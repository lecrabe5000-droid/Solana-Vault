import assert from "node:assert/strict";
import { cleanPrices, fromCoinbase } from "./prices.js";
const c = cleanPrices({ solana: { usd: 170.5, usd_24h_change: -2.1, usd_market_cap: 8e10 }, ethereum: { usd: "x" }, bogus: { usd: 1 }, tron: { usd: 0.24 } });
assert.deepEqual(Object.keys(c).sort(), ["solana", "tron"]); assert.equal(c.solana.usd_24h_change, -2.1); assert.equal(c.tron.usd_24h_change, null);
const b = fromCoinbase({ solana: { open: "100", last: "105", volume: "10" }, ethereum: { last: "0" } });
assert.equal(Object.keys(b).length, 1); assert.ok(Math.abs(b.solana.usd_24h_change - 5) < 1e-9); assert.equal(b.solana.usd_24h_vol, 1050);
console.log("prices ok");
