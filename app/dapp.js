// Ecrin app: your real vault on Solana devnet or Ethereum Sepolia, through the wallet you already use.
// Solana: reads with app/chain.js, signs in the wallet, sends through our own devnet RPC (so it works whichever
// network the wallet is set to). Ethereum: app/evm.js reads through a public Sepolia RPC and signs with MetaMask.
// Both return the same vault shape, so every view below is shared. Nothing here holds keys or funds.
import { createClient, explainError } from "./chain.js";
import { isStricter } from "./vault.js";
import { CONFIG } from "./config.js";
import { createEvmClient, explainEvmError } from "./evm.js";
import { EVM } from "./config-evm.js";

const web3 = window.solanaWeb3;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Amounts are in 1e9 base units per coin on both networks: lamports on Solana, gwei on Ethereum.
const LAMPORTS = 1e9, HOUR = 3600, DAY = 86400;
const sol = (l) => (l / LAMPORTS).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const short = (k) => { const s = String(k); return s.slice(0, 4) + "…" + s.slice(-4); };
const when = (t) => new Date(t * 1000).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dur = (s) => { if (s <= 0) return "ready"; const d = Math.floor(s / DAY), h = Math.floor((s % DAY) / HOUR), m = Math.floor((s % HOUR) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${Math.max(1, m)}m`; };
const delayWords = (s) => (s % DAY === 0 ? `${s / DAY} day${s === DAY ? "" : "s"}` : `${Math.round(s / HOUR)} h`);
const explorer = (kind, id) => C.explorer(kind, id);
const logo = `<svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="8" fill="none" stroke="#2F5BFF" stroke-width="2.2"/><path d="M16 9.5l5.5 6.5L16 22.5 10.5 16z" fill="#2F5BFF"/></svg>`;

const connection = new web3.Connection(CONFIG.rpc, "confirmed");
const client = CONFIG.programId ? createClient({ web3, connection, programId: CONFIG.programId }) : null;

let savedNet = "sol";
try { savedNet = new URLSearchParams(location.search).get("net") || localStorage.getItem("ecrin-net") || "sol"; } catch (_) {}
let savedHide = false;
try { savedHide = localStorage.getItem("ecrin-hide") === "1"; } catch (_) {}
let savedTab = "portfolio";
try { const t = new URLSearchParams(location.search).get("tab"); if (["portfolio", "vault", "activity", "guardian"].includes(t)) savedTab = t; } catch (_) {}
const S = { hide: savedHide, net: savedNet === "eth" ? "eth" : "sol", tab: savedTab, range: "7", shown: null, chart: null, price: null, tokens: [], wallet: null, provider: null, walletSol: null, vault: undefined, view: "owner", watchOwner: "", watched: undefined, busy: false, clockOffset: 0, err: null, pick: "strong" };
const now = () => Math.floor(Date.now() / 1000) + S.clockOffset;

let toastTimer;
function toast(text, kind = "") { const t = $("#toast"); t.innerHTML = text; t.className = "toast " + kind; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 5000); }

// ------------------------------------------------------------------ networks

/** Signs a Solana transaction in the wallet, sends it through our devnet RPC, waits for confirmation. */
async function solTx(...ixs) {
  const tx = new web3.Transaction().add(...(await Promise.all(ixs)));
  tx.feePayer = S.wallet;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  const signed = await S.provider.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await confirm(sig, lastValidBlockHeight);
  return sig;
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

const solX = client && {
  key: (s) => { try { return new web3.PublicKey(String(s).trim()); } catch (_) { return null; } },
  balance: (k) => connection.getBalance(k, "confirmed"),
  fetchVault: (k) => client.fetchVault(k),
  chainTime: () => client.chainTime(),
  explain: explainError,
  ops: {
    create: (preset) => solTx(client.build.initialize(S.wallet, preset)),
    deposit: (u) => solTx(client.build.deposit(S.wallet, u)),
    sendToTrusted: (dest, u) => solTx(client.build.sendToTrusted(S.wallet, dest, u)),
    requestWithdrawal: (dest, u) => solTx(client.build.requestWithdrawal(S.wallet, dest, u)),
    cancelWithdrawal: (id) => solTx(client.build.cancelWithdrawal(S.wallet, id)),
    executeWithdrawal: (owner, id, dest) => solTx(client.build.executeWithdrawal(S.wallet, owner, id, dest)),
    guardianRelease: (owner, id, dest) => solTx(client.build.guardianRelease(S.wallet, owner, id, dest)),
    proposeChange: (change) => solTx(client.build.proposeChange(S.wallet, change)),
    cancelChange: (id) => solTx(client.build.cancelChange(S.wallet, id)),
    applyChange: (owner, id) => solTx(client.build.applyChange(S.wallet, owner, id)),
    guardianApproveChange: (owner, id) => solTx(client.build.guardianApproveChange(S.wallet, owner, id)),
  },
};

/** Asks the wallet to switch to Sepolia, adding the network first if it doesn't know it. */
async function ensureSepolia(p) {
  const want = "0x" + EVM.chainId.toString(16);
  if ((await p.request({ method: "eth_chainId" })) === want) return;
  try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] }); }
  catch (e) {
    if (e?.code !== 4902) throw e;
    await p.request({ method: "wallet_addEthereumChain", params: [{ chainId: want, chainName: "Sepolia", nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 }, rpcUrls: [EVM.rpc], blockExplorerUrls: [EVM.explorer] }] });
  }
}

const evmClient = EVM.address && window.ethers
  ? createEvmClient({ ethers: window.ethers, EVM, getSigner: async () => { await ensureSepolia(S.provider); return new window.ethers.BrowserProvider(S.provider).getSigner(); } })
  : null;
const evmX = evmClient && { ...evmClient, explain: (e) => explainEvmError(e, evmClient.iface) };

const NETS = {
  sol: {
    name: "Solana", net: "Devnet", unit: "SOL", cg: "solana", x: solX, contract: CONFIG.programId, contractWord: "program",
    explorer: (kind, id) => `https://explorer.solana.com/${kind}/${id}?cluster=${CONFIG.cluster}`,
    faucet: "https://faucet.solana.com", faucetName: "faucet.solana.com", lowBal: 0.01,
    setup: "In Phantom: Settings → Developer Settings → turn on <b>Testnet Mode</b> and pick <b>Solana Devnet</b>.",
    getWallet: ["Get Phantom", "https://phantom.com/download"],
    createCost: "Creating the vault costs a small amount of devnet SOL for the account's rent.",
  },
  eth: {
    name: "Ethereum", net: "Sepolia", unit: "ETH", cg: "ethereum", x: evmX, contract: EVM.address, contractWord: "contract",
    explorer: (kind, id) => `${EVM.explorer}/${kind}/${id}`,
    faucet: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia", faucetName: "the Google Cloud Sepolia faucet", lowBal: 0.002,
    setup: "In MetaMask: Settings → Advanced → turn on <b>Show test networks</b>. Ecrin asks MetaMask to switch to <b>Sepolia</b> for you.",
    getWallet: ["Get MetaMask", "https://metamask.io/download/"],
    createCost: "Creating the vault costs a little Sepolia ETH in gas.",
  },
};
let C = NETS[S.net];

function switchNet(n) {
  if (!NETS[n] || n === S.net) return;
  try { S.provider?.disconnect?.(); } catch (_) {}
  Object.assign(S, { net: n, wallet: null, provider: null, walletSol: null, vault: undefined, price: null, tokens: [], tab: "portfolio", shown: null, chart: null, watchOwner: "", watched: undefined, err: null });
  C = NETS[n];
  try { localStorage.setItem("ecrin-net", n); } catch (_) {}
  render(); loadPrice(); reconnect();
}

// ------------------------------------------------------------------ wallet

const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));

// On phones the wallet isn't injected into Safari or Chrome: these links reopen this page inside the wallet app's browser.
function walletLinks() {
  const url = location.href.split("#")[0], ref = location.origin;
  return S.net === "eth"
    ? [["MetaMask", `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, "")}`]]
    : [["Phantom", `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}`], ["Solflare", `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}`]];
}

// Ethereum wallets announce themselves (EIP-6963), so MetaMask and Phantom each get their own button even when
// one of them has taken over window.ethereum.
const evmWallets = new Map();
window.addEventListener("eip6963:announceProvider", (e) => {
  const { info, provider } = e.detail || {};
  if (!info?.rdns || !provider || evmWallets.has(info.rdns)) return;
  evmWallets.set(info.rdns, [info.name, provider]);
  if (S.net === "eth" && !S.wallet) render();
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

function providers() {
  if (S.net === "eth") {
    const list = [...evmWallets.entries()].sort(([a], [b]) => (b === "io.metamask") - (a === "io.metamask")).map(([, w]) => w);
    if (list.length) return list;
    const e = window.ethereum;
    return e ? [[e.isPhantom ? "Phantom" : e.isMetaMask ? "MetaMask" : "Wallet", e]] : [];
  }
  const out = [];
  const ph = window.phantom?.solana; if (ph?.isPhantom) out.push(["Phantom", ph]);
  if (window.solflare?.isSolflare) out.push(["Solflare", window.solflare]);
  if (window.backpack?.isBackpack) out.push(["Backpack", window.backpack]);
  if (!out.length && window.solana) out.push(["Wallet", window.solana]);
  return out;
}
let connecting = false;
async function connect(provider) {
  if (connecting) return;
  connecting = true;
  try {
    if (S.net === "eth") {
      const acc = await provider.request({ method: "eth_requestAccounts" });
      await ensureSepolia(provider);
      S.provider = provider; S.wallet = evmX.key(acc[0]);
      if (!provider.__ecrin) {
        provider.__ecrin = true;
        provider.on?.("accountsChanged", (a) => { if (S.net !== "eth") return; if (a?.length) { S.wallet = evmX.key(a[0]); S.vault = undefined; refresh(); } else disconnect(); });
      }
    } else {
      const r = await provider.connect();
      S.provider = provider; S.wallet = new web3.PublicKey((r?.publicKey || provider.publicKey).toString());
      provider.on?.("accountChanged", (pk) => { if (S.net !== "sol") return; if (pk) { S.wallet = new web3.PublicKey(pk.toString()); S.vault = undefined; refresh(); } else disconnect(); });
    }
    try { localStorage.setItem("ecrin-wallet-" + S.net, "1"); } catch (_) {}
    await refresh();
  } catch (e) { toast(esc((C.x?.explain || explainError)(e).message), "err"); }
  finally { connecting = false; }
}
function disconnect() { try { S.provider?.disconnect?.(); } catch (_) {} S.wallet = null; S.provider = null; S.vault = undefined; try { localStorage.removeItem("ecrin-wallet-" + S.net); } catch (_) {} render(); }

/** The reward for cancelling: the case seals with a drawn check (and a short buzz on phones). */
function seal() {
  navigator.vibrate?.([14, 40, 22]);
  const el = document.createElement("div");
  el.className = "seal";
  el.innerHTML = `<div class="seal-in"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29"/><path d="M20 33l8 8 16-17"/></svg><b>Kept safe</b><span>It never left your vault.</span></div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

/** Runs one signed operation, then logs it, tells the person, and reloads the vault. */
async function send(label, op) {
  if (S.busy) return null;
  S.busy = true; render();
  try {
    const sig = await op();
    log(label, sig);
    toast(`${esc(label)} · <a href="${explorer("tx", sig)}" target="_blank" rel="noopener" style="color:inherit">view</a>`, label.startsWith("Cancelled") ? "win" : "");
    if (label.startsWith("Cancelled")) seal();
    return sig;
  } catch (e) {
    console.warn(e);
    toast(esc(C.x.explain(e).message), "err");
    return null;
  } finally { S.busy = false; await refresh(); }
}

function logKey() { return "ecrin-log-" + (S.net === "eth" ? "eth-" : "") + (S.wallet ? S.wallet.toBase58() : ""); }
function readLog() { try { return JSON.parse(localStorage.getItem(logKey()) || "[]"); } catch (_) { return []; } }
function log(text, sig) { try { localStorage.setItem(logKey(), JSON.stringify([{ at: now(), text, sig }, ...readLog()].slice(0, 30))); } catch (_) {} }

async function refresh() {
  if (!C.x || !S.wallet) return render();
  try {
    const [bal, vault, t] = await Promise.all([C.x.balance(S.wallet), C.x.fetchVault(S.wallet), C.x.chainTime().catch(() => null), S.net === "sol" ? loadTokens() : (S.tokens = [])]);
    S.walletSol = bal; S.vault = vault; S.err = null;
    if (t) S.clockOffset = t - Math.floor(Date.now() / 1000);
    if (S.tab === "guardian" && S.watchOwner) S.watched = await C.x.fetchVault(C.x.key(S.watchOwner)).catch(() => null);
  } catch (e) { S.err = `Couldn't reach ${C.name} ${C.net}. Retrying…`; console.warn(e); }
  render();
}

// ------------------------------------------------------------------ prices and tokens

const RANGES = [["1", "1D"], ["7", "1W"], ["30", "1M"], ["365", "1Y"]];

// Price from CoinGecko: test coins have no value, so we show what the same amount is worth on mainnet.
async function loadPrice() {
  const cg = C.cg;
  try {
    const p = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cg}&vs_currencies=usd&include_24hr_change=true`).then((r) => r.json());
    const usd = p?.[cg]?.usd;
    if (!usd || cg !== C.cg) return;
    S.price = { usd, change: p[cg].usd_24h_change || 0, series: {} };
    render();
    loadSeries(S.range);
  } catch (e) { console.warn("price", e); }
}

async function loadSeries(days) {
  const cg = C.cg;
  if (!S.price || S.price.series[days]) return;
  try {
    const c = await fetch(`https://api.coingecko.com/api/v3/coins/${cg}/market_chart?vs_currency=usd&days=${days}`).then((r) => r.json());
    if (cg !== C.cg || !S.price) return;
    S.price.series[days] = (c?.prices || []).filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v));
    render();
  } catch (e) { console.warn("chart", e); }
}

async function loadTokens() {
  try {
    const r = await connection.getParsedTokenAccountsByOwner(S.wallet, { programId: new web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
    S.tokens = r.value.map(({ account }) => account.data.parsed.info).filter((i) => Number(i.tokenAmount.uiAmount) > 0)
      .map((i) => ({ mint: i.mint, amount: i.tokenAmount.uiAmountString }));
  } catch (_) { S.tokens = []; }
}

const money = (n) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
const usd = (lamports) => (S.price ? money((lamports / LAMPORTS) * S.price.usd) : null);

// ------------------------------------------------------------------ icons

const I = {
  shield: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l7.5 3v6c0 4.6-3.2 8.6-7.5 10-4.3-1.4-7.5-5.4-7.5-10v-6z"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8"/></svg>`,
  home: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11.5L12 4l8.5 7.5"/><path d="M6 10v9.5h12V10"/></svg>`,
  list: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6.5h12M8 12h12M8 17.5h12"/><circle cx="4" cy="6.5" r=".6"/><circle cx="4" cy="12" r=".6"/><circle cx="4" cy="17.5" r=".6"/></svg>`,
  people: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.4 3.4-5.2 6.5-5.2s5.7 1.8 6.5 5.2"/><path d="M15.5 4.8a3.4 3.4 0 0 1 0 6.4M17.5 14.9c2 .6 3.4 2.3 4 5.1"/></svg>`,
  down: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v15M5.5 12.5L12 19l6.5-6.5"/></svg>`,
  up: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V5M5.5 11.5L12 5l6.5 6.5"/></svg>`,
  send: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>`,
  sliders: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>`,
  wallet: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M16 12.5h2"/></svg>`,
  power: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v8"/><path d="M7 6.5a7 7 0 1 0 10 0"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16M9.9 5.8A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6.3 7.6A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>`,
  ext: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>`,
};
const coin = (net) => net === "eth"
  ? `<span class="coin eth" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 4l7 11.6-7 4.2-7-4.2z" fill="#fff" opacity=".95"/><path d="M16 21.2l7-4.2-7 10-7-10z" fill="#fff" opacity=".7"/></svg></span>`
  : `<span class="coin sol" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M10 10.5h13.5l-2.5 2.6H7.5zM10 15.2h13.5L21 17.8H7.5zM10 20h13.5L21 22.6H7.5z" fill="#fff"/></svg></span>`;

// ------------------------------------------------------------------ chart

/** Portfolio value over time: today's holdings priced along the chosen range. */
function chartHTML(units) {
  const pts = S.price?.series?.[S.range];
  const tabs = `<div class="ranges" role="group" aria-label="Range">${RANGES.map(([d, l]) => `<button data-act="range" data-d="${d}" aria-pressed="${S.range === d}">${l}</button>`).join("")}</div>`;
  if (!pts?.length) return `<div class="chart-card"><div class="chart-top"><span class="label">Portfolio value</span>${tabs}</div><div class="chart-wait">${S.price ? "Loading the chart…" : "Prices unavailable right now."}</div></div>`;
  const vals = pts.map(([, v]) => v * (units / LAMPORTS)), W = 1000, H = 260, pad = 12;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const xy = vals.map((v, i) => [(i / (vals.length - 1)) * W, pad + (1 - (v - min) / span) * (H - pad * 2)]);
  const line = xy.map(([x, y], i) => (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1)).join(" ");
  const up = vals[vals.length - 1] >= vals[0], delta = vals[vals.length - 1] - vals[0], pct = vals[0] ? (delta / vals[0]) * 100 : 0;
  S.chart = { pts, vals, W, H, xy };
  return `<div class="chart-card ${up ? "up" : "down"}">
    <div class="chart-top"><span class="label">Portfolio value <b class="${up ? "pos" : "neg"}">${up ? "+" : "−"}${money(Math.abs(delta))} (${Math.abs(pct).toFixed(2)}%)</b></span>${tabs}</div>
    <div class="chart" data-chart>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="cg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--c)" stop-opacity=".12"/><stop offset="1" stop-color="var(--c)" stop-opacity="0"/></linearGradient></defs>
        <path d="${line} L${W} ${H} L0 ${H} Z" fill="url(#cg)"/>
        <path class="ln" d="${line}" fill="none" stroke="var(--c)" stroke-width="1.75" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
      </svg>
      <div class="cross" hidden><i class="vline"></i><i class="dot"></i><div class="tip"><b></b><span></span></div></div>
    </div></div>`;
}

document.addEventListener("pointermove", (e) => {
  const el = e.target.closest?.("[data-chart]");
  if (!el || !S.chart) return;
  const r = el.getBoundingClientRect(), f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const i = Math.round(f * (S.chart.vals.length - 1)), [x, y] = S.chart.xy[i];
  const cross = el.querySelector(".cross"); cross.hidden = false;
  const px = (x / S.chart.W) * r.width, py = (y / S.chart.H) * r.height;
  cross.querySelector(".vline").style.left = px + "px";
  Object.assign(cross.querySelector(".dot").style, { left: px + "px", top: py + "px" });
  const tip = cross.querySelector(".tip");
  tip.style.left = Math.min(r.width - 120, Math.max(0, px - 60)) + "px";
  tip.querySelector("b").textContent = money(S.chart.vals[i]);
  tip.querySelector("span").textContent = new Date(S.chart.pts[i][0]).toLocaleString(undefined, S.range === "1" ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", year: S.range === "365" ? "numeric" : undefined });
}, { passive: true });
document.addEventListener("pointerout", (e) => { const el = e.target.closest?.("[data-chart]"); if (el && !el.contains(e.relatedTarget)) el.querySelector(".cross").hidden = true; });

/** Donut: share of the balance that is protected in the vault. */
function ring(pct) {
  const r = 52, c = 2 * Math.PI * r, on = (pct / 100) * c;
  return `<div class="ring" role="img" aria-label="${pct}% protected"><svg viewBox="0 0 128 128">
    <circle cx="64" cy="64" r="${r}" class="track"/><circle cx="64" cy="64" r="${r}" class="arc" stroke-dasharray="${on} ${c}" transform="rotate(-90 64 64)"/></svg>
    <div class="ring-in"><b>${pct}%</b><span>protected</span></div></div>`;
}

// Animates the big balance from the last shown value to the new one.
function countUp() {
  const el = document.querySelector("[data-count]");
  if (!el) return;
  const to = Number(el.dataset.count), from = S.shown ?? to;
  S.shown = to;
  if (from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const t0 = performance.now(), fmt = el.dataset.fmt === "usd" ? money : (n) => sol(n * LAMPORTS);
  const step = (t) => { const k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// ------------------------------------------------------------------ shell

const TABS = [["portfolio", "Portfolio", I.home], ["vault", "Vault", I.shield], ["activity", "Activity", I.list], ["guardian", "Guardian", I.people]];

function privacyBtn() {
  return `<button class="theme" data-act="privacy" aria-pressed="${S.hide}" aria-label="${S.hide ? "Show" : "Hide"} balances" title="${S.hide ? "Show" : "Hide"} balances">${S.hide ? I.eyeOff : I.eye}</button>`;
}

function themeBtn() {
  const dark = document.documentElement.dataset.theme === "dark";
  return `<button class="theme" data-act="theme" aria-label="Switch to ${dark ? "light" : "dark"} mode" title="Switch to ${dark ? "light" : "dark"} mode">${dark ? I.sun : I.moon}</button>`;
}

function netSwitch() {
  return `<div class="netsw" role="group" aria-label="Network">${["sol", "eth"].map((n) => `<button data-act="net" data-n="${n}" aria-pressed="${S.net === n}">${coin(n)}<span>${NETS[n].name}</span></button>`).join("")}</div>`;
}

function shell(content, { nav = true } = {}) {
  const w = S.wallet, pending = S.vault?.withdrawals?.length || 0, on = nav && w;
  const items = (cls) => TABS.map(([k, label, icon]) => `<button class="${cls}" data-act="tab" data-t="${k}" aria-current="${S.tab === k ? "page" : "false"}">${icon}<span>${label}</span>${k === "vault" && pending ? `<i class="badge">${pending}</i>` : ""}</button>`).join("");
  return `<div class="shell${S.hide ? " private" : ""}">
    <header class="topbar">
      <a class="brand" href="/">${logo}<span>Ecrin</span></a>
      ${on ? `<nav class="pillnav" aria-label="Sections"><i class="pill-ind" aria-hidden="true"></i>${items("pill-i")}</nav>` : ""}
      <div class="tb-right">
        ${netSwitch()}
        ${w ? `<button class="acct-chip" data-act="disconnect" title="${esc(w.toBase58())} · click to disconnect"><i class="live"></i><span>${short(w)}</span></button>` : ""}
        ${privacyBtn()}${themeBtn()}
      </div>
    </header>
    <main class="main">
      ${S.err ? `<div class="notice">${esc(S.err)}</div>` : ""}
      ${content}
      <p class="foot">${C.contractWord[0].toUpperCase() + C.contractWord.slice(1)} ${C.contract ? `<a href="${explorer("address", C.contract)}" target="_blank" rel="noopener">${short(C.contract)}</a>` : "not deployed"} on ${C.name} ${C.net} · Not audited: test coins only</p>
    </main>
    ${on ? `<nav class="tabbar" aria-label="Sections">${items("tab-i")}</nav>` : ""}
  </div>`;
}

// Slides the pill highlight from the last section to the new one.
function placePill() {
  const nav = document.querySelector(".pillnav"), cur = nav?.querySelector('[aria-current="page"]'), ind = nav?.querySelector(".pill-ind");
  if (!cur || !ind) return;
  const to = { x: cur.offsetLeft, w: cur.offsetWidth }, from = S.pill || to;
  ind.style.transition = "none"; ind.style.transform = `translateX(${from.x}px)`; ind.style.width = from.w + "px";
  void ind.offsetWidth;
  ind.style.transition = ""; ind.style.transform = `translateX(${to.x}px)`; ind.style.width = to.w + "px";
  S.pill = to;
}

// ------------------------------------------------------------------ views

function render() { renderView(); placePill(); }

function renderView() {
  const app = $("#app");
  if (!C.x) {
    app.innerHTML = shell(`<section class="glass hello"><div class="mark">${I.shield}</div><h1>Ecrin isn't on ${C.name} ${C.net} yet</h1><p>The ${C.contractWord} is being deployed. Meanwhile the demo runs the same rules with pretend money.</p><a class="btn primary lg" href="/demo">Open the demo</a></section>`, { nav: false });
    return;
  }
  if (!S.wallet) {
    const list = providers();
    app.innerHTML = shell(`<section class="glass hello">
      <div class="mark">${I.shield}</div>
      <h1>Your crypto, out of reach of anyone in a hurry.</h1>
      <p>Connect the wallet you already use. Ecrin never holds your keys: your wallet signs, the ${C.name} ${C.contractWord} enforces the rules.</p>
      <div class="wallets">${list.length ? list.map(([n], i) => `<button class="btn primary lg" data-act="connect" data-i="${i}">Connect ${esc(n)}</button>`).join("")
        : isPhone() ? walletLinks().map(([n, href], i) => `<a class="btn ${i ? "" : "primary "}lg" href="${esc(href)}">Open in ${n}</a>`).join("")
        : `<a class="btn primary lg" href="${C.getWallet[1]}" target="_blank" rel="noopener">${C.getWallet[0]}</a>`}</div>
      ${!list.length && isPhone() ? `<p class="hint">Phone browsers can't reach wallet apps directly, so Ecrin opens inside your wallet's own browser. Don't have it yet? <a href="${C.getWallet[1]}" target="_blank" rel="noopener">${C.getWallet[0]}</a>.</p>` : ""}
      <ol class="steps"><li><b>1</b><span>${C.setup}</span></li><li><b>2</b><span>Get free test ${C.unit} at <a href="${C.faucet}" target="_blank" rel="noopener">${C.faucetName}</a>.</span></li><li><b>3</b><span>Create your vault and try a withdrawal. Watch the clock, then cancel it.</span></li></ol>
    </section>`, { nav: false });
    return;
  }
  if (S.tab === "guardian") { app.innerHTML = shell(guardianView()); return; }
  if (S.vault === undefined) { app.innerHTML = shell(`<section class="glass hello"><div class="spinner"></div><p>Reading your vault from ${C.name} ${C.net}…</p></section>`); return; }
  if (S.vault === null) { app.innerHTML = shell(createView(), { nav: false }); return; }
  const v = S.vault;
  app.innerHTML = shell(S.tab === "vault" ? vaultView(v) : S.tab === "activity" ? activityView() : portfolioView(v));
  countUp();
}

function createView() {
  const presets = [
    ["gentle", "Gentle", "Everyday savings", ["Withdrawals wait 24 h", "Looser rules wait 3 days", "Guardian optional"], I.clock],
    ["strong", "Strong", "Recommended", ["Withdrawals wait 72 h", "Looser rules wait 7 days", "Guardian for emergencies"], I.shield],
    ["locked", "Locked", "Must not move", ["Nothing leaves before your date", "Emergency exit with your guardian", "Guardian required"], I.lock],
  ];
  return `<section class="create">
    <div class="create-h"><h1>Create your vault</h1><p>One vault per wallet on ${C.name}. You can make it stricter any time; loosening it always waits.</p></div>
    ${S.walletSol < C.lowBal * LAMPORTS ? `<div class="notice">Your wallet has ${sol(S.walletSol)} ${C.unit} on ${C.net}. Get free test ${C.unit} at <a href="${C.faucet}" target="_blank" rel="noopener">${C.faucetName}</a> for <b>${short(S.wallet)}</b>, then come back.</div>` : ""}
    <div class="presets">${presets.map(([k, n, tag, pts, icon]) => `<button type="button" class="preset glass" data-act="pick" data-k="${k}" aria-pressed="${S.pick === k}"><span class="p-ico">${icon}</span><span class="p-tag">${tag}</span><b>${n}</b><ul>${pts.map((x) => `<li>${x}</li>`).join("")}</ul></button>`).join("")}</div>
    <div class="glass create-f">
      <label class="field">Guardian wallet address ${S.pick === "locked" ? "(required)" : "(optional)"}<input id="g-addr" placeholder="A friend's ${C.name} address" autocomplete="off" spellcheck="false"/></label>
      ${S.pick === "locked" ? `<label class="field">Locked until<input id="lock-date" type="date"/></label>` : ""}
      <button class="btn primary lg wide" data-act="create" ${S.busy ? "disabled" : ""}>${S.busy ? "Confirm in your wallet…" : "Create vault"}</button>
      <p class="hint">${C.createCost}</p>
    </div></section>`;
}

function levelName(v) {
  const locked = v.lockedUntil && now() < v.lockedUntil;
  if (locked) return "Locked";
  if (v.withdrawDelay >= 72 * HOUR) return "Strong";
  if (v.withdrawDelay >= 24 * HOUR) return "Gentle";
  return "Custom";
}

function actionsRow() {
  return `<div class="qa">
    <button data-act="deposit"><span>${I.down}</span>Deposit</button>
    <button data-act="withdraw"><span>${I.up}</span>Withdraw</button>
    <button data-act="send" title="Send to a trusted address"><span>${I.send}</span>Send</button>
    <button data-act="rules"><span>${I.sliders}</span>Rules</button>
  </div>`;
}

// Engraved wave pattern for the vault case, drawn once: offset circles like a watch dial's guilloché.
const GUILLOCHE = `<svg class="guilloche" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${Array.from({ length: 34 }, (_, i) => `<circle cx="${330 + Math.cos(i / 2.2) * 14}" cy="${40 + Math.sin(i / 2.2) * 14}" r="${18 + i * 9}"/>`).join("")}</svg>`;

/** The vault as an object: an obsidian case with the protected balance and its state. */
function caseCard(v, { link = true } = {}) {
  const t = now(), locked = v.lockedUntil && t < v.lockedUntil;
  const next = v.withdrawals.slice().sort((a, b) => a.readyAt - b.readyAt)[0];
  const opens = next ? Math.max(next.readyAt, locked ? v.lockedUntil : 0) : 0;
  const state = next
    ? `<span class="cs-dot warn"></span><span><b>${sol(next.amount)} ${C.unit}</b> leaving${opens > t ? ` in <span class="count" data-ready="${opens}">${dur(opens - t)}</span>` : " · ready"}</span>`
    : `<span class="cs-dot"></span><span>${locked ? "Locked until " + new Date(v.lockedUntil * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "Sealed · nothing waiting to leave"}</span>`;
  return `<${link ? `button data-act="tab" data-t="vault"` : "div"} class="case${next ? " leaving" : ""}" data-tilt>
    ${GUILLOCHE}<i class="sheen"></i>
    <div class="case-top"><span class="case-mark">${logo}<b>ECRIN</b></span><span class="case-lvl">${levelName(v)} · ${delayWords(v.withdrawDelay)}</span></div>
    <div class="case-mid"><span class="case-k">${I.shield}Protected</span><div class="case-bal"><span class="num m">${sol(v.balance)}</span><small>${C.unit}</small></div><span class="case-usd m">${usd(v.balance) ?? ""}</span></div>
    <div class="case-foot">${state}<span class="case-id">${coin(S.net)}•••• ${String(v.owner).slice(-4)}</span></div>
  </${link ? "button" : "div"}>`;
}

function walletCard() {
  const w = S.walletSol || 0;
  return `<div class="wcard">
    <div class="case-top"><span class="case-k">${I.wallet}Wallet</span><span class="case-lvl">Spendable · instant</span></div>
    <div class="case-bal"><span class="num m">${sol(w)}</span><small>${C.unit}</small></div>
    <span class="case-usd m">${usd(w) ?? ""}</span>
  </div>`;
}

function portfolioView(v) {
  const vaultL = v.balance, walletL = S.walletSol || 0, total = vaultL + walletL;
  const pct = total ? Math.round((vaultL / total) * 100) : 0, ch = S.price?.change;
  const totalUsd = S.price ? (total / LAMPORTS) * S.price.usd : null;
  const recent = readLog().slice(0, 4);
  return `
    <section class="home-top">
      <div>
        <span class="label">Total balance</span>
        <div class="big num m" data-count="${totalUsd ?? total / LAMPORTS}" data-fmt="${totalUsd != null ? "usd" : "coin"}">${totalUsd != null ? money(totalUsd) : sol(total)}</div>
        <div class="sub">${ch != null ? `<span class="pill ${ch >= 0 ? "pos" : "neg"}">${ch >= 0 ? "+" : "−"}${Math.abs(ch).toFixed(2)}% today</span>` : ""}<span class="m">${sol(total)} ${C.unit}</span><span class="dotsep"></span><span><b class="acc">${pct}%</b> protected</span></div>
      </div>
      ${actionsRow()}
    </section>
    <div class="home-grid">
      <div class="stack">${caseCard(v)}${walletCard()}</div>
      ${chartHTML(total)}
    </div>
    <section class="glass">
      <div class="sec-h"><h2>Recent</h2>${recent.length ? `<button class="btn sm" data-act="tab" data-t="activity">See all</button>` : ""}</div>
      ${recent.length ? feedHTML(recent) : `<div class="empty">Nothing yet. Deposits, withdrawals and rule changes show up here.</div>`}
    </section>`;
}

function vaultView(v) {
  const t = now(), locked = v.lockedUntil && t < v.lockedUntil, queued = v.balance - v.available;
  const changes = rowsChanges(v, false);
  return `
    <section class="vault-top">
      ${caseCard(v, { link: false })}
      <div class="vault-side">
        ${actionsRow()}
        <div class="vs-facts">
          <div><span class="label">Available</span><b class="num m">${sol(v.available)}</b><small>${C.unit}</small></div>
          <div><span class="label">Leaving</span><b class="num m">${sol(queued)}</b><small>${C.unit}</small></div>
        </div>
        <div class="chips">${v.guardian ? `<span class="chip">${I.people}Guardian ${short(v.guardian)}</span>` : `<span class="chip">${I.people}No guardian</span>`}<a class="chip" href="${explorer("address", v.address.toBase58())}" target="_blank" rel="noopener">${I.ext}View on-chain</a></div>
      </div>
    </section>
    <div class="cols">
      <div class="col">
        <section class="glass"><div class="sec-h"><h2>Waiting to leave</h2><span class="muted">cancel any time</span></div><div class="rows">${rowsWithdrawals(v, false)}</div></section>
        ${changes ? `<section class="glass"><div class="sec-h"><h2>Rule changes waiting</h2><span class="muted">looser rules wait ${delayWords(v.ruleDelay)}</span></div><div class="rows">${changes}</div></section>` : ""}
      </div>
      <div class="col">
        ${policyCard(v)}
        ${alertsCard()}
        <section class="glass"><div class="sec-h"><h2>Trusted addresses</h2><button class="btn sm" data-act="trust">Add</button></div>
          ${v.trusted.length ? `<div class="trusted">${v.trusted.map((k) => `<a class="addr" href="${explorer("address", k.toBase58())}" target="_blank" rel="noopener"><i class="live"></i>${short(k)}${I.ext}</a>`).join("")}</div>` : `<div class="empty">None yet. Money sent to a trusted address arrives instantly, so adding one takes time.</div>`}</section>
      </div>
    </div>`;
}

// ------------------------------------------------------------------ protection policy

const dateShort = (t) => new Date(t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const RULES = {
  withdraw: { kind: "SetWithdrawDelay", title: "Withdrawal delay", help: "Every withdrawal to an address that isn't trusted waits this long. You can cancel it at any moment.", icon: "clock",
    value: (v) => delayWords(v.withdrawDelay), opts: () => [[HOUR, "1 hour"], [24 * HOUR, "24 hours"], [72 * HOUR, "72 hours"], [7 * DAY, "7 days"], [30 * DAY, "30 days"]], cur: (v) => v.withdrawDelay },
  rule: { kind: "SetRuleDelay", title: "Rule-change delay", help: "Loosening any rule, adding a trusted address or changing the guardian waits this long. Tightening is instant.", icon: "sliders",
    value: (v) => delayWords(v.ruleDelay), opts: () => [[3 * DAY, "3 days"], [7 * DAY, "7 days"], [14 * DAY, "14 days"], [30 * DAY, "30 days"]], cur: (v) => v.ruleDelay },
  limit: { kind: "SetDailyLimit", title: "Daily limit", help: "The most that can leave in one day, sends to trusted addresses included.", icon: "up",
    value: (v) => (v.dailyLimit ? `${sol(v.dailyLimit)} ${C.unit}` : "No limit"), opts: () => [[null, "No limit"], [0.1 * LAMPORTS, `0.1 ${C.unit}`], [1 * LAMPORTS, `1 ${C.unit}`], [5 * LAMPORTS, `5 ${C.unit}`], [25 * LAMPORTS, `25 ${C.unit}`]], cur: (v) => v.dailyLimit },
  lock: { kind: "SetLockedUntil", title: "Time lock", help: "Nothing leaves before this date, except an emergency your guardian co-signs. Ending a lock early can't happen before it ends anyway.", icon: "lock",
    value: (v) => (v.lockedUntil && now() < v.lockedUntil ? `Until ${dateShort(v.lockedUntil)}` : "None"), opts: (v) => [...(v.lockedUntil && now() < v.lockedUntil ? [[null, "End the lock"]] : []), ["d30", "30 days"], ["d90", "90 days"], ["d180", "6 months"], ["d365", "1 year"]], cur: (v) => v.lockedUntil },
  guardian: { kind: "SetGuardian", title: "Guardian", help: "Someone you trust who can approve an emergency release or a new trusted address early. A guardian can never start a withdrawal or choose where money goes.", icon: "people",
    value: (v) => (v.guardian ? short(v.guardian) : "None"), cur: (v) => v.guardian },
};

function pendingFor(v, kind) { return v.changes.filter((c) => c.change.kind === kind); }

function policyCard(v) {
  const rows = Object.entries(RULES).map(([k, r]) => {
    const waiting = pendingFor(v, r.kind);
    return `<div class="pol-row">
      <span class="pol-ico">${I[r.icon]}</span>
      <div class="pol-txt"><span class="pol-name">${r.title}</span><span class="pol-help">${r.help.split(". ")[0].replace(/\.$/, "")}.</span>
        ${waiting.map((c) => `<span class="pol-wait">${I.clock}${esc(changeWords(c.change))} · <span class="count" data-ready="${c.readyAt}">${dur(c.readyAt - now())}</span></span>`).join("")}</div>
      <div class="pol-val"><b class="num${k === "guardian" && v.guardian ? " addr-v" : ""}">${esc(r.value(v))}</b><button class="pol-btn" data-act="rule" data-k="${k}">Adjust</button></div>
    </div>`;
  }).join("");
  return `<section class="glass policy"><div class="sec-h"><div><h2>Protection policy</h2><span class="pol-sub">${levelName(v)} · tightening is instant, loosening waits ${delayWords(v.ruleDelay)}</span></div></div>${rows}</section>`;
}

/** One rule's panel: options as cards, each saying whether it applies now or waits. */
function openRule(key) {
  const v = S.vault, r = RULES[key];
  const lockValue = (raw) => (raw === null || raw === "null" ? null : String(raw).startsWith("d") ? now() + Number(String(raw).slice(1)) * DAY : Number(raw));
  const verdict = (value) => (isStricter(v, { kind: r.kind, value }) ? ["now", "Applies now"] : ["wait", `Waits ${delayWords(v.ruleDelay)}`]);
  let body;
  if (key === "guardian") {
    body = `<label class="field">New guardian address<input name="g" placeholder="A friend's ${C.name} address" spellcheck="false" autocomplete="off"/></label>
      ${v.guardian ? `<label class="opt"><input type="checkbox" name="remove"/><span class="o-l">Remove the current guardian</span><span class="o-b wait">Waits ${delayWords(v.ruleDelay)}</span></label>` : ""}
      <p class="note">Any guardian change waits ${delayWords(v.ruleDelay)}: a guardian can release money early, so nobody holding your key can name one on the spot.</p>`;
  } else {
    const cur = r.cur(v);
    body = `<div class="opts">${r.opts(v).map(([raw, label]) => {
      const value = key === "lock" ? lockValue(raw) : raw, isCur = key !== "lock" && (value ?? null) === (cur ?? null);
      const [cls, txt] = isCur ? ["cur", "Current"] : verdict(value);
      return `<label class="opt${isCur ? " is-cur" : ""}"><input type="radio" name="v" value="${raw}" ${isCur ? "disabled" : ""}/><span class="o-l">${label}</span><span class="o-b ${cls}">${txt}</span></label>`;
    }).join("")}</div>`;
  }
  sheet(`<div class="rule-h"><span class="pol-ico">${I[r.icon]}</span><div><h3>${r.title}</h3><span class="muted small">Now: <b>${esc(r.value(v))}</b></span></div></div><p class="note">${r.help}</p>${body}`, async (fd) => {
    let change;
    if (key === "guardian") {
      const g = String(fd.get("g") || "").trim();
      if (g) { const k = keyOf(g); if (!k || k.equals(S.wallet)) { toast("Pick someone else's valid address", "err"); return false; } change = { kind: "SetGuardian", value: k }; }
      else if (fd.get("remove")) change = { kind: "SetGuardian", value: null };
      else { toast("Enter an address, or choose to remove the guardian", "err"); return false; }
    } else {
      const raw = fd.get("v");
      if (raw === null) { toast("Pick an option", "err"); return false; }
      const value = key === "lock" ? lockValue(raw) : raw === "null" ? null : Number(raw);
      change = { kind: r.kind, value };
    }
    return send(`Changed a rule: ${changeWords(change)}`, () => C.x.ops.proposeChange(change));
  });
  const f = $("#sheet-form"), ok = f.querySelector('button[value="ok"]');
  const label = () => {
    const picked = f.querySelector('input[name="v"]:checked'), g = f.querySelector('input[name="g"]');
    if (key === "guardian") { ok.textContent = `Request change · waits ${delayWords(v.ruleDelay)}`; ok.disabled = !(g?.value.trim() || f.querySelector('input[name="remove"]')?.checked); return; }
    if (!picked) { ok.textContent = "Choose an option"; ok.disabled = true; return; }
    const value = key === "lock" ? lockValue(picked.value) : picked.value === "null" ? null : Number(picked.value);
    ok.disabled = false; ok.textContent = isStricter(v, { kind: r.kind, value }) ? "Apply now" : `Request change · waits ${delayWords(v.ruleDelay)}`;
  };
  f.addEventListener("input", label); label();
}

function openRuleMenu() {
  const v = S.vault;
  sheet(`<h3>Adjust your protection</h3><p class="note">Pick a rule. Tightening applies at once; loosening waits ${delayWords(v.ruleDelay)}.</p>
    <div class="rule-menu">${Object.entries(RULES).map(([k, r]) => `<button type="button" class="rm-row" data-act="rule" data-k="${k}"><span class="pol-ico">${I[r.icon]}</span><span class="rm-t"><b>${r.title}</b><span>${esc(r.value(v))}</span></span>${I.arrow}</button>`).join("")}</div>`, () => true);
  $("#sheet-form").querySelector('button[value="ok"]').hidden = true;
}

// ------------------------------------------------------------------ alerts

const alertsKey = () => `ecrin-alerts-${S.net}-${S.wallet ? S.wallet.toBase58() : ""}`;
const alertsOn = () => { try { return localStorage.getItem(alertsKey()) === "1"; } catch (_) { return false; } };

function alertsCard() {
  const on = alertsOn(), waiting = S.alertCode;
  return `<section class="glass alerts${on ? " on" : ""}">
    <div class="sec-h"><h2>Alerts</h2>${on ? `<span class="pill-on"><i class="live"></i>On</span>` : ""}</div>
    <div class="al-row"><span class="al-ico">${I.bell}</span><p>${on
      ? "Telegram messages you within a minute of any withdrawal, deposit or rule change on this vault. Send <b>/stop</b> to the bot to turn them off."
      : "A delay only protects you if you notice. Get a Telegram message within a minute of anything happening to this vault."}</p></div>
    ${on ? `<button class="btn sm" data-act="alerts">Add another chat</button>`
      : `<button class="btn primary wide" data-act="alerts" ${waiting ? "disabled" : ""}>${waiting ? "Waiting for Telegram… press Start there" : "Get alerts on Telegram"}</button>`}
  </section>`;
}

async function startAlerts() {
  const body = { net: S.net, owner: S.wallet.toBase58(), vault: S.net === "sol" ? S.vault.address.toBase58() : undefined };
  // Open the tab first so phone browsers don't block it as a pop-up.
  const tab = window.open("", "_blank");
  try {
    const r = await fetch("/api/alerts/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok || !j.url) throw new Error(j.error || "Alerts aren't available right now.");
    if (tab) tab.location.href = j.url; else location.href = j.url;
    S.alertCode = j.code; render();
    for (let i = 0; i < 60 && S.alertCode === j.code; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      const st = await fetch("/api/alerts/status?code=" + encodeURIComponent(j.code)).then((x) => x.json()).catch(() => ({}));
      if (st.linked) { try { localStorage.setItem(alertsKey(), "1"); } catch (_) {} toast("Alerts are on. Telegram will message you.", "win"); break; }
    }
  } catch (e) { tab?.close(); toast(esc(e.message), "err"); }
  S.alertCode = null; render();
}

function feedHTML(log) {
  const kind = (t) => /^Cancelled/.test(t) ? ["win", I.shield] : /^Deposited/.test(t) ? ["in", I.down] : /withdraw|Sent/i.test(t) ? ["out", I.up] : /rule|trust/i.test(t) ? ["rule", I.sliders] : ["other", I.clock];
  return `<ul class="feed">${log.map((l) => { const [k, ic] = kind(l.text); return `<li class="${k}"><span class="f-ico">${ic}</span><span class="f-txt"><b>${esc(l.text)}</b><time>${new Date(l.at * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></span><a href="${explorer("tx", l.sig)}" target="_blank" rel="noopener" aria-label="View on the explorer">${I.ext}</a></li>`; }).join("")}</ul>`;
}

function activityView() {
  const log = readLog();
  return `<section class="glass"><div class="sec-h"><h2>Activity</h2><span class="muted">from this browser</span></div>
    ${log.length ? feedHTML(log) : `<div class="empty">Your transactions from this browser show up here.</div>`}</section>`;
}

// A watch dial for a queued withdrawal: 60 ticks, an arc that runs down, the time left in the middle.
const DIAL_R = 84, DIAL_C = 2 * Math.PI * DIAL_R;
function dialText(left) {
  const l = Math.max(0, left), d = Math.floor(l / DAY), h = Math.floor((l % DAY) / HOUR), m = Math.floor((l % HOUR) / 60), s = l % 60, p = (n) => String(n).padStart(2, "0");
  return { main: d ? `${d}d ${p(h)}:${p(m)}` : `${p(h)}:${p(m)}`, sec: `${p(s)}s` };
}
function dialHTML(opens, total) {
  const left = opens - now(), { main, sec } = dialText(left), frac = Math.max(0, Math.min(1, left / Math.max(1, total)));
  const ticks = Array.from({ length: 60 }, (_, i) => { const a = (i / 60) * 2 * Math.PI, r1 = i % 5 ? 92 : 89, x = (r) => 100 + r * Math.sin(a), y = (r) => 100 - r * Math.cos(a); return `<line x1="${x(r1).toFixed(1)}" y1="${y(r1).toFixed(1)}" x2="${x(96).toFixed(1)}" y2="${y(96).toFixed(1)}"${i % 5 ? "" : ' class="maj"'}/>`; }).join("");
  return `<div class="dial" data-ready="${opens}" data-total="${total}" role="timer" aria-label="Time left before this can leave: ${main} ${sec}">
    <svg viewBox="0 0 200 200" aria-hidden="true"><g class="ticks">${ticks}</g><circle class="d-track" cx="100" cy="100" r="${DIAL_R}"/><circle class="d-arc" cx="100" cy="100" r="${DIAL_R}" stroke-dasharray="${DIAL_C}" stroke-dashoffset="${(DIAL_C * (1 - frac)).toFixed(2)}" transform="rotate(-90 100 100) scale(1 -1) translate(0 -200)"/></svg>
    <div class="d-in"><b class="num">${main}</b><span>${sec}</span><small>until it can leave</small></div>
  </div>`;
}
function tickDial(el) {
  const opens = Number(el.dataset.ready), total = Number(el.dataset.total), left = opens - now();
  if (left <= 0) return false;
  const { main, sec } = dialText(left);
  el.querySelector(".d-in b").textContent = main; el.querySelector(".d-in span").textContent = sec;
  el.querySelector(".d-arc").setAttribute("stroke-dashoffset", (DIAL_C * (1 - Math.min(1, left / Math.max(1, total)))).toFixed(2));
  return true;
}

function rowsWithdrawals(v, asGuardian) {
  const t = now(), locked = v.lockedUntil && t < v.lockedUntil;
  return v.withdrawals.map((w) => {
    const left = w.readyAt - t, ready = left <= 0 && !locked, opens = Math.max(w.readyAt, locked ? v.lockedUntil : 0);
    const status = ready ? `<div class="clock-done">Ready. It only leaves if you press send.</div>` : dialHTML(opens, Math.max(v.withdrawDelay, opens - (w.readyAt - v.withdrawDelay)));
    const guard = asGuardian
      ? (S.wallet && v.guardian?.equals(S.wallet) ? `<div class="row-acts"><button class="btn sm good" data-act="release" data-id="${w.id}" data-dest="${w.dest.toBase58()}" ${S.busy ? "disabled" : ""}>Approve emergency release</button></div>` : "")
      : `<button class="keep" data-act="cancel-w" data-id="${w.id}" data-amt="${w.amount}" ${S.busy ? "disabled" : ""}>${I.shield}<span>Cancel and keep ${sol(w.amount)} ${C.unit} safe</span></button>
        <div class="keep-note">Free, instant, and nobody else is told.${ready ? ` <button class="link danger" data-act="run" data-id="${w.id}" data-dest="${w.dest.toBase58()}" ${S.busy ? "disabled" : ""}>Send it now</button>` : ""}</div>`;
    return `<div class="row wd${ready ? " is-ready" : ""}">
      <div class="row-top"><b><span class="m">${sol(w.amount)}</span> ${C.unit} <span class="muted">leaving</span></b><span class="muted">to <a href="${explorer("address", w.dest.toBase58())}" target="_blank" rel="noopener">${short(w.dest)}</a></span></div>
      ${status}
      <div class="muted small center">${ready ? "Unlocked" : "Unlocks"} ${when(opens)}${locked && left <= 0 ? " · held by your lock" : ""}</div>
      ${guard}</div>`;
  }).join("") || `<div class="empty">Nothing waiting to leave. Every withdrawal shows up here with a countdown, and you can cancel it until it runs.</div>`;
}

function guardianView() {
  const v = S.watched, t = now();
  const g = v && S.wallet && v.guardian?.equals(S.wallet), locked = v && v.lockedUntil && t < v.lockedUntil;
  const changes = v ? rowsChanges(v, true) : "";
  return `<section class="glass"><div class="sec-h"><h2>Look up a vault you guard</h2></div>
      <div class="lookup"><input id="watch" class="input" placeholder="The vault owner's ${C.name} address" value="${esc(S.watchOwner)}" spellcheck="false" autocomplete="off"/><button class="btn primary" data-act="watch">Look up</button></div>
      <p class="hint">Guardians can approve an emergency release of a withdrawal the owner requested, or a trusted address the owner proposed. Nothing else.</p></section>
    ${!S.watchOwner ? "" : v === undefined ? `<section class="glass"><div class="spinner"></div></section>` : v === null ? `<section class="glass"><div class="empty">No Ecrin vault for that wallet on ${C.name}.</div></section>` : `
      <section class="vhero glass"><div class="vh-shield">${I.people}</div><div class="vh-txt"><span class="label">Vault of ${short(v.owner)}</span><div class="big">${sol(v.balance)}</div><span class="unit">${C.unit}</span>
        <div class="chips"><span class="chip">${I.clock}Withdrawals wait ${delayWords(v.withdrawDelay)}</span>${locked ? `<span class="chip">${I.lock}Locked</span>` : ""}<span class="chip">${g ? "You're the guardian" : "You're not this vault's guardian"}</span></div></div></section>
      <section class="glass"><div class="sec-h"><h2>Waiting to leave</h2></div><div class="rows">${rowsWithdrawals(v, true)}</div></section>
      ${changes ? `<section class="glass"><div class="sec-h"><h2>Rule changes waiting</h2></div><div class="rows">${changes}</div></section>` : ""}`}`;
}

function changeWords({ kind, value }) {
  switch (kind) {
    case "SetWithdrawDelay": return `Withdrawals wait ${delayWords(value)}`;
    case "SetRuleDelay": return `Looser rules wait ${delayWords(value)}`;
    case "SetDailyLimit": return value ? `Daily limit ${sol(value)} ${C.unit}` : "Remove the daily limit";
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
      ? (g && c.change.kind === "AddTrusted" ? `<button class="btn sm good" data-act="approve" data-id="${c.id}" ${S.busy ? "disabled" : ""}>Approve now</button>` : `<span class="muted small">Guardians can't speed this up.</span>`)
      : `<button class="btn sm" data-act="cancel-c" data-id="${c.id}" ${S.busy ? "disabled" : ""}>Cancel change</button>${left <= 0 ? `<button class="btn sm primary" data-act="apply" data-id="${c.id}" ${S.busy ? "disabled" : ""}>Apply</button>` : ""}`;
    return `<div class="row"><div class="row-top"><b>${esc(changeWords(c.change))}</b><span class="count" data-ready="${c.readyAt}">${dur(left)}</span></div><div class="bar"><i style="width:${pct}%"></i></div><div class="row-acts">${acts}</div></div>`;
  }).join("");
}

// ------------------------------------------------------------------ sheets

function sheet(html, onSubmit) {
  const d = $("#sheet"), f = $("#sheet-form");
  f.innerHTML = html + `<div class="acts"><button class="btn" value="cancel" formnovalidate>Close</button><button class="btn primary" value="ok">Confirm</button></div>`;
  f.onsubmit = async (e) => { if (e.submitter?.value !== "ok") return; e.preventDefault(); if ((await onSubmit(new FormData(f))) !== false) d.close(); };
  d.showModal(); f.querySelector("input,select")?.focus();
}
const lamportsOf = (fd) => Math.round(Number(fd.get("amount")) * LAMPORTS);
const amount = (v = "0.1") => `<label class="field">Amount (${C.unit})<input name="amount" type="number" min="0.0001" step="0.0001" inputmode="decimal" required value="${v}"/></label>`;
const keyOf = (s) => (s ? C.x?.key(s) ?? null : null);

const actions = {
  connect: (el) => connect(providers()[Number(el.dataset.i)][1]),
  disconnect: () => { if (confirm("Disconnect your wallet?")) disconnect(); },
  tab: (el) => {
    if (S.tab === el.dataset.t) return;
    S.tab = el.dataset.t; S.shown = null;
    document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches ? document.startViewTransition(render) : render();
    scrollTo({ top: 0, behavior: "smooth" });
    if (S.tab === "guardian" && S.watchOwner) refresh();
  },
  alerts: () => startAlerts(),
  privacy: () => { S.hide = !S.hide; try { localStorage.setItem("ecrin-hide", S.hide ? "1" : "0"); } catch (_) {} render(); },
  theme: () => {
    const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#0c0d0f" : "#f6f6f3");
    try { localStorage.setItem("ecrin-theme", t); } catch (_) {}
    render();
  },
  range: (el) => { S.range = el.dataset.d; render(); loadSeries(S.range); },
  net: (el) => switchNet(el.dataset.n),
  pick: (el) => { S.pick = el.dataset.k; render(); },
  create: async () => {
    const gRaw = $("#g-addr")?.value.trim(), guardian = gRaw ? keyOf(gRaw) : null;
    if (gRaw && !guardian) return toast("That guardian address isn't valid", "err");
    if (guardian?.equals(S.wallet)) return toast("Your guardian must be someone else's wallet", "err");
    let preset;
    if (S.pick === "gentle") { if (guardian) toast("Gentle starts without a guardian; you can add one later (it waits your rule delay)"); preset = { kind: "gentle" }; }
    else if (S.pick === "strong") preset = { kind: "strong", guardian };
    else {
      const d = $("#lock-date")?.value; if (!guardian) return toast("Locked needs a guardian for emergencies", "err");
      const until = d ? Math.floor(new Date(d + "T00:00:00").getTime() / 1000) : 0;
      if (!(until > now() + HOUR)) return toast("Pick a lock date in the future", "err");
      preset = { kind: "locked", until, guardian };
    }
    await send(`Created a ${S.pick} vault`, () => C.x.ops.create(preset));
  },
  deposit: () => sheet(`<h3>Deposit</h3>${amount("1")}<p class="note">Wallet: ${sol(S.walletSol)} ${C.unit}. Deposits go straight in.</p>`, (fd) => send(`Deposited ${sol(lamportsOf(fd))} ${C.unit}`, () => C.x.ops.deposit(lamportsOf(fd)))),
  withdraw: () => sheet(`<h3>Withdraw</h3>${amount()}<label class="field">To address<input name="dest" placeholder="Where it should go" required spellcheck="false" autocomplete="off" value="${S.wallet.toBase58()}"/></label><p class="note">This waits ${delayWords(S.vault.withdrawDelay)}${S.vault.lockedUntil && now() < S.vault.lockedUntil ? " and until the lock ends" : ""}. You can cancel any time.</p>`, async (fd) => {
    const dest = keyOf(fd.get("dest")); if (!dest) { toast("That address isn't valid", "err"); return false; }
    return send(`Asked to withdraw ${sol(lamportsOf(fd))} ${C.unit}`, () => C.x.ops.requestWithdrawal(dest, lamportsOf(fd)));
  }),
  send: () => {
    if (!S.vault.trusted.length) return toast("Add a trusted address first", "err");
    sheet(`<h3>Send to a trusted address</h3>${amount()}<label class="field">To<select name="dest">${S.vault.trusted.map((k) => `<option value="${k.toBase58()}">${short(k)}</option>`).join("")}</select></label><p class="note">Arrives instantly${S.vault.dailyLimit ? `, up to ${sol(S.vault.dailyLimit)} ${C.unit} a day` : ""}.</p>`,
      (fd) => send(`Sent ${sol(lamportsOf(fd))} ${C.unit} to a trusted address`, () => C.x.ops.sendToTrusted(keyOf(fd.get("dest")), lamportsOf(fd))));
  },
  trust: () => sheet(`<h3>Trust an address</h3><label class="field">Address<input name="addr" required placeholder="Your bank off-ramp, your rent…" spellcheck="false" autocomplete="off"/></label><p class="note">Money sent here will arrive instantly, so trusting it waits ${delayWords(S.vault.ruleDelay)}${S.vault.guardian ? ", unless your guardian approves it sooner" : ""}.</p>`, async (fd) => {
    const a = keyOf(fd.get("addr")); if (!a) { toast("That address isn't valid", "err"); return false; }
    return send("Asked to trust an address", () => C.x.ops.proposeChange({ kind: "AddTrusted", value: a }));
  }),
  rules: () => openRuleMenu(),
  rule: (el) => { $("#sheet").close(); openRule(el.dataset.k); },
  "cancel-w": (el) => send(`Cancelled. ${sol(Number(el.dataset.amt))} ${C.unit} stays in your vault. That's a win.`, () => C.x.ops.cancelWithdrawal(Number(el.dataset.id))),
  run: (el) => send("Sent a withdrawal", () => C.x.ops.executeWithdrawal(S.wallet, Number(el.dataset.id), keyOf(el.dataset.dest))),
  "cancel-c": (el) => send("Cancelled a rule change", () => C.x.ops.cancelChange(Number(el.dataset.id))),
  apply: (el) => send("Applied a rule change", () => C.x.ops.applyChange(S.wallet, Number(el.dataset.id))),
  watch: async () => {
    const k = keyOf($("#watch")?.value); if (!k) return toast("That address isn't valid", "err");
    S.watchOwner = k.toBase58(); S.watched = undefined; render();
    S.watched = await C.x.fetchVault(k).catch(() => null); render();
  },
  release: (el) => send("Approved an emergency release", () => C.x.ops.guardianRelease(keyOf(S.watchOwner), Number(el.dataset.id), keyOf(el.dataset.dest))),
  approve: (el) => send("Approved a trusted address", () => C.x.ops.guardianApproveChange(keyOf(S.watchOwner), Number(el.dataset.id))),
};

document.addEventListener("click", (e) => { const el = e.target.closest("[data-act]"); if (!el || el.disabled) return; actions[el.dataset.act]?.(el); });
// Live countdowns between refreshes: the withdrawal clocks tick every second; when one hits zero, reload the vault.
setInterval(() => {
  let done = false;
  document.querySelectorAll(".dial[data-ready]").forEach((n) => { if (!tickDial(n)) done = true; });
  document.querySelectorAll(".count[data-ready]").forEach((n) => { const left = Number(n.dataset.ready) - now(); if (left > 0) n.textContent = dur(left); });
  if (done && !S.busy && Date.now() - (S.tickRefresh || 0) > 10000) { S.tickRefresh = Date.now(); refresh(); }
}, 1000);
setInterval(() => { if (S.wallet && !S.busy && document.visibilityState === "visible") refresh(); }, 30000);

render();
loadPrice();
setInterval(() => { if (document.visibilityState === "visible") loadPrice(); }, 120000);
// Reconnect silently if this site was trusted before on this network.
function reconnect() {
  try {
    if (!localStorage.getItem("ecrin-wallet-" + S.net) && !(S.net === "sol" && localStorage.getItem("ecrin-wallet"))) return;
    const p = providers()[0]?.[1];
    if (!p || !C.x) return;
    if (S.net === "eth") p.request({ method: "eth_accounts" }).then((a) => { if (a?.length) connect(p); }).catch(() => {});
    else p.connect?.({ onlyIfTrusted: true }).then((r) => { if (r?.publicKey || p.publicKey) connect(p); }).catch(() => {});
  } catch (_) {}
}
reconnect();

// The case leans toward the pointer and catches the light (mouse and pen only).
if (matchMedia("(pointer: fine)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  document.addEventListener("pointermove", (e) => {
    const c = e.target.closest?.("[data-tilt]");
    document.querySelectorAll("[data-tilt].tilting").forEach((n) => { if (n !== c) { n.classList.remove("tilting"); n.style.removeProperty("--rx"); n.style.removeProperty("--ry"); } });
    if (!c) return;
    const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    c.classList.add("tilting");
    c.style.setProperty("--ry", ((x - 0.5) * 9).toFixed(2) + "deg"); c.style.setProperty("--rx", ((0.5 - y) * 7).toFixed(2) + "deg");
    c.style.setProperty("--mx", (x * 100).toFixed(1) + "%"); c.style.setProperty("--my", (y * 100).toFixed(1) + "%");
  }, { passive: true });
}
// A short buzz on phones for the buttons that matter.
document.addEventListener("pointerdown", (e) => { if (e.target.closest?.(".qa button, .keep, .tab-i, .case")) navigator.vibrate?.(8); }, { passive: true });
