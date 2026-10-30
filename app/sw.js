// Ecrin service worker: makes the app installable and keeps its shell available on a bad connection.
// Network first for everything; the cache is only a fallback. Never caches the API or other origins.
const CACHE = "ecrin-v1";
const SHELL = ["/app", "/app.css", "/dapp.js", "/chain.js", "/evm.js", "/vault.js", "/config.js", "/config-evm.js", "/theme.js", "/vendor/solana-web3.min.js", "/vendor/ethers.umd.min.js", "/icon-192.png"];

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
