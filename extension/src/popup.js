// Ecrin Wallet popup. Two accounts on every network: Wallet (spend instantly) and Safe (the
// Ecrin vault: anything leaving waits its delay and can be cancelled). One recovery phrase, encrypted on disk;
// while unlocked it sits only in the browser's memory (chrome.storage.session) and is wiped by auto-lock.
import * as web3 from "@solana/web3.js";
import { ethers } from "ethers";
import qrcode from "qrcode-generator";
import { newPhrase, isPhrase, normalize, seal, open, deriveAccount, strength, WORDS } from "./keyring.js";
import { NETS, BASE, USDC_BASE, engine, modeNets } from "./chains.js";
import { txEvents, setPrivate, PROXY } from "./netmode.js";
import { makeApprovals } from "./approve.js";
import { mountVault3d } from "./vault3d.js";
import { bioEnable, bioUnlock, bioName, bioPossible, bioForget } from "./bio.js";
import { sealKeys, openKeys, parseKey, keysFor, COLORS, b58 } from "./accounts.js";
import { translate, trText, LANGS } from "./i18n.js";
import { toTron } from "./tron.js";
import { suiAddress } from "./sui.js";
import { ed25519 } from "@noble/curves/ed25519";
import { bech32 } from "@scure/base";
import { LOGOS } from "./logos.js";

const VERSION = chrome.runtime.getManifest().version;
// The browser extension can also run as a full page (set-up opens there, like other serious wallets): the same wallet,
// framed in the middle of a lit page. Everything inside works exactly as in the popup.
const IS_EXT = !globalThis.ECRIN_WEB && !globalThis.ECRIN_DEMO && !!globalThis.chrome?.tabs;
const FULL = IS_EXT && new URLSearchParams(location.search).has("full");
const openFull = () => { chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?full=1") }); if (!FULL) window.close(); };
if (FULL) addEventListener("resize", () => { const d = S.screen === "home" && innerWidth >= 1100 ? "1" : ""; if (document.documentElement.dataset.fpDash !== d) { document.documentElement.dataset.fpDash = d; } });
if (FULL) {
  document.documentElement.dataset.full = "1";
  const box = document.createElement("div"); box.className = "device fp-frame";
  for (const id of ["root", "panel", "toast"]) { const el = document.getElementById(id); if (el) box.append(el); }
  document.body.prepend(box);
  queueMicrotask(() => { // after the rest of the module has loaded (the logo is defined below)
  document.body.insertAdjacentHTML("afterbegin", `<aside class="fp-side"><p class="fp-eyebrow">Ecrin Wallet · testnet beta</p><h2>A wallet with a Safe nobody can rush.</h2>
    <p class="fp-lead">Spend from your Wallet like any other. Keep the rest in your Safe: anything leaving it waits for a delay you set, enforced on-chain, and you can cancel it.</p>
    <ul class="fp-pts"><li><i>${'<svg viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/></svg>'}</i><span><b>A Safe with a delay</b>Drainers, casino deposits and 100x leverage meet a wait they can\'t skip.</span></li>
      <li><i>${'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>'}</i><span><b>Cancel any time</b>Something wrong? Stop it before it lands. Alerts by Telegram or email.</span></li>
      <li><i>${'<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>'}</i><span><b>A pause when it matters</b>Late at night it offers to sleep on it, and it can warn you before a betting site connects.</span></li>
      <li><i>${'<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10"/></svg>'}</i><span><b>Every network, one wallet</b>Solana, Ethereum, Base, Arbitrum and more, with free test coins in one tap.</span></li></ul>
    <p class="fp-fine">Not audited yet. Never use real funds in the beta.</p></aside>`);
  document.body.insertAdjacentHTML("afterbegin", `<header class="fp-h">${WORDMARK("md")}<b class="fp-sub">Wallet</b><span class="fp-tag">Testnet beta</span><nav><a href="https://ecrinprotocol.app/how-it-works/" target="_blank">How it works</a><a href="https://ecrinprotocol.app/security/" target="_blank">Security</a><a href="https://ecrinprotocol.app/" target="_blank">ecrinprotocol.app</a></nav></header>`);
  });
}
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
  bell: '<svg viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
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
// The website's lockup: the blue outlined mark and "Ecrin" in Unbounded (the curved E).
const MARK = '<svg viewBox="0 0 32 32" class="wm-mark" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="8" fill="none" stroke="#2F5BFF" stroke-width="2.2"/><path d="M16 9.5l5.5 6.5L16 22.5 10.5 16z" fill="#2F5BFF"/></svg>';
const WORDMARK = (cls = "") => `<span class="wm ${cls}">${MARK}<b>Ecrin</b></span>`;
const LOGO = '<svg viewBox="0 0 32 32" class="logo"><rect x="3" y="3" width="26" height="26" rx="8" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16 9.5l5.5 6.5L16 22.5 10.5 16z" fill="currentColor"/></svg>';
const SOLP = "M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1zM64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1zM333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1z";
let gid = 0;
// A network's logo: mainnet keys are the test key plus "m" (solm, basem…) and share its logo.
const logoKey = (k) => (LOGOS[k] ? k : NETS[k]?.real && LOGOS[k.slice(0, -1)] ? k.slice(0, -1) : k);
const coin = (k, cls = "") => { const L = logoKey(k); return `<span class="coin logo c-${L} ${cls}" aria-hidden="true">${LOGOS[L] || LOGOS.eth}</span>`; };
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
// Amounts are kept in US dollars and shown in the currency you pick (Settings → Currency), at today's rate.
const CURS = [["USD", "US dollar"], ["EUR", "Euro"], ["CAD", "Canadian dollar"], ["GBP", "British pound"], ["CHF", "Swiss franc"], ["AUD", "Australian dollar"], ["JPY", "Japanese yen"]];
const curRate = () => (S.cur && S.cur !== "USD" && S.fx?.[S.cur] ? S.fx[S.cur] : 1);
const curCode = () => (curRate() === 1 && S.cur !== "USD" ? "USD" : S.cur || "USD");
const money = (n, opt = {}) => (n * curRate()).toLocaleString(S.lang === "fr" ? "fr-CA" : "en-US", { style: "currency", currency: curCode(), currencyDisplay: "narrowSymbol", ...opt }); // "$" / "€", never "CA$" or "US$"
async function loadFx() {
  if (S.mock) { S.fx = { EUR: 0.92, CAD: 1.37, GBP: 0.79, CHF: 0.88, AUD: 1.52, JPY: 152 }; return; }
  const { fx } = await local.get("fx"); if (fx?.r) S.fx = fx.r; // last known rates at once, even if old
  if (fx && Date.now() - fx.at < 12 * 3600_000 && CURS.slice(1).every(([c]) => fx.r?.[c] > 0)) return;
  // Three free sources, one after the other: CoinGecko is often busy (it also serves prices and charts).
  const want = CURS.slice(1).map(([c]) => c), pick = (get) => Object.fromEntries(want.map((c) => [c, Number(get(c))]).filter(([, v]) => v > 0));
  const srcs = [
    async () => { const t = (await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd,${want.join(",").toLowerCase()}`))?.tether; return t?.usd ? pick((c) => t[c.toLowerCase()] / t.usd) : {}; },
    async () => { const r = (await getJSON("https://api.coinbase.com/v2/exchange-rates?currency=USD"))?.data?.rates || {}; return pick((c) => r[c]); },
    async () => { const r = (await getJSON("https://open.er-api.com/v6/latest/USD"))?.rates || {}; return pick((c) => r[c]); },
  ];
  for (const src of srcs) {
    try { const r = await src(); if (Object.keys(r).length >= want.length - 1) { S.fx = r; await local.set({ fx: { at: Date.now(), r } }); if (S.screen === "home") render(); return; } } catch (_) {}
  }
  if (S.cur && S.cur !== "USD" && !S.fx?.[S.cur]) setTimeout(loadFx, 60_000); // nothing yet: try again in a minute
}
// Decimals dimmed; dollar cents also carry "cents" so the Numbers setting can hide them without touching coin amounts.
const fig = (str) => {
  // Splits "−$3,948.00" / "3 948,00 $ US" into sign, currency mark, whole part and decimals, so each can be styled.
  // Decimals: the last "." (en), or a "," when it can't be a thousands comma ("1,234" in English stays whole).
  const s = String(str), m = s.match(/^([^\d]*?)(\d(?:[\d\s\u00a0\u202f.,]*\d)?)([^\d]*)$/);
  if (!m) return esc(s);
  const [, pre, num, suf] = m, sg = (pre.match(/^[−-]\s?/) || [""])[0], sym = pre.slice(sg.length), money = !!(sym.trim() || suf.trim());
  const di = num.includes(".") ? num.lastIndexOf(".") : num.includes(",") && (/[\s\u00a0\u202f]/.test(num) || !/,\d{3}$/.test(num)) ? num.lastIndexOf(",") : -1;
  const whole = di < 0 ? num : num.slice(0, di), dec = di < 0 ? "" : num.slice(di);
  return `${esc(sg)}${sym ? `<span class="cur">${esc(sym)}</span>` : ""}${esc(whole)}${dec ? `<span class="dec${money ? " cents" : ""}">${esc(dec)}</span>` : ""}${suf ? `<span class="cur suf">${esc(suf)}</span>` : ""}`;
};
/** A countdown people read at a glance: "6 d 23 h" while it's days away, then 05:42:10 on the last day. */
const clockTxt = (sec) => { sec = Math.max(0, Math.floor(sec)); const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  return d ? `${d} d ${h} h` : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`; };
const parseAmt = (s, a) => { const v = Number(String(s).replace(/,/g, "")); return Number.isFinite(v) && v > 0 ? Math.round(v * A(a).base) : 0; };
const mask = (s) => (S.hide ? "••••" : s);

// ------------------------------------------------------------------ state

let ENG = null, ACCT = null, PHRASE = null;
const DEF_ACCTS = [{ id: "hd0", kind: "hd", i: 0, name: "Account 1", c: 0 }];
/** The networks the current account can use: all of them, or one family for an imported private key. */
// Sui: the account address, and its private key in Sui's export format (suiprivkey…, which Slush and the Sui CLI import).
const suiOf = (A) => (A?.sui ? suiAddress(ed25519.getPublicKey(A.sui)) : null);
const suiKeyHex = (k) => bech32.encode("suiprivkey", bech32.toWords(Uint8Array.of(0, ...k)));
// Networks, like any major wallet: Mainnet (real money) or Testnet, chosen in Settings → Networks. Testnet stays the
// default until mainnet launches; DEFAULT_MODE flips it.
const DEFAULT_MODE = "test";
const isMain = () => S.mode === "main";
/** A network's name, with its test network added when two shown networks share a name (Ethereum Sepolia, Ethereum Hoodi). */
const nname = (N) => (netKeys().some((k) => k !== N.key && NETS[k].name === N.name) ? `${N.name} ${N.net}` : N.name);
const netKeys = () => modeNets(S.mode || DEFAULT_MODE).filter((k) => !ACCT?.only || NETS[k].fam === ACCT.only);
const curAcct = () => (S.accts || DEF_ACCTS).find((a) => a.id === S.sel) || (S.accts || DEF_ACCTS)[0];
async function useAccount(phrase) {
  PHRASE = normalize(phrase);
  const st = await local.get(["accts", "acctSel", "keysBox"]);
  S.accts = st.accts?.length ? st.accts : DEF_ACCTS; S.sel = st.acctSel || S.accts[0].id;
  let imported = {}; try { imported = await openKeys(st.keysBox, PHRASE); } catch (_) {}
  try { ACCT = keysFor(curAcct(), PHRASE, imported, { web3, ethers }); }
  catch (_) { S.sel = S.accts[0].id; ACCT = keysFor(S.accts[0], PHRASE, imported, { web3, ethers }); }
  ENG = null;
  if (!netKeys().includes(S.net)) S.net = netKeys()[0];
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
  const pr = await local.get(["book", "hideSmall", "order", "recvNotify", "guard", "alertsOn", "showNfts", "goal", "cur", "palerts", "sounds", "obHide", "earlySafe"]); S.obHide = !!pr.obHide; S.earlySafe = !!pr.earlySafe; S.palerts = pr.palerts || {}; S.sounds = !!pr.sounds; S.showNfts = !!pr.showNfts; S.goal = pr.goal || null; S.cur = pr.cur || "USD"; Object.assign(S, { book: pr.book || {}, hideSmall: !!pr.hideSmall, order: pr.order || "value", recvNotify: pr.recvNotify, guard: { auto: 0, daily: 0, cool: 0, coolOver: 500, late: 1, bet: 0, ...(pr.guard || {}) }, alertsOn: !!pr.alertsOn });
  const st = await local.get(["box", "net", "theme", "autolock", "hide", "nums", "range", "dev", "prices", "bio", "lang", "netMode"]);
  S.mode = st.netMode === "main" || st.netMode === "test" ? st.netMode : DEFAULT_MODE;
  // Which mainnet networks have a private server at Ecrin: the last known list now, a fresh one in the background (hourly).
  local.get("privRpc").then(({ privRpc }) => { setPrivate(privRpc?.list); if (privRpc && Date.now() - privRpc.at < 3600_000) return;
    fetch(PROXY + "status").then((r) => r.json()).then((d) => { setPrivate(d.private); local.set({ privRpc: { at: Date.now(), list: d.private || [] } }); }).catch(() => {}); }).catch(() => {});
  S.lang = st.lang || (/^fr/i.test(navigator.language || "") ? "fr" : "en"); document.documentElement.lang = S.lang;
  S.bio = globalThis.ECRIN_WEB && st.bio ? st.bio : null;
  // The phone app opens on the spinning Ecrin mark for a moment.
  if (globalThis.ECRIN_WEB) await new Promise((r) => setTimeout(r, Math.max(0, 1300 - performance.now())));
  if (st.prices?.p && Date.now() - st.prices.at < 86400_000) S.prices = st.prices.p;
  if (st.nums) S.nums = { ...S.nums, ...st.nums };
  if (["1", "7", "30", "365"].includes(st.range)) S.range = st.range;
  S.mock = !!st.dev?.mockPrices;
  applyNums();
  S.net = NETS[st.net] && netKeys().includes(st.net) ? st.net : netKeys()[0];
  S.theme = ["light", "ecrin"].includes(st.theme) ? st.theme : "dark";
  S.autolock = st.autolock ?? 15;
  try { chrome.runtime.connect?.({ name: "popup" }); } catch (_) {}
  S.hide = !!st.hide;
  applyTheme();
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

function readyView() {
  return `<div class="fp-ready"><div class="aura" aria-hidden="true" style="${auraT()}"><i class="a1"></i><i class="a2"></i><i class="a3"></i></div>
    <span class="fp-dck">${dcheck()}</span>
    <h1>You're all set</h1><p>Your wallet is ready. Pin Ecrin to your toolbar, then open it as a popup from any page.</p>
    <ol class="fp-pin"><li><span class="fp-k"><svg viewBox="0 0 24 24"><path d="M10 4h4v4h3a2 2 0 0 1 2 2v3h-2.5a2 2 0 1 0 0 4H19v3a2 2 0 0 1-2 2h-3v-2.5a2 2 0 1 0-4 0V21H7a2 2 0 0 1-2-2v-3h2.5a2 2 0 1 0 0-4H5V10a2 2 0 0 1 2-2h3z"/></svg></span><span>Click the puzzle piece at the top right of Chrome</span></li>
      <li><span class="fp-k"><svg viewBox="0 0 24 24"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6"/></svg></span><span>Pin <b>Ecrin Wallet</b></span></li></ol>
    <button class="btn primary xl" data-act="open-popup">Open as popup</button>
    <button class="btn ghost xl" data-act="ready-go">Keep using it in this tab</button></div>`;
}
async function home() {
  if (FULL && S.setupFlow) { S.setupFlow = false; S.screen = "ready"; render(); return; }
  checkUpdate(); loadBackup(); applyPendingLimit(); loadFx();
  S.screen = "home"; await eng(); S.histAt = 0; S.hist = []; render(); loadActivity();
  loadAll();
  refresh();
  loadPrices();
  // Phone app shortcuts (long-press the icon): Send, Receive, Freeze.
  const go = !S.wentTo && new URLSearchParams(location.search).get("go"); S.wentTo = true;
  if (go && ["send", "receive", "safety", "vault"].includes(go)) setTimeout(() => openPanel(go), 400);
  if (globalThis.ECRIN_WEB) pushCheck();
  if (S.offerBio) { S.offerBio = false; if (globalThis.ECRIN_WEB && bioPossible() && !S.bio) setTimeout(offerBio, 1400); }
}
// ---- Safe alerts as notifications on this phone (Web Push from Ecrin's server, the same alerts as Telegram and email).
// Every network where your Safe is open is followed: a withdrawal starting, a rule change waiting, money moving.
// Tapping one opens the Safe screen here (the service worker remembers that the wallet turned them on).
const pushPossible = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const b64uBytes = (x) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((x.length + 3) % 4)), (c) => c.charCodeAt(0));
/** The Safes to follow, in the server's shape: one Solana, one Ethereum-style (the server follows its whole family). */
function pushTargets() {
  const rows = openRows(), out = [];
  const sol = rows.find((r) => NETS[r.k].fam === "sol" && NETS[r.k].test), evm = rows.find((r) => NETS[r.k].fam === "evm" && NETS[r.k].test);
  if (sol && ACCT?.sol) out.push({ net: sol.k, owner: ACCT.sol.publicKey.toBase58(), vault: sol.v.main.address?.toBase58?.() || ENG?.vaultAddress?.() || "" });
  if (evm && ACCT?.evm) out.push({ net: evm.k, owner: ACCT.evm.address });
  return out.filter((t) => t.net !== "sol" || t.vault);
}
async function pushCheck() {
  if (!pushPossible() || Notification.permission !== "granted") { S.pushOn = false; return; }
  try { const reg = await navigator.serviceWorker.getRegistration("/"); S.pushOn = !!(await reg?.pushManager.getSubscription()) && !!(await local.get("pushOn")).pushOn; } catch (_) { S.pushOn = false; }
}
async function pushStart() {
  const t = pushTargets();
  if (!t.length) throw new Error(isMain() ? "Safe alerts follow your Safe, which runs on Testnet for now." : "Open your Safe first: alerts follow what's in it.");
  if ((await Notification.requestPermission()) !== "granted") throw new Error(/iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone ? "On iPhone, add Ecrin to your Home Screen first (Share → Add to Home Screen), then turn this on from there." : "Notifications are blocked for this site. Allow them in your browser's settings, then try again.");
  const reg = await navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready);
  const { key } = await fetch("/api/push/key").then((r) => r.json());
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(key) }));
  const [first, ...also] = t;
  const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...first, lang: S.lang, sub: sub.toJSON(), also }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Alerts aren't available right now. Try again in a minute.");
  reg.active?.postMessage({ type: "ecrin-open", app: "wallet" }); // taps open the wallet's Safe screen
  await local.set({ pushOn: true }); S.pushOn = true;
}
async function pushStop() {
  try { const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (sub) { await fetch("/api/push/unsubscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {}); await sub.unsubscribe().catch(() => {}); } } catch (_) {}
  await local.set({ pushOn: false }); S.pushOn = false;
}
async function offerBio() {
  const c = await choose({ icon: I.face, title: `Unlock with ${bioName()}?`, text: `<p>Open Ecrin with a glance instead of typing your password. Your recovery phrase stays encrypted on this device.</p>`, safe: "Turn on", go: "Not now", fine: "You can change this any time in Settings." });
  if (c === "safe") actions["bio-toggle"]();
}

async function refresh() {
  try {
    const e = await eng(), net = S.net, acct = ACCT;
    const [bal, vault] = await Promise.all([e.balances(), e.vault().catch((err) => (console.warn(err), null))]);
    if (S.net !== net || ACCT !== acct) return; // switched network or account while this was loading
    S.bal = bal; S.vault = vault; S.err = null; autoProtect(bal); queueMicrotask(checkIncoming);
  } catch (err) { console.warn(err); S.err = `Can't reach ${NETS[S.net].name} right now. Retrying…`; setTimeout(refresh, 6000); }
  // Redraw only when something you can see changed: a rebuild every 15s for nothing makes the page jolt.
  let sig = Math.random(); try { sig = JSON.stringify([S.bal, S.vault, S.err, S.net, S.sel], (k, v) => (typeof v === "bigint" ? v.toString() : v && v.toBase58 ? v.toBase58() : v)); } catch (_) {}
  if (sig === S.refreshSig && !S.forceDraw) return; S.refreshSig = sig; S.forceDraw = false;
  if (S.screen === "home") render();
  if (S.panel) renderPanel();
}

// Prices come from CoinGecko first, then Binance, then Coinbase: if one is down or rate-limits us, the next answers.
const SYM = { solana: "SOL", ethereum: "ETH", "polygon-ecosystem-token": "POL", binancecoin: "BNB", "avalanche-2": "AVAX", tron: "TRX", hyperliquid: "HYPE", sui: "SUI" };
// An address that is valid somewhere else: say where, so nobody sends across networks (those coins are lost).
const ADDR_SHAPES = [["evm", "Ethereum-style", /^0x[0-9a-fA-F]{40}$/], ["sui", "Sui", /^0x[0-9a-fA-F]{64}$/], ["tron", "Tron", /^T[1-9A-HJ-NP-Za-km-z]{33}$/],
  ["btc", "Bitcoin", /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,33})$/], ["xrp", "XRP", /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/], ["sol", "Solana", /^[1-9A-HJ-NP-Za-km-z]{32,44}$/]];
function otherAddr(v) {
  const here = NETS[S.net].fam, hit = ADDR_SHAPES.find(([, , re]) => re.test(v)); if (!hit || hit[0] === here) return "";
  const [f, name] = hit, can = Object.values(NETS).some((N) => N.fam === f);
  return can ? `That's a ${name} address, not ${NETS[S.net].name}. Pick a coin on ${name === "Ethereum-style" ? "an Ethereum-style network" : name} to send there.` : `That's a ${name} address. Ecrin can't send to ${name} yet.`;
}
const addrHint = (N) => (N.fam === "sol" ? "Solana address" : N.fam === "tron" ? "Tron address (T…)" : N.fam === "sui" ? "Sui address (0x…, 64 characters)" : "0x… address");
const getJSON = async (url) => { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error(r.status); return r.json(); };

async function spotPrices() {
  // Ecrin's own feed first: fetched once a minute for everyone, so nobody gets rate-limited into "no 24h change".
  try { const j = await getJSON("https://ecrinprotocol.app/api/prices"); if (j?.prices?.solana?.usd) return j.prices; } catch (_) {}
  try { const j = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${Object.keys(SYM).join(",")}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`); if (j?.solana?.usd) return j; } catch (_) {}
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
  if (S.mock) { S.prices = { solana: { usd: 172.4, usd_24h_change: 2.31 }, binancecoin: { usd: 612.5, usd_24h_change: 0.6 }, "avalanche-2": { usd: 28.4, usd_24h_change: -1.4 }, hyperliquid: { usd: 38.2, usd_24h_change: 3.1 }, tron: { usd: 0.24, usd_24h_change: 0.9 }, sui: { usd: 1.92, usd_24h_change: -2.1 }, ethereum: { usd: 3410, usd_24h_change: -0.84 }, "polygon-ecosystem-token": { usd: 0.42, usd_24h_change: 1.2 } }; if (S.screen === "home" && !S.mockDrawn) { S.mockDrawn = true; render(); } return loadSeries(); }
  const p = await spotPrices().catch(() => null);
  if (p) { const was = JSON.stringify(S.prices); S.prices = { ...S.prices, ...p }; local.set({ prices: { at: Date.now(), p: S.prices } }); if (S.screen === "home" && JSON.stringify(S.prices) !== was) render(); checkPriceAlerts(); }
  await loadSeries();
  // No spot price anywhere: use the last point of the history instead.
  let filled = false;
  for (const cg of Object.keys(SYM)) { const h = S.series[`${cg}:${S.range}`]; if (!S.prices[cg]?.usd && h) { S.prices[cg] = { usd: h.pts[h.pts.length - 1][1] }; filled = true; } }
  if (filled && S.screen === "home") render();
  fillChanges();
  if (!p) setTimeout(loadPrices, 30_000);
}
// A source without a 24h change (or a price taken from the chart) must not read as "+0.00%": work the change out
// from the last day of prices instead. One fetch per coin every 10 minutes at most.
async function fillChanges() {
  if (S.mock) return; S.chg1 ||= {};
  const todo = Object.keys(SYM).filter((cg) => S.prices[cg]?.usd != null && S.prices[cg].usd_24h_change == null && !(Date.now() - (S.chg1[cg] || 0) < 600_000));
  if (!todo.length) return;
  let changed = false;
  await Promise.all(todo.map(async (cg) => {
    S.chg1[cg] = Date.now();
    // any loaded chart that reaches back a day will do (the week chart has hourly points); else fetch the day
    const cover = (k) => { const q = S.series[`${cg}:${k}`]?.pts; return q?.length > 2 && q[0][0] <= Date.now() - 86400_000 ? q : null; };
    const pts = cover(1) || cover(7) || (await historyFrom(cg, 1).catch(() => null));
    if (!(pts?.length > 2)) return;
    const cut = Date.now() - 86400_000, from = pts.find(([t]) => t >= cut) || pts[0], last = S.prices[cg]?.usd ?? pts[pts.length - 1][1];
    if (from[1] > 0 && S.prices[cg]) { S.prices[cg] = { ...S.prices[cg], usd_24h_change: ((last - from[1]) / from[1]) * 100 }; changed = true; }
  }));
  if (changed && S.screen === "home" && !S.scrubbing) render();
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
  if (!pts && globalThis.ECRIN_DEMO) pts = fakeHistory(cg, days, S.prices[cg]?.usd || { solana: 170, ethereum: 3400, hyperliquid: 38, binancecoin: 600, "avalanche-2": 25, tron: 0.24, sui: 1.9, "polygon-ecosystem-token": 0.4 }[cg] || 1);
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
    // Staked coins are still yours and still in your Safe: they count in the Safe's share and in every total.
    const stk = Math.max(0, S.stakes?.[r.k]?.staked || 0);
    const N = NETS[r.k], px = S.prices[N.cg]?.usd, natC = r.b.native || 0, natS = (r.v?.main?.balance || 0) + stk, uC = r.b.usdc || 0, uS = r.v?.usdc?.balance || 0;
    if (r.v) vaults++;
    leaving += (r.v?.main?.withdrawals?.length || 0) + (r.v?.usdc?.withdrawals?.length || 0);
    for (const x of r.v?.main?.withdrawals || []) leaveAmt[N.unit] = (leaveAmt[N.unit] || 0) + x.amount / BASE;
    for (const x of r.v?.usdc?.withdrawals || []) leaveAmt.USDC = (leaveAmt.USDC || 0) + x.amount / USDC_BASE;
    if (natC + natS > 0) {
      coins[N.cg] = (coins[N.cg] || 0) + (natC + natS) / BASE;
      const c = px != null ? (natC / BASE) * px : 0, v = px != null ? (natS / BASE) * px : 0; chq += c; sav += v;
      items.push({ k: r.k, a: "native", coin: N.unit === "ETH" ? "eth" : r.k === "solm" ? "sol" : r.k, cg: N.cg, unit: N.unit, name: COIN_NAME[N.unit] || N.unit, net: nname(N), real: !!N.real, chq: natC / BASE, sav: natS / BASE, stk: stk / BASE, usd: px != null ? c + v : null, dec: N.unit === "SOL" ? 4 : 5 });
    }
    if (uC + uS > 0) {
      usdc += (uC + uS) / USDC_BASE; chq += uC / USDC_BASE; sav += uS / USDC_BASE;
      items.push({ k: r.k, a: "usdc", coin: "usdc", cg: "usdc", unit: "USDC", name: "USD Coin", net: nname(N), real: !!N.real, chq: uC / USDC_BASE, sav: uS / USDC_BASE, usd: (uC + uS) / USDC_BASE, dec: 2 });
    }
  }
  items.sort((x, y) => (y.usd || 0) - (x.usd || 0));
  const lv = Object.entries(leaveAmt), leavingText = lv.length ? `${lv[0][1].toLocaleString("en-US", { maximumFractionDigits: lv[0][0] === "USDC" ? 2 : 4 })} ${lv[0][0]}${lv.length > 1 ? ` +${lv.length - 1} more` : ""}` : "";
  return { items, coins, usdc, chq, sav, total: chq + sav, leaving, leavingText, vaults, ready: rows.length > 0, all: !!S.all };
}

// ------------------------------------------------------------------ screens

function go(screen, extra = {}) { Object.assign(S, { screen }, extra); render(); }

// Anything that fails without its own message (a network out of reach, a timeout) still tells you what happened.
addEventListener("unhandledrejection", (e) => { const m = String(e.reason?.message || e.reason || ""); if (!m) return; e.preventDefault?.();
  toast(/fetch|network|timeout|ECONN|503|502|429/i.test(m) ? "Can't reach that network right now. Check your connection and try again." : errText(e.reason), "err"); });

// The lock screen shows your account (logo and name) before anything is unlocked: only public details are kept for it.
local.get(["accts", "acctSel", "addrCache"]).then((st) => { S.lockInfo = { ...st, addrCache: { ...(st.addrCache || {}), ...(S.lockInfo?.addrCache || {}) } }; if (S.screen === "unlock") render(); }).catch(() => {});

// Offline: say so, keep the last balances on screen, and refresh the moment the connection is back.
S.offline = !navigator.onLine;
addEventListener("offline", () => { S.offline = true; if (S.screen === "home") render(); });
addEventListener("online", () => { S.offline = false; if (S.screen === "home") { render(); refresh?.(); loadPrices?.(); } });

// The bar steps aside while you read down the page and comes back as soon as you scroll up (or reach the top).
let tbY = 0;
document.addEventListener("scroll", (ev) => {
  const tb = document.getElementById("tabbar"); if (!tb || tb.hidden) return;
  const t = ev.target === document ? document.scrollingElement : ev.target; if (!t || !t.closest?.("#root, html")) return;
  const y = t.scrollTop, dy = y - tbY; if (Math.abs(dy) < 6) return;
  tb.classList.toggle("away", dy > 0 && y > 140); tbY = y;
}, { capture: true, passive: true });
// ------------------------------------------------------------------ getting started
// For a new wallet: three steps that show what Ecrin is for, with progress. Gone once done or dismissed.
// Test coins straight from Ecrin's faucet on Solana devnet; other networks link to their public faucet.
const FAUCET_URL = "https://ecrinprotocol.app/api/faucet";
const faucetBtn = (N, cls = "link", label = `Get free test ${N.unit}`) => N.real || !N.faucet && N.key !== "sol" ? "" : N.key === "sol" ? `<button class="${cls} fau-b" data-act="faucet">${label}</button>` : `<a class="${cls}" href="${N.faucet}" target="_blank">${label} ${I.ext}</a>`;
function startCard(w) {
  if (S.obHide || !w.ready || isMain()) return ""; // the guide walks through the Safe, which is on Testnet for now
  const acts = S.activity || [], did = (t) => acts.some((e) => t.includes(e.t));
  const steps = [["Get free test coins", w.total > 0, S.net === "sol" ? 'data-act="faucet"' : 'data-act="panel" data-p="receive"'], ["Protect some in your Safe", w.sav > 0 || did(["protect"]), 'data-act="panel" data-p="protect"'],
    ["Start a withdrawal, then cancel it", did(["cancel", "withdraw", "release"]), 'data-act="panel" data-p="vault"']];
  const n = steps.filter((x) => x[1]).length; if (n === 3) return "";
  // Only the next step: one line, the count as a small ring, a way to hide it.
  const i = steps.findIndex((x) => !x[1]), [t, , a] = steps[i];
  return `<section class="ob ob1"><button class="ob-next" ${a}><span class="ob-ring" style="--p:${(n / 3) * 100}" aria-label="${n} of 3 done"><b>${n}/3</b></span><span class="ob-t"><small>Next step</small><b>${t}</b></span>${I.arrow}</button><button class="ob-x" data-act="ob-hide" aria-label="Hide">×</button></section>`;
}

// ------------------------------------------------------------------ the entrance
// Opening the wallet, home arrives in order: each section rises a few pixels and fades in, 55ms after the one before,
// on a soft ease-out. It is timed from the moment you arrived, so a redraw in the middle (balances refresh every 15s)
// carries on where it was instead of restarting. Only opacity and position move, so it stays smooth on phones.
const INTRO_MS = 1500, TAB_MS = 420;
const introLeft = () => (S.homeT0 ? performance.now() - S.homeT0 : 1e9);
const introCls = () => (introLeft() < INTRO_MS ? " intro" : "") + (S.tabT0 && performance.now() - S.tabT0 < TAB_MS ? " tab-in" : "");
const introVar = () => ` style="--ht:${-Math.round(Math.min(introLeft(), 1e6))}ms;--tt:${-Math.round(S.tabT0 ? Math.min(performance.now() - S.tabT0, 1e6) : 1e6)}ms"`;
function stageHome(root) {
  const h = root.querySelector(".home.intro, .home.tab-in"); if (!h) return;
  // The browser starts the animation when it can (the first frames after unlocking are busy). Anchor to when it really
  // started, so a redraw later lines up frame for frame instead of jumping ahead.
  const sync = (sel, key, flag, v) => { const a = h.querySelector(sel)?.getAnimations?.()[0]; if (!a || S[flag]) return; S[flag] = true;
    const used = parseFloat(h.style.getPropertyValue(v)) || 0; a.ready.then(() => { if (a.startTime != null) S[key] = a.startTime + used; }).catch(() => {}); };
  if (h.classList.contains("intro")) sync(":scope > .top", "homeT0", "homeSynced", "--ht");
  if (h.classList.contains("tab-in")) sync(":scope > .tab-body", "tabT0", "tabSynced", "--tt");
  let i = 0; for (const c of h.children) if (!c.classList.contains("aura")) c.style.setProperty("--i", Math.min(i++, 9));
  h.querySelectorAll(".tab-body > .list > .arow").forEach((r, j) => r.style.setProperty("--j", Math.min(j, 6)));
}
function syncTabbar() {
  const tb = document.getElementById("tabbar"); if (!tb) return;
  const cur = S.panel ? S.panel.p : "home", show = S.screen === "home" && !S.panel; // only on the home screen, never over a page
  if (tb.hidden !== !show) tb.classList.remove("away");
  tb.hidden = !show;
  tb.querySelectorAll("button").forEach((b) => { const on = b.dataset.tab === cur; b.classList.toggle("on", on); if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
}

// ------------------------------------------------------------------ light on the lozenge
// A thin highlight slides across the rings as the phone tilts (or the pointer moves on a computer), and the engraved
// rosette behind the total catches that same light. Values are -1..1; idle, the light rests at the top left.
const ROSETTE = (() => { let d = ""; for (let i = 0; i < 24; i++) { const a = (i * Math.PI) / 12; d += `<ellipse cx="110" cy="110" rx="58" ry="20" transform="rotate(${((a * 180) / Math.PI).toFixed(1)} 110 110)"/>`; } for (let r = 14; r <= 62; r += 6) d += `<circle cx="110" cy="110" r="${r}"/>`; return d; })();
const lit = () => S.lit || { x: -0.45, y: -0.55 };
function litDefs(L) {
  const px = 0.5 + L.x * 0.55, py = 0.5 + L.y * 0.55;
  return `<linearGradient id="lzsh" gradientUnits="objectBoundingBox" x1="${(px - 0.42).toFixed(3)}" y1="${(py - 0.42).toFixed(3)}" x2="${(px + 0.42).toFixed(3)}" y2="${(py + 0.42).toFixed(3)}"><stop offset=".38" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/><stop offset=".62" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <radialGradient id="lzgg" cx="${(0.5 + L.x * 0.32).toFixed(3)}" cy="${(0.5 + L.y * 0.32).toFixed(3)}" r=".42"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <mask id="lzgm" maskUnits="userSpaceOnUse" x="0" y="0" width="220" height="220"><rect width="220" height="220" fill="url(#lzgg)"/></mask>`;
}
let litRaf = 0;
let litAt = 0;
function setLit(x, y) {
  // Only while home is in front and the diamond is on screen; at most ~30 times a second; tiny tremors ignored.
  if (S.panel || document.hidden) return;
  const c = (v) => Math.max(-1, Math.min(1, v)), nx = c(x), ny = c(y), o = S.lit || { x: 0, y: 0 };
  if (Math.abs(nx - o.x) < .02 && Math.abs(ny - o.y) < .02) return;
  const now = performance.now(); if (now - litAt < 33) return; litAt = now;
  const z = document.querySelector(".lz"); if (z) { const r = z.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return; }
  S.lit = { x: nx, y: ny };
  if (litRaf) return;
  litRaf = requestAnimationFrame(() => {
    litRaf = 0; const L = lit(), d = document.querySelector(".lz defs"); if (d) d.innerHTML = litDefs(L);
  });
}
addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" && (S.screen === "home" || S.screen === "welcome") && !S.panel) setLit((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1); }, { passive: true });
addEventListener("deviceorientation", (e) => { if (e.gamma == null || (S.screen !== "home" && S.screen !== "welcome")) return; setLit(e.gamma / 30, (e.beta - 45) / 30); });
// iPhone asks once for motion access; we ask only when the lozenge itself is tapped.
document.addEventListener("click", (e) => {
  if (!e.target.closest?.(".lz-wrap, .onb-w") || S.motionAsked || typeof DeviceOrientationEvent?.requestPermission !== "function") return;
  S.motionAsked = true; DeviceOrientationEvent.requestPermission().catch(() => {});
});

// ------------------------------------------------------------------ money moves
// After protecting or withdrawing, a small diamond travels between the Wallet side and the Safe ring, and the ring beats.
function flyFx(kind) {
  if (document.documentElement.dataset.rot) return; // sideways: skip the flourish
  const w = document.querySelector(".wsplit .sp-w b"), z = document.querySelector(".lz-wrap"); if (!w || !z) return;
  const a = w.getBoundingClientRect(), b = z.getBoundingClientRect();
  const from = { x: a.left + a.width / 2, y: a.top + a.height / 2 }, to = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  const [p0, p1] = kind === "protect" ? [from, to] : [to, from], mid = { x: (p0.x + p1.x) / 2 + 40, y: Math.min(p0.y, p1.y) - 30 };
  const d = document.createElement("i"); d.className = "fly-d"; document.body.append(d);
  const at = (p, s) => `translate(${p.x - 7}px, ${p.y - 7}px) rotate(45deg) scale(${s})`;
  const an = d.animate([{ transform: at(p0, 0.4), opacity: 0 }, { transform: at(p0, 1), opacity: 1, offset: 0.12 }, { transform: at(mid, 1.15), offset: 0.5 }, { transform: at(p1, 0.7), opacity: 1, offset: 0.9 }, { transform: at(p1, 0.2), opacity: 0 }], { duration: 900, easing: "cubic-bezier(.5, 0, .3, 1)" });
  an.onfinish = () => { d.remove(); const r = document.querySelector(".lz"); if (r) { r.classList.remove("beat"); void r.getBoundingClientRect(); r.classList.add("beat"); } haptic("medium"); };
}

// ------------------------------------------------------------------ sheets
// The browser's grey confirm box, replaced by a sheet from the bottom: a handle, the question, and two clear buttons.
/** A gentle sheet: the calm choice is the big button, the other is always one tap away. Resolves "safe" or "go". */
function choose({ icon = "", title, text = "", safe, go, fine = "" }) {
  return new Promise((done) => {
    const w = document.createElement("div"); w.className = "ask-w care";
    w.innerHTML = `<div class="ask-bg"></div><div class="ask" role="dialog" aria-modal="true"><i class="sheet-h"></i>${icon ? `<span class="care-ic">${icon}</span>` : ""}<b class="ask-t">${esc(trText(title, S.lang))}</b>${text}
      <button class="btn xl primary" data-safe>${esc(trText(safe, S.lang))}</button><button class="btn xl ghost" data-go>${esc(trText(go, S.lang))}</button>${fine ? `<p class="care-fine">${esc(trText(fine, S.lang))}</p>` : ""}</div>`;
    (document.querySelector(".device") || document.body).append(w); haptic();
    requestAnimationFrame(() => w.classList.add("in"));
    const end = (v) => { w.classList.remove("in"); setTimeout(() => w.remove(), 320); done(v); };
    w.querySelector("[data-safe]").onclick = () => end("safe"); w.querySelector("[data-go]").onclick = () => end("go"); w.querySelector(".ask-bg").onclick = () => end("safe");
  });
}
const careP = (t) => `<p>${esc(trText(t, S.lang))}</p>`;
// Late-night pause: between midnight and 6 AM, starting a withdrawal from the Safe first offers to sleep on it.
const isLate = () => new Date().getHours() < 6;
// Betting sites: a short list of the big crypto casinos plus the words they use. Only checked when you turn the warning on.
const BET_HOSTS = ["stake.com", "stake.us", "rollbit.com", "bc.game", "roobet.com", "shuffle.com", "gamdom.com", "duelbits.com", "bets.io", "sportsbet.io", "cloudbet.com", "bitstarz.com", "fortunejack.com", "bitcasino.io", "metaspins.com", "betfury.io", "betpanda.io", "wild.io", "lucky.io", "bustabit.com", "primedice.com", "winr.games"];
const isBetting = (host) => { const h = String(host || "").toLowerCase().replace(/^www\./, ""); return BET_HOSTS.some((d) => h === d || h.endsWith("." + d)) || /casino|poker|slots?\b|roulette|blackjack|sportsbook|gambl|jackpot|plinko|(^|[.-])bet(s|ting|way|fair|365|online)?([.-]|$)/.test(h); };
const I_DICE = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.1"/><circle cx="15" cy="15" r="1.1"/><circle cx="15" cy="9" r="1.1"/><circle cx="9" cy="15" r="1.1"/></svg>';
async function betCheck(host) {
  const { betWait = {} } = await local.get("betWait"), left = (betWait[host] || 0) - Date.now();
  const text = `<div class="care-host">${esc(host)}</div>` + careP(left > 0 ? `You chose to wait before connecting. ${Math.ceil(left / 60000)} min left.` : "You asked Ecrin to warn you about betting sites. Take 10 minutes before connecting? If you still want to, it'll be one tap.");
  const c = await choose({ icon: I_DICE, title: left > 0 ? "Still waiting on this one" : "This looks like a betting site", text, safe: left > 0 ? "Keep waiting" : "Wait 10 minutes", go: "Connect anyway", fine: "Betting-site warnings are on. Change it in Settings → Safety." });
  if (c === "go") return true;
  if (left <= 0) { betWait[host] = Date.now() + 600_000; await local.set({ betWait }); }
  return false;
}
function ask(text, { ok = "Continue", danger = false, title = "" } = {}) {
  return new Promise((done) => {
    const w = document.createElement("div"); w.className = "ask-w";
    w.innerHTML = `<div class="ask-bg"></div><div class="ask" role="dialog" aria-modal="true"><i class="sheet-h"></i>${title ? `<b class="ask-t">${esc(trText(title, S.lang))}</b>` : ""}<p>${esc(trText(text, S.lang))}</p>
      <button class="btn xl ${danger ? "danger danger-f" : "primary"}" data-ok>${esc(trText(ok, S.lang))}</button><button class="btn xl ghost" data-no>${esc(trText("Cancel", S.lang))}</button></div>`;
    (document.querySelector(".device") || document.body).append(w); haptic();
    requestAnimationFrame(() => w.classList.add("in"));
    const end = (v) => { w.classList.remove("in"); setTimeout(() => w.remove(), 320); done(v); };
    w.querySelector("[data-ok]").onclick = () => end(true); w.querySelector("[data-no]").onclick = () => end(false); w.querySelector(".ask-bg").onclick = () => end(false);
  });
}

// ------------------------------------------------------------------ "Saved by Ecrin"
// After a cancel: a card worth posting. Drawn on the spot in Ecrin's own type, nothing leaves the device unless you share.
// Ecrin mode is built on dark mode (white text, same contrast rules) with its own skin on top.
function applyTheme() {
  const r = document.documentElement; r.dataset.theme = S.theme === "light" ? "light" : "dark";
  if (S.theme === "ecrin") r.dataset.skin = "ecrin"; else delete r.dataset.skin;
  syncChrome();
}
function syncChrome() {
  // keep the iPhone status-bar area and browser tint in step with the theme
  const c = { light: "#f3f2ee", ecrin: "#070b1d" }[S.theme] || "#0c0d0f";
  const bb = document.getElementById("boot-bg"); if (bb) bb.textContent = `html,body{background:${c};height:100%}`;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", c));
  try { const raw = localStorage.getItem("ecrin-theme"); if (raw !== S.theme) localStorage.setItem("ecrin-theme", S.theme); } catch (_) {}
}
async function shareCard(amt) {
  try { await Promise.all(['500 46px "Unbounded"', '400 150px "Geist"', '600 50px "IBM Plex Sans"', '500 28px "IBM Plex Sans"'].map((f) => document.fonts.load(f))); } catch (_) {}
  const c = document.createElement("canvas"); c.width = 1200; c.height = 675; const x = c.getContext("2d");
  x.fillStyle = "#0c0d0f"; x.fillRect(0, 0, 1200, 675);
  let g = x.createRadialGradient(900, 330, 20, 900, 330, 520); g.addColorStop(0, "rgba(47,91,255,.42)"); g.addColorStop(.55, "rgba(47,91,255,.08)"); g.addColorStop(1, "rgba(47,91,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 1200, 675);
  const rr = (X, Y, W, H, R) => { x.beginPath(); x.moveTo(X + R, Y); x.arcTo(X + W, Y, X + W, Y + H, R); x.arcTo(X + W, Y + H, X, Y + H, R); x.arcTo(X, Y + H, X, Y, R); x.arcTo(X, Y, X + W, Y, R); x.closePath(); };
  // the lockup, as on the website
  x.strokeStyle = "#2F5BFF"; x.lineWidth = 3.4; rr(76, 70, 46, 46, 13); x.stroke();
  x.fillStyle = "#2F5BFF"; x.beginPath(); x.moveTo(99, 80); x.lineTo(108, 93); x.lineTo(99, 106); x.lineTo(90, 93); x.closePath(); x.fill();
  x.fillStyle = "#f3f3ef"; x.font = '500 40px "Unbounded", sans-serif'; x.textBaseline = "middle"; x.fillText("Ecrin", 138, 95);
  // the moment
  x.textBaseline = "alphabetic"; let fs = 132; do { x.font = `400 ${fs}px "Geist", sans-serif`; } while (x.measureText(amt).width > 700 && (fs -= 6) > 60); x.fillStyle = "#f3f3ef"; x.fillText(amt, 72, 330);
  x.font = '600 50px "IBM Plex Sans", sans-serif'; x.fillStyle = "#8ea4ff"; x.fillText("kept in my Safe.", 76, 400);
  x.font = '500 28px "IBM Plex Sans", sans-serif'; x.fillStyle = "#9a9da6"; x.fillText("A withdrawal was cancelled before it ever left.", 76, 460);
  x.font = '500 22px "IBM Plex Sans", sans-serif'; x.fillStyle = "#6f727a"; x.fillText("ecrinprotocol.app  ·  the on-chain Safe for your crypto", 76, 600);
  // the confirmation diamond
  x.save(); x.translate(960, 330); x.rotate(Math.PI / 4); x.shadowColor = "rgba(47,91,255,.8)"; x.shadowBlur = 60;
  x.fillStyle = "#2f5bff"; rr(-92, -92, 184, 184, 48); x.fill(); x.shadowBlur = 0; x.strokeStyle = "#7d97ff"; x.lineWidth = 4; rr(-112, -112, 224, 224, 58); x.stroke(); x.restore();
  x.strokeStyle = "#fff"; x.lineWidth = 16; x.lineCap = "round"; x.lineJoin = "round"; x.beginPath(); x.moveTo(918, 334); x.lineTo(948, 364); x.lineTo(1006, 302); x.stroke();
  return await new Promise((r) => c.toBlob(r, "image/png"));
}
async function offerShare(amt) {
  const blob = await shareCard(amt); if (!blob) return; const url = URL.createObjectURL(blob);
  const post = `Just stopped a withdrawal with @ecrinprotocol: ${amt} kept in my Safe.\n\nAn on-chain Safe where money waits before it leaves, and you can cancel. ecrinprotocol.app`;
  const w = document.createElement("div"); w.className = "ask-w";
  w.innerHTML = `<div class="ask-bg"></div><div class="ask share-s"><i class="sheet-h"></i><b class="ask-t">${esc(trText("Saved by Ecrin", S.lang))}</b><img class="sc-img" src="${url}" alt=""/>
    <button class="btn xl primary" data-x>${esc(trText("Share on X", S.lang))}</button><button class="btn xl" data-save>${esc(trText("Save image", S.lang))}</button><button class="btn xl ghost" data-no>${esc(trText("Not now", S.lang))}</button></div>`;
  (document.querySelector(".device") || document.body).append(w); requestAnimationFrame(() => w.classList.add("in"));
  const end = () => { w.classList.remove("in"); setTimeout(() => { w.remove(); URL.revokeObjectURL(url); }, 320); };
  w.querySelector(".ask-bg").onclick = end; w.querySelector("[data-no]").onclick = end;
  w.querySelector("[data-x]").onclick = () => { window.open(`https://x.com/intent/post?text=${encodeURIComponent(post)}`, "_blank"); end(); };
  w.querySelector("[data-save]").onclick = async () => {
    const file = new File([blob], "saved-by-ecrin.png", { type: "image/png" });
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: post }); return end(); } } catch (_) { return; }
    const a = document.createElement("a"); a.href = url; a.download = "saved-by-ecrin.png"; a.click(); toast("Image saved", "win"); setTimeout(end, 300);
  };
}

// ------------------------------------------------------------------ kept safe
// Cancelling a withdrawal: the card confirms with a drawn check, a diamond carries the money back up into the Safe
// (which answers with a pulse), and the card folds away. Everything is on transforms and opacity; skipped with Reduce
// Motion. Resolves once it's all settled, so the page refreshes only after.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function flyHome(p0, p1) {
  const mid = { x: (p0.x + p1.x) / 2 + 80, y: (p0.y + p1.y) / 2 + 10 }, N = 16;
  const pts = Array.from({ length: N + 1 }, (_, i) => { const t = i / N, u = 1 - t; return { x: u * u * p0.x + 2 * u * t * mid.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * mid.y + t * t * p1.y }; });
  const one = (delay, size, op) => { const d = document.createElement("i"); d.className = "keep-d"; document.body.append(d);
    const a = d.animate(pts.map((p, i) => { const k = i / N, sc = size * (k < .12 ? .4 + k * 5 : k > .9 ? 1 - (k - .9) * 7 : 1 + .2 * Math.sin(Math.PI * k));
      return { transform: `translate(${p.x - 8}px, ${p.y - 8}px) rotate(${45 + k * 90}deg) scale(${sc})`, opacity: k === 0 ? 0 : k === 1 ? 0 : op, offset: k }; }),
      { duration: 820, delay, easing: "cubic-bezier(.45, 0, .2, 1)", fill: "both" });
    return a.finished.catch(() => {}).then(() => d.remove()); };
  return Promise.all([one(0, 1, 1), one(60, .72, .45), one(120, .5, .22)]);
}
async function keepFx(btn) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.rot) return false;
  const card = btn.closest(".sf-alert, .sf-w, .arow") || btn.parentElement?.parentElement; if (!card) return false;
  S.holdPanel = true;
  try { return await keepRun(btn, card); } finally { S.holdPanel = false; if (S.panelDirty) { S.panelDirty = false; renderPanel(); } }
}
async function keepRun(btn, card) {
  card.classList.add("kept-card");
  card.insertAdjacentHTML("beforeend", `<div class="kept-ov">${dcheck("sm")}<b>${trText("Kept in your Safe", S.lang)}</b></div>`);
  haptic("success"); await wait(420);
  let arrive = Promise.resolve();
  const stage = document.querySelector("#panel .sf-stage"), r = card.getBoundingClientRect();
  if (stage) { const s = stage.getBoundingClientRect();
    if (s.bottom > 40 && s.top < innerHeight - 40) arrive = flyHome({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, { x: s.left + s.width / 2, y: s.top + s.height / 2 }).then(() => {
      stage.classList.remove("kept"); void stage.offsetWidth; stage.classList.add("kept"); haptic("medium");
      stage.insertAdjacentHTML("beforeend", `<i class="kept-rip"></i><i class="kept-rip r2"></i>`); }); }
  await wait(300);
  const cs = getComputedStyle(card); card.style.overflow = "hidden";
  const fold = card.animate([{ height: `${card.offsetHeight}px`, opacity: 1, marginTop: cs.marginTop, marginBottom: cs.marginBottom, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom },
    { height: "0px", opacity: 0, marginTop: "0px", marginBottom: "0px", paddingTop: "0px", paddingBottom: "0px" }], { duration: 560, easing: "cubic-bezier(.65, 0, .35, 1)", fill: "forwards" });
  await Promise.all([fold.finished.catch(() => {}), arrive]); await wait(1050);
  return true;
}

// ------------------------------------------------------------------ rolling digits
// When a balance changes, only the digits that changed roll into place, right to left. Plain text, no clipping tricks.
function rollDigits(el, prev) {
  const now = el.textContent; if (!prev || prev === now) return;
  const pad = Math.max(prev.length, now.length), P = prev.padStart(pad), N = now.padStart(pad);
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let n; while ((n = walk.nextNode())) nodes.push(n);
  let i = pad - now.length;
  for (const t of nodes) {
    const frag = document.createDocumentFragment();
    for (const ch of t.textContent) {
      if (/\d/.test(ch) && P[i] !== N[i]) { const sp = document.createElement("span"); sp.className = "dg"; sp.style.setProperty("--d", `${(pad - i) * 28}ms`); sp.textContent = ch; frag.append(sp); }
      else frag.append(ch);
      i++;
    }
    t.replaceWith(frag);
  }
}

/** A small physical tap: "light" for keys, "medium" for confirms, "success" / "warning" for outcomes. */
function haptic(kind = "light") {
  if (kind === "success" || kind === "warning") chime(kind);
  try {
    const H = globalThis.Capacitor?.Plugins?.Haptics;
    if (H) return kind === "success" || kind === "warning" ? H.notification({ type: kind.toUpperCase() }) : H.impact({ style: kind === "medium" ? "MEDIUM" : "LIGHT" });
    navigator.vibrate?.({ light: 6, medium: 12, success: [10, 40, 14], warning: [20, 60, 20] }[kind] || 6);
  } catch (_) {}
}
/** Optional sound (Settings → Sounds, off by default): two soft sine notes, quiet, no samples to load. */
let AC = null;
function chime(kind) {
  if (!S.sounds) return;
  try {
    AC ||= new (window.AudioContext || window.webkitAudioContext)(); const t = AC.currentTime;
    const notes = kind === "warning" ? [[523.25, 0], [392, 0.11]] : [[659.25, 0], [987.77, 0.09]];
    for (const [f, d] of notes) { const o = AC.createOscillator(), g = AC.createGain(); o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(0.06, t + d + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.45); o.connect(g).connect(AC.destination); o.start(t + d); o.stop(t + d + 0.5); }
  } catch (_) {}
}
const AURA_T0 = performance.now();
const auraT = () => `--at:${-Math.round(performance.now() - AURA_T0)}ms`;
const TABBAR = `<nav id="tabbar" class="tabbar" aria-label="Main">
      <button class="on" data-tab="home" data-act="tb-home" aria-label="Wallet"><span class="tb-logo">${LOGO}</span><b>Wallet</b></button>
      <button data-tab="swap" data-act="tb-go" data-p="swap" aria-label="Swap"><span>${I.swap}</span><b>Swap</b></button>
      <button data-tab="vault" data-act="tb-go" data-p="vault" aria-label="Safe"><span>${I.lock}</span><b>Safe</b></button>
    </nav>`;
function render() {
  const root = $("#root");
  root.dataset.screen = S.screen;
  if (S.screen === "home" && S.lastScreen !== "home") { S.homeT0 = performance.now(); S.homeSynced = false; } // arriving on home: the entrance plays once
  S.lastScreen = S.screen;
  if (FULL) document.documentElement.dataset.fpDash = S.screen === "home" && innerWidth >= 1100 ? "1" : "";
  if (FULL) document.documentElement.dataset.fpSetup = ["welcome", "createPw", "createPhrase", "createVerify", "importPhrase", "ready"].includes(S.screen) ? "1" : "";
  const html = ({ ready: readyView, loading: () => `<div class="splash boot"><div class="boot-mark">${WORDMARK("lg")}</div><div class="aura" aria-hidden="true" style="${auraT()}"><i class="a1"></i><i class="a2"></i><i class="a3"></i></div></div>`, welcome, createPw, createPhrase, createVerify, importPhrase, unlock, home: homeView, approve: approveView })[S.screen]();
  S.homeSig = S.screen === "home" ? viewSig(html) : null;
  root.innerHTML = html;
  translate(root, S.lang);
  if (FULL) for (const el of document.querySelectorAll(".fp-side, .fp-h")) if (el.dataset.lang !== S.lang) { translate(el, S.lang); el.dataset.lang = S.lang; }
  stageHome(root); maybeNews(); tourLive(root); const tr = root.querySelector(".tour2"); if (tr && S.tourDir) { tr.dataset.dir = S.tourDir; S.tourDir = null; }
  // The three floating buttons live outside #root, made once, so re-renders and panels never make them blink.
  let tb = document.getElementById("tabbar");
  if (S.screen === "home" && !tb) { (document.querySelector(".device") || document.body).insertAdjacentHTML("beforeend", TABBAR); tb = document.getElementById("tabbar"); tb.classList.add("enter"); setTimeout(() => tb.classList.remove("enter"), 1400); }
  syncTabbar();
  const f = root.querySelector("[autofocus]"); if (f) f.focus();
  bindHolds(root);
  depth(root);
  bindChart(root);
  if (S.screen === "welcome") mountVault3d(root);
  if (S.screen === "home") { scrollWatch(); S.prevPx = Object.fromEntries(Object.entries(S.prices).map(([k, v]) => [k, v?.usd])); }
  // The home arrives in a cascade once per unlock.
  if (S.screen === "home" && !S.entered && S.bal) { S.entered = true; root.querySelector(".home")?.classList.add("enter"); }
  if (S.screen === "home" && S.recvQ) setTimeout(playRecv, 600);
  if (S.screen === "home" && !S.wcTried) { S.wcTried = true; wcResume(); }
  if (S.screen === "home" && S.fly) { const k = S.fly; S.fly = null; setTimeout(() => flyFx(k), 320); }
  // Prices and row values: changed digits roll, and the figure warms briefly toward green or red, then settles.
  if (S.screen === "home" && !S.hide && !S.scrubbing) {
    S.pxTxt ||= {}; const num = (t) => Number(String(t).replace(/\D/g, ""));
    root.querySelectorAll("[data-pk]").forEach((el) => {
      const k = el.dataset.pk + curCode(), t = el.textContent, was = S.pxTxt[k]; S.pxTxt[k] = t;
      if (!was || was === t || !/\d/.test(t) || num(was) === num(t)) return;
      el.classList.add(num(t) > num(was) ? "tk-up" : "tk-dn"); rollDigits(el, was);
    });
  }
  // Balances roll into place like a fine mechanical counter: only the digits that changed move.
  if (!S.hide && !S.scrubbing) {
    S.rollPrev ||= {};
    for (const [key, sel] of Object.entries(ROLL_SEL)) {
      const el = root.querySelector(sel); if (!el) continue;
      const txt = el.textContent;
      if (S.rollPrev[key] && S.rollPrev[key] !== txt && /\d/.test(txt) && !el.classList.contains("sk")) rollDigits(el, S.rollPrev[key]);
      S.rollPrev[key] = txt;
    }
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
// Balances stay fresh while the wallet is open, so money arriving shows (and animates) within seconds:
// this network every 15 s, every network every minute, and straight away when you come back to the app.
let polls = 0;
setInterval(() => { if (S.screen !== "home" || document.hidden || !ACCT || S.panel?.step === "sending") return; polls++; refresh(); if (polls % 4 === 0) loadAll(); }, 15_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.screen === "home" && ACCT) { refresh(); loadAll(); } });
// Web app: a phone keeps a home-screen app's page alive for days, so it can run an old version long after a new one is
// live. Coming back to the app, it checks the build it's running against the server's and reloads when there's a new
// one (never in the middle of a transaction).
if (globalThis.ECRIN_WEB) {
  const src = [...document.scripts].map((x) => x.src).find((u) => /\/(wallet|demo)\.js(\?|$)/.test(u));
  const tag = () => (src ? fetch(src, { method: "HEAD", cache: "no-store" }).then((r) => (r.ok ? (r.headers.get("etag") || r.headers.get("last-modified") || "").replace(/^W\//, "") || null : null)).catch(() => null) : Promise.resolve(null));
  let built = null; tag().then((t) => (built = t));
  const check = async () => {
    if (document.hidden || !built) return;
    const now = await tag(); if (!now || now === built) return;
    if (S.panel?.step === "sending" || Date.now() - (S.lastTx || 0) < 60_000) return;
    // Never a reload loop: at most one every 5 minutes.
    try { const last = Number(sessionStorage.getItem("ecrinReloadAt") || 0); if (Date.now() - last < 5 * 60_000) return; sessionStorage.setItem("ecrinReloadAt", String(Date.now())); } catch (_) { return; }
    location.reload();
  };
  document.addEventListener("visibilitychange", check); setInterval(check, 10 * 60_000);
}

// Rolling digits, driven by time rather than CSS transitions, so a redraw in the middle doesn't restart or cut them.
const ROLL_MS = 1100, ease = (k) => 1 - Math.pow(1 - k, 4);
function roll(key, el, prevTxt) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  S.rolls ||= {}; S.rolls[key] = { prev: prevTxt.replace(/[^\d]/g, ""), len: prevTxt.length, at: performance.now() };
  dressRoll(key, el); rollTick();
}
function dressRoll(key, el) {
  const R = S.rolls?.[key]; if (!R || el.dataset.rolled) return; el.dataset.rolled = "1";
  const digits = el.textContent.replace(/[^\d]/g, ""), off = R.prev.length - digits.length; let n = 0;
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; while (walk.nextNode()) nodes.push(walk.currentNode);
  for (const t of nodes) {
    if (!/\d/.test(t.nodeValue)) continue;
    const frag = document.createDocumentFragment();
    for (const ch of t.nodeValue) {
      if (!/\d/.test(ch)) { frag.append(ch); continue; }
      const i = n++, from = Number(R.prev[i + off] ?? 0), to = Number(ch);
      if (from === to && R.len === el.textContent.length) { frag.append(ch); continue; }
      const r = document.createElement("span"); r.className = "rd"; r.dataset.f = from; r.dataset.t = to; r.dataset.i = i;
      r.innerHTML = `<span class="rs">${"0123456789".split("").map((d) => `<span>${d}</span>`).join("")}</span>`; frag.append(r);
    }
    t.replaceWith(frag);
  }
}
function rollTick() {
  if (S.rollRaf) return;
  const step = () => {
    S.rollRaf = 0; let live = false;
    for (const [key, R] of Object.entries(S.rolls || {})) {
      const el = document.querySelector(ROLL_SEL[key]); if (!el) continue;
      dressRoll(key, el);
      el.querySelectorAll(".rd").forEach((r) => {
        const k = Math.max(0, Math.min(1, (performance.now() - R.at - r.dataset.i * 45) / ROLL_MS)), f = +r.dataset.f, t = +r.dataset.t;
        r.firstChild.style.transform = `translateY(${-(f + (t - f) * ease(k)) * 1.15}em)`; if (k < 1) live = true;
      });
      if (performance.now() - R.at > ROLL_MS + 600) delete S.rolls[key];
    }
    if (live) S.rollRaf = requestAnimationFrame(step);
  };
  S.rollRaf = requestAnimationFrame(step);
}
const ROLL_SEL = { total: ".home .big:not(.sk)", chq: ".home .wsplit .sp-w b", sav: ".home .wsplit .sp-s b" };
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
    if (c.__bound) return; c.__bound = true;
    c.addEventListener("pointermove", (e) => {
      const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      c.style.setProperty("--ry", ((x - 0.5) * 10).toFixed(2) + "deg"); c.style.setProperty("--rx", ((0.5 - y) * 8).toFixed(2) + "deg");
      c.style.setProperty("--mx", (x * 100).toFixed(1) + "%"); c.style.setProperty("--my", (y * 100).toFixed(1) + "%");
    });
    c.addEventListener("pointerleave", () => { ["--rx", "--ry"].forEach((v) => c.style.setProperty(v, "0deg")); });
  });
}

const TOUR = [
  { k: "01", h: "Two places for <em>your money</em>", p: "Your <b>Wallet</b> spends instantly, like any wallet. Your <b>Safe</b> keeps the rest, and nothing leaves it in a hurry.", art: "split" },
  { k: "02", h: "Every withdrawal <em>waits</em>", p: "A delay you choose, with a countdown you can stop. A thief, a scam or a 2 a.m. decision all hit the same wall: time.", art: "clock" },
  { k: "03", h: "Scams caught <em>before you sign</em>", p: "Ecrin blocks known scam sites, flags look-alikes, and shows exactly what would leave your wallet before you approve.", art: "shield" },
];
/** Each slide shows a real Ecrin moment, drawn with the wallet's own pieces, instead of an icon. */
function tourArt(k) {
  if (k === "split") return `<div class="tv tv-split">
    <div class="tv-lz"><svg viewBox="0 0 220 220" aria-hidden="true"><g transform="rotate(45 110 110)"><rect class="tl-b" x="38" y="38" width="144" height="144" rx="30"/><rect class="tl-w" x="38" y="38" width="144" height="144" rx="30" pathLength="100"/><rect class="tl-b in" x="54" y="54" width="112" height="112" rx="24"/><rect class="tl-s" x="54" y="54" width="112" height="112" rx="24" pathLength="100"/></g></svg>
      <div class="tv-lz-in"><span>Net worth</span><b><i>$</i>8,989</b></div></div>
    <div class="tv-cards"><div class="tv-card w"><span class="tv-k">${I.card}Wallet</span><b>$1,608</b><small>spend now</small></div><div class="tv-card s"><span class="tv-k">${I.lock}Safe</span><b>$7,381</b><small>72 h to leave</small></div></div></div>`;
  if (k === "clock") return `<div class="tv tv-clock"><div class="tv-wd">
    <div class="tv-wd-h"><span class="tv-dot"></span>Withdrawal requested<em>→ 9cRt…X2</em></div>
    <div class="tv-wd-amt"><b>24.00</b><span>SOL</span></div>
    <div class="tv-cd"><div><b data-tv-h>71</b><small>hours</small></div><i>:</i><div><b data-tv-m>59</b><small>min</small></div><i>:</i><div><b data-tv-s>48</b><small>sec</small></div></div>
    <div class="tv-bar"><i></i></div>
    <button class="tv-keep" tabindex="-1">${I.shield}Cancel and keep it</button>
    <div class="tv-kept">${I.check}<b>Kept in your Safe</b><small>It never left.</small></div></div></div>`;
  return `<div class="tv tv-shield"><div class="tv-ap">
    <div class="tv-site"><span class="tv-fav">!</span><span><b>claim-sol-airdrop.app</b><small>wants you to sign a transaction</small></span></div>
    <div class="tv-out"><span>Would leave your wallet</span><b>24.5 SOL · 1,250 USDC</b><small>everything you hold</small></div>
    <div class="tv-flag">${I.shield}<span><b>Known scam site</b><small>Ecrin blocked this before you could sign.</small></span></div>
    <div class="tv-ap-acts"><span class="tv-btn ghost">Reject</span><span class="tv-btn off">Approve</span></div></div></div>`;
}
function tourView() {
  const i = S.tour || 0, t = TOUR[i], last = i === TOUR.length - 1;
  return `<div class="onb tour tour2" data-tour="${i}">
    <div class="tour-bars">${TOUR.map((_, j) => `<i class="${j < i ? "done" : j === i ? "on" : ""}"><b></b></i>`).join("")}</div>
    <div class="tour-top"><span class="mv-mark">${LOGO}<b>ECRIN</b></span><button class="link" data-act="tour-skip">Skip</button></div>
    <div class="onb-art" data-i="${i}">${tourArt(t.art)}</div>
    <div class="onb-copy"><span class="tour-k">${t.k} / 03</span><h1>${t.h}</h1><p>${t.p}</p></div>
    <div class="onb-acts">${i ? `<button class="btn tour-back" data-act="tour-prev" aria-label="Back">${I.back}</button>` : ""}<button class="btn primary xl" data-act="tour-next">${last ? "Get started" : "Next"}</button></div>
  </div>`;
}
// The countdown on the second slide really counts; after a moment the button is "pressed" and the money is kept.
function tourLive(root) {
  const c = root.querySelector(".tv-clock"); if (!c || c.__on) return; c.__on = true;
  let left = 71 * 3600 + 59 * 60 + 48; const h = c.querySelector("[data-tv-h]"), m = c.querySelector("[data-tv-m]"), sec = c.querySelector("[data-tv-s]"), p = (n) => String(n).padStart(2, "0");
  const tick = setInterval(() => { if (!c.isConnected) return clearInterval(tick); left--; h.textContent = p(Math.floor(left / 3600)); m.textContent = p(Math.floor((left % 3600) / 60)); sec.textContent = p(left % 60); }, 1000);
  setTimeout(() => c.isConnected && c.classList.add("press"), 2600); setTimeout(() => c.isConnected && c.classList.add("kept"), 3000);
}
// Swipe between slides on phones.
document.addEventListener("touchstart", (e) => { const t = e.target.closest?.(".tour2"); S.tsx = t ? e.touches[0].clientX : null; }, { passive: true });
document.addEventListener("touchend", (e) => { if (S.tsx == null) return; const dx = e.changedTouches[0].clientX - S.tsx; S.tsx = null; if (Math.abs(dx) < 50) return; const b = document.querySelector(dx < 0 ? '[data-act="tour-next"]' : '[data-act="tour-prev"]'); b?.click(); }, { passive: true });
// One question after the tour: it decides which safety steps the wallet suggests first. Nothing is turned on by itself.
const GOALS = [["savings", "Protect my savings", "From scams, drainers and stolen keys.", "shield"], ["discipline", "Help me stay in control", "Limits and pauses against impulsive trading or gambling.", "clock"], ["both", "Both", "Protection from others, and from myself.", "lock"]];
function goalView() {
  return `<div class="onb tour tour2 goal">
    <div class="tour-top"><span class="mv-mark">${LOGO}<b>ECRIN</b></span><button class="link" data-act="goal" data-v="skip">Skip</button></div>
    <div class="onb-copy"><span class="tour-k">One question</span><h1>What brings you to <em>Ecrin</em>?</h1><p>We'll suggest the right protections first. You can change everything later.</p></div>
    <div class="goal-l">${GOALS.map(([k, t, d, ic]) => `<button class="goal-o" data-act="goal" data-v="${k}"><span class="goal-ic">${I[ic]}</span><span><b>${t}</b><small>${d}</small></span>${I.arrow}</button>`).join("")}</div>
  </div>`;
}
/** The first thing you see: the Ecrin lozenge with an example balance, the coin rings spinning in, the Safe ring
 *  beating, and the two halves of Ecrin explained in two pills. */
function welcomeArt() {
  const seg = (cls, len, off, u) => `<rect class="lz-seg ${cls}" x="38" y="38" width="144" height="144" rx="30" pathLength="100" style="--cc:${COIN_COL[u]};stroke-dasharray:${len} ${100 - len};stroke-dashoffset:${-off};--o:${-off}"/>`;
  return `<div class="wl">
    <div class="lz-wrap wl-lz"><svg class="lz draw" style="--lt:0ms;--at:0ms" viewBox="0 0 220 220" aria-hidden="true"><defs>${litDefs(lit())}</defs>
      <g transform="rotate(45 110 110)"><rect class="lz-base" x="38" y="38" width="144" height="144" rx="30"/>
      ${seg("r0", 51, 0, "SOL")}${seg("r1", 27, 52, "ETH")}${seg("r2", 19, 80, "USDC")}
      <rect class="lz-base in" x="51" y="51" width="118" height="118" rx="24"/>
      <rect class="lz-safe" x="51" y="51" width="118" height="118" rx="24" pathLength="100" style="stroke-dasharray:64 100"/>
      <rect class="lz-sheen" x="38" y="38" width="144" height="144" rx="30"/><rect class="lz-sheen in" x="51" y="51" width="118" height="118" rx="24"/></g></svg>
      <div class="lz-in"><span class="lbl">Net worth</span><div class="big"><span class="cur">$</span>12,480<span class="dec cents">.00</span></div></div>
    </div>
    <div class="wl-pills"><span class="wl-p">${I.card}<b>Wallet</b><small>spend now</small></span><span class="wl-p safe">${I.lock}<b>Safe</b><small>72 h to leave</small></span></div>
  </div>`;
}
function welcome() {
  if (IS_EXT && !FULL && !S.stayPopup) return `<div class="onb onb-w fp-invite"><div class="aura" aria-hidden="true" style="${auraT()}"><i class="a1"></i><i class="a2"></i><i class="a3"></i></div>
    <div class="onb-art">${welcomeArt()}</div>
    <div class="onb-copy"><h1 class="onb-wm">${WORDMARK("lg")}<span class="sr-only">Ecrin Wallet</span></h1><p>Set up takes a minute, in a full tab with room for your recovery phrase.</p></div>
    <div class="onb-acts"><button class="btn primary xl" data-act="open-full">Set up in a new tab</button><button class="link center" data-act="stay-popup">Continue here instead</button></div>
    <p class="fine">Beta · not audited · starts on test networks</p></div>`;
  if (S.tour != null && S.tour < TOUR.length) return tourView();
  if (S.tour === TOUR.length && S.askGoal) return goalView();
  return `<div class="onb onb-w"><div class="aura" aria-hidden="true" style="${auraT()}"><i class="a1"></i><i class="a2"></i><i class="a3"></i></div>
    <div class="onb-art">${welcomeArt()}</div>
    <div class="onb-copy"><h1 class="onb-wm">${WORDMARK("lg")}<span class="sr-only">Ecrin Wallet</span></h1><p>A wallet for spending.<br/>A safe nobody can rush.</p></div>
    <div class="onb-acts">
      <button class="btn primary xl" data-act="start-create">Create a new wallet</button>
      <button class="btn ghost xl" data-act="start-import">I have a recovery phrase</button>
      ${globalThis.ECRIN_DEMO ? `<button class="link center" data-act="demo-quick">Skip setup: open a demo wallet ${I.arrow}</button>` : ""}
    </div>
    <p class="fine">Beta · not audited · starts on test networks</p>
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
    ${q && !S.busy ? `<button class="btn ghost xl later-btn" data-act="verify-later">Check later</button><p class="fine center">We'll remind you tomorrow. Until you check, keep your paper close.</p>` : ""}
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
  if (S.bioBusy) {
    // Face ID: the Ecrin lozenge scans while the phone checks, then closes into a full diamond with a check.
    const ok = S.bioBusy === "ok", R = (c, x, r, k) => `<rect class="${c}" x="${x}" y="${x}" width="${220 - 2 * x}" height="${220 - 2 * x}" rx="${r}" pathLength="100"${k ? ` style="${k}"` : ""}/>`;
    document.activeElement?.blur?.(); // no keyboard behind Face ID
    const top = S.bioTop ??= Math.round(Math.max(screen.height, innerHeight) * 0.3); // fixed spot, measured once: never moves with the keyboard or system sheets
    return `<div class="bio-scr${ok ? " ok" : ""}" style="--bt:${top}px"><div class="aura" aria-hidden="true" style="${auraT()}"><i class="a1"></i><i class="a2"></i><i class="a3"></i></div>
      <div class="bs-stage"><svg class="bs-lz" viewBox="0 0 220 220" aria-hidden="true"><defs><linearGradient id="bsg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b6c4ff"/><stop offset=".5" stop-color="#4b74ff"/><stop offset="1" stop-color="#00c8ff"/></linearGradient></defs>
        <g transform="rotate(45 110 110)">${R("bs-base", 38, 30)}${R("bs-a", 38, 30)}${R("bs-b", 51, 24)}${R("bs-full", 38, 30)}</g></svg>
        <span class="bs-scan"></span>
        <span class="bs-ic">${ok ? `<svg class="bio-ok" viewBox="0 0 24 24"><path d="M6 12.5l4 4L18 8"/></svg>` : I.face}</span></div>
      <p class="bs-t">${ok ? "Unlocked" : `Unlocking with ${bioName()}`}</p></div>`;
  }
  const las = S.lockInfo?.accts?.length ? S.lockInfo.accts : S.lockInfo ? DEF_ACCTS : [], la = las.find((x) => x.id === S.lockInfo?.acctSel) || las[0];
  const addr = la && S.lockInfo?.addrCache?.[la.id], tries = S.pwTries || 0;
  // The Safe's diamond: a point of light circles it while locked, speeds up while the password is checked, and the
  // diamond closes into a full outline with a check when it opens (the same motion as Face ID).
  const R = (c, x, r) => `<rect class="${c}" x="${x}" y="${x}" width="${220 - 2 * x}" height="${220 - 2 * x}" rx="${r}" pathLength="100"/>`;
  return `<div class="lock lk2">
    <div class="aura" aria-hidden="true" style="${auraT()}"><i class="a1"></i><i class="a2"></i><i class="a3"></i></div>
    <div class="lk-top">
      <div class="lk-hero" aria-hidden="true"><svg class="lk-lz" viewBox="0 0 220 220"><defs><linearGradient id="lkg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b6c4ff"/><stop offset=".5" stop-color="#4b74ff"/><stop offset="1" stop-color="#00c8ff"/></linearGradient></defs>
        <g transform="rotate(45 110 110)">${R("lk-base", 38, 30)}${R("lk-in", 51, 24)}${R("lk-run", 38, 30)}${R("lk-run2", 51, 24)}${R("lk-full", 38, 30)}</g></svg>
        <span class="lk-ic"><span class="lk-l">${I.lock}</span><svg class="lk-ok" viewBox="0 0 24 24"><path d="M6 12.5l4 4L18 8"/></svg></span></div>
      <h1>Welcome back</h1>
      ${la ? `<div class="lk-acct">${acctIc(la)}<span><b>${esc(la.name)}</b>${addr ? `<small class="mono">${esc(short(addr))}</small>` : ""}</span></div>` : `<p class="sub">Unlock Ecrin Wallet</p>`}
    </div>
    <div class="lk-form">
      ${S.bio ? `<button class="btn primary xl bio-btn" data-act="bio-unlock">${I.face}Unlock with ${bioName()}</button><p class="or">or use your password</p>` : ""}
      <form class="stack" data-form="unlock" novalidate>
        <label class="lk-fld"><span class="lk-fi">${I.key}</span><input name="pw" type="password" placeholder="Password" aria-label="Password" autocomplete="current-password" ${S.bio && globalThis.ECRIN_WEB ? "" : "autofocus"} required/>
          <button type="button" class="lk-eye" data-act="pw-eye" aria-label="Show password">${I.eye}</button></label>
        <p class="lk-caps" data-caps hidden>${I.warn}Caps Lock is on</p>
        <p class="err" data-err></p>
        <button class="btn ${S.bio ? "" : "primary"} xl lk-go" data-unlock>Unlock</button>
      </form>
      ${tries >= 3 ? `<div class="lk-help">${I.shield}<span>Can't remember it? Your recovery phrase brings your wallet back with a new password.</span></div>` : ""}
    </div>
    <div class="lk-foot">
      <button class="link" data-act="forgot">Forgot your password?</button>
      <p class="lk-safe">${I.lock}Your keys never leave this device</p>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ home

function totals() {
  const b = S.bal || { native: 0, usdc: 0 }, v = S.vault;
  const vn = v?.main?.balance || 0, vu = v?.usdc?.balance || 0;
  const usd = (n, a) => usdOf(n, a) ?? 0;
  return { chq: usd(b.native, "native") + usd(b.usdc, "usdc"), sav: usd(vn, "native") + usd(vu, "usdc"), b, vn, vu };
}

/** Home: whenever money is leaving a Safe, the next withdrawal with its countdown and a Cancel button right there
 *  (no need to open the Safe first: if it wasn't you, every second counts). */
function leaveBanner() {
  // The network you're on has the freshest copy in S.vault; the others come from the last scan.
  const pend = openRows().flatMap((r) => { const v = r.k === S.net && S.vault ? S.vault : r.v; if (!v?.main) return [];
    return [...v.main.withdrawals.map((x) => ({ ...x, a: "native", r })), ...(v.usdc?.withdrawals || []).map((x) => ({ ...x, a: "usdc", r }))]; }).sort((x, y) => x.readyAt - y.readyAt);
  const x = pend[0]; if (!x) return "";
  const left = x.readyAt - (now() + (S.clockOff || 0)), unit = x.a === "usdc" ? "USDC" : NETS[x.r.k].unit;
  const hms = clockTxt;
  return `<section class="lv-ban" role="alert">
    <span class="lv-ic">${I.clock}</span>
    <span class="lv-t"><b>${amt(x.amount, x.a)} ${unit} leaving</b><small>→ ${esc(short(String(x.dest)))} · ${left > 0 ? `<b class="cd" data-until="${x.readyAt}">${hms(left)}</b>` : "ready to leave"}${pend.length > 1 ? ` · +${pend.length - 1} more` : ""}</small></span>
    <button class="lv-x" data-act="cancel-w" data-n="${x.r.k}" data-id="${x.id}" data-a="${x.a}">${I.shield}Cancel</button>
  </section>`;
}

/** The extension's full tab on a wide screen: a second column with the Safe at a glance and recent activity. */
function dashSide(w, loading) {
  const rows = openRows(), t = now() + (S.clockOff || 0);
  const pend = rows.flatMap((r) => { const v = r.k === S.net && S.vault ? S.vault : r.v; if (!v?.main) return [];
    return [...v.main.withdrawals.map((x) => ({ ...x, a: "native", r })), ...(v.usdc?.withdrawals || []).map((x) => ({ ...x, a: "usdc", r }))]; }).sort((x, y) => x.readyAt - y.readyAt);
  const next = pend[0], share = w.total ? Math.round((w.sav / w.total) * 100) : 0, safeHere = netKeys().some(canSafe);
  const hms = clockTxt;
  const acts = (S.activity || []).slice(0, 6);
  return `<aside class="dk-side">
    <section class="dk-card dk-safe">
      <div class="dk-h"><span class="dk-ic">${I.lock}</span><b>Safe</b><button class="see-all" data-act="panel" data-p="vault">Open ${I.arrow}</button></div>
      ${!safeHere ? `<p class="dk-sub">The Safe comes to mainnet after its audit. Try it on Testnet.</p>`
        : `<div class="dk-big">${loading ? `<b class="sk">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</b>` : mask(fig(money(w.sav)))}</div>
      <div class="dk-bar"><i style="width:${share}%"></i></div><p class="dk-sub">${share}% of everything you own is protected${rows.length ? "" : " · no Safe open yet"}</p>
      ${next ? `<button class="dk-next" data-act="panel" data-p="vault"><span class="dk-ic">${I.clock}</span><span><b>${amt(next.amount, next.a)} ${next.a === "usdc" ? "USDC" : NETS[next.r.k].unit} leaving</b><small>${pend.length > 1 ? `+${pend.length - 1} more · ` : ""}tap to cancel</small></span><b class="cd" data-until="${next.readyAt}">${hms(next.readyAt - t)}</b></button>` : `<p class="dk-quiet">${I.shield}Nothing is leaving. All quiet.</p>`}
      <button class="btn primary dk-go" data-act="panel" data-p="protect">${I.protect}${rows.length ? "Protect more" : "Open my Safe"}</button>`}
    </section>
    <section class="dk-card">
      <div class="dk-h"><span class="dk-ic">${I.clock}</span><b>Recent activity</b><button class="see-all" data-act="tab" data-t="activity">See all ${I.arrow}</button></div>
      ${acts.length ? `<div class="dk-acts">${actRows(acts)}</div>` : `<p class="dk-sub">Nothing yet. What you send, receive and protect shows here.</p>`}
    </section>
  </aside>`;
}
function homeView() {
  const N = NETS[S.net], e = ENG, w = worth(), loading = !w.ready;
  const pct = w.total ? Math.round((w.sav / w.total) * 100) : 0;
  const addr = e?.address || "";
  return `<div class="home${introCls()}"${introVar()}><div class="aura" aria-hidden="true" style="${auraT()}"><i class="a1"></i><i class="a2"></i><i class="a3"></i><i class="a4"></i></div>
    <header class="top">
      <button class="acct" data-act="panel" data-p="accts" title="Your accounts">${acctIc(curAcct())}<span class="acct-n">${esc(curAcct().name)}</span><span class="top-total">${loading ? "" : mask(money(w.total))}</span>${I.chev}</button>
      <div class="top-r">
        <button class="ib" data-act="panel" data-p="nets" aria-label="Networks" title="Networks">${I.globe}</button>
        <button class="ib" data-act="settings" aria-label="Settings">${I.gear}</button>
      </div>
    </header>
    ${S.err ? `<div class="banner">${esc(S.err)}</div>` : ""}
    ${loading ? "" : leaveBanner()}
    ${S.offline ? `<div class="offline"><i></i>You're offline · showing your last balances</div>` : ""}${updateBanner()}${backupCard()}
    ${isMain() ? `<div class="brand-sig">${WORDMARK()}</div>` : `<div class="brand-sig" title="Test networks: these coins have no value">${WORDMARK()}<i>Testnet</i></div>`}
    <section class="hero"><svg class="hero-g" viewBox="0 0 360 230" preserveAspectRatio="xMidYMin slice" aria-hidden="true">${Array.from({ length: 30 }, (_, i) => `<ellipse cx="${180 + Math.sin(i / 2.6) * 6}" cy="${-10 + Math.cos(i / 2.6) * 4}" rx="${40 + i * 9}" ry="${22 + i * 6.2}"/>`).join("")}</svg>
      <div class="lz-wrap">${lozenge(w, loading)}
        <div class="lz-in">
          <div class="hero-l"><span class="lbl">Net worth</span><button class="eye" data-act="hide" aria-label="${S.hide ? "Show" : "Hide"} balances">${S.hide ? I.eyeOff : I.eye}</button></div>
          <div class="big ${loading ? "sk" : ""}${(() => { const n = String(money(w.total ?? 0)).length; return n > 13 ? " xs" : n > 10 ? " sm" : ""; })()}">${loading ? "&nbsp;" : mask(fig(money(w.total)))}</div>
        </div>
      </div>
      <button class="lz-chg plain" data-act="range-next" aria-label="Change period">${chip()}</button>
    </section>
    <section class="wsplit" style="--s:${pct}%">
      <button class="sp-w" data-act="panel" data-p="assets"><span>Wallet</span><b class="${loading ? "sk" : ""}">${loading ? "&nbsp;" : mask(fig(money(w.chq)))}</b></button>
      <button class="sp-s" data-act="panel" data-p="vault"><span>${I.lock}Safe${w.leaving ? ` <em>· ${w.leaving} leaving</em>` : ""}</span><b class="${loading ? "sk" : ""}">${loading ? "&nbsp;" : mask(fig(money(w.sav)))}</b></button>
      <i class="sp-bar"><i></i></i>
    </section>
    ${stakedCard()}
    ${startCard(w)}
    <nav class="acts">
      ${[["send", "Send", I.send], ["receive", "Receive", I.recv], ["swap", "Swap", I.swap], ["protect", "Protect", I.protect]].map(([p, l, ic]) => `<button data-act="panel" data-p="${p}"><span>${ic}</span>${l}</button>`).join("")}
    </nav>
    <div class="tabs ${S.showNfts ? "t3" : ""}" role="tablist">${[["tokens", "Tokens"], ...(S.showNfts ? [["nfts", "Collectibles"]] : []), ["activity", "Activity"]].map(([t, l]) => `<button role="tab" data-act="tab" data-t="${t}" aria-selected="${S.tab === t}">${l}</button>`).join("")}<i class="tab-ind" style="--i:${{ tokens: 0, nfts: 1, activity: S.showNfts ? 2 : 1 }[S.tab] || 0}"></i></div>
    <div class="tab-body">${S.tab === "activity" ? activityList() : S.tab === "nfts" && S.showNfts ? nftGrid() : tokenList(w)}</div>
    ${S.tab === "tokens" && !loading ? homeMore() : ""}
    <footer class="home-end"><span>${LOGO}</span>Ecrin Wallet · ${isMain() ? "beta" : "testnet beta"}</footer>
    ${FULL ? dashSide(w, loading) : ""}
  </div>`;
}

// ------------------------------------------------------------------ the Ecrin lozenge
// Your money as the Ecrin diamond: the outer edge is split by coin (each coin's share, in its colour); the inner edge
// fills with Ecrin blue as more of it sits in your Safe. Thin lines, drawn once when you open the wallet.
// One colour per coin, whatever network it sits on (USDC on Solana and on Base is one USDC). Picked from each coin's
// own brand and kept apart from each other on the dark background.
// Ecrin's own palette: every coin a shade of blue or grey, far enough apart to tell on the diamond, readable on dark and
// light. Tron keeps its red. The diamond, the bubble by each name and the Activity rows all use these.
const COIN_COL = { SOL: "#5b7cff", ETH: "#9badff", USDC: "#3d9bff", POL: "#4352c4", USDT: "#5f7a92", BNB: "#a4abba", AVAX: "#767c88", TRX: "#ff3b5c", HYPE: "#50d2c1", SUI: "#7fb8ff" };
const cdot = (u) => `<i class="cdot" style="--cc:${COIN_COL[u] || "#9aa0b4"}"></i>`;
function lozShares(w) {
  const by = {}; for (const i of w.items) if (i.usd) by[i.unit] = (by[i.unit] || 0) + i.usd;
  const tot = Object.values(by).reduce((a, b) => a + b, 0);
  return tot ? Object.entries(by).sort((a, b) => b[1] - a[1]).map(([u, v]) => ({ u, f: v / tot })) : [];
}
function lozenge(w, loading) {
  const sh = loading ? [] : lozShares(w), safe = !loading && w.total ? w.sav / w.total : 0, G = sh.length > 1 ? 0.9 : 0;
  let at = 0;
  const segs = sh.map(({ u, f }, i) => { const len = Math.max(0.6, f * 100 - G); const d = `<rect class="lz-seg r${Math.min(i, 3)}" x="38" y="38" width="144" height="144" rx="30" pathLength="100" style="--cc:${COIN_COL[u] || "#9aa0b4"};stroke-dasharray:${len.toFixed(2)} ${(100 - len).toFixed(2)};stroke-dashoffset:${(-at).toFixed(2)};--o:${(-at).toFixed(2)}"/>`; at += f * 100; return d; }).join("");
  // The opening spin lasts 2.2s; a re-render in that time picks the animation up where it was, so it never restarts or cuts.
  if (!loading && !S.lzT0) S.lzT0 = performance.now();
  const el = S.lzT0 ? performance.now() - S.lzT0 : 1e9, draw = el < 2300;
  const L = lit(), hot = !loading && w.leaving ? " hot" : "", wait = loading ? `<rect class="lz-wait" x="38" y="38" width="144" height="144" rx="30" pathLength="100"/><rect class="lz-wait in" x="51" y="51" width="118" height="118" rx="24" pathLength="100"/>` : "";
  return `<svg class="lz${draw ? " draw" : ""}${hot}" style="--lt:${-Math.round(el)}ms;--at:${-Math.round(performance.now() - AURA_T0)}ms" viewBox="0 0 220 220" aria-hidden="true">
    <defs>${litDefs(L)}</defs>
    <g transform="rotate(45 110 110)">
    <rect class="lz-base" x="38" y="38" width="144" height="144" rx="30"/>${segs}${wait}
    <rect class="lz-base in" x="51" y="51" width="118" height="118" rx="24"/>
    <rect class="lz-safe" x="51" y="51" width="118" height="118" rx="24" pathLength="100" style="stroke-dasharray:${(safe * 100).toFixed(2)} 100"/>
    <rect class="lz-sheen" x="38" y="38" width="144" height="144" rx="30"/><rect class="lz-sheen in" x="51" y="51" width="118" height="118" rx="24"/></g></svg>`;
}
function lozLegend(w, loading) {
  if (loading || !w.total) return "";
  const sh = lozShares(w).slice(0, 4), safe = Math.round((w.sav / w.total) * 100);
  const LK = { SOL: "sol", ETH: "eth", USDC: "usdc", USDT: "usdt", BNB: "bnb", AVAX: "avax", TRX: "tron", POL: "pol", HYPE: "hype", SUI: "sui" };
  const grow = S.lzT0 && performance.now() - S.lzT0 < 2300 ? " grow" : "", pill = (cls, col, ic, name, pct) => `<span class="lp ${cls}${grow}" style="--pc:${col};--pf:${pct}%">${ic}<b>${name}</b><em>${pct}%</em><i class="lp-bar"></i></span>`;
  return `<div class="lz-leg">${sh.map(({ u, f }) => pill("", COIN_COL[u] || "#9aa0b4", LK[u] ? coin(LK[u], "lp-c") : `<i class="lp-d"></i>`, u, Math.round(f * 100))).join("")}${pill("lz-s", "#5b7cff", `<span class="lp-lock">${I.lock}</span>`, "Safe", safe)}</div>`;
}

/** Every coin you hold on every network, biggest first. Tapping one opens Send on its network. */
function tokenList(w) {
  if (!w.ready) return `<section class="list">${[1, 2, 3].map(() => `<div class="arow"><span class="coin sk"></span><span class="ar-t"><b class="sk">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</b><small class="sk">&nbsp;&nbsp;&nbsp;&nbsp;</small></span></div>`).join("")}</section>`;
  if (!w.items.length && !(S.extra || []).length) return `<section class="list"><div class="empty art">${emptyArt("coins")}<b>Your wallet is empty</b><span>${isMain() ? "Receive coins from an exchange or another wallet to get started." : "Get free test coins to try Ecrin. They're not worth anything."}</span><button class="btn sm primary" data-act="panel" data-p="receive">${isMain() ? "Receive" : "Get test coins"}</button></div></section>`;
  const n = (v, d) => v.toLocaleString("en-US", { maximumFractionDigits: d });
  let items = S.hideSmall ? w.items.filter((i) => !(i.usd != null && i.usd < 1)) : w.items;
  if (S.order === "name") items = [...items].sort((x, y) => x.name.localeCompare(y.name));
  const hidden = w.items.length - items.length;
  // Real money never merges with test coins of the same name: it gets its own row.
  const groups = {}; for (const i of items) (groups[i.unit + (i.real ? ":real" : "")] ||= []).push(i);
  const row = (i, sub) => {
    const p = i.a === "usdc" ? { usd: 1 } : S.prices[i.cg], ch = i.a === "usdc" ? null : p?.usd_24h_change;
    return `<button class="arow" data-act="tok" data-u="${i.unit}" data-n="${i.k}"><span class="cstack">${coin(i.coin)}${i.coin !== i.k ? `<span class="cmini">${coin(i.k)}</span>` : ""}</span>
      <span class="ar-t"><b>${i.name}</b><small>${i.a === "usdc" ? i.net : p?.usd != null ? `<span data-pk="p:${i.cg}" class="px${S.prevPx?.[i.cg] != null && S.prevPx[i.cg] !== p.usd ? (p.usd > S.prevPx[i.cg] ? " flash-up" : " flash-dn") : ""}">${money(p.usd)}</span>` : i.net}${ch != null ? ` <span class="${ch >= 0 ? "up" : "dn"}">${ch >= 0 ? "+" : "−"}${Math.abs(ch).toFixed(2)}%</span>` : ""}</small></span>
      ${spark(i.cg)}<span class="ar-r"><b data-pk="v:${i.unit}:${i.k}">${i.usd != null ? mask(money(i.usd)) : "—"}</b><small>${mask(n(i.chq + i.sav, i.dec))} ${i.unit}${i.sav ? ` <span class="sv">${I.lock}${mask(n(i.sav, i.dec))}</span>` : ""}</small></span></button>`.replace('class="arow"', `class="arow${sub ? " sub" : ""}"`);
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
`;
}

// Live prices for every coin Ecrin supports, held or not: something is always moving on the home screen.
const MARKET = [["solana", "SOL", "sol", "Solana"], ["ethereum", "ETH", "eth", "Ethereum"], ["hyperliquid", "HYPE", "hype", "Hyperliquid"], ["binancecoin", "BNB", "bnb", "BNB"], ["tron", "TRX", "tron", "TRON"], ["sui", "SUI", "sui", "Sui"], ["avalanche-2", "AVAX", "avax", "Avalanche"], ["polygon-ecosystem-token", "POL", "pol", "Polygon"]];
/** Below your coins, like any good wallet: recent activity, shortcuts and the market. */
function homeMore() {
  const all = S.activity || [];
  const recent = ""; void all; // the Activity tab right above already lists everything
  const sc = [...(stakeNets().length ? [["earn", "Earn", I.spark, 'data-act="panel" data-p="earn"']] : []), ["swap", "Swap", I.swap, 'data-act="panel" data-p="swap"'], ...(isMain() ? [["bridge", "Bridge", '<svg viewBox="0 0 24 24"><path d="M3 16c3-6 15-6 18 0"/><path d="M6 12.6V18M12 11v7M18 12.6V18"/></svg>', 'data-act="panel" data-p="bridge"']] : []), ["buy", "Buy", I.card, 'data-act="panel" data-p="buy"'], ["req", "Request", I.recv, 'data-act="home-req"'],
    ["ct", "Contacts", '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1.2-3.2 3.9-5 7-5s5.8 1.8 7 5"/></svg>', 'data-act="panel" data-p="contacts"'], ...(globalThis.ECRIN_WEB ? [["wc", "Apps", I.link, 'data-act="panel" data-p="wc"']] : globalThis.ECRIN_DEMO ? [] : [["sites", "Sites", I.link, 'data-act="panel" data-p="sites"']]), ["al", "Alerts", I.bell, 'data-act="panel" data-p="alerts"']];
  return `${recent ? `<div class="list-h"><b>Recent activity</b><button class="see-all" data-act="tab" data-t="activity">See all</button></div><div class="tab-body"><section class="list recent">${recent}</section></div>` : ""}
    <div class="list-h"><b>Shortcuts</b></div>
    <div class="shortcuts">${sc.map(([k, l, ic, a]) => `<button class="sc sc-${k}" ${a}><span>${ic}</span>${l}</button>`).join("")}</div>
    ${marketList()}`;
}
function marketList() {
  const live = MARKET.filter(([cg]) => S.prices[cg]?.usd != null), rows = S.mktAll ? live : live.slice(0, 3), more = live.length - rows.length;
  if (!rows.length) return "";
  return `<div class="list-h mkt-h"><b>Market</b><span><i class="live-dot"></i>Live</span></div>
    <section class="list mkt">${rows.map(([cg, unit, logo, name]) => { const p = S.prices[cg], ch = p.usd_24h_change, was = S.prevPx?.[cg], fl = was != null && was !== p.usd ? (p.usd > was ? " flash-up" : " flash-dn") : "";
      return `<button class="arow" data-act="tok" data-u="${unit}">${coin(logo)}<span class="ar-t"><b>${name}</b><small>${unit}</small></span>${spark(cg)}
        <span class="ar-r"><b data-pk="m:${cg}" class="px${fl}">${money(p.usd)}</b>${ch == null ? `<small class="na">—</small>` : `<small class="${ch >= 0 ? "up" : "dn"}">${ch >= 0 ? "+" : "−"}${Math.abs(ch).toFixed(2)}%</small>`}</span></button>`; }).join("")}</section>${more > 0 || S.mktAll ? `<button class="mkt-more" data-act="mkt-all">${S.mktAll ? "Show less" : `Show all ${live.length}`}</button>` : ""}`;
}

/** The change over the chart's range, as plain text: "+$122.17 (4.48%) · 1W". */
function chip() {
  const c = chartData(); if (!c || !worth().total) return `<span class="delta" data-chg></span>`; // nothing held: no gain or loss to show
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

const COIN_NAME = { SOL: "Solana", ETH: "Ethereum", POL: "Polygon", BNB: "BNB", AVAX: "Avalanche", TRX: "TRON", HYPE: "Hyperliquid", SUI: "Sui", USDC: "USD Coin" };
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
  const { dev } = await local.get("dev"), acct = ACCT, mode = S.mode;
  const rows = await Promise.all(netKeys().map(async (k) => {
    try {
      const e = k === S.net && ENG ? ENG : engine({ web3, ethers, acct: ACCT, net: k, dev: dev || {} });
      const [b, v, st] = await Promise.all([e.balances(), e.vault().catch(() => null), e.staking && stakeable(k) ? e.staking.fetch().catch(() => null) : null]);
      if (st) (S.stakes ||= {})[k] = st;
      return { k, b, v, st, ok: true };
    } catch (_) { return { k, ok: false }; }
  }));
  if (ACCT !== acct || S.mode !== mode) return; // switched account or networks while this was loading
  S.all = rows; queueMicrotask(checkIncoming);
  loadExtras(dev);
  if (S.panel?.p === "all") { S.panel.rows = rows; renderPanel(); }
  if (S.panel?.p === "vault" || S.panel?.p === "rules" || S.panel?.p === "nets") renderPanel();
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
  const mode = S.mode, pr = await local.get(["tokPref", "tokList", "nftMeta"]); S.tokPref = pr.tokPref || {}; S.tokList = pr.tokList || {};
  const meta = pr.nftMeta || {};
  const lists = await Promise.all(netKeys().map(async (k) => {
    try {
      const e = k === S.net && ENG ? ENG : engine({ web3, ethers, acct: ACCT, net: k, dev: dev || {} });
      if (!e.listTokens) return [];
      return (await e.listTokens(NETS[k].fam === "evm" ? S.tokList[k] || [] : undefined)).map((t) => ({ ...t, k }));
    } catch (_) { return []; }
  }));
  if (S.mode !== mode) return;
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
  const ic = { coins: I.card, act: I.clock, nft: I.img, safe: I.shield, contacts: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1.2-3.2 3.9-5 7-5s5.8 1.8 7 5"/></svg>', search: I.search }[kind] || I.shield;
  return `<span class="eart2" aria-hidden="true"><svg viewBox="0 0 120 120"><g transform="rotate(45 60 60)"><rect class="e-o" x="24" y="24" width="72" height="72" rx="18" pathLength="100"/><rect class="e-i" x="33" y="33" width="54" height="54" rx="13"/></g></svg><i>${ic}</i></span>`;
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
  if (P.step === "sending" || P.step === "done") return motionView(P, { kind: "send", N, title: ["Sending", "Sent"], amount: `${esc(P.amount)} ${esc(t.symbol || tokName(t))}`, line: `to <span class="mono">${esc(short(P.to))}</span>`, rows: [["To", `<span class="mono wrap">${esc(P.to)}</span>`]] });
  if (P.step === "review") return `${phead("Review")}
    <div class="rv-amt">${letterIc(t)}<b>${esc(P.amount)} <small>${esc(t.symbol || "")}</small></b><span>${esc(tokName(t))}</span></div>
    <div class="tk-info"><div><span>From</span><b>${esc(curAcct().name)}</b></div><div><span>To</span><b class="mono wrap">${esc(P.to)}</b></div><div><span>Network</span><b>${N.name} ${N.net}</b></div><div><span>Network fee</span><b>${esc(N.fam === "sol" ? "≈ 0.000005 SOL" : "a little " + N.unit + " for gas")}</b></div></div>
    ${P.lookalike ? lookalikeNote(P) : P.fresh ? `<div class="note warn">${I.shield}<span>You've never sent to this address from Ecrin. Check the first and last characters against where you copied it.</span></div>` : ""}
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
    <div class="acc-acts">${N.explorer("token", t.mint) ? `<a class="btn" href="${N.explorer(N.fam === "evm" || N.fam === "tron" || N.fam === "sui" ? "token" : "address", t.mint)}" target="_blank">${I.ext}Explorer</a>` : ""}
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
    try { const e = engine({ web3, ethers, acct: ACCT, net: x.k, dev: dev || {} }); const left = await Promise.race([e.allowance(x.token, x.spender), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 8000))]); /* a slow network never blocks the page */ return left > 0n ? { ...x, left: String(left) } : null; } catch (_) { return null; }
  }));
  P.evm = live.filter(Boolean); P.sol = S.delegs || []; P.ready = true;
  P.permits = apLog.filter((e) => e.kind === "typed" && e.permit && e.from === mineE).length;
  renderPanel();
}
function permsView() {
  const P = S.panel;
  if (!P.ready && !P.loading) { P.loading = true; setTimeout(loadPerms, 0); } // opened from anywhere, it still loads
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
  const P = S.panel, evm = netKeys().filter((k) => NETS[k].fam === "evm"), k = evm.includes(P.net) ? P.net : evm.includes(S.net) ? S.net : evm[0], N = NETS[k];
  const pv = P.info;
  if (P.res === undefined && !P.addr) setTimeout(searchTok, 0); // suggestions for this network as soon as the screen opens
  return `${phead("Add a token")}<div class="pad">
    <p class="fine">Search a token by name, or paste its contract address. Several tokens can share a name: the price tells you which one is real.</p>
    <div class="fld"><span>Network</span>
      <button type="button" class="dd" data-act="dd" aria-expanded="${!!P.dd}">${coin(k)}<b>${N.name}</b><small>${N.net}</small>${I.chev}</button>
      ${P.dd ? `<div class="dd-menu" role="listbox">${evm.map((n) => `<button type="button" role="option" class="dd-o${n === k ? " on" : ""}" data-act="dd-pick" data-n="${n}">${coin(n)}<b>${NETS[n].name}</b><small>${NETS[n].net}</small>${n === k ? I.check : ""}</button>`).join("")}</div>` : ""}
    </div>
    <label class="fld"><span>Token</span><input data-taddr placeholder="Name, symbol or 0x… address" value="${esc(P.addr || "")}" autocomplete="off" spellcheck="false"/></label>
    <div class="tk-prev" data-tprev>${tokPrevHTML(P)}</div>
    <div class="pfoot"><button class="btn primary xl" data-act="tok-add" ${pv?.symbol && !P.busy ? "" : "disabled"}>${P.busy ? `<i class="spin"></i>` : ""}Add ${pv?.symbol ? esc(pv.symbol) : "token"}</button></div></div>`;
}
const tokPx = (n) => (n == null ? "" : n >= 1 ? money(n) : n >= 0.01 ? money(n, { maximumFractionDigits: 4 }) : money(n, { maximumSignificantDigits: 3 }));
const tokBig = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n)));
const tokFace = (t) => (t.logo ? coin(t.logo) : t.icon ? `<span class="coin img" aria-hidden="true"><img src="${esc(t.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer"/></span>`
  : `<span class="coin letter" style="--h:${[...t.address].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)}">${esc((t.symbol || "?").charAt(0))}</span>`);
function tokPrevHTML(P) {
  const pv = P.info;
  if (P.looking) return `<span class="coin sk"></span><span><b class="sk-t">Looking up the token…</b><small>Reading it from ${esc(NETS[addTokNet(P)].name)}</small></span>`;
  if (pv?.err) return `<span class="err">${esc(pv.err)}</span>`;
  if (pv?.symbol) { const pk = P.picked?.address?.toLowerCase() === pv.mint.toLowerCase() ? P.picked : null;
    return `${pk ? tokFace(pk) : `<span class="coin letter" style="--h:${[...pv.mint].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)}">${esc(pv.symbol.charAt(0))}</span>`}<span><b>${esc(pv.name)}</b><small>${esc(pv.symbol)} · ${pv.dec} decimals · ${short(pv.mint)}</small></span>${pk?.price != null ? `<span class="tk-p"><b>${tokPx(pk.price)}</b><small>${pk.test ? "Test token" : `Liquidity $${tokBig(pk.liq)}`}</small></span>` : ""}`; }
  if (P.searching && !P.res?.length) return `<div class="tk-res">${[1, 2, 3].map(() => `<div class="tk-r sk-r"><span class="coin sk"></span><span class="tk-n"><b class="sk-t">&nbsp;</b></span></div>`).join("")}</div>`;
  if (P.res) {
    if (!P.res.length) return `<span class="tk-none">${P.resErr ? esc(P.resErr) : P.q ? `No token called “${esc(P.q)}” on ${esc(NETS[addTokNet(P)].name)} ${esc(NETS[addTokNet(P)].net)}. Paste its contract address instead.` : ""}</span>`;
    const same = {}; P.res.forEach((t) => { const s = t.symbol.toUpperCase(); same[s] = (same[s] || 0) + 1; });
    const seen = new Set();
    return `<div class="tk-res">${P.q ? "" : `<span class="tk-h">On ${esc(NETS[addTokNet(P)].name)} ${esc(NETS[addTokNet(P)].net)}</span>`}${P.res.map((t) => {
      const s = t.symbol.toUpperCase(), first = !seen.has(s); seen.add(s);
      const tag = t.have ? `<i class="tk-tag">Added</i>` : t.test ? "" : same[s] > 1 && first ? `<i class="tk-tag ok">Most traded</i>` : t.liq < 10_000 ? `<i class="tk-tag warn">Low liquidity</i>` : "";
      return `<button type="button" class="tk-r" data-act="tok-pick" data-a="${esc(t.address)}" ${t.have ? "disabled" : ""}>${tokFace(t)}<span class="tk-n"><b>${esc(t.name)}${tag}</b><small>${esc(t.symbol)} · ${short(t.address)}</small></span><span class="tk-p"><b>${t.price != null ? tokPx(t.price) : "—"}</b><small>${t.test ? "Test token" : `Liq. $${tokBig(t.liq)}`}</small></span></button>`;
    }).join("")}</div>${P.res.some((t) => t.test) ? `<p class="tk-note">Test networks have no markets: test tokens show the price of the real coin they stand for.</p>` : ""}`;
  }
  return "";
}
const addTokNet = (P) => { const evm = netKeys().filter((k) => NETS[k].fam === "evm"); return evm.includes(P.net) ? P.net : evm.includes(S.net) ? S.net : evm[0]; };
// Updates the preview and the Add button in place, so the address field keeps its cursor and the keyboard stays put.
function paintTokPrev() {
  const P = S.panel, box = $("#panel [data-tprev]"), btn = $("#panel [data-act='tok-add']"); if (!P || !box) return renderPanel();
  box.innerHTML = tokPrevHTML(P); translate(box, S.lang);
  if (btn) { btn.disabled = !P.info?.symbol || !!P.busy; btn.textContent = trText(`Add ${P.info?.symbol || "token"}`, S.lang); }
}
async function previewTok() {
  const P = S.panel; if (!P || P.p !== "addTok") return;
  const k = addTokNet(P), addr = (P.addr || "").trim(), key = `${k}:${addr.toLowerCase()}`;
  if (!addr || !/^0x[0-9a-fA-F]*$/.test(addr)) { P.info = null; P.looking = false; P.lastKey = null; return searchTok(); } // a name: search
  P.res = null;
  if (key === P.lastKey && (P.info || P.looking)) return; // nothing changed
  P.lastKey = key; P.info = null; P.looking = false;
  // only judge the address once it's complete: no error while it's still being typed or pasted
  if (!ethers.isAddress(addr)) { if (/^0x[0-9a-fA-F]{40,}$/.test(addr) || addr.length >= 42) P.info = { err: "That isn't a contract address." }; return paintTokPrev(); }
  S.tokCache ||= {}; if (S.tokCache[key]) { P.info = S.tokCache[key]; return paintTokPrev(); }
  P.looking = true; paintTokPrev(); const ticket = (P.ticket = (P.ticket || 0) + 1);
  try {
    const info = await tokInfoAt(k, addr);
    if (ticket !== P.ticket || S.panel !== P) return;
    S.tokCache[key] = info; P.info = info;
  } catch (e) { if (ticket !== P.ticket || S.panel !== P) return; P.info = { err: e?.message === "demo" ? "The demo can't read real tokens. In Ecrin Wallet, any token address works here." : e?.message === "slow" ? `${NETS[k].name} is slow to answer. Try again in a moment.` : `No token at that address on ${NETS[k].name}.` }; P.lastKey = null; }
  P.looking = false; paintTokPrev();
}
async function tokInfoAt(k, addr) {
  const key = `${k}:${addr.toLowerCase()}`; S.tokCache ||= {}; if (S.tokCache[key]) return S.tokCache[key];
  const { dev } = await local.get("dev");
  const eg = engine({ web3, ethers, acct: ACCT, net: k, dev: dev || {} }); if (!eg.tokenInfo) throw new Error("demo");
  const info = await Promise.race([eg.tokenInfo(addr), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 10_000))]);
  return (S.tokCache[key] = info);
}

// ---- token search by name
// Mainnets: live market search (name → contract, price, liquidity) via ecrinprotocol.app/api/tokens.
// Test networks have no markets, so a short list of well-known test tokens. Each one is read from the chain before
// it is shown and must answer with the symbol expected, so a wrong or retired address is never offered.
const TOKENS_API = "https://ecrinprotocol.app/api/tokens";
const DEX_CHAIN = { 1: "ethereum", 8453: "base", 42161: "arbitrum", 10: "optimism", 137: "polygon", 56: "bsc", 43114: "avalanche" };
const TT = (a, sym, cg, words, logo) => ({ a, sym: [].concat(sym), cg, words, logo });
const TEST_TOKENS = {
  eth: [TT("0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4", "EURC", "euro-coin", "euro coin circle"), TT("0x779877A7B0D9E8603169DdbD7836e478b4624789", "LINK", "chainlink", "chainlink"),
    TT("0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", "WETH", "ethereum", "wrapped ether ethereum", "eth"), TT("0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", "UNI", "uniswap", "uniswap")],
  base: [TT("0x808456652fdb597867f38412077A9182bf77359F", "EURC", "euro-coin", "euro coin circle"), TT("0x4200000000000000000000000000000000000006", "WETH", "ethereum", "wrapped ether ethereum", "eth"),
    TT("0xE4aB69C077896252FAFBD49EFD26B5D171A32410", "LINK", "chainlink", "chainlink")],
  arb: [TT("0x980B62Da83eFf3D4576C647993b0c1D7faf17c73", "WETH", "ethereum", "wrapped ether ethereum", "eth"), TT("0xb1D4538B4571d411F07960EF2838Ce337FE1E80E", "LINK", "chainlink", "chainlink")],
  op: [TT("0x4200000000000000000000000000000000000006", "WETH", "ethereum", "wrapped ether ethereum", "eth"), TT("0xE4aB69C077896252FAFBD49EFD26B5D171A32410", "LINK", "chainlink", "chainlink")],
  pol: [TT("0x0Fd9e8d3aF1aaee056EB9e802c3A762a667b1904", "LINK", "chainlink", "chainlink"), TT("0x360ad4f9a9A8EFe9A8DCB5f461c4Cc1047E1Dcf9", ["WPOL", "WMATIC"], "polygon-ecosystem-token", "wrapped pol polygon matic")],
  bnb: [TT("0x84b9B910527Ad5C03A9Ca831909E21e236EA7b06", "LINK", "chainlink", "chainlink"), TT("0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd", "WBNB", "binancecoin", "wrapped bnb binance")],
  avax: [TT("0x5E44db7996c682E92a960b65AC713a54AD815c6B", "EURC", "euro-coin", "euro coin circle"), TT("0x0b9d5D9136855f6FEc3c0993feE6E9CE8a297846", "LINK", "chainlink", "chainlink"),
    TT("0xd00ae08403B9bbb9124bB305C09058E32C39A48c", "WAVAX", "avalanche-2", "wrapped avax avalanche")],
};
async function cgPrices(ids) {
  S.cgPx ||= {}; const want = [...new Set(ids)].filter((id) => !(id in S.cgPx));
  if (want.length) { try { const j = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${want.join(",")}&vs_currencies=usd`); for (const id of want) S.cgPx[id] = j?.[id]?.usd ?? null; } catch (_) {} }
  return (id) => S.cgPx[id] ?? S.prices?.[id]?.usd ?? null;
}
async function testTokens(k, q) {
  const N = NETS[k], have = new Set((S.tokList[k] || []).map((t) => t.mint.toLowerCase()));
  const all = [...(N.usdc ? [TT(N.usdc, "USDC", "usd-coin", "usd coin circle dollar", "usdc")] : []), ...(TEST_TOKENS[k] || [])];
  const ql = q.toLowerCase(), hits = all.filter((t) => !ql || t.sym.some((s) => s.toLowerCase().startsWith(ql)) || t.words.includes(ql));
  const px = await cgPrices(hits.map((t) => t.cg));
  const rows = await Promise.all(hits.map(async (t) => {
    try { const info = await tokInfoAt(k, ethers.getAddress(t.a.toLowerCase())); if (!t.sym.includes(info.symbol.toUpperCase())) return null;
      const isUsdc = N.usdc && info.mint.toLowerCase() === N.usdc.toLowerCase();
      return { address: info.mint, name: info.name, symbol: info.symbol, price: px(t.cg), test: true, logo: t.logo, have: isUsdc || have.has(info.mint.toLowerCase()) };
    } catch (_) { return null; }
  }));
  return rows.filter(Boolean);
}
async function marketTokens(k, q) {
  const chain = DEX_CHAIN[NETS[k].E?.chainId]; if (!chain || q.length < 2) return [];
  const j = await getJSON(`${TOKENS_API}?chain=${chain}&q=${encodeURIComponent(q)}`), have = new Set((S.tokList[k] || []).map((t) => t.mint.toLowerCase()));
  return (j?.tokens || []).filter((t) => ethers.isAddress(t.address)).map((t) => ({ ...t, address: ethers.getAddress(t.address.toLowerCase()), have: have.has(t.address.toLowerCase()) }));
}
async function searchTok() {
  const P = S.panel; if (!P || P.p !== "addTok") return;
  const k = addTokNet(P), q = (P.addr || "").trim(), key = `${k}|${q.toLowerCase()}`;
  if (key === P.sKey && (P.res || P.searching)) return;
  P.sKey = key; P.q = q; P.searching = true; P.resErr = null; if (!P.res) P.res = null; paintTokPrev();
  const ticket = (P.sTicket = (P.sTicket || 0) + 1);
  let res = [], err = null;
  try { const [a, b] = await Promise.all([testTokens(k, q), marketTokens(k, q).catch(() => { err = "Market prices are unreachable right now. You can still paste a contract address."; return []; })]); res = [...a, ...b]; } catch (_) {}
  if (ticket !== P.sTicket || S.panel !== P) return;
  P.searching = false; P.res = res; P.resErr = res.length ? null : err; paintTokPrev();
}

function allView() {
  const rows = S.panel.rows, px = (k) => S.prices[NETS[k].cg]?.usd;
  if (!rows) return `${phead("All assets")}<div class="all-total"><span class="lbl">Across every network</span><div class="big sk">&nbsp;</div></div><section class="list">${[1, 2, 3, 4].map(() => `<div class="arow"><span class="coin sk"></span><span class="ar-t"><b class="sk">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</b></span></div>`).join("")}</section>`;
  const items = [];
  for (const r of rows.filter((r) => r.ok)) {
    const N = NETS[r.k], natC = r.b.native, natS = r.v?.main?.balance || 0, uC = r.b.usdc || 0, uS = r.v?.usdc?.balance || 0;
    const nUsd = px(r.k) != null ? ((natC + natS) / BASE) * px(r.k) : null;
    if (natC + natS > 0) items.push({ k: r.k, coin: r.k, unit: N.unit, name: COIN_NAME[N.unit] || N.unit, net: nname(N), chq: natC / BASE, sav: natS / BASE, usd: nUsd, dec: N.unit === "SOL" ? 4 : 5 });
    if (uC + uS > 0) items.push({ k: r.k, coin: "usdc", unit: "USDC", name: "USD Coin", net: nname(N), chq: uC / USDC_BASE, sav: uS / USDC_BASE, usd: (uC + uS) / USDC_BASE, dec: 2 });
  }
  const total = items.reduce((s, i) => s + (i.usd || 0), 0), saved = items.reduce((s, i) => s + (i.usd != null && i.chq + i.sav ? (i.usd * i.sav) / (i.chq + i.sav) : 0), 0);
  // By coin: SOL, ETH (all Ethereum-style networks together), POL, USDC.
  const byCoin = {};
  for (const i of items) { const c = (byCoin[i.unit] ||= { unit: i.unit, coin: i.unit === "USDC" ? "usdc" : i.unit === "ETH" ? "eth" : i.coin, usd: 0, amt: 0, dec: i.dec }); c.usd += i.usd || 0; c.amt += i.chq + i.sav; }
  const coins = Object.values(byCoin).sort((a, b) => b.usd - a.usd), COL = { SOL: "#9945ff", ETH: "#7d97ff", POL: "#a26bff", BNB: "#f0b90b", AVAX: "#e84142", TRX: "#ff060a", USDC: "#2775ca", HYPE: "#50d2c1" };
  const n = (v, d) => v.toLocaleString("en-US", { maximumFractionDigits: d });
  return `${phead("All assets")}
    <div class="all-total"><span class="lbl">Across every network</span><div class="big">${mask(fig(money(total)))}</div>
      <span class="sub">${total ? `${Math.round((saved / total) * 100)}% protected in your Safe` : "Nothing here yet"}</span></div>
    ${total ? `<div class="alloc">${coins.map((c) => `<i style="flex:${c.usd || 0.0001};background:${COL[c.unit] || "#888"}"></i>`).join("")}</div>
    <div class="alloc-l">${coins.filter((c) => c.usd / total >= 0.005).map((c) => `<span><i style="background:${COL[c.unit] || "#888"}"></i>${c.unit} ${Math.round((c.usd / total) * 100)}%</span>`).join("")}</div>` : ""}
    <div class="list-h"><b>By network</b><span>Wallet · Safe</span></div>
    <section class="list">${items.length ? items.sort((a, b) => (b.usd || 0) - (a.usd || 0)).map((i) => `<button class="arow" data-act="net-go" data-n="${i.k}"><span class="cstack">${coin(i.coin)}${i.coin === "usdc" || i.coin !== i.k ? `<span class="cmini">${coin(i.k)}</span>` : ""}</span>
      <span class="ar-t"><b>${i.net}</b><small>${i.unit} · ${mask(n(i.chq, i.dec))}${i.sav ? ` <span class="sv">${I.lock}${mask(n(i.sav, i.dec))}</span>` : ""}</small></span>
      <span class="ar-r"><b>${i.usd != null ? mask(money(i.usd)) : "—"}</b><small>${mask(n(i.chq + i.sav, i.dec))} ${i.unit}</small></span></button>`).join("")
      : `<div class="empty">${I.shield}<b>No coins yet</b><span>${isMain() ? "Use Receive to add coins on any network." : "Use Receive to get test coins on any network."}</span></div>`}</section>
    ${rows.some((r) => !r.ok) ? `<p class="fine pad">Couldn't reach ${rows.filter((r) => !r.ok).map((r) => NETS[r.k].name).join(", ")} right now.</p>` : ""}`;
}

/** The network picker: Mainnet or Testnet, your networks first with what you hold on each, then every other one. */
function netsView() {
  const rows = Object.fromEntries((S.all || []).map((r) => [r.k, r])), w = worth();
  const usdOn = (k) => w.items.filter((i) => i.k === k).reduce((t, i) => t + (i.usd || 0), 0);
  const addrOf = (k) => { const N = NETS[k]; return N.fam === "sol" ? ACCT?.sol?.publicKey?.toBase58?.() : N.fam === "tron" ? (ACCT?.tron ? toTron(ACCT.tron.address) : "") : N.fam === "sui" ? suiOf(ACCT) : ACCT?.evm?.address; };
  const keys = netKeys(), mine = keys.filter((k) => usdOn(k) > 0 || rows[k]?.v).sort((a, b) => usdOn(b) - usdOn(a)), rest = keys.filter((k) => !mine.includes(k));
  const row = (k) => { const N = NETS[k], r = rows[k], st = !S.all ? "" : r?.ok ? "ok" : "down", v = usdOn(k);
    return `<button class="nr${k === S.net ? " on" : ""}" data-act="net-go" data-n="${k}">${coin(k)}
      <span class="nr-t"><b>${esc(N.name)}${r?.v ? `<i class="nr-safe">${I.lock}Safe</i>` : ""}</b><small><i class="nr-st ${st}"></i>${st === "down" ? "Can't reach it right now" : `${esc(N.net)} · <span class="mono">${esc(short(addrOf(k) || ""))}</span>`}</small></span>
      <span class="nr-r">${v ? `<b>${mask(money(v))}</b>` : `<small>—</small>`}</span>${k === S.net ? `<i class="nr-ck">${I.check}</i>` : ""}</button>`; };
  return `${phead("Networks")}
    <div class="nets">
      <div class="nets-mode"><span class="seg">${[["main", "Mainnet"], ["test", "Testnet"]].map(([m, l]) => `<button data-act="net-mode" data-v="${m}" aria-pressed="${(S.mode || DEFAULT_MODE) === m}">${l}</button>`).join("")}</span>
        <p>${isMain() ? `${keys.length} networks` : `Test coins with no value · ${keys.length} networks`}</p></div>
      ${mine.length ? `<div class="list-h"><b>Your networks</b><span>${mask(money(mine.reduce((t, k) => t + usdOn(k), 0)))}</span></div><section class="list nlist">${mine.map(row).join("")}</section>` : ""}
      <div class="list-h"><b>${mine.length ? "Other networks" : "All networks"}</b><span>${rest.length}</span></div>
      <section class="list nlist">${rest.map(row).join("")}</section>
      <p class="fine pad">Ethereum-style networks share one address. Coins sent on the wrong network can be lost: check the network before you send.</p>
    </div>`;
}

const host = (o) => { try { return new URL(o).hostname.replace(/^www\./, ""); } catch (_) { return String(o || "a website"); } };
const nameFor = (k, a) => (a && S.book?.[NETS[k]?.fam]?.[a]) || null;
const who = (k, a) => esc(nameFor(k, a) || short(a));
/** Activity from every network of this account, newest first, plus coins received (read from the chain) and website approvals. */
async function loadActivity() {
  const keys = netKeys(), addrOf = (k) => (NETS[k].fam === "sol" ? ACCT.sol?.publicKey.toBase58() : NETS[k].fam === "tron" ? (ACCT.tron ? toTron(ACCT.tron.address) : null) : NETS[k].fam === "sui" ? suiOf(ACCT) : ACCT.evm?.address);
  const st = await local.get([...keys.map((k) => `act:${k}:${addrOf(k)}`), "apLog"]);
  let list = keys.flatMap((k) => (st[`act:${k}:${addrOf(k)}`] || []).map((e) => ({ ...e, k })));
  const mine = new Set(keys.map(addrOf).filter(Boolean));
  list.push(...(st.apLog || []).filter((e) => mine.has(e.from)));
  const merge = () => { const seen = new Set(list.map((x) => x.sig).filter(Boolean)); S.activity = [...list, ...(S.hist || []).filter((x) => !seen.has(x.sig))].sort((x, y) => y.at - x.at); if (S.tab === "activity") paintActivity(); };
  merge();
  if (S.histAt && Date.now() - S.histAt < 30_000) return; S.histAt = Date.now();
  const sk = keys.find((k) => NETS[k].fam === "sol"); if (!sk) return;
  try {
    const { dev } = await local.get("dev"); const e = S.net === sk && ENG ? ENG : engine({ web3, ethers, acct: ACCT, net: sk, dev: dev || {} });
    S.hist = ((await e.history?.()) || []).map((x) => ({ ...x, k: sk })); merge();
  } catch (_) {}
}
const ACT_LBL = {
  send: (e) => [`Sent to ${who(e.k, e.to)}`, I.send, "out"], tsend: (e) => [e.to ? `Sent ${esc(e.sym || "tokens")} to ${who(e.k, e.to)}` : `Sent ${esc(e.sym || "tokens")}`, I.send, "out"],
  recv: (e) => [e.from ? `Received from ${who(e.k, e.from)}` : "Received", I.recv, "in"], protect: () => ["Moved to Safe", I.protect, ""],
  withdraw: () => ["Withdrawal started", I.clock, ""], release: () => ["Released to Wallet", I.recv, "in"], cancel: () => ["Withdrawal cancelled", I.shield, ""],
  vault: () => ["Safe opened", I.lock, ""], swap: (e) => [`Swapped ${esc(e.from || "")} for ${esc(e.to || "")}`, I.swap, ""], bridge: (e) => [`Bridged ${esc(e.amt || "")} ${esc(e.sym || "")} to ${esc(e.to || "")}`, I.swap, ""], revoke: (e) => [e.site ? `Removed ${esc(host(e.site))}'s permission` : "Removed a token permission", I.ban, ""],
  freeze: () => ["Safe frozen", I.snow, ""], auto: () => ["Protected automatically", I.protect, ""],
  stake: () => ["Staked", I.spark, ""], unstake: () => ["Unstaking started", I.clock, ""], reclaim: () => ["Back in your Safe from staking", I.lock, "in"],
  ap: (e) => [{ connect: `Connected to ${host(e.origin)}`, sign: `Signed a message on ${host(e.origin)}`, solmsg: `Signed a message on ${host(e.origin)}`, typed: `${e.permit ? "Approved spending on" : "Signed for"} ${host(e.origin)}`, tx: `${e.permit ? "Approved spending on" : "Approved a transaction on"} ${host(e.origin)}`, soltx: `Approved a transaction on ${host(e.origin)}`, delegate: "Gave a token permission" }[e.kind] || `Approved on ${host(e.origin)}`, e.permit ? I.warn : I.link, e.permit ? "warn" : ""],
};
function actRows(only) {
  const q = only ? "" : (S.actQ || "").trim().toLowerCase(), all = only || S.activity || [];
  const when = (ms) => (ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  const rows = all.map((e) => { const [title, ic, cls] = (ACT_LBL[e.t] || (() => ["Transaction", I.arrow, ""]))(e); return { e, title, ic, cls }; })
    .filter((r) => !q || `${r.title} ${r.e.to || ""} ${r.e.from || ""} ${r.e.origin || ""} ${NETS[r.e.k]?.name || ""}`.toLowerCase().includes(q));
  if (!rows.length) return `<div class="empty art">${emptyArt("search")}<b>Nothing matches “${esc(q)}”</b><span>Try a name, an address or a site.</span></div>`;
  let day = ""; S.actShown ||= {};
  return rows.slice(0, 120).map((row) => { const { e, title, ic, cls } = row, ix = `${e.at || 0}:${e.t}:${e.sig || e.n || ""}`.replace(/"/g, ""); S.actShown[ix] = row;
    const d = e.at ? new Date(e.at).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : "Earlier", head = d !== day ? `<div class="act-day">${(day = d)}</div>` : "";
    const N = NETS[e.k] || NETS.sol, unit = e.sym || (e.a === "usdc" ? "USDC" : N.unit), val = e.n ? (e.a === "usdc" ? e.n / USDC_BASE : e.t === "tsend" ? e.n : e.n / BASE) : null;
    const sign = cls === "out" ? "−" : cls === "in" ? "+" : "";
    const tag = `button data-act="txd" data-i="${ix}"`;
    const safeEv = /^(protect|auto|withdraw|release|cancel|vault|freeze)$/.test(e.t), cu = e.a === "usdc" ? "USDC" : unit;
    return `${head}<${tag} class="arow act-row ${e.t} ${cls}${safeEv ? " safe-ev" : ""}" style="--cc:${COIN_COL[cu] || "#9aa0b4"}"><span class="act-ico">${ic}${e.k ? `<span class="cmini">${coin(e.k)}</span>` : ""}</span>
      <span class="ar-t"><b>${title}</b><small>${safeEv ? `<em class="sv-tag">${I.lock}Safe</em>` : ""}${when(e.at)}${e.k ? ` · ${N.name}` : ""}</small></span>
      ${val != null ? `<span class="ar-r"><b class="${cls === "out" ? "neg" : cls === "in" ? "pos" : ""}">${sign}${mask(val.toLocaleString("en-US", { maximumFractionDigits: 6 }))} ${esc(unit)}</b>${(() => { const px = cu === "USDC" ? 1 : S.prices[N.cg]?.usd; return px != null && e.t !== "tsend" && !e.sym ? `<small>≈ ${mask(money(val * px))}</small>` : ""; })()}</span>` : ""}</${tag.split(" ")[0]}>`;
  }).join("");
}
// ------------------------------------------------------------------ monthly report
const monthKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 7);
async function bump(stat) { const { stats = {} } = await local.get("stats"), k = monthKey(); stats[k] = { ...(stats[k] || {}), [stat]: (stats[k]?.[stat] || 0) + 1 }; await local.set({ stats }); }
const usdOfEntry = (e) => { if (!e.n || e.t === "tsend") return 0; if (e.a === "usdc") return e.n / USDC_BASE; const px = S.prices[NETS[e.k]?.cg]?.usd; return px ? (e.n / BASE) * px : 0; };
function reportHTML() {
  const P = S.panel, m = P.month || monthKey(), d = new Date(m + "-15T00:00:00Z");
  const label = d.toLocaleDateString(S.lang === "fr" ? "fr-CA" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const list = (S.activity || []).filter((e) => e.at && monthKey(e.at) === m);
  const sum = (f) => list.filter(f).reduce((t, e) => t + usdOfEntry(e), 0);
  const recv = sum((e) => e.t === "recv"), sent = sum((e) => e.t === "send"), prot = sum((e) => e.t === "protect" || e.t === "auto"), out = sum((e) => e.t === "withdraw" || e.t === "release");
  const st = S.stats?.[m] || {}, apps = list.filter((e) => e.t === "ap").length, revokes = list.filter((e) => e.t === "revoke").length, cancels = list.filter((e) => e.t === "cancel").length;
  const { score } = safety(), w = worth(), share = w.total ? Math.round((w.sav / w.total) * 100) : 0;
  const months = [...new Set([monthKey(), ...(S.activity || []).filter((e) => e.at).map((e) => monthKey(e.at))])].sort().reverse().slice(0, 12), i = months.indexOf(m);
  const big = (v) => mask(money(v));
  const moments = [[I.clock, "Cooling-off pauses", st.cool || 0], [I.ban, "Sends stopped by your limit", st.limit || 0], [I.shield, "Withdrawals you cancelled", cancels], [I.ban, "Permissions you revoked", revokes], [I.link, "Website requests you approved", apps]];
  return `${phead("Monthly report")}
    <div class="rp-nav"><button class="ib" data-act="rp-m" data-v="${months[i + 1] || ""}" ${months[i + 1] ? "" : "disabled"} aria-label="Previous month">${I.back}</button><b>${label}</b><button class="ib rp-next" data-act="rp-m" data-v="${months[i - 1] || ""}" ${i > 0 ? "" : "disabled"} aria-label="Next month">${I.back}</button></div>
    <div class="rp-hero"><span class="lbl">Moved into your Safe</span><b>${big(prot)}</b><small>${share}% of everything you hold is in your Safe today</small>
      <div class="rp-bar"><i style="width:${share}%"></i></div></div>
    <div class="rp-grid"><div><span>Received</span><b>${big(recv)}</b></div><div><span>Sent</span><b>${big(sent)}</b></div><div><span>Left the Safe</span><b>${big(out)}</b></div><div><span>Safety score</span><b>${score}<small>/100</small></b></div></div>
    <div class="list-h"><b>Moments Ecrin stepped in</b><span></span></div>
    <section class="list rp-m">${moments.map(([ic, t, n]) => `<div class="arow"><span class="act-ico">${ic}</span><span class="ar-t"><b>${t}</b></span><span class="ar-r"><b>${n}</b></span></div>`).join("")}</section>
    <p class="fine pad">Amounts use today's prices. ${list.length ? `${list.length} event${list.length > 1 ? "s" : ""} this month.` : "No activity this month yet."}</p>`;
}

/** One activity in full: what, how much, who, when, where, and the explorer link. */
function txdView() {
  const r = S.actShown?.[S.panel.i]; if (!r) return `${phead("Details")}<p class="fine pad">This item isn't available anymore.</p>`;
  const { e, title, ic, cls } = r, N = NETS[e.k] || NETS.sol, unit = e.sym || (e.a === "usdc" ? "USDC" : N.unit);
  const val = e.n ? (e.a === "usdc" ? e.n / USDC_BASE : e.t === "tsend" ? e.n : e.n / BASE) : null, usd = usdOfEntry(e);
  // Only sends and receives carry an address: a swap's "to" is a coin, a bridge's is a network.
  const addrs = ["send", "tsend", "recv"].includes(e.t), who = addrs ? e.to || e.from : null, whoName = who ? nameFor(e.k, who) : null;
  const rowA = (label, a) => `<div><span>${label}</span><b class="mono wrap">${whoName && a === who ? `${esc(whoName)}<br/>` : ""}${esc(a)} <button class="ib sm" data-act="copy" data-v="${esc(a)}" aria-label="Copy">${I.copy}</button></b></div>`;
  return `${phead("Details")}
    <div class="txd-hero"><span class="act-ico lg ${cls}">${ic}</span><b>${title}</b>
      ${val != null ? `<span class="txd-amt ${cls}">${cls === "out" ? "−" : cls === "in" ? "+" : ""}${mask(val.toLocaleString("en-US", { maximumFractionDigits: 6 }))} ${esc(unit)}</span>${usd ? `<small>${mask(money(usd))} today</small>` : ""}` : ""}</div>
    <div class="txd-steps"><span class="ts on"><i></i>${cls === "in" ? "Sent to you" : "Submitted"}</span><span class="ts-l"></span><span class="ts on"><i>${I.check}</i>Confirmed</span></div>
    <div class="tk-info txd-card">
      <div><span>Status</span><b><span class="st-pill">${I.check}Confirmed</span></b></div>
      <div><span>Date</span><b>${e.at ? new Date(e.at).toLocaleString(S.lang === "fr" ? "fr-CA" : "en-US", { dateStyle: "medium", timeStyle: "short" }) : "—"}</b></div>
      <div><span>Network</span><b>${N.name} ${N.net}</b></div>
      ${addrs ? `${e.to ? rowA("To", e.to) : ""}${e.from ? rowA("From", e.from) : ""}` : e.t === "swap" ? `<div><span>Swapped</span><b>${esc(e.from || "")} → ${esc(e.to || "")}</b></div>` : e.t === "bridge" && e.to ? `<div><span>To network</span><b>${esc(e.to)}</b></div>` : ""}
      ${e.origin ? `<div><span>Website</span><b>${esc(host(e.origin))}</b></div>` : ""}
      ${e.sig ? `<div><span>Transaction</span><b class="mono">${short(e.sig)} <button class="ib sm" data-act="copy" data-v="${esc(e.sig)}" aria-label="Copy">${I.copy}</button></b></div>` : ""}
    </div>
    ${who && !whoName && N.fam ? `<div class="book-save txd-save"><input data-bookname placeholder="Save this address as a contact" maxlength="24" autocomplete="off"/><button class="btn sm" data-act="txd-save" data-a="${esc(who)}" data-f="${N.fam}">Save</button></div>` : ""}
    ${e.sig && N.explorer("tx", e.sig) ? `<div class="pfoot"><a class="btn xl" href="${N.explorer("tx", e.sig)}" target="_blank">${I.ext}View on the explorer</a></div>` : ""}`;
}

// ------------------------------------------------------------------ contacts
const FAM_NAME = { sol: "Solana", evm: "Ethereum-style", tron: "Tron" };
const famOfAddr = (a) => { a = String(a || "").trim(); if (/^0x[0-9a-fA-F]{40}$/.test(a)) return "evm"; if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return "tron"; try { new web3.PublicKey(a); return a.length >= 32 ? "sol" : null; } catch (_) { return null; } };
function contactsView() {
  const P = S.panel, all = Object.entries(S.book || {}).flatMap(([f, m]) => Object.entries(m || {}).map(([a, n]) => ({ f, a, n }))).sort((x, y) => x.n.localeCompare(y.n));
  return `${phead("Contacts")}
    <div class="ct-add"><input data-ctname placeholder="Name" maxlength="24" value="${esc(P.n || "")}"/><input data-ctaddr placeholder="Address (Solana, 0x… or T…)" value="${esc(P.a || "")}" spellcheck="false" autocomplete="off"/><button class="btn primary" data-act="ct-add">${I.plus}Add contact</button></div>
    <section class="list">${all.length ? all.map((c) => `<div class="arow ct">${acctIc({ name: c.n, logo: { s: "letter" }, c: [...c.a].reduce((h, ch) => h + ch.charCodeAt(0), 0) })}<span class="ar-t"><b>${esc(c.n)}</b><small class="mono">${short(c.a)} · ${FAM_NAME[c.f] || c.f}</small></span>
      <button class="ib sm" data-act="copy" data-v="${esc(c.a)}" aria-label="Copy">${I.copy}</button><button class="ib sm" data-act="ct-del" data-f="${c.f}" data-a="${esc(c.a)}" aria-label="Delete ${esc(c.n)}">${I.x}</button></div>`).join("")
      : `<div class="empty art">${emptyArt("contacts")}<b>No contacts yet</b><span>Save people and places you send to often. You can also save an address after you send to it.</span></div>`}</section>
    <p class="fine pad ct-note">Contacts stay on this device. Sending to a contact still shows the full address to check.</p>`;
}

// ------------------------------------------------------------------ export a private key
function pkeyView() {
  const P = S.panel, A0 = curAcct();
  if (!P.keys) return `${phead("Private key")}<form class="stack pad" data-form="pkey"><div class="note warn">${I.warn}<span>A private key gives full control of <b>${esc(A0.name)}</b>. Anyone who sees it can take everything in its Wallet. Never paste it on a website or give it to anyone, including "support".</span></div>
    <label class="fld"><span>Password</span><input name="pw" type="password" autofocus required/></label><p class="err" data-err></p><button class="btn primary xl">Show private key</button></form>`;
  return `${phead("Private key")}<p class="sub pad">For <b>${esc(A0.name)}</b>. Import it only into a wallet you trust.</p>
    ${P.keys.map(([label, k]) => `<div class="ad-card pk"><header class="ad-h"><span><b>${label}</b></span><button class="ib sm" data-act="copy" data-v="${esc(k)}" aria-label="Copy">${I.copy}</button></header><div class="ad-a mono" data-notr>${esc(k)}</div></div>`).join("")}
    <p class="fine pad">Your Safe can't be emptied with this key alone in a hurry: its delay still applies.</p>`;
}

function activityList() {
  const list = S.activity || [];
  if (!list.length) return `<section class="list"><div class="empty art">${emptyArt("act")}<b>Nothing here yet</b><span>Sends, receives, Safe moves and website approvals show up here.</span><button class="btn sm primary" data-act="panel" data-p="receive">Receive your first coins</button></div></section>`;
  return `<button class="rp-open" data-act="report">${I.spark || I.clock}<span><b>Monthly report</b><small>${new Date().toLocaleDateString(S.lang === "fr" ? "fr-CA" : "en-US", { month: "long" })} so far</small></span>${I.arrow}</button><label class="act-q">${I.search}<input data-actq placeholder="Search names, addresses, sites" value="${esc(S.actQ || "")}" autocomplete="off" spellcheck="false"/></label><section class="list" id="actl">${actRows()}</section>`;
}
function paintActivity() { const el = $("#actl"); if (el) { el.innerHTML = actRows(); translate(el, S.lang); } else if (S.screen === "home" && !S.panel) render(); }

function delay(s) { return s >= 86400 && s % 86400 === 0 ? `${s / 86400} day${s / 86400 > 1 ? "s" : ""}` : `${Math.round(s / 3600)} h`; }
function dur(s) { if (s <= 0) return "ready"; const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; }

// ------------------------------------------------------------------ panels (slide over the home screen)

/** Screens remember where you came from, like any major wallet: back returns to the exact previous screen. */
function pushPanel(next) { const P = S.panel; if (P && P.p !== next && P.step !== "sending") { (S.pstack ||= []).push(P); if (S.pstack.length > 12) S.pstack.shift(); } }
function openPanel(p, opts = {}) { if (p === "vault") S.shT0 = 0; S.cvT0 = 0; const fresh = !S.panel; pushPanel(p); S.panel = { p, step: "form", asset: opts.a || "native", amount: "", to: "", ...opts }; renderPanel(fresh); }
/** Back: first a step back inside the current screen, then the previous screen, then home. */
function goBack() {
  const P = S.panel; if (!P) return;
  if (P.step === "sending") return; // a transaction is on its way: its sheet stays until it's done
  if (P.p === "earn" && P.step === "done") { P.step = "form"; P.mo = null; P.mode = "home"; P.st = undefined; return renderPanel(); }
  if (P.p === "earn" && (P.mode === "stake" || P.mode === "unstake")) { P.mode = "home"; P.amount = ""; P.pct = null; return renderPanel(); }
  if (P.p === "bridge" && P.pick) { P.pick = null; return renderPanel(); }
  if (P.p === "bridge" && P.step === "review") { P.step = "form"; return renderPanel(); }
  if (P.p === "send" && P.step === "form" && P.whoDone) { P.whoDone = false; P.anim = false; return renderPanel(); }
  if (P.step === "review" || P.step === "to") { P.step = P.p === "withdraw" && P.step === "review" && P.dest ? "form" : "form"; P.anim = false; return renderPanel(); }
  const prev = S.pstack?.pop();
  if (prev) {
    const wasDone = P.step === "done";
    S.panel = prev; if (prev.step === "done") prev.step = "form";
    if (prev.p === "earn") { prev.st = undefined; prev.mode = prev.mode === "stake" || prev.mode === "unstake" ? "home" : prev.mode; }
    if (wasDone || ["all", "vault", "rules"].includes(prev.p)) loadAll();
    return renderPanel();
  }
  closePanel();
}
// Home's bottom fade is pinned to the screen, but while home slides (it moves with a transform) browsers pin it to the
// page instead, so it jumps up over the first token rows: a blank or faded strip until the slide ends. body.stacked
// and body.settling hide it while home is moved, and it fades back once home is still.
function settleHome() { const b = document.body; clearTimeout(S.settleT); b.classList.add("settling"); S.settleT = setTimeout(() => b.classList.remove("settling"), 460); }
function closePanel() { S.pstack = []; if (S.panel?.step === "done" && (S.panel.p === "protect" || S.panel.p === "withdraw")) S.fly = S.panel.p; const el = $("#panel"); el.classList.remove("in"); document.body.classList.remove("stacked"); settleHome(); setTimeout(() => { if (!S.panel) el.innerHTML = ""; }, 260); S.panel = null;
  // Coming back to home: if nothing on it changed, keep the screen as it is instead of rebuilding it mid-slide
  // (a rebuild re-decodes every coin logo and the rows visibly settle for a moment).
  if (S.screen === "home" && !S.fly && S.homeSig && viewSig(homeView()) === S.homeSig) { syncTabbar(); return; }
  render(); }
// The home markup minus anything that only encodes the passing time (animation offsets), to tell real changes apart.
const viewSig = (h) => String(h).replace(/-?\d+(\.\d+)?ms/g, "").replace(/ (intro|draw|enter|fresh)(?=["\s])/g, "").replace(/ (?:[xy][12]|c[xy]|f[xy])="-?\d+\.\d{3}"/g, "");

// Updates a live element to match new markup, touching only what changed. The field you're typing in keeps its
// value, cursor and focus; elements that didn't change keep their animations and listeners.
function morph(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b.cloneNode(true)); return; }
  if (a.nodeType === 3 || a.nodeType === 8) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  const active = a === document.activeElement;
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name) && !(active && name === "value")) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) { if (active && name === "value") continue; if (a.getAttribute(name) !== value) a.setAttribute(name, value); }
  if ((a.nodeName === "INPUT" || a.nodeName === "TEXTAREA") && !active && a.value !== (b.value ?? b.getAttribute("value") ?? "")) a.value = b.getAttribute("value") ?? b.value ?? "";
  if (a.nodeName === "INPUT" && a.checked !== b.hasAttribute("checked")) a.checked = b.hasAttribute("checked");
  if (a.nodeName === "TEXTAREA" || a.nodeName === "svg" && a.isEqualNode(b)) return;
  const ac = [...a.childNodes], bc = [...b.childNodes];
  for (let i = 0; i < bc.length; i++) { if (ac[i]) morph(ac[i], bc[i]); else a.appendChild(bc[i].cloneNode(true)); }
  for (let i = ac.length - 1; i >= bc.length; i--) ac[i].remove();
}
/** Like renderPanel, but patches the open screen in place instead of rebuilding it (used while typing). */
function patchPanel() {
  const el = $("#panel"), pane = el.querySelector(".pane"), P = S.panel;
  if (!P || !pane || S.holdPanel) return renderPanel();
  const views = { send: sendView, protect: moveView, withdraw: moveView, swap: swapView, bridge: bridgeView, payreq: payreqView, earn: earnView };
  const view = views[P.p]; if (!view) return renderPanel();
  const tmp = document.createElement("div"); tmp.innerHTML = view(); translate(tmp, S.lang);
  const next = pane.cloneNode(false); next.append(...tmp.childNodes); morph(pane, next);
  bindHolds(el); depth(el); queueMicrotask(syncTabbar);
}
function renderPanel(enter = false) {
  if (S.holdPanel && !enter) { S.panelDirty = true; return; } // a moment is playing on this page: redraw right after it
  queueMicrotask(syncTabbar);
  const el = $("#panel"), P = S.panel;
  if (!P) return;
  const body = ({ nets: netsView, send: sendView, receive: receiveView, protect: moveView, withdraw: moveView, vault: vaultView, assets: assetsView, settings: settingsView, reveal: revealView, numbers: numbersView, backup: backupView, pick: pickView, tok: tokenView, rules: rulesView, all: allView, buy: buyView, currency: currencyView, news: newsView, report: reportHTML, txd: txdView, contacts: contactsView, pkey: pkeyView, perms: permsView, safety: safetyView, xtok: xtokView, nft: xtokView, addTok: addTokView, addrs: addrsView, accts: acctsView, acctNew: acctNewView, sites: sitesView, swap: swapView, bridge: bridgeView, earn: earnView, wc: wcView, payreq: payreqView, alerts: alertsView, bug: bugView, help: helpView, kept: keptView })[P.p]();
  if (enter || P.fresh) P.openedAt = performance.now();
  const since = P.openedAt ? performance.now() - P.openedAt : 9999;
  // A coin's page grows out of the row you tapped (the home screen stays where it is); other pages slide in.
  if (enter) { P.grow = S.grow || null; S.grow = null; }
  const grow = P.grow && performance.now() - (P.openedAt || 0) < 700 ? P.grow : null;
  el.innerHTML = `<div class="pane${enter || P.fresh ? " fresh" : ""}${since < 2300 ? " trace" : ""}${grow ? " grow" : ""}" style="--tt:${-Math.round(since)}ms${grow ? `;--gx:${Math.round(grow.x)}px;--gy:${Math.round(grow.y)}px` : ""}">${body}</div>`; translate(el, S.lang);
  if (enter) document.body.classList.toggle("grow-open", !!grow);
  P.fresh = false;
  if (enter) requestAnimationFrame(() => { el.classList.add("in"); document.body.classList.add("stacked"); });
  bindHolds(el); depth(el); mountVault3d(el); bindTokChart(el);
  // the top bar turns frosted once the page scrolls under it
  const pane = el.querySelector(".pane"); if (pane) { const sync = () => pane.classList.toggle("scrolled", pane.scrollTop > 6); pane.addEventListener("scroll", sync, { passive: true }); sync(); }
  const f = el.querySelector("[autofocus]"); if (f && enter) setTimeout(() => f.focus(), 200);
  // A new step (form → review → sending → done) starts at the top, like a new screen: never half-scrolled, and the
  // phone's own page shift (left by the keyboard) is undone.
  const key = `${P.p}:${P.step}:${P.whoDone ? 1 : 0}:${P.mode || ""}:${P.pick || ""}`;
  if (key !== S.panelKey) { S.panelKey = key; if (pane) pane.scrollTop = 0; if (globalThis.ECRIN_WEB && !el.contains(document.activeElement)) window.scrollTo(0, 0); }
}
// iPhone: the keyboard pushes the whole page up and doesn't always bring it back. When no field has focus any more,
// put the page back where it belongs.
if (globalThis.ECRIN_WEB) document.addEventListener("focusout", () => setTimeout(() => { const a = document.activeElement; if (!a || a === document.body || !/^(INPUT|TEXTAREA)$/.test(a.tagName)) window.scrollTo(0, 0); }, 120));

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
    <div class="amt-in"><input data-amount inputmode="decimal" placeholder="0" value="${esc(P.amount)}" autocomplete="off" autofocus style="width:${Math.max(1, [...String(P.amount || "")].reduce((t, c) => t + (/[.,]/.test(c) ? .45 : 1), 0)) + .12}ch"/><span>${A(a).unit}</span></div>
    <div class="amt-usd">${u != null && units ? money(u) : "&nbsp;"}</div>
    <div class="pcts">${[25, 50, 100].map((p) => `<button data-act="pct" data-v="${p}" class="${P.pct === p ? "on" : ""}">${p === 100 ? "Max" : p + "%"}</button>`).join("")}</div>
    <div class="avail">${label}: <b>${amt(Math.max(0, max), a)} ${A(a).unit}</b>${usdOf(Math.max(0, max), a) != null && !A(a).stable ? ` <span class="avail-usd">≈ ${money(usdOf(Math.max(0, max), a))}</span>` : ""}${over ? ` <span class="bad">· not enough</span>` : ""}</div>
  </div>`;
}

function sendMax() { const a = S.panel.asset; return a === "native" ? Math.max(0, (S.bal?.native || 0) - (S.panel.reserve || 0)) : S.bal?.usdc || 0; }

function sendView() {
  const P = S.panel, e = ENG, a = P.asset, units = parseAmt(P.amount, a);
  if (P.whoDone === undefined) P.whoDone = !!P.to; // opened with a recipient (contact, payment link): straight to the amount
  if (P.step === "done" || P.step === "sending") {
    const to = P.to.trim(), nm = bookName(to), usd = usdOf(P.sent, a);
    return motionView(P, { kind: "send", N: NETS[S.net], title: ["Sending", "Sent"], amount: `${amt(P.sent, a)} ${A(a).unit}`, usd: usd != null ? money(usd) : "", line: `to ${nm ? `<b>${esc(nm)}</b>` : `<span class="mono">${esc(short(to))}</span>`}`,
      rows: [["To", `<span class="mono wrap">${esc(to)}</span>`], ["From", `${esc(curAcct().name)} · <span class="mono">${esc(short(e?.address))}</span>`], ["Network fee", esc(e?.feeText?.() || "")]],
      extra: nm ? "" : `<div class="book-save"><input data-bookname placeholder="Name this address (optional)" maxlength="24" autocomplete="off"/><button class="btn sm" data-act="book-save">Save</button></div>` });
  }
  if (P.step === "review") {
    const self = P.to.trim() === e.address;
    return `${phead("Review")}
      <div class="rev rev-card"><i class="sheet-h" aria-hidden="true"></i>
        <div class="rev-amt">${assetCoin(a, "lg")}<b>${fig(amt(units, a))}</b><span>${A(a).unit}</span><small>${usdOf(units, a) != null ? money(usdOf(units, a)) : ""}</small></div>
        <dl class="rev-l">
          <div><dt>From</dt><dd>Wallet · ${short(e.address)}</dd></div>
          <div><dt>To</dt><dd class="mono">${P.toName ? `<b class="to-name">${esc(P.toName)}</b>` : ""}${esc(P.to.trim())}</dd></div>
          <div><dt>Network</dt><dd>${NETS[S.net].name} ${NETS[S.net].net}</dd></div>
          <div><dt>Network fee</dt><dd>${NETS[S.net].fam === "evm" ? `<span class="seg fee-seg">${[["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]].map(([k, l]) => `<button data-act="speed" data-v="${k}" aria-pressed="${(P.speed || "normal") === k}">${l}</button>`).join("")}</span>` : e.feeText()}</dd></div>
        </dl>
        ${self ? `<p class="warn-n">That's your own address.</p>` : P.lookalike ? lookalikeNote(P) : P.fresh ? `<p class="warn-n">${I.shield}<span>You've never sent to this address from Ecrin. Check the first and last characters against where you copied it.</span></p>` : ""}
      </div>
      ${P.coolUntil > Date.now() ? `<div class="cool"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/><circle class="cl-p" cx="20" cy="20" r="17" style="stroke-dashoffset:${(106.8 * (P.coolUntil - Date.now())) / (S.guard.cool * 1000)}"/></svg><span><b data-cool>${Math.ceil((P.coolUntil - Date.now()) / 1000)}s</b><small>Cooling-off pause for big sends. Take a breath: is this really who you think it is?</small></span></div>` : ""}
      <div class="pfoot snd-foot"><button class="btn xl" data-act="close">Cancel</button>${P.coolUntil > Date.now() ? `<button class="btn primary xl" disabled>${I.clock}Wait for the pause</button>` : `<button class="btn primary xl" data-act="send-confirm">Confirm</button>`}</div>`;
  }
  const nm = P.named && P.named.name === P.to.trim() ? P.named : null, nmOk = !!(nm?.addr && e.isAddress(nm.addr));
  // 1. Who: an address, a name, a contact or someone you sent to before (like MetaMask's "Send to").
  if (!P.whoDone) {
    const to = nmOk ? nm.addr : P.to.trim(), ok = !!to && e.isAddress(to), mine = String(e.address);
    const recent = [...new Set((S.activity || []).filter((x) => (x.t === "send" || x.t === "tsend") && x.to && x.to !== mine && e.isAddress(x.to)).map((x) => x.to))].slice(0, 4);
    const person = (addr, name, sub) => `<button class="arow who-r" data-act="send-to" data-a="${esc(addr)}"><span class="acct-ic gen">${logoSVG("facets", `${addr}:0`)}</span><span class="ar-t"><b>${name ? esc(name) : `<span class="mono">${esc(short(addr))}</span>`}</b><small>${sub}</small></span>${I.arrow}</button>`;
    return `${phead("Send")}
      <label class="fld to who-in"><span>To</span><div class="in-btn"><input data-to placeholder="${addrHint(NETS[S.net])}" value="${esc(P.to)}" spellcheck="false" autocomplete="off" autofocus/><button type="button" class="ib sm" data-act="paste" aria-label="Paste">${I.paste}</button>${globalThis.ECRIN_WEB ? `<button type="button" class="ib sm" data-act="scan" aria-label="Scan a QR code">${I.qr || I.recv}</button>` : ""}</div></label>
      ${nm ? (nm.addr && !nmOk ? `<p class="err">${esc(nm.name)} is ${nm.fam === "sol" ? "a Solana" : "an Ethereum"} address. Switch to that network to send to it.</p>` : namedLine()) : P.to && !ok ? `<p class="err">${otherAddr(P.to.trim()) || `That isn't ${NETS[S.net].fam === "sol" ? "a Solana" : NETS[S.net].fam === "evm" ? "an Ethereum-style" : `a ${NETS[S.net].name}`} address.`}</p>` : ""}
      ${ok ? `<section class="list">${person(to, bookName(to) || (nmOk ? nm.name : ""), `${short(to)} · ${NETS[S.net].name}`)}</section>` : ""}
      ${!ok && bookList().length ? `<p class="who-h">Contacts</p><section class="list">${bookList().map(([ad, n]) => person(ad, n, `${short(ad)}`)).join("")}</section>` : ""}
      ${!ok && recent.length ? `<p class="who-h">Recent</p><section class="list">${recent.map((ad) => person(ad, bookName(ad), short(ad))).join("")}</section>` : ""}
      ${!ok && !bookList().length && !recent.length ? `<p class="who-empty">Paste an address${NETS[S.net].fam === "evm" || NETS[S.net].fam === "sol" ? " or a name (like alice.eth or alice.sol)" : ""}. Check the first and last characters before you send.</p>` : ""}`;
  }
  // 2. How much: the recipient stays on top (tap to change), the amount is the screen.
  const valid = units > 0 && units <= sendMax() && e.isAddress(P.to.trim());
  const bn = bookName(P.to.trim()) || P.toName || "";
  return `${phead("Send")}
    ${P.payLabel ? `<p class="pay-for">${I.recv}<span>Payment request: <b>${esc(P.payLabel)}</b></span></p>` : ""}
    <button class="who-chip" data-act="send-who"><span class="who-k">To</span><span class="acct-ic gen">${logoSVG("facets", `${P.to.trim()}:0`)}</span><span class="who-t"><b>${bn ? esc(bn) : `<span class="mono">${esc(short(P.to.trim()))}</span>`}</b>${bn ? `<small class="mono">${esc(short(P.to.trim()))}</small>` : ""}</span><span class="who-x">Change</span></button>
    ${fromRow()}
    ${amountBlock(sendMax(), "Wallet")}
    ${feeNote(a)}
    <div class="pfoot"><button class="btn primary xl" data-act="review" ${valid ? "" : "disabled"}>Continue</button></div>`;
}

// ------------------------------------------------------------------ guard rails on the Wallet side (this device)

const todayKey = () => new Date().toISOString().slice(0, 10);
/** Daily spending limit across every network, in dollars. Raising it waits 24 hours; lowering is instant. */
async function limitCheck(usd) {
  const G = S.guard; if (!G.daily || usd == null) return null;
  const { spent = {} } = await local.get("spent"), used = spent[todayKey()] || 0;
  if (used + usd > G.daily) { bump("limit"); return `That's over your daily spending limit (${money(G.daily)}, ${money(Math.max(0, G.daily - used))} left today). Change it in Settings → Safety.`; }
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
    { ok: !!(G.daily || G.cool), pts: 10, t: "Spending limit or cooling-off on", tip: "Add a spending limit", act: "go-limit" },
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
    <div class="list-h" data-sec="limit"><b>Daily spending limit</b><span>${G.daily ? money(G.daily) : "None"}</span></div>
    <p class="fine">Sends from your Wallet stop at this amount per day, on every network. Lowering it is instant; raising it waits 24 hours, so a scammer rushing you can't lift it.${G.pend ? ` <b>Changing to ${G.pend.v ? money(G.pend.v) : "no limit"} on ${new Date(G.pend.at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}.</b>` : ""}</p>
    <span class="seg wide">${lim.map((v) => `<button data-act="guard" data-k="daily" data-v="${v}" aria-pressed="${G.daily === v}">${v ? money(v, { maximumFractionDigits: 0, notation: v >= 1000 ? "compact" : "standard" }) : "None"}</button>`).join("")}</span>
    <div class="list-h"><b>Cooling-off pause</b><span>${G.cool ? `over ${money(G.coolOver)}` : "Off"}</span></div>
    <p class="fine">A short wait before any send over ${money(G.coolOver)}. Scams work by rushing you; the pause gives you time to notice.</p>
    <span class="seg wide">${cool.map(([v, l]) => `<button data-act="guard" data-k="cool" data-v="${v}" aria-pressed="${G.cool === v}">${l}</button>`).join("")}</span>
    <div class="list-h"><b>Late-night pause</b><span>${G.late ? "On" : "Off"}</span></div>
    <p class="fine">Between midnight and 6 AM, starting a withdrawal from your Safe first asks if you'd rather sleep on it. You can always continue.</p>
    <span class="seg wide">${[[1, "On"], [0, "Off"]].map(([v, l]) => `<button data-act="guard" data-k="late" data-v="${v}" aria-pressed="${G.late === v}">${l}</button>`).join("")}</span>
    <div class="list-h"><b>Betting-site warning</b><span>${G.bet ? "On" : "Off"}</span></div>
    <p class="fine">When a casino or betting site asks to connect, Ecrin suggests waiting 10 minutes first. You can always connect anyway.</p>
    <span class="seg wide">${[[1, "On"], [0, "Off"]].map(([v, l]) => `<button data-act="guard" data-k="bet" data-v="${v}" aria-pressed="${G.bet === v}">${l}</button>`).join("")}</span>
    <p class="fine pad">The limit and the pause protect this device. Your Safe's own rules protect your money even from someone who has your recovery phrase.</p>`;
}

/** Copied: the button's copy icon turns into a check for a moment. False when the button has no icon to swap. */
function copied(el) {
  const ic = el?.querySelector("svg"); if (!ic) return false;
  haptic("light"); clearTimeout(el._ct); if (!el._ic) el._ic = ic.outerHTML;
  ic.outerHTML = I.check.replace("<svg", '<svg class="cp-ok"'); el.classList.add("copied");
  const lab = el.querySelector("[data-cl]"); if (lab) { lab._t ??= lab.textContent; lab.textContent = trText("Copied", S.lang); }
  el._ct = setTimeout(() => { const now = el.querySelector("svg"); if (now && el._ic) now.outerHTML = el._ic; el._ic = null; el.classList.remove("copied"); if (lab?._t) lab.textContent = lab._t; }, 1400);
  return true;
}
function hold(label, busy) {
  return `<button class="hold ${busy ? "busy" : ""}" data-hold ${busy ? "disabled" : ""}><span class="hold-fill"></span><span class="hold-t">${busy ? `<i class="spin"></i>` : I.shield}${label}</span></button>`;
}

// Every confirmation in Ecrin: the diamond draws itself, fills with Ecrin blue, a check is drawn inside, and a ring
// pulses out once.
const dcheck = (cls = "") => `<svg class="dck ${cls}" viewBox="0 0 120 120" aria-hidden="true"><g transform="rotate(45 60 60)">
  <rect class="p" x="26" y="26" width="68" height="68" rx="20"/><rect class="o" x="26" y="26" width="68" height="68" rx="20" pathLength="100"/>
  <rect class="f" x="34" y="34" width="52" height="52" rx="15"/></g><path class="t" pathLength="100" d="M47 61 L56 70 L74 51"/></svg>`;
// ------------------------------------------------------------------ money in motion
// Every send, protect, withdrawal and swap shows its journey live: signed on this device, sent to the network (with
// its explorer link the moment it exists), confirmed (and how long it took), then a receipt. The Safe's diamond
// carries it: light runs while it travels and the diamond closes with a check when it lands.
const STEPS = (N, last = "Confirmed") => [{ k: "sign", run: "Signing on this device", ok: "Signed on this device" }, { k: "sent", run: `Sending to ${N.name}`, ok: `Sent to ${N.name}` }, { k: "conf", run: "Waiting for confirmation", ok: last }];
function motionStart(P, steps, auto = true) {
  P.mo = { steps, at: 0, t0: performance.now(), t1: 0 };
  if (auto) setTimeout(() => { if (P.mo?.at === 0 && P.step === "sending") { P.mo.at = 1; if (S.panel === P) patchPanel(); } }, 280); // signing is instant: on this device
  txEvents.sent = (id) => { if (!P.mo || P.step !== "sending") return; P.sig = P.sig || id; const i = P.mo.steps.findIndex((x) => x.k === "sent"); if (i >= 0 && P.mo.at <= i) P.mo.at = i + 1; if (S.panel === P) patchPanel(); };
}
function motionStep(P, k) { const i = P.mo?.steps.findIndex((x) => x.k === k); if (i >= 0 && P.mo.at < i) { P.mo.at = i; if (S.panel === P) patchPanel(); } }
function motionEnd(P) { if (P.mo) { P.mo.at = P.mo.steps.length; P.mo.t1 = performance.now(); } txEvents.sent = null; }
const MO_IC = { send: I.send, protect: I.protect, withdraw: I.clock, swap: I.swap, keep: I.shield, stake: I.spark };
function keptView() {
  const P = S.panel, N = NETS[P.k], u = P.a === "usdc" ? "USDC" : N.unit, usd = usdOf(P.amount, P.a);
  return motionView(P, { kind: "keep", N, title: ["Cancelling", "Withdrawal cancelled"], amount: `${amt(P.amount, P.a)} ${u}`, usd: usd != null ? money(usd) : "",
    line: "Stays in your Safe", note: "Nothing left your Safe. To move it out again, a new withdrawal waits the full delay.",
    rows: P.dest ? [["Was going to", `<span class="mono">${esc(short(P.dest))}</span>`]] : [] });
}
/** o: { kind, N, title: [while, done], amount, usd, line, rows: [[label, value]], note, extra } */
function motionView(P, o) {
  const m = P.mo || { steps: STEPS(o.N), at: P.step === "done" ? 9 : 1, t0: 0, t1: 0 }, done = P.step === "done";
  const link = P.sig && !/^demo/.test(P.sig) ? o.N.explorer("tx", P.sig) : null, took = done && m.t1 && m.t0 ? ((m.t1 - m.t0) / 1000).toFixed(1) : null;
  const R = (c, x, r) => `<rect class="${c}" x="${x}" y="${x}" width="${220 - 2 * x}" height="${220 - 2 * x}" rx="${r}" pathLength="100"/>`;
  const steps = m.steps.map((x, i) => { const st = done || i < m.at ? "ok" : i === m.at ? "now" : "";
    return `<li class="${st}"><i class="mo-dot">${st === "ok" ? `<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4L18 8"/></svg>` : st === "now" ? `<i class="spin"></i>` : ""}</i><span>${st === "ok" ? x.ok : x.run}${x.k === "sent" && link && st === "ok" ? ` <a class="mo-ln" href="${link}" target="_blank">View ${I.ext}</a>` : ""}</span>${x.k === "conf" && took ? `<small>in ${took} s</small>` : ""}</li>`; }).join("");
  const when = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const rows = done ? [...(o.rows || []), ["Network", `${o.N.name} ${o.N.net}`], ["Time", when], ...(P.sig && !/^demo/.test(P.sig) ? [["Transaction", `<span class="mono">${esc(short(P.sig))}</span> <button class="ib sm" data-act="copy" data-v="${esc(P.sig)}" aria-label="Copy transaction id">${I.copy}</button>`]] : [])] : [];
  return `<div class="mo lk2 ${done ? "ok" : "run"}">
    ${done ? "" : `<button class="ib mo-x" data-act="close" aria-label="Close (it keeps going)">${I.x}</button>`}
    <div class="aura" aria-hidden="true" style="${auraT()}"><i class="a1"></i><i class="a2"></i><i class="a3"></i></div>
    <div class="lk-hero mo-hero" aria-hidden="true"><svg class="lk-lz" viewBox="0 0 220 220"><defs><linearGradient id="lkg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b6c4ff"/><stop offset=".5" stop-color="#4b74ff"/><stop offset="1" stop-color="#00c8ff"/></linearGradient></defs>
      <g transform="rotate(45 110 110)">${R("lk-base", 38, 30)}${R("lk-in", 51, 24)}${R("lk-run", 38, 30)}${R("lk-run2", 51, 24)}${R("lk-full", 38, 30)}</g></svg>
      <span class="lk-ic"><span class="lk-l">${MO_IC[o.kind] || I.send}</span><svg class="lk-ok" viewBox="0 0 24 24"><path d="M6 12.5l4 4L18 8"/></svg></span></div>
    <p class="mo-k">${done ? o.title[1] : o.title[0]}</p>
    <div class="mo-amt"><b>${o.amount}</b>${o.usd ? `<small>${o.usd}</small>` : ""}</div>
    ${o.line ? `<p class="mo-line">${o.line}</p>` : ""}
    <ol class="mo-steps">${steps}</ol>
    ${done && o.note ? `<div class="mo-note">${I.shield}<span>${o.note}</span></div>` : ""}
    ${done ? `<div class="mo-rc">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>${o.extra || ""}` : ""}
    <div class="pfoot${done ? "" : " mo-foot-wait"}">${done ? `<button class="btn primary xl" data-act="close">Done</button>` : `<p class="mo-wait">You can close this. It keeps going, and Activity shows when it lands.</p>`}</div>
  </div>`;
}
function doneView(title, text, extra = "") {
  const mark = `<div class="done-dck">${dcheck()}</div>`;
  if (mark) return `<div class="done">${mark}<h2>${title}</h2><p>${text}</p>
    ${S.panel.sig && NETS[S.net].explorer("tx", S.panel.sig) ? `<a class="link" href="${NETS[S.net].explorer("tx", S.panel.sig)}" target="_blank">View on the explorer ${I.ext}</a>` : ""}${extra}
    <div class="pfoot"><button class="btn primary xl" data-act="close">Done</button></div></div>`;
  return `<div class="done">${mark}<h2>${title}</h2><p>${text}</p>
    ${S.panel.sig && NETS[S.net].explorer("tx", S.panel.sig) ? `<a class="link" href="${NETS[S.net].explorer("tx", S.panel.sig)}" target="_blank">View on the explorer ${I.ext}</a>` : ""}${extra}
    <div class="pfoot"><button class="btn primary xl" data-act="close">Done</button></div></div>`;
}

/** Every address this account has, network by network, like MetaMask's account view. */
function addrsView() {
  const sol = ACCT.sol?.publicKey.toBase58(), evm = ACCT.evm?.address, tron = ACCT.tron && !ACCT.only ? toTron(ACCT.tron.address) : null, sui = !ACCT.only ? suiOf(ACCT) : null, A0 = curAcct();
  // The full address in one piece; the first and last four characters stand out, since those are what people check.
  const groups = (a) => `<b>${esc(a.slice(0, 4))}</b>${esc(a.slice(4, -4))}<b>${esc(a.slice(-4))}</b>`;
  const card = (k, a, title, note, nets) => `<article class="ad-card">
      <header class="ad-h">${coin(k)}<span><b>${title}</b><small>${note}</small></span><button class="ib sm" data-act="qr-for" data-n="${k}" aria-label="Show QR code">${I.qr}</button></header>
      <div class="ad-a mono" data-notr>${groups(a)}</div>
      ${nets ? `<div class="ad-nets">${nets.map((n) => `<span title="${esc(NETS[n].name)}">${coin(n)}<small>${esc(NETS[n].name)}</small></span>`).join("")}</div>` : ""}
      <button class="ad-copy" data-act="copy" data-v="${esc(a)}">${I.copy}<span>Copy address</span></button>
    </article>`;
  const evmNets = netKeys().filter((k) => NETS[k].fam === "evm");
  return `${phead("Addresses")}
    <div class="ad-hero">${acctIc(A0, "lg")}<span><b>${esc(A0.name)}</b><small>${A0.kind === "key" ? "Imported private key" : "From your recovery phrase"}</small></span></div>
    <div class="ad-list">
      ${sol ? card("sol", sol, "Solana", "SOL, USDC and Solana tokens") : ""}
      ${evm ? card("eth", evm, "Ethereum-style networks", `One address for all ${evmNets.length}`, evmNets) : ""}
      ${tron ? card("tron", tron, "Tron", "TRX and USDT") : ""}
      ${sui ? card("sui", sui, "Sui", "SUI and USDC") : ""}
    </div>
    <p class="fine pad">Only send coins to the matching network. Coins sent to the right address on the wrong network may be lost.</p>`;
}

/** A round account mark in the account's colour, with its first letter. */
// Account logos: drawn from the account's own address, so every account has one nobody else has (like MetaMask's),
// in Ecrin's shapes: Facets (a cut gem), Pixels (a mirrored 5×5 mark), Rings (the Safe's rounded rings). Or a letter.
const LOGO_STYLES = [["facets", "Facets"], ["pixels", "Pixels"], ["rings", "Rings"], ["letter", "Letter"]];
const addrMemo = {};
const acctSeedAddr = (a) => { if (addrMemo[a.id]) return addrMemo[a.id]; let x = null; try { x = acctAddr(a); } catch (_) {}
  if (!x) return S.lockInfo?.addrCache?.[a.id] || a.id; // locked: the public address remembered from last time
  if (S.lockInfo?.addrCache?.[a.id] !== x) { const c = { ...(S.lockInfo?.addrCache || {}), [a.id]: x }; S.lockInfo = { ...(S.lockInfo || {}), addrCache: c }; local.set({ addrCache: c }); }
  return (addrMemo[a.id] = x); };
function logoRng(str) {
  let h = 2166136261; for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { h = (h + 0x6d2b79f5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function logoSVG(style, seed) {
  const r = logoRng(`${style}:${seed}`), id = "lg" + Math.floor(r() * 1e9).toString(36);
  const h1 = Math.floor(r() * 360), h2 = (h1 + 40 + Math.floor(r() * 90)) % 360, h3 = (h1 + 150 + Math.floor(r() * 80)) % 360;
  const c = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;
  if (style === "pixels") {
    let cells = ""; for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) { const v = r(); if (v < 0.45) continue; const col = v > 0.86 ? c(h3, 85, 66) : c(h1, 80, 62);
      for (const xx of x === 2 ? [2] : [x, 4 - x]) cells += `<rect x="${5 + xx * 6.2}" y="${5 + y * 6.2}" width="5.4" height="5.4" rx="1.4" fill="${col}"/>`; }
    return `<svg viewBox="0 0 41 41" aria-hidden="true"><rect width="41" height="41" fill="${c(h2, 45, 16)}"/>${cells}</svg>`;
  }
  if (style === "rings") {
    const ring = (i) => { const inset = 5 + i * 6, w = 41 - inset * 2, len = 35 + Math.floor(r() * 50), off = Math.floor(r() * 100);
      return `<rect x="${inset}" y="${inset}" width="${w}" height="${w}" rx="${Math.max(3, 10 - i * 2.5)}" pathLength="100" fill="none" stroke="${[c(h1, 85, 64), c(h2, 85, 62), c(h3, 80, 66)][i]}" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="${len} ${100 - len}" stroke-dashoffset="${off}"/>`; };
    return `<svg viewBox="0 0 41 41" aria-hidden="true"><rect width="41" height="41" fill="${c(h1, 40, 14)}"/>${ring(0)}${ring(1)}${ring(2)}<rect x="18" y="18" width="5" height="5" rx="1.2" transform="rotate(45 20.5 20.5)" fill="${c(h2, 90, 72)}"/></svg>`;
  }
  // facets: a cut stone on a two-tone ground; the cut moves a little with each address
  const ang = Math.floor(r() * 360), cx = 20.5 + (r() - 0.5) * 4, cy = 20.5 + (r() - 0.5) * 4, R = 11 + r() * 3;
  const T = [cx, cy - R], Rt = [cx + R, cy], B = [cx, cy + R], L = [cx - R, cy], M = [cx + (r() - 0.5) * 5, cy + (r() - 0.5) * 5];
  const tri = (a, b, l) => `<path d="M${a.join(" ")}L${b.join(" ")}L${M.join(" ")}Z" fill="${c(h3, 80, l)}"/>`;
  return `<svg viewBox="0 0 41 41" aria-hidden="true"><defs><linearGradient id="${id}" gradientTransform="rotate(${ang} .5 .5)"><stop offset="0" stop-color="${c(h1, 75, 52)}"/><stop offset="1" stop-color="${c(h2, 70, 30)}"/></linearGradient></defs>
    <rect width="41" height="41" fill="url(#${id})"/>${tri(L, T, 82)}${tri(T, Rt, 68)}${tri(Rt, B, 50)}${tri(B, L, 60)}</svg>`;
}
function acctIc(a, cls = "", over) {
  const lg = { s: "facets", v: 0, ...(a?.logo || {}), ...(over || {}) };
  if (lg.s === "letter") {
    const col = COLORS[(lg.c ?? a?.c ?? 0) % COLORS.length], letter = esc((a?.name || "A").trim().charAt(0).toUpperCase());
    return `<span class="acct-ic av ${cls}" style="--ac:${col}">${letter}</span>`;
  }
  return `<span class="acct-ic gen ${cls}">${logoSVG(lg.s, `${a ? acctSeedAddr(a) : "x"}:${lg.v || 0}`)}</span>`;
}
const acctAddr = (a) => a.kind === "key" ? a.pub : a.id === S.sel ? (ACCT.sol?.publicKey.toBase58() || ACCT.evm?.address) : deriveAccount(PHRASE, { web3, ethers }, a.i).sol.publicKey.toBase58();

/** Every account in this wallet. Tap one to switch; add another from the phrase, or import a private key. */
function acctsView() {
  const P = S.panel, list = S.accts || DEF_ACCTS;
  return `${phead("Accounts")}
    <section class="list accts-l">${list.map((a) => `<div class="arow acc-row${a.id === S.sel ? " on" : ""}">
      <button class="acc-main" data-act="acct-switch" data-id="${a.id}">${acctIc(a)}<span class="ar-t"><b>${esc(a.name)}</b><small class="mono">${short(acctAddr(a))}${a.kind === "key" ? ` · <span class="tagk">${a.fam === "sol" ? "Solana key" : "Ethereum key"}</span>` : ""}</small></span>${a.id === S.sel ? `<span class="acc-ok">${I.check}</span>` : ""}</button>
      <button class="ib sm" data-act="acct-edit" data-id="${a.id}" aria-label="Rename ${esc(a.name)}">${I.pen}</button></div>
      ${P.edit === a.id ? `<div class="acc-edit"><input data-acct-name value="${esc(a.name)}" maxlength="24" aria-label="Account name"/><button class="btn sm primary" data-act="acct-save" data-id="${a.id}">Save</button>${logoPick(a)}
        ${a.id !== "hd0" ? `<button class="btn sm ghost danger" data-act="acct-remove" data-id="${a.id}">${a.kind === "key" ? "Remove" : "Hide"}</button>` : ""}</div>` : ""}`).join("")}</section>
    <div class="acc-acts">
      <button class="btn" data-act="acct-add">${I.plus}Add account</button>
      <button class="btn" data-act="panel" data-p="acctNew">${I.key}Import key</button>
    </div>
    <button class="srow" data-act="panel" data-p="addrs"><span>${I.qr}Addresses of ${esc(curAcct().name)}</span><span class="sv">${I.arrow}</span></button>
    <p class="fine pad">Accounts you add come from your recovery phrase, so your backup covers them. Imported keys are not in your recovery phrase: keep their own backup.</p>`;
}

function logoPick(a) {
  const cur = { s: "facets", v: 0, ...(a.logo || {}) };
  return `<div class="lp"><span class="lp-h">Logo</span><div class="lp-row">${LOGO_STYLES.map(([st, n]) => `<button class="lp-o${cur.s === st ? " on" : ""}" data-act="acct-logo" data-id="${a.id}" data-s="${st}" aria-label="${n}" aria-pressed="${cur.s === st}">${acctIc(a, "", { s: st, v: cur.v })}<small>${n}</small></button>`).join("")}</div>
    ${cur.s === "letter" ? `<div class="lp-cols">${COLORS.map((col, i) => `<button class="lp-c${(cur.c ?? a.c ?? 0) % COLORS.length === i ? " on" : ""}" style="--ac:${col}" data-act="acct-logo" data-id="${a.id}" data-s="letter" data-c="${i}" aria-label="Colour ${i + 1}"></button>`).join("")}</div>`
      : `<button class="btn sm ghost lp-new" data-act="acct-logo" data-id="${a.id}" data-s="${cur.s}" data-v="${(cur.v || 0) + 1}">${I.swap || ""}Another one</button>`}</div>`;
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
  const e = ENG, N = NETS[S.net], ad = String(e.address);
  const q = qrcode(0, "H"); q.addData(ad); q.make(); // high error correction: the logo in the middle can't break it
  // Like MetaMask and Exodus: one card with the QR, who and which network, the address with its start and end in bold
  // (the parts people check), then Copy and Share.
  const cut = ad.length > 16 ? 6 : 0, addrHTML = cut ? `<b>${esc(ad.slice(0, cut))}</b>${esc(ad.slice(cut, -cut))}<b>${esc(ad.slice(-cut))}</b>` : esc(ad);
  const m = S.panel?.asset === "usdc" ? "usdc" : N.unit === "ETH" ? "eth" : S.net;
  return `${phead("Receive")}${fromRow()}
    <div class="rc">
      <div class="rc-who">${acctIc(curAcct(), "sm")}<b>${esc(curAcct().name)}</b><span class="rc-net">${coin(S.net)}${esc(nname(N))}</span></div>
      <div class="qr rc-qr">${q.createSvgTag({ cellSize: 5, margin: 0, scalable: true })}<span class="qr-c">${coin(m) + (m !== S.net ? `<span class="qr-b">${coin(S.net)}</span>` : "")}</span></div>
      <p class="rc-addr mono" data-notr>${addrHTML}</p>
      <div class="rc-acts"><button class="btn primary rc-copy" data-act="copy-addr">${I.copy}<span data-cl>Copy address</span></button>${navigator.share ? `<button class="btn rc-share" data-act="share-addr">${I.send}<span>Share</span></button>` : ""}</div>
    </div>
    <p class="rc-fine">Only send ${N.name} ${N.net} coins${N.usdc ? " or USDC" : ""} to this address. ${N.fam === "tron" ? (N.real ? "Tron addresses start with T. USDT shows with your tokens." : "Tron addresses start with T. Test USDT on Nile shows with your tokens.") : ""}${N.fam === "sui" ? "Sui addresses are 0x and 64 characters, different from your Ethereum one. " : ""}${N.fam === "evm" ? "The same address works on every Ethereum-style network." : ""}</p>
    <section class="list rc-more">
      <button class="arow" data-act="payreq"><span class="rc-ic">${I.recv}</span><span class="ar-t"><b>Request an amount</b><small>A link or QR with the amount filled in</small></span>${I.arrow}</button>
      <button class="arow" data-act="panel" data-p="buy"><span class="rc-ic">${I.card}</span><span class="ar-t"><b>Buy with a card</b><small>Through MoonPay, straight to this address</small></span>${I.arrow}</button>
    </section>
    ${faucetBtn(N) ? `<div class="rc-fau">${faucetBtn(N)}</div>` : ""}`;
}

/** Protect (chequing → savings) and Withdraw (savings → chequing, after the delay). */
/** Mainnet before the audit: the Safe isn't there yet. Says so plainly and offers Testnet to try it. */
function safeSoonView(title) {
  const early = isMain() && Object.values(NETS).some((N) => N.real && N.contract); // the early-access Safe, one tap away
  return `${phead(title)}<div class="cv"><div class="cv-art">${I.lock}</div><h2>${early ? "The Safe is in early access" : "The Safe comes to mainnet after its audit"}</h2>
    <p class="sub">${early ? "Your Safe already works on Base, with USDC and ETH." : "Your Wallet works on mainnet today: send, receive and swap. The Safe, which makes every withdrawal wait, opens on mainnet once an independent security audit is done."}</p>
    ${early ? `<div class="note early-n">${I.lock}<span><b>Not audited yet.</b> Only use amounts you could lose. The other networks get the Safe after Ecrin's independent security audit.</span></div>` : `<div class="note">${I.shield}<span>Want to try it now? It runs on Testnet with free test coins, exactly as it will on mainnet.</span></div>`}</div>
    <div class="pfoot">${early ? `<button class="btn primary xl" data-act="early-on">Use the Safe on Base</button><button class="btn ghost" data-act="net-mode" data-v="test">Try it on Testnet instead</button>` : `<button class="btn xl" data-act="net-mode" data-v="test">Try the Safe on Testnet</button>`}</div>`;
}
const noSafeHere = () => !netKeys().some(canSafe);
function moveView() {
  if (noSafeHere()) return safeSoonView(S.panel.p === "protect" ? "Protect" : "Withdraw");
  const P = S.panel, e = ENG, a = P.asset, isIn = P.p === "protect", v = S.vault;
  // First Safe ever: open it. Already have one elsewhere: protect straight away, it opens here as part of the deposit.
  if (!v && (!isIn || !anySafe())) return createVaultView(isIn ? "Protect" : "Withdraw");
  const vv = v || { main: openRows()[0].v.main, usdc: null };
  const units = parseAmt(P.amount, a), main = vv.main, tv = a === "usdc" ? vv.usdc : v ? main : null;
  const max = isIn ? sendMaxProtect() : tv?.available || 0;
  if (P.step === "done" || P.step === "sending") {
    const n = P.sent || units, usd = usdOf(n, a), d = delay(main.withdrawDelay);
    return motionView(P, isIn
      ? { kind: "protect", N: NETS[S.net], title: ["Protecting", "Protected"], amount: `${amt(n, a)} ${A(a).unit}`, usd: usd != null ? money(usd) : "", line: "Wallet → Safe",
          note: `It's in your Safe now. Anything leaving it waits ${d}, and you can cancel it the whole time.`, rows: [["Withdrawals wait", d]] }
      : { kind: "withdraw", N: NETS[S.net], title: ["Starting your withdrawal", "Withdrawal started"], amount: `${amt(n, a)} ${A(a).unit}`, usd: usd != null ? money(usd) : "", line: `Safe → ${P.dest ? short(P.dest) : "Wallet"}`,
          note: `It ${P.dest ? `can leave for ${short(P.dest)}` : "reaches your Wallet"} in ${d}. Until then you can cancel it from your Safe.`, rows: [["Arrives", new Date(Date.now() + main.withdrawDelay * 1000).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })]] });
  }
  const lim = a === "usdc" ? vv.usdc?.dailyLimit : main.dailyLimit, overLim = !isIn && lim && units > lim;
  const valid = units > 0 && units <= max && !overLim;
  if (!isIn && P.step === "to") return wdToView(P);
  if (!isIn && P.step === "review" && valid) return wdReviewView(P, { units, main, a });
  // Rail + keypad: where the money goes, how much, what each side holds after, then slide to confirm.
  const bal = isIn ? (S.bal?.[a] || 0) : (tv?.balance || 0), other = isIn ? (tv?.balance || 0) : (S.bal?.[a] || 0), u = A(a).unit;
  const f = max ? Math.min(1, units / max) : 0, usd = usdOf(units, a);
  const arrive = new Date(Math.max(Date.now() + main.withdrawDelay * 1000, (main.lockedUntil || 0) * 1000));
  const when = arrive.toLocaleString(S.lang === "fr" ? "fr-CA" : "en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const side = (k, name, b, after, ic) => `<div class="rt rt-${k}"><span class="rt-ic">${ic}</span><span class="rt-n">${name}</span><b>${mask(amt(Math.max(0, after), a))}</b><small>${units && valid ? `was ${mask(amt(b, a))}` : u}</small></div>`;
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"], pad = !!globalThis.ECRIN_WEB; // phone: our keypad; desktop: type
  return `${phead(isIn ? "Protect" : "Withdraw")}
  <div class="mv2 ${isIn ? "in" : "out"}">
    <div class="rail" style="--f:${f.toFixed(3)}">
      ${side("from", isIn ? "Wallet" : "Safe", bal, bal - (valid ? units : 0), isIn ? I.card : I.lock)}
      <div class="rl"><i class="rl-t"></i><i class="rl-f"></i><i class="rl-d"></i></div>
      ${side("to", isIn ? "Safe" : "Wallet", other, other + (valid ? units : 0), isIn ? I.lock : I.card)}
    </div>
    <div class="mv-src">${fromRow()}</div>
    ${isIn ? "" : `<button class="mv-to" data-act="wd-to"><span>To</span><b>${P.dest ? esc(short(P.dest)) : "Your Wallet"}</b><i>${P.dest ? "Change" : "Another address"}</i></button>`}
    <div class="mv-amt${units > max || overLim ? " over" : ""}">${pad ? `<b>${esc(P.amount || "0")}</b>` : `<input data-amount inputmode="decimal" placeholder="0" value="${esc(P.amount)}" autocomplete="off" autofocus style="width:${Math.max(1, (P.amount || "0").length) + 0.6}ch"/>`}<span>${u}</span></div>
    <div class="mv-sub">${units > max ? `<span class="bad">More than ${isIn ? "your Wallet has" : "can leave right now"}</span>` : overLim ? `<span class="bad">Over your daily limit of ${amt(lim, a)} ${u}</span>` : usd != null && units ? money(usd) : `${amt(max, a)} ${u} available${usdOf(max, a) != null && !A(a).stable && max ? ` · ≈ ${money(usdOf(max, a))}` : ""}`}</div>
    ${feeNote(a)}${isIn && !v ? `<p class="mv-note first">${I.shield}<span>First time on ${NETS[S.net].name}: your Safe opens here as part of this deposit, with the same rules.</span></p>` : ""}
    <div class="mv-pcts">${[25, 50, 100].map((v) => `<button data-act="pct" data-v="${v}" class="${P.pct === v ? "on" : ""}">${v === 100 ? "Max" : v + "%"}</button>`).join("")}</div>
    <p class="mv-note">${isIn ? `${I.lock}<span>Anything leaving waits <b>${delay(main.withdrawDelay)}</b>, and you can cancel it.</span>` : (main.lockedUntil && main.lockedUntil * 1000 > Date.now() ? `${I.lock}<span>Your Safe is frozen until <b>${new Date(main.lockedUntil * 1000).toLocaleString(S.lang === "fr" ? "fr-CA" : "en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</b>, so this arrives <b>${when}</b> · cancel any time before</span>` : `${I.clock}<span>Arrives <b>${when}</b> · cancel any time before</span>`)}</p>
    ${pad ? `<div class="kp">${keys.map((k) => `<button data-act="key" data-k="${k}" aria-label="${k === "del" ? "Delete" : k}">${k === "del" ? `<svg viewBox="0 0 24 24"><path d="M9 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5-6z"/><path d="M12.5 10l4 4M16.5 10l-4 4"/></svg>` : k}</button>`).join("")}</div>` : ""}
    <div class="pfoot mv-foot">${P.step === "sending" ? hold(isIn ? "Protecting…" : "Starting…", true) : `<div class="slide${valid ? "" : " off"}" data-slide="${isIn ? "do-protect" : "do-withdraw"}"><span class="sl-t">${isIn ? "Slide to lock in your Safe" : "Slide to start withdrawal"}</span><i class="sl-k">${isIn ? I.lock : I.out}</i></div>
      <button class="sr-only" data-act="${isIn ? "do-protect" : "do-withdraw"}" ${valid ? "" : "disabled"}>${isIn ? "Move to Safe" : "Start withdrawal"}</button>`}</div>
  </div>`;
}
/* ------------------------------------------------------------------ one Safe, every network
   Each network keeps its own Safe account (that's how blockchains work), but you only ever open one Safe: "Open my
   Safe" opens it on every network where you have coins for the fee, and any other network opens on its own, with the
   same rules, the first time you protect something there. */
// Test networks have their Safe; on mainnet a Safe contract (Base) only shows to someone who turned on early access
// in Settings, knowing it has not been audited yet.
const canSafe = (k) => { const N = NETS[k]; return !!N?.contract && (!N.real || !!S.earlySafe); };
// Every network with an open Safe. The network you're on uses its fresh copy (S.vault), so callers never read a
// stale or empty one right after a change there.
const openRows = () => (S.all || []).filter((r) => r.ok).map((r) => (r.k === S.net && S.vault !== undefined ? { ...r, v: S.vault } : r)).filter((r) => r.v?.main);
const anySafe = () => !!S.vault || openRows().length > 0;
/** The rules your Safe already uses (from any network), so a new network gets the same. */
// ---- Withdraw: where it goes, then a last look before the countdown starts.
const mineAddr = (k) => { const m = String(ENG?.address || ""); return !!m && (String(k) === m || String(k).toLowerCase() === m.toLowerCase()); };
function wdToView(P) {
  const N = NETS[S.net], book = Object.entries(S.book?.[N.fam] || {}).map(([addr, name]) => ({ addr, name })).slice(0, 6);
  return `<header class="phead"><button class="ib" data-act="wd-back" aria-label="Back">${I.back}</button><b>Withdraw to</b><span></span></header>
  <div class="wd-to">
    <button class="wd-opt ${P.dest ? "" : "on"}" data-act="wd-mine"><span class="wd-ic">${I.card}</span><span><b>Your Wallet</b><small>${esc(short(String(ENG.address)))} · the usual choice</small></span></button>
    <label class="fld to"><span>Or another ${N.name} address</span><div class="in-btn"><input data-wdto placeholder="${addrHint(N)}" value="${esc(P.to || "")}" spellcheck="false" autocomplete="off"/><button type="button" class="ib sm" data-act="paste" aria-label="Paste">${I.paste}</button></div></label>
    ${book.length ? `<div class="wd-book">${book.map((c) => `<button class="chip" data-act="wd-pick" data-a="${esc(c.addr)}">${esc(c.name)}</button>`).join("")}</div>` : ""}
    <p class="mv-note">${I.clock}<span>It still waits <b>${delay(S.vault?.main?.withdrawDelay || 0)}</b> in your Safe, and you can cancel it the whole time.</span></p>
  </div>
  <div class="pfoot"><button class="btn primary xl" data-act="wd-to-ok">Use this address</button></div>`;
}
function wdReviewView(P, { units, main, a }) {
  const N = NETS[S.net], u = A(a).unit, usd = usdOf(units, a), dest = P.dest || String(ENG.address);
  const arrive = new Date(Math.max(Date.now() + main.withdrawDelay * 1000, (main.lockedUntil || 0) * 1000));
  const when = arrive.toLocaleString(S.lang === "fr" ? "fr-CA" : "en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const trusted = (main.trusted || []).some((t) => String(t).toLowerCase() === dest.toLowerCase());
  const row = (k, v) => `<div class="rv-r"><span>${k}</span><b>${v}</b></div>`;
  return `<header class="phead"><button class="ib" data-act="wd-back" aria-label="Back">${I.back}</button><b>Review withdrawal</b><span></span></header>
  <div class="rv">
    <div class="rv-amt"><b>${amt(units, a)} ${u}</b>${usd != null ? `<small>${money(usd)}</small>` : ""}</div>
    <div class="rv-card">
      ${row("From", `Your Safe · ${N.name}`)}
      ${row("To", P.dest ? `<span class="rv-addr">${esc(dest)}</span>` : `Your Wallet <small>${esc(short(dest))}</small>`)}
      ${row("Can leave", `${esc(when)} <small>in ${delay(Math.max(0, Math.round((arrive - Date.now()) / 1000)))}</small>`)}
      ${row("Network fee", N.fam === "sol" ? "under 0.001 SOL" : `a little ${N.unit}`)}
    </div>
    ${P.dest && !trusted ? `<div class="note warn">${I.shield}<span>Check this address carefully: once it leaves your Safe it can't come back. Until then, you can cancel.</span></div>`
      : `<p class="mv-note">${I.clock}<span>The countdown starts when you confirm. You can cancel it any time before it ends.</span></p>`}
  </div>
  <div class="pfoot"><button class="btn primary xl" data-act="do-withdraw">Start the countdown</button></div>`;
}
function safeKind() { const r = S.vault ? { v: S.vault } : openRows()[0]; return r?.v ? (r.v.main.withdrawDelay >= 72 * 3600 ? "strong" : "gentle") : null; }
const feeFloor = (k) => (NETS[k].fam === "sol" ? 3_000_000 : 1);
async function openSafeEverywhere(kind) {
  const { dev } = await local.get("dev"), rows = S.all || [], done = [], skipped = [];
  if (!canSafe(S.net)) { const k = netKeys().find(canSafe); if (!k) throw new Error("The Safe isn't available on this network yet."); await useNet(k); }
  // this network first: if it fails, say why and stop
  if (!S.vault) { await (await eng()).createVault(kind); done.push(S.net); }
  for (const k of netKeys().filter((k) => k !== S.net && canSafe(k))) {
    const r = rows.find((x) => x.k === k); if (!r?.ok || r.v) continue;
    if (!((r.b?.native || 0) > feeFloor(k))) { skipped.push(k); continue; }
    try { await engine({ web3, ethers, acct: ACCT, net: k, dev: dev || {} }).createVault(kind); done.push(k); } catch (e) { console.warn("open", k, e); skipped.push(k); }
  }
  return { done, skipped };
}
function sendMaxProtect() { const a = S.panel.asset, open = !S.vault ? (NETS[S.net].fam === "sol" ? 6_000_000 : 0) : 0; return a === "native" ? Math.max(0, (S.bal?.native || 0) - (S.panel.reserve || 0) - (NETS[S.net].fam === "sol" ? 3_000_000 : 0) - open) : S.bal?.usdc || 0; }

/** Opening a Safe: the Shield from the Safe page, its arc filling as you arrive, the delay you're choosing in the middle. */
function cvShield(label) {
  if (!S.cvT0) S.cvT0 = performance.now();
  const el = performance.now() - S.cvT0;
  return `<div class="sf cv-sf${el < 2600 ? " intro" : ""}" style="--lt:${-Math.round(el)}ms"><div class="sf-stage"><svg class="sf-sh" viewBox="0 0 300 300" aria-hidden="true">
    <defs><linearGradient id="sfg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b6c4ff"/><stop offset=".45" stop-color="#4b74ff"/><stop offset="1" stop-color="#00c8ff"/></linearGradient>
      <radialGradient id="sfc" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="#3a5cff" stop-opacity=".55"/><stop offset=".6" stop-color="#1a2160" stop-opacity=".35"/><stop offset="1" stop-color="#0b0d1c" stop-opacity=".1"/></radialGradient></defs>
    <g transform="rotate(45 150 150)"><rect class="sf-tk" x="34" y="34" width="232" height="232" rx="52" pathLength="100"/><rect class="sf-base" x="52" y="52" width="196" height="196" rx="44"/>
      <rect class="sf-arc" x="52" y="52" width="196" height="196" rx="44" pathLength="100" style="--p:100"/><rect class="sf-run" x="52" y="52" width="196" height="196" rx="44" pathLength="100"/>
      <rect class="sf-core" x="66" y="66" width="168" height="168" rx="36"/></g></svg>
    <div class="sf-mid"><span class="sf-ic">${I.shield}</span><span class="lbl">Withdrawals wait</span><b class="sf-tot">${label}</b></div></div></div>`;
}
function createVaultView(title) {
  const P = S.panel, other = (S.all || []).find((r) => r.v && r.k !== S.net);
  if (other && !P.kind) P.kind = other.v.main.withdrawDelay >= 72 * 3600 ? "strong" : "gentle";
  const same = other ? `<p class="note">${I.lock}<span>Same rules as your Safe on ${NETS[other.k].name}: <b>${delay(other.v.main.withdrawDelay)}</b> delay. One tap opens it here too.</span></p>` : "";
  return `${phead(title)}
    <div class="cv">
      <div class="cv-art">${cvShield(P.kind === "gentle" ? "24 h" : "72 h")}</div>
      <h2>Open your Safe</h2>
      <p class="sub">Money you move here can't leave in a hurry: every withdrawal waits, and you can cancel it the whole time. Your Wallet stays instant.</p>
      <div class="presets">
        ${[["gentle", "Gentle", "24 h", "Lighter protection"], ["strong", "Strong", "72 h", "Recommended"]].map(([k, n, d, s]) => `<button class="preset ${P.kind === k || (!P.kind && k === "strong") ? "on" : ""}" data-act="kind" data-k="${k}"><b>${n}</b><span class="pd">${d}</span><small>${s}</small></button>`).join("")}
      </div>
    </div>
    ${S.bal && !S.bal.native ? `<p class="note">${I.recv}<span>Your Wallet has no ${NETS[S.net].unit} yet. Opening your Safe costs a tiny network fee. ${faucetBtn(NETS[S.net])}</span></p>` : ""}
    ${same}<div class="pfoot">${P.step === "sending" ? hold("Opening…", true) : `<button class="btn primary xl" data-act="create-vault" ${S.bal && !S.bal.native ? "disabled" : ""}>Open my Safe</button>`}</div>`;
}

/** One Safe for everything: every network that has a vault, each in its own section, with its own delay, balances
 *  and withdrawals. Actions switch to that network first, so nothing depends on the network picker. */
function vaultView() {
  if (noSafeHere()) return safeSoonView("Safe");
  const rows = S.all;
  if (!rows) return `${phead("Safe")}<div class="vcase safe-all"><div class="mv-top"><span class="mv-mark">${LOGO}<b>ECRIN</b></span><span class="mv-lvl">Every network</span></div><div class="sa-tot"><span class="lbl">Protected</span><b class="sk">&nbsp;</b></div></div>`;
  const mine = [ACCT?.sol?.publicKey?.toBase58?.(), ACCT?.evm?.address?.toLowerCase?.()].filter(Boolean);
  const isMine = (d) => mine.includes(String(d)) || mine.includes(String(d).toLowerCase());
  const t = now() + (S.clockOff || 0), px = (k) => S.prices[NETS[k].cg]?.usd;
  const live = rows.filter((r) => r.ok).map((r) => (r.k === S.net && S.vault !== undefined ? { ...r, v: S.vault } : r));
  const safes = live.filter((r) => r.v), closed = Object.values(NETS).filter((N) => netKeys().includes(N.key) && canSafe(N.key) && !safes.some((r) => r.k === N.key));
  const usdOf = (r) => ((r.v.main.balance / BASE) * (px(r.k) || 0)) + ((r.v.usdc?.balance || 0) / USDC_BASE);
  const total = safes.reduce((x, r) => x + usdOf(r), 0);
  const waiting = safes.reduce((x, r) => x + r.v.main.withdrawals.length + (r.v.usdc?.withdrawals?.length || 0), 0);
  // ---- the Shield: brighter the more of your money is in the Safe
  const w = worth(), share = w.total ? Math.min(1, total / w.total) : 0, pct = Math.round(share * 100);
  const lvl = !safes.length ? ["off", "No shield yet"] : pct >= 70 ? ["max", "Fortress"] : pct >= 40 ? ["strong", "Strong"] : pct >= 15 ? ["mid", "Building"] : ["low", "Exposed"];
  if (!S.shT0) S.shT0 = performance.now();
  const el = performance.now() - S.shT0, intro = el < 2600 ? " intro" : "";
  const pend = safes.flatMap((r) => [...r.v.main.withdrawals.map((x) => ({ ...x, a: "native", r })), ...(r.v.usdc?.withdrawals || []).map((x) => ({ ...x, a: "usdc", r }))]).sort((x, y) => x.readyAt - y.readyAt);
  const next = pend[0], dl = safes[0]?.v.main.withdrawDelay;
  const blocked = (S.activity || []).filter((e) => e.t === "cancel"), saved = blocked.reduce((t, e) => t + usdOfEntry(e), 0);
  const hms = clockTxt;
  const shield = `<svg class="sf-sh" viewBox="0 0 300 300" aria-hidden="true">
    <defs><linearGradient id="sfg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b6c4ff"/><stop offset=".45" stop-color="#4b74ff"/><stop offset="1" stop-color="#00c8ff"/></linearGradient>
      <radialGradient id="sfc" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="#3a5cff" stop-opacity=".55"/><stop offset=".6" stop-color="#1a2160" stop-opacity=".35"/><stop offset="1" stop-color="#0b0d1c" stop-opacity=".1"/></radialGradient></defs>
    <g transform="rotate(45 150 150)">
      <rect class="sf-tk" x="34" y="34" width="232" height="232" rx="52" pathLength="100"/>
      <rect class="sf-base" x="52" y="52" width="196" height="196" rx="44"/>
      <rect class="sf-arc" x="52" y="52" width="196" height="196" rx="44" pathLength="100" style="--p:${Math.max(pct, safes.length ? 2 : 0)}"/>
      <rect class="sf-run" x="52" y="52" width="196" height="196" rx="44" pathLength="100"/>
      <rect class="sf-core" x="66" y="66" width="168" height="168" rx="36"/>
    </g></svg>`;
  const ring = (left, d, until) => { const f = Math.max(0, Math.min(1, left / (d || 86400))); return `<i class="sf-ring"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15"/><circle class="p" cx="18" cy="18" r="15" pathLength="100" data-ru="${until}" data-rd="${d || 86400}" style="stroke-dasharray:${(f * 100).toFixed(2)} 100"/></svg></i>`; };
  const section = (r) => {
    const N = NETS[r.k], v = r.v, main = v.main;
    const list = pend.filter((x) => x.r.k === r.k);
    const line = (a, units) => `<span class="sn-l">${a === "usdc" ? coin("usdc") : coin(r.k)}<b>${mask(fig(amt(units, a)))}</b><small>${a === "usdc" ? "USDC" : N.unit}</small></span>`;
    return `<section class="sf-net">
      <div class="sn-h">${coin(r.k)}<span class="sn-t"><b>${N.name}</b><small>${delay(main.withdrawDelay)} delay</small></span><span class="sn-v">${px(r.k) != null || v.usdc ? mask(money(usdOf(r))) : ""}</span></div>
      <div class="sn-b">${line("native", main.balance)}${N.usdc && (N.fam === "sol" || N.tokens) ? line("usdc", v.usdc?.balance || 0) : ""}</div>
      ${list.map((x) => { const left = x.readyAt - t, ready = left <= 0, unit = x.a === "usdc" ? "USDC" : N.unit;
        return `<div class="sf-w ${ready ? "ready" : ""}">${ring(left, main.withdrawDelay, x.readyAt)}<span class="wr-t"><b>${amt(x.amount, x.a)} ${unit}</b><small>to ${isMine(x.dest) ? "your Wallet" : short(String(x.dest))}</small></span>
          <span class="wr-r"><b class="cd" data-until="${x.readyAt}">${ready ? "Ready" : hms(left)}</b>${ready ? `<button class="btn sm primary" data-act="execute" data-n="${r.k}" data-id="${x.id}" data-a="${x.a}" data-d="${esc(String(x.dest))}">Release</button>` : ""}<button class="btn sm danger" data-act="cancel-w" data-n="${r.k}" data-id="${x.id}" data-a="${x.a}">Cancel</button></span></div>`; }).join("")}
      <div class="sn-a"><button class="btn sm" data-act="safe-go" data-n="${r.k}" data-p="protect">${I.protect}Protect</button><button class="btn sm" data-act="safe-go" data-n="${r.k}" data-p="withdraw">${I.out}Withdraw</button></div>
    </section>`;
  };
  const nextLeft = next ? next.readyAt - t : 0, nextU = next ? (next.a === "usdc" ? "USDC" : NETS[next.r.k].unit) : "";
  return `${phead("Safe")}
  <div class="sf${intro}" style="--lt:${-Math.round(el)}ms">
    <div class="sf-aura" aria-hidden="true" style="${auraT()}"><i></i><i></i><i></i></div>
    <section class="sf-hero lv-${lvl[0]}${next ? " alert" : ""}">
      <div class="sf-stage">${shield}
        <div class="sf-mid"><span class="sf-ic">${I.shield}</span><span class="lbl">Protected</span><b class="sf-tot${(() => { const n = money(total).length; return n > 12 ? " xs" : n > 9 ? " sm" : ""; })()}">${mask(fig(money(total)))}</b></div>
      </div>
      <div class="sf-lvl"><span class="sf-pill"><i></i>${safes.length ? `Shield ${lvl[1]}` : lvl[1]}</span><span class="sf-pct">${safes.length ? `${pct}% of everything you own` : "Open your Safe to raise it"}</span></div>
    </section>
    ${pend.length ? `<div class="list-h sf-lh"><b>Leaving your Safe</b><span>you can cancel any time</span></div>
      <div class="sf-outs${pend.length > 1 ? " many" : ""}">${pend.map((x) => {
        const N = NETS[x.r.k], d = x.r.v.main.withdrawDelay, left = x.readyAt - t, ready = left <= 0, f = Math.max(0, Math.min(1, left / (d || 86400))), unit = x.a === "usdc" ? "USDC" : N.unit, usd = usdOfEntry({ a: x.a, n: x.amount, k: x.r.k });
        const arrive = new Date(x.readyAt * 1000).toLocaleString(S.lang === "fr" ? "fr-CA" : "en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
        return `<article class="sf-out${ready ? " ready" : ""}">
          <div class="so-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="b" cx="60" cy="60" r="52"/><circle class="p" cx="60" cy="60" r="52" pathLength="100" data-ru="${x.readyAt}" data-rd="${d}" style="stroke-dasharray:${(f * 100).toFixed(3)} 100"/></svg>
            <span class="so-mid">${ready ? `<b>Ready</b><small>to release</small>` : `<b class="cd" data-until="${x.readyAt}">${hms(left)}</b><small>left of ${delay(d)}</small>`}</span></div>
          <div class="so-info"><span class="so-amt">${x.a === "usdc" ? coin("usdc") : coin(x.r.k)}<b>${mask(amt(x.amount, x.a))} ${unit}</b></span>${usd ? `<small class="so-usd">${mask(money(usd))}</small>` : ""}
            <span class="so-to">to ${isMine(x.dest) ? "your Wallet" : `<span class="mono">${esc(short(String(x.dest)))}</span>`} · ${N.name}</span>
            <span class="so-when">${ready ? "Waiting for you to release it" : `Arrives ${arrive}`}</span></div>
          ${ready ? `<button class="btn primary so-go" data-act="execute" data-n="${x.r.k}" data-id="${x.id}" data-a="${x.a}" data-d="${esc(String(x.dest))}">${I.recv}Release to Wallet</button>`
            : `<button class="so-x" data-act="cancel-w" data-n="${x.r.k}" data-id="${x.id}" data-a="${x.a}">${I.shield}Cancel this withdrawal</button>`}
        </article>`; }).join("")}</div>` : ""}
    <div class="sf-tiles">
      <div class="sf-tile t-lock"><span class="st-ic">${I.lock}</span><span class="st-k">Locked</span><b>${mask(money(total))}</b><small>${safes.length ? "every network" : "Not opened"}</small></div>
      <div class="sf-tile t-out${waiting ? " hot" : ""}"><span class="st-ic">${I.out}</span><span class="st-k">Leaving</span><b>${waiting || "None"}</b><small>${next ? `first in ${nextLeft > 0 ? dur(nextLeft) : "now"}` : "all quiet"}</small></div>
      <button class="sf-tile t-rules" data-act="panel" data-p="rules"><span class="st-ic">${I.gear}</span><span class="st-k">Rules</span><b>${dl ? delay(dl) : "—"}</b><small>delay · alerts ${I.arrow}</small></button>
    </div>
    <div class="sf-cta"><button class="sf-go" data-act="${safes.length ? "safe-pick" : "safe-go"}" data-n="${S.net}" data-p="protect">${I.protect}${safes.length ? "Protect more" : "Open my Safe"}</button>${safes.length ? `<button class="sf-go2" data-act="safe-pick" data-p="withdraw">${I.out}Withdraw</button>` : ""}</div>
    <div class="list-h"><b>Blocked</b><span>${blocked.length ? `${blocked.length} stopped${saved ? ` · ${mask(money(saved))} kept` : ""}` : "nothing yet"}</span></div>
    <div class="sf-blocked">${blocked.length ? blocked.slice(0, 4).map((e) => `<div class="sb-r"><i class="sb-d"></i><span><b>Withdrawal stopped</b><small>${e.at ? new Date(e.at).toLocaleDateString(S.lang === "fr" ? "fr-CA" : "en-US", { month: "short", day: "numeric" }) : ""}${e.n ? ` · ${amt(e.n, e.a === "usdc" ? "usdc" : "native")} ${e.a === "usdc" ? "USDC" : NETS[e.k]?.unit || ""}` : ""}</small></span><em>Kept</em></div>`).join("")
      : `<div class="sb-empty"><b>Nothing has tried to leave.</b><span>If anything ever does, even with your own key, it waits ${dl ? delay(dl) : "the delay"} and you can stop it right here.</span></div>`}</div>
    ${safes.length ? safeHoldings([], t, isMine, ring, hms) : ""}
    ${safeTimeline()}
    ${stakeNets().length ? `<button class="earn-card" data-act="panel" data-p="earn"><span class="ec-ic">${I.spark}</span><span class="ec-t"><b>Earn on your Safe</b><small>Stake without taking it out · about ${STAKE_APY_TEXT} a year on SOL</small></span><span class="ec-go">${I.arrow}</span></button>`
      : `<button class="earn-card" data-act="panel" data-p="earn"><span class="ec-ic">${I.spark}</span><span class="ec-t"><b>Earn on your Safe</b><small>Stake without taking it out · about ${STAKE_APY_TEXT} a year</small></span><span class="soon">${isMain() ? "After the audit" : "Coming soon"}</span></button>`}
  </div>`;
}
/** The Safe's story, newest first: opened, protected, withdrawals started, stopped and released, freezes. */
function safeTimeline() {
  const K = { vault: [I.lock, "Safe opened", ""], protect: [I.protect, "Protected", "in"], auto: [I.protect, "Protected automatically", "in"], withdraw: [I.clock, "Withdrawal started", "wait"], cancel: [I.shield, "Withdrawal stopped", "stop"], release: [I.recv, "Released to your Wallet", "out"], freeze: [I.snow, "Safe frozen", "stop"] };
  const ev = (S.activity || []).filter((e) => K[e.t]).slice(0, 8);
  if (!ev.length) return "";
  return `<div class="list-h"><b>History</b><span>${ev.length === 8 ? "latest 8" : `${ev.length} event${ev.length > 1 ? "s" : ""}`}</span></div>
    <ol class="sf-tl">${ev.map((e) => { const [ic, label, cls] = K[e.t], N = NETS[e.k] || NETS[S.net], unit = e.a === "usdc" ? "USDC" : N.unit;
      const v = e.n ? `${mask(amt(e.n, e.a || "native"))} ${unit}` : "", when = e.at ? new Date(e.at).toLocaleString(S.lang === "fr" ? "fr-CA" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
      return `<li class="${cls}"><i class="tl-dot">${ic}</i><span class="tl-t"><b>${label}</b><small>${when}${N ? ` · ${N.name}` : ""}</small></span>${v ? `<b class="tl-v">${v}</b>` : ""}</li>`; }).join("")}</ol>`;
}
/** Everything in your Safe as one list, coin by coin (ETH on several networks adds up into one row), then anything
 *  on its way out, each with its countdown. Tapping a coin opens its page, where Protect and Withdraw are. */
function safeHoldings(pend, t, isMine, ring, hms) {
  const w = worth(), by = {};
  for (const i of w.items.filter((i) => i.sav > 0)) { const g = (by[i.unit] ||= { ...i, sav: 0, val: 0, nets: [] }); g.sav += i.sav; g.val += i.usd != null && i.chq + i.sav ? (i.usd * i.sav) / (i.chq + i.sav) : 0; g.nets.push(i.net); }
  const coins = Object.values(by).sort((x, y) => y.val - x.val);
  const n = (v, d) => v.toLocaleString("en-US", { maximumFractionDigits: d });
  const rows = coins.length ? coins.map((c) => `<button class="arow" data-act="tok" data-u="${c.unit}">${coin(c.unit === "USDC" ? "usdc" : c.unit === "ETH" ? "eth" : c.k)}<span class="ar-t"><b>${c.name}</b><small>${c.nets.length > 1 ? `${c.nets.length} networks` : c.nets[0]}</small></span><span class="ar-r"><b>${mask(money(c.val))}</b><small>${mask(n(c.sav, c.dec))} ${c.unit}</small></span></button>`).join("")
    : `<div class="sb-empty"><b>Nothing protected yet.</b><span>Tap Protect more and pick any coin you hold, on any network.</span></div>`;
  const out = pend.map((x) => { const N = NETS[x.r.k], left = x.readyAt - t, ready = left <= 0, unit = x.a === "usdc" ? "USDC" : N.unit, d = x.r.v.main.withdrawDelay;
    return `<div class="sf-w ${ready ? "ready" : ""}">${ring(left, d, x.readyAt)}<span class="wr-t"><b>${amt(x.amount, x.a)} ${unit}</b><small>to ${isMine(x.dest) ? "your Wallet" : short(String(x.dest))} · ${N.name}</small></span>
      <span class="wr-r"><b class="cd" data-until="${x.readyAt}">${ready ? "Ready" : hms(left)}</b>${ready ? `<button class="btn sm primary" data-act="execute" data-n="${x.r.k}" data-id="${x.id}" data-a="${x.a}" data-d="${esc(String(x.dest))}">Release</button>` : ""}<button class="btn sm danger" data-act="cancel-w" data-n="${x.r.k}" data-id="${x.id}" data-a="${x.a}">Cancel</button></span></div>`; }).join("");
  return `<div class="list-h"><b>In your Safe</b><span>${coins.length} coin${coins.length === 1 ? "" : "s"}</span></div><section class="list sf-coins">${rows}</section>
    ${out ? `<div class="list-h"><b>Waiting to leave</b><span>cancel any time</span></div><section class="sf-net sf-out">${out}</section>` : ""}`;
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
  const row = (act, ic, label, val = I.arrow, extra = "") => `<button class="srow" data-act="${act}" ${extra}><span>${ic}${label}</span><span class="sv">${val}</span></button>`;
  const onOff = (v) => (v ? "On" : "Off");
  const sec = (title, body) => `<div class="set-h">${title}</div><div class="sets">${body}</div>`;
  return `${phead("Settings")}
    <button class="set-acct" data-act="panel" data-p="accts">${acctIc(curAcct(), "lg")}<span><b>${esc(curAcct().name)}</b><small class="mono">${short(ENG?.address || "")}</small></span>${I.arrow}</button>
    ${sec("Security", `
      ${row("panel", I.shield, "Safety", `Limits, freeze ${I.arrow}`, 'data-p="safety"')}
      ${row("panel", I.key, "Recovery phrase", I.arrow, 'data-p="reveal"')}
      ${row("panel", I.key, "Export private key", I.arrow, 'data-p="pkey"')}
      ${globalThis.ECRIN_WEB && bioPossible() ? row("bio-toggle", I.face, bioName() === "Face ID" ? "Face ID" : "Biometric unlock", `${onOff(S.bio)} ${I.arrow}`) : ""}
      <div class="srow"><span>${I.clock}Auto-lock</span><span class="seg">${[0, 1, 5, 15, 60].map((m) => `<button data-act="autolock" data-v="${m}" aria-pressed="${S.autolock === m}">${m === 0 ? "Off" : m < 60 ? m + "m" : "1h"}</button>`).join("")}</span></div>
      ${row("perms", I.ban, "Token permissions")}
      ${globalThis.ECRIN_WEB || globalThis.ECRIN_DEMO ? "" : row("panel", I.link, "Connected sites", I.arrow, 'data-p="sites"')}
      ${globalThis.ECRIN_WEB ? row("panel", I.link, "Connected apps (WalletConnect)", I.arrow, 'data-p="wc"') : ""}
      ${row("lock", I.lock, "Lock now", "")}
      ${IS_EXT && !FULL ? row("open-full", I.ext, "Open in a tab", I.arrow) : ""}${FULL ? row("open-popup", I.ext, "Open as popup", I.arrow) : ""}`)}
    ${sec("Preferences", `
      ${row("panel", I.card, "Currency", `${S.cur || "USD"} ${I.arrow}`, 'data-p="currency"')}
      ${row("panel", I.spark, "Price alerts", `${Object.values(S.palerts || {}).filter(Boolean).length || "Off"} ${I.arrow}`, 'data-p="alerts"')}
      <div class="srow"><span>${I.globe}Language</span><span class="seg">${LANGS.map(([k, l]) => `<button data-act="lang" data-v="${k}" aria-pressed="${S.lang === k}">${l}</button>`).join("")}</span></div>
      <div class="srow"><span>${S.theme === "light" ? I.sun : I.moon}Appearance</span><span class="seg">${["light", "dark", "ecrin"].map((t) => `<button data-act="theme" data-v="${t}" aria-pressed="${S.theme === t}">${{ light: "Light", dark: "Dark", ecrin: "Ecrin" }[t]}</button>`).join("")}</span></div>
      ${row("panel", '<b class="nf-ico">1.2</b>', "Numbers", `${NUM_FACES.find(([k]) => k === S.nums.face)[1]} ${I.arrow}`, 'data-p="numbers"')}`)}
    ${sec("Networks", `
      <div class="srow"><span>${I.globe}Networks</span><span class="seg">${[["main", "Mainnet"], ["test", "Testnet"]].map(([m, l]) => `<button data-act="net-mode" data-v="${m}" aria-pressed="${(S.mode || DEFAULT_MODE) === m}">${l}</button>`).join("")}</span></div>
      ${isMain() && Object.values(NETS).some((N) => N.real && N.contract) ? row("tog", I.lock, "Safe on Base · early access", onOff(S.earlySafe), 'data-k="earlySafe"') : ""}
      <p class="set-note">${isMain() ? (S.earlySafe ? "Early access: the Safe works on Base with USDC and ETH. It has not been audited yet, so keep amounts small." : "The Safe comes to mainnet after its security audit; until then it runs on Testnet.") : "Test coins with no value: try everything, the Safe included, for free."}</p>`)}
    ${sec("Wallet", `
      ${row("panel", I.recv, "Contacts", `${Object.values(S.book || {}).reduce((t, m) => t + Object.keys(m || {}).length, 0) || ""} ${I.arrow}`, 'data-p="contacts"')}
      ${row("report", I.spark, "Monthly report")}`)}
    ${sec("Home screen", `
      ${globalThis.ECRIN_WEB && pushPossible() ? row("push-toggle", I.bell, "Safe alerts on this phone", `${S.pushBusy ? "…" : S.pushOn ? "On" : "Off"} ${I.arrow}`) : ""}
      ${row("tog", I.recv, "Notify when I receive coins", onOff(S.recvNotify !== false && !(globalThis.ECRIN_WEB && window.Notification && Notification.permission === "denied")), 'data-k="recvNotify"')}
      ${row("tog", I.spark, "Sounds", onOff(S.sounds), 'data-k="sounds"')}
      ${row("tog", I.img, "Show collectibles (NFTs)", onOff(S.showNfts), 'data-k="showNfts"')}
      ${row("tog", I.eyeOff, "Hide small balances", onOff(S.hideSmall), 'data-k="hideSmall"')}
      ${row("tog", I.arrow, "Order coins by", S.order === "name" ? "Name" : "Value", 'data-k="order"')}`)}
    ${sec("About", `
      ${row("panel", I.spark, "What's new", `${VERSION}${typeof __ECRIN_BUILD__ !== "undefined" ? ` · ${__ECRIN_BUILD__}` : ""} ${I.arrow}`, 'data-p="news"')}
      <a class="srow" href="https://ecrinprotocol.app/" target="_blank"><span>${I.globe}Website</span><span class="sv">${I.ext}</span></a>
      <a class="srow" href="https://ecrinprotocol.app/how-it-works/" target="_blank"><span>${I.shield}How the Safe works</span><span class="sv">${I.ext}</span></a>
      <a class="srow" href="https://ecrinprotocol.app/security/" target="_blank"><span>${I.check}Security and audits</span><span class="sv">${I.ext}</span></a>
      ${row("panel", I.shield, "Help & support", I.arrow, 'data-p="help"')}
      ${row("panel", I.link, "Report a problem or an idea", I.arrow, 'data-p="bug"')}
      <a class="srow" href="https://ecrinprotocol.app/privacy/" target="_blank"><span>${I.lock}Privacy</span><span class="sv">${I.ext}</span></a>
      <a class="srow" href="https://ecrinprotocol.app/terms/" target="_blank"><span>${I.card}Terms</span><span class="sv">${I.ext}</span></a>`)}
    <div class="sets danger-z"><button class="srow danger" data-act="forget"><span>Remove wallet from this browser</span><span></span></button></div>
    <div class="set-sig">${WORDMARK("md")}<b>Wallet</b><small>Version ${VERSION} · beta · not audited</small></div>`;
}
// ---- Report a problem: straight to the team, with what helps fix it (never keys, the phrase or balances).
const REPORT_URL = "https://ecrinprotocol.app/api/report";
function bugInfo() {
  const N = NETS[S.net] || {}, e = S.lastErr && Date.now() - S.lastErr.at < 30 * 60_000 ? S.lastErr : null;
  return {
    version: VERSION, net: `${N.name || S.net} ${N.net || ""}`.trim(), screen: S.panel?.from || S.screen || "",
    platform: IS_EXT ? (FULL ? "extension (tab)" : "extension") : globalThis.ECRIN_WEB ? (navigator.standalone || matchMedia("(display-mode: standalone)").matches ? "phone app (home screen)" : "phone browser") : "web",
    lang: S.lang, size: `${innerWidth}x${innerHeight}, turned ${screen.orientation?.angle ?? 0}°`, agent: navigator.userAgent, error: e ? e.text : "",
  };
}
// ---- Help & support: quick answers, then the ways to reach a person (links set by the team on the server).
const SITE_URL = "https://ecrinprotocol.app";
async function loadLinks() { if (S.links) return S.links; try { S.links = await (await fetch(SITE_URL + "/api/links")).json(); } catch (_) { S.links = {}; } return S.links; }
const HELP_QA = [
  ["My withdrawal hasn't arrived", "Every withdrawal waits the delay you chose, longer if your Safe is locked. Your Safe shows the countdown; when it ends, open the Safe to finish it. Until then you can cancel it."],
  ["I can't get test coins", "On Testnet, tap Get free test SOL (once a day). If Ecrin's faucet is empty or busy, Solana's own faucet opens with your address copied."],
  ["Can Ecrin reverse a transaction?", "No. Ecrin never holds your keys or your money. You can cancel your own withdrawal while it waits; money that has left can't be brought back by anyone."],
  ["Someone offered help in my messages", "That isn't Ecrin. We never message you first, and never ask for your recovery phrase or private key."],
];
function helpView() {
  if (!S.links) loadLinks().then(() => S.panel?.p === "help" && renderPanel());
  const L = S.links || {};
  return `${phead("Help & support")}
  <div class="help">
    <div class="help-qa">${HELP_QA.map(([q, a]) => `<details class="hq"><summary>${q}</summary><p>${a}</p></details>`).join("")}</div>
    <div class="help-ways">
      <button class="srow" data-act="panel" data-p="bug" data-k="support"><span>${I.send || I.link}Message support</span><span class="sv">${I.arrow}</span></button>
      ${L.email ? `<a class="srow" href="mailto:${esc(L.email)}"><span>${I.recv}Email</span><span class="sv">${esc(L.email)}</span></a>` : ""}
      ${L.telegram ? `<a class="srow" href="${esc(L.telegram)}" target="_blank" rel="noopener"><span>${I.link}Telegram community</span><span class="sv">${I.ext}</span></a>` : ""}
      <a class="srow" href="${SITE_URL}/${S.lang === "fr" ? "fr/assistance" : "support"}/" target="_blank" rel="noopener"><span>${I.globe}All answers</span><span class="sv">${I.ext}</span></a>
    </div>
    <div class="note">${I.shield}<span>We never ask for your recovery phrase or private key, and never message you first.</span></div>
  </div>`;
}
function bugView() {
  const P = S.panel, sup = P.k === "support" || P.kind === "support", title = sup ? "Contact support" : "Report a problem";
  if (P.sent) return `${phead(title)}<div class="cv"><div class="cv-art">${I.check}</div><h2>Thank you</h2>
    <p class="sub">${sup ? "Your message is with the Ecrin team. If you left a way to reach you, we'll answer there." : "Your report is with the Ecrin team. Reports like yours are how Ecrin gets better before mainnet."}</p></div>
    <div class="pfoot"><button class="btn xl" data-act="close">Done</button></div>`;
  const info = bugInfo();
  return `${phead(title)}
  <div class="bug">
    <p class="sub">${sup ? "Tell us what you need. A person from the Ecrin team reads every message." : "A bug, something confusing, or an idea: it goes straight to the Ecrin team."}</p>
    <label class="fld"><span>What happened?</span><textarea data-bugtext rows="6" maxlength="2000" placeholder="What did you do, what did you expect, and what happened instead?">${esc(P.text || "")}</textarea></label>
    <label class="fld"><span>${sup ? "How can we answer you?" : "How can we reach you? (optional)"}</span><input data-bugwho maxlength="80" placeholder="@telegram or email" value="${esc(P.who || "")}" autocomplete="off"/></label>
    <div class="note">${I.shield}<span>Added to help us fix it: version ${esc(info.version)}, ${esc(info.net)}, ${esc(info.platform)}${info.error ? ", the last error" : ""}. Never your recovery phrase, keys or balances.</span></div>
  </div>
  <div class="pfoot"><button class="btn primary xl" data-act="bug-send" ${P.busy ? "disabled" : ""}>${P.busy ? "Sending…" : "Send report"}</button></div>`;
}
// What's new: shown once after an update (never on a fresh install), and any time from Settings → About.
const NEWS = [
  ["Earn on your Safe", "Stake from your Safe: SOL with a Solana validator, ETH through Lido (on Hoodi for now). It stays inside your Safe the whole time, and when you unstake it can only come back there."],
  ["Buy with a card", "Buy SOL, ETH and USDC through MoonPay, straight into your Wallet. Test mode on Testnet; real purchases open with mainnet."],
  ["Cancel from the home screen", "Anything leaving your Safe now shows at the top of the home screen, with its countdown and a Cancel button. If it wasn't you, one tap stops it."],
  ["Your Safe on Sui", "The Safe now runs on Sui Testnet too: open it, protect SUI, and every withdrawal waits like on Solana and Ethereum."],
  ["Look-alike addresses caught", "If an address starts and ends like one you've used but differs in the middle, a common scam, Ecrin warns you in red before you send."],
  ["Help & support", "Settings → Help & support: quick answers, and a way to reach a person on the Ecrin team."],
  ["Withdraw anywhere, after a last look", "Choose your Wallet or any address, then review the amount, the destination and when it can leave before the countdown starts."],
  ["Report a problem", "Settings → Report a problem or an idea: it goes straight to the Ecrin team. Thank you to every tester."],
  ["Safe alerts on your phone", "Settings → Safe alerts on this phone: a notification the moment a withdrawal starts, so you can cancel it in time."],
  ["Follow your money", "Every send, protect, withdrawal and swap now shows its journey live, then a receipt with the details."],
  ["Your Safe at a glance", "Anything leaving your Safe gets its own countdown ring and a big Cancel button, and the Safe keeps its history."],
  ["Every network in one place", "Tap the globe at the top of the home screen to see every network and what you hold on each."],
  ["Sui", "Send and receive SUI and USDC on Sui with the same recovery phrase."],
  ["A new unlock screen", "The Safe's diamond greets you, with a show-password eye and a Caps Lock warning."],
  ["Free test coins, built in", "On Solana, \"Get free test SOL\" now sends test coins straight to your Wallet. No outside faucet, no sign-in."],
  ["Steadier on busy networks", "When a network's main server is busy, Ecrin quietly switches to a backup, and tells you plainly if something needs a retry."],
  ["A calmer look", "Quieter Settings icons, the Ecrin mark on the welcome screen, and cleaner badges for tokens without a logo."],
  ["Late-night pause", "Between midnight and 6 AM, starting a withdrawal from your Safe first offers to sleep on it. You can always continue."],
  ["Betting-site warning", "Turn it on in Settings → Safety: when a casino or betting site asks to connect, Ecrin suggests waiting 10 minutes first."],
  ["Ecrin mode", "A third look in Settings → Appearance: deep Ecrin blue, white and ivory, with your coins in beige, white, grey and black."],
  ["Calm price moves", "When a price updates, its digits roll and the figure warms gently toward green or red, then settles."],
  ["A living chart", "On a coin's page the line draws itself, and a slow pulse marks the latest price."],
  ["A cooldown you can watch", "The ring on a pending withdrawal drains continuously, and pull-to-refresh turns the Ecrin mark."],
  ["The Ecrin mark, everywhere", "The same diamond and wordmark as our website, on home, at start-up and in Settings."],
];
function newsView() {
  return `${phead("What's new")}<div class="pad news"><p class="news-v">Ecrin Wallet ${VERSION}</p>
    ${NEWS.map(([t, d], i) => `<div class="news-i" style="--n:${i}"><span class="news-d"></span><span><b>${t}</b><small>${d}</small></span></div>`).join("")}
    <div class="pfoot"><button class="btn primary xl" data-act="close">Got it</button></div></div>`;
}
async function maybeNews() {
  if (S.newsChecked || S.screen !== "home") return; S.newsChecked = true;
  const { seenVer } = await local.get("seenVer"); if (seenVer === VERSION) return;
  await local.set({ seenVer: VERSION });
  // Phone: a small card with only the newest change (the full list stays in Settings → What's new). Extension: the page.
  if (seenVer) setTimeout(() => { if (S.screen === "home" && !S.panel) (globalThis.ECRIN_WEB ? newsPeek() : openPanel("news")); }, 1700); // after the entrance
}
/** The newest change, as a small card above the tab bar. Tap it for the full list; it leaves by itself after a while. */
function newsPeek() {
  const [t, d] = NEWS[0]; document.querySelector(".npk")?.remove();
  const el = document.createElement("div"); el.className = "npk"; el.setAttribute("role", "status");
  el.innerHTML = `<button class="npk-b" data-np="open"><span class="npk-ic">${I.spark}</span><span class="npk-t"><small>New in ${esc(VERSION)}</small><b>${esc(trText(t, S.lang))}</b><span>${esc(trText(d, S.lang))}</span></span></button><button class="npk-x" data-np="x" aria-label="${esc(trText("Close", S.lang))}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  const bye = () => { el.classList.add("out"); setTimeout(() => el.remove(), 320); };
  el.addEventListener("click", (e) => { const b = e.target.closest("[data-np]"); if (!b) return; bye(); if (b.dataset.np === "open") openPanel("news"); });
  document.body.append(el); haptic("light"); setTimeout(() => el.isConnected && bye(), 9000);
}
function currencyView() {
  return `${phead("Currency")}<p class="fine">Prices and totals show in this currency at today's rate. Your coins don't change.</p>
    <section class="list">${CURS.map(([c, n]) => `<button class="arow cur-r${(S.cur || "USD") === c ? " on" : ""}" data-act="cur" data-v="${c}"><span class="cur-c">${c}</span><span class="ar-t"><b>${n}</b><small>${(1234.5).toLocaleString(S.lang === "fr" ? "fr-CA" : "en-US", { style: "currency", currency: c, currencyDisplay: "narrowSymbol" })}</small></span>${(S.cur || "USD") === c ? `<span class="acc-ok">${I.check}</span>` : ""}</button>`).join("")}</section>`;
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
  return `${phead("Recovery phrase")}<form class="stack pad" data-form="reveal"><p class="sub">Enter your password to see your 12 words. Make sure nobody can see your screen.</p>${S.bio ? `<button type="button" class="btn primary bio-btn" data-act="reveal-bio">${I.face}Show with ${bioName()}</button><p class="or">or use your password</p>` : ""}<label class="fld"><span>Password</span><input name="pw" type="password" autofocus required/></label><p class="err" data-err></p><button class="btn primary xl">Show</button></form>`;
}

// ------------------------------------------------------------------ actions

function toast(text, kind = "") { if (kind === "err") S.lastErr = { text: String(text).slice(0, 160), at: Date.now(), net: S.net }; const t = $("#toast"); t.innerHTML = `<i class="t-ic" aria-hidden="true"></i><span>${esc(trText(text, S.lang))}</span>`; t.className = "toast show " + kind; clearTimeout(t._t); t._t = setTimeout(() => (t.className = "toast " + kind), 2600); }
const errText = (e) => {
  const raw = String(e?.shortMessage || e?.message || e);
  if (/429|too many requests|failed to fetch|fetch failed|networkerror|network error|timed? ?out|ECONN|\b50[234]\b|block height exceeded|blockhash not found|server error/i.test(raw)) return `The ${isMain() ? "" : "test "}network is busy right now. Check Activity in a minute, and try again if it didn't go through.`;
  if (/insufficient funds/i.test(raw)) return `Not enough ${NETS[S.net].unit} for this and the network fee. ${isMain() ? "Use Receive to add some." : "Use Receive to get free test coins."}`;
  if (/user rejected|user denied|rejected the request|cancell?ed by (the )?user|NotAllowedError/i.test(raw)) return "Cancelled. Nothing was sent.";
  if (/nonce too low|replacement (transaction )?underpriced|already known|nonce has already been used/i.test(raw)) return "Your last transaction is still going through. Wait a minute, then try again.";
  if (/no record of a prior credit|AccountNotFound|insufficient lamports|attempt to debit an account but found no record/i.test(raw)) return `Your Wallet needs a little ${NETS[S.net].unit} to pay the network fee. ${isMain() ? "Use Receive to add some." : "Use Receive to get free test coins."}`;
  if (/max fee per gas less than block base fee|fee too low|underpriced|intrinsic gas too low/i.test(raw)) return "The network fee went up while you were confirming. Try again: Ecrin will use the new fee.";
  if (/invalid address|bad address checksum|invalid public key|Invalid public key input/i.test(raw)) return "That address doesn't look right for this network. Check it and paste it again.";
  let m; try { m = ENG?.explain?.(e)?.message || raw; } catch (_) { m = raw; }
  // Anything still technical (codes, JSON, hex, stack traces) never reaches the screen: say what happened, plainly.
  if (/execution reverted|CALL_EXCEPTION|reverted|custom program error|instruction error/i.test(m) && m === raw) return "The network refused this transaction, so nothing was sent. Check the amount and your Safe's rules, then try again.";
  if (m === raw && (/[{}\[\]]|0x[0-9a-f]{12,}|code[=:]|Error:|at .+\(/i.test(m) || m.length > 140)) { console.warn("unexplained error", raw); return "Something went wrong and nothing was sent. Try again in a moment."; }
  return m.length > 160 ? m.slice(0, 157) + "…" : m;
};

const actKey = () => `act:${S.net}:${ENG?.address || ""}`;
async function readActivity() { const k = actKey(), o = await local.get(k); return o[k] || []; }
async function logActivity(e) { const k = actKey(), list = await readActivity(); await local.set({ [k]: [{ at: Date.now(), ...e }, ...list].slice(0, 60) }); }

async function txRun(fn, after, log) {
  if (S.upd?.must) return toast("A security update is required before you can send. Update Ecrin Wallet first.", "err");
  const P = S.panel; P.step = "sending"; P.sig = null; motionStart(P, STEPS(NETS[S.net], log?.t === "protect" ? "In your Safe" : log?.t === "withdraw" ? "Withdrawal started" : log?.t === "stake" ? "Staked" : log?.t === "unstake" ? "Unstaking" : log?.t === "reclaim" ? "Back in your Safe" : "Confirmed")); renderPanel();
  try { S.lastTx = Date.now(); const sig = await fn(); S.lastTx = Date.now(); P.sig = typeof sig === "string" ? sig : P.sig; motionEnd(P); await after?.(); if (log) await logActivity({ ...log, sig: P.sig }); P.step = "done"; haptic("success");
    // Show it done now and move the numbers on screen at once; the network's own numbers replace them a moment later.
    if (log && S.bal && (log.t === "send" || log.t === "protect") && log.n) { const k = log.a === "usdc" ? "usdc" : "native"; S.bal = { ...S.bal, [k]: Math.max(0, Number(S.bal[k] || 0) - Number(log.n)) }; }
    renderPanel(); refresh().then(() => { loadActivity(); loadAll(); }); return; }
  catch (e) { console.warn(e); txEvents.sent = null; P.mo = null; P.step = "form"; toast(errText(e), "err"); }
  renderPanel();
}

async function knownDest(to) { const { sent = {} } = await local.get("sent"); return !!sent[`${S.net}:${to}`]; }
/** Address poisoning: scammers send dust from an address that starts and ends like one you use, hoping you copy it
 *  from your history. Returns the real address it imitates (from your past sends, contacts or own accounts), or null. */
async function lookalikeOf(to) {
  const N = NETS[S.net], ci = N.fam === "evm" || N.fam === "sui", norm = (a) => { const x = String(a || "").trim().replace(/^0x/i, ""); return ci ? x.toLowerCase() : x; };
  const t = norm(to); if (t.length < 20) return null;
  const { sent = {} } = await local.get("sent");
  const known = [...Object.keys(sent).filter((k) => k.startsWith(S.net + ":")).map((k) => k.slice(S.net.length + 1)), ...Object.keys(S.book?.[N.fam] || {}), String(ENG?.address || "")];
  for (const k of known) { const n = norm(k); if (n && n !== t && n.length === t.length && n.slice(0, 4) === t.slice(0, 4) && n.slice(-4) === t.slice(-4)) return k; }
  return null;
}
const lookalikeNote = (P) => P.lookalike ? `<div class="note bad-n">${I.shield}<span><b>Careful: this is not the address you used before.</b> It starts and ends like ${esc(short(P.lookalike))}, but the middle is different. Scammers create look-alike addresses to trick you. Check every character, or pick the address from your contacts.</span></div>` : "";
async function rememberDest(to) { const { sent = {} } = await local.get("sent"); sent[`${S.net}:${to}`] = Date.now(); await local.set({ sent }); }

async function useNet(n) {
  if (!n || n === S.net) return;
  S.net = n; await local.set({ net: S.net }); S.bal = null; S.vault = undefined; ENG = null; S.drawChart = true;
  await eng(); loadActivity(); await refresh(); loadSeries();
}

async function saveAccts() { await local.set({ accts: S.accts }); }
const actions = {
  "tb-home": () => { if (S.panel) return closePanel(); $("#root").scrollTo({ top: 0, behavior: "smooth" }); },
  "tb-go": (el) => { if (S.panel?.p === el.dataset.p) return; if (S.panel) { S.panel = null; $("#panel").innerHTML = ""; } openPanel(el.dataset.p); },
  speed: (el) => { S.panel.speed = el.dataset.v; renderPanel(); },
  palert: async (el) => { S.palerts = { ...(S.palerts || {}), [el.dataset.cg]: Number(el.dataset.v) }; await local.set({ palerts: S.palerts }); renderPanel(); checkPriceAlerts(); },
  "palert-notify": async () => { try { await Notification.requestPermission(); } catch (_) {} renderPanel(); },
  // Request opens on a coin you hold (the biggest), not on whatever network happens to be selected.
  "home-req": async () => {
    const best = worth().items.filter((i) => i.chq > 0 && !NETS[i.k]?.test === isMain()).sort((x, y) => (y.usd || 0) - (x.usd || 0))[0];
    if (best && best.k !== S.net) await useNet(best.k);
    openPanel("payreq", { a: best?.a || "native" });
  },
  payreq: () => { const a = S.panel?.asset || "native"; S.panel = null; $("#panel").innerHTML = ""; openPanel("payreq", { a }); },
  "copy-req": async () => { const P = S.panel; try { await navigator.clipboard.writeText(payLink(S.net, P.asset || "native", Number(P.amount) > 0 ? P.amount : "", P.label || "")); toast("Payment link copied", "win"); } catch (_) { toast("Couldn't copy", "err"); } },
  "share-req": async () => { const P = S.panel; try { await navigator.share({ text: payLink(S.net, P.asset || "native", Number(P.amount) > 0 ? P.amount : "", P.label || "") }); } catch (_) {} },
  "wc-paste": () => { const v = ($("#panel [data-wcuri]")?.value || "").trim(); if (!/^wc:/i.test(v)) return toast("Paste the WalletConnect link that starts with wc:", "err"); wcPair(v); },
  "wc-off": async (el) => { const c = await wcClient(); await c.disconnect(el.dataset.t); S.panel.list = c.sessions(); renderPanel(); toast("Disconnected"); },
  scan: async () => {
    // Phone app: read an address from a QR code with the camera. Nothing leaves the phone.
    const ov = document.createElement("div"); ov.className = "scan-ov"; ov.innerHTML = `<video playsinline muted></video><div class="scan-box"></div><p>Point at a QR code</p><button class="btn">Cancel</button>`; (document.querySelector(".device") || document.body).append(ov);
    let stream, raf, stop = () => { cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); ov.remove(); };
    ov.querySelector("button").onclick = stop;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const v = ov.querySelector("video"); v.srcObject = stream; await v.play();
      const { default: jsQR } = await import("jsqr"), c = document.createElement("canvas"), x = c.getContext("2d", { willReadFrequently: true });
      const tick = () => {
        if (v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; x.drawImage(v, 0, 0); const r = jsQR(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
          if (r?.data) { stop(); haptic("success"); onScanned(r.data.trim()); return; } }
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (_) { stop(); toast("Allow the camera to scan a QR code.", "err"); }
  },
  txd: (el) => openPanel("txd", { i: el.dataset.i }),
  "txd-save": async (el) => { const n = ($("#panel [data-bookname]")?.value || "").trim(); if (!n) return toast("Give the contact a name.", "err"); const f = el.dataset.f; S.book[f] = { ...(S.book[f] || {}), [el.dataset.a]: n }; await local.set({ book: S.book }); toast(`Saved as ${n}`, "win"); renderPanel(); },
  "ct-add": async () => {
    const n = ($("[data-ctname]")?.value || "").trim(), a = ($("[data-ctaddr]")?.value || "").trim(), f = famOfAddr(a);
    S.panel.n = n; S.panel.a = a;
    if (!n) return toast("Give the contact a name.", "err"); if (!f) return toast("That isn't a Solana, Ethereum, Tron or Sui address.", "err");
    S.book[f] = { ...(S.book[f] || {}), [a]: n }; await local.set({ book: S.book }); S.panel.n = S.panel.a = ""; toast(`${n} added`, "win"); renderPanel();
  },
  "ct-del": async (el) => { const f = el.dataset.f, a = el.dataset.a, n = S.book?.[f]?.[a]; if (!(await ask(`Delete ${n} from your contacts?`, { ok: "Delete", danger: true }))) return; delete S.book[f][a]; await local.set({ book: S.book }); renderPanel(); },
  report: async () => { S.stats = (await local.get("stats")).stats || {}; await loadActivity(); openPanel("report", { month: monthKey() }); },
  "rp-m": (el) => { if (!el.dataset.v) return; S.panel.month = el.dataset.v; renderPanel(); },
  "reveal-bio": async () => { try { const words = await bioUnlock(S.bio); S.panel.words = normalize(words); renderPanel(); } catch (e) { toast(`${bioName()} didn't work. Use your password.`, "err"); } },
  cur: async (el) => { S.cur = el.dataset.v; await local.set({ cur: S.cur }); await loadFx(); toast(S.cur === "USD" || S.fx?.[S.cur] ? `Showing ${S.cur}` : `Couldn't get today's ${S.cur} rate. Showing USD until it loads.`, S.cur === "USD" || S.fx?.[S.cur] ? "win" : ""); renderPanel(); render(); },
  lang: async (el) => { S.lang = el.dataset.v; document.documentElement.lang = S.lang; await local.set({ lang: S.lang }); render(); renderPanel(); },
  "tour-prev": () => { if (S.tour > 0) { S.tour--; S.tourDir = "back"; render(); } },
  "tour-next": () => { S.tourDir = "fwd"; S.tour = (S.tour || 0) + 1; if (S.tour >= TOUR.length) { local.set({ toured: true }); S.askGoal = true; } render(); },
  "tour-skip": () => { S.tour = TOUR.length; S.askGoal = true; local.set({ toured: true }); render(); },
  goal: async (el) => { const v = el.dataset.v; S.askGoal = false; if (v !== "skip") { S.goal = v; await local.set({ goal: v }); } render(); },
  guard: async (el) => {
    const G = S.guard, k = el.dataset.k, v = Number(el.dataset.v);
    if (k === "daily" && G.daily && (v === 0 || v > G.daily)) { G.pend = { v, at: Date.now() + 86400_000 }; toast("Raising the limit takes 24 hours. Lowering is instant.", "win"); }
    else { G[k] = v; if (k === "daily") delete G.pend; }
    await saveGuard(); renderPanel(); render();
  },
  "freeze-now": async (el) => {
    const safes = (S.all || []).filter((r) => r.v);
    if (!safes.length) return toast("Set up your Safe first: there's nothing to freeze yet.", "err");
    if (!(await ask("Nothing can leave your Safe on any network for 24 hours, including withdrawals already waiting. A freeze can't be ended early.", { title: "Freeze your Safe?", ok: "Freeze for 24 hours", danger: true }))) return;
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
  dd: () => { S.panel.dd = !S.panel.dd; renderPanel(); },
  "dd-pick": (el) => { S.panel.net = el.dataset.n; S.panel.dd = false; S.panel.lastKey = null; S.panel.sKey = null; S.panel.res = null; S.panel.info = null; renderPanel(); previewTok(); },
  "tok-pick": (el) => { const P = S.panel, t = (P.res || []).find((x) => x.address === el.dataset.a); if (!t) return;
    P.picked = t; P.addr = t.address; const inp = $("#panel [data-taddr]"); if (inp) inp.value = t.address; previewTok(); },
  "tok-add": async () => {
    const P = S.panel, evm = netKeys().filter((n) => NETS[n].fam === "evm"), k = evm.includes(P.net) ? P.net : evm.includes(S.net) ? S.net : evm[0];
    if (!P.info?.symbol) return toast("Pick a token or paste its contract address first.", "err");
    P.busy = true; P.net = k; renderPanel();
    try {
      const { dev } = await local.get("dev");
      const info = P.info;
      const list = S.tokList[k] || [], same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();
      if (same(info.mint, NETS[k].usdc)) throw new Error(`USDC is already in your wallet on ${NETS[k].name}.`);
      if (list.some((t) => same(t.mint, info.mint))) throw new Error("You already follow this token.");
      S.tokList = { ...S.tokList, [k]: [...list, info] }; await local.set({ tokList: S.tokList });
      toast(`${info.symbol} added`); closePanel(); loadExtras(dev);
    } catch (e) { S.panel.busy = false; renderPanel(); toast(/already (follow|in your wallet)/.test(e.message) ? e.message : "Couldn't read a token at that address on this network.", "err"); }
  },
  xsend: async () => {
    const P = S.panel, t = (S.extra || []).find((x) => x.mint === P.m && x.k === P.n);
    P.to = ($("[data-xto]")?.value || "").trim(); P.amount = ($("[data-xamt]")?.value || "").trim().replace(",", ".");
    const { dev } = await local.get("dev"); const e = engine({ web3, ethers, acct: ACCT, net: t.k, dev: dev || {} });
    if (!e.isAddress(P.to)) return toast(`That isn't a ${NETS[t.k].name} address.`, "err");
    const v = Number(P.amount); if (!(v > 0) || !/^\d*\.?\d*$/.test(P.amount)) return toast("Enter an amount.", "err");
    const [w, f = ""] = P.amount.split("."); if (f.length > t.dec) return toast(`This token has ${t.dec} decimals at most.`, "err");
    const raw = BigInt(w || "0") * 10n ** BigInt(t.dec) + BigInt((f + "0".repeat(t.dec)).slice(0, t.dec) || "0");
    if (raw > BigInt(t.raw)) return toast("You don't have that much.", "err");
    P.raw = String(raw); P.fresh = !(await knownDest(P.to)); P.lookalike = P.fresh ? await lookalikeOf(P.to) : null; P.step = "review"; renderPanel();
  },
  "x-back": () => { S.panel.step = "form"; renderPanel(); },
  "acct-switch": (el) => el.dataset.id === S.sel ? closePanel() : switchAccount(el.dataset.id),
  "acct-edit": (el) => { S.panel.edit = S.panel.edit === el.dataset.id ? null : el.dataset.id; renderPanel(); setTimeout(() => $("[data-acct-name]")?.select(), 30); },
  "acct-logo": async (el) => {
    const d = el.dataset; haptic();
    S.accts = (S.accts || DEF_ACCTS).map((a) => (a.id === d.id ? { ...a, logo: { ...(a.logo || {}), s: d.s, ...(d.v ? { v: +d.v } : {}), ...(d.c ? { c: +d.c } : {}) } } : a));
    await saveAccts(); renderPanel(); render();
  },
  "acct-save": async (el) => {
    const v = ($("[data-acct-name]")?.value || "").trim().slice(0, 24); if (!v) return toast("Give the account a name.", "err");
    S.accts = (S.accts || DEF_ACCTS).map((a) => (a.id === el.dataset.id ? { ...a, name: v } : a)); await saveAccts(); S.panel.edit = null; renderPanel(); render();
  },
  "acct-remove": async (el) => {
    const a = S.accts.find((x) => x.id === el.dataset.id); if (!a) return;
    if (a.kind === "key" && !(await ask(`Its coins stay on the blockchain, but you'll need its private key to get them back.`, { title: `Remove ${a.name}?`, ok: "Remove", danger: true }))) return;
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
  "rc-apply": (el) => rcRun(el, "applyChange", "Rule applied"),
  "rc-cancel": (el) => rcRun(el, "cancelChange", "Change cancelled"),
  "al-tg": async () => { try { const r = await alertCall("/api/alerts/start", {}); if (!r.url) throw new Error(r.error || "Alerts aren't available right now."); window.open(r.url, "_blank"); S.alertsOn = true; local.set({ alertsOn: true }); toast("Telegram opened: tap Start in the chat.", "win"); } catch (e) { toast(e.message, "err"); } },
  "al-mail": async () => { const email = ($("#panel [data-mail]")?.value || "").trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("Enter your email address", "err"); try { const r = await alertCall("/api/alerts/email", { email }); if (r.error) throw new Error(r.error); S.alertsOn = true; local.set({ alertsOn: true }); toast(r.already ? "Email alerts are already on." : "Check your inbox to confirm.", "win"); } catch (e) { toast(e.message, "err"); } },
  tok: (el) => { S.tkDrawKey = null; if (el.isConnected && !S.panel) { const r = el.getBoundingClientRect(), pr = $("#panel").getBoundingClientRect(); S.grow = { x: r.left + r.width / 2 - pr.left, y: r.top + r.height / 2 - pr.top }; } const u = el.dataset.u, cg = u === "USDC" ? null : { SOL: "solana", ETH: "ethereum", HYPE: "hyperliquid", POL: "polygon-ecosystem-token", BNB: "binancecoin", AVAX: "avalanche-2", TRX: "tron", SUI: "sui" }[u]; openPanel("tok", { u, cg, n: el.dataset.n }); if (cg) loadSeriesFor(cg).then(() => S.panel?.p === "tok" && renderPanel()); },
  "tok-do": async (el) => { const P = S.panel, w = worth(), list = w.items.filter((i) => i.unit === P.u), p = el.dataset.p;
    const best = list.filter((i) => (p === "withdraw" ? i.sav : i.chq) > 0).sort((x, y) => (y.usd || 0) - (x.usd || 0))[0] || list[0];
    const k = best?.k || P.n || (P.u === "SOL" ? "sol" : P.u === "POL" ? "pol" : "eth"), a = P.u === "USDC" ? "usdc" : "native";
    await useNet(k); openPanel(p, { a }); if (p === "send" || p === "protect" || p === "swap") { const e = await eng(); S.panel.reserve = await e.reserve(a); renderPanel(); } },
  "mkt-all": () => { S.mktAll = !S.mktAll; render(); },
  "pick-grp": (el) => { const g = el.dataset.g; S.panel.openG = S.panel.openG === g ? null : g; patchPanel ? patchPanel() : renderPanel(); },
  "pick-coin": () => { const P = S.panel; if (!P) return; pushPanel("pick"); S.panel = { p: "pick", back: P.p, step: "form" }; renderPanel(); },
  "pick-go": async (el) => { await useNet(el.dataset.n); S.panel = null; openPanel(el.dataset.p, { a: el.dataset.a }); if (el.dataset.p !== "receive" && el.dataset.p !== "withdraw") { const e = await eng(); S.panel.reserve = await e.reserve(S.panel.asset); renderPanel(); } },
  grp: (el) => { S.open = { ...(S.open || {}), [el.dataset.u]: !S.open?.[el.dataset.u] }; render(); },
  wn: (el) => { S.wn = Number(el.dataset.n); render(); },
  "book-pick": (el) => { S.panel.to = el.dataset.a; renderPanel(); },
  "send-to": (el) => { const P = S.panel; P.to = el.dataset.a; P.named = null; P.whoDone = true; P.anim = true; renderPanel(); },
  "send-who": () => { const P = S.panel; P.whoDone = false; P.anim = false; renderPanel(); },
  "send-confirm": () => confirmSend(),
  // Early-access Safe on Base: turn it on (once, with the warning), then go to Base with your coins there.
  "early-on": async () => {
    if (!S.earlySafe) {
      if (!confirm("Turn on the Safe on Base?\n\nIt holds real coins and has not been audited yet. A bug could lock what you put in. Only use amounts you could lose.")) return;
      S.earlySafe = true; await local.set({ earlySafe: true }); S.all = null; loadAll();
    }
    const safeNets = netKeys().filter(canSafe);
    if (!safeNets.length) {
      const why = ACCT?.only ? `This account only has ${ACCT.only === "sol" ? "a Solana" : ACCT.only === "evm" ? "an Ethereum" : "one network's"} address, and the Safe on Base needs an Ethereum address. Add an account from your recovery phrase in Settings → Accounts.` : `Base isn't among this account's networks (${netKeys().length} found, mode ${S.mode || DEFAULT_MODE}).`;
      return toast(why, "err");
    }
    const w = worth(), best = w.items.filter((i) => canSafe(i.k) && i.chq > 0).sort((x, y) => (y.usd || 0) - (x.usd || 0))[0], nk = best?.k || safeNets[0];
    if (nk !== S.net) await useNet(nk);
    if (S.panel) { if (best) S.panel.asset = best.a; const e = await eng(); S.panel.reserve = await Promise.resolve().then(() => e.reserve(S.panel.asset)).catch(() => 0); }
    renderPanel(); render();
  },
  "book-save": async () => { const n = ($("#panel [data-bookname]")?.value || "").trim(); if (!n) return; const f = NETS[S.net].fam; S.book[f] = { ...(S.book[f] || {}), [S.panel.to.trim()]: n }; await local.set({ book: S.book }); toast(`Saved as ${n}`, "win"); renderPanel(); },
  "share-addr": async () => { try { await navigator.share({ title: "My " + NETS[S.net].name + " address", text: ENG.address }); } catch (_) {} },
  "ob-hide": async () => { S.obHide = true; await local.set({ obHide: true }); render(); },
  "go-limit": async () => {
    if (S.panel?.p !== "safety") { openPanel("safety"); await wait(380); }
    const h = document.querySelector('#panel [data-sec="limit"]'); if (!h) return;
    h.scrollIntoView({ behavior: "smooth", block: "start" }); h.classList.remove("flash-sec"); void h.offsetWidth; h.classList.add("flash-sec");
  },
  tog: async (el) => {
    const k = el.dataset.k;
    if (k === "order") S.order = S.order === "name" ? "value" : "name";
    else if (k === "recvNotify") {
      const blocked = globalThis.ECRIN_WEB && window.Notification && Notification.permission === "denied";
      S.recvNotify = !(S.recvNotify !== false && !blocked); await local.set({ recvNotify: S.recvNotify }); renderPanel(); // flips what you see, at once
      if (S.recvNotify && globalThis.ECRIN_WEB && window.Notification) {
        const perm = Notification.permission === "default" ? await Notification.requestPermission().catch(() => "denied") : Notification.permission;
        if (perm !== "granted") { S.recvNotify = false; toast("Notifications are blocked for Ecrin. Allow them in your phone's settings, then try again.", "err"); }
      }
    }
    else if (k === "earlySafe" && !S.earlySafe && !confirm("Turn on the Safe on Base?\n\nIt holds real coins and has not been audited yet. A bug could lock what you put in. Only use amounts you could lose.")) return;
    else S[k] = !S[k];
    if (k === "earlySafe") {
      S.all = null; loadAll();
      // Turned on from Protect: go straight to the network that has the Safe (Base), with your coins there if any.
      if (S.earlySafe && S.panel && ["protect", "withdraw"].includes(S.panel.p) && !canSafe(S.net)) {
        const w = worth(), best = w.items.filter((i) => canSafe(i.k) && i.chq > 0).sort((x, y) => (y.usd || 0) - (x.usd || 0))[0];
        const nk = best?.k || netKeys().find(canSafe); if (nk) { await useNet(nk); if (best) S.panel.asset = best.a; const e = await eng(); S.panel.reserve = await Promise.resolve().then(() => e.reserve(S.panel.asset)).catch(() => 0); }
      }
    }
    if (k === "showNfts" && !S.showNfts && S.tab === "nfts") S.tab = "tokens";
    await local.set({ [k]: S[k] }); renderPanel(); render();
  },
  "push-toggle": async () => {
    if (S.pushBusy) return; S.pushBusy = true; renderPanel();
    try { if (S.pushOn) { await pushStop(); toast("Safe alerts are off on this phone."); } else { await pushStart(); toast("Safe alerts are on. You'll see a withdrawal the moment it starts.", "win"); } }
    catch (e) { toast(e.message, "err"); }
    S.pushBusy = false; renderPanel();
  },
  "upd-hide": async () => { await local.set({ updHide: S.upd?.latest }); S.upd = null; render(); },
  "upd-go": () => { if (globalThis.ECRIN_WEB) location.reload(); else window.open("https://chromewebstore.google.com/detail/ecrin-wallet/nmehcocofmbhkjgjhbhbnfmhcbjpcpbd", "_blank"); },
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
    if (S.bio) { if (!(await ask("You'll unlock with your password.", { title: `Turn off ${bioName()}?`, ok: "Turn off" }))) return; await local.remove("bio"); await bioForget(); S.bio = null; toast(`${bioName()} is off`, "win"); return renderPanel(); }
    try { const { phrase } = await session.get("phrase"); const box = await bioEnable(phrase); await local.set({ bio: box }); S.bio = box; toast(`${bioName()} is on`, "win"); renderPanel(); }
    catch (e) { if (e?.name !== "NotAllowedError") toast(e?.message || `Couldn't turn on ${bioName()}`, "err"); }
  },
  "swap-flip": () => { const P = S.panel; [P.from, P.to] = [P.to, P.from]; P.amount = ""; P.pct = null; P.flipped = true; P.quote = null; renderPanel(); },
  "swap-pick": (el) => { const P = S.panel; P.pick = el.dataset.v; P.sq = ""; P.found = []; renderPanel(); },
  "swap-choose": async (el) => {
    const P = S.panel, c = { ...(el.dataset.src === "h" ? swapCoins()[Number(el.dataset.i)] : P.found[Number(el.dataset.i)]) };
    if (c.dec == null) { c.dec = await swapEng().decimals?.(c.mint).catch(() => null); if (!Number.isInteger(c.dec)) return toast("Couldn't read this token. Try another.", "err"); }
    c.raw ||= "0"; P[P.pick] = c; P.pick = null; P.amount = ""; P.pct = null; P.quote = null; renderPanel();
  },
  "swap-pct": (el) => { const P = S.panel, p = BigInt(el.dataset.v), m = swapMaxRaw(P.from), u = (m * p) / 100n; P.pct = Number(p); P.amount = u ? String(fromRaw(u, P.from.dec)) : ""; swapQuoteSoon(0); },
  "swap-review": () => { const P = S.panel; if (!P.quote) return; P.step = "review"; renderPanel(); },
  "br-pick": (el) => { S.panel.pick = el.dataset.v; renderPanel(); },
  "br-set": (el) => { const P = S.panel, k = el.dataset.k, v = el.dataset.v; if (k === "coin") { if (P.coin !== v) { P.coin = v; P.amount = ""; P.pct = null; } } else { if (k === "from" && v === P.to) P.to = P.from; P[k] = v; } P.pick = null; renderPanel(); bridgeQuoteSoon(0); },
  "br-pct": (el) => { const P = S.panel, m = brMax(P.from, P.coin), v = (m * Number(el.dataset.v)) / 100; P.pct = Number(el.dataset.v); P.amount = v > 0 ? String(Math.floor(v * 1e6) / 1e6) : ""; renderPanel(); bridgeQuoteSoon(0); },
  "br-flip": () => { const P = S.panel; [P.from, P.to] = [P.to, P.from]; P.amount = ""; P.pct = null; P.quote = null; renderPanel(); },
  "br-review": () => { const P = S.panel; if (!P.quote) return; P.step = "review"; renderPanel(); },
  "br-back": () => { S.panel.step = "form"; renderPanel(); },
  "br-go": () => bridgeNow(),
  "swap-sol": async () => { await useNet(SWAP_NET); openPanel("swap"); const e = await eng(); S.panel.reserve = await e.reserve("native"); renderPanel(); },
  "ap-ok": async (el) => {
    const R = S.req; if (!R || R.busy) return;
    if (R.kind === "connect" && S.guard.bet && isBetting(R.site?.host) && !(await betCheck(R.site.host))) return actions["ap-no"]();
    if (S.upd?.must) { R.err = "A security update is required before you can sign. Update Ecrin Wallet first."; return render(); }
    R.busy = true; render();
    if (R.wc) { try { await wcOk(R); } catch (e) { R.busy = false; R.err = e?.shortMessage || e?.message || String(e); render(); } return; }
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
  "ap-no": async () => { if (S.req?.wc) return wcNo(S.req); await chrome.runtime.sendMessage({ type: "approval-done", id: S.req?.id, ok: false }).catch(() => {}); window.close(); },
  "ap-risk": () => { S.req.risk = !S.req.risk; render(); },
  "site-off": async (el) => { await chrome.runtime.sendMessage({ type: "site-disconnect", origin: el.dataset.o }); toast("Disconnected", "win"); renderPanel(); loadSites(); },
  "lists-refresh": async (el) => { el.disabled = true; const r = await chrome.runtime.sendMessage({ type: "lists-refresh" }).catch(() => null); toast(r ? `Updated: ${r.count.toLocaleString("en-US")} scam sites` : "Couldn't download the lists right now", r ? "win" : "err"); loadSites(); },
  "start-create": () => { S.setupFlow = FULL; go("createPw", { phrase: newPhrase(), revealed: false, wrote: false }); },
  "start-import": () => { S.setupFlow = FULL; go("importPhrase"); },
  "open-full": () => openFull(),
  "stay-popup": () => { S.stayPopup = true; render(); },
  "ready-go": () => home(),
  // The toolbar popup, opened for you (Chrome 127+); older Chrome: say where it lives.
  "open-popup": async () => {
    try { await chrome.action.openPopup(); setTimeout(() => window.close(), 300); }
    catch (_) { toast("Click the Ecrin icon in your toolbar to open the popup.", "win"); }
  },
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
  "finish-create": async () => { S.busy = true; render(); await saveWallet(S.phrase, S.pw); await local.set({ backup: { at: Date.now(), done: false } }); S.busy = false; S.phrase = S.pw = null; S.offerBio = true; home(); },
  // Skipping the check: the wallet opens now, and the "Check your backup" card comes back tomorrow until it's done.
  "verify-later": async () => { S.busy = true; render(); await saveWallet(S.phrase, S.pw); await local.set({ backup: { at: Date.now() - (BK_DAYS - 1) * 86400_000, done: false } }); S.busy = false; S.phrase = S.pw = null; S.offerBio = true; home(); },
  forgot: async () => { if (await ask("Without the password, the only way back in is your recovery phrase. Remove this wallet from this device and import it again?", { title: "Forgot your password?", ok: "Remove and re-import", danger: true })) forget(); },
  copy: async (el) => {
    await navigator.clipboard.writeText(el.dataset.v);
    if (!el.classList.contains("ad-copy") && copied(el)) return;
    if (el.classList.contains("ad-copy")) { const t = el.querySelector("span"); el.classList.add("ok"); t.textContent = S.lang === "fr" ? "Copiée" : "Copied"; clearTimeout(el._t); el._t = setTimeout(() => { el.classList.remove("ok"); t.textContent = S.lang === "fr" ? "Copier l'adresse" : "Copy address"; }, 1600); navigator.vibrate?.(8); }
    else toast("Address copied", "win");
  },
  "qr-for": async (el) => { if (el.dataset.n !== S.net) { S.net = el.dataset.n; await local.set({ net: S.net }); S.bal = null; S.vault = undefined; ENG = null; await eng(); refresh(); } S.panel = { p: "receive", step: "form", asset: "native", amount: "", to: "" }; renderPanel(); },
  "copy-addr": async (el) => { await navigator.clipboard.writeText(ENG.address); if (!copied(el)) toast("Address copied", "win"); },
  hide: async () => { S.hide = !S.hide; await local.set({ hide: S.hide }); render(); if (S.panel) renderPanel(); },
  panel: async (el) => {
    const p = el.dataset.p;
    if (["send", "protect", "withdraw"].includes(p) && !S.panel) {
      // Protect and Withdraw only make sense where a Safe can live (on mainnet: Base, in early access).
      const ok = (k) => p === "send" || canSafe(k), w = worth(), here = ok(S.net) ? w.items.filter((i) => i.k === S.net && (p === "withdraw" ? i.sav : i.chq) > 0) : [];
      const best = w.items.filter((i) => ok(i.k) && (p === "withdraw" ? i.sav : i.chq) > 0).sort((x, y) => (y.usd || 0) - (x.usd || 0))[0];
      if (!here.length && best && best.k !== S.net) { await useNet(best.k); el = { dataset: { p, a: best.a } }; }
      else if (!ok(S.net)) { const k = netKeys().find(canSafe); if (k) await useNet(k); }
    }
    if (S.panel && p !== S.panel.p) { pushPanel(p); S.panel = { p, step: "form", asset: el.dataset.a || "native", amount: "", to: "", k: el.dataset.k }; renderPanel(); }
    else openPanel(p, { a: el.dataset.a, k: el.dataset.k });
    if (p === "send" || p === "protect" || p === "swap") { const e = await eng(); S.panel.reserve = await e.reserve(S.panel.asset); renderPanel(); }
    if (p === "all" || p === "vault" || p === "rules") loadAll();
    if (p === "sites") loadSites();
  },
  settings: () => openPanel("settings"),
  close: () => goBack(),
  asset: async (el) => { const P = S.panel; P.asset = el.dataset.a; P.amount = ""; P.pct = null; P.reserve = await (await eng()).reserve(P.asset); renderPanel(); },
  key: (el) => {
    const P = S.panel, k = el.dataset.k, x = A(P.asset); let v = P.amount || "";
    if (k === "del") v = v.slice(0, -1);
    else if (k === ".") { if (!v.includes(".")) v = (v || "0") + "."; }
    else { const d = v.split(".")[1]; if (d != null && d.length >= Math.min(x.dec, 6)) return; v = v === "0" ? k : v + k; if (v.replace(".", "").length > 12) return; }
    P.amount = v; P.pct = null; haptic("light"); patchPanel();
  },
  pct: (el) => {
    const P = S.panel, p = Number(el.dataset.v), a = P.asset;
    const max = P.p === "earn" ? stakeMax(P) : P.p === "send" || P.p === "swap" ? sendMax() : P.p === "protect" ? sendMaxProtect() : (a === "usdc" ? S.vault?.usdc?.available : S.vault?.main?.available) || 0;
    const units = Math.floor((max * p) / 100), x = A(a);
    P.pct = p; P.amount = units ? String(Math.floor((units / x.base) * 10 ** x.dec) / 10 ** x.dec) : "";
    patchPanel();
  },
  paste: async () => { try { S.panel.to = (await navigator.clipboard.readText()).trim(); renderPanel(); } catch (_) { toast("Couldn't read the clipboard", "err"); } },
  review: async () => {
    if (S.panel.named?.addr && S.panel.named.name === S.panel.to.trim()) { S.panel.toName = S.panel.named.name; S.panel.to = S.panel.named.addr; }
    const P = S.panel, usd = usdOf(parseAmt(P.amount, P.asset), P.asset);
    const lim = await limitCheck(usd); if (lim) return toast(lim, "err");
    P.fresh = !(await knownDest(P.to.trim())); P.lookalike = P.fresh ? await lookalikeOf(P.to.trim()) : null; P.step = "review"; P.anim = true;
    const G = S.guard; P.coolUntil = G.cool && usd != null && usd >= G.coolOver ? Date.now() + G.cool * 1000 : 0; if (P.coolUntil) bump("cool");
    renderPanel(); if (P.coolUntil) coolTick();
  },
  kind: (el) => { S.panel.kind = el.dataset.k; renderPanel(); },
  "create-vault": async () => {
    const P = S.panel, back = P.p;
    await txRun(async () => { const r = await openSafeEverywhere(P.kind || "strong"); P.opened = r; }, null, { t: "vault" });
    if (P.opened?.done?.length > 1) toast(P.opened.skipped.length ? `Your Safe is open on ${P.opened.done.length} networks. ${P.opened.skipped.map((k) => NETS[k].name).join(", ")} opens with your first deposit there.` : "Your Safe is open on every network.", "win");
    // Opened from Protect: carry straight on to protecting, no detour through a done screen.
    if (back === "protect" && S.panel === P && P.step === "done") { P.step = "form"; if (!(P.opened?.done?.length > 1)) toast("Your Safe is open", "win"); const e = await eng(); P.reserve = await e.reserve(P.asset); renderPanel(); }
  },
  "do-protect": () => { const P = S.panel, units = parseAmt(P.amount, P.asset); if (!units) return; P.sent = units;
    txRun(async () => { const e = await eng(); if (!S.vault) { await e.createVault(safeKind() || "strong"); S.vault = await e.vault().catch(() => null) || S.vault; await syncRulesTo(S.net, e); } return e.protect(P.asset, units); }, null, { t: "protect", a: P.asset, n: units }); },
  "safe-pick": (el) => { openPanel("pick", { back: el.dataset.p }); },
  faucet: async (el) => {
    const N = NETS[S.net]; if (N.key !== "sol" || !ENG?.address) return window.open(N.faucet, "_blank");
    if (S.fauBusy) return; S.fauBusy = true;
    const btn = el?.closest("button"), was = btn?.innerHTML; if (btn) { btn.classList.add("busy"); btn.innerHTML = `<i class="spin"></i>${esc(trText("Sending test coins…", S.lang))}`; }
    try {
      const r = await fetch(FAUCET_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: String(ENG.address) }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { haptic("success"); toast(`${j.sol} test SOL is on its way`, "win"); setTimeout(refresh, 2500); setTimeout(() => { refresh(); loadAll(); }, 8000); }
      // Ecrin's faucet is empty, paused or busy: Solana's own faucet always works (sign in with GitHub there).
      else if (r.status >= 500 || j.busy) { toast(`${j.error ? j.error + " " : ""}Opening Solana's faucet instead: paste your address there.`, "err"); try { await navigator.clipboard.writeText(String(ENG.address)); } catch (_) {} window.open(N.faucet, "_blank"); }
      else toast(j.error || "Couldn't get test coins. Try again in a minute.", "err");
    } catch (_) { toast("Couldn't reach Ecrin. Check your connection and try again.", "err"); }
    finally { S.fauBusy = false; if (btn?.isConnected) { btn.classList.remove("busy"); btn.innerHTML = was; } }
  },
  "do-withdraw": async () => { const P = S.panel;
    if (S.guard.late && isLate() && !P.lateOk) {
      const c = await choose({ icon: I.moon, title: "It's late.", text: careP("Your Safe will hold this until you're sure. If you still want it in the morning, it'll be here."), safe: "Sleep on it", go: "Start anyway", fine: "Shown between midnight and 6 AM. Change it in Settings → Safety." });
      if (c !== "go") { closePanel(); toast("Your Safe has it. Sleep well.", "win"); return; }
      P.lateOk = true;
    }
    if (P.step !== "review") { P.step = "review"; renderPanel(); return; } // look it over first
    const units = parseAmt(P.amount, P.asset), dest = P.dest || ENG.address; P.sent = units; P.step = null;
    txRun(async () => (await eng()).request(P.asset, dest, units), null, { t: "withdraw", a: P.asset, n: units }); },
  "wd-to": () => { const P = S.panel; P.to = P.dest || ""; P.step = "to"; renderPanel(); setTimeout(() => $("#panel [data-wdto]")?.focus(), 60); },
  "wd-to-ok": () => { const P = S.panel, v = String(P.to || "").trim();
    if (!v) { P.dest = null; P.step = null; renderPanel(); return; }
    if (!ENG?.isAddress(v)) return toast(`That isn't a ${addrHint(NETS[S.net])}.`, "err");
    const k = ENG.key?.(v) || v;
    P.dest = mineAddr(k) ? null : String(k); P.step = null; renderPanel(); },
  "wd-mine": () => { const P = S.panel; P.dest = null; P.to = ""; P.step = null; renderPanel(); },
  "bug-send": async () => {
    const P = S.panel; if (P.busy) return;
    if (String(P.text || "").trim().length < 5) { const keep = S.lastErr; toast("Tell us a little more about what happened.", "err"); S.lastErr = keep; return; }
    P.busy = true; renderPanel();
    try {
      const r = await fetch(REPORT_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: P.k === "support" ? "support" : "report", text: P.text, contact: P.who || "", info: bugInfo() }) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Couldn't send it. Try again in a minute.");
      P.sent = true; haptic("success");
    } catch (e) { toast(e.message || "Couldn't reach Ecrin. Check your connection and try again.", "err"); }
    P.busy = false; renderPanel();
  },
  "wd-pick": (el) => { const P = S.panel; P.to = el.dataset.a; renderPanel(); },
  "wd-back": () => { const P = S.panel; P.step = null; renderPanel(); },
  "safe-go": async (el) => { el.disabled = true; await useNet(el.dataset.n); openPanel(el.dataset.p); if (el.dataset.p === "protect") { const e = await eng(); S.panel.reserve = await e.reserve(S.panel.asset); renderPanel(); } },
  "buy-pick": async (el) => { const k = el.dataset.n; BUY.coin = el.dataset.a === "usdc" ? "usdc" : "native"; if (k !== S.net) await useNet(k); renderPanel(); },
  "buy-coin": (el) => { BUY.coin = el.dataset.v === "usdc" ? "usdc" : "native"; renderPanel(); },
  "buy-go": async () => {
    if (BUY.busy) return;
    const tab = globalThis.chrome?.tabs?.create, w = tab ? null : window.open("", "_blank"); // a blank tab first, so phones don't block it
    BUY.busy = true; renderPanel();
    try {
      const N = NETS[S.net], sup = BUY.coins?.[S.net.replace(/m$/, "")] || { native: true, usdc: true }, q = new URLSearchParams({ net: S.net, addr: ENG.address, coin: N.usdc && sup.usdc && (BUY.coin === "usdc" || !sup.native) ? "usdc" : "native", lang: S.lang === "fr" ? "fr" : "en", theme: S.theme === "light" ? "light" : "dark" });
      const r = await fetch(`${BUY.api}?${q}`, { cache: "no-store" }), d = await r.json().catch(() => ({}));
      if (!r.ok || !/^https:\/\/buy(-sandbox)?\.moonpay\.com\//.test(d.url || "")) throw new Error(d.error || "MoonPay can't be reached right now. Try again in a moment.");
      if (tab) chrome.tabs.create({ url: d.url }); else if (w) w.location.href = d.url; else location.href = d.url;
    } catch (e) { w?.close(); toast(errText(e), "err"); }
    BUY.busy = false; renderPanel();
  },
  "earn-open": (el) => openPanel("earn", { k: el.dataset.n }),
  "earn-net": async (el) => { const P = S.panel, k = el.dataset.n; if (k === S.net) return; P.k = k; P.st = undefined; renderPanel(); await useNet(k); P.st = undefined; loadEarn(true); },
  "earn-stake": async () => { const P = S.panel; P.mode = "stake"; P.amount = ""; P.pct = null; P.asset = "native";
    P.reserve = await (await eng()).reserve("native"); P.src = sendMaxProtect() > 0 && !(P.v?.main?.available > sendMaxProtect()) ? "wallet" : "safe"; renderPanel(); },
  "earn-src": (el) => { const P = S.panel; P.src = el.dataset.v === "safe" ? "safe" : "wallet"; P.amount = ""; P.pct = null; patchPanel(); },
  "earn-unstake": (el) => { const P = S.panel; if (!el.dataset.id) return; P.mode = "unstake"; P.id = el.dataset.id; renderPanel(); },
  "do-stake": () => { const P = S.panel, units = parseAmt(P.amount, "native"), from = P.src || "safe"; if (!units || units > stakeMax(P)) return;
    P.kind = "stake"; P.sent = units;
    txRun(async () => { const e = await eng();
      if (from === "wallet" && !S.vault && !P.v) { await e.createVault(safeKind() || "strong"); S.vault = await e.vault().catch(() => null) || S.vault; await syncRulesTo(S.net, e); }
      return e.staking.stake(units, from); }, () => { P.mode = "home"; P.st = undefined; }, { t: "stake", a: "native", n: units }); },
  "do-unstake": () => { const P = S.panel, x = (P.st?.items || []).find((y) => String(y.id) === String(P.id)); if (!x) return;
    P.kind = "unstake"; P.sent = x.amount; txRun(async () => (await eng()).staking.unstake(x), () => { P.mode = "home"; P.st = undefined; }, { t: "unstake", a: "native", n: x.amount }); },
  "earn-reclaim": (el) => { const P = S.panel, x = (P.st?.items || []).find((y) => String(y.id) === el.dataset.id); if (!x) return;
    const to = el.dataset.to === "wallet" ? "wallet" : "safe"; P.kind = to === "wallet" ? "reclaimW" : "reclaim"; P.sent = x.amount;
    txRun(async () => (await eng()).staking.reclaim(x, to), () => { P.mode = "home"; P.st = undefined; }, { t: to === "wallet" ? "withdraw" : "reclaim", a: "native", n: x.amount }); },
  "cancel-w": async (el) => {
    // Cancelling gets the same sheet as every other money move: live steps, then a clear receipt.
    const k = el.dataset.n, a = el.dataset.a, id = Number(el.dataset.id), N = NETS[k];
    const row = openRows().find((r) => r.k === k), list = a === "usdc" ? row?.v.usdc?.withdrawals : row?.v.main.withdrawals;
    const w = (list || []).find((x) => x.id === id) || { amount: 0, dest: "" };
    S.panel = { p: "kept", k, a, id, amount: w.amount, dest: String(w.dest || ""), step: "sending" };
    const P = S.panel; motionStart(P, STEPS(N, "Kept in your Safe")); renderPanel(true);
    try {
      await useNet(k); const sig = await (await eng()).cancel(a, id); P.sig = typeof sig === "string" ? sig : P.sig; motionEnd(P);
      await logActivity({ t: "cancel", a, sig: P.sig }); P.step = "done"; haptic("success");
      renderPanel(); refresh().then(() => { loadActivity(); loadAll(); });
    } catch (e) { txEvents.sent = null; closePanel(); toast(errText(e), "err"); }
  },

  execute: async (el) => { try { el.disabled = true; await useNet(el.dataset.n); await (await eng()).execute(el.dataset.a, Number(el.dataset.id), el.dataset.d); await logActivity({ t: "release", a: el.dataset.a }); loadActivity(); toast("Released to Wallet", "win"); await refresh(); loadAll(); } catch (e) { el.disabled = false; toast(errText(e), "err"); } },
  // Settings → Networks: Mainnet or Testnet. The same network family stays selected where it can (Solana ↔ Solana).
  "pw-eye": (el) => { const i = el.parentElement.querySelector("input"); const show = i.type === "password"; i.type = show ? "text" : "password"; el.innerHTML = show ? I.eyeOff : I.eye; el.setAttribute("aria-label", show ? "Hide password" : "Show password"); i.focus(); },
  "net-mode": async (el) => {
    const m = el.dataset.v; if (m === (S.mode || DEFAULT_MODE)) return;
    const was = NETS[S.net]; S.mode = m; await local.set({ netMode: m });
    // Apps connected through WalletConnect were given the other mode's networks: disconnect them, so none keeps
    // talking to the wrong one. They reconnect with a fresh code.
    local.get("wcOn").then(({ wcOn }) => (WC || wcOn) && wcClient().then(async (c) => { const list = c.sessions(); for (const x of list) await c.disconnect(x.topic).catch(() => {}); if (list.length) toast(`Disconnected ${list.length} app${list.length > 1 ? "s" : ""}. Reconnect them on ${m === "main" ? "Mainnet" : "Testnet"}.`); })).catch(() => {});
    const keys = netKeys(); S.net = keys.find((k) => NETS[k].name === was?.name) || keys[0]; await local.set({ net: S.net });
    Object.assign(S, { bal: null, vault: undefined, all: null, extra: null, hist: null, histAt: 0, activity: null, series: {}, drawChart: true, lzT0: 0 }); ENG = null;
    toast(m === "main" ? "Mainnet" : "Testnet: test coins with no value", m === "main" ? "" : "win");
    renderPanel(); await eng(); refresh(); loadAll(); loadActivity(); loadSeries();
  },
  net: async (el) => { S.net = el.dataset.n; await local.set({ net: S.net }); S.bal = null; S.vault = undefined; ENG = null; S.drawChart = true; closePanel(); await eng(); loadActivity(); refresh(); loadSeries(); },
  "row-send": async (el) => { if (el.dataset.n !== S.net) { S.net = el.dataset.n; await local.set({ net: S.net }); S.bal = null; S.vault = undefined; ENG = null; await eng(); loadActivity(); await refresh(); } openPanel("send", { a: el.dataset.a }); const e = await eng(); S.panel.reserve = await e.reserve(S.panel.asset); renderPanel(); },
  "net-go": async (el) => { if (el.dataset.n !== S.net) await actions.net(el); else closePanel(); },
  tab: async (el) => { if (S.tab !== el.dataset.t) { S.tabT0 = performance.now(); S.tabSynced = false; } S.tab = el.dataset.t; render(); if (S.tab === "activity") loadActivity(); },
  "range-next": async () => { const o = ["1", "7", "30", "365"]; S.range = o[(o.indexOf(S.range) + 1) % o.length]; await local.set({ range: S.range }); render(); loadSeries(); },
  range: async (el) => { S.range = el.dataset.d; await local.set({ range: S.range }); S.drawChart = true; render(); if (S.panel?.p === "tok") { renderPanel(); loadSeriesFor(S.panel.cg).then(() => S.panel?.p === "tok" && renderPanel()); } else loadSeries(); },
  num: async (el) => { S.nums[el.dataset.k] = el.dataset.v; applyNums(); await local.set({ nums: S.nums }); renderPanel(); render(); },
  autolock: async (el) => { S.autolock = Number(el.dataset.v); await local.set({ autolock: S.autolock }); await touch(); renderPanel(); },
  theme: async (el) => { S.theme = el.dataset.v; applyTheme(); await local.set({ theme: S.theme }); render(); renderPanel(); },
  lock: async () => { await session.clear(); chrome.runtime.sendMessage({ type: "lock" }).catch(() => {}); ACCT = ENG = null; S.panel = null; S.counted = false; S.entered = false; $("#panel").innerHTML = ""; $("#panel").classList.remove("in"); document.body.classList.remove("stacked"); go("unlock"); },
  forget: async () => { if (await ask("You'll need your recovery phrase to use it again. Your money stays on the blockchain.", { title: "Remove this wallet from this device?", ok: "Remove wallet", danger: true })) forget(); },
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
    if (b.__bound) return; b.__bound = true;
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
  P.step = "sending"; P.sig = null; motionStart(P, STEPS(NETS[t.k])); renderPanel();
  try {
    const sig = await e.sendToken(t, P.to, BigInt(P.raw)); P.sig = typeof sig === "string" ? sig : P.sig; motionEnd(P); await rememberDest(P.to); P.step = "done"; loadExtras(dev);
    const k = `act:${t.k}:${e.address}`, o = await local.get(k); await local.set({ [k]: [{ at: Date.now(), t: "tsend", to: P.to, n: Number(P.amount), sym: t.symbol || tokName(t), sig: P.sig }, ...(o[k] || [])].slice(0, 60) });
  }
  catch (err) { console.warn(err); txEvents.sent = null; P.mo = null; P.step = "review"; toast(errText(err), "err"); }
  renderPanel();
}
async function confirmSend() {
  if (S.panel?.p === "xtok") return xSendNow();
  if (S.panel?.p === "swap") return swapNow();
  const P = S.panel, units = parseAmt(P.amount, P.asset), to = P.to.trim();
  P.sent = units;
  const lim = await limitCheck(usdOf(units, P.asset)); if (lim) { P.step = "form"; renderPanel(); return toast(lim, "err"); }
  if (S.upd?.must) return toast("A security update is required before you can send. Update Ecrin Wallet first.", "err");
  // Like major wallets: the sheet closes as soon as you confirm, and a small Ecrin pill follows the transaction.
  const a = P.asset, net = S.net, nm = bookName(to), what = `${amt(units, a)} ${A(a).unit}`, who = nm || short(to), usd = usdOf(units, a);
  closePanel(); txPill("run", `Sending ${what}`, `to ${who}`);
  try {
    S.lastTx = Date.now(); const e = await eng(); const sig = await e.send(a, to, units, { speed: P.speed }); S.lastTx = Date.now();
    await rememberDest(to); await countSpend(usd); await logActivity({ t: "send", a, n: units, to, sig: typeof sig === "string" ? sig : null });
    if (S.bal && S.net === net) { const k = a === "usdc" ? "usdc" : "native"; S.bal = { ...S.bal, [k]: Math.max(0, Number(S.bal[k] || 0) - units) }; render(); }
    haptic("success"); txPill("ok", `Sent ${what}`, `to ${who}`, typeof sig === "string" && NETS[net].explorer ? NETS[net].explorer("tx", sig) : null);
    refresh().then(() => { loadActivity(); loadAll(); });
  } catch (err) { console.warn(err); txPill(null); toast(errText(err), "err"); }
}

/** The small confirmation after a send: Ecrin's diamond turns while it travels, then fills with a check. */
function txPill(state, title, sub, link) {
  let el = document.getElementById("txpill");
  if (!state) { el?.classList.remove("in"); return; }
  if (!el) { el = document.createElement("div"); el.id = "txpill"; el.className = "txpill"; el.setAttribute("role", "status"); (document.querySelector(".device") || document.body).append(el); }
  clearTimeout(el._t);
  el.className = `txpill ${state}`;
  el.innerHTML = `<span class="tp-ic">${state === "ok" ? dcheck("sm") : `<svg class="tp-spin" viewBox="0 0 40 40" aria-hidden="true"><rect x="11" y="11" width="18" height="18" rx="5" transform="rotate(45 20 20)"/></svg>`}</span>
    <span class="tp-t"><b>${esc(trText(title, S.lang))}</b><small>${esc(trText(sub, S.lang))}</small></span>${link ? `<a class="tp-l" href="${esc(link)}" target="_blank" rel="noopener">${esc(trText("View", S.lang))}</a>` : ""}`;
  requestAnimationFrame(() => el.classList.add("in"));
  if (state === "ok") el._t = setTimeout(() => el.classList.remove("in"), 4200);
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  if (el.tagName === "A") return;
  e.preventDefault();
  // 25% / 50% / Max fill the amount field: let go of it first (a phone keeps it focused), or the new amount can't show.
  if (/^(pct|swap-pct|br-pct|key)$/.test(el.dataset.act) && /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) document.activeElement.blur();
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
  if (t.matches("[data-taddr]")) { S.panel.addr = t.value; S.panel.picked = null; clearTimeout(S.tokT); const v = t.value.trim(); S.tokT = setTimeout(previewTok, ethers.isAddress(v) ? 60 : /^0x/i.test(v) ? 450 : 280); return; }
  if (t.matches("[data-actq]")) { S.actQ = t.value; const el = $("#actl"); if (el) { el.innerHTML = actRows(); translate(el, S.lang); } return; }
  if (t.matches("[data-amount]")) {
    const v = t.value.replace(/[^\d.,]/g, "").replace(",", "."), parts = v.split(".");
    S.panel.amount = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : v; S.panel.pct = null;
    const pos = t.selectionStart; if (t.value !== S.panel.amount) { t.value = S.panel.amount; try { t.setSelectionRange(Math.min(pos, t.value.length), Math.min(pos, t.value.length)); } catch (_) {} } patchPanel();
    if (S.panel.p === "swap") swapQuoteSoon();
  } else if (t.matches("[data-swapq]")) { swapSearch(t.value);
  } else if (t.matches("[data-reqamt]") || t.matches("[data-reqlabel]")) { const k = t.matches("[data-reqamt]") ? "amount" : "label", sel = k === "amount" ? "[data-reqamt]" : "[data-reqlabel]"; S.panel[k] = k === "amount" ? t.value.replace(/[^\d.,]/g, "").replace(",", ".") : t.value; const pos = t.selectionStart; patchPanel(); const n = $("#panel " + sel); if (n && document.activeElement !== n) n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {}
  } else if (t.matches("[data-to]") && (/^wc:/i.test(t.value.trim()) || parsePayLink(t.value))) { const v = t.value.trim(); t.value = ""; onScanned(v);
  } else if (t.matches("[data-to]")) { lookupTo(t.value); S.panel.to = t.value; patchPanel(); }
  else if (t.matches("[data-bramt]")) { const v = t.value.replace(",", ".").replace(/[^\d.]/g, ""); if (v !== t.value) t.value = v; S.panel.amount = v; S.panel.pct = null; bridgeQuoteSoon(); }
  else if (t.matches("[data-bugtext]")) S.panel.text = t.value;
  else if (t.matches("[data-bugwho]")) S.panel.who = t.value;
  else if (t.matches("[data-wdto]")) { S.panel.to = t.value; const ok = !t.value.trim() || !!ENG?.isAddress(t.value.trim()); t.closest(".fld")?.classList.toggle("bad-in", !ok); }
  else if (t.matches("[data-tick]")) { S.wrote = t.checked; const b = $("#root [data-act='to-verify']"); if (b) b.disabled = !(S.revealed && S.wrote); else render(); }
  else if (t.name === "pw" && t.closest("form")?.querySelector("[data-meter]")) { const m = t.closest("form").querySelector("[data-meter]"); m.dataset.s = strength(t.value); }
});

document.addEventListener("pointerdown", (e) => {
  const k = e.target.closest(".slide:not(.off) .sl-k"); if (!k) return;
  const sl = k.parentElement, act = sl.dataset.slide, max = sl.clientWidth - k.offsetWidth - 8, x0 = e.clientX; let dx = 0;
  e.preventDefault(); k.setPointerCapture(e.pointerId); sl.classList.add("drag");
  const move = (ev) => { dx = Math.max(0, Math.min(max, ev.clientX - x0)); k.style.transform = `translateX(${dx}px)`; sl.style.setProperty("--p", (dx / max).toFixed(3)); };
  const up = () => {
    k.removeEventListener("pointermove", move); k.removeEventListener("pointerup", up); k.removeEventListener("pointercancel", up); sl.classList.remove("drag");
    if (dx >= max * 0.9) { k.style.transform = `translateX(${max}px)`; sl.classList.add("done"); haptic("medium"); setTimeout(() => actions[act](), 160); }
    else { k.style.transform = ""; sl.style.setProperty("--p", 0); if (dx < 6) { sl.classList.remove("nudge"); void sl.offsetWidth; sl.classList.add("nudge"); } }
  };
  k.addEventListener("pointermove", move); k.addEventListener("pointerup", up); k.addEventListener("pointercancel", up);
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
    const lk = $("#root .lk2"), go = $("#root [data-unlock]"), x = $("[data-err]"), f = $("#root form");
    if (!d.pw) { if (x) x.textContent = "Enter your password"; f?.classList.remove("shake"); void f?.offsetWidth; f?.classList.add("shake"); return; }
    if (S.busy) return; S.busy = true;
    lk?.classList.remove("lk-bad"); lk?.classList.add("run"); if (x) x.textContent = ""; if (go) { go.disabled = true; go.innerHTML = `<i class="spin"></i>Unlocking…`; }
    try {
      const { box } = await local.get("box"); const phrase = await open(box, d.pw);
      lk?.classList.replace("run", "ok"); if (go) { go.classList.add("lk-done"); go.innerHTML = "Unlocked"; } haptic?.("success");
      await session.set({ phrase }); await useAccount(phrase); await touch(); S.pwTries = 0;
      await new Promise((r) => setTimeout(r, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 520));
      S.busy = false; AP.id ? startApproval() : home();
    } catch (_) {
      S.busy = false; S.pwTries = (S.pwTries || 0) + 1;
      if (S.pwTries === 3) { render(); }
      const lk2 = $("#root .lk2"), g2 = $("#root [data-unlock]"), x2 = $("[data-err]"), f2 = $("#root form"), i2 = $("#root [name=pw]");
      lk2?.classList.remove("run"); lk2?.classList.add("lk-bad"); if (g2) { g2.disabled = false; g2.textContent = "Unlock"; }
      if (x2) x2.textContent = S.pwTries >= 3 ? "That's not it either. Check Caps Lock, or use your recovery phrase." : "That password doesn't match. Try again.";
      f2?.classList.remove("shake"); void f2?.offsetWidth; f2?.classList.add("shake"); if (i2) { i2.select(); i2.focus(); }
    }
    return;
  }
  if (kind === "pkey") {
    try {
      const { box } = await local.get("box"); await open(box, d.pw);
      const A0 = curAcct(), keys = [];
      if (ACCT.sol) keys.push(["Solana", b58(ACCT.sol.secretKey)]);
      if (ACCT.evm) keys.push(["Ethereum-style networks", ACCT.evm.privateKey]);
      if (ACCT.tron && !ACCT.only) keys.push(["Tron", ACCT.tron.privateKey.slice(2)]);
      if (ACCT.sui && !ACCT.only) keys.push(["Sui", suiKeyHex(ACCT.sui)]);
      S.panel.keys = keys; renderPanel();
    } catch (_) { err("Wrong password."); }
    return;
  }
  if (kind === "reveal") {
    try { const { box } = await local.get("box"); S.panel.words = await open(box, d.pw); renderPanel(); } catch (_) { err("Wrong password"); }
  }
});

// Countdowns in the vault tick without a refetch.
setInterval(() => { if (S.panel?.p === "vault") renderPanel(); }, 30_000);
// Safe countdowns tick every second without re-rendering.
setInterval(() => {
  if (S.panel?.p !== "vault") return; const t = now() + (S.clockOff || 0);
  document.querySelectorAll("[data-until]").forEach((n) => { const s = Math.floor(Number(n.dataset.until) - t); n.textContent = s <= 0 ? "Ready" : clockTxt(s); });
  // the ring drains a little each second; a one-second linear transition joins the steps into one smooth motion
  document.querySelectorAll("[data-ru]").forEach((c) => { const f = Math.max(0, Math.min(1, (Number(c.dataset.ru) - t - 1) / Number(c.dataset.rd))); c.style.strokeDasharray = `${(f * 100).toFixed(3)} 100`; });
}, 1000);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.panel) closePanel(); });
// Lock screen: warn about Caps Lock while typing the password; typing again clears the red "wrong password" state.
for (const ev of ["keydown", "keyup"]) document.addEventListener(ev, (e) => {
  if (!e.target?.matches?.(".lk2 [name=pw]") || !e.getModifierState) return;
  const c = $("#root [data-caps]"); if (c) c.hidden = !e.getModifierState("CapsLock");
  if (ev === "keydown" && e.key !== "Enter") $("#root .lk2")?.classList.remove("lk-bad");
});

boot();

/* ------------------------------------------------------------------ what a scanned or pasted code is */
// A WalletConnect code connects a site; a payment link fills Send; anything else is taken as an address.
function onScanned(text) {
  if (/^wc:/i.test(text)) return wcPair(text);
  const pay = parsePayLink(text);
  if (pay) return openPay(pay);
  if (S.panel?.p === "send") { S.panel.to = text.replace(/^(solana|ethereum|tron|sui):/i, "").split(/[?@]/)[0].trim(); renderPanel(); }
}

/* ------------------------------------------------------------------ never stuck without fees */
// Sending a token (USDC, USDT) still costs a little of the network's own coin. If there isn't enough, say so before
// the send fails, and show where to get it.
function feeNeed(N, P) { return N.fam === "sol" ? 10_000 : N.fam === "tron" ? 15e9 : N.fam === "sui" ? 10_000_000 : Math.max(50_000, (P?.reserve || 0) * 3); }
function feeNote(a) {
  const N = NETS[S.net], P = S.panel;
  if (a === "native" || !S.bal || (S.bal.native || 0) >= feeNeed(N, P)) return "";
  return `<div class="fee-n">${I.warn}<span>Sending ${A(a).unit} on ${N.name} costs a little <b>${N.unit}</b> for the network fee, and this Wallet has ${S.bal.native ? "too little" : "none"}. ${faucetBtn(N, "")}</span></div>`;
}

/* ------------------------------------------------------------------ price alerts */
// A note when a coin you choose moves more than 5 or 10% in a day: once per coin, per direction, per day.
const ALERT_COINS = [["solana", "SOL"], ["ethereum", "ETH"], ["hyperliquid", "HYPE"], ["binancecoin", "BNB"], ["avalanche-2", "AVAX"], ["tron", "TRX"], ["sui", "SUI"], ["polygon-ecosystem-token", "POL"]];
async function checkPriceAlerts() {
  const al = S.palerts || {}; if (!Object.keys(al).length) return;
  const { palertSeen = {} } = await local.get("palertSeen"), day = new Date().toISOString().slice(0, 10); let any = false;
  for (const [cg, unit] of ALERT_COINS) {
    const lim = al[cg], ch = S.prices[cg]?.usd_24h_change; if (!lim || ch == null || Math.abs(ch) < lim) continue;
    const key = `${cg}:${ch > 0 ? "up" : "dn"}:${day}`; if (palertSeen[key]) continue;
    palertSeen[key] = 1; any = true;
    const text = `${unit} is ${ch > 0 ? "up" : "down"} ${Math.abs(ch).toFixed(1)}% today, now ${money(S.prices[cg].usd)}`;
    toast(text); if (document.hidden && window.Notification?.permission === "granted") try { new Notification("Ecrin Wallet", { body: text, icon: "/icon2-192.png" }); } catch (_) {}
  }
  if (any) local.set({ palertSeen });
}
function alertsView() {
  const al = S.palerts || {}, on = Object.values(al).filter(Boolean).length;
  const LOGO = { solana: "sol", ethereum: "eth", binancecoin: "bnb", "avalanche-2": "avax", tron: "tron", "polygon-ecosystem-token": "pol", hyperliquid: "hype", sui: "sui" };
  const canPush = !!window.Notification, pushOn = canPush && Notification.permission === "granted";
  return `${phead("Price alerts")}
    <div class="pa-hero"><span class="pa-ic">${I.spark}</span><b>${on ? `${on} alert${on > 1 ? "s" : ""} on` : "No alerts yet"}</b><small>Get a note when a coin moves more than you choose in a day. Once per coin and direction, each day.</small></div>
    <section class="list pa-list">${ALERT_COINS.map(([cg, unit]) => { const p = S.prices[cg], ch = p?.usd_24h_change, v = al[cg] || 0;
      return `<div class="arow pa-row"><span class="cstack">${coin(LOGO[cg])}</span>
        <span class="ar-t"><b>${COIN_NAME[unit] || unit}</b><small>${p?.usd != null ? `${money(p.usd)}${ch != null ? ` <span class="${ch >= 0 ? "up" : "dn"}">${ch >= 0 ? "+" : "−"}${Math.abs(ch).toFixed(2)}%</span>` : ""}` : unit}</small></span>
        <span class="pa-seg" role="group" aria-label="${unit} alert">${[0, 5, 10].map((x) => `<button data-act="palert" data-cg="${cg}" data-v="${x}" aria-label="${x ? `${x}%` : "Off"}" aria-pressed="${v === x}"${v === x ? ' class="on"' : ""}>${x ? `${x}%` : `<svg class="pa-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 10.6-3.8M18 12v2.5l1.5 2.5H8M10.5 20a1.8 1.8 0 0 0 3 0M4 4l16 16"/></svg>`}</button>`).join("")}</span></div>`; }).join("")}</section>
    ${canPush ? `<section class="list pa-push"><button class="arow" data-act="palert-notify" ${pushOn ? "disabled" : ""}><span class="pa-ic sm">${I.bell || I.check}</span>
      <span class="ar-t"><b>Notify me outside the app</b><small>${pushOn ? "On: alerts reach you even when Ecrin is closed." : Notification.permission === "denied" ? "Blocked. Allow notifications for Ecrin in your phone's settings." : "Allow notifications so alerts reach you when Ecrin is closed."}</small></span>
      <span class="pa-sw${pushOn ? " on" : ""}" aria-hidden="true"><i></i></span></button></section>` : ""}`;
}

/* ------------------------------------------------------------------ names */
// alex.sol (Solana Name Service) and vitalik.eth (ENS), looked up on mainnet where names live. The address it finds is
// shown under the field before you send, so you always see where the money really goes.
const NAME_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(sol|eth)$/i;
async function resolveName(name) {
  name = name.toLowerCase();
  if (name.endsWith(".sol")) {
    const r = await fetch(`https://sns-sdk-proxy.bonfida.workers.dev/resolve/${encodeURIComponent(name.slice(0, -4))}`).then((x) => x.json());
    if (r?.s === "ok" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.result)) return { fam: "sol", addr: r.result };
    return null;
  }
  const p = new ethers.JsonRpcProvider("https://ethereum-rpc.publicnode.com", 1, { staticNetwork: true });
  const a = await p.resolveName(name); return a ? { fam: "evm", addr: a } : null;
}
function lookupTo(v) {
  const P = S.panel; if (!P) return;
  clearTimeout(S.nameT); P.named = null;
  if (!NAME_RE.test(v.trim())) return;
  P.named = { name: v.trim(), busy: true };
  S.nameT = setTimeout(async () => {
    const want = v.trim(); let r = null, fail = false;
    try { r = await resolveName(want); } catch (_) { fail = true; }
    if (S.panel !== P || P.named?.name !== want) return;
    P.named = { name: want, addr: r?.addr, fam: r?.fam, fail, none: !r && !fail };
    renderPanel(); const n = $("#panel [data-to]"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
  }, 450);
}
const namedLine = () => { const n = S.panel?.named; if (!n) return ""; return `<p class="name-r">${n.busy ? `Looking up ${esc(n.name)}…` : n.addr ? `${I.check}<span><b>${esc(n.name)}</b> is <span class="mono">${esc(short(n.addr))}</span></span>` : n.fail ? "Couldn't look this name up right now." : `No address found for ${esc(n.name)}.`}</p>`; };

/* ------------------------------------------------------------------ payment links */
// Solana Pay (solana:<to>?amount=&spl-token=&label=) and EIP-681 (ethereum:<to>@<chain>?value= or
// ethereum:<token>@<chain>/transfer?address=<to>&uint256=<amount>). Reading one fills Send; Receive can make one.
function parsePayLink(text) {
  try {
    const t = String(text).trim();
    let m = t.match(/^solana:([1-9A-HJ-NP-Za-km-z]{32,44})(?:\?(.*))?$/i);
    if (m) { const q = new URLSearchParams(m[2] || ""), mint = q.get("spl-token"), k = isMain() ? "solm" : "sol"; return { fam: "sol", k, to: m[1], amount: q.get("amount") || "", a: mint ? (mint === NETS[k].usdc || (k === "sol" && mint === S.devMint) ? "usdc" : "token") : "native", label: q.get("label") || q.get("message") || "" }; }
    m = t.match(/^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(\/transfer)?(?:\?(.*))?$/i);
    if (m) {
      const q = new URLSearchParams(m[4] || ""), chain = Number(m[2] || 1), N = Object.values(NETS).find((x) => x.fam === "evm" && Number(x.E?.chainId ?? x.chainId) === chain) || Object.values(NETS).find((x) => x.fam === "evm" && String(x.key) === String(netByChain(chain)));
      if (m[3]) { const tok = m[1], to = q.get("address"), raw = q.get("uint256"); const isU = N && String(N.usdc || "").toLowerCase() === tok.toLowerCase(); return { fam: "evm", k: N?.key, chain, to, a: isU ? "usdc" : "token", amount: raw && isU ? String(Number(raw) / 1e6) : "" }; }
      const v = q.get("value"); return { fam: "evm", k: N?.key, chain, to: m[1], a: "native", amount: v ? ethers.formatEther(BigInt(Math.round(Number(v)))) : "" };
    }
  } catch (_) {}
  return null;
}
function netByChain(id) { const e = Object.values(NETS).find((x) => x.fam === "evm" && x.chainId === id); return e?.key; }
async function openPay(pay) {
  if (pay.fam === "evm" && !pay.k) return toast(`That payment is for a network Ecrin doesn't support yet (chain ${pay.chain}).`, "err");
  if (pay.a === "token") return toast("That payment asks for a token Ecrin can't send from a link yet. Send it from the coin's page.", "err");
  if (!netKeys().includes(pay.k)) { const N = NETS[pay.k]; return toast(N.test ? `That payment asks for test coins on ${N.name} ${N.net}. Switch to Testnet in Settings → Networks to pay it.` : `That payment is on ${N.name} Mainnet, with real money. Switch to Mainnet in Settings → Networks to pay it.`, "err"); }
  if (S.panel) { S.panel = null; $("#panel").innerHTML = ""; }
  await useNet(pay.k);
  openPanel("send", { a: pay.a, to: pay.to, amount: pay.amount || "", payLabel: pay.label });
  const e = await eng(); S.panel.reserve = await e.reserve(pay.a); renderPanel();
}
/** The link for a request: Solana Pay on Solana, EIP-681 on EVM networks, a plain address on Tron. */
function payLink(k, a, amount, label) {
  const N = NETS[k], to = ENG.address, x = A(a);
  if (N.fam === "sol") { const q = new URLSearchParams(); if (amount) q.set("amount", amount); if (a === "usdc") q.set("spl-token", N.usdc); if (label) q.set("label", label); const s = q.toString(); return `solana:${to}${s ? "?" + s : ""}`; }
  if (N.fam === "evm") {
    const chain = N.E?.chainId ?? N.chainId;
    if (a === "usdc") return `ethereum:${N.usdc}@${chain}/transfer?address=${to}${amount ? `&uint256=${BigInt(Math.round(Number(amount) * 1e6))}` : ""}`;
    return `ethereum:${to}@${chain}${amount ? `?value=${ethers.parseEther(String(amount)).toString()}` : ""}`;
  }
  return to;
}
function payreqView() {
  const P = S.panel, N = NETS[S.net], a = P.asset || "native", amt0 = (P.amount || "").trim(), n = Number(amt0) > 0 ? Number(amt0) : 0, unit = A(a).unit, note = (P.label || "").trim();
  const link = payLink(S.net, a, n ? amt0 : "", note);
  const q = qrcode(0, "H"); q.addData(link); q.make(); // high correction: the coin in the middle can't break it
  const px = a === "usdc" ? 1 : S.prices[N.cg]?.usd, fiat = n && px != null ? money(n * px) : "";
  const m = a === "usdc" ? "usdc" : N.unit === "ETH" ? "eth" : S.net, mid = coin(m) + (m !== S.net ? `<span class="qr-b">${coin(S.net)}</span>` : "");
  const addr = ENG?.address || "";
  return `${phead("Request a payment")}
    <div class="rq">
      ${fromRow()}
      <div class="rq-amt"><div class="rq-in"><input data-reqamt inputmode="decimal" placeholder="0" value="${esc(P.amount || "")}" autocomplete="off" aria-label="Amount" style="width:${Math.max(1, [...(P.amount || "")].reduce((t, c) => t + (/[.,]/.test(c) ? .45 : 1), 0)) + .12}ch"/><span>${unit}</span></div>
        <small>${fiat ? `≈ ${fiat}` : "Leave empty to let them choose"}</small></div>
      <label class="rq-note">${I.pen}<input data-reqlabel placeholder="Add a note (optional)" value="${esc(P.label || "")}" maxlength="40"/></label>
      <div class="rq-card">
        <div class="qr">${q.createSvgTag({ cellSize: 5, margin: 0, scalable: true })}<span class="qr-c">${mid}</span></div>
        <b class="rq-what">${n ? `Requesting ${esc(amt0)} ${unit}` : `Any amount of ${unit}`}</b>
        ${note ? `<span class="rq-for">“${esc(note)}”</span>` : ""}
        <span class="rq-to">to <span class="mono">${short(addr)}</span> · ${N.name}</span>
      </div>
      <p class="fine rq-fine">Opens in any ${N.fam === "sol" ? "Solana Pay" : N.fam === "evm" ? "Ethereum" : N.fam === "sui" ? "Sui" : "Tron"} wallet that scans it.</p>
      <div class="rq-acts">${navigator.share ? `<button class="btn primary" data-act="share-req">${I.send}Share</button>` : ""}<button class="btn" data-act="copy-req">${I.copy}Copy link</button></div>
    </div>`;
}

/* ------------------------------------------------------------------ WalletConnect (phone app) */
let WC = null;
const wcClient = () => (WC ||= import("./wc.js").then((m) => m.startWC({
  solAddr: ACCT?.sol?.publicKey?.toBase58?.(), evmAddr: ACCT?.evm?.address,
  onProposal: wcProposal, onRequest: wcRequest, onChange: () => { if (S.panel?.p === "wc") renderPanel(); }, getMode: () => S.mode || DEFAULT_MODE,
}).then((c) => ({ ...c, m }))).catch((e) => { WC = null; throw e; }));
async function wcSite(meta, verify) {
  let host = "unknown app", https = false;
  try { const u = new URL(meta?.url || ""); host = u.hostname; https = u.protocol === "https:"; } catch (_) {}
  const { check } = await import("./sitecheck.js"), c = await check(host).catch(() => ({})), { wcSeen = {} } = await local.get("wcSeen");
  return { host, https, phish: c.phish || verify === "INVALID", like: c.like, first: !wcSeen[host], name: meta?.name };
}
async function wcPair(uri) {
  if (!globalThis.ECRIN_WEB) return toast("Use the phone app to connect with WalletConnect.", "err");
  toast("Connecting…");
  try { const c = await wcClient(); await c.pair(uri); await local.set({ wcOn: true }); }
  catch (e) { toast(/expired|already/i.test(e?.message) ? "That code has expired. Refresh it on the site and scan again." : "Couldn't connect. Check your connection and try a fresh code.", "err"); }
}
async function wcProposal(p) {
  if (S.screen === "approve" && S.req) { try { (await wcClient()).reject(p); } catch (_) {} return; }
  const site = await wcSite(p.meta, p.verify);
  S.req = { wc: "proposal", p, kind: "connect", fam: p.ns?.solana ? "sol" : "evm", site, origin: p.meta?.url, err: p.ns ? null : (isMain() ? "This app asks for networks Ecrin doesn't have on Mainnet." : "This app asks for networks Ecrin doesn't have on Testnet (Solana Devnet and the EVM test networks). Switch Settings → Networks to Mainnet for real networks.") };
  S.reqBack = S.screen; S.screen = "approve"; render();
}
async function wcRequest(r) {
  const c = await wcClient();
  // One request at a time: a second one while you're deciding on the first is refused, never swapped in under you.
  if (S.screen === "approve" && S.req) return c.refuse(r, "Ecrin Wallet is showing another request. Try again in a moment.");
  if (!ACCT) return c.refuse(r, "Ecrin Wallet is locked.");
  let req; try { req = c.m.toRequest(r.method, r.params, r.chainId, ACCT?.evm?.address); } catch (e) { return c.refuse(r, e.message); }
  const R = { ...req, wc: "request", r, site: await wcSite(r.meta, r.verify), origin: r.meta?.url };
  S.req = R; S.reqBack = S.screen === "approve" ? "home" : S.screen; S.screen = "approve"; render();
  try { R.pv = await APX.preview(R); } catch (e) { R.pv = { fail: `Ecrin couldn't check this request: ${e?.message || e}` }; }
  if (S.req === R) render();
}
function wcDone(msg) { S.req = null; S.screen = S.reqBack && S.reqBack !== "approve" ? S.reqBack : "home"; render(); if (msg) toast(msg, "win"); }
async function wcOk(R) {
  const c = await wcClient();
  if (R.wc === "proposal") { await c.approve(R.p); const { wcSeen = {} } = await local.get("wcSeen"); wcSeen[R.site.host] = Date.now(); await local.set({ wcSeen }); return wcDone(`Connected to ${R.site.name || R.site.host}`); }
  const out = await APX.sign(R); await c.answer(R.r, c.m.toResult(R.r.method, out));
  const from = R.fam === "sol" ? ACCT.sol?.publicKey.toBase58() : ACCT.evm?.address, { apLog = [] } = await local.get("apLog");
  await local.set({ apLog: [{ t: "ap", at: Date.now(), origin: R.origin, kind: R.kind, fam: R.fam, from, via: "walletconnect" }, ...apLog].slice(0, 200) });
  wcDone(R.kind === "tx" || (R.kind === "soltx" && R.send) ? "Approved" : "Signed");
}
async function wcNo(R) { try { const c = await wcClient(); if (R.wc === "proposal") await c.reject(R.p); else await c.refuse(R.r); } catch (_) {} wcDone(); }
// Sessions you approved stay connected: start listening again whenever the wallet opens.
async function wcResume() { if (!globalThis.ECRIN_WEB || WC || !ACCT) return; if ((await local.get("wcOn")).wcOn) wcClient().catch(() => {}); }
function wcView() {
  const P = S.panel, list = P.list || [];
  if (!P.loaded) { P.loaded = true; wcClient().then((c) => { P.list = c.sessions(); renderPanel(); }).catch(() => { P.list = []; P.off = true; renderPanel(); }); }
  return `${phead("Connected apps")}
    <div class="wc">
      <p class="sub">Connect Ecrin to any app or site that shows a <b>WalletConnect</b> QR code. Every request still shows you exactly what would leave your wallet before you approve.</p>
      <button class="btn primary xl" data-act="scan">${I.qr}Scan a code</button>
      <div class="wc-paste"><input data-wcuri placeholder="or paste a wc: link" autocomplete="off"/><button class="btn" data-act="wc-paste">Connect</button></div>
      ${P.off ? `<p class="note">${I.warn}<span>Couldn't reach WalletConnect right now. Check your connection.</span></p>` : ""}
      <div class="list-h"><b>Connected</b><span>${list.length || ""}</span></div>
      ${list.length ? `<section class="list">${list.map((x) => `<div class="arow wc-s"><span class="coin tk">${esc((x.name || "?").slice(0, 1))}</span><span class="ar-t"><b>${esc(x.name || "App")}</b><small>${esc(String(x.url || "").replace(/^https?:\/\//, ""))}</small></span><button class="btn sm" data-act="wc-off" data-t="${esc(x.topic)}">Disconnect</button></div>`).join("")}</section>` : `<p class="fine pad">${P.list ? "No apps connected yet." : "Loading…"}</p>`}
    </div>`;
}

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
  if (kind === "connect" && S.guard?.bet && isBetting(site.host)) banners.push(["warn", "This looks like a betting site. You asked Ecrin to warn you about these."]);
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
const BUY = { api: "https://ecrinprotocol.app/api/buy", on: false, test: false, checked: 0, coin: "native", busy: false };
async function buyStatus() {
  if (Date.now() - BUY.checked < 60_000) return;
  BUY.checked = Date.now();
  try { const d = await (await fetch(BUY.api + "/status", { cache: "no-store" })).json(); BUY.on = !!d.on; BUY.test = !!d.test; BUY.coins = d.coins || null; } catch (_) {}
  if (S.panel?.p === "buy") renderPanel();
}
/** Buying is open on Testnet with MoonPay's sandbox (a test key), and on Mainnet with a live key. Never in the demo. */
const buyOpen = () => !globalThis.ECRIN_DEMO && BUY.on && (isMain() ? !BUY.test : BUY.test) && !!ENG?.address && !["rh", "hype", "rhm", "hypem"].includes(S.net);
function buyView() {
  const N = NETS[S.net], addr = ENG?.address || "";
  buyStatus();
  // What MoonPay offers here right now (in test mode, only coins MoonPay marks as test-ready).
  const sup = BUY.coins?.[S.net.replace(/m$/, "")] || (BUY.coins ? { native: false, usdc: false } : { native: true, usdc: true });
  if (buyOpen() && !sup.native && !(sup.usdc && N.usdc)) return `${phead("Buy")}<div class="soon-row"><span class="soon">${BUY.test ? "Test mode" : "Not available here"}</span></div>
    <div class="cv"><div class="cv-art">${I.card}</div><h2>Not on ${esc(nname(N))} ${BUY.test ? "in test mode" : "yet"}</h2>
      <p class="sub">${BUY.test ? `MoonPay's test mode only offers some coins, and ${esc(N.unit)} on ${esc(N.name)} isn't one of them. Real purchases open with mainnet.` : `MoonPay doesn't offer ${esc(N.unit)} on ${esc(N.name)}.`}</p>
      ${faucetBtn(N, "btn xl", `Get free test ${N.unit} instead`)}</div>`;
  if (buyOpen()) {
    const usdc = !!N.usdc && N.fam !== "tron" && sup.usdc && sup.native, bc = usdc ? BUY.coin : sup.native ? "native" : "usdc", u = bc === "usdc" ? "USDC" : N.unit;
    // Pick what to buy, whatever network you're on: every coin MoonPay offers here, in one row.
    const opts = netKeys().flatMap((k) => { const s2 = BUY.coins?.[k.replace(/m$/, "")]; if (!s2 || ["rh", "hype", "rhm", "hypem", "hoodi"].includes(k)) return [];
      return [...(s2.native ? [{ k, a: "native", u: NETS[k].unit }] : []), ...(s2.usdc && NETS[k].usdc && NETS[k].fam !== "tron" ? [{ k, a: "usdc", u: "USDC" }] : [])]; });
    const pick = opts.length > 1 ? `<div class="buy-pick">${opts.map((o) => `<button data-act="buy-pick" data-n="${o.k}" data-a="${o.a}" aria-pressed="${o.k === S.net && o.a === bc}">${coin(o.a === "usdc" ? "usdc" : o.k, "sm")}<span><b>${o.u}</b><small>${esc(nname(NETS[o.k]))}</small></span></button>`).join("")}</div>` : "";
    return `${phead("Buy")}${BUY.test ? `<div class="soon-row"><span class="soon">Test mode · no real money</span></div>` : ""}
    <div class="cv"><div class="cv-art">${I.card}</div><h2>Buy ${u} with a card</h2>
      ${pick}
      <p class="sub">You'll pay on MoonPay's secure page. The ${u} arrives straight in your Wallet on ${esc(N.name)}, at <span class="mono" style="white-space:nowrap">${short(addr)}</span>.</p>
      ${BUY.test ? `<div class="note">${I.shield}<span>This is MoonPay's test mode: use their test card, nothing is charged. Real purchases open with mainnet.</span></div>` : `<div class="note">${I.shield}<span>Ecrin never sees your card details: MoonPay handles payment and identity checks.</span></div>`}
      <button class="btn primary xl" data-act="buy-go"${BUY.busy ? " disabled" : ""}>${BUY.busy ? `<span class="spin"></span>` : ""}Continue to MoonPay ${I.ext}</button></div>`;
  }
  return `${phead("Buy")}
    <div class="soon-row"><span class="soon">Coming soon · opens with mainnet</span></div>
    <div class="cv"><div class="cv-art">${I.card}</div><h2>Buy crypto with a card</h2>
      <p class="sub">Soon you'll buy SOL, ETH and USDC with a card or Apple Pay, through MoonPay. The coins land straight in your Wallet, and you can protect them in your Safe right away.</p>
      <div class="note">${I.shield}<span>Ecrin never sees your card details: MoonPay handles payment and identity checks.</span></div>
      ${faucetBtn(N, "btn xl", `Get free test ${N.unit} for now`)}</div>`;
}
// Swaps run on Solana mainnet (real money) through Jupiter, with Ecrin's fee, via ecrinprotocol.app/api/swap. They
// open when the server says so (/api/swap/status → "on"); until then the screen shows a preview. Before signing,
// the wallet dry-runs Jupiter's transaction and refuses anything that takes more than you chose (chains.js swapSign).
/** A fee as people read it: 0.0088 → "0.88%", 0.00875 → "0.875%". */
const feePct = (f) => `${(Math.round(f * 1e5) / 1e3).toLocaleString(S.lang === "fr" ? "fr-CA" : "en-US", { maximumFractionDigits: 3 })}${S.lang === "fr" ? " " : ""}%`;
const SWAP = { live: false, feeBps: 88, api: "https://ecrinprotocol.app/api/swap", checked: 0 };
const STAKE_APY = 0.065, STAKE_APY_TEXT = "6–7%"; // Earn: Solana staking from the Safe (Ethereum: about 3% through Lido)
const SOL_MINT = "So11111111111111111111111111111111111111112";
const SWAP_NET = "solm";
const swapEng = () => (S.net === SWAP_NET && ENG ? ENG : engine({ web3, ethers, acct: ACCT, net: SWAP_NET, dev: {} }));
async function swapStatus() {
  if (Date.now() - SWAP.checked < 60_000) return;
  SWAP.checked = Date.now();
  try { const r = await fetch(SWAP.api + "/status", { cache: "no-store" }); const d = await r.json(); SWAP.live = d.mode === "on"; SWAP.feeBps = Number(d.feeBps) || 88; } catch (_) {}
  if (S.panel?.p === "swap") renderPanel();
}
const toRaw = (s, dec) => { const m = /^(\d*)(?:\.(\d*))?$/.exec(String(s || "").trim()); if (!m || (!m[1] && !m[2])) return 0n; const f = (m[2] || "").slice(0, dec).padEnd(dec, "0"); return BigInt((m[1] || "0") + f); };
const fromRaw = (r, dec) => Number(r) / 10 ** dec;
/** The coins you can swap on mainnet: SOL, USDC, then every token this wallet holds there. */
function swapCoins() {
  const N = NETS[SWAP_NET], list = [{ mint: SOL_MINT, sym: "SOL", name: "Solana", dec: 9, raw: String(Math.max(0, (S.net === SWAP_NET ? S.bal?.native : S.all?.find((r) => r.k === SWAP_NET)?.b?.native) || 0)), logo: "sol" },
    { mint: N.usdc, sym: "USDC", name: "USD Coin", dec: 6, raw: String((S.net === SWAP_NET ? S.bal?.usdc : S.all?.find((r) => r.k === SWAP_NET)?.b?.usdc) || 0), logo: "usdc" }];
  for (const t of S.extra || []) if (t.k === SWAP_NET && !t.nft && t.mint !== N.usdc) list.push({ mint: t.mint, sym: t.symbol || "Token", name: t.name || t.symbol || short(t.mint), dec: t.dec, raw: t.raw, icon: t.icon });
  return list;
}
const swapIc = (c) => (c?.logo ? coin(c.logo) : c?.icon ? `<img class="coin" src="${esc(c.icon)}" alt="" referrerpolicy="no-referrer"/>` : `<span class="coin tk-l">${esc((c?.sym || "?").slice(0, 1))}</span>`);
/** Reserve 0.01 SOL for fees when paying with SOL. */
const swapMaxRaw = (c) => { const r = BigInt(c?.raw || 0); return c?.mint === SOL_MINT ? (r > 10_000_000n ? r - 10_000_000n : 0n) : r; };
function swapQuoteSoon(ms = 400) {
  const P = S.panel; if (!P || P.p !== "swap") return;
  clearTimeout(S.swapT); const mine = (P.qSeq = (P.qSeq || 0) + 1); P.quote = null; P.qErr = null;
  const raw = toRaw(P.amount, P.from.dec); if (!raw || !SWAP.live) { patchPanel(); return; }
  P.quoting = true; patchPanel();
  S.swapT = setTimeout(async () => {
    try {
      const r = await fetch(`${SWAP.api}?` + new URLSearchParams({ inputMint: P.from.mint, outputMint: P.to.mint, amount: String(raw) }), { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (P.qSeq !== mine || S.panel !== P) return;
      if (!r.ok || !d.outAmount) throw new Error((typeof d.error === "string" ? d.error : d.error?.message) || d.errorMessage || "No price for this pair right now");
      P.quote = d;
    } catch (e) { if (P.qSeq === mine) P.qErr = e.message || "No price right now"; }
    if (P.qSeq === mine && S.panel === P) { P.quoting = false; renderPanel(); }
  }, ms);
}
const SWAP_ERR = { 1: "Not enough balance for this swap.", 2: "You need a little SOL for network fees (about 0.01 SOL).", 3: "That amount is too small to swap." };
async function swapNow() {
  const P = S.panel, raw = toRaw(P.amount, P.from.dec);
  if (S.upd?.must) return toast("A security update is required before you can swap. Update Ecrin Wallet first.", "err");
  if (!raw) return;
  const usd = P.quote?.inUsdValue ? Number(P.quote.inUsdValue) : null, lim = await limitCheck(usd); if (lim) { P.step = "form"; renderPanel(); return toast(lim, "err"); }
  P.step = "sending"; P.sig = null; renderPanel();
  motionStart(P, [{ k: "route", run: "Finding the best route", ok: "Best route found" }, { k: "check", run: "Ecrin is checking the swap", ok: "Checked by Ecrin: nothing extra leaves" }, { k: "sent", run: "Sending to Solana", ok: "Sent to Solana" }, { k: "conf", run: "Waiting for confirmation", ok: "Confirmed" }], false);
  txEvents.sent = null;
  try {
    const { dev } = await local.get("dev"), e = swapEng();
    const r = await fetch(`${SWAP.api}?` + new URLSearchParams({ inputMint: P.from.mint, outputMint: P.to.mint, amount: String(raw), taker: e.address }), { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.transaction) throw new Error(SWAP_ERR[d.errorCode] || (typeof d.error === "string" ? d.error : d.error?.message) || d.errorMessage || "Jupiter couldn't build this swap. Try again.");
    motionStep(P, "check");
    const signed = await e.swapSign(d.transaction, { inMint: P.from.mint, inRaw: String(raw) });
    motionStep(P, "sent");
    const x = await fetch(SWAP.api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedTransaction: signed, requestId: d.requestId }) });
    const res = await x.json().catch(() => ({}));
    if (res.status !== "Success") throw new Error(res.error || "The swap didn't go through" + (res.code ? ` (${res.code})` : "") + ". Nothing left your wallet.");
    P.sig = res.signature || null; P.got = d.outAmount; P.inUsd = Number(d.inUsdValue) || null; motionEnd(P); P.step = "done"; haptic("success");
    await logActivity({ t: "swap", k: SWAP_NET, from: P.from.sym, to: P.to.sym, sig: P.sig });
    if (usd != null) await countSpend(usd);
    refresh().then(() => { loadActivity(); loadAll(); loadExtras(dev || {}); });
  } catch (err) { console.warn(err); P.mo = null; P.step = "form"; toast(errText(err), "err"); }
  renderPanel();
}

function swapView() {
  // Jupiter has markets on mainnet only.
  if (!isMain()) return `${phead("Swap")}<div class="cv"><div class="cv-art">${I.swap}</div><h2>Swaps run on Mainnet</h2><p class="sub">Swaps go through Jupiter on Solana mainnet, which has no test version. Switch Settings → Networks to Mainnet to swap.</p></div>`;
  const P = S.panel, N = NETS[SWAP_NET], coins = swapCoins();
  swapStatus();
  P.from ||= coins[0]; P.to ||= coins[1];
  const fresh = (c) => coins.find((x) => x.mint === c.mint) || { ...c, raw: "0" };
  P.from = fresh(P.from); P.to = fresh(P.to);
  if (P.step === "done" || P.step === "sending") {
    const got = P.got ? fromRaw(P.got, P.to.dec) : P.quote ? fromRaw(P.quote.outAmount, P.to.dec) : 0, nf = (v) => v.toLocaleString("en-US", { maximumFractionDigits: P.to.dec > 4 ? 4 : P.to.dec });
    return motionView(P, { kind: "swap", N, title: ["Swapping", "Swapped"], amount: `${esc(P.amount)} ${esc(P.from.sym)} → ${nf(got)} ${esc(P.to.sym)}`, usd: P.inUsd || P.quote?.inUsdValue ? money(Number(P.inUsd || P.quote.inUsdValue)) : "", line: "on Solana mainnet",
      rows: [["You paid", `${esc(P.amount)} ${esc(P.from.sym)}`], ["You got", `${nf(got)} ${esc(P.to.sym)}`], ["Ecrin fee", `${feePct(SWAP.feeBps / 1e4)} (included)`], ["Route", `Jupiter${P.quote?.router ? " · " + esc(String(P.quote.router)) : ""}`]] });
  }
  if (P.pick) return swapPickView();
  const raw = toRaw(P.amount, P.from.dec), max = swapMaxRaw(P.from), over = raw > max, q = P.quote;
  const out = q ? fromRaw(q.outAmount, P.to.dec) : 0, inAmt = fromRaw(raw, P.from.dec);
  const inUsd = q && Number(q.inUsdValue) > 0 ? Number(q.inUsdValue) : null, outUsd = q && Number(q.outUsdValue) > 0 ? Number(q.outUsdValue) : null;
  const loss = inUsd && outUsd ? Math.max(0, (1 - outUsd / inUsd) * 100) : null;
  const nf = (v, d) => v.toLocaleString("en-US", { maximumFractionDigits: d });
  const bal = (c) => nf(fromRaw(c.raw, c.dec), c.dec > 4 ? 4 : c.dec);
  const chip = (side, c) => `<button class="sx-coin sx-pickb" data-act="swap-pick" data-v="${side}">${swapIc(c)}<b>${esc(c.sym)}</b><small>${esc(c.name)}</small>${I.chev}</button>`;
  const btn = !SWAP.live ? "Coming soon" : !raw ? "Enter an amount" : over ? `Not enough ${esc(P.from.sym)}` : P.quoting || !q ? (P.qErr ? "No price right now" : "Getting the best price…") : `Review swap`;
  if (P.step === "review" || P.step === "sending") return `${phead("Review swap")}
    <div class="sx sx-rv">
      <div class="tk-info"><div><span>You pay</span><b>${nf(inAmt, 6)} ${esc(P.from.sym)}${inUsd ? ` · ${money(inUsd)}` : ""}</b></div>
        <div><span>You receive about</span><b>${nf(out, 6)} ${esc(P.to.sym)}${outUsd ? ` · ${money(outUsd)}` : ""}</b></div>
        <div><span>Price impact + fees</span><b class="${loss >= 10 ? "bad" : ""}">${loss == null ? "—" : loss < 0.1 ? "< 0.1%" : "−" + loss.toFixed(loss < 10 ? 2 : 1) + "%"}</b></div>
        <div><span>Ecrin fee</span><b>${feePct(SWAP.feeBps / 1e4)} (included)</b></div>
        <div><span>Route</span><b>Jupiter${q?.router ? " · " + esc(String(q.router)) : ""}</b></div></div>
      ${loss >= 10 ? `<p class="err">You'd lose ${loss.toFixed(0)}% to price impact. This coin has very little trading; try a smaller amount.</p>` : ""}
      <div class="sx-note">${I.shield}<span>Before you sign, Ecrin checks the swap on the network and refuses it if more would leave than you chose.</span></div>
    </div><div class="pfoot">${hold(P.step === "sending" ? "Swapping…" : "Hold to swap", P.step === "sending")}</div>`;
  return `${phead("Swap")}
  <div class="sx">
    <div class="sf-aura" aria-hidden="true" style="${auraT()}"><i></i><i></i><i></i></div>
    <div class="sx-soon${SWAP.live ? " real" : ""}"><i></i>${SWAP.live ? "Solana mainnet" : "Preview · swaps are being switched on"}</div>
    <div class="sx-pair">
      <div class="sx-card${over ? " over" : ""}">
        <div class="sx-top"><span class="sx-k">You pay</span><span class="sx-bal">Balance ${bal(P.from)} ${esc(P.from.sym)}</span></div>
        <div class="sx-row">${chip("from", P.from)}<input class="sx-in" data-amount inputmode="decimal" placeholder="0" value="${esc(P.amount)}" autocomplete="off" autofocus/></div>
        <div class="sx-foot"><span class="sx-pcts">${[25, 50, 100].map((v) => `<button data-act="swap-pct" data-v="${v}" class="${P.pct === v ? "on" : ""}">${v === 100 ? "Max" : v + "%"}</button>`).join("")}</span><span class="sx-usd">${over ? `<span class="bad">Not enough</span>` : inUsd ? money(inUsd) : ""}</span></div>
      </div>
      <button class="sx-flip${P.flipped ? " spun" : ""}" data-act="swap-flip" aria-label="Swap direction"><svg viewBox="0 0 24 24"><path d="M8 4v15M8 19l-4-4M8 19l4-4M16 20V5M16 5l-4 4M16 5l4 4"/></svg></button>
      <div class="sx-card to">
        <div class="sx-top"><span class="sx-k">You receive</span><span class="sx-bal">Balance ${bal(P.to)} ${esc(P.to.sym)}</span></div>
        <div class="sx-row">${chip("to", P.to)}<b class="sx-out${out ? "" : " zero"}${P.quoting ? " ld" : ""}">${out ? nf(out, P.to.dec > 4 ? 4 : P.to.dec) : "0"}</b></div>
        <div class="sx-foot"><span class="sx-est">${P.qErr ? `<span class="bad">${esc(P.qErr)}</span>` : "Estimate"}</span><span class="sx-usd">${outUsd ? money(outUsd) : ""}</span></div>
      </div>
    </div>
    <div class="sx-rate"><span class="sx-live"><i></i>${q && inAmt && out ? `1 ${esc(P.from.sym)} ≈ ${nf(out / inAmt, 6)} ${esc(P.to.sym)}` : "Best price"}</span><span class="sx-route">via Jupiter</span></div>
    <div class="sx-kv"><div><span>Ecrin fee</span><b>${feePct(SWAP.feeBps / 1e4)}</b></div><div><span>Network fee</span><b>&lt; 0.001 SOL</b></div><div><span>Price impact</span><b class="${loss >= 10 ? "bad" : ""}">${loss == null ? "—" : loss < 0.1 ? "< 0.1%" : loss.toFixed(2) + "%"}</b></div><div><span>Slippage</span><b>Automatic · Jupiter</b></div></div>
    ${loss >= 4 ? `<div class="sx-warn${loss >= 10 ? " hi" : ""}">${I.warn}<span>${loss >= 10 ? `<b>You'd lose about ${loss.toFixed(0)}%.</b> This coin has very little trading at this size. Try a smaller amount.` : `<b>About ${loss.toFixed(1)}% goes to price impact and fees.</b> A smaller amount usually gets a better rate.`}</span></div>` : ""}
    <div class="sx-note">${I.lock}<span>Swaps use your Wallet on Solana mainnet. Money in your Safe never moves without its delay.</span></div>
    ${(P.flipped = false, "")}<button class="sx-go" data-act="swap-review" ${SWAP.live && raw && !over && q ? "" : "disabled"}>${btn}</button>
  </div>`;
}
/** Picking a coin: what you hold on mainnet first, then search any Solana token by name. */
function swapPickView() {
  const P = S.panel, side = P.pick, other = side === "from" ? P.to : P.from, held = swapCoins();
  const row = (c, i, src) => `<button class="arow" data-act="swap-choose" data-src="${src}" data-i="${i}" ${c.mint === other.mint ? "disabled" : ""}>${swapIc(c)}<span class="ar-t"><b>${esc(c.sym)}</b><small>${esc(c.name)}</small></span>
    <span class="ar-r">${src === "h" ? `<b>${(fromRaw(c.raw, c.dec)).toLocaleString("en-US", { maximumFractionDigits: 4 })}</b>` : c.price ? `<b>${money(c.price)}</b><small>${c.liq ? "liquidity " + money(c.liq) : ""}</small>` : ""}</span></button>`;
  const found = P.found || [];
  return `${phead(side === "from" ? "You pay" : "You receive")}
    <div class="pk-search"><input data-swapq placeholder="Search any Solana token by name" value="${esc(P.sq || "")}" autocomplete="off" autofocus/></div>
    ${P.sq && P.sq.trim().length >= 2 ? `<section class="list">${P.searching ? `<p class="fine pad">Searching…</p>` : found.length ? found.map((c, i) => row(c, i, "f")).join("") : `<p class="fine pad">No Solana token by that name. Paste its address instead.</p>`}</section>
      <p class="fine pad">Several tokens can share a name. Check the liquidity: copies usually have very little.</p>`
    : `<section class="list">${(side === "to" ? held : held.filter((c) => BigInt(c.raw) > 0n || c.mint === SOL_MINT)).map((c, i) => row(c, held.indexOf(c), "h")).join("")}</section>`}`;
}
async function swapSearch(q) {
  const P = S.panel; P.sq = q; clearTimeout(S.swapQT);
  if (q.trim().length < 2) { P.found = []; return renderPanel(); }
  P.searching = true;
  S.swapQT = setTimeout(async () => {
    const v = q.trim(); let list = [];
    try {
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) {
        const d = await swapEng().decimals?.(v).catch(() => null); // an address pasted: the chain says how many decimals
        if (Number.isInteger(d)) list = [{ mint: v, sym: short(v), name: "Token by address", dec: d }];
      } else {
        const r = await fetch(`https://ecrinprotocol.app/api/tokens?` + new URLSearchParams({ q: v, chain: "solana" })); const d = await r.json();
        list = (d.tokens || d || []).slice?.(0, 8).map((t) => ({ mint: t.address, sym: t.symbol, name: t.name, price: t.price, liq: t.liq, icon: t.icon, dec: null })) || [];
      }
    } catch (_) {}
    if (S.panel !== P || P.sq !== q) return;
    P.found = list; P.searching = false; renderPanel();
  }, 300);
}

/* ------------------------------------------------------------------ Earn: staking from the Safe */
// The money stays the Safe's the whole time: on Solana in a stake account only the Safe controls, on Ethereum as
// Lido's wstETH held by the Safe contract. Unstaked money can only come back into the Safe.
const stakeable = (k) => !!NETS[k]?.staking || (!!globalThis.ECRIN_DEMO && (k === "sol" || k === "hoodi"));
const stakeNets = () => netKeys().filter(stakeable);
const ST_TXT = { activating: ["Starting", "Earns from the next epoch"], active: ["Earning", "Rewards add up every few days"], cooling: ["Unstaking", "Coming back to your Safe"], ready: ["Unstaked", "Ready to use"] };
/** Loads (or reloads) the stakes for the Earn screen, moving to a network that has staking first. */
async function loadEarn(force) {
  const P = S.panel; if (!P || P.p !== "earn" || (P.loading && !force)) return;
  const nets = stakeNets(); if (!nets.length) return;
  P.loading = true;
  try {
    const want = P.k && nets.includes(P.k) ? P.k : stakeable(S.net) ? S.net : nets[0];
    if (want !== S.net) await useNet(want);
    const e = await eng(); P.k = S.net;
    const [st, v] = await Promise.all([e.staking ? e.staking.fetch() : null, e.vault().catch(() => null)]);
    if (S.panel !== P) return;
    P.st = st; P.v = v; P.err = null; if (st) (S.stakes ||= {})[S.net] = st;
  } catch (err) { if (S.panel === P) P.err = errText(err); }
  finally { P.loading = false; }
  if (S.panel === P && P.step !== "sending") (P.mode === "stake" ? patchPanel() : renderPanel());
  // Countdowns and rewards move: refresh every 20 s while the screen is open (5 s in the demo, where time runs fast).
  clearTimeout(S.earnT); S.earnT = setTimeout(() => { if (S.panel === P && P.mode !== "stake" && P.step !== "sending") loadEarn(); }, globalThis.ECRIN_DEMO ? 5000 : 20000);
}
/** Home: everything you have staked, on every network, in one place. Tap a row to manage it in Earn. */
/** Keeps Home's Staked section current (status, rewards): at most every 20 s while Home is open. */
async function refreshStakes() {
  const gap = globalThis.ECRIN_DEMO ? 6000 : 20000;
  clearTimeout(S.stakeTimer); S.stakeTimer = setTimeout(() => { if (S.screen === "home" && !S.panel) refreshStakes(); }, gap + 200);
  if (S.stakeT && Date.now() - S.stakeT < gap) return; S.stakeT = Date.now();
  const { dev } = await local.get("dev"), ks = Object.keys(S.stakes || {}).filter((k) => netKeys().includes(k));
  await Promise.all(ks.map(async (k) => { try { const e = k === S.net && ENG ? ENG : engine({ web3, ethers, acct: ACCT, net: k, dev: dev || {} }); if (e.staking) S.stakes[k] = await e.staking.fetch(); } catch (_) {} }));
  if (S.screen === "home" && !S.panel && !S.scrubbing) render();
}
function stakedCard() {
  queueMicrotask(refreshStakes);
  const rows = Object.entries(S.stakes || {}).filter(([k, st]) => netKeys().includes(k) && st?.items?.length).flatMap(([k, st]) => st.items.map((x) => ({ k, x })));
  if (!rows.length) return "";
  const px = (k) => S.prices[NETS[k].cg]?.usd, fmt = (k, v) => (v / BASE).toLocaleString(S.lang === "fr" ? "fr-CA" : "en-US", { maximumFractionDigits: NETS[k].unit === "SOL" ? 4 : 5 });
  const usd = (k, v) => (px(k) != null ? (v / BASE) * px(k) : 0);
  const total = rows.reduce((t, r) => t + usd(r.k, r.x.amount), 0), earned = rows.reduce((t, r) => t + usd(r.k, r.x.rewards || 0), 0);
  const ST = { active: ["on", "Earning"], activating: ["wait", "Starting"], cooling: ["wait", "Unstaking"], ready: ["ready", "Ready to collect"] };
  return `<section class="stk">
    <button class="stk-h" data-act="earn-open" data-n="${rows[0].k}"><span class="stk-ic">${I.spark}</span><span class="stk-t"><b>Staked</b><small>${rows.length} ${rows.length > 1 ? "positions" : "position"} · inside your Safe</small></span>
      <span class="stk-v"><b>${mask(fig(money(total)))}</b>${earned ? `<small class="pos">+${mask(money(earned))} earned</small>` : ""}</span></button>
    ${rows.map(({ k, x }) => { const [c, t] = ST[x.status] || ST.active, eta = (x.status === "cooling" || x.status === "activating") && x.eta > 60 ? ` · ${dur(x.eta)}` : "";
      return `<button class="stk-r" data-act="earn-open" data-n="${k}">${coin(k)}<span class="stk-rt"><b>${mask(fmt(k, x.amount))} ${NETS[k].unit}</b><small><i class="stk-d ${c}"></i>${t}${eta} · ${esc(nname(NETS[k]))}</small></span>
        <span class="stk-rv"><b>${mask(money(usd(k, x.amount)))}</b>${x.rewards ? `<small class="pos">+${mask(fmt(k, x.rewards))}</small>` : `<small>&nbsp;</small>`}</span></button>`; }).join("")}
  </section>`;
}
function earnSoonView() {
  const main = isMain();
  return `${phead("Earn")}
    <div class="soon-row"><span class="soon">${main ? "After the audit" : "Coming soon"}</span></div>
    <div class="ern ern-soon">
      <div class="ern-stage">${earnGem(0, true)}<div class="ern-mid"><span class="ern-ic">${I.spark}</span><span class="lbl">Earn</span><b class="ern-big">${STAKE_APY_TEXT}</b><small>a year on SOL (estimate)</small></div></div>
      <div class="ap-card ern-how">
        <div class="ap-li">${I.lock}<span>Your money stays inside your Safe while it earns. Every delay still applies.</span></div>
        <div class="ap-li">${I.spark}<span>Native Solana staking, and Ethereum staking through Lido. Rates change; nothing is guaranteed.</span></div>
        <div class="ap-li">${I.shield}<span>No Ecrin fee on rewards.</span></div>
      </div>
      <p class="fine pad">${main ? "Staking on Mainnet opens after Ecrin's independent security audit." : "Staking opens on test networks with the next update."}</p>
    </div>`;
}
/** The Earn diamond: the outer edge fills with how much of the Safe is staked; a point of light circles while it earns. */
function earnGem(f, idle) {
  return `<svg class="ern-gem${idle ? " idle" : ""}" viewBox="0 0 260 260" aria-hidden="true">
    <defs><linearGradient id="erg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c8d3ff"/><stop offset=".5" stop-color="#5b7cff"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>
      <radialGradient id="erc" cx=".5" cy=".4" r=".75"><stop offset="0" stop-color="#3d63ff" stop-opacity=".5"/><stop offset=".65" stop-color="#18205a" stop-opacity=".3"/><stop offset="1" stop-color="#0b0d1c" stop-opacity="0"/></radialGradient></defs>
    <g transform="rotate(45 130 130)">
      <rect class="eg-tk" x="30" y="30" width="200" height="200" rx="46" pathLength="100"/>
      <rect class="eg-base" x="46" y="46" width="168" height="168" rx="38"/>
      <rect class="eg-arc" x="46" y="46" width="168" height="168" rx="38" pathLength="100" style="--p:${Math.max(0, Math.min(100, f * 100)).toFixed(2)}"/>
      <rect class="eg-run" x="46" y="46" width="168" height="168" rx="38" pathLength="100"/>
      <rect class="eg-core" x="60" y="60" width="140" height="140" rx="30"/>
    </g></svg>`;
}
function earnView() {
  const nets = stakeNets();
  if (!nets.length) return earnSoonView();
  const P = S.panel;
  if (P.step === "sending" || P.step === "done") return earnMotion(P);
  if (P.st === undefined) { queueMicrotask(() => loadEarn()); return earnShell(nets, true); }
  if (P.mode === "stake") return earnStakeView(P);
  if (P.mode === "unstake") return earnUnstakeView(P);
  return earnShell(nets);
}
function earnShell(nets, loading) {
  const P = S.panel, N = NETS[S.net], st = P.st, e = ENG?.staking, unit = N.unit, lido = N.fam === "evm";
  const px = S.prices[N.cg]?.usd, fiat = (u) => (px != null ? money((u / BASE) * px) : "");
  const free = P.v?.main?.available || 0, wal = S.bal?.native || 0, staked = st?.staked || 0, items = st?.items || [];
  const apy = (e?.apy || (lido ? "3%" : STAKE_APY_TEXT)).replace(/^about /, ""), rate = N.fam === "sol" ? STAKE_APY : 0.03, yr = (staked / BASE) * rate;
  const earning = items.filter((x) => x.status === "active" || x.status === "activating"), out = items.filter((x) => x.status === "cooling" || x.status === "ready");
  const status = !items.length ? null : earning.some((x) => x.status === "active") ? ["on", "Earning"] : earning.length ? ["wait", "Starting"] : ["wait", "Unstaking"];
  const nets2 = nets.length > 1 ? `<div class="seg ern-nets">${nets.map((k) => `<button data-act="earn-net" data-n="${k}" aria-pressed="${k === S.net}">${coin(k, "sm")}${NETS[k].name}</button>`).join("")}</div>`
    : `<span class="ern-chip">${coin(S.net, "sm")}${N.name} · ${N.net}</span>`;
  const canStake = (free || wal) && (!st || st.room);
  const unstakeable = earning.find((x) => x.wst || N.fam === "sol");
  const row = (x) => {
    const [t] = ST_TXT[x.status] || ST_TXT.active, eta = x.eta > 0 ? (x.eta < 60 ? "<1m" : dur(x.eta)) : "";
    const who = x.who && !/\s/.test(x.who) && x.who.length > 20 ? short(x.who) : x.who || "";
    const right = x.status === "ready" ? `<span class="er-pill">Ready</span>` : x.status === "cooling" ? `<span class="er-when">${eta ? `back in ${eta}` : lido ? "in Lido's queue" : "this epoch"}</span>`
      : (x.wst || N.fam === "sol") && earning.length > 1 ? `<button class="er-link" data-act="earn-unstake" data-id="${esc(String(x.id))}">Unstake</button>` : "";
    return `<article class="er2 s-${x.status}"><div class="er2-top"><b>${mask(amt(x.amount, "native"))} ${unit}</b>${right}</div>
      <small class="er2-sub"><i class="er2-dot"></i>${t}${who ? ` · ${esc(who)}` : ""}${x.rewards ? ` · <em>+${amt(x.rewards, "native")}</em>` : ""}</small>
      ${x.status === "ready" ? `<div class="er2-btns"><button class="btn" data-act="earn-reclaim" data-to="safe" data-id="${esc(String(x.id))}">Keep in Safe</button><button class="btn primary" data-act="earn-reclaim" data-to="wallet" data-id="${esc(String(x.id))}">To Wallet</button></div>` : ""}</article>`;
  };
  const line = staked ? `${st?.rewards ? `<em>+${amt(st.rewards, "native")} ${unit} earned</em> · ` : status && status[1] !== "Earning" ? `${status[1]} · ` : ""}~${apy} a year` : `${mask(amt(free + wal, "native"))} ${unit} available`;
  return `${phead("Earn")}
  <div class="ern ern3${loading ? " loading" : ""}">
    ${nets.length > 1 ? nets2 : ""}
    <section class="e3${out.length || earning.length > 1 ? " tight" : ""}">
      ${coin(S.net, "e3-coin")}
      <span class="e3-lbl">${staked || loading ? `<span>Staked</span>${status ? ` · <i class="${status[0]}">${status[1]}</i>` : ""}` : `Earn on ${unit}`}</span>
      ${staked || loading ? `<b class="e3-amt${loading ? " sk" : ""}">${loading ? "&nbsp;" : `${mask(amt(staked, "native"))} <small>${unit}</small>`}</b><span class="e3-fiat">${staked ? mask(fiat(staked)) : "&nbsp;"}</span>`
        : `<b class="e3-amt">~${apy}<small> a year</small></b><span class="e3-fiat">without it leaving your Safe</span>`}
      <p class="e3-line">${loading ? "&nbsp;" : line}</p>
    </section>
    <div class="e3-acts${staked ? "" : " one"}"><button class="btn primary xl" data-act="earn-stake"${canStake ? "" : " disabled"}>${staked ? "Stake more" : `Stake ${unit}`}</button>
      ${staked ? `<button class="btn xl" data-act="earn-unstake" data-id="${unstakeable ? esc(String(unstakeable.id)) : ""}"${unstakeable ? "" : " disabled"}>Unstake</button>` : ""}</div>
    ${out.length || earning.length > 1 ? `<div class="er-list">${[...out, ...(earning.length > 1 ? earning : [])].map(row).join("")}</div>` : ""}
    ${!canStake && !staked && !loading ? `<p class="e3-note">${N.faucet ? `Need ${unit}? <button class="link" data-act="faucet">Get free test ${unit}</button>` : `Receive some ${unit} first.`}</p>` : ""}
    ${P.err ? `<p class="note bad-n">${I.shield}<span>${esc(P.err)}</span></p>` : ""}
    <p class="e3-fine">${lido ? "Staked with Lido" : "Native Solana staking"} · stays in your Safe · unstaking ${N.fam === "sol" ? "2–3" : "1–5"} days · no Ecrin fee</p>
  </div>`;
}
/** How much can be staked from each place: the Wallet (keeping the network fee back) or what's free in the Safe. */
const stakeMax = (P) => (P.src === "wallet" ? sendMaxProtect() : P.v?.main?.available || 0);
function earnStakeView(P) {
  const N = NETS[S.net], u = N.unit, max = stakeMax(P), units = parseAmt(P.amount, "native"), valid = units > 0 && units <= max;
  const usd = usdOf(units, "native"), pad = !!globalThis.ECRIN_WEB, rate = N.fam === "sol" ? STAKE_APY : 0.03, yr = (units / BASE) * rate;
  const wal = sendMaxProtect(), safe = P.v?.main?.available || 0;
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"];
  const src = (k, name, bal) => `<button data-act="earn-src" data-v="${k}" aria-pressed="${P.src === k}"${bal ? "" : " disabled"}>${name} <em>${mask(amt(bal, "native"))}</em></button>`;
  const len = (P.amount || "0").length, big = len > 8 ? " xs" : len > 6 ? " sm" : "";
  return `${phead(`Stake ${u}`)}
  <div class="es2">
    <div class="seg es-seg">${src("wallet", "Wallet", wal)}${src("safe", "Safe", safe)}</div>
    <div class="mv-amt es-amt${big}${units > max ? " over" : ""}">${pad ? `<b>${esc(P.amount || "0")}</b>` : `<input data-amount inputmode="decimal" placeholder="0" value="${esc(P.amount)}" autocomplete="off" autofocus style="width:${Math.max(1, len) + 0.6}ch"/>`}<span class="u">${u}</span></div>
    <div class="mv-sub">${units > max ? `<span class="bad">More than your ${P.src === "wallet" ? "Wallet" : "Safe"} has</span>` : usd != null && units ? money(usd) : `${amt(max, "native")} ${u} available`}</div>
    <div class="mv-pcts">${[25, 50, 100].map((v) => `<button data-act="pct" data-v="${v}" class="${P.pct === v ? "on" : ""}">${v === 100 ? "Max" : v + "%"}</button>`).join("")}</div>
    <p class="es-line"><span>${valid ? `≈ <b>${yr.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${u}</b> a year` : `~${(ENG?.staking?.apy || STAKE_APY_TEXT).replace(/^about /, "")} a year`}</span></p>
    ${pad ? `<div class="kp">${keys.map((k) => `<button data-act="key" data-k="${k}" aria-label="${k === "del" ? "Delete" : k}">${k === "del" ? `<svg viewBox="0 0 24 24"><path d="M9 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5-6z"/><path d="M12.5 10l4 4M16.5 10l-4 4"/></svg>` : k}</button>`).join("")}</div>` : ""}
    <div class="es-foot"><button class="btn primary xl" data-act="do-stake"${valid ? "" : " disabled"}>${valid ? `Stake ${amt(units, "native")} ${u}` : `Stake ${u}`}</button></div>
  </div>`;
}
function earnUnstakeView(P) {
  const N = NETS[S.net], x = (P.st?.items || []).find((y) => String(y.id) === String(P.id)); if (!x) { P.mode = "home"; return earnShell(stakeNets()); }
  const usd = usdOf(x.amount, "native"), lido = N.fam === "evm", days = N.fam === "sol" ? "2–3 days" : "1–5 days";
  return `${phead("Unstake")}
  <div class="ern3 eu">
    <section class="e3">
      ${coin(S.net, "e3-coin")}
      <span class="e3-lbl">Unstake</span>
      <b class="e3-amt">${amt(x.amount, "native")} <small>${N.unit}</small></b><span class="e3-fiat">${usd != null ? money(usd) : "&nbsp;"}</span>
    </section>
    <div class="eu-rows">
      <div><span>Back in your Safe</span><b>in ${days}</b></div>
      <div><span>Stops earning</span><b>${lido ? "when Lido pays out" : "at the end of the epoch"}</b></div>
      <div><span>From</span><b>${lido || /\s/.test(x.who || "") ? esc(x.who || "Lido") : `<span class="mono">${esc(short(x.who))}</span>`}</b></div>
    </div>
    <p class="e3-fine">It comes back into your Safe only. To take it out after, withdraw as usual.</p>
    <div class="e3-acts one"><button class="btn primary xl" data-act="do-unstake">Unstake ${amt(x.amount, "native")} ${N.unit}</button></div>
  </div>`;
}
function earnMotion(P) {
  const N = NETS[S.net], k = P.kind || "stake", n = P.sent || 0, usd = usdOf(n, "native"), lido = N.fam === "evm";
  const days = N.fam === "sol" ? "2–3 days" : "1–5 days";
  const o = {
    stake: { title: ["Staking", "Staked"], line: "Safe → Staked", note: lido ? "Earning now through Lido. It stays in your Safe." : "Earning starts next epoch, in a day or two. It stays in your Safe." },
    unstake: { title: ["Unstaking", "Unstaking started"], line: "Staked → Safe", note: `Back in your Safe in ${days}. Then choose To Wallet or Keep in Safe in Earn.` },
    reclaim: { title: ["Bringing it back", "Back in your Safe"], line: "Staked → Safe", note: "Back in your Safe, rewards included." },
    reclaimW: { title: ["Sending it to your Wallet", "On its way to your Wallet"], line: "Staked → Safe → Wallet", note: `It reaches your Wallet in ${P.v?.main?.withdrawDelay ? delay(P.v.main.withdrawDelay) : "your Safe's delay"}. You can cancel it until then.` },
  }[k];
  return motionView(P, { kind: k === "stake" ? "stake" : k === "reclaimW" ? "withdraw" : "keep", N, title: o.title, amount: `${amt(n, "native")} ${N.unit}`, usd: usd != null ? money(usd) : "", line: o.line, note: o.note, rows: [] });
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
    const mine = chrome.runtime.getManifest().version, must = older(mine, j.minimum);
    // The phone app: a newer version is one reload away (`latest`). The extension: only a version Chrome's Web Store has
    // approved and published (`chrome`), never one still in review; a required security update always shows.
    const target = globalThis.ECRIN_WEB ? j.latest : j.chrome;
    const newer = must || (!!target && older(mine, target));
    const { updHide } = await local.get("updHide");
    S.upd = newer && (must || updHide !== target) ? { latest: target || j.latest, must, notes: j.notes || "" } : null;
    if (S.screen === "home") render();
  } catch (_) {}
}
function updateBanner() {
  const u = S.upd; if (!u) return "";
  return `<div class="upd-w"><button class="upd ${u.must ? "must" : ""}" data-act="upd-go">${I.warn}<span><b>${u.must ? "Security update required" : "Update available"}</b><small>${u.must ? "Sending and signing are paused until you update." : `Version ${esc(u.latest)} is ready.`} ${globalThis.ECRIN_WEB ? "Tap to reload." : "Tap to get it from the Chrome Web Store."}</small></span></button>${u.must ? "" : `<button class="upd-x" data-act="upd-hide" aria-label="Hide until the next version">${I.x}</button>`}</div>`;
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
function noticeIncoming() {} // replaced by checkIncoming(): every coin, every network, remembered between visits

// Money arriving: every coin on every network, compared with what this device last saw (kept between visits), so an
// arrival while the app was closed still plays the moment you open it. Our own moves (release, swap) are skipped.
// Rules that keep it honest: one check at a time; a network that failed to load is unknown, not zero; a rise only
// counts if it beats the highest value seen in the last 3 minutes (so a stale read flipping back and forth never
// plays); and the same arrival is never announced twice.
let incomingRun = Promise.resolve();
function checkIncoming() { incomingRun = incomingRun.then(checkIncomingNow, checkIncomingNow); return incomingRun; }
async function checkIncomingNow() {
  const w = worth(); if (!w.ready || !ACCT) return;
  if (S.seen === undefined) S.seen = (await local.get("seenBal")).seenBal || {};
  S.seenHi ||= {}; S.announced ||= {};
  const who = curAcct()?.id ?? "0", first = !Object.keys(S.seen).some((k) => k.startsWith(who + ":")), mine = Date.now() - (S.lastTx || 0) < 90_000, t = Date.now();
  const okNets = new Set([...(S.all || []).filter((r) => r.ok).map((r) => r.k), ...(S.bal ? [S.net] : [])]);
  const got = [], now = {};
  for (const i of w.items) now[`${who}:${i.k}:${i.a}`] = { v: i.chq, i };
  // a coin that disappeared only counts as zero when its network actually answered
  for (const k of Object.keys(S.seen)) if (k.startsWith(who + ":") && !(k in now) && okNets.has(k.split(":")[1])) now[k] = { v: 0 };
  for (const [k, { v, i }] of Object.entries(now)) {
    const was = S.seen[k], hist = (S.seenHi[k] || []).filter((h) => t - h.t < 180_000), hi = Math.max(was ?? 0, ...hist.map((h) => h.v));
    const key = `${k}:${v.toFixed(9)}`;
    if (!first && !mine && i && was != null && v > hi + 1e-9 && !S.announced[key]) { got.push({ i, d: v - Math.max(was, ...hist.map((h) => h.v).filter((x) => x <= v)) }); S.announced[key] = t; }
    hist.push({ v, t }); S.seenHi[k] = hist.slice(-12); S.seen[k] = v;
  }
  for (const [key, at] of Object.entries(S.announced)) if (t - at > 600_000) delete S.announced[key];
  local.set({ seenBal: S.seen });
  if (!got.length || S.recvNotify === false) return;
  got.sort((x, y) => (y.i.usd || 0) - (x.i.usd || 0));
  const g = got[0], n = (x) => x.toLocaleString("en-US", { maximumFractionDigits: g.i.dec });
  const label = `+${n(g.d)} ${g.i.unit}${got.length > 1 ? ` · +${got.length - 1} more` : ""}`;
  for (const x of got) if (["evm", "sui"].includes(NETS[x.i.k]?.fam)) logActivity({ t: "recv", a: x.i.a, n: Math.round(x.d * (x.i.a === "usdc" ? USDC_BASE : BASE)), k: x.i.k }).then(loadActivity);
  if (document.hidden && window.Notification?.permission === "granted") try { new Notification("Ecrin Wallet", { body: `Received ${n(g.d)} ${g.i.unit} on ${g.i.net}`, icon: "/icon2-192.png" }); } catch (_) {}
  // one animation at a time: a newer arrival replaces one that hasn't played yet, and nothing replays on re-render
  S.recvQ = label; playRecv();
}
// Played only where you can see it: on home, app in front. Otherwise it waits until you are.
function playRecv() {
  if (!S.recvQ || document.hidden || S.screen !== "home" || document.querySelector(".fx-recv")) return;
  const l = S.recvQ; S.recvQ = null; recvFx(l);
}
document.addEventListener("visibilitychange", playRecv);

// Phone app: pull down to refresh (the Ecrin mark follows your finger, then spins until everything is fresh),
// and a light tap of the vibration motor on important buttons (Android).
if (globalThis.ECRIN_WEB) {
  let y0 = null, d = 0, busy = false;
  const ptr = document.createElement("div"); ptr.className = "ptr"; ptr.innerHTML = `<span class="ptr-ic">${MARK}</span>`; (document.querySelector(".device") || document.body).append(ptr);
  const set = (v) => { ptr.style.setProperty("--p", v); ptr.classList.toggle("ready", v >= 1); };
  document.addEventListener("touchstart", (e) => { const r = $("#root"); y0 = !busy && S.screen === "home" && !S.panel && r.scrollTop <= 0 && !e.target.closest("[data-chart]") ? e.touches[0].clientY : null; d = 0; }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (y0 == null) return; d = Math.max(0, e.touches[0].clientY - y0);
    const p = Math.min(1.25, d / 110); ptr.classList.add("pull"); set(p);
    if (p >= 1 && !ptr._tick) { ptr._tick = true; haptic("light"); } if (p < 1) ptr._tick = false;
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
  document.addEventListener("click", (e) => { if (e.target.closest(".btn.primary, .acts button, .tk-acts button, #tabbar button, .sf-go, .sa-x, [data-act='ap-ok']")) haptic("light"); }, true);
}

function recvFx(label) {
  const host = document.querySelector(".device") || document.body, el = document.createElement("div");
  el.className = "fx-recv"; el.setAttribute("aria-live", "polite");
  el.innerHTML = `<svg class="fx-in" viewBox="0 0 120 120"><g class="rays"><path class="ray" style="--i:0" d="M60 60 L130.0 60.0"/><path class="ray" style="--i:1" d="M60 60 L109.5 109.5"/><path class="ray" style="--i:2" d="M60 60 L60.1 130.0"/><path class="ray" style="--i:3" d="M60 60 L10.6 109.6"/><path class="ray" style="--i:4" d="M60 60 L-10.0 60.1"/><path class="ray" style="--i:5" d="M60 60 L10.4 10.6"/><path class="ray" style="--i:6" d="M60 60 L59.8 -10.0"/><path class="ray" style="--i:7" d="M60 60 L109.4 10.4"/></g><g class="dia"><path class="d-o d-fill" pathLength="100" d="M60 22 L88 50 L60 98 L32 50 Z"/><path class="d-f" pathLength="100" d="M32 50 H88 M46 36 L60 50 L74 36 M60 50 V98 M46 36 L52 50 M74 36 L68 50"/></g></svg><b>${esc(label)}</b><small>Received</small>`;
  host.appendChild(el); haptic("success");
  setTimeout(() => el.classList.add("out"), 2500); setTimeout(() => { el.remove(); playRecv(); }, 3000);
}


/* ------------------------------------------------------------------ bridges (LI.FI)
   Move USDC or ETH from one network to another without leaving Ecrin. LI.FI finds the route and builds the
   transaction; Ecrin's server adds Ecrin's fee; the wallet checks the transaction before signing (chains.js
   bridgeSend), sends it, and a small Ecrin pill follows it until it arrives on the other network. */
const BRIDGE = { on: false, fee: 0.00875, api: "https://ecrinprotocol.app/api/bridge", checked: 0 };
const BR_USDC = ["solm", "ethm", "basem", "arbm", "opm", "polm", "avaxm", "hypem"], BR_ETH = ["ethm", "basem", "arbm", "opm"];
const ZERO_EVM = "0x0000000000000000000000000000000000000000";
async function bridgeStatus() {
  if (globalThis.ECRIN_DEMO) { BRIDGE.on = true; return; }
  if (Date.now() - BRIDGE.checked < 60_000) return; BRIDGE.checked = Date.now();
  try { const d = await (await fetch(BRIDGE.api + "/status", { cache: "no-store" })).json(); BRIDGE.on = !!d.on; BRIDGE.fee = Number(d.fee) || 0.00875; } catch (_) {}
  if (S.panel?.p === "bridge") renderPanel();
}
/** Networks this account can bridge a coin on (needs an address of that family). */
const brNets = (coinK) => (coinK === "usdc" ? BR_USDC : BR_ETH).filter((k) => NETS[k] && netKeys().includes(k));
/** What you hold of the coin on a network, in coins (Wallet side only: the Safe's coins stay in the Safe). */
const brHeld = (k, coinK) => { const it = worth().items.find((i) => i.k === k && (coinK === "usdc" ? i.a === "usdc" : i.a !== "usdc")); return it ? it.chq || 0 : 0; };
const brDec = (k, coinK) => (coinK === "usdc" ? 6 : NETS[k].fam === "sol" ? 9 : 18);
const brAddr = (k) => (NETS[k].fam === "sol" ? ACCT?.sol?.publicKey?.toBase58?.() : ACCT?.evm?.address) || "";
const brUnit = (coinK) => (coinK === "usdc" ? "USDC" : "ETH");
/** Fees on ETH: keep a little behind for the network fee. */
const brMax = (k, coinK) => Math.max(0, brHeld(k, coinK) - (coinK === "usdc" ? 0 : k === "ethm" ? 0.003 : 0.0004));
function bridgeQuoteSoon(ms = 450) {
  const P = S.panel; if (!P || P.p !== "bridge") return;
  clearTimeout(S.brT); const mine = (P.qSeq = (P.qSeq || 0) + 1); P.quote = null; P.qErr = null;
  const raw = toRaw(P.amount, brDec(P.from, P.coin)); if (!raw || !BRIDGE.on || !P.to) { patchPanel(); return; }
  P.quoting = true; patchPanel();
  S.brT = setTimeout(async () => {
    try {
      let d;
      if (globalThis.ECRIN_DEMO) { await new Promise((r) => setTimeout(r, 600)); const out = (raw * BigInt(Math.round((1 - BRIDGE.fee - 0.0012) * 1e6))) / 1_000_000n; d = { toAmount: String(out), toAmountMin: String((out * 995n) / 1000n), seconds: P.coin === "usdc" ? 25 : 60, feesUSD: 0.03, gasUSD: 0.01, tool: "Across", bridge: "across", fee: BRIDGE.fee }; }
      else {
        const r = await fetch(`${BRIDGE.api}/quote?` + new URLSearchParams({ from: P.from, to: P.to, coin: P.coin, amount: String(raw), fromAddress: brAddr(P.from), toAddress: brAddr(P.to) }), { cache: "no-store" });
        d = await r.json().catch(() => ({})); if (!r.ok || !d.toAmount) throw new Error(d.error || "No route right now");
      }
      if (P.qSeq !== mine || S.panel !== P) return; P.quote = d;
    } catch (e) { if (P.qSeq === mine) P.qErr = e.message || "No route right now"; }
    if (P.qSeq === mine && S.panel === P) { P.quoting = false; renderPanel(); }
  }, ms);
}
const brSecs = (s) => (!s ? "" : s < 90 ? `about ${Math.max(5, Math.round(s / 5) * 5)} seconds` : `about ${Math.round(s / 60)} minutes`);
function bridgeView() {
  if (!isMain()) return `${phead("Bridge")}<div class="cv"><div class="cv-art">${I.swap}</div><h2>Bridges run on Mainnet</h2><p class="sub">Bridges move real coins between networks, and have no test version. Switch Settings → Networks to Mainnet to bridge.</p></div>`;
  const P = S.panel; bridgeStatus();
  P.coin ||= "usdc";
  const nets = brNets(P.coin);
  if (!nets.includes(P.from)) P.from = [...nets].sort((a, b) => brHeld(b, P.coin) - brHeld(a, P.coin))[0];
  if (!P.to || P.to === P.from || !nets.includes(P.to)) P.to = nets.find((k) => k !== P.from && k === "basem") || nets.find((k) => k !== P.from);
  if (!P.from || !P.to) return `${phead("Bridge")}<div class="cv"><div class="cv-art">${I.swap}</div><h2>Nothing to bridge here</h2><p class="sub">Bridges need an address on two networks. This account has only one.</p></div>`;
  const unit = brUnit(P.coin), dec = brDec(P.from, P.coin), raw = toRaw(P.amount, dec), max = brMax(P.from, P.coin), over = Number(P.amount || 0) > max + 1e-12, q = P.quote;
  const outN = q ? fromRaw(q.toAmount, brDec(P.to, P.coin)) : 0, nf = (v) => v.toLocaleString(S.lang === "fr" ? "fr-CA" : "en-US", { maximumFractionDigits: P.coin === "usdc" ? 2 : 6 });
  const px = P.coin === "usdc" ? 1 : S.prices.ethereum?.usd, inUsd = px ? Number(P.amount || 0) * px : null;
  if (P.pick) {
    const list = P.pick === "coin" ? [["usdc", "USD Coin", "USDC"], ["native", "Ethereum", "ETH"]] : nets.filter((k) => (P.pick === "to" ? k !== P.from : true));
    return `${phead(P.pick === "coin" ? "Which coin?" : P.pick === "from" ? "From which network?" : "To which network?")}
      <section class="list">${P.pick === "coin" ? list.map(([k, n, u]) => `<button class="arow" data-act="br-set" data-k="coin" data-v="${k}"><span class="cstack">${coin(k === "usdc" ? "usdc" : "eth")}</span><span class="ar-t"><b>${n}</b><small>${u}</small></span>${P.coin === k ? `<span class="acc-ok">${I.check}</span>` : ""}</button>`).join("")
        : list.map((k) => `<button class="arow" data-act="br-set" data-k="${P.pick}" data-v="${k}"><span class="cstack">${coin(k)}</span><span class="ar-t"><b>${esc(NETS[k].name)}</b><small>${nf(brHeld(k, P.coin))} ${unit}</small></span>${P[P.pick] === k ? `<span class="acc-ok">${I.check}</span>` : ""}</button>`).join("")}</section>`;
  }
  const netBtn = (side, k) => `<button class="br-net" data-act="br-pick" data-v="${side}">${coin(k)}<span>${esc(NETS[k].name)}</span>${I.chev}</button>`;
  const feeLine = `<div class="sx-kv">
      <div><span>You receive</span><b>${q ? `≈ ${nf(outN)} ${unit}` : "—"}</b></div>
      <div><span>Arrives in</span><b>${q ? brSecs(q.seconds) || "a few minutes" : "—"}</b></div>
      <div><span>Ecrin fee</span><b>${feePct(BRIDGE.fee)} (included)</b></div>
      <div><span>Network and bridge fees</span><b>${q ? (q.feesUSD + q.gasUSD > 0 ? `≈ ${money(q.feesUSD + q.gasUSD)}` : "included") : "—"}</b></div>
      ${q?.tool ? `<div><span>Route</span><b>${esc(String(q.tool))} · via LI.FI</b></div>` : ""}</div>`;
  if (P.step === "review") return `${phead("Review bridge")}
    <div class="br br-rv">
      <div class="br-rv-amt">${coin(P.coin === "usdc" ? "usdc" : "eth")}<b>${esc(P.amount)} ${unit}</b><small>${inUsd != null ? money(inUsd) : ""}</small></div>
      <div class="br-path"><span>${coin(P.from)}${esc(NETS[P.from].name)}</span><i>${I.arrow}</i><span>${coin(P.to)}${esc(NETS[P.to].name)}</span></div>
      ${feeLine}
      <p class="br-note">${I.shield}<span>It arrives at your own address on ${esc(NETS[P.to].name)}. Ecrin checks the transaction before you sign: only the ${unit} you chose can leave.</span></p>
    </div>
    <div class="pfoot snd-foot"><button class="btn xl" data-act="br-back">Back</button><button class="btn primary xl" data-act="br-go">Confirm</button></div>`;
  const btn = !BRIDGE.on ? "Bridges open soon" : !raw ? "Enter an amount" : over ? `Not enough ${unit} on ${NETS[P.from].name}` : P.quoting || !q ? (P.qErr ? "No route right now" : "Finding the best route…") : "Review bridge";
  return `${phead("Bridge")}
    <div class="sx br">
      <button class="br-coin" data-act="br-pick" data-v="coin">${coin(P.coin === "usdc" ? "usdc" : "eth")}<span><b>${P.coin === "usdc" ? "USD Coin" : "Ethereum"}</b><small>${unit}</small></span>${I.chev}</button>
      <div class="sx-card br-card">
        <div class="sx-top"><span class="sx-k">From</span><span class="sx-bal">Balance ${nf(brHeld(P.from, P.coin))} ${unit}</span></div>
        <div class="sx-row">${netBtn("from", P.from)}<input class="sx-in" data-bramt inputmode="decimal" placeholder="0" value="${esc(P.amount || "")}" autocomplete="off"/></div>
        <div class="sx-foot"><span class="sx-pcts">${[25, 50, 100].map((v) => `<button data-act="br-pct" data-v="${v}" class="${P.pct === v ? "on" : ""}">${v === 100 ? "Max" : v + "%"}</button>`).join("")}</span><span class="sx-usd">${over ? `<span class="bad">Not enough</span>` : inUsd ? money(inUsd) : ""}</span></div>
      </div>
      <button class="sx-flip br-flip" data-act="br-flip" aria-label="Switch networks"><svg viewBox="0 0 24 24"><path d="M8 4v15M8 19l-4-4M8 19l4-4M16 20V5M16 5l-4 4M16 5l4 4"/></svg></button>
      <div class="sx-card to br-card">
        <div class="sx-top"><span class="sx-k">To</span><span class="sx-bal">Your address on ${esc(NETS[P.to].name)}</span></div>
        <div class="sx-row">${netBtn("to", P.to)}<span class="sx-out">${q ? nf(outN) : P.quoting ? `<i class="spin"></i>` : "0"}</span></div>
      </div>
      ${P.qErr && raw ? `<p class="err">${esc(P.qErr)}</p>` : ""}
      ${feeLine}
      ${!BRIDGE.on ? `<p class="br-note">${I.clock}<span>Bridges open very soon: Ecrin is finishing its setup with LI.FI.</span></p>` : ""}
    </div>
    <div class="pfoot"><button class="btn primary xl" data-act="br-review" ${BRIDGE.on && raw && !over && q ? "" : "disabled"}>${btn}</button></div>`;
}
async function bridgeNow() {
  const P = S.panel; if (!P?.quote) return;
  if (S.upd?.must) return toast("A security update is required before you can bridge. Update Ecrin Wallet first.", "err");
  const from = P.from, to = P.to, coinK = P.coin, unit = brUnit(coinK), amount = P.amount, raw = toRaw(amount, brDec(from, coinK));
  const usd = coinK === "usdc" ? Number(amount) : S.prices.ethereum?.usd ? Number(amount) * S.prices.ethereum.usd : null;
  const lim = await limitCheck(usd); if (lim) { P.step = "form"; renderPanel(); return toast(lim, "err"); }
  closePanel(); txPill("run", `Bridging ${amount} ${unit}`, `${NETS[from].name} → ${NETS[to].name}`);
  try {
    const { dev } = await local.get("dev"), e = engine({ web3, ethers, acct: ACCT, net: from, dev: dev || {} });
    let d, sig;
    if (globalThis.ECRIN_DEMO) { d = { ...P.quote, bridge: "demo" }; sig = await e.bridgeSend({ demo: true, asset: coinK === "usdc" ? "usdc" : "native", units: coinK === "usdc" ? Number(amount) * USDC_BASE : Number(amount) * BASE }); }
    else {
      // A fresh quote for the transaction itself (prices move), with the same checks.
      const r = await fetch(`${BRIDGE.api}/quote?` + new URLSearchParams({ from, to, coin: coinK, amount: String(raw), fromAddress: brAddr(from), toAddress: brAddr(to) }), { cache: "no-store" });
      d = await r.json().catch(() => ({})); if (!r.ok || !d.tx) throw new Error(d.error || "LI.FI couldn't build this bridge. Try again.");
      if (BigInt(d.fromAmount) !== raw) throw new Error("The bridge quote changed the amount. Ecrin refused it.");
      if (d.toAmountMin && P.quote.toAmount && BigInt(d.toAmountMin) < (BigInt(P.quote.toAmount) * 97n) / 100n) throw new Error("The price moved more than 3% since your review. Try again.");
      sig = await e.bridgeSend({ tx: d.tx, approval: d.approval, fromToken: d.fromToken, fromAmount: d.fromAmount });
    }
    S.lastTx = Date.now(); haptic("success");
    await logActivity({ t: "bridge", k: from, to: NETS[to].name, a: coinK === "usdc" ? "usdc" : "native", n: coinK === "usdc" ? Number(amount) * USDC_BASE : 0, sym: unit, amt: amount, sig: typeof sig === "string" ? sig : null });
    if (usd != null) await countSpend(usd);
    txPill("run", `Bridging ${amount} ${unit}`, `Sent from ${NETS[from].name} · arriving on ${NETS[to].name}`);
    refresh().then(() => { loadActivity(); loadAll(); });
    // Follow it to the other side.
    if (globalThis.ECRIN_DEMO) { await new Promise((r) => setTimeout(r, 2500)); return txPill("ok", `${unit} arrived on ${NETS[to].name}`, `${amount} ${unit} bridged`); }
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, i < 6 ? 5000 : 15000));
      const t = await fetch(`${BRIDGE.api}/track?` + new URLSearchParams({ tx: String(sig), from: String(d.fromChain), to: String(d.toChain), bridge: d.bridge || "" }), { cache: "no-store" }).then((x) => x.json()).catch(() => ({}));
      if (t.status === "DONE") { txPill("ok", `${unit} arrived on ${NETS[to].name}`, `${amount} ${unit} bridged`, t.link || null); loadAll(); return; }
      if (t.status === "FAILED") { txPill(null); return toast(`The bridge didn't complete. LI.FI refunds it on ${NETS[from].name}${t.link ? " (see its page)" : ""}.`, "err"); }
    }
    txPill(null); toast("The bridge is taking longer than usual. It will arrive; check Activity in a few minutes.");
  } catch (err) { console.warn(err); txPill(null); toast(errText(err), "err"); }
}

/* ------------------------------------------------------------------ coin first: pick a coin, Ecrin picks the network */
function fromRow() {
  const P = S.panel, N = NETS[S.net], a = P.asset || "native";
  return `<button class="from" data-act="pick-coin">${coinOn(a)}<span><b>${a === "usdc" ? "USDC" : N.unit}</b><small>on ${N.name}</small></span>${I.chev}</button>`;
}
function pickView() {
  const P = S.panel, w = worth(), need = P.back === "withdraw" ? "sav" : P.back === "receive" ? null : "chq";
  // Protect only offers coins on networks where a Safe can live (the Safe program or contract is deployed there).
  let list = need ? w.items.filter((i) => i[need] > 0 && (P.back !== "protect" || canSafe(i.k))) : [];
  if (!need) list = netKeys().map((k) => NETS[k]).flatMap((N) => [{ k: N.key, a: "native", unit: N.unit, name: COIN_NAME[N.unit] || N.unit, net: nname(N), coin: N.key }, ...(N.usdc ? [{ k: N.key, a: "usdc", unit: "USDC", name: "USD Coin", net: nname(N), coin: "usdc" }] : [])]);
  // Each coin shows once (ETH, USDC…). A coin on several networks opens its networks when tapped, and you pick where:
  // a transaction lives on one network. With balances, the row shows the total and the fullest network comes first.
  const groups = [];
  for (const i of list) { const g = i.a === "usdc" ? "USDC" : i.unit; let G = groups.find((x) => x.g === g); if (!G) groups.push((G = { g, items: [] })); G.items.push(i); }
  const amt = (x) => (need ? x[need] || 0 : 0);
  list = groups.map(({ g, items }) => {
    if (items.length === 1) return items[0];
    const nets = need ? [...items].sort((x, y) => amt(y) - amt(x)) : items, tot = (k) => items.reduce((t, i) => t + (i[k] || 0), 0);
    const face = g === "USDC" ? "usdc" : (items.find((i) => NETS[i.k].name === COIN_NAME[g]) || items[0]).coin;
    return { ...items[0], coin: face, k: face, chq: tot("chq"), sav: tot("sav"), usd: need ? tot("usd") : null, net: `${items.length} networks`, merged: g, nets };
  });
  const n = (v, d) => v.toLocaleString("en-US", { maximumFractionDigits: d });
  return `${phead({ send: "Send which coin?", protect: "Protect which coin?", withdraw: "Withdraw which coin?", receive: "Receive which coin?", payreq: "Request which coin?" }[P.back] || "Choose a coin")}
    <section class="list">${list.length ? list.map((i) => {
      const right = (x) => (need ? `<span class="ar-r"><b>${mask(n(x[need], x.dec))} ${x.unit}</b><small>${x.usd != null ? mask(money(x.usd * (x[need] / ((x.chq + x.sav) || 1)))) : ""}</small></span>` : "");
      if (i.merged) { const isOpen = P.openG === i.merged; return `<button class="arow pk-u${isOpen ? " open" : ""}" data-act="pick-grp" data-g="${i.merged}" aria-expanded="${isOpen}"><span class="cstack">${coin(i.coin)}</span><span class="ar-t"><b>${i.name}</b><small>${i.net}</small></span>${right(i)}</button>
        ${open ? `<div class="pk-nets">${i.nets.map((x, j) => `<button class="arow sub" data-act="pick-go" data-n="${x.k}" data-a="${x.a}" data-p="${P.back}"><span class="cstack">${coin(x.k)}</span><span class="ar-t"><b>on ${x.net}</b><small>${need && j === 0 && amt(x) > 0 ? "most here" : "&nbsp;"}</small></span>${right(x)}</button>`).join("")}</div>` : ""}`; }
      return `<button class="arow" data-act="pick-go" data-n="${i.k}" data-a="${i.a}" data-p="${P.back}"><span class="cstack">${coin(i.coin)}${i.coin !== i.k ? `<span class="cmini">${coin(i.k)}</span>` : ""}</span>
      <span class="ar-t"><b>${i.name}</b><small>${i.net}</small></span>${right(i)}</button>`; }).join("") : `<div class="empty">${I.recv}<b>Nothing here yet</b><span>${need === "sav" ? "Your Safe is empty." : isMain() ? "Use Receive to add some." : "Use Receive to get free test coins."}</span></div>`}</section>`;
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
  const tot = list.reduce((a, i) => ({ amt: a.amt + i.chq + i.sav, chq: a.chq + i.chq, sav: a.sav + i.sav, stk: a.stk + (i.stk || 0), usd: a.usd + (i.usd || 0) }), { amt: 0, chq: 0, sav: 0, stk: 0, usd: 0 }), dec = f?.dec ?? 4;
  const n = (v, d) => v.toLocaleString("en-US", { maximumFractionDigits: d }), big = (v) => (v >= 1e6 ? money(v, { notation: "compact", maximumFractionDigits: v >= 1e9 ? 2 : 1 }) : money(v));
  // Price history for the range: the change shown is over that range, like the home chart.
  const h = P.cg ? S.series[`${P.cg}:${S.range}`] : null, W = 328, H = 110;
  const v = P.u === "USDC" ? Array(40).fill(1) : h ? h.pts.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 120)) === 0).map((x) => x[1]) : null;
  const tl = P.u === "USDC" ? null : h ? h.pts.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 120)) === 0).map((x) => x[0]) : null;
  let chart = `<div class="tk-chart"><div class="ch-sk"></div></div>`, dd = 0, pc = 0;
  // the line always ends at the price shown above it
  if (v && tl && px != null && P.u !== "USDC") { v.push(px); tl.push(Date.now()); }
  if (v) {
    // Headroom above the highest point and below the lowest, and a light moving average so one spike never looks clipped.
    const sm = v.map((_, i) => { const a = Math.max(0, i - 1), b = Math.min(v.length - 1, i + 1); let t = 0; for (let j = a; j <= b; j++) t += v[j]; return t / (b - a + 1); }); sm[0] = v[0]; sm[sm.length - 1] = v[v.length - 1];
    const XR = W - 16, lo = Math.min(...sm), hi = Math.max(...sm), sp = hi - lo || 1, xy = sm.map((y, i) => [(i / (sm.length - 1)) * XR, 18 + (1 - (y - lo) / sp) * (H - 30)]);
    let d = `M${xy[0][0].toFixed(1)},${xy[0][1].toFixed(1)}`;
    for (let i = 0; i < xy.length - 1; i++) { const p0 = xy[i - 1] || xy[i], p1 = xy[i], p2 = xy[i + 1], p3 = xy[i + 2] || p2; d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`; }
    dd = v[v.length - 1] - v[0]; pc = (dd / (v[0] || 1)) * 100;
    S.tkChart = { v, tl, xy, W, H };
    const fresh = S.tkDrawKey !== `${P.u}:${S.range}`; S.tkDrawKey = `${P.u}:${S.range}`;
    chart = `<div class="tk-chart${fresh ? " draw" : ""}" data-tkchart><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="tkf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".1"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient><linearGradient id="tkmg" x1="0" x2="1" y1="0" y2="0"><stop offset=".8" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="tkm" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#tkmg)"/></mask></defs><path d="${d}L${XR},${H}L0,${H}Z" fill="url(#tkf)" mask="url(#tkm)"/><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.7" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><line class="tk-x" x1="0" x2="0" y1="0" y2="${H}"/></svg><i class="tk-dot" style="left:${((xy[xy.length - 1][0] / W) * 100).toFixed(2)}%;top:${((xy[xy.length - 1][1] / H) * 100).toFixed(2)}%"></i><i class="tk-pin"></i><span class="ch-tip tk-tip"></span></div>`;
  }
  const rl = { 1: "today", 7: "this week", 30: "this month", 365: "this year" }[S.range];
  const ranges = `<div class="ranges">${[["1", "1D"], ["7", "1W"], ["30", "1M"], ["365", "1Y"]].map(([x, l]) => `<button data-act="range" data-d="${x}" aria-pressed="${S.range === x}">${l}</button>`).join("")}</div>`;
  const icon = coin({ USDC: "usdc", USDT: "usdt", ETH: "eth", SOL: "sol", POL: "pol", BNB: "bnb", AVAX: "avax", TRX: "tron", HYPE: "hype", SUI: "sui" }[P.u] || "eth");
  // Each coin's own brand colour on its page (the home diamond keeps Ecrin's blue palette).
  const BRAND = { SOL: "#9b6bff", ETH: "#7f96ff", USDC: "#3b8ff0", USDT: "#26a17b", POL: "#8f5cf0", BNB: "#f0b90b", AVAX: "#e84142", TRX: "#ff3b4e", SUI: "#4da2ff", HYPE: "#50d2c1" };
  const cc = BRAND[P.u] || COIN_COL[P.u] || "#5b7cff";
  const nets = [...new Set(list.map((i) => NETS[i.k].name))];
  const acts = (S.activity || []).filter((e) => e.n && A(e.a).unit === P.u).slice(0, 5);
  const when = (ms) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric" });
  const savPct = tot.amt ? Math.round((tot.sav / tot.amt) * 100) : 0;
  return `<div class="tk-page" style="--cc:${cc}">${phead(`<span class="tk-ht">${icon}${esc(name)}</span>`)}
    <div class="tk-top">${icon}<span><b>${esc(name)}</b><small>${esc(P.u)}${nets.length ? ` · ${nets.length > 2 ? `${nets.length} networks` : esc(nets.join(", "))}` : ""}</small></span></div>
    <div class="tk-px" data-tkpx>${px != null ? fig(money(px)) : "—"}</div>
    <div class="tk-ch ${dd >= 0 ? "up" : "dn"}" data-tkch>${P.u === "USDC" ? (curCode() === "USD" ? "Stays close to $1" : `Stays close to 1 US dollar · ${money(1)}`) : v ? `${dd >= 0 ? "+" : "−"}${money(Math.abs(dd))} (${Math.abs(pc).toFixed(2)}%) <span>${rl}</span>` : "&nbsp;"}</div>
    ${chart}${ranges}
    <nav class="acts tk-acts">${[["send", "Send", I.send], ["receive", "Receive", I.recv], ["swap", "Swap", I.swap], ["protect", "Protect", I.protect]].map(([p2, l, ic]) => `<button data-act="tok-do" data-p="${p2}"><span>${ic}</span>${l}</button>`).join("")}</nav>
    <div class="tk-bal"><span class="lbl">Your balance</span><b>${S.hide ? "••••" : fig(money(tot.usd))}</b><small>${mask(n(tot.amt, dec))} ${esc(P.u)}${(() => { const c = pr.usd_24h_change; if (c == null || !tot.usd || P.u === "USDC") return ""; const pl = tot.usd - tot.usd / (1 + c / 100); return ` · <span class="${pl >= 0 ? "up" : "dn"}">${pl >= 0 ? "+" : "−"}${mask(money(Math.abs(pl)))} today</span>`; })()}</small>
      ${tot.amt ? `<div class="tk-split"><i style="width:${100 - savPct}%"></i><i class="s" style="width:${savPct}%"></i></div><div class="tk-leg"><span><i></i>Wallet ${mask(n(tot.chq, dec))}</span><span><i class="s"></i>${I.lock}Safe ${mask(n(tot.sav, dec))}</span></div>${tot.stk ? `<div class="tk-stk">${I.spark}<span>${mask(n(tot.stk, dec))} ${esc(P.u)} staked, earning inside your Safe</span></div>` : ""}` : ""}</div>
    ${list.length > 1 ? `<div class="list-h"><b>By network</b><span></span></div><section class="list">${list.map((i) => `<div class="arow">${coin(i.k)}<span class="ar-t"><b>${esc(nname(NETS[i.k]))}</b><small>${i.sav ? `<span class="tk-sv">${I.lock}${mask(n(i.sav, i.dec))} in Safe${i.stk ? ` · ${mask(n(i.stk, i.dec))} staked` : ""}</span>` : "Wallet"}</small></span><span class="ar-r"><b>${i.usd != null ? mask(money(i.usd)) : "—"}</b><small>${mask(n(i.chq + i.sav, i.dec))} ${i.unit}</small></span></div>`).join("")}</section>` : ""}
    <div class="list-h"><b>Market</b><span></span></div>
    <div class="tk-stats">
      <div><span>Price</span><b>${px != null ? money(px) : "—"}</b></div>
      <div><span>24h change</span><b class="${(pr.usd_24h_change ?? 0) >= 0 ? "up" : "dn"}">${pr.usd_24h_change != null ? `${pr.usd_24h_change >= 0 ? "+" : "−"}${Math.abs(pr.usd_24h_change).toFixed(2)}%` : "—"}</b></div>
      ${pr.usd_market_cap && pr.usd_24h_vol ? `<div><span>Market cap</span><b>${big(pr.usd_market_cap)}</b></div><div><span>24h volume</span><b>${big(pr.usd_24h_vol)}</b></div>` : ""}
      <div><span>You hold</span><b>${mask(money(tot.usd))}</b></div>
      <div><span>In your Safe</span><b>${tot.amt ? savPct + "%" : "—"}</b></div>
    </div>
    ${acts.length ? `<div class="list-h"><b>Activity</b><span></span></div><div class="tab-body"><section class="list">${actRows(acts.slice(0, 5)).replace(/<div class="act-day">[^<]*<\/div>/g, "")}</section></div>` : ""}
    <div class="list-h"><b>About ${esc(name)}</b><span></span></div>
    <p class="tk-about">${ABOUT[P.u] || ""}</p></div>`;
}

/** Scrubbing the token chart: price and date follow the finger. */
function bindTokChart(el) {
  const c = el.querySelector("[data-tkchart]"); if (!c || !S.tkChart || c.__bound) return; c.__bound = true;
  const svg = c.querySelector("svg"), x = c.querySelector(".tk-x"), pin = c.querySelector(".tk-pin"), pxEl = el.querySelector("[data-tkpx]"), chEl = el.querySelector("[data-tkch]");
  const keep = { px: pxEl?.innerHTML, ch: chEl?.innerHTML, cls: chEl?.className };
  const fmtT = (ms) => new Date(ms).toLocaleString(S.lang === "fr" ? "fr-CA" : "en-US", S.range === "1" ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", ...(S.range === "365" ? { year: "numeric" } : {}) });
  let last = -1;
  const move = (e) => {
    const r = svg.getBoundingClientRect(), { v, tl, xy, W, H } = S.tkChart, xr = xy[xy.length - 1][0];
    const k = Math.max(0, Math.min(1, ((e.clientX - r.left) / r.width) * (W / xr))), i = Math.round(k * (v.length - 1));
    c.classList.add("scrub"); if (i === last) return; last = i;
    x.setAttribute("x1", xy[i][0]); x.setAttribute("x2", xy[i][0]);
    pin.style.left = `${(xy[i][0] / W) * 100}%`; pin.style.top = `${(xy[i][1] / H) * 100}%`;
    if (pxEl && !S.hide) pxEl.innerHTML = fig(money(v[i]));
    if (chEl) { const dd = v[i] - v[0], pc = (dd / (v[0] || 1)) * 100; chEl.className = `tk-ch ${dd >= 0 ? "up" : "dn"}`; chEl.innerHTML = `${dd >= 0 ? "+" : "−"}${money(Math.abs(dd))} (${Math.abs(pc).toFixed(2)}%) <span>${tl ? fmtT(tl[i]) : ""}</span>`; }
  };
  const leave = () => { last = -1; c.classList.remove("scrub"); if (pxEl) pxEl.innerHTML = keep.px; if (chEl) { chEl.innerHTML = keep.ch; chEl.className = keep.cls; } };
  svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move);
  ["pointerleave", "pointerup", "pointercancel"].forEach((ev) => svg.addEventListener(ev, leave));
}

/* ------------------------------------------------------------------ Safe rules and alerts, for every network at once */
const validFor = (f, t) => (f === "evm" ? /^0x[0-9a-fA-F]{40}$/.test(t) : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t));
const famOf = (k) => (NETS[k].fam === "sol" ? "sol" : "evm");
const openVaults = () => (S.all || []).filter((r) => r.ok && r.v);

/** Sends each change to every network with a Safe in that family ("all" = every network), one after another. */
/** A Safe that opens later on a new network takes your current rules from one you already have: the same delay,
 *  freeze date, and (same kind of address only) guardian, trusted addresses and daily limit. Stricter ones apply at
 *  once; anything looser waits, like any rule change. Quiet: only says something if a rule couldn't be copied. */
async function syncRulesTo(k, eng0) {
  const ref = openVaults().find((r) => r.k !== k && famOf(r.k) === famOf(k)) || openVaults().find((r) => r.k !== k); if (!ref) return;
  const m = ref.v.main, same = famOf(ref.k) === famOf(k), t = now(), jobs = [];
  const fresh = await eng0.vault().catch(() => null); if (!fresh) return; const f = fresh.main;
  if (m.withdrawDelay && m.withdrawDelay !== f.withdrawDelay) jobs.push({ kind: "SetWithdrawDelay", value: m.withdrawDelay });
  if (m.lockedUntil && m.lockedUntil > t + 300 && m.lockedUntil !== f.lockedUntil) jobs.push({ kind: "SetLockedUntil", value: m.lockedUntil });
  if (same) {
    if (m.guardian && String(m.guardian) !== String(f.guardian || "")) jobs.push({ kind: "SetGuardian", value: String(m.guardian) });
    for (const a of m.trusted || []) if (!(f.trusted || []).some((x) => String(x) === String(a))) jobs.push({ kind: "AddTrusted", value: String(a) });
    if (m.dailyLimit && NETS[ref.k].unit === NETS[k].unit && m.dailyLimit !== f.dailyLimit) jobs.push({ kind: "SetDailyLimit", value: m.dailyLimit });
  }
  let failed = 0; for (const c of jobs) { try { await eng0.propose(c); } catch (e) { console.warn("sync rule", k, c.kind, e); failed++; } }
  if (failed) toast(`Your Safe opened on ${NETS[k].name}, but ${failed} rule${failed > 1 ? "s" : ""} didn't copy. Check Rules and alerts.`, "err");
}

/** Apply or cancel a waiting rule change on every network it was made on, then come back to the network you were on. */
async function rcRun(el, method, done) {
  const list = (el.dataset.list || `${el.dataset.n}:${el.dataset.id}`).split(",").map((x) => x.split(":")), back = S.net, fails = [];
  el.disabled = true; el.innerHTML = `<i class="spin"></i>`;
  for (const [k, id] of list) { try { await useNet(k); await (await eng())[method](Number(id)); } catch (e) { fails.push(`${NETS[k]?.name || k}: ${errText(e)}`); } }
  await useNet(back);
  toast(fails.length ? fails[0] : list.length > 1 ? `${done} on ${list.length} networks` : done, fails.length ? "err" : "win");
  await loadAll(); renderPanel();
}
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
  if (!vs.length) return `${phead("Rules and alerts")}<div class="cv"><div class="cv-art">${I.shield}</div><h2>Open your Safe first</h2><p class="sub">Rules and alerts apply to your Safe on every network.</p></div><div class="pfoot"><button class="btn primary xl" data-act="panel" data-p="protect">${I.protect}Open my Safe</button></div>`;
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
      ${row("guardian", I.shield, "Guardian", (() => { const g = [vs.some((r) => r.k === "sol") && ["Solana", guard("sol")], vs.some((r) => famOf(r.k) === "evm") && ["Ethereum", guard("evm")]].filter(Boolean); return g.length === 1 ? g[0][1] : g.map(([n, v]) => `${n}: ${v}`).join(" · "); })())}
      ${row("trust", I.check, "Trusted addresses", trusted.length ? `${trusted.length}` : "None")}
      ${row("freeze", I.lock, "Freeze", lockTxt)}
    </div>
    ${pending.length ? `<div class="list-h"><b>Waiting changes</b><span>cancel any time</span></div><section class="list">${(() => {
      // The same change made on several networks is one row: one Apply, one Cancel for all of them.
      const groups = []; for (const c of pending) { const key = label(c.change); let g = groups.find((x) => x.key === key); if (!g) groups.push((g = { key, items: [] })); g.items.push(c); }
      return groups.map((g) => { const at = Math.max(...g.items.map((c) => c.readyAt)), ready = at <= t, list = g.items.map((c) => `${c.k}:${c.id}`).join(","), n = g.items.length;
        return `<div class="wrow ${ready ? "ready" : ""}"><span class="cstack">${coin(g.items[0].k)}${n > 1 ? `<span class="cmini wr-n">${n}</span>` : ""}</span><span class="wr-t"><b>${esc(g.key)}</b><small>${n > 1 ? `${n} networks` : NETS[g.items[0].k].name}</small></span><span class="wr-r"><b class="cd">${ready ? "Ready" : dur(at - t)}</b>${ready ? `<button class="btn sm primary" data-act="rc-apply" data-list="${list}">Apply</button>` : ""}<button class="btn sm danger" data-act="rc-cancel" data-list="${list}">Cancel</button></span></div>`; }).join(""); })()}</section>` : ""}
    <div class="list-h"><b>Alerts</b><span>when a withdrawal is requested</span></div>
    <div class="sets">
      <button class="srow" data-act="al-tg"><span>${I.send}Telegram</span><span class="sv">Turn on ${I.ext}</span></button>
      <div class="srow mailrow"><span>${I.recv}Email</span><span class="mail-in"><input data-mail type="email" placeholder="you@example.com" autocomplete="email"/><button class="btn sm" data-act="al-mail">On</button></span></div>
    </div>
    <p class="fine pad">Alerts cover your Solana and Ethereum addresses on every network. If a withdrawal you didn't make shows up, open your Safe and cancel it.</p>`;
}
