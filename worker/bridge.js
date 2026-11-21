// Bridges through LI.FI: move any coin Ecrin holds to any coin on another network (or swap on the same one). LI.FI builds the transaction;
// the user signs it in the wallet, which checks it first. Ecrin's fee and integrator name are added here, on the
// server, so a wallet can't change them. The server never holds funds or keys.
//   GET /api/bridge/status                                                  → { on, fee }
//   GET /api/bridge/quote?from=&to=&fromCoin=&toCoin=&amount=&fromAddress=&toAddress=  → a quote with the transaction
//       (coins: native | usdc | usdt | a token address on that network; the older coin= sets both sides)
//   GET /api/bridge/price?ids=net:address,…                                → { prices: { id: usd } }
//   GET /api/bridge/track?tx=&from=&to=&bridge=                             → { status, substatus, receiving, got }
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

const ZERO = "0x0000000000000000000000000000000000000000", SOL = "11111111111111111111111111111111";
const TRX = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb", TRON_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const SUI = "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";
const SUI_USDC = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
const evm = (k, chain, unit) => ({ chain, fam: "evm", unit, coins: { native: ZERO, ...(EVM_MAIN[k].usdc ? { usdc: EVM_MAIN[k].usdc } : {}) } });
/** Ecrin's mainnet networks that can bridge, with LI.FI's chain id and token ids (both from LI.FI's /v1/chains and
 *  /v1/token), and the coins Ecrin holds there. */
export const BRIDGE_NETS = {
  solm: { chain: "SOL", fam: "sol", unit: "SOL", coins: { native: SOL, usdc: SOL_USDC.mainnet } },
  ethm: evm("ethm", 1, "ETH"), basem: evm("basem", 8453, "ETH"), arbm: evm("arbm", 42161, "ETH"), opm: evm("opm", 10, "ETH"),
  polm: evm("polm", 137, "POL"), avaxm: evm("avaxm", 43114, "AVAX"), hypem: evm("hypem", 999, "HYPE"), bnbm: evm("bnbm", 56, "BNB"),
  tronm: { chain: 728126428, fam: "tron", unit: "TRX", coins: { native: TRX, usdt: TRON_USDT } },
  suim: { chain: 9270000000000000, fam: "sui", unit: "SUI", coins: { native: SUI, usdc: SUI_USDC } },
  btcm: { chain: 20000000000001, fam: "btc", unit: "BTC", coins: { native: "bitcoin" } },
};
const ADDR = { btc: /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/, sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, evm: /^0x[0-9a-fA-F]{40}$/, tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, sui: /^0x[0-9a-fA-F]{64}$/ };
const COIN = /^(native|usdc|usdt)$/;
// Any other token, by its address on that network (LINK on Arbitrum, BONK on Solana…). LI.FI only routes tokens it
// knows, and the wallet checks every transaction before signing, so an address can't make it send something else.
const TOKEN = { evm: /^0x[0-9a-fA-F]{40}$/, sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ };
const coinOf = (N, c) => (COIN.test(c) ? N.coins[c] : TOKEN[N.fam]?.test(c || "") ? c : null);

export const bridgeFee = (env) => { const f = Number(env.LIFI_FEE); return Number.isFinite(f) && f >= 0 && f < 0.05 ? f : 0.00875; };
export const bridgeOn = (env) => /^[A-Za-z0-9._-]{2,40}$/.test(env.LIFI_INTEGRATOR || "");

/** The token to send and the token to receive. Null when a coin isn't on that network, or it's the same coin twice. */
export function bridgeTokens(from, to, fromCoin, toCoin = fromCoin) {
  const a = BRIDGE_NETS[from], b = BRIDGE_NETS[to];
  if (!a || !b) return null;
  const x = coinOf(a, fromCoin), y = coinOf(b, toCoin);
  if (!x || !y || (from === to && String(x).toLowerCase() === String(y).toLowerCase())) return null;
  return [x, y];
}

/** LI.FI's reasons in plain words, with a code the wallet can act on. */
export function swapWhy(err) {
  const e = String(err || "");
  if (/AMOUNT_TOO_LOW|too low|too small|below (the )?min|minimum/i.test(e)) return { error: "This amount is too small for this route. Try a larger amount.", code: "AMOUNT_LOW" };
  if (/price impact|slippage/i.test(e)) return { error: "The price would move too much for this amount. Try a smaller amount.", code: "IMPACT" };
  if (/AMOUNT_TOO_HIGH|amount (is )?too (high|large)|exceeds (the )?max|above (the )?max|maximum amount|not enough liquidity/i.test(e)) return { error: "This amount is too large for this route right now. Try a smaller amount.", code: "AMOUNT_HIGH" };
  if (/insufficient|balance/i.test(e)) return { error: "Not enough balance for this swap, including the network fee.", code: "BALANCE" };
  if (/busy|rate.?limit|429/i.test(e)) return { error: "Swaps are busy. Try again in a few seconds.", code: "BUSY" };
  if (/unreachable/i.test(e)) return { error: "The swap service is unreachable right now. Try again in a minute.", code: "DOWN" };
  if (/no available quotes|no route|none of the available routes|NO_QUOTE/i.test(e)) return { error: "No route for this swap right now. Try another amount, coin or network.", code: "NO_ROUTE" };
  return { error: "This swap isn't available right now. Try another amount, coin or network.", code: "OTHER", detail: e.slice(0, 160) };
}
async function lifi(env, path) {
  const headers = { Accept: "application/json" };
  if (env.LIFI_API_KEY) headers["x-lifi-api-key"] = env.LIFI_API_KEY;
  let res; try { res = await fetch(API + path, { headers }); } catch (_) { return [null, "LI.FI is unreachable right now. Try again in a minute."]; }
  const body = await res.json().catch(() => null);
  if (res.status === 429) return [null, "Bridges are busy. Try again in a few seconds."];
  if (!res.ok) {
    // LI.FI says why in its details: routes it filtered out (reason) and routes that failed (code, message).
    const why = [body?.message, ...((body?.errors?.filteredOut || []).map((x) => x?.reason)), ...((body?.errors?.failed || []).flatMap((f) => Object.values(f?.subpaths || {}).flat().map((x) => `${x?.code || ""} ${x?.message || ""}`)))].filter(Boolean).join(" | ");
    return [null, why ? why.slice(0, 600) : `LI.FI answered ${res.status}`];
  }
  return [body, null];
}

export async function handleBridge(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (url.pathname === "/api/bridge/status") return json({ on: bridgeOn(env), fee: bridgeFee(env), nets: Object.keys(BRIDGE_NETS) });
  // Live prices for tokens Ecrin doesn't price itself: GET /api/bridge/price?ids=arbm:0x…,solm:Mint… (at most 30)
  if (url.pathname === "/api/bridge/price") {
    const ids = [...new Set((url.searchParams.get("ids") || "").split(",").filter(Boolean))].slice(0, 30), prices = {};
    await Promise.all(ids.map(async (id) => {
      const i = id.indexOf(":"), N = BRIDGE_NETS[id.slice(0, i)], c = id.slice(i + 1);
      if (!N || !TOKEN[N.fam]?.test(c)) return;
      const ck = new Request(`https://cache.ecrin/price/${id}`), cache = typeof caches !== "undefined" ? caches.default : null;
      const hit = cache && (await cache.match(ck)); if (hit) { const v = Number(await hit.text()); if (v > 0) prices[id] = v; return; }
      const [t] = await lifi(env, `/token?chain=${N.chain}&token=${c}`); const v = Number(t?.priceUSD) || 0;
      if (v > 0) { prices[id] = v; if (cache) await cache.put(ck, new Response(String(v), { headers: { "cache-control": "public, max-age=120" } })); }
    }));
    return Response.json({ prices }, { headers: { "Cache-Control": "public, max-age=60", ...CORS } });
  }
  if (!bridgeOn(env)) return json({ error: "Bridges are coming soon.", code: "BRIDGE_SOON" }, 503);
  const q = url.searchParams;

  if (url.pathname === "/api/bridge/quote") {
    const from = q.get("from"), to = q.get("to"), amount = q.get("amount") || "";
    const fromCoin = q.get("fromCoin") || q.get("coin") || "native", toCoin = q.get("toCoin") || q.get("coin") || "native";
    const tk = bridgeTokens(from, to, fromCoin, toCoin);
    if (!tk) return json({ error: "This coin can't be bridged between these networks." }, 400);
    if (!/^[1-9]\d{0,29}$/.test(amount)) return json({ error: "Bad amount" }, 400);
    const A = BRIDGE_NETS[from], B = BRIDGE_NETS[to], fa = q.get("fromAddress") || "", ta = q.get("toAddress") || "";
    if (!ADDR[A.fam].test(fa) || !ADDR[B.fam].test(ta)) return json({ error: "That address doesn't match the network." }, 400);
    const p = new URLSearchParams({ fromChain: String(A.chain), toChain: String(B.chain), fromToken: tk[0], toToken: tk[1], fromAmount: amount, fromAddress: fa, toAddress: ta,
      integrator: env.LIFI_INTEGRATOR, fee: String(bridgeFee(env)), slippage: "0.005", order: "RECOMMENDED" });
    const [qt, err] = await lifi(env, "/quote?" + p);
    if (err) {
      // LI.FI refuses a network until Ecrin has a fee wallet there (set in LI.FI's portal): say it opens soon.
      if (/not configured for collecting fees/i.test(err)) return json({ error: `Bridges from ${A.fam === "tron" ? "Tron" : A.fam === "sui" ? "Sui" : A.fam === "btc" ? "Bitcoin" : "this network"} open very soon.`, code: "BRIDGE_NET_SOON" }, 503);
      return json(swapWhy(err), 502);
    }
    const e = qt.estimate || {}, t = qt.transactionRequest || {}, isToken = tk[0] !== A.coins.native;
    const usd = (list) => (list || []).reduce((s, c) => s + (Number(c.amountUSD) || 0), 0);
    let tx;
    if (A.fam === "sol") tx = { sol: t.data };
    else if (A.fam === "sui") tx = { sui: t.data };
    // Bitcoin: a PSBT spending the user's coins; the wallet checks every input and output before signing it.
    else if (A.fam === "btc") { if (!/^70736274ff[0-9a-f]+$/i.test(t.data || "")) return json({ error: "LI.FI sent a Bitcoin transaction Ecrin can't read. Try another amount." }, 502); tx = { psbt: t.data, to: t.to, value: String(t.value || "") }; }
    else if (A.fam === "tron") {
      // LI.FI sends a whole Tron transaction; pass on only the call in it. The wallet builds and signs its own
      // transaction from these fields, so nothing else in LI.FI's bytes can ride along.
      let c = t.customData; try { if (typeof c === "string") c = JSON.parse(c); } catch (_) { c = null; }
      const ct = c?.tronTransaction?.raw_data?.contract?.[0], v = ct?.parameter?.value || {};
      if (ct?.type !== "TriggerSmartContract" || v.owner_address !== fa || !ADDR.tron.test(v.contract_address || "") || !/^[0-9a-fA-F]+$/.test(v.data || ""))
        return json({ error: "LI.FI sent a Tron transaction Ecrin can't check. Try another amount." }, 502);
      tx = { tron: { contract: v.contract_address, data: v.data, callValue: String(v.call_value || 0), feeLimit: Number(c.tronTransaction.raw_data.fee_limit) || 150_000_000 } };
    } else tx = { to: t.to, data: t.data, value: t.value || "0x0", gasLimit: t.gasLimit || null };
    return json({
      tool: qt.toolDetails?.name || qt.tool, bridge: qt.tool, toAmount: e.toAmount, toAmountMin: e.toAmountMin, seconds: e.executionDuration,
      feesUSD: usd(e.feeCosts), gasUSD: usd(e.gasCosts), fee: bridgeFee(env),
      approval: (A.fam === "evm" || A.fam === "tron") && isToken ? e.approvalAddress || null : null,
      tx, fromToken: tk[0], toToken: tk[1], fromAmount: amount, fromChain: A.chain, toChain: B.chain,
    });
  }

  if (url.pathname === "/api/bridge/track") {
    const tx = q.get("tx") || "";
    if (!/^((0x)?[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{32,100})$/.test(tx)) return json({ error: "Bad transaction" }, 400);
    const p = new URLSearchParams({ txHash: tx });
    for (const [k, v] of [["fromChain", q.get("from")], ["toChain", q.get("to")], ["bridge", q.get("bridge")]]) if (v && /^[A-Za-z0-9]{1,24}$/.test(v)) p.set(k, v);
    const [st, err] = await lifi(env, "/status?" + p);
    if (err) return json({ status: "PENDING", note: err });
    return json({ status: st.status, substatus: st.substatus || null, receiving: st.receiving?.txHash || null, got: st.receiving?.amount || null, link: st.lifiExplorerLink || null });
  }
  return json({ error: "Not found" }, 404);
}
