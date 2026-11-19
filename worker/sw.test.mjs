// The service worker must define its cache and never hand the browser an empty response.
import fs from "node:fs";
import assert from "node:assert/strict";
const src = fs.readFileSync(new URL("../app/sw.js", import.meta.url), "utf8");
assert.match(src, /^const CACHE = "ecrin-v\d+";$/m, "sw.js lost its CACHE line");
const handlers = {};
const self = { addEventListener: (t, f) => (handlers[t] = f), skipWaiting() {}, clients: { claim() {} }, location: { origin: "https://x" } };
const cachesStub = { open: async () => ({ addAll: async () => {}, put: async () => {} }), keys: async () => [], match: async () => undefined, delete: async () => true };
new Function("self", "caches", "location", "fetch", src)(self, cachesStub, self.location, async () => { throw new TypeError("offline"); });
assert.ok(handlers.fetch);
let responded = null;
handlers.fetch({ request: { method: "GET", url: "https://x/wallet/wallet.js", mode: "cors" }, respondWith: (p) => (responded = p) });
await assert.rejects(responded); // offline with no copy: a real network error, never a null response
let navResponded = false;
handlers.fetch({ request: { method: "GET", url: "https://x/wallet/", mode: "navigate" }, respondWith: () => (navResponded = true) });
assert.equal(navResponded, false); // pages go straight to the network
console.log("sw ok");
