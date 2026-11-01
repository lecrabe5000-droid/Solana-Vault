//! Cooldown Vault rules, kept free of any Solana dependency so they can be tested on any machine.
//!
//! The idea: every way out of the vault is slower than a gambling urge.
//! - Sends to trusted addresses arrive at once (subject to the daily limit).
//! - Any other withdrawal waits for the policy's delay, and the owner can cancel it until it runs.
//! - Making the policy stricter applies at once. Loosening it waits for the rule delay.
//! - A guardian can never move funds on their own. They can only approve something the owner asked for.
//!
//! The on-chain program (programs/cooldown-vault) stores this state and calls these functions;
//! the clock and the signers come from the transaction.

pub type Address = [u8; 32];

pub const HOUR: i64 = 3_600;
pub const DAY: i64 = 86_400;

/// Most addresses and pending items one vault holds, so the on-chain account has a fixed size.
pub const MAX_TRUSTED: usize = 8;
pub const MAX_PENDING_WITHDRAWALS: usize = 4;
pub const MAX_PENDING_CHANGES: usize = 4;
/// Furthest a lock can reach: ten years. Past that it is a typo, or a key thief trying to freeze the money for good.
pub const MAX_LOCK: i64 = 10 * 365 * DAY;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Policy {
    /// Seconds a normal withdrawal waits before it can run.
    pub withdraw_delay: i64,
    /// Seconds a loosening rule change waits before it applies.
    pub rule_delay: i64,
    /// Most that can leave in one UTC day, trusted sends included. None = no limit.
    pub daily_limit: Option<u64>,
    /// Nothing leaves before this unix time, except an emergency withdrawal the guardian co-signs.
    pub locked_until: Option<i64>,
    pub guardian: Option<Address>,
}

impl Policy {
    /// 24 h withdrawal delay, 3-day rule delay.
    pub fn gentle() -> Self {
        Policy { withdraw_delay: 24 * HOUR, rule_delay: 3 * DAY, daily_limit: None, locked_until: None, guardian: None }
    }
    /// 72 h withdrawal delay, 7-day rule delay, guardian notified.
    pub fn strong(guardian: Option<Address>) -> Self {
        Policy { withdraw_delay: 72 * HOUR, rule_delay: 7 * DAY, daily_limit: None, locked_until: None, guardian }
    }
    /// Nothing leaves before `until` except a guardian-approved emergency withdrawal.
    pub fn locked(until: i64, guardian: Address) -> Self {
        Policy { withdraw_delay: 72 * HOUR, rule_delay: 7 * DAY, daily_limit: None, locked_until: Some(until), guardian: Some(guardian) }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Change {
    SetWithdrawDelay(i64),
    SetRuleDelay(i64),
    SetDailyLimit(Option<u64>),
    SetLockedUntil(Option<i64>),
    SetGuardian(Option<Address>),
    AddTrusted(Address),
    RemoveTrusted(Address),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PendingWithdrawal {
    pub id: u32,
    pub amount: u64,
    pub dest: Address,
    pub ready_at: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PendingChange {
    pub id: u32,
    pub change: Change,
    pub ready_at: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultError {
    NotOwner,
    NotGuardian,
    NoGuardian,
    ZeroAmount,
    InsufficientFunds,
    NotTrusted,
    Locked,
    TooEarly,
    DailyLimit,
    NotFound,
    TooManyPending,
    TooManyTrusted,
    InvalidValue,
    Overflow,
}

/// What a call changed, so the program knows what to transfer or log.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Move `amount` to `dest` now.
    Send { amount: u64, dest: Address },
    /// A withdrawal is queued and can run at `ready_at`.
    WithdrawalQueued { id: u32, ready_at: i64 },
    /// A change applied immediately (it was stricter, or the guardian approved it).
    ChangeApplied,
    /// A loosening change is queued and applies at `ready_at`.
    ChangeQueued { id: u32, ready_at: i64 },
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Vault {
    pub owner: Address,
    pub balance: u64,
    pub policy: Policy,
    pub trusted: Vec<Address>,
    pub withdrawals: Vec<PendingWithdrawal>,
    pub changes: Vec<PendingChange>,
    pub next_id: u32,
    /// UTC day number of the last outgoing transfer, and how much left that day.
    pub spent_day: i64,
    pub spent_today: u64,
}

impl Vault {
    pub fn new(owner: Address, policy: Policy) -> Result<Self, VaultError> {
        validate(&policy)?;
        // Being your own guardian would let one key release any withdrawal at once, so every delay would be void.
        if policy.guardian == Some(owner) { return Err(VaultError::InvalidValue); }
        Ok(Vault { owner, balance: 0, policy, trusted: Vec::new(), withdrawals: Vec::new(), changes: Vec::new(), next_id: 1, spent_day: 0, spent_today: 0 })
    }

    fn owner_only(&self, signer: &Address) -> Result<(), VaultError> {
        if *signer == self.owner { Ok(()) } else { Err(VaultError::NotOwner) }
    }

    fn guardian_only(&self, signer: &Address) -> Result<(), VaultError> {
        match self.policy.guardian {
            None => Err(VaultError::NoGuardian),
            Some(g) if g == *signer => Ok(()),
            Some(_) => Err(VaultError::NotGuardian),
        }
    }

    fn id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        id
    }

    fn is_locked(&self, now: i64) -> bool {
        self.policy.locked_until.is_some_and(|t| now < t)
    }

    /// Funds not already promised to a queued withdrawal.
    pub fn available(&self) -> u64 {
        let queued: u64 = self.withdrawals.iter().map(|w| w.amount).sum();
        self.balance.saturating_sub(queued)
    }

    /// Counts `amount` against today's limit and takes it from the balance.
    fn spend(&mut self, amount: u64, now: i64) -> Result<(), VaultError> {
        let day = now.div_euclid(DAY);
        let spent = if day == self.spent_day { self.spent_today } else { 0 };
        let after = spent.checked_add(amount).ok_or(VaultError::Overflow)?;
        if let Some(limit) = self.policy.daily_limit {
            if after > limit { return Err(VaultError::DailyLimit); }
        }
        if amount > self.balance { return Err(VaultError::InsufficientFunds); }
        self.balance -= amount;
        self.spent_day = day;
        self.spent_today = after;
        Ok(())
    }

    pub fn deposit(&mut self, amount: u64) -> Result<(), VaultError> {
        if amount == 0 { return Err(VaultError::ZeroAmount); }
        self.balance = self.balance.checked_add(amount).ok_or(VaultError::Overflow)?;
        Ok(())
    }

    /// Instant send to an address the owner trusted earlier. Still blocked while locked.
    pub fn send_to_trusted(&mut self, signer: &Address, dest: Address, amount: u64, now: i64) -> Result<Outcome, VaultError> {
        self.owner_only(signer)?;
        if amount == 0 { return Err(VaultError::ZeroAmount); }
        if !self.trusted.contains(&dest) { return Err(VaultError::NotTrusted); }
        if self.is_locked(now) { return Err(VaultError::Locked); }
        if amount > self.available() { return Err(VaultError::InsufficientFunds); }
        self.spend(amount, now)?;
        Ok(Outcome::Send { amount, dest })
    }

    /// Queues a withdrawal to any address. It can run after the delay, or after the lock ends if that is later.
    pub fn request_withdrawal(&mut self, signer: &Address, dest: Address, amount: u64, now: i64) -> Result<Outcome, VaultError> {
        self.owner_only(signer)?;
        if amount == 0 { return Err(VaultError::ZeroAmount); }
        if amount > self.available() { return Err(VaultError::InsufficientFunds); }
        // More than a day's limit could never run (each run counts against the day), so it would sit there forever.
        if self.policy.daily_limit.is_some_and(|l| amount > l) { return Err(VaultError::DailyLimit); }
        if self.withdrawals.len() >= MAX_PENDING_WITHDRAWALS { return Err(VaultError::TooManyPending); }
        let after_delay = now.checked_add(self.policy.withdraw_delay).ok_or(VaultError::Overflow)?;
        let ready_at = after_delay.max(self.policy.locked_until.unwrap_or(i64::MIN));
        let id = self.id();
        self.withdrawals.push(PendingWithdrawal { id, amount, dest, ready_at });
        Ok(Outcome::WithdrawalQueued { id, ready_at })
    }

    /// The owner can cancel any queued withdrawal at any time. The funds simply stay.
    pub fn cancel_withdrawal(&mut self, signer: &Address, id: u32) -> Result<Outcome, VaultError> {
        self.owner_only(signer)?;
        let i = self.withdrawals.iter().position(|w| w.id == id).ok_or(VaultError::NotFound)?;
        self.withdrawals.remove(i);
        Ok(Outcome::Cancelled)
    }

    /// Runs a queued withdrawal once its time has come. Anyone may call it (a crank); the funds go to the
    /// destination the owner chose, so the caller gains nothing.
    pub fn execute_withdrawal(&mut self, id: u32, now: i64) -> Result<Outcome, VaultError> {
        let i = self.withdrawals.iter().position(|w| w.id == id).ok_or(VaultError::NotFound)?;
        let w = self.withdrawals[i];
        if now < w.ready_at { return Err(VaultError::TooEarly); }
        // A lock added after the request still holds it back.
        if self.is_locked(now) { return Err(VaultError::Locked); }
        self.spend(w.amount, now)?;
        self.withdrawals.remove(i);
        Ok(Outcome::Send { amount: w.amount, dest: w.dest })
    }

    /// Emergency exit: the guardian co-signs a withdrawal the owner already requested, and it runs now,
    /// lock and delay included. The guardian can't create one, change its amount or its destination.
    pub fn guardian_release(&mut self, signer: &Address, id: u32, now: i64) -> Result<Outcome, VaultError> {
        self.guardian_only(signer)?;
        let i = self.withdrawals.iter().position(|w| w.id == id).ok_or(VaultError::NotFound)?;
        let w = self.withdrawals[i];
        self.spend(w.amount, now)?;
        self.withdrawals.remove(i);
        Ok(Outcome::Send { amount: w.amount, dest: w.dest })
    }

    /// Proposes a policy change. Stricter changes apply at once; looser ones wait for the rule delay
    /// (and never before the lock ends).
    pub fn propose_change(&mut self, signer: &Address, change: Change, now: i64) -> Result<Outcome, VaultError> {
        self.owner_only(signer)?;
        self.check_change(&change, now)?;
        if is_stricter(&self.policy, &change) {
            self.apply(change)?;
            return Ok(Outcome::ChangeApplied);
        }
        if self.changes.len() >= MAX_PENDING_CHANGES { return Err(VaultError::TooManyPending); }
        let after_delay = now.checked_add(self.policy.rule_delay).ok_or(VaultError::Overflow)?;
        let ready_at = after_delay.max(self.policy.locked_until.unwrap_or(i64::MIN));
        let id = self.id();
        self.changes.push(PendingChange { id, change, ready_at });
        Ok(Outcome::ChangeQueued { id, ready_at })
    }

    pub fn cancel_change(&mut self, signer: &Address, id: u32) -> Result<Outcome, VaultError> {
        self.owner_only(signer)?;
        let i = self.changes.iter().position(|c| c.id == id).ok_or(VaultError::NotFound)?;
        self.changes.remove(i);
        Ok(Outcome::Cancelled)
    }

    /// Applies a queued change once its time has come. Anyone may call it.
    pub fn apply_change(&mut self, id: u32, now: i64) -> Result<Outcome, VaultError> {
        let i = self.changes.iter().position(|c| c.id == id).ok_or(VaultError::NotFound)?;
        let c = self.changes[i];
        if now < c.ready_at { return Err(VaultError::TooEarly); }
        self.apply(c.change)?;
        self.changes.remove(i);
        Ok(Outcome::ChangeApplied)
    }

    /// The guardian can approve a queued change early, but only adding a trusted address: everything
    /// else that loosens the vault always waits.
    pub fn guardian_approve_change(&mut self, signer: &Address, id: u32) -> Result<Outcome, VaultError> {
        self.guardian_only(signer)?;
        let i = self.changes.iter().position(|c| c.id == id).ok_or(VaultError::NotFound)?;
        let c = self.changes[i];
        if !matches!(c.change, Change::AddTrusted(_)) { return Err(VaultError::TooEarly); }
        self.apply(c.change)?;
        self.changes.remove(i);
        Ok(Outcome::ChangeApplied)
    }

    fn check_change(&self, change: &Change, now: i64) -> Result<(), VaultError> {
        let mut p = self.policy;
        match *change {
            Change::SetWithdrawDelay(s) => p.withdraw_delay = s,
            Change::SetRuleDelay(s) => p.rule_delay = s,
            Change::SetDailyLimit(l) => p.daily_limit = l,
            Change::SetLockedUntil(t) => {
                if t.is_some_and(|t| t > now.saturating_add(MAX_LOCK)) { return Err(VaultError::InvalidValue); }
                p.locked_until = t
            }
            Change::SetGuardian(g) => { if g == Some(self.owner) { return Err(VaultError::InvalidValue); } p.guardian = g }
            Change::AddTrusted(a) => {
                if self.trusted.contains(&a) { return Err(VaultError::InvalidValue); }
                if self.trusted.len() >= MAX_TRUSTED { return Err(VaultError::TooManyTrusted); }
            }
            Change::RemoveTrusted(a) => { if !self.trusted.contains(&a) { return Err(VaultError::NotFound); } }
        }
        validate(&p)
    }

    fn apply(&mut self, change: Change) -> Result<(), VaultError> {
        match change {
            Change::SetWithdrawDelay(s) => self.policy.withdraw_delay = s,
            Change::SetRuleDelay(s) => self.policy.rule_delay = s,
            Change::SetDailyLimit(l) => self.policy.daily_limit = l,
            Change::SetLockedUntil(t) => self.policy.locked_until = t,
            Change::SetGuardian(g) => self.policy.guardian = g,
            Change::AddTrusted(a) => {
                if self.trusted.contains(&a) { return Ok(()); }
                if self.trusted.len() >= MAX_TRUSTED { return Err(VaultError::TooManyTrusted); }
                self.trusted.push(a);
            }
            Change::RemoveTrusted(a) => self.trusted.retain(|t| *t != a),
        }
        Ok(())
    }
}

fn validate(p: &Policy) -> Result<(), VaultError> {
    // A delay under an hour isn't a cooldown; over a year is almost certainly a typo.
    let ok = |s: i64| (HOUR..=365 * DAY).contains(&s);
    if !ok(p.withdraw_delay) || !ok(p.rule_delay) { return Err(VaultError::InvalidValue); }
    if p.daily_limit == Some(0) { return Err(VaultError::InvalidValue); }
    Ok(())
}

/// True when the change only makes the vault harder to drain, so it may apply at once.
pub fn is_stricter(p: &Policy, change: &Change) -> bool {
    match *change {
        Change::SetWithdrawDelay(s) => s >= p.withdraw_delay,
        Change::SetRuleDelay(s) => s >= p.rule_delay,
        Change::SetDailyLimit(l) => match (p.daily_limit, l) {
            (_, None) => p.daily_limit.is_none(),
            (None, Some(_)) => true,
            (Some(old), Some(new)) => new <= old,
        },
        Change::SetLockedUntil(t) => match (p.locked_until, t) {
            (_, None) => p.locked_until.is_none(),
            (None, Some(_)) => true,
            (Some(old), Some(new)) => new >= old,
        },
        // Any guardian change waits, adding one included: a guardian can release a withdrawal at once,
        // so a key thief (or the owner on a bad night) could otherwise name a second wallet and empty the vault.
        Change::SetGuardian(_) => false,
        Change::AddTrusted(_) => false,
        Change::RemoveTrusted(_) => true,
    }
}
