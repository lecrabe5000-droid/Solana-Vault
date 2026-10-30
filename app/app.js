// Ecrin demo: the real rules (vault.js) with a fake wallet, a fake guardian and a demo clock you can
// fast-forward. Everything is kept in this browser's localStorage; no network, no blockchain.
import { Vault, Policy, VaultError, HOUR, DAY } from "./vault.js";

const KEY = "cooldown-demo-v1";
const OWNER = "you", GUARDIAN = "alex";
const UNIT = 1000; // 1 SOL = 1000 units in the rules
const PLACES = { bank: "My bank off-ramp", rent: "Landlord (rent)", unknown: "Unknown address" };
const MESSAGES = {
  NotOwner: "Only the vault owner can do that.", NotGuardian: "Only the guardian can do that.", NoGuardian: "This vault has no guardian.",
  ZeroAmount: "Enter an amount above zero.", InsufficientFunds: "Not enough funds that aren't already queued.",
  NotTrusted: "That address isn't trusted yet.", Locked: "The vault is locked until its date.", TooEarly: "Not yet: the waiting time hasn't passed.",
  DailyLimit: "That's over today's limit.", NotFound: "That item is gone.", TooManyPending: "Too many things are already waiting.",
  TooManyTrusted: "You can trust up to 8 addresses.", InvalidValue: "That value isn't allowed.",
};

let S = load();
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sol = (u) => (u / UNIT).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const place = (d) => PLACES[d] || (d.length > 14 ? d.slice(0, 5) + "…" + d.slice(-4) : d);
const when = (t) => new Date(t * 1000).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dur = (s) => {
  if (s <= 0) return "ready";
  const d = Math.floor(s / DAY), h = Math.floor((s % DAY) / HOUR), m = Math.floor((s % HOUR) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
};
const delayWords = (s) => (s % DAY === 0 ? `${s / DAY} day${s === DAY ? "" : "s"}` : `${s / HOUR} h`);

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw?.v) return { ...raw, v: Vault.from(raw.v) };
  } catch (_) {}
  return null;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify({ ...S, v: S.v })); } catch (_) {} }
function log(text) { S.log.unshift({ at: S.now, text }); S.log = S.log.slice(0, 40); }

let toastTimer;
function toast(text, kind = "") {
  const t = $("#toast"); t.textContent = text; t.className = "toast " + kind; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3600);
}
function attempt(fn) {
  try { const r = fn(); save(); render(); return r; }
  catch (e) { if (e instanceof VaultError) { toast(MESSAGES[e.code] || e.code, "err"); return null; } throw e; }
}

// ------------------------------------------------------------------ onboarding

let pick = "strong", withGuardian = true;
function renderIntro() {
  const presets = [
    ["gentle", "Gentle", "Withdrawals wait 24 h. Loosening a rule waits 3 days."],
    ["strong", "Strong", "Withdrawals wait 72 h. Loosening a rule waits 7 days. Your guardian is notified."],
    ["locked", "Locked", "Nothing leaves for 30 days, except an emergency your guardian co-signs."],
  ];
  $("#app").innerHTML = `
    <section class="intro">
      ${logo(44)}
      <h1 style="margin-top:18px">Where your crypto <span>is kept.</span></h1>
      <p>Ecrin is a Solana vault with a built-in cooldown. Every way out takes time, so no impulse, scam or bad night can empty it, and you can cancel any time.</p>
    </section>
    <div class="presets" role="radiogroup" aria-label="Protection level">
      ${presets.map(([k, n, d]) => `<button type="button" class="preset" data-act="pick" data-k="${k}" aria-pressed="${pick === k}"><i class="dot"></i><b>${n}</b><span>${d}</span></button>`).join("")}
    </div>
    <label class="toggle"><input type="checkbox" id="g" ${withGuardian || pick === "locked" ? "checked" : ""} ${pick === "locked" ? "disabled" : ""}/> Add a guardian (Alex, a friend who gets notified and can approve an emergency)</label>
    <button class="btn primary" style="width:100%;height:48px" data-act="start">Start the demo with 10 SOL</button>
    <p class="foot">A demo with pretend money. The rules are the same ones the Solana program enforces.</p>`;
}

function start() {
  const now = Math.floor(Date.now() / 1000 / HOUR) * HOUR;
  const g = pick === "locked" || withGuardian ? GUARDIAN : null;
  const policy = pick === "gentle" ? { ...Policy.gentle(), guardian: g } : pick === "strong" ? Policy.strong(g) : Policy.locked(now + 30 * DAY, GUARDIAN);
  const v = new Vault(OWNER, policy);
  v.deposit(10 * UNIT);
  S = { v, now, role: "owner", preset: pick, log: [], wins: 0, meta: {} };
  log(`Vault created with the ${pick} preset and 10 SOL`);
  save(); render();
}

// ------------------------------------------------------------------ main view

function logo(size = 26) {
  // Ecrin mark: a jewel case (rounded frame) holding a gem.
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg${size}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9945FF"/><stop offset="1" stop-color="#14F195"/></linearGradient></defs><rect x="3" y="3" width="26" height="26" rx="8" fill="none" stroke="url(#lg${size})" stroke-width="2.2"/><path d="M16 9.5l5.5 6.5L16 22.5 10.5 16z" fill="url(#lg${size})"/></svg>`;
}

function render() {
  if (!S) return renderIntro();
  const v = S.v, p = v.policy, now = S.now, guardian = S.role === "guardian";
  const queued = v.balance - v.available(), locked = p.lockedUntil && now < p.lockedUntil;
  const presetName = { gentle: "Gentle", strong: "Strong", locked: "Locked" }[S.preset] || "Custom";

  const withdrawals = v.withdrawals.map((w) => {
    const start = w.requestedAt ?? w.readyAt - p.withdrawDelay, left = w.readyAt - now, pct = Math.min(100, Math.max(2, ((now - start) / Math.max(1, w.readyAt - start)) * 100));
    const ready = left <= 0 && !locked;
    return `<div class="row">
      <div class="row-top"><b>${sol(w.amount)} SOL</b><span class="count">${ready ? "Ready" : locked && left <= 0 ? "Locked" : dur(left)}</span></div>
      <div class="small muted">to ${esc(place(w.dest))} · unlocks ${when(Math.max(w.readyAt, locked ? p.lockedUntil : 0))}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="row-acts">${guardian
        ? `<button class="btn sm good" data-act="release" data-id="${w.id}">Approve emergency release</button>`
        : `<button class="btn sm" data-act="cancel-w" data-id="${w.id}">Cancel, keep it in the vault</button>${ready ? `<button class="btn sm danger" data-act="run" data-id="${w.id}">Send it now</button>` : ""}`}</div>
    </div>`;
  }).join("") || `<div class="empty">Nothing waiting to leave.</div>`;

  const changes = v.changes.map((c) => {
    const start = S.meta?.[c.id] ?? c.readyAt - p.ruleDelay, left = c.readyAt - now, pct = Math.min(100, Math.max(2, ((now - start) / Math.max(1, c.readyAt - start)) * 100));
    return `<div class="row">
      <div class="row-top"><b style="font-size:14.5px">${esc(changeWords(c.change))}</b><span class="count">${dur(left)}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="row-acts">${guardian
        ? (c.change.kind === "AddTrusted" ? `<button class="btn sm good" data-act="approve" data-id="${c.id}">Approve now</button>` : `<span class="small muted">Guardians can't speed this up.</span>`)
        : `<button class="btn sm" data-act="cancel-c" data-id="${c.id}">Cancel change</button>${left <= 0 ? `<button class="btn sm" data-act="apply" data-id="${c.id}">Apply</button>` : ""}`}</div>
    </div>`;
  }).join("");

  $("#app").innerHTML = `
    <header class="top">
      <div class="brand">${logo()}Ecrin</div><div class="spacer"></div>
      <div class="seg" role="group" aria-label="View as">
        <button data-act="role" data-r="owner" aria-pressed="${!guardian}">You</button>
        <button data-act="role" data-r="guardian" aria-pressed="${guardian}" ${p.guardian ? "" : "disabled title='This vault has no guardian'"}>Guardian</button>
      </div>
    </header>

    <section class="card clock">
      <span class="small muted">Demo time</span><b>${when(now)}</b>
      <div class="ff"><button class="btn sm" data-act="ff" data-s="${HOUR}">+1h</button><button class="btn sm" data-act="ff" data-s="${DAY}">+1d</button><button class="btn sm" data-act="ff" data-s="${3 * DAY}">+3d</button><button class="btn sm" data-act="ff" data-s="${7 * DAY}">+7d</button></div>
    </section>

    <section class="card hero">
      <div class="kicker">${guardian ? "Alex's view · guardian" : "In your vault"}</div>
      <div class="bal">${sol(v.balance)}<small>SOL</small></div>
      <div class="bal-sub">${sol(v.available())} SOL available${queued ? ` · ${sol(queued)} SOL waiting to leave` : ""}</div>
      <div class="chips">
        <span class="chip">${presetName}</span>
        <span class="chip">Withdrawals wait ${delayWords(p.withdrawDelay)}</span>
        ${locked ? `<span class="chip lock">Locked until ${new Date(p.lockedUntil * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>` : ""}
        ${p.guardian ? `<span class="chip good">Guardian: Alex</span>` : ""}
        ${S.wins ? `<span class="chip good">${S.wins} urge${S.wins === 1 ? "" : "s"} beaten</span>` : ""}
      </div>
      ${guardian ? `<p class="small muted" style="margin:14px 0 0">As a guardian you can approve an emergency release or a new trusted address. You can never start a withdrawal or choose where money goes.</p>`
        : `<div class="actions"><button class="btn" data-act="deposit">Deposit</button><button class="btn" data-act="withdraw">Withdraw</button><button class="btn primary" data-act="send">Send to trusted</button></div>`}
    </section>

    <section class="card"><div class="card-h"><h2>Waiting to leave</h2><span class="small muted">cancel any time</span></div><div class="rows">${withdrawals}</div></section>

    ${changes ? `<section class="card"><div class="card-h"><h2>Rule changes waiting</h2><span class="small muted">looser rules wait ${delayWords(p.ruleDelay)}</span></div><div class="rows">${changes}</div></section>` : ""}

    <section class="card">
      <div class="card-h"><h2>Your rules</h2>${guardian ? "" : `<button class="btn sm" data-act="rules">Change rules</button>`}</div>
      <div class="rules">
        <div class="rule"><small>Withdrawals wait</small><b>${delayWords(p.withdrawDelay)}</b></div>
        <div class="rule"><small>Looser rules wait</small><b>${delayWords(p.ruleDelay)}</b></div>
        <div class="rule"><small>Daily limit</small><b>${p.dailyLimit ? sol(p.dailyLimit) + " SOL" : "None"}</b></div>
        <div class="rule"><small>Lock</small><b>${locked ? "Until " + new Date(p.lockedUntil * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "None"}</b></div>
      </div>
    </section>

    <section class="card">
      <div class="card-h"><h2>Trusted addresses</h2>${guardian ? "" : `<button class="btn sm" data-act="trust">Add</button>`}</div>
      ${v.trusted.length ? `<div class="chips" style="margin:0">${v.trusted.map((t) => `<span class="chip good">${esc(place(t))}</span>`).join("")}</div>` : `<div class="empty">None yet. Money sent here arrives instantly, so adding one takes time.</div>`}
    </section>

    <section class="card"><div class="card-h"><h2>Activity</h2></div>
      <ul class="log">${S.log.map((l) => `<li><time>${new Date(l.at * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time><span>${esc(l.text)}</span></li>`).join("")}</ul>
    </section>

    <p class="foot">Open source · <a href="https://github.com/lecrabe5000-droid/Solana-Vault" target="_blank" rel="noopener">GitHub</a> · <button class="link" data-act="reset">Reset demo</button></p>`;
}

function changeWords({ kind, value }) {
  switch (kind) {
    case "SetWithdrawDelay": return `Withdrawals wait ${delayWords(value)}`;
    case "SetRuleDelay": return `Looser rules wait ${delayWords(value)}`;
    case "SetDailyLimit": return value ? `Daily limit ${sol(value)} SOL` : "Remove the daily limit";
    case "SetLockedUntil": return value ? `Lock until ${new Date(value * 1000).toLocaleDateString()}` : "End the lock";
    case "SetGuardian": return value ? "Add Alex as guardian" : "Remove the guardian";
    case "AddTrusted": return `Trust ${place(value)}`;
    case "RemoveTrusted": return `Stop trusting ${place(value)}`;
  }
  return kind;
}

// ------------------------------------------------------------------ sheets

function sheet(html, onSubmit) {
  const d = $("#sheet"), f = $("#sheet-form");
  f.innerHTML = html + `<div class="acts"><button class="btn" value="cancel" formnovalidate>Close</button><button class="btn primary" value="ok">Confirm</button></div>`;
  f.onsubmit = (e) => { if (e.submitter?.value === "ok") { e.preventDefault(); if (onSubmit(new FormData(f)) !== false) d.close(); } };
  d.showModal(); f.querySelector("input,select")?.focus();
}
const amountField = `<label class="field">Amount (SOL)<input name="amount" type="number" min="0.001" step="0.001" inputmode="decimal" required value="1"/></label>`;
const units = (fd) => Math.round(Number(fd.get("amount")) * UNIT);
const destField = (opts) => `<label class="field">To<select name="dest">${opts.map((o) => `<option value="${esc(o)}">${esc(place(o))}</option>`).join("")}<option value="__custom">Another address…</option></select></label><label class="field">Custom address<input name="custom" placeholder="Paste an address"/></label>`;
const dest = (fd) => (fd.get("dest") === "__custom" ? String(fd.get("custom") || "").trim() : String(fd.get("dest")));

const actions = {
  pick: (el) => { pick = el.dataset.k; renderIntro(); },
  start,
  role: (el) => { S.role = el.dataset.r; save(); render(); },
  ff: (el) => { S.now += Number(el.dataset.s); save(); render(); toast(`Time moved forward ${dur(Number(el.dataset.s))}`); },
  deposit: () => sheet(`<h3>Deposit</h3>${amountField}<p class="note">Deposits always go straight in.</p>`, (fd) => {
    const r = attempt(() => S.v.deposit(units(fd))); if (r === null) return false;
    log(`Deposited ${sol(units(fd))} SOL`); save(); render();
  }),
  withdraw: () => sheet(`<h3>Withdraw</h3>${amountField}${destField(["unknown", "bank", "rent"])}<p class="note">This waits ${delayWords(S.v.policy.withdrawDelay)}${S.v.policy.lockedUntil && S.now < S.v.policy.lockedUntil ? " and until the lock ends" : ""}. You can cancel it any time${S.v.policy.guardian ? ", and Alex will be told" : ""}.</p>`, (fd) => {
    const to = dest(fd); if (!to) return toast("Pick where it goes", "err"), false;
    const r = attempt(() => S.v.requestWithdrawal(OWNER, to, units(fd), S.now)); if (!r) return false;
    log(`Asked to withdraw ${sol(units(fd))} SOL to ${place(to)}, unlocks ${when(r.readyAt)}`); save(); render();
    toast(`Queued. It unlocks in ${dur(r.readyAt - S.now)}.`);
  }),
  send: () => {
    if (!S.v.trusted.length) return toast("Add a trusted address first", "err");
    sheet(`<h3>Send to a trusted address</h3>${amountField}<label class="field">To<select name="dest">${S.v.trusted.map((t) => `<option value="${esc(t)}">${esc(place(t))}</option>`).join("")}</select></label><p class="note">Arrives instantly${S.v.policy.dailyLimit ? `, up to ${sol(S.v.policy.dailyLimit)} SOL a day` : ""}.</p>`, (fd) => {
      const to = String(fd.get("dest")); const r = attempt(() => S.v.sendToTrusted(OWNER, to, units(fd), S.now)); if (!r) return false;
      log(`Sent ${sol(r.amount)} SOL to ${place(to)}`); save(); render(); toast(`Sent ${sol(r.amount)} SOL`);
    });
  },
  trust: () => sheet(`<h3>Trust an address</h3>${destField(["bank", "rent"])}<p class="note">Money sent to trusted addresses arrives instantly, so trusting one waits ${delayWords(S.v.policy.ruleDelay)}${S.v.policy.guardian ? ", unless Alex approves it sooner" : ""}.</p>`, (fd) => {
    const a = dest(fd); if (!a) return toast("Pick an address", "err"), false;
    propose({ kind: "AddTrusted", value: a });
  }),
  rules: () => {
    const p = S.v.policy;
    sheet(`<h3>Change a rule</h3>
      <label class="field">Rule<select name="rule">
        <option value="d24">Withdrawals wait 24 h</option><option value="d72">Withdrawals wait 72 h</option><option value="d168">Withdrawals wait 7 days</option>
        <option value="l1">Daily limit 1 SOL</option><option value="l5">Daily limit 5 SOL</option><option value="l0">No daily limit</option>
        <option value="k30">Lock for 30 days</option><option value="k0">End the lock</option>
        ${p.guardian ? `<option value="g0">Remove guardian</option>` : `<option value="g1">Add Alex as guardian</option>`}
      </select></label><p class="note">Stricter rules apply at once. Looser rules wait ${delayWords(p.ruleDelay)}.</p>`, (fd) => {
      const r = String(fd.get("rule"));
      const change = r.startsWith("d") ? { kind: "SetWithdrawDelay", value: Number(r.slice(1)) * HOUR }
        : r.startsWith("l") ? { kind: "SetDailyLimit", value: r === "l0" ? null : Number(r.slice(1)) * UNIT }
        : r.startsWith("k") ? { kind: "SetLockedUntil", value: r === "k0" ? null : S.now + 30 * DAY }
        : { kind: "SetGuardian", value: r === "g1" ? GUARDIAN : null };
      propose(change);
    });
  },
  "cancel-w": (el) => {
    const id = Number(el.dataset.id), w = S.v.withdrawals.find((x) => x.id === id);
    if (attempt(() => S.v.cancelWithdrawal(OWNER, id))) { S.wins = (S.wins || 0) + 1; log(`Cancelled the ${sol(w.amount)} SOL withdrawal`); save(); render(); toast("Cancelled. That's a win: it stays yours.", "win"); }
  },
  run: (el) => { const r = attempt(() => S.v.executeWithdrawal(Number(el.dataset.id), S.now)); if (r) { log(`Sent ${sol(r.amount)} SOL to ${place(r.dest)}`); save(); render(); } },
  release: (el) => { const r = attempt(() => S.v.guardianRelease(GUARDIAN, Number(el.dataset.id), S.now)); if (r) { log(`Alex approved an emergency release: ${sol(r.amount)} SOL to ${place(r.dest)}`); save(); render(); toast("Released"); } },
  "cancel-c": (el) => { if (attempt(() => S.v.cancelChange(OWNER, Number(el.dataset.id)))) { log("Cancelled a rule change"); save(); render(); } },
  apply: (el) => { const c = S.v.changes.find((x) => x.id === Number(el.dataset.id)); if (attempt(() => S.v.applyChange(c.id, S.now))) { log(`Applied: ${changeWords(c.change)}`); save(); render(); } },
  approve: (el) => { const c = S.v.changes.find((x) => x.id === Number(el.dataset.id)); if (attempt(() => S.v.guardianApproveChange(GUARDIAN, c.id))) { log(`Alex approved: ${changeWords(c.change)}`); save(); render(); toast("Approved"); } },
  reset: () => { if (confirm("Start the demo again?")) { localStorage.removeItem(KEY); S = null; render(); } },
};

function propose(change) {
  const r = attempt(() => S.v.proposeChange(OWNER, change, S.now));
  if (!r) return false;
  if (r.type === "ChangeQueued") { S.meta = { ...(S.meta || {}), [r.id]: S.now }; log(`Asked: ${changeWords(change)} (applies ${when(r.readyAt)})`); toast(`Looser rule: it applies in ${dur(r.readyAt - S.now)}.`); }
  else { S.preset = "custom"; log(`Applied now: ${changeWords(change)}`); toast("Stricter rule: applied now."); }
  save(); render();
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]"); if (!el || el.disabled) return;
  actions[el.dataset.act]?.(el);
});
document.addEventListener("change", (e) => { if (e.target.id === "g") withGuardian = e.target.checked; });
render();
