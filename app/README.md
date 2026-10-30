# Web app (demo)

A static demo with no build step: `index.html`, `app.js`, `style.css` and `vault.js`.

- `vault.js` is a line-for-line port of `crates/vault-core`. `node app/vault.test.mjs` runs the same scenarios as the Rust tests.
- Pretend money, a pretend guardian (Alex) and a demo clock you can fast-forward. State is kept in the browser's localStorage.
- Nothing touches a blockchain yet. The next step swaps the demo vault for the devnet program, with Phantom.

Run locally: `npx serve app` (or any static server), then open the printed address.

Deploy on Cloudflare Pages: framework preset **None**, build command empty, build output directory **app**.
