// On-chain tests: run by `anchor test` against a local Solana validator.
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { assert } from "chai";
import { CooldownVault } from "../target/types/cooldown_vault";

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
});
