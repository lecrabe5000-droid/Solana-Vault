# Ecrin security review 1 (internal)

Date: 2026-11-01. Scope: everything that holds, moves or watches money.

| Part | Files |
|---|---|
| Rules engine (shared by both chains) | `crates/vault-core/src/lib.rs` |
| Solana program | `programs/cooldown-vault/src/lib.rs` |
| Ethereum contract | `evm/contracts/EcrinVault.sol` |
| Alert server (Telegram, email, phone notifications, waitlist, stats) | `worker/*.js` |
| Web app and landing | `app/dapp.js`, `app/i18n.js`, `app/_headers`, `app/sw.js` |
| Deploy workflows and keys | `.github/workflows/*`, `keys/` |

**This is an internal review, not an independent audit.** It was done by reading the code and testing the attack
ideas below against it. No fuzzing or formal verification was done. Nobody outside the project checked it. Mainnet
still needs a professional audit (see "Before mainnet").

## Summary

There is no way for a stranger, or for the guardian, to take money out of a vault, on either chain. The core
promise holds: nothing leaves without the owner's delay, and the owner can cancel. Six issues were found and fixed
in code. One more must be fixed before mainnet (who can upgrade the Solana program). Two low ones are left open
with a plan.

| # | Severity | Issue | Status |
|---|---|---|---|
| 1 | **High** (mainnet) | One key can upgrade the Solana program | Open: process change before mainnet |
| 2 | Medium | Solana: you could be your own guardian, which skips every delay | Fixed (program upgrade needed) |
| 3 | Medium | Opening an email's unsubscribe link stopped alerts, so link scanners could switch them off | Fixed (live) |
| 4 | Medium | A withdrawal bigger than the daily limit could be queued but never run | Fixed (app now; contracts on next deploy) |
| 5 | Low | No upper bound on a lock date | Fixed: 10 years at most |
| 6 | Low | A withdrawal to the vault's own address would vanish from its books | Fixed |
| 7 | Low | Sign-up endpoints only have global limits (spam, filling the queue) | Open: add rate limiting |
| 8 | Low | A tiny SOL withdrawal to a brand-new address fails (Solana's rent minimum) | Open: app warning |
| 9–13 | Info | Design notes (below) | Documented |

## Findings

### 1. High (before mainnet): one key can upgrade the Solana program

The devnet program `EzVuV8…8CUo` can be upgraded by its deployer key alone. On mainnet, whoever holds that key could
replace the program with one that pays every vault to themselves. The time delays don't protect against this,
because they are part of the program being replaced.

The Ethereum contract has no owner, no admin and no upgrade path, so this doesn't apply there.

**Before mainnet:**
- Move the upgrade authority to a multisig (Squads) with a timelock.
- Publish a verifiable build so anyone can check that the deployed program matches the code.
- Once audited and stable, make the program immutable (`solana program set-upgrade-authority --final`).

### 2. Medium: you could be your own guardian on Solana (fixed)

The guardian can release a requested withdrawal at once, skipping the delay and the lock. On Solana, `initialize`
accepted the owner's own address as guardian. With that setup, one stolen key could request a withdrawal and release
it immediately, making every delay worthless. The app already refused this and the Ethereum contract refused it too,
but anyone calling the program directly could set it up.

**Fix:** `Vault::new` now refuses a guardian equal to the owner. Test: `audit_you_cannot_be_your_own_guardian`.
The devnet program needs an upgrade (Actions → deploy-devnet).

### 3. Medium: opening an unsubscribe link stopped alerts (fixed, live)

`GET /api/alerts/unsub?t=…` deleted the subscription. Corporate mail filters and link scanners (Outlook Safe Links,
for example) open every link in a message. A scanner could therefore switch someone's alerts off without them
knowing. For a product whose protection depends on noticing a withdrawal, that defeats the point.

**Fix:** opening the link now only shows a page with an "Unsubscribe" button. Nothing stops until that button is
pressed (a POST). Mail apps' one-click unsubscribe (`List-Unsubscribe-Post`) still works directly. Tested: a GET
leaves the subscription in place, the button removes it, and one-click removes it.

### 4. Medium: a withdrawal over the daily limit could never run (fixed)

Each run of a withdrawal counts against one day's limit. A queued withdrawal bigger than the limit therefore failed
every day, forever, until the owner cancelled it. The money wasn't lost, but it was stuck in a confusing way.

**Fix:**
- The rules (Solana and Ethereum, ETH and tokens) now refuse such a request up front.
- The app refuses it now, on the contracts already deployed, and suggests splitting the withdrawal.
- Tests: `audit_a_withdrawal_over_the_daily_limit_is_refused_up_front`, plus the Ethereum "audit 1" tests.

### 5. Low: a lock had no upper bound (fixed)

A lock date could be anything, up to the year 292 billion. A typo, or a key thief making the rules "stricter",
could freeze a vault for good. If the vault had no guardian, nothing could release it.

**Fix:** a lock can reach at most 10 years ahead (`MAX_LOCK`), at creation and as a change, on both chains. The app
only offers up to one year. Tests: `audit_a_lock_reaches_ten_years_at_most`, plus the Ethereum "audit 1" tests.

### 6. Low: withdrawing to the vault's own address (fixed)

On Solana, a withdrawal whose destination was the vault account itself would take the amount off the vault's books
while the lamports stayed in the account, out of reach for good. It would have to be self-inflicted.

**Fix:** the program refuses the vault (or token vault) as a destination, and so does the app. On Ethereum the
contract can't receive plain ETH, so such a withdrawal would just fail and could be cancelled.

### 7. Low: sign-up endpoints have only global limits (open)

`/api/alerts/start`, `/api/alerts/email`, `/api/push/subscribe` and `/api/waitlist` cap totals (for example, 500
unconfirmed emails an hour and 50,000 devices) but not per visitor. One person could fill those caps and block
others from signing up. They could also make the site send up to 500 confirmation emails an hour to addresses they
don't own, which hurts the sending domain's reputation.

**Plan:**
- A Cloudflare rate-limiting rule on `/api/*`, for example 20 requests a minute per IP (free plan, dashboard).
- Cloudflare Turnstile on the email and waitlist forms.

### 8. Low: tiny SOL withdrawals to a brand-new address (open)

Solana refuses to leave a new account with less than its rent minimum (about 0.00089 SOL). A smaller withdrawal to an
empty address fails when it runs, until the owner cancels it.

**Plan:** an app warning when the destination is empty and the amount is under 0.001 SOL.

### 9–13. Design notes (by design, now written down)

- **9. A stolen key can't take money, but it can make the rules as strict as possible:** 365-day delays, a 10-year
  lock, a tiny daily limit. That's a nuisance, not a theft. A guardian can still release withdrawals the owner
  requests. The security page should recommend a guardian for larger vaults.
- **10. The guardian's emergency release still counts against the daily limit.** A guardian can't empty a vault
  faster than the owner's own limit allows.
- **11. USDC can be frozen by Circle**, its issuer. Neither contract can override that.
- **12. Email confirmation works by simply opening the link**, so a link scanner could confirm a sign-up. The cost
  is low: an unwanted alert email, which can be unsubscribed.
- **13. A Solana vault can't be closed** to recover its rent (about 0.003 SOL). A `close_vault` instruction for
  empty vaults could come later.

## What was checked and holds

**Rules engine (`crates/vault-core`, used by both chains)**
- Only the owner can request, cancel, send or change rules.
- The guardian can only release a withdrawal the owner already requested, to the destination and for the amount
  the owner chose. The only change a guardian can approve early is adding a trusted address.
- A queued withdrawal reserves its amount, so queued withdrawals can never promise more than the balance.
- Looser changes wait the rule delay and never before the lock ends. Every guardian change waits, adding one
  included.
- Overflow is checked on every sum. Delays are kept between 1 hour and 365 days.

**Solana program**
- Every vault and token vault is found by its PDA seeds, with the stored bump.
- Payouts check that the destination account is the one the rules chose. Token payouts check the destination's
  associated token account and its owner.
- A token vault takes the main vault's delays, lock, guardian and trusted list. Ids come from one counter, so an id
  never means two things.
- Only classic SPL Token mints are accepted, not Token-2022 (which can have transfer hooks). Coins sent straight to
  a token account are counted, not lost.
- Test suite: 21 passing.

**Ethereum contract**
- No owner, admin, pause or upgrade path.
- One reentrancy guard covers every function that pays out. State is updated before any external call.
- ERC-20 handling:
  - Tokens that return nothing (USDT-style) work.
  - Fee-on-transfer tokens are counted by what actually arrived.
  - A token that reports failure is refused.
- Plain ETH sent to the contract is refused. Arrays are bounded at 4 and 8 items, so gas is bounded.
- Test suite: 38 passing.

**Alert server**
- The Telegram webhook checks a secret derived from the bot token.
- Email is double opt-in, and alerts are sent only to confirmed addresses.
- Push: the server only calls known push services (Google, Mozilla, Apple, Microsoft). Messages are encrypted
  (RFC 8291) and signed (VAPID). The signing key never leaves the server.
- All text from users or chains is HTML-escaped in emails, Telegram messages and pages.
- The internal `/tick` endpoint isn't routed from outside.
- Test suites: 22 + 3 passing, plus one-off checks of the all-networks alerts and the new unsubscribe flow.

**Web app**
- Strict Content-Security-Policy: scripts only from the site itself, and a fixed list of chain and WalletConnect
  hosts. Framing is blocked.
- Every error and label shown as HTML is escaped.
- Links from alerts can only open cancel or freeze screens, which only ever make a vault safer, and they still
  need a signature.
- Names for addresses stay on the device. A warning flags lookalike addresses (address poisoning).
- The service worker never caches `/api/` or other sites.

**Keys and deploys**
- The only key in the repository is the public local-test program key, which is documented as worthless.
- Deploy keys are GitHub secrets, used only on testnets.

## Before mainnet

1. **Independent audit** of `crates/vault-core`, the Solana program and the Ethereum contract. Firms that do both
   Solana and EVM: OtterSec, Neodyme, Zellic, Trail of Bits, Halborn. A public contest is a cheaper alternative
   (Code4rena, Sherlock, Cantina).
2. **Finding 1:** Squads multisig as the Solana upgrade authority, a verifiable build, then immutable.
3. **A bug bounty** (Immunefi) live from launch.
4. **Finding 7:** rate limiting and Turnstile.
5. **Deposit caps** for the first weeks, so a missed bug can only cost so much.

## What to deploy for these fixes

- **Live once the site deploys:** findings 3 and 6 (app side), and the app-side refusals for 4.
- **Solana devnet:** Actions → deploy-devnet upgrades the program (findings 2, 4, 5, 6).
- **Ethereum test networks:** the fixes for 4 and 5 are in the contract source. The deployed contracts can't be
  changed, so this needs a fresh contract. In Actions → deploy-evm, pick each network by itself to replace it.
  Vaults on the old contracts stay where they are; it's test money only. This isn't urgent: the app already
  refuses withdrawals over the daily limit, and it only offers locks of up to a year.
