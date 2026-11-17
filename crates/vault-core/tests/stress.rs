//! Stress test of the Safe's rules: long random sequences of actions, by the owner, the guardian and strangers,
//! with time jumping forward, and after every step a check that the security promises still hold:
//!
//! 1. Money never leaves early: a withdrawal runs only once its time has come, and never while the Safe is locked,
//!    unless the guardian releases one the owner asked for.
//! 2. Instant sends go only to addresses that were already trusted, and never while locked.
//! 3. The books balance: what's in the Safe is what came in minus what went out, and waiting withdrawals never
//!    promise more than the balance.
//! 4. No UTC day lets out more than the daily limit in force at the time.
//! 5. A rule that loosens the Safe applies only after its wait (the guardian can hurry a new trusted address, nothing
//!    else); only stricter changes apply at once.
//! 6. Only the owner starts anything; the guardian can release or approve, and strangers can only run what's due.
//! 7. The limits always hold: delays 1 h to 365 days, never your own guardian, at most 8 trusted addresses and
//!    4 waiting withdrawals and changes, a lock at most ten years out.
//!
//! No extra crates: a small deterministic random generator, so every failure is reproducible from its seed.
use vault_core::*;

const OWNER: Address = [1; 32];
const GUARDIAN: Address = [2; 32];
const OTHER_GUARDIAN: Address = [3; 32];
const STRANGER: Address = [9; 32];
const PLACES: [Address; 6] = [[10; 32], [11; 32], [12; 32], [13; 32], [14; 32], [15; 32]];
const T0: i64 = 1_800_000_000;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 { self.0 ^= self.0 << 13; self.0 ^= self.0 >> 7; self.0 ^= self.0 << 17; self.0 }
    fn below(&mut self, n: u64) -> u64 { self.next() % n.max(1) }
    fn pick<T: Copy>(&mut self, xs: &[T]) -> T { xs[self.below(xs.len() as u64) as usize] }
    fn chance(&mut self, pct: u64) -> bool { self.below(100) < pct }
}

/// What the test remembers about the Safe, independently of it.
struct Shadow {
    hits: [u64; 8],
    deposited: u64,
    sent: u64,
    /// id -> (amount, dest, ready_at, requested_at)
    queued: std::collections::HashMap<u32, (u64, Address, i64, i64)>,
    /// id -> (change, ready_at)
    changes: std::collections::HashMap<u32, (Change, i64)>,
    /// UTC day -> amount sent that day
    per_day: std::collections::HashMap<i64, u64>,
}

fn delay(r: &mut Rng) -> i64 {
    // mostly valid, sometimes just outside the allowed range
    match r.below(6) { 0 => HOUR - 1, 1 => 365 * DAY + 1, 2 => HOUR, 3 => 365 * DAY, _ => HOUR * (1 + r.below(24 * 30) as i64) }
}

fn random_change(r: &mut Rng, v: &Vault, now: i64) -> Change {
    match r.below(7) {
        0 => Change::SetWithdrawDelay(delay(r)),
        1 => Change::SetRuleDelay(delay(r)),
        2 => Change::SetDailyLimit(match r.below(4) { 0 => None, 1 => Some(0), _ => Some(1 + r.below(5_000)) }),
        3 => Change::SetLockedUntil(match r.below(4) { 0 => None, 1 => Some(now + 11 * 365 * DAY), _ => Some(now + r.below(60 * DAY as u64) as i64) }),
        4 => Change::SetGuardian(match r.below(4) { 0 => None, 1 => Some(OWNER), 2 => Some(GUARDIAN), _ => Some(OTHER_GUARDIAN) }),
        5 => Change::AddTrusted(r.pick(&PLACES)),
        _ => Change::RemoveTrusted(if !v.trusted.is_empty() && r.chance(70) { r.pick(&v.trusted) } else { r.pick(&PLACES) }),
    }
}

fn check(v: &Vault, s: &Shadow, seed: u64, step: usize) {
    let ctx = || format!("seed {seed}, step {step}");
    // 3. books
    assert_eq!(v.balance, s.deposited - s.sent, "balance doesn't add up ({})", ctx());
    let promised: u64 = v.withdrawals.iter().map(|w| w.amount).sum();
    assert!(promised <= v.balance, "waiting withdrawals promise {promised} of {} ({})", v.balance, ctx());
    assert_eq!(v.withdrawals.len(), s.queued.len(), "waiting withdrawals out of sync ({})", ctx());
    // 7. limits
    let ok = |d: i64| (HOUR..=365 * DAY).contains(&d);
    assert!(ok(v.policy.withdraw_delay) && ok(v.policy.rule_delay), "delay out of range ({})", ctx());
    assert_ne!(v.policy.daily_limit, Some(0), "zero daily limit ({})", ctx());
    assert_ne!(v.policy.guardian, Some(OWNER), "owner became their own guardian ({})", ctx());
    assert!(v.trusted.len() <= MAX_TRUSTED, "too many trusted ({})", ctx());
    assert!(v.withdrawals.len() <= MAX_PENDING_WITHDRAWALS && v.changes.len() <= MAX_PENDING_CHANGES, "too many waiting ({})", ctx());
    let mut t = v.trusted.clone(); t.sort(); t.dedup();
    assert_eq!(t.len(), v.trusted.len(), "duplicate trusted address ({})", ctx());
}

fn run(seed: u64, steps: usize) -> [u64; 8] {
    let mut r = Rng(seed | 1);
    let guardian = if r.chance(60) { Some(GUARDIAN) } else { None };
    let policy = match r.below(3) { 0 => Policy::gentle(), 1 => Policy::strong(guardian), _ => Policy::locked(T0 + r.below(30 * DAY as u64) as i64, GUARDIAN) };
    let mut v = Vault::new(OWNER, policy).unwrap();
    let mut s = Shadow { hits: [0; 8], deposited: 0, sent: 0, queued: Default::default(), changes: Default::default(), per_day: Default::default() };
    let mut now = T0;

    for step in 0..steps {
        // time moves on: often a little, sometimes a lot, sometimes across midnight
        now += match r.below(10) { 0..=4 => r.below(600) as i64, 5..=7 => r.below(6 * HOUR as u64) as i64, 8 => r.below(4 * DAY as u64) as i64, _ => DAY };
        let who = match r.below(10) { 0..=6 => OWNER, 7 | 8 => v.policy.guardian.unwrap_or(GUARDIAN), _ => STRANGER };
        let before = v.clone();
        let locked = before.policy.locked_until.is_some_and(|t| now < t);

        match r.below(11) {
            0 | 1 => {
                let a = 1 + r.below(2_000);
                if v.deposit(a).is_ok() { s.deposited += a; }
            }
            2 => {
                let (dest, amt) = (r.pick(&PLACES), 1 + r.below(1_500));
                if let Ok(Outcome::Send { amount, dest: d }) = v.send_to_trusted(&who, dest, amt, now) {
                    // 2, 6: only the owner, only to an address trusted before this step, never while locked
                    assert_eq!(who, OWNER, "a non-owner sent instantly (seed {seed}, step {step})");
                    assert!(before.trusted.contains(&d), "instant send to an untrusted address (seed {seed}, step {step})");
                    assert!(!locked, "instant send while locked (seed {seed}, step {step})");
                    assert!(amount <= before.available(), "instant send dipped into promised money (seed {seed}, step {step})");
                    record_send(&mut s, &before, amount, now, seed, step); s.hits[0] += 1;
                }
            }
            3 | 4 => {
                let (dest, amt) = (r.pick(&PLACES), 1 + r.below(1_500));
                if let Ok(Outcome::WithdrawalQueued { id, ready_at }) = v.request_withdrawal(&who, dest, amt, now) {
                    assert_eq!(who, OWNER, "a non-owner queued a withdrawal (seed {seed}, step {step})");
                    // 1: never sooner than the delay in force, nor before the lock ends
                    assert!(ready_at >= now + before.policy.withdraw_delay, "withdrawal can leave early (seed {seed}, step {step})");
                    if let Some(t) = before.policy.locked_until { assert!(ready_at >= t, "withdrawal can leave during the lock (seed {seed}, step {step})"); }
                    assert!(s.queued.insert(id, (amt, dest, ready_at, now)).is_none(), "id reused (seed {seed}, step {step})"); s.hits[1] += 1;
                }
            }
            5 => {
                if let Some(w) = pick_withdrawal(&mut r, &v) {
                    if v.cancel_withdrawal(&who, w).is_ok() {
                        assert_eq!(who, OWNER, "a non-owner cancelled (seed {seed}, step {step})");
                        s.queued.remove(&w);
                    }
                }
            }
            6 => {
                if let Some(w) = pick_withdrawal(&mut r, &v) {
                    if let Ok(Outcome::Send { amount, dest }) = v.execute_withdrawal(w, now) {
                        let (a, d, ready_at, _) = s.queued.remove(&w).expect("ran an unknown withdrawal");
                        // 1: only when due, never while locked, exactly what and where the owner asked
                        assert!(now >= ready_at, "withdrawal ran early (seed {seed}, step {step})");
                        assert!(!locked, "withdrawal ran while locked (seed {seed}, step {step})");
                        assert_eq!((amount, dest), (a, d), "withdrawal changed on the way (seed {seed}, step {step})"); s.hits[2] += 1;
                        record_send(&mut s, &before, amount, now, seed, step);
                    }
                }
            }
            7 => {
                if let Some(w) = pick_withdrawal(&mut r, &v) {
                    if let Ok(Outcome::Send { amount, dest }) = v.guardian_release(&who, w, now) {
                        let (a, d, _, _) = s.queued.remove(&w).expect("released an unknown withdrawal");
                        // 6: only the guardian in force, only what the owner asked for
                        assert_eq!(Some(who), before.policy.guardian, "released by someone other than the guardian (seed {seed}, step {step})");
                        assert_eq!((amount, dest), (a, d), "guardian changed a withdrawal (seed {seed}, step {step})"); s.hits[3] += 1;
                        record_send(&mut s, &before, amount, now, seed, step);
                    }
                }
            }
            8 => {
                let c = random_change(&mut r, &v, now);
                match v.propose_change(&who, c, now) {
                    Ok(Outcome::ChangeApplied) => {
                        assert_eq!(who, OWNER, "a non-owner changed a rule (seed {seed}, step {step})");
                        // 5: only stricter changes apply at once
                        assert!(may_apply_now(&before.policy, &c), "a loosening change applied at once: {c:?} (seed {seed}, step {step})"); s.hits[4] += 1;
                    }
                    Ok(Outcome::ChangeQueued { id, ready_at }) => {
                        assert_eq!(who, OWNER, "a non-owner proposed a rule (seed {seed}, step {step})");
                        assert!(ready_at >= now + before.policy.rule_delay, "loosening waits less than the rule delay (seed {seed}, step {step})");
                        if let Some(t) = before.policy.locked_until { assert!(ready_at >= t, "loosening can apply during the lock (seed {seed}, step {step})"); }
                        s.changes.insert(id, (c, ready_at)); s.hits[5] += 1;
                    }
                    Ok(o) => panic!("unexpected outcome {o:?}"),
                    Err(_) => {}
                }
            }
            9 => {
                if let Some(id) = pick_change(&mut r, &v) {
                    if v.apply_change(id, now).is_ok() {
                        let (_, ready_at) = s.changes.remove(&id).expect("applied an unknown change");
                        assert!(now >= ready_at, "a change applied early (seed {seed}, step {step})"); s.hits[6] += 1;
                    }
                }
            }
            _ => {
                if let Some(id) = pick_change(&mut r, &v) {
                    if r.chance(50) {
                        if v.guardian_approve_change(&who, id).is_ok() {
                            let (c, _) = s.changes.remove(&id).expect("approved an unknown change");
                            assert_eq!(Some(who), before.policy.guardian, "approved by someone other than the guardian (seed {seed}, step {step})");
                            assert!(matches!(c, Change::AddTrusted(_)), "guardian hurried {c:?} (seed {seed}, step {step})"); s.hits[7] += 1;
                        }
                    } else if v.cancel_change(&who, id).is_ok() {
                        assert_eq!(who, OWNER, "a non-owner cancelled a change (seed {seed}, step {step})");
                        s.changes.remove(&id);
                    }
                }
            }
        }
        // Nothing may change the Safe without one of the outcomes above being recorded.
        if v.balance != before.balance { assert_eq!(v.balance, s.deposited - s.sent, "balance moved silently (seed {seed}, step {step})"); }
        check(&v, &s, seed, step);
    }
    s.hits
}

/// The spec for "applies at once", written independently of the library (so a bug there can't hide here):
/// only a change that makes the Safe harder to empty. Guardians and new trusted addresses always wait.
fn may_apply_now(p: &Policy, c: &Change) -> bool {
    match *c {
        Change::SetWithdrawDelay(d) => d >= p.withdraw_delay,
        Change::SetRuleDelay(d) => d >= p.rule_delay,
        Change::SetDailyLimit(None) => p.daily_limit.is_none(),
        Change::SetDailyLimit(Some(n)) => p.daily_limit.map_or(true, |old| n <= old),
        Change::SetLockedUntil(None) => p.locked_until.is_none(),
        Change::SetLockedUntil(Some(t)) => p.locked_until.map_or(true, |old| t >= old),
        Change::SetGuardian(_) | Change::AddTrusted(_) => false,
        Change::RemoveTrusted(_) => true,
    }
}

fn record_send(s: &mut Shadow, before: &Vault, amount: u64, now: i64, seed: u64, step: usize) {
    s.sent += amount;
    let day = s.per_day.entry(now.div_euclid(DAY)).or_default();
    *day += amount;
    // 4: within the daily limit in force at the time
    if let Some(l) = before.policy.daily_limit { assert!(*day <= l, "a day let out {day} with a limit of {l} (seed {seed}, step {step})"); }
}

fn pick_withdrawal(r: &mut Rng, v: &Vault) -> Option<u32> {
    if v.withdrawals.is_empty() || r.chance(10) { return Some(r.below(50) as u32); } // sometimes an id that doesn't exist
    Some(v.withdrawals[r.below(v.withdrawals.len() as u64) as usize].id)
}
fn pick_change(r: &mut Rng, v: &Vault) -> Option<u32> {
    if v.changes.is_empty() || r.chance(10) { return Some(r.below(50) as u32); }
    Some(v.changes[r.below(v.changes.len() as u64) as usize].id)
}

#[test]
fn random_sequences_keep_every_promise() {
    // 400 Safes x 2,000 steps each. Set STRESS_SEEDS for a longer run.
    let seeds: u64 = std::env::var("STRESS_SEEDS").ok().and_then(|s| s.parse().ok()).unwrap_or(400);
    let mut hits = [0u64; 8];
    for seed in 1..=seeds { for (h, n) in hits.iter_mut().zip(run(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15), 2_000)) { *h += n; } }
    let names = ["instant sends", "withdrawals queued", "withdrawals run", "guardian releases", "stricter rules applied", "looser rules queued", "queued rules applied", "guardian approvals"];
    for (n, h) in names.iter().zip(hits) { println!("{n}: {h}"); assert!(h > 0, "the stress test never reached: {n}"); }
}
