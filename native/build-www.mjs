// Copies the phone wallet (built by ../extension) into www/, with the same paths it has on the website, so the
// native app runs the exact same wallet, from inside the app (nothing is loaded from the website at run time).
import fs from "node:fs";
const A = "../app", W = "www";
fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(W, { recursive: true });
fs.cpSync(`${A}/wallet`, `${W}/wallet`, { recursive: true });
fs.cpSync(`${A}/fonts`, `${W}/fonts`, { recursive: true });
for (const f of ["icon2-180.png", "icon2-192.png", "icon2-512.png"]) if (fs.existsSync(`${A}/${f}`)) fs.copyFileSync(`${A}/${f}`, `${W}/${f}`);
// The website's service worker isn't needed inside the app.
fs.writeFileSync(`${W}/wallet/sw-reg.js`, "/* native app: no service worker */\n");
// Native: the app owns the whole screen, so use the see-through status bar layout (content behind the clock).
let html = fs.readFileSync(`${W}/wallet/index.html`, "utf8").replace('<meta name="apple-mobile-web-app-status-bar-style" content="black" />', '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />');
fs.writeFileSync(`${W}/wallet/index.html`, html);
fs.writeFileSync(`${W}/index.html`, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/wallet/"><title>Ecrin Wallet</title><style>html{background:#0c0d0f}</style>`);
console.log("www/ ready");
