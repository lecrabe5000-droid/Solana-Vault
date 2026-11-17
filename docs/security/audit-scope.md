# Ecrin: audit scope and threat model

For security reviewers. Everything here is in this repository, open source (MIT).

## What Ecrin is

A self-custody wallet (Chrome extension and phone web app) with an on-chain **Safe**: money in the Safe can only
leave after a delay its owner chose, and the owner can cancel during that delay. It protects people from theft
(stolen keys, drainers, coercion) and from their own impulsive decisions. Owners can also set trusted addresses
(instant), a daily limit, a time lock and an optional guardian.

The same rules are implemented three times, from one specification (`crates/vault-core`, plain Rust with tests).

## In scope

| Part | Path | Lines of code* | Language |
|---|---|---|---|
| Rules (used by the Solana program) | `crates/vault-core/src/lib.rs` | ~270 | Rust |
| **Solana program** | `programs/cooldown-vault/src/lib.rs` | ~610 | Rust, Anchor 0.31.1 |
| **EVM contract** | `evm/contracts/EcrinVault.sol` | ~450 | Solidity 0.8.24 (no proxy, not upgradeable) |
| Sui package (optional, round 2) | `sui/sources/safe.move` | ~380 | Move 2024 |

\*Non-blank, non-comment lines. The EVM contract is deployed unchanged on Ethereum, Base, Arbitrum, Optimism and
Polygon (later BNB Chain and Avalanche).

**Priority for round one: the Solana program (with the rules) and the EVM contract, about 1,330 lines.**

Out of scope: the wallet apps, the website and the alert server (`worker/`). They hold no funds and can't move
any; they were reviewed internally (`audit-1.md`, `audit-2.md`, `audit-3.md`).

## Actors

| Actor | Can | Can never |
|---|---|---|
| **Owner** (the Safe's key) | Deposit; ask for a withdrawal to any address (it waits); cancel it; send instantly to a trusted address; propose rule changes | Skip the delay; loosen a rule at once; send instantly to an address that wasn't already trusted |
| **Guardian** (optional) | Release a withdrawal **the owner already asked for**, at once; approve a **new trusted address** early | Start a withdrawal; change its amount or destination; hurry any other rule change |
| **Anyone** | Run a withdrawal whose delay has passed (it pays the owner's chosen destination); apply a rule change whose wait is over | Anything else |
| **Brake holder** (Solana `config.authority`, EVM `pauser`) | Stop and restart **new deposits** | Touch withdrawals, cancels, rules, guardians or balances |
| **Upgrade authority** (Solana program; Sui UpgradeCap) | Replace the code | Moves to a multisig before mainnet, then is removed (`admin-keys.md`) |

## Security properties to verify

1. **No early exit.** Money leaves only (a) to an address that was trusted before the send, outside a lock and
   within the daily limit, (b) through a withdrawal whose `ready_at` has passed, outside a lock and within the
   daily limit, or (c) through a guardian release of a withdrawal the owner requested.
2. **Requests can't skip the clock.** `ready_at >= now + withdraw_delay` and `>= locked_until`, using the delay in
   force when asked.
3. **Loosening waits.** Only a stricter change applies at once (longer delays, a lower or new daily limit, a later
   or new lock, removing a trusted address). Everything else, **any guardian change** and **any new trusted
   address** included, waits `rule_delay` and never ends before a lock. The guardian may hurry only a new trusted
   address.
4. **Books balance.** A Safe's recorded balance is what came in minus what went out; queued withdrawals never
   promise more than the balance; the contract always holds at least what all Safes record (exactly, for ETH).
5. **Tokens.** Only what actually arrived is counted (fee-on-transfer tokens), tokens that return nothing (USDT)
   work, failed transfers revert, and a token can't re-enter the vault.
6. **Isolation.** One owner's key can't act on another's Safe; one token's state can't affect another's.
7. **The brake can't trap money**: while paused, every exit still works.
8. **Limits**: delays between 1 hour and 365 days; a lock at most 10 years out; at most 8 trusted addresses, 4 queued
   withdrawals and 4 queued changes; never your own guardian; never paying a Safe into itself.

## Threat model

| Attacker | Goal | Expected defence |
|---|---|---|
| **Thief with the owner's key** | Empty the Safe | Every exit waits the delay; owner is alerted and cancels (with a second device or the guardian); rule loosening, new trusted addresses and new guardians all wait |
| Thief who also controls a second wallet | Name it guardian, then release instantly | Guardian changes always wait (property 3) |
| **Malicious or compromised guardian** | Take money | Can only release what the owner asked for, to where the owner asked |
| **Stranger / cranker** | Redirect, front-run or grief withdrawals | Payout destination fixed by the owner's request; running due items only helps the owner |
| **Malicious token** | Inflate a balance, re-enter, lock the Safe | Balance-difference accounting, re-entry guard, per-token state |
| **Brake holder** | Freeze funds | The brake only stops deposits |
| **Upgrade authority** | Replace the code | Multisig before mainnet, then removed (Solana); the EVM contract has no upgrade path |
| **The owner, on a bad night** | Undo their own protection | Loosening waits; the wallet adds a late-night check and a cooldown (app level) |

## Known limitations (by design)

- An issuer can freeze its token (e.g. Circle and USDC) at any address, a Safe included.
- Money sent to a trusted address is instant by design.
- The delay protects only if someone notices: the alert server sends Telegram, email and phone notifications.
- SOL sent straight to a vault account (not through `deposit`) isn't counted and can't be withdrawn.
- Rebasing tokens aren't supported (the apps offer stablecoins only).

## Build and test

| What | Command | Notes |
|---|---|---|
| Rules + stress test | `cargo test -p vault-core` | 17 rule tests and 800,000 random steps; `STRESS_SEEDS=4000` for a longer run |
| Solana program | `anchor test` | Local validator, deployed upgradeable; SOL, tokens, the brake |
| Wallet's Solana client | see `.github/workflows/ci.yml`, step "Browser client" | Against a local validator |
| EVM contract | `cd evm && npm ci && npx hardhat test` | Unit tests, token edge cases, stress test (`STRESS_SEEDS`, `STRESS_STEPS`) |
| Sui package | `cd sui && sui move test` | 27 tests |

All of these run on every push (GitHub Actions: `ci`, `sui-safe`).

## Deployments (test networks)

The current addresses are in `app/config.js` (Solana devnet), `app/deployments-evm.js` and `app/deployments-sui.js`,
and on the website's Security page.

## Contact

support@ecrinprotocol.app. Please report vulnerabilities privately (GitHub security advisories on this repository).
