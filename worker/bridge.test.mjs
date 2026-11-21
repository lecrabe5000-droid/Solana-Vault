import assert from "node:assert/strict";
import { bridgeTokens, bridgeFee, bridgeOn, handleBridge } from "./bridge.js";
assert.deepEqual(bridgeTokens("solm", "basem", "usdc"), ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"]);
assert.deepEqual(bridgeTokens("solm", "basem", "native"), ["11111111111111111111111111111111", "0x0000000000000000000000000000000000000000"]); // SOL → ETH on Base
assert.deepEqual(bridgeTokens("bnbm", "basem", "native", "usdc"), ["0x0000000000000000000000000000000000000000", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"]); // BNB → USDC
assert.deepEqual(bridgeTokens("tronm", "solm", "usdt", "native"), ["TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "11111111111111111111111111111111"]);
assert.equal(bridgeTokens("bnbm", "basem", "usdc", "usdc"), null); // no USDC on BNB Chain in Ecrin
assert.equal(bridgeTokens("tronm", "basem", "usdc", "usdc"), null); // Tron has USDT, not USDC
assert.equal(bridgeTokens("basem", "basem", "native", "native"), null); // same coin twice
assert.deepEqual(bridgeTokens("basem", "basem", "native", "usdc"), ["0x0000000000000000000000000000000000000000", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"]); // a swap on one network
assert.equal(bridgeTokens("basem", "arbm", "nope", "usdc"), null);
assert.deepEqual(bridgeTokens("basem", "arbm", "native"), ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000"]);
assert.equal(bridgeTokens("basem", "basem", "usdc"), null);
assert.deepEqual(bridgeTokens("polm", "basem", "native"), ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000"]); // POL → ETH
assert.equal(bridgeFee({}), 0.00875); assert.equal(bridgeFee({ LIFI_FEE: "0.5" }), 0.00875); assert.equal(bridgeFee({ LIFI_FEE: "0.01" }), 0.01);
assert.equal(bridgeOn({}), false); assert.equal(bridgeOn({ LIFI_INTEGRATOR: "ecrin" }), true); assert.equal(bridgeOn({ LIFI_INTEGRATOR: "bad name!" }), false);
const st = await (await handleBridge(new Request("https://x/api/bridge/status"), {})).json();
assert.equal(st.on, false); assert.equal(st.fee, 0.00875);
const r = await handleBridge(new Request("https://x/api/bridge/quote?from=solm&to=basem&coin=usdc&amount=1000000"), {});
assert.equal(r.status, 503);
// Tron: only the call inside LI.FI's transaction is passed on, and only if it comes from the user's own address.
const ME = "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7", BR = "TU3ymitEKCWQFtASkEeHaPb8NfZcJtCHLt", env = { LIFI_INTEGRATOR: "ecrin" };
const tronQuote = (owner) => ({ tool: "layerswap", estimate: { toAmount: "19000000", toAmountMin: "18900000", approvalAddress: BR },
  transactionRequest: { customData: { tronTransaction: { raw_data: { fee_limit: 150000000, contract: [{ type: "TriggerSmartContract", parameter: { value: { owner_address: owner, contract_address: BR, data: "4c279d6b00" } } }] } } } } });
const tq = (owner) => { globalThis.fetch = async () => new Response(JSON.stringify(tronQuote(owner)), { status: 200 });
  return handleBridge(new Request(`https://x/api/bridge/quote?from=tronm&to=basem&fromCoin=usdt&toCoin=usdc&amount=20000000&fromAddress=${ME}&toAddress=0x8ba1f109551bD432803012645Ac136ddd64DBA72`), env); };
let tr = await tq(ME), tj = await tr.json();
assert.equal(tr.status, 200); assert.deepEqual(tj.tx, { tron: { contract: BR, data: "4c279d6b00", callValue: "0", feeLimit: 150000000 } }); assert.equal(tj.approval, BR);
tr = await tq("TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"); assert.equal(tr.status, 502); // a call from another address is refused
assert.deepEqual(bridgeTokens("btcm", "basem", "native", "usdc"), ["bitcoin", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"]); // BTC → USDC on Base
assert.deepEqual(bridgeTokens("solm", "btcm", "usdc", "native"), ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "bitcoin"]); // USDC → BTC
assert.equal(bridgeTokens("btcm", "basem", "usdc", "usdc"), null); // no USDC on Bitcoin
console.log("bridge ok");
// Any token by address: LINK on Arbitrum, a Solana token; addresses must match the network's format.
const LINK_ARB = "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
assert.deepEqual(bridgeTokens("basem", "arbm", "usdc", LINK_ARB), ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", LINK_ARB]);
assert.deepEqual(bridgeTokens("solm", "solm", BONK, "usdc"), [BONK, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]);
assert.equal(bridgeTokens("arbm", "solm", "usdc", LINK_ARB), null); // an EVM address on Solana
assert.equal(bridgeTokens("solm", "arbm", "native", BONK), null); // a Solana address on Arbitrum
assert.equal(bridgeTokens("tronm", "basem", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "usdc"), null); // Tron tokens: USDT only
assert.equal(bridgeTokens("arbm", "arbm", LINK_ARB, LINK_ARB.toLowerCase()), null); // same token twice
assert.equal(bridgeTokens("arbm", "basem", "0x123", "usdc"), null);
// Prices: only known networks and well-formed token addresses are looked up.
globalThis.fetch = async (u) => new Response(JSON.stringify(String(u).includes(LINK_ARB) ? { priceUSD: "8.61" } : {}), { status: 200 });
const pr = await (await handleBridge(new Request(`https://x/api/bridge/price?ids=arbm:${LINK_ARB},arbm:0xbad,zzz:${LINK_ARB}`), {})).json();
assert.deepEqual(pr.prices, { [`arbm:${LINK_ARB}`]: 8.61 });
console.log("bridge tokens ok");
