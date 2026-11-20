// One page to create Ecrin's Jupiter referral account under the project Jupiter's /order API requires (its "Ultra"
// project), plus the fee token accounts for SOL, USDC and USDT, in one transaction the connected wallet signs.
// It reproduces exactly two things from Jupiter's own @jup-ag/referral-sdk 0.3.0:
//   initializeReferralAccountWithName (referral program) and initializeReferralTokenAccountV2 (an associated token
//   account owned by the referral account, created idempotently).
// Nothing here holds keys: the wallet (Ecrin, Phantom…) signs and sends.
import "./shim.js";
import * as web3 from "@solana/web3.js";

const RPC = "/api/rpc/solm"; // Ecrin's own relay to Solana mainnet (same site)
const REFERRAL_PROGRAM = new web3.PublicKey("REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3");
const PROJECT = new web3.PublicKey("DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc"); // the project Jupiter's /order checks
const TOKEN = new web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA = new web3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MINTS = { SOL: "So11111111111111111111111111111111111111112", USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" };
// Anchor discriminator: sha256("global:initialize_referral_account_with_name")[0..8]
const DISC = Uint8Array.from([241, 190, 107, 26, 244, 236, 119, 229]);

const conn = new web3.Connection(new URL(RPC, location.origin).href, "confirmed");
const $ = (s) => document.querySelector(s);
const say = (html, cls = "") => { const el = $("#status"); el.className = cls; el.innerHTML = html; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const referralPda = (name) => web3.PublicKey.findProgramAddressSync([Buffer.from("referral"), PROJECT.toBuffer(), Buffer.from(name)], REFERRAL_PROGRAM)[0];
const ataOf = (owner, mint) => web3.PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA)[0];

function initReferralIx(payer, name) {
  const nameBytes = new TextEncoder().encode(name), data = new Uint8Array(8 + 4 + nameBytes.length);
  data.set(DISC, 0); new DataView(data.buffer).setUint32(8, nameBytes.length, true); data.set(nameBytes, 12);
  return new web3.TransactionInstruction({ programId: REFERRAL_PROGRAM, data: Buffer.from(data), keys: [
    { pubkey: payer, isSigner: true, isWritable: true }, // payer
    { pubkey: payer, isSigner: false, isWritable: false }, // partner: the wallet that owns and claims the fees
    { pubkey: PROJECT, isSigner: false, isWritable: false },
    { pubkey: referralPda(name), isSigner: false, isWritable: true },
    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
  ] });
}
// createAssociatedTokenAccountIdempotent (instruction 1 of the associated token program), owner = the referral account
function ataIx(payer, owner, mint) {
  return new web3.TransactionInstruction({ programId: ATA, data: Buffer.from([1]), keys: [
    { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: ataOf(owner, mint), isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN, isSigner: false, isWritable: false },
  ] });
}

// ---- wallets (Wallet Standard: Ecrin, Phantom, Solflare, Backpack…)
const wallets = [];
const add = (w) => { if (w?.features?.["standard:connect"] && w.features["solana:signAndSendTransaction"] && !wallets.includes(w)) { wallets.push(w); drawWallets(); } };
window.addEventListener("wallet-standard:register-wallet", (e) => e.detail?.({ register: add }));
window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register: add } }));
let W = null, me = null;
function drawWallets() {
  $("#wallets").innerHTML = wallets.length ? wallets.map((w, i) => `<button class="btn" data-w="${i}">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : ""}${esc(w.name)}</button>`).join("") : `<p class="muted">No Solana wallet found in this browser. Open this page in Chrome with the Ecrin Wallet extension (or Phantom).</p>`;
}
setTimeout(drawWallets, 600);

async function check() {
  const name = $("#name").value.trim(), ref = referralPda(name);
  const keys = [ref, ...Object.values(MINTS).map((m) => ataOf(ref, new web3.PublicKey(m)))];
  const [info, bal] = await Promise.all([conn.getMultipleAccountsInfo(keys), conn.getBalance(me)]);
  const owned = info[0] && info[0].owner.equals(REFERRAL_PROGRAM);
  const rows = [["Referral account", owned], ...Object.keys(MINTS).map((k, i) => [`${k} fee account`, !!info[i + 1]])];
  $("#result").innerHTML = `<div class="kv"><div><span>Wallet</span><b class="mono">${esc(me.toBase58())}</b></div><div><span>Balance</span><b>${(bal / 1e9).toFixed(4)} SOL</b></div>
    ${rows.map(([k, ok]) => `<div><span>${k}</span><b class="${ok ? "ok" : "no"}">${ok ? "created" : "not yet"}</b></div>`).join("")}</div>
    ${owned ? `<p>Put this in Cloudflare as <b>JUPITER_REFERRAL_ACCOUNT</b>:</p><div class="addr mono">${ref.toBase58()}</div><button class="btn sm" id="copy">Copy</button>` : ""}`;
  $("#copy")?.addEventListener("click", () => navigator.clipboard.writeText(ref.toBase58()).then(() => ($("#copy").textContent = "Copied")));
  $("#create").disabled = owned && rows.every(([, ok]) => ok);
  $("#create").textContent = owned ? "Create the missing fee accounts" : "Create the referral account (one approval)";
  return { bal, owned };
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-w]");
  if (b) {
    try {
      W = wallets[Number(b.dataset.w)]; say("Waiting for your wallet…");
      const r = await W.features["standard:connect"].connect(); const a = (r?.accounts || W.accounts)[0];
      if (!a) throw new Error("The wallet didn't share an account.");
      me = new web3.PublicKey(a.address); W.acct = a;
      $("#step2").hidden = false; say(""); await check();
    } catch (err) { say(esc(err.message || err), "bad"); }
  }
  if (e.target.id === "create") {
    try {
      const name = $("#name").value.trim(); if (!/^[A-Za-z0-9 _-]{2,32}$/.test(name)) throw new Error("Use a name of 2 to 32 letters or numbers.");
      const { bal, owned } = await check();
      if (bal < 12_000_000) throw new Error("This wallet needs about 0.012 SOL for the deposits (it has " + (bal / 1e9).toFixed(4) + " SOL).");
      const ref = referralPda(name), tx = new web3.Transaction();
      if (!owned) tx.add(initReferralIx(me, name));
      for (const m of Object.values(MINTS)) tx.add(ataIx(me, ref, new web3.PublicKey(m)));
      tx.feePayer = me; tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
      say("Approve the transaction in your wallet…");
      await W.features["solana:signAndSendTransaction"].signAndSendTransaction({ account: W.acct, chain: "solana:mainnet", transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }) });
      say("Sent. Waiting for Solana to confirm…");
      for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 2000)); const s = await check(); if (s.owned) break; }
      say("Done. Copy the address below into Cloudflare.", "good");
    } catch (err) { say(esc(err.message || err), "bad"); }
  }
});
$("#name").addEventListener("input", () => { if (me) check().catch(() => {}); });
