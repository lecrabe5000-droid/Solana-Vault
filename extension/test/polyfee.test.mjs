// Polygon fees come from the Polygon node itself, never from ethers' "gas station" website (blocked by the wallet's
// security rules, so every Polygon send and swap failed with "error encountered with polygon gas station").
import assert from "node:assert/strict";
import * as ethers from "ethers";
import { evmProvider } from "../src/chains.js";

const seen = [];
ethers.FetchRequest.registerGetUrl(async (req) => {
  seen.push(req.url);
  if (/gasstation/.test(req.url)) throw new Error("gas station must not be called");
  const body = JSON.parse(new TextDecoder().decode(req.body));
  const one = ({ method, id }) => ({ jsonrpc: "2.0", id, result: ({ eth_chainId: "0x89", eth_gasPrice: "0x" + (200n * 10n ** 9n).toString(16), eth_maxPriorityFeePerGas: "0x" + (30n * 10n ** 9n).toString(16),
    eth_getBlockByNumber: { number: "0x1", hash: "0x" + "11".repeat(32), parentHash: "0x" + "22".repeat(32), timestamp: "0x1", nonce: "0x0000000000000000", difficulty: "0x0", gasLimit: "0x1", gasUsed: "0x0", miner: "0x" + "00".repeat(20), extraData: "0x", baseFeePerGas: "0x" + (100n * 10n ** 9n).toString(16), transactions: [] } })[method] });
  const out = Array.isArray(body) ? body.map(one) : one(body);
  return { statusCode: 200, statusMessage: "OK", headers: { "content-type": "application/json" }, body: new TextEncoder().encode(JSON.stringify(out)) };
});

const p = evmProvider(ethers, { key: "polm", chainId: 137, rpc: "https://polygon.example" }, "https://polygon.example");
const f = await p.getFeeData();
assert.equal(f.maxPriorityFeePerGas, 30n * 10n ** 9n, "tip comes from the node (30 gwei), not a 1 gwei default");
assert.equal(f.maxFeePerGas, 230n * 10n ** 9n, "max fee = 2 × base fee + tip");
assert.ok(!seen.some((u) => /gasstation/.test(u)), "no gas station request");
console.log("OK polygon fees come from the node:", ethers.formatUnits(f.maxPriorityFeePerGas, "gwei"), "gwei tip");
