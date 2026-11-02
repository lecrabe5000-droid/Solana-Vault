// The Safe's emblem: the Ecrin diamond inside a glass case, in 3D, drawn only with fine lines, like a laser
// engraving. A small hand-written renderer on a canvas (no 3D library): points are rotated, projected with
// perspective, and every line fades with depth. It drifts very slightly on its own and leans toward the pointer.
const TAU = Math.PI * 2;

function diamond() {
  const segs = [], N = 8;
  const ring = (y, r, rot = 0) => Array.from({ length: N }, (_, i) => { const a = (i / N) * TAU + rot; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
  const girdle = ring(0, 1), table = ring(0.42, 0.56, TAU / 16), culet = [0, -1.05, 0];
  // Facet edges.
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    segs.push([girdle[i], girdle[j], 1], [table[i], table[j], 1], [girdle[i], culet, 1], [girdle[i], table[i], 1], [girdle[j], table[i], 1]);
  }
  // Laser lines: horizontal slices through the pavilion and the crown, and rings on the table.
  for (let k = 1; k < 14; k++) { const y = -1.05 + (k / 14) * 1.05, r = (k / 14); const R = ring(y, r); for (let i = 0; i < N; i++) segs.push([R[i], R[(i + 1) % N], 0.42]); }
  for (let k = 1; k < 6; k++) { const t = k / 6, y = t * 0.42, r = 1 - t * 0.44; const R = ring(y, r, (TAU / 16) * t); for (let i = 0; i < N; i++) segs.push([R[i], R[(i + 1) % N], 0.42]); }
  for (let k = 1; k < 4; k++) { const R = ring(0.42, 0.56 * (k / 4), TAU / 16); for (let i = 0; i < N; i++) segs.push([R[i], R[(i + 1) % N], 0.32]); }
  return segs;
}

function caseBox() {
  const s = 1.42, h = 1.3, segs = [], c = [];
  for (const x of [-s, s]) for (const y of [-h, h]) for (const z of [-s, s]) c.push([x, y, z]);
  const key = (p) => p.join(",");
  const idx = new Map(c.map((p, i) => [key(p), i]));
  // The 12 edges.
  for (const p of c) for (let d = 0; d < 3; d++) { const q = [...p]; q[d] = -q[d]; if (key(p) < key(q)) segs.push([p, q, 0.9]); }
  // Laser hatching on the glass: fine horizontal lines on the four walls, and a grid on the lid and the base.
  const walls = [[[-s, 0, -s], [s, 0, -s]], [[s, 0, -s], [s, 0, s]], [[s, 0, s], [-s, 0, s]], [[-s, 0, s], [-s, 0, -s]]];
  for (let k = 1; k < 12; k++) { const y = -h + (k / 12) * 2 * h; for (const [a, b] of walls) segs.push([[a[0], y, a[2]], [b[0], y, b[2]], 0.12]); }
  for (let k = 1; k < 8; k++) { const t = -s + (k / 8) * 2 * s; for (const y of [-h, h]) { segs.push([[t, y, -s], [t, y, s], 0.16]); segs.push([[-s, y, t], [s, y, t], 0.16]); } }
  // A small plinth under the diamond.
  const pl = 0.8, py = -h + 0.16;
  for (const [a, b] of [[[-pl, py, -pl], [pl, py, -pl]], [[pl, py, -pl], [pl, py, pl]], [[pl, py, pl], [-pl, py, pl]], [[-pl, py, pl], [-pl, py, -pl]]]) segs.push([a, b, 0.5]);
  void idx;
  return segs;
}

const fit = (p) => p.map((v, i) => (i === 1 ? v * 0.92 + 0.06 : v * 0.92));
const MODEL = (() => {
  const d = diamond().map(([a, b, w]) => [fit(a), fit(b), w]);
  return [...caseBox(), ...d];
})();
// The diamond's facets, filled very lightly (flat, matte) so it reads as a solid under the lines.
const FACES = (() => {
  const N = 8, f = [];
  const ring = (y, r, rot = 0) => Array.from({ length: N }, (_, i) => { const a = (i / N) * TAU + rot; return fit([Math.cos(a) * r, y, Math.sin(a) * r]); });
  const g = ring(0, 1), t = ring(0.42, 0.56, TAU / 16), c = fit([0, -1.05, 0]);
  for (let i = 0; i < N; i++) { const j = (i + 1) % N; f.push([g[i], g[j], c], [g[i], g[j], t[i]], [g[j], t[j], t[i]]); }
  f.push(t);
  return f;
})();

const CORNERS = (() => { const s = 1.42, h = 1.3, c = []; for (const x of [-s, s]) for (const y of [-h, h]) for (const z of [-s, s]) c.push([x, y, z]); return c; })();
const state = { sc: 0, t0: performance.now(), tx: 0, ty: 0, cx: 0, cy: 0, el: null, raf: 0 };

/** Starts (or re-attaches) the animation on the canvas inside `root`, if there is one. */
export function mountVault3d(root) {
  const cv = root?.querySelector?.("canvas[data-vault3d]");
  if (!cv || cv === state.el) return;
  state.el = cv;
  const host = cv.parentElement;
  host.addEventListener("pointermove", (e) => { const r = host.getBoundingClientRect(); state.tx = ((e.clientX - r.left) / r.width - 0.5) * 2; state.ty = ((e.clientY - r.top) / r.height - 0.5) * 2; });
  host.addEventListener("pointerleave", () => { state.tx = 0; state.ty = 0; });
  cancelAnimationFrame(state.raf);
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const loop = () => {
    if (!cv.isConnected) { if (state.el === cv) state.el = null; return; }
    draw(cv, still);
    if (!still) state.raf = requestAnimationFrame(loop);
  };
  loop();
}

function draw(cv, still) {
  const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const t = still ? 0 : (performance.now() - state.t0) / 1000;
  state.cx += (state.tx - state.cx) * 0.06; state.cy += (state.ty - state.cy) * 0.06;
  // A slow, slight wobble, plus a lean toward the pointer.
  const yaw = 0.62 + Math.sin(t * 0.42) * 0.16 + Math.sin(t * 0.17) * 0.07 + state.cx * 0.32;
  const pitch = -0.36 + Math.sin(t * 0.33 + 1.2) * 0.06 + state.cy * 0.18;
  const bob = Math.sin(t * 0.8) * 0.04;
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cam = 7.5;
  const raw = ([x, y, z]) => {
    const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
    const y1 = (y + bob) * cp - z1 * sp, z2 = (y + bob) * sp + z1 * cp;
    const k = cam / (cam + z2);
    return [x1 * k, -y1 * k, z2];
  };
  // Always fits: measure the case as drawn right now and scale it to leave a margin on every side.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of CORNERS) { const [x, y] = raw(p); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const target = Math.min((W - 24) / (x1 - x0), (H - 20) / (y1 - y0));
  state.sc = state.sc ? state.sc + (target - state.sc) * 0.2 : target;
  const ox = W / 2 - ((x0 + x1) / 2) * state.sc, oy = H / 2 - ((y0 + y1) / 2) * state.sc;
  const P = (p) => { const [x, y, z] = raw(p); return [ox + x * state.sc, oy + y * state.sc, z]; };
  const dark = document.documentElement.dataset.theme !== "light";
  const rgb = dark ? "91,124,255" : "47,91,255";
  // Facets back to front, each a faint flat tone that depends on how it faces the light.
  const rot = ([x, y, z]) => { const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw; return [x1, (y + bob) * cp - z1 * sp, (y + bob) * sp + z1 * cp]; };
  const faces = FACES.map((poly) => {
    const r = poly.map(rot), [a, b, c] = r;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const L = Math.hypot(...n) || 1; n = n.map((x) => x / L);
    const light = Math.abs(n[0] * -0.4 + n[1] * 0.75 + n[2] * -0.5);
    return { pts: poly.map(P), z: r.reduce((s, p) => s + p[2], 0) / r.length, light };
  }).sort((p, q) => q.z - p.z);
  for (const f of faces) {
    g.fillStyle = `rgba(${rgb},${(0.035 + f.light * 0.11).toFixed(3)})`;
    g.beginPath(); f.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
  }
  g.lineCap = "round";
  for (const [a, b, w] of MODEL) {
    const A = P(a), B = P(b), z = (A[2] + B[2]) / 2;
    const depth = Math.max(0.18, Math.min(1, 0.62 - z * 0.22));
    g.strokeStyle = `rgba(${rgb},${(w * depth).toFixed(3)})`;
    g.lineWidth = w >= 0.9 ? 1.1 : w >= 0.4 ? 0.8 : 0.6;
    g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke();
  }
}
