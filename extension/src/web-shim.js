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
// Keep the app upright when the phone turns sideways (see the phone stylesheet). Phones only, never a computer.
const keepUpright = () => {
  // The phone's real orientation (its angle), not the page's shape: on Android the keyboard shrinks the page until it is
  // wider than tall, and that must not turn the app sideways while you type.
  const touch = matchMedia("(pointer: coarse)").matches, a = Number(screen.orientation?.angle ?? (typeof window.orientation === "number" ? window.orientation : 0));
  const turned = a === 90 || a === -90 || a === 270;
  const side = touch && Math.min(screen.width, screen.height) < 600 && turned && innerWidth > innerHeight ? (a === -90 || a === 270 ? "-90" : "90") : null;
  if (side) document.documentElement.dataset.rot = side; else delete document.documentElement.dataset.rot;
};
// Phones report the new angle at slightly different moments (iPhone often after the resize), so look again a few times.
const recheck = () => { keepUpright(); for (const ms of [60, 200, 450, 800]) setTimeout(keepUpright, ms); };
keepUpright(); addEventListener("resize", recheck); addEventListener("orientationchange", recheck);
screen.orientation?.addEventListener?.("change", recheck);
document.addEventListener("visibilitychange", () => { if (!document.hidden) recheck(); }); // back from the background: the phone may have turned meanwhile
// Like a native app, the phone wallet never zooms: a pinch or a double tap used to leave it zoomed in and shifted
// sideways. Block the pinch (iPhone), and undo any zoom or sideways shift that is already there.
document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
document.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
const unzoom = () => {
  const m = document.querySelector('meta[name="viewport"]');
  if (m && globalThis.visualViewport && visualViewport.scale > 1.01) { const c = m.content; m.content = c.replace(/,\s*maximum-scale=[\d.]+/, "") + ", maximum-scale=1"; }
  if (scrollX) scrollTo(0, scrollY);
};
unzoom(); addEventListener("resize", unzoom); globalThis.visualViewport?.addEventListener?.("resize", unzoom);
document.addEventListener("visibilitychange", () => { if (!document.hidden) unzoom(); });
// Where the system allows it (an installed app on Android), lock portrait outright; iPhone ignores this, the turn-back above covers it.
try { screen.orientation?.lock?.("portrait")?.catch?.(() => {}); } catch (_) {}
globalThis.chrome = {
  storage: {
    local: { get: async (k) => pick(read(), k), set: async (o) => write({ ...read(), ...o }), remove: async (k) => { const o = read(); [].concat(k).forEach((x) => delete o[x]); write(o); }, clear: async () => write({}) },
    session: { get: async (k) => pick(mem, k), set: async (o) => { mem = { ...mem, ...o }; }, clear: async () => { mem = {}; }, setAccessLevel: () => {} },
  },
  runtime: {
    getManifest: () => ({ version: __ECRIN_VERSION__ }),
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
