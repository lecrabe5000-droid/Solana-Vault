# Chrome Web Store listing: Ecrin Wallet

Everything to paste into the Chrome Web Store developer dashboard, field by field.

**Package to upload:** `ecrin-wallet-beta.zip` (https://ecrinprotocol.app/downloads/ecrin-wallet-beta.zip, or `app/downloads/` in the repo).

---

## Store listing tab

**Name** (taken from the package): Ecrin Wallet

**Summary** (taken from the package, 132 characters max):
The wallet with an undo button: withdrawals from your Safe wait, and you can cancel them. Solana, Ethereum, Sui and more.

**Description:**

Crypto has no undo button. Ecrin adds one.

Ecrin Wallet gives you two places for your money: a Wallet for everyday spending, and a Safe for everything else. Anything leaving your Safe waits a delay you choose, and you can cancel it the whole time.

A stolen recovery phrase, a wallet drainer, a phishing signature or your own 3 a.m. impulse: they all hit the same wall, which is time.

HOW THE SAFE WORKS
• Protect: move money from your Wallet into your Safe in one tap.
• Withdraw: every withdrawal waits the delay you chose (24 hours, 3 days or longer), with a live countdown.
• Cancel: not you, or changed your mind? Cancel it from the home screen. The money stays in your Safe.
• Alerts: get a Telegram or email alert the moment a withdrawal is requested, and a notification when coins arrive in your Wallet.
• Rules: a daily limit, a time lock, trusted addresses and an optional guardian. Changes that loosen your protection wait too, so a thief can't switch them off.
• The Safe is a smart contract on the blockchain, not a company account. Nobody, including Ecrin, can move your money or skip the delay.

PROTECTION BEFORE YOU SIGN
• Look-alike addresses caught: scammers copy the start and end of an address you use. Ecrin checks every character and warns you.
• Known scam sites blocked before they can ask for anything.
• A clear review of exactly what leaves before you approve a website's request, with risky requests flagged in red.
• See and revoke the permissions sites have over your tokens.
• Press and hold to confirm every send.

A COMPLETE WALLET
• One recovery phrase for Solana, Ethereum, Base, Arbitrum, Optimism, Polygon, Sui and Tron.
• Send, receive and swap, with the dollar value next to every amount.
• Several accounts, private key import, an address book and price alerts.
• Every token you hold, with scam airdrops hidden, and a collectibles gallery.
• Full activity history, a live chart for every coin, light and dark mode, English and French.

PRIVATE BY DESIGN
Your recovery phrase is encrypted on your computer and never leaves it. No account, no tracking, no ads. The code is open source.

BETA
The Safe runs on test networks while an independent security audit is prepared: try it free with test coins. The wallet also works on mainnet with real money (Settings → Networks); the Safe comes to mainnet only after the audit.

Website: https://ecrinprotocol.app
Roadmap: https://ecrinprotocol.app/roadmap/
Help: https://ecrinprotocol.app/support/

**Category:** Tools (or "Productivity" if Tools isn't offered)

**Language:** English

**Store icon:** 128×128, already in the package (`icons/128.png`). The dashboard may ask for it again: use `extension/icons/128.png`.

**Screenshots (1280×800, in this order):**
1. `screenshot-1-home.png`: Crypto has no undo button. Ecrin adds one. (home, with a withdrawal leaving and its Cancel button)
2. `screenshot-2-safe.png`: Every withdrawal waits. (the Safe with a live countdown)
3. `screenshot-3-cancel.png`: Cancel it. It stays in your Safe. (the cancelled sheet)
4. `screenshot-4-lookalike.png`: Look-alike addresses, caught. (the warning before a send)
5. `screenshot-5-alerts.png`: Know the moment money moves. (rules and alerts)

**Small promo tile (440×280):** `promo-small-440x280.png`

**Marquee promo tile (1400×560, optional):** `promo-marquee-1400x560.png`

**Official URL / homepage:** https://ecrinprotocol.app

**Support URL:** https://ecrinprotocol.app/support/

---

## Privacy practices tab

**Single purpose:**
Ecrin Wallet is a self-custody cryptocurrency wallet. It holds the user's keys on their computer and lets them send, receive and swap coins, and move them in and out of their own Ecrin Safe, a smart contract vault that delays withdrawals so the user can cancel them.

**Permission justifications:**
- **storage**: stores the user's encrypted recovery phrase and their settings (network, theme, auto-lock time, number style) on their own computer, and keeps the unlocked wallet in memory until auto-lock.
- **alarms**: locks the wallet automatically after the idle time the user chose.
- **clipboardWrite**: copies the user's own wallet address when they press Copy.
- **notifications**: tells the user when coins arrive in their wallet (they can turn this off).
- **unlimitedStorage**: keeps the public phishing blocklists (several MB) on the user's computer so scam sites are checked locally, without sending browsing data anywhere.
- **Content scripts on all http/https pages**: lets websites find the wallet (Solana Wallet Standard and the Ethereum provider) and shows a full-page warning on known phishing sites. The script carries requests to the extension; it doesn't read page content or record browsing.
- **Host permissions**: blockchain servers to read balances and send the user's own transactions (api.devnet.solana.com and api.mainnet-beta.solana.com for Solana, *.publicnode.com for Ethereum-style networks, nile.trongrid.io for Tron, graphql.testnet.sui.io for Sui); coin prices (api.coingecko.com, with api.binance.com and api.exchange.coinbase.com as backups); the public phishing blocklists (raw.githubusercontent.com); and ecrinprotocol.app, the developer's own server, for prices, token search, swap quotes, test coins, and the alerts and problem reports the user chooses to turn on or send.

**Remote code:** No, I am not using remote code. (All code is in the package. The wallet only exchanges data with blockchain servers.)

**Data usage:** tick these three, and nothing else. Each is collected only when the user turns the feature on or sends it:
- **Personally identifiable information**: the email address a user enters for email alerts.
- **Financial and payment information**: the public wallet and Safe addresses a user turns alerts on for, so the server can watch them and warn the user.
- **Personal communications**: the message a user writes in "Report a problem".

Not collected: the recovery phrase and private keys (never leave the computer), browsing history, website content, location, health, authentication information.

Certify the three statements:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://ecrinprotocol.app/privacy/

---

## Distribution tab

**Visibility:** Unlisted. Only people with the link can install it. Switch to Public later.

**Regions:** All regions.

**Pricing:** Free.

---

## Notes for review

If the form has a field for reviewer notes, paste this:

"Ecrin Wallet is a self-custody wallet. It starts on public test networks (Solana Devnet, Ethereum Sepolia and other testnets) with test coins; a Mainnet mode exists in Settings → Networks, but the Safe is only on test networks. To try it: Create a new wallet, then use Receive to get the address and fund it from https://faucet.solana.com (or the wallet's own Get test coins button). Then tap Protect to move some into the Safe, Withdraw to start a withdrawal, and Cancel on the home screen to stop it. The 'Safe' is a smart contract vault (source at github.com/lecrabe5000-droid/Solana-Vault) that delays withdrawals so they can be cancelled."
