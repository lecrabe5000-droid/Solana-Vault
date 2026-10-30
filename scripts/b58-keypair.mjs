// Prints a Solana keypair file (a JSON array of 64 bytes) from a secret key given as base58 (what Phantom's
// "Export private key" shows) or as a JSON array. Used by the devnet deploy workflow; never logs the key.
const input = String(process.argv[2] || "").trim();
if (!input) { console.error("no key given"); process.exit(1); }
let bytes;
if (input.startsWith("[")) bytes = JSON.parse(input);
else {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of input) { const i = A.indexOf(c); if (i < 0) { console.error("not base58"); process.exit(1); } n = n * 58n + BigInt(i); }
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of input) { if (c === "1") out.unshift(0); else break; }
  bytes = out;
}
if (bytes.length !== 64) { console.error(`expected a 64-byte secret key, got ${bytes.length} bytes`); process.exit(1); }
process.stdout.write(JSON.stringify(bytes));
