// The Safe on Sui Testnet, for real, through the wallet's own code (src/sui.js): open a Safe, protect SUI, ask
// for a withdrawal, cancel it, tighten a rule (applies now), loosen one (waits), and the errors people would see.
// Testnet only. Needs SUI_TEST_KEY (a suiprivkey… for a TESTNET wallet holding ~0.2 SUI); without it, only the
// read-only checks run. Run again any time: an existing Safe is reused.
import assert from "node:assert/strict";
import { bech32 } from "@scure/base";
import { ed25519 } from "@noble/curves/ed25519";
import { suiEngine, suiAddress, SUI } from "../src/sui.js";

assert.ok(SUI.safe?.package && SUI.safe?.registry, "The Sui Safe isn't published (app/deployments-sui.js)");
const API = "https://graphql.testnet.sui.io/graphql", dev = { suiApi: API };
const say = (...a) => console.log("  ", ...a);

// Read-only, with a fresh key: no Safe yet, and the wallet says so instead of failing.
{
  const e = suiEngine({ acct: { sui: ed25519.utils.randomPrivateKey() }, dev, N: SUI });
  assert.equal(e.hasVaults, true);
  assert.equal(await e.vault(), null);
  await assert.rejects(e.protect("native", 1000), /Open your Safe on Sui first/);
  say("fresh wallet: no Safe, and a clear message ✓");
}

const key = process.env.SUI_TEST_KEY;
if (!key) { console.log("sui-safe live: read-only checks passed (set SUI_TEST_KEY for the full run)"); process.exit(0); }
const { prefix, bytes } = bech32.decodeToBytes(key.trim());
assert.equal(prefix, "suiprivkey"); assert.equal(bytes[0], 0, "only ed25519 keys");
const priv = bytes.slice(1, 33), me = suiAddress(ed25519.getPublicKey(priv));
const e = suiEngine({ acct: { sui: priv }, dev, N: SUI });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle(check, what) { for (let i = 0; i < 20; i++) { const v = await e.vault(); if (v && check(v)) return v; await wait(1500); } throw new Error("never saw: " + what); }
say("wallet", me.slice(0, 10) + "…", "SUI", (await e.balances()).native / 1e9);

let v = await e.vault();
if (!v) { say("open a Safe (gentle):", await e.createVault("gentle")); v = await settle((x) => x.withdrawDelay > 0, "the new Safe"); }
assert.equal(v.main.owner.toBase58(), me);
say(`Safe ${v.main.address.toBase58().slice(0, 10)}… · withdrawals wait ${v.main.withdrawDelay / 3600} h · rules wait ${v.main.ruleDelay / 86400} days`);

await assert.rejects(e.createVault("gentle"), /already has a Safe/); say("a second Safe is refused, in plain words ✓");

const b0 = v.main.balance;
say("protect 0.02 SUI:", await e.protect("native", 20_000_000));
v = await settle((x) => x.main.balance === b0 + 20_000_000, "the deposit");
say("Safe holds", v.main.balance / 1e9, "SUI ✓");

const t0 = await e.chainTime(), dest = "0x" + "e7".repeat(32);
say("ask to withdraw 0.01 SUI:", await e.request("native", dest, 10_000_000));
v = await settle((x) => x.main.withdrawals.length > 0, "the withdrawal");
const w = v.main.withdrawals.at(-1);
assert.equal(w.amount, 10_000_000); assert.equal(w.dest.toBase58(), dest);
assert.ok(w.readyAt >= t0 + v.main.withdrawDelay - 5, "it can't leave before the delay");
assert.equal(v.main.available, v.main.balance - v.main.withdrawals.reduce((s, x) => s + x.amount, 0));
say(`withdrawal #${w.id} waits until ${new Date(w.readyAt * 1000).toISOString()} ✓`);

await assert.rejects(e.execute("native", w.id), /isn't time yet/); say("running it early is refused ✓");
await assert.rejects(e.request("native", dest, v.main.available + 1), /Not enough in the Safe/); say("asking for more than is free is refused ✓");

say("cancel it:", await e.cancel("native", w.id));
v = await settle((x) => !x.main.withdrawals.some((y) => y.id === w.id), "the cancel");
say("cancelled, the money stays ✓");

const lim = v.main.dailyLimit == null ? 1_000_000_000 : Math.max(1, v.main.dailyLimit - 1);
say("tighten: daily limit", lim / 1e9, "SUI:", await e.propose({ kind: "SetDailyLimit", value: lim }));
v = await settle((x) => x.main.dailyLimit === lim, "the stricter rule");
say("applied at once ✓");

const before = v.main.changes.length;
say("loosen: withdrawals wait 1 h:", await e.propose({ kind: "SetWithdrawDelay", value: 3600 }));
v = await settle((x) => x.main.changes.length === before + 1, "the queued rule");
const c = v.main.changes.at(-1);
assert.equal(c.change.kind, "SetWithdrawDelay"); assert.equal(c.change.value, 3600);
assert.notEqual(v.main.withdrawDelay, 3600, "a looser rule must not apply at once");
say(`queued until ${new Date(c.readyAt * 1000).toISOString()}, not applied ✓`);
say("cancel the change:", await e.cancelChange(c.id));
await settle((x) => !x.main.changes.some((y) => y.id === c.id), "the cancelled change");
console.log("sui-safe live: every step passed on Sui Testnet");
