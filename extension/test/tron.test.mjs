// Checks Ecrin's Tron code against TronWeb (run with TRONWEB=<path to an installed tronweb>).
import { createRequire } from "node:module";
import assert from "node:assert";
import { ethers } from "ethers";
import { toTron, fromTron, rawTx, transferValue, triggerValue, trc20Data, signRaw } from "../src/tron.js";
const { TronWeb } = createRequire(import.meta.url)(process.env.TRONWEB);
const tw = new TronWeb({ fullHost: "http://127.0.0.1:1" });
const phrase = "test test test test test test test test test test test junk";
const w = ethers.HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/195'/0'/0/0");
const me = toTron(w.address);
assert.equal(me, TronWeb.address.fromPrivateKey(w.privateKey.slice(2)), "address");
assert.ok(fromTron(me)); assert.equal(fromTron(me.slice(0, -1) + (me.endsWith("a") ? "b" : "a")), null, "checksum");
const to = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const block = { number: 61234567, id: "0000000003a65c87" + "ab".repeat(24) };
const now = 1730000000000;
const cases = [
  ["TransferContract", rawTx({ block, contractType: 1, typeName: "TransferContract", value: transferValue(fromTron(me), fromTron(to), 1_500_000), now }),
    { contract: [{ type: "TransferContract", parameter: { type_url: "type.googleapis.com/protocol.TransferContract", value: { owner_address: TronWeb.address.toHex(me), to_address: TronWeb.address.toHex(to), amount: 1_500_000 } } }] }],
  ["TriggerSmartContract", rawTx({ block, contractType: 31, typeName: "TriggerSmartContract", value: triggerValue(fromTron(me), fromTron(to), trc20Data(fromTron(me), 2_000_000n)), feeLimit: 30_000_000, now }),
    { contract: [{ type: "TriggerSmartContract", parameter: { type_url: "type.googleapis.com/protocol.TriggerSmartContract", value: { owner_address: TronWeb.address.toHex(me), contract_address: TronWeb.address.toHex(to), data: Buffer.from(trc20Data(fromTron(me), 2_000_000n)).toString("hex") } } }], fee_limit: 30_000_000 }],
];
for (const [name, mine, extra] of cases) {
  const num = BigInt(block.number).toString(16).padStart(16, "0");
  const json = { raw_data: { ref_block_bytes: num.slice(12, 16), ref_block_hash: block.id.slice(16, 32), expiration: now + 60_000, timestamp: now, ...extra } };
  const theirs = tw.utils.transaction.txJsonToPb(json).getRawData().serializeBinary();
  assert.equal(Buffer.from(mine).toString("hex"), Buffer.from(theirs).toString("hex"), name + " bytes");
  const id = tw.utils.transaction.txPbToTxID(tw.utils.transaction.txJsonToPb(json)).replace(/^0x/, "");
  const signed = signRaw(mine, w.signingKey); assert.equal(signed.id, id, name + " id");
  const tsig = tw.utils.crypto.ECKeySign(Buffer.from(id, "hex"), Buffer.from(w.privateKey.slice(2), "hex"));
  const mine65 = Buffer.from(signed.bytes).toString("hex").slice(-130);
  assert.equal(mine65, tsig.replace(/^0x/, "").toLowerCase(), name + " signature");
  console.log(`${name}: bytes, id and signature match TronWeb`);
}
console.log("address", me);
