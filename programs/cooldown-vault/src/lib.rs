//! Cooldown Vault on Solana. Each owner has one vault: a program-owned PDA that holds their SOL.
//! Every rule lives in `vault-core`; this program only loads the vault, calls the rule, and moves lamports.
//!
//! Tokens (USDC and other classic SPL tokens) live in a token vault per (owner, mint), opened next to the main
//! vault. It keeps its own balance, daily limit and queue, and takes everything else from the main vault: the
//! delays, the lock, the guardian and the trusted addresses. So one set of rules covers every coin, and a token
//! withdrawal waits, cancels and gets released exactly like a SOL one.
//!
//! No receipt token is ever minted, so there is nothing to sell to get around the delay.
//! NOT AUDITED. Devnet only until an independent audit is done.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use vault_core as rules;

declare_id!("FbyskcdPd2WTnU35m2AfCzDZ6GEYhYDj4EuWSLPV49Sy");

#[program]
pub mod cooldown_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, preset: Preset) -> Result<()> {
        let policy = match preset {
            Preset::Gentle => rules::Policy::gentle(),
            Preset::Strong { guardian } => rules::Policy::strong(guardian.map(|g| g.to_bytes())),
            Preset::Locked { until, guardian } => rules::Policy::locked(until, guardian.to_bytes()),
        };
        let v = rules::Vault::new(ctx.accounts.owner.key().to_bytes(), policy).map_err(err)?;
        ctx.accounts.vault.store(&v, ctx.bumps.vault);
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let mut v = ctx.accounts.vault.load();
        v.deposit(amount).map_err(err)?;
        anchor_lang::system_program::transfer(
            CpiContext::new(ctx.accounts.system_program.to_account_info(), anchor_lang::system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            }),
            amount,
        )?;
        let bump = ctx.accounts.vault.bump;
        ctx.accounts.vault.store(&v, bump);
        Ok(())
    }

    pub fn send_to_trusted(ctx: Context<OwnerSend>, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let mut v = ctx.accounts.vault.load();
        let out = v.send_to_trusted(&ctx.accounts.owner.key().to_bytes(), ctx.accounts.dest.key().to_bytes(), amount, now).map_err(err)?;
        pay(&ctx.accounts.vault, &ctx.accounts.dest, out)?;
        let bump = ctx.accounts.vault.bump;
        ctx.accounts.vault.store(&v, bump);
        Ok(())
    }

    pub fn request_withdrawal(ctx: Context<OwnerOnly>, dest: Pubkey, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let mut v = ctx.accounts.vault.load();
        let out = v.request_withdrawal(&ctx.accounts.owner.key().to_bytes(), dest.to_bytes(), amount, now).map_err(err)?;
        if let rules::Outcome::WithdrawalQueued { id, ready_at } = out {
            emit!(WithdrawalQueued { owner: ctx.accounts.owner.key(), id, amount, dest, ready_at });
        }
        let bump = ctx.accounts.vault.bump;
        ctx.accounts.vault.store(&v, bump);
        Ok(())
    }

    pub fn cancel_withdrawal(ctx: Context<OwnerOnly>, id: u32) -> Result<()> {
        let mut v = ctx.accounts.vault.load();
        v.cancel_withdrawal(&ctx.accounts.owner.key().to_bytes(), id).map_err(err)?;
        let bump = ctx.accounts.vault.bump;
        ctx.accounts.vault.store(&v, bump);
        Ok(())
    }

    /// Anyone can run a withdrawal whose delay has passed; the money only ever goes to the owner's chosen address.
    pub fn execute_withdrawal(ctx: Context<Execute>, id: u32) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let mut v = ctx.accounts.vault.load();
        let out = v.execute_withdrawal(id, now).map_err(err)?;
        pay(&ctx.accounts.vault, &ctx.accounts.dest, out)?;
        let bump = ctx.accounts.vault.bump;
        ctx.accounts.vault.store(&v, bump);
        Ok(())
    }

    pub fn guardian_release(ctx: Context<Guardian>, id: u32) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let mut v = ctx.accounts.vault.load();
        let out = v.guardian_release(&ctx.accounts.guardian.key().to_bytes(), id, now).map_err(err)?;
        pay(&ctx.accounts.vault, &ctx.accounts.dest, out)?;
        let bump = ctx.accounts.vault.bump;
        ctx.accounts.vault.store(&v, bump);
        Ok(())
    }

    pub fn propose_change(ctx: Context<OwnerOnly>, change: ChangeArg) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let mut v = ctx.accounts.vault.load();
        v.propose_change(&ctx.accounts.owner.key().to_bytes(), change.into(), now).map_err(err)?;
        let bump = ctx.accounts.vault.bump;
        ctx.accounts.vault.store(&v, bump);
        Ok(())
    }

    pub fn cancel_change(ctx: Context<OwnerOnly>, id: u32) -> Result<()> {
        let mut v = ctx.accounts.vault.load();
        v.cancel_change(&ctx.accounts.owner.key().to_bytes(), id).map_err(err)?;
        let bump = ctx.accounts.vault.bump;
        ctx.accounts.vault.store(&v, bump);
        Ok(())
    }

    pub fn apply_change(ctx: Context<Crank>, id: u32) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let mut v = ctx.accounts.vault.load();
        v.apply_change(id, now).map_err(err)?;
        let bump = ctx.accounts.vault.bump;
        ctx.accounts.vault.store(&v, bump);
        Ok(())
    }

    pub fn guardian_approve_change(ctx: Context<GuardianOnly>, id: u32) -> Result<()> {
        let mut v = ctx.accounts.vault.load();
        v.guardian_approve_change(&ctx.accounts.guardian.key().to_bytes(), id).map_err(err)?;
        let bump = ctx.accounts.vault.bump;
        ctx.accounts.vault.store(&v, bump);
        Ok(())
    }

    // ------------------------------------------------------------ tokens

    /// Opens the owner's vault for one token: a PDA that keeps its rules state and owns the token account
    /// (an associated token account) that holds the coins.
    pub fn open_token_vault(ctx: Context<OpenTokenVault>) -> Result<()> {
        let t = &mut ctx.accounts.token_vault;
        t.owner = ctx.accounts.owner.key();
        t.mint = ctx.accounts.mint.key();
        t.bump = ctx.bumps.token_vault;
        t.daily_limit = None;
        t.spent_day = 0;
        t.spent_today = 0;
        t.withdrawals = Vec::new();
        t.changes = Vec::new();
        Ok(())
    }

    pub fn deposit_token(ctx: Context<DepositToken>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultErr::ZeroAmount);
        token::transfer_checked(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
                from: ctx.accounts.from.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault_tokens.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            }),
            amount,
            ctx.accounts.mint.decimals,
        )
    }

    pub fn send_token_to_trusted(ctx: Context<TokenSend>, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = &ctx.accounts;
        let mut v = a.token_vault.load(&a.vault, a.vault_tokens.amount);
        let out = v.send_to_trusted(&a.owner.key().to_bytes(), a.dest.key().to_bytes(), amount, now).map_err(err)?;
        pay_token(&a.token_vault, &a.mint, &a.vault_tokens, &a.dest, &a.dest_tokens, &a.token_program, out)?;
        ctx.accounts.token_vault.store(&v);
        Ok(())
    }

    pub fn request_token_withdrawal(ctx: Context<TokenOwnerOnly>, dest: Pubkey, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = &ctx.accounts;
        let mut v = a.token_vault.load(&a.vault, a.vault_tokens.amount);
        let out = v.request_withdrawal(&a.owner.key().to_bytes(), dest.to_bytes(), amount, now).map_err(err)?;
        if let rules::Outcome::WithdrawalQueued { id, ready_at } = out {
            emit!(TokenWithdrawalQueued { owner: a.owner.key(), mint: a.token_vault.mint, id, amount, dest, ready_at });
        }
        ctx.accounts.vault.next_id = v.next_id;
        ctx.accounts.token_vault.store(&v);
        Ok(())
    }

    pub fn cancel_token_withdrawal(ctx: Context<TokenOwnerOnly>, id: u32) -> Result<()> {
        let a = &ctx.accounts;
        let mut v = a.token_vault.load(&a.vault, a.vault_tokens.amount);
        v.cancel_withdrawal(&a.owner.key().to_bytes(), id).map_err(err)?;
        ctx.accounts.token_vault.store(&v);
        Ok(())
    }

    /// Anyone can run a token withdrawal whose delay has passed; the coins only ever go to the owner's chosen address.
    pub fn execute_token_withdrawal(ctx: Context<TokenPayout>, id: u32) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = &ctx.accounts;
        let mut v = a.token_vault.load(&a.vault, a.vault_tokens.amount);
        let out = v.execute_withdrawal(id, now).map_err(err)?;
        pay_token(&a.token_vault, &a.mint, &a.vault_tokens, &a.dest, &a.dest_tokens, &a.token_program, out)?;
        ctx.accounts.token_vault.store(&v);
        Ok(())
    }

    /// The main vault's guardian releases a token withdrawal the owner already requested.
    pub fn guardian_release_token(ctx: Context<TokenPayout>, id: u32) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = &ctx.accounts;
        let mut v = a.token_vault.load(&a.vault, a.vault_tokens.amount);
        let out = v.guardian_release(&a.caller.key().to_bytes(), id, now).map_err(err)?;
        pay_token(&a.token_vault, &a.mint, &a.vault_tokens, &a.dest, &a.dest_tokens, &a.token_program, out)?;
        ctx.accounts.token_vault.store(&v);
        Ok(())
    }

    /// A token vault has one rule of its own: its daily limit. Lowering it applies at once; raising or removing
    /// it waits for the main vault's rule delay, like any other loosening.
    pub fn propose_token_limit(ctx: Context<TokenOwnerOnly>, limit: Option<u64>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = &ctx.accounts;
        let mut v = a.token_vault.load(&a.vault, a.vault_tokens.amount);
        v.propose_change(&a.owner.key().to_bytes(), rules::Change::SetDailyLimit(limit), now).map_err(err)?;
        ctx.accounts.vault.next_id = v.next_id;
        ctx.accounts.token_vault.store(&v);
        Ok(())
    }

    pub fn cancel_token_change(ctx: Context<TokenOwnerOnly>, id: u32) -> Result<()> {
        let a = &ctx.accounts;
        let mut v = a.token_vault.load(&a.vault, a.vault_tokens.amount);
        v.cancel_change(&a.owner.key().to_bytes(), id).map_err(err)?;
        ctx.accounts.token_vault.store(&v);
        Ok(())
    }

    pub fn apply_token_change(ctx: Context<TokenCrank>, id: u32) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = &ctx.accounts;
        let mut v = a.token_vault.load(&a.vault, 0);
        v.apply_change(id, now).map_err(err)?;
        ctx.accounts.token_vault.store(&v);
        Ok(())
    }
}

/// Moves lamports out of the vault PDA (owned by this program, so no CPI is needed) and checks the
/// destination account is the one the rules chose.
fn pay<'info>(vault: &Account<'info, VaultAccount>, dest: &AccountInfo<'info>, out: rules::Outcome) -> Result<()> {
    let rules::Outcome::Send { amount, dest: want } = out else { return Ok(()) };
    require_keys_eq!(dest.key(), Pubkey::new_from_array(want), VaultErr::WrongDestination);
    let from = vault.to_account_info();
    **from.try_borrow_mut_lamports()? = from.lamports().checked_sub(amount).ok_or(VaultErr::Overflow)?;
    **dest.try_borrow_mut_lamports()? = dest.lamports().checked_add(amount).ok_or(VaultErr::Overflow)?;
    Ok(())
}

/// Pays tokens out of the token vault's account, signed by the token vault PDA, into the associated token
/// account of the destination the rules chose (the client creates it first if it doesn't exist).
fn pay_token<'info>(
    tv: &Account<'info, TokenVaultAccount>,
    mint: &Account<'info, Mint>,
    from: &Account<'info, TokenAccount>,
    dest: &AccountInfo<'info>,
    dest_tokens: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    out: rules::Outcome,
) -> Result<()> {
    let rules::Outcome::Send { amount, dest: want } = out else { return Ok(()) };
    require_keys_eq!(dest.key(), Pubkey::new_from_array(want), VaultErr::WrongDestination);
    require_keys_eq!(dest_tokens.owner, dest.key(), VaultErr::WrongDestination);
    let seeds: &[&[u8]] = &[b"tvault", tv.owner.as_ref(), tv.mint.as_ref(), &[tv.bump]];
    token::transfer_checked(
        CpiContext::new_with_signer(token_program.to_account_info(), TransferChecked {
            from: from.to_account_info(),
            mint: mint.to_account_info(),
            to: dest_tokens.to_account_info(),
            authority: tv.to_account_info(),
        }, &[seeds]),
        amount,
        mint.decimals,
    )
}

// ---------------------------------------------------------------- accounts

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init, payer = owner, space = 8 + VaultAccount::INIT_SPACE, seeds = [b"vault", owner.key().as_ref()], bump)]
    pub vault: Account<'info, VaultAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"vault", owner.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, VaultAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"vault", owner.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, VaultAccount>,
}

#[derive(Accounts)]
pub struct OwnerSend<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"vault", owner.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, VaultAccount>,
    /// CHECK: must be a trusted address; vault-core checks it and `pay` checks the key.
    #[account(mut)]
    pub dest: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Execute<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [b"vault", vault.owner.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, VaultAccount>,
    /// CHECK: `pay` checks it is the withdrawal's destination.
    #[account(mut)]
    pub dest: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Crank<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [b"vault", vault.owner.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, VaultAccount>,
}

#[derive(Accounts)]
pub struct Guardian<'info> {
    pub guardian: Signer<'info>,
    #[account(mut, seeds = [b"vault", vault.owner.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, VaultAccount>,
    /// CHECK: `pay` checks it is the withdrawal's destination.
    #[account(mut)]
    pub dest: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct GuardianOnly<'info> {
    pub guardian: Signer<'info>,
    #[account(mut, seeds = [b"vault", vault.owner.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, VaultAccount>,
}

#[derive(Accounts)]
pub struct OpenTokenVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"vault", owner.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, VaultAccount>,
    pub mint: Account<'info, Mint>,
    #[account(init, payer = owner, space = 8 + TokenVaultAccount::INIT_SPACE, seeds = [b"tvault", owner.key().as_ref(), mint.key().as_ref()], bump)]
    pub token_vault: Account<'info, TokenVaultAccount>,
    #[account(init, payer = owner, associated_token::mint = mint, associated_token::authority = token_vault)]
    pub vault_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositToken<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"tvault", owner.key().as_ref(), mint.key().as_ref()], bump = token_vault.bump)]
    pub token_vault: Account<'info, TokenVaultAccount>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub from: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = token_vault)]
    pub vault_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TokenOwnerOnly<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"vault", owner.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, VaultAccount>,
    #[account(mut, seeds = [b"tvault", owner.key().as_ref(), token_vault.mint.as_ref()], bump = token_vault.bump)]
    pub token_vault: Account<'info, TokenVaultAccount>,
    #[account(associated_token::mint = token_vault.mint, associated_token::authority = token_vault)]
    pub vault_tokens: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct TokenSend<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"vault", owner.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, VaultAccount>,
    #[account(mut, seeds = [b"tvault", owner.key().as_ref(), mint.key().as_ref()], bump = token_vault.bump)]
    pub token_vault: Account<'info, TokenVaultAccount>,
    pub mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = token_vault)]
    pub vault_tokens: Account<'info, TokenAccount>,
    /// CHECK: must be a trusted address; vault-core checks it and `pay_token` checks the key.
    pub dest: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = dest)]
    pub dest_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// Running a due token withdrawal (anyone) or releasing one (the guardian): `caller` signs either way.
#[derive(Accounts)]
pub struct TokenPayout<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [b"vault", token_vault.owner.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, VaultAccount>,
    #[account(mut, seeds = [b"tvault", token_vault.owner.as_ref(), mint.key().as_ref()], bump = token_vault.bump)]
    pub token_vault: Account<'info, TokenVaultAccount>,
    pub mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = token_vault)]
    pub vault_tokens: Account<'info, TokenAccount>,
    /// CHECK: `pay_token` checks it is the withdrawal's destination.
    pub dest: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = dest)]
    pub dest_tokens: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TokenCrank<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [b"vault", token_vault.owner.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, VaultAccount>,
    #[account(mut, seeds = [b"tvault", token_vault.owner.as_ref(), token_vault.mint.as_ref()], bump = token_vault.bump)]
    pub token_vault: Account<'info, TokenVaultAccount>,
}

// ---------------------------------------------------------------- state

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub enum Preset {
    Gentle,
    Strong { guardian: Option<Pubkey> },
    Locked { until: i64, guardian: Pubkey },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Default)]
pub struct WithdrawalSlot { pub id: u32, pub amount: u64, pub dest: Pubkey, pub ready_at: i64 }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub enum ChangeArg {
    SetWithdrawDelay { seconds: i64 },
    SetRuleDelay { seconds: i64 },
    SetDailyLimit { limit: Option<u64> },
    SetLockedUntil { until: Option<i64> },
    SetGuardian { guardian: Option<Pubkey> },
    AddTrusted { address: Pubkey },
    RemoveTrusted { address: Pubkey },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct ChangeSlot { pub id: u32, pub change: ChangeArg, pub ready_at: i64 }

#[account]
#[derive(InitSpace)]
pub struct VaultAccount {
    pub owner: Pubkey,
    pub bump: u8,
    pub balance: u64,
    pub withdraw_delay: i64,
    pub rule_delay: i64,
    pub daily_limit: Option<u64>,
    pub locked_until: Option<i64>,
    pub guardian: Option<Pubkey>,
    #[max_len(8)]
    pub trusted: Vec<Pubkey>,
    #[max_len(4)]
    pub withdrawals: Vec<WithdrawalSlot>,
    #[max_len(4)]
    pub changes: Vec<ChangeSlot>,
    pub next_id: u32,
    pub spent_day: i64,
    pub spent_today: u64,
}

const _: () = assert!(rules::MAX_TRUSTED == 8 && rules::MAX_PENDING_WITHDRAWALS == 4 && rules::MAX_PENDING_CHANGES == 4);

impl VaultAccount {
    fn load(&self) -> rules::Vault {
        rules::Vault {
            owner: self.owner.to_bytes(),
            balance: self.balance,
            policy: rules::Policy {
                withdraw_delay: self.withdraw_delay,
                rule_delay: self.rule_delay,
                daily_limit: self.daily_limit,
                locked_until: self.locked_until,
                guardian: self.guardian.map(|g| g.to_bytes()),
            },
            trusted: self.trusted.iter().map(|t| t.to_bytes()).collect(),
            withdrawals: self.withdrawals.iter().map(|w| rules::PendingWithdrawal { id: w.id, amount: w.amount, dest: w.dest.to_bytes(), ready_at: w.ready_at }).collect(),
            changes: self.changes.iter().map(|c| rules::PendingChange { id: c.id, change: c.change.into(), ready_at: c.ready_at }).collect(),
            next_id: self.next_id,
            spent_day: self.spent_day,
            spent_today: self.spent_today,
        }
    }

    fn store(&mut self, v: &rules::Vault, bump: u8) {
        self.owner = Pubkey::new_from_array(v.owner);
        self.bump = bump;
        self.balance = v.balance;
        self.withdraw_delay = v.policy.withdraw_delay;
        self.rule_delay = v.policy.rule_delay;
        self.daily_limit = v.policy.daily_limit;
        self.locked_until = v.policy.locked_until;
        self.guardian = v.policy.guardian.map(Pubkey::new_from_array);
        self.trusted = v.trusted.iter().map(|t| Pubkey::new_from_array(*t)).collect();
        self.withdrawals = v.withdrawals.iter().map(|w| WithdrawalSlot { id: w.id, amount: w.amount, dest: Pubkey::new_from_array(w.dest), ready_at: w.ready_at }).collect();
        self.changes = v.changes.iter().map(|c| ChangeSlot { id: c.id, change: c.change.into(), ready_at: c.ready_at }).collect();
        self.next_id = v.next_id;
        self.spent_day = v.spent_day;
        self.spent_today = v.spent_today;
    }
}

/// One token held by a vault. Its rules come from the owner's main vault, except the daily limit, which is
/// counted in this token's own units. Withdrawal and change ids come from the main vault's counter, so an id
/// never means two things.
#[account]
#[derive(InitSpace)]
pub struct TokenVaultAccount {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub bump: u8,
    pub daily_limit: Option<u64>,
    pub spent_day: i64,
    pub spent_today: u64,
    #[max_len(4)]
    pub withdrawals: Vec<WithdrawalSlot>,
    #[max_len(4)]
    pub changes: Vec<ChangeSlot>,
}

impl TokenVaultAccount {
    /// The rules view of this token: the main vault's policy and trusted list, with this token's balance
    /// (what its token account holds), limit, spending and queues.
    fn load(&self, main: &VaultAccount, balance: u64) -> rules::Vault {
        let mut v = main.load();
        v.balance = balance;
        v.policy.daily_limit = self.daily_limit;
        v.spent_day = self.spent_day;
        v.spent_today = self.spent_today;
        v.withdrawals = self.withdrawals.iter().map(|w| rules::PendingWithdrawal { id: w.id, amount: w.amount, dest: w.dest.to_bytes(), ready_at: w.ready_at }).collect();
        v.changes = self.changes.iter().map(|c| rules::PendingChange { id: c.id, change: c.change.into(), ready_at: c.ready_at }).collect();
        v
    }

    /// Writes back only what belongs to the token. Only a daily-limit change is ever proposed here, so
    /// nothing else in the policy can have moved.
    fn store(&mut self, v: &rules::Vault) {
        self.daily_limit = v.policy.daily_limit;
        self.spent_day = v.spent_day;
        self.spent_today = v.spent_today;
        self.withdrawals = v.withdrawals.iter().map(|w| WithdrawalSlot { id: w.id, amount: w.amount, dest: Pubkey::new_from_array(w.dest), ready_at: w.ready_at }).collect();
        self.changes = v.changes.iter().map(|c| ChangeSlot { id: c.id, change: c.change.into(), ready_at: c.ready_at }).collect();
    }
}

impl From<ChangeArg> for rules::Change {
    fn from(c: ChangeArg) -> Self {
        match c {
            ChangeArg::SetWithdrawDelay { seconds } => rules::Change::SetWithdrawDelay(seconds),
            ChangeArg::SetRuleDelay { seconds } => rules::Change::SetRuleDelay(seconds),
            ChangeArg::SetDailyLimit { limit } => rules::Change::SetDailyLimit(limit),
            ChangeArg::SetLockedUntil { until } => rules::Change::SetLockedUntil(until),
            ChangeArg::SetGuardian { guardian } => rules::Change::SetGuardian(guardian.map(|g| g.to_bytes())),
            ChangeArg::AddTrusted { address } => rules::Change::AddTrusted(address.to_bytes()),
            ChangeArg::RemoveTrusted { address } => rules::Change::RemoveTrusted(address.to_bytes()),
        }
    }
}

impl From<rules::Change> for ChangeArg {
    fn from(c: rules::Change) -> Self {
        match c {
            rules::Change::SetWithdrawDelay(seconds) => ChangeArg::SetWithdrawDelay { seconds },
            rules::Change::SetRuleDelay(seconds) => ChangeArg::SetRuleDelay { seconds },
            rules::Change::SetDailyLimit(limit) => ChangeArg::SetDailyLimit { limit },
            rules::Change::SetLockedUntil(until) => ChangeArg::SetLockedUntil { until },
            rules::Change::SetGuardian(g) => ChangeArg::SetGuardian { guardian: g.map(Pubkey::new_from_array) },
            rules::Change::AddTrusted(a) => ChangeArg::AddTrusted { address: Pubkey::new_from_array(a) },
            rules::Change::RemoveTrusted(a) => ChangeArg::RemoveTrusted { address: Pubkey::new_from_array(a) },
        }
    }
}

// ---------------------------------------------------------------- events and errors

#[event]
pub struct WithdrawalQueued { pub owner: Pubkey, pub id: u32, pub amount: u64, pub dest: Pubkey, pub ready_at: i64 }

#[event]
pub struct TokenWithdrawalQueued { pub owner: Pubkey, pub mint: Pubkey, pub id: u32, pub amount: u64, pub dest: Pubkey, pub ready_at: i64 }

#[error_code]
pub enum VaultErr {
    #[msg("Only the vault owner can do this")] NotOwner,
    #[msg("Only the guardian can do this")] NotGuardian,
    #[msg("This vault has no guardian")] NoGuardian,
    #[msg("Amount must be more than zero")] ZeroAmount,
    #[msg("Not enough funds that aren't already queued")] InsufficientFunds,
    #[msg("That address isn't trusted yet")] NotTrusted,
    #[msg("The vault is locked until its date")] Locked,
    #[msg("Not yet: the delay hasn't passed")] TooEarly,
    #[msg("Over today's limit")] DailyLimit,
    #[msg("No such pending item")] NotFound,
    #[msg("Too many pending items")] TooManyPending,
    #[msg("Too many trusted addresses")] TooManyTrusted,
    #[msg("That value isn't allowed")] InvalidValue,
    #[msg("Arithmetic overflow")] Overflow,
    #[msg("Destination account doesn't match")] WrongDestination,
}

fn err(e: rules::VaultError) -> anchor_lang::error::Error {
    use rules::VaultError as E;
    match e {
        E::NotOwner => VaultErr::NotOwner, E::NotGuardian => VaultErr::NotGuardian, E::NoGuardian => VaultErr::NoGuardian,
        E::ZeroAmount => VaultErr::ZeroAmount, E::InsufficientFunds => VaultErr::InsufficientFunds, E::NotTrusted => VaultErr::NotTrusted,
        E::Locked => VaultErr::Locked, E::TooEarly => VaultErr::TooEarly, E::DailyLimit => VaultErr::DailyLimit,
        E::NotFound => VaultErr::NotFound, E::TooManyPending => VaultErr::TooManyPending, E::TooManyTrusted => VaultErr::TooManyTrusted,
        E::InvalidValue => VaultErr::InvalidValue, E::Overflow => VaultErr::Overflow,
    }.into()
}
