// Ecrin Wallet keys. One 12-word recovery phrase (BIP-39) gives one account on every network:
// - Solana: SLIP-0010 ed25519 at m/44'/501'/i'/0' (the path Phantom and Solflare use), so the same phrase works there.
// - Ethereum-style networks: BIP-44 secp256k1 at m/44'/60'/0'/0/i (the path MetaMask uses).
// The phrase is stored only encrypted: PBKDF2-SHA256 (600,000 rounds) turns the password into an AES-256-GCM key.
// Only well-known audited libraries do the cryptography (@scure/bip39, @noble/hashes, ethers, WebCrypto).
import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { hmac } from "@noble/hashes/hmac";
import { sha512 } from "@noble/hashes/sha512";

const enc = new TextEncoder();
export const ROUNDS = 600_000;

export const newPhrase = () => generateMnemonic(wordlist, 128);
export const normalize = (p) => String(p || "").trim().toLowerCase().split(/\s+/).join(" ");
export const isPhrase = (p) => { const n = normalize(p); return [12, 15, 18, 21, 24].includes(n.split(" ").length) && validateMnemonic(n, wordlist); };
export const WORDS = wordlist;

/** SLIP-0010 for ed25519: hardened steps only. Returns the 32-byte private seed at `path`. */
export function slip10(seed, path) {
  let I = hmac(sha512, enc.encode("ed25519 seed"), seed);
  let k = I.slice(0, 32), c = I.slice(32);
  for (const step of path.replace(/^m\/?/, "").split("/").filter(Boolean)) {
    if (!step.endsWith("'")) throw new Error("ed25519 only has hardened steps");
    const i = (Number(step.slice(0, -1)) + 0x80000000) >>> 0;
    const data = new Uint8Array(37);
    data.set(k, 1); new DataView(data.buffer).setUint32(33, i);
    I = hmac(sha512, c, data); k = I.slice(0, 32); c = I.slice(32);
  }
  return k;
}

/** The account's keys for both families. `web3` and `ethers` are passed in so this file stays small and testable. */
export function deriveAccount(phrase, { web3, ethers }, index = 0) {
  const seed = mnemonicToSeedSync(normalize(phrase));
  const sol = web3.Keypair.fromSeed(slip10(seed, `m/44'/501'/${index}'/0'`));
  const evm = ethers.HDNodeWallet.fromPhrase(normalize(phrase), undefined, `m/44'/60'/0'/0/${index}`);
  return { sol, evm };
}

const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(password, salt, rounds) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Encrypts the phrase with the password. The result is safe to store; it reveals nothing without the password. */
export async function seal(phrase, password, rounds = ROUNDS) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(password, salt, rounds), enc.encode(normalize(phrase))));
  return { v: 1, kdf: "pbkdf2-sha256", rounds, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

/** Decrypts with the password, or throws "Wrong password". */
export async function open(box, password) {
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, await keyFrom(password, unb64(box.salt), box.rounds), unb64(box.ct));
    return new TextDecoder().decode(pt);
  } catch (_) { throw new Error("Wrong password"); }
}

/** 0 to 4: how hard the password is to guess, by length and variety. Below 2 is refused. */
export function strength(pw) {
  pw = String(pw || "");
  if (pw.length < 8) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((r) => r.test(pw)).length;
  return Math.min(4, (pw.length >= 12 ? 2 : 1) + (kinds >= 3 ? 2 : kinds >= 2 ? 1 : 0));
}
