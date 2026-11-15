// Private servers for the mainnet networks other than Solana, so their keys stay secret in Cloudflare:
//   GET  /api/rpc/status        → { private: ["ethm", "tronm", ...] }  which networks have a private server set
//   POST /api/rpc/<evm key>     → JSON-RPC to RPC_<KEY> (e.g. RPC_ETHM = an Alchemy or QuickNode URL)
//   POST /api/rpc/tronm/<path>  → TronGrid /wallet/... with TRON_API_KEY
//   POST /api/rpc/suim          → Sui GraphQL at SUI_MAINNET_GRAPHQL
// The wallet only comes here for a network listed in /status; every other network it reaches directly on public
// servers, so nothing passes through Ecrin without a reason. Only the calls the wallet makes are passed on.
import { EVM_MAIN } from "../app/config-evm.js";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" };
const out = (body, status = 200, extra = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...extra } });
const EVM_OK = new Set(["eth_chainId", "eth_blockNumber", "eth_getBalance", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getTransactionCount",
  "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByNumber", "eth_getCode", "eth_getLogs", "eth_sendRawTransaction", "eth_simulateV1", "net_version"]);
const TRON_OK = new Set(["getnowblock", "getaccount", "broadcasthex", "triggerconstantcontract"]);
const isUrl = (u) => /^https:\/\/[^\s]+$/.test(String(u || ""));
const evmVar = (k) => "RPC_" + k.toUpperCase();

/** Which networks have a private server configured (never the servers themselves). */
export function privateNets(env) {
  const list = Object.keys(EVM_MAIN).filter((k) => isUrl(env[evmVar(k)]));
  if (env.TRON_API_KEY) list.push("tronm");
  if (isUrl(env.SUI_MAINNET_GRAPHQL)) list.push("suim");
  return list;
}

export async function handleRpc2(request, env, path) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const [net, ...rest] = path.split("/");
  if (net === "status") return out({ private: privateNets(env) }, 200, { "cache-control": "public, max-age=300" });
  if (request.method !== "POST") return out({ error: "POST only" }, 405);
  const text = await request.text(); if (text.length > 64_000) return out({ error: "Request too large" }, 413);
  let body; try { body = JSON.parse(text); } catch (_) { return out({ error: "Bad JSON" }, 400); }
  const send = (url, headers = {}) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: text }).then(async (r) => out(await r.text(), r.status), () => out({ error: "The network's server is unreachable right now." }, 502));

  if (EVM_MAIN[net]) {
    const calls = Array.isArray(body) ? body : [body];
    if (!calls.length || calls.length > 20 || calls.some((c) => !EVM_OK.has(c?.method))) return out({ jsonrpc: "2.0", id: calls[0]?.id ?? null, error: { code: -32601, message: "Method not available on this route" } }, 400);
    return send(isUrl(env[evmVar(net)]) ? env[evmVar(net)] : EVM_MAIN[net].rpc);
  }
  if (net === "tronm") {
    if (rest[0] !== "wallet" || !TRON_OK.has(rest[1]) || rest.length !== 2) return out({ error: "Not available on this route" }, 400);
    return send(`https://api.trongrid.io/wallet/${rest[1]}`, env.TRON_API_KEY ? { "TRON-PRO-API-KEY": env.TRON_API_KEY } : {});
  }
  if (net === "suim") {
    if (typeof body?.query !== "string" || body.query.length > 4000) return out({ error: "Bad query" }, 400);
    return send(isUrl(env.SUI_MAINNET_GRAPHQL) ? env.SUI_MAINNET_GRAPHQL : "https://graphql.mainnet.sui.io/graphql");
  }
  return out({ error: "Unknown network" }, 404);
}
