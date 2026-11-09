import assert from "node:assert/strict";
import { pickTokens } from "./tokens.js";
const pairs = [
  { chainId: "base", baseToken: { address: "0xAAA", name: "Pepe", symbol: "PEPE" }, priceUsd: "0.00001", liquidity: { usd: 5000 } },
  { chainId: "base", baseToken: { address: "0xaaa", name: "Pepe", symbol: "PEPE" }, priceUsd: "0.00002", liquidity: { usd: 90000 }, info: { imageUrl: "https://x/i.png" } },
  { chainId: "base", baseToken: { address: "0xBBB", name: "Pepe", symbol: "PEPE" }, priceUsd: "0.3", liquidity: { usd: 120 } },
  { chainId: "ethereum", baseToken: { address: "0xCCC", name: "Pepe", symbol: "PEPE" }, priceUsd: "1", liquidity: { usd: 1e9 } },
  { chainId: "base", baseToken: { address: "0xDDD", name: "x", symbol: "X" }, info: { imageUrl: "javascript:alert(1)" } },
];
const r = pickTokens(pairs, "base");
assert.equal(r.length, 3); assert.equal(r[0].address, "0xaaa"); assert.equal(r[0].price, 0.00002); assert.equal(r[0].icon, "https://x/i.png");
assert.equal(r[1].address, "0xBBB"); assert.equal(r[2].icon, null); assert.equal(r[2].price, null);
assert.deepEqual(pickTokens(null, "base"), []);
console.log("tokens ok");
