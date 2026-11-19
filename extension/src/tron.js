// Tron for Ecrin Wallet: TRX and USDT (TRC-20), send and receive, on Nile (test) and mainnet. No Safe on Tron yet.
// Keys: the recovery phrase at m/44'/195'/0'/0/i (the path TronLink uses), secp256k1 like Ethereum.
// Every transaction is built and signed here, byte by byte (Tron's protobuf format), so the server only relays it:
// it can't change the receiver or the amount. The server is TronGrid's public API for the Nile test network.
import { sha256 } from "@noble/hashes/sha256";
import bs58 from "bs58";
import { emitSent, viaProxy, fetchFirst } from "./netmode.js";

export const TRON = {
  key: "tron", fam: "tron", name: "Tron", net: "Nile", unit: "TRX", cg: "tron", usdc: null, contract: null,
  api: "https://nile.trongrid.io", faucet: "https://nileex.io/join/getJoinPage",
  usdt: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf", // Tether's test USDT on Nile
  explorer: (k, id) => `https://nile.tronscan.org/#/${k === "tx" ? "transaction" : k === "token" ? "token20" : "address"}/${id}`,
};
// Mainnet, real money. USDT is Tether's own contract (tether.to, supported protocols), checked on-chain (symbol USDT).
export const TRON_MAIN = {
  ...TRON, key: "tronm", net: "Mainnet", real: true, api: "https://api.trongrid.io", faucet: null,
  usdt: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  explorer: (k, id) => `https://tronscan.org/#/${k === "tx" ? "transaction" : k === "token" ? "token20" : "address"}/${id}`,
};
const SUN = 1_000_000; // 1 TRX
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h) => Uint8Array.from(h.replace(/^0x/, "").match(/.{2}/g) || [], (b) => parseInt(b, 16));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

/** 0x-style 20-byte address → Tron's T… address (0x41 prefix, base58 with a double-sha256 checksum). */
export function toTron(evmAddr) {
  const raw = cat(Uint8Array.of(0x41), unhex(evmAddr));
  return bs58.encode(cat(raw, sha256(sha256(raw)).slice(0, 4)));
}
/** T… address → its 21 bytes (0x41 + 20), or null if the checksum is wrong. */
export function fromTron(addr) {
  try {
    const b = bs58.decode(String(addr).trim()); if (b.length !== 25 || b[0] !== 0x41) return null;
    const raw = b.slice(0, 21), sum = sha256(sha256(raw)).slice(0, 4);
    return sum.every((x, i) => x === b[21 + i]) ? raw : null;
  } catch (_) { return null; }
}

// ---- protobuf, just the parts a transfer needs
const varint = (n) => { n = BigInt(n); const o = []; do { let b = Number(n & 0x7fn); n >>= 7n; if (n) b |= 0x80; o.push(b); } while (n); return Uint8Array.from(o); };
const fInt = (f, v) => cat(varint((f << 3) | 0), varint(v));
const fBytes = (f, b) => cat(varint((f << 3) | 2), varint(b.length), b);
const fStr = (f, s) => fBytes(f, new TextEncoder().encode(s));
const any = (type, value) => cat(fStr(1, `type.googleapis.com/protocol.${type}`), fBytes(2, value));

/** The raw part of a transaction (what gets hashed and signed). */
export function rawTx({ block, contractType, typeName, value, feeLimit, now = Date.now() }) {
  const num = BigInt(block.number), refBytes = unhex(num.toString(16).padStart(16, "0")).slice(6, 8), refHash = unhex(block.id).slice(8, 16);
  const contract = cat(fInt(1, contractType), fBytes(2, any(typeName, value)));
  return cat(fBytes(1, refBytes), fBytes(4, refHash), fInt(8, now + 60_000), fBytes(11, contract), fInt(14, now), ...(feeLimit ? [fInt(18, feeLimit)] : []));
}
export const transferValue = (from, to, sun) => cat(fBytes(1, from), fBytes(2, to), fInt(3, sun));
export const triggerValue = (from, contract, data) => cat(fBytes(1, from), fBytes(2, contract), fBytes(4, data));
/** A contract call that may also send TRX (call_value, field 3): used for bridges. */
export const callValue = (from, contract, data, sun) => cat(fBytes(1, from), fBytes(2, contract), ...(BigInt(sun) > 0n ? [fInt(3, sun)] : []), fBytes(4, data));
/** TRC-20 approve(address,uint256) call data. */
export const approveData = (spender21, amount) => cat(unhex("095ea7b3"), new Uint8Array(12), spender21.slice(1), unhex(BigInt(amount).toString(16).padStart(64, "0")));
export const TRX_ID = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"; // how LI.FI names TRX itself
/** TRC-20 transfer(address,uint256) call data. */
export const trc20Data = (to21, amount) => cat(unhex("a9059cbb"), new Uint8Array(12), to21.slice(1), unhex(BigInt(amount).toString(16).padStart(64, "0")));

/** Signs: secp256k1 over sha256(raw), 65 bytes r‖s‖v (v = 27/28, like TronWeb). Returns the full transaction bytes and id. */
export function signRaw(raw, signingKey) {
  const id = sha256(raw), sig = signingKey.sign(id);
  const s65 = cat(unhex(sig.r), unhex(sig.s), Uint8Array.of(sig.v));
  return { id: hex(id), bytes: cat(fBytes(1, raw), fBytes(2, s65)) };
}

export function tronEngine({ ethers, acct, dev = {}, N = TRON }) {
  const apis = dev.tronApi ? [dev.tronApi] : viaProxy(N.key, N.api), w = acct.tron;
  const me = toTron(w.address), me21 = fromTron(me);
  async function call(path, body) {
    const r = await fetchFirst(apis, path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Tron network error (${r.status})`);
    return r.json();
  }
  async function block() { const b = await call("/wallet/getnowblock", {}); return { number: b.block_header.raw_data.number, id: b.blockID }; }
  async function send(raw) {
    const t = signRaw(raw, w.signingKey);
    const r = await call("/wallet/broadcasthex", { transaction: hex(t.bytes) });
    if (!r.result) { let m = r.message || r.code || "rejected"; try { if (/^[0-9a-f]+$/i.test(m)) m = new TextDecoder().decode(unhex(m)); } catch (_) {} throw new Error(`Tron refused the transaction: ${m}`); }
    emitSent(t.id);
    return t.id;
  }
  /** Waits until a transaction is in a block (up to about a minute) and says if it failed. */
  async function confirmed(id) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const r = await call("/wallet/gettransactioninfobyid", { value: id }).catch(() => null);
      if (r?.blockNumber) { if (r.receipt?.result && r.receipt.result !== "SUCCESS") throw new Error(`The USDT approval failed on Tron (${r.receipt.result}).`); return; }
    }
    throw new Error("The USDT approval is taking long on Tron. Try the bridge again in a minute.");
  }
  const usdtBal = async () => {
    const r = await call("/wallet/triggerconstantcontract", { owner_address: me, contract_address: N.usdt, function_selector: "balanceOf(address)", parameter: hex(new Uint8Array(12)) + hex(me21.slice(1)), visible: true });
    return BigInt("0x" + (r.constant_result?.[0] || "0"));
  };
  return {
    N, address: me, key: (s) => (fromTron(s) ? String(s).trim() : null),
    isAddress: (s) => !!fromTron(s),
    explain: (e) => ({ message: String(e?.message || e) }),
    // Balances in the wallet's common unit (1e9 per coin), like the other networks.
    async balances() { const a = await call("/wallet/getaccount", { address: me, visible: true }); return { native: Number(a.balance || 0) * 1000, usdc: 0 }; },
    vault: async () => null,
    reserve: (asset) => (asset === "native" ? 1.1 * SUN * 1000 : 0),
    feeText: () => "≈ 0.3 TRX (less with free daily bandwidth)",
    async send(asset, to, amount) {
      const to21 = fromTron(to); if (!to21) throw new Error("That isn't a Tron address.");
      return send(rawTx({ block: await block(), contractType: 1, typeName: "TransferContract", value: transferValue(me21, to21, Math.round(amount / 1000)) }));
    },
    // USDT shows with the other tokens; sending it is a TRC-20 call that burns a little TRX for energy (capped at 30 TRX).
    async listTokens() {
      const raw = await usdtBal().catch(() => 0n);
      return raw > 0n ? [{ mint: N.usdt, raw: String(raw), dec: 6, symbol: "USDT", name: N.real ? "Tether USD" : "Tether USD (test)", prog: "trc20" }] : [];
    },
    async sendToken(t, to, raw) {
      const to21 = fromTron(to); if (!to21) throw new Error("That isn't a Tron address.");
      return send(rawTx({ block: await block(), contractType: 31, typeName: "TriggerSmartContract", value: triggerValue(me21, fromTron(t.mint), trc20Data(to21, raw)), feeLimit: 30 * SUN }));
    },
    /** Bridges (LI.FI) from Tron. Ecrin doesn't sign LI.FI's own transaction: it takes only the call (which contract,
     *  which data, how much TRX), checks it, and builds and signs its own transaction from this address. USDT is
     *  approved for exactly the amount, and only to the bridge contract. Returns the transaction id. */
    async bridgeSend({ tx, approval, fromToken, fromAmount }) {
      const c = tx?.tron, want = BigInt(fromAmount), contract21 = fromTron(c?.contract || "");
      if (!c || !contract21 || !/^[0-9a-fA-F]+$/.test(c.data || "")) throw new Error("This bridge sent a Tron transaction Ecrin can't read. Ecrin refused it.");
      const sun = BigInt(c.callValue || 0);
      if (fromToken === TRX_ID) { if (sun !== want) throw new Error("This bridge would send a different amount than you chose. Ecrin refused it."); }
      else {
        if (fromToken !== N.usdt) throw new Error("This bridge asks for a token Ecrin doesn't know. Ecrin refused it.");
        if (sun !== 0n) throw new Error("This bridge asks for TRX on top of your USDT. Ecrin refused it.");
        if (!approval || approval !== c.contract) throw new Error("This bridge asks to approve a different contract. Ecrin refused it.");
        const r = await call("/wallet/triggerconstantcontract", { owner_address: me, contract_address: N.usdt, function_selector: "allowance(address,address)", parameter: hex(new Uint8Array(12)) + hex(me21.slice(1)) + hex(new Uint8Array(12)) + hex(contract21.slice(1)), visible: true });
        if (BigInt("0x" + (r.constant_result?.[0] || "0")) < want) {
          const id = await send(rawTx({ block: await block(), contractType: 31, typeName: "TriggerSmartContract", value: triggerValue(me21, fromTron(N.usdt), approveData(contract21, want)), feeLimit: 30 * SUN }));
          await confirmed(id);
        }
      }
      const feeLimit = Math.min(Math.max(Number(c.feeLimit) || 100 * SUN, 30 * SUN), 200 * SUN);
      return send(rawTx({ block: await block(), contractType: 31, typeName: "TriggerSmartContract", value: callValue(me21, contract21, unhex(c.data), sun), feeLimit }));
    },
  };
}
