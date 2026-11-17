// Ecrin on-chain client: builds the program's instructions and reads vault accounts, with no Anchor runtime.
// Works in the browser (web3 = window.solanaWeb3) and in Node (web3 = @solana/web3.js). The layouts below follow
// programs/cooldown-vault/src/lib.rs exactly: if you change an account or an argument there, change it here and
// in tests/client.test.mjs (which runs this file against a local validator in CI).

const enc = new TextEncoder();

export const ERRORS = [
  ["NotOwner", "Only the Safe owner can do that."],
  ["NotGuardian", "Only the guardian can do that."],
  ["NoGuardian", "This vault has no guardian."],
  ["ZeroAmount", "Enter an amount above zero."],
  ["InsufficientFunds", "Not enough funds that aren't already queued."],
  ["NotTrusted", "That address isn't trusted yet."],
  ["Locked", "The Safe is locked until its date."],
  ["TooEarly", "Not yet: the waiting time hasn't passed."],
  ["DailyLimit", "That's over today's limit."],
  ["NotFound", "That item is gone."],
  ["TooManyPending", "Too many things are already waiting."],
  ["TooManyTrusted", "You can trust up to 8 addresses."],
  ["InvalidValue", "That value isn't allowed."],
  ["Overflow", "That amount is too large."],
  ["WrongDestination", "That isn't where this withdrawal goes."],
  ["DepositsPaused", "New deposits are paused for now. Your Safe still works: withdrawals, cancels and rules are unaffected."],
];

/** Turns a failed transaction into { code, message } when it is one of the program's errors. */
export function explainError(err) {
  const text = String(err?.message || err) + " " + (err?.logs || []).join(" ");
  const hex = text.match(/custom program error: 0x([0-9a-f]+)/i);
  const num = hex ? parseInt(hex[1], 16) : Number((text.match(/Error Number: (\d+)/) || [])[1]);
  const named = ERRORS.find(([code]) => text.includes(`Error Code: ${code}.`));
  const hit = named || (num >= 6000 ? ERRORS[num - 6000] : null);
  if (hit) return { code: hit[0], message: hit[1] };
  if (/User rejected|rejected the request/i.test(text)) return { code: "Rejected", message: "You cancelled it in your wallet." };
  if (/no record of a prior credit|AccountNotFound/i.test(text)) return { code: "NoSol", message: "This wallet has no SOL yet. You need a little to pay the network fee: use Receive to get free test SOL." };
  if (/insufficient lamports|insufficient funds for fee|0x1\b/i.test(text)) return { code: "NoSol", message: "Your wallet doesn't have enough SOL for this (and the fee)." };
  return { code: "Unknown", message: text.slice(0, 200) };
}

// ------------------------------------------------------------------ borsh, by hand

class W {
  constructor() { this.parts = []; }
  bytes(b) { this.parts.push(Uint8Array.from(b)); return this; }
  u8(n) { return this.bytes([n]); }
  u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return this.bytes(b); }
  u64(n) { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return this.bytes(b); }
  i64(n) { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(n), true); return this.bytes(b); }
  key(k) { return this.bytes(k.toBytes()); }
  opt(v, f) { if (v === null || v === undefined) return this.u8(0); this.u8(1); f(v); return this; }
  out() { const n = this.parts.reduce((s, p) => s + p.length, 0), o = new Uint8Array(n); let i = 0; for (const p of this.parts) { o.set(p, i); i += p.length; } return o; }
}

class R {
  constructor(data, web3) { this.d = data; this.v = new DataView(data.buffer, data.byteOffset, data.byteLength); this.i = 0; this.web3 = web3; }
  u8() { return this.d[this.i++]; }
  u32() { const n = this.v.getUint32(this.i, true); this.i += 4; return n; }
  u64() { const n = this.v.getBigUint64(this.i, true); this.i += 8; return Number(n); }
  i64() { const n = this.v.getBigInt64(this.i, true); this.i += 8; return Number(n); }
  key() { const k = new this.web3.PublicKey(this.d.slice(this.i, this.i + 32)); this.i += 32; return k; }
  opt(f) { return this.u8() ? f() : null; }
  vec(f) { const n = this.u32(); return Array.from({ length: n }, f); }
}

const CHANGE_KINDS = ["SetWithdrawDelay", "SetRuleDelay", "SetDailyLimit", "SetLockedUntil", "SetGuardian", "AddTrusted", "RemoveTrusted"];

function writeChange(w, { kind, value }) {
  const tag = CHANGE_KINDS.indexOf(kind);
  if (tag < 0) throw new Error("Unknown change " + kind);
  w.u8(tag);
  if (tag <= 1) w.i64(value);
  else if (tag === 2) w.opt(value, (x) => w.u64(x));
  else if (tag === 3) w.opt(value, (x) => w.i64(x));
  else if (tag === 4) w.opt(value, (x) => w.key(x));
  else w.key(value);
}

function readChange(r) {
  const tag = r.u8(), kind = CHANGE_KINDS[tag];
  const value = tag <= 1 ? r.i64() : tag === 2 ? r.opt(() => r.u64()) : tag === 3 ? r.opt(() => r.i64()) : tag === 4 ? r.opt(() => r.key()) : r.key();
  return { kind, value };
}

// ------------------------------------------------------------------ client

export function createClient({ web3, connection, programId }) {
  const PROGRAM = new web3.PublicKey(programId);
  const discCache = new Map();
  const disc = async (s) => {
    if (!discCache.has(s)) discCache.set(s, new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", enc.encode(s))).slice(0, 8));
    return discCache.get(s);
  };
  const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });
  const vaultAddress = (owner) => web3.PublicKey.findProgramAddressSync([enc.encode("vault"), owner.toBytes()], PROGRAM)[0];
  // Program-wide settings (the emergency brake on new deposits). Deposits pass it; programs older than the brake
  // simply ignore the extra account.
  const CONFIG_PDA = web3.PublicKey.findProgramAddressSync([enc.encode("config")], PROGRAM)[0];
  const ix = async (name, args, keys) => {
    const d = await disc("global:" + name);
    const data = new Uint8Array(d.length + args.length); data.set(d); data.set(args, d.length);
    return new web3.TransactionInstruction({ programId: PROGRAM, keys, data });
  };
  const owner = (o) => [meta(o, true, false), meta(vaultAddress(o), false, true)];

  const build = {
    /** preset: { kind: "gentle" } | { kind: "strong", guardian?: PublicKey } | { kind: "locked", until: unixSeconds, guardian: PublicKey } */
    initialize: (o, preset) => {
      const w = new W();
      if (preset.kind === "gentle") w.u8(0);
      else if (preset.kind === "strong") { w.u8(1); w.opt(preset.guardian || null, (g) => w.key(g)); }
      else { w.u8(2); w.i64(preset.until); w.key(preset.guardian); }
      return ix("initialize", w.out(), [meta(o, true, true), meta(vaultAddress(o), false, true), meta(web3.SystemProgram.programId, false, false)]);
    },
    deposit: (o, lamports) => ix("deposit", new W().u64(lamports).out(), [meta(o, true, true), meta(vaultAddress(o), false, true), meta(web3.SystemProgram.programId, false, false), meta(CONFIG_PDA, false, false)]),
    sendToTrusted: (o, dest, lamports) => ix("send_to_trusted", new W().u64(lamports).out(), [...owner(o), meta(dest, false, true)]),
    requestWithdrawal: (o, dest, lamports) => ix("request_withdrawal", new W().key(dest).u64(lamports).out(), owner(o)),
    cancelWithdrawal: (o, id) => ix("cancel_withdrawal", new W().u32(id).out(), owner(o)),
    executeWithdrawal: (caller, vaultOwner, id, dest) => ix("execute_withdrawal", new W().u32(id).out(), [meta(caller, true, false), meta(vaultAddress(vaultOwner), false, true), meta(dest, false, true)]),
    guardianRelease: (guardian, vaultOwner, id, dest) => ix("guardian_release", new W().u32(id).out(), [meta(guardian, true, false), meta(vaultAddress(vaultOwner), false, true), meta(dest, false, true)]),
    proposeChange: (o, change) => { const w = new W(); writeChange(w, change); return ix("propose_change", w.out(), owner(o)); },
    cancelChange: (o, id) => ix("cancel_change", new W().u32(id).out(), owner(o)),
    applyChange: (caller, vaultOwner, id) => ix("apply_change", new W().u32(id).out(), [meta(caller, true, false), meta(vaultAddress(vaultOwner), false, true)]),
    guardianApproveChange: (guardian, vaultOwner, id) => ix("guardian_approve_change", new W().u32(id).out(), [meta(guardian, true, false), meta(vaultAddress(vaultOwner), false, true)]),
  };

  async function fetchVault(vaultOwner) {
    const address = vaultAddress(vaultOwner);
    const info = await connection.getAccountInfo(address, "confirmed");
    if (!info) return null;
    if (!info.owner.equals(PROGRAM)) throw new Error("That account isn't an Ecrin Safe");
    const data = Uint8Array.from(info.data), want = await disc("account:VaultAccount");
    if (!want.every((b, i) => data[i] === b)) throw new Error("That account isn't an Ecrin Safe");
    const r = new R(data.subarray(8), web3);
    const v = {
      address, lamports: info.lamports,
      owner: r.key(), bump: r.u8(), balance: r.u64(), withdrawDelay: r.i64(), ruleDelay: r.i64(),
      dailyLimit: r.opt(() => r.u64()), lockedUntil: r.opt(() => r.i64()), guardian: r.opt(() => r.key()),
    };
    v.trusted = r.vec(() => r.key());
    v.withdrawals = r.vec(() => ({ id: r.u32(), amount: r.u64(), dest: r.key(), readyAt: r.i64() }));
    v.changes = r.vec(() => ({ id: r.u32(), change: readChange(r), readyAt: r.i64() }));
    v.nextId = r.u32(); v.spentDay = r.i64(); v.spentToday = r.u64();
    v.available = Math.max(0, v.balance - v.withdrawals.reduce((s, w) => s + w.amount, 0));
    return v;
  }

  /** The chain's clock, which is what the program compares delays against. */
  async function chainTime() {
    const slot = await connection.getSlot("confirmed");
    return (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
  }

  // ---------------------------------------------------------------- tokens (USDC and other classic SPL tokens)

  const TOKEN = new web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const ATA = new web3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  const ata = (who, mint) => web3.PublicKey.findProgramAddressSync([who.toBytes(), TOKEN.toBytes(), mint.toBytes()], ATA)[0];
  /** Creates `who`'s token account for `mint` if it doesn't exist yet (payer pays the rent); does nothing otherwise. */
  const createAta = (payer, who, mint) => new web3.TransactionInstruction({
    programId: ATA, data: Uint8Array.of(1),
    keys: [meta(payer, true, true), meta(ata(who, mint), false, true), meta(who, false, false), meta(mint, false, false), meta(web3.SystemProgram.programId, false, false), meta(TOKEN, false, false)],
  });

  /** One token's side of the Safe. Amounts are the token's base units (1e6 per USDC). */
  function token(mintAddr) {
    const mint = new web3.PublicKey(mintAddr);
    const tvault = (o) => web3.PublicKey.findProgramAddressSync([enc.encode("tvault"), o.toBytes(), mint.toBytes()], PROGRAM)[0];
    const holds = (o) => ata(tvault(o), mint);
    const ownerOnly = (o) => [meta(o, true, false), meta(vaultAddress(o), false, true), meta(tvault(o), false, true), meta(holds(o), false, false)];
    const payout = (caller, o, dest) => [meta(caller, true, false), meta(vaultAddress(o), false, false), meta(tvault(o), false, true), meta(mint, false, false), meta(holds(o), false, true), meta(dest, false, false), meta(ata(dest, mint), false, true), meta(TOKEN, false, false)];
    const amountOf = async (k) => { const r = await connection.getTokenAccountBalance(k, "confirmed").catch(() => null); return r ? Number(r.value.amount) : 0; };

    const build = {
      open: (o) => ix("open_token_vault", new Uint8Array(0), [meta(o, true, true), meta(vaultAddress(o), false, false), meta(mint, false, false), meta(tvault(o), false, true), meta(holds(o), false, true), meta(TOKEN, false, false), meta(ATA, false, false), meta(web3.SystemProgram.programId, false, false)]),
      deposit: (o, amount) => ix("deposit_token", new W().u64(amount).out(), [meta(o, true, false), meta(tvault(o), false, false), meta(mint, false, false), meta(ata(o, mint), false, true), meta(holds(o), false, true), meta(TOKEN, false, false), meta(CONFIG_PDA, false, false)]),
      // Payouts land in the destination's token account; these create it first when it doesn't exist.
      sendToTrusted: (o, dest, amount) => [createAta(o, dest, mint), ix("send_token_to_trusted", new W().u64(amount).out(), [meta(o, true, false), meta(vaultAddress(o), false, false), meta(tvault(o), false, true), meta(mint, false, false), meta(holds(o), false, true), meta(dest, false, false), meta(ata(dest, mint), false, true), meta(TOKEN, false, false)])],
      requestWithdrawal: (o, dest, amount) => ix("request_token_withdrawal", new W().key(dest).u64(amount).out(), ownerOnly(o)),
      cancelWithdrawal: (o, id) => ix("cancel_token_withdrawal", new W().u32(id).out(), ownerOnly(o)),
      executeWithdrawal: (caller, o, id, dest) => [createAta(caller, dest, mint), ix("execute_token_withdrawal", new W().u32(id).out(), payout(caller, o, dest))],
      guardianRelease: (guardian, o, id, dest) => [createAta(guardian, dest, mint), ix("guardian_release_token", new W().u32(id).out(), payout(guardian, o, dest))],
      proposeLimit: (o, limit) => { const w = new W(); w.opt(limit, (x) => w.u64(x)); return ix("propose_token_limit", w.out(), ownerOnly(o)); },
      cancelChange: (o, id) => ix("cancel_token_change", new W().u32(id).out(), ownerOnly(o)),
      applyChange: (caller, o, id) => ix("apply_token_change", new W().u32(id).out(), [meta(caller, true, false), meta(vaultAddress(o), false, false), meta(tvault(o), false, true)]),
    };

    /** The token vault, or null before it is opened. `balance` is what its token account holds. */
    async function fetch(o) {
      const address = tvault(o);
      const info = await connection.getAccountInfo(address, "confirmed");
      if (!info) return null;
      if (!info.owner.equals(PROGRAM)) throw new Error("That account isn't an Ecrin token vault");
      const data = Uint8Array.from(info.data), want = await disc("account:TokenVaultAccount");
      if (!want.every((b, i) => data[i] === b)) throw new Error("That account isn't an Ecrin token vault");
      const r = new R(data.subarray(8), web3);
      const t = { address, holds: holds(o), owner: r.key(), mint: r.key(), bump: r.u8(), dailyLimit: r.opt(() => r.u64()), spentDay: r.i64(), spentToday: r.u64() };
      t.withdrawals = r.vec(() => ({ id: r.u32(), amount: r.u64(), dest: r.key(), readyAt: r.i64() }));
      t.changes = r.vec(() => ({ id: r.u32(), change: readChange(r), readyAt: r.i64() }));
      t.balance = await amountOf(t.holds);
      t.available = Math.max(0, t.balance - t.withdrawals.reduce((s, w) => s + w.amount, 0));
      return t;
    }

    return { mint, address: tvault, holds, build, fetch, walletBalance: (o) => amountOf(ata(o, mint)) };
  }

  // ---------------------------------------------------------------- staking (SOL stays inside the Safe)

  const STAKE = new web3.PublicKey("Stake11111111111111111111111111111111111111");
  const STAKE_CONFIG = new web3.PublicKey("StakeConfig11111111111111111111111111111111");
  const SYSVAR = { clock: new web3.PublicKey("SysvarC1ock11111111111111111111111111111111"), history: new web3.PublicKey("SysvarStakeHistory1111111111111111111111111"), rent: new web3.PublicKey("SysvarRent111111111111111111111111111111111") };
  const bookAddress = (o) => web3.PublicKey.findProgramAddressSync([enc.encode("stakes"), vaultAddress(o).toBytes()], PROGRAM)[0];
  const stakeAddress = (o, idx) => web3.PublicKey.findProgramAddressSync([enc.encode("stake"), vaultAddress(o).toBytes(), Uint8Array.of(idx)], PROGRAM)[0];
  const MAX_STAKES = 4;
  const staking = {
    bookAddress, stakeAddress, MAX_STAKES,
    build: {
      open: (o) => ix("open_stakes", new Uint8Array(0), [meta(o, true, true), meta(vaultAddress(o), false, false), meta(bookAddress(o), false, true), meta(web3.SystemProgram.programId, false, false)]),
      stake: (o, idx, lamports, vote) => ix("stake_sol", new W().u8(idx).u64(lamports).out(), [meta(o, true, true), meta(vaultAddress(o), false, true), meta(bookAddress(o), false, true),
        meta(stakeAddress(o, idx), false, true), meta(vote, false, false), meta(SYSVAR.clock, false, false), meta(SYSVAR.history, false, false), meta(SYSVAR.rent, false, false),
        meta(STAKE_CONFIG, false, false), meta(STAKE, false, false), meta(web3.SystemProgram.programId, false, false)]),
      unstake: (o, idx) => ix("unstake_sol", Uint8Array.of(idx), [meta(o, true, false), meta(vaultAddress(o), false, false), meta(bookAddress(o), false, true), meta(stakeAddress(o, idx), false, true), meta(SYSVAR.clock, false, false), meta(STAKE, false, false)]),
      reclaim: (caller, o, idx) => ix("reclaim_stake", Uint8Array.of(idx), [meta(caller, true, false), meta(vaultAddress(o), false, true), meta(bookAddress(o), false, true), meta(stakeAddress(o, idx), false, true), meta(SYSVAR.clock, false, false), meta(SYSVAR.history, false, false), meta(STAKE, false, false)]),
    },
    /** The Safe's stakes: null before the first one; otherwise each with its amount now (rewards included), its
     *  validator and where it is: "activating" (earning from next epoch), "active", "cooling" (unstaked, coming back
     *  at the end of the epoch), "ready" (can come back into the Safe now). */
    async fetch(o) {
      const info = await connection.getAccountInfo(bookAddress(o), "confirmed");
      if (!info || !info.owner.equals(PROGRAM)) return null;
      const r = new R(Uint8Array.from(info.data).subarray(8), web3);
      r.key(); r.u8();
      const slots = r.vec(() => ({ idx: r.u8(), principal: r.u64(), vote: r.key(), unstaking: !!r.u8() }));
      const [ep, accts] = await Promise.all([connection.getEpochInfo("confirmed"), slots.length ? connection.getMultipleParsedAccounts(slots.map((x) => stakeAddress(o, x.idx)), { commitment: "confirmed" }) : { value: [] }]);
      const U = 18446744073709551615n;
      const list = slots.map((x, i) => {
        const a = accts.value[i], p = a?.data?.parsed?.info, d = p?.stake?.delegation, reserve = Number(p?.meta?.rentExemptReserve || 0);
        const act = d ? BigInt(d.activationEpoch) : U, deact = d ? BigInt(d.deactivationEpoch) : U, e = BigInt(ep.epoch);
        const status = deact !== U ? (deact < e ? "ready" : "cooling") : act >= e ? "activating" : "active";
        const lamports = a?.lamports || 0;
        return { ...x, address: stakeAddress(o, x.idx), lamports, reserve, rewards: Math.max(0, lamports - reserve - x.principal), status };
      });
      const left = (ep.slotsInEpoch - ep.slotIndex) * 0.4; // seconds until the epoch turns, at ~400 ms a slot
      return { list, epoch: ep.epoch, epochEndsIn: Math.round(left), freeIdx: [0, 1, 2, 3].find((i) => !slots.some((x) => x.idx === i)) ?? null };
    },
    /** A healthy validator to stake with: voting, not delinquent, low commission, among the larger ones. */
    async pickValidator() {
      const { current } = await connection.getVoteAccounts("confirmed");
      const ok = current.filter((v) => v.commission <= 10 && v.epochVoteAccount).sort((a, b) => b.activatedStake - a.activatedStake);
      const pool = ok.slice(0, 20); if (!pool.length) throw new Error("No validator is available right now. Try again in a moment.");
      const v = pool[Math.floor(Math.random() * pool.length)];
      return { vote: new web3.PublicKey(v.votePubkey), commission: v.commission };
    },
  };

  return { programId: PROGRAM, vaultAddress, build, fetchVault, chainTime, token, ata, staking };
}
