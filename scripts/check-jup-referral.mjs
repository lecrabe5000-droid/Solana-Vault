// Checks a Jupiter referral account before it goes in Cloudflare (JUPITER_REFERRAL_ACCOUNT). Read-only.
//   node scripts/check-jup-referral.mjs <referral account address> [rpc url]
// It must be owned by Jupiter's referral program and belong to the Jupiter Ultra project, and have a token account
// for each coin fees are taken in (wrapped SOL, USDC, USDT): a coin without one collects no fee.
import { createRequire } from "node:module";
const require = createRequire(new URL("../extension/package.json", import.meta.url));
const { Connection, PublicKey } = require("@solana/web3.js");

const REFERRAL_PROGRAM = new PublicKey("REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3");
const ULTRA_PROJECT = new PublicKey("DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc"); // named in Jupiter's own error message
const MINTS = { "wrapped SOL": "So11111111111111111111111111111111111111112", USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" };

const addr = process.argv[2], rpc = process.argv[3] || "https://api.mainnet-beta.solana.com";
let ref; try { ref = new PublicKey(addr); } catch (_) { console.log("✗ That isn't a Solana address."); process.exit(1); }
const conn = new Connection(rpc, "confirmed");
const acc = await conn.getAccountInfo(ref);
if (!acc) { console.log("✗ Nothing exists at this address on Solana mainnet."); process.exit(1); }
if (!acc.owner.equals(REFERRAL_PROGRAM)) {
  console.log(`✗ Not a Jupiter referral account (owned by ${acc.owner.toBase58()}).`);
  if (acc.owner.toBase58() === "11111111111111111111111111111111") console.log("  This is a regular wallet address. Create a referral account for it in Jupiter's referral dashboard.");
  process.exit(1);
}
// Layout: 8-byte discriminator, then partner (32), then project (32).
const partner = new PublicKey(acc.data.subarray(8, 40)), project = new PublicKey(acc.data.subarray(40, 72));
console.log(`✓ Jupiter referral account. Owner (who claims the fees): ${partner.toBase58()}`);
if (!project.equals(ULTRA_PROJECT)) { console.log(`✗ It belongs to another Jupiter project (${project.toBase58()}), not Jupiter Ultra. Create one under Jupiter Ultra.`); process.exit(1); }
console.log("✓ Under the Jupiter Ultra project");
let missing = 0;
for (const [name, mint] of Object.entries(MINTS)) {
  const [ata] = PublicKey.findProgramAddressSync([Buffer.from("referral_ata"), ref.toBuffer(), new PublicKey(mint).toBuffer()], REFERRAL_PROGRAM);
  const ok = !!(await conn.getAccountInfo(ata));
  if (!ok) missing++;
  console.log(`${ok ? "✓" : "✗"} Fee account for ${name}${ok ? "" : ": missing (fees in this coin won't be collected)"}`);
}
console.log(missing ? "\nAlmost: create the missing fee accounts in the dashboard, then it's ready." : "\nReady: put this address in Cloudflare as JUPITER_REFERRAL_ACCOUNT.");
