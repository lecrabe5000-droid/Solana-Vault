/// The Safe's rules, the same cases vault-core and the EVM contract test.
#[test_only]
module ecrin_safe::safe_tests;

use ecrin_safe::safe::{Self, Safe, Registry};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0xA;
const GUARD: address = @0xB;
const FRIEND: address = @0xC;
const STRANGER: address = @0xD;
const HOUR: u64 = 3_600;
const DAY: u64 = 86_400;
const T0: u64 = 1_700_000_000; // a Tuesday, mid-day UTC

fun start(guardian: Option<address>, limit: Option<u64>): (Scenario, Clock) {
    let mut sc = ts::begin(OWNER);
    safe::init_for_testing(sc.ctx());
    let mut c = clock::create_for_testing(sc.ctx());
    c.set_for_testing(T0 * 1000);
    sc.next_tx(OWNER);
    let mut reg = sc.take_shared<Registry>();
    safe::create<SUI>(&mut reg, 24 * HOUR, 3 * DAY, limit, option::none(), guardian, &c, sc.ctx());
    ts::return_shared(reg);
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.deposit(coin::mint_for_testing<SUI>(1000, sc.ctx()));
    ts::return_shared(s);
    (sc, c)
}

fun later(c: &mut Clock, seconds: u64) { c.increment_for_testing(seconds * 1000) }

fun done(sc: Scenario, c: Clock) {
    c.destroy_for_testing();
    sc.end();
}

/// What `who` received (all coins summed), burnt afterwards.
fun received(sc: &mut Scenario, who: address): u64 {
    sc.next_tx(who);
    let ids = ts::ids_for_address<Coin<SUI>>(who);
    let mut total = 0;
    let mut i = 0;
    while (i < ids.length()) {
        let coin = sc.take_from_address_by_id<Coin<SUI>>(who, ids[i]);
        total = total + coin.value();
        coin.burn_for_testing();
        i = i + 1;
    };
    total
}

#[test]
fun a_withdrawal_waits_for_the_delay_then_anyone_can_run_it() {
    let (mut sc, mut c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.request_withdrawal(STRANGER, 300, &c, sc.ctx());
    assert!(s.available() == 700);
    assert!(s.value() == 1000);
    ts::return_shared(s);
    later(&mut c, 24 * HOUR);
    sc.next_tx(STRANGER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.execute_withdrawal(1, &c, sc.ctx());
    assert!(s.value() == 700);
    assert!(s.withdrawal_count() == 0);
    ts::return_shared(s);
    assert!(received(&mut sc, STRANGER) == 300);
    done(sc, c);
}

#[test, expected_failure(abort_code = 7, location = ecrin_safe::safe)]
fun a_withdrawal_cant_run_early() {
    let (mut sc, mut c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.request_withdrawal(STRANGER, 300, &c, sc.ctx());
    later(&mut c, 24 * HOUR - 1);
    s.execute_withdrawal(1, &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test]
fun the_owner_can_cancel_and_the_money_stays() {
    let (mut sc, c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.request_withdrawal(STRANGER, 300, &c, sc.ctx());
    s.cancel_withdrawal(1, sc.ctx());
    assert!(s.available() == 1000);
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 0, location = ecrin_safe::safe)]
fun only_the_owner_can_ask_for_a_withdrawal() {
    let (mut sc, c) = start(option::none(), option::none());
    sc.next_tx(STRANGER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.request_withdrawal(STRANGER, 300, &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 0, location = ecrin_safe::safe)]
fun only_the_owner_can_cancel() {
    let (mut sc, c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.request_withdrawal(FRIEND, 300, &c, sc.ctx());
    ts::return_shared(s);
    sc.next_tx(STRANGER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.cancel_withdrawal(1, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 4, location = ecrin_safe::safe)]
fun cant_promise_more_than_the_balance() {
    let (mut sc, c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.request_withdrawal(FRIEND, 600, &c, sc.ctx());
    s.request_withdrawal(FRIEND, 600, &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 10, location = ecrin_safe::safe)]
fun at_most_four_waiting_withdrawals() {
    let (mut sc, c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    let mut i = 0;
    while (i < 5) { s.request_withdrawal(FRIEND, 10, &c, sc.ctx()); i = i + 1; };
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 5, location = ecrin_safe::safe)]
fun instant_sends_only_go_to_trusted_addresses() {
    let (mut sc, c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.send_to_trusted(FRIEND, 100, &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test]
fun a_new_trusted_address_waits_unless_the_guardian_approves() {
    let (mut sc, mut c) = start(option::some(GUARD), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.add_trusted(FRIEND, &c, sc.ctx());
    assert!(s.trusted().length() == 0);
    assert!(s.change_count() == 1);
    ts::return_shared(s);
    // the guardian approves it early
    sc.next_tx(GUARD);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.guardian_approve_change(1, sc.ctx());
    assert!(s.trusted() == vector[FRIEND]);
    ts::return_shared(s);
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.send_to_trusted(FRIEND, 100, &c, sc.ctx());
    // without a guardian it applies after the rule delay, run by anyone
    s.add_trusted(STRANGER, &c, sc.ctx());
    ts::return_shared(s);
    later(&mut c, 3 * DAY);
    sc.next_tx(STRANGER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.apply_change(2, &c);
    assert!(s.trusted() == vector[FRIEND, STRANGER]);
    // removing one applies at once
    ts::return_shared(s);
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.remove_trusted(STRANGER, &c, sc.ctx());
    assert!(s.trusted() == vector[FRIEND]);
    ts::return_shared(s);
    assert!(received(&mut sc, FRIEND) == 100);
    done(sc, c);
}

#[test, expected_failure(abort_code = 7, location = ecrin_safe::safe)]
fun the_guardian_cant_hurry_anything_but_a_trusted_address() {
    let (mut sc, c) = start(option::some(GUARD), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.set_withdraw_delay(HOUR, &c, sc.ctx());
    ts::return_shared(s);
    sc.next_tx(GUARD);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.guardian_approve_change(1, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test]
fun stricter_rules_apply_now_looser_ones_wait() {
    let (mut sc, mut c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.set_withdraw_delay(48 * HOUR, &c, sc.ctx());
    assert!(s.withdraw_delay() == 48 * HOUR);
    s.set_daily_limit(option::some(500), &c, sc.ctx());
    assert!(s.daily_limit() == option::some(500));
    s.set_daily_limit(option::some(400), &c, sc.ctx());
    assert!(s.daily_limit() == option::some(400));
    // looser: queued
    s.set_withdraw_delay(HOUR, &c, sc.ctx());
    s.set_daily_limit(option::none(), &c, sc.ctx());
    assert!(s.withdraw_delay() == 48 * HOUR);
    assert!(s.daily_limit() == option::some(400));
    assert!(s.change_count() == 2);
    ts::return_shared(s);
    later(&mut c, 3 * DAY);
    sc.next_tx(STRANGER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.apply_change(1, &c);
    s.apply_change(2, &c);
    assert!(s.withdraw_delay() == HOUR);
    assert!(s.daily_limit() == option::none());
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 7, location = ecrin_safe::safe)]
fun a_looser_rule_cant_apply_early() {
    let (mut sc, mut c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.set_withdraw_delay(HOUR, &c, sc.ctx());
    later(&mut c, 3 * DAY - 1);
    s.apply_change(1, &c);
    ts::return_shared(s);
    done(sc, c);
}

#[test]
fun the_daily_limit_counts_every_send_and_resets_at_midnight_utc() {
    let (mut sc, mut c) = start(option::some(GUARD), option::some(150));
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.add_trusted(FRIEND, &c, sc.ctx());
    ts::return_shared(s);
    sc.next_tx(GUARD);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.guardian_approve_change(1, sc.ctx());
    ts::return_shared(s);
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.send_to_trusted(FRIEND, 100, &c, sc.ctx());
    s.send_to_trusted(FRIEND, 50, &c, sc.ctx());
    ts::return_shared(s);
    later(&mut c, DAY);
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.send_to_trusted(FRIEND, 150, &c, sc.ctx());
    ts::return_shared(s);
    assert!(received(&mut sc, FRIEND) == 300);
    done(sc, c);
}

#[test, expected_failure(abort_code = 8, location = ecrin_safe::safe)]
fun over_the_daily_limit_is_refused() {
    let (mut sc, c) = start(option::some(GUARD), option::some(150));
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.add_trusted(FRIEND, &c, sc.ctx());
    ts::return_shared(s);
    sc.next_tx(GUARD);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.guardian_approve_change(1, sc.ctx());
    ts::return_shared(s);
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.send_to_trusted(FRIEND, 100, &c, sc.ctx());
    s.send_to_trusted(FRIEND, 51, &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 8, location = ecrin_safe::safe)]
fun a_withdrawal_over_the_daily_limit_is_refused_up_front() {
    let (mut sc, c) = start(option::none(), option::some(150));
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.request_withdrawal(FRIEND, 151, &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test]
fun a_lock_holds_withdrawals_back_and_the_guardian_can_still_release_one() {
    let (mut sc, mut c) = start(option::some(GUARD), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    let until = T0 + 30 * DAY;
    s.set_locked_until(option::some(until), &c, sc.ctx()); // a lock is stricter: applies now
    assert!(s.locked_until() == option::some(until));
    s.request_withdrawal(FRIEND, 200, &c, sc.ctx());
    s.request_withdrawal(STRANGER, 100, &c, sc.ctx());
    ts::return_shared(s);
    // past the delay, still locked
    later(&mut c, 2 * DAY);
    sc.next_tx(GUARD);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.guardian_release(1, &c, sc.ctx());
    assert!(s.value() == 800);
    ts::return_shared(s);
    // after the lock, the other runs
    later(&mut c, 28 * DAY);
    sc.next_tx(STRANGER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.execute_withdrawal(2, &c, sc.ctx());
    ts::return_shared(s);
    assert!(received(&mut sc, FRIEND) == 200);
    assert!(received(&mut sc, STRANGER) == 100);
    done(sc, c);
}

#[test, expected_failure(abort_code = 7, location = ecrin_safe::safe)]
fun a_withdrawal_asked_during_a_lock_waits_for_its_end() {
    let (mut sc, mut c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.set_locked_until(option::some(T0 + 10 * DAY), &c, sc.ctx());
    s.request_withdrawal(FRIEND, 200, &c, sc.ctx());
    later(&mut c, 10 * DAY - 1);
    s.execute_withdrawal(1, &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 6, location = ecrin_safe::safe)]
fun a_lock_added_after_a_request_still_holds_it() {
    let (mut sc, mut c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.request_withdrawal(FRIEND, 200, &c, sc.ctx());
    s.set_locked_until(option::some(T0 + 10 * DAY), &c, sc.ctx());
    later(&mut c, 2 * DAY);
    s.execute_withdrawal(1, &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 6, location = ecrin_safe::safe)]
fun no_instant_send_while_locked() {
    let (mut sc, c) = start(option::some(GUARD), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.add_trusted(FRIEND, &c, sc.ctx());
    s.set_locked_until(option::some(T0 + DAY), &c, sc.ctx());
    ts::return_shared(s);
    sc.next_tx(GUARD);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.guardian_approve_change(1, sc.ctx());
    ts::return_shared(s);
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.send_to_trusted(FRIEND, 10, &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 12, location = ecrin_safe::safe)]
fun a_lock_past_ten_years_is_refused() {
    let (mut sc, c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.set_locked_until(option::some(T0 + 3651 * DAY), &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test]
fun a_guardian_change_always_waits() {
    let (mut sc, mut c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.set_guardian(option::some(GUARD), &c, sc.ctx());
    assert!(s.guardian() == option::none());
    later(&mut c, 3 * DAY);
    s.apply_change(1, &c);
    assert!(s.guardian() == option::some(GUARD));
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 1, location = ecrin_safe::safe)]
fun only_the_guardian_releases() {
    let (mut sc, c) = start(option::some(GUARD), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.request_withdrawal(FRIEND, 200, &c, sc.ctx());
    s.guardian_release(1, &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 12, location = ecrin_safe::safe)]
fun you_cant_be_your_own_guardian() {
    let (mut sc, c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.set_guardian(option::some(OWNER), &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 12, location = ecrin_safe::safe)]
fun a_delay_under_an_hour_is_refused() {
    let (mut sc, c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.set_withdraw_delay(HOUR - 1, &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 14, location = ecrin_safe::safe)]
fun one_safe_per_owner_and_coin() {
    let (mut sc, c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut reg = sc.take_shared<Registry>();
    assert!(safe::safe_of<SUI>(&reg, OWNER).is_some());
    assert!(safe::safe_of<SUI>(&reg, STRANGER).is_none());
    safe::create<SUI>(&mut reg, 24 * HOUR, 3 * DAY, option::none(), option::none(), option::none(), &c, sc.ctx());
    ts::return_shared(reg);
    done(sc, c);
}

#[test, expected_failure(abort_code = 12, location = ecrin_safe::safe)]
fun the_safe_cant_withdraw_to_itself() {
    let (mut sc, c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    let me = object::id_address(&s);
    s.request_withdrawal(me, 10, &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 12, location = ecrin_safe::safe)]
fun the_safe_cant_trust_itself() {
    let (mut sc, c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    let me = object::id_address(&s);
    s.add_trusted(me, &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

// ---- Strict options

#[test, expected_failure(abort_code = 15, location = ecrin_safe::safe)]
fun trusted_waits_refuses_instant_sends() {
    let (mut sc, mut c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.add_trusted(FRIEND, &c, sc.ctx());
    later(&mut c, 3 * DAY);
    s.apply_change(1, &c);
    s.set_trusted_waits(true, &c, sc.ctx());
    assert!(s.trusted_waits());
    s.send_to_trusted(FRIEND, 10, &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test]
fun turning_trusted_waits_off_waits_for_the_rule_delay() {
    let (mut sc, mut c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.add_trusted(FRIEND, &c, sc.ctx());
    later(&mut c, 3 * DAY);
    s.apply_change(1, &c);
    s.set_trusted_waits(true, &c, sc.ctx());
    s.set_trusted_waits(false, &c, sc.ctx()); // queued as id 2
    assert!(s.trusted_waits());
    assert!(s.strict_pending_count() == 1);
    later(&mut c, 3 * DAY);
    s.apply_strict_change(2, &c);
    assert!(!s.trusted_waits());
    s.send_to_trusted(FRIEND, 10, &c, sc.ctx());
    ts::return_shared(s);
    assert!(received(&mut sc, FRIEND) == 10);
    done(sc, c);
}

#[test, expected_failure(abort_code = 7, location = ecrin_safe::safe)]
fun trusted_waits_off_cant_apply_early() {
    let (mut sc, mut c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.set_trusted_waits(true, &c, sc.ctx());
    s.set_trusted_waits(false, &c, sc.ctx()); // id 1
    later(&mut c, 3 * DAY - 1);
    s.apply_strict_change(1, &c);
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 16, location = ecrin_safe::safe)]
fun no_exit_stops_the_guardian_release() {
    let (mut sc, c) = start(option::some(GUARD), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.set_no_exit(true, &c, sc.ctx());
    s.request_withdrawal(FRIEND, 100, &c, sc.ctx());
    ts::return_shared(s);
    sc.next_tx(GUARD);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.guardian_release(1, &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}

#[test]
fun a_strict_lock_needs_no_guardian_and_turning_no_exit_off_waits_for_the_lock() {
    let mut sc = ts::begin(OWNER);
    safe::init_for_testing(sc.ctx());
    let mut c = clock::create_for_testing(sc.ctx());
    c.set_for_testing(T0 * 1000);
    sc.next_tx(OWNER);
    let mut reg = sc.take_shared<Registry>();
    safe::create_strict<SUI>(&mut reg, 72 * HOUR, 7 * DAY, option::none(), option::some(T0 + 30 * DAY), option::none(), false, true, &c, sc.ctx());
    ts::return_shared(reg);
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    assert!(s.no_exit());
    assert!(s.guardian().is_none());
    s.deposit(coin::mint_for_testing<SUI>(1000, sc.ctx()));
    s.set_no_exit(false, &c, sc.ctx()); // id 1, waits for the lock
    later(&mut c, 7 * DAY);
    assert!(s.no_exit());
    s.request_withdrawal(FRIEND, 400, &c, sc.ctx()); // id 2, ready when the lock ends
    later(&mut c, 23 * DAY);
    s.apply_strict_change(1, &c);
    assert!(!s.no_exit());
    s.execute_withdrawal(2, &c, sc.ctx());
    ts::return_shared(s);
    assert!(received(&mut sc, FRIEND) == 400);
    done(sc, c);
}

#[test, expected_failure(abort_code = 7, location = ecrin_safe::safe)]
fun no_exit_off_cant_apply_during_the_lock() {
    let mut sc = ts::begin(OWNER);
    safe::init_for_testing(sc.ctx());
    let mut c = clock::create_for_testing(sc.ctx());
    c.set_for_testing(T0 * 1000);
    sc.next_tx(OWNER);
    let mut reg = sc.take_shared<Registry>();
    safe::create_strict<SUI>(&mut reg, HOUR, HOUR, option::none(), option::some(T0 + 30 * DAY), option::some(GUARD), false, true, &c, sc.ctx());
    ts::return_shared(reg);
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.set_no_exit(false, &c, sc.ctx()); // the rule delay is an hour, but the lock still holds it
    later(&mut c, 2 * DAY);
    s.apply_strict_change(1, &c);
    ts::return_shared(s);
    done(sc, c);
}

#[test, expected_failure(abort_code = 0, location = ecrin_safe::safe)]
fun a_stranger_cant_turn_a_strict_option_off() {
    let (mut sc, c) = start(option::none(), option::none());
    sc.next_tx(OWNER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.set_no_exit(true, &c, sc.ctx());
    ts::return_shared(s);
    sc.next_tx(STRANGER);
    let mut s = sc.take_shared<Safe<SUI>>();
    s.set_no_exit(false, &c, sc.ctx());
    ts::return_shared(s);
    done(sc, c);
}
