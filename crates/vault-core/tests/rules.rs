use vault_core::*;

const OWNER: Address = [1; 32];
const GUARDIAN: Address = [2; 32];
const BANK: Address = [3; 32];
const CASINO: Address = [4; 32];
const T0: i64 = 1_800_000_000;

fn vault(policy: Policy) -> Vault {
    let mut v = Vault::new(OWNER, policy).unwrap();
    v.deposit(1_000).unwrap();
    v
}

#[test]
fn withdrawal_waits_for_the_delay_then_runs() {
    let mut v = vault(Policy::strong(None));
    let Outcome::WithdrawalQueued { id, ready_at } = v.request_withdrawal(&OWNER, CASINO, 400, T0).unwrap() else { panic!() };
    assert_eq!(ready_at, T0 + 72 * HOUR);
    assert_eq!(v.execute_withdrawal(id, T0 + 71 * HOUR), Err(VaultError::TooEarly));
    assert_eq!(v.execute_withdrawal(id, ready_at), Ok(Outcome::Send { amount: 400, dest: CASINO }));
    assert_eq!(v.balance, 600);
}

#[test]
fn owner_can_cancel_and_the_money_stays() {
    let mut v = vault(Policy::gentle());
    let Outcome::WithdrawalQueued { id, .. } = v.request_withdrawal(&OWNER, CASINO, 900, T0).unwrap() else { panic!() };
    assert_eq!(v.available(), 100);
    v.cancel_withdrawal(&OWNER, id).unwrap();
    assert_eq!(v.available(), 1_000);
    assert_eq!(v.execute_withdrawal(id, T0 + 30 * DAY), Err(VaultError::NotFound));
}

#[test]
fn queued_withdrawals_cannot_promise_more_than_the_balance() {
    let mut v = vault(Policy::gentle());
    v.request_withdrawal(&OWNER, CASINO, 700, T0).unwrap();
    assert_eq!(v.request_withdrawal(&OWNER, CASINO, 400, T0), Err(VaultError::InsufficientFunds));
}

#[test]
fn trusted_address_must_wait_before_it_is_trusted() {
    let mut v = vault(Policy::strong(None));
    assert_eq!(v.send_to_trusted(&OWNER, BANK, 100, T0), Err(VaultError::NotTrusted));
    let Outcome::ChangeQueued { id, ready_at } = v.propose_change(&OWNER, Change::AddTrusted(BANK), T0).unwrap() else { panic!() };
    assert_eq!(ready_at, T0 + 7 * DAY);
    assert_eq!(v.apply_change(id, T0 + 6 * DAY), Err(VaultError::TooEarly));
    v.apply_change(id, ready_at).unwrap();
    assert_eq!(v.send_to_trusted(&OWNER, BANK, 100, ready_at), Ok(Outcome::Send { amount: 100, dest: BANK }));
}

#[test]
fn guardian_can_approve_a_trusted_address_early() {
    let mut v = vault(Policy::strong(Some(GUARDIAN)));
    let Outcome::ChangeQueued { id, .. } = v.propose_change(&OWNER, Change::AddTrusted(BANK), T0).unwrap() else { panic!() };
    assert_eq!(v.guardian_approve_change(&OWNER, id), Err(VaultError::NotGuardian));
    v.guardian_approve_change(&GUARDIAN, id).unwrap();
    assert!(v.trusted.contains(&BANK));
}

#[test]
fn guardian_cannot_rush_other_loosening_changes() {
    let mut v = vault(Policy::strong(Some(GUARDIAN)));
    let Outcome::ChangeQueued { id, .. } = v.propose_change(&OWNER, Change::SetWithdrawDelay(HOUR), T0).unwrap() else { panic!() };
    assert_eq!(v.guardian_approve_change(&GUARDIAN, id), Err(VaultError::TooEarly));
}

#[test]
fn stricter_changes_apply_at_once() {
    let mut v = vault(Policy::gentle());
    assert_eq!(v.propose_change(&OWNER, Change::SetWithdrawDelay(72 * HOUR), T0), Ok(Outcome::ChangeApplied));
    assert_eq!(v.propose_change(&OWNER, Change::SetDailyLimit(Some(200)), T0), Ok(Outcome::ChangeApplied));
    assert_eq!(v.propose_change(&OWNER, Change::SetGuardian(Some(GUARDIAN)), T0), Ok(Outcome::ChangeApplied));
    assert_eq!(v.policy.withdraw_delay, 72 * HOUR);
    // Loosening back waits.
    assert!(matches!(v.propose_change(&OWNER, Change::SetWithdrawDelay(24 * HOUR), T0), Ok(Outcome::ChangeQueued { .. })));
    assert!(matches!(v.propose_change(&OWNER, Change::SetGuardian(None), T0), Ok(Outcome::ChangeQueued { .. })));
}

#[test]
fn lock_blocks_everything_until_its_date() {
    let until = T0 + 30 * DAY;
    let mut v = vault(Policy::locked(until, GUARDIAN));
    let Outcome::ChangeQueued { id: add, ready_at } = v.propose_change(&OWNER, Change::AddTrusted(BANK), T0).unwrap() else { panic!() };
    assert_eq!(ready_at, until);
    v.guardian_approve_change(&GUARDIAN, add).unwrap();
    assert_eq!(v.send_to_trusted(&OWNER, BANK, 10, T0), Err(VaultError::Locked));
    let Outcome::WithdrawalQueued { ready_at, .. } = v.request_withdrawal(&OWNER, CASINO, 10, T0).unwrap() else { panic!() };
    assert_eq!(ready_at, until);
    // Ending the lock early is a loosening change: it can't apply before the lock ends anyway.
    let Outcome::ChangeQueued { ready_at, .. } = v.propose_change(&OWNER, Change::SetLockedUntil(None), T0).unwrap() else { panic!() };
    assert_eq!(ready_at, until);
}

#[test]
fn guardian_emergency_release_only_for_what_the_owner_requested() {
    let mut v = vault(Policy::locked(T0 + 30 * DAY, GUARDIAN));
    let Outcome::WithdrawalQueued { id, .. } = v.request_withdrawal(&OWNER, BANK, 300, T0).unwrap() else { panic!() };
    assert_eq!(v.guardian_release(&CASINO, id, T0), Err(VaultError::NotGuardian));
    assert_eq!(v.guardian_release(&GUARDIAN, id, T0), Ok(Outcome::Send { amount: 300, dest: BANK }));
    assert_eq!(v.balance, 700);
    // The guardian can't withdraw on their own: there is no instruction that lets them pick an amount or address.
    assert_eq!(v.guardian_release(&GUARDIAN, 999, T0), Err(VaultError::NotFound));
}

#[test]
fn daily_limit_counts_every_outgoing_transfer() {
    let mut p = Policy::gentle();
    p.daily_limit = Some(250);
    let mut v = vault(p);
    v.trusted.push(BANK);
    v.send_to_trusted(&OWNER, BANK, 200, T0).unwrap();
    assert_eq!(v.send_to_trusted(&OWNER, BANK, 100, T0 + HOUR), Err(VaultError::DailyLimit));
    // Next UTC day the limit resets.
    v.send_to_trusted(&OWNER, BANK, 100, T0 + DAY).unwrap();
}

#[test]
fn only_the_owner_can_move_or_change_anything() {
    let mut v = vault(Policy::gentle());
    v.trusted.push(BANK);
    assert_eq!(v.send_to_trusted(&CASINO, BANK, 1, T0), Err(VaultError::NotOwner));
    assert_eq!(v.request_withdrawal(&CASINO, CASINO, 1, T0), Err(VaultError::NotOwner));
    assert_eq!(v.propose_change(&GUARDIAN, Change::SetWithdrawDelay(HOUR), T0), Err(VaultError::NotOwner));
}

#[test]
fn nonsense_policies_are_refused() {
    assert_eq!(Vault::new(OWNER, Policy { withdraw_delay: 60, ..Policy::gentle() }).err(), Some(VaultError::InvalidValue));
    let mut v = vault(Policy::gentle());
    assert_eq!(v.propose_change(&OWNER, Change::SetGuardian(Some(OWNER)), T0), Err(VaultError::InvalidValue));
    assert_eq!(v.propose_change(&OWNER, Change::SetDailyLimit(Some(0)), T0), Err(VaultError::InvalidValue));
}

#[test]
fn a_lock_added_later_still_holds_back_a_queued_withdrawal() {
    let mut v = vault(Policy::gentle());
    let Outcome::WithdrawalQueued { id, ready_at } = v.request_withdrawal(&OWNER, CASINO, 100, T0).unwrap() else { panic!() };
    assert_eq!(v.propose_change(&OWNER, Change::SetLockedUntil(Some(T0 + 10 * DAY)), T0), Ok(Outcome::ChangeApplied));
    assert_eq!(v.execute_withdrawal(id, ready_at), Err(VaultError::Locked));
    assert!(v.execute_withdrawal(id, T0 + 10 * DAY).is_ok());
}
