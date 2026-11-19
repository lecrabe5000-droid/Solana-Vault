// Bitcoin: send and receive (no Safe). Native SegWit addresses (bc1q…, BIP-84), the kind every major wallet uses.
// Keys come from the same recovery phrase: m/84'/0'/0'/0/i on mainnet, m/84'/1'/0'/0/i on testnet (keyring.js).
// Transactions are built and signed here with @scure/btc-signer (audited); balances, coins and fees come from
// mempool.space through Ecrin's server (your IP stays private), with mempool.space and Blockstream directly as backups. Amounts in the wallet's common unit: 1e9 per coin (1 sat = 10 units).
import * as btc from "@scure/btc-signer";
import { hex } from "@scure/base";
import { emitSent } from "./netmode.js";

export const BTC = {
  key: "btc", fam: "btc", name: "Bitcoin", net: "Testnet4", unit: "BTC", cg: "bitcoin", usdc: null, contract: null, faucet: null,
  apis: ["https://ecrinprotocol.app/api/rpc/btc", "https://mempool.space/testnet4/api"],
  explorer: (k, id) => (k === "tx" || k === "address" ? `https://mempool.space/testnet4/${k}/${id}` : null),
};
export const BTC_MAIN = {
  ...BTC, key: "btcm", net: "Mainnet", real: true,
  apis: ["https://ecrinprotocol.app/api/rpc/btcm", "https://mempool.space/api", "https://blockstream.info/api"],
  explorer: (k, id) => (k === "tx" || k === "address" ? `https://mempool.space/${k}/${id}` : null),
};
const netOf = (N) => (N.real ? btc.NETWORK : btc.TEST_NETWORK);
const UNITS_PER_SAT = 10n;
export const DUST = 546n; // the smallest output nodes relay (a little above P2WPKH's 294, like most wallets)

/** The account's address on this network (acct.btc is mainnet's key, acct.btcT testnet's). */
export function btcAddress(acct, N) {
  const k = N.real ? acct?.btc : acct?.btcT; if (!k) return null;
  return btc.p2wpkh(k.pub, netOf(N)).address;
}
/** Is it an address for this network? Native SegWit, Taproot and the older formats all receive. */
export function btcIsAddress(s, N) { try { btc.Address(netOf(N)).decode(String(s).trim()); return true; } catch (_) { return false; } }

/** Size of a transaction with `n` P2WPKH inputs and `outs` outputs, in virtual bytes (what the fee is per). */
export const vbytes = (n, outs) => Math.ceil(10.5 + 68 * n + 31 * outs);
/** Chooses coins, largest first, for `sats` to `to` at `rate` sat/vB. Change below dust goes to the fee.
 *  Returns { use, fee, change } or throws a clear message. Pure, so it's tested on its own. */
export function plan(utxos, sats, rate) {
  const list = [...utxos].sort((a, b) => b.value - a.value), use = []; let total = 0n;
  for (const u of list) {
    use.push(u); total += BigInt(u.value);
    const fee2 = BigInt(Math.ceil(vbytes(use.length, 2) * rate));
    if (total >= sats + fee2) {
      const change = total - sats - fee2;
      if (change >= DUST) return { use, fee: fee2, change };
      return { use, fee: total - sats, change: 0n }; // too little left to be worth an output: it goes to the miners
    }
  }
  const fee1 = BigInt(Math.ceil(vbytes(list.length, 1) * rate));
  if (total >= sats + fee1) return { use, fee: total - sats, change: 0n };
  throw new Error("Not enough BTC for this amount and the network fee.");
}

export function btcEngine({ acct, N, dev = {} }) {
  const key = N.real ? acct.btc : acct.btcT, NET = netOf(N), apis = dev.btcApi ? [dev.btcApi] : N.apis;
  const me = btc.p2wpkh(key.pub, NET), address = me.address;
  async function get(path, asText) {
    let last;
    for (const a of apis) {
      try { const r = await fetch(a + path, { cache: "no-store" }); if (!r.ok) throw new Error(`Bitcoin server error (${r.status})`); return asText ? r.text() : r.json(); } catch (e) { last = e; }
    }
    throw last || new Error("Bitcoin servers are unreachable right now.");
  }
  async function rate() {
    // mempool.space's recommendation (within about half an hour); Blockstream's estimate for ~3 blocks otherwise.
    try { const f = await get("/v1/fees/recommended"); if (f?.halfHourFee) return Math.max(1, Number(f.halfHourFee)); } catch (_) {}
    try { const f = await get("/fee-estimates"); if (f?.["3"]) return Math.max(1, Math.ceil(Number(f["3"]))); } catch (_) {}
    return 5;
  }
  const utxos = () => get(`/address/${address}/utxo`);
  return {
    N, address, key: (s) => (btcIsAddress(s, N) ? String(s).trim() : null),
    isAddress: (s) => btcIsAddress(s, N),
    explain: (e) => ({ message: String(e?.message || e) }),
    async balances() {
      const a = await get(`/address/${address}`);
      const sats = (s) => BigInt(s?.funded_txo_sum || 0) - BigInt(s?.spent_txo_sum || 0);
      return { native: Number((sats(a.chain_stats) + sats(a.mempool_stats)) * UNITS_PER_SAT), usdc: 0 };
    },
    vault: async () => null,
    /** What to keep back for the fee when sending everything (all coins in, one output). */
    async reserve(asset) { if (asset !== "native") return 0; const [u, r] = await Promise.all([utxos().catch(() => []), rate()]); return Math.ceil(vbytes(Math.max(1, u.length), 1) * r) * Number(UNITS_PER_SAT); },
    feeText: () => "set by the network (a few hundred to a few thousand sats)",
    async send(asset, to, amount) {
      if (asset !== "native") throw new Error("Bitcoin sends BTC only.");
      if (!btcIsAddress(to, N)) throw new Error(`That isn't a Bitcoin ${N.real ? "" : "testnet "}address.`);
      const sats = BigInt(Math.round(amount)) / UNITS_PER_SAT;
      if (sats < DUST) throw new Error(`Bitcoin can't send less than ${DUST} sats (0.00000546 BTC).`);
      const [list, r] = await Promise.all([utxos(), rate()]);
      const p = plan(list, sats, r);
      if (p.fee > sats && p.fee > 50_000n) throw new Error("The network fee would be more than what you're sending. Try a larger amount.");
      const tx = new btc.Transaction();
      for (const u of p.use) tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: me.script, amount: BigInt(u.value) } });
      tx.addOutputAddress(String(to).trim(), sats, NET);
      if (p.change > 0n) tx.addOutputAddress(address, p.change, NET);
      tx.sign(key.priv); tx.finalize();
      const raw = hex.encode(tx.extract());
      let id = null, last;
      for (const a of apis) { try { const res = await fetch(a + "/tx", { method: "POST", body: raw }); const t = await res.text(); if (!res.ok) throw new Error(t || `refused (${res.status})`); id = t.trim(); break; } catch (e) { last = e; } }
      if (!id) throw new Error(`Bitcoin refused the transaction: ${String(last?.message || last).slice(0, 160)}`);
      emitSent(id); return id;
    },
    async listTokens() { return []; },
  };
}
