# Cooldown Vault

A Solana vault that makes every way out of your savings slower than a gambling urge.

Crypto puts a casino one tap away. DNS blockers are switched off in a minute, staking unstakes in hours, and liquid staking tokens sell instantly. Cooldown Vault moves the protection on-chain, where no app, wallet or setting can skip it.

## How it works

| Way out | What happens |
| --- | --- |
| Send to a **trusted address** (your bank off-ramp, your rent) | Arrives now. Adding a trusted address waits for the rule delay, or needs the guardian. |
| **Any other withdrawal** | Waits 24 to 72 h. You can cancel any time; the guardian is notified. |
| **Loosening a rule** (shorter delay, removing the guardian) | Waits 3 to 7 days. Stricter rules apply at once. |
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
programs/cooldown-vault  the Anchor program: stores the vault in a PDA, calls vault-core, moves lamports
docs/spec.md             the product spec
app/                     the demo web app (static, deploys to Cloudflare Pages)
```

## Try the demo

Open the Cloudflare Pages link (or `npx serve app`). Pick a preset, request a withdrawal, cancel it, fast-forward the clock, and switch to the guardian view.

## Develop

```bash
cargo test -p vault-core            # the rules, runs anywhere
node app/vault.test.mjs             # the same rules, as used by the demo
cd programs/cooldown-vault && cargo check   # type-checks the program on your machine
anchor build && anchor deploy       # needs the Solana + Anchor toolchains, devnet only
```

## Status

Early prototype. SOL only. **Not audited: do not put real funds in it.** Mainnet only after an independent security audit, with deposit caps at first and the upgrade authority removed afterwards.

## Roadmap

1. Devnet program + integration tests (`anchor test`)
2. Web app: connect wallet, pick a preset, deposit, countdown with cancel, guardian invite
3. USDC and other SPL tokens
4. Test with 10 to 20 people in recovery and their families
5. Audit, then mainnet with caps

If gambling is hurting you right now, talking to someone helps. Search for your country's gambling helpline; most are free and confidential.
