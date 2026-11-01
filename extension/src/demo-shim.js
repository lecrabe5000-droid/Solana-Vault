// Web demo only: stands in for the chrome.* APIs so the real wallet screens run on a web page.
// Storage lives in this browser's localStorage under ecrin-demo-*; the "session" lives in memory.
const KEY = "ecrin-demo-local";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (_) { return {}; } };
const write = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (_) {} };
const pick = (o, k) => (k == null ? o : Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in o).map((x) => [x, o[x]])));
let mem = {};
globalThis.ECRIN_DEMO = true;
globalThis.chrome = {
  storage: {
    local: { get: async (k) => pick(read(), k), set: async (o) => write({ ...read(), ...o }), remove: async (k) => { const o = read(); [].concat(k).forEach((x) => delete o[x]); write(o); }, clear: async () => write({}) },
    session: { get: async (k) => pick(mem, k), set: async (o) => { mem = { ...mem, ...o }; }, clear: async () => { mem = {}; }, setAccessLevel: () => {} },
  },
  runtime: { getManifest: () => ({ version: "0.1.0 · demo" }), sendMessage: () => Promise.resolve(), connect: () => ({ onDisconnect: { addListener() {} } }) },
};
export {};
