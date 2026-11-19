// Bitcoin and XRP: addresses from the phrase match the published standards, coin choice and fees, XRP signing.
import assert from "node:assert/strict";
import * as web3 from "@solana/web3.js";
import { ethers } from "ethers";
import { secp256k1 } from "@noble/curves/secp256k1";
import { decode } from "ripple-binary-codec";
import { classicAddressToXAddress } from "ripple-address-codec";
import { deriveAccount } from "../src/keyring.js";
import { btcAddress, btcIsAddress, plan, vbytes, BTC, BTC_MAIN, DUST } from "../src/btc.js";
import * as btcLib from "@scure/btc-signer";
import { xrpAddress, xrpAddressOf, xrpParse, xrpSign } from "../src/xrp.js";

const PHRASE = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const A = deriveAccount(PHRASE, { web3, ethers });

// BIP-84's own test vector (github.com/bitcoin/bips, bip-0084): first receiving address of this phrase.
assert.equal(btcAddress(A, BTC_MAIN), "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
assert.match(btcAddress(A, BTC), /^tb1q[0-9a-z]{38}$/); // testnet: its own key and the tb1 prefix
assert.notEqual(btcAddress(A, BTC).slice(4), btcAddress(A, BTC_MAIN).slice(4));
assert.ok(btcIsAddress("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", BTC_MAIN));
assert.ok(!btcIsAddress("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", BTC)); // a mainnet address on testnet
assert.ok(!btcIsAddress("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv", BTC_MAIN)); // checksum
assert.ok(btcIsAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", BTC_MAIN)); // older formats still receive
assert.ok(btcIsAddress("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", BTC_MAIN));
assert.ok(!btcIsAddress("0x8ba1f109551bD432803012645Ac136ddd64DBA72", BTC_MAIN));

// Coin choice: largest first, change back to you, dust change goes to the fee, a clear error when short.
const U = [{ txid: "a".repeat(64), vout: 0, value: 50_000 }, { txid: "b".repeat(64), vout: 1, value: 200_000 }];
let p = plan(U, 100_000n, 10);
assert.equal(p.use.length, 1); assert.equal(p.use[0].value, 200_000); assert.equal(p.fee, BigInt(vbytes(1, 2) * 10)); assert.equal(p.change, 200_000n - 100_000n - p.fee);
p = plan(U, 200_000n, 10); assert.equal(p.use.length, 2); // needs both
p = plan(U, 249_000n, 3); assert.equal(p.change, 0n); assert.equal(p.fee, 1_000n); // 1,000 left, 627 of fee: 373 of change is dust, so it goes to the fee
p = plan(U, 249_000n, 2); assert.equal(p.change, 582n); // at 2 sat/vB, 582 sats is enough to come back as change
assert.throws(() => plan(U, 250_000n, 10), /Not enough BTC/);
assert.ok(DUST >= 294n);

// XRP: the XRP Ledger's genesis account (xrpl.org): this public key is rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh.
assert.equal(xrpAddressOf(ethers.getBytes("0x0330E7FC9D56BB25D6893BA3F317AE5BCF33B3291BD63DB32654A313222F7FD020")), "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh");
const me = xrpAddress(A); assert.match(me, /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);
assert.deepEqual(xrpParse(me), { to: me, tag: null });
const X = classicAddressToXAddress("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", 12345, false);
assert.deepEqual(xrpParse(X), { to: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", tag: 12345 }); // an X-address brings its tag
assert.equal(xrpParse("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTx"), null); // checksum
assert.equal(xrpParse("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"), null);
// A signed payment: the bytes decode back to the same payment, and the signature checks out against our key.
const tx = { TransactionType: "Payment", Account: me, Destination: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", Amount: "1500000", Fee: "12", Flags: 0, Sequence: 7, LastLedgerSequence: 1000, SigningPubKey: Buffer.from(A.xrp.pub).toString("hex").toUpperCase(), DestinationTag: 42 };
const { blob, hash } = xrpSign(tx, A.xrp.priv), back = decode(blob);
for (const k of Object.keys(tx)) assert.equal(String(back[k]), String(tx[k]), k);
assert.ok(secp256k1.verify(secp256k1.Signature.fromDER(back.TxnSignature), hash, A.xrp.pub, { lowS: true }));
// A whole Bitcoin transaction, built and signed the way the wallet does: inputs from our address, both outputs right.
{
  const NET = btcLib.NETWORK, me = btcLib.p2wpkh(A.btc.pub, NET), q = plan(U, 100_000n, 10);
  const t = new btcLib.Transaction();
  for (const u of q.use) t.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: me.script, amount: BigInt(u.value) } });
  t.addOutputAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", 100_000n, NET); t.addOutputAddress(me.address, q.change, NET);
  t.sign(A.btc.priv); t.finalize();
  assert.equal(t.outputsLength, 2); assert.equal(t.getOutput(0).amount, 100_000n); assert.equal(t.getOutput(1).amount, q.change);
  assert.equal(t.fee, q.fee); // what goes to the miners is exactly the planned fee
  assert.ok(t.extract().length > 100);
}
console.log("btc xrp ok");
