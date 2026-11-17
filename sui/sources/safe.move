/// Ecrin Safe on Sui. The same rules as the Solana program and the EVM contract, ported line by line from
/// crates/vault-core (the canonical rules, with their own tests):
/// - money leaves after a delay you chose, or at once to an address you trusted earlier;
/// - you can cancel a waiting withdrawal at any time;
/// - a rule that makes the Safe harder to empty applies at once; one that loosens it waits;
/// - an optional guardian can release a withdrawal you already asked for, and approve a new trusted address early,
///   and nothing else: they can't start a withdrawal, change its amount or where it goes.
///
/// One Safe per owner and coin type (the Registry keeps them apart). The Safe is a shared object that only its
/// owner can move money out of; running a withdrawal whose time has come is open to anyone (the money goes to
/// the address the owner chose, so whoever runs it gains nothing).
module ecrin_safe::safe;

use std::type_name::{Self, TypeName};
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;
use sui::table::{Self, Table};

const HOUR: u64 = 3_600;
const DAY: u64 = 86_400;
const MAX_TRUSTED: u64 = 8;
const MAX_PENDING_WITHDRAWALS: u64 = 4;
const MAX_PENDING_CHANGES: u64 = 4;
/// Furthest a lock can reach: ten years. Past that it is a typo, or a key thief trying to freeze the money for good.
const MAX_LOCK: u64 = 315_360_000;
const MAX_U64: u64 = 18_446_744_073_709_551_615;

// Errors, in the same order as vault-core's VaultError (the wallet maps each to plain words).
const ENotOwner: u64 = 0;
const ENotGuardian: u64 = 1;
const ENoGuardian: u64 = 2;
const EZeroAmount: u64 = 3;
const EInsufficientFunds: u64 = 4;
const ENotTrusted: u64 = 5;
const ELocked: u64 = 6;
const ETooEarly: u64 = 7;
const EDailyLimit: u64 = 8;
const ENotFound: u64 = 9;
const ETooManyPending: u64 = 10;
const ETooManyTrusted: u64 = 11;
const EInvalidValue: u64 = 12;
const EOverflow: u64 = 13;
/// This address already has a Safe for this coin.
const EAlreadyHasSafe: u64 = 14;

/// Every Safe, by owner and coin, so one owner can't end up with two Safes for the same coin.
public struct Registry has key {
    id: UID,
    safes: Table<Key, ID>,
}

public struct Key has copy, drop, store {
    owner: address,
    coin: TypeName,
}

public struct Policy has copy, drop, store {
    /// Seconds a normal withdrawal waits before it can run.
    withdraw_delay: u64,
    /// Seconds a loosening rule change waits before it applies.
    rule_delay: u64,
    /// Most that can leave in one UTC day, trusted sends included. None = no limit.
    daily_limit: Option<u64>,
    /// Nothing leaves before this unix time (seconds), except a withdrawal the guardian releases.
    locked_until: Option<u64>,
    guardian: Option<address>,
}

public enum Change has copy, drop, store {
    SetWithdrawDelay(u64),
    SetRuleDelay(u64),
    SetDailyLimit(Option<u64>),
    SetLockedUntil(Option<u64>),
    SetGuardian(Option<address>),
    AddTrusted(address),
    RemoveTrusted(address),
}

public struct PendingWithdrawal has copy, drop, store {
    id: u64,
    amount: u64,
    dest: address,
    ready_at: u64,
}

public struct PendingChange has copy, drop, store {
    id: u64,
    change: Change,
    ready_at: u64,
}

public struct Safe<phantom T> has key {
    id: UID,
    owner: address,
    balance: Balance<T>,
    policy: Policy,
    trusted: vector<address>,
    withdrawals: vector<PendingWithdrawal>,
    changes: vector<PendingChange>,
    next_id: u64,
    /// UTC day number of the last outgoing transfer, and how much left that day.
    spent_day: u64,
    spent_today: u64,
}

// Events: what the wallet's history and Ecrin's alerts follow.
public struct SafeCreated has copy, drop { safe: ID, owner: address, coin: TypeName }
public struct Deposited has copy, drop { safe: ID, amount: u64 }
public struct Sent has copy, drop { safe: ID, id: u64, amount: u64, dest: address, by_guardian: bool }
public struct WithdrawalQueued has copy, drop { safe: ID, id: u64, amount: u64, dest: address, ready_at: u64 }
public struct WithdrawalCancelled has copy, drop { safe: ID, id: u64 }
public struct ChangeQueued has copy, drop { safe: ID, id: u64, change: Change, ready_at: u64 }
public struct ChangeApplied has copy, drop { safe: ID, id: u64, change: Change }
public struct ChangeCancelled has copy, drop { safe: ID, id: u64 }

fun init(ctx: &mut TxContext) {
    transfer::share_object(Registry { id: object::new(ctx), safes: table::new(ctx) });
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }

fun now(clock: &Clock): u64 { clock.timestamp_ms() / 1000 }

// ---- Opening a Safe

/// Opens a Safe for coin T, owned by the sender. Delays are in seconds (one hour to one year).
public fun create<T>(
    registry: &mut Registry,
    withdraw_delay: u64,
    rule_delay: u64,
    daily_limit: Option<u64>,
    locked_until: Option<u64>,
    guardian: Option<address>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let owner = ctx.sender();
    let policy = Policy { withdraw_delay, rule_delay, daily_limit, locked_until, guardian };
    validate(&policy);
    // Being your own guardian would let one key release any withdrawal at once, so every delay would be void.
    assert!(guardian != option::some(owner), EInvalidValue);
    if (locked_until.is_some()) assert!(*locked_until.borrow() <= now(clock) + MAX_LOCK, EInvalidValue);
    let key = Key { owner, coin: type_name::with_defining_ids<T>() };
    assert!(!registry.safes.contains(key), EAlreadyHasSafe);
    let safe = Safe<T> {
        id: object::new(ctx),
        owner,
        balance: balance::zero(),
        policy,
        trusted: vector[],
        withdrawals: vector[],
        changes: vector[],
        next_id: 1,
        spent_day: 0,
        spent_today: 0,
    };
    let id = object::id(&safe);
    registry.safes.add(key, id);
    event::emit(SafeCreated { safe: id, owner, coin: key.coin });
    transfer::share_object(safe);
}

// ---- Money in and out

/// Adds coins to the Safe. Anyone can top it up.
public fun deposit<T>(safe: &mut Safe<T>, coin: Coin<T>) {
    let amount = coin.value();
    assert!(amount > 0, EZeroAmount);
    safe.balance.join(coin.into_balance());
    event::emit(Deposited { safe: object::id(safe), amount });
}

/// Instant send to an address the owner trusted earlier. Still blocked while locked.
public fun send_to_trusted<T>(safe: &mut Safe<T>, dest: address, amount: u64, clock: &Clock, ctx: &mut TxContext) {
    owner_only(safe, ctx);
    let now = now(clock);
    assert!(amount > 0, EZeroAmount);
    assert!(safe.trusted.contains(&dest), ENotTrusted);
    assert!(!is_locked(safe, now), ELocked);
    assert!(amount <= available(safe), EInsufficientFunds);
    let out = spend(safe, amount, now);
    pay(out, dest, ctx);
    event::emit(Sent { safe: object::id(safe), id: 0, amount, dest, by_guardian: false });
}

/// Queues a withdrawal to any address. It can run after the delay, or after the lock ends if that is later.
public fun request_withdrawal<T>(safe: &mut Safe<T>, dest: address, amount: u64, clock: &Clock, ctx: &mut TxContext) {
    owner_only(safe, ctx);
    let now = now(clock);
    assert!(amount > 0, EZeroAmount);
    // A coin sent to the Safe's own address would be stuck there for good.
    assert!(dest != object::id_address(safe), EInvalidValue);
    assert!(amount <= available(safe), EInsufficientFunds);
    // More than a day's limit could never run (each run counts against the day), so it would sit there forever.
    if (safe.policy.daily_limit.is_some()) assert!(amount <= *safe.policy.daily_limit.borrow(), EDailyLimit);
    assert!(safe.withdrawals.length() < MAX_PENDING_WITHDRAWALS, ETooManyPending);
    let ready_at = max(now + safe.policy.withdraw_delay, safe.policy.locked_until.get_with_default(0));
    let id = next_id(safe);
    safe.withdrawals.push_back(PendingWithdrawal { id, amount, dest, ready_at });
    event::emit(WithdrawalQueued { safe: object::id(safe), id, amount, dest, ready_at });
}

/// The owner can cancel any queued withdrawal at any time. The money simply stays.
public fun cancel_withdrawal<T>(safe: &mut Safe<T>, id: u64, ctx: &TxContext) {
    owner_only(safe, ctx);
    let i = find_withdrawal(safe, id);
    safe.withdrawals.remove(i);
    event::emit(WithdrawalCancelled { safe: object::id(safe), id });
}

/// Runs a queued withdrawal once its time has come. Anyone may call it.
public fun execute_withdrawal<T>(safe: &mut Safe<T>, id: u64, clock: &Clock, ctx: &mut TxContext) {
    let now = now(clock);
    let i = find_withdrawal(safe, id);
    let w = safe.withdrawals[i];
    assert!(now >= w.ready_at, ETooEarly);
    // A lock added after the request still holds it back.
    assert!(!is_locked(safe, now), ELocked);
    let out = spend(safe, w.amount, now);
    safe.withdrawals.remove(i);
    pay(out, w.dest, ctx);
    event::emit(Sent { safe: object::id(safe), id, amount: w.amount, dest: w.dest, by_guardian: false });
}

/// Emergency exit: the guardian co-signs a withdrawal the owner already requested, and it runs now,
/// lock and delay included. The guardian can't create one, change its amount or its destination.
public fun guardian_release<T>(safe: &mut Safe<T>, id: u64, clock: &Clock, ctx: &mut TxContext) {
    guardian_only(safe, ctx);
    let now = now(clock);
    let i = find_withdrawal(safe, id);
    let w = safe.withdrawals[i];
    let out = spend(safe, w.amount, now);
    safe.withdrawals.remove(i);
    pay(out, w.dest, ctx);
    event::emit(Sent { safe: object::id(safe), id, amount: w.amount, dest: w.dest, by_guardian: true });
}

// ---- Rule changes: stricter applies at once, looser waits for the rule delay (and never before a lock ends)

public fun set_withdraw_delay<T>(safe: &mut Safe<T>, seconds: u64, clock: &Clock, ctx: &TxContext) {
    propose(safe, Change::SetWithdrawDelay(seconds), clock, ctx)
}
public fun set_rule_delay<T>(safe: &mut Safe<T>, seconds: u64, clock: &Clock, ctx: &TxContext) {
    propose(safe, Change::SetRuleDelay(seconds), clock, ctx)
}
public fun set_daily_limit<T>(safe: &mut Safe<T>, limit: Option<u64>, clock: &Clock, ctx: &TxContext) {
    propose(safe, Change::SetDailyLimit(limit), clock, ctx)
}
public fun set_locked_until<T>(safe: &mut Safe<T>, until: Option<u64>, clock: &Clock, ctx: &TxContext) {
    propose(safe, Change::SetLockedUntil(until), clock, ctx)
}
public fun set_guardian<T>(safe: &mut Safe<T>, guardian: Option<address>, clock: &Clock, ctx: &TxContext) {
    propose(safe, Change::SetGuardian(guardian), clock, ctx)
}
public fun add_trusted<T>(safe: &mut Safe<T>, addr: address, clock: &Clock, ctx: &TxContext) {
    propose(safe, Change::AddTrusted(addr), clock, ctx)
}
public fun remove_trusted<T>(safe: &mut Safe<T>, addr: address, clock: &Clock, ctx: &TxContext) {
    propose(safe, Change::RemoveTrusted(addr), clock, ctx)
}

fun propose<T>(safe: &mut Safe<T>, change: Change, clock: &Clock, ctx: &TxContext) {
    owner_only(safe, ctx);
    let now = now(clock);
    check_change(safe, &change, now);
    if (is_stricter(&safe.policy, &change)) {
        apply(safe, change);
        event::emit(ChangeApplied { safe: object::id(safe), id: 0, change });
        return
    };
    assert!(safe.changes.length() < MAX_PENDING_CHANGES, ETooManyPending);
    let ready_at = max(now + safe.policy.rule_delay, safe.policy.locked_until.get_with_default(0));
    let id = next_id(safe);
    safe.changes.push_back(PendingChange { id, change, ready_at });
    event::emit(ChangeQueued { safe: object::id(safe), id, change, ready_at });
}

public fun cancel_change<T>(safe: &mut Safe<T>, id: u64, ctx: &TxContext) {
    owner_only(safe, ctx);
    let i = find_change(safe, id);
    safe.changes.remove(i);
    event::emit(ChangeCancelled { safe: object::id(safe), id });
}

/// Applies a queued change once its time has come. Anyone may call it.
public fun apply_change<T>(safe: &mut Safe<T>, id: u64, clock: &Clock) {
    let i = find_change(safe, id);
    let c = safe.changes[i];
    assert!(now(clock) >= c.ready_at, ETooEarly);
    apply(safe, c.change);
    safe.changes.remove(i);
    event::emit(ChangeApplied { safe: object::id(safe), id, change: c.change });
}

/// The guardian can approve a queued change early, but only adding a trusted address:
/// everything else that loosens the Safe always waits.
public fun guardian_approve_change<T>(safe: &mut Safe<T>, id: u64, ctx: &TxContext) {
    guardian_only(safe, ctx);
    let i = find_change(safe, id);
    let c = safe.changes[i];
    let is_add = match (&c.change) { Change::AddTrusted(_) => true, _ => false };
    assert!(is_add, ETooEarly);
    apply(safe, c.change);
    safe.changes.remove(i);
    event::emit(ChangeApplied { safe: object::id(safe), id, change: c.change });
}

// ---- Reading

public fun owner<T>(safe: &Safe<T>): address { safe.owner }
public fun value<T>(safe: &Safe<T>): u64 { safe.balance.value() }
public fun withdraw_delay<T>(safe: &Safe<T>): u64 { safe.policy.withdraw_delay }
public fun rule_delay<T>(safe: &Safe<T>): u64 { safe.policy.rule_delay }
public fun daily_limit<T>(safe: &Safe<T>): Option<u64> { safe.policy.daily_limit }
public fun locked_until<T>(safe: &Safe<T>): Option<u64> { safe.policy.locked_until }
public fun guardian<T>(safe: &Safe<T>): Option<address> { safe.policy.guardian }
public fun trusted<T>(safe: &Safe<T>): vector<address> { safe.trusted }
public fun withdrawal_count<T>(safe: &Safe<T>): u64 { safe.withdrawals.length() }
public fun change_count<T>(safe: &Safe<T>): u64 { safe.changes.length() }
public fun safe_of<T>(registry: &Registry, owner: address): Option<ID> {
    let key = Key { owner, coin: type_name::with_defining_ids<T>() };
    if (registry.safes.contains(key)) option::some(*registry.safes.borrow(key)) else option::none()
}

/// Money not already promised to a queued withdrawal.
public fun available<T>(safe: &Safe<T>): u64 {
    let mut queued = 0;
    let mut i = 0;
    let n = safe.withdrawals.length();
    while (i < n) {
        queued = queued + safe.withdrawals[i].amount;
        i = i + 1;
    };
    let bal = safe.balance.value();
    if (queued >= bal) 0 else bal - queued
}

// ---- Inside

fun owner_only<T>(safe: &Safe<T>, ctx: &TxContext) {
    assert!(ctx.sender() == safe.owner, ENotOwner);
}

fun guardian_only<T>(safe: &Safe<T>, ctx: &TxContext) {
    assert!(safe.policy.guardian.is_some(), ENoGuardian);
    assert!(*safe.policy.guardian.borrow() == ctx.sender(), ENotGuardian);
}

fun is_locked<T>(safe: &Safe<T>, now: u64): bool {
    safe.policy.locked_until.is_some() && now < *safe.policy.locked_until.borrow()
}

fun next_id<T>(safe: &mut Safe<T>): u64 {
    let id = safe.next_id;
    safe.next_id = id + 1;
    id
}

fun max(a: u64, b: u64): u64 { if (a > b) a else b }

/// Counts `amount` against today's limit and takes it out of the balance.
fun spend<T>(safe: &mut Safe<T>, amount: u64, now: u64): Balance<T> {
    let day = now / DAY;
    let spent = if (day == safe.spent_day) safe.spent_today else 0;
    assert!(amount <= MAX_U64 - spent, EOverflow);
    let after = spent + amount;
    if (safe.policy.daily_limit.is_some()) assert!(after <= *safe.policy.daily_limit.borrow(), EDailyLimit);
    assert!(amount <= safe.balance.value(), EInsufficientFunds);
    safe.spent_day = day;
    safe.spent_today = after;
    safe.balance.split(amount)
}

fun pay<T>(out: Balance<T>, dest: address, ctx: &mut TxContext) {
    transfer::public_transfer(coin::from_balance(out, ctx), dest);
}

fun find_withdrawal<T>(safe: &Safe<T>, id: u64): u64 {
    let mut i = 0;
    let n = safe.withdrawals.length();
    while (i < n) {
        if (safe.withdrawals[i].id == id) return i;
        i = i + 1;
    };
    abort ENotFound
}

fun find_change<T>(safe: &Safe<T>, id: u64): u64 {
    let mut i = 0;
    let n = safe.changes.length();
    while (i < n) {
        if (safe.changes[i].id == id) return i;
        i = i + 1;
    };
    abort ENotFound
}

fun check_change<T>(safe: &Safe<T>, change: &Change, now: u64) {
    let mut p = safe.policy;
    match (change) {
        Change::SetWithdrawDelay(s) => p.withdraw_delay = *s,
        Change::SetRuleDelay(s) => p.rule_delay = *s,
        Change::SetDailyLimit(l) => p.daily_limit = *l,
        Change::SetLockedUntil(t) => {
            if (t.is_some()) assert!(*t.borrow() <= now + MAX_LOCK, EInvalidValue);
            p.locked_until = *t;
        },
        Change::SetGuardian(g) => {
            assert!(*g != option::some(safe.owner), EInvalidValue);
            p.guardian = *g;
        },
        Change::AddTrusted(a) => {
            assert!(*a != object::id_address(safe), EInvalidValue);
            assert!(!safe.trusted.contains(a), EInvalidValue);
            assert!(safe.trusted.length() < MAX_TRUSTED, ETooManyTrusted);
        },
        Change::RemoveTrusted(a) => {
            assert!(safe.trusted.contains(a), ENotFound);
        },
    };
    validate(&p);
}

fun apply<T>(safe: &mut Safe<T>, change: Change) {
    match (change) {
        Change::SetWithdrawDelay(s) => safe.policy.withdraw_delay = s,
        Change::SetRuleDelay(s) => safe.policy.rule_delay = s,
        Change::SetDailyLimit(l) => safe.policy.daily_limit = l,
        Change::SetLockedUntil(t) => safe.policy.locked_until = t,
        Change::SetGuardian(g) => safe.policy.guardian = g,
        Change::AddTrusted(a) => {
            if (!safe.trusted.contains(&a)) {
                assert!(safe.trusted.length() < MAX_TRUSTED, ETooManyTrusted);
                safe.trusted.push_back(a);
            }
        },
        Change::RemoveTrusted(a) => {
            let (found, i) = safe.trusted.index_of(&a);
            if (found) { safe.trusted.remove(i); }
        },
    }
}

fun validate(p: &Policy) {
    // A delay under an hour isn't a cooldown; over a year is almost certainly a typo.
    assert!(p.withdraw_delay >= HOUR && p.withdraw_delay <= 365 * DAY, EInvalidValue);
    assert!(p.rule_delay >= HOUR && p.rule_delay <= 365 * DAY, EInvalidValue);
    assert!(p.daily_limit != option::some(0), EInvalidValue);
}

/// True when the change only makes the Safe harder to empty, so it may apply at once.
fun is_stricter(p: &Policy, change: &Change): bool {
    match (change) {
        Change::SetWithdrawDelay(s) => *s >= p.withdraw_delay,
        Change::SetRuleDelay(s) => *s >= p.rule_delay,
        Change::SetDailyLimit(l) => {
            if (l.is_none()) p.daily_limit.is_none()
            else if (p.daily_limit.is_none()) true
            else *l.borrow() <= *p.daily_limit.borrow()
        },
        Change::SetLockedUntil(t) => {
            if (t.is_none()) p.locked_until.is_none()
            else if (p.locked_until.is_none()) true
            else *t.borrow() >= *p.locked_until.borrow()
        },
        // Any guardian change waits, adding one included: a guardian can release a withdrawal at once,
        // so a key thief could otherwise name a second wallet and empty the Safe.
        Change::SetGuardian(_) => false,
        Change::AddTrusted(_) => false,
        Change::RemoveTrusted(_) => true,
    }
}
