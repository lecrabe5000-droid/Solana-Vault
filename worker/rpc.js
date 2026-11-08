// A backup route to Solana devnet for the wallet: when the public server rate-limits a user, the wallet retries here.
// Only the methods the wallet uses are passed on, bodies are small, and the upstream can be a private node
// (SOL_RPC secret, e.g. a Helius devnet URL) or the public one.
const ALLOWED = new Set(["getBalance", "getAccountInfo", "getMultipleAccounts", "getLatestBlockhash", "sendTransaction", "simulateTransaction", "getSignatureStatuses",
  "getSignaturesForAddress", "getTransaction", "getTokenAccountsByOwner", "getTokenAccountBalance", "getProgramAccounts", "getMinimumBalanceForRentExemption", "getFeeForMessage",
  "getBlockHeight", "getSlot", "getEpochInfo", "getRecentPrioritizationFees", "isBlockhashValid", "getVersion", "getGenesisHash", "getHealth", "requestAirdrop"]);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, solana-client" };
const out = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS } });

export async function handleRpc(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return out({ error: "POST only" }, 405);
  const text = await request.text(); if (text.length > 64_000) return out({ error: "Request too large" }, 413);
  let body; try { body = JSON.parse(text); } catch (_) { return out({ error: "Bad JSON" }, 400); }
  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > 20 || calls.some((c) => !ALLOWED.has(c?.method))) return out({ jsonrpc: "2.0", id: calls[0]?.id ?? null, error: { code: -32601, message: "Method not available on this route" } }, 400);
  const upstream = env.SOL_RPC || "https://api.devnet.solana.com";
  const r = await fetch(upstream, { method: "POST", headers: { "content-type": "application/json" }, body: text });
  return out(await r.text(), r.status);
}
