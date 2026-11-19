// Private servers for the mainnet networks other than Solana, so their keys stay secret in Cloudflare:
//   GET  /api/rpc/status        → { private: ["ethm", "tronm", ...] }  which networks have a private server set
//   POST /api/rpc/<evm key>     → JSON-RPC to RPC_<KEY> (e.g. RPC_ETHM = an Alchemy or QuickNode URL)
//   POST /api/rpc/tronm/<path>  → TronGrid /wallet/... with TRON_API_KEY
//   POST /api/rpc/suim          → Sui GraphQL at SUI_MAINNET_GRAPHQL
//   GET  /api/rpc/btcm/<path>   → mempool.space's Bitcoin API (btc: testnet4); POST …/tx broadcasts a signed transaction
//   POST /api/rpc/xrpm          → XRP Ledger JSON-RPC (xrp: testnet); only the calls the wallet makes
//   (Bitcoin and XRP always come through here first: it keeps your IP away from those servers; direct servers are the backup.)
// The wallet only comes here for a network listed in /status; every other network it reaches directly on public
// servers, so nothing passes through Ecrin without a reason. Only the calls the wallet makes are passed on.
import { EVM_MAIN } from "../app/config-evm.js";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" };
const out = (body, status = 200, extra = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...extra } });
const EVM_OK = new Set(["eth_chainId", "eth_blockNumber", "eth_getBalance", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getTransactionCount",
  "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByNumber", "eth_getCode", "eth_getLogs", "eth_sendRawTransaction", "eth_simulateV1", "net_version"]);
const TRON_OK = new Set(["getnowblock", "getaccount", "broadcasthex", "triggerconstantcontract"]);
const XRP_BUSY = /"error"\s*:\s*"(slowDown|tooBusy|noNetwork|noCurrent|noClosed|amendmentBlocked)"/;
const XRP_OK = new Set(["account_info", "server_state", "fee", "ledger_current", "submit", "account_tx", "tx"]);
// Bitcoin: read an address, its coins and its history, the fee rates, a transaction; and broadcast one.
const BTC_GET = [/^address\/(bc1|tb1|[13mn2])[0-9A-Za-z]{20,90}(\/utxo|\/txs)?$/, /^v1\/fees\/recommended$/, /^fee-estimates$/, /^tx\/[0-9a-f]{64}(\/status)?$/, /^blocks\/tip\/height$/];
async function bitcoin(request, net, rest) {
  const path = rest.join("/"), base = net === "btcm" ? ["https://mempool.space/api", "https://blockstream.info/api"] : ["https://mempool.space/testnet4/api"];
  let init;
  if (request.method === "POST") {
    if (path !== "tx") return out({ error: "Not available on this route" }, 400);
    const raw = (await request.text()).trim(); if (!/^[0-9a-f]{120,200000}$/.test(raw)) return out({ error: "Bad transaction" }, 400);
    init = { method: "POST", body: raw };
  } else if (request.method === "GET") { if (!BTC_GET.some((re) => re.test(path))) return out({ error: "Not available on this route" }, 400); }
  else return out({ error: "Method not allowed" }, 405);
  let last = null;
  for (const b of base) {
    const r = await fetch(`${b}/${path}`, init).catch(() => null);
    if (r && (r.ok || (r.status >= 400 && r.status < 500))) return new Response(await r.text(), { status: r.status, headers: { "content-type": r.headers.get("content-type") || "text/plain", "cache-control": "no-store", ...CORS } });
    last = r;
  }
  return out({ error: "The Bitcoin servers are unreachable right now." }, last?.status || 502);
}
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
  if (net === "btcm" || net === "btc") return bitcoin(request, net, rest);
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
  if (net === "xrpm" || net === "xrp") {
    if (!XRP_OK.has(body?.method) || !Array.isArray(body?.params) || body.params.length > 1) return out({ error: "Not available on this route" }, 400);
    // Ripple's own servers first; the community cluster rate-limits shared server addresses like Cloudflare's.
    const ups = net === "xrpm" ? ["https://s1.ripple.com:51234", "https://s2.ripple.com:51234", "https://xrplcluster.com"] : ["https://s.altnet.rippletest.net:51234"];
    for (const u of ups) {
      const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: text }).catch(() => null);
      if (!r?.ok) continue;
      const t = await r.text();
      if (XRP_BUSY.test(t)) continue; // "slow down" or "too busy" comes back with a 200: try the next server
      return out(t, 200);
    }
    return out({ error: "The XRP Ledger servers are unreachable right now." }, 502);
  }
  if (net === "suim") {
    if (typeof body?.query !== "string" || body.query.length > 4000) return out({ error: "Bad query" }, 400);
    return send(isUrl(env.SUI_MAINNET_GRAPHQL) ? env.SUI_MAINNET_GRAPHQL : "https://graphql.mainnet.sui.io/graphql");
  }
  return out({ error: "Unknown network" }, 404);
}
