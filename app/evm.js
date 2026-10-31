// Ecrin on Ethereum-style networks (Sepolia, Base, Arbitrum, Optimism, Polygon): reads vaults and sends transactions to evm/contracts/EcrinVault.sol through ethers.
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
  // tokens
  "function depositToken(address token, uint256 amount)",
  "function sendTokenToTrusted(address token, address dest, uint256 amount)",
  "function requestTokenWithdrawal(address token, address dest, uint256 amount) returns (uint32)",
  "function cancelTokenWithdrawal(address token, uint32 id)",
  "function executeTokenWithdrawal(address owner, address token, uint32 id)",
  "function guardianReleaseToken(address owner, address token, uint32 id)",
  "function proposeTokenLimit(address token, uint256 limit) returns (uint32)",
  "function cancelTokenChange(address token, uint32 id)",
  "function applyTokenChange(address owner, address token, uint32 id)",
  "function getTokenVault(address owner, address token) view returns (uint256 balance, uint256 dailyLimit, uint64 spentDay, uint256 spentToday, (uint32 id, uint256 amount, address dest, uint64 readyAt)[] withdrawals, (uint32 id, (uint8 kind, uint256 value, address addr) change, uint64 readyAt)[] changes)",
];

const ERC20 = ["function balanceOf(address) view returns (uint256)", "function allowance(address owner, address spender) view returns (uint256)", "function approve(address spender, uint256 amount) returns (bool)"];

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
  if (err?.code === "ACTION_REJECTED" || err?.code === 4001 || /user rejected|denied/i.test(text)) return { code: "Rejected", message: "You cancelled it in your wallet." };
  if (err?.code === -32002 || /already pending|resource not available|resource unavailable/i.test(text)) return { code: "Pending", message: "Your wallet already has a request waiting. Click its icon in the browser toolbar, approve or reject it, then try again." };
  if (err?.code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test(text)) return { code: "NoEth", message: "Your wallet doesn't have enough test coins for this (and the gas)." };
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

  /** One token's side of the vault. Amounts are the token's base units (1e6 per USDC), no conversion. */
  function token(tokenAddr) {
    const t = String(tokenAddr), erc = new ethers.Contract(t, ERC20, read);
    async function fetch(owner) {
      const o = String(owner);
      if (!(await contract.hasVault(o))) return null;
      const r = await contract.getTokenVault(o, t);
      const withdrawals = r.withdrawals.map((w) => ({ id: Number(w.id), amount: Number(w.amount), dest: new Addr(w.dest), readyAt: Number(w.readyAt) }));
      const balance = Number(r.balance);
      return {
        address: new Addr(EVM.address), balance, available: Math.max(0, balance - withdrawals.reduce((s, w) => s + w.amount, 0)),
        dailyLimit: BigInt(r.dailyLimit) === 0n ? null : Number(r.dailyLimit), spentDay: Number(r.spentDay), spentToday: Number(r.spentToday), withdrawals,
        changes: r.changes.map((c) => ({ id: Number(c.id), change: { kind: "SetDailyLimit", value: BigInt(c.change.value) === 0n ? null : Number(c.change.value) }, readyAt: Number(c.readyAt) })),
      };
    }
    return {
      fetch,
      walletBalance: async (owner) => Number(await erc.balanceOf(String(owner))),
      ops: {
        // The vault pulls the coins, so the wallet approves the amount first when it hasn't already.
        deposit: async (amount) => {
          const signer = await getSigner(), me = await signer.getAddress();
          if ((await erc.allowance(me, EVM.address)) < BigInt(amount)) {
            const a = await erc.connect(signer).approve(EVM.address, BigInt(amount));
            await a.wait();
          }
          return tx((c) => c.depositToken(t, BigInt(amount)));
        },
        sendToTrusted: (dest, amount) => tx((c) => c.sendTokenToTrusted(t, String(dest), BigInt(amount))),
        requestWithdrawal: (dest, amount) => tx((c) => c.requestTokenWithdrawal(t, String(dest), BigInt(amount))),
        cancelWithdrawal: (id) => tx((c) => c.cancelTokenWithdrawal(t, id)),
        executeWithdrawal: (owner, id) => tx((c) => c.executeTokenWithdrawal(String(owner), t, id)),
        guardianRelease: (owner, id) => tx((c) => c.guardianReleaseToken(String(owner), t, id)),
        proposeLimit: (limit) => tx((c) => c.proposeTokenLimit(t, limit === null ? 0n : BigInt(limit))),
        cancelChange: (id) => tx((c) => c.cancelTokenChange(t, id)),
        applyChange: (owner, id) => tx((c) => c.applyTokenChange(String(owner), t, id)),
      },
    };
  }

  return {
    key, fromWei, toWei, fetchVault, token, encodeChange, decodeChange, iface: contract.interface,
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
