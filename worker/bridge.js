// Bridges through LI.FI: move USDC or ETH between networks from inside Ecrin Wallet. LI.FI builds the transaction;
// the user signs it in the wallet, which checks it first. Ecrin's fee and integrator name are added here, on the
// server, so a wallet can't change them. The server never holds funds or keys.
//   GET /api/bridge/status                                                  → { on, fee }
//   GET /api/bridge/quote?from=&to=&coin=native|usdc&amount=&fromAddress=&toAddress=  → a quote with the transaction
//   GET /api/bridge/track?tx=&from=&to=&bridge=                             → { status, substatus, receiving }
// Cloudflare variables (Settings → Variables and Secrets):
//   LIFI_INTEGRATOR   Ecrin's integrator name from LI.FI's Partner Portal (portal.li.fi), with fee wallets set there.
//                     Bridges stay closed until it's set: without it LI.FI can't pay Ecrin's fee.
//   LIFI_FEE          Ecrin's fee as a fraction (default 0.00875 = 0.875%)
//   LIFI_API_KEY      (secret, optional) higher rate limits
import { EVM_MAIN } from "../app/config-evm.js";
import { SOL_USDC } from "../app/config-tokens.js";

const API = "https://li.quest/v1";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...CORS } });

const ETH = "0x0000000000000000000000000000000000000000", SOL = "11111111111111111111111111111111";
/** Ecrin's mainnet networks that can bridge, with LI.FI's chain id (from its /v1/chains) and the coins offered. */
export const BRIDGE_NETS = {
  solm: { chain: "SOL", fam: "sol", usdc: SOL_USDC.mainnet, native: SOL, unit: "SOL" },
  ethm: { chain: 1, fam: "evm", usdc: EVM_MAIN.ethm.usdc, native: ETH, unit: "ETH" },
  basem: { chain: 8453, fam: "evm", usdc: EVM_MAIN.basem.usdc, native: ETH, unit: "ETH" },
  arbm: { chain: 42161, fam: "evm", usdc: EVM_MAIN.arbm.usdc, native: ETH, unit: "ETH" },
  opm: { chain: 10, fam: "evm", usdc: EVM_MAIN.opm.usdc, native: ETH, unit: "ETH" },
  polm: { chain: 137, fam: "evm", usdc: EVM_MAIN.polm.usdc, native: null, unit: "POL" },
  avaxm: { chain: 43114, fam: "evm", usdc: EVM_MAIN.avaxm.usdc, native: null, unit: "AVAX" },
  hypem: { chain: 999, fam: "evm", usdc: EVM_MAIN.hypem.usdc, native: null, unit: "HYPE" },
};
const ADDR = { sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, evm: /^0x[0-9a-fA-F]{40}$/ };

export const bridgeFee = (env) => { const f = Number(env.LIFI_FEE); return Number.isFinite(f) && f >= 0 && f < 0.05 ? f : 0.00875; };
export const bridgeOn = (env) => /^[A-Za-z0-9._-]{2,40}$/.test(env.LIFI_INTEGRATOR || "");

/** The coin to send and to receive. ETH bridges to ETH; USDC to USDC. Null when that coin isn't on both networks. */
export function bridgeTokens(from, to, coin) {
  const a = BRIDGE_NETS[from], b = BRIDGE_NETS[to];
  if (!a || !b || from === to) return null;
  if (coin === "usdc") return a.usdc && b.usdc ? [a.usdc, b.usdc] : null;
  if (a.unit !== "ETH" || b.unit !== "ETH") return null; // native: ETH between Ethereum and its networks only
  return [a.native, b.native];
}

async function lifi(env, path) {
  const headers = { Accept: "application/json" };
  if (env.LIFI_API_KEY) headers["x-lifi-api-key"] = env.LIFI_API_KEY;
  let res; try { res = await fetch(API + path, { headers }); } catch (_) { return [null, "LI.FI is unreachable right now. Try again in a minute."]; }
  const body = await res.json().catch(() => null);
  if (res.status === 429) return [null, "Bridges are busy. Try again in a few seconds."];
  if (!res.ok) return [null, body?.message ? String(body.message).slice(0, 200) : `LI.FI answered ${res.status}`];
  return [body, null];
}

export async function handleBridge(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (url.pathname === "/api/bridge/status") return json({ on: bridgeOn(env), fee: bridgeFee(env), nets: Object.keys(BRIDGE_NETS) });
  if (!bridgeOn(env)) return json({ error: "Bridges are coming soon.", code: "BRIDGE_SOON" }, 503);
  const q = url.searchParams;

  if (url.pathname === "/api/bridge/quote") {
    const from = q.get("from"), to = q.get("to"), coin = q.get("coin") === "usdc" ? "usdc" : "native", amount = q.get("amount") || "";
    const tk = bridgeTokens(from, to, coin);
    if (!tk) return json({ error: "This coin can't be bridged between these networks." }, 400);
    if (!/^[1-9]\d{0,29}$/.test(amount)) return json({ error: "Bad amount" }, 400);
    const A = BRIDGE_NETS[from], B = BRIDGE_NETS[to], fa = q.get("fromAddress") || "", ta = q.get("toAddress") || "";
    if (!ADDR[A.fam].test(fa) || !ADDR[B.fam].test(ta)) return json({ error: "That address doesn't match the network." }, 400);
    const p = new URLSearchParams({ fromChain: String(A.chain), toChain: String(B.chain), fromToken: tk[0], toToken: tk[1], fromAmount: amount, fromAddress: fa, toAddress: ta,
      integrator: env.LIFI_INTEGRATOR, fee: String(bridgeFee(env)), slippage: "0.005", order: "RECOMMENDED" });
    const [qt, err] = await lifi(env, "/quote?" + p);
    if (err) return json({ error: /no available quotes|no route/i.test(err) ? "No bridge can move this amount right now. Try a larger amount." : err }, 502);
    const e = qt.estimate || {}, t = qt.transactionRequest || {};
    const usd = (list) => (list || []).reduce((s, c) => s + (Number(c.amountUSD) || 0), 0);
    return json({
      tool: qt.toolDetails?.name || qt.tool, bridge: qt.tool, toAmount: e.toAmount, toAmountMin: e.toAmountMin, seconds: e.executionDuration,
      feesUSD: usd(e.feeCosts), gasUSD: usd(e.gasCosts), fee: bridgeFee(env),
      approval: A.fam === "evm" && tk[0] !== ETH ? e.approvalAddress || null : null,
      tx: A.fam === "sol" ? { sol: t.data } : { to: t.to, data: t.data, value: t.value || "0x0", gasLimit: t.gasLimit || null },
      fromToken: tk[0], fromAmount: amount, fromChain: A.chain, toChain: B.chain,
    });
  }

  if (url.pathname === "/api/bridge/track") {
    const tx = q.get("tx") || "";
    if (!/^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{60,100})$/.test(tx)) return json({ error: "Bad transaction" }, 400);
    const p = new URLSearchParams({ txHash: tx });
    for (const [k, v] of [["fromChain", q.get("from")], ["toChain", q.get("to")], ["bridge", q.get("bridge")]]) if (v && /^[A-Za-z0-9]{1,24}$/.test(v)) p.set(k, v);
    const [st, err] = await lifi(env, "/status?" + p);
    if (err) return json({ status: "PENDING", note: err });
    return json({ status: st.status, substatus: st.substatus || null, receiving: st.receiving?.txHash || null, link: st.lifiExplorerLink || null });
  }
  return json({ error: "Not found" }, 404);
}
