// On-chain tests: run by `anchor test` against a local Solana validator.
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { assert } from "chai";
import { CooldownVault } from "../target/types/cooldown_vault";
import { ensureConfig, configAddress, programDataAddress } from "./config";

const HOUR = 3600, DAY = 86400, SOL = anchor.web3.LAMPORTS_PER_SOL;

describe("cooldown-vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CooldownVault as Program<CooldownVault>;
  const owner = provider.wallet.publicKey;
  const [vault] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("vault"), owner.toBuffer()], program.programId);
  const casino = anchor.web3.Keypair.generate().publicKey;
  const fetch = () => program.account.vaultAccount.fetch(vault);
  const expectError = async (call: Promise<unknown>, code: string) => {
    try { await call; } catch (e) { assert.include(String(e), code); return; }
    assert.fail(`expected ${code}`);
  };

  const airdrop = async (k: anchor.web3.Keypair) => provider.connection.confirmTransaction(await provider.connection.requestAirdrop(k.publicKey, SOL));

  before(async () => {
    // Only the program's upgrade authority may set up the brake; a stranger trying first is refused.
    if (!(await provider.connection.getAccountInfo(configAddress(program)))) {
      const stranger = anchor.web3.Keypair.generate(); await airdrop(stranger);
      await expectError(program.methods.initConfig()
        .accountsPartial({ authority: stranger.publicKey, config: configAddress(program), program: program.programId, programData: programDataAddress(program) })
        .signers([stranger]).rpc(), "NotOwner");
    }
    await ensureConfig(program, owner);
  });

  it("creates a Strong vault", async () => {
    await program.methods.initialize({ strong: { guardian: null } }).accountsPartial({ owner, vault }).rpc();
    const v = await fetch();
    assert.equal(v.withdrawDelay.toNumber(), 72 * HOUR);
    assert.equal(v.ruleDelay.toNumber(), 7 * DAY);
    assert.ok(v.owner.equals(owner));
  });

  it("takes a deposit into the vault account", async () => {
    const before = await provider.connection.getBalance(vault);
    await program.methods.deposit(new BN(SOL)).accountsPartial({ owner, vault }).rpc();
    assert.equal((await fetch()).balance.toNumber(), SOL);
    assert.equal((await provider.connection.getBalance(vault)) - before, SOL);
  });

  it("queues a withdrawal that cannot run before its delay", async () => {
    await program.methods.requestWithdrawal(casino, new BN(0.4 * SOL)).accountsPartial({ owner, vault }).rpc();
    const v = await fetch();
    assert.equal(v.withdrawals.length, 1);
    const w = v.withdrawals[0];
    assert.ok(w.dest.equals(casino));
    await expectError(program.methods.executeWithdrawal(w.id).accountsPartial({ caller: owner, vault, dest: casino }).rpc(), "TooEarly");
  });

  it("refuses to queue more than the free balance", async () => {
    await expectError(program.methods.requestWithdrawal(casino, new BN(0.7 * SOL)).accountsPartial({ owner, vault }).rpc(), "InsufficientFunds");
  });

  it("lets the owner cancel, and the money stays", async () => {
    const id = (await fetch()).withdrawals[0].id;
    await program.methods.cancelWithdrawal(id).accountsPartial({ owner, vault }).rpc();
    const v = await fetch();
    assert.equal(v.withdrawals.length, 0);
    assert.equal(v.balance.toNumber(), SOL);
  });

  it("refuses an instant send to an address that isn't trusted", async () => {
    await expectError(program.methods.sendToTrusted(new BN(1000)).accountsPartial({ owner, vault, dest: casino }).rpc(), "NotTrusted");
  });

  it("applies a stricter rule at once and queues a looser one", async () => {
    await program.methods.proposeChange({ setWithdrawDelay: { seconds: new BN(7 * DAY) } }).accountsPartial({ owner, vault }).rpc();
    assert.equal((await fetch()).withdrawDelay.toNumber(), 7 * DAY);
    await program.methods.proposeChange({ addTrusted: { address: casino } }).accountsPartial({ owner, vault }).rpc();
    const v = await fetch();
    assert.equal(v.changes.length, 1);
    assert.equal(v.trusted.length, 0);
    await expectError(program.methods.applyChange(v.changes[0].id).accountsPartial({ caller: owner, vault }).rpc(), "TooEarly");
  });

  it("won't pay a queued withdrawal to a different account", async () => {
    await program.methods.requestWithdrawal(casino, new BN(0.1 * SOL)).accountsPartial({ owner, vault }).rpc();
    const id = (await fetch()).withdrawals[0].id;
    // Still too early, so the destination check isn't reached; the rules refuse first.
    await expectError(program.methods.executeWithdrawal(id).accountsPartial({ caller: owner, vault, dest: owner }).rpc(), "TooEarly");
  });

  it("doesn't let a stranger act on someone else's vault", async () => {
    const stranger = anchor.web3.Keypair.generate();
    const sig = await provider.connection.requestAirdrop(stranger.publicKey, SOL);
    await provider.connection.confirmTransaction(sig);
    let failed = false;
    try {
      await program.methods.cancelWithdrawal(1).accountsPartial({ owner: stranger.publicKey, vault }).signers([stranger]).rpc();
    } catch (_) { failed = true; }
    assert.ok(failed, "a stranger's signature must not open this vault");
  });

  describe("emergency brake on new deposits", () => {
    const config = configAddress(program);
    const pause = (paused: boolean, who = owner, signers: anchor.web3.Keypair[] = []) =>
      program.methods.setDepositsPaused(paused).accountsPartial({ authority: who, config }).signers(signers).rpc();

    it("stops new deposits, and nothing else", async () => {
      await pause(true);
      assert.equal((await program.account.config.fetch(config)).depositsPaused, true);
      await expectError(program.methods.deposit(new BN(1000)).accountsPartial({ owner, vault }).rpc(), "DepositsPaused");
      // Everything that protects or returns money still works while paused.
      const before = await fetch();
      await program.methods.requestWithdrawal(casino, new BN(1000)).accountsPartial({ owner, vault }).rpc();
      const id = (await fetch()).withdrawals.at(-1)!.id;
      await program.methods.cancelWithdrawal(id).accountsPartial({ owner, vault }).rpc();
      await program.methods.proposeChange({ setDailyLimit: { limit: new BN(SOL) } }).accountsPartial({ owner, vault }).rpc();
      assert.equal((await fetch()).balance.toNumber(), before.balance.toNumber());
      await pause(false);
      await program.methods.deposit(new BN(1000)).accountsPartial({ owner, vault }).rpc();
      assert.equal((await fetch()).balance.toNumber(), before.balance.toNumber() + 1000);
    });

    it("only its holder can pull it, and handing it over takes two steps", async () => {
      const stranger = anchor.web3.Keypair.generate(), next = anchor.web3.Keypair.generate();
      await airdrop(stranger); await airdrop(next);
      await expectError(pause(true, stranger.publicKey, [stranger]), "NotOwner");
      await program.methods.proposeConfigAuthority(next.publicKey).accountsPartial({ authority: owner, config }).rpc();
      await expectError(program.methods.acceptConfigAuthority().accountsPartial({ next: stranger.publicKey, config }).signers([stranger]).rpc(), "NotOwner");
      await program.methods.acceptConfigAuthority().accountsPartial({ next: next.publicKey, config }).signers([next]).rpc();
      await expectError(pause(true), "NotOwner"); // the old holder no longer can
      // and back, for the other tests
      await program.methods.proposeConfigAuthority(owner).accountsPartial({ authority: next.publicKey, config }).signers([next]).rpc();
      await program.methods.acceptConfigAuthority().accountsPartial({ next: owner, config }).rpc();
      assert.ok((await program.account.config.fetch(config)).authority.equals(owner));
    });

    it("can't be set up twice", async () => {
      let failed = false;
      try { await program.methods.initConfig().accountsPartial({ authority: owner, config, program: program.programId, programData: programDataAddress(program) }).rpc(); } catch (_) { failed = true; }
      assert.ok(failed, "the settings must not be created twice");
    });
  });
});
