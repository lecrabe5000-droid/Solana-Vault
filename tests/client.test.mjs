// Runs the browser client (app/chain.js) against a local validator with the real program loaded.
// CI starts the validator; locally: solana-test-validator --bpf-program <id> target/deploy/cooldown_vault.so
import fs from "node:fs";
import os from "node:os";
import * as web3 from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { createClient, explainError } from "../app/chain.js";

const DAY = 86400, HOUR = 3600, SOL = web3.LAMPORTS_PER_SOL;
const programKey = JSON.parse(fs.readFileSync(new URL("../keys/localnet-program-keypair.json", import.meta.url)));
const programId = web3.Keypair.fromSecretKey(Uint8Array.from(programKey)).publicKey;
const connection = new web3.Connection(process.env.RPC || "http://127.0.0.1:8899", "confirmed");
const client = createClient({ web3, connection, programId });

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ✔", name); } catch (e) { failed++; console.log("  ✘", name, "\n   ", e.message); } };
const eq = (a, b, what = "") => { if (a !== b) throw new Error(`${what} expected ${b}, got ${a}`); };
const send = async (signer, ...ixs) => {
  const tx = new web3.Transaction().add(...(await Promise.all(ixs.flat())).flat());
  return web3.sendAndConfirmTransaction(connection, tx, [signer], { commitment: "confirmed" });
};
const fails = async (p, code) => {
  try { await p; } catch (e) { const got = explainError(e).code; if (got === code) return; throw new Error(`expected ${code}, got ${got}: ${String(e.message).slice(0, 120)}`); }
  throw new Error(`expected ${code}, got success`);
};
const fund = async (kp, sol = 5) => { const sig = await connection.requestAirdrop(kp.publicKey, sol * SOL); await connection.confirmTransaction(sig, "confirmed"); };

const owner = web3.Keypair.generate(), guardian = web3.Keypair.generate(), stranger = web3.Keypair.generate();
const casino = web3.Keypair.generate().publicKey, bank = web3.Keypair.generate().publicKey;

console.log("browser client against", connection.rpcEndpoint, "program", programId.toBase58());
await fund(owner); await fund(guardian, 1); await fund(stranger, 1);

await test("no vault before it is created", async () => { eq(await client.fetchVault(owner.publicKey), null); });

await test("creates a Strong vault with a guardian", async () => {
  await send(owner, client.build.initialize(owner.publicKey, { kind: "strong", guardian: guardian.publicKey }));
  const v = await client.fetchVault(owner.publicKey);
  eq(v.withdrawDelay, 72 * HOUR, "delay"); eq(v.ruleDelay, 7 * DAY, "rule delay");
  eq(v.guardian.toBase58(), guardian.publicKey.toBase58(), "guardian");
  eq(v.owner.toBase58(), owner.publicKey.toBase58(), "owner");
});

await test("deposits and reads the balance back", async () => {
  await send(owner, client.build.deposit(owner.publicKey, 2 * SOL));
  const v = await client.fetchVault(owner.publicKey);
  eq(v.balance, 2 * SOL, "balance"); eq(v.available, 2 * SOL, "available");
});

let wid;
await test("queues a withdrawal with a ready time three days out", async () => {
  const now = await client.chainTime();
  await send(owner, client.build.requestWithdrawal(owner.publicKey, casino, 0.5 * SOL));
  const v = await client.fetchVault(owner.publicKey), w = v.withdrawals[0];
  wid = w.id;
  eq(v.withdrawals.length, 1); eq(w.amount, 0.5 * SOL); eq(w.dest.toBase58(), casino.toBase58());
  if (Math.abs(w.readyAt - (now + 72 * HOUR)) > 120) throw new Error("readyAt " + w.readyAt);
  eq(v.available, 1.5 * SOL, "available");
});

await test("an early run is refused with TooEarly", async () => {
  await fails(send(owner, client.build.executeWithdrawal(owner.publicKey, owner.publicKey, wid, casino)), "TooEarly");
});

await test("a stranger can't cancel it", async () => {
  // The stranger's signature derives the stranger's own (empty) vault, so the call fails.
  let threw = false;
  try { await send(stranger, client.build.cancelWithdrawal(stranger.publicKey, wid)); } catch (_) { threw = true; }
  if (!threw) throw new Error("stranger succeeded");
});

await test("the guardian can release it now (emergency)", async () => {
  const before = await connection.getBalance(casino);
  await send(guardian, client.build.guardianRelease(guardian.publicKey, owner.publicKey, wid, casino));
  eq(await connection.getBalance(casino) - before, 0.5 * SOL, "received");
  eq((await client.fetchVault(owner.publicKey)).balance, 1.5 * SOL, "balance");
});

await test("owner cancels a second withdrawal and the money stays", async () => {
  await send(owner, client.build.requestWithdrawal(owner.publicKey, casino, 1 * SOL));
  const id = (await client.fetchVault(owner.publicKey)).withdrawals[0].id;
  await send(owner, client.build.cancelWithdrawal(owner.publicKey, id));
  const v = await client.fetchVault(owner.publicKey);
  eq(v.withdrawals.length, 0); eq(v.available, 1.5 * SOL);
});

await test("instant send to an untrusted address is refused", async () => {
  await fails(send(owner, client.build.sendToTrusted(owner.publicKey, bank, 1000)), "NotTrusted");
});

await test("stricter rule applies now, adding a trusted address waits, guardian approves it", async () => {
  await send(owner, client.build.proposeChange(owner.publicKey, { kind: "SetWithdrawDelay", value: 7 * DAY }));
  eq((await client.fetchVault(owner.publicKey)).withdrawDelay, 7 * DAY, "delay");
  await send(owner, client.build.proposeChange(owner.publicKey, { kind: "AddTrusted", value: bank }));
  let v = await client.fetchVault(owner.publicKey);
  eq(v.changes.length, 1); eq(v.changes[0].change.kind, "AddTrusted"); eq(v.trusted.length, 0);
  await fails(send(owner, client.build.applyChange(owner.publicKey, owner.publicKey, v.changes[0].id)), "TooEarly");
  await send(guardian, client.build.guardianApproveChange(guardian.publicKey, owner.publicKey, v.changes[0].id));
  v = await client.fetchVault(owner.publicKey);
  eq(v.trusted.length, 1); eq(v.trusted[0].toBase58(), bank.toBase58());
});

await test("now the trusted send arrives instantly", async () => {
  await send(owner, client.build.sendToTrusted(owner.publicKey, bank, 0.25 * SOL));
  eq(await connection.getBalance(bank), 0.25 * SOL, "bank");
  eq((await client.fetchVault(owner.publicKey)).balance, 1.25 * SOL, "balance");
});

await test("a looser rule change is queued and can be cancelled", async () => {
  await send(owner, client.build.proposeChange(owner.publicKey, { kind: "SetDailyLimit", value: 1 * SOL }));
  eq((await client.fetchVault(owner.publicKey)).dailyLimit, 1 * SOL, "stricter limit applied");
  await send(owner, client.build.proposeChange(owner.publicKey, { kind: "SetDailyLimit", value: null }));
  const v = await client.fetchVault(owner.publicKey);
  eq(v.changes.length, 1); eq(v.changes[0].change.kind, "SetDailyLimit"); eq(v.changes[0].change.value, null);
  await send(owner, client.build.cancelChange(owner.publicKey, v.changes[0].id));
  eq((await client.fetchVault(owner.publicKey)).changes.length, 0);
});

await test("a Locked vault with a date reads back", async () => {
  const lockedOwner = web3.Keypair.generate(); await fund(lockedOwner, 1);
  const until = (await client.chainTime()) + 30 * DAY;
  await send(lockedOwner, client.build.initialize(lockedOwner.publicKey, { kind: "locked", until, guardian: guardian.publicKey }));
  const v = await client.fetchVault(lockedOwner.publicKey);
  eq(v.lockedUntil, until, "lockedUntil");
});

// ---------------------------------------------------------------- tokens (a test USDC)
const USD = 1_000_000;
const mint = await createMint(connection, owner, owner.publicKey, null, 6);
await mintTo(connection, owner, mint, (await getOrCreateAssociatedTokenAccount(connection, owner, mint, owner.publicKey)).address, owner, 300 * USD);
const usdc = client.token(mint);

await test("token: nothing before it is opened; the wallet balance reads", async () => {
  eq(await usdc.fetch(owner.publicKey), null);
  eq(await usdc.walletBalance(owner.publicKey), 300 * USD, "wallet");
});

await test("token: opens and deposits in one transaction", async () => {
  await send(owner, usdc.build.open(owner.publicKey), usdc.build.deposit(owner.publicKey, 120 * USD));
  const t = await usdc.fetch(owner.publicKey);
  eq(t.balance, 120 * USD, "balance"); eq(t.available, 120 * USD, "available"); eq(t.dailyLimit, null, "limit");
  eq(t.mint.toBase58(), mint.toBase58(), "mint");
});

let tid;
await test("token: queues a withdrawal and refuses to run it early", async () => {
  await send(owner, usdc.build.requestWithdrawal(owner.publicKey, casino, 20 * USD));
  const t = await usdc.fetch(owner.publicKey); tid = t.withdrawals[0].id;
  eq(t.withdrawals.length, 1); eq(t.available, 100 * USD, "available");
  await fails(send(stranger, usdc.build.executeWithdrawal(stranger.publicKey, owner.publicKey, tid, casino)), "TooEarly");
});

await test("token: the guardian releases it into an account created on the way", async () => {
  await send(guardian, usdc.build.guardianRelease(guardian.publicKey, owner.publicKey, tid, casino));
  eq(await usdc.walletBalance(casino), 20 * USD, "casino got it");
  eq((await usdc.fetch(owner.publicKey)).balance, 100 * USD, "balance");
});

await test("token: sends instantly to the vault's trusted bank", async () => {
  await send(owner, usdc.build.sendToTrusted(owner.publicKey, bank, 5 * USD));
  eq(await usdc.walletBalance(bank), 5 * USD, "bank");
});

await test("token: lowering the limit applies, raising waits and cancels", async () => {
  await send(owner, usdc.build.proposeLimit(owner.publicKey, 50 * USD));
  eq((await usdc.fetch(owner.publicKey)).dailyLimit, 50 * USD, "limit");
  await send(owner, usdc.build.proposeLimit(owner.publicKey, null));
  const t = await usdc.fetch(owner.publicKey);
  eq(t.changes.length, 1); eq(t.changes[0].change.kind, "SetDailyLimit"); eq(t.changes[0].change.value, null);
  await fails(send(stranger, usdc.build.applyChange(stranger.publicKey, owner.publicKey, t.changes[0].id)), "TooEarly");
  await send(owner, usdc.build.cancelChange(owner.publicKey, t.changes[0].id));
  eq((await usdc.fetch(owner.publicKey)).changes.length, 0);
});

await test("token: the owner cancels a request and the coins stay", async () => {
  await send(owner, usdc.build.requestWithdrawal(owner.publicKey, casino, 1 * USD));
  const id = (await usdc.fetch(owner.publicKey)).withdrawals[0].id;
  await send(owner, usdc.build.cancelWithdrawal(owner.publicKey, id));
  const t = await usdc.fetch(owner.publicKey);
  eq(t.withdrawals.length, 0); eq(t.balance, 95 * USD);
});

console.log(`\n${passed} passing, ${failed} failing`);
process.exit(failed ? 1 : 0);
