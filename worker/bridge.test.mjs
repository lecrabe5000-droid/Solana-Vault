import assert from "node:assert/strict";
import { bridgeTokens, bridgeFee, bridgeOn, handleBridge } from "./bridge.js";
assert.deepEqual(bridgeTokens("solm", "basem", "usdc"), ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"]);
assert.equal(bridgeTokens("solm", "basem", "native"), null); // SOL doesn't become ETH
assert.deepEqual(bridgeTokens("basem", "arbm", "native"), ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000"]);
assert.equal(bridgeTokens("basem", "basem", "usdc"), null);
assert.equal(bridgeTokens("polm", "basem", "native"), null);
assert.equal(bridgeFee({}), 0.00875); assert.equal(bridgeFee({ LIFI_FEE: "0.5" }), 0.00875); assert.equal(bridgeFee({ LIFI_FEE: "0.01" }), 0.01);
assert.equal(bridgeOn({}), false); assert.equal(bridgeOn({ LIFI_INTEGRATOR: "ecrin" }), true); assert.equal(bridgeOn({ LIFI_INTEGRATOR: "bad name!" }), false);
const st = await (await handleBridge(new Request("https://x/api/bridge/status"), {})).json();
assert.equal(st.on, false); assert.equal(st.fee, 0.00875);
const r = await handleBridge(new Request("https://x/api/bridge/quote?from=solm&to=basem&coin=usdc&amount=1000000"), {});
assert.equal(r.status, 503);
console.log("bridge ok");
