// Ecrin Wallet in web pages (runs in the page itself, so sites can find it). It holds no keys and signs nothing:
// every request goes to the extension through content.js, and anything that matters opens an Ecrin window where
// you see the site, what it asks and exactly what would leave, and approve or reject it.
// - Solana: the Wallet Standard (how Phantom, Solflare and Backpack appear in Solana apps).
// - Ethereum-style networks: an EIP-1193 provider, announced with EIP-6963 so it sits next to MetaMask without
//   replacing it (window.ethereum is only set when no other wallet did).
(() => {
  if (window.__ecrinWallet) return;
  const CH = "ecrin-wallet", ICON = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#2F5BFF"/><rect x="6" y="6" width="20" height="20" rx="6" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M16 10.5l4.8 5.5L16 21.5 11.2 16z" fill="#fff"/></svg>');
  const target = location.origin === "null" ? "*" : location.origin;
  let seq = 0;
  const pending = new Map(), handlers = { sol: {}, evm: {} };
  const call = (fam, method, params) => new Promise((resolve, reject) => {
    const id = `${Date.now().toString(36)}-${++seq}`;
    pending.set(id, { resolve, reject });
    window.postMessage({ ch: CH, dir: "in", id, fam, method, params }, target);
  });
  const emit = (fam, ev, data) => (handlers[fam][ev] || []).slice().forEach((fn) => { try { fn(data); } catch (_) {} });
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.ch !== CH || d.dir !== "out") return;
    if (d.event) return d.fam === "sol" ? solEvent(d.event, d.data) : emit("evm", d.event, d.data);
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.error) { const err = new Error(d.error.message || "Request failed"); err.code = d.error.code ?? 4001; p.reject(err); } else p.resolve(d.result);
  });

  /* ---------- Ethereum-style networks (EIP-1193) ---------- */
  const on = (ev, fn) => { (handlers.evm[ev] ||= []).push(fn); return eth; };
  const off = (ev, fn) => { handlers.evm[ev] = (handlers.evm[ev] || []).filter((f) => f !== fn); return eth; };
  const eth = {
    isEcrin: true,
    request: (args) => {
      if (!args || typeof args.method !== "string") return Promise.reject(Object.assign(new Error("Invalid request"), { code: -32600 }));
      return call("evm", args.method, args.params ?? []);
    },
    on, addListener: on, once: (ev, fn) => { const w = (x) => { off(ev, w); fn(x); }; return on(ev, w); },
    removeListener: off, off, removeAllListeners: (ev) => { if (ev) handlers.evm[ev] = []; else handlers.evm = {}; return eth; },
    enable: () => eth.request({ method: "eth_requestAccounts" }),
    isConnected: () => true,
    // Old-style calls some sites still use.
    send: (a, b) => (typeof a === "string" ? eth.request({ method: a, params: b }) : (b ? eth.request(a).then((r) => b(null, { id: a.id, jsonrpc: "2.0", result: r }), (e) => b(e)) : Promise.reject(new Error("Unsupported")))),
    sendAsync: (a, cb) => eth.request(a).then((r) => cb(null, { id: a.id, jsonrpc: "2.0", result: r }), (e) => cb(e)),
  };
  // randomUUID only exists on https pages; plain http still needs an id.
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
  const info = Object.freeze({ uuid: uuid(), name: "Ecrin Wallet", icon: ICON, rdns: "app.ecrinprotocol.wallet" });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider: eth }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  if (!window.ethereum) { try { Object.defineProperty(window, "ethereum", { value: eth, configurable: true, writable: true }); } catch (_) {} }

  /* ---------- Solana (Wallet Standard) ---------- */
  const SOL_CHAINS = ["solana:devnet", "solana:testnet", "solana:localnet"];
  const FEATS = ["solana:signAndSendTransaction", "solana:signTransaction", "solana:signMessage"];
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const b58decode = (s) => { let n = 0n; for (const c of s) n = n * 58n + BigInt(B58.indexOf(c)); const out = []; while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; } for (const c of s) { if (c !== "1") break; out.unshift(0); } return new Uint8Array(out); };
  const account = (address) => Object.freeze({ address, publicKey: b58decode(address), chains: SOL_CHAINS, features: FEATS, label: "Ecrin Wallet", icon: ICON });
  let accounts = [];
  const solHandlers = { change: [] };
  const changed = () => solHandlers.change.forEach((fn) => { try { fn({ accounts }); } catch (_) {} });
  function solEvent(ev, data) {
    if (ev === "accounts") { accounts = data?.length ? [account(data[0])] : []; changed(); }
  }
  const bytes = (u8) => Array.from(u8 instanceof Uint8Array ? u8 : new Uint8Array(u8));
  const signTx = async (send, inputs) => {
    if (!accounts.length) throw Object.assign(new Error("Connect Ecrin Wallet first."), { code: 4100 });
    const r = await call("sol", "signTransactions", { send, chain: inputs[0]?.chain || "solana:devnet", txs: inputs.map((i) => bytes(i.transaction)), options: inputs[0]?.options || {} });
    return r.map((x) => (send ? { signature: new Uint8Array(x) } : { signedTransaction: new Uint8Array(x) }));
  };
  const wallet = {
    version: "1.0.0", name: "Ecrin Wallet", icon: ICON, chains: SOL_CHAINS,
    get accounts() { return accounts; },
    features: {
      "standard:connect": { version: "1.0.0", connect: async (o = {}) => { const a = await call("sol", "connect", { silent: !!o.silent }); accounts = a ? [account(a)] : []; changed(); return { accounts }; } },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { await call("sol", "disconnect", {}); accounts = []; changed(); } },
      "standard:events": { version: "1.0.0", on: (ev, fn) => { (solHandlers[ev] ||= []).push(fn); return () => { solHandlers[ev] = solHandlers[ev].filter((f) => f !== fn); }; } },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: (...inputs) => signTx(false, inputs) },
      "solana:signAndSendTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signAndSendTransaction: (...inputs) => signTx(true, inputs) },
      "solana:signMessage": { version: "1.0.0", signMessage: async (...inputs) => {
        if (!accounts.length) throw Object.assign(new Error("Connect Ecrin Wallet first."), { code: 4100 });
        const out = [];
        for (const i of inputs) { const sig = await call("sol", "signMessage", { message: bytes(i.message) }); out.push({ signedMessage: i.message, signature: new Uint8Array(sig) }); }
        return out;
      } },
    },
  };
  const register = (api) => { try { api.register(wallet); } catch (_) {} };
  try { window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register })); } catch (_) {}
  try { window.addEventListener("wallet-standard:app-ready", (e) => register(e.detail)); } catch (_) {}

  Object.defineProperty(window, "__ecrinWallet", { value: { ethereum: eth, solana: wallet }, configurable: false });
})();
