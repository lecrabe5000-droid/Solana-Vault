# Security review 2: Ecrin Wallet (extension and phone app)

Date: 2 November 2026. Scope: the browser extension (`extension/src`) and the phone web app (`app/wallet`, built from the same code with `web-shim.js`). The Safe programs and contracts were covered in audit 1.

## What was checked and found sound

- Approval windows: every value a site sends is escaped before it is shown; the site name comes from Chrome (`sender.url`), never from the page.
- Only the wallet's own pages can unlock, read the session or sign without an approval window.
- `eth_sign` of raw hashes is refused; `personal_sign` is prefixed as the standard requires.
- Sign-in requests (SIWE) whose domain doesn't match the site are flagged and need a tick.
- Content Security Policy blocks outside scripts in the extension and the phone app.
- The recovery phrase is stored only encrypted (password, or Face ID passkey on the phone); the unlocked key lives in memory or session storage, never in the page.

## Fixed in this review

| # | Issue | Fix |
|---|-------|-----|
| A | A site could open approval windows in a loop and bury the screen (and push people into clicking through). | One open request per site; others are refused until it is answered. |
| B | No size limits on what sites send, so a page could freeze the approval window with huge data. | Solana: at most 8 transactions of 1232 bytes each; messages at most 4096 bytes. Ethereum: requests at most 32 KB. |
| C | A Solana "sign message" request could carry the bytes of a real transaction (a known drainer trick). | Messages that read as a Solana transaction are refused, with a clear warning. |
| D | The phone app accepted developer settings (custom network address) from storage on the live site. | Developer settings only work on localhost. |
| E | A phishing page could delete Ecrin's warning cover with its own script. | The warning puts itself back until the person chooses to continue. |

All five were tested: the full dApp flow (connect, sign, send 1.5 SOL, Ethereum connect/sign, rejections, phishing cover, look-alike), plus a disguised transaction (refused), a second request while one is open (refused), and a page removing the warning (it came back). Phone tests (Face ID, address book, update banner, Safe) pass.

## Remaining risks

- The phone app keeps the encrypted phrase in the browser storage of ecrinprotocol.app. A script injected into that site could copy the encrypted box (it would still need the password). The site's CSP and the absence of third-party scripts keep this small.
- Ethereum previews decode the request (transfers, approvals, permits) but don't simulate it, so an unusual contract call shows less detail than a Solana one.
- USDC Safe rules are not managed from the wallet yet (SOL/ETH only).
- Telegram and email alerts could not be tested from the build machine.
- A downloaded (sideloaded) extension doesn't update itself; it relies on the in-wallet update alert.
- Website connections are not available in the phone app.
