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
import { bioEnable, bioUnlock, bioName, bioPossible, bioForget } from "./bio.js";
import { sealKeys, openKeys, parseKey, keysFor, COLORS, b58 } from "./accounts.js";
import { translate, trText, LANGS } from "./i18n.js";
import { toTron } from "./tron.js";
import { LOGOS } from "./logos.js";

const VERSION = chrome.runtime.getManifest().version;
// The browser extension can also run as a full page (set-up opens there, like other serious wallets): the same wallet,
// framed in the middle of a lit page. Everything inside works exactly as in the popup.
const IS_EXT = !globalThis.ECRIN_WEB && !globalThis.ECRIN_DEMO && !!globalThis.chrome?.tabs;
const FULL = IS_EXT && new URLSearchParams(location.search).has("full");
const openFull = () => { chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?full=1") }); if (!FULL) window.close(); };
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
// Amounts are kept in US dollars and shown in the currency you pick (Settings → Currency), at today's rate.
const CURS = [["USD", "US dollar"], ["EUR", "Euro"], ["CAD", "Canadian dollar"], ["GBP", "British pound"], ["CHF", "Swiss franc"], ["AUD", "Australian dollar"], ["JPY", "Japanese yen"]];
const curRate = () => (S.cur && S.cur !== "USD" && S.fx?.[S.cur] ? S.fx[S.cur] : 1);
const curCode = () => (curRate() === 1 && S.cur !== "USD" ? "USD" : S.cur || "USD");
const money = (n, opt = {}) => (n * curRate()).toLocaleString(S.lang === "fr" ? "fr-CA" : "en-US", { style: "currency", currency: curCode(), ...opt });
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
  const pr = await local.get(["book", "hideSmall", "order", "recvNotify", "guard", "alertsOn", "showNfts", "goal", "cur", "palerts", "sounds", "obHide"]); S.obHide = !!pr.obHide; S.palerts = pr.palerts || {}; S.sounds = !!pr.sounds; S.showNfts = !!pr.showNfts; S.goal = pr.goal || null; S.cur = pr.cur || "USD"; Object.assign(S, { book: pr.book || {}, hideSmall: !!pr.hideSmall, order: pr.order || "value", recvNotify: pr.recvNotify, guard: { auto: 0, daily: 0, cool: 0, coolOver: 500, late: 1, bet: 0, ...(pr.guard || {}) }, alertsOn: !!pr.alertsOn });
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
  if (go && ["send", "receive", "safety"].includes(go)) setTimeout(() => openPanel(go), 400);
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
const SYM = { solana: "SOL", ethereum: "ETH", "polygon-ecosystem-token": "POL", binancecoin: "BNB", "avalanche-2": "AVAX", tron: "TRX" };
const addrHint = (N) => (N.fam === "sol" ? "Solana address" : N.fam === "tron" ? "Tron address (T…)" : "0x… address");
const getJSON = async (url) => { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error(r.status); return r.json(); };

async function spotPrices() {
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
  if (S.mock) { S.prices = { solana: { usd: 172.4, usd_24h_change: 2.31 }, binancecoin: { usd: 612.5, usd_24h_change: 0.6 }, "avalanche-2": { usd: 28.4, usd_24h_change: -1.4 }, tron: { usd: 0.24, usd_24h_change: 0.9 }, ethereum: { usd: 3410, usd_24h_change: -0.84 }, "polygon-ecosystem-token": { usd: 0.42, usd_24h_change: 1.2 } }; if (S.screen === "home" && !S.mockDrawn) { S.mockDrawn = true; render(); } return loadSeries(); }
  const p = await spotPrices().catch(() => null);
  if (p) { const was = JSON.stringify(S.prices); S.prices = { ...S.prices, ...p }; local.set({ prices: { at: Date.now(), p: S.prices } }); if (S.screen === "home" && JSON.stringify(S.prices) !== was) render(); checkPriceAlerts(); }
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
const faucetBtn = (N, cls = "link", label = `Get free test ${N.unit}`) => N.key === "sol" ? `<button class="${cls} fau-b" data-act="faucet">${label}</button>` : `<a class="${cls}" href="${N.faucet}" target="_blank">${label} ${I.ext}</a>`;
function startCard(w) {
  if (S.obHide || !w.ready) return "";
  const acts = S.activity || [], did = (t) => acts.some((e) => t.includes(e.t));
  const steps = [["Get free test coins", w.total > 0, S.net === "sol" ? 'data-act="faucet"' : 'data-act="panel" data-p="receive"'], ["Protect some in your Safe", w.sav > 0 || did(["protect"]), 'data-act="panel" data-p="protect"'],
    ["Start a withdrawal, then cancel it", did(["cancel", "withdraw", "release"]), 'data-act="panel" data-p="vault"']];
  const n = steps.filter((x) => x[1]).length; if (n === 3) return "";
  return `<section class="ob"><div class="ob-h"><b>Getting started</b><span>${n} of 3</span><button class="ob-x" data-act="ob-hide" aria-label="Hide">×</button></div>
    <i class="ob-bar"><i style="width:${(n / 3) * 100}%"></i></i>
    ${steps.map(([t, ok, a], i) => `<button class="ob-s${ok ? " ok" : ""}" ${ok ? "disabled" : a}><span class="ob-n">${ok ? I.check : i + 1}</span><span>${t}</span>${ok ? "" : I.arrow}</button>`).join("")}</section>`;
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
  if (FULL) document.documentElement.dataset.fpSetup = ["welcome", "createPw", "createPhrase", "createVerify", "importPhrase", "ready"].includes(S.screen) ? "1" : "";
  const html = ({ ready: readyView, loading: () => `<div class="splash boot"><div class="boot-mark">${WORDMARK("lg")}</div><div class="aura" aria-hidden="true" style="${auraT()}"><i class="a1"></i><i class="a2"></i><i class="a3"></i></div></div>`, welcome, createPw, createPhrase, createVerify, importPhrase, unlock, home: homeView, approve: approveView })[S.screen]();
  S.homeSig = S.screen === "home" ? viewSig(html) : null;
  root.innerHTML = html;
  translate(root, S.lang);
  if (FULL) for (const el of document.querySelectorAll(".fp-side, .fp-h")) if (el.dataset.lang !== S.lang) { translate(el, S.lang); el.dataset.lang = S.lang; }
  stageHome(root); maybeNews();
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
    <p class="fine">Testnet beta · not audited · test coins only</p></div>`;
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
  return `<div class="lock">
    <div class="lock-mark"><i class="halo"></i>${LOGO}</div>
    <h1>Welcome back</h1>
    ${la ? `<div class="lock-acct">${acctIc(la)}<span>${esc(la.name)}</span></div>` : `<p class="sub">Unlock Ecrin Wallet</p>`}
    ${S.bio ? `<button class="btn primary xl bio-btn" data-act="bio-unlock">${I.face}Unlock with ${bioName()}</button><p class="or">or use your password</p>` : ""}
    <form class="stack" data-form="unlock">
      <label class="fld"><span>Password</span><input name="pw" type="password" autocomplete="current-password" ${S.bio && globalThis.ECRIN_WEB ? "" : "autofocus"} required/></label>
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
  return `<div class="home${introCls()}"${introVar()}><div class="aura" aria-hidden="true" style="${auraT()}"><i class="a1"></i><i class="a2"></i><i class="a3"></i><i class="a4"></i></div>
    <header class="top">
      <button class="acct" data-act="panel" data-p="accts" title="Your accounts">${acctIc(curAcct())}<span class="acct-n">${esc(curAcct().name)}</span><span class="top-total">${loading ? "" : mask(money(w.total))}</span>${I.chev}</button>
      <div class="top-r">
        <button class="ib" data-act="settings" aria-label="Settings">${I.gear}</button>
      </div>
    </header>
    ${S.err ? `<div class="banner">${esc(S.err)}</div>` : ""}
    ${S.offline ? `<div class="offline"><i></i>You're offline · showing your last balances</div>` : ""}${updateBanner()}${backupCard()}
    <div class="brand-sig" title="Test networks only: these coins have no value">${WORDMARK()}<i>Testnet</i></div>
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
    ${startCard(w)}
    <nav class="acts">
      ${[["send", "Send", I.send], ["receive", "Receive", I.recv], ["protect", "Protect", I.protect]].map(([p, l, ic]) => `<button data-act="panel" data-p="${p}"><span>${ic}</span>${l}</button>`).join("")}
    </nav>
    <div class="tabs ${S.showNfts ? "t3" : ""}" role="tablist">${[["tokens", "Tokens"], ...(S.showNfts ? [["nfts", "Collectibles"]] : []), ["activity", "Activity"]].map(([t, l]) => `<button role="tab" data-act="tab" data-t="${t}" aria-selected="${S.tab === t}">${l}</button>`).join("")}<i class="tab-ind" style="--i:${{ tokens: 0, nfts: 1, activity: S.showNfts ? 2 : 1 }[S.tab] || 0}"></i></div>
    <div class="tab-body">${S.tab === "activity" ? activityList() : S.tab === "nfts" && S.showNfts ? nftGrid() : tokenList(w)}</div>
    ${S.tab === "tokens" && !loading ? homeMore() : ""}
    <footer class="home-end"><span>${LOGO}</span>Ecrin Wallet · testnet beta</footer>

  </div>`;
}

// ------------------------------------------------------------------ the Ecrin lozenge
// Your money as the Ecrin diamond: the outer edge is split by coin (each coin's share, in its colour); the inner edge
// fills with Ecrin blue as more of it sits in your Safe. Thin lines, drawn once when you open the wallet.
// One colour per coin, whatever network it sits on (USDC on Solana and on Base is one USDC). Picked from each coin's
// own brand and kept apart from each other on the dark background.
// Ecrin's own palette: every coin a shade of blue or grey, far enough apart to tell on the diamond, readable on dark and
// light. Tron keeps its red. The diamond, the bubble by each name and the Activity rows all use these.
const COIN_COL = { SOL: "#5b7cff", ETH: "#9badff", USDC: "#3d9bff", POL: "#4352c4", USDT: "#5f7a92", BNB: "#a4abba", AVAX: "#767c88", TRX: "#ff3b5c" };
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
  const LK = { SOL: "sol", ETH: "eth", USDC: "usdc", USDT: "usdt", BNB: "bnb", AVAX: "avax", TRX: "tron", POL: "pol" };
  const grow = S.lzT0 && performance.now() - S.lzT0 < 2300 ? " grow" : "", pill = (cls, col, ic, name, pct) => `<span class="lp ${cls}${grow}" style="--pc:${col};--pf:${pct}%">${ic}<b>${name}</b><em>${pct}%</em><i class="lp-bar"></i></span>`;
  return `<div class="lz-leg">${sh.map(({ u, f }) => pill("", COIN_COL[u] || "#9aa0b4", LK[u] ? coin(LK[u], "lp-c") : `<i class="lp-d"></i>`, u, Math.round(f * 100))).join("")}${pill("lz-s", "#5b7cff", `<span class="lp-lock">${I.lock}</span>`, "Safe", safe)}</div>`;
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
      <span class="ar-t"><b>${cdot(i.unit)}${i.name}</b><small>${i.a === "usdc" ? i.net : p?.usd != null ? `<span data-pk="p:${i.cg}" class="px${S.prevPx?.[i.cg] != null && S.prevPx[i.cg] !== p.usd ? (p.usd > S.prevPx[i.cg] ? " flash-up" : " flash-dn") : ""}">${money(p.usd)}</span>` : i.net}${ch != null ? ` <span class="${ch >= 0 ? "up" : "dn"}">${ch >= 0 ? "+" : "−"}${Math.abs(ch).toFixed(2)}%</span>` : ""}</small></span>
      ${spark(i.cg)}<span class="ar-r"><b data-pk="v:${i.unit}:${i.k}">${i.usd != null ? mask(money(i.usd)) : "—"}</b><small>${mask(n(i.chq + i.sav, i.dec))} ${i.unit}${i.sav ? ` <span class="sv">${I.lock}${mask(n(i.sav, i.dec))}</span>` : ""}</small></span></button>`.replace('class="arow"', `class="arow${sub ? " sub" : ""}"`);
  };
  const out = Object.values(groups).map((g) => {
    if (g.length === 1) return row(g[0]);
    const t = g.reduce((s2, i) => ({ usd: s2.usd + (i.usd || 0), amt: s2.amt + i.chq + i.sav, sav: s2.sav + i.sav }), { usd: 0, amt: 0, sav: 0 }), f = g[0], open = S.open?.[f.unit];
    return `<button class="arow grp" data-act="tok" data-u="${f.unit}"><span class="cstack">${coin(f.a === "usdc" ? "usdc" : f.unit === "ETH" ? "eth" : f.coin)}</span>
      <span class="ar-t"><b>${cdot(f.unit)}${f.name}</b><small>${g.length} networks ${I.chev}</small></span>${spark(f.cg)}
      <span class="ar-r"><b>${mask(money(t.usd))}</b><small>${mask(n(t.amt, f.dec))} ${f.unit}${t.sav ? ` <span class="sv">${I.lock}${mask(n(t.sav, f.dec))}</span>` : ""}</small></span></button>${open ? g.map((i) => `<button class="arow sub" data-act="row-send" data-n="${i.k}" data-a="${i.a}">${coin(i.k)}<span class="ar-t"><b>${NETS[i.k].name}</b><small>${NETS[i.k].net}</small></span><span class="ar-r"><b>${i.usd != null ? mask(money(i.usd)) : "—"}</b><small>${mask(n(i.chq + i.sav, i.dec))} ${i.unit}</small></span></button>`).join("") : ""}`;
  });
  return `<section class="list">${hidden ? `<div class="hid-note">${hidden} small balance${hidden > 1 ? "s" : ""} hidden</div>` : ""}${out.join("")}${extraRows()}</section>
    ${netKeys().some((k) => NETS[k].fam === "evm") ? `<button class="add-tok" data-act="panel" data-p="addTok">${I.plus}Add a token</button>` : ""}
`;
}

// Live prices for every coin Ecrin supports, held or not: something is always moving on the home screen.
const MARKET = [["solana", "SOL", "sol", "Solana"], ["ethereum", "ETH", "eth", "Ethereum"], ["binancecoin", "BNB", "bnb", "BNB"], ["tron", "TRX", "tron", "TRON"], ["avalanche-2", "AVAX", "avax", "Avalanche"], ["polygon-ecosystem-token", "POL", "pol", "Polygon"]];
/** Below your coins, like any good wallet: recent activity, shortcuts and the market. */
function homeMore() {
  const all = S.activity || [];
  let recent = "";
  if (all.length) recent = actRows(all.slice(0, 3));
  const sc = [["swap", "Swap", I.swap, 'data-act="panel" data-p="swap"'], ["buy", "Buy", I.card, 'data-act="panel" data-p="buy"'], ["req", "Request", I.recv, 'data-act="home-req"'],
    ["ct", "Contacts", '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1.2-3.2 3.9-5 7-5s5.8 1.8 7 5"/></svg>', 'data-act="panel" data-p="contacts"'], ...(globalThis.ECRIN_WEB ? [["wc", "Apps", I.link, 'data-act="panel" data-p="wc"']] : globalThis.ECRIN_DEMO ? [] : [["sites", "Sites", I.link, 'data-act="panel" data-p="sites"']]), ["al", "Alerts", I.spark, 'data-act="panel" data-p="alerts"']];
  return `${recent ? `<div class="list-h"><b>Recent activity</b><button class="see-all" data-act="tab" data-t="activity">See all</button></div><div class="tab-body"><section class="list recent">${recent}</section></div>` : ""}
    <div class="list-h"><b>Shortcuts</b></div>
    <div class="shortcuts">${sc.map(([k, l, ic, a]) => `<button class="sc sc-${k}" ${a}><span>${ic}</span>${l}</button>`).join("")}</div>
    ${marketList()}`;
}
function marketList() {
  const rows = MARKET.filter(([cg]) => S.prices[cg]?.usd != null);
  if (!rows.length) return "";
  return `<div class="list-h mkt-h"><b>Market</b><span><i class="live-dot"></i>Live</span></div>
    <section class="list mkt">${rows.map(([cg, unit, logo, name]) => { const p = S.prices[cg], ch = p.usd_24h_change, was = S.prevPx?.[cg], fl = was != null && was !== p.usd ? (p.usd > was ? " flash-up" : " flash-dn") : "";
      return `<button class="arow" data-act="tok" data-u="${unit}">${coin(logo)}<span class="ar-t"><b>${name}</b><small>${unit}</small></span>${spark(cg)}
        <span class="ar-r"><b data-pk="m:${cg}" class="px${fl}">${money(p.usd)}</b><small class="${ch >= 0 ? "up" : "dn"}">${ch >= 0 ? "+" : "−"}${Math.abs(ch ?? 0).toFixed(2)}%</small></span></button>`; }).join("")}</section>`;
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

const COIN_NAME = { SOL: "Solana", ETH: "Ethereum", POL: "Polygon", BNB: "BNB", AVAX: "Avalanche", TRX: "TRON", USDC: "USD Coin" };
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
  const { dev } = await local.get("dev"), acct = ACCT;
  const rows = await Promise.all(netKeys().map(async (k) => {
    try {
      const e = k === S.net && ENG ? ENG : engine({ web3, ethers, acct: ACCT, net: k, dev: dev || {} });
      const [b, v] = await Promise.all([e.balances(), e.vault().catch(() => null)]);
      return { k, b, v, ok: true };
    } catch (_) { return { k, ok: false }; }
  }));
  if (ACCT !== acct) return; // switched account while this was loading
  S.all = rows; queueMicrotask(checkIncoming);
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
  } catch (e) { if (ticket !== P.ticket || S.panel !== P) return; P.info = { err: e?.message === "slow" ? `${NETS[k].name} is slow to answer. Try again in a moment.` : `No token at that address on ${NETS[k].name}.` }; P.lastKey = null; }
  P.looking = false; paintTokPrev();
}
async function tokInfoAt(k, addr) {
  const key = `${k}:${addr.toLowerCase()}`; S.tokCache ||= {}; if (S.tokCache[key]) return S.tokCache[key];
  const { dev } = await local.get("dev");
  const info = await Promise.race([engine({ web3, ethers, acct: ACCT, net: k, dev: dev || {} }).tokenInfo(addr), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 10_000))]);
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
      ${val != null ? `<span class="ar-r"><b class="${cls === "out" ? "neg" : cls === "in" ? "pos" : ""}">${sign}${mask(val.toLocaleString("en-US", { maximumFractionDigits: 6 }))} ${esc(unit)}</b></span>` : ""}</${tag.split(" ")[0]}>`;
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
  const who = e.to || e.from, whoName = who ? nameFor(e.k, who) : null;
  const rowA = (label, a) => `<div><span>${label}</span><b class="mono wrap">${whoName && a === who ? `${esc(whoName)}<br/>` : ""}${esc(a)} <button class="ib sm" data-act="copy" data-v="${esc(a)}" aria-label="Copy">${I.copy}</button></b></div>`;
  return `${phead("Details")}
    <div class="txd-hero"><span class="act-ico lg ${cls}">${ic}</span><b>${title}</b>
      ${val != null ? `<span class="txd-amt ${cls}">${cls === "out" ? "−" : cls === "in" ? "+" : ""}${mask(val.toLocaleString("en-US", { maximumFractionDigits: 6 }))} ${esc(unit)}</span>${usd ? `<small>${mask(money(usd))} today</small>` : ""}` : ""}</div>
    <div class="txd-steps"><span class="ts on"><i></i>${cls === "in" ? "Sent to you" : "Submitted"}</span><span class="ts-l"></span><span class="ts on"><i>${I.check}</i>Confirmed</span></div>
    <div class="tk-info txd-card">
      <div><span>Status</span><b><span class="st-pill">${I.check}Confirmed</span></b></div>
      <div><span>Date</span><b>${e.at ? new Date(e.at).toLocaleString(S.lang === "fr" ? "fr-CA" : "en-US", { dateStyle: "medium", timeStyle: "short" }) : "—"}</b></div>
      <div><span>Network</span><b>${N.name} ${N.net}</b></div>
      ${e.to ? rowA("To", e.to) : ""}${e.from ? rowA("From", e.from) : ""}
      ${e.origin ? `<div><span>Website</span><b>${esc(host(e.origin))}</b></div>` : ""}
      ${e.sig ? `<div><span>Transaction</span><b class="mono">${short(e.sig)} <button class="ib sm" data-act="copy" data-v="${esc(e.sig)}" aria-label="Copy">${I.copy}</button></b></div>` : ""}
    </div>
    ${who && !whoName && N.fam ? `<div class="book-save txd-save"><input data-bookname placeholder="Save this address as a contact" maxlength="24" autocomplete="off"/><button class="btn sm" data-act="txd-save" data-a="${esc(who)}" data-f="${N.fam}">Save</button></div>` : ""}
    ${e.sig ? `<div class="pfoot"><a class="btn xl" href="${N.explorer("tx", e.sig)}" target="_blank">${I.ext}View on the explorer</a></div>` : ""}`;
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
    <p class="fine pad">Contacts stay on this device. Sending to a contact still shows the full address to check.</p>`;
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

function openPanel(p, opts = {}) { if (p === "vault") S.shT0 = 0; S.cvT0 = 0; S.panel = { p, step: "form", asset: opts.a || "native", amount: "", to: "", ...opts }; renderPanel(true); }
function closePanel() { if (S.panel?.step === "done" && (S.panel.p === "protect" || S.panel.p === "withdraw")) S.fly = S.panel.p; const el = $("#panel"); el.classList.remove("in"); document.body.classList.remove("stacked"); setTimeout(() => { if (!S.panel) el.innerHTML = ""; }, 260); S.panel = null;
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
  const views = { send: sendView, protect: moveView, withdraw: moveView, swap: swapView, payreq: payreqView };
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
  const body = ({ send: sendView, receive: receiveView, protect: moveView, withdraw: moveView, vault: vaultView, assets: assetsView, settings: settingsView, reveal: revealView, numbers: numbersView, backup: backupView, pick: pickView, tok: tokenView, rules: rulesView, all: allView, buy: buyView, currency: currencyView, news: newsView, report: reportHTML, txd: txdView, contacts: contactsView, pkey: pkeyView, perms: permsView, safety: safetyView, xtok: xtokView, nft: xtokView, addTok: addTokView, addrs: addrsView, accts: acctsView, acctNew: acctNewView, sites: sitesView, swap: swapView, earn: earnView, wc: wcView, payreq: payreqView, alerts: alertsView })[P.p]();
  if (enter || P.fresh) P.openedAt = performance.now();
  const since = P.openedAt ? performance.now() - P.openedAt : 9999;
  el.innerHTML = `<div class="pane${enter || P.fresh ? " fresh" : ""}${since < 2300 ? " trace" : ""}" style="--tt:${-Math.round(since)}ms">${body}</div>`; translate(el, S.lang);
  P.fresh = false;
  if (enter) requestAnimationFrame(() => { el.classList.add("in"); document.body.classList.add("stacked"); });
  bindHolds(el); depth(el); mountVault3d(el); bindTokChart(el);
  // the top bar turns frosted once the page scrolls under it
  const pane = el.querySelector(".pane"); if (pane) { const sync = () => pane.classList.toggle("scrolled", pane.scrollTop > 6); pane.addEventListener("scroll", sync, { passive: true }); sync(); }
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
    <div class="amt-in"><input data-amount inputmode="decimal" placeholder="0" value="${esc(P.amount)}" autocomplete="off" autofocus style="width:${Math.max(1, [...String(P.amount || "")].reduce((t, c) => t + (/[.,]/.test(c) ? .45 : 1), 0)) + .12}ch"/><span>${A(a).unit}</span></div>
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
      <div class="rev rev-card"><i class="sheet-h" aria-hidden="true"></i>
        <div class="rev-amt">${assetCoin(a, "lg")}<b>${fig(amt(units, a))}</b><span>${A(a).unit}</span><small>${usdOf(units, a) != null ? money(usdOf(units, a)) : ""}</small></div>
        <dl class="rev-l">
          <div><dt>From</dt><dd>Wallet · ${short(e.address)}</dd></div>
          <div><dt>To</dt><dd class="mono">${P.toName ? `<b class="to-name">${esc(P.toName)}</b>` : ""}${esc(P.to.trim())}</dd></div>
          <div><dt>Network</dt><dd>${NETS[S.net].name} ${NETS[S.net].net}</dd></div>
          <div><dt>Network fee</dt><dd>${NETS[S.net].fam === "evm" ? `<span class="seg fee-seg">${[["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]].map(([k, l]) => `<button data-act="speed" data-v="${k}" aria-pressed="${(P.speed || "normal") === k}">${l}</button>`).join("")}</span>` : e.feeText()}</dd></div>
        </dl>
        ${self ? `<p class="warn-n">That's your own address.</p>` : P.fresh ? `<p class="warn-n">${I.shield}<span>You've never sent to this address from Ecrin. Check the first and last characters against where you copied it.</span></p>` : ""}
      </div>
      ${P.coolUntil > Date.now() ? `<div class="cool"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/><circle class="cl-p" cx="20" cy="20" r="17" style="stroke-dashoffset:${(106.8 * (P.coolUntil - Date.now())) / (S.guard.cool * 1000)}"/></svg><span><b data-cool>${Math.ceil((P.coolUntil - Date.now()) / 1000)}s</b><small>Cooling-off pause for big sends. Take a breath: is this really who you think it is?</small></span></div>` : ""}
      <div class="pfoot">${P.coolUntil > Date.now() ? `<button class="hold" disabled><span class="hold-t">${I.clock}Wait for the pause</span></button>` : hold(P.step === "sending" ? "Sending…" : "Hold to send", P.step === "sending")}</div>`;
  }
  const nm = P.named && P.named.name === P.to.trim() ? P.named : null, nmOk = !!(nm?.addr && e.isAddress(nm.addr));
  const valid = units > 0 && units <= sendMax() && (e.isAddress(P.to) || nmOk);
  return `${phead("Send")}
    ${P.payLabel ? `<p class="pay-for">${I.recv}<span>Payment request: <b>${esc(P.payLabel)}</b></span></p>` : ""}
    ${fromRow()}${assetPick()}
    ${amountBlock(sendMax(), "Wallet")}
    ${feeNote(a)}
    <label class="fld to"><span>To</span><div class="in-btn"><input data-to placeholder="${addrHint(NETS[S.net])}" value="${esc(P.to)}" spellcheck="false" autocomplete="off"/><button type="button" class="ib sm" data-act="paste" aria-label="Paste">${I.paste}</button>${globalThis.ECRIN_WEB && navigator.mediaDevices?.getUserMedia ? `<button type="button" class="ib sm" data-act="scan" aria-label="Scan a QR code">${I.qr}</button>` : ""}</div></label>
    ${nm ? (nm.addr && !nmOk ? `<p class="err">${esc(nm.name)} is ${nm.fam === "sol" ? "a Solana" : "an Ethereum"} address. Switch to that network to send to it.</p>` : namedLine()) : P.to && !e.isAddress(P.to) ? `<p class="err">That isn't a ${NETS[S.net].name} address${NETS[S.net].fam === "sol" ? " or a .sol name" : NETS[S.net].fam === "evm" ? " or an .eth name" : ""}.</p>` : ""}
    ${(() => { const to = nmOk ? nm.addr : P.to.trim(); if (!to || !e.isAddress(to)) return ""; const bn = bookName(to) || (nmOk ? nm.name : "");
      return `<div class="to-card"><span class="acct-ic gen">${logoSVG("facets", `${to}:0`)}</span><span class="to-t"><b>${bn ? esc(bn) : "New address"}</b><small class="mono">${short(to)} · ${NETS[S.net].name}</small></span>${bn ? `<span class="to-ok">${I.check}</span>` : ""}</div>`; })()}
    ${bookList().length ? `<div class="book">${bookList().map(([a, n]) => `<button class="${P.to.trim() === a ? "on" : ""}" data-act="book-pick" data-a="${esc(a)}"><i>${esc(n.slice(0, 1).toUpperCase())}</i>${esc(n)}</button>`).join("")}</div>` : ""}
    <div class="pfoot"><button class="btn primary xl" data-act="review" ${valid ? "" : "disabled"}>Review</button></div>`;
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

function hold(label, busy) {
  return `<button class="hold ${busy ? "busy" : ""}" data-hold ${busy ? "disabled" : ""}><span class="hold-fill"></span><span class="hold-t">${busy ? `<i class="spin"></i>` : I.shield}${label}</span></button>`;
}

// Every confirmation in Ecrin: the diamond draws itself, fills with Ecrin blue, a check is drawn inside, and a ring
// pulses out once.
const dcheck = (cls = "") => `<svg class="dck ${cls}" viewBox="0 0 120 120" aria-hidden="true"><g transform="rotate(45 60 60)">
  <rect class="p" x="26" y="26" width="68" height="68" rx="20"/><rect class="o" x="26" y="26" width="68" height="68" rx="20" pathLength="100"/>
  <rect class="f" x="34" y="34" width="52" height="52" rx="15"/></g><path class="t" pathLength="100" d="M47 61 L56 70 L74 51"/></svg>`;
function doneView(title, text, extra = "") {
  const mark = `<div class="done-dck">${dcheck()}</div>`;
  if (mark) return `<div class="done">${mark}<h2>${title}</h2><p>${text}</p>
    ${S.panel.sig ? `<a class="link" href="${NETS[S.net].explorer("tx", S.panel.sig)}" target="_blank">View on the explorer ${I.ext}</a>` : ""}${extra}
    <div class="pfoot"><button class="btn primary xl" data-act="close">Done</button></div></div>`;
  return `<div class="done">${mark}<h2>${title}</h2><p>${text}</p>
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
  const e = ENG, N = NETS[S.net];
  const q = qrcode(0, "H"); q.addData(e.address); q.make(); // high error correction: the logo in the middle can't break it
  return `${phead("Receive")}${fromRow()}
    <div class="recv">
      <div class="qr">${q.createSvgTag({ cellSize: 5, margin: 0, scalable: true })}<span class="qr-c">${(() => { const m = S.panel?.asset === "usdc" ? "usdc" : N.unit === "ETH" ? "eth" : S.net; return coin(m) + (m !== S.net ? `<span class="qr-b">${coin(S.net)}</span>` : ""); })()}</span></div>
      <p class="recv-n">Your ${N.name} address</p>
      ${navigator.share ? `<button class="btn sm share" data-act="share-addr">${I.send}Share address</button>` : ""}
      <button class="addr" data-act="copy-addr"><span class="mono">${esc(e.address)}</span>${I.copy}</button>
      <p class="fine">Only send ${N.name} ${N.net} coins${N.usdc ? " or USDC" : ""} to this address. ${N.fam === "tron" ? "Tron addresses start with T. Test USDT on Nile shows with your tokens." : ""}${N.fam === "evm" ? "The same address works on every Ethereum-style network." : ""}</p>
      ${faucetBtn(N)}
      <button class="btn sm buy-b" data-act="payreq">${I.recv}Request an amount</button>
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
    <div class="mv-amt${units > max || overLim ? " over" : ""}">${pad ? `<b>${esc(P.amount || "0")}</b>` : `<input data-amount inputmode="decimal" placeholder="0" value="${esc(P.amount)}" autocomplete="off" autofocus style="width:${Math.max(1, (P.amount || "0").length) + 0.6}ch"/>`}<span>${u}</span></div>
    <div class="mv-sub">${units > max ? `<span class="bad">More than ${isIn ? "your Wallet has" : "can leave right now"}</span>` : overLim ? `<span class="bad">Over your daily limit of ${amt(lim, a)} ${u}</span>` : usd != null && units ? money(usd) : `${amt(max, a)} ${u} available`}</div>
    ${feeNote(a)}
    <div class="mv-pcts">${[25, 50, 100].map((v) => `<button data-act="pct" data-v="${v}" class="${P.pct === v ? "on" : ""}">${v === 100 ? "Max" : v + "%"}</button>`).join("")}</div>
    <p class="mv-note">${isIn ? `${I.lock}<span>Anything leaving waits <b>${delay(main.withdrawDelay)}</b>, and you can cancel it.</span>` : `${I.clock}<span>Arrives <b>${when}</b> · cancel any time before</span>`}</p>
    ${pad ? `<div class="kp">${keys.map((k) => `<button data-act="key" data-k="${k}" aria-label="${k === "del" ? "Delete" : k}">${k === "del" ? `<svg viewBox="0 0 24 24"><path d="M9 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5-6z"/><path d="M12.5 10l4 4M16.5 10l-4 4"/></svg>` : k}</button>`).join("")}</div>` : ""}
    <div class="pfoot mv-foot">${P.step === "sending" ? hold(isIn ? "Protecting…" : "Starting…", true) : `<div class="slide${valid ? "" : " off"}" data-slide="${isIn ? "do-protect" : "do-withdraw"}"><span class="sl-t">${isIn ? "Slide to lock in your Safe" : "Slide to start withdrawal"}</span><i class="sl-k">${isIn ? I.lock : I.out}</i></div>
      <button class="sr-only" data-act="${isIn ? "do-protect" : "do-withdraw"}" ${valid ? "" : "disabled"}>${isIn ? "Move to Safe" : "Start withdrawal"}</button>`}</div>
  </div>`;
}
function sendMaxProtect() { const a = S.panel.asset; return a === "native" ? Math.max(0, (S.bal?.native || 0) - (S.panel.reserve || 0) - (NETS[S.net].fam === "sol" ? 3_000_000 : 0)) : S.bal?.usdc || 0; }

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
  const rows = S.all;
  if (!rows) return `${phead("Safe")}<div class="vcase safe-all"><div class="mv-top"><span class="mv-mark">${LOGO}<b>ECRIN</b></span><span class="mv-lvl">Every network</span></div><div class="sa-tot"><span class="lbl">Protected</span><b class="sk">&nbsp;</b></div></div>`;
  const mine = [ACCT?.sol?.publicKey?.toBase58?.(), ACCT?.evm?.address?.toLowerCase?.()].filter(Boolean);
  const isMine = (d) => mine.includes(String(d)) || mine.includes(String(d).toLowerCase());
  const t = now() + (S.clockOff || 0), px = (k) => S.prices[NETS[k].cg]?.usd;
  const live = rows.filter((r) => r.ok).map((r) => (r.k === S.net && S.vault !== undefined ? { ...r, v: S.vault } : r));
  const open = live.filter((r) => r.v), closed = Object.values(NETS).filter((N) => netKeys().includes(N.key) && (N.fam === "sol" || N.contract) && !open.some((r) => r.k === N.key));
  const usdOf = (r) => ((r.v.main.balance / BASE) * (px(r.k) || 0)) + ((r.v.usdc?.balance || 0) / USDC_BASE);
  const total = open.reduce((x, r) => x + usdOf(r), 0);
  const waiting = open.reduce((x, r) => x + r.v.main.withdrawals.length + (r.v.usdc?.withdrawals?.length || 0), 0);
  // ---- the Shield: brighter the more of your money is in the Safe
  const w = worth(), share = w.total ? Math.min(1, total / w.total) : 0, pct = Math.round(share * 100);
  const lvl = !open.length ? ["off", "Not raised"] : pct >= 70 ? ["max", "Fortress"] : pct >= 40 ? ["strong", "Strong"] : pct >= 15 ? ["mid", "Building"] : ["low", "Exposed"];
  if (!S.shT0) S.shT0 = performance.now();
  const el = performance.now() - S.shT0, intro = el < 2600 ? " intro" : "";
  const pend = open.flatMap((r) => [...r.v.main.withdrawals.map((x) => ({ ...x, a: "native", r })), ...(r.v.usdc?.withdrawals || []).map((x) => ({ ...x, a: "usdc", r }))]).sort((x, y) => x.readyAt - y.readyAt);
  const next = pend[0], dl = open[0]?.v.main.withdrawDelay;
  const blocked = (S.activity || []).filter((e) => e.t === "cancel"), saved = blocked.reduce((t, e) => t + usdOfEntry(e), 0);
  const hms = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`; };
  const shield = `<svg class="sf-sh" viewBox="0 0 300 300" aria-hidden="true">
    <defs><linearGradient id="sfg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b6c4ff"/><stop offset=".45" stop-color="#4b74ff"/><stop offset="1" stop-color="#00c8ff"/></linearGradient>
      <radialGradient id="sfc" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="#3a5cff" stop-opacity=".55"/><stop offset=".6" stop-color="#1a2160" stop-opacity=".35"/><stop offset="1" stop-color="#0b0d1c" stop-opacity=".1"/></radialGradient></defs>
    <g transform="rotate(45 150 150)">
      <rect class="sf-tk" x="34" y="34" width="232" height="232" rx="52" pathLength="100"/>
      <rect class="sf-base" x="52" y="52" width="196" height="196" rx="44"/>
      <rect class="sf-arc" x="52" y="52" width="196" height="196" rx="44" pathLength="100" style="--p:${Math.max(pct, open.length ? 2 : 0)}"/>
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
      <div class="sf-lvl"><span class="sf-pill"><i></i>Shield ${lvl[1]}</span><span class="sf-pct">${open.length ? `${pct}% of everything you own` : "Open your Safe to raise it"}</span></div>
    </section>
    ${next ? `<div class="sf-alert"><span class="sa-ic">${I.clock}</span><span class="sa-t"><b>${amt(next.amount, next.a)} ${nextU} is leaving your Safe</b><small>to ${isMine(next.dest) ? "your Wallet" : short(String(next.dest))} · on ${NETS[next.r.k].name}</small></span><b class="sa-cd" data-until="${next.readyAt}">${nextLeft > 0 ? hms(nextLeft) : "Ready"}</b>
      <button class="sa-x" data-act="cancel-w" data-n="${next.r.k}" data-id="${next.id}" data-a="${next.a}">${I.shield}Cancel</button></div>` : ""}
    <div class="sf-tiles">
      <div class="sf-tile t-lock"><span class="st-ic">${I.lock}</span><span class="st-k">Locked</span><b>${mask(money(total))}</b><small>${open.length ? `${open.length} network${open.length > 1 ? "s" : ""}` : "Not opened"}</small></div>
      <div class="sf-tile t-out${waiting ? " hot" : ""}"><span class="st-ic">${I.out}</span><span class="st-k">Leaving</span><b>${waiting || "None"}</b><small>${next ? `first in ${nextLeft > 0 ? dur(nextLeft) : "now"}` : "all quiet"}</small></div>
      <button class="sf-tile t-rules" data-act="panel" data-p="rules"><span class="st-ic">${I.gear}</span><span class="st-k">Rules</span><b>${dl ? delay(dl) : "—"}</b><small>delay · alerts ${I.arrow}</small></button>
    </div>
    <div class="sf-cta"><button class="sf-go" data-act="safe-go" data-n="${S.net}" data-p="protect">${I.protect}Protect more</button><button class="sf-go2" data-act="safe-go" data-n="${S.net}" data-p="withdraw">${I.out}Withdraw</button></div>
    <div class="list-h"><b>Blocked</b><span>${blocked.length ? `${blocked.length} stopped${saved ? ` · ${mask(money(saved))} kept` : ""}` : "nothing yet"}</span></div>
    <div class="sf-blocked">${blocked.length ? blocked.slice(0, 4).map((e) => `<div class="sb-r"><i class="sb-d"></i><span><b>Withdrawal stopped</b><small>${e.at ? new Date(e.at).toLocaleDateString(S.lang === "fr" ? "fr-CA" : "en-US", { month: "short", day: "numeric" }) : ""}${e.n ? ` · ${amt(e.n, e.a === "usdc" ? "usdc" : "native")} ${e.a === "usdc" ? "USDC" : NETS[e.k]?.unit || ""}` : ""}</small></span><em>Kept</em></div>`).join("")
      : `<div class="sb-empty"><b>Nothing has tried to leave.</b><span>If anything ever does, even with your own key, it waits ${dl ? delay(dl) : "the delay"} and you can stop it right here.</span></div>`}</div>
    ${open.length ? `<div class="list-h"><b>Your Safe on each network</b><span>${open.length}</span></div>${open.map(section).join("")}` : ""}
    <button class="earn-card" data-act="panel" data-p="earn"><span class="ec-ic">${I.spark}</span><span class="ec-t"><b>Earn on your Safe</b><small>Stake SOL without taking it out · about ${STAKE_APY_TEXT} a year</small></span><span class="soon">Coming soon</span></button>
    ${closed.length ? `<div class="list-h"><b>Add a network</b><span>same Safe</span></div>
      <section class="list">${closed.map((N) => `<button class="arow" data-act="safe-go" data-n="${N.key}" data-p="protect">${coin(N.key)}<span class="ar-t"><b>${N.name}</b><small>${N.net} · not opened</small></span><span class="ar-r"><b class="sn-open">Open</b></span></button>`).join("")}</section>` : ""}
  </div>`;
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
      ${row("panel", I.shield, "Safety: limits, auto-protect, freeze", I.arrow, 'data-p="safety"')}
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
    ${sec("Wallet", `
      ${row("panel", I.recv, "Contacts", `${Object.values(S.book || {}).reduce((t, m) => t + Object.keys(m || {}).length, 0) || ""} ${I.arrow}`, 'data-p="contacts"')}
      ${row("report", I.spark, "Monthly report")}`)}
    ${sec("Home screen", `
      ${row("tog", I.recv, "Notify when I receive coins", onOff(S.recvNotify !== false && !(globalThis.ECRIN_WEB && window.Notification && Notification.permission === "denied")), 'data-k="recvNotify"')}
      ${row("tog", I.spark, "Sounds", onOff(S.sounds), 'data-k="sounds"')}
      ${row("tog", I.img, "Show collectibles (NFTs)", onOff(S.showNfts), 'data-k="showNfts"')}
      ${row("tog", I.eyeOff, "Hide small balances", onOff(S.hideSmall), 'data-k="hideSmall"')}
      ${row("tog", I.arrow, "Order coins by", S.order === "name" ? "Name" : "Value", 'data-k="order"')}`)}
    ${sec("About", `
      ${row("panel", I.spark, "What's new", `${VERSION} ${I.arrow}`, 'data-p="news"')}
      <a class="srow" href="https://ecrinprotocol.app/" target="_blank"><span>${I.globe}Website</span><span class="sv">${I.ext}</span></a>
      <a class="srow" href="https://ecrinprotocol.app/how-it-works/" target="_blank"><span>${I.shield}How the Safe works</span><span class="sv">${I.ext}</span></a>
      <a class="srow" href="https://ecrinprotocol.app/security/" target="_blank"><span>${I.check}Security and audits</span><span class="sv">${I.ext}</span></a>
      <a class="srow" href="https://github.com/lecrabe5000-droid/Solana-Vault/issues" target="_blank"><span>${I.link}Report a bug or give feedback</span><span class="sv">${I.ext}</span></a>
      <a class="srow" href="https://ecrinprotocol.app/privacy/" target="_blank"><span>${I.lock}Privacy</span><span class="sv">${I.ext}</span></a>
      <a class="srow" href="https://ecrinprotocol.app/terms/" target="_blank"><span>${I.card}Terms</span><span class="sv">${I.ext}</span></a>`)}
    <div class="sets danger-z"><button class="srow danger" data-act="forget"><span>Remove wallet from this browser</span><span></span></button></div>
    <div class="set-sig">${WORDMARK("md")}<b>Wallet</b><small>Version ${VERSION} · testnet beta · not audited</small></div>`;
}
// What's new: shown once after an update (never on a fresh install), and any time from Settings → About.
const NEWS = [
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
  if (seenVer) setTimeout(() => { if (S.screen === "home" && !S.panel) openPanel("news"); }, 1700); // after the entrance
}
function currencyView() {
  return `${phead("Currency")}<p class="fine">Prices and totals show in this currency at today's rate. Your coins don't change.</p>
    <section class="list">${CURS.map(([c, n]) => `<button class="arow cur-r${(S.cur || "USD") === c ? " on" : ""}" data-act="cur" data-v="${c}"><span class="cur-c">${c}</span><span class="ar-t"><b>${n}</b><small>${(1234.5).toLocaleString(S.lang === "fr" ? "fr-CA" : "en-US", { style: "currency", currency: c })}</small></span>${(S.cur || "USD") === c ? `<span class="acc-ok">${I.check}</span>` : ""}</button>`).join("")}</section>`;
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

function toast(text, kind = "") { const t = $("#toast"); t.innerHTML = `<i class="t-ic" aria-hidden="true"></i><span>${esc(trText(text, S.lang))}</span>`; t.className = "toast show " + kind; clearTimeout(t._t); t._t = setTimeout(() => (t.className = "toast " + kind), 2600); }
const errText = (e) => {
  const raw = String(e?.shortMessage || e?.message || e);
  if (/429|too many requests|failed to fetch|fetch failed|networkerror|network error|timed? ?out|ECONN|\b50[234]\b|block height exceeded|blockhash not found|server error/i.test(raw)) return "The test network is busy right now. Check Activity in a minute, and try again if it didn't go through.";
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
  try { S.lastTx = Date.now(); const sig = await fn(); S.lastTx = Date.now(); P.sig = typeof sig === "string" ? sig : null; await after?.(); if (log) await logActivity({ ...log, sig: P.sig }); P.step = "done"; haptic("success");
    // Show it done now and move the numbers on screen at once; the network's own numbers replace them a moment later.
    if (log && S.bal && (log.t === "send" || log.t === "protect") && log.n) { const k = log.a === "usdc" ? "usdc" : "native"; S.bal = { ...S.bal, [k]: Math.max(0, Number(S.bal[k] || 0) - Number(log.n)) }; }
    renderPanel(); refresh().then(() => { loadActivity(); loadAll(); }); return; }
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
  "tb-home": () => { if (S.panel) return closePanel(); $("#root").scrollTo({ top: 0, behavior: "smooth" }); },
  "tb-go": (el) => { if (S.panel?.p === el.dataset.p) return; if (S.panel) { S.panel = null; $("#panel").innerHTML = ""; } openPanel(el.dataset.p); },
  speed: (el) => { S.panel.speed = el.dataset.v; renderPanel(); },
  palert: async (el) => { S.palerts = { ...(S.palerts || {}), [el.dataset.cg]: Number(el.dataset.v) }; await local.set({ palerts: S.palerts }); renderPanel(); checkPriceAlerts(); },
  "palert-notify": async () => { try { await Notification.requestPermission(); } catch (_) {} renderPanel(); },
  "home-req": () => openPanel("payreq", { a: "native" }),
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
    if (!n) return toast("Give the contact a name.", "err"); if (!f) return toast("That isn't a Solana, Ethereum or Tron address.", "err");
    S.book[f] = { ...(S.book[f] || {}), [a]: n }; await local.set({ book: S.book }); S.panel.n = S.panel.a = ""; toast(`${n} added`, "win"); renderPanel();
  },
  "ct-del": async (el) => { const f = el.dataset.f, a = el.dataset.a, n = S.book?.[f]?.[a]; if (!(await ask(`Delete ${n} from your contacts?`, { ok: "Delete", danger: true }))) return; delete S.book[f][a]; await local.set({ book: S.book }); renderPanel(); },
  report: async () => { S.stats = (await local.get("stats")).stats || {}; await loadActivity(); openPanel("report", { month: monthKey() }); },
  "rp-m": (el) => { if (!el.dataset.v) return; S.panel.month = el.dataset.v; renderPanel(); },
  "reveal-bio": async () => { try { const words = await bioUnlock(S.bio); S.panel.words = normalize(words); renderPanel(); } catch (e) { toast(`${bioName()} didn't work. Use your password.`, "err"); } },
  cur: async (el) => { S.cur = el.dataset.v; await local.set({ cur: S.cur }); await loadFx(); toast(S.cur === "USD" || S.fx?.[S.cur] ? `Showing ${S.cur}` : `Couldn't get today's ${S.cur} rate. Showing USD until it loads.`, S.cur === "USD" || S.fx?.[S.cur] ? "win" : ""); renderPanel(); render(); },
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
  "rc-apply": async (el) => { try { el.disabled = true; await useNet(el.dataset.n); await (await eng()).applyChange(Number(el.dataset.id)); toast("Rule applied", "win"); } catch (e) { toast(errText(e), "err"); } await loadAll(); },
  "rc-cancel": async (el) => { try { el.disabled = true; await useNet(el.dataset.n); await (await eng()).cancelChange(Number(el.dataset.id)); toast("Change cancelled", "win"); } catch (e) { toast(errText(e), "err"); } await loadAll(); },
  "al-tg": async () => { try { const r = await alertCall("/api/alerts/start", {}); if (!r.url) throw new Error(r.error || "Alerts aren't available right now."); window.open(r.url, "_blank"); S.alertsOn = true; local.set({ alertsOn: true }); toast("Telegram opened: tap Start in the chat.", "win"); } catch (e) { toast(e.message, "err"); } },
  "al-mail": async () => { const email = ($("#panel [data-mail]")?.value || "").trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("Enter your email address", "err"); try { const r = await alertCall("/api/alerts/email", { email }); if (r.error) throw new Error(r.error); S.alertsOn = true; local.set({ alertsOn: true }); toast(r.already ? "Email alerts are already on." : "Check your inbox to confirm.", "win"); } catch (e) { toast(e.message, "err"); } },
  tok: (el) => { S.tkDrawKey = null; const u = el.dataset.u, cg = u === "USDC" ? null : { SOL: "solana", ETH: "ethereum", POL: "polygon-ecosystem-token", BNB: "binancecoin", AVAX: "avalanche-2", TRX: "tron" }[u]; openPanel("tok", { u, cg, n: el.dataset.n }); if (cg) loadSeriesFor(cg).then(() => S.panel?.p === "tok" && renderPanel()); },
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
    else S[k] = !S[k];
    if (k === "showNfts" && !S.showNfts && S.tab === "nfts") S.tab = "tokens";
    await local.set({ [k]: S[k] }); renderPanel(); render();
  },
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
  "swap-flip": async () => { const P = S.panel, px = S.prices.solana?.usd, v = Number(String(P.amount || "").replace(/,/g, ""));
    // what you would have received becomes what you pay, like every swap screen
    P.amount = px && v > 0 ? String(+(P.asset === "usdc" ? v / px : v * px).toFixed(P.asset === "usdc" ? 4 : 2)) : "";
    P.asset = P.asset === "usdc" ? "native" : "usdc"; P.pct = null; P.flipped = true; P.reserve = await (await eng()).reserve(P.asset); renderPanel(); },
  "swap-sol": async () => { await useNet("sol"); S.panel = null; openPanel("swap"); const e = await eng(); S.panel.reserve = await e.reserve("native"); renderPanel(); },
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
  "finish-create": async () => { S.busy = true; render(); await saveWallet(S.phrase, S.pw); await local.set({ backup: { at: Date.now(), done: false } }); S.busy = false; S.phrase = S.pw = null; home(); },
  forgot: async () => { if (await ask("Without the password, the only way back in is your recovery phrase. Remove this wallet from this device and import it again?", { title: "Forgot your password?", ok: "Remove and re-import", danger: true })) forget(); },
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
  key: (el) => {
    const P = S.panel, k = el.dataset.k, x = A(P.asset); let v = P.amount || "";
    if (k === "del") v = v.slice(0, -1);
    else if (k === ".") { if (!v.includes(".")) v = (v || "0") + "."; }
    else { const d = v.split(".")[1]; if (d != null && d.length >= Math.min(x.dec, 6)) return; v = v === "0" ? k : v + k; if (v.replace(".", "").length > 12) return; }
    P.amount = v; P.pct = null; haptic("light"); patchPanel();
  },
  pct: (el) => {
    const P = S.panel, p = Number(el.dataset.v), a = P.asset;
    const max = P.p === "send" || P.p === "swap" ? sendMax() : P.p === "protect" ? sendMaxProtect() : (a === "usdc" ? S.vault?.usdc?.available : S.vault?.main?.available) || 0;
    const units = Math.floor((max * p) / 100), x = A(a);
    P.pct = p; P.amount = units ? String(Math.floor((units / x.base) * 10 ** x.dec) / 10 ** x.dec) : "";
    patchPanel();
  },
  paste: async () => { try { S.panel.to = (await navigator.clipboard.readText()).trim(); renderPanel(); } catch (_) { toast("Couldn't read the clipboard", "err"); } },
  review: async () => {
    if (S.panel.named?.addr && S.panel.named.name === S.panel.to.trim()) { S.panel.toName = S.panel.named.name; S.panel.to = S.panel.named.addr; }
    const P = S.panel, usd = usdOf(parseAmt(P.amount, P.asset), P.asset);
    const lim = await limitCheck(usd); if (lim) return toast(lim, "err");
    P.fresh = !(await knownDest(P.to.trim())); P.step = "review"; P.anim = true;
    const G = S.guard; P.coolUntil = G.cool && usd != null && usd >= G.coolOver ? Date.now() + G.cool * 1000 : 0; if (P.coolUntil) bump("cool");
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
  faucet: async (el) => {
    const N = NETS[S.net]; if (N.key !== "sol" || !ENG?.address) return window.open(N.faucet, "_blank");
    if (S.fauBusy) return; S.fauBusy = true;
    const btn = el?.closest("button"), was = btn?.innerHTML; if (btn) { btn.classList.add("busy"); btn.innerHTML = `<i class="spin"></i>${esc(trText("Sending test coins…", S.lang))}`; }
    try {
      const r = await fetch(FAUCET_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: String(ENG.address) }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { haptic("success"); toast(`${j.sol} test SOL is on its way`, "win"); setTimeout(refresh, 2500); setTimeout(() => { refresh(); loadAll(); }, 8000); }
      else if (r.status === 503 && /switched on/i.test(j.error || "")) window.open(N.faucet, "_blank");
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
    const units = parseAmt(P.amount, P.asset); P.sent = units; txRun(async () => (await eng()).request(P.asset, ENG.address, units), null, { t: "withdraw", a: P.asset, n: units }); },
  "safe-go": async (el) => { el.disabled = true; await useNet(el.dataset.n); S.panel = null; openPanel(el.dataset.p); if (el.dataset.p === "protect") { const e = await eng(); S.panel.reserve = await e.reserve(S.panel.asset); renderPanel(); } },
  "cancel-w": async (el) => {
    const was = el.innerHTML;
    try {
      const keptAmt = (el.closest(".sf-alert, .sf-w")?.textContent.match(/([\d.,]+)\s+([A-Z]{2,6})/) || []).slice(1, 3).join(" ");
      el.disabled = true; el.classList.add("busy"); el.innerHTML = `<i class="btn-spin"></i>${trText("Keeping it safe…", S.lang)}`;
      await useNet(el.dataset.n); await (await eng()).cancel(el.dataset.a, Number(el.dataset.id)); await logActivity({ t: "cancel", a: el.dataset.a });
      const played = await keepFx(el);
      if (!played) { haptic("success"); toast("Cancelled. It stays in your Safe.", "win"); }
      loadActivity();
      if (played && keptAmt) setTimeout(() => offerShare(keptAmt), 400);
      await refresh(); loadAll();
    } catch (e) { el.disabled = false; el.classList.remove("busy"); el.innerHTML = was; toast(errText(e), "err"); }
  },
  execute: async (el) => { try { el.disabled = true; await useNet(el.dataset.n); await (await eng()).execute(el.dataset.a, Number(el.dataset.id), el.dataset.d); await logActivity({ t: "release", a: el.dataset.a }); loadActivity(); toast("Released to Wallet", "win"); await refresh(); loadAll(); } catch (e) { el.disabled = false; toast(errText(e), "err"); } },
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
  await txRun(async () => (await eng()).send(P.asset, to, units, { speed: P.speed }), async () => { await rememberDest(to); await countSpend(usdOf(units, P.asset)); }, { t: "send", a: P.asset, n: units, to });
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
  if (t.matches("[data-taddr]")) { S.panel.addr = t.value; S.panel.picked = null; clearTimeout(S.tokT); const v = t.value.trim(); S.tokT = setTimeout(previewTok, ethers.isAddress(v) ? 60 : /^0x/i.test(v) ? 450 : 280); return; }
  if (t.matches("[data-actq]")) { S.actQ = t.value; const el = $("#actl"); if (el) { el.innerHTML = actRows(); translate(el, S.lang); } return; }
  if (t.matches("[data-amount]")) {
    const v = t.value.replace(/[^\d.,]/g, "").replace(",", "."), parts = v.split(".");
    S.panel.amount = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : v; S.panel.pct = null;
    const pos = t.selectionStart; if (t.value !== S.panel.amount) { t.value = S.panel.amount; try { t.setSelectionRange(Math.min(pos, t.value.length), Math.min(pos, t.value.length)); } catch (_) {} } patchPanel();
  } else if (t.matches("[data-reqamt]") || t.matches("[data-reqlabel]")) { const k = t.matches("[data-reqamt]") ? "amount" : "label", sel = k === "amount" ? "[data-reqamt]" : "[data-reqlabel]"; S.panel[k] = k === "amount" ? t.value.replace(/[^\d.,]/g, "").replace(",", ".") : t.value; const pos = t.selectionStart; renderPanel(); const n = $("#panel " + sel); n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {}
  } else if (t.matches("[data-to]") && (/^wc:/i.test(t.value.trim()) || parsePayLink(t.value))) { const v = t.value.trim(); t.value = ""; onScanned(v);
  } else if (t.matches("[data-to]")) { lookupTo(t.value); S.panel.to = t.value; patchPanel(); }
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
    S.busy = true; render();
    try { const { box } = await local.get("box"); const phrase = await open(box, d.pw); await session.set({ phrase }); await useAccount(phrase); await touch(); S.busy = false; AP.id ? startApproval() : home(); }
    catch (_) { S.busy = false; render(); const x = $("[data-err]"); if (x) x.textContent = "Wrong password"; $("#root form")?.classList.add("shake"); }
    return;
  }
  if (kind === "pkey") {
    try {
      const { box } = await local.get("box"); await open(box, d.pw);
      const A0 = curAcct(), keys = [];
      if (ACCT.sol) keys.push(["Solana", b58(ACCT.sol.secretKey)]);
      if (ACCT.evm) keys.push(["Ethereum-style networks", ACCT.evm.privateKey]);
      if (ACCT.tron && !ACCT.only) keys.push(["Tron", ACCT.tron.privateKey.slice(2)]);
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
  document.querySelectorAll("[data-until]").forEach((n) => { const s = Math.floor(Number(n.dataset.until) - t); n.textContent = s <= 0 ? "Ready" : `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; });
  // the ring drains a little each second; a one-second linear transition joins the steps into one smooth motion
  document.querySelectorAll("[data-ru]").forEach((c) => { const f = Math.max(0, Math.min(1, (Number(c.dataset.ru) - t - 1) / Number(c.dataset.rd))); c.style.strokeDasharray = `${(f * 100).toFixed(3)} 100`; });
}, 1000);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.panel) closePanel(); });

boot();

/* ------------------------------------------------------------------ what a scanned or pasted code is */
// A WalletConnect code connects a site; a payment link fills Send; anything else is taken as an address.
function onScanned(text) {
  if (/^wc:/i.test(text)) return wcPair(text);
  const pay = parsePayLink(text);
  if (pay) return openPay(pay);
  if (S.panel?.p === "send") { S.panel.to = text.replace(/^(solana|ethereum|tron):/i, "").split(/[?@]/)[0].trim(); renderPanel(); }
}

/* ------------------------------------------------------------------ never stuck without fees */
// Sending a token (USDC, USDT) still costs a little of the network's own coin. If there isn't enough, say so before
// the send fails, and show where to get it.
function feeNeed(N, P) { return N.fam === "sol" ? 10_000 : N.fam === "tron" ? 15e9 : Math.max(50_000, (P?.reserve || 0) * 3); }
function feeNote(a) {
  const N = NETS[S.net], P = S.panel;
  if (a === "native" || !S.bal || (S.bal.native || 0) >= feeNeed(N, P)) return "";
  return `<div class="fee-n">${I.warn}<span>Sending ${A(a).unit} on ${N.name} costs a little <b>${N.unit}</b> for the network fee, and this Wallet has ${S.bal.native ? "too little" : "none"}. ${faucetBtn(N, "")}</span></div>`;
}

/* ------------------------------------------------------------------ price alerts */
// A note when a coin you choose moves more than 5 or 10% in a day: once per coin, per direction, per day.
const ALERT_COINS = [["solana", "SOL"], ["ethereum", "ETH"], ["binancecoin", "BNB"], ["avalanche-2", "AVAX"], ["tron", "TRX"], ["polygon-ecosystem-token", "POL"]];
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
  const LOGO = { solana: "sol", ethereum: "eth", binancecoin: "bnb", "avalanche-2": "avax", tron: "tron", "polygon-ecosystem-token": "pol" };
  const canPush = !!window.Notification, pushOn = canPush && Notification.permission === "granted";
  return `${phead("Price alerts")}
    <div class="pa-hero"><span class="pa-ic">${I.spark}</span><b>${on ? `${on} alert${on > 1 ? "s" : ""} on` : "No alerts yet"}</b><small>Get a note when a coin moves more than you choose in a day. Once per coin and direction, each day.</small></div>
    <section class="list pa-list">${ALERT_COINS.map(([cg, unit]) => { const p = S.prices[cg], ch = p?.usd_24h_change, v = al[cg] || 0;
      return `<div class="arow pa-row"><span class="cstack">${coin(LOGO[cg])}</span>
        <span class="ar-t"><b>${cdot(unit)}${COIN_NAME[unit] || unit}</b><small>${p?.usd != null ? `${money(p.usd)}${ch != null ? ` <span class="${ch >= 0 ? "up" : "dn"}">${ch >= 0 ? "+" : "−"}${Math.abs(ch).toFixed(2)}%</span>` : ""}` : unit}</small></span>
        <span class="pa-seg" role="group" aria-label="${unit} alert">${[0, 5, 10].map((x) => `<button data-act="palert" data-cg="${cg}" data-v="${x}" aria-pressed="${v === x}"${v === x ? ' class="on"' : ""}>${x ? `±${x}%` : "Off"}</button>`).join("")}</span></div>`; }).join("")}</section>
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
    if (m) { const q = new URLSearchParams(m[2] || ""), mint = q.get("spl-token"); return { fam: "sol", k: "sol", to: m[1], amount: q.get("amount") || "", a: mint ? (mint === NETS.sol.usdc || mint === S.devMint ? "usdc" : "token") : "native", label: q.get("label") || q.get("message") || "" }; }
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
      <p class="fine rq-fine">Opens in any ${N.fam === "sol" ? "Solana Pay" : N.fam === "evm" ? "Ethereum" : "Tron"} wallet that scans it.</p>
      <div class="rq-acts">${navigator.share ? `<button class="btn primary" data-act="share-req">${I.send}Share</button>` : ""}<button class="btn" data-act="copy-req">${I.copy}Copy link</button></div>
    </div>`;
}

/* ------------------------------------------------------------------ WalletConnect (phone app) */
let WC = null;
const wcClient = () => (WC ||= import("./wc.js").then((m) => m.startWC({
  solAddr: ACCT?.sol?.publicKey?.toBase58?.(), evmAddr: ACCT?.evm?.address,
  onProposal: wcProposal, onRequest: wcRequest, onChange: () => { if (S.panel?.p === "wc") renderPanel(); },
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
  S.req = { wc: "proposal", p, kind: "connect", fam: p.ns?.solana ? "sol" : "evm", site, origin: p.meta?.url, err: p.ns ? null : "This app asks for networks Ecrin doesn't support during the beta (Solana Devnet and the EVM test networks only)." };
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
      ${faucetBtn(N, "btn xl", `Get free test ${N.unit} for now`)}</div>`;
}
const SWAP = { live: false, feeBps: 50, api: "https://ecrinprotocol.app/api/swap" };
const STAKE_APY = 0.065, STAKE_APY_TEXT = "6–7%";

function swapView() {
  const P = S.panel, N = NETS[S.net];
  if (N.fam !== "sol") return `${phead("Swap")}<div class="cv"><div class="cv-art">${I.swap}</div><h2>Swaps start on Solana</h2><p class="sub">Swap any Solana coin at the best price across every exchange, through Jupiter. Ethereum-style networks come later.</p></div><div class="pfoot"><button class="btn primary xl" data-act="swap-sol">Go to Solana</button></div>`;
  const a = P.asset, b = a === "usdc" ? "native" : "usdc", units = parseAmt(P.amount, a), px = S.prices.solana?.usd;
  const fee = SWAP.feeBps / 10_000, inAmt = units / A(a).base;
  const out = px && inAmt ? (a === "native" ? inAmt * px : inAmt / px) * (1 - fee) : 0;
  const rate = px ? `1 SOL ≈ ${money(px)}` : "—";
  const max = sendMax(), over = units > max, usdIn = usdOf(units, a), usdOut = out && px ? (b === "usdc" ? out : out * px) : null;
  const bal = (x) => amt(Math.max(0, x === a ? max : (S.bal?.[x] || 0)), x);
  const chip = (x) => `<span class="sx-coin">${assetCoin(x)}<b>${A(x).unit}</b><small>${x === "usdc" ? "USD Coin" : N.name}</small></span>`;
  return `${phead("Swap")}
  <div class="sx">
    <div class="sf-aura" aria-hidden="true" style="${auraT()}"><i></i><i></i><i></i></div>
    <div class="sx-soon"><i></i>Preview · swaps open with mainnet</div>
    <div class="sx-pair">
      <div class="sx-card${over ? " over" : ""}">
        <div class="sx-top"><span class="sx-k">You pay</span><span class="sx-bal">Balance ${bal(a)} ${A(a).unit}</span></div>
        <div class="sx-row">${chip(a)}<input class="sx-in" data-amount inputmode="decimal" placeholder="0" value="${esc(P.amount)}" autocomplete="off" autofocus/></div>
        <div class="sx-foot"><span class="sx-pcts">${[25, 50, 100].map((v) => `<button data-act="pct" data-v="${v}" class="${P.pct === v ? "on" : ""}">${v === 100 ? "Max" : v + "%"}</button>`).join("")}</span><span class="sx-usd">${over ? `<span class="bad">Not enough</span>` : usdIn != null && units ? money(usdIn) : ""}</span></div>
      </div>
      <button class="sx-flip${P.flipped ? " spun" : ""}" data-act="swap-flip" aria-label="Swap direction"><svg viewBox="0 0 24 24"><path d="M8 4v15M8 19l-4-4M8 19l4-4M16 20V5M16 5l-4 4M16 5l4 4"/></svg></button>
      <div class="sx-card to">
        <div class="sx-top"><span class="sx-k">You receive</span><span class="sx-bal">Balance ${bal(b)} ${A(b).unit}</span></div>
        <div class="sx-row">${chip(b)}<b class="sx-out${out ? "" : " zero"}">${out ? out.toLocaleString("en-US", { maximumFractionDigits: b === "usdc" ? 2 : 4 }) : "0"}</b></div>
        <div class="sx-foot"><span class="sx-est">Estimate</span><span class="sx-usd">${usdOut != null ? money(usdOut) : ""}</span></div>
      </div>
    </div>
    <div class="sx-rate"><span class="sx-live"><i></i>${rate}</span><span class="sx-route">Best price via Jupiter</span></div>
    <div class="sx-kv"><div><span>Ecrin fee</span><b>${(SWAP.feeBps / 100).toFixed(1)}%</b></div><div><span>Network fee</span><b>${N.unit === "SOL" ? "< 0.001 SOL" : "—"}</b></div><div><span>Price protection</span><b>0.5% max slippage</b></div></div>
    <div class="sx-note">${I.lock}<span>Swaps use your Wallet only. Money in your Safe never moves without its delay.</span></div>
    ${(P.flipped = false, "")}<button class="sx-go" ${SWAP.live && units && !over ? "" : "disabled"}>${SWAP.live ? (units ? (over ? "Not enough " + A(a).unit : "Swap") : "Enter an amount") : "Coming soon"}</button>
  </div>`;
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
  for (const x of got) if (NETS[x.i.k]?.fam === "evm") logActivity({ t: "recv", a: x.i.a, n: Math.round(x.d * (x.i.a === "usdc" ? USDC_BASE : BASE)), k: x.i.k }).then(loadActivity);
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

/* ------------------------------------------------------------------ coin first: pick a coin, Ecrin picks the network */
function fromRow() {
  const P = S.panel, N = NETS[S.net], a = P.asset || "native";
  return `<button class="from" data-act="pick-coin">${coinOn(a)}<span><b>${a === "usdc" ? "USDC" : N.unit}</b><small>on ${N.name}</small></span>${I.chev}</button>`;
}
function pickView() {
  const P = S.panel, w = worth(), need = P.back === "withdraw" ? "sav" : P.back === "receive" ? null : "chq";
  let list = need ? w.items.filter((i) => i[need] > 0) : [];
  // USDC on several networks shows as one row with the total; Ecrin uses the network that holds the most.
  if (need) { const us = list.filter((i) => i.a === "usdc"); if (us.length > 1) { const best = [...us].sort((x, y) => y[need] - x[need])[0], tot = (k) => us.reduce((t, i) => t + (i[k] || 0), 0); list = [{ ...best, chq: tot("chq"), sav: tot("sav"), usd: tot("chq") + tot("sav"), net: `${us.length} networks · uses ${best.net}`, merged: best[need] }, ...list.filter((i) => i.a !== "usdc")]; } }
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
    chart = `<div class="tk-chart${fresh ? " draw" : ""}" data-tkchart><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="tkf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".16"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient><linearGradient id="tkmg" x1="0" x2="1" y1="0" y2="0"><stop offset=".8" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="tkm" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#tkmg)"/></mask></defs><path d="${d}L${XR},${H}L0,${H}Z" fill="url(#tkf)" mask="url(#tkm)"/><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.7" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><line class="tk-x" x1="0" x2="0" y1="0" y2="${H}"/></svg><i class="tk-dot" style="left:${((xy[xy.length - 1][0] / W) * 100).toFixed(2)}%;top:${((xy[xy.length - 1][1] / H) * 100).toFixed(2)}%"></i><i class="tk-pin"></i><span class="ch-tip tk-tip"></span></div>`;
  }
  const rl = { 1: "today", 7: "this week", 30: "this month", 365: "this year" }[S.range];
  const ranges = `<div class="ranges">${[["1", "1D"], ["7", "1W"], ["30", "1M"], ["365", "1Y"]].map(([x, l]) => `<button data-act="range" data-d="${x}" aria-pressed="${S.range === x}">${l}</button>`).join("")}</div>`;
  const icon = coin({ USDC: "usdc", USDT: "usdt", ETH: "eth", SOL: "sol", POL: "pol", BNB: "bnb", AVAX: "avax", TRX: "tron" }[P.u] || "eth");
  const cc = COIN_COL[P.u] || "#5b7cff";
  const nets = [...new Set(list.map((i) => NETS[i.k].name))];
  const acts = (S.activity || []).filter((e) => e.n && A(e.a).unit === P.u).slice(0, 5);
  const when = (ms) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric" });
  const savPct = tot.amt ? Math.round((tot.sav / tot.amt) * 100) : 0;
  return `<div class="tk-page" style="--cc:${cc}">${phead("")}
    <div class="tk-top">${icon}<span><b>${esc(name)}</b><small>${esc(P.u)}${nets.length ? ` · ${esc(nets.join(", "))}` : ""}</small></span></div>
    <div class="tk-px" data-tkpx>${px != null ? fig(money(px)) : "—"}</div>
    <div class="tk-ch ${dd >= 0 ? "up" : "dn"}" data-tkch>${P.u === "USDC" ? "Stays close to $1" : v ? `${dd >= 0 ? "+" : "−"}${money(Math.abs(dd))} (${Math.abs(pc).toFixed(2)}%) <span>${rl}</span>` : "&nbsp;"}</div>
    ${chart}${ranges}
    <nav class="acts tk-acts">${[["send", "Send", I.send], ["receive", "Receive", I.recv], ["swap", "Swap", I.swap], ["protect", "Protect", I.protect]].map(([p2, l, ic]) => `<button data-act="tok-do" data-p="${p2}"><span>${ic}</span>${l}</button>`).join("")}</nav>
    <div class="tk-bal"><span class="lbl">Your balance</span><b>${S.hide ? "••••" : fig(money(tot.usd))}</b><small>${mask(n(tot.amt, dec))} ${esc(P.u)}${(() => { const c = pr.usd_24h_change; if (c == null || !tot.usd || P.u === "USDC") return ""; const pl = tot.usd - tot.usd / (1 + c / 100); return ` · <span class="${pl >= 0 ? "up" : "dn"}">${pl >= 0 ? "+" : "−"}${mask(money(Math.abs(pl)))} today</span>`; })()}</small>
      ${tot.amt ? `<div class="tk-split"><i style="width:${100 - savPct}%"></i><i class="s" style="width:${savPct}%"></i></div><div class="tk-leg"><span><i></i>Wallet ${mask(n(tot.chq, dec))}</span><span><i class="s"></i>${I.lock}Safe ${mask(n(tot.sav, dec))}</span></div>` : ""}</div>
    ${list.length > 1 ? `<div class="list-h"><b>By network</b><span></span></div><section class="list">${list.map((i) => `<div class="arow">${coin(i.k)}<span class="ar-t"><b>${NETS[i.k].name}</b><small>${i.sav ? `${I.lock}${mask(n(i.sav, i.dec))} in Safe` : "Wallet"}</small></span><span class="ar-r"><b>${i.usd != null ? mask(money(i.usd)) : "—"}</b><small>${mask(n(i.chq + i.sav, i.dec))} ${i.unit}</small></span></div>`).join("")}</section>` : ""}
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
      ${row("guardian", I.shield, "Guardian", (() => { const g = [vs.some((r) => r.k === "sol") && ["Solana", guard("sol")], vs.some((r) => famOf(r.k) === "evm") && ["Ethereum", guard("evm")]].filter(Boolean); return g.length === 1 ? g[0][1] : g.map(([n, v]) => `${n}: ${v}`).join(" · "); })())}
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
