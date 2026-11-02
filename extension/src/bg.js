// Ecrin Wallet background.
// 1. Auto-lock: wipes the unlocked phrase from memory after the chosen idle time (chrome.storage.session lives only
//    in memory and is cleared when the browser closes).
// 2. Websites: answers requests from the page (through content.js). It never holds keys: anything that needs your
//    approval opens an Ecrin window, which shows the site, what it asks and exactly what would leave, and signs
//    only if you approve. The site's address always comes from Chrome (sender.url), never from the page.
import { EVM_NETS } from "../../app/config-evm.js";
import { check, refresh as refreshLists } from "./sitecheck.js";

const lock = () => chrome.storage.session.clear();

/* ---------- auto-lock ---------- */
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === "lists") return refreshLists().catch(() => {});
  if (a.name !== "lock") return;
  const { until } = await chrome.storage.session.get("until");
  if (!until || until <= Date.now() + 1000) lock(); else chrome.alarms.create("lock", { when: until });
});
// Only the wallet's own pages may read the unlocked phrase, never a web page or content script.
chrome.storage.session.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
chrome.runtime.onStartup.addListener(lock);
chrome.runtime.onInstalled.addListener(() => { refreshLists().catch(() => {}); chrome.alarms.create("lists", { periodInMinutes: 24 * 60 }); });

// "Always" auto-lock: the popup keeps a connection open; when it closes, lock at once.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "approval") { port.onMessage.addListener(() => {}); return; } // keeps this worker awake while you decide
  if (port.name !== "popup") return;
  port.onDisconnect.addListener(async () => { const { autolock } = await chrome.storage.local.get("autolock"); if (autolock === 0) { chrome.alarms.clear("lock"); lock(); } });
});

/* ---------- websites ---------- */
const OWN = chrome.runtime.getURL("");
const fromWallet = (s) => typeof s.url === "string" && s.url.startsWith(OWN); // the popup and the approval window (which Chrome counts as a tab)
const err = (code, message) => Object.assign(new Error(message), { code });
const REJECT = () => err(4001, "You rejected the request in Ecrin Wallet.");
const EVMS = Object.values(EVM_NETS);
const byChain = (id) => EVMS.find((n) => n.chainId === Number(id));
const hex = (n) => "0x" + Number(n).toString(16);

const getSites = async () => (await chrome.storage.local.get("sites")).sites || {};
const setSites = (sites) => chrome.storage.local.set({ sites });
const pub = async () => (await chrome.storage.local.get("pub")).pub || null;

/** Tell every open tab of this site (content.js filters by origin). */
async function broadcast(origin, fam, event, data) {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: "dapp-event", origin, fam, event, data }).catch(() => {});
}

// Requests waiting for you in an Ecrin window.
const pending = new Map();
async function approve(req) {
  // One open request per site: a page can't flood the screen with approval windows.
  for (const p of pending.values()) if (p.req.origin === req.origin) throw err(4001, "Ecrin Wallet already has a request open for this site. Answer it first.");
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, { req, resolve, reject, win: null });
    chrome.windows.getLastFocused().catch(() => null).then((w) => {
      const W = 380, H = 640;
      const pos = w && w.width ? { left: Math.max(0, (w.left || 0) + w.width - W - 24), top: Math.max(0, (w.top || 0) + 72) } : {};
      const opts = { url: chrome.runtime.getURL(`popup.html#approve=${id}`), type: "popup", width: W, height: H, focused: true };
      // Top right of the current window when possible; Chrome's own placement if that would be off screen.
      return chrome.windows.create({ ...opts, ...pos }).catch(() => chrome.windows.create(opts));
    }).then((win) => { const p = pending.get(id); if (p) p.win = win.id; }).catch((e) => { pending.delete(id); reject(err(4900, "Couldn't open Ecrin Wallet: " + e.message)); });
  });
}
chrome.windows.onRemoved.addListener((wid) => {
  for (const [id, p] of pending) if (p.win === wid) { pending.delete(id); p.reject(REJECT()); }
});

async function siteInfo(origin) {
  const u = new URL(origin);
  const c = await check(u.hostname);
  const sites = await getSites();
  return { origin, host: u.hostname, https: u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1", phish: c.phish, like: c.like, first: !sites[origin] };
}

// Read-only calls a site may make through Ecrin's connection to the network.
const READ = new Set(["eth_blockNumber", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_getBalance", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getCode",
  "eth_getLogs", "eth_getStorageAt", "eth_getTransactionByHash", "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_feeHistory", "eth_maxPriorityFeePerGas", "eth_syncing", "net_listening", "web3_clientVersion"]);

async function evmRpc(net, method, params) {
  const { dev } = await chrome.storage.local.get("dev");
  const url = dev?.evm?.[net.key]?.rpc || net.rpc;
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw err(j.error.code ?? -32603, j.error.message || "Network error");
  return j.result;
}

async function handleEvm(origin, method, params) {
  const sites = await getSites(), site = sites[origin], p = await pub();
  const net = byChain(site?.chainId) || EVM_NETS.eth;
  const connected = !!site?.evm && !!p?.evm;
  switch (method) {
    case "eth_chainId": return hex(net.chainId);
    case "net_version": return String(net.chainId);
    case "eth_accounts": return connected ? [p.evm] : [];
    case "eth_coinbase": return connected ? p.evm : null;
    case "eth_requestAccounts": case "wallet_requestPermissions": {
      if (!connected) {
        if (!p?.evm) throw err(4100, "Open Ecrin Wallet and create or import a wallet first.");
        await approve({ fam: "evm", kind: "connect", origin, site: await siteInfo(origin), chainId: net.chainId });
        const s = await getSites(); s[origin] = { ...(s[origin] || {}), evm: true, chainId: net.chainId, at: Date.now() }; await setSites(s);
        broadcast(origin, "evm", "connect", { chainId: hex(net.chainId) });
      }
      return method === "wallet_requestPermissions" ? [{ parentCapability: "eth_accounts" }] : [p.evm];
    }
    case "wallet_getPermissions": return connected ? [{ parentCapability: "eth_accounts" }] : [];
    case "wallet_revokePermissions": { const s = await getSites(); if (s[origin]) { s[origin].evm = false; await setSites(s); } broadcast(origin, "evm", "accountsChanged", []); return null; }
    case "wallet_switchEthereumChain": case "wallet_addEthereumChain": {
      const want = byChain(BigInt(params?.[0]?.chainId ?? "0x0"));
      if (!want) throw err(4902, "Ecrin Wallet runs on test networks during the beta: Sepolia, Base Sepolia, Arbitrum Sepolia, OP Sepolia and Polygon Amoy.");
      const s = await getSites(); s[origin] = { ...(s[origin] || {}), chainId: want.chainId }; await setSites(s);
      if (want.chainId !== net.chainId) broadcast(origin, "evm", "chainChanged", hex(want.chainId));
      return null;
    }
    case "personal_sign": case "eth_sign": case "eth_signTypedData_v4": case "eth_signTypedData_v3": case "eth_signTypedData": case "eth_sendTransaction": {
      if (!connected) throw err(4100, "Connect Ecrin Wallet to this site first.");
      const kind = method === "eth_sendTransaction" ? "tx" : method.startsWith("eth_signTypedData") ? "typed" : "sign";
      let body;
      const [x, y] = params || [], pick = String(x).toLowerCase() === p.evm.toLowerCase() ? y : x;
      if (JSON.stringify(params || []).length > 32_768) throw err(-32602, "That request is too large.");
      if (kind === "sign") body = { message: method === "eth_sign" ? y : pick };
      else if (kind === "typed") body = { data: typeof pick === "string" ? pick : JSON.stringify(pick) };
      else {
        const tx = params?.[0] || {};
        if (tx.from && String(tx.from).toLowerCase() !== p.evm.toLowerCase()) throw err(4100, "That isn't the connected address.");
        body = { tx };
      }
      return approve({ fam: "evm", kind, origin, site: await siteInfo(origin), chainId: net.chainId, ...body });
    }
    default:
      if (READ.has(method)) return evmRpc(net, method, params || []);
      throw err(4200, `Ecrin Wallet doesn't support ${method} yet.`);
  }
}

async function handleSol(origin, method, params) {
  const sites = await getSites(), site = sites[origin], p = await pub();
  const connected = !!site?.sol && !!p?.sol;
  switch (method) {
    case "connect": {
      if (connected) return p.sol;
      if (params?.silent) return null;
      if (!p?.sol) throw err(4100, "Open Ecrin Wallet and create or import a wallet first.");
      await approve({ fam: "sol", kind: "connect", origin, site: await siteInfo(origin) });
      const s = await getSites(); s[origin] = { ...(s[origin] || {}), sol: true, at: Date.now() }; await setSites(s);
      return p.sol;
    }
    case "disconnect": { const s = await getSites(); if (s[origin]) { s[origin].sol = false; await setSites(s); } return null; }
    case "signTransactions": case "signMessage": {
      if (!connected) throw err(4100, "Connect Ecrin Wallet to this site first.");
      if (method === "signTransactions") {
        const chain = String(params?.chain || "solana:devnet");
        if (chain === "solana:mainnet" || chain === "solana:mainnet-beta") throw err(4100, "Ecrin Wallet runs on Solana Devnet during the beta.");
        if (!Array.isArray(params?.txs) || !params.txs.length) throw err(-32602, "No transaction to sign.");
        if (params.txs.length > 8 || params.txs.some((t) => !Array.isArray(t) || t.length > 1232 || t.some((x) => !Number.isInteger(x) || x < 0 || x > 255))) throw err(-32602, "That transaction is malformed or too large.");
        return approve({ fam: "sol", kind: "soltx", origin, site: await siteInfo(origin), txs: params.txs, send: !!params.send, chain });
      }
      const msg = params?.message;
      if (!Array.isArray(msg) || !msg.length || msg.length > 4096 || msg.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) throw err(-32602, "That message is malformed or too long.");
      return approve({ fam: "sol", kind: "solmsg", origin, site: await siteInfo(origin), message: msg });
    }
    default: throw err(4200, `Ecrin Wallet doesn't support ${method} yet.`);
  }
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || sender.id !== chrome.runtime.id) return;
  // From web pages (content.js).
  if (sender.tab && !fromWallet(sender) && m.type === "dapp") {
    let origin;
    try { origin = new URL(sender.url).origin; } catch (_) { reply({ error: { code: 4100, message: "Unknown page." } }); return; }
    if (!/^https?:/.test(origin)) { reply({ error: { code: 4100, message: "Ecrin Wallet only works on web pages." } }); return; }
    (m.fam === "sol" ? handleSol : handleEvm)(origin, m.method, m.params)
      .then((result) => reply({ result }), (e) => reply({ error: { code: e.code ?? -32603, message: e.message } }));
    return true;
  }
  if (sender.tab && !fromWallet(sender) && m.type === "check-site") {
    let host; try { host = new URL(sender.url).hostname; } catch (_) { reply(null); return; }
    check(host).then((c) => reply({ phish: c.phish && !c.ignored, host })).catch(() => reply(null));
    return true;
  }
  if (sender.tab && !fromWallet(sender) && m.type === "allow-site") {
    let host; try { host = new URL(sender.url).hostname; } catch (_) { return; }
    chrome.storage.local.get("siteAllow").then(({ siteAllow = {} }) => chrome.storage.local.set({ siteAllow: { ...siteAllow, [host]: Date.now() } }));
    return;
  }
  // From the wallet's own pages only.
  if (!fromWallet(sender)) return;
  if (m.type === "autolock" && m.until) chrome.alarms.create("lock", { when: m.until });
  if (m.type === "lock") { chrome.alarms.clear("lock"); lock(); }
  if (m.type === "approval-get") { const p = pending.get(m.id); reply(p ? { ...p.req, id: m.id } : null); return; }
  if (m.type === "approval-done") {
    const p = pending.get(m.id);
    if (p) { pending.delete(m.id); if (m.ok) p.resolve(m.result); else p.reject(m.error ? err(m.error.code ?? -32603, m.error.message) : REJECT()); }
    reply(true); return;
  }
  if (m.type === "site-disconnect") {
    getSites().then(async (s) => { delete s[m.origin]; await setSites(s); broadcast(m.origin, "evm", "accountsChanged", []); broadcast(m.origin, "sol", "accounts", []); reply(true); });
    return true;
  }
  if (m.type === "lists-refresh") { refreshLists().then((r) => reply(r ? { count: r.count, at: r.at } : null)); return true; }
  if (m.type === "site-check") { check(m.host).then(reply); return true; }
});


/* ---------- incoming coins: a notification when your balance goes up (every 5 minutes) ---------- */
chrome.alarms.create("recv", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "recv") return;
  const { pub, recvNotify, dev, seenBal = {} } = await chrome.storage.local.get(["pub", "recvNotify", "dev", "seenBal"]);
  if (!pub || recvNotify === false) return;
  const rpc = (url, method, params) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json()).then((j) => j.result);
  const checks = [["sol", "Solana", "SOL", 1e9, () => rpc(dev?.solRpc || "https://api.devnet.solana.com", "getBalance", [pub.sol]).then((r) => r?.value)],
    ...Object.values(EVM_NETS).map((n) => [n.key, n.name, n.unit, 1e18, () => rpc(dev?.evm?.[n.key]?.rpc || n.rpc, "eth_getBalance", [pub.evm, "latest"]).then((r) => (r ? Number(BigInt(r)) : null))])];
  const next = { ...seenBal };
  await Promise.all(checks.map(async ([k, name, unit, base, get]) => {
    const v = await get().catch(() => null); if (v == null) return;
    const key = `${k}:${k === "sol" ? pub.sol : pub.evm}`, was = seenBal[key];
    if (was != null && v > was) chrome.notifications?.create(`recv-${key}-${Date.now()}`, { type: "basic", iconUrl: "icons/128.png", title: "Ecrin Wallet", message: `Received ${+((v - was) / base).toFixed(6)} ${unit} on ${name}` });
    next[key] = v;
  }));
  await chrome.storage.local.set({ seenBal: next });
});
