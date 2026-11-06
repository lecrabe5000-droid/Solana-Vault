// Builds the extension into dist/ (load it in chrome://extensions → Load unpacked → extension/dist).
import { build, context } from "esbuild";
import fs from "node:fs";

const out = "dist";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ["manifest.json", "popup.html", "popup.css"]) fs.copyFileSync(f, `${out}/${f}`);
for (const d of ["icons", "fonts"]) fs.cpSync(d, `${out}/${d}`, { recursive: true });

const opts = {
  entryPoints: { popup: "src/popup.js", bg: "src/bg.js" },
  bundle: true, format: "esm", outdir: out, minify: true, target: "chrome116", platform: "browser",
  define: { global: "globalThis", "process.env.NODE_ENV": '"production"', __ECRIN_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync("manifest.json", "utf8")).version) },
  inject: ["src/shims.js"], legalComments: "linked", logLevel: "warning",
};
if (process.argv.includes("--watch")) { const c = await context(opts); await c.watch(); console.log("watching…"); }
else {
  await build(opts);
  // The page scripts: plain IIFEs (content scripts can't be modules), no shims, tiny.
  // The website's motion layer (logos, 3D Safe), from the same code as the wallet.
  await build({ entryPoints: { "site-fx": "src/site-fx.js" }, bundle: true, format: "iife", outdir: "../app", minify: true, target: "es2020", legalComments: "none", logLevel: "warning" });
  await build({ entryPoints: { inpage: "src/inpage.js", content: "src/content.js" }, bundle: true, format: "iife", outdir: out, minify: true, target: "chrome116", legalComments: "none", logLevel: "warning" });
  console.log("built", fs.readdirSync(out).join(" "));
}

// A zip of dist/ for testers, served by the website.
if (!process.argv.includes("--watch")) {
  const { execSync } = await import("node:child_process");
  fs.mkdirSync("../app/downloads", { recursive: true });
  fs.rmSync("../app/downloads/ecrin-wallet-beta.zip", { force: true });
  execSync("cd dist && zip -qr ../../app/downloads/ecrin-wallet-beta.zip .");
  console.log("zip → app/downloads/ecrin-wallet-beta.zip");
}

// Ecrin Wallet for phones: the same popup, real networks, served at ecrinprotocol.app/wallet/ (add to home screen).
if (!process.argv.includes("--watch")) {
  const D = "../app/wallet";
  fs.mkdirSync(D, { recursive: true });
  await build({ ...opts, entryPoints: { wallet: "src/popup.js" }, outdir: D, inject: ["src/web-shim.js", "src/shims.js"] });
  let css = fs.readFileSync("popup.css", "utf8").replace(/url\("fonts\//g, 'url("/fonts/');
  css = css.replace("html, body { width: 360px; height: 600px; overflow: hidden; }", "html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: var(--bg); } .device { position: relative; width: 100%; max-width: 480px; height: 100dvh; margin: 0 auto; overflow: hidden; transform: translateZ(0); background: var(--bg); color: var(--ink); font: 500 14px/1.45 var(--font); padding-top: env(safe-area-inset-top); box-sizing: border-box; }");
  // Phone-only: keep clear of the clock, the notch/Dynamic Island and the home bar; no zoom on text fields; no
  // grey tap flashes or rubber-band edges.
  css += `
.device { padding: 0 !important; position: fixed !important; inset: 0; height: auto !important; max-width: none !important; }
/* Full screen, edge to edge: the app paints behind the clock and the home bar; only the content keeps clear of them. */
#root, #panel { top: 0; bottom: 0; }
.home .top, .phead { padding-top: env(safe-area-inset-top, 0px) !important; height: calc(56px + env(safe-area-inset-top, 0px)) !important; box-sizing: border-box; }
.lock, .onb, .flow, .splash, .bio-scr, .cv { padding-top: env(safe-area-inset-top, 0px); }
#tabbar { bottom: max(6px, calc(env(safe-area-inset-bottom, 0px) - 8px)) !important; }
.home, #panel .pane, .lock, .onb, .flow { padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)) !important; }
.pfoot { padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px)); }
.toast { bottom: calc(16px + env(safe-area-inset-bottom, 0px)) !important; }
html, body, #root, #panel .pane { overscroll-behavior: none; }
* { -webkit-tap-highlight-color: transparent; }
button, .btn, .srow, .arow, .acard { -webkit-user-select: none; user-select: none; touch-action: manipulation; }
input, textarea, select { font-size: max(16px, 1em); }
/* Always portrait: turned sideways, the app asks to be held upright instead of reflowing. */
.rotate-note { display: none; }
@media (orientation: landscape) and (max-height: 520px) {
  .device > * { visibility: hidden; }
  .rotate-note { display: grid; visibility: visible !important; position: fixed; inset: 0; z-index: 999; place-content: center; justify-items: center; gap: 12px; background: var(--bg); color: var(--muted); font: 500 14px var(--font); }
  .rotate-note svg { width: 34px; height: 34px; fill: none; stroke: var(--eb); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
}
.fld input, .fld textarea, [data-to] { font-size: 16px !important; }
`;
  fs.writeFileSync(`${D}/wallet.css`, css);
  console.log("phone wallet → app/wallet/");
}

// The web demo: the same popup, with chrome.* stood in for and pretend money instead of a blockchain.
// Served at ecrinprotocol.app/wallet-demo/.
if (!process.argv.includes("--watch")) {
  const D = "../app/wallet-demo";
  fs.mkdirSync(D, { recursive: true });
  const demoChains = { name: "demo-chains", setup(b) { b.onResolve({ filter: /^\.\/chains\.js$/ }, (a) => (a.importer.endsWith("popup.js") ? { path: new URL("./src/demo-chains.js", import.meta.url).pathname } : undefined)); } };
  await build({ ...opts, entryPoints: { demo: "src/popup.js" }, outdir: D, inject: ["src/demo-shim.js", "src/shims.js"], plugins: [demoChains] });
  // The popup's stylesheet, scoped to a 360 × 600 device on the page, fonts from the site.
  let css = fs.readFileSync("popup.css", "utf8").replace(/url\("fonts\//g, 'url("/fonts/');
  css = css.replace("html, body { width: 360px; height: 600px; overflow: hidden; }", ".device { position: relative; width: 360px; height: 600px; overflow: hidden; transform: translateZ(0); border-radius: 30px; background: var(--bg); color: var(--ink); font: 500 14px/1.45 var(--font); }");
  fs.writeFileSync(`${D}/wallet.css`, css);
  console.log("demo → app/wallet-demo/");
}
