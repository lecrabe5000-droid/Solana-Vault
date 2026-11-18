// Buy crypto with a card through MoonPay. MoonPay takes the payment and does the identity checks; Ecrin only builds
// the link to MoonPay's page with the user's own address filled in, and signs it (MoonPay requires a signature when a
// link carries a wallet address). The server never touches money, cards or keys.
//   GET /api/buy/status                              → { on, test }
//   GET /api/buy?net=&addr=&coin=native|usdc&lang=   → { url, test }
// Cloudflare variables (Settings → Variables and Secrets):
//   MOONPAY_PK          publishable key (pk_test_… or pk_live_…). A test key opens MoonPay's sandbox, for Testnet only;
//                       a live key opens the real MoonPay, for Mainnet only.
//   MOONPAY_SECRET_KEY  (secret) signs the links. Nothing opens until both are set.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...CORS } });

// Ecrin network (without the mainnet "m") → MoonPay network codes, and the codes we expect for the coin and USDC.
export const NETS = {
  sol: { nc: ["solana"], native: "sol", usdc: "usdc_sol", fam: "sol" },
  eth: { nc: ["ethereum"], native: "eth", usdc: "usdc", fam: "evm" },
  base: { nc: ["base"], native: "eth_base", usdc: "usdc_base", fam: "evm" },
  arb: { nc: ["arbitrum"], native: "eth_arbitrum", usdc: "usdc_arbitrum", fam: "evm" },
  op: { nc: ["optimism"], native: "eth_optimism", usdc: "usdc_optimism", fam: "evm" },
  pol: { nc: ["polygon"], native: "pol_polygon", usdc: "usdc_polygon", fam: "evm" },
  bnb: { nc: ["bnb_chain", "binance_smart_chain", "bsc"], native: "bnb_bsc", usdc: "usdc_bsc", fam: "evm" },
  avax: { nc: ["avalanche_c_chain", "avalanche"], native: "avax_cchain", usdc: "usdc_cchain", fam: "evm" },
  sui: { nc: ["sui"], native: "sui", usdc: "usdc_sui", fam: "sui" },
  tron: { nc: ["tron"], native: "trx", usdc: null, fam: "tron" },
};
const ADDR = { sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, evm: /^0x[0-9a-fA-F]{40}$/, sui: /^0x[0-9a-fA-F]{64}$/, tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/ };

/** "solm" → { base: "sol", main: true }; "sol" → { base: "sol", main: false }; unknown → null. */
export function parseNet(key) {
  const k = String(key || "");
  if (NETS[k]) return { base: k, main: false };
  if (k.endsWith("m") && NETS[k.slice(0, -1)]) return { base: k.slice(0, -1), main: true };
  return null;
}
export const keyMode = (env) => (/^pk_live_/.test(env.MOONPAY_PK || "") ? "live" : /^pk_test_/.test(env.MOONPAY_PK || "") ? "test" : null);
export const buyOn = (env) => !!(keyMode(env) && env.MOONPAY_SECRET_KEY);

/** Picks MoonPay's currency code for a network and coin from MoonPay's own list (so a renamed code still works),
 *  falling back to the expected code when the list can't be read. */
export function pickCode(list, base, coin) {
  const n = NETS[base], want = coin === "usdc" ? n.usdc : n.native;
  if (!want) return null;
  const live = (Array.isArray(list) ? list : []).filter((c) => c?.type === "crypto" && !c.isSuspended && n.nc.includes(String(c.metadata?.networkCode || "").toLowerCase()));
  if (!live.length) return want;
  if (live.some((c) => c.code === want)) return want;
  const m = coin === "usdc" ? live.find((c) => /^usdc(_|$)/.test(c.code)) : live.find((c) => !c.metadata?.contractAddress);
  return m ? m.code : null;
}

let cache = { at: 0, list: null };
async function currencies() {
  if (cache.list && Date.now() - cache.at < 6 * 3600e3) return cache.list;
  try {
    const r = await fetch("https://api.moonpay.com/v3/currencies", { headers: { Accept: "application/json" } });
    if (r.ok) { const list = await r.json(); if (Array.isArray(list)) cache = { at: Date.now(), list }; }
  } catch (_) {}
  return cache.list;
}

/** Which coins MoonPay offers per network, right now: in test mode only those MoonPay marks as test-mode ready.
 *  { sol: { native: true, usdc: false }, ... }; unknown (list unreachable) is left out, and the wallet tries anyway. */
export async function coinSupport(mode, list) {
  list = list || (await currencies()); if (!Array.isArray(list)) return {};
  const out = {};
  for (const base of Object.keys(NETS)) {
    const row = {};
    for (const coin of ["native", "usdc"]) {
      const code = pickCode(list, base, coin), c = code && list.find((x) => x.code === code);
      row[coin] = !!c && !c.isSuspended && (mode !== "test" || c.supportsTestMode === true);
    }
    out[base] = row;
  }
  return out;
}

/** MoonPay's signature: base64 HMAC-SHA256 of the query string (with its "?"), keyed with the secret key. */
export async function sign(query, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(query)));
  return btoa(String.fromCharCode(...mac));
}

export async function handleBuy(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const mode = keyMode(env);
  if (url.pathname === "/api/buy/status") return json({ on: buyOn(env), test: mode === "test", coins: buyOn(env) ? await coinSupport(mode) : null });
  if (!buyOn(env)) return json({ error: "Buying with a card is coming soon.", code: "BUY_SOON" }, 503);
  const q = url.searchParams, net = parseNet(q.get("net")), addr = q.get("addr") || "", coin = q.get("coin") === "usdc" ? "usdc" : "native";
  if (!net) return json({ error: "This network can't be bought on yet." }, 400);
  if (net.main !== (mode === "live")) return json({ error: net.main ? "Buying on Mainnet opens soon." : "Test purchases are only on Testnet.", code: "BUY_SOON" }, 503);
  if (!ADDR[NETS[net.base].fam].test(addr)) return json({ error: "That address doesn't match this network." }, 400);
  const list = await currencies(), code = pickCode(list, net.base, coin);
  if (!code) return json({ error: "MoonPay doesn't offer this coin on this network." }, 400);
  const cur = Array.isArray(list) ? list.find((x) => x.code === code) : null;
  if (mode === "test" && cur && cur.supportsTestMode !== true) return json({ error: "MoonPay's test mode doesn't offer this coin. It opens with mainnet.", code: "BUY_NOT_IN_TEST" }, 400);
  const p = new URLSearchParams({ apiKey: env.MOONPAY_PK, currencyCode: code, walletAddress: addr, colorCode: "#2F5BFF", language: q.get("lang") === "fr" ? "fr" : "en" });
  if (q.get("theme") === "light" || q.get("theme") === "dark") p.set("theme", q.get("theme"));
  const query = "?" + p.toString();
  const host = mode === "live" ? "https://buy.moonpay.com" : "https://buy-sandbox.moonpay.com";
  return json({ url: `${host}/${query}&signature=${encodeURIComponent(await sign(query, env.MOONPAY_SECRET_KEY))}`, test: mode === "test", code });
}
