// Test-coin faucet: sends a little devnet SOL from Ecrin's faucet wallet, so testers don't need an outside faucet.
// The faucet wallet's secret key is the FAUCET_SOL_KEY secret (base58, as wallets export it, or a JSON byte array).
// Devnet only: the transfer is signed here with WebCrypto Ed25519, no Solana library needed.

export const FAUCET_LAMPORTS = 500_000_000; // 0.5 SOL per claim
const SYSTEM = new Uint8Array(32); // 11111111111111111111111111111111

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58decode(s) {
  let n = 0n;
  for (const c of String(s)) { const i = B58.indexOf(c); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of String(s)) { if (c !== "1") break; out.unshift(0); }
  return new Uint8Array(out);
}
const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const compact = (n) => { const out = []; for (;;) { let b = n & 0x7f; n >>= 7; if (n) { out.push(b | 0x80); } else { out.push(b); return out; } } };

/** The faucet's key pair from the secret: 64 bytes (seed + public key). */
export async function faucetKey(secret) {
  const s = String(secret || "").trim(); if (!s) return null;
  const raw = s.startsWith("[") ? new Uint8Array(JSON.parse(s)) : b58decode(s);
  if (raw.length !== 64) throw new Error("FAUCET_SOL_KEY must be a 64-byte Solana secret key");
  const seed = raw.slice(0, 32), pub = raw.slice(32);
  const key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", d: b64url(seed), x: b64url(pub) }, { name: "Ed25519" }, false, ["sign"]);
  return { key, pub };
}

/** A signed System Program transfer, ready to send (base64). */
export async function transferTx({ key, pub }, to, lamports, blockhash) {
  const msg = [1, 0, 1, ...compact(3), ...pub, ...to, ...SYSTEM, ...b58decode(blockhash), ...compact(1), 2, ...compact(2), 0, 1, ...compact(12)];
  const data = new Uint8Array(12), dv = new DataView(data.buffer); dv.setUint32(0, 2, true); dv.setBigUint64(4, BigInt(lamports), true);
  const message = new Uint8Array([...msg, ...data]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, message));
  return b64(new Uint8Array([...compact(1), ...sig, ...message]));
}

async function rpc(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json().catch(() => ({})); if (j.error) throw new Error(j.error.message || "RPC error"); return j.result;
}

/** Sends one claim. Returns { sig } or throws with a message a person can read. */
export async function faucetSend(env, rpcUrl, address) {
  let to; try { to = b58decode(address); } catch (_) { to = []; }
  if (to.length !== 32) throw Object.assign(new Error("That isn't a Solana address."), { status: 400 });
  const kp = await faucetKey(env.FAUCET_SOL_KEY); if (!kp) throw Object.assign(new Error("Test coins aren't switched on yet."), { status: 503 });
  const { value: bal } = await rpc(rpcUrl, "getBalance", [b58encodeLite(kp.pub), { commitment: "confirmed" }]);
  if (bal < FAUCET_LAMPORTS + 10_000) throw Object.assign(new Error("The test-coin faucet is empty right now. Try again later."), { status: 503 });
  const { value: { blockhash } } = await rpc(rpcUrl, "getLatestBlockhash", [{ commitment: "confirmed" }]);
  const tx = await transferTx(kp, to, FAUCET_LAMPORTS, blockhash);
  const sig = await rpc(rpcUrl, "sendTransaction", [tx, { encoding: "base64", preflightCommitment: "confirmed" }]);
  return { sig, lamports: FAUCET_LAMPORTS };
}
function b58encodeLite(bytes) {
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = "1" + s; }
  return s;
}
