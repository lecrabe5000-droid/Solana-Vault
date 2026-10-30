// Ecrin app: your real vault on Solana devnet or Ethereum Sepolia, through the wallet you already use.
// Solana: reads with app/chain.js, signs in the wallet, sends through our own devnet RPC (so it works whichever
// network the wallet is set to). Ethereum: app/evm.js reads through a public Sepolia RPC and signs with MetaMask.
// Both return the same vault shape, so every view below is shared. Nothing here holds keys or funds.
import { createClient, explainError } from "./chain.js";
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
const S = { net: savedNet === "eth" ? "eth" : "sol", price: null, tokens: [], wallet: null, provider: null, walletSol: null, vault: undefined, view: "owner", watchOwner: "", watched: undefined, busy: false, clockOffset: 0, err: null, pick: "strong" };
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
  Object.assign(S, { net: n, wallet: null, provider: null, walletSol: null, vault: undefined, price: null, tokens: [], view: "owner", watchOwner: "", watched: undefined, err: null });
  C = NETS[n];
  try { localStorage.setItem("ecrin-net", n); } catch (_) {}
  render(); loadPrice(); reconnect();
}

// ------------------------------------------------------------------ wallet

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

/** Runs one signed operation, then logs it, tells the person, and reloads the vault. */
async function send(label, op) {
  if (S.busy) return null;
  S.busy = true; render();
  try {
    const sig = await op();
    log(label, sig);
    toast(`${esc(label)} · <a href="${explorer("tx", sig)}" target="_blank" rel="noopener" style="color:inherit">view</a>`, label.startsWith("Cancelled") ? "win" : "");
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
    if (S.view === "guardian" && S.watchOwner) S.watched = await C.x.fetchVault(C.x.key(S.watchOwner)).catch(() => null);
  } catch (e) { S.err = `Couldn't reach ${C.name} ${C.net}. Retrying…`; console.warn(e); }
  render();
}

// ------------------------------------------------------------------ prices and tokens

// Price from CoinGecko: test coins have no value, so we show what the same amount is worth on mainnet.
async function loadPrice() {
  const cg = C.cg;
  try {
    const [p, c] = await Promise.all([
      fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cg}&vs_currencies=usd&include_24hr_change=true`).then((r) => r.json()),
      fetch(`https://api.coingecko.com/api/v3/coins/${cg}/market_chart?vs_currency=usd&days=7`).then((r) => r.json()),
    ]);
    const usd = p?.[cg]?.usd;
    if (!usd || cg !== C.cg) return;
    S.price = { usd, change: p[cg].usd_24h_change || 0, series: (c?.prices || []).map(([, v]) => v).filter(Number.isFinite) };
    render();
  } catch (e) { console.warn("price", e); }
}

async function loadTokens() {
  try {
    const r = await connection.getParsedTokenAccountsByOwner(S.wallet, { programId: new web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
    S.tokens = r.value.map(({ account }) => account.data.parsed.info).filter((i) => Number(i.tokenAmount.uiAmount) > 0)
      .map((i) => ({ mint: i.mint, amount: i.tokenAmount.uiAmountString }));
  } catch (_) { S.tokens = []; }
}

const usd = (lamports) => S.price ? ((lamports / LAMPORTS) * S.price.usd).toLocaleString(undefined, { style: "currency", currency: "USD" }) : null;

function spark(series) {
  if (series.length < 2) return "";
  const W = 600, H = 120, min = Math.min(...series), max = Math.max(...series), span = max - min || 1;
  const pts = series.map((v, i) => [(i / (series.length - 1)) * W, H - 8 - ((v - min) / span) * (H - 16)]);
  const line = pts.map(([x, y], i) => (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1)).join(" ");
  const up = series[series.length - 1] >= series[0];
  return `<svg class="spark ${up ? "up" : "down"}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="sg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".16"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
    <path d="${line} L${W} ${H} L0 ${H} Z" fill="url(#sg)"/><path d="${line}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

const SHIELD_SM = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2.5l7.5 3v6c0 4.6-3.2 8.6-7.5 10-4.3-1.4-7.5-5.4-7.5-10v-6z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>`;
const WALLET_SM = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M16 12.5h2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;

function portfolio(v, locked) {
  const vaultL = v.balance, walletL = S.walletSol || 0, total = vaultL + walletL, queued = v.balance - v.available;
  const pct = total ? Math.round((vaultL / total) * 100) : 0;
  const ch = S.price?.change, chTxt = ch == null ? "" : `<span class="delta ${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(2)}% today</span>`;
  return `<section class="card hero o-hero">
    <div class="kicker">Total balance</div>
    <div class="bal">${usd(total) ?? `${sol(total)}<small>${C.unit}</small>`}</div>
    <div class="bal-sub">${S.price ? `${sol(total)} ${C.unit} · ` : ""}${chTxt}${S.price ? ` <span class="muted">· test ${C.unit} at the real ${C.unit} price</span>` : ""}</div>
    ${S.price?.series?.length ? `<div class="chart">${spark(S.price.series)}<div class="chart-l"><span>7 days</span><span>1 ${C.unit} = ${S.price.usd.toLocaleString(undefined, { style: "currency", currency: "USD" })}</span></div></div>` : ""}
    <div class="split" role="img" aria-label="${pct}% protected in the vault"><i style="width:${pct}%"></i></div>
    <div class="accts">
      <div class="acct vault"><div class="acct-h">${SHIELD_SM}Vault <span class="tag">Protected</span></div><b>${sol(vaultL)} ${C.unit}</b><span class="muted">${usd(vaultL) ? usd(vaultL) + " · " : ""}${locked ? "locked until " + new Date(v.lockedUntil * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "withdrawals wait " + delayWords(v.withdrawDelay)}${queued ? ` · ${sol(queued)} leaving` : ""}</span></div>
      <div class="acct"><div class="acct-h">${WALLET_SM}Wallet <span class="tag plain">Spendable</span></div><b>${sol(walletL)} ${C.unit}</b><span class="muted">${usd(walletL) ? usd(walletL) + " · " : ""}moves instantly</span>${S.tokens.length ? `<span class="muted">+ ${S.tokens.length} token${S.tokens.length > 1 ? "s" : ""}</span>` : ""}</div>
    </div>
    <div class="chips">
      ${v.guardian ? `<span class="chip good">Guardian ${short(v.guardian)}</span>` : ""}
      <a class="chip" href="${explorer("address", v.address.toBase58())}" target="_blank" rel="noopener">Vault on-chain ↗</a>
    </div>
    <div class="actions"><button class="btn" data-act="deposit">Deposit</button><button class="btn" data-act="withdraw">Withdraw</button><button class="btn primary" data-act="send">Send to trusted</button></div>
  </section>`;
}

// ------------------------------------------------------------------ views

function header() {
  const w = S.wallet;
  return `<header class="top">
    <a class="brand" href="/" style="text-decoration:none">${logo}Ecrin</a>
    <div class="seg netsw" role="group" aria-label="Network"><button data-act="net" data-n="sol" aria-pressed="${S.net === "sol"}">Solana</button><button data-act="net" data-n="eth" aria-pressed="${S.net === "eth"}">Ethereum</button></div><span class="net">${C.net}</span><div class="spacer"></div>
    ${w ? `<div class="seg" role="group" aria-label="View as"><button data-act="view" data-v="owner" aria-pressed="${S.view === "owner"}">My vault</button><button data-act="view" data-v="guardian" aria-pressed="${S.view === "guardian"}">Guardian</button></div>
      <button class="btn sm wallet" data-act="disconnect" title="Disconnect ${esc(w.toBase58())}"><i class="live"></i>${short(w)}</button>` : ""}
  </header>`;
}

function render() {
  const app = $("#app");
  if (!C.x) {
    app.innerHTML = header() + `<section class="card center-card"><div class="big-ico">${logo}</div><h2>The Ecrin ${C.contractWord} isn't on ${C.name} ${C.net} yet</h2><p class="muted">It's being deployed. In the meantime, the demo runs the same rules with pretend money.</p><a class="btn primary" href="/demo">Open the demo</a></section>`;
    return;
  }
  if (!S.wallet) {
    const list = providers();
    app.innerHTML = header() + `<section class="card center-card">
      <div class="big-ico">${logo}</div><h2>Connect your wallet</h2>
      <p class="muted">Ecrin never holds your keys. Your wallet signs, the ${C.name} ${C.contractWord} enforces the rules.</p>
      <div class="wallets">${list.length ? list.map(([n], i) => `<button class="btn primary" data-act="connect" data-i="${i}">Connect ${esc(n)}</button>`).join("") : `<a class="btn primary" href="${C.getWallet[1]}" target="_blank" rel="noopener">${C.getWallet[0]}</a>`}</div>
      <ol class="howto"><li>${C.setup}</li><li>Get free test ${C.unit} at <a href="${C.faucet}" target="_blank" rel="noopener">${C.faucetName}</a>.</li><li>Connect, create your vault, and try a withdrawal.</li></ol>
    </section>`;
    return;
  }
  if (S.view === "guardian") return renderGuardian(app);
  if (S.vault === undefined) { app.innerHTML = header() + `<section class="card center-card"><p class="muted">Reading your vault from ${C.name} ${C.net}…</p></section>`; return; }
  if (S.vault === null) return renderCreate(app);
  renderVault(app, S.vault);
}

function renderCreate(app) {
  const presets = [["gentle", "Gentle", "Withdrawals wait 24 h. Loosening a rule waits 3 days."], ["strong", "Strong", "Withdrawals wait 72 h. Loosening a rule waits 7 days."], ["locked", "Locked", "Nothing leaves before a date you pick, except an emergency your guardian co-signs."]];
  app.innerHTML = header() + `<div class="onb">
    <section class="intro"><h1>Create your vault</h1><p>One vault per wallet. You can make it stricter any time; loosening it always waits.</p></section>
    ${S.walletSol < C.lowBal * LAMPORTS ? `<div class="notice">Your wallet has ${sol(S.walletSol)} ${C.unit} on ${C.net}. Get free test ${C.unit} at <a href="${C.faucet}" target="_blank" rel="noopener">${C.faucetName}</a> for <b>${short(S.wallet)}</b>, then come back.</div>` : ""}
    <div class="presets">${presets.map(([k, n, d]) => `<button type="button" class="preset" data-act="pick" data-k="${k}" aria-pressed="${S.pick === k}"><i class="dot"></i><b>${n}</b><span>${d}</span></button>`).join("")}</div>
    <label class="field">Guardian wallet address ${S.pick === "locked" ? "(required)" : "(optional)"}<input id="g-addr" placeholder="A friend's ${C.name} address" autocomplete="off" spellcheck="false"/></label>
    ${S.pick === "locked" ? `<label class="field" style="margin-top:12px">Locked until<input id="lock-date" type="date"/></label>` : ""}
    <button class="btn primary" style="width:100%;height:50px;margin-top:20px" data-act="create" ${S.busy ? "disabled" : ""}>${S.busy ? "Confirm in your wallet…" : "Create vault"}</button>
    <p class="foot">${C.createCost}</p></div>`;
}

// Big ticking clock for a queued withdrawal: days (if any), then hh:mm:ss.
function clockParts(left) {
  const l = Math.max(0, left), d = Math.floor(l / DAY), h = Math.floor((l % DAY) / HOUR), m = Math.floor((l % HOUR) / 60), sec = l % 60;
  const p = (n) => String(n).padStart(2, "0");
  return (d ? [[d, d === 1 ? "day" : "days"]] : []).concat([[p(h), "hours"], [p(m), "min"], [p(sec), "sec"]]);
}
const clockHTML = (left) => clockParts(left).map(([n, u]) => `<span class="seg-t"><b>${n}</b><small>${u}</small></span>`).join(`<i class="colon">:</i>`);
const SHIELD = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2.5l7.5 3v6c0 4.6-3.2 8.6-7.5 10-4.3-1.4-7.5-5.4-7.5-10v-6z" fill="currentColor" opacity=".18"/><path d="M12 2.5l7.5 3v6c0 4.6-3.2 8.6-7.5 10-4.3-1.4-7.5-5.4-7.5-10v-6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function rowsWithdrawals(v, asGuardian) {
  const t = now(), locked = v.lockedUntil && t < v.lockedUntil;
  return v.withdrawals.map((w) => {
    const total = Math.max(1, v.withdrawDelay), left = w.readyAt - t, pct = Math.min(100, Math.max(2, (1 - left / total) * 100));
    const ready = left <= 0 && !locked, opens = Math.max(w.readyAt, locked ? v.lockedUntil : 0);
    const status = ready ? `<div class="clock-done">Ready. It only leaves if you press send.</div>`
      : `<div class="clock" data-ready="${opens}" role="timer" aria-label="Time left before this can leave">${clockHTML(opens - t)}</div>`;
    const guard = asGuardian
      ? (S.wallet && v.guardian?.equals(S.wallet) ? `<div class="row-acts"><button class="btn sm good" data-act="release" data-id="${w.id}" data-dest="${w.dest.toBase58()}" ${S.busy ? "disabled" : ""}>Approve emergency release</button></div>` : "")
      : `<button class="keep" data-act="cancel-w" data-id="${w.id}" data-amt="${w.amount}" ${S.busy ? "disabled" : ""}>${SHIELD}<span>Cancel and keep ${sol(w.amount)} ${C.unit} safe</span></button>
        <div class="keep-note">Free, instant, and nobody else is told.${ready ? ` <button class="link danger" data-act="run" data-id="${w.id}" data-dest="${w.dest.toBase58()}" ${S.busy ? "disabled" : ""}>Send it now</button>` : ""}</div>`;
    return `<div class="row wd${ready ? " is-ready" : ""}">
      <div class="row-top"><b>${sol(w.amount)} ${C.unit} <span class="muted" style="font-weight:500">leaving</span></b><span class="small muted">to <a href="${explorer("address", w.dest.toBase58())}" target="_blank" rel="noopener">${short(w.dest)}</a></span></div>
      ${status}
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="small muted">${ready ? "Unlocked" : "Unlocks"} ${when(opens)}${locked && left <= 0 ? " · held by your lock" : ""}</div>
      ${guard}</div>`;
  }).join("") || `<div class="empty">Nothing waiting to leave.</div>`;
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
      ? (g && c.change.kind === "AddTrusted" ? `<button class="btn sm good" data-act="approve" data-id="${c.id}" ${S.busy ? "disabled" : ""}>Approve now</button>` : `<span class="small muted">Guardians can't speed this up.</span>`)
      : `<button class="btn sm" data-act="cancel-c" data-id="${c.id}" ${S.busy ? "disabled" : ""}>Cancel change</button>${left <= 0 ? `<button class="btn sm" data-act="apply" data-id="${c.id}" ${S.busy ? "disabled" : ""}>Apply</button>` : ""}`;
    return `<div class="row"><div class="row-top"><b style="font-size:15px">${esc(changeWords(c.change))}</b><span class="count">${dur(left)}</span></div><div class="bar"><i style="width:${pct}%"></i></div><div class="row-acts">${acts}</div></div>`;
  }).join("");
}

function guardianHero(v, locked) {
  const queued = v.balance - v.available;
  return `<section class="card hero o-hero">
      <div class="kicker">Vault of ${short(v.owner)}</div>
      <div class="bal">${sol(v.balance)}<small>${C.unit}</small></div>
      <div class="bal-sub">${sol(v.available)} ${C.unit} available${queued ? ` · ${sol(queued)} ${C.unit} waiting to leave` : ""}</div>
      <div class="chips">
        <span class="chip">Withdrawals wait ${delayWords(v.withdrawDelay)}</span>
        ${locked ? `<span class="chip lock">Locked until ${new Date(v.lockedUntil * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>` : ""}
        ${v.guardian ? `<span class="chip good">Guardian ${short(v.guardian)}</span>` : ""}
        <a class="chip" href="${explorer("address", v.address.toBase58())}" target="_blank" rel="noopener">On-chain ↗</a>
      </div>
      <p class="small muted" style="margin:16px 0 0">${S.wallet && v.guardian?.equals(S.wallet) ? "You're this vault's guardian: you can approve an emergency release or a new trusted address. You can never start a withdrawal or choose where money goes." : "Your wallet isn't this vault's guardian, so you can only watch."}</p>
    </section>`;
}

function vaultCards(v, asGuardian) {
  const t = now(), locked = v.lockedUntil && t < v.lockedUntil, queued = v.balance - v.available;
  const changes = rowsChanges(v, asGuardian);
  return `<div class="layout"><div class="col-main">
    ${asGuardian ? guardianHero(v, locked) : portfolio(v, locked)}
    <section class="card o-wait"><div class="card-h"><h2>Waiting to leave</h2><span class="small muted">${asGuardian ? "" : "cancel any time"}</span></div><div class="rows">${rowsWithdrawals(v, asGuardian)}</div></section>
    ${changes ? `<section class="card o-changes"><div class="card-h"><h2>Rule changes waiting</h2><span class="small muted">looser rules wait ${delayWords(v.ruleDelay)}</span></div><div class="rows">${changes}</div></section>` : ""}
    </div><div class="col-side">
    <section class="card o-rules"><div class="card-h"><h2>Rules</h2>${asGuardian ? "" : `<button class="btn sm" data-act="rules">Change rules</button>`}</div>
      <div class="rules">
        <div class="rule"><small>Withdrawals wait</small><b>${delayWords(v.withdrawDelay)}</b></div>
        <div class="rule"><small>Looser rules wait</small><b>${delayWords(v.ruleDelay)}</b></div>
        <div class="rule"><small>Daily limit</small><b>${v.dailyLimit ? sol(v.dailyLimit) + " " + C.unit : "None"}</b></div>
        <div class="rule"><small>Lock</small><b>${locked ? "Until " + new Date(v.lockedUntil * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "None"}</b></div>
      </div></section>
    <section class="card o-trusted"><div class="card-h"><h2>Trusted addresses</h2>${asGuardian ? "" : `<button class="btn sm" data-act="trust">Add</button>`}</div>
      ${v.trusted.length ? `<div class="chips" style="margin:0">${v.trusted.map((k) => `<a class="chip good" href="${explorer("address", k.toBase58())}" target="_blank" rel="noopener">${short(k)}</a>`).join("")}</div>` : `<div class="empty">None yet. Money sent here arrives instantly, so adding one takes time.</div>`}</section>
    ${asGuardian ? "" : `<section class="card o-log"><div class="card-h"><h2>Activity</h2></div>${readLog().length ? `<ul class="log">${readLog().map((l) => `<li><time>${new Date(l.at * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time><span>${esc(l.text)} · <a href="${explorer("tx", l.sig)}" target="_blank" rel="noopener">tx</a></span></li>`).join("")}</ul>` : `<div class="empty">Your transactions from this browser show up here.</div>`}</section>`}
    </div></div>`;
}

function renderVault(app, v) {
  app.innerHTML = header() + (S.err ? `<div class="notice">${esc(S.err)}</div>` : "") + vaultCards(v, false) + `<p class="foot">${C.contractWord[0].toUpperCase() + C.contractWord.slice(1)} <a href="${explorer("address", C.contract)}" target="_blank" rel="noopener">${short(C.contract)}</a> on ${C.name} ${C.net} · <a href="/">Ecrin</a></p>`;
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
const amount = (v = "0.1") => `<label class="field">Amount (${C.unit})<input name="amount" type="number" min="0.0001" step="0.0001" inputmode="decimal" required value="${v}"/></label>`;
const keyOf = (s) => (s ? C.x?.key(s) ?? null : null);

const actions = {
  connect: (el) => connect(providers()[Number(el.dataset.i)][1]),
  disconnect: () => { if (confirm("Disconnect your wallet?")) disconnect(); },
  view: (el) => { S.view = el.dataset.v; render(); },
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
  rules: () => {
    const v = S.vault;
    sheet(`<h3>Change a rule</h3><label class="field">Rule<select name="rule">
      <option value="d24">Withdrawals wait 24 h</option><option value="d72">Withdrawals wait 72 h</option><option value="d168">Withdrawals wait 7 days</option>
      <option value="l1">Daily limit 1 ${C.unit}</option><option value="l5">Daily limit 5 ${C.unit}</option><option value="l0">No daily limit</option>
      <option value="k30">Lock for 30 days</option>${v.lockedUntil ? `<option value="k0">End the lock</option>` : ""}${v.guardian ? `<option value="g0">Remove the guardian</option>` : ""}
    </select></label><label class="field">New guardian (optional)<input name="g" placeholder="Set a guardian's address instead" spellcheck="false" autocomplete="off"/></label>
    <p class="note">Stricter rules apply at once. Looser rules, and any guardian change, wait ${delayWords(v.ruleDelay)}: a guardian can release money early, so nobody holding your key can name one on the spot.</p>`, async (fd) => {
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
      return send(`Changed a rule: ${changeWords(change)}`, () => C.x.ops.proposeChange(change));
    });
  },
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
  document.querySelectorAll(".clock[data-ready]").forEach((n) => { const left = Number(n.dataset.ready) - now(); if (left > 0) n.innerHTML = clockHTML(left); else done = true; });
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
