// Web demo only: the wallet's networks with pretend money. Same shape as chains.js, no blockchain involved:
// balances, the savings vault and its countdowns live in memory, and every action takes a moment like a real one.
import * as web3 from "@solana/web3.js";
import { ethers } from "ethers";
import { NETS, BASE, USDC_BASE, modeNets } from "./chains.js";
import { toTron, fromTron } from "./tron.js";
import { suiAddress, normAddr } from "./sui.js";
import { emitSent } from "./netmode.js";
import { ed25519 } from "@noble/curves/ed25519";
export { NETS, BASE, USDC_BASE, modeNets };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const books = {};
const now = () => Math.floor(Date.now() / 1000);

export function engine({ acct, net }) {
  const N = NETS[net], sol = N.fam === "sol";
  const address = sol ? acct.sol.publicKey.toBase58() : N.fam === "tron" ? toTron(acct.tron.address) : N.fam === "sui" ? suiAddress(ed25519.getPublicKey(acct.sui)) : acct.evm.address;
  const B = (books[net] ||= { native: sol ? 24.5 * BASE : 1.8 * BASE, usdc: N.usdc || sol || N.fam === "tron" ? 1250 * USDC_BASE : 0, vault: null, id: 1 }); // no test USDC where the real network has none
  const side = (a) => (a === "usdc" ? B.vault.usdc : B.vault.main);
  const free = (t) => t.balance - t.withdrawals.reduce((s, w) => s + w.amount, 0);
  const view = () => B.vault && { main: { ...B.vault.main, available: free(B.vault.main) }, usdc: { ...B.vault.usdc, available: free(B.vault.usdc) } };
  // Like a real network: a moment to reach it, then a moment to confirm.
  const act = async (fn) => { await wait(450 + Math.random() * 300); const id = "demo" + Math.random().toString(36).slice(2, 10); emitSent(id); await wait(700 + Math.random() * 600); fn(); return id; };
  return {
    N, address, explain: (e) => ({ message: e.message }),
    isAddress: (s) => { if (N.fam === "tron") return !!fromTron(s); if (N.fam === "sui") return !!normAddr(s); try { if (sol) new web3.PublicKey(String(s).trim()); else ethers.getAddress(String(s).trim()); return true; } catch (_) { return false; } },
    balances: async () => ({ native: B.native, usdc: B.usdc }),
    vault: async () => view(),
    reserve: (a) => (a === "native" ? (sol ? 10_000 : 30_000) : 0),
    feeText: () => (sol ? "≈ 0.000005 SOL" : "a little ETH for gas") + " · demo",
    send: (a, to, amount) => act(() => { B[a] -= amount; }),
    // Staking, pretend: a stake activates in ~20 s, earns at Solana's ~6.5% a year sped up so it visibly grows, and
    // comes back ~30 s after unstaking. Only where the real wallet has staking (Solana, Ethereum Hoodi).
    staking: sol || N.key === "hoodi" ? {
      kind: sol ? "sol" : "lido", apy: sol ? "6–7%" : "3%", unstakeTime: sol ? "about 2 to 3 days" : "about 1 to 5 days",
      async fetch() {
        const t = Date.now() / 1000, list = (B.stakes ||= []);
        const items = list.map((x) => {
          const on = t >= x.at + 20, earned = x.off ? x.earned : on ? Math.floor(x.principal * 0.065 * ((t - x.at - 20) * 3600) / (365 * 86400)) : 0;
          const status = x.off ? (t >= x.off + 30 ? "ready" : "cooling") : on ? "active" : "activating";
          return { id: x.id, amount: x.principal + earned, principal: x.principal, rewards: earned, status, eta: status === "cooling" ? Math.ceil(x.off + 30 - t) : status === "activating" ? Math.ceil(x.at + 20 - t) : 0, who: sol ? "Demo validator" : "Lido", wst: "1" };
        });
        return { open: !!B.stakesOpen, staked: items.reduce((q, x) => q + x.amount, 0), rewards: items.reduce((q, x) => q + x.rewards, 0), items, room: list.length < 4 };
      },
      stake: (amount) => act(() => { const m = B.vault.main; if (amount > free(m)) throw new Error("Not enough funds that aren't already queued"); m.balance -= amount; B.stakesOpen = true; (B.stakes ||= []).push({ id: B.id++, principal: amount, at: Date.now() / 1000 }); }),
      unstake: (item) => act(() => { const x = B.stakes.find((y) => y.id === item.id), t = Date.now() / 1000; x.earned = Math.floor(x.principal * 0.065 * (Math.max(0, t - x.at - 20) * 3600) / (365 * 86400)); x.off = t; }),
      reclaim: (item) => act(() => { const x = B.stakes.find((y) => y.id === item.id); B.vault.main.balance += x.principal + (x.earned || 0); B.stakes = B.stakes.filter((y) => y.id !== item.id); }),
    } : null,
    createVault: (kind) => act(() => {
      const d = kind === "gentle" ? 24 * 3600 : 72 * 3600;
      B.vault = { main: { balance: 0, withdrawDelay: d, ruleDelay: 7 * 86400, dailyLimit: null, lockedUntil: null, withdrawals: [], trusted: [], changes: [] }, usdc: { balance: 0, dailyLimit: null, withdrawals: [], changes: [] } };
    }),
    protect: (a, amount) => act(() => { B[a] -= amount; side(a).balance += amount; }),
    request: (a, dest, amount) => act(() => { side(a).withdrawals.push({ id: B.id++, amount, dest, readyAt: now() + B.vault.main.withdrawDelay }); }),
    cancel: (a, id) => act(() => { const t = side(a); t.withdrawals = t.withdrawals.filter((w) => w.id !== id); }),
    execute: (a, id) => act(() => { const t = side(a), w = t.withdrawals.find((x) => x.id === id); t.withdrawals = t.withdrawals.filter((x) => x.id !== id); t.balance -= w.amount; B[a] += w.amount; }),
    chainTime: async () => now(),
    // Rule changes, like the real program: stricter applies now, looser waits the rule delay.
    propose: (c) => act(() => {
      const m = B.vault.main, strict = (c.kind === "SetWithdrawDelay" && c.value >= m.withdrawDelay) || (c.kind === "SetDailyLimit" && c.value != null && (m.dailyLimit == null || c.value <= m.dailyLimit)) || (c.kind === "SetLockedUntil" && c.value > (m.lockedUntil || 0)) || c.kind === "RemoveTrusted";
      const apply = () => { if (c.kind === "SetWithdrawDelay") m.withdrawDelay = c.value; else if (c.kind === "SetDailyLimit") m.dailyLimit = c.value; else if (c.kind === "SetLockedUntil") m.lockedUntil = c.value; else if (c.kind === "SetGuardian") m.guardian = c.value; else if (c.kind === "AddTrusted") m.trusted.push(c.value); else if (c.kind === "RemoveTrusted") m.trusted = m.trusted.filter((t) => String(t) !== String(c.value)); };
      if (strict) apply(); else m.changes.push({ id: B.id++, change: { kind: c.kind, value: c.value }, readyAt: now() + m.ruleDelay, apply });
    }),
    cancelChange: (id) => act(() => { B.vault.main.changes = B.vault.main.changes.filter((x) => x.id !== id); }),
    applyChange: (id) => act(() => { const m = B.vault.main, x = m.changes.find((y) => y.id === id); if (x && x.readyAt <= now()) { x.apply?.(); m.changes = m.changes.filter((y) => y.id !== id); } }),
  };
}
