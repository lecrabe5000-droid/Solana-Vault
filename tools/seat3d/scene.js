// "Self-custody, with a seatbelt": the scroll film for the preview landing, rendered offline into frames
// (tools/seat3d/render.cjs). Transparent background, so the page can change colour behind it section by section.
// The cast: the Ecrin mark as a solid glossy tile (a 3D app icon), real network coins, and a text band.
// window.seat.frame(t): t from 0 (top of the page) to 1 (end of the film). Returns a PNG data URL.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const Q = new URLSearchParams(location.search), S = Number(Q.get("s") || 1080);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(S, S); renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0; // keeps Ecrin blue blue (ACES drifts it to purple)
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.append(renderer.domElement);

// ---- a bright, soft studio (what the gloss reflects) ----
const studio = new THREE.Scene(); studio.background = new THREE.Color(0x0c0f1a);
const soft = (w, h, x, y, z, ry, rx, k, tint = [1, 1, 1]) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint[0] * k, tint[1] * k, tint[2] * k), side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); studio.add(m); };
{ const dome = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.24, 0.3), side: THREE.BackSide })); studio.add(dome); }
soft(14, 5, 0, 8, 1, 0, Math.PI / 2, 10);            // large top softbox
soft(2.4, 10, -8, 1, 3, Math.PI / 2, 0, 7);           // left strip: the long highlight on the tile's edge
soft(2.4, 10, 8, 1, 2, -Math.PI / 2, 0, 5, [0.75, 0.82, 1]);
soft(10, 4, 0, 1, 10, Math.PI, 0, 2.6);               // front fill
soft(8, 4, 0, 2, -9, 0, 0, 3, [0.45, 0.58, 1]);        // cool back light
const pmrem = new THREE.PMREMGenerator(renderer);
const scene = new THREE.Scene(); scene.environment = pmrem.fromScene(studio, 0.03).texture;

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(3, 8, 6); key.castShadow = true;
key.shadow.mapSize.set(4096, 4096); key.shadow.radius = 22; key.shadow.bias = -0.0005; Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 }); scene.add(key);
const rimL = new THREE.DirectionalLight(0xa9bbff, 1.1); rimL.position.set(-5, 2, -4); scene.add(rimL);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.1 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -2.05; floor.receiveShadow = true; scene.add(floor);

// ---- the tile: Ecrin blue, deep gloss, an ivory frame and a crystal diamond raised on its face ----
const blue = new THREE.MeshPhysicalMaterial({ color: 0x1f4bff, metalness: 0.15, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.75 });
const ivory = new THREE.MeshPhysicalMaterial({ color: 0xf4f1ea, metalness: 0.15, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.1 });
const crystal = new THREE.MeshPhysicalMaterial({ color: 0xe9eeff, metalness: 0.25, roughness: 0.04, flatShading: true, clearcoat: 1, iridescence: 0.7, iridescenceIOR: 1.45, envMapIntensity: 2.4 });
const tile = new THREE.Group(); scene.add(tile);
const TW = 2.3, TD = 0.56;
{
  const body = new THREE.Mesh(new RoundedBoxGeometry(TW, TW, TD, 12, 0.58), blue); body.castShadow = body.receiveShadow = true; tile.add(body);
  // the mark's frame: a rounded-square ring, raised from the face
  const rr = (s, r) => { const sh = new THREE.Shape(); sh.moveTo(-s + r, -s); sh.lineTo(s - r, -s); sh.quadraticCurveTo(s, -s, s, -s + r); sh.lineTo(s, s - r); sh.quadraticCurveTo(s, s, s - r, s); sh.lineTo(-s + r, s); sh.quadraticCurveTo(-s, s, -s, s - r); sh.lineTo(-s, -s + r); sh.quadraticCurveTo(-s, -s, -s + r, -s); return sh; };
  const ring = rr(0.68, 0.24); ring.holes.push(rr(0.56, 0.16));
  const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 6, curveSegments: 40 }), ivory);
  frame.position.z = TD / 2 - 0.005; frame.castShadow = true; tile.add(frame);
  const d = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), crystal); d.scale.set(0.82, 1.12, 0.42); d.position.z = TD / 2 + 0.07; d.castShadow = true; tile.add(d);
  tile.userData.diamond = d;
}

// ---- coins: real networks, steel rims, their logo on both faces ----
const coins = [];
const coinGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.085, 96, 1);
const rimGeo = new THREE.TorusGeometry(0.4, 0.028, 16, 96);
const steel = new THREE.MeshPhysicalMaterial({ color: 0xeef1f8, metalness: 1, roughness: 0.14 });
const frost = new THREE.MeshPhysicalMaterial({ color: 0xcfdcff, metalness: 0.1, roughness: 0.12, transparent: true, opacity: 0, clearcoat: 1, clearcoatRoughness: 0.05, flatShading: true, depthWrite: false, side: THREE.DoubleSide });
// the ice: a faceted hexagonal ring around the coin's edge (open, so it never covers the logo)
const frostGeo = new THREE.CylinderGeometry(0.47, 0.47, 0.13, 6, 1, true);
async function logoTexture(svg) {
  const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); await img.decode();
  const c = document.createElement("canvas"); c.width = c.height = 1024; const g = c.getContext("2d");
  g.beginPath(); g.arc(512, 512, 512, 0, Math.PI * 2); g.clip(); g.drawImage(img, 0, 0, 1024, 1024);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ---- the band: SELF-CUSTODY · WITH A SEATBELT, wrapped around the tile ----
let band;
async function makeBand() {
  // the font is inlined by render.cjs (pages opened from disk can't fetch files)
  const font = new FontFace("ITB", `url("${window.SEAT_FONT}")`, { weight: "800" });
  await font.load(); document.fonts.add(font);
  const c = document.createElement("canvas"); c.width = 8192; c.height = 400; const g = c.getContext("2d");
  g.fillStyle = "#f4f1ea"; g.textBaseline = "middle"; g.font = "800 250px serif"; const serifW = g.measureText("SELF-CUSTODY").width; g.font = '800 250px "ITB"';
  if (Math.abs(g.measureText("SELF-CUSTODY").width - serifW) < 1) throw new Error("band font not loaded");
  const phrase = "SELF-CUSTODY  ✦  WITH A SEATBELT  ✦  ";
  let x = 0; const w = g.measureText(phrase).width; while (x < c.width) { g.fillText(phrase, x, 204); x += w; }
  // the phrase repeats to fill; the band's circumference is tuned so it closes cleanly
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; t.wrapS = THREE.RepeatWrapping; t.repeat.x = (w * Math.floor(c.width / w)) / c.width >= 0.9 ? 1 : 1;
  const mat = new THREE.MeshStandardMaterial({ map: t, transparent: true, side: THREE.DoubleSide, roughness: 0.6, metalness: 0, emissive: 0xf4f1ea, emissiveMap: t, emissiveIntensity: 0.55, depthWrite: false });
  band = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.34, 200, 1, true), mat);
  band.renderOrder = 2; scene.add(band);
}

// ---- the night: a crescent moon (a glowing sprite) and faint stars ----
const moon = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 1024; const g = c.getContext("2d");
  const glow = g.createRadialGradient(512, 512, 120, 512, 512, 500); glow.addColorStop(0, "rgba(255,214,150,.55)"); glow.addColorStop(1, "rgba(255,190,110,0)");
  g.fillStyle = glow; g.fillRect(0, 0, 1024, 1024);
  // dither the glow: a soft gradient stored in 8 bits shows rings; a touch of noise makes it fade smoothly
  { const im = g.getImageData(0, 0, 1024, 1024), d = im.data; let sd = 7; const rn = () => ((sd = (sd * 16807) % 2147483647) / 2147483647 - 0.5) * 6;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { const n = rn(); d[i + 3] = Math.max(0, Math.min(255, d[i + 3] + n)); } g.putImageData(im, 0, 0); }
  // the crescent is cut on its own canvas, then laid over the glow (cutting it here would punch a hole in the glow)
  const m2 = document.createElement("canvas"); m2.width = m2.height = 1024; const h = m2.getContext("2d");
  h.fillStyle = "#fff1d6"; h.beginPath(); h.arc(512, 512, 200, 0, Math.PI * 2); h.fill();
  h.globalCompositeOperation = "destination-out"; h.beginPath(); h.arc(598, 448, 178, 0, Math.PI * 2); h.fill();
  g.drawImage(m2, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  m.visible = false; scene.add(m); return m;
})();
const stars = (() => {
  const pts = []; let sd = 11; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) pts.push((r() - 0.5) * 7, -0.3 + r() * 3.6, -4.5);
  const gm = new THREE.BufferGeometry(); gm.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const p = new THREE.Points(gm, new THREE.PointsMaterial({ color: 0xfff3dc, size: 0.035, transparent: true, depthWrite: false, toneMapped: false }));
  p.visible = false; scene.add(p); return p;
})();
// ---- the lock: a graphite dial ring with fine ticks and an Ecrin-blue index ----
const dialG = (() => {
  const g = new THREE.Group(), metal = { metalness: 1, roughness: 0.24, transparent: true };
  g.add(new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.045, 24, 220), new THREE.MeshPhysicalMaterial({ color: 0xb9c0cf, ...metal, clearcoat: 1 })));
  g.add(new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.018, 16, 220), new THREE.MeshPhysicalMaterial({ color: 0x8d95a6, ...metal })));
  const tickM = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.4, transparent: true });
  for (let i = 0; i < 72; i++) { const a = (i / 72) * Math.PI * 2, big = i % 6 === 0; const m = new THREE.Mesh(new THREE.BoxGeometry(0.018, big ? 0.13 : 0.065, 0.02), tickM);
    m.position.set(Math.cos(a) * (big ? 1.79 : 1.76), Math.sin(a) * (big ? 1.79 : 1.76), 0); m.rotation.z = a - Math.PI / 2; g.add(m); }
  const idx = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), new THREE.MeshPhysicalMaterial({ color: 0x2f5bff, metalness: 0.4, roughness: 0.2, transparent: true, emissive: 0x2f5bff, emissiveIntensity: 0.5 }));
  idx.position.set(0, 1.92, 0); g.add(idx);
  g.visible = false; scene.add(g); return g;
})();

// ---- timeline helpers ----
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const out = (x) => 1 - Math.pow(1 - x, 3);
const mix = (a, b, k) => a + (b - a) * k;

// Each coin has: a loose spot (hero), a place in the frozen orbit (around the tile), a place in the final row.
function placeCoins() {
  const n = coins.length;
  coins.forEach((c, i) => {
    // loose: spread around the tile, inside the frame, at different depths (a few close to the lens)
    const a = (i / n) * Math.PI * 2 + 0.5, r0 = 1.85 + ((i * 7) % 3) * 0.22;
    c.userData.loose = [Math.cos(a) * r0 * 1.12, Math.sin(a) * r0 * 0.8 + 0.35, -1.6 + ((i * 37) % 5) * 0.6];
    c.userData.orbit = (i / n) * Math.PI * 2;
    c.userData.row = [(i - (n - 1) / 2) * 0.57, -1.62, 0.9];
    c.userData.spin = [((i * 53) % 7) / 7 - 0.5, ((i * 31) % 5) / 5 - 0.5];
    // its slot in the blue scene (the middle one rests behind the tile)
    const xs = [-2.6, -2.1, -1.62, -1.3, 0, 1.3, 1.62, 2.1, 2.6], k = i % xs.length, front = [1, 0, 1, 0, 0, 0, 1, 0, 1][k] === 1;
    c.userData.slot = [xs[k], front ? -0.12 : 0.62, front ? 0.75 : -1.0];
  });
}

// How close anything visible comes to the edge of the frame: 1 = at the centre, 0 = touching the edge, < 0 = cut off.
// The render refuses to write frames until every one of them keeps a margin (see render.cjs).
const box = new THREE.Box3(), v3 = new THREE.Vector3();
function margin() {
  camera.updateMatrixWorld(); let worst = 1, who = "";
  const check = (obj, name) => { box.setFromObject(obj); if (box.isEmpty()) return;
    for (let i = 0; i < 8; i++) { v3.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
      const m = 1 - Math.max(Math.abs(v3.x), Math.abs(v3.y)); if (m < worst) { worst = m; who = name; } } };
  check(tile, "tile"); coins.forEach((c, i) => check(c, "coin " + i)); if (moon.visible) check(moon, "moon"); if (dialG.visible) check(dialG, "dial");
  if (band?.visible && band.material.opacity > 0.05) { band.updateMatrixWorld(); // the ring itself, sampled (its box corners lie outside it)
    for (let k = 0; k < 96; k++) for (const y of [-0.17, 0.17]) { const a = (k / 96) * Math.PI * 2; v3.set(Math.cos(a) * 2.3, y, Math.sin(a) * 2.3).applyMatrix4(band.matrixWorld).project(camera);
      const m = 1 - Math.max(Math.abs(v3.x), Math.abs(v3.y)); if (m < worst) { worst = m; who = "band"; } } }
  return { worst, who };
}

// the coin's face texture sits a quarter-turn off on the cylinder cap: this turns every logo upright
const LOGO_UP = Number(new URLSearchParams(location.search).get("up") ?? Math.PI / 2);

// keyframes: [[t, value], ...] eased between neighbours, held before the first and after the last
const kf = (t, keys) => { if (t <= keys[0][0]) return keys[0][1]; for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [a, va] = keys[i - 1], [b, vb] = keys[i]; return mix(va, vb, ease((t - a) / (b - a))); } return keys[keys.length - 1][1]; };

window.seat = {
  margin(t) { this.pose(t); return margin(); },
  frame(t) { this.pose(t); renderer.render(scene, camera); return renderer.domElement.toDataURL("image/png"); },
  // the film, in six scenes: Ecrin (loose coins) · Wait (they rush in and freeze) · Cancel (the band, coins in slots)
  // · Sleep on it (moon, coins at rest) · The lock (a dial closes, coins on it, iced) · Every coin (a row of networks)
  pose(t) {
    const lift = Math.sin(t * Math.PI * 5) * 0.035;
    const turn = kf(t, [[0, -0.62], [0.07, -0.62], [0.26, 0], [0.31, 0], [0.45, 0.42], [0.5, 0], [0.58, -0.2], [0.64, 0], [0.8, 0], [0.97, -0.32]]);
    tile.rotation.set(kf(t, [[0, 0.06], [0.8, 0.06], [1, 0]]), turn, 0);
    tile.position.set(0, 0.28 + lift + kf(t, [[0, 0], [0.8, 0], [0.94, 0.32]]), 0);
    tile.userData.diamond.rotation.y = t * Math.PI * 2.4;

    const pull = out(seg(t, 0.07, 0.24)), freeze = ease(seg(t, 0.21, 0.27));
    const wide = ease(seg(t, 0.28, 0.34)) * (1 - ease(seg(t, 0.43, 0.48)));
    const sleepW = ease(seg(t, 0.47, 0.55)), lockW = ease(seg(t, 0.62, 0.69)), toRow = ease(seg(t, 0.79, 0.93));
    const dialRot = kf(t, [[0.62, -1.1], [0.71, 0.06], [0.735, 0], [1, 0]]); // turns, overshoots a hair, clicks home
    const ice = Math.max(freeze * (1 - ease(seg(t, 0.43, 0.48))), ease(seg(t, 0.7, 0.75)) * (1 - ease(seg(t, 0.78, 0.82))));
    const n = coins.length;
    coins.forEach((c, i) => {
      const u = c.userData, oa = u.orbit + (1 - freeze) * (1 - pull) * 1.2 + t * 1.1 * (1 - freeze);
      const ring = [Math.cos(oa) * 2.02, Math.sin(oa) * 0.8 + 0.3, Math.sin(oa) * 1.0];
      const drift = [Math.sin(t * 11 + u.orbit) * 0.12, Math.cos(t * 9 + u.orbit) * 0.1, 0];
      // resting for the night: a low, gently sagging line under the tile, breathing slowly
      const q = (i - (n - 1) / 2) / ((n - 1) / 2), rest = [q * 2.4, -1.5 - 0.2 * (1 - q * q) + Math.sin(t * 40 + i) * 0.025, 0.5];
      // on the dial: like the numbers of a safe's dial, turning with it
      const da = (i / n) * Math.PI * 2 + Math.PI / 2 + dialRot, dial = [Math.cos(da) * 1.98, Math.sin(da) * 1.98 + 0.28, -0.05];
      let p = u.loose.map((v, k) => mix(v + drift[k], ring[k], pull));
      p = p.map((v, k) => mix(v, u.slot[k], wide)); p = p.map((v, k) => mix(v, rest[k], sleepW));
      p = p.map((v, k) => mix(v, dial[k], lockW)); p = p.map((v, k) => mix(v, u.row[k], toRow));
      c.position.set(...p);
      const spinning = (1 - freeze) * (1 - toRow);
      const tilt = kf(t, [[0, 0.55], [0.47, 0.55], [0.55, 0.8], [0.62, 0.8], [0.69, 1], [1, 1]]);
      c.rotation.set(Math.PI / 2 * tilt + u.spin[0] * spinning * 2 + t * 15 * spinning, LOGO_UP + u.spin[1] * 1.4 * (1 - Math.max(toRow, lockW, sleepW)) + t * 8 * spinning, 0);
      c.userData.frost.material.opacity = 0.7 * ice; c.userData.frost.scale.setScalar(mix(0.6, 1, ice));
      c.scale.setScalar(mix(0.95, 0.9, pull) * mix(1, 0.8, wide) * mix(1, 0.72, sleepW * (1 - lockW)) * mix(1, 0.88, lockW * (1 - toRow)) * mix(1, 0.72, toRow));
    });

    if (band) {
      const inB = ease(seg(t, 0.28, 0.34)), outB = ease(seg(t, 0.43, 0.47)), v = inB * (1 - outB);
      band.visible = v > 0.01; band.material.opacity = v;
      band.scale.set(mix(1.25, 1, inB), 1, mix(1.25, 1, inB));
      band.position.set(0, 0.28 + lift, 0); band.rotation.set(0.2, -(t - 0.28) * Math.PI * 4, -0.14);
    }

    // the night: a warm crescent rising behind the tile, faint stars
    const night = ease(seg(t, 0.47, 0.53)) * (1 - ease(seg(t, 0.6, 0.65)));
    moon.visible = stars.visible = night > 0.01; moon.material.opacity = night; stars.material.opacity = night * 0.9;
    moon.position.set(1.75, kf(t, [[0.47, -0.4], [0.58, 1.6]]), -3.2);
    stars.rotation.z = t * 0.4;

    // the lock: a precision dial ring closes around the tile, turns with the coins and clicks home
    const lockV = ease(seg(t, 0.62, 0.68)) * (1 - ease(seg(t, 0.77, 0.81)));
    dialG.visible = lockV > 0.01; dialG.children.forEach((m) => (m.material.opacity = lockV));
    dialG.scale.setScalar(mix(1.16, 1, ease(seg(t, 0.62, 0.69)))); dialG.rotation.z = dialRot; dialG.position.set(0, 0.28 + lift, -0.34);

    const z = kf(t, [[0, 13.2], [0.25, 11.6], [0.3, 13.9], [0.46, 13.9], [0.5, 11.9], [0.61, 11.9], [0.66, 12.8], [0.78, 12.8], [0.86, 13.0], [1, 13.0]]);
    camera.position.set(kf(t, [[0, 0.4], [0.25, 0]]), kf(t, [[0, 0.9], [0.5, 1.1], [1, 1.4]]), z);
    camera.lookAt(0, kf(t, [[0, 0.1], [0.8, 0.1], [1, -0.15]]), 0);
  },
};

(async () => {
  const logos = window.SEAT_LOGOS;
  const pick = ["Bitcoin", "Ethereum", "Solana", "Sui", "Base", "Polygon", "Avalanche", "BNB Chain", "XRP Ledger"];
  for (const name of pick) {
    const svg = logos.find((l) => l[0] === name)?.[1]; if (!svg) continue;
    const tex = await logoTexture(svg);
    // the logo is unlit: it shows in its exact colours whatever the light does (no glare, no shading); the steel rim catches the light
    const face = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const edge = steel;
    const g = new THREE.Group();
    const body = new THREE.Mesh(coinGeo, [edge, face, face]); body.castShadow = true; g.add(body);
    const rim = new THREE.Mesh(rimGeo, steel); rim.rotation.x = Math.PI / 2; g.add(rim);
    const f = new THREE.Mesh(frostGeo, frost.clone()); f.renderOrder = 3; g.add(f); g.userData.frost = f;
    coins.push(g); scene.add(g);
  }
  placeCoins();
  await makeBand();
  window.seatReady = true;
})();
