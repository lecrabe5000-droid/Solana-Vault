// Alert logic with no I/O: decode vault state, turn changes into events, and words for each event.
// Solana: we read each watched vault account and diff it against the last snapshot.
// Ethereum: we read the EcrinVault contract's event logs (every event carries the owner as topic 1).

const LAMPORTS = 1_000_000_000n, WEI = 1_000_000_000_000_000_000n;
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
export const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const short = (a) => { const s = String(a); return s.length > 12 ? s.slice(0, 4) + "…" + s.slice(-4) : s; };

/** Formats base units (lamports or wei) as a coin amount with up to 4 decimals. */
export function coin(units, decimals) {
  const one = decimals === 9 ? LAMPORTS : WEI, v = BigInt(units);
  const whole = v / one, frac = ((v % one) * 10000n) / one;
  return frac ? `${whole}.${String(frac).padStart(4, "0").replace(/0+$/, "")}` : String(whole);
}
const words = (s) => { s = Number(s); return s % 86400 === 0 ? `${s / 86400} day${s === 86400 ? "" : "s"}` : `${Math.round(s / 3600)} h`; };
export const when = (t) => new Date(Number(t) * 1000).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const inTime = (t, now) => { const s = Number(t) - now; if (s <= 0) return "now"; const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.ceil((s % 3600) / 60); return d ? `in ${d}d ${h}h` : h ? `in ${h}h ${m}m` : `in ${m} min`; };

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
  for (const [id, w] of nw) if (!pw.has(id)) ev.push({ type: "requested", amount: w.amount, dest: w.dest, readyAt: w.readyAt });
  const delta = BigInt(next.balance) - BigInt(prev.balance) + explained;
  if (delta > 0n) ev.push({ type: "deposit", amount: String(delta) });
  else if (delta < 0n) ev.push({ type: "sentTrusted", amount: String(-delta) });
  const pc = new Set(prev.changes.map((c) => c.id));
  for (const c of next.changes) if (!pc.has(c.id)) ev.push({ type: "changeQueued", kind: c.kind, value: c.value, readyAt: c.readyAt });
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
};
export const ownerTopic = (addr) => "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const word = (data, i) => data.slice(2 + i * 64, 2 + (i + 1) * 64);
const uint = (data, i) => BigInt("0x" + word(data, i)).toString();
const addr = (hex64) => "0x" + hex64.slice(24);

/** Turns one EcrinVault log into { owner, event } (event in the same shape as diffSol's), or null. */
export function decodeEvmLog(log) {
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
  return { owner, event, block: parseInt(log.blockNumber, 16), tx: log.transactionHash };
}

// ------------------------------------------------------------------ words

function changeWords(kind, value, fmt) {
  switch (kind) {
    case "SetWithdrawDelay": return `Withdrawals wait ${words(value)}`;
    case "SetRuleDelay": return `Looser rules wait ${words(value)}`;
    case "SetDailyLimit": return value ? `Daily limit ${fmt(value)}` : "No daily limit";
    case "SetLockedUntil": return value ? `Locked until ${when(value)}` : "Lock ended";
    case "SetGuardian": return value ? `Guardian set to ${short(value)}` : "Guardian removed";
    case "AddTrusted": return `Trusted address added: ${short(value)}`;
    case "RemoveTrusted": return `Trusted address removed: ${short(value)}`;
  }
  return kind;
}

/**
 * The Telegram message for one event: { text, urgent }. HTML parse mode; every value we insert is an
 * address, a number or a fixed phrase, so there is nothing to escape beyond what esc() covers.
 */
export function message(event, { net, owner, now = Math.floor(Date.now() / 1000) }) {
  const sol = net === "sol", unit = sol ? "SOL" : "ETH", fmt = (u) => `${coin(u, sol ? 9 : 18)} ${unit}`;
  const head = `<b>Ecrin · ${sol ? "Solana devnet" : "Ethereum Sepolia"}</b> · vault <code>${esc(short(owner))}</code>\n\n`;
  const e = event;
  switch (e.type) {
    case "requested": return { urgent: true, text: head + `⏳ <b>Withdrawal requested</b>\n${e.amount ? fmt(e.amount) : "Funds"} to <code>${esc(short(e.dest))}</code>\nIt can leave ${inTime(e.readyAt, now)} (${when(e.readyAt)}).\n\n<b>Not you?</b> Open Ecrin and cancel it. Cancelling is free and instant.` };
    case "cancelled": return { text: head + `🛡 <b>Withdrawal cancelled</b>${e.amount ? `\n${fmt(e.amount)} stays in your vault.` : "\nThe funds stay in your vault."}` };
    case "sent": return { text: head + `↗ <b>Withdrawal sent</b>\n${fmt(e.amount)} left the vault to <code>${esc(short(e.dest))}</code>.` };
    case "sentAny": return { text: head + `↗ <b>Funds left the vault</b>\n${fmt(e.amount)} to <code>${esc(short(e.dest))}</code>.` };
    case "sentTrusted": return { text: head + `↗ <b>Sent to a trusted address</b>\n${fmt(e.amount)} left the vault.` };
    case "deposit": return { text: head + `↘ <b>Deposit</b>\n${fmt(e.amount)} added to your vault.` };
    case "changeQueued": return { urgent: true, text: head + `⚙ <b>Rule change requested</b>\n${esc(changeWords(e.kind, e.value, fmt))}\nIt applies ${inTime(e.readyAt, now)} (${when(e.readyAt)}).\n\n<b>Not you?</b> Open Ecrin and cancel it.` };
    case "changed": return { text: head + `⚙ <b>Rule changed</b>\n${esc(changeWords(e.kind, e.value, fmt))}` };
    case "changeCancelled": return { text: head + `⚙ <b>Rule change cancelled</b>${e.kind ? `\n${esc(changeWords(e.kind, e.value, fmt))} won't happen.` : ""}` };
    case "created": return { text: head + `✦ <b>Vault created</b>\nEcrin is watching it from now on.` };
  }
  return null;
}

export const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
