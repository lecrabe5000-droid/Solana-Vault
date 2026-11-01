// Tests for worker/push.js: decrypts what encrypt() produces the way a browser would (RFC 8291), and checks the
// VAPID signature. Run: node worker/push.test.mjs
import { encrypt, newVapidKeys, vapidPublic, allowedEndpoint, b64u, unb64u, sendPush } from "./push.js";

let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; } catch (e) { failed++; console.log("FAIL", name, "\n ", e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m || "expected true"); };
const enc = new TextEncoder(), dec = new TextDecoder();
const cat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const hkdf = async (salt, ikm, info, bits) => new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), bits));

// A browser's side: its key pair and auth secret, and how it decrypts.
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
async function browserDecrypt(body) {
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(enc.encode("WebPush: info\0"), uaPub, asPub), 256);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 128), nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 96);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), ct));
  if (plain[plain.length - 1] !== 2) throw new Error("missing last-record delimiter");
  return dec.decode(plain.slice(0, -1));
}

await test("a browser can decrypt the message, and only with its own keys", async () => {
  const msg = JSON.stringify({ title: "Withdrawal requested", body: "25 USDC can leave in 3 days", url: "https://ecrinprotocol.app/app" });
  const body = await encrypt(msg, b64u(uaPub), b64u(auth));
  ok((await browserDecrypt(body)) === msg, "round trip");
  ok(new DataView(body.buffer).getUint32(16) === 4096 && body[20] === 65, "header");
  const other = await encrypt(msg, b64u(uaPub), b64u(crypto.getRandomValues(new Uint8Array(16))));
  let threw = false; try { await browserDecrypt(other); } catch (_) { threw = true; } ok(threw, "a different auth secret can't be read");
});

await test("the VAPID key is a 65-byte point and the request carries a valid ES256 signature", async () => {
  const keys = await newVapidKeys(), pub = unb64u(vapidPublic(keys.publicJwk));
  ok(pub.length === 65 && pub[0] === 4, "raw point");
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url, init }; return new Response(null, { status: 201 }); };
  const status = await sendPush({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: b64u(uaPub), auth: b64u(auth) }, { title: "t" }, keys);
  ok(status === 201, "status");
  const [, jwt, k] = seen.init.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  ok(k === vapidPublic(keys.publicJwk), "k");
  const [h, c, s] = jwt.split(".");
  const claims = JSON.parse(dec.decode(unb64u(c)));
  ok(claims.aud === "https://fcm.googleapis.com" && claims.exp > Date.now() / 1000, "claims");
  const verifyKey = await crypto.subtle.importKey("jwk", keys.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifyKey, unb64u(s), enc.encode(`${h}.${c}`)), "signature");
  ok(seen.init.headers["content-encoding"] === "aes128gcm", "encoding");
});

await test("only real push services are called", async () => {
  ok(allowedEndpoint("https://fcm.googleapis.com/fcm/send/x"), "chrome");
  ok(allowedEndpoint("https://web.push.apple.com/abc"), "safari");
  ok(allowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x"), "firefox");
  ok(allowedEndpoint("https://wns2-bl2p.notify.windows.com/w/?token=x"), "edge");
  ok(!allowedEndpoint("http://fcm.googleapis.com/x"), "http");
  ok(!allowedEndpoint("https://evil.example/fcm.googleapis.com"), "other host");
  ok(!allowedEndpoint("https://fcm.googleapis.com.evil.example/x"), "suffix trick");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
