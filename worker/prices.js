// One price feed for every Ecrin wallet and app: GET /api/prices
// Fetched here once a minute (cached at the edge) instead of by each person's browser, so a busy day doesn't get
// everyone rate-limited by CoinGecko and left with prices but no 24h change. CoinGecko first, Coinbase as backup.
// Shape matches CoinGecko's simple/price: { solana: { usd, usd_24h_change, usd_market_cap, usd_24h_vol }, ... }
export const COINS = { solana: "SOL", ethereum: "ETH", "polygon-ecosystem-token": "POL", binancecoin: "BNB", "avalanche-2": "AVAX", tron: "TRX", "usd-coin": "USDC", "euro-coin": "EURC", chainlink: "LINK", uniswap: "UNI" };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS" };
const out = (body, status = 200, maxAge = 0) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store", ...CORS } });
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Keeps only coins with a usable price, and only numbers. Pure, so it can be tested without the network. */
export function cleanPrices(j) {
  const res = {};
  for (const id of Object.keys(COINS)) {
    const p = j?.[id], usd = num(p?.usd); if (usd == null || usd <= 0) continue;
    res[id] = { usd, usd_24h_change: num(p.usd_24h_change), usd_market_cap: num(p.usd_market_cap), usd_24h_vol: num(p.usd_24h_vol) };
  }
  return res;
}
/** Coinbase's 24h stats ({ open, last, volume }) in the same shape. */
export function fromCoinbase(stats) {
  const res = {};
  for (const [id, s] of Object.entries(stats)) {
    const last = num(s?.last), open = num(s?.open); if (last == null || last <= 0) continue;
    res[id] = { usd: last, usd_24h_change: open ? ((last - open) / open) * 100 : null, usd_market_cap: null, usd_24h_vol: num(s.volume) != null ? num(s.volume) * last : null };
  }
  return res;
}

async function getJSON(url) { const r = await fetch(url, { headers: { accept: "application/json" } }); if (!r.ok) throw new Error(String(r.status)); return r.json(); }

export async function handlePrices(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET") return out({ error: "GET only" }, 405);
  const cache = typeof caches !== "undefined" ? caches.default : null, key = new Request("https://cache.ecrin/prices/v1");
  const hit = cache && (await cache.match(key)); if (hit) return hit;
  let prices = {};
  try {
    const head = env?.COINGECKO_KEY ? { "x-cg-demo-api-key": env.COINGECKO_KEY } : {};
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${Object.keys(COINS).join(",")}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`, { headers: { accept: "application/json", ...head } });
    if (r.ok) prices = cleanPrices(await r.json());
  } catch (_) {}
  // Fill anything CoinGecko didn't give (down, rate-limited, or no 24h change) from Coinbase.
  const missing = Object.entries(COINS).filter(([id, sym]) => sym !== "USDC" && (!prices[id] || prices[id].usd_24h_change == null));
  if (missing.length) {
    const stats = {};
    await Promise.all(missing.map(async ([id, sym]) => { try { stats[id] = await getJSON(`https://api.exchange.coinbase.com/products/${sym}-USD/stats`); } catch (_) {} }));
    for (const [id, p] of Object.entries(fromCoinbase(stats))) prices[id] = prices[id] ? { ...prices[id], usd_24h_change: prices[id].usd_24h_change ?? p.usd_24h_change } : p;
  }
  if (!prices.solana) return out({ error: "Prices are unreachable right now." }, 502);
  const res = out({ at: Date.now(), prices }, 200, 60);
  if (cache) await cache.put(key, res.clone());
  return res;
}
