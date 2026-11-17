import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { parseNet, pickCode, sign, handleBuy, keyMode } from "./buy.js";
assert.deepEqual(parseNet("solm"), { base: "sol", main: true }); assert.deepEqual(parseNet("base"), { base: "base", main: false }); assert.equal(parseNet("hype"), null);
// signature matches MoonPay's documented Node recipe
const q = "?apiKey=pk_test_x&currencyCode=sol&walletAddress=abc";
assert.equal(await sign(q, "sk_test_y"), createHmac("sha256", "sk_test_y").update(q).digest("base64"));
// codes: the expected one when listed, a renamed one found by network, fallback when the list is missing
const L = [{ type: "crypto", code: "matic_polygon", metadata: { networkCode: "polygon", contractAddress: null } }, { type: "crypto", code: "usdc_polygon", metadata: { networkCode: "polygon", contractAddress: "0x1" } }];
assert.equal(pickCode(L, "pol", "native"), "matic_polygon"); assert.equal(pickCode(L, "pol", "usdc"), "usdc_polygon"); assert.equal(pickCode(null, "sol", "usdc"), "usdc_sol"); assert.equal(pickCode(null, "tron", "usdc"), null);
// modes: a test key opens the sandbox on Testnet only; nothing without the secret
const env = { MOONPAY_PK: "pk_test_abc", MOONPAY_SECRET_KEY: "sk_test_s" }; assert.equal(keyMode(env), "test");
globalThis.fetch = async () => { throw new Error("offline"); };
const get = (path, e = env) => handleBuy(new Request("https://ecrinprotocol.app" + path), e).then(async (r) => [r.status, await r.json()]);
assert.deepEqual((await get("/api/buy/status"))[1], { on: true, test: true });
assert.deepEqual((await get("/api/buy/status", { MOONPAY_PK: "pk_test_abc" }))[1], { on: false, test: true });
const [s1, b1] = await get("/api/buy?net=sol&addr=9FV9MRrSvGHxyuvAeLKZ7MYs3XCL5mppCjzf4tXzrdx");
assert.equal(s1, 200); assert.ok(b1.url.startsWith("https://buy-sandbox.moonpay.com/?apiKey=pk_test_abc&currencyCode=sol&walletAddress=9FV9")); assert.match(b1.url, /&signature=[^&]+$/);
const u = new URL(b1.url), sig = u.searchParams.get("signature"); u.searchParams.delete("signature"); assert.equal(sig, createHmac("sha256", "sk_test_s").update(u.search).digest("base64"));
assert.equal((await get("/api/buy?net=solm&addr=9FV9MRrSvGHxyuvAeLKZ7MYs3XCL5mppCjzf4tXzrdx"))[0], 503); // mainnet needs a live key
assert.equal((await get("/api/buy?net=eth&addr=9FV9MRrSvGHxyuvAeLKZ7MYs3XCL5mppCjzf4tXzrdx"))[0], 400); // wrong address kind
assert.equal((await get("/api/buy?net=ethm&addr=0x" + "a".repeat(40), { MOONPAY_PK: "pk_live_x", MOONPAY_SECRET_KEY: "s" }))[1].url.slice(0, 26), "https://buy.moonpay.com/?a");
console.log("buy ok");
