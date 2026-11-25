// The Ecrin Safe, product-shot quality, rendered offline into frames (tools/safe3d/render.cjs).
// Black titanium body, anodized Ecrin-blue door, polished steel dial and handle, a real gem inside,
// lit like a studio product shot (softboxes reflected in the metal).
// window.ecrinSafe.frame(spin, open): spin in turns (0..1), open 0 (shut) .. 1 (open).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const S = Number(new URLSearchParams(location.search).get("s") || 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(S, S); renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.append(renderer.domElement);

// ---- a dark studio: black room, a few large softboxes that the metal reflects ----
const studio = new THREE.Scene(); studio.background = new THREE.Color(0x000000);
const box = (w, h, x, y, z, ry, rx, k, tint = [1, 1, 1]) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint[0] * k, tint[1] * k, tint[2] * k), side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); studio.add(m); };
{ const dome = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.17, 0.2), side: THREE.BackSide })); studio.add(dome); }
box(12, 4, 0, 7, 2, 0, Math.PI / 2, 12);             // big top softbox
box(2, 9, -7, 1, 3, Math.PI / 2, 0, 9);              // left strip
box(2, 9, 7, 1, 1, -Math.PI / 2, 0, 7);              // right strip
box(10, 5, 0, 1.5, 9, Math.PI, 0, 3.2);              // front fill, so faces and the dial read
box(7, 4, 0, 1.5, -8, 0, 0, 3, [0.5, 0.62, 1]);      // cool blue back fill
box(12, 3, 0, -4, 5, Math.PI, -0.6, 1.6);            // floor bounce
const pmrem = new THREE.PMREMGenerator(renderer);
const scene = new THREE.Scene(); scene.environment = pmrem.fromScene(studio, 0.02).texture;

const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100); camera.position.set(0, 1.25, 11); camera.lookAt(0, 0.05, 0);
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 7, 5); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 10; key.shadow.bias = -0.0004; Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 }); scene.add(key);
const rim = new THREE.DirectionalLight(0x9db0ff, 1.2); rim.position.set(-4, 3, -5); scene.add(rim);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.55 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -1.27; floor.receiveShadow = true; scene.add(floor);

// ---- materials ----
const titanium = new THREE.MeshPhysicalMaterial({ color: 0x4a4d57, metalness: 1, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.25 });
const anodized = new THREE.MeshPhysicalMaterial({ color: 0x2649f2, metalness: 0.68, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
const steel = new THREE.MeshPhysicalMaterial({ color: 0xf2f4fa, metalness: 1, roughness: 0.08 });
const satin = new THREE.MeshPhysicalMaterial({ color: 0xd9dde8, metalness: 1, roughness: 0.28 });
const gap = new THREE.MeshStandardMaterial({ color: 0x030305, roughness: 1 });
const suede = new THREE.MeshStandardMaterial({ color: 0x0b1130, roughness: 1 });
const gem = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0, transmission: 1, thickness: 1.2, ior: 2.42, dispersion: 4, iridescence: 0.3, specularIntensity: 1, envMapIntensity: 2.2, flatShading: true });

const safe = new THREE.Group(); scene.add(safe);
const W = 2.3, H = 2.3, D = 1.95, R = 0.22;
const add = (g, m, p = [0, 0, 0], parent = safe) => { const o = new THREE.Mesh(g, m); o.position.set(...p); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };

// body, the door recess (a dark gap around the door) and the interior
add(new RoundedBoxGeometry(W, H, D, 10, R), titanium);
add(new RoundedBoxGeometry(W - 0.24, H - 0.24, 0.05, 4, 0.12), gap, [0, 0, D / 2 + 0.002]);
const interior = add(new RoundedBoxGeometry(W - 0.34, H - 0.34, 0.04, 4, 0.1), suede, [0, 0, D / 2 + 0.03]);
// feet
for (const x of [-0.82, 0.82]) for (const z of [-0.6, 0.6]) add(new THREE.CylinderGeometry(0.11, 0.13, 0.08, 32), satin, [x, -H / 2 - 0.03, z]);

// the gem on a small satin plinth, inside
const cut = new THREE.Group();
const crown = new THREE.CylinderGeometry(0.26, 0.5, 0.2, 16, 1), pav = new THREE.ConeGeometry(0.5, 0.55, 16, 1);
const g1 = new THREE.Mesh(crown, gem), g2 = new THREE.Mesh(pav, gem); g2.rotation.x = Math.PI; g2.position.y = -0.375; cut.add(g1, g2);
cut.position.set(0, 0.2, D / 2 + 0.55); cut.rotation.set(0.32, 0.4, 0); safe.add(cut);
const plinth = add(new THREE.CylinderGeometry(0.42, 0.48, 0.16, 64), satin, [0, -0.62, D / 2 + 0.42]);
const glow = new THREE.PointLight(0x7f97ff, 0, 4); glow.position.set(0, 0.6, D / 2 + 1.4); safe.add(glow);

// the door, hinged on the left
const hinge = new THREE.Group(); hinge.position.set(-W / 2 + 0.14, 0, D / 2 + 0.03); safe.add(hinge);
const door = new THREE.Group(); door.position.set(W / 2 - 0.14, 0, 0.07); hinge.add(door);
add(new RoundedBoxGeometry(W - 0.3, H - 0.3, 0.15, 8, 0.11), anodized, [0, 0, 0], door);
for (const y of [-0.62, 0.62]) add(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 32), steel, [-(W - 0.3) / 2 - 0.02, y, 0], door);
// dial: a satin bezel, a knurled steel knob, a blue centre
add(new THREE.TorusGeometry(0.5, 0.022, 24, 96), steel, [0, 0, 0.08], door);
for (let i = 0; i < 72; i++) { const a = (i / 72) * Math.PI * 2, big = i % 6 === 0; const t = add(new THREE.BoxGeometry(0.012, big ? 0.07 : 0.035, 0.01), satin, [Math.sin(a) * (big ? 0.6 : 0.615), Math.cos(a) * (big ? 0.6 : 0.615), 0.078], door); t.rotation.z = -a; }
const knob = add(new THREE.CylinderGeometry(0.34, 0.35, 0.16, 96), steel, [0, 0, 0.16], door); knob.rotation.x = Math.PI / 2;
for (let i = 0; i < 90; i++) { const a = (i / 90) * Math.PI * 2; const r = add(new THREE.BoxGeometry(0.012, 0.012, 0.15), satin, [Math.sin(a) * 0.35, Math.cos(a) * 0.35, 0.16], door); r.rotation.z = -a; }
const face = add(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 96), satin, [0, 0, 0.245], door); face.rotation.x = Math.PI / 2;
const cap = add(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 64), anodized, [0, 0, 0.26], door); cap.rotation.x = Math.PI / 2;
// handle: a slim polished lever
const hub = add(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 48), steel, [0.72, 0, 0.12], door); hub.rotation.x = Math.PI / 2;
add(new RoundedBoxGeometry(0.06, 0.56, 0.06, 4, 0.03), steel, [0.72, -0.24, 0.19], door);
// the Ecrin mark, inlaid in steel at the top of the door
const markShape = new THREE.Shape(); { const s = 0.13, r = 0.045; markShape.moveTo(-s + r, -s); markShape.lineTo(s - r, -s); markShape.quadraticCurveTo(s, -s, s, -s + r); markShape.lineTo(s, s - r); markShape.quadraticCurveTo(s, s, s - r, s); markShape.lineTo(-s + r, s); markShape.quadraticCurveTo(-s, s, -s, s - r); markShape.lineTo(-s, -s + r); markShape.quadraticCurveTo(-s, -s, -s + r, -s);
  const h = new THREE.Path(); const q = 0.105, rr = 0.03; h.moveTo(-q + rr, -q); h.lineTo(q - rr, -q); h.quadraticCurveTo(q, -q, q, -q + rr); h.lineTo(q, q - rr); h.quadraticCurveTo(q, q, q - rr, q); h.lineTo(-q + rr, q); h.quadraticCurveTo(-q, q, -q, q - rr); h.lineTo(-q, -q + rr); h.quadraticCurveTo(-q, -q, -q + rr, -q); markShape.holes.push(h); }
add(new THREE.ExtrudeGeometry(markShape, { depth: 0.012, bevelEnabled: false, curveSegments: 12 }), steel, [0, 0.83, 0.075], door);
const dm = add(new THREE.OctahedronGeometry(0.055, 0), steel, [0, 0.83, 0.085], door); dm.scale.set(0.8, 1, 0.25);

safe.rotation.x = 0.03;
window.ecrinSafe = {
  frame(spin = 0, open = 0) {
    safe.rotation.y = spin * Math.PI * 2;
    const e = open < 0.5 ? 4 * open ** 3 : 1 - Math.pow(-2 * open + 2, 3) / 2;
    hinge.rotation.y = -e * 1.9;
    const inside = open > 0.03; cut.visible = plinth.visible = inside;
    glow.intensity = e * 5;
    cut.rotation.y = 0.4 + open * 1.4; cut.position.y = 0.0 + e * 0.1;
    knob.rotation.y = open * -2.5;
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  },
};
// floating objects for the page: a large glass gem, an Ecrin coin, a steel dial
const objs = new THREE.Group(); scene.add(objs); objs.visible = false;
const crystal = new THREE.MeshPhysicalMaterial({ color: 0x9fb4ff, metalness: 0.7, roughness: 0.02, flatShading: true, iridescence: 1, iridescenceIOR: 1.6, clearcoat: 1, envMapIntensity: 3.2, specularIntensity: 1 });
const bigGem = new THREE.Group(); { const c = new THREE.CylinderGeometry(0.55, 1.05, 0.42, 24, 1), pv = new THREE.ConeGeometry(1.05, 1.15, 24, 1); const a = new THREE.Mesh(c, crystal), b = new THREE.Mesh(pv, crystal); b.rotation.x = Math.PI; b.position.y = -0.785; bigGem.add(a, b); bigGem.position.y = 0.35; } objs.add(bigGem);
const coin = new THREE.Group(); { const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.2, 128), anodized); disc.rotation.x = Math.PI / 2; const rimT = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.07, 24, 128), steel); const m = new THREE.Mesh(new THREE.ExtrudeGeometry(markShape, { depth: 0.04, bevelEnabled: false, curveSegments: 12 }), steel); m.scale.setScalar(3.4); m.position.z = 0.1; const dd = new THREE.Mesh(new THREE.OctahedronGeometry(0.19, 0), steel); dd.scale.set(0.8, 1, 0.3); dd.position.z = 0.13; coin.add(disc, rimT, m, dd); } objs.add(coin);
const dial = new THREE.Group(); { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1, 0.42, 128), steel); k.rotation.x = Math.PI / 2; dial.add(k); for (let i = 0; i < 120; i++) { const a = (i / 120) * Math.PI * 2; const r = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.4), satin); r.position.set(Math.sin(a) * 1, Math.cos(a) * 1, 0); r.rotation.z = -a; dial.add(r); } const f = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.05, 96), satin); f.rotation.x = Math.PI / 2; f.position.z = 0.22; const cc = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.07, 64), anodized); cc.rotation.x = Math.PI / 2; cc.position.z = 0.25; dial.add(f, cc); } objs.add(dial);
window.ecrinObj = (name, rx = 0, ry = 0) => {
  safe.visible = false; floor.visible = false; objs.visible = true;
  for (const [k, g] of Object.entries({ gem: bigGem, coin, dial })) { g.visible = k === name; g.rotation.set(rx, ry, 0); }
  renderer.render(scene, camera); return renderer.domElement.toDataURL("image/png");
};
window.ecrinReady = true;
