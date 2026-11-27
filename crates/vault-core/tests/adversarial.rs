//! Adversarial cases, grouped by attacker: a stolen owner key, a guardian gone bad, a stranger. Each one is a way to
//! get money out sooner, somewhere else, or at all, and the rule that stops it. (Random sequences: stress.rs.)
use vault_core::*;

const OWNER: Address = [1; 32];
const GUARDIAN: Address = [2; 32];
const BANK: Address = [3; 32];
const CASINO: Address = [4; 32];
const STRANGER: Address = [5; 32];
const T0: i64 = 1_800_000_000;

fn vault(policy: Policy) -> Vault {
    let mut v = Vault::new(OWNER, policy).unwrap();
    v.deposit(10_000).unwrap();
    v
}
fn queued(o: Result<Outcome, VaultError>) -> (u32, i64) {
    match o { Ok(Outcome::WithdrawalQueued { id, ready_at }) | Ok(Outcome::ChangeQueued { id, ready_at }) => (id, ready_at), x => panic!("expected queued, got {x:?}") }
}

// ---------------------------------------------------------------- a stolen owner key

#[test]
fn a_stolen_key_cant_loosen_anything_at_once() {
    let mut v = vault(Policy { daily_limit: Some(1_000), trusted_waits: true, no_exit: true, ..Policy::strong(Some(GUARDIAN)) });
    let before = v.policy;
    for c in [Change::SetWithdrawDelay(HOUR), Change::SetRuleDelay(HOUR), Change::SetDailyLimit(None), Change::SetDailyLimit(Some(5_000)),
        Change::SetGuardian(Some(STRANGER)), Change::SetGuardian(None), Change::AddTrusted(CASINO), Change::SetTrustedWaits(false), Change::SetNoExit(false)] {
        let (id, ready_at) = queued(v.propose_change(&OWNER, c, T0));
        assert_eq!(ready_at, T0 + 7 * DAY, "{c:?}");
        v.cancel_change(&OWNER, id).unwrap(); // four slots: free it for the next one
    }
    assert_eq!(v.policy, before);
    assert!(v.trusted.is_empty());
}

#[test]
fn full_change_slots_never_block_a_freeze() {
    let mut v = vault(Policy::gentle());
    for i in 0..4 { queued(v.propose_change(&OWNER, Change::SetWithdrawDelay(HOUR + i), T0)); }
    assert_eq!(v.propose_change(&OWNER, Change::AddTrusted(CASINO), T0), Err(VaultError::TooManyPending));
    assert_eq!(v.propose_change(&OWNER, Change::SetLockedUntil(Some(T0 + DAY)), T0), Ok(Outcome::ChangeApplied));
}

#[test]
fn a_due_withdrawal_cant_be_redirected_a_new_one_starts_over() {
    let mut v = vault(Policy::strong(None));
    let (a, ready) = queued(v.request_withdrawal(&OWNER, BANK, 4_000, T0));
    v.cancel_withdrawal(&OWNER, a).unwrap();
    let (b, ready_b) = queued(v.request_withdrawal(&OWNER, CASINO, 4_000, ready));
    assert_eq!(ready_b, ready + 72 * HOUR);
    assert_eq!(v.execute_withdrawal(b, ready), Err(VaultError::TooEarly));
    assert_eq!(v.execute_withdrawal(a, ready), Err(VaultError::NotFound));
}

#[test]
fn not_one_second_early_and_a_lock_ends_exactly() {
    let until = T0 + 10 * DAY;
    let mut v = vault(Policy::locked(until, GUARDIAN));
    let (id, ready) = queued(v.request_withdrawal(&OWNER, BANK, 1_000, T0));
    assert_eq!(ready, until);
    assert_eq!(v.execute_withdrawal(id, until - 1), Err(VaultError::TooEarly));
    assert_eq!(v.execute_withdrawal(id, until), Ok(Outcome::Send { amount: 1_000, dest: BANK }));
}

#[test]
fn splitting_a_withdrawal_doesnt_beat_the_daily_limit() {
    let mut v = vault(Policy { daily_limit: Some(1_000), ..Policy::gentle() });
    let ids: Vec<u32> = (0..4).map(|_| queued(v.request_withdrawal(&OWNER, CASINO, 1_000, T0)).0).collect();
    let at = T0 + DAY + 1;
    v.execute_withdrawal(ids[0], at).unwrap();
    for id in &ids[1..] { assert_eq!(v.execute_withdrawal(*id, at), Err(VaultError::DailyLimit)); }
    // trusted sends share the same daily budget
    v.trusted.push(BANK);
    assert_eq!(v.send_to_trusted(&OWNER, BANK, 1, at), Err(VaultError::DailyLimit));
}

#[test]
fn staking_is_not_a_way_out() {
    let mut v = vault(Policy::locked(T0 + 30 * DAY, GUARDIAN));
    v.stake_out(&OWNER, 9_000).unwrap(); // allowed during a lock: the money stays under the Safe's control
    assert_eq!(v.request_withdrawal(&OWNER, CASINO, 2_000, T0), Err(VaultError::InsufficientFunds));
    assert_eq!(v.stake_out(&STRANGER, 1), Err(VaultError::NotOwner));
    v.stake_back(9_100).unwrap(); // back with rewards, only ever into the Safe
    assert_eq!(v.balance, 10_100);
}

#[test]
fn staking_cant_take_money_already_promised() {
    let mut v = vault(Policy::gentle());
    queued(v.request_withdrawal(&OWNER, BANK, 8_000, T0));
    assert_eq!(v.stake_out(&OWNER, 3_000), Err(VaultError::InsufficientFunds));
}

#[test]
fn huge_amounts_overflow_into_an_error_not_a_wraparound() {
    let mut v = vault(Policy::gentle());
    assert_eq!(v.deposit(u64::MAX), Err(VaultError::Overflow));
    assert_eq!(v.request_withdrawal(&OWNER, CASINO, u64::MAX, T0), Err(VaultError::InsufficientFunds));
    assert_eq!(v.stake_back(u64::MAX), Err(VaultError::Overflow));
    assert_eq!(v.balance, 10_000);
}

// ---------------------------------------------------------------- a guardian gone bad

#[test]
fn a_guardian_cant_start_redirect_cancel_or_rush_a_rule() {
    let mut v = vault(Policy::strong(Some(GUARDIAN)));
    let (w, _) = queued(v.request_withdrawal(&OWNER, BANK, 2_000, T0));
    assert_eq!(v.request_withdrawal(&GUARDIAN, CASINO, 1, T0), Err(VaultError::NotOwner));
    assert_eq!(v.cancel_withdrawal(&GUARDIAN, w), Err(VaultError::NotOwner));
    assert_eq!(v.propose_change(&GUARDIAN, Change::SetWithdrawDelay(HOUR), T0), Err(VaultError::NotOwner));
    assert_eq!(v.send_to_trusted(&GUARDIAN, CASINO, 1, T0), Err(VaultError::NotOwner));
    let (c, _) = queued(v.propose_change(&OWNER, Change::SetWithdrawDelay(HOUR), T0));
    assert_eq!(v.guardian_approve_change(&GUARDIAN, c), Err(VaultError::TooEarly));
    // the release pays exactly what and where the owner asked, once
    assert_eq!(v.guardian_release(&GUARDIAN, w, T0), Ok(Outcome::Send { amount: 2_000, dest: BANK }));
    assert_eq!(v.guardian_release(&GUARDIAN, w, T0), Err(VaultError::NotFound));
}

#[test]
fn a_replaced_guardian_loses_every_power_the_moment_the_change_applies() {
    let mut v = vault(Policy::strong(Some(GUARDIAN)));
    let (c, ready) = queued(v.propose_change(&OWNER, Change::SetGuardian(Some(STRANGER)), T0));
    let (w, _) = queued(v.request_withdrawal(&OWNER, BANK, 1_000, T0));
    v.apply_change(c, ready).unwrap();
    assert_eq!(v.guardian_release(&GUARDIAN, w, ready), Err(VaultError::NotGuardian));
}

#[test]
fn no_exit_holds_against_the_guardian_even_mid_lock() {
    let until = T0 + 30 * DAY;
    let mut v = vault(Policy::locked(until, GUARDIAN));
    let (w, _) = queued(v.request_withdrawal(&OWNER, BANK, 1_000, T0));
    assert_eq!(v.propose_change(&OWNER, Change::SetNoExit(true), T0), Ok(Outcome::ChangeApplied));
    assert_eq!(v.guardian_release(&GUARDIAN, w, T0 + DAY), Err(VaultError::NoExit));
    assert_eq!(v.balance, 10_000);
}

// ---------------------------------------------------------------- a stranger

#[test]
fn a_stranger_can_crank_but_gains_nothing() {
    let mut v = vault(Policy::strong(None));
    let (w, ready) = queued(v.request_withdrawal(&OWNER, BANK, 1_000, T0));
    for r in [v.cancel_withdrawal(&STRANGER, w), v.send_to_trusted(&STRANGER, STRANGER, 1, T0), v.propose_change(&STRANGER, Change::SetLockedUntil(None), T0)] {
        assert_eq!(r, Err(VaultError::NotOwner));
    }
    assert_eq!(v.guardian_release(&STRANGER, w, T0), Err(VaultError::NoGuardian));
    // running it is open to anyone, and pays only the owner's destination
    assert_eq!(v.execute_withdrawal(w, ready), Ok(Outcome::Send { amount: 1_000, dest: BANK }));
}

#[test]
fn a_stranger_cant_name_themselves_guardian_or_owner_be_their_own() {
    assert_eq!(Vault::new(OWNER, Policy::strong(Some(OWNER))).err(), Some(VaultError::InvalidValue));
    let mut v = vault(Policy::gentle());
    assert_eq!(v.propose_change(&OWNER, Change::SetGuardian(Some(OWNER)), T0), Err(VaultError::InvalidValue));
}
