// Ecrin service worker: makes the app installable and keeps its shell available on a bad connection.
// Network first for everything; the cache is only a fallback. Never caches the API or other origins.
const CACHE = "ecrin-v147";
const SHELL = ["/app", "/app.css", "/dapp.js", "/chain.js", "/evm.js", "/vault.js", "/config.js", "/config-evm.js", "/deployments-evm.js", "/config-tokens.js", "/config-wc.js", "/i18n.js", "/theme.js", "/vendor/solana-web3.min.js", "/vendor/ethers.umd.min.js", "/icon2-192.png",
  "/wallet/wallet.css", "/wallet/wallet.js", "/wallet/theme-boot.js", "/wallet/sw-reg.js"]; // the phone wallet always has a copy to fall back on

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Pages themselves always come straight from the network (the browser handles them), so a new version is never
  // hidden behind an old copy and a page can never fail to open because of this worker.
  if (e.request.mode === "navigate") return;
  e.respondWith((async () => {
    const net = fetch(e.request).then((res) => { if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); } return res; });
    try {
      return await net;
    } catch (err) {
      // Offline: the last copy if there is one; otherwise the same network error the browser would have shown.
      const hit = await caches.match(e.request).catch(() => null);
      if (hit) return hit;
      throw err;
    }
  })());
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "Ecrin", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Ecrin", { body: d.body || "", icon: "/icon2-192.png", badge: "/icon2-192.png", tag: d.tag, renotify: true, data: { url: d.url || "/app" } }));
});
// Which app turned alerts on (the phone wallet or the protocol app), kept so a tap opens that one.
self.addEventListener("message", (e) => { if (e.data?.type === "ecrin-open" && ["wallet", "app"].includes(e.data.app)) e.waitUntil(caches.open("ecrin-prefs").then((c) => c.put("/__open", new Response(e.data.app)))); });
const openWith = () => caches.open("ecrin-prefs").then((c) => c.match("/__open")).then((r) => (r ? r.text() : "app")).catch(() => "app");
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(openWith().then((app) => {
    if (app === "wallet") return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).pathname.startsWith("/wallet"));
      if (open) { open.navigate("/wallet/?go=vault").catch(() => {}); return open.focus(); }
      return self.clients.openWindow("/wallet/?go=vault");
    });
    return openApp(e);
  }));
});
function openApp(e) {
  const url = e.notification.data?.url || "/app";
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).pathname.startsWith("/app"));
    if (open) { open.navigate(url).catch(() => {}); return open.focus(); }
    return self.clients.openWindow(url);
  });
}
