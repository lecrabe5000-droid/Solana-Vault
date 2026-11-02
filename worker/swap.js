// Swap relay to Jupiter (Swap API v2), so the Jupiter API key stays secret on the server and every swap carries
// Ecrin's referral fee. Users sign in Ecrin Wallet: the server never holds funds or keys. Same design as
// TrenchSight's relay.
//   GET  /api/swap/status                                  → { mode, feeBps }
//   GET  /api/swap?inputMint=&outputMint=&amount=&taker=   → Jupiter /order (quote, plus the unsigned transaction)
//   POST /api/swap { signedTransaction, requestId }        → Jupiter /execute
// Cloudflare variables (Settings → Variables and Secrets):
//   JUPITER_API_KEY (secret)       nothing works until it's set: the relay answers "coming soon"
//   JUPITER_REFERRAL_ACCOUNT       Ecrin's referral account (public address), where swap fees collect
//   JUPITER_FEE_BPS                fee in basis points, 50–255 (default 50 = 0.5%)
//   SWAP_ENABLED                   "1" to open swaps; anything else keeps them closed even with a key
const JUP = "https://api.jup.ag/swap/v2";
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...CORS } });

export const swapMode = (env) => (env.JUPITER_API_KEY && env.SWAP_ENABLED === "1" ? "on" : "soon");
export function swapFeeBps(env) {
  const n = Math.round(Number(env.JUPITER_FEE_BPS));
  return Number.isFinite(n) && n > 0 ? Math.min(255, Math.max(50, n)) : 50;
}

async function jupiter(env, path, init = {}) {
  let res;
  try { res = await fetch(JUP + path, { ...init, headers: { ...(init.headers || {}), "x-api-key": env.JUPITER_API_KEY, Accept: "application/json" } }); }
  catch (_) { return json({ error: "Jupiter is unreachable right now" }, 502); }
  if (res.status === 429) return json({ error: "Swaps are busy, try again in a few seconds", code: "RATE" }, 429);
  return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });
}

export async function handleSwap(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === "/api/swap/status") return json({ mode: swapMode(env), feeBps: swapFeeBps(env) });
  if (swapMode(env) !== "on") return json({ error: "Swaps open with mainnet. Coming soon.", code: "SWAP_SOON" }, 503);
  if (request.method === "GET") {
    const q = url.searchParams, inputMint = q.get("inputMint") || "", outputMint = q.get("outputMint") || "", amount = q.get("amount") || "", taker = q.get("taker") || "";
    if (!SOLANA.test(inputMint) || !SOLANA.test(outputMint) || inputMint === outputMint) return json({ error: "Bad token" }, 400);
    if (!/^[1-9]\d{0,19}$/.test(amount)) return json({ error: "Bad amount" }, 400);
    if (taker && !SOLANA.test(taker)) return json({ error: "Bad wallet" }, 400);
    const params = new URLSearchParams({ inputMint, outputMint, amount });
    if (taker) params.set("taker", taker);
    if (SOLANA.test(env.JUPITER_REFERRAL_ACCOUNT || "")) { params.set("referralAccount", env.JUPITER_REFERRAL_ACCOUNT); params.set("referralFee", String(swapFeeBps(env))); }
    return jupiter(env, "/order?" + params);
  }
  if (request.method === "POST") {
    let input; try { input = await request.json(); } catch (_) { return json({ error: "Invalid JSON" }, 400); }
    const signedTransaction = String(input?.signedTransaction || ""), requestId = String(input?.requestId || "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signedTransaction) || signedTransaction.length > 8000) return json({ error: "Bad transaction" }, 400);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) return json({ error: "Bad request id" }, 400);
    return jupiter(env, "/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signedTransaction, requestId }) });
  }
  return json({ error: "Method not allowed" }, 405);
}
