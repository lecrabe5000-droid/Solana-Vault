// Sui: the same phrase gives the same address as Sui's own SDK, transfers lay out the bytes Sui expects (checked
// against real testnet transactions and simulations), and signatures verify for the account's own key.
import assert from "node:assert/strict";
import { mnemonicToSeedSync } from "@scure/bip39";
import { ed25519 } from "@noble/curves/ed25519";
import { blake2b } from "@noble/hashes/blake2b";
import { slip10 } from "../src/keyring.js";
import { suiAddress, normAddr, transfer, signTx, txDigest, typeTag, SUI_COIN, SUI } from "../src/sui.js";

// Sui TypeScript SDK test vector (ed25519 keypair from mnemonic, m/44'/784'/0'/0'/0')
const m = "film crazy soon outside stand loop subway crumble thrive popular green nuclear struggle pistol arm wife phrase warfare march wheat nephew ask sunny firm";
const priv = slip10(mnemonicToSeedSync(m), "m/44'/784'/0'/0'/0'"), me = suiAddress(ed25519.getPublicKey(priv));
assert.equal(me, "0xa2d14fad60c56049ecf75246a481934691214ce413e6a8ae2fe6834c173a6133");

assert.equal(normAddr("0x2"), "0x" + "0".repeat(63) + "2");
assert.equal(normAddr("0xZZ"), null); assert.equal(normAddr("T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"), null);
assert.equal(SUI.usdc, "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC");

const hex = (u8) => Buffer.from(u8).toString("hex"), to = "0x" + "ab".repeat(32), coin = { address: "0x" + "11".repeat(32), version: 7, digest: "11111111111111111111111111111111" };
// SUI paid with coins: split from the gas coin, transfer; no expiry
const t1 = transfer({ sender: me, to, type: SUI_COIN, amount: 1_250_000_000n, useGas: true, gas: { payment: [coin], price: 1000n, budget: 4_000_000n } });
assert.equal(t1[0], 0); assert.equal(t1[1], 0); // V1, programmable
assert.ok(hex(t1).includes("ab".repeat(32)) && hex(t1).includes("807c814a00000000")); // receiver, 1.25e9 LE
assert.equal(t1[t1.length - 1], 0); // TransactionExpiration::None
// From the address balance: empty payment, ValidDuring with this epoch and the next, chain id and nonce (bytes as decoded from real testnet transactions)
const t2 = transfer({ sender: me, to, type: SUI_COIN, amount: 5n, fromBalance: 5n, gas: { payment: [], price: 1000n, budget: 3_000_000n, epoch: "1283", chain: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD", nonce: 405692858 } });
assert.ok(hex(t2).endsWith("02010305000000000000010405000000000000000020" + "4c78adacf2a2f5ad80f27ed7d54aa69d3a78f1ca67fdef9ecf5754f5b8bb77b0" + "ba612e18"));
assert.ok(hex(t2).includes("02000500000000000000" + "00" + hex(typeTag(SUI_COIN)) + "00")); // FundsWithdrawal(5 mist of SUI, from sender)
assert.equal(hex(typeTag(SUI_COIN)), "07" + "0".repeat(63) + "2" + "03737569" + "03535549" + "00");

// Signature: flag 0 ‖ ed25519(blake2b(intent ‖ tx)) ‖ public key
const { signature, digest } = signTx(t1, priv), raw = Buffer.from(signature, "base64");
assert.equal(raw.length, 97); assert.equal(raw[0], 0);
assert.ok(ed25519.verify(raw.subarray(1, 65), blake2b(Uint8Array.of(0, 0, 0, ...t1), { dkLen: 32 }), raw.subarray(65)));
assert.equal(digest, txDigest(t1));
console.log("sui ok");
