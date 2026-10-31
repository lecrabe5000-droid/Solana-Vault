// On-chain tests for token vaults (USDC and other SPL tokens), run by `anchor test` on a local validator.
// The local clock can't jump 72 hours, so the paths that pay out are tested through the guardian, who
// can release a requested withdrawal and approve a trusted address early.
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { assert } from "chai";
import { createMint, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo, getAccount, transfer } from "@solana/spl-token";
import { CooldownVault } from "../target/types/cooldown_vault";

const { Keypair, PublicKey, LAMPORTS_PER_SOL: SOL } = anchor.web3;
const USDC = 1_000_000; // 6 decimals

describe("token vaults", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CooldownVault as Program<CooldownVault>;
  const conn = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const owner = Keypair.generate(), guardian = Keypair.generate(), shop = Keypair.generate(), stranger = Keypair.generate();
  const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const vault = pda(Buffer.from("vault"), owner.publicKey.toBuffer());
  let mint: anchor.web3.PublicKey, tvault: anchor.web3.PublicKey, vaultTokens: anchor.web3.PublicKey, ownerTokens: anchor.web3.PublicKey;
  const ata = (who: anchor.web3.PublicKey) => getAssociatedTokenAddressSync(mint, who, true);
  const held = async (a: anchor.web3.PublicKey) => Number((await getAccount(conn, a)).amount);
  const fetchT = () => program.account.tokenVaultAccount.fetch(tvault);
  const expectError = async (call: Promise<unknown>, code: string) => {
    try { await call; } catch (e) { assert.include(String(e), code); return; }
    assert.fail(`expected ${code}`);
  };
  const payout = (caller: anchor.web3.PublicKey, dest: anchor.web3.PublicKey) => ({ caller, vault, tokenVault: tvault, mint, vaultTokens, dest, destTokens: ata(dest) });

  before(async () => {
    for (const k of [owner, guardian, stranger]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 2 * SOL));
    mint = await createMint(conn, payer, payer.publicKey, null, 6);
    ownerTokens = (await getOrCreateAssociatedTokenAccount(conn, payer, mint, owner.publicKey)).address;
    await mintTo(conn, payer, mint, ownerTokens, payer, 500 * USDC);
    for (const k of [shop, guardian, stranger]) await getOrCreateAssociatedTokenAccount(conn, payer, mint, k.publicKey);
    tvault = pda(Buffer.from("tvault"), owner.publicKey.toBuffer(), mint.toBuffer());
    vaultTokens = ata(tvault);
    await program.methods.initialize({ strong: { guardian: guardian.publicKey } }).accountsPartial({ owner: owner.publicKey, vault }).signers([owner]).rpc();
  });

  it("opens a token vault next to the main vault", async () => {
    await program.methods.openTokenVault().accountsPartial({ owner: owner.publicKey, vault, mint, tokenVault: tvault, vaultTokens }).signers([owner]).rpc();
    const t = await fetchT();
    assert.ok(t.owner.equals(owner.publicKey) && t.mint.equals(mint));
    assert.equal(t.dailyLimit, null);
    assert.equal(await held(vaultTokens), 0);
  });

  it("takes a deposit into the vault's token account", async () => {
    await program.methods.depositToken(new BN(200 * USDC)).accountsPartial({ owner: owner.publicKey, tokenVault: tvault, mint, from: ownerTokens, vaultTokens }).signers([owner]).rpc();
    assert.equal(await held(vaultTokens), 200 * USDC);
    assert.equal(await held(ownerTokens), 300 * USDC);
  });

  it("counts coins sent straight to the vault's token account too", async () => {
    await transfer(conn, payer, ownerTokens, vaultTokens, owner, 10 * USDC);
    assert.equal(await held(vaultTokens), 210 * USDC);
  });

  it("queues a withdrawal with the main vault's delay and an id from its counter", async () => {
    const before = (await program.account.vaultAccount.fetch(vault)).nextId;
    await program.methods.requestTokenWithdrawal(shop.publicKey, new BN(50 * USDC)).accountsPartial({ owner: owner.publicKey, vault, tokenVault: tvault, vaultTokens }).signers([owner]).rpc();
    const t = await fetchT();
    assert.equal(t.withdrawals.length, 1);
    assert.equal(t.withdrawals[0].id, before);
    assert.equal((await program.account.vaultAccount.fetch(vault)).nextId, before + 1);
    const wait = t.withdrawals[0].readyAt.toNumber() - Math.floor(Date.now() / 1000);
    assert.isAbove(wait, 71 * 3600);
    await expectError(program.methods.executeTokenWithdrawal(t.withdrawals[0].id).accountsPartial(payout(stranger.publicKey, shop.publicKey)).signers([stranger]).rpc(), "TooEarly");
  });

  it("won't queue more than what isn't already promised", async () => {
    await expectError(program.methods.requestTokenWithdrawal(shop.publicKey, new BN(161 * USDC)).accountsPartial({ owner: owner.publicKey, vault, tokenVault: tvault, vaultTokens }).signers([owner]).rpc(), "InsufficientFunds");
  });

  it("refuses a stranger, and a guardian who tries to pay somewhere else", async () => {
    const id = (await fetchT()).withdrawals[0].id;
    await expectError(program.methods.cancelTokenWithdrawal(id).accountsPartial({ owner: stranger.publicKey, vault, tokenVault: tvault, vaultTokens }).signers([stranger]).rpc(), "Error");
    await expectError(program.methods.guardianReleaseToken(id).accountsPartial(payout(stranger.publicKey, shop.publicKey)).signers([stranger]).rpc(), "NotGuardian");
    await expectError(program.methods.guardianReleaseToken(id).accountsPartial(payout(guardian.publicKey, guardian.publicKey)).signers([guardian]).rpc(), "WrongDestination");
  });

  it("lets the guardian release a requested withdrawal now, to the address the owner chose", async () => {
    const id = (await fetchT()).withdrawals[0].id;
    await program.methods.guardianReleaseToken(id).accountsPartial(payout(guardian.publicKey, shop.publicKey)).signers([guardian]).rpc();
    assert.equal(await held(ata(shop.publicKey)), 50 * USDC);
    assert.equal(await held(vaultTokens), 160 * USDC);
    assert.equal((await fetchT()).withdrawals.length, 0);
  });

  it("lets the owner cancel, and the coins stay", async () => {
    await program.methods.requestTokenWithdrawal(stranger.publicKey, new BN(20 * USDC)).accountsPartial({ owner: owner.publicKey, vault, tokenVault: tvault, vaultTokens }).signers([owner]).rpc();
    const id = (await fetchT()).withdrawals[0].id;
    await program.methods.cancelTokenWithdrawal(id).accountsPartial({ owner: owner.publicKey, vault, tokenVault: tvault, vaultTokens }).signers([owner]).rpc();
    assert.equal((await fetchT()).withdrawals.length, 0);
    assert.equal(await held(vaultTokens), 160 * USDC);
  });

  it("uses the main vault's trusted list for instant sends", async () => {
    const send = (amount: number) => program.methods.sendTokenToTrusted(new BN(amount)).accountsPartial({ owner: owner.publicKey, vault, tokenVault: tvault, mint, vaultTokens, dest: shop.publicKey, destTokens: ata(shop.publicKey) }).signers([owner]).rpc();
    await expectError(send(USDC), "NotTrusted");
    await program.methods.proposeChange({ addTrusted: { address: shop.publicKey } }).accountsPartial({ owner: owner.publicKey, vault }).signers([owner]).rpc();
    const change = (await program.account.vaultAccount.fetch(vault)).changes[0];
    await program.methods.guardianApproveChange(change.id).accountsPartial({ guardian: guardian.publicKey, vault }).signers([guardian]).rpc();
    await send(10 * USDC);
    assert.equal(await held(ata(shop.publicKey)), 60 * USDC);
  });

  it("has its own daily limit: lowering applies at once, raising waits", async () => {
    await program.methods.proposeTokenLimit(new BN(15 * USDC)).accountsPartial({ owner: owner.publicKey, vault, tokenVault: tvault, vaultTokens }).signers([owner]).rpc();
    assert.equal((await fetchT()).dailyLimit.toNumber(), 15 * USDC);
    // 10 already left today, so 6 more would pass 15.
    await expectError(program.methods.sendTokenToTrusted(new BN(6 * USDC)).accountsPartial({ owner: owner.publicKey, vault, tokenVault: tvault, mint, vaultTokens, dest: shop.publicKey, destTokens: ata(shop.publicKey) }).signers([owner]).rpc(), "DailyLimit");
    await program.methods.proposeTokenLimit(null).accountsPartial({ owner: owner.publicKey, vault, tokenVault: tvault, vaultTokens }).signers([owner]).rpc();
    const t = await fetchT();
    assert.equal(t.dailyLimit.toNumber(), 15 * USDC);
    assert.equal(t.changes.length, 1);
    await expectError(program.methods.applyTokenChange(t.changes[0].id).accountsPartial({ caller: stranger.publicKey, vault, tokenVault: tvault }).signers([stranger]).rpc(), "TooEarly");
    await program.methods.cancelTokenChange(t.changes[0].id).accountsPartial({ owner: owner.publicKey, vault, tokenVault: tvault, vaultTokens }).signers([owner]).rpc();
    assert.equal((await fetchT()).changes.length, 0);
  });

  it("doesn't let anyone open a token vault in someone else's name", async () => {
    const other = pda(Buffer.from("tvault"), stranger.publicKey.toBuffer(), mint.toBuffer());
    await expectError(program.methods.openTokenVault().accountsPartial({ owner: owner.publicKey, vault, mint, tokenVault: other, vaultTokens: ata(other) }).signers([owner]).rpc(), "Error");
  });

  it("leaves the SOL side of the vault alone", async () => {
    const v = await program.account.vaultAccount.fetch(vault);
    assert.equal(v.balance.toNumber(), 0);
    assert.equal(v.withdrawals.length, 0);
    assert.equal(v.trusted.length, 1);
  });
});
