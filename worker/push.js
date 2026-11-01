// Web Push with no library: VAPID (RFC 8292) to identify the sender and aes128gcm (RFC 8291) to encrypt the
// message so only the subscribed browser can read it. Works in the Worker and in Node (both have WebCrypto).

const enc = new TextEncoder();
export const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
const hkdf = async (salt, ikm, info, bits) => new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), bits));

/** Push services browsers use. Subscriptions pointing anywhere else are refused, so the worker never calls arbitrary URLs. */
export function allowedEndpoint(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com|android\.googleapis\.com)$/.test(u.hostname);
  } catch (_) { return false; }
}

/** A new VAPID key pair, as JWKs to store. */
export async function newVapidKeys() {
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { publicJwk: await crypto.subtle.exportKey("jwk", k.publicKey), privateJwk: await crypto.subtle.exportKey("jwk", k.privateKey) };
}
/** The public key as browsers want it (applicationServerKey): the raw 65-byte point, base64url. */
export const vapidPublic = (jwk) => b64u(cat(Uint8Array.of(4), unb64u(jwk.x), unb64u(jwk.y)));

async function vapidHeader(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin, exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const unsigned = `${b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })))}.${b64u(enc.encode(JSON.stringify({ aud, exp, sub: subject })))}`;
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${vapidPublic(keys.publicJwk)}`;
}

/** Encrypts a payload for one subscription (keys.p256dh, keys.auth), as an aes128gcm body. */
export async function encrypt(payload, p256dh, auth) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(secret, shared, cat(enc.encode("WebPush: info\0"), ua, asPub), 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 96);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(enc.encode(payload), Uint8Array.of(2))));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return cat(salt, rs, Uint8Array.of(asPub.length), asPub, body);
}

/** Sends one push. Returns the push service's status (201 = accepted; 404/410 = the subscription is gone). */
export async function sendPush(sub, payload, keys, subject = "https://ecrinprotocol.app") {
  if (!allowedEndpoint(sub.endpoint)) return 400;
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: { authorization: await vapidHeader(sub.endpoint, keys, subject), "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: "high" },
    body: await encrypt(JSON.stringify(payload), sub.p256dh, sub.auth),
  });
  return r.status;
}
