// Is this site safe to deal with? Three checks, all on your computer:
// 1. Phishing lists: MetaMask's and ScamSniffer's public lists of scam domains, refreshed once a day.
// 2. Look-alikes: a name close to a well-known app (uniswaap.org, jup-claim.ag) or written with look-alike letters.
// 3. First visit: you have never connected this site to Ecrin.
const LISTS = [
  { url: "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json", pick: (j) => ({ block: j.blacklist || [], allow: j.whitelist || [] }) },
  { url: "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json", pick: (j) => ({ block: Array.isArray(j) ? j : [], allow: [] }) },
];
const DAY = 86400_000;

// Well-known apps people get phished for. A site that looks like one of these but isn't it gets a warning.
export const KNOWN = ["uniswap.org", "jup.ag", "raydium.io", "orca.so", "phantom.app", "phantom.com", "metamask.io", "opensea.io", "magiceden.io", "pump.fun",
  "aave.com", "curve.fi", "1inch.io", "lido.fi", "marginfi.com", "drift.trade", "tensor.trade", "ecrinprotocol.app", "solana.com", "ethereum.org", "coinbase.com",
  "binance.com", "kraken.com", "blur.io", "sushi.com", "pancakeswap.finance", "compound.finance", "arbitrum.io", "optimism.io", "base.org", "polygon.technology",
  "jito.network", "marinade.finance", "meteora.ag", "kamino.finance", "solflare.com", "backpack.app", "rabby.io", "etherscan.io", "solscan.io", "dexscreener.com",
  "birdeye.so", "hyperliquid.xyz", "eigenlayer.xyz", "ens.domains", "zora.co", "rainbow.me", "trustwallet.com", "ledger.com", "trezor.io"];

let mem = null; // { block: Set, allow: Set, at }

const clean = (d) => String(d || "").trim().toLowerCase().replace(/^\*\./, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
/** example.co.uk → example.co.uk; a.b.example.com → example.com (good enough for the lists and look-alikes). */
export function base(host) {
  const p = host.split(".");
  if (p.length <= 2) return host;
  const two = p.slice(-2).join(".");
  return /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/.test(two) ? p.slice(-3).join(".") : two;
}

async function load() {
  if (mem && Date.now() - mem.at < DAY) return mem;
  const st = await chrome.storage.local.get(["phishList"]);
  let list = st.phishList;
  if (!list || Date.now() - list.at > DAY) {
    const fresh = await refresh().catch(() => null);
    if (fresh) list = fresh;
  }
  mem = { block: new Set((list?.block || "").split("\n").filter(Boolean)), allow: new Set((list?.allow || "").split("\n").filter(Boolean)), at: Date.now(), updated: list?.at || 0 };
  return mem;
}

/** Downloads the lists and keeps them on this computer. Returns what it saved, or null if every list failed. */
export async function refresh() {
  const block = new Set(), allow = new Set();
  let ok = 0;
  await Promise.all(LISTS.map(async (L) => {
    try {
      const r = await fetch(L.url, { cache: "no-store" });
      if (!r.ok) return;
      const { block: b, allow: a } = L.pick(await r.json());
      b.forEach((d) => { d = clean(d); if (d && d.includes(".")) block.add(d); });
      a.forEach((d) => { d = clean(d); if (d) allow.add(d); });
      ok++;
    } catch (_) {}
  }));
  if (!ok) return null;
  const saved = { at: Date.now(), block: [...block].join("\n"), allow: [...allow].join("\n"), count: block.size };
  await chrome.storage.local.set({ phishList: saved });
  mem = null;
  return saved;
}

const lev = (a, b) => {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

/** Which well-known app this host imitates, if any. */
export function lookalike(host) {
  const b = base(host);
  if (KNOWN.some((k) => b === k || host === k || host.endsWith("." + k))) return null;
  if (host.split(".").some((l) => l.startsWith("xn--"))) return { kind: "chars" };
  const label = b.split(".")[0];
  for (const k of KNOWN) {
    const kl = k.split(".")[0];
    if (kl.length >= 4 && label !== kl && (lev(label, kl) <= (kl.length >= 7 ? 2 : 1) || (label.includes(kl) && label.length > kl.length))) return { kind: "name", like: k };
  }
  return null;
}

/** Everything Ecrin knows about a site. `allowed` holds sites you chose to open despite a warning. */
export async function check(host) {
  host = clean(host);
  const { siteAllow = {} } = await chrome.storage.local.get("siteAllow");
  let phish = false;
  try {
    const L = await load();
    const parts = host.split(".");
    const cands = parts.map((_, i) => parts.slice(i).join(".")).filter((h) => h.includes("."));
    if (!cands.some((h) => L.allow.has(h))) phish = cands.some((h) => L.block.has(h));
  } catch (_) {}
  // A test name so the warning can be tried safely (it never resolves to a real site).
  if (host === "phishing-test.ecrinprotocol.app") phish = true;
  return { host, phish, ignored: !!siteAllow[host], like: lookalike(host) };
}

export async function stats() {
  const { phishList } = await chrome.storage.local.get("phishList");
  return { at: phishList?.at || 0, count: phishList?.count || 0 };
}

// A new list (daily refresh, or "Update now") takes effect at once.
chrome.storage?.onChanged?.addListener((ch, area) => { if (area === "local" && ch.phishList) mem = null; });
