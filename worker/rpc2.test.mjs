// The private-server routes: status lists only configured networks, only wallet calls pass, and each network goes to
// its own upstream (the private one when set, the public one otherwise).
import assert from "node:assert/strict";
import { handleRpc2, privateNets } from "./rpc2.js";

const seen = [];
globalThis.fetch = async (url, init) => { seen.push({ url, headers: init.headers, body: init.body }); return new Response('{"ok":1}', { status: 200 }); };
const post = (path, body, env = {}) => handleRpc2(new Request("https://x/api/rpc/" + path, { method: "POST", body: JSON.stringify(body) }), env, path);
const env = { RPC_ETHM: "https://private.example/eth-key", TRON_API_KEY: "k", SUI_MAINNET_GRAPHQL: "not a url" };

assert.deepEqual(privateNets(env), ["ethm", "tronm"]);
assert.deepEqual(privateNets({}), []);
const st = await (await handleRpc2(new Request("https://x/api/rpc/status"), env, "status")).json();
assert.deepEqual(st, { private: ["ethm", "tronm"] });
assert.ok(!JSON.stringify(st).includes("private.example"), "status never shows a server address");

assert.equal((await post("ethm", { id: 1, method: "eth_getBalance", params: [] }, env)).status, 200);
assert.equal(seen.at(-1).url, "https://private.example/eth-key");
await post("basem", { id: 1, method: "eth_chainId" }, env);
assert.equal(seen.at(-1).url, "https://base-rpc.publicnode.com"); // no private server: the public one
assert.equal((await post("ethm", { id: 1, method: "debug_traceCall" }, env)).status, 400);
assert.equal((await post("ethm", [{ method: "eth_chainId" }, { method: "admin_peers" }], env)).status, 400);
assert.equal((await post("eth", { id: 1, method: "eth_chainId" }, env)).status, 404); // test networks aren't served here

await post("tronm/wallet/getaccount", { address: "T" }, env);
assert.equal(seen.at(-1).url, "https://api.trongrid.io/wallet/getaccount"); assert.equal(seen.at(-1).headers["TRON-PRO-API-KEY"], "k");
assert.equal((await post("tronm/wallet/createtransaction", {}, env)).status, 400);
assert.equal((await post("tronm/walletsolidity/getaccount", {}, env)).status, 400);

await post("suim", { query: "{ chainIdentifier }" }, env);
assert.equal(seen.at(-1).url, "https://graphql.mainnet.sui.io/graphql");
assert.equal((await post("suim", { nope: 1 }, env)).status, 400);
assert.equal((await handleRpc2(new Request("https://x/api/rpc/ethm"), env, "ethm")).status, 405);
console.log("rpc2 ok");
