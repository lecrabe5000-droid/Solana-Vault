// Checks the Ethereum simulation reading: a fake node answers eth_simulateV1 the way a real one does.
import { ethers } from "ethers";
import * as web3 from "@solana/web3.js";
import { makeApprovals } from "../src/approve.js";
import assert from "node:assert";

const me = ethers.Wallet.createRandom(), drainer = "0x000000000000000000000000000000000000dEaD", USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const T = ethers.id("Transfer(address,address,uint256)"), pad = (a) => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
let status = "0x1";
const orig = ethers.JsonRpcProvider.prototype.send;
ethers.JsonRpcProvider.prototype.send = async function (method, params) {
  if (method === "eth_chainId") return "0xaa36a7";
  if (method === "eth_simulateV1") return [{ calls: [{ status, logs: [
    { address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", topics: [T, pad(me.address), pad(drainer)], data: "0x" + (5n * 10n ** 17n).toString(16).padStart(64, "0") },
    { address: USDC, topics: [T, pad(me.address), pad(drainer)], data: "0x" + (250n * 10n ** 6n).toString(16).padStart(64, "0") },
  ] }] }];
  if (method === "eth_call") { const sel = params[0].data.slice(0, 10); return sel === "0x95d89b41" ? ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["USDC"]) : sel === "0x313ce567" ? ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [6]) : "0x"; }
  if (method === "eth_estimateGas") return "0x5208";
  if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
  if (method === "eth_getBlockByNumber") return { baseFeePerGas: "0x3b9aca00", number: "0x1" };
  return orig.call(this, method, params);
};
const APX = makeApprovals({ web3, ethers, getAcct: () => ({ evm: me }), getDev: async () => ({}) });
const req = { fam: "evm", kind: "tx", chainId: 11155111, tx: { from: me.address, to: "0x1111111111111111111111111111111111111111", data: "0x12345678" }, site: { host: "x" } };
const pv = await APX.preview(req);
assert.equal(pv.simulated, true);
assert.deepEqual(pv.leaves.map((l) => `${l.amt} ${l.unit}`), ["0.5 ETH", "250 USDC"]);
status = "0x0";
const pv2 = await APX.preview(req);
assert.match(pv2.fail, /fails/);
console.log("simulation ok:", pv.leaves.map((l) => `${l.amt} ${l.unit}`).join(", "));
