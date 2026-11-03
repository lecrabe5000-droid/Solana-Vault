// Several accounts in one Ecrin Wallet.
// - Accounts from the recovery phrase: account N uses index N on every network (the same accounts Phantom and
//   MetaMask show for that phrase), so nothing new needs backing up.
// - Imported private keys: one network family each (a Solana key, or an Ethereum-style key). They are encrypted with
//   a key derived from the recovery phrase (AES-256-GCM), so they unlock whenever the phrase does (password or Face ID)
//   and are as safe as the phrase itself. They are NOT covered by the recovery phrase backup: the wallet says so.
import { sha256 } from "@noble/hashes/sha256";
import bs58 from "bs58";
import { deriveAccount, normalize } from "./keyring.js";

const enc = new TextEncoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aesKey(phrase) {
  return crypto.subtle.importKey("raw", sha256(enc.encode("ecrin-imported-keys:v1:" + normalize(phrase))), "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function sealKeys(map, phrase) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(phrase), enc.encode(JSON.stringify(map))));
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}
export async function openKeys(box, phrase) {
  if (!box) return {};
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, await aesKey(phrase), unb64(box.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

/** Reads a pasted private key. Solana: base58 (Phantom/Solflare export) or a [64 numbers] array. Ethereum: 64 hex characters. */
export function parseKey(text, { web3, ethers }) {
  const t = String(text || "").trim();
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(t)) {
    const w = new ethers.Wallet(t.startsWith("0x") ? t : "0x" + t);
    return { fam: "evm", secret: w.privateKey, pub: w.address };
  }
  let bytes = null;
  if (/^\[[\d,\s]+\]$/.test(t)) bytes = Uint8Array.from(JSON.parse(t));
  else if (/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(t)) { try { bytes = bs58.decode(t); } catch (_) {} }
  if (bytes && bytes.length === 64) {
    const kp = web3.Keypair.fromSecretKey(bytes); // checks the public half matches
    return { fam: "sol", secret: bs58.encode(kp.secretKey), pub: kp.publicKey.toBase58() };
  }
  throw new Error("That doesn't look like a private key. Paste a Solana key (from Phantom or Solflare) or an Ethereum key (64 characters).");
}

/** The keys for one account entry. Returns { sol, evm, only } where `only` names the single family of an imported key. */
export function keysFor(entry, phrase, imported, { web3, ethers }) {
  if (!entry || entry.kind === "hd") return { ...deriveAccount(phrase, { web3, ethers }, entry?.i || 0), only: null };
  const s = imported[entry.id];
  if (!s) throw new Error("This imported account's key is missing.");
  if (entry.fam === "sol") return { sol: web3.Keypair.fromSecretKey(bs58.decode(s)), evm: null, only: "sol" };
  return { sol: null, evm: new ethers.Wallet(s), only: "evm" };
}

export const COLORS = ["#2f5bff", "#12b886", "#f59f00", "#e64980", "#7950f2", "#15aabf", "#fd7e14", "#82c91e"];
