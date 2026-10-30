// The same scenarios as crates/vault-core/tests/rules.rs, run against the browser port.
// node app/vault.test.mjs
import { Vault, Policy, HOUR, DAY } from "./vault.js";

const OWNER = "owner", GUARDIAN = "guardian", BANK = "bank", CASINO = "casino", T0 = 1_800_000_000;
let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.log("FAIL", name, "\n ", e.message); } };
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const err = (fn, code) => { try { fn(); } catch (e) { if (e.code === code) return; throw new Error(`expected ${code}, got ${e.code || e.message}`); } throw new Error(`expected ${code}, got success`); };
const vault = (p) => { const v = new Vault(OWNER, p); v.deposit(1000); return v; };

test("withdrawal waits for the delay then runs", () => {
  const v = vault(Policy.strong(null));
  const { id, readyAt } = v.requestWithdrawal(OWNER, CASINO, 400, T0);
  eq(readyAt, T0 + 72 * HOUR);
  err(() => v.executeWithdrawal(id, T0 + 71 * HOUR), "TooEarly");
  eq(v.executeWithdrawal(id, readyAt), { type: "Send", amount: 400, dest: CASINO });
  eq(v.balance, 600);
});

test("owner can cancel and the money stays", () => {
  const v = vault(Policy.gentle());
  const { id } = v.requestWithdrawal(OWNER, CASINO, 900, T0);
  eq(v.available(), 100);
  v.cancelWithdrawal(OWNER, id);
  eq(v.available(), 1000);
  err(() => v.executeWithdrawal(id, T0 + 30 * DAY), "NotFound");
});

test("queued withdrawals cannot promise more than the balance", () => {
  const v = vault(Policy.gentle());
  v.requestWithdrawal(OWNER, CASINO, 700, T0);
  err(() => v.requestWithdrawal(OWNER, CASINO, 400, T0), "InsufficientFunds");
});

test("trusted address must wait before it is trusted", () => {
  const v = vault(Policy.strong(null));
  err(() => v.sendToTrusted(OWNER, BANK, 100, T0), "NotTrusted");
  const { id, readyAt } = v.proposeChange(OWNER, { kind: "AddTrusted", value: BANK }, T0);
  eq(readyAt, T0 + 7 * DAY);
  err(() => v.applyChange(id, T0 + 6 * DAY), "TooEarly");
  v.applyChange(id, readyAt);
  eq(v.sendToTrusted(OWNER, BANK, 100, readyAt), { type: "Send", amount: 100, dest: BANK });
});

test("guardian can approve a trusted address early", () => {
  const v = vault(Policy.strong(GUARDIAN));
  const { id } = v.proposeChange(OWNER, { kind: "AddTrusted", value: BANK }, T0);
  err(() => v.guardianApproveChange(OWNER, id), "NotGuardian");
  v.guardianApproveChange(GUARDIAN, id);
  eq(v.trusted.includes(BANK), true);
});

test("guardian cannot rush other loosening changes", () => {
  const v = vault(Policy.strong(GUARDIAN));
  const { id } = v.proposeChange(OWNER, { kind: "SetWithdrawDelay", value: HOUR }, T0);
  err(() => v.guardianApproveChange(GUARDIAN, id), "TooEarly");
});

test("stricter changes apply at once", () => {
  const v = vault(Policy.gentle());
  eq(v.proposeChange(OWNER, { kind: "SetWithdrawDelay", value: 72 * HOUR }, T0).type, "ChangeApplied");
  eq(v.proposeChange(OWNER, { kind: "SetDailyLimit", value: 200 }, T0).type, "ChangeApplied");
  eq(v.proposeChange(OWNER, { kind: "SetGuardian", value: GUARDIAN }, T0).type, "ChangeApplied");
  eq(v.policy.withdrawDelay, 72 * HOUR);
  eq(v.proposeChange(OWNER, { kind: "SetWithdrawDelay", value: 24 * HOUR }, T0).type, "ChangeQueued");
  eq(v.proposeChange(OWNER, { kind: "SetGuardian", value: null }, T0).type, "ChangeQueued");
});

test("lock blocks everything until its date", () => {
  const until = T0 + 30 * DAY;
  const v = vault(Policy.locked(until, GUARDIAN));
  const add = v.proposeChange(OWNER, { kind: "AddTrusted", value: BANK }, T0);
  eq(add.readyAt, until);
  v.guardianApproveChange(GUARDIAN, add.id);
  err(() => v.sendToTrusted(OWNER, BANK, 10, T0), "Locked");
  eq(v.requestWithdrawal(OWNER, CASINO, 10, T0).readyAt, until);
  eq(v.proposeChange(OWNER, { kind: "SetLockedUntil", value: null }, T0).readyAt, until);
});

test("guardian emergency release only for what the owner requested", () => {
  const v = vault(Policy.locked(T0 + 30 * DAY, GUARDIAN));
  const { id } = v.requestWithdrawal(OWNER, BANK, 300, T0);
  err(() => v.guardianRelease(CASINO, id, T0), "NotGuardian");
  eq(v.guardianRelease(GUARDIAN, id, T0), { type: "Send", amount: 300, dest: BANK });
  eq(v.balance, 700);
  err(() => v.guardianRelease(GUARDIAN, 999, T0), "NotFound");
});

test("daily limit counts every outgoing transfer", () => {
  const p = Policy.gentle(); p.dailyLimit = 250;
  const v = vault(p); v.trusted.push(BANK);
  v.sendToTrusted(OWNER, BANK, 200, T0);
  err(() => v.sendToTrusted(OWNER, BANK, 100, T0 + HOUR), "DailyLimit");
  v.sendToTrusted(OWNER, BANK, 100, T0 + DAY);
});

test("only the owner can move or change anything", () => {
  const v = vault(Policy.gentle()); v.trusted.push(BANK);
  err(() => v.sendToTrusted(CASINO, BANK, 1, T0), "NotOwner");
  err(() => v.requestWithdrawal(CASINO, CASINO, 1, T0), "NotOwner");
  err(() => v.proposeChange(GUARDIAN, { kind: "SetWithdrawDelay", value: HOUR }, T0), "NotOwner");
});

test("nonsense policies are refused", () => {
  err(() => new Vault(OWNER, { ...Policy.gentle(), withdrawDelay: 60 }), "InvalidValue");
  const v = vault(Policy.gentle());
  err(() => v.proposeChange(OWNER, { kind: "SetGuardian", value: OWNER }, T0), "InvalidValue");
  err(() => v.proposeChange(OWNER, { kind: "SetDailyLimit", value: 0 }, T0), "InvalidValue");
});

test("a lock added later still holds back a queued withdrawal", () => {
  const v = vault(Policy.gentle());
  const { id, readyAt } = v.requestWithdrawal(OWNER, CASINO, 100, T0);
  eq(v.proposeChange(OWNER, { kind: "SetLockedUntil", value: T0 + 10 * DAY }, T0).type, "ChangeApplied");
  err(() => v.executeWithdrawal(id, readyAt), "Locked");
  v.executeWithdrawal(id, T0 + 10 * DAY);
});

test("state survives a save and load", () => {
  const v = vault(Policy.strong(GUARDIAN));
  v.requestWithdrawal(OWNER, CASINO, 100, T0);
  const w = Vault.from(JSON.parse(JSON.stringify(v)));
  eq(w.available(), 900);
  eq(w.withdrawals.length, 1);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
