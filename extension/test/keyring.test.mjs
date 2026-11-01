// Keyring tests: known vectors for both derivations, and the encryption round trip. Run: npm test
import * as web3 from "@solana/web3.js";
import { ethers } from "ethers";
import { slip10, deriveAccount, seal, open, isPhrase, newPhrase, normalize, strength } from "../src/keyring.js";

let passed = 0, failed = 0;
const t = async (name, fn) => { try { await fn(); passed++; } catch (e) { failed++; console.log("FAIL", name, "\n ", e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${a} != ${b}`); };
const hex = (u8) => Buffer.from(u8).toString("hex");

await t("SLIP-0010 ed25519 test vector 1", () => {
  const seed = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
  eq(hex(slip10(seed, "m")), "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7", "m");
  eq(hex(slip10(seed, "m/0'")), "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3", "m/0'");
  eq(hex(slip10(seed, "m/0'/1'/2'/2'/1000000000'")), "8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793", "deep");
});

await t("Ethereum address matches MetaMask/Hardhat for the test phrase", () => {
  const { evm } = deriveAccount("test test test test test test test test test test test junk", { web3, ethers });
  eq(evm.address, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "account 0");
});

await t("Solana key is stable, and the same phrase always gives the same accounts", () => {
  const p = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const a = deriveAccount(p, { web3, ethers }), b = deriveAccount("  " + p.toUpperCase() + " ", { web3, ethers });
  eq(a.sol.publicKey.toBase58(), b.sol.publicKey.toBase58(), "normalised");
  eq(a.sol.publicKey.toBase58() === deriveAccount(p, { web3, ethers }, 1).sol.publicKey.toBase58(), false, "index 1 differs");
});

await t("phrases: new ones are valid 12 words, typos are refused", () => {
  const p = newPhrase();
  eq(p.split(" ").length, 12, "12 words"); eq(isPhrase(p), true, "valid");
  eq(isPhrase(p.replace(/\w+$/, "zzzz")), false, "bad word");
  eq(isPhrase("abandon ".repeat(12)), false, "bad checksum");
});

await t("sealed phrase opens with the password only, and hides the words", async () => {
  const p = newPhrase(), box = await seal(p, "correct horse 9!", 1000);
  eq(JSON.stringify(box).includes(p.split(" ")[0] + " "), false, "no plaintext");
  eq(await open(box, "correct horse 9!"), normalize(p), "round trip");
  let err = ""; try { await open(box, "wrong"); } catch (e) { err = e.message; }
  eq(err, "Wrong password", "refused");
  const box2 = await seal(p, "correct horse 9!", 1000);
  eq(box.ct === box2.ct, false, "fresh salt and iv each time");
});

await t("password strength", () => { eq(strength("short"), 0, "short"); eq(strength("longerpassword"), 2, "plain"); eq(strength("Longer-pass-2026"), 4, "strong"); });

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
