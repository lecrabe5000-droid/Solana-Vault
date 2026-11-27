// Renders the preview landing's scroll film (tools/seat3d/scene.js) into transparent WebP frames:
//   app/preview/seat/hi/f-000.webp …  (1080 px, desktop)
//   app/preview/seat/lo/f-000.webp …  (540 px, phones and the first load)
// Run from extension/:  NODE_PATH=$PWD/node_modules:/opt/node-tools/node_modules node ../tools/seat3d/render.cjs
//   TEST="0,0.3,0.6,0.9"  renders just those moments as PNGs into tools/seat3d/.build, to look at.
const { chromium } = require('playwright');
const esbuild = require('esbuild');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..', '..'), tmp = path.join(__dirname, '.build'), N = Number(process.env.N || 150), S = Number(process.env.S || 1080);
fs.mkdirSync(tmp, { recursive: true });
(async () => {
  await esbuild.build({ entryPoints: [path.join(__dirname, 'scene.js')], bundle: true, format: 'esm', outfile: path.join(tmp, 'scene.js'), absWorkingDir: path.join(root, 'extension'), nodePaths: [path.join(root, 'extension/node_modules')], logLevel: 'warning' });
  const code = fs.readFileSync(path.join(tmp, 'scene.js'), 'utf8').replace(/<\/script/g, '<\\/script');
  const font = 'data:font/woff2;base64,' + fs.readFileSync(path.join(root, 'app/fonts/inter-tight-latin-800-normal.woff2')).toString('base64');
  const logos = fs.readFileSync(path.join(root, 'app/preview/logos.json'), 'utf8').replace(/<\/script/g, '<\\/script');
  fs.writeFileSync(path.join(tmp, 'index.html'), `<!doctype html><html><body style="margin:0;background:transparent"><script>window.SEAT_FONT=${JSON.stringify(font)};window.SEAT_LOGOS=${logos};</script><script type="module">` + code + '</script></body></html>');
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: S, height: S } });
  p.on('pageerror', (e) => console.log('pageerror', e.message)); p.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
  await p.goto('file://' + path.join(tmp, 'index.html') + `?s=${S}`); await p.waitForFunction(() => window.seatReady, null, { timeout: 90000 });
  const shot = async (t, file) => { const url = await p.evaluate((x) => window.seat.frame(x), t); fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64')); };
  if (process.env.TEST) {
    for (const t of process.env.TEST.split(',').map(Number)) await shot(t, path.join(tmp, `test-${t}.png`));
    console.log('test frames in', tmp); await b.close(); return;
  }
  const pngs = path.join(tmp, 'png'); fs.rmSync(pngs, { recursive: true, force: true }); fs.mkdirSync(pngs);
  const t0 = Date.now();
  for (let i = 0; i < N; i++) { await shot(i / (N - 1), path.join(pngs, `f-${String(i).padStart(3, '0')}.png`)); if (i % 25 === 0) console.log(`frame ${i}/${N} · ${Math.round((Date.now() - t0) / 1000)} s`); }
  await b.close();
  for (const [dir, size, q] of [['hi', S, 78], ['lo', Math.round(S / 2), 70]]) {
    const outDir = path.join(root, 'app/preview/seat', dir); fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(pngs, 'f-%03d.png'), '-vf', `scale=${size}:${size}`, '-c:v', 'libwebp', '-quality', String(q), '-pix_fmt', 'yuva420p', '-start_number', '0', path.join(outDir, 'f-%03d.webp')]);
  }
  const kb = (d) => Math.round(fs.readdirSync(d).reduce((s, f) => s + fs.statSync(path.join(d, f)).size, 0) / 1024);
  console.log(`rendered ${N} frames · hi ${kb(path.join(root, 'app/preview/seat/hi'))} KB · lo ${kb(path.join(root, 'app/preview/seat/lo'))} KB`);
})();
