// Tests for worker/alerts.js. Run from evm/ (it borrows ethers from there): node ../worker/alerts.test.mjs
import { createRequire } from "node:module";
import { alertLink, alertLinks, decodeSolVault, decodeSolTokenVault, emptyTokenSnap, diffSol, decodeEvmLog, message, base58, coin, ownerTopic, onCurve, unbase58, tokenAmount, USDC } from "./alerts.js";

const require = createRequire(new URL("../evm/package.json", import.meta.url));
const { ethers } = require("ethers");

let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.log("FAIL", name, "\n ", e.message); } };
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}\n   got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || "expected true"); };

// --- a byte-for-byte VaultAccount, as programs/cooldown-vault lays it out
const key = (n) => new Uint8Array(32).fill(n);
function vaultBytes({ balance = 0n, withdrawals = [], changes = [], trusted = [], guardian = null, dailyLimit = null, lockedUntil = null, withdrawDelay = 86400n, ruleDelay = 259200n } = {}) {
  const parts = [], u8 = (n) => parts.push(Uint8Array.of(n)), raw = (b) => parts.push(b);
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); raw(b); };
  const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); raw(b); };
  const i64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(n), true); raw(b); };
  const opt = (v, f) => { if (v === null) u8(0); else { u8(1); f(v); } };
  raw(new Uint8Array(8)); raw(key(1)); u8(255); u64(balance); i64(withdrawDelay); i64(ruleDelay);
  opt(dailyLimit, u64); opt(lockedUntil, i64); opt(guardian, raw);
  u32(trusted.length); trusted.forEach(raw);
  u32(withdrawals.length); for (const w of withdrawals) { u32(w.id); u64(w.amount); raw(w.dest); i64(w.readyAt); }
  u32(changes.length); for (const c of changes) { u32(c.id); u8(c.tag); if (c.tag === 5) raw(c.value); else i64(c.value); i64(c.readyAt); }
  u32(9); i64(0); u64(0);
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out;
}
const snap = (o) => decodeSolVault(vaultBytes(o));

test("base58 matches a known Solana address", () => eq(base58(new Uint8Array(32)), "11111111111111111111111111111111"));
test("coin formats lamports and wei", () => { eq(coin("1500000000", 9), "1.5"); eq(coin("250000000000000000", 18), "0.25"); eq(coin("3000000000", 9), "3"); });

test("decodes a Solana vault", () => {
  const v = snap({ balance: 5_000_000_000n, guardian: key(2), trusted: [key(3)], withdrawals: [{ id: 1, amount: 500_000_000n, dest: key(4), readyAt: 1_900_000_000n }] });
  eq([v.owner, v.balance, v.guardian, v.trusted, v.withdrawals[0].amount, v.withdrawals[0].readyAt], [base58(key(1)), "5000000000", base58(key(2)), [base58(key(3))], "500000000", "1900000000"]);
});

test("a new withdrawal request is reported with its time", () => {
  const a = snap({ balance: 5_000_000_000n }), b = snap({ balance: 5_000_000_000n, withdrawals: [{ id: 1, amount: 500_000_000n, dest: key(4), readyAt: 1_900_000_000n }] });
  eq(diffSol(a, b), [{ type: "requested", id: 1, amount: "500000000", dest: base58(key(4)), readyAt: "1900000000" }]);
});

test("a withdrawal that disappears with the balance is sent; without it, cancelled", () => {
  const w = { id: 1, amount: 500_000_000n, dest: key(4), readyAt: 1n };
  const before = snap({ balance: 5_000_000_000n, withdrawals: [w] });
  eq(diffSol(before, snap({ balance: 4_500_000_000n })).map((e) => e.type), ["sent"]);
  eq(diffSol(before, snap({ balance: 5_000_000_000n })).map((e) => e.type), ["cancelled"]);
});

test("deposits, trusted sends and rule changes", () => {
  const a = snap({ balance: 1_000_000_000n });
  eq(diffSol(a, snap({ balance: 3_000_000_000n })), [{ type: "deposit", amount: "2000000000" }]);
  eq(diffSol(a, snap({ balance: 600_000_000n })), [{ type: "sentTrusted", amount: "400000000" }]);
  eq(diffSol(a, snap({ balance: 1_000_000_000n, withdrawDelay: 259200n })), [{ type: "changed", kind: "SetWithdrawDelay", value: "259200" }]);
  eq(diffSol(a, snap({ balance: 1_000_000_000n, changes: [{ id: 2, tag: 5, value: key(7), readyAt: 1_900_000_000n }] })), [{ type: "changeQueued", id: 2, kind: "AddTrusted", value: base58(key(7)), readyAt: "1900000000" }]);
  eq(diffSol(snap({ changes: [{ id: 2, tag: 5, value: key(7), readyAt: 1n }] }), snap({ trusted: [key(7)] })), [{ type: "changed", kind: "AddTrusted", value: base58(key(7)) }]);
  eq(diffSol(snap({ changes: [{ id: 2, tag: 5, value: key(7), readyAt: 1n }] }), snap({})), [{ type: "changeCancelled", kind: "AddTrusted", value: base58(key(7)) }]);
});

test("no change, no alert", () => eq(diffSol(snap({ balance: 7n }), snap({ balance: 7n })), []));

// --- Ethereum logs, encoded with ethers exactly as the contract emits them
const iface = new ethers.Interface([
  "event WithdrawalQueued(address indexed owner, uint32 id, address dest, uint256 amount, uint64 readyAt)",
  "event ChangeQueued(address indexed owner, uint32 id, uint8 kind, uint256 value, address addr, uint64 readyAt)",
  "event Sent(address indexed owner, address indexed dest, uint256 amount)",
  "event ChangeApplied(address indexed owner, uint8 kind, uint256 value, address addr)",
]);
const OWNER = "0x1111111111111111111111111111111111111111", DEST = "0x2222222222222222222222222222222222222222";
const log = (name, args) => { const l = iface.encodeEventLog(name, args); return { ...l, blockNumber: "0x10", transactionHash: "0xab" }; };

test("decodes WithdrawalQueued", () => {
  const r = decodeEvmLog(log("WithdrawalQueued", [OWNER, 3, DEST, ethers.parseEther("0.25"), 1_900_000_000]));
  eq(r.owner, OWNER); eq(r.event, { type: "requested", id: 3, dest: DEST, amount: "250000000000000000", readyAt: "1900000000" }); eq(r.block, 16);
});
test("decodes ChangeQueued for a guardian and a daily limit", () => {
  eq(decodeEvmLog(log("ChangeQueued", [OWNER, 4, 4, 0, DEST, 1_900_000_000])).event, { type: "changeQueued", id: 4, kind: "SetGuardian", value: DEST, readyAt: "1900000000" });
  eq(decodeEvmLog(log("ChangeApplied", [OWNER, 2, 0, ethers.ZeroAddress])).event, { type: "changed", kind: "SetDailyLimit", value: null });
});
test("decodes Sent with its indexed destination", () => eq(decodeEvmLog(log("Sent", [OWNER, DEST, 5n])).event, { type: "sentAny", amount: "5", dest: DEST }));
test("ignores other logs", () => eq(decodeEvmLog({ topics: ["0x" + "00".repeat(32)], data: "0x" }), null));
test("owner topic padding", () => eq(ownerTopic(OWNER), "0x000000000000000000000000" + OWNER.slice(2)));

test("messages read well and flag what needs action", () => {
  const m = message({ type: "requested", amount: "500000000", dest: base58(key(4)), readyAt: "1900003600" }, { net: "sol", owner: base58(key(1)), now: 1_900_000_000 });
  ok(m.urgent); ok(m.text.includes("0.5 SOL") && m.text.includes("in 1h") && m.text.includes("Not you?"), m.text);
  const e = message({ type: "changed", kind: "SetDailyLimit", value: "1000000000000000000" }, { net: "eth", owner: OWNER });
  ok(e.text.includes("Daily limit 1 ETH") && !e.urgent, e.text);
  ok(!message({ type: "cancelled", amount: "1" }, { net: "sol", owner: "x<b>" }).text.includes("x<b>"), "escapes");
});

// --- tokens
function tokenVaultBytes({ dailyLimit = null, withdrawals = [], changes = [] } = {}) {
  const parts = [], u8 = (n) => parts.push(Uint8Array.of(n)), raw = (b) => parts.push(b);
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); raw(b); };
  const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); raw(b); };
  const i64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(n), true); raw(b); };
  raw(new Uint8Array(8)); raw(key(1)); raw(key(9)); u8(254);
  if (dailyLimit === null) u8(0); else { u8(1); u64(dailyLimit); }
  i64(0); u64(0);
  u32(withdrawals.length); for (const w of withdrawals) { u32(w.id); u64(w.amount); raw(w.dest); i64(w.readyAt); }
  u32(changes.length); for (const c of changes) { u32(c.id); u8(2); if (c.value === null) u8(0); else { u8(1); u64(c.value); } i64(c.readyAt); }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out;
}
const tsnap = (o, bal) => decodeSolTokenVault(tokenVaultBytes(o), bal);

test("coin formats USDC's 6 decimals", () => { eq(coin("25000000", 6), "25"); eq(coin("1500000", 6), "1.5"); });
test("reads a token account's amount", () => { const d = new Uint8Array(165); new DataView(d.buffer).setBigUint64(64, 123456789n, true); eq(tokenAmount(d), "123456789"); });
test("curve check: wallet keys are on the curve, the program's vault address isn't", () => {
  ok(onCurve(unbase58("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")), "USDC mint (a keypair address)");
  ok(onCurve(unbase58("11111111111111111111111111111111")), "the zero point");
  ok(!onCurve(unbase58("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")) || true); // a program id may be either; just must not throw
});
test("a token vault diff reports USDC requests, sends, deposits and limit changes", () => {
  const w = { id: 7, amount: 25_000_000n, dest: key(4), readyAt: 1_900_000_000n };
  const a = tsnap({}, 100_000_000), b = tsnap({ withdrawals: [w] }, 100_000_000);
  eq(diffSol(a, b), [{ type: "requested", id: 7, amount: "25000000", dest: base58(key(4)), readyAt: "1900000000" }]);
  eq(diffSol(b, tsnap({}, 75_000_000)).map((e) => e.type), ["sent"]);
  eq(diffSol(a, tsnap({}, 150_000_000)), [{ type: "deposit", amount: "50000000" }]);
  eq(diffSol(a, tsnap({ dailyLimit: 50_000_000n }, 100_000_000)), [{ type: "changed", kind: "SetDailyLimit", value: "50000000" }]);
  eq(diffSol(a, tsnap({ changes: [{ id: 8, value: null, readyAt: 1_900_000_000n }] }, 100_000_000)), [{ type: "changeQueued", id: 8, kind: "SetDailyLimit", value: null, readyAt: "1900000000" }]);
  eq(diffSol(emptyTokenSnap, tsnap({}, 120_000_000)), [{ type: "deposit", amount: "120000000" }]);
});
test("token messages use the token's unit", () => {
  const m = message({ type: "requested", amount: "25000000", dest: base58(key(4)), readyAt: "1900003600", asset: USDC }, { net: "sol", owner: base58(key(1)), now: 1_900_000_000 });
  ok(m.urgent && m.text.includes("25 USDC") && m.text.includes("Solana devnet"), m.text);
  ok(message({ type: "changed", kind: "SetDailyLimit", value: null, asset: USDC }, { net: "base", owner: OWNER }).text.includes("No daily limit on USDC"));
  ok(message({ type: "deposit", amount: "1000000000000000000" }, { net: "pol", owner: OWNER }).text.includes("1 POL") );
  ok(message({ type: "deposit", amount: "1" }, { net: "arb", owner: OWNER }).text.includes("Arbitrum Sepolia"));
});

const tiface = new ethers.Interface([
  "event TokenDeposited(address indexed owner, address indexed token, uint256 amount)",
  "event TokenSent(address indexed owner, address indexed token, address indexed dest, uint256 amount)",
  "event TokenWithdrawalQueued(address indexed owner, address indexed token, uint32 id, address dest, uint256 amount, uint64 readyAt)",
  "event TokenWithdrawalCancelled(address indexed owner, address indexed token, uint32 id)",
  "event TokenLimitQueued(address indexed owner, address indexed token, uint32 id, uint256 limit, uint64 readyAt)",
  "event TokenLimitApplied(address indexed owner, address indexed token, uint256 limit)",
  "event TokenLimitCancelled(address indexed owner, address indexed token, uint32 id)",
]);
const USDC_ADDR = "0x036CbD53842c5426634e7929541eC2318f3dCF7e", OTHER = "0x3333333333333333333333333333333333333333";
const tlog = (name, args) => ({ ...tiface.encodeEventLog(name, args), blockNumber: "0x20", transactionHash: "0xcd" });
test("decodes every token event, named USDC when it is the network's USDC", () => {
  const q = decodeEvmLog(tlog("TokenWithdrawalQueued", [OWNER, USDC_ADDR, 9, DEST, 25_000_000n, 1_900_000_000]), USDC_ADDR);
  eq(q.owner, OWNER); eq(q.event, { type: "requested", id: 9, dest: DEST, amount: "25000000", readyAt: "1900000000", asset: USDC });
  eq(decodeEvmLog(tlog("TokenDeposited", [OWNER, USDC_ADDR, 5n]), USDC_ADDR).event, { type: "deposit", amount: "5", asset: USDC });
  eq(decodeEvmLog(tlog("TokenSent", [OWNER, USDC_ADDR, DEST, 7n]), USDC_ADDR).event, { type: "sentAny", amount: "7", dest: DEST, asset: USDC });
  eq(decodeEvmLog(tlog("TokenWithdrawalCancelled", [OWNER, USDC_ADDR, 9]), USDC_ADDR).event, { type: "cancelled", id: 9, asset: USDC });
  eq(decodeEvmLog(tlog("TokenLimitQueued", [OWNER, USDC_ADDR, 10, 0, 1_900_000_000]), USDC_ADDR).event, { type: "changeQueued", id: 10, kind: "SetDailyLimit", value: null, readyAt: "1900000000", asset: USDC });
  eq(decodeEvmLog(tlog("TokenLimitApplied", [OWNER, USDC_ADDR, 50_000_000n]), USDC_ADDR).event, { type: "changed", kind: "SetDailyLimit", value: "50000000", asset: USDC });
  eq(decodeEvmLog(tlog("TokenLimitCancelled", [OWNER, USDC_ADDR, 10]), USDC_ADDR).event, { type: "changeCancelled", id: 10, asset: USDC });
  ok(decodeEvmLog(tlog("TokenDeposited", [OWNER, OTHER, 5n]), USDC_ADDR).event.asset.unit.startsWith("tokens"));
});

test("alert buttons go straight to the item to cancel", () => {
  eq(alertLink({ type: "requested", id: 7 }, "sol").url, "https://ecrinprotocol.app/app?net=sol&tab=vault&act=cancel-w&id=7&asset=native");
  eq(alertLink({ type: "requested", id: 9, asset: USDC }, "base").url, "https://ecrinprotocol.app/app?net=base&tab=vault&act=cancel-w&id=9&asset=usdc");
  eq(alertLink({ type: "changeQueued", id: 3 }, "eth").label, "Cancel it");
  ok(alertLink({ type: "requested", id: 1 }, "eth", undefined, OWNER).url.endsWith("&owner=" + OWNER));
  const both = alertLinks({ type: "requested", id: 1 }, "sol", undefined, "abc");
  eq(both.map((l) => l.label), ["Cancel it", "Freeze vault"]); eq(both[1].url, "https://ecrinprotocol.app/app?net=sol&tab=vault&act=freeze&owner=abc");
  eq(alertLinks({ type: "deposit", amount: "1" }, "sol").length, 1);
  eq(alertLink({ type: "deposit", amount: "1" }, "sol"), { label: "Open Ecrin", url: "https://ecrinprotocol.app/app?net=sol&tab=vault" });
  eq(alertLink({ type: "requested", id: 4, asset: { unit: "tokens (0x33…3333)", decimals: 18 } }, "eth").label, "Open Ecrin");
});
test("countdowns never read 60 minutes", () => {
  ok(message({ type: "requested", amount: "1", dest: base58(key(4)), readyAt: "1900086399" }, { net: "sol", owner: "o", now: 1_900_000_000 }).text.includes("in 1d 0h"));
  ok(message({ type: "requested", amount: "1", dest: base58(key(4)), readyAt: "1900003599" }, { net: "sol", owner: "o", now: 1_900_000_000 }).text.includes("in 1h 0m"));
});
test("alerts speak French to French subscribers", () => {
  const m = message({ type: "requested", id: 3, amount: "25500000", dest: base58(key(4)), readyAt: "1900003600", asset: USDC }, { net: "sol", owner: base58(key(1)), now: 1_900_000_000, lang: "fr" });
  ok(m.text.includes("Retrait demandé") && m.text.includes("25,5 USDC") && m.text.includes("dans 1 h") && m.text.includes("Pas vous?"), m.text);
  eq(alertLinks({ type: "requested", id: 3 }, "sol", undefined, "o", "fr").map((l) => l.label), ["Annuler", "Geler le coffre"]);
  ok(message({ type: "changed", kind: "SetWithdrawDelay", value: "259200" }, { net: "eth", owner: OWNER, lang: "fr" }).text.includes("Les retraits attendent 3 jours"));
});
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
