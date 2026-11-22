import assert from "node:assert/strict";
import { cleanPrices, fromCoinbase, fromKraken } from "./prices.js";
const c = cleanPrices({ solana: { usd: 170.5, usd_24h_change: -2.1, usd_market_cap: 8e10 }, ethereum: { usd: "x" }, bogus: { usd: 1 }, tron: { usd: 0.24 } });
assert.deepEqual(Object.keys(c).sort(), ["solana", "tron"]); assert.equal(c.solana.usd_24h_change, -2.1); assert.equal(c.tron.usd_24h_change, null);
const b = fromCoinbase({ solana: { open: "100", last: "105", volume: "10" }, ethereum: { last: "0" } });
assert.equal(Object.keys(b).length, 1); assert.ok(Math.abs(b.solana.usd_24h_change - 5) < 1e-9); assert.equal(b.solana.usd_24h_vol, 1050);
// Kraken: its own pair names (XXRPZUSD, XXBTZUSD), last trade and today's opening price
const kr = fromKraken({ XXRPZUSD: { c: ["2.10", "1"], o: "2.00", v: ["1", "1000"] }, XXBTZUSD: { c: ["60000", "1"], o: "60600", v: ["1", "10"] }, TRXUSD: { c: ["0", "1"], o: "0.2" } }, [["ripple", "XRP"], ["bitcoin", "BTC"], ["tron", "TRX"]]);
assert.equal(kr.ripple.usd, 2.1); assert.ok(Math.abs(kr.ripple.usd_24h_change - 5) < 1e-9); assert.equal(kr.bitcoin.usd, 60000); assert.ok(!kr.tron, "a zero price is left out");
console.log("prices ok");
