// Builds app/coins.json: every coin you can swap to in Ecrin, and its address on each Ecrin network that holds tokens
// (the Ethereum-style networks and Solana), from LI.FI's own token lists. Only tokens LI.FI marks as verified and
// prices, grouped by LI.FI's coin key, so "Chainlink" is one coin with its address on Ethereum, Arbitrum, Base…
// The wallet searches this file on the device (nothing is sent while you type) and asks the live search for the rest.
//   node tools/coin-index.mjs            (writes app/coins.json; run it now and then to pick up new coins)
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Ecrin's network key → LI.FI chain id. Natives and USDC are built into the wallet; they are left out here.
const NETS = { ethm: 1, basem: 8453, arbm: 42161, opm: 10, polm: 137, bnbm: 56, avaxm: 43114, hypem: 999, solm: 1151111081099710 };
const NATIVE = new Set(["0x0000000000000000000000000000000000000000", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "11111111111111111111111111111111", "So11111111111111111111111111111111111111112"]);
const get = (url) => JSON.parse(execFileSync("curl", ["-sf", "--max-time", "120", url], { maxBuffer: 1 << 28 }).toString());

const coins = new Map(), lists = {};
for (const [k, chain] of Object.entries(NETS)) lists[k] = get(`https://li.quest/v1/tokens?chains=${chain}`).tokens?.[chain] || [];
// Two passes over every network: first the tokens LI.FI groups itself (its coin key), then the others, which may only
// join a coin under the same name (a "Pepe Community" is not "Pepe"), so a copy never takes the real one's place.
for (const grouped of [true, false]) for (const [k, list] of Object.entries(lists)) {
  let n = 0;
  for (const t of list) {
    if (!!t.coinKey !== grouped) continue;
    const px = Number(t.priceUSD) || 0, key = String(t.coinKey || t.symbol || "").toUpperCase();
    if (t.verificationStatus !== "verified" || !key || !(px > 0) || NATIVE.has(String(t.address).toLowerCase()) || NATIVE.has(t.address)) continue;
    if (!/^[\x20-\x7e]{1,12}$/.test(t.symbol || "") || !/^[\x20-\x7e]{1,40}$/.test(t.name || "")) continue; // plain names only
    if (/ \/ |\bLP\b|pool/i.test(t.name) || /(^|-)(UNI|SUSHI|CAKE)-V\d|-LP$|^LP-/i.test(t.symbol)) continue; // pool shares, not coins
    if (!grouped && coins.has(key) && coins.get(key).n.toLowerCase() !== String(t.name).toLowerCase()) continue;
    const c = coins.get(key) || { s: t.symbol, n: t.name, l: /^https:\/\/[^\s"'<>]+$/.test(t.logoURI || "") ? t.logoURI : "", p: px, on: {} };
    if (c.on[k]) continue; // the first (LI.FI lists the main one first) wins on each network
    c.on[k] = [t.address, t.decimals]; if (!c.l && /^https:\/\//.test(t.logoURI || "")) c.l = t.logoURI;
    coins.set(key, c); n++;
  }
  console.log(k, grouped ? "grouped" : "other", n, "kept");
}
// Keep coins on two networks or more: real coins are bridged, copies rarely are. Coins on one network only come from
// the live search, which shows their liquidity so a person can tell the real one from copies.
const out = [...coins.entries()].filter(([key, c]) => {
  const nets = Object.keys(c.on);
  return nets.length >= 2;
}).map(([, c]) => ({ ...c, p: Number(c.p.toPrecision(6)) }))
  .sort((a, b) => Object.keys(b.on).length - Object.keys(a.on).length || a.s.localeCompare(b.s));
writeFileSync(new URL("../app/coins.json", import.meta.url), JSON.stringify({ at: new Date().toISOString().slice(0, 10), coins: out }));
console.log("coins:", out.length);
