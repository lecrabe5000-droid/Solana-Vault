// Ecrin Wallet popup. Two accounts on every network: Chequing (the wallet: spend instantly) and Savings (the
// Ecrin vault: anything leaving waits its delay and can be cancelled). One recovery phrase, encrypted on disk;
// while unlocked it sits only in the browser's memory (chrome.storage.session) and is wiped by auto-lock.
import * as web3 from "@solana/web3.js";
import { ethers } from "ethers";
import qrcode from "qrcode-generator";
import { newPhrase, isPhrase, normalize, seal, open, deriveAccount, strength, WORDS } from "./keyring.js";
import { NETS, BASE, USDC_BASE, engine } from "./chains.js";

const VERSION = chrome.runtime.getManifest().version;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const local = { get: (k) => chrome.storage.local.get(k), set: (o) => chrome.storage.local.set(o), remove: (k) => chrome.storage.local.remove(k) };
const session = { get: (k) => chrome.storage.session.get(k), set: (o) => chrome.storage.session.set(o), clear: () => chrome.storage.session.clear() };
const short = (a) => (a ? `${String(a).slice(0, 4)}…${String(a).slice(-4)}` : "");
const now = () => Math.floor(Date.now() / 1000);

const S = { screen: "loading", net: "sol", theme: "dark", autolock: 15, panel: null, prices: {}, bal: null, vault: undefined, busy: false, hide: false, range: "7", series: {}, nums: { face: "serif", weight: "500", cents: "dim" }, tab: "tokens" };
const NUM_FACES = [["display", "Display"], ["sans", "Sans"], ["serif", "Serif"], ["mono", "Mono"]];
const NUM_WEIGHTS = [["400", "Light"], ["500", "Regular"], ["600", "Bold"]];
const NUM_CENTS = [["dim", "Dimmed"], ["full", "Full"], ["hide", "Hidden"]];
/** The numbers' look, applied to the whole wallet through attributes on <html>. */
function applyNums() { const r = document.documentElement; r.dataset.numFace = S.nums.face; r.dataset.numWeight = S.nums.weight; r.dataset.cents = S.nums.cents; }

// ------------------------------------------------------------------ icons and coins

const I = {
  send: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  recv: '<svg viewBox="0 0 24 24"><path d="M12 4v15M5.5 12.5L12 19l6.5-6.5"/></svg>',
  protect: '<svg viewBox="0 0 24 24"><path d="M12 2.5l7.5 3v6c0 4.6-3.2 8.6-7.5 10-4.3-1.4-7.5-5.4-7.5-10v-6z"/><path d="M12 8v7M9 12l3 3 3-3"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M12 2.5l7.5 3v6c0 4.6-3.2 8.6-7.5 10-4.3-1.4-7.5-5.4-7.5-10v-6z"/><path d="M12 15V8M9 11l3-3 3 3"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 2.5l7.5 3v6c0 4.6-3.2 8.6-7.5 10-4.3-1.4-7.5-5.4-7.5-10v-6z"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M4 4l16 16M9.9 5.8A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6.3 7.6A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  paste: '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="12" height="17" rx="2.5"/><path d="M9 4h6v3H9z"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 5h5v5M19 5l-8 8M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
};
const LOGO = '<svg viewBox="0 0 32 32" class="logo"><rect x="3" y="3" width="26" height="26" rx="8" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16 9.5l5.5 6.5L16 22.5 10.5 16z" fill="currentColor"/></svg>';
const SOLP = "M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1zM64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1zM333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1z";
let gid = 0;
const COIN = {
  sol: () => { const id = "sg" + ++gid; return `<svg viewBox="0 0 398 312"><defs><linearGradient id="${id}" x1="360.9" y1="-37.5" x2="141.2" y2="383.3" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#00FFA3"/><stop offset="1" stop-color="#DC1FFF"/></linearGradient></defs><path d="${SOLP}" fill="url(#${id})"/></svg>`; },
  eth: () => '<svg viewBox="0 0 32 32"><path d="M16 4l7 11.6-7 4.2-7-4.2z" fill="#fff" opacity=".95"/><path d="M16 21.2l7-4.2-7 10-7-10z" fill="#fff" opacity=".7"/></svg>',
  base: () => '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="9" fill="#fff"/><path d="M7.4 15h12.4" stroke="#2151f5" stroke-width="2.6"/></svg>',
  arb: () => '<svg viewBox="0 0 32 32"><path d="M16 6.5l8.2 4.75v9.5L16 25.5l-8.2-4.75v-9.5z" fill="none" stroke="#9dccff" stroke-width="2"/><path d="M13.2 20.5l4.2-9.5 4 9.5" fill="none" stroke="#fff" stroke-width="2"/></svg>',
  op: () => '<svg viewBox="0 0 32 32"><text x="16" y="20.5" text-anchor="middle" font-family="Arial,sans-serif" font-weight="800" font-size="11.5" fill="#fff">OP</text></svg>',
  pol: () => '<svg viewBox="0 0 32 32"><path d="M10 12.5l4-2.3 4 2.3v4.6l-4 2.3-4-2.3zM14 17.1v4.6l4 2.3 4-2.3v-4.6l-4-2.3" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/></svg>',
  usdc: () => '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="9.5" fill="none" stroke="#fff" stroke-width="1.8"/><text x="16" y="20.3" text-anchor="middle" font-family="Arial,sans-serif" font-weight="800" font-size="12" fill="#fff">$</text></svg>',
};
const coin = (k, cls = "") => `<span class="coin c-${k} ${cls}" aria-hidden="true">${(COIN[k] || COIN.eth)()}</span>`;
const netCoin = (n = S.net) => coin(n);
const assetCoin = (a) => (a === "usdc" ? coin("usdc") : netCoin());
function avatar(addr) {
  let h = 0; for (const c of String(addr)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360, b = (a + 70 + (h >> 9) % 80) % 360;
  return `<span class="ava" style="background:conic-gradient(from ${h % 360}deg, hsl(${a} 85% 62%), hsl(${b} 90% 56%), hsl(${a} 85% 62%))"></span>`;
}

// ------------------------------------------------------------------ amounts

const A = (a) => (a === "usdc" ? { id: "usdc", unit: "USDC", base: USDC_BASE, dec: 2 } : { id: "native", unit: NETS[S.net].unit, base: BASE, dec: NETS[S.net].unit === "SOL" ? 4 : 5 });
const amt = (units, a) => { const x = A(a), v = units / x.base; return v.toLocaleString("en-US", { minimumFractionDigits: x.dec === 2 ? 2 : 0, maximumFractionDigits: x.dec }); };
const usdOf = (units, a) => (a === "usdc" ? units / USDC_BASE : S.prices[NETS[S.net].cg]?.usd != null ? (units / BASE) * S.prices[NETS[S.net].cg].usd : null);
const money = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
// Decimals dimmed; dollar cents also carry "cents" so the Numbers setting can hide them without touching coin amounts.
const fig = (str) => { const usd = String(str).trim().startsWith("$"); return esc(str).replace(/([.,]\d+)(\D*)$/, `<span class="dec${usd ? " cents" : ""}">$1</span>$2`); };
const parseAmt = (s, a) => { const v = Number(String(s).replace(/,/g, "")); return Number.isFinite(v) && v > 0 ? Math.round(v * A(a).base) : 0; };
const mask = (s) => (S.hide ? "••••" : s);

// ------------------------------------------------------------------ state

let ENG = null, ACCT = null;
function useAccount(phrase) {
  ACCT = deriveAccount(phrase, { web3, ethers });
  ENG = null;
}
async function eng() {
  if (!ENG || ENG.N.key !== S.net) {
    const { dev } = await local.get("dev");
    ENG = engine({ web3, ethers, acct: ACCT, net: S.net, dev: dev || {} });
  }
  return ENG;
}

async function boot() {
  const st = await local.get(["box", "net", "theme", "autolock", "hide", "nums", "range", "dev"]);
  if (st.nums) S.nums = { ...S.nums, ...st.nums };
  if (["1", "7", "30", "365"].includes(st.range)) S.range = st.range;
  S.mock = !!st.dev?.mockPrices;
  applyNums();
  S.net = NETS[st.net] ? st.net : "sol";
  S.theme = st.theme === "light" ? "light" : "dark";
  S.autolock = st.autolock ?? 15;
  try { chrome.runtime.connect?.({ name: "popup" }); } catch (_) {}
  S.hide = !!st.hide;
  document.documentElement.dataset.theme = S.theme;
  if (!st.box) return go("welcome");
  const ses = await session.get(["phrase", "until"]);
  if (ses.phrase && ses.until > Date.now()) { useAccount(ses.phrase); await touch(); return home(); }
  await session.clear();
  go("unlock");
}

/** Keeps the wallet unlocked while it's being used; the background locks it after the chosen idle time. */
async function touch() {
  // "Always" (0): stays unlocked while open, locks the moment the window closes (the background sees it go).
  const until = Date.now() + (S.autolock === 0 ? 12 * 3600_000 : S.autolock * 60_000);
  await session.set({ until });
  chrome.runtime.sendMessage({ type: "autolock", until }).catch(() => {});
}

async function home() {
  S.screen = "home"; await eng(); S.activity = await readActivity().catch(() => []); render();
  loadAll();
  refresh();
  loadPrices();
}

async function refresh() {
  try {
    const e = await eng();
    const [bal, vault] = await Promise.all([e.balances(), e.vault().catch((err) => (console.warn(err), null))]);
    S.bal = bal; S.vault = vault; S.err = null;
  } catch (err) { console.warn(err); S.err = `Can't reach ${NETS[S.net].name} right now. Retrying…`; setTimeout(refresh, 6000); }
  if (S.screen === "home") render();
  if (S.panel) renderPanel();
}

async function loadPrices() {
  if (S.mock) { S.prices = { solana: { usd: 172.4, usd_24h_change: 2.31 }, ethereum: { usd: 3410, usd_24h_change: -0.84 }, "polygon-ecosystem-token": { usd: 0.42, usd_24h_change: 1.2 } }; if (S.screen === "home") render(); return loadSeries(); }
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum,polygon-ecosystem-token&vs_currencies=usd&include_24hr_change=true");
    if (r.ok) { S.prices = await r.json(); if (S.screen === "home") render(); }
  } catch (_) {}
  loadSeries();
}

/** Price history for the chart, one fetch per coin and range, kept for five minutes. Fetches every coin you hold. */
async function loadSeries() {
  const cgs = [...new Set([NETS[S.net].cg, ...Object.keys(worth().coins)])];
  await Promise.all(cgs.map(loadSeriesFor));
}
async function loadSeriesFor(cg) {
  const k = `${cg}:${S.range}`, hit = S.series[k];
  if (hit && Date.now() - hit.at < 300_000) return;
  let pts = null;
  if (S.mock) {
    const n = 80, now = Date.now(), span = Number(S.range) * 86400_000; let v = 160, seed = Number(S.range) * 7 + cg.length;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    pts = Array.from({ length: n }, (_, i) => { v *= 1 + (rnd() - 0.47) * 0.035; return [now - span + (span * i) / (n - 1), v]; });
    const last = S.prices[cg]?.usd || v, f = last / pts[n - 1][1]; pts = pts.map(([t, x]) => [t, x * f]);
  } else {
    try {
      const r = await fetch(`https://api.coingecko.com/api/v3/coins/${cg}/market_chart?vs_currency=usd&days=${S.range}`);
      if (r.ok) pts = (await r.json()).prices;
    } catch (_) {}
  }
  if (pts?.length > 2) { S.series[k] = { at: Date.now(), pts }; S.drawChart = true; if (S.screen === "home" && !S.scrubbing) render(); }
}

/** Net worth across every network: what each holds in chequing and savings, priced. The current network's own
 *  reading is the freshest, so it wins over the background sweep. */
function worth() {
  const rows = (S.all || []).filter((r) => r.ok && r.k !== S.net);
  if (S.bal) rows.push({ k: S.net, b: S.bal, v: S.vault, ok: true });
  const items = [], coins = {}; let usdc = 0, chq = 0, sav = 0, leaving = 0, vaults = 0;
  for (const r of rows) {
    const N = NETS[r.k], px = S.prices[N.cg]?.usd, natC = r.b.native || 0, natS = r.v?.main?.balance || 0, uC = r.b.usdc || 0, uS = r.v?.usdc?.balance || 0;
    if (r.v) vaults++;
    leaving += (r.v?.main?.withdrawals?.length || 0) + (r.v?.usdc?.withdrawals?.length || 0);
    if (natC + natS > 0) {
      coins[N.cg] = (coins[N.cg] || 0) + (natC + natS) / BASE;
      const c = px != null ? (natC / BASE) * px : 0, v = px != null ? (natS / BASE) * px : 0; chq += c; sav += v;
      items.push({ k: r.k, a: "native", coin: r.k, cg: N.cg, unit: N.unit, name: COIN_NAME[N.unit] || N.unit, net: N.name, chq: natC / BASE, sav: natS / BASE, usd: px != null ? c + v : null, dec: N.unit === "SOL" ? 4 : 5 });
    }
    if (uC + uS > 0) {
      usdc += (uC + uS) / USDC_BASE; chq += uC / USDC_BASE; sav += uS / USDC_BASE;
      items.push({ k: r.k, a: "usdc", coin: "usdc", cg: "usdc", unit: "USDC", name: "USD Coin", net: N.name, chq: uC / USDC_BASE, sav: uS / USDC_BASE, usd: (uC + uS) / USDC_BASE, dec: 2 });
    }
  }
  items.sort((x, y) => (y.usd || 0) - (x.usd || 0));
  return { items, coins, usdc, chq, sav, total: chq + sav, leaving, vaults, ready: rows.length > 0, all: !!S.all };
}

// ------------------------------------------------------------------ screens

function go(screen, extra = {}) { Object.assign(S, { screen }, extra); render(); }

function render() {
  const root = $("#root");
  root.dataset.screen = S.screen;
  root.innerHTML = ({ loading: () => `<div class="splash">${LOGO}</div>`, welcome, createPw, createPhrase, createVerify, importPhrase, unlock, home: homeView })[S.screen]();
  const f = root.querySelector("[autofocus]"); if (f) f.focus();
  bindHolds(root);
  depth(root);
  bindChart(root);
  // The home arrives in a cascade once per unlock.
  if (S.screen === "home" && !S.entered && S.bal) { S.entered = true; root.querySelector(".home")?.classList.add("enter"); }
  // The total counts up the first time it shows, so the balance arrives rather than appears.
  const big = root.querySelector(".home .big:not(.sk)");
  if (big && !S.hide) {
    const val = Number(big.textContent.replace(/[^\d.]/g, ""));
    if (!S.counted) { S.counted = true; countUp(big, 0); }
    else if (S.prevTotal != null && val !== S.prevTotal && !S.scrubbing) countUp(big, S.prevTotal);
    S.prevTotal = val;
  }
}

/** Number roll-up: from 0 to the shown dollar total in 0.9 s, easing out. */
function countUp(el, from = 0) {
  const to = Number(el.textContent.replace(/[^\d.]/g, "")); if (!to && !from) return;
  const t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - k, 4); el.innerHTML = fig(money(from + (to - from) * e)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/** Moving along the chart shows the value at that moment in the big total, like a trading app. */
function bindChart(root) {
  const el = root.querySelector("[data-chart]"); if (!el || !S.chart) return;
  const svg = el.querySelector("svg"), big = root.querySelector(".big"), chg = root.querySelector("[data-chg]");
  const pin = el.querySelector(".ch-pin"), tip = el.querySelector(".ch-tip"), x = el.querySelector(".ch-x");
  const keep = { big: big?.innerHTML, chg: chg?.outerHTML };
  const fmtT = (ms) => new Date(ms).toLocaleString("en-US", S.range === "1" ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", ...(S.range === "365" ? { year: "numeric" } : {}) });
  const move = (e) => {
    const r = svg.getBoundingClientRect(), k = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const { c, xy, W } = S.chart, i = Math.round(k * (c.vals.length - 1)), p = xy[i];
    S.scrubbing = true; el.classList.add("scrub");
    x.setAttribute("x1", p[0]); x.setAttribute("x2", p[0]);
    pin.style.left = `${(p[0] / W) * 100}%`; pin.style.top = `${p[1]}px`;
    tip.textContent = fmtT(c.times[i]); tip.style.left = `${Math.max(14, Math.min(86, (p[0] / W) * 100))}%`;
    if (big && !S.hide) big.innerHTML = fig(money(c.vals[i]));
    const dd = c.vals[i] - c.vals[0], ch = (dd / (c.vals[0] || 1)) * 100;
    const cur = root.querySelector("[data-chg]"); if (cur) cur.outerHTML = deltaHTML(dd, ch, fmtT(c.times[i]), c.coinOnly);
  };
  const leave = () => { S.scrubbing = false; el.classList.remove("scrub"); if (big && keep.big != null) big.innerHTML = keep.big; const cur = root.querySelector("[data-chg]"); if (cur && keep.chg) cur.outerHTML = keep.chg; };
  svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move); svg.addEventListener("pointerleave", leave);
}

/** Cards that catch the light: they lean toward the pointer and a sheen follows it. */
function depth(scope) {
  scope.querySelectorAll("[data-tilt]").forEach((c) => {
    c.addEventListener("pointermove", (e) => {
      const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      c.style.setProperty("--ry", ((x - 0.5) * 10).toFixed(2) + "deg"); c.style.setProperty("--rx", ((0.5 - y) * 8).toFixed(2) + "deg");
      c.style.setProperty("--mx", (x * 100).toFixed(1) + "%"); c.style.setProperty("--my", (y * 100).toFixed(1) + "%");
    });
    c.addEventListener("pointerleave", () => { ["--rx", "--ry"].forEach((v) => c.style.setProperty(v, "0deg")); });
  });
}

function welcome() {
  return `<div class="onb">
    <div class="onb-art">${miniVault()}</div>
    <div class="onb-copy"><h1>Ecrin Wallet</h1><p>A chequing account for trading.<br/>A savings vault nobody can rush.</p></div>
    <div class="onb-acts">
      <button class="btn primary xl" data-act="start-create">Create a new wallet</button>
      <button class="btn ghost xl" data-act="start-import">I have a recovery phrase</button>
      ${globalThis.ECRIN_DEMO ? `<button class="link center" data-act="demo-quick">Skip setup: open a demo wallet ${I.arrow}</button>` : ""}
    </div>
    <p class="fine">Testnet beta · not audited · test coins only</p>
  </div>`;
}

function miniVault() {
  return `<div class="mv" data-tilt><i class="sheen"></i><svg class="mv-g" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice">${Array.from({ length: 26 }, (_, i) => `<circle cx="${330 + Math.cos(i / 2.2) * 14}" cy="${40 + Math.sin(i / 2.2) * 14}" r="${18 + i * 9}"/>`).join("")}</svg>
    <div class="mv-top"><span class="mv-mark">${LOGO}<b>ECRIN</b></span><span class="mv-lvl">Savings · 72 h</span></div>
    <div class="mv-bal"><span>Protected</span><b>12.40<small> SOL</small></b></div>
    <div class="mv-foot"><i class="dot"></i>Sealed · nothing waiting to leave</div></div>`;
}

const steps = (n) => `<div class="steps">${[1, 2, 3].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</div>`;

function createPw() {
  return `<div class="flow">
    <header class="fhead"><button class="ib" data-act="to-welcome" aria-label="Back">${I.back}</button>${steps(1)}<span></span></header>
    <h2>Create a password</h2><p class="sub">It unlocks Ecrin Wallet on this computer. It can't recover your wallet: your recovery phrase does that.</p>
    <form class="stack" data-form="pw">
      <label class="fld"><span>Password</span><input name="pw" type="password" autocomplete="new-password" autofocus minlength="8" required/></label>
      <div class="meter" data-meter><i></i><i></i><i></i><i></i></div>
      <label class="fld"><span>Repeat it</span><input name="pw2" type="password" autocomplete="new-password" required/></label>
      <p class="err" data-err></p>
      <button class="btn primary xl">Continue</button>
    </form>
  </div>`;
}

function createPhrase() {
  const words = S.phrase.split(" ");
  return `<div class="flow">
    <header class="fhead"><button class="ib" data-act="to-pw" aria-label="Back">${I.back}</button>${steps(2)}<span></span></header>
    <h2>Your recovery phrase</h2><p class="sub">These 12 words are your wallet. Write them on paper, in order. Anyone who has them can spend your chequing account at once; your savings vault still makes them wait.</p>
    <div class="phrase ${S.revealed ? "shown" : ""}">${words.map((w, i) => `<span><i>${i + 1}</i>${esc(w)}</span>`).join("")}
      ${S.revealed ? "" : `<button class="reveal" data-act="reveal">${I.eye}<b>Tap to reveal</b><small>Make sure nobody can see your screen</small></button>`}</div>
    <label class="tick"><input type="checkbox" data-tick ${S.wrote ? "checked" : ""}/><span>I wrote it down somewhere safe, offline</span></label>
    <button class="btn primary xl" data-act="to-verify" ${S.revealed && S.wrote ? "" : "disabled"}>Continue</button>
  </div>`;
}

function createVerify() {
  const words = S.phrase.split(" ");
  const q = S.quiz.find((x) => !x.ok) || null;
  return `<div class="flow">
    <header class="fhead"><button class="ib" data-act="to-phrase" aria-label="Back">${I.back}</button>${steps(3)}<span></span></header>
    <h2>Check your words</h2><p class="sub">Pick the right word for each number. This proves your copy is complete.</p>
    <div class="quiz">${S.quiz.map((x) => `<span class="qz ${x.ok ? "ok" : x === q ? "now" : ""}"><i>#${x.i + 1}</i>${x.ok ? esc(words[x.i]) : "—"}</span>`).join("")}</div>
    ${q ? `<div class="choices">${q.opts.map((w) => `<button class="choice" data-act="pick" data-w="${esc(w)}">${esc(w)}</button>`).join("")}</div>` : `<div class="allset">${I.check}<b>All correct</b></div>`}
    <p class="err" data-err>${S.quizErr ? "Not that one. Check your paper." : ""}</p>
    <button class="btn primary xl" data-act="finish-create" ${q ? "disabled" : ""}>${S.busy ? "Securing…" : "Open my wallet"}</button>
  </div>`;
}

function importPhrase() {
  return `<div class="flow">
    <header class="fhead"><button class="ib" data-act="to-welcome" aria-label="Back">${I.back}</button><span class="ftitle">Import</span><span></span></header>
    <h2>Enter your recovery phrase</h2><p class="sub">12 or 24 words, separated by spaces. The same phrase as in Phantom or MetaMask gives the same addresses.</p>
    <form class="stack" data-form="import">
      <label class="fld"><span>Recovery phrase</span><textarea name="phrase" rows="3" autocomplete="off" spellcheck="false" autofocus required></textarea></label>
      <label class="fld"><span>New password for this computer</span><input name="pw" type="password" autocomplete="new-password" minlength="8" required/></label>
      <div class="meter" data-meter><i></i><i></i><i></i><i></i></div>
      <p class="err" data-err></p>
      <button class="btn primary xl">${S.busy ? "Securing…" : "Import wallet"}</button>
    </form>
  </div>`;
}

function unlock() {
  return `<div class="lock">
    <div class="lock-mark"><i class="halo"></i>${LOGO}</div>
    <h1>Welcome back</h1><p class="sub">Unlock Ecrin Wallet</p>
    <form class="stack" data-form="unlock">
      <label class="fld"><span>Password</span><input name="pw" type="password" autocomplete="current-password" autofocus required/></label>
      <p class="err" data-err></p>
      <button class="btn primary xl">${S.busy ? "Unlocking…" : "Unlock"}</button>
    </form>
    <button class="link" data-act="forgot">Forgot your password?</button>
  </div>`;
}

// ------------------------------------------------------------------ home

function totals() {
  const b = S.bal || { native: 0, usdc: 0 }, v = S.vault;
  const vn = v?.main?.balance || 0, vu = v?.usdc?.balance || 0;
  const usd = (n, a) => usdOf(n, a) ?? 0;
  return { chq: usd(b.native, "native") + usd(b.usdc, "usdc"), sav: usd(vn, "native") + usd(vu, "usdc"), b, vn, vu };
}

function homeView() {
  const N = NETS[S.net], e = ENG, w = worth(), loading = !w.ready;
  const pct = w.total ? Math.round((w.sav / w.total) * 100) : 0;
  const addr = e?.address || "";
  return `<div class="home">
    <header class="top">
      <button class="acct" data-act="copy-addr" title="Copy your ${N.name} address"><span class="acct-ic">${LOGO}</span><span class="acct-n">Account 1</span><span class="acct-a">${short(addr)}${I.copy}</span></button>
      <div class="top-r">
        <button class="netchip" data-act="nets" title="${N.name} ${N.net}: the network for Send, Receive, Protect and Withdraw" aria-label="Network: ${N.name}">${netCoin()}${I.chev}</button>
        <button class="ib" data-act="settings" aria-label="Settings">${I.gear}</button>
      </div>
    </header>
    ${S.err ? `<div class="banner">${esc(S.err)}</div>` : ""}
    <section class="hero"><svg class="hero-g" viewBox="0 0 360 230" preserveAspectRatio="xMidYMin slice" aria-hidden="true">${Array.from({ length: 30 }, (_, i) => `<ellipse cx="${180 + Math.sin(i / 2.6) * 6}" cy="${-10 + Math.cos(i / 2.6) * 4}" rx="${40 + i * 9}" ry="${22 + i * 6.2}"/>`).join("")}</svg>
      <div class="hero-l"><span class="lbl">Net worth</span><button class="eye" data-act="hide" aria-label="${S.hide ? "Show" : "Hide"} balances">${S.hide ? I.eyeOff : I.eye}</button></div>
      <div class="big ${loading ? "sk" : ""}">${loading ? "&nbsp;" : mask(fig(money(w.total)))}</div>
      <div class="hero-sub">${chip()}</div>
      ${chartView()}
    </section>
    <section class="accts">
      <button class="acard chq" data-act="panel" data-p="assets" data-tilt><i class="sheen"></i>
        <span class="ac-k">Chequing</span>
        <b class="ac-v ${loading ? "sk" : ""}">${loading ? "&nbsp;" : mask(fig(money(w.chq)))}</b>
        <span class="ac-s"><i class="dot live"></i>Spend instantly</span>
      </button>
      <button class="acard sav" data-act="panel" data-p="vault" data-tilt><i class="sheen"></i>
        <svg class="mv-g" viewBox="0 0 200 140" preserveAspectRatio="xMidYMid slice">${Array.from({ length: 18 }, (_, i) => `<circle cx="${170 + Math.cos(i / 2.2) * 8}" cy="${20 + Math.sin(i / 2.2) * 8}" r="${10 + i * 8}"/>`).join("")}</svg>
        <span class="ac-k">${I.lock}Savings</span>
        <b class="ac-v ${loading ? "sk" : ""}">${loading ? "&nbsp;" : mask(fig(money(w.sav)))}</b>
        <span class="ac-s">${w.leaving ? `<i class="dot warn"></i>${w.leaving} leaving` : w.vaults ? `<i class="dot"></i>${pct}% of net worth` : `<i class="dot off"></i>Not set up`}</span>
      </button>
    </section>
    <nav class="acts">
      ${[["send", "Send", I.send], ["receive", "Receive", I.recv], ["protect", "Protect", I.protect], ["withdraw", "Withdraw", I.out]].map(([p, l, ic]) => `<button data-act="panel" data-p="${p}"><span>${ic}</span>${l}</button>`).join("")}
    </nav>
    <div class="tabs" role="tablist"><button role="tab" data-act="tab" data-t="tokens" aria-selected="${S.tab === "tokens"}">Tokens</button><button role="tab" data-act="tab" data-t="activity" aria-selected="${S.tab === "activity"}">Activity</button><i class="tab-ind" style="--i:${S.tab === "activity" ? 1 : 0}"></i></div>
    ${S.tab === "activity" ? activityList() : tokenList(w)}
    <footer class="foot">${w.all ? "Every network" : "Reading every network…"} · testnet beta</footer>
  </div>`;
}

/** Every coin you hold on every network, biggest first. Tapping one opens Send on its network. */
function tokenList(w) {
  if (!w.ready) return `<section class="list">${[1, 2, 3].map(() => `<div class="arow"><span class="coin sk"></span><span class="ar-t"><b class="sk">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</b><small class="sk">&nbsp;&nbsp;&nbsp;&nbsp;</small></span></div>`).join("")}</section>`;
  if (!w.items.length) return `<section class="list"><div class="empty">${I.recv}<b>No coins yet</b><span>Use Receive to get free test coins on any network.</span></div></section>`;
  const n = (v, d) => v.toLocaleString("en-US", { maximumFractionDigits: d });
  return `<section class="list">${w.items.map((i) => {
    const p = i.a === "usdc" ? { usd: 1 } : S.prices[i.cg], ch = i.a === "usdc" ? null : p?.usd_24h_change;
    return `<button class="arow" data-act="row-send" data-n="${i.k}" data-a="${i.a}"><span class="cstack">${coin(i.coin)}${i.coin !== i.k ? `<span class="cmini">${coin(i.k)}</span>` : ""}</span>
      <span class="ar-t"><b>${i.name}</b><small>${i.a === "usdc" ? i.net : p?.usd != null ? money(p.usd) : i.net}${ch != null ? ` <span class="${ch >= 0 ? "up" : "dn"}">${ch >= 0 ? "+" : "−"}${Math.abs(ch).toFixed(2)}%</span>` : ""}</small></span>
      ${spark(i.cg)}<span class="ar-r"><b>${i.usd != null ? mask(money(i.usd)) : "—"}</b><small>${mask(n(i.chq + i.sav, i.dec))} ${i.unit}${i.sav ? ` <span class="sv">${I.lock}${mask(n(i.sav, i.dec))}</span>` : ""}</small></span></button>`;
  }).join("")}</section>`;
}

/** The change over the chart's range, as plain text: "+$122.17 (4.48%) · 1W". */
function chip() {
  const c = chartData(); if (!c) return `<span class="delta" data-chg></span>`;
  const d = c.vals[c.vals.length - 1] - c.vals[0], ch = (d / (c.vals[0] || 1)) * 100;
  if (!Number.isFinite(ch)) return "";
  return deltaHTML(d, ch, { 1: "1D", 7: "1W", 30: "1M", 365: "1Y" }[S.range], c.coinOnly);
}
function deltaHTML(d, ch, label, pctOnly) {
  const up = d >= 0, sign = up ? "+" : "−";
  return `<span class="delta ${up ? "up" : "dn"}" data-chg>${pctOnly ? `${sign}${Math.abs(ch).toFixed(2)}%` : `${sign}${mask(money(Math.abs(d)))} <span class="dp">(${Math.abs(ch).toFixed(2)}%)</span>`}<span class="dl">${label}</span></span>`;
}

/** Net worth over the range: today's holdings on every network priced along each coin's history (USDC at $1).
 *  Holding nothing yet, it shows the current network's coin price. */
function chartData() {
  const w = worth(), cgs = Object.keys(w.coins), M = 80;
  const list = (cgs.length ? cgs : [NETS[S.net].cg]).map((cg) => [cg, S.series[`${cg}:${S.range}`]]);
  if (list.some(([, h]) => !h)) return null;
  const at = (pts, i) => pts[Math.min(pts.length - 1, Math.round((i / (M - 1)) * (pts.length - 1)))];
  const base = list[0][1].pts, times = Array.from({ length: M }, (_, i) => at(base, i)[0]);
  const vals = times.map((_, i) => (cgs.length ? w.usdc + list.reduce((s, [cg, h]) => s + w.coins[cg] * at(h.pts, i)[1], 0) : at(base, i)[1]));
  return { times, vals, coinOnly: !cgs.length && !w.usdc };
}

function chartView() {
  const c = chartData(), W = 328, H = 78;
  const ranges = `<div class="ranges">${[["1", "1D"], ["7", "1W"], ["30", "1M"], ["365", "1Y"]].map(([d, l]) => `<button data-act="range" data-d="${d}" aria-pressed="${S.range === d}">${l}</button>`).join("")}</div>`;
  if (!c) return `<div class="chart empty-c"><div class="ch-sk"></div>${ranges}</div>`;
  const lo = Math.min(...c.vals), hi = Math.max(...c.vals), span = hi - lo || 1;
  const xy = c.vals.map((v, i) => [(i / (c.vals.length - 1)) * W, 6 + (1 - (v - lo) / span) * (H - 14)]);
  // A smooth line through the points (Catmull-Rom as cubic Béziers).
  let d = `M${xy[0][0].toFixed(1)},${xy[0][1].toFixed(1)}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[i - 1] || xy[i], p1 = xy[i], p2 = xy[i + 1], p3 = xy[i + 2] || p2;
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const up = c.vals[c.vals.length - 1] >= c.vals[0], last = xy[xy.length - 1], draw = S.drawChart ? " draw" : "";
  S.drawChart = false;
  S.chart = { c, xy, W };
  return `<div class="chart ${up ? "up" : "dn"}${draw}" data-chart>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${c.coinOnly ? NETS[S.net].unit + " price" : "Portfolio value"}">
      <defs><linearGradient id="cf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="cf0"/><stop offset="1" class="cf1"/></linearGradient><linearGradient id="cl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9b7bff"/><stop offset=".55" stop-color="#6d8bff"/><stop offset="1" stop-color="#4fc3ff"/></linearGradient></defs>
      <path class="ch-area" d="${d}L${W},${H}L0,${H}Z" fill="url(#cf)"/>
      <path class="ch-line" d="${d}" pathLength="1"/>
      <line class="ch-x" x1="0" x2="0" y1="0" y2="${H}"/>
    </svg>
    <i class="ch-dot" style="left:${((last[0] / W) * 100).toFixed(2)}%;top:${last[1].toFixed(1)}px"></i>
    <i class="ch-pin"></i><span class="ch-tip"></span>
    ${ranges}
  </div>`;
}

const COIN_NAME = { SOL: "Solana", ETH: "Ether", POL: "Polygon", USDC: "USD Coin" };
function assetRow(a, chq, sav) {
  const x = A(a), u = usdOf(chq + sav, a), p = a === "usdc" ? { usd: 1, usd_24h_change: 0 } : S.prices[NETS[S.net].cg];
  const ch = p?.usd_24h_change;
  return `<button class="arow" data-act="panel" data-p="send" data-a="${a}">${assetCoin(a)}
    <span class="ar-t"><b>${COIN_NAME[x.unit] || x.unit}</b><small>${p?.usd != null ? money(p.usd) : x.unit}${ch != null && a !== "usdc" ? ` <span class="${ch >= 0 ? "up" : "dn"}">${ch >= 0 ? "+" : "−"}${Math.abs(ch).toFixed(2)}%</span>` : ""}</small></span>
    ${spark(a)}<span class="ar-r"><b>${S.bal ? (u != null ? mask(money(u)) : mask(amt(chq + sav, a))) : "—"}</b><small>${mask(amt(chq + sav, a))} ${x.unit}${sav ? ` <span class="sv">${I.lock}${mask(amt(sav, a))}</span>` : ""}</small></span></button>`;
}

/** A small price line for a token row: the coin over the chart's range; USDC stays flat at $1. */
function spark(cg) {
  const a = cg === "usdc" || cg === "native" ? (cg === "usdc" ? "usdc" : "native") : "x";
  if (cg === "native") cg = NETS[S.net].cg;
  const hit = S.series[`${cg}:${S.range}`], W = 54, H = 22;
  const vals = a === "usdc" ? [1, 1] : hit ? hit.pts.filter((_, i, l) => i % Math.max(1, Math.floor(l.length / 28)) === 0 || i === l.length - 1).map(([, v]) => v) : null;
  if (!vals) return `<span class="spark"></span>`;
  const lo = Math.min(...vals), hi = Math.max(...vals), sp = hi - lo || 1, up = vals[vals.length - 1] >= vals[0];
  const d = vals.map((v, i) => `${i ? "L" : "M"}${((i / (vals.length - 1)) * W).toFixed(1)},${(a === "usdc" ? H / 2 : 2 + (1 - (v - lo) / sp) * (H - 4)).toFixed(1)}`).join("");
  return `<svg class="spark ${a === "usdc" ? "flat" : up ? "up" : "dn"}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}"/></svg>`;
}

const ACT = { send: ["Sent", I.send], protect: ["Moved to savings", I.protect], withdraw: ["Withdrawal started", I.clock], release: ["Released to chequing", I.recv], cancel: ["Withdrawal cancelled", I.shield], vault: ["Savings vault opened", I.lock] };
/** Every network at once: reads chequing and savings on each, prices them, and adds it all up. */
async function loadAll() {
  const { dev } = await local.get("dev");
  const rows = await Promise.all(Object.keys(NETS).map(async (k) => {
    try {
      const e = k === S.net && ENG ? ENG : engine({ web3, ethers, acct: ACCT, net: k, dev: dev || {} });
      const [b, v] = await Promise.all([e.balances(), e.vault().catch(() => null)]);
      return { k, b, v, ok: true };
    } catch (_) { return { k, ok: false }; }
  }));
  S.all = rows;
  if (S.panel?.p === "all") { S.panel.rows = rows; renderPanel(); }
  if (S.screen === "home" && !S.scrubbing) render();
  loadSeries();
}

function allView() {
  const rows = S.panel.rows, px = (k) => S.prices[NETS[k].cg]?.usd;
  if (!rows) return `${phead("All assets")}<div class="all-total"><span class="lbl">Across every network</span><div class="big sk">&nbsp;</div></div><section class="list">${[1, 2, 3, 4].map(() => `<div class="arow"><span class="coin sk"></span><span class="ar-t"><b class="sk">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</b></span></div>`).join("")}</section>`;
  const items = [];
  for (const r of rows.filter((r) => r.ok)) {
    const N = NETS[r.k], natC = r.b.native, natS = r.v?.main?.balance || 0, uC = r.b.usdc || 0, uS = r.v?.usdc?.balance || 0;
    const nUsd = px(r.k) != null ? ((natC + natS) / BASE) * px(r.k) : null;
    if (natC + natS > 0) items.push({ k: r.k, coin: r.k, unit: N.unit, name: COIN_NAME[N.unit] || N.unit, net: N.name, chq: natC / BASE, sav: natS / BASE, usd: nUsd, dec: N.unit === "SOL" ? 4 : 5 });
    if (uC + uS > 0) items.push({ k: r.k, coin: "usdc", unit: "USDC", name: "USD Coin", net: N.name, chq: uC / USDC_BASE, sav: uS / USDC_BASE, usd: (uC + uS) / USDC_BASE, dec: 2 });
  }
  const total = items.reduce((s, i) => s + (i.usd || 0), 0), saved = items.reduce((s, i) => s + (i.usd != null && i.chq + i.sav ? (i.usd * i.sav) / (i.chq + i.sav) : 0), 0);
  // By coin: SOL, ETH (all Ethereum-style networks together), POL, USDC.
  const byCoin = {};
  for (const i of items) { const c = (byCoin[i.unit] ||= { unit: i.unit, coin: i.unit === "USDC" ? "usdc" : i.unit === "ETH" ? "eth" : i.coin, usd: 0, amt: 0, dec: i.dec }); c.usd += i.usd || 0; c.amt += i.chq + i.sav; }
  const coins = Object.values(byCoin).sort((a, b) => b.usd - a.usd), COL = { SOL: "#9945ff", ETH: "#7d97ff", POL: "#a26bff", USDC: "#2775ca" };
  const n = (v, d) => v.toLocaleString("en-US", { maximumFractionDigits: d });
  return `${phead("All assets")}
    <div class="all-total"><span class="lbl">Across every network</span><div class="big">${mask(fig(money(total)))}</div>
      <span class="sub">${total ? `${Math.round((saved / total) * 100)}% protected in savings` : "Nothing here yet"}</span></div>
    ${total ? `<div class="alloc">${coins.map((c) => `<i style="flex:${c.usd || 0.0001};background:${COL[c.unit] || "#888"}"></i>`).join("")}</div>
    <div class="alloc-l">${coins.map((c) => `<span><i style="background:${COL[c.unit] || "#888"}"></i>${c.unit} ${Math.round((c.usd / total) * 100)}%</span>`).join("")}</div>` : ""}
    <div class="list-h"><b>By network</b><span>Chequing · Savings</span></div>
    <section class="list">${items.length ? items.sort((a, b) => (b.usd || 0) - (a.usd || 0)).map((i) => `<button class="arow" data-act="net-go" data-n="${i.k}"><span class="cstack">${coin(i.coin)}${i.coin === "usdc" || i.coin !== i.k ? `<span class="cmini">${coin(i.k)}</span>` : ""}</span>
      <span class="ar-t"><b>${i.name}</b><small>${i.net} · ${mask(n(i.chq, i.dec))}${i.sav ? ` <span class="sv">${I.lock}${mask(n(i.sav, i.dec))}</span>` : ""}</small></span>
      <span class="ar-r"><b>${i.usd != null ? mask(money(i.usd)) : "—"}</b><small>${mask(n(i.chq + i.sav, i.dec))} ${i.unit}</small></span></button>`).join("")
      : `<div class="empty">${I.shield}<b>No coins yet</b><span>Use Receive to get test coins on any network.</span></div>`}</section>
    ${rows.some((r) => !r.ok) ? `<p class="fine pad">Couldn't reach ${rows.filter((r) => !r.ok).map((r) => NETS[r.k].name).join(", ")} right now.</p>` : ""}`;
}

function activityList() {
  const list = S.activity || [];
  if (!list.length) return `<section class="list"><div class="empty">${I.clock}<b>No activity yet</b><span>Sends, savings moves and withdrawals show up here.</span></div></section>`;
  const when = (ms) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `<section class="list">${list.map((e) => {
    const [title, ic] = ACT[e.t] || ["Transaction", I.arrow], out = e.t === "send";
    return `<${e.sig ? `a href="${NETS[S.net].explorer("tx", e.sig)}" target="_blank"` : "div"} class="arow act-row ${e.t}"><span class="act-ico">${ic}</span>
      <span class="ar-t"><b>${title}</b><small>${when(e.at)}${e.to ? ` · to ${short(e.to)}` : ""}</small></span>
      ${e.n ? `<span class="ar-r"><b class="${out ? "neg" : ""}">${out ? "−" : ""}${amt(e.n, e.a)} ${A(e.a).unit}</b></span>` : ""}</${e.sig ? "a" : "div"}>`;
  }).join("")}</section>`;
}

function delay(s) { return s >= 86400 && s % 86400 === 0 ? `${s / 86400} day${s / 86400 > 1 ? "s" : ""}` : `${Math.round(s / 3600)} h`; }
function dur(s) { if (s <= 0) return "ready"; const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; }

// ------------------------------------------------------------------ panels (slide over the home screen)

function openPanel(p, opts = {}) { S.panel = { p, step: "form", asset: opts.a || "native", amount: "", to: "", ...opts }; renderPanel(true); }
function closePanel() { const el = $("#panel"); el.classList.remove("in"); document.body.classList.remove("stacked"); setTimeout(() => { if (!S.panel) el.innerHTML = ""; }, 260); S.panel = null; render(); }

function renderPanel(enter = false) {
  const el = $("#panel"), P = S.panel;
  if (!P) return;
  const body = ({ send: sendView, receive: receiveView, protect: moveView, withdraw: moveView, vault: vaultView, assets: assetsView, settings: settingsView, nets: netsView, reveal: revealView, numbers: numbersView, all: allView })[P.p]();
  el.innerHTML = `<div class="pane${enter || P.fresh ? " fresh" : ""}">${body}</div>`;
  P.fresh = false;
  if (enter) requestAnimationFrame(() => { el.classList.add("in"); document.body.classList.add("stacked"); });
  bindHolds(el); depth(el);
  const f = el.querySelector("[autofocus]"); if (f && enter) setTimeout(() => f.focus(), 200);
}

const phead = (title, extra = "") => `<header class="phead"><button class="ib" data-act="close" aria-label="Back">${I.back}</button><b>${title}</b><span>${extra}</span></header>`;

function assetPick() {
  const N = NETS[S.net], P = S.panel;
  if (!N.usdc) return "";
  return `<div class="seg2" style="--i:${P.asset === "usdc" ? 1 : 0}"><i></i>${["native", "usdc"].map((a) => `<button data-act="asset" data-a="${a}" aria-pressed="${P.asset === a}">${assetCoin(a)}${A(a).unit}</button>`).join("")}</div>`;
}

/** The amount block: a large number, its dollar value, and 25 / 50 / 100%. */
function amountBlock(max, label) {
  const P = S.panel, a = P.asset, units = parseAmt(P.amount, a), u = usdOf(units, a), over = units > max;
  return `<div class="amt ${over ? "over" : ""}">
    <div class="amt-in"><input data-amount inputmode="decimal" placeholder="0" value="${esc(P.amount)}" autocomplete="off" autofocus/><span>${A(a).unit}</span></div>
    <div class="amt-usd">${u != null && units ? money(u) : "&nbsp;"}</div>
    <div class="pcts">${[25, 50, 100].map((p) => `<button data-act="pct" data-v="${p}" class="${P.pct === p ? "on" : ""}">${p === 100 ? "Max" : p + "%"}</button>`).join("")}</div>
    <div class="avail">${label}: <b>${amt(Math.max(0, max), a)} ${A(a).unit}</b>${over ? ` <span class="bad">· not enough</span>` : ""}</div>
  </div>`;
}

function sendMax() { const a = S.panel.asset; return a === "native" ? Math.max(0, (S.bal?.native || 0) - (S.panel.reserve || 0)) : S.bal?.usdc || 0; }

function sendView() {
  const P = S.panel, e = ENG, a = P.asset, units = parseAmt(P.amount, a);
  if (P.step === "done") return doneView("Sent", `${amt(P.sent, a)} ${A(a).unit} is on its way.`);
  if (P.step === "review" || P.step === "sending") {
    const self = P.to.trim() === e.address;
    return `${phead("Review")}
      <div class="rev">
        <div class="rev-amt">${assetCoin(a, "lg")}<b>${fig(amt(units, a))}</b><span>${A(a).unit}</span><small>${usdOf(units, a) != null ? money(usdOf(units, a)) : ""}</small></div>
        <dl class="rev-l">
          <div><dt>From</dt><dd>Chequing · ${short(e.address)}</dd></div>
          <div><dt>To</dt><dd class="mono">${esc(P.to.trim())}</dd></div>
          <div><dt>Network</dt><dd>${NETS[S.net].name} ${NETS[S.net].net}</dd></div>
          <div><dt>Network fee</dt><dd>${e.feeText()}</dd></div>
        </dl>
        ${self ? `<p class="warn-n">That's your own address.</p>` : P.fresh ? `<p class="warn-n">${I.shield}<span>You've never sent to this address from Ecrin. Check the first and last characters against where you copied it.</span></p>` : ""}
      </div>
      <div class="pfoot">${hold(P.step === "sending" ? "Sending…" : "Hold to send", P.step === "sending")}</div>`;
  }
  const valid = units > 0 && units <= sendMax() && e.isAddress(P.to);
  return `${phead("Send")}
    ${assetPick()}
    ${amountBlock(sendMax(), "Chequing")}
    <label class="fld to"><span>To</span><div class="in-btn"><input data-to placeholder="${NETS[S.net].fam === "sol" ? "Solana address" : "0x… address"}" value="${esc(P.to)}" spellcheck="false" autocomplete="off"/><button type="button" class="ib sm" data-act="paste" aria-label="Paste">${I.paste}</button></div></label>
    ${P.to && !e.isAddress(P.to) ? `<p class="err">That isn't a ${NETS[S.net].name} address.</p>` : ""}
    <div class="pfoot"><button class="btn primary xl" data-act="review" ${valid ? "" : "disabled"}>Review</button></div>`;
}

function hold(label, busy) {
  return `<button class="hold ${busy ? "busy" : ""}" data-hold ${busy ? "disabled" : ""}><span class="hold-fill"></span><span class="hold-t">${busy ? `<i class="spin"></i>` : I.shield}${label}</span></button>`;
}

function doneView(title, text, extra = "") {
  return `<div class="done"><div class="done-mark"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="29"/><path d="M20 33l8 8 16-17"/></svg></div><h2>${title}</h2><p>${text}</p>
    ${S.panel.sig ? `<a class="link" href="${NETS[S.net].explorer("tx", S.panel.sig)}" target="_blank">View on the explorer ${I.ext}</a>` : ""}${extra}
    <div class="pfoot"><button class="btn primary xl" data-act="close">Done</button></div></div>`;
}

function receiveView() {
  const e = ENG, N = NETS[S.net];
  const q = qrcode(0, "M"); q.addData(e.address); q.make();
  return `${phead("Receive")}
    <div class="recv">
      <div class="qr">${q.createSvgTag({ cellSize: 5, margin: 0, scalable: true })}<span class="qr-c">${netCoin()}</span></div>
      <p class="recv-n">Your ${N.name} address</p>
      <button class="addr" data-act="copy-addr"><span class="mono">${esc(e.address)}</span>${I.copy}</button>
      <p class="fine">Only send ${N.name} ${N.net} coins${N.usdc ? " or USDC" : ""} to this address. ${N.fam === "evm" ? "The same address works on every Ethereum-style network." : ""}</p>
      <a class="link" href="${N.faucet}" target="_blank">Get free test ${N.unit} ${I.ext}</a>
    </div>`;
}

/** Protect (chequing → savings) and Withdraw (savings → chequing, after the delay). */
function moveView() {
  const P = S.panel, e = ENG, a = P.asset, isIn = P.p === "protect", v = S.vault;
  if (!v) return createVaultView(isIn ? "Protect" : "Withdraw");
  const units = parseAmt(P.amount, a), main = v.main, tv = a === "usdc" ? v.usdc : main;
  const max = isIn ? sendMaxProtect() : tv?.available || 0;
  if (P.step === "done") return isIn ? doneView("Protected", `${amt(P.sent, a)} ${A(a).unit} is in your savings vault. Anything leaving it waits ${delay(main.withdrawDelay)}.`) : doneView("Withdrawal started", `${amt(P.sent, a)} ${A(a).unit} reaches chequing in ${delay(main.withdrawDelay)}. You can cancel it until then.`);
  const lim = a === "usdc" ? v.usdc?.dailyLimit : main.dailyLimit, overLim = !isIn && lim && units > lim;
  const valid = units > 0 && units <= max && !overLim;
  return `${phead(isIn ? "Protect" : "Withdraw")}
    <div class="flowline ${isIn ? "in" : "out"}"><span>${isIn ? "Chequing" : "Savings"}</span><i></i><span>${isIn ? "Savings" : "Chequing"}</span></div>
    ${assetPick()}
    ${amountBlock(max, isIn ? "Chequing" : "Savings, free to leave")}
    ${overLim ? `<p class="err">Over your daily limit of ${amt(lim, a)} ${A(a).unit}. Split it into smaller withdrawals.</p>` : ""}
    <p class="note">${isIn ? `${I.lock}<span>Once inside, anything leaving waits <b>${delay(main.withdrawDelay)}</b>, and you can cancel it the whole time. Not even someone with your recovery phrase can rush it.</span>` : `${I.clock}<span>Arrives in chequing in <b>${delay(main.withdrawDelay)}</b>${main.lockedUntil && now() < main.lockedUntil ? " and not before the lock ends" : ""}. You can cancel it any time before.</span>`}</p>
    <div class="pfoot">${P.step === "sending" ? hold(isIn ? "Protecting…" : "Starting…", true) : `<button class="btn primary xl" data-act="${isIn ? "do-protect" : "do-withdraw"}" ${valid ? "" : "disabled"}>${isIn ? "Move to savings" : "Start withdrawal"}</button>`}</div>`;
}
function sendMaxProtect() { const a = S.panel.asset; return a === "native" ? Math.max(0, (S.bal?.native || 0) - (S.panel.reserve || 0) - (NETS[S.net].fam === "sol" ? 3_000_000 : 0)) : S.bal?.usdc || 0; }

function createVaultView(title) {
  const P = S.panel;
  return `${phead(title)}
    <div class="cv">
      <div class="cv-art">${miniVault()}</div>
      <h2>Open your savings vault</h2>
      <p class="sub">Money you move here can't leave in a hurry: every withdrawal waits, and you can cancel it the whole time. Your chequing account stays instant.</p>
      <div class="presets">
        ${[["gentle", "Gentle", "24 h", "Everyday savings"], ["strong", "Strong", "72 h", "Recommended"]].map(([k, n, d, s]) => `<button class="preset ${P.kind === k || (!P.kind && k === "strong") ? "on" : ""}" data-act="kind" data-k="${k}"><b>${n}</b><span class="pd">${d}</span><small>${s}</small></button>`).join("")}
      </div>
    </div>
    <div class="pfoot">${P.step === "sending" ? hold("Opening…", true) : `<button class="btn primary xl" data-act="create-vault">Open vault</button>`}</div>`;
}

function vaultView() {
  const v = S.vault;
  if (!v) return createVaultView("Savings");
  const main = v.main, list = [...main.withdrawals.map((w) => ({ ...w, a: "native" })), ...(v.usdc?.withdrawals || []).map((w) => ({ ...w, a: "usdc" }))].sort((x, y) => x.readyAt - y.readyAt);
  const t = now() + (S.clockOff || 0);
  return `${phead("Savings vault")}
    <div class="vcase" data-tilt><i class="sheen"></i>
      <svg class="mv-g" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice">${Array.from({ length: 26 }, (_, i) => `<circle cx="${330 + Math.cos(i / 2.2) * 14}" cy="${40 + Math.sin(i / 2.2) * 14}" r="${18 + i * 9}"/>`).join("")}</svg>
      <div class="mv-top"><span class="mv-mark">${LOGO}<b>ECRIN</b></span><span class="mv-lvl">${delay(main.withdrawDelay)} delay</span></div>
      <div class="vc-rows">${vaultLine("native", main.balance)}${NETS[S.net].usdc ? vaultLine("usdc", v.usdc?.balance || 0) : ""}</div>
    </div>
    <div class="vacts"><button class="btn" data-act="panel" data-p="protect">${I.protect}Protect more</button><button class="btn" data-act="panel" data-p="withdraw">${I.out}Withdraw</button></div>
    <div class="list-h"><b>Waiting to leave</b><span>cancel any time</span></div>
    ${list.length ? list.map((w) => {
      const left = w.readyAt - t, ready = left <= 0;
      return `<div class="wrow ${ready ? "ready" : ""}">${assetCoin(w.a)}<span class="wr-t"><b>${amt(w.amount, w.a)} ${A(w.a).unit}</b><small>to ${String(w.dest) === ENG.address ? "your chequing" : short(String(w.dest))}</small></span>
        <span class="wr-r"><b class="cd">${ready ? "Ready" : dur(left)}</b>${ready ? `<button class="btn sm primary" data-act="execute" data-id="${w.id}" data-a="${w.a}" data-d="${esc(String(w.dest))}">Release</button>` : ""}<button class="btn sm danger" data-act="cancel-w" data-id="${w.id}" data-a="${w.a}">Cancel</button></span></div>`;
    }).join("") : `<div class="empty">${I.shield}<b>Sealed</b><span>Nothing is waiting to leave.</span></div>`}
    <a class="link center" href="https://ecrinprotocol.app/app" target="_blank">Rules, guardian and alerts on ecrinprotocol.app ${I.ext}</a>`;
}
const vaultLine = (a, units) => `<div class="vl">${assetCoin(a)}<b>${mask(fig(amt(units, a)))}</b><span>${A(a).unit}</span></div>`;

function assetsView() {
  const t = totals();
  return `${phead("Chequing")}
    <p class="sub pad">Your everyday wallet. It sends at once, like any wallet. Keep what you trade with here, and the rest in savings.</p>
    <section class="list">${assetRow("native", t.b.native, t.vn)}${NETS[S.net].usdc ? assetRow("usdc", t.b.usdc, t.vu) : ""}</section>
    <div class="vacts"><button class="btn" data-act="panel" data-p="send">${I.send}Send</button><button class="btn" data-act="panel" data-p="receive">${I.recv}Receive</button></div>`;
}

function netsView() {
  return `${phead("Network")}
    <div class="nets">${Object.values(NETS).map((n) => {
      const live = n.fam === "sol" || !!n.contract;
      return `<button class="nrow ${S.net === n.key ? "on" : ""}" data-act="net" data-n="${n.key}">${coin(n.key)}<span class="nr-t"><b>${n.name}</b><small>${n.net} testnet${live ? "" : " · vault coming soon"}</small></span>${S.net === n.key ? `<i class="nr-on">${I.check}</i>` : ""}</button>`;
    }).join("")}</div>
    <p class="fine pad">Your Ethereum address is the same on every Ethereum-style network.</p>`;
}

function settingsView() {
  return `${phead("Settings")}
    <div class="sets">
      <div class="srow"><span>${I.clock}Auto-lock</span><span class="seg">${[0, 1, 5, 15, 60].map((m) => `<button data-act="autolock" data-v="${m}" aria-pressed="${S.autolock === m}">${m === 0 ? "Always" : m < 60 ? m + "m" : "1h"}</button>`).join("")}</span></div>
      <div class="srow"><span>${S.theme === "dark" ? I.moon : I.sun}Appearance</span><span class="seg">${["light", "dark"].map((t) => `<button data-act="theme" data-v="${t}" aria-pressed="${S.theme === t}">${t === "light" ? "Light" : "Dark"}</button>`).join("")}</span></div>
      <button class="srow" data-act="panel" data-p="numbers"><span><b class="nf-ico">1.2</b>Numbers</span><span class="sv">${NUM_FACES.find(([k]) => k === S.nums.face)[1]} ${I.arrow}</span></button>
      <button class="srow" data-act="panel" data-p="nets"><span>${netCoin()}Network</span><span class="sv">${NETS[S.net].name} ${I.arrow}</span></button>
      <button class="srow" data-act="panel" data-p="reveal"><span>${I.eye}Show recovery phrase</span><span class="sv">${I.arrow}</span></button>
      <a class="srow" href="https://ecrinprotocol.app/app" target="_blank"><span>${I.shield}Vault rules and alerts</span><span class="sv">${I.ext}</span></a>
      <button class="srow" data-act="lock"><span>${I.lock}Lock now</span><span></span></button>
      <button class="srow danger" data-act="forget"><span>Remove wallet from this browser</span><span></span></button>
    </div>
    <p class="fine pad">Ecrin Wallet ${VERSION} · testnet beta · not audited</p>`;
}

function numbersView() {
  const t = S.bal ? totals() : null, sample = t ? t.chq + t.sav : 12480.5;
  const row = (k, title, list) => `<div class="nrow-h">${title}</div><div class="nopts">${list.map(([v, n]) => `<button data-act="num" data-k="${k}" data-v="${v}" aria-pressed="${S.nums[k] === v}"${k === "face" ? ` data-face="${v}"` : ""}>${k === "face" ? `<b>$1,248</b>` : ""}<span>${n}</span></button>`).join("")}</div>`;
  return `${phead("Numbers")}
    <div class="nprev"><span class="lbl">Preview</span><div class="big">${fig(money(sample))}</div><div class="nprev-s"><b class="ac-v">${fig("7.4953")}</b><small>SOL</small></div></div>
    ${row("face", "Typeface", NUM_FACES)}${row("weight", "Weight", NUM_WEIGHTS)}${row("cents", "Cents", NUM_CENTS)}
    <p class="fine pad">Applies to every number in the wallet.</p>`;
}

function revealView() {
  const P = S.panel;
  if (P.words) return `${phead("Recovery phrase")}<p class="sub pad">Never type these anywhere but a wallet you trust. Ecrin will never ask for them.</p><div class="phrase shown">${P.words.split(" ").map((w, i) => `<span><i>${i + 1}</i>${esc(w)}</span>`).join("")}</div>`;
  return `${phead("Recovery phrase")}<form class="stack pad" data-form="reveal"><p class="sub">Enter your password to see your 12 words. Make sure nobody can see your screen.</p><label class="fld"><span>Password</span><input name="pw" type="password" autofocus required/></label><p class="err" data-err></p><button class="btn primary xl">Show</button></form>`;
}

// ------------------------------------------------------------------ actions

function toast(text, kind = "") { const t = $("#toast"); t.textContent = text; t.className = "toast show " + kind; clearTimeout(t._t); t._t = setTimeout(() => (t.className = "toast " + kind), 2600); }
const errText = (e) => { try { return ENG?.explain?.(e)?.message || e.message; } catch (_) { return String(e?.message || e); } };

const actKey = () => `act:${S.net}:${ENG?.address || ""}`;
async function readActivity() { const k = actKey(), o = await local.get(k); return o[k] || []; }
async function logActivity(e) { const k = actKey(), list = await readActivity(); await local.set({ [k]: [{ at: Date.now(), ...e }, ...list].slice(0, 40) }); }

async function txRun(fn, after, log) {
  const P = S.panel; P.step = "sending"; renderPanel();
  try { const sig = await fn(); P.sig = typeof sig === "string" ? sig : null; await after?.(); if (log) await logActivity({ ...log, sig: P.sig }); P.step = "done"; await refresh(); S.activity = await readActivity(); loadAll(); }
  catch (e) { console.warn(e); P.step = "form"; toast(errText(e), "err"); }
  renderPanel();
}

async function knownDest(to) { const { sent = {} } = await local.get("sent"); return !!sent[`${S.net}:${to}`]; }
async function rememberDest(to) { const { sent = {} } = await local.get("sent"); sent[`${S.net}:${to}`] = Date.now(); await local.set({ sent }); }

const actions = {
  "start-create": () => go("createPw", { phrase: newPhrase(), revealed: false, wrote: false }),
  "start-import": () => go("importPhrase"),
  // Web demo only: a ready wallet with pretend money, no setup.
  "demo-quick": async () => { if (!globalThis.ECRIN_DEMO) return; S.busy = true; render(); await saveWallet(newPhrase(), "demo-wallet-1"); S.busy = false; home(); },
  "to-welcome": () => go("welcome"),
  "to-pw": () => go("createPw"),
  "to-phrase": () => go("createPhrase"),
  reveal: () => { S.revealed = true; render(); },
  "to-verify": () => {
    const words = S.phrase.split(" "), idx = [];
    while (idx.length < 3) { const i = Math.floor(Math.random() * 12); if (!idx.includes(i)) idx.push(i); }
    idx.sort((a, b) => a - b);
    S.quiz = idx.map((i) => {
      const opts = new Set([words[i]]);
      while (opts.size < 6) opts.add(WORDS[Math.floor(Math.random() * WORDS.length)]);
      return { i, ok: false, opts: [...opts].sort(() => Math.random() - 0.5) };
    });
    go("createVerify", { quizErr: false });
  },
  pick: (el) => { const q = S.quiz.find((x) => !x.ok), w = S.phrase.split(" ")[q.i]; if (el.dataset.w === w) { q.ok = true; S.quizErr = false; } else S.quizErr = true; render(); },
  "finish-create": async () => { S.busy = true; render(); await saveWallet(S.phrase, S.pw); S.busy = false; S.phrase = S.pw = null; home(); },
  forgot: () => { if (confirm("Without the password, the only way back in is your recovery phrase. Remove this wallet from the browser and import it again?")) forget(); },
  "copy-addr": async () => { await navigator.clipboard.writeText(ENG.address); toast("Address copied", "win"); },
  hide: async () => { S.hide = !S.hide; await local.set({ hide: S.hide }); render(); if (S.panel) renderPanel(); },
  panel: async (el) => {
    const p = el.dataset.p;
    if (S.panel && p !== S.panel.p) { S.panel = { p, step: "form", asset: el.dataset.a || "native", amount: "", to: "" }; renderPanel(); }
    else openPanel(p, { a: el.dataset.a });
    if (p === "send" || p === "protect") { const e = await eng(); S.panel.reserve = await e.reserve(S.panel.asset); renderPanel(); }
    if (p === "all") loadAll();
  },
  settings: () => openPanel("settings"),
  nets: () => openPanel("nets"),
  close: () => closePanel(),
  asset: async (el) => { const P = S.panel; P.asset = el.dataset.a; P.amount = ""; P.pct = null; P.reserve = await (await eng()).reserve(P.asset); renderPanel(); },
  pct: (el) => {
    const P = S.panel, p = Number(el.dataset.v), a = P.asset;
    const max = P.p === "send" ? sendMax() : P.p === "protect" ? sendMaxProtect() : (a === "usdc" ? S.vault?.usdc?.available : S.vault?.main?.available) || 0;
    const units = Math.floor((max * p) / 100), x = A(a);
    P.pct = p; P.amount = units ? String(Math.floor((units / x.base) * 10 ** x.dec) / 10 ** x.dec) : "";
    renderPanel();
  },
  paste: async () => { try { S.panel.to = (await navigator.clipboard.readText()).trim(); renderPanel(); } catch (_) { toast("Couldn't read the clipboard", "err"); } },
  review: async () => { S.panel.fresh = !(await knownDest(S.panel.to.trim())); S.panel.step = "review"; S.panel.anim = true; renderPanel(); },
  kind: (el) => { S.panel.kind = el.dataset.k; renderPanel(); },
  "create-vault": () => txRun(async () => (await eng()).createVault(S.panel.kind || "strong"), null, { t: "vault" }),
  "do-protect": () => { const P = S.panel, units = parseAmt(P.amount, P.asset); P.sent = units; txRun(async () => (await eng()).protect(P.asset, units), null, { t: "protect", a: P.asset, n: units }); },
  "do-withdraw": () => { const P = S.panel, units = parseAmt(P.amount, P.asset); P.sent = units; txRun(async () => (await eng()).request(P.asset, ENG.address, units), null, { t: "withdraw", a: P.asset, n: units }); },
  "cancel-w": async (el) => { try { el.disabled = true; await (await eng()).cancel(el.dataset.a, Number(el.dataset.id)); await logActivity({ t: "cancel", a: el.dataset.a }); S.activity = await readActivity(); toast("Cancelled. It stays in savings.", "win"); await refresh(); } catch (e) { el.disabled = false; toast(errText(e), "err"); } },
  execute: async (el) => { try { el.disabled = true; await (await eng()).execute(el.dataset.a, Number(el.dataset.id), el.dataset.d); await logActivity({ t: "release", a: el.dataset.a }); S.activity = await readActivity(); toast("Released to chequing", "win"); await refresh(); } catch (e) { el.disabled = false; toast(errText(e), "err"); } },
  net: async (el) => { S.net = el.dataset.n; await local.set({ net: S.net }); S.bal = null; S.vault = undefined; ENG = null; S.drawChart = true; closePanel(); await eng(); S.activity = await readActivity(); refresh(); loadSeries(); },
  "row-send": async (el) => { if (el.dataset.n !== S.net) { S.net = el.dataset.n; await local.set({ net: S.net }); S.bal = null; S.vault = undefined; ENG = null; await eng(); S.activity = await readActivity(); await refresh(); } openPanel("send", { a: el.dataset.a }); const e = await eng(); S.panel.reserve = await e.reserve(S.panel.asset); renderPanel(); },
  "net-go": async (el) => { if (el.dataset.n !== S.net) await actions.net(el); else closePanel(); },
  tab: async (el) => { S.tab = el.dataset.t; if (S.tab === "activity") S.activity = await readActivity(); render(); },
  range: async (el) => { S.range = el.dataset.d; await local.set({ range: S.range }); S.drawChart = true; render(); loadSeries(); },
  num: async (el) => { S.nums[el.dataset.k] = el.dataset.v; applyNums(); await local.set({ nums: S.nums }); renderPanel(); render(); },
  autolock: async (el) => { S.autolock = Number(el.dataset.v); await local.set({ autolock: S.autolock }); await touch(); renderPanel(); },
  theme: async (el) => { S.theme = el.dataset.v; document.documentElement.dataset.theme = S.theme; await local.set({ theme: S.theme }); render(); renderPanel(); },
  lock: async () => { await session.clear(); chrome.runtime.sendMessage({ type: "lock" }).catch(() => {}); ACCT = ENG = null; S.panel = null; S.counted = false; S.entered = false; $("#panel").innerHTML = ""; $("#panel").classList.remove("in"); document.body.classList.remove("stacked"); go("unlock"); },
  forget: () => { if (confirm("Remove this wallet from the browser? You'll need your recovery phrase to use it again. Money stays on the blockchain.")) forget(); },
};

async function forget() { await chrome.storage.local.clear(); await session.clear(); location.reload(); }

async function saveWallet(phrase, pw) {
  await local.set({ box: await seal(phrase, pw) });
  await session.set({ phrase: normalize(phrase) });
  useAccount(phrase); await touch();
}

// The send confirmation needs a press and hold: a stray click can't send money.
function bindHolds(root) {
  root.querySelectorAll("[data-hold]:not([disabled])").forEach((b) => {
    let t0 = 0, raf = 0;
    const stop = () => { cancelAnimationFrame(raf); b.style.setProperty("--h", 0); b.classList.remove("holding"); };
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / 850); b.style.setProperty("--h", k);
      if (k < 1) raf = requestAnimationFrame(tick); else { stop(); confirmSend(); }
    };
    const start = (e) => { if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return; if (e.repeat) return; e.preventDefault(); t0 = performance.now(); b.classList.add("holding"); raf = requestAnimationFrame(tick); };
    b.addEventListener("pointerdown", start); b.addEventListener("keydown", start);
    ["pointerup", "pointerleave", "keyup", "blur"].forEach((ev) => b.addEventListener(ev, stop));
  });
}

async function confirmSend() {
  const P = S.panel, units = parseAmt(P.amount, P.asset), to = P.to.trim();
  P.sent = units;
  await txRun(async () => (await eng()).send(P.asset, to, units), () => rememberDest(to), { t: "send", a: P.asset, n: units, to });
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  if (el.tagName === "A") return;
  e.preventDefault();
  actions[el.dataset.act]?.(el);
  if (ACCT) touch();
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.matches("[data-amount]")) {
    const v = t.value.replace(/[^\d.,]/g, "").replace(",", "."), parts = v.split(".");
    S.panel.amount = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : v; S.panel.pct = null;
    const pos = t.selectionStart; renderPanel(); const n = $("#panel [data-amount]"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {}
  } else if (t.matches("[data-to]")) { S.panel.to = t.value; const pos = t.selectionStart; renderPanel(); const n = $("#panel [data-to]"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} }
  else if (t.matches("[data-tick]")) { S.wrote = t.checked; render(); }
  else if (t.name === "pw" && t.closest("form")?.querySelector("[data-meter]")) { const m = t.closest("form").querySelector("[data-meter]"); m.dataset.s = strength(t.value); }
});

document.addEventListener("submit", async (e) => {
  const f = e.target, kind = f.dataset.form; if (!kind) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f)), err = (m) => { const x = f.querySelector("[data-err]"); if (x) x.textContent = m; };
  if (kind === "pw") {
    if (strength(d.pw) < 2) return err("Use at least 8 characters, mixing letters and numbers.");
    if (d.pw !== d.pw2) return err("The two passwords don't match.");
    S.pw = d.pw; return go("createPhrase");
  }
  if (kind === "import") {
    if (!isPhrase(d.phrase)) return err("That phrase isn't valid. Check each word and the order.");
    if (strength(d.pw) < 2) return err("Use at least 8 characters, mixing letters and numbers.");
    S.busy = true; render(); await saveWallet(d.phrase, d.pw); S.busy = false; return home();
  }
  if (kind === "unlock") {
    S.busy = true; render();
    try { const { box } = await local.get("box"); const phrase = await open(box, d.pw); await session.set({ phrase }); useAccount(phrase); await touch(); S.busy = false; home(); }
    catch (_) { S.busy = false; render(); const x = $("[data-err]"); if (x) x.textContent = "Wrong password"; $("#root form")?.classList.add("shake"); }
    return;
  }
  if (kind === "reveal") {
    try { const { box } = await local.get("box"); S.panel.words = await open(box, d.pw); renderPanel(); } catch (_) { err("Wrong password"); }
  }
});

// Countdowns in the vault tick without a refetch.
setInterval(() => { if (S.panel?.p === "vault") renderPanel(); }, 30_000);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.panel) closePanel(); });

boot();
