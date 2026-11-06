// Ecrin Wallet popup. Two accounts on every network: Wallet (spend instantly) and Safe (the
// Ecrin vault: anything leaving waits its delay and can be cancelled). One recovery phrase, encrypted on disk;
// while unlocked it sits only in the browser's memory (chrome.storage.session) and is wiped by auto-lock.
import * as web3 from "@solana/web3.js";
import { ethers } from "ethers";
import qrcode from "qrcode-generator";
import { newPhrase, isPhrase, normalize, seal, open, deriveAccount, strength, WORDS } from "./keyring.js";
import { NETS, BASE, USDC_BASE, engine } from "./chains.js";
import { makeApprovals } from "./approve.js";
import { mountVault3d } from "./vault3d.js";
import { bioEnable, bioUnlock, bioName, bioPossible } from "./bio.js";
import { sealKeys, openKeys, parseKey, keysFor, COLORS } from "./accounts.js";
import { translate, LANGS } from "./i18n.js";
import { toTron } from "./tron.js";
import { LOGOS } from "./logos.js";

const VERSION = chrome.runtime.getManifest().version;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const local = { get: (k) => chrome.storage.local.get(k), set: (o) => chrome.storage.local.set(o), remove: (k) => chrome.storage.local.remove(k) };
const session = { get: (k) => chrome.storage.session.get(k), set: (o) => chrome.storage.session.set(o), clear: () => chrome.storage.session.clear() };
const short = (a) => (a ? `${String(a).slice(0, 4)}…${String(a).slice(-4)}` : "");
const now = () => Math.floor(Date.now() / 1000);

const S = { screen: "loading", net: "sol", theme: "dark", autolock: 15, panel: null, prices: {}, bal: null, vault: undefined, busy: false, hide: false, range: "7", series: {}, nums: { face: "sans", weight: "500", cents: "dim" }, tab: "tokens" };
const NUM_FACES = [["display", "Display"], ["sans", "Sans"], ["serif", "Serif"], ["mono", "Mono"]];
const NUM_WEIGHTS = [["400", "Light"], ["500", "Regular"], ["600", "Bold"]];
const NUM_CENTS = [["dim", "Dimmed"], ["full", "Full"], ["hide", "Hidden"]];
/** The numbers' look, applied to the whole wallet through attributes on <html>. */
function applyNums() { const r = document.documentElement; r.dataset.numFace = S.nums.face; r.dataset.numWeight = S.nums.weight; r.dataset.cents = S.nums.cents; }

// ------------------------------------------------------------------ icons and coins

const I = {
  pen: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  img: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/></svg>',
  card: '<svg viewBox="0 0 24 24"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/></svg>',
  ban: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/></svg>',
  snow: '<svg viewBox="0 0 24 24"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5S9.5 6.1 12 3.5z"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/></svg>',
  swap: '<svg viewBox="0 0 24 24"><path d="M7 4v14M3.5 14.5L7 18l3.5-3.5M17 20V6M13.5 9.5L17 6l3.5 3.5"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M4 17l5-5 4 4 7-8"/><path d="M15 8h5v5"/></svg>',
  face: '<svg viewBox="0 0 24 24"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 16a3.5 3.5 0 0 0 5 0"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>',
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
  qr: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2M18 14h2M14 18v2M18 18h2v2"/></svg>',
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
const coin = (k, cls = "") => `<span class="coin logo c-${k} ${cls}" aria-hidden="true">${LOGOS[k] || LOGOS.eth}</span>`;
const netCoin = (n = S.net) => coin(n);
const assetCoin = (a) => (a === "usdc" ? coin("usdc") : netCoin());
/** The coin itself (USDC, or ETH on every Ethereum network), with the network as a small badge when they differ. */
const coinOn = (a, n = S.net) => { const m = a === "usdc" ? "usdc" : NETS[n].unit === "ETH" ? "eth" : n; return m === n ? coin(n) : `<span class="cstack">${coin(m)}<span class="cmini">${coin(n)}</span></span>`; };
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

let ENG = null, ACCT = null, PHRASE = null;
const DEF_ACCTS = [{ id: "hd0", kind: "hd", i: 0, name: "Account 1", c: 0 }];
/** The networks the current account can use: all of them, or one family for an imported private key. */
const netKeys = () => Object.keys(NETS).filter((k) => !ACCT?.only || NETS[k].fam === ACCT.only);
const curAcct = () => (S.accts || DEF_ACCTS).find((a) => a.id === S.sel) || (S.accts || DEF_ACCTS)[0];
async function useAccount(phrase) {
  PHRASE = normalize(phrase);
  const st = await local.get(["accts", "acctSel", "keysBox"]);
  S.accts = st.accts?.length ? st.accts : DEF_ACCTS; S.sel = st.acctSel || S.accts[0].id;
  let imported = {}; try { imported = await openKeys(st.keysBox, PHRASE); } catch (_) {}
  try { ACCT = keysFor(curAcct(), PHRASE, imported, { web3, ethers }); }
  catch (_) { S.sel = S.accts[0].id; ACCT = keysFor(S.accts[0], PHRASE, imported, { web3, ethers }); }
  ENG = null;
  if (ACCT.only && NETS[S.net].fam !== ACCT.only) S.net = netKeys()[0];
  // Public addresses only, so websites you connected can see your address while the wallet is locked.
  await local.set({ pub: { sol: ACCT.sol?.publicKey.toBase58() || null, evm: ACCT.evm?.address || null } });
}
async function switchAccount(id) {
  S.sel = id; await local.set({ acctSel: id });
  await useAccount(PHRASE);
  Object.assign(S, { bal: null, vault: undefined, all: null, series: {}, drawChart: true });
  closePanel(); await home();
}
async function eng() {
  if (!ENG || ENG.N.key !== S.net) {
    const { dev } = await local.get("dev");
    ENG = engine({ web3, ethers, acct: ACCT, net: S.net, dev: dev || {} });
  }
  return ENG;
}

async function boot() {
  const pr = await local.get(["book", "hideSmall", "order", "recvNotify", "guard", "alertsOn", "showNfts", "goal"]); S.showNfts = !!pr.showNfts; S.goal = pr.goal || null; Object.assign(S, { book: pr.book || {}, hideSmall: !!pr.hideSmall, order: pr.order || "value", recvNotify: pr.recvNotify, guard: { auto: 0, daily: 0, cool: 0, coolOver: 500, ...(pr.guard || {}) }, alertsOn: !!pr.alertsOn });
  const st = await local.get(["box", "net", "theme", "autolock", "hide", "nums", "range", "dev", "prices", "bio", "lang"]);
  S.lang = st.lang || (/^fr/i.test(navigator.language || "") ? "fr" : "en"); document.documentElement.lang = S.lang;
  S.bio = globalThis.ECRIN_WEB && st.bio ? st.bio : null;
  // The phone app opens on the spinning Ecrin mark for a moment.
  if (globalThis.ECRIN_WEB) await new Promise((r) => setTimeout(r, Math.max(0, 1300 - performance.now())));
  if (st.prices?.p && Date.now() - st.prices.at < 86400_000) S.prices = st.prices.p;
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
  if (!st.box) { if (AP.id) { S.req = { gone: true, nowallet: true }; return go("approve"); } if (!(await local.get("toured")).toured && !globalThis.ECRIN_DEMO) S.tour = 0; return go("welcome"); }
  const ses = await session.get(["phrase", "until"]);
  if (ses.phrase && ses.until > Date.now()) { await useAccount(ses.phrase); await touch(); return AP.id ? startApproval() : home(); }
  await session.clear();
  if (S.bio) { S.bioBusy = "scan"; go("unlock"); return actions["bio-unlock"](); }
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
  checkUpdate(); loadBackup(); applyPendingLimit();
  S.screen = "home"; await eng(); S.histAt = 0; S.hist = []; render(); loadActivity();
  loadAll();
  refresh();
  loadPrices();
  // Phone app shortcuts (long-press the icon): Send, Receive, Freeze.
  const go = !S.wentTo && new URLSearchParams(location.search).get("go"); S.wentTo = true;
  if (go && ["send", "receive", "safety"].includes(go)) setTimeout(() => openPanel(go), 400);
}

async function refresh() {
  try {
    const e = await eng();
    const [bal, vault] = await Promise.all([e.balances(), e.vault().catch((err) => (console.warn(err), null))]);
    noticeIncoming(bal); S.bal = bal; S.vault = vault; S.err = null; autoProtect(bal);
  } catch (err) { console.warn(err); S.err = `Can't reach ${NETS[S.net].name} right now. Retrying…`; setTimeout(refresh, 6000); }
  if (S.screen === "home") render();
  if (S.panel) renderPanel();
}

// Prices come from CoinGecko first, then Binance, then Coinbase: if one is down or rate-limits us, the next answers.
const SYM = { solana: "SOL", ethereum: "ETH", "polygon-ecosystem-token": "POL", binancecoin: "BNB", "avalanche-2": "AVAX", tron: "TRX" };
const addrHint = (N) => (N.fam === "sol" ? "Solana address" : N.fam === "tron" ? "Tron address (T…)" : "0x… address");
const getJSON = async (url) => { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error(r.status); return r.json(); };

async function spotPrices() {
  try { const j = await getJSON("https://api.coingecko.com/api/v3/simple/price?ids=${Object.keys(SYM).join(",")}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true"); if (j?.solana?.usd) return j; } catch (_) {}
  try {
    const j = await getJSON(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(Object.values(SYM).map((x) => x + "USDT")))}`);
    const out = {}; for (const [cg, x] of Object.entries(SYM)) { const t = j.find((r) => r.symbol === x + "USDT"); if (t) out[cg] = { usd: Number(t.lastPrice), usd_24h_change: Number(t.priceChangePercent) }; }
    if (out.solana) return out;
  } catch (_) {}
  const out = {};
  await Promise.all(Object.entries(SYM).map(async ([cg, x]) => { try { const t = await getJSON(`https://api.exchange.coinbase.com/products/${x}-USD/stats`); out[cg] = { usd: Number(t.last), usd_24h_change: ((t.last - t.open) / t.open) * 100 }; } catch (_) {} }));
  return out.solana ? out : null;
}

async function loadPrices() {
  if (S.mock) { S.prices = { solana: { usd: 172.4, usd_24h_change: 2.31 }, binancecoin: { usd: 612.5, usd_24h_change: 0.6 }, "avalanche-2": { usd: 28.4, usd_24h_change: -1.4 }, tron: { usd: 0.24, usd_24h_change: 0.9 }, ethereum: { usd: 3410, usd_24h_change: -0.84 }, "polygon-ecosystem-token": { usd: 0.42, usd_24h_change: 1.2 } }; if (S.screen === "home") render(); return loadSeries(); }
  const p = await spotPrices().catch(() => null);
  if (p) { S.prices = { ...S.prices, ...p }; local.set({ prices: { at: Date.now(), p: S.prices } }); if (S.screen === "home") render(); }
  await loadSeries();
  // No spot price anywhere: use the last point of the history instead.
  let filled = false;
  for (const cg of Object.keys(SYM)) { const h = S.series[`${cg}:${S.range}`]; if (!S.prices[cg]?.usd && h) { S.prices[cg] = { usd: h.pts[h.pts.length - 1][1] }; filled = true; } }
  if (filled && S.screen === "home") render();
  if (!p) setTimeout(loadPrices, 30_000);
}

/** Price history for the chart, one fetch per coin and range, kept for five minutes and saved, so the last chart
 *  shows at once next time (even offline) while a fresh one loads. Every source is tried before giving up. */
async function loadSeries() {
  if (!S.seriesLoaded) { S.seriesLoaded = true; try { const st = await local.get("series"); for (const [k, v] of Object.entries(st.series || {})) if (!S.series[k]) S.series[k] = v; } catch (_) {} }
  const cgs = [...new Set([NETS[S.net].cg, ...Object.keys(worth().coins), ...MARKET.map(([cg]) => cg)])];
  const ok = await Promise.all(cgs.map(loadSeriesFor));
  if (ok.includes(false)) { clearTimeout(S.seriesRetry); S.seriesRetry = setTimeout(loadSeries, 20_000); }
}
const RANGE = { 1: ["15m", 96, 900], 7: ["1h", 168, 3600], 30: ["6h", 120, 21600], 365: ["1d", 365, 86400] };
async function historyFrom(cg, days) {
  try { const j = await getJSON(`https://api.coingecko.com/api/v3/coins/${cg}/market_chart?vs_currency=usd&days=${days}`); if (j.prices?.length > 2) return j.prices; } catch (_) {}
  const x = SYM[cg], [iv, n, g] = RANGE[days] || RANGE[7];
  if (!x) return null;
  try { const j = await getJSON(`https://api.binance.com/api/v3/klines?symbol=${x}USDT&interval=${iv}&limit=${n}`); if (j.length > 2) return j.map((k) => [k[0], Number(k[4])]); } catch (_) {}
  try {
    // Coinbase returns at most 300 candles per call, newest first: ask in slices and stitch them together.
    const end = Math.floor(Date.now() / 1000), start = end - days * 86400, out = [];
    for (let a = start; a < end; a += g * 300) {
      const b = Math.min(end, a + g * 300);
      const j = await getJSON(`https://api.exchange.coinbase.com/products/${x}-USD/candles?granularity=${g}&start=${new Date(a * 1000).toISOString()}&end=${new Date(b * 1000).toISOString()}`);
      out.push(...j.map((k) => [k[0] * 1000, Number(k[4])]));
    }
    out.sort((p, q) => p[0] - q[0]);
    if (out.length > 2) return out;
  } catch (_) {}
  return null;
}
function fakeHistory(cg, days, last) {
  const n = 80, now = Date.now(), span = days * 86400_000; let v = 100, seed = days * 7 + cg.length;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const pts = Array.from({ length: n }, (_, i) => { v *= 1 + (rnd() - 0.47) * 0.035; return [now - span + (span * i) / (n - 1), v]; });
  const f = (last || 100) / pts[n - 1][1]; return pts.map(([t, y]) => [t, y * f]);
}
async function loadSeriesFor(cg) {
  const k = `${cg}:${S.range}`, hit = S.series[k];
  if (hit && Date.now() - hit.at < 300_000) return true;
  const days = Number(S.range);
  let pts = S.mock ? fakeHistory(cg, days, S.prices[cg]?.usd) : await historyFrom(cg, days);
  // The web demo runs on pretend money: if every price server is out of reach, it draws a pretend history too.
  if (!pts && globalThis.ECRIN_DEMO) pts = fakeHistory(cg, days, S.prices[cg]?.usd || { solana: 170, ethereum: 3400 }[cg] || 1);
  if (!(pts?.length > 2)) return false;
  S.series[k] = { at: Date.now(), pts }; S.drawChart = true;
  try { const st = await local.get("series"); local.set({ series: { ...(st.series || {}), [k]: { at: Date.now(), pts: pts.length > 200 ? pts.filter((_, i) => i % Math.ceil(pts.length / 200) === 0 || i === pts.length - 1) : pts } } }); } catch (_) {}
  if (S.screen === "home" && !S.scrubbing) render();
  return true;
}

/** Net worth across every network: what each holds in chequing and savings, priced. The current network's own
 *  reading is the freshest, so it wins over the background sweep. */
function worth() {
  const rows = (S.all || []).filter((r) => r.ok && r.k !== S.net);
  if (S.bal) rows.push({ k: S.net, b: S.bal, v: S.vault, ok: true });
  const items = [], coins = {}; let usdc = 0, chq = 0, sav = 0, leaving = 0, vaults = 0; const leaveAmt = {};
  for (const r of rows) {
    const N = NETS[r.k], px = S.prices[N.cg]?.usd, natC = r.b.native || 0, natS = r.v?.main?.balance || 0, uC = r.b.usdc || 0, uS = r.v?.usdc?.balance || 0;
    if (r.v) vaults++;
    leaving += (r.v?.main?.withdrawals?.length || 0) + (r.v?.usdc?.withdrawals?.length || 0);
    for (const x of r.v?.main?.withdrawals || []) leaveAmt[N.unit] = (leaveAmt[N.unit] || 0) + x.amount / BASE;
    for (const x of r.v?.usdc?.withdrawals || []) leaveAmt.USDC = (leaveAmt.USDC || 0) + x.amount / USDC_BASE;
    if (natC + natS > 0) {
      coins[N.cg] = (coins[N.cg] || 0) + (natC + natS) / BASE;
      const c = px != null ? (natC / BASE) * px : 0, v = px != null ? (natS / BASE) * px : 0; chq += c; sav += v;
      items.push({ k: r.k, a: "native", coin: N.unit === "ETH" ? "eth" : r.k, cg: N.cg, unit: N.unit, name: COIN_NAME[N.unit] || N.unit, net: N.name, chq: natC / BASE, sav: natS / BASE, usd: px != null ? c + v : null, dec: N.unit === "SOL" ? 4 : 5 });
    }
    if (uC + uS > 0) {
      usdc += (uC + uS) / USDC_BASE; chq += uC / USDC_BASE; sav += uS / USDC_BASE;
      items.push({ k: r.k, a: "usdc", coin: "usdc", cg: "usdc", unit: "USDC", name: "USD Coin", net: N.name, chq: uC / USDC_BASE, sav: uS / USDC_BASE, usd: (uC + uS) / USDC_BASE, dec: 2 });
    }
  }
  items.sort((x, y) => (y.usd || 0) - (x.usd || 0));
  const lv = Object.entries(leaveAmt), leavingText = lv.length ? `${lv[0][1].toLocaleString("en-US", { maximumFractionDigits: lv[0][0] === "USDC" ? 2 : 4 })} ${lv[0][0]}${lv.length > 1 ? ` +${lv.length - 1} more` : ""}` : "";
  return { items, coins, usdc, chq, sav, total: chq + sav, leaving, leavingText, vaults, ready: rows.length > 0, all: !!S.all };
}

// ------------------------------------------------------------------ screens

function go(screen, extra = {}) { Object.assign(S, { screen }, extra); render(); }

function render() {
  const root = $("#root");
  root.dataset.screen = S.screen;
  root.innerHTML = ({ loading: () => `<div class="splash"><span class="spin-tile">${LOGO}</span></div>`, welcome, createPw, createPhrase, createVerify, importPhrase, unlock, home: homeView, approve: approveView })[S.screen]();
  translate(root, S.lang);
  const f = root.querySelector("[autofocus]"); if (f) f.focus();
  bindHolds(root);
  depth(root);
  bindChart(root);
  if (S.screen === "welcome") mountVault3d(root);
  if (S.screen === "home") { scrollWatch(); S.prevPx = Object.fromEntries(Object.entries(S.prices).map(([k, v]) => [k, v?.usd])); }
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
// Rows glide in the first time they scroll into view (once per session, so refreshes don't replay it).
function reveal(root) {
  S.rv ||= new Set();
  const sc = $("#root"), io = new IntersectionObserver((es) => es.forEach((e) => { if (!e.isIntersecting) return; e.target.classList.add("in"); S.rv.add(e.target.dataset.rk); io.unobserve(e.target); }), { root: sc, rootMargin: "0px 0px -6% 0px" });
  let n = 0;
  root.querySelectorAll(".home .tab-body .arow, .home .sscore, .home .add-tok, .home .list-h, .home .acts button").forEach((el) => {
    const k = [el.className.split(" ")[0], el.dataset.act, el.dataset.u, el.dataset.n, el.dataset.m, el.dataset.p, el.closest(".mkt") ? "m" : ""].join(":") + (el.classList.contains("list-h") ? el.textContent.slice(0, 12) : "");
    el.dataset.rk = k; if (S.rv.has(k)) return;
    el.classList.add("rv"); el.style.setProperty("--d", `${Math.min(n++, 8) * 45}ms`); io.observe(el);
  });
}
// When the big total scrolls away, the header shows it instead.
function scrollWatch() {
  const sc = $("#root"); if (sc._sw) return; sc._sw = true;
  sc.addEventListener("scroll", () => { const h = document.querySelector(".home .hero"); sc.classList.toggle("scrolled", !!h && sc.scrollTop > h.offsetTop + h.offsetHeight * 0.5); }, { passive: true });
}
// Prices refresh every 30 seconds while the home screen is open.
setInterval(() => { if (S.screen === "home" && !document.hidden && ACCT) loadPrices(); }, 30_000);

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
    tip.innerHTML = `<b>${S.hide ? "•••" : money(c.vals[i])}</b>${fmtT(c.times[i])}`; tip.style.left = `${Math.max(14, Math.min(86, (p[0] / W) * 100))}%`;
    if (big && !S.hide) big.innerHTML = fig(money(c.vals[i]));
    const dd = c.vals[i] - c.vals[0], ch = (dd / (c.vals[0] || 1)) * 100;
    const cur = root.querySelector("[data-chg]"); if (cur) cur.outerHTML = deltaHTML(dd, ch, fmtT(c.times[i]), c.coinOnly);
  };
  const leave = () => { S.scrubbing = false; el.classList.remove("scrub"); if (big && keep.big != null) big.innerHTML = keep.big; const cur = root.querySelector("[data-chg]"); if (cur && keep.chg) cur.outerHTML = keep.chg; };
  svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move); ["pointerleave", "pointerup", "pointercancel"].forEach((ev) => svg.addEventListener(ev, leave));
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

const TOUR = [
  { h: "Two places for your money", p: "Your <b>Wallet</b> is for spending, like any crypto wallet. Your <b>Safe</b> is a vault only you control, on every network.", art: "safe" },
  { h: "Nothing leaves the Safe in a hurry", p: "Anything leaving your Safe waits a delay you choose, and you can cancel it the whole time. Even someone with your recovery phrase can't rush it.", art: "clock" },
  { h: "Scams, caught before you sign", p: "Ecrin blocks known scam sites, flags look-alikes, and shows exactly what would leave your wallet before you approve anything.", art: "shield" },
];
function tourArt(k) {
  if (k === "safe") return `<div class="tour-3d"><canvas data-vault3d aria-hidden="true"></canvas></div>`;
  const ring = Array.from({ length: 36 }, (_, i) => { const a = (i / 36) * Math.PI * 2, r0 = 52, r1 = i % 3 ? 58 : 64; return `<path d="M${(80 + Math.cos(a) * r0).toFixed(1)} ${(80 + Math.sin(a) * r0).toFixed(1)}L${(80 + Math.cos(a) * r1).toFixed(1)} ${(80 + Math.sin(a) * r1).toFixed(1)}" style="--i:${i}"/>`; }).join("");
  if (k === "clock") return `<svg class="tour-art" viewBox="0 0 160 160"><g class="t-ring">${ring}</g><circle cx="80" cy="80" r="44" class="soft"/><path class="t-hand" d="M80 80V48"/><path class="t-hand2" d="M80 80h22"/><circle cx="80" cy="80" r="2.5" class="dot"/></svg>`;
  return `<svg class="tour-art" viewBox="0 0 160 160"><g class="t-ring">${ring}</g><path class="t-sh" d="M80 34l34 12v26c0 24-15 40-34 50-19-10-34-26-34-50V46z"/><path class="t-ck" d="M64 80l11 11 22-24"/></svg>`;
}
function tourView() {
  const i = S.tour || 0, t = TOUR[i], last = i === TOUR.length - 1;
  return `<div class="onb tour">
    <div class="tour-top"><span class="mv-mark">${LOGO}<b>ECRIN</b></span><button class="link" data-act="tour-skip">Skip</button></div>
    <div class="onb-art" data-i="${i}">${tourArt(t.art)}</div>
    <div class="onb-copy"><h1>${t.h}</h1><p>${t.p}</p></div>
    <div class="tour-dots">${TOUR.map((_, j) => `<i class="${j === i ? "on" : ""}"></i>`).join("")}</div>
    <div class="onb-acts"><button class="btn primary xl" data-act="tour-next">${last ? "Get started" : "Next"}</button></div>
  </div>`;
}
// One question after the tour: it decides which safety steps the wallet suggests first. Nothing is turned on by itself.
const GOALS = [["savings", "Protect my savings", "From scams, drainers and stolen keys.", "shield"], ["discipline", "Help me stay in control", "Limits and pauses against impulsive trading or gambling.", "clock"], ["both", "Both", "Protection from others, and from myself.", "lock"]];
function goalView() {
  return `<div class="onb tour goal">
    <div class="tour-top"><span class="mv-mark">${LOGO}<b>ECRIN</b></span><button class="link" data-act="goal" data-v="skip">Skip</button></div>
    <div class="onb-copy"><h1>What brings you to Ecrin?</h1><p>We'll suggest the right protections first. You can change everything later.</p></div>
    <div class="goal-l">${GOALS.map(([k, t, d, ic]) => `<button class="goal-o" data-act="goal" data-v="${k}"><span class="goal-ic">${I[ic]}</span><span><b>${t}</b><small>${d}</small></span>${I.arrow}</button>`).join("")}</div>
  </div>`;
}
function welcome() {
  if (S.tour != null && S.tour < TOUR.length) return tourView();
  if (S.tour === TOUR.length && S.askGoal) return goalView();
  return `<div class="onb">
    <div class="onb-art">${miniVault()}</div>
    <div class="onb-copy"><h1>Ecrin Wallet</h1><p>A wallet for spending.<br/>A safe nobody can rush.</p></div>
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
    <div class="mv-top"><span class="mv-mark">${LOGO}<b>ECRIN</b></span><span class="mv-lvl">Safe · 72 h</span></div>
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
    <h2>Your recovery phrase</h2><p class="sub">These 12 words are your wallet. Write them on paper, in order. Anyone who has them can spend your Wallet at once; your Safe still makes them wait.</p>
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
      <div class="fld"><span>Recovery phrase</span><div class="wl-n">${[12, 24].map((n) => `<button type="button" data-act="wn" data-n="${n}" class="${(S.wn || 12) === n ? "on" : ""}">${n} words</button>`).join("")}</div>
        <div class="words">${Array.from({ length: S.wn || 12 }, (_, i) => `<label><span>${i + 1}</span><input data-w="${i}" autocomplete="off" autocapitalize="none" spellcheck="false" ${i === 0 ? "autofocus" : ""}/></label>`).join("")}</div>
        <textarea name="phrase" class="sr-only" tabindex="-1" aria-hidden="true"></textarea><p class="fine">Tip: paste the whole phrase into the first box.</p></div>
      <label class="fld"><span>New password for this computer</span><input name="pw" type="password" autocomplete="new-password" minlength="8" required/></label>
      <div class="meter" data-meter><i></i><i></i><i></i><i></i></div>
      <p class="err" data-err></p>
      <button class="btn primary xl">${S.busy ? "Securing…" : "Import wallet"}</button>
    </form>
  </div>`;
}

function unlock() {
  if (S.bioBusy === "ok") return `<div class="splash bio-done"><span class="spin-tile done"><svg class="bio-ok" viewBox="0 0 24 24"><path d="M6 12.5l4 4L18 8"/></svg></span></div>`;
  if (S.bioBusy) return `<div class="splash"><span class="spin-tile">${LOGO}</span></div>`;
  return `<div class="lock">
    <div class="lock-mark"><i class="halo"></i>${LOGO}</div>
    <h1>Welcome back</h1><p class="sub">Unlock Ecrin Wallet</p>
    ${S.bio ? `<button class="btn primary xl bio-btn" data-act="bio-unlock">${I.face}Unlock with ${bioName()}</button><p class="or">or use your password</p>` : ""}
    <form class="stack" data-form="unlock">
      <label class="fld"><span>Password</span><input name="pw" type="password" autocomplete="current-password" autofocus required/></label>
      <p class="err" data-err></p>
      <button class="btn ${S.bio ? "" : "primary"} xl">${S.busy ? "Unlocking…" : "Unlock"}</button>
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
      <button class="acct" data-act="panel" data-p="accts" title="Your accounts">${acctIc(curAcct())}<span class="acct-n">${esc(curAcct().name)}</span><span class="top-total">${loading ? "" : mask(money(w.total))}</span><span class="acct-a">${short(addr)}${I.chev}</span></button>
      <div class="top-r">
        <button class="ib" data-act="settings" aria-label="Settings">${I.gear}</button>
      </div>
    </header>
    ${S.err ? `<div class="banner">${esc(S.err)}</div>` : ""}
    ${updateBanner()}${backupCard()}
    <section class="hero"><svg class="hero-g" viewBox="0 0 360 230" preserveAspectRatio="xMidYMin slice" aria-hidden="true">${Array.from({ length: 30 }, (_, i) => `<ellipse cx="${180 + Math.sin(i / 2.6) * 6}" cy="${-10 + Math.cos(i / 2.6) * 4}" rx="${40 + i * 9}" ry="${22 + i * 6.2}"/>`).join("")}</svg>
      <div class="hero-l"><span class="lbl">Net worth</span><button class="eye" data-act="hide" aria-label="${S.hide ? "Show" : "Hide"} balances">${S.hide ? I.eyeOff : I.eye}</button></div>
      <div class="big ${loading ? "sk" : ""}">${loading ? "&nbsp;" : mask(fig(money(w.total)))}</div>
      <div class="hero-sub">${chip()}</div>
      ${chartView()}
    </section>
    <section class="accts">
      <button class="acard chq" data-act="panel" data-p="assets" data-tilt><i class="sheen"></i>
        <span class="ac-k">Wallet</span>
        <b class="ac-v ${loading ? "sk" : ""}">${loading ? "&nbsp;" : mask(fig(money(w.chq)))}</b>
        <span class="ac-s"><i class="dot live"></i>Spend instantly</span>
      </button>
      <button class="acard sav" data-act="panel" data-p="vault" data-tilt><i class="sheen"></i>
        <svg class="mv-g" viewBox="0 0 200 140" preserveAspectRatio="xMidYMid slice">${Array.from({ length: 18 }, (_, i) => `<circle cx="${170 + Math.cos(i / 2.2) * 8}" cy="${20 + Math.sin(i / 2.2) * 8}" r="${10 + i * 8}"/>`).join("")}</svg>
        <span class="ac-k">${I.lock}Safe</span>
        <b class="ac-v ${loading ? "sk" : ""}">${loading ? "&nbsp;" : mask(fig(money(w.sav)))}</b>
        <span class="ac-s">${w.leaving ? `<i class="dot warn"></i>${w.leavingText || w.leaving} leaving` : w.vaults ? `<i class="dot"></i>${pct}% of net worth` : `<i class="dot off"></i>Not set up`}</span>
      </button>
    </section>
    ${safetyCard()}
    <nav class="acts">
      ${[["send", "Send", I.send], ["receive", "Receive", I.recv], ["swap", "Swap", I.swap], ["protect", "Protect", I.protect], ["withdraw", "Withdraw", I.out]].map(([p, l, ic]) => `<button data-act="panel" data-p="${p}"><span>${ic}</span>${l}</button>`).join("")}
    </nav>
    <div class="tabs ${S.showNfts ? "t3" : ""}" role="tablist">${[["tokens", "Tokens"], ...(S.showNfts ? [["nfts", "Collectibles"]] : []), ["activity", "Activity"]].map(([t, l]) => `<button role="tab" data-act="tab" data-t="${t}" aria-selected="${S.tab === t}">${l}</button>`).join("")}<i class="tab-ind" style="--i:${{ tokens: 0, nfts: 1, activity: S.showNfts ? 2 : 1 }[S.tab] || 0}"></i></div>
    <div class="tab-body">${S.tab === "activity" ? activityList() : S.tab === "nfts" && S.showNfts ? nftGrid() : tokenList(w)}</div>
    <footer class="foot">${w.all ? "Every network" : "Reading every network…"} · testnet beta</footer>
  </div>`;
}

/** Every coin you hold on every network, biggest first. Tapping one opens Send on its network. */
function tokenList(w) {
  if (!w.ready) return `<section class="list">${[1, 2, 3].map(() => `<div class="arow"><span class="coin sk"></span><span class="ar-t"><b class="sk">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</b><small class="sk">&nbsp;&nbsp;&nbsp;&nbsp;</small></span></div>`).join("")}</section>`;
  if (!w.items.length && !(S.extra || []).length) return `<section class="list"><div class="empty art">${emptyArt("coins")}<b>Your wallet is empty</b><span>Get free test coins to try Ecrin. They're not worth anything.</span><button class="btn sm primary" data-act="panel" data-p="receive">Get test coins</button></div></section>`;
  const n = (v, d) => v.toLocaleString("en-US", { maximumFractionDigits: d });
  let items = S.hideSmall ? w.items.filter((i) => !(i.usd != null && i.usd < 1)) : w.items;
  if (S.order === "name") items = [...items].sort((x, y) => x.name.localeCompare(y.name));
  const hidden = w.items.length - items.length;
  const groups = {}; for (const i of items) (groups[i.unit] ||= []).push(i);
  const row = (i, sub) => {
    const p = i.a === "usdc" ? { usd: 1 } : S.prices[i.cg], ch = i.a === "usdc" ? null : p?.usd_24h_change;
    return `<button class="arow" data-act="tok" data-u="${i.unit}" data-n="${i.k}"><span class="cstack">${coin(i.coin)}${i.coin !== i.k ? `<span class="cmini">${coin(i.k)}</span>` : ""}</span>
      <span class="ar-t"><b>${i.name}</b><small>${i.a === "usdc" ? i.net : p?.usd != null ? `<span class="px${S.prevPx?.[i.cg] != null && S.prevPx[i.cg] !== p.usd ? (p.usd > S.prevPx[i.cg] ? " flash-up" : " flash-dn") : ""}">${money(p.usd)}</span>` : i.net}${ch != null ? ` <span class="${ch >= 0 ? "up" : "dn"}">${ch >= 0 ? "+" : "−"}${Math.abs(ch).toFixed(2)}%</span>` : ""}</small></span>
      ${spark(i.cg)}<span class="ar-r"><b>${i.usd != null ? mask(money(i.usd)) : "—"}</b><small>${mask(n(i.chq + i.sav, i.dec))} ${i.unit}${i.sav ? ` <span class="sv">${I.lock}${mask(n(i.sav, i.dec))}</span>` : ""}</small></span></button>`.replace('class="arow"', `class="arow${sub ? " sub" : ""}"`);
  };
  const out = Object.values(groups).map((g) => {
    if (g.length === 1) return row(g[0]);
    const t = g.reduce((s2, i) => ({ usd: s2.usd + (i.usd || 0), amt: s2.amt + i.chq + i.sav, sav: s2.sav + i.sav }), { usd: 0, amt: 0, sav: 0 }), f = g[0], open = S.open?.[f.unit];
    return `<button class="arow grp" data-act="tok" data-u="${f.unit}"><span class="cstack">${coin(f.a === "usdc" ? "usdc" : f.unit === "ETH" ? "eth" : f.coin)}</span>
      <span class="ar-t"><b>${f.name}</b><small>${g.length} networks ${I.chev}</small></span>${spark(f.cg)}
      <span class="ar-r"><b>${mask(money(t.usd))}</b><small>${mask(n(t.amt, f.dec))} ${f.unit}${t.sav ? ` <span class="sv">${I.lock}${mask(n(t.sav, f.dec))}</span>` : ""}</small></span></button>${open ? g.map((i) => `<button class="arow sub" data-act="row-send" data-n="${i.k}" data-a="${i.a}">${coin(i.k)}<span class="ar-t"><b>${NETS[i.k].name}</b><small>${NETS[i.k].net}</small></span><span class="ar-r"><b>${i.usd != null ? mask(money(i.usd)) : "—"}</b><small>${mask(n(i.chq + i.sav, i.dec))} ${i.unit}</small></span></button>`).join("") : ""}`;
  });
  return `<section class="list">${hidden ? `<div class="hid-note">${hidden} small balance${hidden > 1 ? "s" : ""} hidden</div>` : ""}${out.join("")}${extraRows()}</section>
    ${netKeys().some((k) => NETS[k].fam === "evm") ? `<button class="add-tok" data-act="panel" data-p="addTok">${I.plus}Add a token</button>` : ""}
    ${marketList()}`;
}

// Live prices for every coin Ecrin supports, held or not: something is always moving on the home screen.
const MARKET = [["solana", "SOL", "sol", "Solana"], ["ethereum", "ETH", "eth", "Ethereum"], ["binancecoin", "BNB", "bnb", "BNB"], ["tron", "TRX", "tron", "TRON"], ["avalanche-2", "AVAX", "avax", "Avalanche"], ["polygon-ecosystem-token", "POL", "pol", "Polygon"]];
function marketList() {
  const rows = MARKET.filter(([cg]) => S.prices[cg]?.usd != null);
  if (!rows.length) return "";
  return `<div class="list-h mkt-h"><b>Market</b><span><i class="live-dot"></i>Live</span></div>
    <section class="list mkt">${rows.map(([cg, unit, logo, name]) => { const p = S.prices[cg], ch = p.usd_24h_change, was = S.prevPx?.[cg], fl = was != null && was !== p.usd ? (p.usd > was ? " flash-up" : " flash-dn") : "";
      return `<button class="arow" data-act="tok" data-u="${unit}">${coin(logo)}<span class="ar-t"><b>${name}</b><small>${unit}</small></span>${spark(cg)}
        <span class="ar-r"><b class="px${fl}">${money(p.usd)}</b><small class="${ch >= 0 ? "up" : "dn"}">${ch >= 0 ? "+" : "−"}${Math.abs(ch ?? 0).toFixed(2)}%</small></span></button>`; }).join("")}</section>`;
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
  // A coin whose history hasn't arrived yet counts at today's price, so one slow server never blanks the chart.
  const want = cgs.length ? cgs : [NETS[S.net].cg];
  const have = want.filter((cg) => S.series[`${cg}:${S.range}`]);
  if (!have.length) {
    if (!w.ready || w.total == null) return null;
    const now = Date.now(), span = Number(S.range) * 86400_000;
    return { times: Array.from({ length: M }, (_, i) => now - span + (span * i) / (M - 1)), vals: Array(M).fill(w.total), coinOnly: false, flat: true };
  }
  const flatPts = (cg) => [[0, S.prices[cg]?.usd || 0]];
  const list = [...have, ...want.filter((cg) => !have.includes(cg))].map((cg) => [cg, S.series[`${cg}:${S.range}`] || { pts: flatPts(cg) }]);
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
  // A gentle moving average so the line reads as a trend, not noise.
  const sm = c.vals.map((_, i) => { const a = Math.max(0, i - 2), b = Math.min(c.vals.length - 1, i + 2); let t = 0; for (let j = a; j <= b; j++) t += c.vals[j]; return t / (b - a + 1); });
  sm[0] = c.vals[0]; sm[sm.length - 1] = c.vals[c.vals.length - 1];
  const xy = sm.map((v, i) => [(i / (sm.length - 1)) * W, 8 + (1 - (v - lo) / span) * (H - 16)]);
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
    <i class="ch-pin"></i><span class="ch-tip"></span>
    ${ranges}
  </div>`;
}

const COIN_NAME = { SOL: "Solana", ETH: "Ether", POL: "Polygon", BNB: "BNB", AVAX: "Avalanche", TRX: "TRON", USDC: "USD Coin" };
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

const ACT = { send: ["Sent", I.send], protect: ["Moved to Safe", I.protect], withdraw: ["Withdrawal started", I.clock], release: ["Released to Wallet", I.recv], cancel: ["Withdrawal cancelled", I.shield], vault: ["Safe opened", I.lock] };
/** Every network at once: reads chequing and savings on each, prices them, and adds it all up. */
async function loadAll() {
  const { dev } = await local.get("dev");
  const rows = await Promise.all(netKeys().map(async (k) => {
    try {
      const e = k === S.net && ENG ? ENG : engine({ web3, ethers, acct: ACCT, net: k, dev: dev || {} });
      const [b, v] = await Promise.all([e.balances(), e.vault().catch(() => null)]);
      return { k, b, v, ok: true };
    } catch (_) { return { k, ok: false }; }
  }));
  S.all = rows;
  loadExtras(dev);
  if (S.panel?.p === "all") { S.panel.rows = rows; renderPanel(); }
  if (S.panel?.p === "vault" || S.panel?.p === "rules") renderPanel();
  if (S.screen === "home" && !S.scrubbing) render();
  loadSeries();
}

// ------------------------------------------------------------------ every other token, spam hiding, collectibles

// Names that scam airdrops use to lure you to a site. Tokens like this are hidden until you choose to show them.
const SPAM_RE = /(https?:|www\.|\.(com|io|xyz|net|org|app|site|online|top|fun|vip|gift|info|live|claims?)\b|claim|visit|airdrop|reward|bonus|free\s|voucher|\$\d|✅|🎁)/i;
const isSpam = (t) => SPAM_RE.test(`${t.name || ""} ${t.symbol || ""}`);
const tokHidden = (t) => (S.tokPref?.[t.mint] === "hide") || (S.tokPref?.[t.mint] !== "show" && isSpam(t));
const tokAmt = (t) => Number(BigInt(t.raw)) / 10 ** t.dec;
const tokName = (t) => t.name || t.symbol || `Token ${short(t.mint)}`;
const ipfs = (u) => String(u || "").replace(/^ipfs:\/\//, "https://ipfs.io/ipfs/").replace(/^ar:\/\//, "https://arweave.net/");
const safeImg = (u) => (/^https:\/\/[^\s"'<>]+$/.test(u) ? u : "");
async function loadExtras(dev) {
  const pr = await local.get(["tokPref", "tokList", "nftMeta"]); S.tokPref = pr.tokPref || {}; S.tokList = pr.tokList || {};
  const meta = pr.nftMeta || {};
  const lists = await Promise.all(netKeys().map(async (k) => {
    try {
      const e = k === S.net && ENG ? ENG : engine({ web3, ethers, acct: ACCT, net: k, dev: dev || {} });
      if (!e.listTokens) return [];
      return (await e.listTokens(NETS[k].fam === "evm" ? S.tokList[k] || [] : undefined)).map((t) => ({ ...t, k }));
    } catch (_) { return []; }
  }));
  S.delegs = lists.flat().filter((t) => t.delegate);
  S.extra = lists.flat().filter((t) => !t.usdc && BigInt(t.raw || 0) > 0n);
  // Pictures for collectibles (and token logos): read each item's public metadata file once, never for hidden spam.
  const need = S.extra.filter((t) => t.uri && !meta[t.mint] && !tokHidden(t)).slice(0, 24);
  await Promise.all(need.map(async (t) => {
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 6000);
      const j = await (await fetch(ipfs(t.uri), { signal: ctl.signal, credentials: "omit", referrerPolicy: "no-referrer" })).json(); clearTimeout(tm);
      meta[t.mint] = { img: safeImg(ipfs(j.image)), desc: String(j.description || "").slice(0, 400), col: String(j.collection?.name || j.symbol || "").slice(0, 40) };
    } catch (_) { meta[t.mint] = { img: "" }; }
  }));
  if (need.length) await local.set({ nftMeta: meta });
  S.nftMeta = meta;
  if (S.screen === "home" && !S.scrubbing) render();
  if (S.panel?.p === "xtok" || S.panel?.p === "nft") renderPanel();
}
/** Calm line drawings for empty screens, in the same thin-laser style as the Safe. */
function emptyArt(kind) {
  const dia = (x, y, r) => `<path d="M${x - r} ${y - r * 0.35}L${x - r * 0.55} ${y - r}H${x + r * 0.55}L${x + r} ${y - r * 0.35}L${x} ${y + r}Z M${x - r} ${y - r * 0.35}H${x + r} M${x - r * 0.55} ${y - r}L${x - r * 0.25} ${y - r * 0.35}L${x} ${y + r}L${x + r * 0.25} ${y - r * 0.35}L${x + r * 0.55} ${y - r}"/>`;
  const rays = (x, y, n, r0, r1) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return `<path class="ray" d="M${(x + Math.cos(a) * r0).toFixed(1)} ${(y + Math.sin(a) * r0).toFixed(1)}L${(x + Math.cos(a) * r1).toFixed(1)} ${(y + Math.sin(a) * r1).toFixed(1)}"/>`; }).join("");
  const body = {
    nft: `<rect x="34" y="18" width="52" height="52" rx="8"/><rect x="42" y="26" width="52" height="52" rx="8" class="soft"/>${dia(60, 44, 11)}`,
    act: `<path d="M30 60h60M30 46h44M30 32h52" class="soft"/>${dia(92, 34, 9)}`,
    coins: `<ellipse cx="60" cy="58" rx="26" ry="7" class="soft"/><ellipse cx="60" cy="50" rx="26" ry="7" class="soft"/>${dia(60, 30, 13)}${rays(60, 30, 12, 18, 24)}`,
    safe: `<rect x="32" y="20" width="56" height="52" rx="9"/><circle cx="60" cy="46" r="13" class="soft"/>${dia(60, 46, 7)}`,
  }[kind] || "";
  return `<svg class="eart" viewBox="0 0 120 90" aria-hidden="true">${body}</svg>`;
}
function letterIc(t) {
  const known = { USDT: "usdt", USDC: "usdc" }[String(t.symbol || "").toUpperCase()]; if (known) return coin(known);
  const m = S.nftMeta?.[t.mint]?.img, ch = esc((t.symbol || t.name || "?").replace(/[^\p{L}\p{N}]/gu, "").charAt(0).toUpperCase() || "?");
  const hue = [...t.mint].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return m ? `<span class="coin img"><img src="${esc(m)}" alt="" loading="lazy" referrerpolicy="no-referrer"/></span>` : `<span class="coin letter" style="--h:${hue}">${ch}</span>`;
}
function extraRows() {
  const list = (S.extra || []).filter((t) => !t.nft), shown = list.filter((t) => !tokHidden(t)), hid = list.length - shown.length;
  const n = (v) => v.toLocaleString("en-US", { maximumFractionDigits: v < 1 ? 6 : 2 });
  const row = (t) => `<button class="arow${tokHidden(t) ? " muted" : ""}" data-act="xtok" data-m="${esc(t.mint)}" data-n="${t.k}"><span class="cstack">${letterIc(t)}<span class="cmini">${coin(t.k)}</span></span>
    <span class="ar-t"><b>${esc(tokName(t))}</b><small>${NETS[t.k].name}${isSpam(t) ? ` · <span class="dn">Likely spam</span>` : ""}</small></span>
    <span class="ar-r"><b>${mask(n(tokAmt(t)))}</b><small>${esc((t.symbol || "").slice(0, 10))}</small></span></button>`;
  return shown.map(row).join("") + (hid ? `<button class="hid-note btnish" data-act="tog-hidden">${I.eyeOff}${hid} hidden token${hid > 1 ? "s" : ""} · ${S.showHid ? "Hide them" : "Show"}</button>${S.showHid ? list.filter(tokHidden).map(row).join("") : ""}` : "");
}
function nftGrid() {
  const all = (S.extra || []).filter((t) => t.nft), list = all.filter((t) => !tokHidden(t)), hid = all.length - list.length;
  if (!S.extra) return `<section class="nfts">${[1, 2, 3, 4].map(() => `<div class="nft sk"></div>`).join("")}</section>`;
  if (!list.length) return `<section class="list"><div class="empty art">${emptyArt("nft")}<b>No collectibles yet</b><span>NFTs you own on Solana show up here.${hid ? ` ${hid} hidden as likely spam.` : ""}</span></div></section>`;
  return `<section class="nfts">${list.map((t) => { const m = S.nftMeta?.[t.mint] || {}; return `<button class="nft" data-act="nft" data-m="${esc(t.mint)}">${m.img ? `<img src="${esc(m.img)}" alt="" loading="lazy" referrerpolicy="no-referrer"/>` : `<span class="nft-ph">${I.img}</span>`}<span class="nft-n">${esc(tokName(t))}</span></button>`; }).join("")}</section>
    ${hid ? `<p class="fine pad">${hid} collectible${hid > 1 ? "s" : ""} hidden as likely spam.</p>` : ""}`;
}
function xtokView() {
  const P = S.panel, t = (S.extra || []).find((x) => x.mint === P.m && x.k === P.n);
  if (!t) return `${phead("Token")}<p class="fine pad">This token isn't in this account anymore.</p>`;
  const N = NETS[t.k], m = S.nftMeta?.[t.mint] || {}, hidden = tokHidden(t);
  if (P.step === "sending") return `${phead("Sending")}<div class="sending"><i class="spin"></i><p>Sending ${esc(tokName(t))}…</p></div>`;
  if (P.step === "done") return doneView("Sent", `${esc(P.amount)} ${esc(t.symbol || tokName(t))} is on its way.`);
  if (P.step === "review") return `${phead("Review")}
    <div class="rv-amt">${letterIc(t)}<b>${esc(P.amount)} <small>${esc(t.symbol || "")}</small></b><span>${esc(tokName(t))}</span></div>
    <div class="tk-info"><div><span>From</span><b>${esc(curAcct().name)}</b></div><div><span>To</span><b class="mono wrap">${esc(P.to)}</b></div><div><span>Network</span><b>${N.name} ${N.net}</b></div><div><span>Network fee</span><b>${esc(N.fam === "sol" ? "≈ 0.000005 SOL" : "a little " + N.unit + " for gas")}</b></div></div>
    ${P.fresh ? `<div class="note warn">${I.shield}<span>You've never sent to this address from Ecrin. Check the first and last characters against where you copied it.</span></div>` : ""}
    <div class="pfoot">${hold("Hold to send")}<button class="btn ghost" data-act="x-back">Back</button></div>`;
  return `${phead(t.nft ? "Collectible" : esc(t.symbol || "Token"))}
    ${t.nft ? `<div class="nft-big">${m.img ? `<img src="${esc(m.img)}" alt="" referrerpolicy="no-referrer"/>` : `<span class="nft-ph">${I.img}</span>`}</div>` : `<div class="tk-top">${letterIc(t)}<span><b>${esc(tokName(t))}</b><small>${N.name}</small></span></div>
    <div class="tk-bal"><b>${mask(tokAmt(t).toLocaleString("en-US", { maximumFractionDigits: 6 }))} ${esc(t.symbol || "")}</b><small>No market price on test networks</small></div>`}
    ${t.nft ? `<h3 class="nft-t">${esc(tokName(t))}</h3>${m.col ? `<p class="fine">${esc(m.col)}</p>` : ""}${m.desc ? `<p class="tk-about">${esc(m.desc)}</p>` : ""}` : ""}
    ${isSpam(t) ? `<div class="note warn">${I.warn}<span>This looks like a scam airdrop: its name points you to a website. Don't visit it or try to sell it there, it's how drainers get you.</span></div>` : ""}
    ${hidden && !isSpam(t) ? "" : ""}
    ${!t.nft && !isSpam(t) ? `<div class="xsend"><label class="fld"><span>Send to</span><input data-xto placeholder="${addrHint(N)}" value="${esc(P.to || "")}" autocomplete="off" spellcheck="false"/></label>
      <label class="fld"><span>Amount</span><input data-xamt inputmode="decimal" placeholder="0" value="${esc(P.amount || "")}"/></label>
      <button class="btn primary" data-act="xsend">${I.send}Review and send</button></div>` : ""}
    <div class="tk-info"><div><span>Network</span><b>${N.name} ${N.net}</b></div><div><span>Token address</span><b class="mono">${short(t.mint)} <button class="ib sm" data-act="copy" data-v="${esc(t.mint)}" aria-label="Copy">${I.copy}</button></b></div></div>
    <div class="acc-acts"><a class="btn" href="${N.explorer(N.fam === "evm" || N.fam === "tron" ? "token" : "address", t.mint)}" target="_blank">${I.ext}Explorer</a>
      <button class="btn" data-act="tok-pref" data-m="${esc(t.mint)}">${hidden ? `${I.eye}Show in list` : `${I.eyeOff}Hide`}</button></div>`;
}
/** Who can move your tokens without asking again, and a Revoke button for each. */
async function loadPerms() {
  const P = S.panel; if (!P || P.p !== "perms") return;
  const { apLog = [], dev } = await local.get(["apLog", "dev"]);
  const mineE = ACCT.evm?.address, seen = new Set(), evm = [];
  for (const e of apLog) {
    if (!e.permit?.spender || !e.permit?.token || e.from !== mineE || e.kind !== "tx") continue;
    const id = `${e.k}:${e.permit.token}:${e.permit.spender}`.toLowerCase(); if (seen.has(id)) continue; seen.add(id);
    evm.push({ ...e.permit, k: e.k, origin: e.origin });
  }
  const live = await Promise.all(evm.filter((x) => NETS[x.k]).map(async (x) => {
    try { const e = engine({ web3, ethers, acct: ACCT, net: x.k, dev: dev || {} }); const left = await e.allowance(x.token, x.spender); return left > 0n ? { ...x, left: String(left) } : null; } catch (_) { return null; }
  }));
  P.evm = live.filter(Boolean); P.sol = S.delegs || []; P.ready = true;
  P.permits = apLog.filter((e) => e.kind === "typed" && e.permit && e.from === mineE).length;
  renderPanel();
}
function permsView() {
  const P = S.panel;
  if (!P.ready) return `${phead("Permissions")}<div class="ap-load"><div class="sk"></div><div class="sk"></div><small>Checking every network…</small></div>`;
  const big = (v) => BigInt(v) > 10n ** 30n;
  const sol = P.sol.map((t) => `<div class="arow perm"><span class="cstack">${letterIc(t)}<span class="cmini">${coin(t.k)}</span></span>
      <span class="ar-t"><b>${esc(t.usdc ? "USDC" : tokName(t))}</b><small>${short(t.delegate)} can move ${Number(BigInt(t.delegated)) / 10 ** t.dec} without asking</small></span>
      <button class="btn sm danger" data-act="revoke" data-f="sol" data-acct="${esc(t.acct)}">Revoke</button></div>`);
  const evm = P.evm.map((x, i) => `<div class="arow perm"><span class="cstack"><span class="coin letter" style="--h:210">${I.ban}</span><span class="cmini">${coin(x.k)}</span></span>
      <span class="ar-t"><b>${esc(host(x.origin))}</b><small>${short(x.spender)} can take ${big(x.left) ? "ALL" : "some"} of token ${short(x.token)}</small></span>
      <button class="btn sm danger" data-act="revoke" data-f="evm" data-i="${i}">Revoke</button></div>`);
  const all = [...sol, ...evm];
  return `${phead("Permissions")}
    <p class="fine">Sites you used may still be allowed to move your tokens without asking again. Drainers rely on old permissions you forgot about. Revoke any you don't need.</p>
    <section class="list">${all.length ? all.join("") : `<div class="empty art">${emptyArt("safe")}<b>No open permissions</b><span>Nobody can move your tokens without asking you first.</span></div>`}</section>
    ${P.permits ? `<p class="fine pad">You also signed ${P.permits} permit${P.permits > 1 ? "s" : ""} (off-chain signatures). They expire on their own and can't be listed here.</p>` : ""}`;
}

function addTokView() {
  const P = S.panel, evm = netKeys().filter((k) => NETS[k].fam === "evm");
  return `${phead("Add a token")}<div class="pad">
    <p class="fine">Ethereum-style networks don't list every token an address holds. Paste a token's contract address to follow it.</p>
    <label class="fld"><span>Network</span><select data-tnet>${evm.map((k) => `<option value="${k}" ${k === (P.net || S.net) ? "selected" : ""}>${NETS[k].name}</option>`).join("")}</select></label>
    <label class="fld"><span>Token contract</span><input data-taddr placeholder="0x…" autocomplete="off" spellcheck="false"/></label>
    <div class="pfoot"><button class="btn primary xl" data-act="tok-add" ${P.busy ? "disabled" : ""}>${P.busy ? `<i class="spin"></i>` : ""}Add token</button></div></div>`;
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
  const coins = Object.values(byCoin).sort((a, b) => b.usd - a.usd), COL = { SOL: "#9945ff", ETH: "#7d97ff", POL: "#a26bff", BNB: "#f0b90b", AVAX: "#e84142", TRX: "#ff060a", USDC: "#2775ca" };
  const n = (v, d) => v.toLocaleString("en-US", { maximumFractionDigits: d });
  return `${phead("All assets")}
    <div class="all-total"><span class="lbl">Across every network</span><div class="big">${mask(fig(money(total)))}</div>
      <span class="sub">${total ? `${Math.round((saved / total) * 100)}% protected in your Safe` : "Nothing here yet"}</span></div>
    ${total ? `<div class="alloc">${coins.map((c) => `<i style="flex:${c.usd || 0.0001};background:${COL[c.unit] || "#888"}"></i>`).join("")}</div>
    <div class="alloc-l">${coins.map((c) => `<span><i style="background:${COL[c.unit] || "#888"}"></i>${c.unit} ${Math.round((c.usd / total) * 100)}%</span>`).join("")}</div>` : ""}
    <div class="list-h"><b>By network</b><span>Wallet · Safe</span></div>
    <section class="list">${items.length ? items.sort((a, b) => (b.usd || 0) - (a.usd || 0)).map((i) => `<button class="arow" data-act="net-go" data-n="${i.k}"><span class="cstack">${coin(i.coin)}${i.coin === "usdc" || i.coin !== i.k ? `<span class="cmini">${coin(i.k)}</span>` : ""}</span>
      <span class="ar-t"><b>${i.name}</b><small>${i.net} · ${mask(n(i.chq, i.dec))}${i.sav ? ` <span class="sv">${I.lock}${mask(n(i.sav, i.dec))}</span>` : ""}</small></span>
      <span class="ar-r"><b>${i.usd != null ? mask(money(i.usd)) : "—"}</b><small>${mask(n(i.chq + i.sav, i.dec))} ${i.unit}</small></span></button>`).join("")
      : `<div class="empty">${I.shield}<b>No coins yet</b><span>Use Receive to get test coins on any network.</span></div>`}</section>
    ${rows.some((r) => !r.ok) ? `<p class="fine pad">Couldn't reach ${rows.filter((r) => !r.ok).map((r) => NETS[r.k].name).join(", ")} right now.</p>` : ""}`;
}

const host = (o) => { try { return new URL(o).hostname.replace(/^www\./, ""); } catch (_) { return String(o || "a website"); } };
const nameFor = (k, a) => (a && S.book?.[NETS[k]?.fam]?.[a]) || null;
const who = (k, a) => esc(nameFor(k, a) || short(a));
/** Activity from every network of this account, newest first, plus coins received (read from the chain) and website approvals. */
async function loadActivity() {
  const keys = netKeys(), addrOf = (k) => (NETS[k].fam === "sol" ? ACCT.sol?.publicKey.toBase58() : NETS[k].fam === "tron" ? (ACCT.tron ? toTron(ACCT.tron.address) : null) : ACCT.evm?.address);
  const st = await local.get([...keys.map((k) => `act:${k}:${addrOf(k)}`), "apLog"]);
  let list = keys.flatMap((k) => (st[`act:${k}:${addrOf(k)}`] || []).map((e) => ({ ...e, k })));
  const mine = new Set(keys.map(addrOf).filter(Boolean));
  list.push(...(st.apLog || []).filter((e) => mine.has(e.from)));
  const merge = () => { const seen = new Set(list.map((x) => x.sig).filter(Boolean)); S.activity = [...list, ...(S.hist || []).filter((x) => !seen.has(x.sig))].sort((x, y) => y.at - x.at); if (S.tab === "activity") paintActivity(); };
  merge();
  if (S.histAt && Date.now() - S.histAt < 30_000) return; S.histAt = Date.now();
  if (!keys.includes("sol")) return;
  try {
    const { dev } = await local.get("dev"); const e = S.net === "sol" && ENG ? ENG : engine({ web3, ethers, acct: ACCT, net: "sol", dev: dev || {} });
    S.hist = ((await e.history?.()) || []).map((x) => ({ ...x, k: "sol" })); merge();
  } catch (_) {}
}
const ACT_LBL = {
  send: (e) => [`Sent to ${who(e.k, e.to)}`, I.send, "out"], tsend: (e) => [e.to ? `Sent ${esc(e.sym || "tokens")} to ${who(e.k, e.to)}` : `Sent ${esc(e.sym || "tokens")}`, I.send, "out"],
  recv: (e) => [e.from ? `Received from ${who(e.k, e.from)}` : "Received", I.recv, "in"], protect: () => ["Moved to Safe", I.protect, ""],
  withdraw: () => ["Withdrawal started", I.clock, ""], release: () => ["Released to Wallet", I.recv, "in"], cancel: () => ["Withdrawal cancelled", I.shield, ""],
  vault: () => ["Safe opened", I.lock, ""], swap: (e) => [`Swapped ${esc(e.from || "")} for ${esc(e.to || "")}`, I.swap, ""], revoke: (e) => [e.site ? `Removed ${esc(host(e.site))}'s permission` : "Removed a token permission", I.ban, ""],
  freeze: () => ["Safe frozen", I.snow, ""], auto: () => ["Protected automatically", I.protect, ""],
  ap: (e) => [{ connect: `Connected to ${host(e.origin)}`, sign: `Signed a message on ${host(e.origin)}`, solmsg: `Signed a message on ${host(e.origin)}`, typed: `${e.permit ? "Approved spending on" : "Signed for"} ${host(e.origin)}`, tx: `${e.permit ? "Approved spending on" : "Approved a transaction on"} ${host(e.origin)}`, soltx: `Approved a transaction on ${host(e.origin)}`, delegate: "Gave a token permission" }[e.kind] || `Approved on ${host(e.origin)}`, e.permit ? I.warn : I.link, e.permit ? "warn" : ""],
};
function actRows() {
  const q = (S.actQ || "").trim().toLowerCase(), all = S.activity || [];
  const when = (ms) => (ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  const rows = all.map((e) => { const [title, ic, cls] = (ACT_LBL[e.t] || (() => ["Transaction", I.arrow, ""]))(e); return { e, title, ic, cls }; })
    .filter((r) => !q || `${r.title} ${r.e.to || ""} ${r.e.from || ""} ${r.e.origin || ""} ${NETS[r.e.k]?.name || ""}`.toLowerCase().includes(q));
  if (!rows.length) return `<div class="empty">${I.search}<b>Nothing matches “${esc(q)}”</b><span>Try a name, an address or a site.</span></div>`;
  let day = "";
  return rows.slice(0, 120).map(({ e, title, ic, cls }) => {
    const d = e.at ? new Date(e.at).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : "Earlier", head = d !== day ? `<div class="act-day">${(day = d)}</div>` : "";
    const N = NETS[e.k] || NETS.sol, unit = e.sym || (e.a === "usdc" ? "USDC" : N.unit), val = e.n ? (e.a === "usdc" ? e.n / USDC_BASE : e.t === "tsend" ? e.n : e.n / BASE) : null;
    const sign = cls === "out" ? "−" : cls === "in" ? "+" : "";
    const tag = e.sig && e.k ? `a href="${N.explorer("tx", e.sig)}" target="_blank"` : "div";
    return `${head}<${tag} class="arow act-row ${e.t} ${cls}"><span class="act-ico">${ic}${e.k ? `<span class="cmini">${coin(e.k)}</span>` : ""}</span>
      <span class="ar-t"><b>${title}</b><small>${when(e.at)}${e.k ? ` · ${N.name}` : ""}</small></span>
      ${val != null ? `<span class="ar-r"><b class="${cls === "out" ? "neg" : cls === "in" ? "pos" : ""}">${sign}${mask(val.toLocaleString("en-US", { maximumFractionDigits: 6 }))} ${esc(unit)}</b></span>` : ""}</${tag.split(" ")[0]}>`;
  }).join("");
}
function activityList() {
  const list = S.activity || [];
  if (!list.length) return `<section class="list"><div class="empty art">${emptyArt("act")}<b>Nothing here yet</b><span>Sends, receives, Safe moves and website approvals show up here.</span><button class="btn sm primary" data-act="panel" data-p="receive">Receive your first coins</button></div></section>`;
  return `<label class="act-q">${I.search}<input data-actq placeholder="Search names, addresses, sites" value="${esc(S.actQ || "")}" autocomplete="off" spellcheck="false"/></label><section class="list" id="actl">${actRows()}</section>`;
}
function paintActivity() { const el = $("#actl"); if (el) { el.innerHTML = actRows(); translate(el, S.lang); } else if (S.screen === "home" && !S.panel) render(); }

function delay(s) { return s >= 86400 && s % 86400 === 0 ? `${s / 86400} day${s / 86400 > 1 ? "s" : ""}` : `${Math.round(s / 3600)} h`; }
function dur(s) { if (s <= 0) return "ready"; const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; }

// ------------------------------------------------------------------ panels (slide over the home screen)

function openPanel(p, opts = {}) { S.panel = { p, step: "form", asset: opts.a || "native", amount: "", to: "", ...opts }; renderPanel(true); }
function closePanel() { const el = $("#panel"); el.classList.remove("in"); document.body.classList.remove("stacked"); setTimeout(() => { if (!S.panel) el.innerHTML = ""; }, 260); S.panel = null; render(); }

function renderPanel(enter = false) {
  const el = $("#panel"), P = S.panel;
  if (!P) return;
  const body = ({ send: sendView, receive: receiveView, protect: moveView, withdraw: moveView, vault: vaultView, assets: assetsView, settings: settingsView, reveal: revealView, numbers: numbersView, backup: backupView, pick: pickView, tok: tokenView, rules: rulesView, all: allView, buy: buyView, perms: permsView, safety: safetyView, xtok: xtokView, nft: xtokView, addTok: addTokView, addrs: addrsView, accts: acctsView, acctNew: acctNewView, sites: sitesView, swap: swapView, earn: earnView })[P.p]();
  el.innerHTML = `<div class="pane${enter || P.fresh ? " fresh" : ""}">${body}</div>`; translate(el, S.lang);
  P.fresh = false;
  if (enter) requestAnimationFrame(() => { el.classList.add("in"); document.body.classList.add("stacked"); });
  bindHolds(el); depth(el); mountVault3d(el); bindTokChart(el);
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
  if (P.step === "done") return doneView("Sent", `${amt(P.sent, a)} ${A(a).unit} is on its way${bookName(P.to.trim()) ? ` to ${esc(bookName(P.to.trim()))}` : ""}.`, bookName(P.to.trim()) ? "" : `<div class="book-save"><input data-bookname placeholder="Name this address (optional)" maxlength="24" autocomplete="off"/><button class="btn sm" data-act="book-save">Save</button></div>`);
  if (P.step === "review" || P.step === "sending") {
    const self = P.to.trim() === e.address;
    return `${phead("Review")}
      <div class="rev">
        <div class="rev-amt">${assetCoin(a, "lg")}<b>${fig(amt(units, a))}</b><span>${A(a).unit}</span><small>${usdOf(units, a) != null ? money(usdOf(units, a)) : ""}</small></div>
        <dl class="rev-l">
          <div><dt>From</dt><dd>Wallet · ${short(e.address)}</dd></div>
          <div><dt>To</dt><dd class="mono">${esc(P.to.trim())}</dd></div>
          <div><dt>Network</dt><dd>${NETS[S.net].name} ${NETS[S.net].net}</dd></div>
          <div><dt>Network fee</dt><dd>${e.feeText()}</dd></div>
        </dl>
        ${self ? `<p class="warn-n">That's your own address.</p>` : P.fresh ? `<p class="warn-n">${I.shield}<span>You've never sent to this address from Ecrin. Check the first and last characters against where you copied it.</span></p>` : ""}
      </div>
      ${P.coolUntil > Date.now() ? `<div class="cool"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/><circle class="cl-p" cx="20" cy="20" r="17" style="stroke-dashoffset:${(106.8 * (P.coolUntil - Date.now())) / (S.guard.cool * 1000)}"/></svg><span><b data-cool>${Math.ceil((P.coolUntil - Date.now()) / 1000)}s</b><small>Cooling-off pause for big sends. Take a breath: is this really who you think it is?</small></span></div>` : ""}
      <div class="pfoot">${P.coolUntil > Date.now() ? `<button class="hold" disabled><span class="hold-t">${I.clock}Wait for the pause</span></button>` : hold(P.step === "sending" ? "Sending…" : "Hold to send", P.step === "sending")}</div>`;
  }
  const valid = units > 0 && units <= sendMax() && e.isAddress(P.to);
  return `${phead("Send")}
    ${fromRow()}${assetPick()}
    ${amountBlock(sendMax(), "Wallet")}
    <label class="fld to"><span>To</span><div class="in-btn"><input data-to placeholder="${addrHint(NETS[S.net])}" value="${esc(P.to)}" spellcheck="false" autocomplete="off"/><button type="button" class="ib sm" data-act="paste" aria-label="Paste">${I.paste}</button></div></label>
    ${P.to && !e.isAddress(P.to) ? `<p class="err">That isn't a ${NETS[S.net].name} address.</p>` : ""}
    ${bookName(P.to.trim()) ? `<p class="book-to">${I.check}Sending to <b>${esc(bookName(P.to.trim()))}</b></p>` : ""}
    ${bookList().length ? `<div class="book">${bookList().map(([a, n]) => `<button class="${P.to.trim() === a ? "on" : ""}" data-act="book-pick" data-a="${esc(a)}"><i>${esc(n.slice(0, 1).toUpperCase())}</i>${esc(n)}</button>`).join("")}</div>` : ""}
    <div class="pfoot"><button class="btn primary xl" data-act="review" ${valid ? "" : "disabled"}>Review</button></div>`;
}

// ------------------------------------------------------------------ guard rails on the Wallet side (this device)

const todayKey = () => new Date().toISOString().slice(0, 10);
/** Daily spending limit across every network, in dollars. Raising it waits 24 hours; lowering is instant. */
async function limitCheck(usd) {
  const G = S.guard; if (!G.daily || usd == null) return null;
  const { spent = {} } = await local.get("spent"), used = spent[todayKey()] || 0;
  if (used + usd > G.daily) return `That's over your daily spending limit (${money(G.daily)}, ${money(Math.max(0, G.daily - used))} left today). Change it in Settings → Safety.`;
  return null;
}
async function countSpend(usd) { if (usd == null) return; const { spent = {} } = await local.get("spent"), k = todayKey(); await local.set({ spent: { [k]: (spent[k] || 0) + usd } }); }
function coolTick() {
  const P = S.panel; if (!P || !P.coolUntil) return;
  if (Date.now() >= P.coolUntil) return renderPanel();
  const el = $("[data-cool]"); if (el) el.textContent = Math.ceil((P.coolUntil - Date.now()) / 1000) + "s";
  const c = $(".cl-p"); if (c) c.style.strokeDashoffset = (106.8 * (P.coolUntil - Date.now())) / (S.guard.cool * 1000);
  requestAnimationFrame(coolTick);
}
async function saveGuard() { await local.set({ guard: S.guard }); }
async function applyPendingLimit() {
  const G = S.guard; if (G.pend && G.pend.at <= Date.now()) { G.daily = G.pend.v; delete G.pend; await saveGuard(); }
}

/** Protect automatically: part of every payment that arrives goes straight into the Safe on that network. */
async function autoProtect(bal) {
  const G = S.guard, key = `${S.net}:${ENG?.address}`, { autoSeen = {} } = await local.get("autoSeen");
  const was = autoSeen[key]; autoSeen[key] = bal.native; await local.set({ autoSeen });
  if (!G.auto || was == null || !(bal.native > was) || !S.vault || Date.now() - (S.lastTx || 0) < 90_000 || S.autoBusy) return;
  const amount = Math.floor(((bal.native - was) * G.auto) / 100);
  const fee = NETS[S.net].fam === "sol" ? 3_000_000 : 0, minimum = NETS[S.net].fam === "sol" ? 1_000_000 : 1_000;
  if (amount < minimum || amount + fee > bal.native) return;
  S.autoBusy = true;
  try { S.lastTx = Date.now(); await ENG.protect("native", amount); S.lastTx = Date.now(); await logActivity({ t: "auto", a: "native", n: amount }); autoSeen[key] = bal.native - amount; await local.set({ autoSeen }); toast(`${amt(amount, "native")} ${NETS[S.net].unit} protected automatically`, "win"); refresh(); loadAll(); }
  catch (e) { console.warn(e); } finally { S.autoBusy = false; }
}

/** How protected you are, 0–100, and what would raise it. */
function safety() {
  const w = worth(), G = S.guard, vaults = (S.all || []).filter((r) => r.v).length;
  const share = w.total ? w.sav / w.total : 0, perms = (S.delegs || []).length;
  const items = [
    { ok: !S.backup || S.backup.done, pts: 25, t: "Recovery phrase checked", tip: "Check your 12 words are written down", act: "panel", p: "backup" },
    { ok: vaults > 0, pts: 20, t: "Safe set up", tip: "Set up your Safe", act: "panel", p: "vault" },
    { ok: share >= 0.5, pts: 15, t: "Most of your money is in the Safe", tip: `Move more into your Safe (${Math.round(share * 100)}% now)`, act: "panel", p: "protect" },
    { ok: S.alertsOn, pts: 10, t: "Safe alerts on", tip: "Turn on Telegram or email alerts", act: "panel", p: "rules" },
    { ok: S.autolock > 0 && S.autolock <= 15, pts: 10, t: "Auto-lock in 15 minutes or less", tip: "Lock the wallet sooner", act: "settings" },
    { ok: perms === 0, pts: 10, t: "No open token permissions", tip: `Revoke ${perms} token permission${perms > 1 ? "s" : ""}`, act: "perms" },
    { ok: !!(G.daily || G.cool), pts: 10, t: "Spending limit or cooling-off on", tip: "Add a spending limit", act: "panel", p: "safety" },
  ];
  // Your answer to "What brings you to Ecrin?" decides which step is suggested first.
  const first = S.goal === "discipline" ? ["Spending limit or cooling-off on", "Safe set up"] : S.goal === "savings" ? ["Safe set up", "Safe alerts on", "No open token permissions"] : [];
  items.sort((a, b) => ((first.indexOf(b.t) + 1 || 99) < (first.indexOf(a.t) + 1 || 99) ? 1 : (first.indexOf(a.t) + 1 || 99) < (first.indexOf(b.t) + 1 || 99) ? -1 : 0));
  return { score: items.reduce((s2, i) => s2 + (i.ok ? i.pts : 0), 0), items };
}
function safetyCard() {
  if (!S.all) return "";
  const { score, items } = safety(), next = items.find((i) => !i.ok);
  return `<button class="sscore" data-act="panel" data-p="safety"><span class="ss-ring" style="--v:${score}"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5"/><circle class="ss-p" cx="18" cy="18" r="15.5"/></svg><b>${score}</b></span>
    <span class="ss-t"><b>Safety score</b><small>${next ? esc(next.tip) : "You're well protected"}</small></span>${I.arrow}</button>`;
}
function safetyView() {
  const { score, items } = safety(), G = S.guard;
  const lim = [0, 100, 250, 500, 1000, 5000], cool = [[0, "Off"], [60, "1 min"], [300, "5 min"], [900, "15 min"]], auto = [0, 10, 25, 50];
  return `${phead("Safety")}
    <div class="ss-hero"><span class="ss-ring lg" style="--v:${score}"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5"/><circle class="ss-p" cx="18" cy="18" r="15.5"/></svg><b>${score}</b></span>
      <span><b>${score >= 85 ? "Well protected" : score >= 55 ? "Getting there" : "At risk"}</b><small>Each step makes a drainer's job harder.</small></span></div>
    <section class="list">${items.map((i) => `<${i.ok ? "div" : `button data-act="${i.act}"${i.p ? ` data-p="${i.p}"` : ""}`} class="arow ss-i ${i.ok ? "ok" : ""}"><span class="ss-c">${i.ok ? I.check : ""}</span><span class="ar-t"><b>${esc(i.ok ? i.t : i.tip)}</b></span><span class="ss-pts">+${i.pts}</span></${i.ok ? "div" : "button"}>`).join("")}</section>
    <button class="freeze-btn" data-act="freeze-now">${I.snow}<span><b>Freeze my Safe now</b><small>Nothing leaves your Safe on any network for 24 hours. Use it the moment something feels wrong.</small></span></button>
    <div class="list-h"><b>Protect automatically</b><span>${G.auto ? `${G.auto}% of each payment` : "Off"}</span></div>
    <p class="fine">When coins arrive in your Wallet, this share goes straight into your Safe on that network (while Ecrin is open).</p>
    <span class="seg wide">${auto.map((v) => `<button data-act="guard" data-k="auto" data-v="${v}" aria-pressed="${G.auto === v}">${v ? v + "%" : "Off"}</button>`).join("")}</span>
    <div class="list-h"><b>Daily spending limit</b><span>${G.daily ? money(G.daily) : "None"}</span></div>
    <p class="fine">Sends from your Wallet stop at this amount per day, on every network. Lowering it is instant; raising it waits 24 hours, so a scammer rushing you can't lift it.${G.pend ? ` <b>Changing to ${G.pend.v ? money(G.pend.v) : "no limit"} on ${new Date(G.pend.at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}.</b>` : ""}</p>
    <span class="seg wide">${lim.map((v) => `<button data-act="guard" data-k="daily" data-v="${v}" aria-pressed="${G.daily === v}">${v ? "$" + (v >= 1000 ? v / 1000 + "k" : v) : "None"}</button>`).join("")}</span>
    <div class="list-h"><b>Cooling-off pause</b><span>${G.cool ? `over ${money(G.coolOver)}` : "Off"}</span></div>
    <p class="fine">A short wait before any send over ${money(G.coolOver)}. Scams work by rushing you; the pause gives you time to notice.</p>
    <span class="seg wide">${cool.map(([v, l]) => `<button data-act="guard" data-k="cool" data-v="${v}" aria-pressed="${G.cool === v}">${l}</button>`).join("")}</span>
    <p class="fine pad">The limit and the pause protect this device. Your Safe's own rules protect your money even from someone who has your recovery phrase.</p>`;
}

function hold(label, busy) {
  return `<button class="hold ${busy ? "busy" : ""}" data-hold ${busy ? "disabled" : ""}><span class="hold-fill"></span><span class="hold-t">${busy ? `<i class="spin"></i>` : I.shield}${label}</span></button>`;
}

function doneView(title, text, extra = "") {
  const mark = title === "Sent" ? `<svg class="fx-sent" viewBox="0 0 120 120" aria-hidden="true"><g class="streaks"><path d="M30 92 L62 60"/><path d="M40 100 L68 72"/><path d="M22 82 L52 52"/></g><g class="dia"><path class="d-o" pathLength="100" d="M60 22 L88 50 L60 98 L32 50 Z"/><path class="d-f" pathLength="100" d="M32 50 H88 M46 36 L60 50 L74 36 M60 50 V98 M46 36 L52 50 M74 36 L68 50"/></g><circle class="ring" cx="60" cy="60" r="34" pathLength="100"/><path class="tick" pathLength="100" d="M45 61 L55 71 L76 49"/></svg>` : null;
  if (mark) return `<div class="done">${mark}<h2>${title}</h2><p>${text}</p>
    ${S.panel.sig ? `<a class="link" href="${NETS[S.net].explorer("tx", S.panel.sig)}" target="_blank">View on the explorer ${I.ext}</a>` : ""}${extra}
    <div class="pfoot"><button class="btn primary xl" data-act="close">Done</button></div></div>`;
  return `<div class="done"><div class="done-mark"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="29"/><path d="M20 33l8 8 16-17"/></svg></div><h2>${title}</h2><p>${text}</p>
    ${S.panel.sig ? `<a class="link" href="${NETS[S.net].explorer("tx", S.panel.sig)}" target="_blank">View on the explorer ${I.ext}</a>` : ""}${extra}
    <div class="pfoot"><button class="btn primary xl" data-act="close">Done</button></div></div>`;
}

/** Every address this account has, network by network, like MetaMask's account view. */
function addrsView() {
  const sol = ACCT.sol?.publicKey.toBase58(), evm = ACCT.evm?.address, tron = ACCT.tron && !ACCT.only ? toTron(ACCT.tron.address) : null, A0 = curAcct();
  // The full address in one piece; the first and last four characters stand out, since those are what people check.
  const groups = (a) => `<b>${esc(a.slice(0, 4))}</b>${esc(a.slice(4, -4))}<b>${esc(a.slice(-4))}</b>`;
  const card = (k, a, title, note, nets) => `<article class="ad-card">
      <header class="ad-h">${coin(k)}<span><b>${title}</b><small>${note}</small></span><button class="ib sm" data-act="qr-for" data-n="${k}" aria-label="Show QR code">${I.qr}</button></header>
      <div class="ad-a mono" data-notr>${groups(a)}</div>
      ${nets ? `<div class="ad-nets">${nets.map((n) => `<span title="${esc(NETS[n].name)}">${coin(n)}<small>${esc(NETS[n].name)}</small></span>`).join("")}</div>` : ""}
      <button class="ad-copy" data-act="copy" data-v="${esc(a)}">${I.copy}<span>Copy address</span></button>
    </article>`;
  const evmNets = Object.keys(NETS).filter((k) => NETS[k].fam === "evm");
  return `${phead("Addresses")}
    <div class="ad-hero">${acctIc(A0, "lg")}<span><b>${esc(A0.name)}</b><small>${A0.kind === "key" ? "Imported private key" : "From your recovery phrase"}</small></span></div>
    <div class="ad-list">
      ${sol ? card("sol", sol, "Solana", "SOL, USDC and Solana tokens") : ""}
      ${evm ? card("eth", evm, "Ethereum-style networks", `One address for all ${evmNets.length}`, evmNets) : ""}
      ${tron ? card("tron", tron, "Tron", "TRX and USDT") : ""}
    </div>
    <p class="fine pad">Only send coins to the matching network. Coins sent to the right address on the wrong network may be lost.</p>`;
}

/** A round account mark in the account's colour, with its first letter. */
function acctIc(a, cls = "") {
  const col = COLORS[(a?.c ?? 0) % COLORS.length], letter = esc((a?.name || "A").trim().charAt(0).toUpperCase());
  return `<span class="acct-ic av ${cls}" style="--ac:${col}">${letter}</span>`;
}
const acctAddr = (a) => a.kind === "key" ? a.pub : a.id === S.sel ? (ACCT.sol?.publicKey.toBase58() || ACCT.evm?.address) : deriveAccount(PHRASE, { web3, ethers }, a.i).sol.publicKey.toBase58();

/** Every account in this wallet. Tap one to switch; add another from the phrase, or import a private key. */
function acctsView() {
  const P = S.panel, list = S.accts || DEF_ACCTS;
  return `${phead("Accounts")}
    <section class="list accts-l">${list.map((a) => `<div class="arow acc-row${a.id === S.sel ? " on" : ""}">
      <button class="acc-main" data-act="acct-switch" data-id="${a.id}">${acctIc(a)}<span class="ar-t"><b>${esc(a.name)}</b><small class="mono">${short(acctAddr(a))}${a.kind === "key" ? ` · <span class="tagk">${a.fam === "sol" ? "Solana key" : "Ethereum key"}</span>` : ""}</small></span>${a.id === S.sel ? `<span class="acc-ok">${I.check}</span>` : ""}</button>
      <button class="ib sm" data-act="acct-edit" data-id="${a.id}" aria-label="Rename ${esc(a.name)}">${I.pen}</button></div>
      ${P.edit === a.id ? `<div class="acc-edit"><input data-acct-name value="${esc(a.name)}" maxlength="24" aria-label="Account name"/><button class="btn sm primary" data-act="acct-save" data-id="${a.id}">Save</button>
        ${a.id !== "hd0" ? `<button class="btn sm ghost danger" data-act="acct-remove" data-id="${a.id}">${a.kind === "key" ? "Remove" : "Hide"}</button>` : ""}</div>` : ""}`).join("")}</section>
    <div class="acc-acts">
      <button class="btn" data-act="acct-add">${I.plus}Add account</button>
      <button class="btn" data-act="panel" data-p="acctNew">${I.key}Import key</button>
    </div>
    <button class="srow" data-act="panel" data-p="addrs"><span>${I.qr}Addresses of ${esc(curAcct().name)}</span><span class="sv">${I.arrow}</span></button>
    <p class="fine pad">Accounts you add come from your recovery phrase, so your backup covers them. Imported keys are not in your recovery phrase: keep their own backup.</p>`;
}

function acctNewView() {
  return `${phead("Import private key")}
    <div class="pad">
      <p class="fine">Paste a private key from another wallet. Solana keys come from Phantom or Solflare (Settings → Show private key). Ethereum keys are 64 characters.</p>
      <label class="fld"><span>Private key</span><textarea data-pk rows="3" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Paste the key"></textarea></label>
      <label class="fld"><span>Name</span><input data-pkname maxlength="24" placeholder="Imported ${(S.accts || []).filter((a) => a.kind === "key").length + 1}"/></label>
      <div class="note warn">${I.shield}<span>Never paste a private key a website or a person asked you for. Ecrin keeps it encrypted on this device only.</span></div>
      <div class="pfoot"><button class="btn primary xl" data-act="acct-import">Import</button></div>
    </div>`;
}

function receiveView() {
  const e = ENG, N = NETS[S.net];
  const q = qrcode(0, "H"); q.addData(e.address); q.make(); // high error correction: the logo in the middle can't break it
  return `${phead("Receive")}${fromRow()}
    <div class="recv">
      <div class="qr">${q.createSvgTag({ cellSize: 5, margin: 0, scalable: true })}<span class="qr-c">${(() => { const m = S.panel?.asset === "usdc" ? "usdc" : N.unit === "ETH" ? "eth" : S.net; return coin(m) + (m !== S.net ? `<span class="qr-b">${coin(S.net)}</span>` : ""); })()}</span></div>
      <p class="recv-n">Your ${N.name} address</p>
      ${navigator.share ? `<button class="btn sm share" data-act="share-addr">${I.send}Share address</button>` : ""}
      <button class="addr" data-act="copy-addr"><span class="mono">${esc(e.address)}</span>${I.copy}</button>
      <p class="fine">Only send ${N.name} ${N.net} coins${N.usdc ? " or USDC" : ""} to this address. ${N.fam === "tron" ? "Tron addresses start with T. Test USDT on Nile shows with your tokens." : ""}${N.fam === "evm" ? "The same address works on every Ethereum-style network." : ""}</p>
      <a class="link" href="${N.faucet}" target="_blank">Get free test ${N.unit} ${I.ext}</a>
      <button class="btn sm buy-b" data-act="panel" data-p="buy">${I.card}Buy with a card</button>
    </div>`;
}

/** Protect (chequing → savings) and Withdraw (savings → chequing, after the delay). */
function moveView() {
  const P = S.panel, e = ENG, a = P.asset, isIn = P.p === "protect", v = S.vault;
  if (!v) return createVaultView(isIn ? "Protect" : "Withdraw");
  const units = parseAmt(P.amount, a), main = v.main, tv = a === "usdc" ? v.usdc : main;
  const max = isIn ? sendMaxProtect() : tv?.available || 0;
  if (P.step === "done") return isIn ? doneView("Protected", `${amt(P.sent, a)} ${A(a).unit} is in your Safe. Anything leaving it waits ${delay(main.withdrawDelay)}.`) : doneView("Withdrawal started", `${amt(P.sent, a)} ${A(a).unit} reaches your Wallet in ${delay(main.withdrawDelay)}. You can cancel it until then.`);
  const lim = a === "usdc" ? v.usdc?.dailyLimit : main.dailyLimit, overLim = !isIn && lim && units > lim;
  const valid = units > 0 && units <= max && !overLim;
  return `${phead(isIn ? "Protect" : "Withdraw")}
    <div class="flowline ${isIn ? "in" : "out"}"><span>${isIn ? "Wallet" : "Safe"}</span><i></i><span>${isIn ? "Safe" : "Wallet"}</span></div>
    ${fromRow()}${assetPick()}
    ${amountBlock(max, isIn ? "Wallet" : "Safe, free to leave")}
    ${overLim ? `<p class="err">Over your daily limit of ${amt(lim, a)} ${A(a).unit}. Split it into smaller withdrawals.</p>` : ""}
    <p class="note">${isIn ? `${I.lock}<span>Once inside, anything leaving waits <b>${delay(main.withdrawDelay)}</b>, and you can cancel it the whole time. Not even someone with your recovery phrase can rush it.</span>` : `${I.clock}<span>Arrives in your Wallet in <b>${delay(main.withdrawDelay)}</b>${main.lockedUntil && now() < main.lockedUntil ? " and not before the lock ends" : ""}. You can cancel it any time before.</span>`}</p>
    <div class="pfoot">${P.step === "sending" ? hold(isIn ? "Protecting…" : "Starting…", true) : `<button class="btn primary xl" data-act="${isIn ? "do-protect" : "do-withdraw"}" ${valid ? "" : "disabled"}>${isIn ? "Move to Safe" : "Start withdrawal"}</button>`}</div>`;
}
function sendMaxProtect() { const a = S.panel.asset; return a === "native" ? Math.max(0, (S.bal?.native || 0) - (S.panel.reserve || 0) - (NETS[S.net].fam === "sol" ? 3_000_000 : 0)) : S.bal?.usdc || 0; }

function createVaultView(title) {
  const P = S.panel, other = (S.all || []).find((r) => r.v && r.k !== S.net);
  if (other && !P.kind) P.kind = other.v.main.withdrawDelay >= 72 * 3600 ? "strong" : "gentle";
  const same = other ? `<p class="note">${I.lock}<span>Same rules as your Safe on ${NETS[other.k].name}: <b>${delay(other.v.main.withdrawDelay)}</b> delay. One tap opens it here too.</span></p>` : "";
  return `${phead(title)}
    <div class="cv">
      <div class="cv-art">${miniVault()}</div>
      <h2>Open your Safe</h2>
      <p class="sub">Money you move here can't leave in a hurry: every withdrawal waits, and you can cancel it the whole time. Your Wallet stays instant.</p>
      <div class="presets">
        ${[["gentle", "Gentle", "24 h", "Lighter protection"], ["strong", "Strong", "72 h", "Recommended"]].map(([k, n, d, s]) => `<button class="preset ${P.kind === k || (!P.kind && k === "strong") ? "on" : ""}" data-act="kind" data-k="${k}"><b>${n}</b><span class="pd">${d}</span><small>${s}</small></button>`).join("")}
      </div>
    </div>
    ${S.bal && !S.bal.native ? `<p class="note">${I.recv}<span>Your Wallet has no ${NETS[S.net].unit} yet. Opening your Safe costs a tiny network fee. <a class="link" href="${NETS[S.net].faucet}" target="_blank">Get free test ${NETS[S.net].unit} ${I.ext}</a></span></p>` : ""}
    ${same}<div class="pfoot">${P.step === "sending" ? hold("Opening…", true) : `<button class="btn primary xl" data-act="create-vault" ${S.bal && !S.bal.native ? "disabled" : ""}>Open vault</button>`}</div>`;
}

/** One Safe for everything: every network that has a vault, each in its own section, with its own delay, balances
 *  and withdrawals. Actions switch to that network first, so nothing depends on the network picker. */
function vaultView() {
  const rows = S.all;
  if (!rows) return `${phead("Safe")}<div class="vcase safe-all"><div class="mv-top"><span class="mv-mark">${LOGO}<b>ECRIN</b></span><span class="mv-lvl">Every network</span></div><div class="sa-tot"><span class="lbl">Protected</span><b class="sk">&nbsp;</b></div></div>`;
  const mine = [ACCT?.sol?.publicKey?.toBase58?.(), ACCT?.evm?.address?.toLowerCase?.()].filter(Boolean);
  const isMine = (d) => mine.includes(String(d)) || mine.includes(String(d).toLowerCase());
  const t = now() + (S.clockOff || 0), px = (k) => S.prices[NETS[k].cg]?.usd;
  const live = rows.filter((r) => r.ok).map((r) => (r.k === S.net && S.vault !== undefined ? { ...r, v: S.vault } : r));
  const open = live.filter((r) => r.v), closed = Object.values(NETS).filter((N) => netKeys().includes(N.key) && (N.fam === "sol" || N.contract) && !open.some((r) => r.k === N.key));
  const usdOf = (r) => ((r.v.main.balance / BASE) * (px(r.k) || 0)) + ((r.v.usdc?.balance || 0) / USDC_BASE);
  const total = open.reduce((x, r) => x + usdOf(r), 0);
  const section = (r) => {
    const N = NETS[r.k], v = r.v, main = v.main;
    const list = [...main.withdrawals.map((w) => ({ ...w, a: "native" })), ...(v.usdc?.withdrawals || []).map((w) => ({ ...w, a: "usdc" }))].sort((x, y) => x.readyAt - y.readyAt);
    const line = (a, units) => `<span class="sn-l">${a === "usdc" ? coin("usdc") : coin(r.k)}<b>${mask(fig(amt(units, a)))}</b><small>${a === "usdc" ? "USDC" : N.unit}</small></span>`;
    return `<section class="snet">
      <div class="sn-h">${coin(r.k)}<span class="sn-t"><b>${N.name}</b><small>${delay(main.withdrawDelay)} delay</small></span><span class="sn-v">${px(r.k) != null || v.usdc ? mask(money(usdOf(r))) : ""}</span></div>
      <div class="sn-b">${line("native", main.balance)}${N.usdc && (N.fam === "sol" || N.tokens) ? line("usdc", v.usdc?.balance || 0) : ""}</div>
      ${list.map((w) => { const left = w.readyAt - t, ready = left <= 0; const unit = w.a === "usdc" ? "USDC" : N.unit;
        return `<div class="wrow ${ready ? "ready" : ""}">${w.a === "usdc" ? coin("usdc") : coin(r.k)}<span class="wr-t"><b>${amt(w.amount, w.a)} ${unit}</b><small>to ${isMine(w.dest) ? "your Wallet" : short(String(w.dest))}</small></span>
          <span class="wr-r"><b class="cd">${ready ? "Ready" : dur(left)}</b>${ready ? `<button class="btn sm primary" data-act="execute" data-n="${r.k}" data-id="${w.id}" data-a="${w.a}" data-d="${esc(String(w.dest))}">Release</button>` : ""}<button class="btn sm danger" data-act="cancel-w" data-n="${r.k}" data-id="${w.id}" data-a="${w.a}">Cancel</button></span></div>`; }).join("")}
      <div class="sn-a"><button class="btn sm" data-act="safe-go" data-n="${r.k}" data-p="protect">${I.protect}Protect</button><button class="btn sm" data-act="safe-go" data-n="${r.k}" data-p="withdraw">${I.out}Withdraw</button></div>
    </section>`;
  };
  const waiting = open.reduce((x, r) => x + r.v.main.withdrawals.length + (r.v.usdc?.withdrawals?.length || 0), 0);
  return `${phead("Safe")}
    <div class="vcase safe-all"><div class="v3d"><canvas data-vault3d aria-hidden="true"></canvas></div><div class="mv-top"><span class="mv-mark">${LOGO}<b>ECRIN</b></span><span class="mv-lvl">Every network</span></div>
      <div class="sa-tot"><span class="lbl">Protected</span><b>${mask(fig(money(total)))}</b><small>${open.length ? `${open.length} network${open.length > 1 ? "s" : ""} · ${waiting ? `${waiting} waiting to leave` : "nothing waiting to leave"}` : "Not opened yet"}</small></div></div>
    <button class="earn-card rules-card" data-act="panel" data-p="rules"><span class="ec-ic">${I.shield}</span><span class="ec-t"><b>Rules and alerts</b><small>Delay, daily limit, guardian, trusted addresses, freeze, Telegram and email alerts</small></span>${I.arrow}</button>
    <button class="earn-card" data-act="panel" data-p="earn"><span class="ec-ic">${I.spark}</span><span class="ec-t"><b>Earn on your Safe</b><small>Stake SOL without taking it out · about ${STAKE_APY_TEXT} a year</small></span><span class="soon">Coming soon</span></button>
    ${open.map(section).join("") || `<div class="empty">${I.shield}<b>Your Safe is empty</b><span>Open it on any network below. Anything leaving it waits, and you can cancel it the whole time.</span></div>`}
    ${closed.length ? `<div class="list-h"><b>Add a network</b><span>same Safe</span></div>
      <section class="list">${closed.map((N) => `<button class="arow" data-act="safe-go" data-n="${N.key}" data-p="protect">${coin(N.key)}<span class="ar-t"><b>${N.name}</b><small>${N.net} · not opened</small></span><span class="ar-r"><b class="sn-open">Open</b></span></button>`).join("")}</section>` : ""}
    <a class="link center" href="https://ecrinprotocol.app/app" target="_blank">Rules, guardian and alerts on ecrinprotocol.app ${I.ext}</a>`;
}
const vaultLine = (a, units) => `<div class="vl">${assetCoin(a)}<b>${mask(fig(amt(units, a)))}</b><span>${A(a).unit}</span></div>`;

function assetsView() {
  const t = totals();
  return `${phead("Wallet")}
    <p class="sub pad">Your everyday wallet. It sends at once, like any wallet. Keep what you trade with here, and the rest in your Safe.</p>
    <section class="list">${assetRow("native", t.b.native, t.vn)}${NETS[S.net].usdc ? assetRow("usdc", t.b.usdc, t.vu) : ""}</section>
    <div class="vacts"><button class="btn" data-act="panel" data-p="send">${I.send}Send</button><button class="btn" data-act="panel" data-p="receive">${I.recv}Receive</button></div>`;
}

function settingsView() {
  return `${phead("Settings")}
    <div class="sets">
      <div class="srow"><span>${I.clock}Auto-lock</span><span class="seg">${[0, 1, 5, 15, 60].map((m) => `<button data-act="autolock" data-v="${m}" aria-pressed="${S.autolock === m}">${m === 0 ? "Always" : m < 60 ? m + "m" : "1h"}</button>`).join("")}</span></div>
      <div class="srow"><span>${I.globe}Language</span><span class="seg">${LANGS.map(([k, l]) => `<button data-act="lang" data-v="${k}" aria-pressed="${S.lang === k}">${l}</button>`).join("")}</span></div>
      <div class="srow"><span>${S.theme === "dark" ? I.moon : I.sun}Appearance</span><span class="seg">${["light", "dark"].map((t) => `<button data-act="theme" data-v="${t}" aria-pressed="${S.theme === t}">${t === "light" ? "Light" : "Dark"}</button>`).join("")}</span></div>
      <button class="srow" data-act="panel" data-p="numbers"><span><b class="nf-ico">1.2</b>Numbers</span><span class="sv">${NUM_FACES.find(([k]) => k === S.nums.face)[1]} ${I.arrow}</span></button>
      ${globalThis.ECRIN_WEB || globalThis.ECRIN_DEMO ? "" : `<button class="srow" data-act="panel" data-p="sites"><span>${I.link}Connected sites</span><span class="sv">${I.arrow}</span></button>`}
      ${globalThis.ECRIN_WEB && bioPossible() ? `<button class="srow" data-act="bio-toggle"><span>${I.face}${bioName() === "Face ID" ? "Face ID" : "Biometric unlock"}</span><span class="sv">${S.bio ? "On" : "Off"} ${I.arrow}</span></button>` : ""}
      <button class="srow" data-act="tog" data-k="recvNotify"><span>${I.recv}Notify when I receive coins</span><span class="sv">${S.recvNotify === false ? "Off" : "On"}</span></button>
      <button class="srow" data-act="tog" data-k="showNfts"><span>${I.img}Show collectibles (NFTs)</span><span class="sv">${S.showNfts ? "On" : "Off"}</span></button>
      <button class="srow" data-act="tog" data-k="hideSmall"><span>${I.eyeOff}Hide balances under $1</span><span class="sv">${S.hideSmall ? "On" : "Off"}</span></button>
      <button class="srow" data-act="tog" data-k="order"><span>${I.arrow}Order coins by</span><span class="sv">${S.order === "name" ? "Name" : "Value"}</span></button>
      <button class="srow" data-act="panel" data-p="safety"><span>${I.shield}Safety: limits, auto-protect, freeze</span><span class="sv">${I.arrow}</span></button>
      <button class="srow" data-act="perms"><span>${I.ban}Token permissions</span><span class="sv">${I.arrow}</span></button>
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
const errText = (e) => {
  const raw = String(e?.shortMessage || e?.message || e);
  if (/insufficient funds/i.test(raw)) return `Not enough ${NETS[S.net].unit} for this and the network fee. Use Receive to get free test coins.`;
  let m; try { m = ENG?.explain?.(e)?.message || raw; } catch (_) { m = raw; }
  return m.length > 160 ? m.slice(0, 157) + "…" : m;
};

const actKey = () => `act:${S.net}:${ENG?.address || ""}`;
async function readActivity() { const k = actKey(), o = await local.get(k); return o[k] || []; }
async function logActivity(e) { const k = actKey(), list = await readActivity(); await local.set({ [k]: [{ at: Date.now(), ...e }, ...list].slice(0, 60) }); }

async function txRun(fn, after, log) {
  if (S.upd?.must) return toast("A security update is required before you can send. Update Ecrin Wallet first.", "err");
  const P = S.panel; P.step = "sending"; renderPanel();
  try { S.lastTx = Date.now(); const sig = await fn(); S.lastTx = Date.now(); P.sig = typeof sig === "string" ? sig : null; await after?.(); if (log) await logActivity({ ...log, sig: P.sig }); P.step = "done"; await refresh(); loadActivity(); loadAll(); }
  catch (e) { console.warn(e); P.step = "form"; toast(errText(e), "err"); }
  renderPanel();
}

async function knownDest(to) { const { sent = {} } = await local.get("sent"); return !!sent[`${S.net}:${to}`]; }
async function rememberDest(to) { const { sent = {} } = await local.get("sent"); sent[`${S.net}:${to}`] = Date.now(); await local.set({ sent }); }

async function useNet(n) {
  if (!n || n === S.net) return;
  S.net = n; await local.set({ net: S.net }); S.bal = null; S.vault = undefined; ENG = null; S.drawChart = true;
  await eng(); loadActivity(); await refresh(); loadSeries();
}

async function saveAccts() { await local.set({ accts: S.accts }); }
const actions = {
  lang: async (el) => { S.lang = el.dataset.v; document.documentElement.lang = S.lang; await local.set({ lang: S.lang }); render(); renderPanel(); },
  "tour-next": () => { S.tour = (S.tour || 0) + 1; if (S.tour >= TOUR.length) { local.set({ toured: true }); S.askGoal = true; } render(); },
  "tour-skip": () => { S.tour = TOUR.length; S.askGoal = true; local.set({ toured: true }); render(); },
  goal: async (el) => { const v = el.dataset.v; S.askGoal = false; if (v !== "skip") { S.goal = v; await local.set({ goal: v }); } render(); },
  guard: async (el) => {
    const G = S.guard, k = el.dataset.k, v = Number(el.dataset.v);
    if (k === "daily" && G.daily && (v === 0 || v > G.daily)) { G.pend = { v, at: Date.now() + 86400_000 }; toast("Raising the limit takes 24 hours. Lowering is instant.", "win"); }
    else { G[k] = v; if (k === "daily") delete G.pend; }
    await saveGuard(); renderPanel(); render();
  },
  "freeze-now": async (el) => {
    const open = (S.all || []).filter((r) => r.v);
    if (!open.length) return toast("Set up your Safe first: there's nothing to freeze yet.", "err");
    if (!confirm("Freeze your Safe on every network for 24 hours? Nothing can leave, including withdrawals already waiting. A freeze can't be ended early.")) return;
    el.disabled = true; el.classList.add("busy");
    try { await applyEverywhere([["all", { kind: "SetLockedUntil", value: now() + 86400 + 120 }]]); await logActivity({ t: "freeze" }); toast("Frozen for 24 hours on every network", "win"); loadAll(); }
    catch (e) { toast(errText(e), "err"); }
    el.disabled = false; el.classList.remove("busy");
  },
  revoke: async (el) => {
    const P = S.panel, { dev } = await local.get("dev");
    const item = el.dataset.f === "sol" ? P.sol.find((t) => t.acct === el.dataset.acct) : P.evm[Number(el.dataset.i)];
    if (!item) return;
    el.disabled = true; el.innerHTML = `<i class="spin"></i>`;
    try {
      const e = engine({ web3, ethers, acct: ACCT, net: item.k, dev: dev || {} });
      const sig = await e.revoke(item);
      const k = `act:${item.k}:${e.address}`, o = await local.get(k); await local.set({ [k]: [{ at: Date.now(), t: "revoke", site: item.origin || "", sig: typeof sig === "string" ? sig : null }, ...(o[k] || [])].slice(0, 60) });
      toast("Permission removed", "win"); await loadExtras(dev); P.ready = false; renderPanel(); loadPerms();
    } catch (err) { el.disabled = false; el.textContent = "Revoke"; toast(errText(err), "err"); }
  },
  perms: () => { openPanel("perms"); loadPerms(); },
  xtok: (el) => openPanel("xtok", { m: el.dataset.m, n: el.dataset.n }),
  nft: (el) => { const t = (S.extra || []).find((x) => x.mint === el.dataset.m); if (t) openPanel("nft", { m: t.mint, n: t.k }); },
  "tog-hidden": () => { S.showHid = !S.showHid; render(); },
  "tok-pref": async (el) => {
    const t = (S.extra || []).find((x) => x.mint === el.dataset.m); if (!t) return;
    S.tokPref = { ...S.tokPref, [t.mint]: tokHidden(t) ? "show" : "hide" }; await local.set({ tokPref: S.tokPref });
    toast(tokHidden(t) ? "Hidden from your list" : "Shown in your list"); renderPanel(); render();
  },
  "tok-add": async () => {
    const k = $("[data-tnet]")?.value, addr = ($("[data-taddr]")?.value || "").trim();
    if (!ethers.isAddress(addr)) return toast("That isn't a token contract address.", "err");
    S.panel.busy = true; S.panel.net = k; renderPanel();
    try {
      const { dev } = await local.get("dev"); const e = engine({ web3, ethers, acct: ACCT, net: k, dev: dev || {} });
      const info = await e.tokenInfo(addr);
      const list = S.tokList[k] || []; if (list.some((t) => t.mint === info.mint)) throw new Error("You already follow this token.");
      S.tokList = { ...S.tokList, [k]: [...list, info] }; await local.set({ tokList: S.tokList });
      toast(`${info.symbol} added`); closePanel(); loadExtras(dev);
    } catch (e) { S.panel.busy = false; renderPanel(); toast(/already/.test(e.message) ? e.message : "Couldn't read a token at that address on this network.", "err"); }
  },
  xsend: async () => {
    const P = S.panel, t = (S.extra || []).find((x) => x.mint === P.m && x.k === P.n);
    P.to = ($("[data-xto]")?.value || "").trim(); P.amount = ($("[data-xamt]")?.value || "").trim().replace(",", ".");
    const { dev } = await local.get("dev"); const e = engine({ web3, ethers, acct: ACCT, net: t.k, dev: dev || {} });
    if (!e.isAddress(P.to)) return toast(`That isn't a ${NETS[t.k].name} address.`, "err");
    const v = Number(P.amount); if (!(v > 0)) return toast("Enter an amount.", "err");
    const [w, f = ""] = P.amount.split("."); if (f.length > t.dec) return toast(`This token has ${t.dec} decimals at most.`, "err");
    const raw = BigInt(w || "0") * 10n ** BigInt(t.dec) + BigInt((f + "0".repeat(t.dec)).slice(0, t.dec) || "0");
    if (raw > BigInt(t.raw)) return toast("You don't have that much.", "err");
    P.raw = String(raw); P.fresh = !(await knownDest(P.to)); P.step = "review"; renderPanel();
  },
  "x-back": () => { S.panel.step = "form"; renderPanel(); },
  "acct-switch": (el) => el.dataset.id === S.sel ? closePanel() : switchAccount(el.dataset.id),
  "acct-edit": (el) => { S.panel.edit = S.panel.edit === el.dataset.id ? null : el.dataset.id; renderPanel(); setTimeout(() => $("[data-acct-name]")?.select(), 30); },
  "acct-save": async (el) => {
    const v = ($("[data-acct-name]")?.value || "").trim().slice(0, 24); if (!v) return toast("Give the account a name.", "err");
    S.accts = (S.accts || DEF_ACCTS).map((a) => (a.id === el.dataset.id ? { ...a, name: v } : a)); await saveAccts(); S.panel.edit = null; renderPanel(); render();
  },
  "acct-remove": async (el) => {
    const a = S.accts.find((x) => x.id === el.dataset.id); if (!a) return;
    if (a.kind === "key" && !confirm(`Remove ${a.name}? Its coins stay on the blockchain, but you'll need its private key to get them back.`)) return;
    S.accts = S.accts.filter((x) => x.id !== a.id); await saveAccts();
    if (a.kind === "key") { const st = await local.get("keysBox"); const m = await openKeys(st.keysBox, PHRASE).catch(() => ({})); delete m[a.id]; await local.set({ keysBox: await sealKeys(m, PHRASE) }); }
    if (a.id === S.sel) return switchAccount(S.accts[0].id);
    S.panel.edit = null; renderPanel();
  },
  "acct-add": async () => {
    const used = (S.accts || DEF_ACCTS).filter((a) => a.kind === "hd").map((a) => a.i), i = Math.max(...used) + 1;
    if (i > 49) return toast("That's the most accounts one phrase can hold here.", "err");
    const n = (S.accts || DEF_ACCTS).length;
    S.accts = [...(S.accts || DEF_ACCTS), { id: "hd" + i, kind: "hd", i, name: `Account ${i + 1}`, c: n % COLORS.length }];
    await saveAccts(); toast(`Account ${i + 1} added`); switchAccount("hd" + i);
  },
  "acct-import": async () => {
    const raw = $("[data-pk]")?.value || "", name = ($("[data-pkname]")?.value || "").trim().slice(0, 24);
    let k; try { k = parseKey(raw, { web3, ethers }); } catch (e) { return toast(e.message, "err"); }
    const list = S.accts || DEF_ACCTS;
    if (list.some((a) => a.pub === k.pub) || [ACCT.sol?.publicKey.toBase58(), ACCT.evm?.address].includes(k.pub)) return toast("This account is already in Ecrin Wallet.", "err");
    const id = "k" + Date.now().toString(36);
    const st = await local.get("keysBox"); const m = await openKeys(st.keysBox, PHRASE).catch(() => ({})); m[id] = k.secret;
    await local.set({ keysBox: await sealKeys(m, PHRASE) });
    S.accts = [...list, { id, kind: "key", fam: k.fam, pub: k.pub, name: name || `Imported ${list.filter((a) => a.kind === "key").length + 1}`, c: list.length % COLORS.length }];
    await saveAccts(); $("[data-pk]").value = ""; toast("Account imported"); switchAccount(id);
  },
  "rule-open": (el) => { S.panel.edit = el.dataset.k; renderPanel(); },
  "rule-back": () => { S.panel.edit = null; renderPanel(); },
  "rule-set": async (el) => {
    const P = S.panel, k = el.dataset.k, val = (sel) => (document.querySelector(sel)?.value || "").trim();
    const jobs = [];
    try {
      if (k === "delay") { const d = Number(el.dataset.v); jobs.push(["all", { kind: "SetWithdrawDelay", value: d }]); }
      if (k === "freeze") { const d = Number(el.dataset.v); jobs.push(["all", { kind: "SetLockedUntil", value: now() + d * 86400 + 120 }]); }
      if (k === "limit") { for (const f of ["sol", "evm"]) { const t = val(`[data-lim="${f}"]`); if (t === "") continue; const n = t === "0" || /^none$/i.test(t) ? null : Math.round(Number(t) * BASE); if (n != null && !(n > 0)) throw new Error("Enter an amount, or 0 for no limit."); jobs.push([f, { kind: "SetDailyLimit", value: n }]); } }
      if (k === "guardian") { for (const f of ["sol", "evm"]) { const t = val(`[data-g="${f}"]`); if (!t) continue; if (!validFor(f, t)) throw new Error(`That isn't a${f === "sol" ? " Solana" : "n Ethereum"} address.`); jobs.push([f, { kind: "SetGuardian", value: t }]); } }
      if (k === "trust") { const t = val("[data-trust]"), f = /^0x[0-9a-fA-F]{40}$/.test(t) ? "evm" : "sol"; if (!validFor(f, t)) throw new Error("That isn't a Solana or Ethereum address."); jobs.push([f, { kind: "AddTrusted", value: t }]); }
      if (k === "untrust") jobs.push([el.dataset.f, { kind: "RemoveTrusted", value: el.dataset.a }]);
      if (!jobs.length) throw new Error("Nothing to change.");
    } catch (e) { return toast(e.message, "err"); }
    await applyEverywhere(jobs);
  },
  "rc-apply": async (el) => { try { el.disabled = true; await useNet(el.dataset.n); await (await eng()).applyChange(Number(el.dataset.id)); toast("Rule applied", "win"); } catch (e) { toast(errText(e), "err"); } await loadAll(); },
  "rc-cancel": async (el) => { try { el.disabled = true; await useNet(el.dataset.n); await (await eng()).cancelChange(Number(el.dataset.id)); toast("Change cancelled", "win"); } catch (e) { toast(errText(e), "err"); } await loadAll(); },
  "al-tg": async () => { try { const r = await alertCall("/api/alerts/start", {}); if (!r.url) throw new Error(r.error || "Alerts aren't available right now."); window.open(r.url, "_blank"); S.alertsOn = true; local.set({ alertsOn: true }); toast("Telegram opened: tap Start in the chat.", "win"); } catch (e) { toast(e.message, "err"); } },
  "al-mail": async () => { const email = ($("#panel [data-mail]")?.value || "").trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("Enter your email address", "err"); try { const r = await alertCall("/api/alerts/email", { email }); if (r.error) throw new Error(r.error); S.alertsOn = true; local.set({ alertsOn: true }); toast(r.already ? "Email alerts are already on." : "Check your inbox to confirm.", "win"); } catch (e) { toast(e.message, "err"); } },
  tok: (el) => { const u = el.dataset.u, cg = u === "USDC" ? null : { SOL: "solana", ETH: "ethereum", POL: "polygon-ecosystem-token" }[u]; openPanel("tok", { u, cg, n: el.dataset.n }); if (cg) loadSeriesFor(cg).then(() => S.panel?.p === "tok" && renderPanel()); },
  "tok-do": async (el) => { const P = S.panel, w = worth(), list = w.items.filter((i) => i.unit === P.u), p = el.dataset.p;
    const best = list.filter((i) => (p === "withdraw" ? i.sav : i.chq) > 0).sort((x, y) => (y.usd || 0) - (x.usd || 0))[0] || list[0];
    const k = best?.k || P.n || (P.u === "SOL" ? "sol" : P.u === "POL" ? "pol" : "eth"), a = P.u === "USDC" ? "usdc" : "native";
    await useNet(k); S.panel = null; openPanel(p, { a }); if (p === "send" || p === "protect" || p === "swap") { const e = await eng(); S.panel.reserve = await e.reserve(a); renderPanel(); } },
  "pick-coin": () => { const P = S.panel; S.panel = { p: "pick", back: P.p, step: "form" }; renderPanel(); },
  "pick-go": async (el) => { await useNet(el.dataset.n); S.panel = null; openPanel(el.dataset.p, { a: el.dataset.a }); if (el.dataset.p !== "receive" && el.dataset.p !== "withdraw") { const e = await eng(); S.panel.reserve = await e.reserve(S.panel.asset); renderPanel(); } },
  grp: (el) => { S.open = { ...(S.open || {}), [el.dataset.u]: !S.open?.[el.dataset.u] }; render(); },
  wn: (el) => { S.wn = Number(el.dataset.n); render(); },
  "book-pick": (el) => { S.panel.to = el.dataset.a; renderPanel(); },
  "book-save": async () => { const n = ($("#panel [data-bookname]")?.value || "").trim(); if (!n) return; const f = NETS[S.net].fam; S.book[f] = { ...(S.book[f] || {}), [S.panel.to.trim()]: n }; await local.set({ book: S.book }); toast(`Saved as ${n}`, "win"); renderPanel(); },
  "share-addr": async () => { try { await navigator.share({ title: "My " + NETS[S.net].name + " address", text: ENG.address }); } catch (_) {} },
  tog: async (el) => {
    const k = el.dataset.k;
    if (k === "order") S.order = S.order === "name" ? "value" : "name";
    else if (k === "recvNotify") { S.recvNotify = S.recvNotify === false; if (S.recvNotify && globalThis.ECRIN_WEB && window.Notification && Notification.permission === "default") await Notification.requestPermission().catch(() => {}); }
    else S[k] = !S[k];
    if (k === "showNfts" && !S.showNfts && S.tab === "nfts") S.tab = "tokens";
    await local.set({ [k]: S[k] }); renderPanel(); render();
  },
  "upd-go": () => { if (globalThis.ECRIN_WEB) location.reload(); else window.open("https://ecrinprotocol.app/#wallet", "_blank"); },
  "bk-later": async () => { await local.set({ backup: { ...S.backup, at: Date.now() } }); S.backup = { ...S.backup, at: Date.now() }; render(); },
  "bk-check": async () => {
    const { phrase } = await session.get("phrase"), w = phrase.split(" "), P = S.panel;
    const ok = P.ask.every((i) => (document.querySelector(`[data-bk="${i}"]`)?.value || "").trim().toLowerCase() === w[i]);
    if (!ok) return toast("Not quite. Check your paper and try again.", "err");
    S.backup = { ...S.backup, done: true }; await local.set({ backup: S.backup }); closePanel(); toast("Backup confirmed. Keep that paper safe.", "win");
  },
  "bio-unlock": async () => {
    if (S.busy || !S.bio || S.bioRun) return;
    S.bioRun = true; S.bioBusy = "scan"; render();
    try {
      const phrase = await bioUnlock(S.bio); await session.set({ phrase }); await useAccount(phrase); await touch();
      S.bioBusy = "ok"; render(); await new Promise((r) => setTimeout(r, 650)); S.bioBusy = null; S.bioRun = false; home();
    } catch (e) { S.bioBusy = null; S.bioRun = false; render(); if (e?.name !== "NotAllowedError") toast(e?.message || `${bioName()} didn't work. Use your password.`, "err"); }
  },
  "bio-toggle": async () => {
    if (S.bio) { if (!confirm(`Turn off ${bioName()}? You'll unlock with your password.`)) return; await local.remove("bio"); S.bio = null; toast(`${bioName()} is off`, "win"); return renderPanel(); }
    try { const { phrase } = await session.get("phrase"); const box = await bioEnable(phrase); await local.set({ bio: box }); S.bio = box; toast(`${bioName()} is on`, "win"); renderPanel(); }
    catch (e) { if (e?.name !== "NotAllowedError") toast(e?.message || `Couldn't turn on ${bioName()}`, "err"); }
  },
  "swap-flip": async () => { const P = S.panel; P.asset = P.asset === "usdc" ? "native" : "usdc"; P.amount = ""; P.pct = null; P.reserve = await (await eng()).reserve(P.asset); renderPanel(); },
  "swap-sol": async () => { await useNet("sol"); S.panel = null; openPanel("swap"); const e = await eng(); S.panel.reserve = await e.reserve("native"); renderPanel(); },
  "ap-ok": async (el) => {
    const R = S.req; if (!R || R.busy) return;
    if (S.upd?.must) { R.err = "A security update is required before you can sign. Update Ecrin Wallet first."; return render(); }
    R.busy = true; render();
    try {
      const result = await APX.sign(R);
      // Keep a record: it shows in Activity, and spending permissions show on the Permissions page to revoke later.
      const from = R.fam === "sol" ? ACCT.sol?.publicKey.toBase58() : ACCT.evm?.address, { apLog = [] } = await local.get("apLog");
      const permit = R.pv?.permit ? { spender: R.pv.permit.spender, token: R.pv.permit.token, chainId: R.chainId } : null;
      await local.set({ apLog: [{ t: "ap", at: Date.now(), origin: R.origin, kind: R.kind, fam: R.fam, from, permit, sig: typeof result === "string" && R.kind === "tx" ? result : null, k: R.fam === "sol" ? "sol" : Object.values(NETS).find((x) => x.E?.chainId === Number(R.chainId))?.key }, ...apLog].slice(0, 200) });
      await chrome.runtime.sendMessage({ type: "approval-done", id: R.id, ok: true, result }); window.close();
    }
    catch (e) { R.busy = false; R.err = e?.shortMessage || e?.message || String(e); render(); }
  },
  "ap-no": async () => { await chrome.runtime.sendMessage({ type: "approval-done", id: S.req?.id, ok: false }).catch(() => {}); window.close(); },
  "ap-risk": () => { S.req.risk = !S.req.risk; render(); },
  "site-off": async (el) => { await chrome.runtime.sendMessage({ type: "site-disconnect", origin: el.dataset.o }); toast("Disconnected", "win"); renderPanel(); loadSites(); },
  "lists-refresh": async (el) => { el.disabled = true; const r = await chrome.runtime.sendMessage({ type: "lists-refresh" }).catch(() => null); toast(r ? `Updated: ${r.count.toLocaleString("en-US")} scam sites` : "Couldn't download the lists right now", r ? "win" : "err"); loadSites(); },
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
  "finish-create": async () => { S.busy = true; render(); await saveWallet(S.phrase, S.pw); await local.set({ backup: { at: Date.now(), done: false } }); S.busy = false; S.phrase = S.pw = null; home(); },
  forgot: () => { if (confirm("Without the password, the only way back in is your recovery phrase. Remove this wallet from the browser and import it again?")) forget(); },
  copy: async (el) => {
    await navigator.clipboard.writeText(el.dataset.v);
    if (el.classList.contains("ad-copy")) { const t = el.querySelector("span"); el.classList.add("ok"); t.textContent = S.lang === "fr" ? "Copiée" : "Copied"; clearTimeout(el._t); el._t = setTimeout(() => { el.classList.remove("ok"); t.textContent = S.lang === "fr" ? "Copier l'adresse" : "Copy address"; }, 1600); navigator.vibrate?.(8); }
    else toast("Address copied", "win");
  },
  "qr-for": async (el) => { if (el.dataset.n !== S.net) { S.net = el.dataset.n; await local.set({ net: S.net }); S.bal = null; S.vault = undefined; ENG = null; await eng(); refresh(); } S.panel = { p: "receive", step: "form", asset: "native", amount: "", to: "" }; renderPanel(); },
  "copy-addr": async () => { await navigator.clipboard.writeText(ENG.address); toast("Address copied", "win"); },
  hide: async () => { S.hide = !S.hide; await local.set({ hide: S.hide }); render(); if (S.panel) renderPanel(); },
  panel: async (el) => {
    const p = el.dataset.p;
    if (["send", "protect", "withdraw"].includes(p) && !S.panel) {
      const w = worth(), here = w.items.filter((i) => i.k === S.net && (p === "withdraw" ? i.sav : i.chq) > 0);
      const best = w.items.filter((i) => (p === "withdraw" ? i.sav : i.chq) > 0).sort((x, y) => (y.usd || 0) - (x.usd || 0))[0];
      if (!here.length && best && best.k !== S.net) { await useNet(best.k); el = { dataset: { p, a: best.a } }; }
    }
    if (S.panel && p !== S.panel.p) { S.panel = { p, step: "form", asset: el.dataset.a || "native", amount: "", to: "" }; renderPanel(); }
    else openPanel(p, { a: el.dataset.a });
    if (p === "send" || p === "protect" || p === "swap") { const e = await eng(); S.panel.reserve = await e.reserve(S.panel.asset); renderPanel(); }
    if (p === "all" || p === "vault" || p === "rules") loadAll();
    if (p === "sites") loadSites();
  },
  settings: () => openPanel("settings"),
  close: () => closePanel(),
  asset: async (el) => { const P = S.panel; P.asset = el.dataset.a; P.amount = ""; P.pct = null; P.reserve = await (await eng()).reserve(P.asset); renderPanel(); },
  pct: (el) => {
    const P = S.panel, p = Number(el.dataset.v), a = P.asset;
    const max = P.p === "send" || P.p === "swap" ? sendMax() : P.p === "protect" ? sendMaxProtect() : (a === "usdc" ? S.vault?.usdc?.available : S.vault?.main?.available) || 0;
    const units = Math.floor((max * p) / 100), x = A(a);
    P.pct = p; P.amount = units ? String(Math.floor((units / x.base) * 10 ** x.dec) / 10 ** x.dec) : "";
    renderPanel();
  },
  paste: async () => { try { S.panel.to = (await navigator.clipboard.readText()).trim(); renderPanel(); } catch (_) { toast("Couldn't read the clipboard", "err"); } },
  review: async () => {
    const P = S.panel, usd = usdOf(parseAmt(P.amount, P.asset), P.asset);
    const lim = await limitCheck(usd); if (lim) return toast(lim, "err");
    P.fresh = !(await knownDest(P.to.trim())); P.step = "review"; P.anim = true;
    const G = S.guard; P.coolUntil = G.cool && usd != null && usd >= G.coolOver ? Date.now() + G.cool * 1000 : 0;
    renderPanel(); if (P.coolUntil) coolTick();
  },
  kind: (el) => { S.panel.kind = el.dataset.k; renderPanel(); },
  "create-vault": async () => {
    const P = S.panel, back = P.p;
    await txRun(async () => (await eng()).createVault(P.kind || "strong"), null, { t: "vault" });
    // Opened from Protect: carry straight on to protecting, no detour through a done screen.
    if (back === "protect" && S.panel === P && P.step === "done") { P.step = "form"; toast(`Safe opened on ${NETS[S.net].name}`, "win"); const e = await eng(); P.reserve = await e.reserve(P.asset); renderPanel(); }
  },
  "do-protect": () => { const P = S.panel, units = parseAmt(P.amount, P.asset); P.sent = units; txRun(async () => (await eng()).protect(P.asset, units), null, { t: "protect", a: P.asset, n: units }); },
  "do-withdraw": () => { const P = S.panel, units = parseAmt(P.amount, P.asset); P.sent = units; txRun(async () => (await eng()).request(P.asset, ENG.address, units), null, { t: "withdraw", a: P.asset, n: units }); },
  "safe-go": async (el) => { el.disabled = true; await useNet(el.dataset.n); S.panel = null; openPanel(el.dataset.p); if (el.dataset.p === "protect") { const e = await eng(); S.panel.reserve = await e.reserve(S.panel.asset); renderPanel(); } },
  "cancel-w": async (el) => { try { el.disabled = true; await useNet(el.dataset.n); await (await eng()).cancel(el.dataset.a, Number(el.dataset.id)); await logActivity({ t: "cancel", a: el.dataset.a }); loadActivity(); toast("Cancelled. It stays in your Safe.", "win"); await refresh(); loadAll(); } catch (e) { el.disabled = false; toast(errText(e), "err"); } },
  execute: async (el) => { try { el.disabled = true; await useNet(el.dataset.n); await (await eng()).execute(el.dataset.a, Number(el.dataset.id), el.dataset.d); await logActivity({ t: "release", a: el.dataset.a }); loadActivity(); toast("Released to Wallet", "win"); await refresh(); loadAll(); } catch (e) { el.disabled = false; toast(errText(e), "err"); } },
  net: async (el) => { S.net = el.dataset.n; await local.set({ net: S.net }); S.bal = null; S.vault = undefined; ENG = null; S.drawChart = true; closePanel(); await eng(); loadActivity(); refresh(); loadSeries(); },
  "row-send": async (el) => { if (el.dataset.n !== S.net) { S.net = el.dataset.n; await local.set({ net: S.net }); S.bal = null; S.vault = undefined; ENG = null; await eng(); loadActivity(); await refresh(); } openPanel("send", { a: el.dataset.a }); const e = await eng(); S.panel.reserve = await e.reserve(S.panel.asset); renderPanel(); },
  "net-go": async (el) => { if (el.dataset.n !== S.net) await actions.net(el); else closePanel(); },
  tab: async (el) => { S.tab = el.dataset.t; render(); if (S.tab === "activity") loadActivity(); },
  range: async (el) => { S.range = el.dataset.d; await local.set({ range: S.range }); S.drawChart = true; render(); if (S.panel?.p === "tok") { renderPanel(); loadSeriesFor(S.panel.cg).then(() => S.panel?.p === "tok" && renderPanel()); } else loadSeries(); },
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
  await useAccount(phrase); await touch();
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

async function xSendNow() {
  const P = S.panel, t = (S.extra || []).find((x) => x.mint === P.m && x.k === P.n);
  if (S.upd?.must) return toast("A security update is required before you can send. Update Ecrin Wallet first.", "err");
  const { dev } = await local.get("dev"); const e = engine({ web3, ethers, acct: ACCT, net: t.k, dev: dev || {} });
  P.step = "sending"; renderPanel();
  try {
    const sig = await e.sendToken(t, P.to, BigInt(P.raw)); P.sig = typeof sig === "string" ? sig : null; await rememberDest(P.to); P.step = "done"; loadExtras(dev);
    const k = `act:${t.k}:${e.address}`, o = await local.get(k); await local.set({ [k]: [{ at: Date.now(), t: "tsend", to: P.to, n: Number(P.amount), sym: t.symbol || tokName(t), sig: P.sig }, ...(o[k] || [])].slice(0, 60) });
  }
  catch (err) { console.warn(err); P.step = "review"; toast(errText(err), "err"); }
  renderPanel();
}
async function confirmSend() {
  if (S.panel?.p === "xtok") return xSendNow();
  const P = S.panel, units = parseAmt(P.amount, P.asset), to = P.to.trim();
  P.sent = units;
  const lim = await limitCheck(usdOf(units, P.asset)); if (lim) { P.step = "form"; renderPanel(); return toast(lim, "err"); }
  await txRun(async () => (await eng()).send(P.asset, to, units), async () => { await rememberDest(to); await countSpend(usdOf(units, P.asset)); }, { t: "send", a: P.asset, n: units, to });
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
  if (t.matches("[data-w]")) {
    const boxes = [...document.querySelectorAll("[data-w]")], words = t.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length > 1) { if (words.length === 24 && boxes.length === 12) { S.wn = 24; render(); return setTimeout(() => { const b = [...document.querySelectorAll("[data-w]")]; words.forEach((w, i) => b[i] && (b[i].value = w)); sync(); }, 0); } words.forEach((w, i) => { const b = boxes[Number(t.dataset.w) + i]; if (b) b.value = w; }); boxes[Math.min(boxes.length - 1, Number(t.dataset.w) + words.length)]?.focus(); }
    else if (/\s$/.test(t.value)) { t.value = t.value.trim(); boxes[Number(t.dataset.w) + 1]?.focus(); }
    sync(); return;
    function sync() { const ta = document.querySelector('textarea[name="phrase"]'); if (ta) ta.value = [...document.querySelectorAll("[data-w]")].map((b) => b.value.trim().toLowerCase()).filter(Boolean).join(" "); }
  }
  if (t.matches("[data-actq]")) { S.actQ = t.value; const el = $("#actl"); if (el) { el.innerHTML = actRows(); translate(el, S.lang); } return; }
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
    try { const { box } = await local.get("box"); const phrase = await open(box, d.pw); await session.set({ phrase }); await useAccount(phrase); await touch(); S.busy = false; AP.id ? startApproval() : home(); }
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

/* ------------------------------------------------------------------ requests from websites */

const AP = { id: (location.hash.match(/^#approve=([\w-]+)$/) || [])[1] || null };
const APX = makeApprovals({ web3, ethers, getAcct: () => ACCT, getDev: async () => (await local.get("dev")).dev || {} });

async function startApproval() {
  S.screen = "approve"; S.req = null; render();
  try { const port = chrome.runtime.connect({ name: "approval" }); setInterval(() => port.postMessage(1), 20_000); } catch (_) {}
  const r = await chrome.runtime.sendMessage({ type: "approval-get", id: AP.id }).catch(() => null);
  if (!r) { S.req = { gone: true }; return render(); }
  S.req = r; render();
  try { r.pv = await APX.preview(r); } catch (e) { r.pv = { fail: `Ecrin couldn't check this request: ${e?.message || e}` }; }
  if (S.req === r) render();
}

function approveView() {
  const R = S.req;
  if (!R) return `<div class="splash">${LOGO}</div>`;
  if (R.gone) return `<div class="ap"><div class="ap-gone">${I.clock}<b>${R.nowallet ? "No wallet yet" : "This request has ended"}</b><span>${R.nowallet ? "Open Ecrin Wallet from the toolbar to create or import a wallet, then try again on the site." : "The site withdrew it, or it was already answered."}</span><button class="btn" onclick="window.close()">Close</button></div></div>`;
  const site = R.site, pv = R.pv, kind = R.kind;
  const netName = R.fam === "sol" ? "Solana Devnet" : (() => { const n = Object.values(NETS).find((x) => x.E?.chainId === Number(R.chainId)); return n ? `${n.name} ${n.net}` : "Ethereum"; })();
  const netKey = R.fam === "sol" ? "sol" : (Object.values(NETS).find((x) => x.E?.chainId === Number(R.chainId))?.key || "eth");
  const title = { connect: "Connect to this site?", sign: "Sign a message", solmsg: "Sign a message", typed: "Sign a permission", tx: "Approve a transaction", soltx: R.send ? "Approve a transaction" : "Sign a transaction" }[kind];
  const banners = [];
  if (site.phish) banners.push(["bad", `<b>Known scam site.</b> ${esc(site.host)} is on a phishing list. Sites like this copy real apps to steal money. Ecrin strongly advises you to reject.`]);
  if (site.like) banners.push(["bad", site.like.kind === "chars" ? `<b>Look-alike address.</b> ${esc(site.host)} uses letters that imitate other letters, a common phishing trick.` : `<b>Look-alike site.</b> ${esc(site.host)} looks like <b>${esc(site.like.like)}</b>, but it isn't. Check the address bar carefully.`]);
  if (!site.https) banners.push(["warn", "This site isn't secure (no https). Anyone on your network could change what it shows you."]);
  if (kind === "connect" && site.first && !site.phish && !site.like) banners.push(["note", "You haven't connected to this site before. Only connect to sites you trust."]);
  for (const d of pv?.danger || []) banners.push(["bad", esc(d)]);
  if (pv?.fail) banners.push(["warn", esc(pv.fail)]);
  for (const n of pv?.notes || []) banners.push(["note", esc(n)]);
  const risky = site.phish || site.like || (pv?.danger || []).length > 0 || ((kind === "tx" || kind === "soltx") && !!pv?.fail);
  const loading = kind !== "connect" && !pv;
  const row = (sign, x) => `<div class="ap-r">${x.unit === "SOL" ? coin("sol") : x.unit === "USDC" ? coin("usdc") : x.unit === "ETH" ? coin("eth") : x.unit === "POL" ? coin("pol") : `<span class="coin tk">${esc(String(x.unit).slice(0, 1))}</span>`}<b class="${sign === "−" ? "out" : "in"}">${sign}${esc(x.amt)} ${esc(x.unit)}</b>${x.to ? `<small>to ${esc(short(x.to))}</small>` : ""}</div>`;
  let body = "";
  if (kind === "connect") body = `<div class="ap-card"><div class="ap-li">${I.check}<span>See your ${R.fam === "sol" ? "Solana" : "Ethereum"} address and balances</span></div><div class="ap-li">${I.check}<span>Ask you to approve transactions</span></div><div class="ap-li no">${I.x}<span>Move anything without your approval</span></div></div>`;
  else if (loading) body = `<div class="ap-card ap-load"><span class="sk">&nbsp;</span><small>Checking exactly what this does…</small></div>`;
  else if (kind === "sign" || kind === "solmsg") body = `<div class="ap-lbl">${pv.signin ? "Sign-in message" : "Message"}</div><pre class="ap-msg">${esc(pv.text)}</pre><p class="ap-fine">Signing a message costs nothing and moves nothing${pv.raw ? ", unless the data is a hidden permission" : ""}.</p>`;
  else if (kind === "typed") body = `<div class="ap-lbl">${esc(pv.title)}</div><div class="ap-card ap-fields">${(pv.fields || []).map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v.length > 46 ? short(v) : v)}</b></div>`).join("")}</div>`;
  else {
    const lv = pv.leaves || [], gt = pv.gets || [];
    body = `<div class="ap-lbl">What leaves your wallet${pv.simulated || kind === "soltx" ? `<span class="ap-sim">${I.check}Simulated</span>` : ""}</div><div class="ap-card">${lv.length ? lv.map((x) => row("−", x)).join("") : `<div class="ap-r none">Nothing${pv.fail ? " that Ecrin could see" : ""}</div>`}</div>
      ${gt.length ? `<div class="ap-lbl">What you receive</div><div class="ap-card">${gt.map((x) => row("+", x)).join("")}</div>` : ""}
      <div class="ap-kv">${pv.to ? `<div><span>To</span><b>${esc(short(pv.to))}</b></div>` : ""}<div><span>Network fee</span><b>${esc(pv.fee || "—")}</b></div></div>`;
  }
  const label = kind === "connect" ? "Connect" : kind === "tx" || (kind === "soltx" && R.send) ? "Approve" : "Sign";
  return `<div class="ap">
    <header class="ap-top"><span class="ap-site"><i class="${site.phish || site.like ? "bad" : ""}">${esc(site.host.replace(/^www\./, "").slice(0, 1).toUpperCase())}</i><span><b>${esc(site.host)}</b><small>${site.https ? "wants to use Ecrin Wallet" : "not secure"}</small></span></span><span class="ap-net">${coin(netKey)}${esc(netName)}</span></header>
    <h2 class="ap-h">${title}</h2>
    ${banners.map(([k, t]) => `<div class="ap-b ${k}">${k === "note" ? I.shield : I.warn}<span>${t}</span></div>`).join("")}
    ${body}
    ${R.err ? `<div class="ap-b bad">${I.warn}<span>${esc(R.err)}</span></div>` : ""}
    <div class="ap-foot">
      ${risky ? `<label class="ap-risk"><input type="checkbox" data-act="ap-risk" ${R.risk ? "checked" : ""}/> I understand the risk and still want to continue</label>` : ""}
      <div class="ap-btns"><button class="btn" data-act="ap-no">Reject</button><button class="btn primary ${risky ? "risky" : ""}" data-act="ap-ok" ${R.busy || loading || (risky && !R.risk) ? "disabled" : ""}>${R.busy ? "Working…" : label}</button></div>
    </div>
  </div>`;
}

async function loadSites() {
  const { sites = {} } = await local.get("sites");
  const stats = await local.get("phishList").then((x) => x.phishList).catch(() => null);
  if (S.panel?.p === "sites") { S.panel.sites = sites; S.panel.list = stats ? { at: stats.at, count: stats.count } : null; renderPanel(); }
}
function sitesView() {
  const P = S.panel, list = Object.entries(P.sites || {}).filter(([, v]) => v.sol || v.evm).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  return `${phead("Connected sites")}
    <p class="sub pad">Sites you allowed to see your address and ask for approvals. Disconnecting stops them asking.</p>
    <section class="list">${list.length ? list.map(([o, v]) => `<div class="arow"><span class="coin tk">${esc(new URL(o).hostname.slice(0, 1).toUpperCase())}</span><span class="ar-t"><b>${esc(new URL(o).hostname)}</b><small>${[v.sol && "Solana", v.evm && "Ethereum"].filter(Boolean).join(" · ")}</small></span><button class="btn sm" data-act="site-off" data-o="${esc(o)}">Disconnect</button></div>`).join("")
      : `<div class="empty">${I.link}<b>No connected sites</b><span>When a site asks to connect, Ecrin shows it here.</span></div>`}</section>
    <div class="list-h"><b>Phishing protection</b><span>${P.list ? `updated ${new Date(P.list.at).toLocaleDateString()}` : "not downloaded yet"}</span></div>
    <p class="sub pad">${P.list ? `${P.list.count.toLocaleString("en-US")} known scam sites are blocked before they can ask for anything.` : "Ecrin downloads public lists of scam sites (MetaMask and ScamSniffer) once a day."} Look-alike addresses of popular apps are flagged too.</p>
    <div class="vacts"><button class="btn" data-act="lists-refresh">Update the list now</button></div>`;
}

/* ------------------------------------------------------------------ swap (Jupiter) and staking: coming soon */

// Swaps go through Jupiter, Solana's main swap service, with Ecrin's referral fee, via ecrinprotocol.app/api/swap
// (the relay keeps the Jupiter key secret). They open with mainnet: on test networks Jupiter has no markets, so the
// screen shows an estimate from current prices and the button says "Coming soon".
// Buying with a card goes through a licensed partner (they handle payment and identity checks, Ecrin never sees
// card details). It turns on when a partner key is set for mainnet; until then the screen says so.
const ONRAMP = { provider: "Transak", key: "", url: (key, addr, net, coin) => `https://global.transak.com/?apiKey=${encodeURIComponent(key)}&walletAddress=${encodeURIComponent(addr)}&network=${net}&cryptoCurrencyCode=${coin}&disableWalletAddressForm=true` };
function buyView() {
  const N = NETS[S.net], addr = ENG?.address || "";
  if (ONRAMP.key) return `${phead("Buy")}${fromRow()}<div class="cv"><div class="cv-art">${I.card}</div><h2>Buy ${N.unit} with a card</h2><p class="sub">You'll pay on ${ONRAMP.provider}'s secure page. The coins arrive straight in your Wallet at ${short(addr)}.</p>
    <a class="btn primary xl" href="${ONRAMP.url(ONRAMP.key, addr, N.fam === "sol" ? "solana" : N.key === "eth" ? "ethereum" : N.key, N.unit)}" target="_blank">Continue to ${ONRAMP.provider} ${I.ext}</a></div>`;
  return `${phead("Buy")}
    <div class="soon-row"><span class="soon">Coming soon · opens with mainnet</span></div>
    <div class="cv"><div class="cv-art">${I.card}</div><h2>Buy crypto with a card</h2>
      <p class="sub">Soon you'll buy SOL, ETH and USDC with a card or Apple Pay, through a licensed partner. The coins land straight in your Wallet, and you can protect them in your Safe right away.</p>
      <div class="note">${I.shield}<span>Ecrin never sees your card details: the partner handles payment and identity checks.</span></div>
      <a class="btn xl" href="${N.faucet}" target="_blank">Get free test ${N.unit} for now ${I.ext}</a></div>`;
}
const SWAP = { live: false, feeBps: 50, api: "https://ecrinprotocol.app/api/swap" };
const STAKE_APY = 0.065, STAKE_APY_TEXT = "6–7%";

function swapView() {
  const P = S.panel, N = NETS[S.net];
  if (N.fam !== "sol") return `${phead("Swap")}<div class="cv"><div class="cv-art">${I.swap}</div><h2>Swaps start on Solana</h2><p class="sub">Swap any Solana coin at the best price across every exchange, through Jupiter. Ethereum-style networks come later.</p></div><div class="pfoot"><button class="btn primary xl" data-act="swap-sol">Go to Solana</button></div>`;
  const a = P.asset, b = a === "usdc" ? "native" : "usdc", units = parseAmt(P.amount, a), px = S.prices.solana?.usd;
  const fee = SWAP.feeBps / 10_000, inAmt = units / A(a).base;
  const out = px && inAmt ? (a === "native" ? inAmt * px : inAmt / px) * (1 - fee) : 0;
  const rate = px ? (a === "native" ? `1 SOL ≈ ${money(px)}` : `1 USDC ≈ ${(1 / px).toFixed(6)} SOL`) : "—";
  return `${phead("Swap")}
    <div class="soon-row"><span class="soon">Coming soon · opens with mainnet</span></div>
    <div class="sw">
      <div class="sw-box"><span class="sw-k">You pay</span>${amountBlock(sendMax(), "In your Wallet")}<span class="sw-coin">${assetCoin(a)}${A(a).unit}</span></div>
      <button class="sw-flip" data-act="swap-flip" aria-label="Swap direction">${I.swap}</button>
      <div class="sw-box out"><span class="sw-k">You receive (estimate)</span><div class="sw-out"><b>${out ? out.toLocaleString("en-US", { maximumFractionDigits: b === "usdc" ? 2 : 4 }) : "0"}</b><span class="sw-coin">${assetCoin(b)}${A(b).unit}</span></div></div>
      <div class="ap-kv sw-kv"><div><span>Rate</span><b>${rate}</b></div><div><span>Ecrin fee</span><b>${(SWAP.feeBps / 100).toFixed(1)}%</b></div><div><span>Route</span><b>Jupiter, best price</b></div></div>
      <p class="note">${I.lock}<span>Swaps use your Wallet only. Money in your Safe never moves without its delay.</span></p>
    </div>
    <div class="pfoot"><button class="btn primary xl" disabled>${SWAP.live ? "Swap" : "Coming soon"}</button></div>`;
}

function earnView() {
  const v = S.vault?.main && S.net === "sol" ? S.vault.main.balance / BASE : (S.all || []).find((r) => r.k === "sol" && r.v)?.v.main.balance / BASE || 0;
  const px = S.prices.solana?.usd, yr = v * STAKE_APY;
  return `${phead("Earn")}
    <div class="soon-row"><span class="soon">Coming soon · after the audit</span></div>
    <div class="earn">
      <div class="earn-hero"><span class="lbl">Estimated rewards</span><b>${yr ? `${yr.toLocaleString("en-US", { maximumFractionDigits: 3 })} SOL` : "—"}</b><small>${yr && px ? `≈ ${money(yr * px)} a year on the ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL in your Safe` : "Protect some SOL in your Safe to see your estimate"}</small></div>
      <div class="ap-card">
        <div class="ap-li">${I.lock}<span>Your SOL stays inside your Safe while it earns. Every delay still applies.</span></div>
        <div class="ap-li">${I.spark}<span>About ${STAKE_APY_TEXT} a year from Solana staking. Rates change; nothing is guaranteed.</span></div>
        <div class="ap-li">${I.clock}<span>Unstaking takes about 2 days on Solana, then your Safe's usual delay.</span></div>
        <div class="ap-li">${I.shield}<span>Ecrin keeps a small share of the rewards, shown before you stake.</span></div>
      </div>
      <p class="fine pad">Staking opens after Ecrin's security audit, on mainnet.</p>
    </div>
    <div class="pfoot"><button class="btn primary xl" disabled>Coming soon</button></div>`;
}

/* ------------------------------------------------------------------ updates and backup check */

// The latest version lives at ecrinprotocol.app/wallet-version.json. Older than "minimum" means a security fix:
// signing stops until the wallet is updated.
const vnum = (v) => String(v || "0").split(/[^\d.]/)[0].split(".").map(Number);
const older = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
async function checkUpdate() {
  if (globalThis.ECRIN_DEMO) return;
  try {
    const j = await (await fetch("https://ecrinprotocol.app/wallet-version.json", { cache: "no-store" })).json();
    const mine = chrome.runtime.getManifest().version;
    S.upd = older(mine, j.latest) ? { latest: j.latest, must: older(mine, j.minimum), notes: j.notes || "" } : null;
    if (S.screen === "home") render();
  } catch (_) {}
}
function updateBanner() {
  const u = S.upd; if (!u) return "";
  return `<button class="upd ${u.must ? "must" : ""}" data-act="upd-go">${I.warn}<span><b>${u.must ? "Security update required" : "Update available"}</b><small>${u.must ? "Sending and signing are paused until you update." : `Version ${esc(u.latest)} is ready.`} ${globalThis.ECRIN_WEB ? "Tap to reload." : "Tap to download."}</small></span></button>`;
}

const BK_DAYS = 3;
async function loadBackup() { S.backup = (await local.get("backup")).backup || null; }
function backupCard() {
  const b = S.backup; if (!b || b.done || Date.now() - b.at < BK_DAYS * 86400_000) return "";
  return `<div class="bk"><span class="bk-ic">${I.shield}</span><span class="bk-t"><b>Check your backup</b><small>Make sure your 12 words are written down correctly. It takes 20 seconds.</small></span>
    <span class="bk-a"><button class="btn sm primary" data-act="panel" data-p="backup">Check</button><button class="btn sm" data-act="bk-later">Later</button></span></div>`;
}
function backupView() {
  const P = S.panel;
  if (!P.ask) { const a = new Set(); while (a.size < 3) a.add(Math.floor(Math.random() * 12)); P.ask = [...a].sort((x, y) => x - y); }
  return `${phead("Check your backup")}
    <p class="sub pad">Look at the paper where you wrote your recovery phrase and type these words.</p>
    <div class="stack pad">${P.ask.map((i) => `<label class="fld"><span>Word #${i + 1}</span><input data-bk="${i}" autocomplete="off" autocapitalize="none" spellcheck="false"/></label>`).join("")}</div>
    <div class="pfoot"><button class="btn primary xl" data-act="bk-check">Confirm</button></div>`;
}

/* ------------------------------------------------------------------ address book, incoming coins, phone touches */

const bookList = () => Object.entries(S.book?.[NETS[S.net].fam] || {}).sort((a, b) => a[1].localeCompare(b[1]));
const bookName = (a) => (a && S.book?.[NETS[S.net].fam]?.[a]) || null;

// Money arriving while the wallet is open: a toast, and a phone notification if the app is in the background.
function noticeIncoming(bal) {
  const prev = S.bal, key = `${S.net}:${ENG?.address}`;
  if (!prev || S.balKey !== key) { S.balKey = key; return; }
  if (S.recvNotify === false || Date.now() - (S.lastTx || 0) < 90_000) return;
  for (const [a, now, was] of [["native", bal.native, prev.native], ["usdc", bal.usdc, prev.usdc]]) {
    if (!(now > was)) continue;
    const text = `Received ${amt(now - was, a)} ${A(a).unit} on ${NETS[S.net].name}`;
    recvFx(`+${amt(now - was, a)} ${A(a).unit}`);
    if (NETS[S.net].fam === "evm") logActivity({ t: "recv", a, n: now - was }).then(loadActivity);
    if (document.hidden && window.Notification?.permission === "granted") try { new Notification("Ecrin Wallet", { body: text, icon: "/icon2-192.png" }); } catch (_) {}
  }
}

// Phone app: pull down to refresh (the Ecrin mark follows your finger, then spins until everything is fresh),
// and a light tap of the vibration motor on important buttons (Android).
if (globalThis.ECRIN_WEB) {
  let y0 = null, d = 0, busy = false;
  const ptr = document.createElement("div"); ptr.className = "ptr"; ptr.innerHTML = `<span class="ptr-ic">${LOGO}</span>`; document.body.append(ptr);
  const set = (v) => { ptr.style.setProperty("--p", v); ptr.classList.toggle("ready", v >= 1); };
  document.addEventListener("touchstart", (e) => { const r = $("#root"); y0 = !busy && S.screen === "home" && !S.panel && r.scrollTop <= 0 && !e.target.closest("[data-chart]") ? e.touches[0].clientY : null; d = 0; }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (y0 == null) return; d = Math.max(0, e.touches[0].clientY - y0);
    const p = Math.min(1.25, d / 110); ptr.classList.add("pull"); set(p);
    if (p >= 1 && !ptr._tick) { ptr._tick = true; navigator.vibrate?.(6); } if (p < 1) ptr._tick = false;
  }, { passive: true });
  document.addEventListener("touchend", async () => {
    if (y0 == null) return; y0 = null;
    if (d >= 110) {
      busy = true; ptr.classList.add("spin"); set(1);
      S.histAt = 0; await Promise.allSettled([refresh(), loadAll(), loadPrices(), loadActivity()]);
      await new Promise((r) => setTimeout(r, 350)); busy = false; ptr.classList.remove("spin");
    }
    ptr.classList.remove("pull"); set(0); ptr._tick = false;
  }, { passive: true });
  document.addEventListener("click", (e) => { if (e.target.closest(".btn.primary, .acts button, [data-act='ap-ok']")) navigator.vibrate?.(8); }, true);
}

function recvFx(label) {
  const host = document.querySelector(".device") || document.body, el = document.createElement("div");
  el.className = "fx-recv"; el.setAttribute("aria-live", "polite");
  el.innerHTML = `<svg class="fx-in" viewBox="0 0 120 120"><g class="rays"><path class="ray" style="--i:0" d="M60 60 L130.0 60.0"/><path class="ray" style="--i:1" d="M60 60 L109.5 109.5"/><path class="ray" style="--i:2" d="M60 60 L60.1 130.0"/><path class="ray" style="--i:3" d="M60 60 L10.6 109.6"/><path class="ray" style="--i:4" d="M60 60 L-10.0 60.1"/><path class="ray" style="--i:5" d="M60 60 L10.4 10.6"/><path class="ray" style="--i:6" d="M60 60 L59.8 -10.0"/><path class="ray" style="--i:7" d="M60 60 L109.4 10.4"/></g><g class="dia"><path class="d-o d-fill" pathLength="100" d="M60 22 L88 50 L60 98 L32 50 Z"/><path class="d-f" pathLength="100" d="M32 50 H88 M46 36 L60 50 L74 36 M60 50 V98 M46 36 L52 50 M74 36 L68 50"/></g></svg><b>${esc(label)}</b><small>Received</small>`;
  host.appendChild(el); navigator.vibrate?.([10, 40, 10]);
  setTimeout(() => el.classList.add("out"), 2500); setTimeout(() => el.remove(), 3000);
}

/* ------------------------------------------------------------------ coin first: pick a coin, Ecrin picks the network */
function fromRow() {
  const P = S.panel, N = NETS[S.net], a = P.asset || "native";
  return `<button class="from" data-act="pick-coin">${coinOn(a)}<span><b>${a === "usdc" ? "USDC" : N.unit}</b><small>on ${N.name}</small></span>${I.chev}</button>`;
}
function pickView() {
  const P = S.panel, w = worth(), need = P.back === "withdraw" ? "sav" : P.back === "receive" ? null : "chq";
  let list = need ? w.items.filter((i) => i[need] > 0) : [];
  if (!need) list = netKeys().map((k) => NETS[k]).flatMap((N) => [{ k: N.key, a: "native", unit: N.unit, name: COIN_NAME[N.unit] || N.unit, net: N.name, coin: N.key }, ...(N.usdc ? [{ k: N.key, a: "usdc", unit: "USDC", name: "USD Coin", net: N.name, coin: "usdc" }] : [])]);
  const n = (v, d) => v.toLocaleString("en-US", { maximumFractionDigits: d });
  return `${phead({ send: "Send which coin?", protect: "Protect which coin?", withdraw: "Withdraw which coin?", receive: "Receive which coin?" }[P.back] || "Choose a coin")}
    <section class="list">${list.length ? list.map((i) => `<button class="arow" data-act="pick-go" data-n="${i.k}" data-a="${i.a}" data-p="${P.back}"><span class="cstack">${coin(i.coin)}${i.coin !== i.k ? `<span class="cmini">${coin(i.k)}</span>` : ""}</span>
      <span class="ar-t"><b>${i.name}</b><small>${i.net}</small></span>${need ? `<span class="ar-r"><b>${mask(n(i[need], i.dec))} ${i.unit}</b><small>${i.usd != null ? mask(money(i.usd * (i[need] / ((i.chq + i.sav) || 1)))) : ""}</small></span>` : ""}</button>`).join("") : `<div class="empty">${I.recv}<b>Nothing here yet</b><span>${need === "sav" ? "Your Safe is empty." : "Use Receive to get free test coins."}</span></div>`}</section>`;
}

/* ------------------------------------------------------------------ the token page */
const ABOUT = {
  SOL: "Solana is a fast, low-cost blockchain used for payments, trading and apps. SOL pays the network fees and can be staked to help secure the network.",
  ETH: "Ether is the coin of Ethereum, the largest network for smart contracts. It pays the fees on Ethereum and on its faster networks such as Base, Arbitrum and Optimism.",
  POL: "POL is the coin of Polygon, a network with low fees that runs the same apps as Ethereum. It pays the fees on Polygon and secures the network.",
  USDC: "USD Coin is a digital dollar issued by Circle. Each USDC is backed by cash and short-term US government bonds, so its price stays close to $1.",
};
function tokenView() {
  const P = S.panel, w = worth(), list = w.items.filter((i) => i.unit === P.u), f = list[0];
  const name = f?.name || COIN_NAME[P.u] || P.u, pr = P.u === "USDC" ? { usd: 1 } : S.prices[P.cg] || {}, px = pr.usd;
  const tot = list.reduce((a, i) => ({ amt: a.amt + i.chq + i.sav, chq: a.chq + i.chq, sav: a.sav + i.sav, usd: a.usd + (i.usd || 0) }), { amt: 0, chq: 0, sav: 0, usd: 0 }), dec = f?.dec ?? 4;
  const n = (v, d) => v.toLocaleString("en-US", { maximumFractionDigits: d }), big = (v) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : money(v));
  // Price history for the range: the change shown is over that range, like the home chart.
  const h = P.cg ? S.series[`${P.cg}:${S.range}`] : null, W = 328, H = 110;
  const v = P.u === "USDC" ? Array(40).fill(1) : h ? h.pts.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 120)) === 0).map((x) => x[1]) : null;
  const tl = P.u === "USDC" ? null : h ? h.pts.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 120)) === 0).map((x) => x[0]) : null;
  let chart = `<div class="tk-chart"><div class="ch-sk"></div></div>`, dd = 0, pc = 0;
  if (v) {
    const lo = Math.min(...v), hi = Math.max(...v), sp = hi - lo || 1, xy = v.map((y, i) => [(i / (v.length - 1)) * W, 10 + (1 - (y - lo) / sp) * (H - 20)]);
    const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    dd = v[v.length - 1] - v[0]; pc = (dd / (v[0] || 1)) * 100;
    S.tkChart = { v, tl, xy, W };
    chart = `<div class="tk-chart" data-tkchart><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="tkf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".16"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><path d="${d}L${W},${H}L0,${H}Z" fill="url(#tkf)"/><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.7" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><line class="tk-x" x1="0" x2="0" y1="0" y2="${H}"/></svg><span class="ch-tip tk-tip"></span></div>`;
  }
  const rl = { 1: "today", 7: "this week", 30: "this month", 365: "this year" }[S.range];
  const ranges = `<div class="ranges">${[["1", "1D"], ["7", "1W"], ["30", "1M"], ["365", "1Y"]].map(([x, l]) => `<button data-act="range" data-d="${x}" aria-pressed="${S.range === x}">${l}</button>`).join("")}</div>`;
  const icon = P.u === "USDC" ? coin("usdc") : P.u === "ETH" ? coin("eth") : coin(P.u === "SOL" ? "sol" : "pol");
  const nets = [...new Set(list.map((i) => NETS[i.k].name))];
  const acts = (S.activity || []).filter((e) => e.n && A(e.a).unit === P.u).slice(0, 5);
  const when = (ms) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric" });
  const savPct = tot.amt ? Math.round((tot.sav / tot.amt) * 100) : 0;
  return `${phead("")}
    <div class="tk-top">${icon}<span><b>${esc(name)}</b><small>${esc(P.u)}${nets.length ? ` · ${esc(nets.join(", "))}` : ""}</small></span></div>
    <div class="tk-px" data-tkpx>${px != null ? money(px) : "—"}</div>
    <div class="tk-ch ${dd >= 0 ? "up" : "dn"}" data-tkch>${P.u === "USDC" ? "Stays close to $1" : v ? `${dd >= 0 ? "+" : "−"}${money(Math.abs(dd))} (${Math.abs(pc).toFixed(2)}%) <span>${rl}</span>` : "&nbsp;"}</div>
    ${chart}${ranges}
    <nav class="acts tk-acts">${[["send", "Send", I.send], ["receive", "Receive", I.recv], ["swap", "Swap", I.swap], ["protect", "Protect", I.protect]].map(([p2, l, ic]) => `<button data-act="tok-do" data-p="${p2}"><span>${ic}</span>${l}</button>`).join("")}</nav>
    <div class="tk-bal"><span class="lbl">Your balance</span><b>${mask(money(tot.usd))}</b><small>${mask(n(tot.amt, dec))} ${esc(P.u)}${(() => { const c = pr.usd_24h_change; if (c == null || !tot.usd || P.u === "USDC") return ""; const pl = tot.usd - tot.usd / (1 + c / 100); return ` · <span class="${pl >= 0 ? "up" : "dn"}">${pl >= 0 ? "+" : "−"}${mask(money(Math.abs(pl)))} today</span>`; })()}</small>
      ${tot.amt ? `<div class="tk-split"><i style="width:${100 - savPct}%"></i><i class="s" style="width:${savPct}%"></i></div><div class="tk-leg"><span><i></i>Wallet ${mask(n(tot.chq, dec))}</span><span><i class="s"></i>${I.lock}Safe ${mask(n(tot.sav, dec))}</span></div>` : ""}</div>
    ${list.length > 1 ? `<div class="list-h"><b>By network</b><span></span></div><section class="list">${list.map((i) => `<div class="arow">${coin(i.k)}<span class="ar-t"><b>${NETS[i.k].name}</b><small>${i.sav ? `${I.lock}${mask(n(i.sav, i.dec))} in Safe` : "Wallet"}</small></span><span class="ar-r"><b>${i.usd != null ? mask(money(i.usd)) : "—"}</b><small>${mask(n(i.chq + i.sav, i.dec))} ${i.unit}</small></span></div>`).join("")}</section>` : ""}
    <div class="list-h"><b>Info</b><span></span></div>
    <div class="tk-info">
      <div><span>Price</span><b>${px != null ? money(px) : "—"}</b></div>
      ${pr.usd_24h_change != null ? `<div><span>24h change</span><b class="${pr.usd_24h_change >= 0 ? "up" : "dn"}">${pr.usd_24h_change >= 0 ? "+" : "−"}${Math.abs(pr.usd_24h_change).toFixed(2)}%</b></div>` : ""}
      ${pr.usd_market_cap ? `<div><span>Market cap</span><b>${big(pr.usd_market_cap)}</b></div>` : ""}
      ${pr.usd_24h_vol ? `<div><span>24h volume</span><b>${big(pr.usd_24h_vol)}</b></div>` : ""}
      <div><span>Networks</span><b>${esc(nets.join(", ") || "—")}</b></div>
    </div>
    ${acts.length ? `<div class="list-h"><b>Activity</b><span></span></div><section class="list">${acts.map((e) => { const [t, ic] = ACT[e.t] || ["Transaction", I.arrow]; return `<div class="arow act-row"><span class="act-ico">${ic}</span><span class="ar-t"><b>${t}</b><small>${when(e.at)}</small></span><span class="ar-r"><b>${e.t === "send" ? "−" : ""}${amt(e.n, e.a)} ${A(e.a).unit}</b></span></div>`; }).join("")}</section>` : ""}
    <div class="list-h"><b>About ${esc(name)}</b><span></span></div>
    <p class="tk-about">${ABOUT[P.u] || ""}</p>`;
}

/** Scrubbing the token chart: price and date follow the finger. */
function bindTokChart(el) {
  const c = el.querySelector("[data-tkchart]"); if (!c || !S.tkChart) return;
  const svg = c.querySelector("svg"), x = c.querySelector(".tk-x"), tip = c.querySelector(".tk-tip"), pxEl = el.querySelector("[data-tkpx]"), keep = pxEl?.innerHTML;
  const fmtT = (ms) => new Date(ms).toLocaleString("en-US", S.range === "1" ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" });
  const move = (e) => { const r = svg.getBoundingClientRect(), k = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), { v, tl, xy, W } = S.tkChart, i = Math.round(k * (v.length - 1));
    c.classList.add("scrub"); x.setAttribute("x1", xy[i][0]); x.setAttribute("x2", xy[i][0]);
    tip.innerHTML = `<b>${money(v[i])}</b>${tl ? fmtT(tl[i]) : ""}`; tip.style.left = `${Math.max(14, Math.min(86, (xy[i][0] / W) * 100))}%`; if (pxEl) pxEl.innerHTML = money(v[i]); };
  svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointerleave", () => { c.classList.remove("scrub"); if (pxEl) pxEl.innerHTML = keep; });
}

/* ------------------------------------------------------------------ Safe rules and alerts, for every network at once */
const validFor = (f, t) => (f === "evm" ? /^0x[0-9a-fA-F]{40}$/.test(t) : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t));
const famOf = (k) => (NETS[k].fam === "sol" ? "sol" : "evm");
const openVaults = () => (S.all || []).filter((r) => r.ok && r.v);

/** Sends each change to every network with a Safe in that family ("all" = every network), one after another. */
async function applyEverywhere(jobs) {
  const P = S.panel; P.busy = true; renderPanel();
  const back = S.net; let done = 0; const fails = [];
  for (const [f, change] of jobs) for (const r of openVaults().filter((r) => f === "all" || famOf(r.k) === f)) {
    try { await useNet(r.k); await (await eng()).propose(change); done++; } catch (e) { fails.push(`${NETS[r.k].name}: ${errText(e)}`); }
  }
  await useNet(back); P.busy = false; P.edit = null;
  if (fails.length) toast(fails[0], "err"); else toast(done ? `Done on ${done} network${done > 1 ? "s" : ""}. Stricter rules apply now; looser ones wait.` : "Open your Safe first.", done ? "win" : "err");
  await loadAll(); renderPanel();
}

async function alertCall(path, extra) {
  const vs = openVaults(), sol = vs.find((r) => r.k === "sol"), evm = vs.find((r) => famOf(r.k) === "evm");
  if (!sol && !evm) throw new Error("Open your Safe first, then turn on alerts.");
  const t = (r) => ({ net: r.k, owner: r.k === "sol" ? ACCT.sol.publicKey.toBase58() : ACCT.evm.address, vault: r.k === "sol" ? r.v.main.address?.toBase58?.() : undefined });
  const [first, ...also] = [sol, evm].filter(Boolean).map(t);
  const base = globalThis.ECRIN_WEB ? "" : "https://ecrinprotocol.app";
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...first, also, lang: "en", ...extra }) });
  return res.json().catch(() => ({}));
}

function rulesView() {
  const P = S.panel, vs = openVaults();
  if (!S.all) return `${phead("Rules and alerts")}<div class="ap-card ap-load"><span class="sk">&nbsp;</span></div>`;
  if (!vs.length) return `${phead("Rules and alerts")}<div class="empty">${I.shield}<b>Open your Safe first</b><span>Rules and alerts apply to your Safe on every network.</span></div>`;
  const m = vs[0].v.main, t = now() + (S.clockOff || 0);
  const busy = P.busy ? `<div class="ap-b note">${I.clock}<span>Updating every network…</span></div>` : "";
  const fmtLim = (r) => (r.v.main.dailyLimit ? `${amt(r.v.main.dailyLimit, "native")} ${NETS[r.k].unit}` : "No limit");
  const lockTxt = m.lockedUntil && t < m.lockedUntil ? `Frozen until ${new Date(m.lockedUntil * 1000).toLocaleDateString()}` : "Off";
  const guard = (f) => { const r = vs.find((x) => famOf(x.k) === f); return r?.v.main.guardian ? short(String(r.v.main.guardian)) : "None"; };
  const trusted = vs.flatMap((r) => (r.v.main.trusted || []).map((a) => [famOf(r.k), String(a)])).filter((x, i, a) => a.findIndex((y) => y[1] === x[1]) === i);
  const pending = vs.flatMap((r) => (r.v.main.changes || []).map((c) => ({ ...c, k: r.k })));
  const label = (c) => ({ SetWithdrawDelay: `Delay → ${delay(c.value)}`, SetRuleDelay: `Rule delay → ${delay(c.value)}`, SetDailyLimit: `Daily limit → ${c.value ? amt(Number(c.value), "native") : "none"}`, SetLockedUntil: "Lock date", SetGuardian: `Guardian → ${c.value ? short(String(c.value)) : "none"}`, AddTrusted: `Trust ${short(String(c.value))}`, RemoveTrusted: `Remove ${short(String(c.value))}` }[c.kind] || c.kind);
  if (P.edit) {
    const E = {
      delay: ["Withdrawal delay", `<p class="sub">How long anything leaving your Safe waits. Longer applies now; shorter waits ${delay(m.ruleDelay)}.</p><div class="presets">${[[86400, "24 h"], [3 * 86400, "3 days"], [7 * 86400, "7 days"]].map(([v2, l]) => `<button class="preset ${m.withdrawDelay === v2 ? "on" : ""}" data-act="rule-set" data-k="delay" data-v="${v2}"><b>${l}</b></button>`).join("")}</div>`],
      limit: ["Daily limit", `<p class="sub">The most that can leave your Safe in a day, per network. Lower applies now; higher waits ${delay(m.ruleDelay)}. Enter 0 for no limit.</p>
        <div class="stack">${vs.some((r) => r.k === "sol") ? `<label class="fld"><span>Solana · SOL per day</span><input data-lim="sol" inputmode="decimal" placeholder="e.g. 5"/></label>` : ""}${vs.some((r) => famOf(r.k) === "evm") ? `<label class="fld"><span>Ethereum-style networks · ETH/POL per day</span><input data-lim="evm" inputmode="decimal" placeholder="e.g. 0.5"/></label>` : ""}</div>
        <div class="pfoot"><button class="btn primary xl" data-act="rule-set" data-k="limit">Save limit</button></div>`],
      guardian: ["Guardian", `<p class="sub">Someone you trust who can release a real emergency faster. They can never start a withdrawal or choose where money goes. Changing it waits ${delay(m.ruleDelay)}.</p>
        <div class="stack">${vs.some((r) => r.k === "sol") ? `<label class="fld"><span>Guardian's Solana address</span><input data-g="sol" spellcheck="false" autocomplete="off"/></label>` : ""}${vs.some((r) => famOf(r.k) === "evm") ? `<label class="fld"><span>Guardian's Ethereum address (all Ethereum-style networks)</span><input data-g="evm" spellcheck="false" autocomplete="off" placeholder="0x…"/></label>` : ""}</div>
        <div class="pfoot"><button class="btn primary xl" data-act="rule-set" data-k="guardian">Save guardian</button></div>`],
      trust: ["Trusted addresses", `<p class="sub">Your own addresses (exchange, cold wallet) that can be paid straight from the Safe. Adding one waits ${delay(m.ruleDelay)}; removing applies now.</p>
        <section class="list">${trusted.length ? trusted.map(([f, a]) => `<div class="arow"><span class="ar-t"><b class="mono">${short(a)}</b><small>${f === "sol" ? "Solana" : "Ethereum-style networks"}</small></span><button class="btn sm" data-act="rule-set" data-k="untrust" data-f="${f}" data-a="${esc(a)}">Remove</button></div>`).join("") : `<div class="hid-note">None yet</div>`}</section>
        <label class="fld"><span>Add an address</span><input data-trust spellcheck="false" autocomplete="off" placeholder="Solana or 0x… address"/></label>
        <div class="pfoot"><button class="btn primary xl" data-act="rule-set" data-k="trust">Add address</button></div>`],
      freeze: ["Freeze your Safe", `<p class="sub">For when something feels wrong: until the date you pick, <b>nothing leaves</b> your Safe on any network, including withdrawals already waiting. You can still cancel, and your guardian can still release an emergency. A freeze can't be ended early.</p>
        <div class="presets">${[[1, "24 hours"], [7, "7 days"], [30, "30 days"]].map(([d, l]) => `<button class="preset" data-act="rule-set" data-k="freeze" data-v="${d}"><b>${l}</b><small>until ${new Date((now() + d * 86400) * 1000).toLocaleDateString()}</small></button>`).join("")}</div>`],
    }[P.edit];
    return `${phead(E[0])}${busy}<div class="pad-x">${E[1]}</div>`;
  }
  const row = (k, ic, title, v) => `<button class="srow" data-act="rule-open" data-k="${k}"><span>${ic}${title}</span><span class="sv">${esc(v)} ${I.arrow}</span></button>`;
  return `${phead("Rules and alerts")}${busy}
    <p class="sub pad">One set of rules for your Safe on every network (${vs.map((r) => NETS[r.k].name).join(", ")}).</p>
    <div class="sets">
      ${row("delay", I.clock, "Withdrawal delay", delay(m.withdrawDelay))}
      ${row("limit", I.out, "Daily limit", vs.map(fmtLim).filter((x, i, a) => a.indexOf(x) === i).join(" · "))}
      ${row("guardian", I.shield, "Guardian", [vs.some((r) => r.k === "sol") && `SOL ${guard("sol")}`, vs.some((r) => famOf(r.k) === "evm") && `ETH ${guard("evm")}`].filter(Boolean).join(" · "))}
      ${row("trust", I.check, "Trusted addresses", trusted.length ? `${trusted.length}` : "None")}
      ${row("freeze", I.lock, "Freeze", lockTxt)}
    </div>
    ${pending.length ? `<div class="list-h"><b>Waiting changes</b><span>cancel any time</span></div><section class="list">${pending.map((c) => { const ready = c.readyAt <= t; return `<div class="wrow ${ready ? "ready" : ""}">${coin(c.k)}<span class="wr-t"><b>${esc(label(c.change))}</b><small>${NETS[c.k].name}</small></span><span class="wr-r"><b class="cd">${ready ? "Ready" : dur(c.readyAt - t)}</b>${ready ? `<button class="btn sm primary" data-act="rc-apply" data-n="${c.k}" data-id="${c.id}">Apply</button>` : ""}<button class="btn sm danger" data-act="rc-cancel" data-n="${c.k}" data-id="${c.id}">Cancel</button></span></div>`; }).join("")}</section>` : ""}
    <div class="list-h"><b>Alerts</b><span>when a withdrawal is requested</span></div>
    <div class="sets">
      <button class="srow" data-act="al-tg"><span>${I.send}Telegram</span><span class="sv">Turn on ${I.ext}</span></button>
      <div class="srow mailrow"><span>${I.recv}Email</span><span class="mail-in"><input data-mail type="email" placeholder="you@example.com" autocomplete="email"/><button class="btn sm" data-act="al-mail">On</button></span></div>
    </div>
    <p class="fine pad">Alerts cover your Solana and Ethereum addresses on every network. If a withdrawal you didn't make shows up, open your Safe and cancel it.</p>`;
}
