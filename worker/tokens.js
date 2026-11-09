// Token search by name for the wallet's "Add a token" screen: GET /api/tokens?q=pepe&chain=base
// Looks the name up on DexScreener (public, no key), keeps the chain asked for, one entry per token (its most liquid
// market), and returns the price and liquidity so a person can tell the real token from copies with the same name.
// Cached for a minute per query. Test networks have no markets: the wallet uses its own checked list there.
const CHAINS = new Set(["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "avalanche", "solana"]);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS" };
const out = (body, status = 200, maxAge = 0) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store", ...CORS } });

/** One row per token, most liquid first; pure, so it can be tested without the network. */
export function pickTokens(pairs, chain, limit = 8) {
  const best = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (p?.chainId !== chain || !p.baseToken?.address) continue;
    const key = String(p.baseToken.address).toLowerCase(), liq = Number(p.liquidity?.usd) || 0;
    const row = { address: String(p.baseToken.address), name: String(p.baseToken.name || "").slice(0, 40), symbol: String(p.baseToken.symbol || "").slice(0, 12),
      price: Number(p.priceUsd) || null, liq, vol: Number(p.volume?.h24) || 0, icon: /^https:\/\//.test(p.info?.imageUrl || "") ? p.info.imageUrl : null };
    const was = best.get(key); if (!was || liq > was.liq) best.set(key, row);
  }
  return [...best.values()].sort((a, b) => b.liq - a.liq).slice(0, limit);
}

export async function handleTokens(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET") return out({ error: "GET only" }, 405);
  const url = new URL(request.url), q = (url.searchParams.get("q") || "").trim().slice(0, 40), chain = url.searchParams.get("chain") || "";
  if (q.length < 2 || !CHAINS.has(chain)) return out({ error: "Give a name (2+ letters) and a known chain." }, 400);
  const cacheKey = new Request(`https://cache.ecrin/tokens?chain=${chain}&q=${encodeURIComponent(q.toLowerCase())}`);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const hit = cache && (await cache.match(cacheKey)); if (hit) return hit;
  let pairs = [];
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, { headers: { accept: "application/json" } });
    if (!r.ok) return out({ error: "Market data is busy. Try again in a moment." }, 502);
    pairs = (await r.json())?.pairs || [];
  } catch (_) { return out({ error: "Market data is unreachable right now." }, 502); }
  const res = out({ tokens: pickTokens(pairs, chain) }, 200, 60);
  if (cache) await cache.put(cacheKey, res.clone());
  return res;
}
