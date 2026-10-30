const { chromium } = require('playwright');
const FONTS = 'file://' + require('path').join(__dirname, '..', 'app', 'fonts') + '/';
const guil = (cx, cy, n, step, stroke) => Array.from({ length: n }, (_, i) => `<circle cx="${cx + Math.cos(i / 2.2) * 14}" cy="${cy + Math.sin(i / 2.2) * 14}" r="${18 + i * step}" fill="none" stroke="${stroke}" stroke-width="1"/>`).join('');
const mark = (size, c) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32"><rect x="3" y="3" width="26" height="26" rx="8" fill="none" stroke="${c}" stroke-width="2.1"/><path d="M16 9.5l5.5 6.5L16 22.5 10.5 16z" fill="${c}"/></svg>`;
const ticks = (r1, r2, c) => Array.from({ length: 60 }, (_, i) => { const a = (i / 60) * 2 * Math.PI, rr = i % 5 ? r1 : r1 - 8, x = (r) => (200 + r * Math.sin(a)).toFixed(1), y = (r) => (200 - r * Math.cos(a)).toFixed(1); return `<line x1="${x(rr)}" y1="${y(rr)}" x2="${x(r2)}" y2="${y(r2)}" stroke="${c}" stroke-width="${i % 5 ? 1.2 : 2.2}" stroke-linecap="round"/>`; }).join('');
const head = `<style>@font-face{font-family:U;font-weight:500;src:url(${FONTS}unbounded-latin-500-normal.woff2)}@font-face{font-family:M;font-weight:500;src:url(${FONTS}manrope-latin-500-normal.woff2)}@font-face{font-family:M;font-weight:600;src:url(${FONTS}manrope-latin-600-normal.woff2)}*{margin:0;box-sizing:border-box}body{overflow:hidden}</style>`;
const OBS = 'radial-gradient(120% 95% at 82% 0%, #262a42 0%, #121318 55%, #0a0a0d 100%)';
const icon = (dark) => `<html><head>${head}</head><body style="width:1024px;height:1024px;background:${dark ? OBS : '#f6f6f3'};position:relative">
  <svg style="position:absolute;inset:0" width="1024" height="1024" viewBox="0 0 1024 1024">${guil(820, 180, 46, 22, dark ? 'rgba(160,175,255,.10)' : 'rgba(16,17,20,.06)')}</svg>
  <div style="position:absolute;inset:0;display:grid;place-items:center">${mark(500, dark ? '#7D97FF' : '#2F5BFF')}</div></body></html>`;
const banner = (dark) => `<html><head>${head}</head><body style="width:1500px;height:500px;background:${dark ? OBS : '#f6f6f3'};position:relative;color:${dark ? '#f3f3ef' : '#101114'};font-family:M">
  <svg style="position:absolute;inset:0" width="1500" height="500" viewBox="0 0 1500 500">${guil(1270, 120, 40, 20, dark ? 'rgba(160,175,255,.09)' : 'rgba(16,17,20,.06)')}</svg>
  <div style="position:absolute;left:120px;top:96px">
    <div style="display:flex;align-items:center;gap:22px">${mark(78, dark ? '#7D97FF' : '#2F5BFF')}<span style="font:500 76px/1 U;letter-spacing:-.04em">Ecrin</span></div>
    <div style="margin-top:34px;font:500 40px/1.15 U;letter-spacing:-.035em;max-width:760px">Crypto that can't be<br><span style="color:${dark ? '#7D97FF' : '#2F5BFF'}">taken in a hurry.</span></div>
    <div style="margin-top:22px;font:600 19px/1 M;letter-spacing:.14em;text-transform:uppercase;color:${dark ? '#8e93ad' : '#8b8d93'}">Solana · Ethereum · ecrinprotocol.app</div>
  </div>
  <div style="position:absolute;right:110px;top:50px;width:400px;height:400px">
    <svg width="400" height="400" viewBox="0 0 400 400">${ticks(186, 196, dark ? 'rgba(255,255,255,.28)' : 'rgba(16,17,20,.28)')}<circle cx="200" cy="200" r="168" fill="none" stroke="${dark ? 'rgba(255,255,255,.08)' : 'rgba(16,17,20,.08)'}" stroke-width="5"/><circle cx="200" cy="200" r="168" fill="none" stroke="${dark ? '#f0b04a' : '#b7700a'}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(2 * Math.PI * 168).toFixed(1)}" stroke-dashoffset="${(2 * Math.PI * 168 * 0.3).toFixed(1)}" transform="rotate(-90 200 200) scale(1 -1) translate(0 -400)"/></svg>
    <div style="position:absolute;inset:0;display:grid;place-content:center;text-align:center">
      <div style="font:500 64px/1 U;letter-spacing:-.04em">71:59</div>
      <div style="margin-top:10px;font:600 15px/1 M;letter-spacing:.16em;color:${dark ? '#8e93ad' : '#8b8d93'}">UNTIL IT CAN LEAVE</div>
    </div></div></body></html>`;
// X header that pairs with the profile picture: fine engraved rings ripple out from the avatar's spot
// (measured on X: centre about 215 x 500 of 1500 x 500), so the picture sits at their centre at any crop.
const xBanner = (dark) => {
  const cx = 215, cy = 500, ink = dark ? '#f3f3ef' : '#101114', mute = dark ? '#8e93ad' : '#8b8d93', acc = dark ? '#7D97FF' : '#2F5BFF';
  const rings = Array.from({ length: 80 }, (_, i) => { const r = 205 + i * 17, o = Math.max(0, (dark ? .1 : .075) * (1 - i / 95)); return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${dark ? `rgba(160,175,255,${o.toFixed(3)})` : `rgba(16,17,20,${o.toFixed(3)})`}" stroke-width="1"/>`; }).join('');
  return `<html><head>${head}</head><body style="width:1500px;height:500px;background:${dark ? OBS : '#f6f6f3'};position:relative;color:${ink};font-family:M">
    <svg style="position:absolute;inset:0" width="1500" height="500" viewBox="0 0 1500 500">${rings}</svg>
    <div style="position:absolute;right:110px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-end;text-align:right">
      <div style="font:500 60px/1.06 U;letter-spacing:-.045em">Crypto that can't be<br><span style="color:${acc}">taken in a hurry.</span></div>
      <div style="margin-top:26px;display:flex;gap:14px;align-items:center;font:600 17px/1 M;letter-spacing:.12em;text-transform:uppercase;color:${mute}"><span>On-chain vault</span><i style="width:4px;height:4px;border-radius:50%;background:${mute}"></i><span>Solana · Ethereum</span><i style="width:4px;height:4px;border-radius:50%;background:${mute}"></i><span style="color:${ink}">ecrinprotocol.app</span></div>
    </div></body></html>`;
};
// A preview of the header with the avatar where X puts it, to check the pairing.
const xPreview = (theme = 'dark') => `<html><head>${head}</head><body style="width:1500px;height:640px;background:#000;position:relative">
  <img src="ecrin-x-banner-${theme}.png" style="position:absolute;left:0;top:0;width:1500px;height:500px">
  <img src="ecrin-icon-${theme}.png" style="position:absolute;left:${215 - 175}px;top:${500 - 175}px;width:350px;height:350px;border-radius:50%;border:12px solid #000;box-sizing:border-box"></body></html>`;

(async () => {
  const b = await chromium.launch();
  for (const [name, html, w, h] of [['ecrin-icon-dark', icon(true), 1024, 1024], ['ecrin-icon-light', icon(false), 1024, 1024], ['ecrin-banner-dark', banner(true), 1500, 500], ['ecrin-banner-light', banner(false), 1500, 500], ['ecrin-x-banner-dark', xBanner(true), 1500, 500], ['ecrin-x-banner-light', xBanner(false), 1500, 500]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const tmp = require('os').tmpdir() + '/' + name + '.html'; require('fs').writeFileSync(tmp, html); await p.goto('file://' + tmp); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
    await p.screenshot({ path: `${__dirname}/${name}.png` }); await p.close();
  }
  const p = await b.newPage({ viewport: { width: 1500, height: 640 } });
  for (const th of ['dark', 'light']) {
    require('fs').writeFileSync(__dirname + '/_preview.html', xPreview(th)); await p.goto('file://' + __dirname + '/_preview.html'); await p.waitForTimeout(300);
    await p.screenshot({ path: require('os').tmpdir() + `/ecrin-x-preview-${th}.png` });
  }
  require('fs').unlinkSync(__dirname + '/_preview.html');
  await b.close();
})();
