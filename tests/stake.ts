// Staking from the Safe: the stake account belongs to the vault (staker and withdrawer), so staked SOL can only
// come back into the vault. Runs against the local validator's own vote account.
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { assert } from "chai";
import { CooldownVault } from "../target/types/cooldown_vault";
import { ensureConfig } from "./config";

const SOL = anchor.web3.LAMPORTS_PER_SOL;
const STAKE = new anchor.web3.PublicKey("Stake11111111111111111111111111111111111111");
const STAKE_CONFIG = new anchor.web3.PublicKey("StakeConfig11111111111111111111111111111111");
const S = anchor.web3.SYSVAR_CLOCK_PUBKEY, H = anchor.web3.SYSVAR_STAKE_HISTORY_PUBKEY, R = anchor.web3.SYSVAR_RENT_PUBKEY;

describe("staking from the Safe", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CooldownVault as Program<CooldownVault>;
  const conn = provider.connection;
  const me = anchor.web3.Keypair.generate(), thief = anchor.web3.Keypair.generate();
  const pda = (seeds: (Buffer | Uint8Array)[]) => anchor.web3.PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const vault = pda([Buffer.from("vault"), me.publicKey.toBuffer()]);
  const book = pda([Buffer.from("stakes"), vault.toBuffer()]);
  const stakeAt = (i: number) => pda([Buffer.from("stake"), vault.toBuffer(), Uint8Array.of(i)]);
  let vote: anchor.web3.PublicKey;
  const expectError = async (call: Promise<unknown>, code: string) => {
    try { await call; } catch (e) { assert.include(String(e), code); return; }
    assert.fail(`expected ${code}`);
  };
  const stakeSol = (i: number, amount: number, signer = me) => program.methods.stakeSol(i, new BN(amount))
    .accountsPartial({ owner: signer.publicKey, vault, book, stake: stakeAt(i), vote, clock: S, stakeHistory: H, rent: R, stakeConfig: STAKE_CONFIG, stakeProgram: STAKE })
    .signers([signer]).rpc();
  const books = async () => {
    const v = await program.account.vaultAccount.fetch(vault), lamports = await conn.getBalance(vault);
    const rent = await conn.getMinimumBalanceForRentExemption((await conn.getAccountInfo(vault))!.data.length);
    return { balance: v.balance.toNumber(), spare: lamports - rent - v.balance.toNumber() };
  };

  before(async () => {
    for (const k of [me, thief]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 20 * SOL));
    await ensureConfig(program, provider.wallet.publicKey);
    vote = new anchor.web3.PublicKey((await conn.getVoteAccounts()).current[0].votePubkey);
    await program.methods.initialize({ gentle: {} }).accountsPartial({ owner: me.publicKey, vault }).signers([me]).rpc();
    await program.methods.deposit(new BN(5 * SOL)).accountsPartial({ owner: me.publicKey, vault }).signers([me]).rpc();
    await program.methods.requestWithdrawal(thief.publicKey, new BN(1 * SOL)).accountsPartial({ owner: me.publicKey, vault }).signers([me]).rpc();
    await program.methods.openStakes().accountsPartial({ owner: me.publicKey, vault, book }).signers([me]).rpc();
  });

  it("stakes free SOL into a stake account the vault controls", async () => {
    await stakeSol(0, 3 * SOL);
    const b = await program.account.stakeBook.fetch(book);
    assert.equal(b.slots.length, 1); assert.equal(b.slots[0].principal.toNumber(), 3 * SOL); assert.ok(b.slots[0].vote.equals(vote));
    const acct = await conn.getParsedAccountInfo(stakeAt(0));
    assert.ok(acct.value!.owner.equals(STAKE));
    const info = (acct.value!.data as anchor.web3.ParsedAccountData).parsed.info;
    assert.equal(info.meta.authorized.staker, vault.toBase58());
    assert.equal(info.meta.authorized.withdrawer, vault.toBase58());
    assert.equal(info.meta.lockup.custodian, anchor.web3.PublicKey.default.toBase58());
    assert.equal(info.stake.delegation.voter, vote.toBase58());
    assert.equal(Number(info.stake.delegation.stake), 3 * SOL);
    const k = await books(); assert.equal(k.balance, 2 * SOL); assert.isAtLeast(k.spare, 0);
  });

  it("never stakes money promised to a queued withdrawal", async () => {
    await expectError(stakeSol(1, 1.5 * SOL), "InsufficientFunds");
  });

  it("only the owner can stake or unstake", async () => {
    const tv = pda([Buffer.from("vault"), thief.publicKey.toBuffer()]);
    await expectError(program.methods.unstakeSol(0).accountsPartial({ owner: thief.publicKey, vault: tv, book, stake: stakeAt(0), clock: S, stakeProgram: STAKE }).signers([thief]).rpc(), "Error");
    await expectError(program.methods.unstakeSol(0).accountsPartial({ owner: thief.publicKey, vault, book, stake: stakeAt(0), clock: S, stakeProgram: STAKE }).signers([thief]).rpc(), "ConstraintSeeds");
  });

  it("can't bring back a stake that is still active", async () => {
    // wait for the stake to activate (next epoch), then try to reclaim without unstaking
    const e0 = (await conn.getEpochInfo()).epoch;
    while ((await conn.getEpochInfo()).epoch <= e0) await new Promise((r) => setTimeout(r, 1000));
    await expectError(program.methods.reclaimStake(0).accountsPartial({ caller: thief.publicKey, vault, book, stake: stakeAt(0), clock: S, stakeHistory: H, stakeProgram: STAKE }).signers([thief]).rpc(), "Error");
  });

  it("unstakes, and anyone can bring it back, only into the vault, rewards included", async () => {
    await program.methods.unstakeSol(0).accountsPartial({ owner: me.publicKey, vault, book, stake: stakeAt(0), clock: S, stakeProgram: STAKE }).signers([me]).rpc();
    assert.isTrue((await program.account.stakeBook.fetch(book)).slots[0].unstaking);
    const thiefBefore = await conn.getBalance(thief.publicKey);
    let done = false;
    for (let i = 0; i < 180 && !done; i++) {
      try {
        await program.methods.reclaimStake(0).accountsPartial({ caller: thief.publicKey, vault, book, stake: stakeAt(0), clock: S, stakeHistory: H, stakeProgram: STAKE }).signers([thief]).rpc();
        done = true;
      } catch (_) { await new Promise((r) => setTimeout(r, 1000)); }
    }
    assert.isTrue(done, "stake never cooled down");
    const k = await books();
    assert.isAtLeast(k.balance, 5 * SOL); // 2 SOL free + 3 SOL staked + the stake account's rent (and any rewards)
    assert.isAtLeast(k.spare, 0);
    assert.equal((await program.account.stakeBook.fetch(book)).slots.length, 0);
    assert.isNull(await conn.getAccountInfo(stakeAt(0)));
    assert.isAtMost(await conn.getBalance(thief.publicKey), thiefBefore); // running it gained the caller nothing
  });

  it("a slot can be reused once its stake came back", async () => {
    await stakeSol(0, 1 * SOL);
    assert.equal((await program.account.stakeBook.fetch(book)).slots.length, 1);
  });
});
