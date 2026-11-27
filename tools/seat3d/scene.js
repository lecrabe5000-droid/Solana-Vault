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

const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(3, 8, 6); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 22; key.shadow.bias = -0.0005; Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 }); scene.add(key);
const rimL = new THREE.DirectionalLight(0xa9bbff, 1.1); rimL.position.set(-5, 2, -4); scene.add(rimL);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.13 }));
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
const frost = new THREE.MeshPhysicalMaterial({ color: 0xcfdcff, metalness: 0.1, roughness: 0.12, transparent: true, opacity: 0, clearcoat: 1, clearcoatRoughness: 0.05, flatShading: true, depthWrite: false });
const frostGeo = new THREE.CylinderGeometry(0.455, 0.455, 0.11, 6, 1); // a faceted ice shell (hexagonal, like a crystal)
async function logoTexture(svg) {
  const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); await img.decode();
  const c = document.createElement("canvas"); c.width = c.height = 512; const g = c.getContext("2d");
  g.beginPath(); g.arc(256, 256, 256, 0, Math.PI * 2); g.clip(); g.drawImage(img, 0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ---- the band: SELF-CUSTODY · WITH A SEATBELT, wrapped around the tile ----
let band;
async function makeBand() {
  const font = new FontFace("ITB", `url(${window.SEAT_FONT})`); // inlined by render.cjs (pages opened from disk can't fetch files) await font.load(); document.fonts.add(font);
  const c = document.createElement("canvas"); c.width = 4096; c.height = 220; const g = c.getContext("2d");
  g.fillStyle = "#f4f1ea"; g.textBaseline = "middle"; g.font = "800 150px ITB";
  const phrase = "SELF-CUSTODY  ✦  WITH A SEATBELT  ✦  ";
  let x = 0; const w = g.measureText(phrase).width; while (x < c.width) { g.fillText(phrase, x, 112); x += w; }
  // the phrase repeats to fill; the band's circumference is tuned so it closes cleanly
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = THREE.RepeatWrapping; t.repeat.x = (w * Math.floor(c.width / w)) / c.width >= 0.9 ? 1 : 1;
  const mat = new THREE.MeshStandardMaterial({ map: t, transparent: true, side: THREE.DoubleSide, roughness: 0.6, metalness: 0, emissive: 0xf4f1ea, emissiveMap: t, emissiveIntensity: 0.55, depthWrite: false });
  band = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 0.42, 160, 1, true), mat);
  band.renderOrder = 2; scene.add(band);
}

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
    const a = (i / n) * Math.PI * 2 + 0.5, r0 = 1.9 + ((i * 7) % 3) * 0.32;
    c.userData.loose = [Math.cos(a) * r0 * 1.1, Math.sin(a) * r0 * 0.78 + 0.35, -1.6 + ((i * 37) % 5) * 0.9];
    c.userData.orbit = (i / n) * Math.PI * 2;
    c.userData.row = [(i - (n - 1) / 2) * 0.57, -1.62, 0.9];
    c.userData.spin = [((i * 53) % 7) / 7 - 0.5, ((i * 31) % 5) / 5 - 0.5];
  });
}

window.seat = {
  frame(t) {
    // --- the tile: three-quarter view, turns to face us as the coins arrive, turns again for the band
    const turn = mix(-0.62, 0, ease(seg(t, 0.12, 0.42))) + mix(0, 0.42, ease(seg(t, 0.5, 0.72))) + mix(0, -0.42, ease(seg(t, 0.78, 0.97)));
    const lift = Math.sin(t * Math.PI * 3) * 0.04;
    tile.rotation.set(0.06 - 0.06 * seg(t, 0.75, 1), turn, 0); tile.position.set(0, 0.28 + lift + 0.32 * ease(seg(t, 0.72, 0.95)), 0);
    tile.userData.diamond.rotation.y = t * Math.PI * 1.5;

    // --- coins: loose and drifting → pulled in and frozen in an orbit → lined up as a row of networks
    const pull = out(seg(t, 0.14, 0.4)), freeze = ease(seg(t, 0.36, 0.46)), toRow = ease(seg(t, 0.74, 0.96));
    coins.forEach((c) => {
      const u = c.userData, oa = u.orbit + (1 - freeze) * (1 - pull) * 1.2 + t * 0.6 * (1 - freeze); // slows to a stop as it freezes
      const orbit = [Math.cos(oa) * 2.45, Math.sin(oa) * 0.95 + 0.3, Math.sin(oa) * 1.5];
      const drift = [Math.sin(t * 6 + u.orbit) * 0.12, Math.cos(t * 5 + u.orbit) * 0.1, 0];
      let p = u.loose.map((v, k) => mix(v + drift[k], orbit[k], pull)); p = p.map((v, k) => mix(v, u.row[k], toRow));
      c.position.set(...p);
      const spinning = (1 - freeze) * (1 - toRow);
      c.rotation.set(Math.PI / 2 * mix(0.55, 1, toRow) + u.spin[0] * spinning * 2 + t * 9 * spinning, u.spin[1] * 1.4 * (1 - toRow) + t * 5 * spinning, 0);
      const ice = freeze * (1 - seg(t, 0.7, 0.78));
      c.userData.frost.material.opacity = 0.42 * ice; c.userData.frost.scale.setScalar(mix(0.6, 1, ice));
      c.scale.setScalar(mix(0.95, 0.9, pull) * mix(1, 0.64, toRow));
    });

    // --- the band: appears around the tile once the coins are held, turns, then leaves
    if (band) {
      const inB = ease(seg(t, 0.44, 0.54)), outB = ease(seg(t, 0.72, 0.8)), v = inB * (1 - outB);
      band.visible = v > 0.01; band.material.opacity = v;
      band.scale.set(mix(1.25, 1, inB), 1, mix(1.25, 1, inB));
      band.position.set(0, 0.28 + lift, 0); band.rotation.set(0.2, -t * Math.PI * 2.2, -0.14);
    }

    // --- camera: a slow push in, a little rise at the end
    const z = mix(13.2, 11.4, ease(seg(t, 0, 0.5))) + mix(0, 1.6, ease(seg(t, 0.72, 1)));
    camera.position.set(mix(0.4, 0, seg(t, 0, 0.4)), mix(0.9, 1.4, seg(t, 0.6, 1)), z); camera.lookAt(0, mix(0.1, -0.15, seg(t, 0.72, 1)), 0);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  },
};

(async () => {
  const logos = window.SEAT_LOGOS;
  const pick = ["Bitcoin", "Ethereum", "Solana", "Sui", "Base", "Polygon", "Avalanche", "BNB Chain", "XRP Ledger"];
  for (const name of pick) {
    const svg = logos.find((l) => l[0] === name)?.[1]; if (!svg) continue;
    const tex = await logoTexture(svg);
    const face = new THREE.MeshPhysicalMaterial({ map: tex, metalness: 0.2, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
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
