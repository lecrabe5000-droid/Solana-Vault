# Chrome Web Store listing: Ecrin Wallet

Everything to paste into the Chrome Web Store developer dashboard, field by field.

**Package to upload:** `ecrin-wallet-beta.zip` (https://ecrinprotocol.app/downloads/ecrin-wallet-beta.zip, or `app/downloads/` in the repo).

---

## Store listing tab

**Name** (taken from the package): Ecrin Wallet

**Summary** (taken from the package, 132 characters max):
A wallet for spending, a safe nobody can rush. Solana and Ethereum. Testnet beta.

**Description:**

Ecrin Wallet gives you two accounts in one: a Wallet and a Safe.

WALLET: your everyday account. Send and receive coins instantly, like any wallet.

SAFE: your Ecrin vault. Anything leaving it waits a delay you choose (24 hours or 3 days), and you can cancel it the whole time. A wallet drainer, a phishing signature, someone who stole your recovery phrase, or your own 3 a.m. impulse: they all hit the same wall, which is time.

• One recovery phrase for Solana and Ethereum-compatible networks, with the same addresses other popular wallets give you.
• Move money between your Wallet and your Safe in one tap.
• Send with a clear review of exactly what leaves, a warning before sending to a new address, and press-and-hold to confirm.
• Before you approve anything a website asks, Ecrin shows exactly what would leave your wallet and flags risky requests in red.
• Phishing protection: known scam sites are blocked before they can ask for anything.
• A token page with a live chart for every coin, an address book, and light or dark mode.
• Your recovery phrase is encrypted on your computer and never leaves it. No account, no tracking, no ads.

TESTNET BETA: Ecrin Wallet currently runs on test networks with test coins only. It has not been audited yet. Don't use real funds.

Website: https://ecrinprotocol.app

**Category:** Tools (or "Productivity" if Tools isn't offered)

**Language:** English

**Store icon:** 128×128, already in the package (`icons/128.png`). The dashboard may ask for it again: use `extension/icons/128.png`.

**Screenshots (1280×800, in this order):**
1. `screenshot-1-home.png`
2. `screenshot-2-safe.png`
3. `screenshot-3-send.png`
4. `screenshot-4-review.png`
5. `screenshot-5-addresses.png`

**Small promo tile (440×280):** `promo-small-440x280.png`

**Marquee promo tile (1400×560, optional):** `promo-marquee-1400x560.png`

**Official URL / homepage:** https://ecrinprotocol.app

**Support URL:** https://github.com/lecrabe5000-droid/Solana-Vault/issues

---

## Privacy practices tab

**Single purpose:**
Ecrin Wallet is a self-custody cryptocurrency wallet. It holds the user's keys on their computer and lets them send and receive coins and move them in and out of their own Ecrin Safe, a vault that delays withdrawals.

**Permission justifications:**
- **storage**: stores the user's encrypted recovery phrase and their settings (network, theme, auto-lock time, number style) on their own computer, and keeps the unlocked wallet in memory until auto-lock.
- **alarms**: locks the wallet automatically after the idle time the user chose.
- **clipboardWrite**: copies the user's own wallet address when they press Copy.
- **unlimitedStorage**: keeps the public phishing blocklists (several MB) on the user's computer so scam sites are checked locally, without sending browsing data anywhere.
- **Content scripts on all http/https pages**: lets websites find the wallet (Solana Wallet Standard and the Ethereum provider) and shows a full-page warning on known phishing sites. The script carries requests to the extension; it doesn't read page content or record browsing.
- **Host permissions** (api.devnet.solana.com, *.publicnode.com, api.coingecko.com, api.binance.com, api.exchange.coinbase.com, raw.githubusercontent.com): read balances and send the user's transactions through public blockchain servers, and fetch coin prices for the balance and chart (CoinGecko, with Binance and Coinbase as backups), and download the public phishing blocklists from GitHub.

**Remote code:** No, I am not using remote code. (All code is in the package. The wallet only exchanges data with blockchain servers.)

**Data usage:** tick nothing. The extension collects no user data, and nothing is sent to the developer.

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

"Ecrin Wallet is a self-custody wallet that runs on public test networks only (Solana Devnet, Ethereum Sepolia and other testnets), with test coins. To try it: Create a new wallet, then use Receive to get the address and fund it from https://faucet.solana.com. The 'Safe' is a smart contract vault (source at github.com/lecrabe5000-droid/Solana-Vault) that delays withdrawals so they can be cancelled."
