// Ecrin app: your real vault on Solana devnet or an Ethereum-style test network (Sepolia, Base, Arbitrum, Optimism,
// Polygon), through the wallet you already use. Solana: reads with app/chain.js, signs in the wallet, sends through our
// own devnet RPC (so it works whichever network the wallet is set to). Ethereum-style: app/evm.js reads through a
// public RPC and signs with MetaMask. Both return the same vault shape, so every view below is shared.
// Each vault holds the network's own coin and USDC: one set of rules, a balance, a queue and a daily limit per coin.
// Nothing here holds keys or funds.
import { createClient, explainError } from "./chain.js";
import { isStricter } from "./vault.js";
import { CONFIG } from "./config.js";
import { createEvmClient, explainEvmError } from "./evm.js";
import { EVM_NETS } from "./config-evm.js";
import { SOL_USDC } from "./config-tokens.js";
import { WC } from "./config-wc.js";
import { LANG, LOCALE, tr, setLang, startTranslating } from "./i18n.js";

const web3 = window.solanaWeb3;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Amounts are in 1e9 base units per coin on both networks: lamports on Solana, gwei on Ethereum.
const LAMPORTS = 1e9, HOUR = 3600, DAY = 86400;
// Amounts are in the coin's base units: 1e9 for the network's own coin (lamports, gwei), 1e6 for USDC.
// `sol` formats for the asset being looked at unless told which.
const sol = (l, a = A()) => (l / a.base).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: a.stable ? 2 : 4 });
const short = (k) => { const s = String(k); return s.slice(0, 4) + "…" + s.slice(-4); };
const when = (t) => new Date(t * 1000).toLocaleString(LOCALE, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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
const S = { asset: "native", tok: {}, walletTok: {}, hide: savedHide, net: savedNet, tab: savedTab, range: "7", shown: null, chart: null, price: null, tokens: [], wallet: null, provider: null, walletSol: null, vault: undefined, view: "owner", watchOwner: "", watched: undefined, busy: false, clockOffset: 0, err: null, pick: "strong" };
const now = () => Math.floor(Date.now() / 1000) + S.clockOffset;
// A link from an alert: ?act=cancel-w|cancel-c&id=7&asset=native|usdc opens that item, ready to cancel.
try {
  const q = new URLSearchParams(location.search), act = q.get("act"), id = Number(q.get("id"));
  if (act === "freeze") S.goto = { act, id: 0, asset: "native", owner: q.get("owner") || "" };
  else if ((act === "cancel-w" || act === "cancel-c") && Number.isInteger(id) && id > 0) S.goto = { act, id, asset: q.get("asset") === "usdc" ? "usdc" : "native", owner: q.get("owner") || "" };
} catch (_) {}

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

const isEvm = (n = S.net) => n !== "sol";

/** Asks the wallet to switch to this network, adding it first if the wallet doesn't know it. */
async function ensureChain(p, E = C.evm) {
  const want = "0x" + E.chainId.toString(16);
  if ((await p.request({ method: "eth_chainId" })) === want) return;
  try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] }); }
  catch (e) {
    if (e?.code !== 4902) throw e;
    await p.request({ method: "wallet_addEthereumChain", params: [{ chainId: want, chainName: `${E.name} ${E.net}`, nativeCurrency: { name: E.unit, symbol: E.unit, decimals: 18 }, rpcUrls: [E.rpc], blockExplorerUrls: [E.explorer] }] });
  }
}

function evmNet(E) {
  const c = E.address && window.ethers
    ? createEvmClient({ ethers: window.ethers, EVM: E, getSigner: async () => { await ensureChain(S.provider, E); return new window.ethers.BrowserProvider(S.provider).getSigner(); } })
    : null;
  return {
    name: E.name, net: E.net, unit: E.unit, cg: E.cg, x: c && { ...c, explain: (e) => explainEvmError(e, c.iface) }, contract: E.address, contractWord: "contract", evm: E,
    explorer: (kind, id) => `${E.explorer}/${kind}/${id}`,
    faucet: E.faucet, faucetName: E.faucetName, lowBal: E.unit === "POL" ? 0.05 : E.key === "eth" ? 0.002 : 0.0005,
    setup: `In MetaMask: Settings → Advanced → turn on <b>Show test networks</b>. Ecrin asks MetaMask to switch to <b>${E.name} ${E.net}</b> for you.`,
    getWallet: ["Get MetaMask", "https://metamask.io/download/"],
    createCost: `Creating the vault costs a little test ${E.unit} in gas.`,
    usdc: E.v >= 2 && E.usdc ? E.usdc : null,
  };
}

const NETS = {
  sol: {
    name: "Solana", net: "Devnet", unit: "SOL", cg: "solana", x: solX, contract: CONFIG.programId, contractWord: "program",
    explorer: (kind, id) => `https://explorer.solana.com/${kind}/${id}?cluster=${CONFIG.cluster}`,
    faucet: "https://faucet.solana.com", faucetName: "faucet.solana.com", lowBal: 0.01,
    setup: "In Phantom: Settings → Developer Settings → turn on <b>Testnet Mode</b> and pick <b>Solana Devnet</b>.",
    getWallet: ["Get Phantom", "https://phantom.com/download"],
    createCost: "Creating the vault costs a small amount of devnet SOL for the account's rent.",
    usdc: CONFIG.tokens ? SOL_USDC[CONFIG.cluster] || null : null,
  },
  ...Object.fromEntries(Object.values(EVM_NETS).map((E) => [E.key, evmNet(E)])),
};
if (!NETS[S.net]) S.net = "sol";
let C = NETS[S.net];

function switchNet(n) {
  if (!NETS[n] || n === S.net) return;
  try { S.provider?.disconnect?.(); } catch (_) {}
  Object.assign(S, { asset: "native", tok: {}, walletTok: {}, readOnly: false, net: n, wallet: null, provider: null, walletSol: null, vault: undefined, price: null, tokens: [], tab: "portfolio", shown: null, chart: null, watchOwner: "", watched: undefined, err: null });
  C = NETS[n];
  try { localStorage.setItem("ecrin-net", n); } catch (_) {}
  render(); loadPrice(); reconnect();
}

// ------------------------------------------------------------------ assets: the network's own coin, and USDC

const USDC = { id: "usdc", unit: "USDC", base: 1e6, stable: true };
/** What a vault on this network can hold. USDC shows once the deployed program or contract supports tokens. */
const assets = () => [{ id: "native", unit: C.unit, base: LAMPORTS }, ...(C.usdc && C.x ? [USDC] : [])];
const A = (id = S.asset) => assets().find((a) => a.id === id) || assets()[0];
let tokCache = null;
/** The USDC side of this network's client (same shape on Solana and Ethereum). */
function tc() {
  if (!tokCache || tokCache.net !== S.net) tokCache = { net: S.net, t: isEvm() ? C.x.token(C.usdc) : client.token(C.usdc) };
  return tokCache.t;
}

/** The vault as seen for one asset: the shared rules, with that asset's balance, queue, limit and limit changes. */
function assetView(v, id = S.asset) {
  if (!v || id === "native") return v && { ...v, asset: "native" };
  const t = v.tokens?.[id];
  return {
    ...v, asset: id, opened: !!t, balance: t?.balance || 0, available: t?.available || 0, withdrawals: t?.withdrawals || [], dailyLimit: t?.dailyLimit ?? null,
    changes: [...v.changes.filter((c) => c.change.kind !== "SetDailyLimit"), ...(t?.changes || []).map((c) => ({ ...c, asset: id }))],
  };
}
/** Every withdrawal waiting to leave, whatever the coin, each tagged with its asset. */
const allWithdrawals = (v) => [...(v?.withdrawals || []).map((w) => ({ ...w, asset: "native" })), ...Object.entries(v?.tokens || {}).flatMap(([id, t]) => (t?.withdrawals || []).map((w) => ({ ...w, asset: id })))];

/** The operations for one asset, with the native coin's signatures. Rules other than the daily limit are shared. */
function assetOps(id = S.asset) {
  if (id === "native") return C.x.ops;
  const t = tc(), main = C.x.ops;
  const limitOr = (f) => (ch) => (ch.kind === "SetDailyLimit" ? f(ch.value) : main.proposeChange(ch));
  if (isEvm()) return { ...t.ops, proposeChange: limitOr(t.ops.proposeLimit) };
  const b = t.build, me = () => S.wallet;
  return {
    // The first USDC deposit also opens the vault's USDC account, in the same transaction.
    deposit: (u) => solTx(...(S.vault?.tokens?.[id] ? [] : [b.open(me())]), b.deposit(me(), u)),
    sendToTrusted: (dest, u) => solTx(...b.sendToTrusted(me(), dest, u)),
    requestWithdrawal: (dest, u) => solTx(b.requestWithdrawal(me(), dest, u)),
    cancelWithdrawal: (wid) => solTx(b.cancelWithdrawal(me(), wid)),
    executeWithdrawal: (o, wid, dest) => solTx(...b.executeWithdrawal(me(), o, wid, dest)),
    guardianRelease: (o, wid, dest) => solTx(...b.guardianRelease(me(), o, wid, dest)),
    proposeChange: limitOr((v) => solTx(b.proposeLimit(me(), v))),
    cancelChange: (cid) => solTx(b.cancelChange(me(), cid)),
    applyChange: (o, cid) => solTx(b.applyChange(me(), o, cid)),
  };
}

/** Reads a vault and its USDC side together. */
async function readVault(owner) {
  const v = await C.x.fetchVault(owner);
  if (v && C.usdc) v.tokens = { usdc: await tc().fetch(owner).catch(() => null) };
  return v;
}

// ------------------------------------------------------------------ wallet

const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));

// On phones the wallet isn't injected into Safari or Chrome: these links reopen this page inside the wallet app's browser.
function walletLinks() {
  const url = location.href.split("#")[0], ref = location.origin;
  return isEvm()
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
  if (isEvm() && !S.wallet) render();
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

function providers() {
  if (isEvm()) {
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
    if (isEvm()) {
      const acc = await provider.request({ method: "eth_requestAccounts" });
      await ensureChain(provider);
      S.provider = provider; S.wallet = C.x.key(acc[0]);
      if (!provider.__ecrin) {
        provider.__ecrin = true;
        provider.on?.("accountsChanged", (a) => { if (!isEvm() || S.viaWC) return; if (a?.length) { S.wallet = C.x.key(a[0]); S.vault = undefined; refresh(); } else disconnect(); });
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
function disconnect() {
  try { S.viaWC ? wcMod?.disconnectWalletConnect() : S.provider?.disconnect?.(); } catch (_) {}
  S.wallet = null; S.provider = null; S.vault = undefined; S.readOnly = false; S.viaWC = false;
  try { localStorage.removeItem("ecrin-wallet-" + S.net); localStorage.removeItem("ecrin-view-" + S.net); } catch (_) {}
  render();
}

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

function logKey() { return "ecrin-log-" + (S.net === "sol" ? "" : S.net + "-") + (S.wallet ? S.wallet.toBase58() : ""); }
function readLog() { try { return JSON.parse(localStorage.getItem(logKey()) || "[]"); } catch (_) { return []; } }
function log(text, sig) { try { localStorage.setItem(logKey(), JSON.stringify([{ at: now(), text, sig }, ...readLog()].slice(0, 30))); } catch (_) {} }

async function refresh() {
  if (!C.x || !S.wallet) return render();
  try {
    const [bal, vault, t, wtok] = await Promise.all([C.x.balance(S.wallet), readVault(S.wallet), C.x.chainTime().catch(() => null), C.usdc ? tc().walletBalance(S.wallet).catch(() => 0) : 0]);
    S.walletSol = bal; S.vault = vault; S.walletTok = { usdc: wtok }; S.err = null;
    if (!assets().some((a) => a.id === S.asset)) S.asset = "native";
    if (t) S.clockOffset = t - Math.floor(Date.now() / 1000);
    if (S.tab === "guardian" && S.watchOwner) S.watched = await readVault(C.x.key(S.watchOwner)).catch(() => null);
  } catch (e) { S.err = `Couldn't reach ${C.name} ${C.net}. Retrying…`; console.warn(e); }
  render();
  if (S.goto && S.vault !== undefined) openGoto();
}

/** Takes the person from an alert to the withdrawal or rule change it was about, and asks to cancel it. */
function openGoto() {
  const g = S.goto; S.goto = null;
  try { history.replaceState(null, "", location.pathname + "?net=" + S.net + "&tab=vault"); } catch (_) {}
  // Ids count per vault, so the link only applies to the vault it was about.
  if (g.owner && S.wallet && S.wallet.toBase58().toLowerCase() !== g.owner.toLowerCase()) return toast(`That alert is about vault ${esc(short(g.owner))}. Connect that wallet to cancel it.`, "err");
  if (!S.vault) return toast("This wallet has no vault on " + C.name + ". Connect the wallet that owns it.", "err");
  if (g.act === "freeze") { S.tab = "vault"; render(); return S.readOnly ? signElsewhere() : freezeSheet(); }
  if (g.asset !== "native" && !assets().some((a) => a.id === g.asset)) return;
  S.asset = g.asset; S.tab = "vault"; render();
  const v = assetView(S.vault), a = A();
  const item = g.act === "cancel-w" ? v.withdrawals.find((w) => w.id === g.id) : v.changes.find((c) => c.id === g.id);
  if (!item) return toast(g.act === "cancel-w" ? "That withdrawal isn't waiting anymore: it was already cancelled or sent." : "That rule change isn't waiting anymore.", "err");
  const btn = document.querySelector(`[data-act="${g.act}"][data-id="${g.id}"]`);
  const row = btn?.closest(".row");
  if (row) { row.scrollIntoView({ behavior: "smooth", block: "center" }); row.classList.add("flash"); setTimeout(() => row.classList.remove("flash"), 4000); }
  const what = g.act === "cancel-w" ? `<b>${sol(item.amount, a)} ${a.unit}</b> to <code>${esc(short(item.dest))}</code>` : `<b>${esc(changeWords(item.change, item.asset))}</b>`;
  sheet(`<div class="rule-h"><span class="pol-ico">${I.shield}</span><div><h3>Cancel this ${g.act === "cancel-w" ? "withdrawal" : "rule change"}?</h3><span class="muted small">From your alert</span></div></div>
    <p class="note">${what}. ${g.act === "cancel-w" ? "Cancelling is free and instant, and the money stays in your vault." : "Cancelling is free and instant; your rules stay as they are."}</p>`, () => { btn?.click(); return true; });
  $("#sheet-form").querySelector('button[value="ok"]').textContent = g.act === "cancel-w" ? "Cancel and keep it safe" : "Cancel the change";
}

// ------------------------------------------------------------------ WalletConnect

let wcMod = null;
const wcOn = () => !!WC.projectId;
async function wc() {
  if (!wcMod) wcMod = await import("./vendor/wc/walletconnect.js");
  wcMod.initWalletConnect({ projectId: WC.projectId, theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light" });
  return wcMod;
}
/** Connects through the WalletConnect modal (QR code on computers, wallet apps on phones). */
async function connectWC() {
  if (connecting) return;
  connecting = true;
  try {
    const m = await wc();
    const { provider, address } = await m.connectWith(S.net === "sol" ? "solana" : "eip155");
    S.readOnly = false; S.viaWC = true; S.vault = undefined;
    if (isEvm()) {
      await ensureChain(provider);
      S.provider = provider; S.wallet = C.x.key(address);
      provider.on?.("accountsChanged", (a) => { if (isEvm() && S.viaWC) { if (a?.length) { S.wallet = C.x.key(a[0]); S.vault = undefined; refresh(); } else disconnect(); } });
    } else {
      S.provider = provider; S.wallet = new web3.PublicKey(address);
    }
    try { localStorage.removeItem(viewKey()); } catch (_) {}
    toast("Connected with WalletConnect", "win");
    await refresh();
  } catch (e) {
    if (e?.code !== 4001) toast(esc((C.x?.explain || explainError)(e).message), "err");
  } finally { connecting = false; }
}

// ------------------------------------------------------------------ home screen and view mode

const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
const inWalletBrowser = () => isPhone() && !!(window.phantom?.solana || window.solflare || window.ethereum);
let installPrompt = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; render(); });
addEventListener("appinstalled", () => { installPrompt = null; render(); });

function installCard() {
  if (!isPhone() || standalone()) return "";
  try { if (localStorage.getItem("ecrin-install-off") === "1") return ""; } catch (_) {}
  return `<section class="glass install"><span class="in-ico">${logo}</span><div class="in-t"><b>Add Ecrin to your home screen</b><span>Your vault, one tap away. Opens like an app.</span></div><button class="btn primary sm" data-act="install">Install</button><button class="in-x" data-act="install-off" aria-label="Hide">×</button></section>`;
}

function installGuide() {
  if (installPrompt) { installPrompt.prompt(); installPrompt.userChoice.finally(() => { installPrompt = null; render(); }); return; }
  const url = location.origin + "/app";
  const steps = inWalletBrowser()
    ? `<p class="note">Wallet browsers can't add apps to the home screen. Open Ecrin in ${isIOS() ? "Safari" : "Chrome"} and install it from there.</p><div class="copy-row"><code>${esc(url.replace(/^https?:\/\//, ""))}</code><button type="button" class="btn sm" data-act="copy" data-v="${esc(url)}">Copy link</button></div>`
    : isIOS()
      ? `<ol class="guide"><li><b>1</b><span>Tap <b>Share</b> at the bottom of Safari (the square with an arrow).</span></li><li><b>2</b><span>Scroll and tap <b>Add to Home Screen</b>.</span></li><li><b>3</b><span>Tap <b>Add</b>. Ecrin appears with your other apps.</span></li></ol>`
      : `<ol class="guide"><li><b>1</b><span>Open Chrome's menu <b>⋮</b> at the top right.</span></li><li><b>2</b><span>Tap <b>Install app</b> (or <b>Add to Home screen</b>).</span></li><li><b>3</b><span>Confirm. Ecrin appears with your other apps.</span></li></ol>`;
  sheet(`<div class="rule-h"><span class="pol-ico">${logo}</span><div><h3>Install Ecrin</h3><span class="muted small">Takes ten seconds</span></div></div>${steps}
    <p class="note">On the home screen, Ecrin opens in view mode: your vault, balance, countdowns and alerts. To sign something, it hands you to your wallet app.</p>`, () => true);
  $("#sheet-form").querySelector('button[value="ok"]').hidden = true;
}

// View mode: watch a vault by address, with no wallet connected (what the home-screen app uses on phones).
const viewKey = () => "ecrin-view-" + S.net;
function startView(addr) {
  const k = keyOf(addr);
  if (!k) return toast("That address isn't valid", "err");
  S.wallet = k; S.provider = null; S.readOnly = true; S.vault = undefined;
  try { localStorage.setItem(viewKey(), k.toBase58()); } catch (_) {}
  refresh();
}
/** In view mode, anything that needs a signature is handed to the wallet app. */
function signElsewhere() {
  const [name, href] = walletLinks()[0];
  sheet(`<div class="rule-h"><span class="pol-ico">${I.lock}</span><div><h3>Sign in ${name}</h3><span class="muted small">You're in view mode</span></div></div>
    <p class="note">The home-screen app can watch your vault but can't sign. ${name} opens Ecrin in its own browser, already on your vault, where you can confirm this.</p>
    ${wcOn() ? `<button type="button" class="btn primary wide wc-btn" data-act="wc">${WC_ICON}<span>Connect with WalletConnect</span></button>` : ""}
    <a class="btn ${wcOn() ? "" : "primary "}wide" href="${esc(href)}">Open in ${name}</a>`, () => true);
  $("#sheet-form").querySelector('button[value="ok"]').hidden = true;
}
const WC_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6.1 8.6c3.3-3.2 8.5-3.2 11.8 0l.4.4a.4.4 0 0 1 0 .6l-1.3 1.3a.2.2 0 0 1-.3 0l-.5-.5a6.1 6.1 0 0 0-8.4 0l-.6.6a.2.2 0 0 1-.3 0L5.6 9.7a.4.4 0 0 1 0-.6zm14.6 2.7 1.2 1.1a.4.4 0 0 1 0 .6l-5.3 5.2a.4.4 0 0 1-.6 0l-3.8-3.7a.1.1 0 0 0-.2 0l-3.8 3.7a.4.4 0 0 1-.6 0L2.1 13a.4.4 0 0 1 0-.6l1.2-1.1a.4.4 0 0 1 .6 0l3.8 3.7a.1.1 0 0 0 .2 0l3.8-3.7a.4.4 0 0 1 .6 0l3.8 3.7a.1.1 0 0 0 .2 0l3.8-3.7a.4.4 0 0 1 .6 0z" fill="#3b99fc"/></svg>`;
const SIGNING = new Set(["freeze", "create", "deposit", "withdraw", "send", "trust", "rules", "rule", "cancel-w", "run", "cancel-c", "apply", "release", "approve"]);

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

const money = (n) => n.toLocaleString(LOCALE, { style: "currency", currency: "USD" });
/** What an amount is worth: USDC at $1, the network's coin at the mainnet price (null while it loads). */
const usdOf = (amount, a = A()) => (a.stable ? amount / a.base : S.price ? (amount / a.base) * S.price.usd : null);
const usd = (amount, a = A()) => { const v = usdOf(amount, a); return v == null ? null : money(v); };

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
  snow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.5 4l2.5 2 2.5-2M9.5 20l2.5-2 2.5 2M3.2 10.6l3.1-.6-.9-3M20.8 13.4l-3.1.6.9 3M3.2 13.4l3.1.6-.9 3M20.8 10.6l-3.1-.6.9-3"/></svg>`,
  mail: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M4 7l8 6 8-6"/></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  ext: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>`,
};
// Simple marks for each network and for USDC, drawn here (no third-party logos).
const COINS = {
  sol: `<svg viewBox="0 0 32 32"><path d="M10 10.5h13.5l-2.5 2.6H7.5zM10 15.2h13.5L21 17.8H7.5zM10 20h13.5L21 22.6H7.5z" fill="#fff"/></svg>`,
  eth: `<svg viewBox="0 0 32 32"><path d="M16 4l7 11.6-7 4.2-7-4.2z" fill="#fff" opacity=".95"/><path d="M16 21.2l7-4.2-7 10-7-10z" fill="#fff" opacity=".7"/></svg>`,
  base: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="8.5" fill="#fff"/><path d="M7.6 15h12" stroke="#1d4ed8" stroke-width="2.6"/></svg>`,
  arb: `<svg viewBox="0 0 32 32"><path d="M16 6.5l8.2 4.75v9.5L16 25.5l-8.2-4.75v-9.5z" fill="none" stroke="#fff" stroke-width="2"/><path d="M13.2 20.5l4.2-9.5 4 9.5" fill="none" stroke="#fff" stroke-width="2"/></svg>`,
  op: `<svg viewBox="0 0 32 32"><text x="16" y="20.5" text-anchor="middle" font-family="Arial,sans-serif" font-weight="800" font-size="11.5" fill="#fff">OP</text></svg>`,
  pol: `<svg viewBox="0 0 32 32"><path d="M10 12.5l4-2.3 4 2.3v4.6l-4 2.3-4-2.3zM14 17.1v4.6l4 2.3 4-2.3v-4.6l-4-2.3" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/></svg>`,
  usdc: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="9.5" fill="none" stroke="#fff" stroke-width="1.8"/><text x="16" y="20.3" text-anchor="middle" font-family="Arial,sans-serif" font-weight="800" font-size="12" fill="#fff">$</text></svg>`,
};
const coin = (k) => `<span class="coin ${k}" aria-hidden="true">${COINS[k] || COINS.eth}</span>`;
/** The mark for an asset on the current network. */
const assetCoin = (id = S.asset) => coin(id === "native" ? S.net : id);

// ------------------------------------------------------------------ chart

/** Portfolio value over time: today's holdings priced along the chosen range. */
function chartHTML(units, stableUsd = 0) {
  const pts = S.price?.series?.[S.range];
  const tabs = `<div class="ranges" role="group" aria-label="Range">${RANGES.map(([d, l]) => `<button data-act="range" data-d="${d}" aria-pressed="${S.range === d}">${l}</button>`).join("")}</div>`;
  if (!pts?.length) return `<div class="chart-card"><div class="chart-top"><span class="label">Portfolio value</span>${tabs}</div><div class="chart-wait">${S.price ? "Loading the chart…" : "Prices unavailable right now."}</div></div>`;
  const vals = pts.map(([, v]) => v * (units / LAMPORTS) + stableUsd), W = 1000, H = 260, pad = 12;
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
  tip.querySelector("span").textContent = new Date(S.chart.pts[i][0]).toLocaleString(LOCALE, S.range === "1" ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", year: S.range === "365" ? "numeric" : undefined });
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
/** A big figure with its cents dimmed: "$4,366" bright, ".73" quiet (works for "4 366,73 $" too). */
const fig = (str) => esc(str).replace(/([.,]\d+)(\D*)$/, '<span class="dec">$1</span>$2');

function countUp() {
  const el = document.querySelector("[data-count]");
  if (!el) return;
  const to = Number(el.dataset.count), from = S.shown ?? to;
  S.shown = to;
  if (from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const t0 = performance.now(), fmt = el.dataset.fmt === "usd" ? money : (n) => sol(n * LAMPORTS, A("native"));
  const step = (t) => { const k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - k, 3); el.innerHTML = fig(fmt(from + (to - from) * e)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/** A round mark made from the address, so each wallet is recognisable at a glance. */
function avatar(addr) {
  let h = 0; for (const c of String(addr)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360, b = (a + 70 + (h >> 9) % 80) % 360;
  return `<span class="ava" style="background:conic-gradient(from ${h % 360}deg, hsl(${a} 80% 60%), hsl(${b} 85% 55%), hsl(${a} 80% 60%))" aria-hidden="true"></span>`;
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
  return `<button class="netbtn" data-act="netmenu" aria-label="Network: ${C.name} ${C.net}. Change network" aria-haspopup="dialog">${coin(S.net)}<span>${C.name}</span><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg></button>`;
}

/** Account menu: the address, and the settings that used to crowd the top bar. */
function accountMenu() {
  const w = S.wallet.toBase58(), dark = document.documentElement.dataset.theme === "dark";
  const row = (act, icon, title, value = "", cls = "") => `<button type="button" class="am-row${cls}" data-act="${act}"><span class="am-ico">${icon}</span><span class="am-t">${title}</span><span class="am-v">${value}</span></button>`;
  sheet(`<div class="am-head">${avatar(w)}<div><b>${short(w)}</b><span>${C.name} ${C.net}${S.readOnly ? " · view mode" : ""}</span></div><button type="button" class="btn sm" data-act="copy" data-v="${esc(w)}">Copy</button></div>
    <div class="am-list">
      ${row("privacy", S.hide ? I.eyeOff : I.eye, "Hide balances", S.hide ? "On" : "Off")}
      ${row("lang", `<b class="am-lang">${LANG === "fr" ? "FR" : "EN"}</b>`, "Language", LANG === "fr" ? "Français" : "English")}
      ${row("theme", dark ? I.moon : I.sun, "Appearance", dark ? "Dark" : "Light")}
      <a class="am-row" href="${explorer("address", w)}" target="_blank" rel="noopener"><span class="am-ico">${I.ext}</span><span class="am-t">View wallet on the explorer</span><span class="am-v"></span></a>
      ${isPhone() && !standalone() ? row("install", logo, "Add to home screen") : ""}
      ${row("disconnect", I.power, S.readOnly ? "Exit view mode" : "Disconnect", "", " danger")}
    </div>`, () => true);
  $("#sheet-form").querySelector('button[value="ok"]').hidden = true;
}

/** Network picker: Solana, then the Ethereum-style networks, each saying what it holds or that it's coming. */
function netMenu() {
  const row = (k) => {
    const n = NETS[k], live = !!n.x, on = S.net === k;
    return `<button type="button" class="net-row${on ? " on" : ""}" data-act="net" data-n="${k}" ${live || on ? "" : "disabled"}>${coin(k)}<span class="nr-t"><b>${n.name}</b><span>${n.net} testnet</span></span>
      <span class="nr-r">${live ? `<span class="nr-a">${n.unit}${n.usdc ? " · USDC" : ""}</span>` : `<span class="nr-soon">Coming soon</span>`}${on ? `<i class="nr-on">${I.check}</i>` : ""}</span></button>`;
  };
  sheet(`<h3>Network</h3><p class="note">Each network has its own vault with the same rules. Test coins only.</p>
    <div class="net-list">${row("sol")}<span class="label nl-h">Ethereum and its networks</span>${Object.keys(EVM_NETS).map(row).join("")}</div>`, () => true);
  $("#sheet-form").querySelector('button[value="ok"]').hidden = true;
}

function shell(content, { nav = true } = {}) {
  const w = S.wallet, pending = allWithdrawals(S.vault).length, on = nav && w;
  const items = (cls) => TABS.map(([k, label, icon]) => `<button class="${cls}" data-act="tab" data-t="${k}" aria-current="${S.tab === k ? "page" : "false"}">${icon}<span>${label}</span>${k === "vault" && pending ? `<i class="badge">${pending}</i>` : ""}</button>`).join("");
  return `<div class="shell${S.hide ? " private" : ""}">
    <header class="topbar">
      <a class="brand" href="/">${logo}<span>Ecrin</span></a>
      ${on ? `<nav class="pillnav" aria-label="Sections"><i class="pill-ind" aria-hidden="true"></i>${items("pill-i")}</nav>` : ""}
      <div class="tb-right">
        ${netSwitch()}
        ${w ? `<span class="tb-desk">${privacyBtn()}</span><button class="acct-chip" data-act="account" aria-haspopup="dialog" title="${esc(w.toBase58())}">${avatar(w.toBase58())}<span>${short(w)}</span></button>`
          : `<button class="theme lang-btn" data-act="lang" aria-label="${LANG === "fr" ? "Read in English" : "Lire en français"}" lang="${LANG === "fr" ? "en" : "fr"}">${LANG === "fr" ? "EN" : "FR"}</button>${themeBtn()}`}
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
      ${wcOn() ? `<button class="btn lg wc-btn" data-act="wc">${WC_ICON}<span>WalletConnect</span></button>` : ""}
      <div class="wallets">${list.length ? list.map(([n], i) => `<button class="btn primary lg" data-act="connect" data-i="${i}">Connect ${esc(n)}</button>`).join("")
        : isPhone() ? walletLinks().map(([n, href], i) => `<a class="btn ${i ? "" : "primary "}lg" href="${esc(href)}">Open in ${n}</a>`).join("")
        : `<a class="btn primary lg" href="${C.getWallet[1]}" target="_blank" rel="noopener">${C.getWallet[0]}</a>`}</div>
      ${!list.length && isPhone() ? `<p class="hint">Phone browsers can't reach wallet apps directly, so Ecrin opens inside your wallet's own browser. Don't have it yet? <a href="${C.getWallet[1]}" target="_blank" rel="noopener">${C.getWallet[0]}</a>.</p>
        <div class="viewmode"><span class="label">Or just watch your vault</span><div class="lookup"><input id="view-addr" class="input" placeholder="Your ${C.name} wallet address" spellcheck="false" autocomplete="off"/><button class="btn" data-act="view-start">View</button></div><p class="hint">View mode shows your vault, countdowns and alerts. Signing opens your wallet app.</p></div>` : ""}
      <ol class="steps"><li><b>1</b><span><span>${C.setup}</span></span></li><li><b>2</b><span><span>Get free test ${C.unit} at <a href="${C.faucet}" target="_blank" rel="noopener">${C.faucetName}</a>.</span></span></li><li><b>3</b><span><span>Create your vault and try a withdrawal. Watch the clock, then cancel it.</span></span></li></ol>
    </section>`, { nav: false });
    return;
  }
  if (S.tab === "guardian") { app.innerHTML = shell(guardianView()); return; }
  if (S.vault === undefined) { app.innerHTML = shell(`<div class="skel" aria-label="Reading your vault from ${C.name} ${C.net}…"><i class="sk sk-l"></i><i class="sk sk-xl"></i><i class="sk sk-m"></i><div class="sk-row"><i class="sk sk-case"></i><i class="sk sk-card"></i></div></div>`); return; }
  if (S.vault === null) { app.innerHTML = shell(createView(), { nav: false }); return; }
  const v = S.vault;
  app.innerHTML = shell((S.tab === "portfolio" ? installCard() : "") + (S.readOnly ? `<div class="viewbar">${I.eye}<span><b>View mode</b> · signing opens your wallet app</span><button class="link" data-act="disconnect">Exit</button></div>` : "") + (S.tab === "vault" ? vaultView(v) : S.tab === "activity" ? activityView() : portfolioView(v)));
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
    ${S.walletSol < C.lowBal * LAMPORTS ? `<div class="notice">Your wallet has ${sol(S.walletSol, A("native"))} ${C.unit} on ${C.net}. Get free test ${C.unit} at <a href="${C.faucet}" target="_blank" rel="noopener">${C.faucetName}</a> for <b>${short(S.wallet)}</b>, then come back.</div>` : ""}
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
    <button data-act="freeze" class="qa-freeze" title="Stop everything from leaving, now"><span>${I.snow}</span>Freeze</button>
  </div>`;
}

// Engraved wave pattern for the vault case, drawn once: offset circles like a watch dial's guilloché.
const GUILLOCHE = `<svg class="guilloche" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${Array.from({ length: 34 }, (_, i) => `<circle cx="${330 + Math.cos(i / 2.2) * 14}" cy="${40 + Math.sin(i / 2.2) * 14}" r="${18 + i * 9}"/>`).join("")}</svg>`;

/** The vault as an object: an obsidian case with the protected balance and its state. With `total`, it shows
 *  everything protected (every coin, in dollars when prices are in) and the soonest withdrawal of any coin. */
function caseCard(v, { link = true, total = false } = {}) {
  const t = now(), locked = v.lockedUntil && t < v.lockedUntil, a = A(v.asset || "native");
  const queue = total ? allWithdrawals(S.vault) : v.withdrawals.map((w) => ({ ...w, asset: a.id }));
  const next = queue.slice().sort((x, y) => x.readyAt - y.readyAt)[0];
  const opens = next ? Math.max(next.readyAt, locked ? v.lockedUntil : 0) : 0;
  const state = next
    ? `<span class="cs-dot warn"></span><span><b>${sol(next.amount, A(next.asset))} ${A(next.asset).unit}</b> leaving${opens > t ? ` in <span class="count" data-ready="${opens}">${dur(opens - t)}</span>` : " · ready"}</span>`
    : `<span class="cs-dot"></span><span>${locked ? "Locked until " + new Date(v.lockedUntil * 1000).toLocaleDateString(LOCALE, { day: "numeric", month: "short" }) : "Sealed · nothing waiting to leave"}</span>`;
  let bal;
  if (total) {
    const p = protectedTotals(v);
    bal = p.usd != null && p.stable ? `<div class="case-bal"><span class="num m">${money(p.usd)}</span></div><span class="case-usd m">${p.parts}</span>`
      : `<div class="case-bal"><span class="num m">${sol(v.balance, A("native"))}</span><small>${C.unit}</small></div><span class="case-usd m">${p.stable ? p.parts : usd(v.balance, A("native")) ?? ""}</span>`;
  } else bal = `<div class="case-bal"><span class="num m">${sol(v.balance, a)}</span><small>${a.unit}</small></div><span class="case-usd m">${a.stable ? "" : usd(v.balance, a) ?? ""}</span>`;
  return `<${link ? `button data-act="tab" data-t="vault"` : "div"} class="case${next ? " leaving" : ""}" data-tilt>
    ${GUILLOCHE}<i class="sheen"></i>
    <div class="case-top"><span class="case-mark">${logo}<b>ECRIN</b></span><span class="case-lvl">${levelName(v)} · ${delayWords(v.withdrawDelay)}</span></div>
    <div class="case-mid"><span class="case-k">${I.shield}Protected</span>${bal}</div>
    <div class="case-foot">${state}<span class="case-id">${total ? coin(S.net) : assetCoin(a.id)}•••• ${String(v.owner).slice(-4)}</span></div>
  </${link ? "button" : "div"}>`;
}

/** What the vault protects across its coins: dollars (when prices are in) and a short "1.2 SOL · 300 USDC" line. */
function protectedTotals(v) {
  const list = assets().map((a) => [a, a.id === "native" ? v.balance : v.tokens?.[a.id]?.balance || 0]);
  const vals = list.map(([a, n]) => usdOf(n, a));
  const stable = list.some(([a, n]) => a.stable && n > 0);
  return { stable, usd: vals.some((x) => x == null) ? null : vals.reduce((x, y) => x + y, 0), parts: list.filter(([a, n]) => n > 0 || a.id === "native").map(([a, n]) => `${sol(n, a)} ${a.unit}`).join(" · ") };
}

/** Every coin: what's protected, what's in the wallet (as a split bar), its value, and anything leaving. */
function assetsCard(v) {
  return `<section class="glass assets"><div class="sec-h"><h2>Assets</h2><span class="muted">same rules for every coin</span></div>
    ${assets().map((a) => {
      const inV = a.id === "native" ? v.balance : v.tokens?.[a.id]?.balance || 0, inW = a.id === "native" ? S.walletSol || 0 : S.walletTok[a.id] || 0;
      const leaving = allWithdrawals(v).filter((w) => w.asset === a.id).length, value = usd(inV + inW, a), pct = inV + inW ? Math.round((inV / (inV + inW)) * 100) : 0;
      return `<button class="as-row" data-act="open-asset" data-a="${a.id}">${assetCoin(a.id)}
        <span class="as-t"><b>${a.unit}</b><span class="as-split"><i class="as-bar"><i style="width:${pct}%"></i></i><span><span class="m">${sol(inV, a)}</span> protected · <span class="m">${sol(inW, a)}</span> in wallet</span></span></span>
        <span class="as-r">${value ? `<b class="m">${value}</b>` : `<b class="m">${sol(inV + inW, a)}</b>`}${leaving ? `<span class="as-leave">${I.clock}${leaving} leaving</span>` : `<span class="as-amt m">${sol(inV + inW, a)} ${a.unit}</span>`}</span>${I.arrow}</button>`;
    }).join("")}</section>`;
}

/** How well this vault is set up: five checks, each with the one tap that fixes it. */
function protectionCard(v) {
  const pushed = (() => { try { return Object.keys(localStorage).some((k) => (k.startsWith("ecrin-alerts-") || k.startsWith("ecrin-push-")) && k.endsWith(S.wallet.toBase58()) && localStorage.getItem(k) === "1") || !!localStorage.getItem(alertsKey() + "-mail"); } catch (_) { return false; } })();
  const checks = [
    [v.withdrawDelay >= 72 * HOUR, "Withdrawals wait at least 3 days", "Make withdrawals wait longer", `data-act="rule" data-k="withdraw"`],
    [!!v.guardian, "A guardian for emergencies", "Add a guardian", `data-act="rule" data-k="guardian"`],
    [pushed || alertsOn(), "Alerts are on", "Turn on alerts", `data-act="goto-alerts"`],
    [v.trusted.length > 0, "A trusted address for instant payments", "Add a trusted address", `data-act="trust"`],
    [!!v.dailyLimit, "A daily limit", "Set a daily limit", `data-act="rule" data-k="limit"`],
  ];
  const n = checks.filter(([ok]) => ok).length, r = 34, c = 2 * Math.PI * r;
  return `<section class="glass prot">
    <div class="prot-h"><div class="prot-ring"><svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="${r}" class="track"/><circle cx="40" cy="40" r="${r}" class="arc" stroke-dasharray="${(n / 5) * c} ${c}" transform="rotate(-90 40 40)"/></svg><b class="num">${n}<small>/5</small></b></div>
      <div><h2>Your protection</h2><span class="muted">${n === 5 ? "Fully set up. Nicely done." : n >= 3 ? "Good. A few taps make it stronger." : "Just getting started."}</span></div></div>
    <ul class="prot-list">${checks.map(([ok, done, todo, act]) => ok
      ? `<li class="ok"><i>${I.check}</i><span>${done}</span></li>`
      : `<li><button class="prot-do" ${act}><i></i><span>${todo}</span>${I.arrow}</button></li>`).join("")}</ul>
  </section>`;
}

/** SOL | USDC switch for the vault tab, with a dot on any coin that has something waiting to leave. */
function assetSwitch(v) {
  if (assets().length < 2) return "";
  return `<div class="asw" role="group" aria-label="Coin">${assets().map((a) => {
    const leaving = allWithdrawals(v).some((w) => w.asset === a.id);
    return `<button type="button" data-act="asset" data-a="${a.id}" aria-pressed="${S.asset === a.id}">${assetCoin(a.id)}<span>${a.unit}</span>${leaving ? `<i class="asw-dot" title="Something is waiting to leave"></i>` : ""}</button>`;
  }).join("")}</div>`;
}

function portfolioView(v) {
  const na = A("native"), list = assets();
  const coinTotal = v.balance + (S.walletSol || 0);
  const stableTotal = list.filter((a) => a.stable).reduce((sum, a) => sum + (v.tokens?.[a.id]?.balance || 0) + (S.walletTok[a.id] || 0), 0);
  const stableUsd = stableTotal / USDC.base, protUsd = protectedTotals(v).usd;
  const totalUsd = S.price ? (coinTotal / LAMPORTS) * S.price.usd + stableUsd : null;
  const pct = totalUsd ? Math.round((protUsd / totalUsd) * 100) : coinTotal ? Math.round((v.balance / coinTotal) * 100) : 0, ch = S.price?.change;
  const recent = readLog().slice(0, 4);
  return `
    ${frozenBanner(v)}
    <section class="pf-hero">
      <div class="pf-total">
        <span class="label">Total balance</span>
        <div class="pf-big num m" data-count="${totalUsd ?? coinTotal / LAMPORTS}" data-fmt="${totalUsd != null ? "usd" : "coin"}">${fig(totalUsd != null ? money(totalUsd) : sol(coinTotal, na))}</div>
        <div class="pf-sub">${ch != null ? `<span class="chg ${ch >= 0 ? "pos" : "neg"}">${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(2)}%</span>` : ""}<span class="m">${sol(coinTotal, na)} ${C.unit}${stableTotal ? ` · ${sol(stableTotal, USDC)} USDC` : ""}</span></div>
        <div class="pf-split" title="${pct}% protected">
          <div class="pf-bar"><i style="width:${pct}%"></i></div>
          <div class="pf-legend"><span><i class="lg v"></i><b>${pct}%</b> in your vault</span><span><i class="lg w"></i>${100 - pct}% in your wallet</span></div>
        </div>
        ${actionsRow()}
      </div>
      <div class="pf-case">${caseCard(v, { total: true })}</div>
    </section>
    <div class="pf-grid">
      ${chartHTML(coinTotal, stableUsd)}
      ${protectionCard(v)}
    </div>
    ${assetsCard(v)}
    <section class="glass">
      <div class="sec-h"><h2>Recent</h2>${recent.length ? `<button class="btn sm" data-act="tab" data-t="activity">See all</button>` : ""}</div>
      ${recent.length ? feedHTML(recent) : `<div class="empty">Nothing yet. Deposits, withdrawals and rule changes show up here.</div>`}
    </section>`;
}

/** While a lock holds, say so plainly at the top. */
function frozenBanner(v) {
  if (!(v.lockedUntil && now() < v.lockedUntil)) return "";
  return `<div class="frozen">${I.snow}<span><b>Frozen until ${dateShort(v.lockedUntil)}.</b> Nothing can leave before then, withdrawals already waiting included. You can still cancel anything.</span></div>`;
}

function vaultView(full) {
  const v = assetView(full), a = A(), queued = v.balance - v.available;
  const changes = rowsChanges(v, false);
  const elsewhere = allWithdrawals(full).filter((w) => w.asset !== a.id);
  return `
    ${frozenBanner(full)}
    <div class="v-top">${assetSwitch(full)}</div>
    ${elsewhere.length ? `<button class="notice warn-n" data-act="asset" data-a="${elsewhere[0].asset}">${I.clock}<span>${elsewhere.length === 1 ? `${sol(elsewhere[0].amount, A(elsewhere[0].asset))} ${A(elsewhere[0].asset).unit} is waiting to leave` : `${elsewhere.length} withdrawals in other coins are waiting to leave`}. <u>Show</u></span></button>` : ""}
    <section class="v-hero">
      ${caseCard(v, { link: false })}
      <div class="v-side">
        ${actionsRow()}
        <div class="v-stats">
          <div><span class="label">Available</span><b class="num m">${fig(sol(v.available, a))}</b><small>${a.unit}</small></div>
          <div><span class="label">Leaving</span><b class="num m">${fig(sol(queued, a))}</b><small>${a.unit}</small></div>
          <div><span class="label">Daily limit</span><b class="num">${v.dailyLimit ? fig(sol(v.dailyLimit, a)) : "None"}</b><small>${v.dailyLimit ? a.unit : ""}</small></div>
        </div>
        <div class="chips">${v.guardian ? `<span class="chip">${I.people}Guardian ${label(v.guardian)}</span>` : `<button class="chip" data-act="rule" data-k="guardian">${I.people}No guardian · add one</button>`}<a class="chip" href="${explorer("address", (a.id === "native" ? v.address : full.tokens?.[a.id]?.holds || v.address).toBase58())}" target="_blank" rel="noopener">${I.ext}View on-chain</a></div>
      </div>
    </section>
    <div class="cols">
      <div class="col">
        <section class="glass"><div class="sec-h"><h2>Waiting to leave</h2><span class="muted">cancel any time</span></div><div class="rows">${rowsWithdrawals(v, false)}</div></section>
        ${changes ? `<section class="glass"><div class="sec-h"><h2>Rule changes waiting</h2><span class="muted">looser rules wait ${delayWords(v.ruleDelay)}</span></div><div class="rows">${changes}</div></section>` : ""}
        ${trustedCard(v)}
      </div>
      <div class="col">
        ${policyCard(v)}
        ${alertsCard()}
      </div>
    </div>`;
}

function trustedCard(v) {
  return `<section class="glass"><div class="sec-h"><h2>Trusted addresses</h2><button class="btn sm" data-act="trust">Add</button></div>
    ${v.trusted.length ? `<div class="tr-list">${v.trusted.map((k) => `<div class="tr-row">${avatar(k.toBase58())}<span class="tr-t"><b>${esc(nameOf(k) || "Unnamed")}</b><span class="m">${short(k)}</span></span><button class="link" data-act="name" data-a="${k.toBase58()}">${nameOf(k) ? "Rename" : "Name it"}</button><a class="tr-ext" href="${explorer("address", k.toBase58())}" target="_blank" rel="noopener" aria-label="View on the explorer">${I.ext}</a></div>`).join("")}</div>`
      : `<div class="empty">None yet. Money sent to a trusted address arrives instantly, so adding one takes time. Trusted addresses apply to every coin.</div>`}</section>`;
}

// ------------------------------------------------------------------ protection policy

const dateShort = (t) => new Date(t * 1000).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });
const RULES = {
  withdraw: { kind: "SetWithdrawDelay", title: "Withdrawal delay", help: "Every withdrawal to an address that isn't trusted waits this long. You can cancel it at any moment.", icon: "clock",
    value: (v) => delayWords(v.withdrawDelay), opts: () => [[HOUR, "1 hour"], [24 * HOUR, "24 hours"], [72 * HOUR, "72 hours"], [7 * DAY, "7 days"], [30 * DAY, "30 days"]], cur: (v) => v.withdrawDelay },
  rule: { kind: "SetRuleDelay", title: "Rule-change delay", help: "Loosening any rule, adding a trusted address or changing the guardian waits this long. Tightening is instant.", icon: "sliders",
    value: (v) => delayWords(v.ruleDelay), opts: () => [[3 * DAY, "3 days"], [7 * DAY, "7 days"], [14 * DAY, "14 days"], [30 * DAY, "30 days"]], cur: (v) => v.ruleDelay },
  limit: { kind: "SetDailyLimit", title: "Daily limit", help: "The most that can leave in one day, sends to trusted addresses included. Each coin has its own.", icon: "up",
    value: (v) => (v.dailyLimit ? `${sol(v.dailyLimit)} ${A().unit}` : "No limit"),
    opts: () => [[null, "No limit"], ...(A().stable ? [50, 250, 1000, 5000] : [0.1, 1, 5, 25]).map((n) => [n * A().base, `${n.toLocaleString(LOCALE)} ${A().unit}`])], cur: (v) => v.dailyLimit },
  lock: { kind: "SetLockedUntil", title: "Time lock", help: "Nothing leaves before this date, except an emergency your guardian co-signs. Ending a lock early can't happen before it ends anyway.", icon: "lock",
    value: (v) => (v.lockedUntil && now() < v.lockedUntil ? `Until ${dateShort(v.lockedUntil)}` : "None"), opts: (v) => [...(v.lockedUntil && now() < v.lockedUntil ? [[null, "End the lock"]] : []), ["d30", "30 days"], ["d90", "90 days"], ["d180", "6 months"], ["d365", "1 year"]], cur: (v) => v.lockedUntil },
  guardian: { kind: "SetGuardian", title: "Guardian", help: "Someone you trust who can approve an emergency release or a new trusted address early. A guardian can never start a withdrawal or choose where money goes.", icon: "people",
    value: (v) => (v.guardian ? short(v.guardian) : "None"), cur: (v) => v.guardian },
};

function pendingFor(v, kind) { return v.changes.filter((c) => c.change.kind === kind); }

function policyCard(v) {
  const rows = Object.entries(RULES).map(([k, r]) => {
    const waiting = pendingFor(v, r.kind);
    const name = k === "limit" && assets().length > 1 ? `${r.title} · ${A().unit}` : r.title;
    return `<button class="pol-row" data-act="rule" data-k="${k}">
      <span class="pol-ico">${I[r.icon]}</span>
      <span class="pol-txt"><span class="pol-name">${name}</span>${waiting.map((c) => `<span class="pol-wait">${I.clock}${esc(changeWords(c.change, c.asset))} · <span class="count" data-ready="${c.readyAt}">${dur(c.readyAt - now())}</span></span>`).join("")}</span>
      <span class="pol-val${k === "guardian" && v.guardian ? " addr-v" : ""}">${esc(r.value(v))}</span>${I.arrow}
    </button>`;
  }).join("");
  return `<section class="glass policy"><div class="sec-h"><div><h2>Protection policy</h2><span class="pol-sub">${levelName(v)} · tightening is instant, loosening waits ${delayWords(v.ruleDelay)}</span></div></div>${rows}</section>`;
}

/** One rule's panel: options as cards, each saying whether it applies now or waits. */
function openRule(key) {
  const v = assetView(S.vault), r = RULES[key];
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
  sheet(`<div class="rule-h"><span class="pol-ico">${I[r.icon]}</span><div><h3>${r.title}${key === "limit" && assets().length > 1 ? ` · ${A().unit}` : ""}</h3><span class="muted small">Now: <b>${esc(r.value(v))}</b></span></div></div><p class="note">${r.help}</p>${body}`, async (fd) => {
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
    return send(`Changed a rule: ${changeWords(change, v.asset)}`, () => assetOps().proposeChange(change));
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

// Panic freeze: a time lock from now. Locking is a stricter rule, so it applies at once; while it holds nothing
// leaves (withdrawals already waiting and trusted sends included), cancelling still works, and the guardian can
// still release an emergency. It can't be ended early.
function freezeSheet() {
  const v = S.vault, cur = v.lockedUntil && now() < v.lockedUntil ? v.lockedUntil : 0;
  const waiting = allWithdrawals(v).length;
  const opts = [[1, "24 hours"], [7, "7 days"], [30, "30 days"], [90, "90 days"]].map(([d, label]) => {
    const until = now() + d * DAY + 120, ok = until > cur;
    return `<label class="opt${ok ? "" : " is-cur"}"><input type="radio" name="d" value="${d}" ${ok ? "" : "disabled"} ${d === 7 && ok ? "checked" : ""}/><span class="o-l">${label}</span><span class="o-b ${ok ? "now" : "cur"}">${ok ? "Until " + dateShort(until) : "Already locked longer"}</span></label>`;
  }).join("");
  sheet(`<div class="rule-h"><span class="pol-ico freeze-ico">${I.snow}</span><div><h3>Freeze your vault</h3><span class="muted small">${cur ? `Locked until ${dateShort(cur)} already` : "Applies the moment you confirm"}</span></div></div>
    <p class="note">For when something feels wrong: a withdrawal you didn't make, a signature you regret, a stolen phone. Until the date you pick, <b>nothing leaves</b>${waiting ? `, including the ${waiting} withdrawal${waiting === 1 ? "" : "s"} already waiting` : ""}, and sends to trusted addresses stop too.</p>
    <div class="opts">${opts}</div>
    <p class="note">You can still cancel anything, and your guardian can still release a real emergency. A freeze can't be ended early, so pick the shortest time that gives you room to think.</p>`, (fd) => {
    const d = Number(fd.get("d"));
    if (!d) { toast("Pick how long", "err"); return false; }
    const until = now() + d * DAY + 120;
    return send(`Froze the vault until ${dateShort(until)}`, () => C.x.ops.proposeChange({ kind: "SetLockedUntil", value: until }));
  });
  const ok = $("#sheet-form").querySelector('button[value="ok"]');
  ok.textContent = "Freeze now"; ok.classList.add("danger-btn");
  if (!$("#sheet-form").querySelector('input[name="d"]:not([disabled])')) ok.disabled = true;
}

function openRuleMenu() {
  const v = assetView(S.vault);
  sheet(`<h3>Adjust your protection</h3><p class="note">Pick a rule. Tightening applies at once; loosening waits ${delayWords(v.ruleDelay)}.</p>
    <div class="rule-menu">${Object.entries(RULES).map(([k, r]) => `<button type="button" class="rm-row" data-act="rule" data-k="${k}"><span class="pol-ico">${I[r.icon]}</span><span class="rm-t"><b>${r.title}</b><span>${esc(r.value(v))}</span></span>${I.arrow}</button>`).join("")}</div>`, () => true);
  $("#sheet-form").querySelector('button[value="ok"]').hidden = true;
}

// ------------------------------------------------------------------ alerts

const alertsKey = () => `ecrin-alerts-${S.net}-${S.wallet ? S.wallet.toBase58() : ""}`;
const alertsOn = () => { try { return localStorage.getItem(alertsKey()) === "1"; } catch (_) { return false; } };

function alertsCard() {
  const tg = alertsOn(), waiting = S.alertCode;
  let mailed = null; try { mailed = localStorage.getItem(alertsKey() + "-mail"); } catch (_) {}
  const canPush = pushPossible() && !(S.readOnly && !standalone()), pushed = pushOn();
  const tile = (icon, name, state, on, btn) => `<div class="al-tile${on ? " on" : ""}"><span class="al-ti">${icon}</span><span class="al-tt"><b>${name}</b><span>${state}</span></span>${btn}</div>`;
  return `<section class="glass alerts" id="alerts">
    <div class="sec-h"><div><h2>Alerts</h2><span class="pol-sub">A delay only protects you if you notice.</span></div>${tg || mailed || pushed ? `<span class="pill-on"><i class="live"></i>On</span>` : ""}</div>
    <div class="al-tiles">
      ${tile(TG_ICON, "Telegram", tg ? "Messages within a minute" : waiting ? "Press Start in Telegram…" : "Off", tg, `<button class="btn sm${tg ? "" : " primary"}" data-act="alerts" ${waiting ? "disabled" : ""}>${tg ? "Add chat" : waiting ? "Waiting…" : "Turn on"}</button>`)}
      ${tile(I.mail, "Email", mailed ? `Sent to ${esc(mailed)}` : "Off", !!mailed, `<button class="btn sm" data-act="mail">${mailed ? "Change" : "Turn on"}</button>`)}
      ${canPush ? tile(I.bell, "This device", pushed ? "Notifications on" : "Off", pushed, pushed ? `<button class="btn sm" data-act="push-off">Turn off</button>` : `<button class="btn sm" data-act="push" ${S.pushBusy ? "disabled" : ""}>${S.pushBusy ? "…" : "Turn on"}</button>`)
        : isIOS() && !standalone() ? tile(I.bell, "This device", "Add Ecrin to your home screen first", false, `<button class="btn sm" data-act="install">How</button>`) : ""}
    </div>
  </section>`;
}
const TG_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 4.5L3 11.4l5.6 2 2.1 6.6 3.2-3.9 5 3.6z"/><path d="M8.6 13.4l9.6-6.6-7.5 8.3"/></svg>`;

async function startAlerts() {
  const body = { net: S.net, owner: S.wallet.toBase58(), vault: S.net === "sol" ? S.vault.address.toBase58() : undefined, lang: LANG };
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

// Notifications on this device (Web Push). Phones need the home-screen app on iPhone; Android and computers work in the browser.
const pushKey = () => `ecrin-push-${S.net}-${S.wallet ? S.wallet.toBase58() : ""}`;
const pushOn = () => { try { return localStorage.getItem(pushKey()) === "1"; } catch (_) { return false; } };
const pushPossible = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function startPush() {
  S.pushBusy = true; render();
  try {
    if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked for this site. Allow them in your browser settings, then try again.");
    const reg = await navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready);
    const { key } = await fetch("/api/push/key").then((r) => r.json());
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) }));
    const body = { net: S.net, owner: S.wallet.toBase58(), vault: S.net === "sol" ? S.vault.address.toBase58() : undefined, lang: LANG, sub: sub.toJSON() };
    const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Notifications aren't available right now.");
    try { localStorage.setItem(pushKey(), "1"); } catch (_) {}
    toast("Notifications are on for this device.", "win");
  } catch (e) { toast(esc(e.message), "err"); }
  S.pushBusy = false; render();
}
async function stopPush() {
  try {
    const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (sub) { await fetch("/api/push/unsubscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {}); }
  } catch (_) {}
  try { localStorage.removeItem(pushKey()); } catch (_) {}
  render();
}

async function startEmail(email) {
  S.mailBusy = true; render();
  try {
    const body = { net: S.net, owner: S.wallet.toBase58(), vault: S.net === "sol" ? S.vault.address.toBase58() : undefined, lang: LANG, email };
    const r = await fetch("/api/alerts/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Email alerts aren't available right now.");
    try { localStorage.setItem(alertsKey() + "-mail", email); } catch (_) {}
    toast(j.already ? "Email alerts are already on for this address." : "Check your inbox to confirm.", "win");
  } catch (e) { toast(esc(e.message), "err"); }
  S.mailBusy = false; render();
}
document.addEventListener("submit", (e) => {
  if (!e.target.matches?.("[data-mailform]")) return;
  e.preventDefault();
  startEmail(String(new FormData(e.target).get("email") || "").trim());
});

function feedHTML(log) {
  const kind = (t) => /^Cancelled/.test(t) ? ["win", I.shield] : /^Deposited/.test(t) ? ["in", I.down] : /withdraw|Sent/i.test(t) ? ["out", I.up] : /rule|trust/i.test(t) ? ["rule", I.sliders] : ["other", I.clock];
  return `<ul class="feed">${log.map((l) => { const [k, ic] = kind(l.text); return `<li class="${k}"><span class="f-ico">${ic}</span><span class="f-txt"><b>${esc(l.text)}</b><time>${new Date(l.at * 1000).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></span><a href="${explorer("tx", l.sig)}" target="_blank" rel="noopener" aria-label="View on the explorer">${I.ext}</a></li>`; }).join("")}</ul>`;
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
  const t = now(), locked = v.lockedUntil && t < v.lockedUntil, a = A(v.asset || "native");
  return v.withdrawals.map((w) => {
    const left = w.readyAt - t, ready = left <= 0 && !locked, opens = Math.max(w.readyAt, locked ? v.lockedUntil : 0);
    const status = ready ? `<div class="clock-done">Ready. It only leaves if you press send.</div>` : dialHTML(opens, Math.max(v.withdrawDelay, opens - (w.readyAt - v.withdrawDelay)));
    const ids = `data-id="${w.id}" data-asset="${a.id}"`;
    const guard = asGuardian
      ? (S.wallet && v.guardian?.equals(S.wallet) ? `<div class="row-acts"><button class="btn sm good" data-act="release" ${ids} data-dest="${w.dest.toBase58()}" ${S.busy ? "disabled" : ""}>Approve emergency release</button></div>` : "")
      : `<button class="keep" data-act="cancel-w" ${ids} data-amt="${w.amount}" ${S.busy ? "disabled" : ""}>${I.shield}<span>Cancel and keep ${sol(w.amount, a)} ${a.unit} safe</span></button>
        <div class="keep-note">Free, instant, and nobody else is told. <button class="link" data-act="freeze">Not you? Freeze everything</button>${ready ? ` <button class="link danger" data-act="run" ${ids} data-dest="${w.dest.toBase58()}" ${S.busy ? "disabled" : ""}>Send it now</button>` : ""}</div>`;
    return `<div class="row wd${ready ? " is-ready" : ""}">
      <div class="row-top"><b><span class="m">${sol(w.amount, a)}</span> ${a.unit} <span class="muted">leaving</span></b><span class="muted">to <a href="${explorer("address", w.dest.toBase58())}" target="_blank" rel="noopener">${label(w.dest)}</a></span></div>
      ${status}
      <div class="muted small center">${ready ? "Unlocked" : "Unlocks"} ${when(opens)}${locked && left <= 0 ? " · held by your lock" : ""}</div>
      ${guard}</div>`;
  }).join("") || (asGuardian ? `<div class="empty">Nothing ${a.id === "native" ? "" : a.unit + " "}waiting to leave.</div>` : `<div class="sealed"><span class="sealed-ico">${I.shield}</span><b>Sealed</b><span>Nothing ${a.id === "native" ? "" : a.unit + " "}is waiting to leave. Every withdrawal shows up here with a countdown, and you can cancel it until it runs.</span></div>`);
}

function guardianView() {
  const v = S.watched, t = now();
  const g = v && S.wallet && v.guardian?.equals(S.wallet), locked = v && v.lockedUntil && t < v.lockedUntil;
  const views = v ? assets().map((a) => assetView(v, a.id)) : [];
  const changes = v ? rowsChanges(assetView(v, "native"), true) : "";
  const waiting = views.map((x) => (x.withdrawals.length ? rowsWithdrawals(x, true) : "")).join("");
  return `<section class="glass"><div class="sec-h"><h2>Look up a vault you guard</h2></div>
      <div class="lookup"><input id="watch" class="input" placeholder="The vault owner's ${C.name} address" value="${esc(S.watchOwner)}" spellcheck="false" autocomplete="off"/><button class="btn primary" data-act="watch">Look up</button></div>
      <p class="hint">Guardians can approve an emergency release of a withdrawal the owner requested, or a trusted address the owner proposed. Nothing else.</p></section>
    ${!S.watchOwner ? "" : v === undefined ? `<section class="glass"><div class="spinner"></div></section>` : v === null ? `<section class="glass"><div class="empty">No Ecrin vault for that wallet on ${C.name}.</div></section>` : `
      <section class="vhero glass"><div class="vh-shield">${I.people}</div><div class="vh-txt"><span class="label">Vault of ${short(v.owner)}</span><div class="big">${sol(v.balance, A("native"))}</div><span class="unit">${C.unit}${views.slice(1).map((x) => ` · ${sol(x.balance, A(x.asset))} ${A(x.asset).unit}`).join("")}</span>
        <div class="chips"><span class="chip">${I.clock}Withdrawals wait ${delayWords(v.withdrawDelay)}</span>${locked ? `<span class="chip">${I.lock}Locked</span>` : ""}<span class="chip">${g ? "You're the guardian" : "You're not this vault's guardian"}</span></div></div></section>
      <section class="glass"><div class="sec-h"><h2>Waiting to leave</h2></div><div class="rows">${waiting || `<div class="empty">Nothing waiting to leave.</div>`}</div></section>
      ${changes ? `<section class="glass"><div class="sec-h"><h2>Rule changes waiting</h2></div><div class="rows">${changes}</div></section>` : ""}`}`;
}

function changeWords({ kind, value }, aid = "native") {
  switch (kind) {
    case "SetWithdrawDelay": return `Withdrawals wait ${delayWords(value)}`;
    case "SetRuleDelay": return `Looser rules wait ${delayWords(value)}`;
    case "SetDailyLimit": return value ? `Daily limit ${sol(value, A(aid))} ${A(aid).unit}` : `Remove the ${A(aid).unit} daily limit`;
    case "SetLockedUntil": return value ? `Lock until ${new Date(value * 1000).toLocaleDateString(LOCALE)}` : "End the lock";
    case "SetGuardian": return value ? `Guardian ${short(value)}` : "Remove the guardian";
    case "AddTrusted": return `Trust ${nameOf(value) ? nameOf(value) + " · " : ""}${short(value)}`;
    case "RemoveTrusted": return `Stop trusting ${nameOf(value) ? nameOf(value) + " · " : ""}${short(value)}`;
  }
  return kind;
}

function rowsChanges(v, asGuardian) {
  const t = now();
  return v.changes.map((c) => {
    const left = c.readyAt - t, pct = Math.min(100, Math.max(2, (1 - left / Math.max(1, v.ruleDelay)) * 100));
    const g = S.wallet && v.guardian?.equals(S.wallet);
    const ids = `data-id="${c.id}" data-asset="${c.asset || "native"}"`;
    const acts = asGuardian
      ? (g && c.change.kind === "AddTrusted" ? `<button class="btn sm good" data-act="approve" ${ids} ${S.busy ? "disabled" : ""}>Approve now</button>` : `<span class="muted small">Guardians can't speed this up.</span>`)
      : `<button class="btn sm" data-act="cancel-c" ${ids} ${S.busy ? "disabled" : ""}>Cancel change</button>${left <= 0 ? `<button class="btn sm primary" data-act="apply" ${ids} ${S.busy ? "disabled" : ""}>Apply</button>` : ""}`;
    return `<div class="row"><div class="row-top"><b>${esc(changeWords(c.change, c.asset))}</b><span class="count" data-ready="${c.readyAt}">${dur(left)}</span></div><div class="bar"><i style="width:${pct}%"></i></div><div class="row-acts">${acts}</div></div>`;
  }).join("");
}

// ------------------------------------------------------------------ sheets

function sheet(html, onSubmit) {
  const d = $("#sheet"), f = $("#sheet-form");
  f.innerHTML = html + `<div class="acts"><button class="btn" value="cancel" formnovalidate>Close</button><button class="btn primary" value="ok">Confirm</button></div>`;
  f.onsubmit = async (e) => { if (e.submitter?.value !== "ok") return; e.preventDefault(); if ((await onSubmit(new FormData(f))) !== false) d.close(); };
  d.showModal(); f.querySelector("input,select")?.focus();
}
const lamportsOf = (fd) => Math.round(Number(fd.get("amount")) * A().base);
const amount = (v = A().stable ? "10" : "0.1") => `<label class="field">Amount (${A().unit})<input name="amount" type="number" min="${A().stable ? "0.01" : "0.0001"}" step="${A().stable ? "0.01" : "0.0001"}" inputmode="decimal" required value="${v}"/></label>`;
/** "Withdraw" with the coin's name when the vault holds more than one. */
const titled = (verb) => (assets().length > 1 ? `${verb} ${A().unit}` : verb);
const walletHas = () => (S.asset === "native" ? S.walletSol || 0 : S.walletTok[S.asset] || 0);
const keyOf = (s) => (s ? C.x?.key(s) ?? null : null);

// Names for addresses, kept on this device only (nothing about them goes on-chain).
const namesKey = () => `ecrin-names-${S.net}-${S.wallet ? S.wallet.toBase58() : ""}`;
function names() { try { return JSON.parse(localStorage.getItem(namesKey()) || "{}"); } catch (_) { return {}; } }
function setName(addr, name) { try { const n = names(); if (name) n[String(addr)] = name.slice(0, 40); else delete n[String(addr)]; localStorage.setItem(namesKey(), JSON.stringify(n)); } catch (_) {} }
const nameOf = (k) => names()[String(k)] || "";
/** "Bank off-ramp · 9cRt…X2pa", or just the short address. */
const label = (k) => (nameOf(k) ? `${esc(nameOf(k))} · ${short(k)}` : short(k));

/** Address poisoning: an address that starts and ends like one you know but isn't it. Returns what it imitates. */
function lookalike(addr) {
  const a = String(addr || "").trim();
  if (a.length < 20) return null;
  const known = [...(S.vault?.trusted || []).map(String), S.wallet ? S.wallet.toBase58() : "", ...Object.keys(names()), ...allWithdrawals(S.vault).map((w) => String(w.dest))].filter(Boolean);
  const same = (x, y) => x.toLowerCase() === y.toLowerCase();
  if (known.some((k) => same(k, a))) return null;
  const hit = known.find((k) => same(k.slice(0, 4), a.slice(0, 4)) && same(k.slice(-4), a.slice(-4)));
  return hit ? (nameOf(hit) || short(hit)) : null;
}
/** Shows a warning under an address field while it looks like a known address. */
function watchLookalike(input) {
  if (!input) return;
  const note = document.createElement("p"); note.className = "note warn-note"; note.hidden = true;
  input.closest("label").after(note);
  const check = () => { const hit = lookalike(input.value); note.hidden = !hit; if (hit) note.innerHTML = `<b>Careful:</b> this looks like <b>${esc(hit)}</b> but it is a different address. Scammers send tiny amounts from lookalike addresses so you copy the wrong one. Check every character.`; };
  input.addEventListener("input", check); check();
}

const actions = {
  connect: (el) => connect(providers()[Number(el.dataset.i)][1]),
  disconnect: () => { $("#sheet").open && $("#sheet").close(); if (confirm(tr("Disconnect your wallet?"))) disconnect(); },
  account: () => accountMenu(),
  tab: (el) => {
    if (S.tab === el.dataset.t) return;
    S.tab = el.dataset.t; S.shown = null;
    document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches ? document.startViewTransition(render) : render();
    scrollTo({ top: 0, behavior: "smooth" });
    if (S.tab === "guardian" && S.watchOwner) refresh();
  },
  alerts: () => startAlerts(),
  mail: () => { sheet(`<div class="rule-h"><span class="pol-ico">${I.mail}</span><div><h3>Email alerts</h3><span class="muted small">Double opt-in: we send a link first</span></div></div><label class="field">Email<input name="email" type="email" required placeholder="you@example.com" autocomplete="email"/></label><p class="note">Every alert email has an unsubscribe link. Nothing else is ever sent.</p>`, (fd) => { startEmail(String(fd.get("email") || "").trim()); return true; }); },
  "goto-alerts": () => { S.tab = "vault"; render(); setTimeout(() => document.getElementById("alerts")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); },
  push: () => startPush(),
  "push-off": () => stopPush(),
  wc: () => { $("#sheet").close(); connectWC(); },
  install: () => installGuide(),
  "install-off": () => { try { localStorage.setItem("ecrin-install-off", "1"); } catch (_) {} render(); },
  "view-start": () => startView($("#view-addr")?.value),
  copy: async (el) => { try { await navigator.clipboard.writeText(el.dataset.v); toast("Link copied"); } catch (_) { toast("Copy failed: press and hold the link", "err"); } },
  privacy: () => { S.hide = !S.hide; try { localStorage.setItem("ecrin-hide", S.hide ? "1" : "0"); } catch (_) {} render(); if ($("#sheet").open) { $("#sheet").close(); accountMenu(); } },
  theme: () => {
    const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#0c0d0f" : "#f6f6f3");
    try { localStorage.setItem("ecrin-theme", t); } catch (_) {}
    render();
  },
  range: (el) => { S.range = el.dataset.d; render(); loadSeries(S.range); },
  net: (el) => { $("#sheet").close(); switchNet(el.dataset.n); },
  netmenu: () => netMenu(),
  lang: () => setLang(LANG === "fr" ? "en" : "fr"),
  // Switching coin inside a deposit, withdraw or send sheet reopens it for the new coin.
  asset: (el) => { S.asset = el.dataset.a; S.shown = null; render(); if ($("#sheet").open && S.sheetAct) { $("#sheet").close(); actions[S.sheetAct](); } },
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
  deposit: () => sheet(`<h3>${titled("Deposit")}</h3>${assetSwitch(S.vault)}${amount(A().stable ? "100" : "1")}<p class="note">Wallet: ${sol(walletHas())} ${A().unit}. Deposits go straight in.${A().stable && isEvm() ? " Your wallet asks you to allow the amount first, then to deposit it." : ""}${A().stable && !walletHas() ? ` Get free test USDC at <a href="https://faucet.circle.com" target="_blank" rel="noopener">faucet.circle.com</a>.` : ""}</p>`, (fd) => send(`Deposited ${sol(lamportsOf(fd))} ${A().unit}`, () => assetOps().deposit(lamportsOf(fd)))),
  withdraw: () => sheet(`<h3>${titled("Withdraw")}</h3>${assetSwitch(S.vault)}${amount()}<label class="field">To address<input name="dest" placeholder="Where it should go" required spellcheck="false" autocomplete="off" value="${S.wallet.toBase58()}"/></label><p class="note">Available: ${sol(assetView(S.vault).available)} ${A().unit}. This waits ${delayWords(S.vault.withdrawDelay)}${S.vault.lockedUntil && now() < S.vault.lockedUntil ? " and until the lock ends" : ""}. You can cancel any time.</p>`, async (fd) => {
    const dest = keyOf(fd.get("dest")); if (!dest) { toast("That address isn't valid", "err"); return false; }
    return send(`Asked to withdraw ${sol(lamportsOf(fd))} ${A().unit}`, () => assetOps().requestWithdrawal(dest, lamportsOf(fd)));
  }) || watchLookalike($('#sheet-form input[name="dest"]')),
  send: () => {
    if (!S.vault.trusted.length) return toast("Add a trusted address first", "err");
    const lim = assetView(S.vault).dailyLimit;
    sheet(`<h3>${titled("Send")} to a trusted address</h3>${assetSwitch(S.vault)}${amount()}<label class="field">To<select name="dest">${S.vault.trusted.map((k) => `<option value="${k.toBase58()}">${label(k)}</option>`).join("")}</select></label><p class="note">Arrives instantly${lim ? `, up to ${sol(lim)} ${A().unit} a day` : ""}.</p>`,
      (fd) => send(`Sent ${sol(lamportsOf(fd))} ${A().unit} to a trusted address`, () => assetOps().sendToTrusted(keyOf(fd.get("dest")), lamportsOf(fd))));
  },
  trust: () => { sheet(`<h3>Trust an address</h3><label class="field">Address<input name="addr" required placeholder="Your bank off-ramp, your rent…" spellcheck="false" autocomplete="off"/></label><label class="field">Name (only on this device)<input name="label" maxlength="40" placeholder="Bank off-ramp" autocomplete="off"/></label><p class="note">Money sent here will arrive instantly, so trusting it waits ${delayWords(S.vault.ruleDelay)}${S.vault.guardian ? ", unless your guardian approves it sooner" : ""}.</p>`, async (fd) => {
    const a = keyOf(fd.get("addr")); if (!a) { toast("That address isn't valid", "err"); return false; }
    if (String(fd.get("label") || "").trim()) setName(a.toBase58(), String(fd.get("label")).trim());
    return send("Asked to trust an address", () => C.x.ops.proposeChange({ kind: "AddTrusted", value: a }));
  }); watchLookalike($('#sheet-form input[name="addr"]')); },
  name: (el) => { const cur = nameOf(el.dataset.a), n = prompt(tr("Name for this address (only on this device):"), cur); if (n === null) return; setName(el.dataset.a, n.trim()); render(); },
  rules: () => openRuleMenu(),
  freeze: () => { $("#sheet").close(); freezeSheet(); },
  rule: (el) => { $("#sheet").close(); openRule(el.dataset.k); },
  "cancel-w": (el) => { const a = A(el.dataset.asset); return send(`Cancelled. ${sol(Number(el.dataset.amt), a)} ${a.unit} stays in your vault. That's a win.`, () => assetOps(a.id).cancelWithdrawal(Number(el.dataset.id))); },
  run: (el) => send("Sent a withdrawal", () => assetOps(el.dataset.asset).executeWithdrawal(S.wallet, Number(el.dataset.id), keyOf(el.dataset.dest))),
  "cancel-c": (el) => send("Cancelled a rule change", () => assetOps(el.dataset.asset).cancelChange(Number(el.dataset.id))),
  apply: (el) => send("Applied a rule change", () => assetOps(el.dataset.asset).applyChange(S.wallet, Number(el.dataset.id))),
  "open-asset": (el) => { S.asset = el.dataset.a; actions.tab({ dataset: { t: "vault" } }); },
  watch: async () => {
    const k = keyOf($("#watch")?.value); if (!k) return toast("That address isn't valid", "err");
    S.watchOwner = k.toBase58(); S.watched = undefined; render();
    S.watched = await readVault(k).catch(() => null); render();
  },
  release: (el) => send("Approved an emergency release", () => assetOps(el.dataset.asset).guardianRelease(keyOf(S.watchOwner), Number(el.dataset.id), keyOf(el.dataset.dest))),
  approve: (el) => send("Approved a trusted address", () => C.x.ops.guardianApproveChange(keyOf(S.watchOwner), Number(el.dataset.id))),
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  if (S.readOnly && SIGNING.has(el.dataset.act)) { $("#sheet").close(); return signElsewhere(); }
  if (el.dataset.act !== "asset") S.sheetAct = ["deposit", "withdraw", "send"].includes(el.dataset.act) ? el.dataset.act : null;
  actions[el.dataset.act]?.(el);
});
// Live countdowns between refreshes: the withdrawal clocks tick every second; when one hits zero, reload the vault.
setInterval(() => {
  let done = false;
  document.querySelectorAll(".dial[data-ready]").forEach((n) => { if (!tickDial(n)) done = true; });
  document.querySelectorAll(".count[data-ready]").forEach((n) => { const left = Number(n.dataset.ready) - now(); if (left > 0) n.textContent = dur(left); });
  if (done && !S.busy && Date.now() - (S.tickRefresh || 0) > 10000) { S.tickRefresh = Date.now(); refresh(); }
}, 1000);
setInterval(() => { if (S.wallet && !S.busy && document.visibilityState === "visible") refresh(); }, 30000);

startTranslating();
render();
loadPrice();
setInterval(() => { if (document.visibilityState === "visible") loadPrice(); }, 120000);
// Reconnect silently if this site was trusted before on this network.
function reconnect() {
  try {
    if (!localStorage.getItem("ecrin-wallet-" + S.net) && !(S.net === "sol" && localStorage.getItem("ecrin-wallet"))) return;
    const p = providers()[0]?.[1];
    if (!p || !C.x) return;
    if (isEvm()) p.request({ method: "eth_accounts" }).then((a) => { if (a?.length) connect(p); }).catch(() => {});
    else p.connect?.({ onlyIfTrusted: true }).then((r) => { if (r?.publicKey || p.publicKey) connect(p); }).catch(() => {});
  } catch (_) {}
}
// Phones without an injected wallet (Safari, Chrome, the home-screen app) reopen the last watched vault.
try { const a = localStorage.getItem(viewKey()); if (a && !providers().length && C.x) startView(a); } catch (_) {}
reconnect();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

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
