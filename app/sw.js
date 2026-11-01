// Ecrin service worker: makes the app installable and keeps its shell available on a bad connection.
// Network first for everything; the cache is only a fallback. Never caches the API or other origins.
const CACHE = "ecrin-v4";
const SHELL = ["/app", "/app.css", "/dapp.js", "/chain.js", "/evm.js", "/vault.js", "/config.js", "/config-evm.js", "/deployments-evm.js", "/config-tokens.js", "/config-wc.js", "/i18n.js", "/theme.js", "/vendor/solana-web3.min.js", "/vendor/ethers.umd.min.js", "/icon-192.png"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("/app"))));
});

// Alerts as notifications on this device (sent by the worker through the browser's push service).
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "Ecrin", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Ecrin", { body: d.body || "", icon: "/icon-192.png", badge: "/icon-192.png", tag: d.tag, renotify: true, data: { url: d.url || "/app" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/app";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).pathname.startsWith("/app"));
    if (open) { open.navigate(url).catch(() => {}); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
