// Alert logic with no I/O: decode vault state, turn changes into events, and words for each event.
// Solana: we read each watched vault account (and its USDC token vault) and diff it against the last snapshot.
// Ethereum-style networks: we read the EcrinVault contract's event logs (every event carries the owner as topic 1;
// token events carry the token as topic 2). Events about a token carry `asset: { unit, decimals }`.

/** The networks alerts know, with their coin. */
export const NETS = {
  sol: { name: "Solana devnet", unit: "SOL", decimals: 9 },
  eth: { name: "Ethereum Sepolia", unit: "ETH", decimals: 18 },
  base: { name: "Base Sepolia", unit: "ETH", decimals: 18 },
  arb: { name: "Arbitrum Sepolia", unit: "ETH", decimals: 18 },
  op: { name: "Optimism Sepolia", unit: "ETH", decimals: 18 },
  pol: { name: "Polygon Amoy", unit: "POL", decimals: 18 },
};
export const USDC = { unit: "USDC", decimals: 6 };
const KINDS = ["SetWithdrawDelay", "SetRuleDelay", "SetDailyLimit", "SetLockedUntil", "SetGuardian", "AddTrusted", "RemoveTrusted"];

// ------------------------------------------------------------------ small helpers

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}
export function unbase58(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  const out = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of s) { if (c !== "1") break; out.unshift(0); }
  return Uint8Array.from(out);
}

// ed25519: is this 32-byte string a point on the curve? (A program address must not be.)
const P = 2n ** 255n - 19n, D = (-121665n * inv(121666n)) % P + P;
function pow(b, e) { let r = 1n; b %= P; while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; } return r; }
function inv(x) { return pow(((x % P) + P) % P, P - 2n); }
export function onCurve(bytes) {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
  if (y >= P) return false;
  const y2 = (y * y) % P, u = (y2 - 1n + P) % P, v = (D % P * y2 + 1n) % P;
  const x = (u * pow(v, 3n) % P) * pow(u * pow(v, 7n) % P, (P - 5n) / 8n) % P; // candidate square root of u/v (RFC 8032)
  const vx2 = (v * x % P) * x % P;
  return vx2 === u || vx2 === (P - u) % P;
}

/** Solana's findProgramAddress: the first bump from 255 down whose hash is off the curve. Returns base58. */
export async function findPda(seeds, programId) {
  const prog = unbase58(programId), tail = new TextEncoder().encode("ProgramDerivedAddress");
  for (let bump = 255; bump >= 0; bump--) {
    const parts = [...seeds, Uint8Array.of(bump), prog, tail], buf = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let i = 0; for (const p of parts) { buf.set(p, i); i += p.length; }
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
    if (!onCurve(h)) return base58(h);
  }
  throw new Error("no program address");
}
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
/** The owner's token vault for a mint, and the token account that holds its coins. */
export async function tokenVaultAddresses(owner, mint, programId) {
  const vault = await findPda([new TextEncoder().encode("tvault"), unbase58(owner), unbase58(mint)], programId);
  const holds = await findPda([unbase58(vault), unbase58(TOKEN_PROGRAM), unbase58(mint)], ATA_PROGRAM);
  return { vault, holds };
}
/** The amount in an SPL token account (u64 at byte 64). */
export const tokenAmount = (data) => new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true).toString();

export const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const short = (a) => { const s = String(a); return s.length > 12 ? s.slice(0, 4) + "…" + s.slice(-4) : s; };

/** Formats base units (lamports, wei, USDC's 1e-6) as a coin amount with up to 4 decimals. */
export function coin(units, decimals) {
  const one = 10n ** BigInt(decimals), v = BigInt(units);
  const whole = v / one, frac = ((v % one) * 10000n) / one;
  return frac ? `${whole}.${String(frac).padStart(4, "0").replace(/0+$/, "")}` : String(whole);
}
const words = (s, fr) => { s = Number(s); if (s % 86400 === 0) { const d = s / 86400; return fr ? `${d} jour${d === 1 ? "" : "s"}` : `${d} day${d === 1 ? "" : "s"}`; } return `${Math.round(s / 3600)} h`; };
export const when = (t, fr) => new Date(Number(t) * 1000).toLocaleString(fr ? "fr-CA" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const inTime = (t, now, fr) => {
  const s = Number(t) - now; if (s <= 0) return fr ? "maintenant" : "now";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.ceil((s % 3600) / 60);
  return fr ? (d ? `dans ${d} j ${h} h` : h ? `dans ${h} h ${m} min` : `dans ${m} min`) : (d ? `in ${d}d ${h}h` : h ? `in ${h}h ${m}m` : `in ${m} min`);
};

// ------------------------------------------------------------------ Solana: decode and diff

class R {
  constructor(d) { this.d = d; this.v = new DataView(d.buffer, d.byteOffset, d.byteLength); this.i = 0; }
  u8() { return this.d[this.i++]; }
  u32() { const n = this.v.getUint32(this.i, true); this.i += 4; return n; }
  u64() { const n = this.v.getBigUint64(this.i, true); this.i += 8; return n; }
  i64() { const n = this.v.getBigInt64(this.i, true); this.i += 8; return n; }
  key() { const k = base58(this.d.subarray(this.i, this.i + 32)); this.i += 32; return k; }
  opt(f) { return this.u8() ? f() : null; }
  vec(f) { const n = this.u32(); return Array.from({ length: n }, f); }
}

/** Decodes a VaultAccount (after its 8-byte discriminator) into plain JSON-safe values (amounts as strings). */
export function decodeSolVault(data) {
  const r = new R(data.subarray(8));
  const v = { owner: r.key(), bump: r.u8(), balance: r.u64(), withdrawDelay: r.i64(), ruleDelay: r.i64(), dailyLimit: r.opt(() => r.u64()), lockedUntil: r.opt(() => r.i64()), guardian: r.opt(() => r.key()) };
  v.trusted = r.vec(() => r.key());
  v.withdrawals = r.vec(() => ({ id: r.u32(), amount: r.u64(), dest: r.key(), readyAt: r.i64() }));
  v.changes = r.vec(() => {
    const id = r.u32(), tag = r.u8(), kind = KINDS[tag];
    const value = tag <= 1 ? r.i64() : tag === 2 ? r.opt(() => r.u64()) : tag === 3 ? r.opt(() => r.i64()) : tag === 4 ? r.opt(() => r.key()) : r.key();
    return { id, kind, value, readyAt: r.i64() };
  });
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
}

/** Decodes a TokenVaultAccount into the same shape as a vault snapshot, with the balance its token account holds.
 *  Fields a token vault doesn't have are fixed, so diffSol only reports this token's money and limit. */
export function decodeSolTokenVault(data, balance) {
  const r = new R(data.subarray(8));
  const t = { owner: r.key(), mint: r.key(), bump: r.u8(), dailyLimit: r.opt(() => r.u64()), spentDay: r.i64(), spentToday: r.u64() };
  t.withdrawals = r.vec(() => ({ id: r.u32(), amount: r.u64(), dest: r.key(), readyAt: r.i64() }));
  t.changes = r.vec(() => {
    const id = r.u32(), tag = r.u8(), kind = KINDS[tag];
    const value = tag <= 1 ? r.i64() : tag === 2 ? r.opt(() => r.u64()) : tag === 3 ? r.opt(() => r.i64()) : tag === 4 ? r.opt(() => r.key()) : r.key();
    return { id, kind, value, readyAt: r.i64() };
  });
  const v = { owner: t.owner, mint: t.mint, balance: String(balance), withdrawDelay: "0", ruleDelay: "0", dailyLimit: t.dailyLimit, lockedUntil: null, guardian: null, trusted: [], withdrawals: t.withdrawals, changes: t.changes };
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
}
/** An empty token vault, to diff against when one appears (so its first deposit is reported). */
export const emptyTokenSnap = { balance: "0", withdrawDelay: "0", ruleDelay: "0", dailyLimit: null, lockedUntil: null, guardian: null, trusted: [], withdrawals: [], changes: [] };

/** Compares two snapshots of one Solana vault and returns what happened, oldest first. */
export function diffSol(prev, next) {
  const ev = [];
  if (!prev && next) return [{ type: "created" }];
  if (!prev || !next) return ev;
  const pw = new Map(prev.withdrawals.map((w) => [w.id, w])), nw = new Map(next.withdrawals.map((w) => [w.id, w]));
  let explained = 0n;
  for (const [id, w] of pw) if (!nw.has(id)) {
    // Gone: it either ran (the balance dropped by its amount) or was cancelled.
    const dropped = BigInt(prev.balance) - BigInt(next.balance) - explained;
    if (dropped >= BigInt(w.amount)) { explained += BigInt(w.amount); ev.push({ type: "sent", amount: w.amount, dest: w.dest }); }
    else ev.push({ type: "cancelled", amount: w.amount, dest: w.dest });
  }
  for (const [id, w] of nw) if (!pw.has(id)) ev.push({ type: "requested", id, amount: w.amount, dest: w.dest, readyAt: w.readyAt });
  const delta = BigInt(next.balance) - BigInt(prev.balance) + explained;
  if (delta > 0n) ev.push({ type: "deposit", amount: String(delta) });
  else if (delta < 0n) ev.push({ type: "sentTrusted", amount: String(-delta) });
  const pc = new Set(prev.changes.map((c) => c.id));
  for (const c of next.changes) if (!pc.has(c.id)) ev.push({ type: "changeQueued", id: c.id, kind: c.kind, value: c.value, readyAt: c.readyAt });
  const field = (kind, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) ev.push({ type: "changed", kind, value: b }); };
  field("SetWithdrawDelay", prev.withdrawDelay, next.withdrawDelay);
  field("SetRuleDelay", prev.ruleDelay, next.ruleDelay);
  field("SetDailyLimit", prev.dailyLimit, next.dailyLimit);
  field("SetLockedUntil", prev.lockedUntil, next.lockedUntil);
  field("SetGuardian", prev.guardian, next.guardian);
  for (const a of next.trusted) if (!prev.trusted.includes(a)) ev.push({ type: "changed", kind: "AddTrusted", value: a });
  for (const a of prev.trusted) if (!next.trusted.includes(a)) ev.push({ type: "changed", kind: "RemoveTrusted", value: a });
  const nc = new Set(next.changes.map((c) => c.id)), applied = new Set(ev.filter((e) => e.type === "changed").map((e) => e.kind));
  for (const c of prev.changes) if (!nc.has(c.id) && !applied.has(c.kind)) ev.push({ type: "changeCancelled", kind: c.kind, value: c.value });
  return ev;
}

// ------------------------------------------------------------------ Ethereum: decode logs

export const TOPICS = {
  "0x597fbcb71eb7ed6d840f5b85c8b386c7a28ff717ed702eca46f373d330158bb4": "VaultCreated",
  "0x2da466a7b24304f47e87fa2e1e5a81b9831ce54fec19055ce277ca2f39ba42c4": "Deposited",
  "0x3990db2d31862302a685e8086b5755072a6e2b5b780af1ee81ece35ee3cd3345": "Sent",
  "0xad65ccfc174897eef69da71a716496cd0717964f56b90c4f4f0dbfedd0e0be17": "WithdrawalQueued",
  "0x48ef11f023d4c07a6e707086835ea4c9d2ce5857581b21807a19044a9c6d176d": "WithdrawalCancelled",
  "0x105e142ef20dc04ad8b73f1411f429aa7a948f6faedd138e78e8863b6d1efddd": "ChangeQueued",
  "0xa70cddd5e3d28d553f381a431e09db6e9b729e5b7920200ad5c7adacfbd81c3b": "ChangeApplied",
  "0xa8a15db10499efdfa37b2acfc2998e2fb9153427bfa22be6cee5a91afbf96209": "ChangeCancelled",
  "0xf1444b5cad7ce70cb018d1b8edc8618fe303f3c7f034d8d572a6e27facbf2bef": "TokenDeposited",
  "0xa4162acb2096ecf8e81304c656b4ff4eb143f95264f26ac3dad5a3b96bb68b53": "TokenSent",
  "0xdc93c532eacec4adb5024b65d8925519c461cfd05c189538676190c639dbb715": "TokenWithdrawalQueued",
  "0x90be254c081e9ef277f26fddb373a7861a21a21f4d2f7daa3efe223c2f55a6cb": "TokenWithdrawalCancelled",
  "0xceba88dfc113f090934b416532834c2e4f3ed8c5c316f0ba087ce4e952d0ba0f": "TokenLimitQueued",
  "0x07016a3b6ceb9ef4ff5cfccd13b4a259ff7e9d0cb395ede6a02642b77eae7542": "TokenLimitApplied",
  "0xe4d5f57d239eb4a4e157c64ac061be2686a10d372221d242e7bfd982ed2781bb": "TokenLimitCancelled",
};
export const ownerTopic = (addr) => "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const word = (data, i) => data.slice(2 + i * 64, 2 + (i + 1) * 64);
const uint = (data, i) => BigInt("0x" + word(data, i)).toString();
const addr = (hex64) => "0x" + hex64.slice(24);

/** Turns one EcrinVault log into { owner, event } (event in the same shape as diffSol's), or null.
 *  `usdc` is this network's USDC address: token events for it say USDC; any other token is named by its address. */
export function decodeEvmLog(log, usdc = null) {
  const name = TOPICS[log.topics?.[0]?.toLowerCase()];
  if (!name) return null;
  const owner = addr(log.topics[1].slice(2)), d = log.data;
  const kindVal = (kIdx, vIdx, aIdx) => {
    const kind = KINDS[Number(uint(d, kIdx))], raw = uint(d, vIdx), a = addr(word(d, aIdx));
    const zero = /^0x0{40}$/.test(a);
    const value = kind === "SetGuardian" ? (zero ? null : a) : kind === "AddTrusted" || kind === "RemoveTrusted" ? a : (kind === "SetDailyLimit" || kind === "SetLockedUntil") && raw === "0" ? null : raw;
    return { kind, value };
  };
  let event;
  switch (name) {
    case "VaultCreated": event = { type: "created" }; break;
    case "Deposited": event = { type: "deposit", amount: uint(d, 0) }; break;
    case "Sent": event = { type: "sentAny", amount: uint(d, 0), dest: addr(log.topics[2].slice(2)) }; break;
    case "WithdrawalQueued": event = { type: "requested", id: Number(uint(d, 0)), dest: addr(word(d, 1)), amount: uint(d, 2), readyAt: uint(d, 3) }; break;
    case "WithdrawalCancelled": event = { type: "cancelled", id: Number(uint(d, 0)) }; break;
    case "ChangeQueued": event = { type: "changeQueued", id: Number(uint(d, 0)), ...kindVal(1, 2, 3), readyAt: uint(d, 4) }; break;
    case "ChangeApplied": event = { type: "changed", ...kindVal(0, 1, 2) }; break;
    case "ChangeCancelled": event = { type: "changeCancelled", id: Number(uint(d, 0)) }; break;
  }
  if (name.startsWith("Token")) {
    const token = addr(log.topics[2].slice(2)), asset = usdc && token.toLowerCase() === usdc.toLowerCase() ? USDC : { unit: `tokens (${short(token)})`, decimals: 18 };
    const limit = (i) => (uint(d, i) === "0" ? null : uint(d, i));
    switch (name) {
      case "TokenDeposited": event = { type: "deposit", amount: uint(d, 0) }; break;
      case "TokenSent": event = { type: "sentAny", amount: uint(d, 0), dest: addr(log.topics[3].slice(2)) }; break;
      case "TokenWithdrawalQueued": event = { type: "requested", id: Number(uint(d, 0)), dest: addr(word(d, 1)), amount: uint(d, 2), readyAt: uint(d, 3) }; break;
      case "TokenWithdrawalCancelled": event = { type: "cancelled", id: Number(uint(d, 0)) }; break;
      case "TokenLimitQueued": event = { type: "changeQueued", id: Number(uint(d, 0)), kind: "SetDailyLimit", value: limit(1), readyAt: uint(d, 2) }; break;
      case "TokenLimitApplied": event = { type: "changed", kind: "SetDailyLimit", value: limit(0) }; break;
      case "TokenLimitCancelled": event = { type: "changeCancelled", id: Number(uint(d, 0)) }; break;
    }
    event.asset = asset;
  }
  return { owner, event, block: parseInt(log.blockNumber, 16), tx: log.transactionHash };
}

// ------------------------------------------------------------------ words

function changeWords(kind, value, fmt, fr) {
  const w = (v) => words(v, fr);
  switch (kind) {
    case "SetWithdrawDelay": return fr ? `Les retraits attendent ${w(value)}` : `Withdrawals wait ${w(value)}`;
    case "SetRuleDelay": return fr ? `Les assouplissements attendent ${w(value)}` : `Looser rules wait ${w(value)}`;
    case "SetDailyLimit": return value ? (fr ? `Limite quotidienne de ${fmt(value)}` : `Daily limit ${fmt(value)}`) : fr ? `Aucune limite quotidienne${fmt.unit ? ` en ${fmt.unit}` : ""}` : `No daily limit${fmt.unit ? ` on ${fmt.unit}` : ""}`;
    case "SetLockedUntil": return value ? (fr ? `Verrouillé jusqu'au ${when(value, fr)} : rien ne peut sortir d'ici là` : `Locked until ${when(value)}: nothing can leave before then`) : fr ? "Verrou terminé" : "Lock ended";
    case "SetGuardian": return value ? (fr ? `Gardien changé pour ${short(value)}` : `Guardian set to ${short(value)}`) : fr ? "Gardien retiré" : "Guardian removed";
    case "AddTrusted": return fr ? `Adresse de confiance ajoutée : ${short(value)}` : `Trusted address added: ${short(value)}`;
    case "RemoveTrusted": return fr ? `Adresse de confiance retirée : ${short(value)}` : `Trusted address removed: ${short(value)}`;
  }
  return kind;
}

/**
 * The Telegram message for one event: { text, urgent }. HTML parse mode; every value we insert is an
 * address, a number or a fixed phrase, so there is nothing to escape beyond what esc() covers.
 */
/** Where an alert's button should take the person: straight to the item to cancel when there is one. */
export function alertLink(event, net, site = "https://ecrinprotocol.app", owner = "", lang = "en") {
  const fr = lang === "fr", open = fr ? "Ouvrir Ecrin" : "Open Ecrin", cancel = fr ? "Annuler" : "Cancel it";
  const base = `${site}/app?net=${net}&tab=vault`, who = owner ? `&owner=${encodeURIComponent(owner)}` : "", asset = event.asset ? (event.asset.unit === "USDC" ? "usdc" : null) : "native";
  if (event.id == null || !asset) return { label: open, url: base };
  if (event.type === "requested") return { label: cancel, url: `${base}&act=cancel-w&id=${event.id}&asset=${asset}${who}` };
  if (event.type === "changeQueued") return { label: cancel, url: `${base}&act=cancel-c&id=${event.id}&asset=${asset}${who}` };
  return { label: open, url: base };
}

/** The buttons under an alert: the item itself, and for anything that could be an attack, a freeze. */
export function alertLinks(event, net, site = "https://ecrinprotocol.app", owner = "", lang = "en") {
  const first = alertLink(event, net, site, owner, lang);
  if (event.type !== "requested" && event.type !== "changeQueued") return [first];
  const who = owner ? `&owner=${encodeURIComponent(owner)}` : "";
  return [first, { label: lang === "fr" ? "Geler le coffre" : "Freeze vault", url: `${site}/app?net=${net}&tab=vault&act=freeze${who}` }];
}

export function message(event, { net, owner, now = Math.floor(Date.now() / 1000), lang = "en" }) {
  const fr = lang === "fr", n = NETS[net] || NETS.eth, a = event.asset || n;
  const fmt = (u) => `${fr ? coin(u, a.decimals).replace(".", ",") : coin(u, a.decimals)} ${a.unit}`;
  if (event.asset) fmt.unit = a.unit;
  const head = `<b>Ecrin · ${n.name}</b> · ${fr ? "coffre" : "vault"} <code>${esc(short(owner))}</code>\n\n`;
  const e = event, cw = () => esc(changeWords(e.kind, e.value, fmt, fr));
  if (fr) switch (e.type) {
    case "requested": return { urgent: true, text: head + `⏳ <b>Retrait demandé</b>\n${e.amount ? fmt(e.amount) : "Des fonds"} vers <code>${esc(short(e.dest))}</code>\nIl peut sortir ${inTime(e.readyAt, now, fr)} (${when(e.readyAt, fr)}).\n\n<b>Pas vous?</b> Touchez Annuler ci-dessous (gratuit et instantané), ou Geler le coffre pour tout arrêter le temps de vérifier.` };
    case "cancelled": return { text: head + `🛡 <b>Retrait annulé</b>${e.amount ? `\n${fmt(e.amount)} reste dans votre coffre.` : "\nLes fonds restent dans votre coffre."}` };
    case "sent": return { text: head + `↗ <b>Retrait envoyé</b>\n${fmt(e.amount)} est sorti du coffre vers <code>${esc(short(e.dest))}</code>.` };
    case "sentAny": return { text: head + `↗ <b>Des fonds sont sortis du coffre</b>\n${fmt(e.amount)} vers <code>${esc(short(e.dest))}</code>.` };
    case "sentTrusted": return { text: head + `↗ <b>Envoyé à une adresse de confiance</b>\n${fmt(e.amount)} est sorti du coffre.` };
    case "deposit": return { text: head + `↘ <b>Dépôt</b>\n${fmt(e.amount)} ajouté à votre coffre.` };
    case "changeQueued": return { urgent: true, text: head + `⚙ <b>Changement de règle demandé</b>\n${cw()}\nIl s'applique ${inTime(e.readyAt, now, fr)} (${when(e.readyAt, fr)}).\n\n<b>Pas vous?</b> Touchez Annuler ci-dessous.` };
    case "changed": return { text: head + `⚙ <b>Règle modifiée</b>\n${cw()}` };
    case "changeCancelled": return { text: head + `⚙ <b>Changement de règle annulé</b>${e.kind ? `\n${cw()} : ça n'aura pas lieu.` : ""}` };
    case "created": return { text: head + `✦ <b>Coffre créé</b>\nEcrin le surveille à partir de maintenant.` };
  }
  switch (e.type) {
    case "requested": return { urgent: true, text: head + `⏳ <b>Withdrawal requested</b>\n${e.amount ? fmt(e.amount) : "Funds"} to <code>${esc(short(e.dest))}</code>\nIt can leave ${inTime(e.readyAt, now)} (${when(e.readyAt)}).\n\n<b>Not you?</b> Tap Cancel it below (free and instant), or Freeze vault to stop everything while you look into it.` };
    case "cancelled": return { text: head + `🛡 <b>Withdrawal cancelled</b>${e.amount ? `\n${fmt(e.amount)} stays in your vault.` : "\nThe funds stay in your vault."}` };
    case "sent": return { text: head + `↗ <b>Withdrawal sent</b>\n${fmt(e.amount)} left the vault to <code>${esc(short(e.dest))}</code>.` };
    case "sentAny": return { text: head + `↗ <b>Funds left the vault</b>\n${fmt(e.amount)} to <code>${esc(short(e.dest))}</code>.` };
    case "sentTrusted": return { text: head + `↗ <b>Sent to a trusted address</b>\n${fmt(e.amount)} left the vault.` };
    case "deposit": return { text: head + `↘ <b>Deposit</b>\n${fmt(e.amount)} added to your vault.` };
    case "changeQueued": return { urgent: true, text: head + `⚙ <b>Rule change requested</b>\n${cw()}\nIt applies ${inTime(e.readyAt, now)} (${when(e.readyAt)}).\n\n<b>Not you?</b> Tap Cancel it below.` };
    case "changed": return { text: head + `⚙ <b>Rule changed</b>\n${cw()}` };
    case "changeCancelled": return { text: head + `⚙ <b>Rule change cancelled</b>${e.kind ? `\n${cw()} won't happen.` : ""}` };
    case "created": return { text: head + `✦ <b>Vault created</b>\nEcrin is watching it from now on.` };
  }
  return null;
}

export const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
