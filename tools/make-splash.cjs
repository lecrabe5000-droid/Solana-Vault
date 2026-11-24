// Launch images for the phone app, photographed from the app's own opening screen so the hand-off is seamless:
// the web launch images (one per iPhone size, from app/wallet/index.html) and the native app's square splash.
// Run with the site served locally:  (cd app && python3 -m http.server 8090) & node tools/make-splash.cjs
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/wallet/index.html'), 'utf8');
const sizes = [...html.matchAll(/href="\/wallet\/splash\/([^"]+)" media="\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d+)\)/g)]
  .map(([, file, w, h, dpr]) => ({ file: path.join(root, 'app/wallet/splash', file), w: +w, h: +h, dpr: +dpr }));
const native = path.join(root, 'native/ios/App/App/Assets.xcassets/Splash.imageset');
// The native splash is a square shown "aspect fill": its middle is the screen's middle, its height the screen's height.
for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) sizes.push({ file: path.join(native, f), w: 390, h: 844, dpr: 2732 / 844, square: true });
(async () => {
  const b = await chromium.launch();
  for (const s of sizes) {
    const ctx = await b.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.dpr, isMobile: true });
    await ctx.addInitScript(() => { globalThis.ECRIN_WEB = true; });
    const p = await ctx.newPage(); await p.route(/wallet\.js/, (r) => r.abort()); // the opening screen as it is before the app's code runs
    await p.goto('http://localhost:8090/wallet/'); await p.addStyleTag({ content: '.boot-mark, .boot-mark * { animation: none !important; }' }); await p.waitForTimeout(500);
    if (!s.square) await p.screenshot({ path: s.file });
    else { // the phone-width shot, centered on a square of the same dark (the sides are cropped off on the phone)
      const img = (await p.screenshot()).toString('base64');
      await p.setViewportSize({ width: s.h, height: s.h });
      await p.setContent(`<body style="margin:0;background:#0c0d0f;display:grid;place-items:center;height:100vh"><img style="width:${s.w}px;height:${s.h}px;display:block" src="data:image/png;base64,${img}"></body>`);
      await p.waitForTimeout(200); await p.screenshot({ path: s.file });
    }
    await ctx.close();
    console.log(path.relative(root, s.file));
  }
  await b.close();
})();
