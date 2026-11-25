// Renders the Ecrin Safe (tools/safe3d/scene.js) into image frames for the landing page:
//   app/preview/safe/spin-00..47.webp  a full turn, for drag-to-spin
//   app/preview/safe/open-00..23.webp  the door opening, front view, for scroll
// Run: node tools/safe3d/render.cjs   (bundles the scene with esbuild, renders in headless Chromium)
const { chromium } = require('playwright');
const esbuild = require('esbuild');
const fs = require('fs'), path = require('path');
const sharp = (() => { try { return require('sharp'); } catch (_) { return null; } })();
const root = path.join(__dirname, '..', '..'), out = path.join(root, 'app/preview/safe'), tmp = path.join(__dirname, '.build');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(tmp, { recursive: true });
(async () => {
  await esbuild.build({ entryPoints: [path.join(__dirname, 'scene.js')], bundle: true, format: 'esm', outfile: path.join(tmp, 'scene.js'), absWorkingDir: path.join(root, 'extension'), nodePaths: [path.join(root, 'extension/node_modules')], logLevel: 'warning' });
  // inlined: browsers won't load module files from file:// pages
  const code = fs.readFileSync(path.join(tmp, 'scene.js'), 'utf8').replace(/<\/script/g, '<\\/script');
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><html><body style="margin:0;background:transparent"><script type="module">' + code + '</script></body></html>');
  const S = Number(process.env.S || 1000);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: S, height: S } });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto('file://' + path.join(tmp, 'index.html') + '?s=' + S); await p.waitForFunction(() => window.ecrinReady, null, { timeout: 60000 });
  const save = async (name, spin, open) => {
    const url = await p.evaluate(([s, o]) => window.ecrinSafe.frame(s, o), [spin, open]);
    fs.writeFileSync(path.join(tmp, name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
  };
  if (process.env.OBJS) {
    for (const [n, rx, ry] of [['gem', 0.35, 0.5], ['coin', -0.35, 0.55], ['dial', 0.4, -0.6]]) { const url = await p.evaluate(([n, a, b]) => window.ecrinObj(n, a, b), [n, rx, ry]); fs.writeFileSync(path.join(tmp, 'obj-' + n + '.png'), Buffer.from(url.split(',')[1], 'base64')); }
    console.log('objects rendered'); await b.close(); return;
  }
  const ONLY = process.env.ONLY;
  if (ONLY) { await save('test', Number(process.env.SPIN || 0.06), Number(process.env.OPEN || 0)); console.log('test frame saved'); await b.close(); return; }
  for (let i = 0; i < 60; i++) await save(`spin-${String(i).padStart(2, '0')}`, i / 60, 0);
  for (let i = 0; i < 30; i++) await save(`open-${String(i).padStart(2, '0')}`, 0.04, i / 29);
  await b.close();
  console.log('rendered');
})();
