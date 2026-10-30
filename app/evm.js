// Ecrin on Ethereum (Sepolia): reads vaults and sends transactions to evm/contracts/EcrinVault.sol through ethers.
// Returns vaults in the same shape as chain.js so the app renders both networks with one set of views.
// Amounts use 1e9 base units per coin on both networks (lamports on Solana, gwei here), so the app's
// formatting is shared; conversions to wei happen only in this file.
// Works in the browser (ethers = window.ethers, wallet = window.ethereum) and in Node tests (pass a signer).
import { ERRORS } from "./chain.js";

export const ABI = [
  "function createVault(uint8 preset, address guardian, uint64 lockUntil) payable",
  "function deposit() payable",
  "function sendToTrusted(address dest, uint256 amount)",
  "function requestWithdrawal(address dest, uint256 amount) returns (uint32)",
  "function cancelWithdrawal(uint32 id)",
  "function proposeChange((uint8 kind, uint256 value, address addr) change) returns (uint32)",
  "function cancelChange(uint32 id)",
  "function executeWithdrawal(address owner, uint32 id)",
  "function applyChange(address owner, uint32 id)",
  "function guardianRelease(address owner, uint32 id)",
  "function guardianApproveChange(address owner, uint32 id)",
  "function hasVault(address owner) view returns (bool)",
  "function getVault(address owner) view returns (uint256 balance, uint64 withdrawDelay, uint64 ruleDelay, uint256 dailyLimit, uint64 lockedUntil, address guardian, uint64 spentDay, uint256 spentToday, address[] trusted, (uint32 id, uint256 amount, address dest, uint64 readyAt)[] withdrawals, (uint32 id, (uint8 kind, uint256 value, address addr) change, uint64 readyAt)[] changes)",
  ...ERRORS.map(([code]) => `error ${code}()`).filter((e) => !/Overflow|WrongDestination/.test(e)),
  "error VaultExists()", "error TransferFailed()", "error Reentered()",
];

const KINDS = ["SetWithdrawDelay", "SetRuleDelay", "SetDailyLimit", "SetLockedUntil", "SetGuardian", "AddTrusted", "RemoveTrusted"];
const PRESETS = { gentle: 0, strong: 1, locked: 2 };
const GWEI = 1_000_000_000n;
const EXTRA_ERRORS = { VaultExists: "This wallet already has a vault.", TransferFailed: "The destination refused the transfer.", Reentered: "That call was refused." };

/** Turns a failed call into { code, message }. */
export function explainEvmError(err, iface) {
  const text0 = String(err?.shortMessage || err?.message || err);
  const data = [err?.data, err?.error?.data, err?.info?.error?.data, err?.info?.error?.data?.data].find((d) => typeof d === "string" && d.startsWith("0x"));
  let parsed = null;
  try { parsed = data && iface ? iface.parseError(data)?.name : null; } catch (_) {}
  const name = err?.revert?.name || err?.error?.revert?.name || parsed || (text0.match(/custom error '?(\w+)\(/) || [])[1];
  const hit = ERRORS.find(([c]) => c === name);
  if (hit) return { code: hit[0], message: hit[1] };
  if (EXTRA_ERRORS[name]) return { code: name, message: EXTRA_ERRORS[name] };
  const text = String(err?.shortMessage || err?.message || err);
  if (err?.code === "ACTION_REJECTED" || /user rejected|denied/i.test(text)) return { code: "Rejected", message: "You cancelled it in your wallet." };
  if (err?.code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test(text)) return { code: "NoEth", message: "Your wallet doesn't have enough Sepolia ETH for this (and the gas)." };
  return { code: "Unknown", message: text.slice(0, 200) };
}

export function createEvmClient({ ethers, EVM, readProvider, getSigner }) {
  const read = readProvider || new ethers.JsonRpcProvider(EVM.rpc, EVM.chainId, { staticNetwork: true });
  const contract = new ethers.Contract(EVM.address, ABI, read);

  class Addr {
    constructor(a) { this.a = ethers.getAddress(String(a).trim()); }
    toBase58() { return this.a; }
    toString() { return this.a; }
    equals(o) { return !!o && String(o).toLowerCase() === this.a.toLowerCase(); }
  }
  const key = (s) => { try { return s ? new Addr(s) : null; } catch (_) { return null; } };
  const toWei = (units) => BigInt(Math.round(Number(units))) * GWEI;
  const fromWei = (w) => Number(BigInt(w) / GWEI);
  const orNull = (v, f) => (BigInt(v) === 0n ? null : f(v));
  const addrOrNull = (a) => (BigInt(a) === 0n ? null : new Addr(a));

  function decodeChange(c) {
    const kind = KINDS[Number(c.kind)];
    const value = kind === "SetDailyLimit" ? orNull(c.value, fromWei)
      : kind === "SetLockedUntil" ? orNull(c.value, Number)
      : kind === "SetGuardian" ? addrOrNull(c.addr)
      : kind === "AddTrusted" || kind === "RemoveTrusted" ? new Addr(c.addr)
      : Number(c.value);
    return { kind, value };
  }
  function encodeChange({ kind, value }) {
    const k = KINDS.indexOf(kind);
    if (k < 0) throw new Error("Unknown change " + kind);
    const zero = ethers.ZeroAddress;
    if (kind === "SetDailyLimit") return { kind: k, value: value === null ? 0n : toWei(value), addr: zero };
    if (kind === "SetLockedUntil") return { kind: k, value: BigInt(value ?? 0), addr: zero };
    if (kind === "SetGuardian") return { kind: k, value: 0n, addr: value ? String(value) : zero };
    if (kind === "AddTrusted" || kind === "RemoveTrusted") return { kind: k, value: 0n, addr: String(value) };
    return { kind: k, value: BigInt(value), addr: zero };
  }

  async function fetchVault(owner) {
    const o = String(owner);
    if (!(await contract.hasVault(o))) return null;
    const v = await contract.getVault(o);
    const withdrawals = v.withdrawals.map((w) => ({ id: Number(w.id), amount: fromWei(w.amount), dest: new Addr(w.dest), readyAt: Number(w.readyAt) }));
    const balance = fromWei(v.balance);
    return {
      owner: new Addr(o), address: new Addr(EVM.address), balance,
      available: Math.max(0, balance - withdrawals.reduce((s, w) => s + w.amount, 0)),
      withdrawDelay: Number(v.withdrawDelay), ruleDelay: Number(v.ruleDelay),
      dailyLimit: orNull(v.dailyLimit, fromWei), lockedUntil: orNull(v.lockedUntil, Number), guardian: addrOrNull(v.guardian),
      trusted: v.trusted.map((a) => new Addr(a)), withdrawals,
      changes: v.changes.map((c) => ({ id: Number(c.id), change: decodeChange(c.change), readyAt: Number(c.readyAt) })),
    };
  }

  /** Signs with the wallet, waits for the receipt, returns the transaction hash. */
  async function tx(fn) {
    const signer = await getSigner();
    const t = await fn(contract.connect(signer));
    const r = await t.wait();
    if (!r || r.status !== 1) throw new Error("The transaction failed on-chain.");
    return t.hash;
  }

  return {
    key, fromWei, toWei, fetchVault, encodeChange, decodeChange, iface: contract.interface,
    balance: async (k) => fromWei(await read.getBalance(String(k))),
    chainTime: async () => (await read.getBlock("latest")).timestamp,
    ops: {
      create: ({ kind, guardian, until }) => tx((c) => c.createVault(PRESETS[kind], guardian ? String(guardian) : ethers.ZeroAddress, until || 0)),
      deposit: (units) => tx((c) => c.deposit({ value: toWei(units) })),
      sendToTrusted: (dest, units) => tx((c) => c.sendToTrusted(String(dest), toWei(units))),
      requestWithdrawal: (dest, units) => tx((c) => c.requestWithdrawal(String(dest), toWei(units))),
      cancelWithdrawal: (id) => tx((c) => c.cancelWithdrawal(id)),
      executeWithdrawal: (owner, id) => tx((c) => c.executeWithdrawal(String(owner), id)),
      guardianRelease: (owner, id) => tx((c) => c.guardianRelease(String(owner), id)),
      proposeChange: (change) => tx((c) => c.proposeChange(encodeChange(change))),
      cancelChange: (id) => tx((c) => c.cancelChange(id)),
      applyChange: (owner, id) => tx((c) => c.applyChange(String(owner), id)),
      guardianApproveChange: (owner, id) => tx((c) => c.guardianApproveChange(String(owner), id)),
    },
  };
}
