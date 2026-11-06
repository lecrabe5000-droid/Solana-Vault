// Face ID / fingerprint unlock for the phone app, with passkeys and the WebAuthn "PRF" extension.
// The phone's secure chip holds a passkey; Face ID unlocks it, and it hands back a 32-byte secret that only this
// passkey can produce. That secret encrypts a second copy of your recovery phrase (AES-256-GCM). Without your face
// (or the phone's passcode) the copy can't be opened, so it's real encryption, not just a check.
// Phones without PRF (older iOS/Android) keep using the password.
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));

export const bioName = () => (/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) ? "Face ID" : "fingerprint or face unlock");
// Inside the native app (Capacitor), browser passkeys need extra Apple setup, so the option is hidden there for now.
export const bioPossible = () => !globalThis.Capacitor?.isNativePlatform?.() && !!(window.PublicKeyCredential && navigator.credentials?.create && window.isSecureContext);

async function keyFrom(secret) { return crypto.subtle.importKey("raw", secret, "AES-GCM", false, ["encrypt", "decrypt"]); }
const prfOut = (cred) => cred.getClientExtensionResults?.()?.prf?.results?.first;

/** Creates the passkey and returns what to store (no secret in it), or throws a readable error. */
export async function bioEnable(phrase) {
  if (!bioPossible()) throw new Error(`${bioName()} isn't available in this browser.`);
  const salt = rnd(32);
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: "Ecrin Wallet", id: location.hostname }, user: { id: rnd(16), name: "Ecrin Wallet", displayName: "Ecrin Wallet" },
    challenge: rnd(32), pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
    extensions: { prf: { eval: { first: salt } } }, timeout: 60_000,
  } });
  if (!cred.getClientExtensionResults?.()?.prf?.enabled && !prfOut(cred)) throw new Error(`This phone can't use ${bioName()} for the wallet yet (it needs iOS 18 or a recent Android). Keep using your password.`);
  // Some phones give the secret at creation; others only when the passkey is used, so ask once more.
  let secret = prfOut(cred);
  if (!secret) secret = prfOut(await navigator.credentials.get({ publicKey: { challenge: rnd(32), allowCredentials: [{ type: "public-key", id: cred.rawId }], userVerification: "required", extensions: { prf: { eval: { first: salt } } }, timeout: 60_000 } }));
  if (!secret) throw new Error(`This phone can't use ${bioName()} for the wallet yet. Keep using your password.`);
  const iv = rnd(12), ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(secret), enc.encode(phrase));
  return { v: 1, id: b64(cred.rawId), salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

/** Asks for Face ID and returns the recovery phrase, or throws. */
export async function bioUnlock(box) {
  const cred = await navigator.credentials.get({ publicKey: { challenge: rnd(32), allowCredentials: [{ type: "public-key", id: unb64(box.id) }], userVerification: "required", extensions: { prf: { eval: { first: unb64(box.salt) } } }, timeout: 60_000 } });
  const secret = prfOut(cred);
  if (!secret) throw new Error(`${bioName()} didn't return the key. Use your password.`);
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, await keyFrom(secret), unb64(box.ct)));
}
