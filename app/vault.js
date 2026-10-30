// The Ecrin vault rules for the browser demo: a line-for-line port of crates/vault-core/src/lib.rs.
// Same names, same checks, same order. If you change a rule in Rust, change it here and in vault.test.mjs.
// Amounts are whole numbers (the app uses 1 unit = 0.001 SOL); times are unix seconds.

export const HOUR = 3600;
export const DAY = 86400;
export const MAX_TRUSTED = 8;
export const MAX_PENDING_WITHDRAWALS = 4;
export const MAX_PENDING_CHANGES = 4;

export class VaultError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new VaultError(code); };

export const Policy = {
  gentle: () => ({ withdrawDelay: 24 * HOUR, ruleDelay: 3 * DAY, dailyLimit: null, lockedUntil: null, guardian: null }),
  strong: (guardian = null) => ({ withdrawDelay: 72 * HOUR, ruleDelay: 7 * DAY, dailyLimit: null, lockedUntil: null, guardian }),
  locked: (until, guardian) => ({ withdrawDelay: 72 * HOUR, ruleDelay: 7 * DAY, dailyLimit: null, lockedUntil: until, guardian }),
};

// A change is { kind, value }: SetWithdrawDelay, SetRuleDelay, SetDailyLimit, SetLockedUntil, SetGuardian, AddTrusted, RemoveTrusted.

export function validate(p) {
  const ok = (s) => Number.isInteger(s) && s >= HOUR && s <= 365 * DAY;
  if (!ok(p.withdrawDelay) || !ok(p.ruleDelay)) fail("InvalidValue");
  if (p.dailyLimit === 0) fail("InvalidValue");
}

/** True when the change only makes the vault harder to drain, so it may apply at once. */
export function isStricter(p, { kind, value }) {
  switch (kind) {
    case "SetWithdrawDelay": return value >= p.withdrawDelay;
    case "SetRuleDelay": return value >= p.ruleDelay;
    case "SetDailyLimit":
      if (value === null) return p.dailyLimit === null;
      return p.dailyLimit === null || value <= p.dailyLimit;
    case "SetLockedUntil":
      if (value === null) return p.lockedUntil === null;
      return p.lockedUntil === null || value >= p.lockedUntil;
    case "SetGuardian": return p.guardian === null && value !== null;
    case "AddTrusted": return false;
    case "RemoveTrusted": return true;
    default: fail("InvalidValue");
  }
}

export class Vault {
  constructor(owner, policy) {
    validate(policy);
    Object.assign(this, { owner, balance: 0, policy: { ...policy }, trusted: [], withdrawals: [], changes: [], nextId: 1, spentDay: 0, spentToday: 0 });
  }

  static from(data) { return Object.assign(Object.create(Vault.prototype), structuredClone(data)); }
  toJSON() { const { owner, balance, policy, trusted, withdrawals, changes, nextId, spentDay, spentToday } = this; return { owner, balance, policy, trusted, withdrawals, changes, nextId, spentDay, spentToday }; }

  ownerOnly(signer) { if (signer !== this.owner) fail("NotOwner"); }
  guardianOnly(signer) {
    if (this.policy.guardian === null) fail("NoGuardian");
    if (this.policy.guardian !== signer) fail("NotGuardian");
  }
  id() { const id = this.nextId; this.nextId = this.nextId + 1; return id; }
  isLocked(now) { return this.policy.lockedUntil !== null && now < this.policy.lockedUntil; }

  /** Funds not already promised to a queued withdrawal. */
  available() { return Math.max(0, this.balance - this.withdrawals.reduce((s, w) => s + w.amount, 0)); }

  spend(amount, now) {
    const day = Math.floor(now / DAY);
    const spent = day === this.spentDay ? this.spentToday : 0;
    const after = spent + amount;
    if (this.policy.dailyLimit !== null && after > this.policy.dailyLimit) fail("DailyLimit");
    if (amount > this.balance) fail("InsufficientFunds");
    this.balance -= amount;
    this.spentDay = day;
    this.spentToday = after;
  }

  deposit(amount) {
    if (!(amount > 0)) fail("ZeroAmount");
    this.balance += amount;
  }

  sendToTrusted(signer, dest, amount, now) {
    this.ownerOnly(signer);
    if (!(amount > 0)) fail("ZeroAmount");
    if (!this.trusted.includes(dest)) fail("NotTrusted");
    if (this.isLocked(now)) fail("Locked");
    if (amount > this.available()) fail("InsufficientFunds");
    this.spend(amount, now);
    return { type: "Send", amount, dest };
  }

  requestWithdrawal(signer, dest, amount, now) {
    this.ownerOnly(signer);
    if (!(amount > 0)) fail("ZeroAmount");
    if (amount > this.available()) fail("InsufficientFunds");
    if (this.withdrawals.length >= MAX_PENDING_WITHDRAWALS) fail("TooManyPending");
    const readyAt = Math.max(now + this.policy.withdrawDelay, this.policy.lockedUntil ?? -Infinity);
    const id = this.id();
    this.withdrawals.push({ id, amount, dest, readyAt, requestedAt: now });
    return { type: "WithdrawalQueued", id, readyAt };
  }

  cancelWithdrawal(signer, id) {
    this.ownerOnly(signer);
    const i = this.withdrawals.findIndex((w) => w.id === id);
    if (i < 0) fail("NotFound");
    this.withdrawals.splice(i, 1);
    return { type: "Cancelled" };
  }

  executeWithdrawal(id, now) {
    const i = this.withdrawals.findIndex((w) => w.id === id);
    if (i < 0) fail("NotFound");
    const w = this.withdrawals[i];
    if (now < w.readyAt) fail("TooEarly");
    if (this.isLocked(now)) fail("Locked");
    this.spend(w.amount, now);
    this.withdrawals.splice(i, 1);
    return { type: "Send", amount: w.amount, dest: w.dest };
  }

  guardianRelease(signer, id, now) {
    this.guardianOnly(signer);
    const i = this.withdrawals.findIndex((w) => w.id === id);
    if (i < 0) fail("NotFound");
    const w = this.withdrawals[i];
    this.spend(w.amount, now);
    this.withdrawals.splice(i, 1);
    return { type: "Send", amount: w.amount, dest: w.dest };
  }

  proposeChange(signer, change, now) {
    this.ownerOnly(signer);
    this.checkChange(change);
    if (isStricter(this.policy, change)) { this.apply(change); return { type: "ChangeApplied" }; }
    if (this.changes.length >= MAX_PENDING_CHANGES) fail("TooManyPending");
    const readyAt = Math.max(now + this.policy.ruleDelay, this.policy.lockedUntil ?? -Infinity);
    const id = this.id();
    this.changes.push({ id, change: { ...change }, readyAt });
    return { type: "ChangeQueued", id, readyAt };
  }

  cancelChange(signer, id) {
    this.ownerOnly(signer);
    const i = this.changes.findIndex((c) => c.id === id);
    if (i < 0) fail("NotFound");
    this.changes.splice(i, 1);
    return { type: "Cancelled" };
  }

  applyChange(id, now) {
    const i = this.changes.findIndex((c) => c.id === id);
    if (i < 0) fail("NotFound");
    const c = this.changes[i];
    if (now < c.readyAt) fail("TooEarly");
    this.apply(c.change);
    this.changes.splice(i, 1);
    return { type: "ChangeApplied" };
  }

  guardianApproveChange(signer, id) {
    this.guardianOnly(signer);
    const i = this.changes.findIndex((c) => c.id === id);
    if (i < 0) fail("NotFound");
    const c = this.changes[i];
    if (c.change.kind !== "AddTrusted") fail("TooEarly");
    this.apply(c.change);
    this.changes.splice(i, 1);
    return { type: "ChangeApplied" };
  }

  checkChange({ kind, value }) {
    const p = { ...this.policy };
    switch (kind) {
      case "SetWithdrawDelay": p.withdrawDelay = value; break;
      case "SetRuleDelay": p.ruleDelay = value; break;
      case "SetDailyLimit": p.dailyLimit = value; break;
      case "SetLockedUntil": p.lockedUntil = value; break;
      case "SetGuardian": if (value === this.owner) fail("InvalidValue"); p.guardian = value; break;
      case "AddTrusted":
        if (this.trusted.includes(value)) fail("InvalidValue");
        if (this.trusted.length >= MAX_TRUSTED) fail("TooManyTrusted");
        break;
      case "RemoveTrusted": if (!this.trusted.includes(value)) fail("NotFound"); break;
      default: fail("InvalidValue");
    }
    validate(p);
  }

  apply({ kind, value }) {
    switch (kind) {
      case "SetWithdrawDelay": this.policy.withdrawDelay = value; break;
      case "SetRuleDelay": this.policy.ruleDelay = value; break;
      case "SetDailyLimit": this.policy.dailyLimit = value; break;
      case "SetLockedUntil": this.policy.lockedUntil = value; break;
      case "SetGuardian": this.policy.guardian = value; break;
      case "AddTrusted":
        if (this.trusted.includes(value)) return;
        if (this.trusted.length >= MAX_TRUSTED) fail("TooManyTrusted");
        this.trusted.push(value);
        break;
      case "RemoveTrusted": this.trusted = this.trusted.filter((t) => t !== value); break;
    }
  }
}
