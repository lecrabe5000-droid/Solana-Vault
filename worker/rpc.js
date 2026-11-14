// A route to Solana for the wallet. /api/rpc/sol is devnet (the backup when the public server rate-limits a user);
// /api/rpc/solm is mainnet, real money (the first choice, so a private node can serve it). Only the methods the wallet
// uses are passed on, bodies are small. Upstreams: SOL_RPC / SOL_MAINNET_RPC secrets (e.g. Helius URLs) or the public ones.
const ALLOWED = new Set(["getBalance", "getAccountInfo", "getMultipleAccounts", "getLatestBlockhash", "sendTransaction", "simulateTransaction", "getSignatureStatuses",
  "getSignaturesForAddress", "getTransaction", "getTokenAccountsByOwner", "getTokenAccountBalance", "getProgramAccounts", "getMinimumBalanceForRentExemption", "getFeeForMessage",
  "getBlockHeight", "getSlot", "getEpochInfo", "getRecentPrioritizationFees", "isBlockhashValid", "getVersion", "getGenesisHash", "getHealth", "requestAirdrop"]);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, solana-client" };
const out = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS } });

export async function handleRpc(request, env, net = "sol") {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return out({ error: "POST only" }, 405);
  const text = await request.text(); if (text.length > 64_000) return out({ error: "Request too large" }, 413);
  let body; try { body = JSON.parse(text); } catch (_) { return out({ error: "Bad JSON" }, 400); }
  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > 20 || calls.some((c) => !ALLOWED.has(c?.method) || (net === "solm" && c.method === "requestAirdrop"))) return out({ jsonrpc: "2.0", id: calls[0]?.id ?? null, error: { code: -32601, message: "Method not available on this route" } }, 400);
  // Mainnet (real money) has its own upstream: SOL_MAINNET_RPC (e.g. a Helius mainnet URL) or Solana's public server.
  const upstream = net === "solm" ? env.SOL_MAINNET_RPC || "https://api.mainnet-beta.solana.com" : env.SOL_RPC || "https://api.devnet.solana.com";
  const r = await fetch(upstream, { method: "POST", headers: { "content-type": "application/json" }, body: text });
  return out(await r.text(), r.status);
}
