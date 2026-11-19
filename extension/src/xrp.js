// XRP Ledger: send and receive XRP (no Safe). Keys from the same recovery phrase at m/44'/144'/0'/0/i (secp256k1,
// the path Xaman and Ledger use). Transactions are encoded with the XRP Ledger Foundation's ripple-binary-codec and
// signed here with @noble/curves. Amounts in the wallet's common unit: 1e9 per coin (1 drop = 1000 units).
// Two rules of the XRP Ledger the wallet explains instead of failing on: every address keeps a reserve (1 XRP today,
// read from the network), and a new address only exists once it receives at least that much.
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { encode, encodeForSigning } from "ripple-binary-codec";
import { encodeAccountID, isValidClassicAddress, isValidXAddress, xAddressToClassicAddress } from "ripple-address-codec";
import { emitSent } from "./netmode.js";

export const XRP = {
  key: "xrp", fam: "xrp", name: "XRP Ledger", net: "Testnet", unit: "XRP", cg: "ripple", usdc: null, contract: null, faucet: null,
  apis: ["https://ecrinprotocol.app/api/rpc/xrp", "https://s.altnet.rippletest.net:51234"],
  explorer: (k, id) => (k === "tx" ? `https://testnet.xrpl.org/transactions/${id}` : k === "address" ? `https://testnet.xrpl.org/accounts/${id}` : null),
};
export const XRP_MAIN = {
  ...XRP, key: "xrpm", net: "Mainnet", real: true,
  apis: ["https://ecrinprotocol.app/api/rpc/xrpm", "https://xrplcluster.com", "https://s1.ripple.com:51234", "https://s2.ripple.com:51234"],
  explorer: (k, id) => (k === "tx" ? `https://livenet.xrpl.org/transactions/${id}` : k === "address" ? `https://livenet.xrpl.org/accounts/${id}` : null),
};
const UNITS_PER_DROP = 1000;
const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
const unhex = (h) => Uint8Array.from(h.match(/.{2}/g) || [], (b) => parseInt(b, 16));

/** The classic r… address of a 33-byte compressed public key. */
export const xrpAddressOf = (pub) => encodeAccountID(ripemd160(sha256(pub)));
export const xrpAddress = (acct) => (acct?.xrp ? xrpAddressOf(acct.xrp.pub) : null);
/** A pasted address: classic (r…), or an X-address (X…), which carries its destination tag inside. */
export function xrpParse(s) {
  const v = String(s || "").trim();
  if (isValidClassicAddress(v)) return { to: v, tag: null };
  if (isValidXAddress(v)) { const x = xAddressToClassicAddress(v); return { to: x.classicAddress, tag: x.tag === false ? null : x.tag }; }
  return null;
}
/** Signs a transaction object: secp256k1 over SHA-512-half of "STX\0" + its signing bytes, DER, low-S. */
export function xrpSign(tx, priv) {
  const data = unhex(encodeForSigning(tx)), pre = new Uint8Array(4 + data.length);
  pre.set([0x53, 0x54, 0x58, 0x00]); pre.set(data, 4);
  const hash = sha512(pre).slice(0, 32);
  const sig = secp256k1.sign(hash, priv, { lowS: true });
  const signed = { ...tx, TxnSignature: sig.toDERHex().toUpperCase() };
  return { blob: encode(signed), hash };
}

export function xrpEngine({ acct, N, dev = {} }) {
  const key = acct.xrp, address = xrpAddressOf(key.pub), apis = dev.xrpApi ? [dev.xrpApi] : N.apis;
  async function rpc(method, params = {}) {
    let last;
    for (const a of apis) {
      try {
        const r = await fetch(a, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, params: [params] }) });
        if (!r.ok) throw new Error(`XRP Ledger server error (${r.status})`);
        const j = await r.json(); return j.result;
      } catch (e) { last = e; }
    }
    throw last || new Error("XRP Ledger servers are unreachable right now.");
  }
  const info = (account) => rpc("account_info", { account, ledger_index: "validated" });
  /** The reserve every address keeps, in drops (1 XRP since December 2024; read from the network). */
  async function baseReserve() {
    const s = await rpc("server_state").catch(() => null);
    const d = Number(s?.state?.validated_ledger?.reserve_base); return Number.isFinite(d) && d > 0 ? d : 1_000_000;
  }
  return {
    N, address, key: (s) => xrpParse(s)?.to || null,
    isAddress: (s) => !!xrpParse(s),
    explain: (e) => ({ message: String(e?.message || e) }),
    async balances() {
      const r = await info(address);
      if (r?.error === "actNotFound") return { native: 0, usdc: 0 };
      return { native: Number(r?.account_data?.Balance || 0) * UNITS_PER_DROP, usdc: 0 };
    },
    vault: async () => null,
    /** XRP that can't be sent: the address's reserve, plus a little for the fee. */
    async reserve(asset) { return asset === "native" ? ((await baseReserve()) + 20) * UNITS_PER_DROP : 0; },
    feeText: () => "≈ 0.00001 XRP",
    /** opts.tag: the destination tag an exchange gives you (a number). An X-address brings its own. */
    async send(asset, to, amount, opts = {}) {
      if (asset !== "native") throw new Error("This sends XRP only.");
      const dest = xrpParse(to); if (!dest) throw new Error(`That isn't an XRP Ledger address.`);
      if (dest.to === address) throw new Error("That's this wallet's own address.");
      const tag = dest.tag ?? (opts.tag === "" || opts.tag == null ? null : Number(opts.tag));
      if (tag != null && !(Number.isInteger(tag) && tag >= 0 && tag <= 4294967295)) throw new Error("A destination tag is a whole number (up to 4294967295).");
      const drops = Math.round(amount / UNITS_PER_DROP); if (!(drops > 0)) throw new Error("Enter an amount.");
      const [mine, theirs, reserve, fee, cur] = await Promise.all([info(address), info(dest.to), baseReserve(), rpc("fee"), rpc("ledger_current")]);
      if (mine?.error === "actNotFound") throw new Error("This XRP address isn't active yet: it needs to receive at least 1 XRP first.");
      if (theirs?.error === "actNotFound" && drops < reserve) throw new Error(`That address isn't active yet: send at least ${reserve / 1e6} XRP to activate it.`);
      const feeDrops = Math.min(Math.max(12, Math.ceil(Number(fee?.drops?.open_ledger_fee || 10) * 1.2)), 2000);
      const left = Number(mine.account_data.Balance) - drops - feeDrops, ownerReserve = Number(mine.account_data.OwnerCount || 0) * 200_000;
      if (left < reserve + ownerReserve) throw new Error(`XRP keeps ${(reserve + ownerReserve) / 1e6} XRP in every address. Send at most ${Math.max(0, (Number(mine.account_data.Balance) - reserve - ownerReserve - feeDrops) / 1e6)} XRP.`);
      const tx = { TransactionType: "Payment", Account: address, Destination: dest.to, Amount: String(drops), Fee: String(feeDrops), Flags: 0,
        Sequence: mine.account_data.Sequence, LastLedgerSequence: Number(cur.ledger_current_index) + 20, SigningPubKey: toHex(key.pub), ...(tag != null ? { DestinationTag: tag } : {}) };
      const { blob } = xrpSign(tx, key.priv);
      const r = await rpc("submit", { tx_blob: blob });
      const code = r?.engine_result || r?.error || "unknown";
      if (!/^(tesSUCCESS|terQUEUED)$/.test(code)) throw new Error(`The XRP Ledger refused it: ${r?.engine_result_message || code}`);
      const id = r.tx_json?.hash; emitSent(id); return id;
    },
    async listTokens() { return []; },
  };
}
