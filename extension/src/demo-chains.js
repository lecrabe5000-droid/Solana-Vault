// Web demo only: the wallet's networks with pretend money. Same shape as chains.js, no blockchain involved:
// balances, the savings vault and its countdowns live in memory, and every action takes a moment like a real one.
import * as web3 from "@solana/web3.js";
import { ethers } from "ethers";
import { NETS, BASE, USDC_BASE } from "./chains.js";
export { NETS, BASE, USDC_BASE };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const books = {};
const now = () => Math.floor(Date.now() / 1000);

export function engine({ acct, net }) {
  const N = NETS[net], sol = N.fam === "sol";
  const address = sol ? acct.sol.publicKey.toBase58() : acct.evm.address;
  const B = (books[net] ||= { native: sol ? 24.5 * BASE : 1.8 * BASE, usdc: 1250 * USDC_BASE, vault: null, id: 1 });
  const side = (a) => (a === "usdc" ? B.vault.usdc : B.vault.main);
  const free = (t) => t.balance - t.withdrawals.reduce((s, w) => s + w.amount, 0);
  const view = () => B.vault && { main: { ...B.vault.main, available: free(B.vault.main) }, usdc: { ...B.vault.usdc, available: free(B.vault.usdc) } };
  const act = async (fn) => { await wait(700 + Math.random() * 600); fn(); return null; };
  return {
    N, address, explain: (e) => ({ message: e.message }),
    isAddress: (s) => { try { if (sol) new web3.PublicKey(String(s).trim()); else ethers.getAddress(String(s).trim()); return true; } catch (_) { return false; } },
    balances: async () => ({ native: B.native, usdc: B.usdc }),
    vault: async () => view(),
    reserve: (a) => (a === "native" ? (sol ? 10_000 : 30_000) : 0),
    feeText: () => (sol ? "≈ 0.000005 SOL" : "a little ETH for gas") + " · demo",
    send: (a, to, amount) => act(() => { B[a] -= amount; }),
    createVault: (kind) => act(() => {
      const d = kind === "gentle" ? 24 * 3600 : 72 * 3600;
      B.vault = { main: { balance: 0, withdrawDelay: d, ruleDelay: 7 * 86400, dailyLimit: null, lockedUntil: null, withdrawals: [], trusted: [], changes: [] }, usdc: { balance: 0, dailyLimit: null, withdrawals: [], changes: [] } };
    }),
    protect: (a, amount) => act(() => { B[a] -= amount; side(a).balance += amount; }),
    request: (a, dest, amount) => act(() => { side(a).withdrawals.push({ id: B.id++, amount, dest, readyAt: now() + B.vault.main.withdrawDelay }); }),
    cancel: (a, id) => act(() => { const t = side(a); t.withdrawals = t.withdrawals.filter((w) => w.id !== id); }),
    execute: (a, id) => act(() => { const t = side(a), w = t.withdrawals.find((x) => x.id === id); t.withdrawals = t.withdrawals.filter((x) => x.id !== id); t.balance -= w.amount; B[a] += w.amount; }),
    chainTime: async () => now(),
  };
}
