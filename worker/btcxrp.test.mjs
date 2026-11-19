// The Bitcoin and XRP relay passes on only what the wallet uses.
import assert from "node:assert/strict";
import { handleRpc2 } from "./rpc2.js";
const seen = [];
globalThis.fetch = async (u, init) => { seen.push([String(u), init?.method || "GET"]); return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }); };
const call = (path, init) => handleRpc2(new Request("https://x/api/rpc/" + path, init), {}, path);
const A = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
// Bitcoin reads
for (const p of [`address/${A}`, `address/${A}/utxo`, `address/${A}/txs`, "v1/fees/recommended", "fee-estimates", "blocks/tip/height", "tx/" + "a".repeat(64)]) {
  seen.length = 0; const r = await call("btcm/" + p); assert.equal(r.status, 200, p); assert.equal(seen[0][0], "https://mempool.space/api/" + p);
}
seen.length = 0; await call(`btc/address/${A}`); assert.equal(seen[0][0], `https://mempool.space/testnet4/api/address/${A}`); // testnet4
for (const p of ["address/../../admin", "mempool/recent", "address/" + A + "/utxo/extra", "v1/mining/pools"]) assert.equal((await call("btcm/" + p)).status, 400, p);
// Bitcoin broadcast: a hex transaction only
seen.length = 0; let r = await call("btcm/tx", { method: "POST", body: "02" + "ab".repeat(100) });
assert.equal(r.status, 200); assert.deepEqual(seen[0], ["https://mempool.space/api/tx", "POST"]);
assert.equal((await call("btcm/tx", { method: "POST", body: "<script>" })).status, 400);
assert.equal((await call("btcm/address/" + A, { method: "POST", body: "00" })).status, 400);
// XRP: only the wallet's calls
const xrp = (net, method) => call(net, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, params: [{}] }) });
for (const m of ["account_info", "server_state", "fee", "ledger_current", "submit", "account_tx", "tx"]) { seen.length = 0; assert.equal((await xrp("xrpm", m)).status, 200, m); assert.equal(seen[0][0], "https://xrplcluster.com"); }
seen.length = 0; await xrp("xrp", "fee"); assert.equal(seen[0][0], "https://s.altnet.rippletest.net:51234");
for (const m of ["wallet_propose", "sign", "ledger_accept", "validation_create"]) assert.equal((await xrp("xrpm", m)).status, 400, m); // never secret-handling or admin calls
console.log("btc xrp relay ok");
