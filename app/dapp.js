// Ecrin app: your real vault on Solana devnet, through the wallet you already use.
// Reads with app/chain.js, signs in the wallet, sends through our own devnet RPC (so it works whichever network
// the wallet is set to). Nothing here holds keys or funds.
import { createClient, explainError } from "./chain.js";
import { CONFIG } from "./config.js";

const web3 = window.solanaWeb3;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const LAMPORTS = 1e9, HOUR = 3600, DAY = 86400;
const sol = (l) => (l / LAMPORTS).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const short = (k) => { const s = String(k); return s.slice(0, 4) + "…" + s.slice(-4); };
const when = (t) => new Date(t * 1000).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dur = (s) => { if (s <= 0) return "ready"; const d = Math.floor(s / DAY), h = Math.floor((s % DAY) / HOUR), m = Math.floor((s % HOUR) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${Math.max(1, m)}m`; };
const delayWords = (s) => (s % DAY === 0 ? `${s / DAY} day${s === DAY ? "" : "s"}` : `${Math.round(s / HOUR)} h`);
const explorer = (kind, id) => `https://explorer.solana.com/${kind}/${id}?cluster=${CONFIG.cluster}`;
const logo = `<svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="8" fill="none" stroke="#2F5BFF" stroke-width="2.2"/><path d="M16 9.5l5.5 6.5L16 22.5 10.5 16z" fill="#2F5BFF"/></svg>`;

const connection = new web3.Connection(CONFIG.rpc, "confirmed");
const client = CONFIG.programId ? createClient({ web3, connection, programId: CONFIG.programId }) : null;

const S = { wallet: null, provider: null, walletSol: null, vault: undefined, view: "owner", watchOwner: "", watched: undefined, busy: false, clockOffset: 0, err: null, pick: "strong" };
const now = () => Math.floor(Date.now() / 1000) + S.clockOffset;

let toastTimer;
function toast(text, kind = "") { const t = $("#toast"); t.innerHTML = text; t.className = "toast " + kind; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 5000); }

// ------------------------------------------------------------------ wallet

function providers() {
  const out = [];
  const ph = window.phantom?.solana; if (ph?.isPhantom) out.push(["Phantom", ph]);
  if (window.solflare?.isSolflare) out.push(["Solflare", window.solflare]);
  if (window.backpack?.isBackpack) out.push(["Backpack", window.backpack]);
  if (!out.length && window.solana) out.push(["Wallet", window.solana]);
  return out;
}
async function connect(provider) {
  try {
    const r = await provider.connect();
    S.provider = provider; S.wallet = new web3.PublicKey((r?.publicKey || provider.publicKey).toString());
    provider.on?.("accountChanged", (pk) => { if (pk) { S.wallet = new web3.PublicKey(pk.toString()); S.vault = undefined; refresh(); } else disconnect(); });
    try { localStorage.setItem("ecrin-wallet", "1"); } catch (_) {}
    await refresh();
  } catch (e) { toast(esc(explainError(e).message), "err"); }
}
function disconnect() { try { S.provider?.disconnect?.(); } catch (_) {} S.wallet = null; S.provider = null; S.vault = undefined; try { localStorage.removeItem("ecrin-wallet"); } catch (_) {} render(); }

/** Signs in the wallet, sends through our devnet RPC, waits for confirmation. */
async function send(label, ...ixs) {
  if (S.busy) return null;
  S.busy = true; render();
  try {
    const tx = new web3.Transaction().add(...(await Promise.all(ixs)));
    tx.feePayer = S.wallet;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    const signed = await S.provider.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    await confirm(sig, lastValidBlockHeight);
    log(label, sig);
    toast(`${esc(label)} · <a href="${explorer("tx", sig)}" target="_blank" rel="noopener" style="color:inherit">view</a>`, label.startsWith("Cancelled") ? "win" : "");
    return sig;
  } catch (e) {
    console.warn(e);
    toast(esc(explainError(e).message), "err");
    return null;
  } finally { S.busy = false; await refresh(); }
}

// Polls the signature's status instead of waiting on a websocket (some RPCs and networks drop them).
async function confirm(sig, lastValidBlockHeight) {
  for (let i = 0; i < 90; i++) {
    const st = (await connection.getSignatureStatuses([sig])).value[0];
    if (st?.err) throw Object.assign(new Error("Transaction failed: " + JSON.stringify(st.err)), { logs: (await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 }).catch(() => null))?.meta?.logMessages || [] });
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
    if (i % 10 === 9 && (await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) throw new Error("The transaction expired before it landed. Try again.");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Still waiting for the network. Check the explorer for " + sig);
}

function logKey() { return "ecrin-log-" + (S.wallet ? S.wallet.toBase58() : ""); }
function readLog() { try { return JSON.parse(localStorage.getItem(logKey()) || "[]"); } catch (_) { return []; } }
function log(text, sig) { try { localStorage.setItem(logKey(), JSON.stringify([{ at: now(), text, sig }, ...readLog()].slice(0, 30))); } catch (_) {} }

async function refresh() {
  if (!client || !S.wallet) return render();
  try {
    const [bal, vault, t] = await Promise.all([connection.getBalance(S.wallet, "confirmed"), client.fetchVault(S.wallet), client.chainTime().catch(() => null)]);
    S.walletSol = bal; S.vault = vault; S.err = null;
    if (t) S.clockOffset = t - Math.floor(Date.now() / 1000);
    if (S.view === "guardian" && S.watchOwner) S.watched = await client.fetchVault(new web3.PublicKey(S.watchOwner)).catch(() => null);
  } catch (e) { S.err = "Couldn't reach Solana devnet. Retrying…"; console.warn(e); }
  render();
}

// ------------------------------------------------------------------ views

function header() {
  const w = S.wallet;
  return `<header class="top">
    <a class="brand" href="/" style="text-decoration:none">${logo}Ecrin</a><span class="net">Devnet</span><div class="spacer"></div>
    ${w ? `<div class="seg" role="group" aria-label="View as"><button data-act="view" data-v="owner" aria-pressed="${S.view === "owner"}">My vault</button><button data-act="view" data-v="guardian" aria-pressed="${S.view === "guardian"}">Guardian</button></div>
      <button class="btn sm wallet" data-act="disconnect" title="Disconnect ${esc(w.toBase58())}"><i class="live"></i>${short(w)}</button>` : ""}
  </header>`;
}

function render() {
  const app = $("#app");
  if (!client) {
    app.innerHTML = header() + `<section class="card center-card"><div class="big-ico">${logo}</div><h2>The Ecrin program isn't on devnet yet</h2><p class="muted">It's being deployed. In the meantime, the demo runs the same rules with pretend money.</p><a class="btn primary" href="/demo">Open the demo</a></section>`;
    return;
  }
  if (!S.wallet) {
    const list = providers();
    app.innerHTML = header() + `<section class="card center-card">
      <div class="big-ico">${logo}</div><h2>Connect your wallet</h2>
      <p class="muted">Ecrin never holds your keys. Your wallet signs, the Solana program enforces the rules.</p>
      <div class="wallets">${list.length ? list.map(([n], i) => `<button class="btn primary" data-act="connect" data-i="${i}">Connect ${esc(n)}</button>`).join("") : `<a class="btn primary" href="https://phantom.com/download" target="_blank" rel="noopener">Get Phantom</a>`}</div>
      <ol class="howto"><li>In Phantom: Settings → Developer Settings → turn on <b>Testnet Mode</b> and pick <b>Solana Devnet</b>.</li><li>Get free test SOL at <a href="https://faucet.solana.com" target="_blank" rel="noopener">faucet.solana.com</a>.</li><li>Connect, create your vault, and try a withdrawal.</li></ol>
    </section>`;
    return;
  }
  if (S.view === "guardian") return renderGuardian(app);
  if (S.vault === undefined) { app.innerHTML = header() + `<section class="card center-card"><p class="muted">Reading your vault from devnet…</p></section>`; return; }
  if (S.vault === null) return renderCreate(app);
  renderVault(app, S.vault);
}

function renderCreate(app) {
  const presets = [["gentle", "Gentle", "Withdrawals wait 24 h. Loosening a rule waits 3 days."], ["strong", "Strong", "Withdrawals wait 72 h. Loosening a rule waits 7 days."], ["locked", "Locked", "Nothing leaves before a date you pick, except an emergency your guardian co-signs."]];
  app.innerHTML = header() + `<div class="onb">
    <section class="intro"><h1>Create your vault</h1><p>One vault per wallet. You can make it stricter any time; loosening it always waits.</p></section>
    ${S.walletSol < 0.01 * LAMPORTS ? `<div class="notice">Your wallet has ${sol(S.walletSol)} SOL on devnet. Get free test SOL at <a href="https://faucet.solana.com" target="_blank" rel="noopener">faucet.solana.com</a> for <b>${short(S.wallet)}</b>, then come back.</div>` : ""}
    <div class="presets">${presets.map(([k, n, d]) => `<button type="button" class="preset" data-act="pick" data-k="${k}" aria-pressed="${S.pick === k}"><i class="dot"></i><b>${n}</b><span>${d}</span></button>`).join("")}</div>
    <label class="field">Guardian wallet address ${S.pick === "locked" ? "(required)" : "(optional)"}<input id="g-addr" placeholder="A friend's Solana address" autocomplete="off" spellcheck="false"/></label>
    ${S.pick === "locked" ? `<label class="field" style="margin-top:12px">Locked until<input id="lock-date" type="date"/></label>` : ""}
    <button class="btn primary" style="width:100%;height:50px;margin-top:20px" data-act="create" ${S.busy ? "disabled" : ""}>${S.busy ? "Confirm in your wallet…" : "Create vault"}</button>
    <p class="foot">Creating the vault costs a small amount of devnet SOL for the account's rent.</p></div>`;
}

function rowsWithdrawals(v, asGuardian) {
  const t = now(), locked = v.lockedUntil && t < v.lockedUntil;
  return v.withdrawals.map((w) => {
    const total = Math.max(1, v.withdrawDelay), left = w.readyAt - t, pct = Math.min(100, Math.max(2, (1 - left / total) * 100));
    const ready = left <= 0 && !locked;
    const acts = asGuardian
      ? (S.wallet && v.guardian?.equals(S.wallet) ? `<button class="btn sm good" data-act="release" data-id="${w.id}" data-dest="${w.dest.toBase58()}" ${S.busy ? "disabled" : ""}>Approve emergency release</button>` : "")
      : `<button class="btn sm" data-act="cancel-w" data-id="${w.id}" ${S.busy ? "disabled" : ""}>Cancel, keep it in the vault</button>${ready ? `<button class="btn sm danger" data-act="run" data-id="${w.id}" data-dest="${w.dest.toBase58()}" ${S.busy ? "disabled" : ""}>Send it now</button>` : ""}`;
    return `<div class="row"><div class="row-top"><b>${sol(w.amount)} SOL</b><span class="count" data-ready="${w.readyAt}">${ready ? "Ready" : locked && left <= 0 ? "Locked" : dur(left)}</span></div>
      <div class="small muted">to <a href="${explorer("address", w.dest.toBase58())}" target="_blank" rel="noopener">${short(w.dest)}</a> · unlocks ${when(Math.max(w.readyAt, locked ? v.lockedUntil : 0))}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>${acts ? `<div class="row-acts">${acts}</div>` : ""}</div>`;
  }).join("") || `<div class="empty">Nothing waiting to leave.</div>`;
}

function changeWords({ kind, value }) {
  switch (kind) {
    case "SetWithdrawDelay": return `Withdrawals wait ${delayWords(value)}`;
    case "SetRuleDelay": return `Looser rules wait ${delayWords(value)}`;
    case "SetDailyLimit": return value ? `Daily limit ${sol(value)} SOL` : "Remove the daily limit";
    case "SetLockedUntil": return value ? `Lock until ${new Date(value * 1000).toLocaleDateString()}` : "End the lock";
    case "SetGuardian": return value ? `Guardian ${short(value)}` : "Remove the guardian";
    case "AddTrusted": return `Trust ${short(value)}`;
    case "RemoveTrusted": return `Stop trusting ${short(value)}`;
  }
  return kind;
}

function rowsChanges(v, asGuardian) {
  const t = now();
  return v.changes.map((c) => {
    const left = c.readyAt - t, pct = Math.min(100, Math.max(2, (1 - left / Math.max(1, v.ruleDelay)) * 100));
    const g = S.wallet && v.guardian?.equals(S.wallet);
    const acts = asGuardian
      ? (g && c.change.kind === "AddTrusted" ? `<button class="btn sm good" data-act="approve" data-id="${c.id}" ${S.busy ? "disabled" : ""}>Approve now</button>` : `<span class="small muted">Guardians can't speed this up.</span>`)
      : `<button class="btn sm" data-act="cancel-c" data-id="${c.id}" ${S.busy ? "disabled" : ""}>Cancel change</button>${left <= 0 ? `<button class="btn sm" data-act="apply" data-id="${c.id}" ${S.busy ? "disabled" : ""}>Apply</button>` : ""}`;
    return `<div class="row"><div class="row-top"><b style="font-size:15px">${esc(changeWords(c.change))}</b><span class="count">${dur(left)}</span></div><div class="bar"><i style="width:${pct}%"></i></div><div class="row-acts">${acts}</div></div>`;
  }).join("");
}

function vaultCards(v, asGuardian) {
  const t = now(), locked = v.lockedUntil && t < v.lockedUntil, queued = v.balance - v.available;
  const changes = rowsChanges(v, asGuardian);
  return `<div class="layout"><div class="col-main">
    <section class="card hero o-hero">
      <div class="kicker">${asGuardian ? `Vault of ${short(v.owner)}` : "In your vault"}</div>
      <div class="bal">${sol(v.balance)}<small>SOL</small></div>
      <div class="bal-sub">${sol(v.available)} SOL available${queued ? ` · ${sol(queued)} SOL waiting to leave` : ""}${asGuardian ? "" : ` · wallet ${sol(S.walletSol)} SOL`}</div>
      <div class="chips">
        <span class="chip">Withdrawals wait ${delayWords(v.withdrawDelay)}</span>
        ${locked ? `<span class="chip lock">Locked until ${new Date(v.lockedUntil * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>` : ""}
        ${v.guardian ? `<span class="chip good">Guardian ${short(v.guardian)}</span>` : ""}
        <a class="chip" href="${explorer("address", v.address.toBase58())}" target="_blank" rel="noopener">On-chain ↗</a>
      </div>
      ${asGuardian ? `<p class="small muted" style="margin:16px 0 0">${S.wallet && v.guardian?.equals(S.wallet) ? "You're this vault's guardian: you can approve an emergency release or a new trusted address. You can never start a withdrawal or choose where money goes." : "Your wallet isn't this vault's guardian, so you can only watch."}</p>`
        : `<div class="actions"><button class="btn" data-act="deposit">Deposit</button><button class="btn" data-act="withdraw">Withdraw</button><button class="btn primary" data-act="send">Send to trusted</button></div>`}
    </section>
    <section class="card o-wait"><div class="card-h"><h2>Waiting to leave</h2><span class="small muted">${asGuardian ? "" : "cancel any time"}</span></div><div class="rows">${rowsWithdrawals(v, asGuardian)}</div></section>
    ${changes ? `<section class="card o-changes"><div class="card-h"><h2>Rule changes waiting</h2><span class="small muted">looser rules wait ${delayWords(v.ruleDelay)}</span></div><div class="rows">${changes}</div></section>` : ""}
    </div><div class="col-side">
    <section class="card o-rules"><div class="card-h"><h2>Rules</h2>${asGuardian ? "" : `<button class="btn sm" data-act="rules">Change rules</button>`}</div>
      <div class="rules">
        <div class="rule"><small>Withdrawals wait</small><b>${delayWords(v.withdrawDelay)}</b></div>
        <div class="rule"><small>Looser rules wait</small><b>${delayWords(v.ruleDelay)}</b></div>
        <div class="rule"><small>Daily limit</small><b>${v.dailyLimit ? sol(v.dailyLimit) + " SOL" : "None"}</b></div>
        <div class="rule"><small>Lock</small><b>${locked ? "Until " + new Date(v.lockedUntil * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "None"}</b></div>
      </div></section>
    <section class="card o-trusted"><div class="card-h"><h2>Trusted addresses</h2>${asGuardian ? "" : `<button class="btn sm" data-act="trust">Add</button>`}</div>
      ${v.trusted.length ? `<div class="chips" style="margin:0">${v.trusted.map((k) => `<a class="chip good" href="${explorer("address", k.toBase58())}" target="_blank" rel="noopener">${short(k)}</a>`).join("")}</div>` : `<div class="empty">None yet. Money sent here arrives instantly, so adding one takes time.</div>`}</section>
    ${asGuardian ? "" : `<section class="card o-log"><div class="card-h"><h2>Activity</h2></div>${readLog().length ? `<ul class="log">${readLog().map((l) => `<li><time>${new Date(l.at * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time><span>${esc(l.text)} · <a href="${explorer("tx", l.sig)}" target="_blank" rel="noopener">tx</a></span></li>`).join("")}</ul>` : `<div class="empty">Your transactions from this browser show up here.</div>`}</section>`}
    </div></div>`;
}

function renderVault(app, v) {
  app.innerHTML = header() + (S.err ? `<div class="notice">${esc(S.err)}</div>` : "") + vaultCards(v, false) + `<p class="foot">Program <a href="${explorer("address", CONFIG.programId)}" target="_blank" rel="noopener">${short(CONFIG.programId)}</a> on devnet · <a href="/">Ecrin</a></p>`;
}

function renderGuardian(app) {
  app.innerHTML = header() + `<section class="card"><div class="card-h"><h2>Look up a vault you guard</h2></div>
    <div class="lookup"><input id="watch" class="input" placeholder="The vault owner's wallet address" value="${esc(S.watchOwner)}" spellcheck="false" autocomplete="off"/><button class="btn primary" data-act="watch">Look up</button></div>
    <p class="small muted" style="margin:10px 0 0">Guardians can approve an emergency release of a withdrawal the owner requested, or a new trusted address the owner proposed. Nothing else.</p></section>`
    + (S.watchOwner ? (S.watched === undefined ? `<section class="card"><p class="muted">Reading…</p></section>` : S.watched === null ? `<section class="card"><div class="empty">No Ecrin vault for that wallet.</div></section>` : vaultCards(S.watched, true)) : "");
}

// ------------------------------------------------------------------ sheets

function sheet(html, onSubmit) {
  const d = $("#sheet"), f = $("#sheet-form");
  f.innerHTML = html + `<div class="acts"><button class="btn" value="cancel" formnovalidate>Close</button><button class="btn primary" value="ok">Confirm</button></div>`;
  f.onsubmit = async (e) => { if (e.submitter?.value !== "ok") return; e.preventDefault(); if ((await onSubmit(new FormData(f))) !== false) d.close(); };
  d.showModal(); f.querySelector("input,select")?.focus();
}
const lamportsOf = (fd) => Math.round(Number(fd.get("amount")) * LAMPORTS);
const amount = (v = "0.1") => `<label class="field">Amount (SOL)<input name="amount" type="number" min="0.0001" step="0.0001" inputmode="decimal" required value="${v}"/></label>`;
const keyOf = (s) => { try { return new web3.PublicKey(String(s).trim()); } catch (_) { return null; } };

const actions = {
  connect: (el) => connect(providers()[Number(el.dataset.i)][1]),
  disconnect: () => { if (confirm("Disconnect your wallet?")) disconnect(); },
  view: (el) => { S.view = el.dataset.v; render(); },
  pick: (el) => { S.pick = el.dataset.k; render(); },
  create: async () => {
    const gRaw = $("#g-addr")?.value.trim(), guardian = gRaw ? keyOf(gRaw) : null;
    if (gRaw && !guardian) return toast("That guardian address isn't valid", "err");
    if (guardian?.equals(S.wallet)) return toast("Your guardian must be someone else's wallet", "err");
    let preset;
    if (S.pick === "gentle") { if (guardian) toast("Gentle has no guardian; add one later as a stricter rule"); preset = { kind: "gentle" }; }
    else if (S.pick === "strong") preset = { kind: "strong", guardian };
    else {
      const d = $("#lock-date")?.value; if (!guardian) return toast("Locked needs a guardian for emergencies", "err");
      const until = d ? Math.floor(new Date(d + "T00:00:00").getTime() / 1000) : 0;
      if (!(until > now() + HOUR)) return toast("Pick a lock date in the future", "err");
      preset = { kind: "locked", until, guardian };
    }
    await send(`Created a ${S.pick} vault`, client.build.initialize(S.wallet, preset));
  },
  deposit: () => sheet(`<h3>Deposit</h3>${amount("1")}<p class="note">Wallet: ${sol(S.walletSol)} SOL. Deposits go straight in.</p>`, (fd) => send(`Deposited ${sol(lamportsOf(fd))} SOL`, client.build.deposit(S.wallet, lamportsOf(fd)))),
  withdraw: () => sheet(`<h3>Withdraw</h3>${amount()}<label class="field">To address<input name="dest" placeholder="Where it should go" required spellcheck="false" autocomplete="off" value="${S.wallet.toBase58()}"/></label><p class="note">This waits ${delayWords(S.vault.withdrawDelay)}${S.vault.lockedUntil && now() < S.vault.lockedUntil ? " and until the lock ends" : ""}. You can cancel any time.</p>`, async (fd) => {
    const dest = keyOf(fd.get("dest")); if (!dest) { toast("That address isn't valid", "err"); return false; }
    return send(`Asked to withdraw ${sol(lamportsOf(fd))} SOL`, client.build.requestWithdrawal(S.wallet, dest, lamportsOf(fd)));
  }),
  send: () => {
    if (!S.vault.trusted.length) return toast("Add a trusted address first", "err");
    sheet(`<h3>Send to a trusted address</h3>${amount()}<label class="field">To<select name="dest">${S.vault.trusted.map((k) => `<option value="${k.toBase58()}">${short(k)}</option>`).join("")}</select></label><p class="note">Arrives instantly${S.vault.dailyLimit ? `, up to ${sol(S.vault.dailyLimit)} SOL a day` : ""}.</p>`,
      (fd) => send(`Sent ${sol(lamportsOf(fd))} SOL to a trusted address`, client.build.sendToTrusted(S.wallet, new web3.PublicKey(fd.get("dest")), lamportsOf(fd))));
  },
  trust: () => sheet(`<h3>Trust an address</h3><label class="field">Address<input name="addr" required placeholder="Your bank off-ramp, your rent…" spellcheck="false" autocomplete="off"/></label><p class="note">Money sent here will arrive instantly, so trusting it waits ${delayWords(S.vault.ruleDelay)}${S.vault.guardian ? ", unless your guardian approves it sooner" : ""}.</p>`, async (fd) => {
    const a = keyOf(fd.get("addr")); if (!a) { toast("That address isn't valid", "err"); return false; }
    return send("Asked to trust an address", client.build.proposeChange(S.wallet, { kind: "AddTrusted", value: a }));
  }),
  rules: () => {
    const v = S.vault;
    sheet(`<h3>Change a rule</h3><label class="field">Rule<select name="rule">
      <option value="d24">Withdrawals wait 24 h</option><option value="d72">Withdrawals wait 72 h</option><option value="d168">Withdrawals wait 7 days</option>
      <option value="l1">Daily limit 1 SOL</option><option value="l5">Daily limit 5 SOL</option><option value="l0">No daily limit</option>
      <option value="k30">Lock for 30 days</option>${v.lockedUntil ? `<option value="k0">End the lock</option>` : ""}${v.guardian ? `<option value="g0">Remove the guardian</option>` : ""}
    </select></label><label class="field">New guardian (optional)<input name="g" placeholder="Set a guardian's address instead" spellcheck="false" autocomplete="off"/></label>
    <p class="note">Stricter rules apply at once. Looser rules wait ${delayWords(v.ruleDelay)}.</p>`, async (fd) => {
      const g = String(fd.get("g") || "").trim();
      let change;
      if (g) { const k = keyOf(g); if (!k || k.equals(S.wallet)) { toast("Pick someone else's valid address", "err"); return false; } change = { kind: "SetGuardian", value: k }; }
      else {
        const r = String(fd.get("rule"));
        change = r.startsWith("d") ? { kind: "SetWithdrawDelay", value: Number(r.slice(1)) * HOUR }
          : r.startsWith("l") ? { kind: "SetDailyLimit", value: r === "l0" ? null : Number(r.slice(1)) * LAMPORTS }
          : r.startsWith("k") ? { kind: "SetLockedUntil", value: r === "k0" ? null : now() + 30 * DAY }
          : { kind: "SetGuardian", value: null };
      }
      return send(`Changed a rule: ${changeWords(change)}`, client.build.proposeChange(S.wallet, change));
    });
  },
  "cancel-w": (el) => send("Cancelled a withdrawal. That's a win.", client.build.cancelWithdrawal(S.wallet, Number(el.dataset.id))),
  run: (el) => send("Sent a withdrawal", client.build.executeWithdrawal(S.wallet, S.wallet, Number(el.dataset.id), new web3.PublicKey(el.dataset.dest))),
  "cancel-c": (el) => send("Cancelled a rule change", client.build.cancelChange(S.wallet, Number(el.dataset.id))),
  apply: (el) => send("Applied a rule change", client.build.applyChange(S.wallet, S.wallet, Number(el.dataset.id))),
  watch: async () => {
    const k = keyOf($("#watch")?.value); if (!k) return toast("That address isn't valid", "err");
    S.watchOwner = k.toBase58(); S.watched = undefined; render();
    S.watched = await client.fetchVault(k).catch(() => null); render();
  },
  release: (el) => send("Approved an emergency release", client.build.guardianRelease(S.wallet, new web3.PublicKey(S.watchOwner), Number(el.dataset.id), new web3.PublicKey(el.dataset.dest))),
  approve: (el) => send("Approved a trusted address", client.build.guardianApproveChange(S.wallet, new web3.PublicKey(S.watchOwner), Number(el.dataset.id))),
};

document.addEventListener("click", (e) => { const el = e.target.closest("[data-act]"); if (!el || el.disabled) return; actions[el.dataset.act]?.(el); });
// Live countdowns between refreshes.
setInterval(() => document.querySelectorAll(".count[data-ready]").forEach((n) => { const left = Number(n.dataset.ready) - now(); if (left > 0) n.textContent = dur(left); }), 15000);
setInterval(() => { if (S.wallet && !S.busy && document.visibilityState === "visible") refresh(); }, 30000);

render();
// Reconnect silently if this site was trusted before.
try {
  if (localStorage.getItem("ecrin-wallet")) {
    const p = providers()[0]?.[1];
    p?.connect?.({ onlyIfTrusted: true }).then((r) => { if (r?.publicKey || p.publicKey) connect(p); }).catch(() => {});
  }
} catch (_) {}
