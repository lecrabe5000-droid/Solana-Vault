# Who controls what, and the path to nobody

Ecrin is self-custody: no key held by Ecrin can move anyone's money, start a withdrawal, change a Safe's rules
or skip a delay. Three powers exist outside the Safes themselves. This page lists each one, who holds it today
(test networks), and who must hold it before mainnet.

| Power | What it can do | What it can never do | Today (testnet) | Before mainnet |
|---|---|---|---|---|
| **Solana program upgrade authority** | Replace the program's code | (In principle anything: that is why it must not stay with one key) | One devnet key (`DEVNET_DEPLOYER_KEY`) | A **Squads** multisig (e.g. 2 of 3, keys on separate hardware wallets), then **removed** (program made immutable) after the audit and a quiet period |
| **Deposit brake** (Solana `config.authority`, EVM `pauser`) | Stop and restart **new deposits** | Touch withdrawals, cancels, rules, guardians, or any balance | The deployer key on each network | The same multisig (Squads on Solana, **Safe** on each EVM network) |
| **Sui package upgrade (UpgradeCap)** | Publish a new version of the Sui package | Change existing Safes' rules or balances by itself | The Sui testnet deployer | Burned (package made immutable) or held by a multisig |

The Ethereum contract has **no upgrade path at all** (no proxy): what is deployed is final. A new version is a new
address.

## The deposit brake

One switch per network. It only stops money coming **in**; every way out keeps working, so it can never trap
funds:

| Paused? | Deposit / new Safe with money | Withdraw, cancel, rules, guardian |
|---|---|---|
| No | ✅ | ✅ |
| Yes | ❌ `DepositsPaused` | ✅ |

When to use it: a bug is suspected in deposits or accounting, a token behaves unexpectedly, or during an incident
while people withdraw. It is not a freeze: nobody can stop withdrawals.

Handover is two steps on both chains (the new holder must accept), so a typo can't lose the switch:

- Solana: `propose_config_authority(next)` by the current holder, then `accept_config_authority` signed by `next`.
- EVM: `proposePauser(next)`, then `acceptPauser()` from `next`.

## Moving to multisigs (mainnet checklist)

1. **Create the multisigs**: Squads (Solana) and Safe (each EVM network), same signers, threshold 2 of 3.
   Signers on hardware wallets, held by different people or places. Write down who holds which.
2. **Deploy** from a fresh deployer key that has never touched the internet-facing machines.
3. **Solana program**: `solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <SQUADS_VAULT> --skip-new-upgrade-authority-signer-check`
4. **Solana brake**: run `scripts/init-config.mjs` with the deployer, then `propose_config_authority(<SQUADS_VAULT>)`,
   then accept it through a Squads transaction.
5. **EVM brake** on each network: `proposePauser(<SAFE_ADDRESS>)`, then `acceptPauser()` through the Safe app.
6. **Check**: the program's upgrade authority, `config.authority` and each `pauser()` all show the multisigs.
   Publish the addresses on the Security page.
7. **Later**: after the audit and a quiet period on mainnet, make the Solana program immutable
   (`solana program set-upgrade-authority <PROGRAM_ID> --final`, through Squads). The brake can stay with the
   multisig: it can't take money.

## Launch scope

The Safe launches first on **Solana** and the Ethereum-style networks **Ethereum, Base, Arbitrum, Optimism and
Polygon** (one contract, the same code everywhere). BNB Chain and Avalanche follow when deployed. HyperEVM and
Robinhood Chain are wallet-only (send and receive), with no Safe, and are not part of the audit. Sui is a separate
contract, optional for the first audit round.
