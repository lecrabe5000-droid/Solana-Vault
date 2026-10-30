# Ecrin

*Where your crypto is kept.*

Ecrin is a Solana wallet vault and on-chain protocol with a built-in **cooldown**: every way out of your savings takes time, so no impulse, scam or bad night can empty it. It's built first for people fighting gambling urges, and it protects anyone who wants their crypto to stay put.

Crypto puts a casino one tap away. DNS blockers are switched off in a minute, staking unstakes in hours, and liquid staking tokens sell instantly. Ecrin moves the protection on-chain, where no app, wallet or setting can skip it.

## How it works

| Way out | What happens |
| --- | --- |
| Send to a **trusted address** (your bank off-ramp, your rent) | Arrives now. Adding a trusted address waits for the rule delay, or needs the guardian. |
| **Any other withdrawal** | Waits 24 to 72 h. You can cancel any time; the guardian is notified. |
| **Loosening a rule** (shorter delay, any guardian change) | Waits 3 to 7 days. Stricter rules apply at once. |
| **Emergency** | Your guardian co-signs a withdrawal you requested and it runs now. The guardian can never start one or choose where it goes. |

There is no receipt token, so there is nothing to sell to get around the delay. Importing your key into another wallet changes nothing: the program enforces the rules.

### Presets

| Preset | Withdrawal delay | Rule delay | Guardian |
| --- | --- | --- | --- |
| Gentle | 24 h | 3 days | optional |
| Strong | 72 h | 7 days | notified of every request |
| Locked | nothing leaves before your date | 7 days | required for an emergency exit |

## Layout

```
crates/vault-core        every rule, in plain Rust with no Solana dependency, fully unit-tested
programs/cooldown-vault  the Ecrin vault program (Anchor): stores the vault in a PDA, calls vault-core, moves lamports
docs/spec.md             the product spec
app/                     the demo web app (static, deploys to Cloudflare Pages)
```

## Site

| Path | What it is |
| --- | --- |
| `/` | Landing page |
| `/app` | The real app: connects Phantom, Solflare or Backpack and uses the program on Solana devnet |
| `/demo` | The same rules with pretend money and a fast-forward clock, no wallet needed |

## Try the demo

Live demo: **https://solana-vault.lecrabe5000.workers.dev** (or run `npx serve app`). Pick a preset, request a withdrawal, cancel it, fast-forward the clock, and switch to the guardian view.

## Develop

```bash
cargo test -p vault-core            # the rules, runs anywhere
node app/vault.test.mjs             # the same rules, as used by the demo
anchor test                         # on-chain tests on a local validator
node tests/client.test.mjs          # the browser client against a running local validator
cd programs/cooldown-vault && cargo check   # type-checks the program on your machine
anchor build && anchor deploy       # needs the Solana + Anchor toolchains, devnet only
```

## Deploy to devnet

1. In Phantom, make two **new** accounts for devnet only (one to pay and own upgrades, one to be the program's address). Export each private key (Settings → the account → Show private key).
2. On GitHub: Settings → Secrets and variables → Actions → New repository secret:
   - `DEVNET_DEPLOYER_KEY`: the first account's private key
   - `DEVNET_PROGRAM_KEY`: the second account's private key
3. Get about 4 devnet SOL for the first account at https://faucet.solana.com.
4. Actions → **deploy-devnet** → Run workflow. It builds, deploys (or upgrades), checks the program from the browser client, and commits its address to `app/config.js`, so the site switches to it.

Never reuse these accounts for real money. Never put a mainnet key in GitHub.

## Ethereum (Sepolia)

`evm/contracts/EcrinVault.sol` is the same vault for Ethereum: one contract, one vault per owner, ETH only, the same rules and limits. `evm/test/` mirrors the Solana rule tests and also runs the browser client (`app/evm.js`) against the contract.

```sh
cd evm && npm ci && npx hardhat test
```

To deploy:

1. In MetaMask, make a **new** account for testnets only. Turn on Settings → Advanced → Show test networks, pick Sepolia.
2. Get Sepolia ETH for it (0.05 is plenty) at https://cloud.google.com/application/web3/faucet/ethereum/sepolia.
3. Export its private key (account menu → Account details → Show private key) and add it as the repository secret `SEPOLIA_DEPLOYER_KEY`. Optional: `SEPOLIA_RPC_URL`.
4. Actions → **deploy-sepolia** → Run workflow. It tests, deploys, and commits the address to `app/config-evm.js`; the app's Ethereum tab switches to it.

## Status

Early prototype. SOL only. **Not audited: do not put real funds in it.** Mainnet only after an independent security audit, with deposit caps at first and the upgrade authority removed afterwards.

## Roadmap

1. Devnet program + integration tests (`anchor test`)
2. Web app: connect wallet, pick a preset, deposit, countdown with cancel, guardian invite
3. USDC and other SPL tokens
4. Test with 10 to 20 people in recovery and their families
5. Audit, then mainnet with caps

If gambling is hurting you right now, talking to someone helps. Search for your country's gambling helpline; most are free and confidential.
