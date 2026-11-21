// Account discovery, like MetaMask and Phantom: after a recovery phrase is imported, look at its accounts one by one
// (index 1, 2, 3…) and report every one that has been used, stopping after a run of unused ones. "Used" means a
// balance or any transaction on an Ethereum-style network, Solana or Bitcoin, in the mode Ecrin is in (Mainnet or
// Testnet). Only public addresses are sent, to the same servers the wallet already uses for balances.
import { deriveAccount } from "./keyring.js";
import { NETS } from "./chains.js";
import { SOL_RPC } from "./netmode.js";
import { btcAddress, BTC, BTC_MAIN } from "./btc.js";

const post = (url, body, ms = 9000) => {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: c.signal }).then((r) => r.json()).finally(() => clearTimeout(t));
};
const get = (url, ms = 9000) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); return fetch(url, { signal: c.signal }).then((r) => (r.ok ? r.json() : null)).finally(() => clearTimeout(t)); };

/** Has this EVM address a balance or a sent transaction on this network? (One batched request.) */
async function evmUsed(rpc, addr) {
  const r = await post(rpc, [{ jsonrpc: "2.0", id: 1, method: "eth_getTransactionCount", params: [addr, "latest"] }, { jsonrpc: "2.0", id: 2, method: "eth_getBalance", params: [addr, "latest"] }]);
  const v = Array.isArray(r) ? Object.fromEntries(r.map((x) => [x.id, x.result])) : {};
  return BigInt(v[1] || "0x0") > 0n || BigInt(v[2] || "0x0") > 0n;
}
/** Solana: any transaction ever (tokens included), or a balance. */
async function solUsed(rpc, addr) {
  const r = await post(rpc, [{ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [addr, { limit: 1 }] }, { jsonrpc: "2.0", id: 2, method: "getBalance", params: [addr] }]);
  const v = Array.isArray(r) ? Object.fromEntries(r.map((x) => [x.id, x.result])) : {};
  return (Array.isArray(v[1]) && v[1].length > 0) || (v[2]?.value || 0) > 0;
}
async function btcUsed(api, addr) {
  const a = await get(`${api}/address/${addr}`);
  return !!a && ((a.chain_stats?.tx_count || 0) + (a.mempool_stats?.tx_count || 0)) > 0;
}

/** Was the account at this index used anywhere? Errors on one network don't count as "unused" elsewhere. */
export async function accountUsed(acct, { main = true } = {}) {
  const evm = acct.evm.address, sol = acct.sol.publicKey.toBase58(), btcN = main ? BTC_MAIN : BTC, btc = btcAddress(acct, btcN);
  const evmNets = Object.values(NETS).filter((N) => N.fam === "evm" && !!N.real === !!main && N.rpc);
  const checks = [...evmNets.map((N) => evmUsed(N.rpc, evm)), solUsed(main ? SOL_RPC.main : SOL_RPC.test, sol), btcUsed(btcN.apis[0], btc)];
  const res = await Promise.allSettled(checks);
  return res.some((x) => x.status === "fulfilled" && x.value === true);
}

/**
 * The used account indexes from `start` on, stopping after `gap` unused ones in a row (and never past `max`).
 * onStep(i) reports progress.
 */
export async function usedIndexes(phrase, { web3, ethers, main = true, start = 1, gap = 2, max = 20, onStep } = {}) {
  const found = []; let empty = 0;
  for (let i = start; i < max && empty < gap; i++) {
    onStep?.(i);
    const acct = deriveAccount(phrase, { web3, ethers }, i);
    // "both": activity on Mainnet or Testnet counts (a restored wallet may have been used in either).
    const used = main === "both" ? (await accountUsed(acct, { main: true }).catch(() => false)) || (await accountUsed(acct, { main: false }).catch(() => false)) : await accountUsed(acct, { main }).catch(() => false);
    if (used) { found.push(i); empty = 0; } else empty++;
  }
  return found;
}
