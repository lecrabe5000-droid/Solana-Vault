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
  define: { global: "globalThis", "process.env.NODE_ENV": '"production"' },
  inject: ["src/shims.js"], legalComments: "linked", logLevel: "warning",
};
if (process.argv.includes("--watch")) { const c = await context(opts); await c.watch(); console.log("watching…"); }
else { await build(opts); console.log("built", fs.readdirSync(out).join(" ")); }

// A zip of dist/ for testers, served by the website.
if (!process.argv.includes("--watch")) {
  const { execSync } = await import("node:child_process");
  fs.mkdirSync("../app/downloads", { recursive: true });
  fs.rmSync("../app/downloads/ecrin-wallet-beta.zip", { force: true });
  execSync("cd dist && zip -qr ../../app/downloads/ecrin-wallet-beta.zip .");
  console.log("zip → app/downloads/ecrin-wallet-beta.zip");
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
