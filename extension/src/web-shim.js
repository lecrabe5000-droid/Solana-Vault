// Ecrin Wallet on phones (ecrinprotocol.app/wallet/): the same wallet as the browser extension, running as a web
// app you add to your home screen. This file stands in for the chrome.* APIs the extension uses:
// - storage.local → this browser's localStorage (key "ecrin-wallet-web"). It holds the recovery phrase only
//   encrypted (PBKDF2-SHA256 600,000 rounds + AES-256-GCM), plus settings and public addresses.
// - storage.session → memory only: the unlocked phrase disappears when the page closes or auto-lock runs.
// - auto-lock → a timer in the page instead of the extension's background alarm.
const KEY = "ecrin-wallet-web";
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
// Developer overrides (a test network, another program) only work on a developer's own machine, so a script that
// ever ran on the website couldn't quietly point the wallet at a fake network.
const read = () => { try { const o = JSON.parse(localStorage.getItem(KEY) || "{}"); if (!LOCAL) delete o.dev; return o; } catch (_) { return {}; } };
const write = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (_) {} };
const pick = (o, k) => (k == null ? o : Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in o).map((x) => [x, o[x]])));
let mem = {}, timer = 0;
const lockNow = () => { const had = !!mem.phrase; mem = {}; clearTimeout(timer); if (had) location.reload(); };
globalThis.ECRIN_WEB = true;
globalThis.chrome = {
  storage: {
    local: { get: async (k) => pick(read(), k), set: async (o) => write({ ...read(), ...o }), remove: async (k) => { const o = read(); [].concat(k).forEach((x) => delete o[x]); write(o); }, clear: async () => write({}) },
    session: { get: async (k) => pick(mem, k), set: async (o) => { mem = { ...mem, ...o }; }, clear: async () => { mem = {}; }, setAccessLevel: () => {} },
  },
  runtime: {
    getManifest: () => ({ version: "0.2.0 · phone beta" }),
    sendMessage: async (m) => {
      if (m?.type === "autolock" && m.until) { clearTimeout(timer); timer = setTimeout(lockNow, Math.max(0, m.until - Date.now())); }
      if (m?.type === "lock") lockNow();
      return null;
    },
    connect: () => ({ onDisconnect: { addListener() {} }, postMessage() {} }),
  },
};
// "Always" auto-lock: lock as soon as the app goes to the background.
document.addEventListener("visibilitychange", () => { if (document.hidden && read().autolock === 0) lockNow(); });
export {};
