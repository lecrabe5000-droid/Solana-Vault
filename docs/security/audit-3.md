# Security review 3 (internal): before the audit

Date: 17 November 2026. Scope: the Solana program, the EVM contract, the Sui package, and the wallet's key
handling and dependencies, after adding the deposit brake.

**This is an internal review, not an independent audit.** It prepares the code for one.

## What was added

| Change | Where | Why |
|---|---|---|
| **Deposit brake**: one switch per network stops new deposits, and nothing else | Solana `init_config` / `set_deposits_paused` / two-step authority handover; EVM `pauser`, `setDepositsPaused`, `proposePauser` / `acceptPauser` | An emergency stop that can never trap money: withdrawals, cancels, rules and guardian actions always work. See `admin-keys.md`. |
| **Stress tests** of the rules | `crates/vault-core/tests/stress.rs` (800,000 random steps), `evm/test/Stress.test.js` (ETH and three token kinds, with the brake) | Random sequences by the owner, the guardian and strangers, with time jumping; every security property checked after every step. |
| **Hostile token** test | `evm/contracts/test/Helpers.sol` (`EvilToken`), `Stress.test.js` | A token that calls back into the vault during `transfer` and `transferFrom` gets nowhere (the re-entry guard holds). |
| **Live Sui test** | `extension/test/sui-safe.live.mjs`, run by the `sui-safe` workflow | The wallet's own code opens a Safe, deposits, withdraws, cancels and changes rules on Sui Testnet. |

## Proving the tests can fail

A test that never fails proves nothing, so known bugs were planted in the code one at a time:

- **Rules (Rust), 7 bugs**: withdrawal runs early; guardian change applies at once; daily limit ignored; instant send
  ignores the lock; lowering the delay applies at once; the guardian can hurry any change; being your own guardian.
  **All 7 caught.** One was missed at first because the test asked the code under test whether a change was
  "stricter"; the test now has its own independent copy of that rule.
- **EVM contract, 8 bugs**: withdrawal runs early; guardian change applies at once; deposits ignore the brake;
  instant send ignores the lock; fee tokens counted at face value; anyone can release; a looser delay applies at once;
  withdrawals can promise the same money twice. **All 8 caught** after tuning which actions the random test favours.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Low | **Paying a Safe into itself.** If the owner trusted their own Safe's address (or the contract's), an instant send or withdrawal to it would lower the Safe's books while the coins stayed inside, stuck. Only the owner could cause it, after the trusted-address wait. | **Fixed on all three chains** (Solana `pay`/`pay_token`, EVM `requestWithdrawal`/`requestTokenWithdrawal`/`AddTrusted`, Sui `request_withdrawal`/`AddTrusted`), with tests. |
| 2 | Medium (wallet) | **Sui Safe errors shown raw.** Sui reports a contract refusal in a second format the wallet didn't recognise, so people would have seen "abort code: 14" instead of words. | **Fixed**, found by the live test, with a test. |
| 3 | High (wallet, Sui only) | **Every Sui rule change crashed before sending** (all seven kinds were encoded at once, and encoding an address from a number threw). | **Fixed**, found by the live test, with a test. Never released to users. |
| 4 | Low (wallet) | **Address poisoning** (a look-alike of an address you used) had only the generic "first time" warning. | **Fixed**: a red warning names the trick when a destination matches a known address's first and last 4 characters but differs in the middle. |
| 5 | Info | `npm audit` lists advisories in `ws`, `uuid` and `jayson` (server-side code pulled in by ethers and Solana's library). | **Not reachable**: checked that none of them is in the extension or phone-wallet builds. |
| 6 | Info | One shipped library (`jsqr`) wasn't pinned to an exact version. | **Fixed** (pinned). |
| 7 | Info | The Solana deposit brake must be set up (`scripts/init-config.mjs`) **before** the program is made immutable, or deposits would be impossible. | Documented in `admin-keys.md`; the devnet deploy runs it automatically. |
| 8 | Info | SOL sent straight to a vault account (not through `deposit`) isn't counted and can't be withdrawn. Tokens sent straight to a token vault's account *are* counted (by design). | Documented; no fix (a "sweep" would add risk). |

## Solana program: what was checked and found sound

- Every vault and token vault is a PDA derived from its owner (and mint); `has_one`-style seed checks on every
  instruction, so one owner's signature can't open another's vault.
- Payouts check the destination against what the rules chose (`require_keys_eq`), and token payouts check the
  destination token account belongs to that destination.
- Token CPIs go to the fixed SPL Token program, with `transfer_checked` (mint and decimals checked).
- The settings account can only be created by the program's upgrade authority (checked against `ProgramData`), once.
- Arithmetic is checked; the vault never pays more than its recorded balance.

## Still before mainnet

1. **Independent audit** of the Solana program and EVM contract (Sui optional), with fixes re-checked.
2. Upgrade authority and brake holders moved to **multisigs** (`admin-keys.md`).
3. The Solana deposit brake goes live on devnet once the extension version that sends the new account is in the
   Chrome Web Store (older versions can't deposit on the upgraded program).
4. EVM contract redeployed (it has no upgrade path) at the code freeze; Sui package republished then too.
