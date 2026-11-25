// The Ecrin Safe, modelled for the landing page and rendered offline into image frames (see tools/safe3d/render.cjs):
// an ivory jewel-box safe with an Ecrin-blue door, a chrome dial and handle, and the glass diamond inside.
// window.ecrinSafe.frame(spin, open) draws one frame: spin in turns (0..1), open from 0 (shut) to 1 (open).
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const S = Number(new URLSearchParams(location.search).get("s") || 900);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(S, S); renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100); camera.position.set(0, 1.5, 9.2); camera.lookAt(0, 0.05, 0);

const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3.5, 6, 5); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 8; Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
scene.add(key);
const rim = new THREE.DirectionalLight(0x8fa6ff, 1.4); rim.position.set(-5, 2, -4); scene.add(rim);
scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x1a2050, 0.35));

// a soft contact shadow under the Safe, on an invisible floor
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.28 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -1.22; floor.receiveShadow = true; scene.add(floor);

const ivory = new THREE.MeshPhysicalMaterial({ color: 0xf2efe6, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.18, sheen: 0.4 });
const inside = new THREE.MeshPhysicalMaterial({ color: 0x0c1440, roughness: 0.85 });
const blue = new THREE.MeshPhysicalMaterial({ color: 0x0a24c4, roughness: 0.42, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.1, envMapIntensity: 0.28 });
const chrome = new THREE.MeshPhysicalMaterial({ color: 0xe9ecf5, roughness: 0.12, metalness: 1 });
const gem = new THREE.MeshPhysicalMaterial({ color: 0xdbe4ff, roughness: 0.02, metalness: 0.1, transmission: 0.55, thickness: 0.6, ior: 2.1, iridescence: 0.6, clearcoat: 1, flatShading: true, emissive: 0x3d5cff, emissiveIntensity: 0.18 });

const safe = new THREE.Group(); scene.add(safe);
const W = 2.3, H = 2.3, D = 1.9;
// body: a rounded box with the front cut open (built from the box and a dark hollow inside)
const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 6, 0.32), ivory); body.castShadow = true; body.receiveShadow = true; safe.add(body);
const hollow = new THREE.Mesh(new RoundedBoxGeometry(W - 0.42, H - 0.42, 0.06, 4, 0.03), inside); hollow.position.z = D / 2 + 0.005; safe.add(hollow);
// little feet
for (const x of [-0.78, 0.78]) { const f = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.12, 0.42, 3, 0.05), chrome); f.position.set(x, -H / 2 - 0.04, 0.35); safe.add(f); }

// the diamond inside, on a little blue cushion
const crown = new THREE.CylinderGeometry(0.2, 0.42, 0.18, 12, 1), pav = new THREE.ConeGeometry(0.42, 0.42, 12, 1);
const g1 = new THREE.Mesh(crown, gem), g2 = new THREE.Mesh(pav, gem); g2.rotation.x = Math.PI; g2.position.y = -0.3;
const diamond = new THREE.Group(); diamond.add(g1, g2); diamond.position.set(0, 0.12, D / 2 + 0.45); diamond.rotation.set(0.25, 0.3, 0); diamond.scale.setScalar(1.25); safe.add(diamond);
const cushion = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.22, 0.6, 3, 0.1), blue); cushion.position.set(0, -0.62, D / 2 + 0.16); safe.add(cushion);
const glow = new THREE.PointLight(0x6d8bff, 0, 3); glow.position.set(0, 0.3, D / 2 + 1.1); safe.add(glow);

// the door: hinged on the left edge, so it swings open toward the viewer
const hinge = new THREE.Group(); hinge.position.set(-W / 2 + 0.1, 0, D / 2 + 0.01); safe.add(hinge);
const door = new THREE.Group(); door.position.set(W / 2 - 0.1, 0, 0.06); hinge.add(door);
const panel = new THREE.Mesh(new RoundedBoxGeometry(W - 0.2, H - 0.2, 0.14, 5, 0.2), blue); panel.castShadow = true; door.add(panel);
// dial: a chrome ring with ticks and a knob
const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 16, 64), chrome); ring.position.z = 0.09; door.add(ring);
const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.16, 48), chrome); knob.rotation.x = Math.PI / 2; knob.position.z = 0.14; door.add(knob);
const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 32), blue); cap.rotation.x = Math.PI / 2; cap.position.z = 0.23; door.add(cap);
for (let i = 0; i < 24; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.018, i % 6 ? 0.05 : 0.09, 0.02), chrome); const a = (i / 24) * Math.PI * 2; t.position.set(Math.sin(a) * 0.56, Math.cos(a) * 0.56, 0.08); t.rotation.z = -a; door.add(t); }
// handle and the Ecrin mark (a small ivory diamond) at the top
const handle = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.62, 0.12, 3, 0.05), chrome); handle.position.set(0.78, 0, 0.13); door.add(handle);
const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), ivory); mark.scale.set(1, 1, 0.3); mark.position.set(0, 0.8, 0.09); door.add(mark);

safe.rotation.x = 0.04;
window.ecrinSafe = {
  frame(spin = 0, open = 0) {
    safe.rotation.y = spin * Math.PI * 2;
    const e = 1 - Math.pow(1 - open, 3);
    hinge.rotation.y = -e * 1.95;
    glow.intensity = e * 6;
    diamond.visible = cushion.visible = open > 0.04; // inside, behind the shut door
    diamond.rotation.y = 0.3 + open * 1.2; diamond.position.y = 0.05 + e * 0.22;
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  },
};
window.ecrinReady = true;
