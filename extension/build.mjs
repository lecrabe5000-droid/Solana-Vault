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
