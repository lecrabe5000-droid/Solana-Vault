// Bridges from Sui and Tron: what Ecrin agrees to sign.
import assert from "node:assert/strict";
import { suiBridgeCheck, normType } from "../src/sui.js";
import { callValue, approveData, fromTron } from "../src/tron.js";

// Sui: the balance changes a real LI.FI quote produced on a copy of the chain (20 USDC → Base).
const ME = "0x7ae2efc9b3b23635566967ba35ef6ffe3a8182eb98e01a12f916bc3a34e59b54";
const USDC = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
const SUI = "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";
const real = [
  { owner: { address: ME }, amount: "-1422965", coinType: { repr: SUI } },
  { owner: { address: ME }, amount: "-20000000", coinType: { repr: USDC } },
  { owner: { address: "0x90efcc7705e4b7753d79ae6c7430b9cb91c40ff281bc259c82f537f60be268a6" }, amount: "50000", coinType: { repr: USDC } },
];
assert.equal(suiBridgeCheck(real, ME, USDC, "20000000"), ""); // exactly what was chosen, plus a small fee
assert.match(suiBridgeCheck(real, ME, USDC, "10000000"), /more than you chose/); // takes 20 when 10 was chosen
const extra = [...real, { owner: { address: ME }, amount: "-5", coinType: { repr: "0xabc::wal::WAL" } }];
assert.match(suiBridgeCheck(extra, ME, USDC, "20000000"), /another coin/); // a third coin leaving
const bigGas = [{ owner: { address: ME }, amount: "-900000000", coinType: { repr: SUI } }, real[1]];
assert.match(suiBridgeCheck(bigGas, ME, USDC, "20000000"), /more than you chose/); // 0.9 SUI "fee"
// sending SUI itself: the amount plus up to 0.5 SUI of fees
assert.equal(suiBridgeCheck([{ owner: { address: ME }, amount: "-1001400000", coinType: { repr: SUI } }], ME, "0x2::sui::SUI", "1000000000"), "");
assert.equal(normType("0x2::sui::SUI"), SUI);
// someone else's changes don't count against you
assert.equal(suiBridgeCheck([{ owner: { address: "0x" + "1".repeat(64) }, amount: "-999999999999", coinType: { repr: USDC } }, ...real], ME, USDC, "20000000"), "");

// Tron: the contract call Ecrin builds itself (protobuf TriggerSmartContract: owner 1, contract 2, call_value 3, data 4).
const hex = (u8) => Buffer.from(u8).toString("hex");
const me21 = fromTron("TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7"), br21 = fromTron("TU3ymitEKCWQFtASkEeHaPb8NfZcJtCHLt");
const v0 = hex(callValue(me21, br21, Uint8Array.of(0xab, 0xcd), 0n));
assert.equal(v0, "0a15" + hex(me21) + "1215" + hex(br21) + "2202abcd"); // no call_value field when no TRX is sent
const v1 = hex(callValue(me21, br21, Uint8Array.of(0xab), 100_000_000n));
assert.equal(v1, "0a15" + hex(me21) + "1215" + hex(br21) + "1880c2d72f" + "2201ab"); // 100 TRX as a varint
const ap = hex(approveData(br21, 20_000_000n));
assert.equal(ap.slice(0, 8), "095ea7b3"); assert.equal(ap.slice(32, 72), hex(br21.slice(1))); assert.equal(BigInt("0x" + ap.slice(72)), 20_000_000n);
console.log("bridge signing ok");
