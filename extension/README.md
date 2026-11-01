# Ecrin Wallet (browser extension)

A chequing account for trading, a savings vault nobody can rush. Solana and Ethereum-style networks. **Testnet beta, not audited.**

- **Chequing** is the wallet: it sends at once, like any wallet.
- **Savings** is the Ecrin vault: anything leaving waits its delay and can be cancelled the whole time, even by someone holding your recovery phrase.

## Install (developer mode)

1. Download https://ecrinprotocol.app/downloads/ecrin-wallet-beta.zip and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, pick the unzipped folder.
3. Pin Ecrin Wallet from the puzzle-piece menu.

## Build

    npm install
    npm run build      # → dist/ (what Chrome loads), and the zip for the website
    npm test           # key derivation and encryption

## Security model (short)

- One BIP-39 phrase. Solana keys use SLIP-0010 `m/44'/501'/0'/0'`, Ethereum keys use `m/44'/60'/0'/0/0`, the same paths as Phantom and MetaMask.
- On disk, the phrase is only stored encrypted: PBKDF2-SHA256 with 600,000 rounds, then AES-256-GCM.
- While unlocked, the phrase lives in `chrome.storage.session`, which is held in memory only and readable only by the extension's own pages. Auto-lock wipes it.
- Sending requires a press-and-hold, and the review screen shows exactly what leaves. You're warned the first time you send to an address.
- Not yet built: connecting to websites, a phishing blocklist, and transaction simulation for other sites' requests (next milestone).
