// The Safe's emblem: a brilliant-cut Ecrin diamond floating in a glass case, over an engraved vault dial.
// Hand-written canvas renderer, no 3D library. Everything is fine "laser" lines in Ecrin blue with a matte fill
// on the facets; a scan line sweeps through the case and traces the diamond's outline as it passes.
// The case wobbles very slightly and leans toward the pointer; the diamond turns slowly on its own.
const TAU = Math.PI * 2;
const S = 1.42, H = 1.3; // case half-width and half-height

/* ---------------- geometry ---------------- */
const G = 16, T = 8, CROWN = 0.36, PAV = 0.9, TABLE = 0.53, DS = 0.98, DY = 0.16;
const ringPts = (n, r, y, off = 0) => Array.from({ length: n }, (_, i) => { const a = ((i + off) / n) * TAU; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
const girdle = ringPts(G, 1, 0), table = ringPts(T, TABLE, CROWN, 0.5), culet = [0, -PAV, 0];
const D_FACES = [], D_EDGES = [];
for (let i = 0; i < T; i++) {
  const g0 = girdle[2 * i], g1 = girdle[2 * i + 1], g2 = girdle[(2 * i + 2) % G], t0 = table[i], t1 = table[(i + 1) % T];
  D_FACES.push([t0, g0, g1], [t0, g1, g2], [t0, t1, g2]);
  D_EDGES.push([t0, t1], [t0, g1], [t0, g0], [t0, g2], [t1, g2]);
}
D_FACES.push(table);
for (let j = 0; j < G; j++) { D_FACES.push([girdle[j], girdle[(j + 1) % G], culet]); D_EDGES.push([girdle[j], girdle[(j + 1) % G]], [girdle[j], culet]); }

const CORNERS = []; for (const x of [-S, S]) for (const y of [-H, H]) for (const z of [-S, S]) CORNERS.push([x, y, z]);
const CASE_EDGES = []; for (const p of CORNERS) for (let d = 0; d < 3; d++) { const q = [...p]; q[d] = -q[d]; if (String(p) < String(q)) CASE_EDGES.push([p, q]); }
const WALLS = [[[-S, 0, -S], [S, 0, -S]], [[S, 0, -S], [S, 0, S]], [[S, 0, S], [-S, 0, S]], [[-S, 0, S], [-S, 0, -S]]];

/* ---------------- state ---------------- */
const state = { sc: 0, t0: performance.now(), tx: 0, ty: 0, cx: 0, cy: 0, el: null, raf: 0 };

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

/* ---------------- drawing ---------------- */
function draw(cv, still) {
  const dpr = Math.min(3, devicePixelRatio || 1), W = cv.clientWidth, Hh = cv.clientHeight;
  if (!W || !Hh) return;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, Hh);
  const t = still ? 2 : (performance.now() - state.t0) / 1000;
  state.cx += (state.tx - state.cx) * 0.06; state.cy += (state.ty - state.cy) * 0.06;
  const dark = document.documentElement.dataset.theme !== "light";
  const rgb = dark ? [91, 124, 255] : [47, 91, 255];
  const col = (a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(3)})`;

  // Camera: a slight wobble plus a lean toward the pointer.
  const yaw = 0.66 + Math.sin(t * 0.42) * 0.12 + Math.sin(t * 0.17) * 0.06 + state.cx * 0.3;
  const pitch = -0.3 + Math.sin(t * 0.33 + 1.2) * 0.05 + state.cy * 0.16;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cam = 7.5;
  const view = ([x, y, z]) => { const x1 = x * cy + z * sy, z1 = -x * sy + z * cy; return [x1, y * cp - z1 * sp, y * sp + z1 * cp]; };
  const proj = ([x, y, z]) => { const k = cam / (cam + z); return [x * k, -y * k, z]; };

  // Fit the case into the canvas, always.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of CORNERS) { const [x, y] = proj(view(p)); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const target = Math.min((W - 24) / (x1 - x0), (Hh - 18) / (y1 - y0));
  state.sc = state.sc ? state.sc + (target - state.sc) * 0.2 : target;
  const ox = W / 2 - ((x0 + x1) / 2) * state.sc, oy = Hh / 2 - ((y0 + y1) / 2) * state.sc;
  const P = (p) => { const [x, y, z] = proj(view(p)); return [ox + x * state.sc, oy + y * state.sc, z]; };
  const line = (a, b, alpha, w = 0.7) => { const A = P(a), B = P(b); g.strokeStyle = col(alpha); g.lineWidth = w; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke(); };
  const depth = (p) => Math.max(0.25, Math.min(1, 0.7 - view(p)[2] * 0.2));
  g.lineCap = "round"; g.lineJoin = "round";

  // The diamond: turns slowly, floats a little.
  const spin = t * 0.32, bob = Math.sin(t * 0.9) * 0.045, cs = Math.cos(spin), ss = Math.sin(spin);
  const dia = ([x, y, z]) => [(x * cs + z * ss) * DS, y * DS + DY + bob, (-x * ss + z * cs) * DS];

  // Laser scan: a plane sweeping down through the case every few seconds.
  const period = 5.2, ph = (t % period) / period, scanOn = ph < 0.62, sy0 = H - (ph / 0.62) * 2 * H;

  /* floor: the engraved vault dial, turning slowly */
  const fy = -H + 0.001, dialR = S * 0.86, rot = -t * 0.08;
  const circle = (r, a, w = 0.6) => { g.strokeStyle = col(a); g.lineWidth = w; g.beginPath(); for (let i = 0; i <= 72; i++) { const an = (i / 72) * TAU; const q = P([Math.cos(an) * r, fy, Math.sin(an) * r]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); } g.stroke(); };
  circle(dialR, 0.22); circle(dialR * 0.78, 0.14); circle(dialR * 0.36, 0.12);
  for (let i = 0; i < 60; i++) {
    const an = (i / 60) * TAU + rot, big = i % 5 === 0, r0 = dialR * (big ? 0.84 : 0.9);
    line([Math.cos(an) * r0, fy, Math.sin(an) * r0], [Math.cos(an) * dialR, fy, Math.sin(an) * dialR], big ? 0.34 : 0.16, big ? 0.9 : 0.6);
  }
  // A soft shadow under the diamond.
  { const c = P([0, fy, 0]), e = P([dialR * 0.5, fy, 0]), rr = Math.abs(e[0] - c[0]) || 20;
    const gr = g.createRadialGradient(c[0], c[1], 0, c[0], c[1], rr); gr.addColorStop(0, col(dark ? 0.22 : 0.14)); gr.addColorStop(1, col(0));
    g.save(); g.translate(c[0], c[1]); g.scale(1, 0.38); g.translate(-c[0], -c[1]); g.fillStyle = gr; g.beginPath(); g.arc(c[0], c[1], rr, 0, TAU); g.fill(); g.restore(); }

  /* case: back edges and glass hatching first */
  const front = (a, b) => view([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])[2] < 0;
  for (let k = 1; k < 14; k++) { const y = -H + (k / 14) * 2 * H; for (const [a, b] of WALLS) { const A = [a[0], y, a[2]], B = [b[0], y, b[2]]; if (!front(A, B)) line(A, B, 0.07 * depth(A)); } }
  for (const [a, b] of CASE_EDGES) if (!front(a, b)) line(a, b, 0.32 * depth(a), 0.8);

  /* diamond facets, back to front, matte blue with light falling from the top left */
  const faces = D_FACES.map((f) => {
    const w = f.map(dia), v = w.map(view);
    const u = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], q = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
    let n = [u[1] * q[2] - u[2] * q[1], u[2] * q[0] - u[0] * q[2], u[0] * q[1] - u[1] * q[0]]; const L = Math.hypot(...n) || 1; n = n.map((x) => x / L);
    const key = Math.abs(n[0] * -0.45 + n[1] * 0.8 + n[2] * -0.4), rim = Math.abs(n[0] * 0.7 + n[2] * 0.7) * 0.4;
    return { pts: w.map(P), z: v.reduce((s, p) => s + p[2], 0) / v.length, l: Math.min(1, key * 0.85 + rim) };
  }).sort((a, b) => b.z - a.z);
  for (const f of faces) {
    const l = f.l, mix = (a, b) => Math.round(a + (b - a) * l);
    const c0 = dark ? [16, 28, 92] : [214, 223, 255], c1 = dark ? [118, 146, 255] : [47, 91, 255];
    g.fillStyle = `rgba(${mix(c0[0], c1[0])},${mix(c0[1], c1[1])},${mix(c0[2], c1[2])},${dark ? 0.62 : 0.5})`;
    g.beginPath(); f.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
  }
  // Facet edges: the laser lines on the stone.
  for (const [a, b] of D_EDGES) { const A = dia(a), B = dia(b); line(A, B, (dark ? 0.75 : 0.65) * depth(A), 0.75); }

  /* the scan: a bright ring around the case and the diamond's cross-section at that height */
  if (scanOn) {
    const fade = Math.sin((ph / 0.62) * Math.PI);
    for (const [a, b] of WALLS) line([a[0], sy0, a[2]], [b[0], sy0, b[2]], 0.5 * fade, 0.9);
    const hits = [];
    for (const [a, b] of D_EDGES) {
      const A = dia(a), B = dia(b);
      if ((A[1] - sy0) * (B[1] - sy0) < 0) { const k = (sy0 - A[1]) / (B[1] - A[1]); hits.push([A[0] + (B[0] - A[0]) * k, sy0, A[2] + (B[2] - A[2]) * k]); }
    }
    if (hits.length > 2) {
      hits.sort((p, q) => Math.atan2(p[2], p[0]) - Math.atan2(q[2], q[0]));
      g.strokeStyle = dark ? `rgba(220,228,255,${(0.9 * fade).toFixed(3)})` : col(0.95 * fade); g.lineWidth = 1.2;
      g.shadowColor = col(0.9 * fade); g.shadowBlur = dark ? 8 : 4;
      g.beginPath(); hits.forEach((p, i) => { const q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); g.stroke();
      g.shadowBlur = 0;
    }
  }

  /* glints: a few vertices catch the light for a moment */
  const vtx = [...table, ...girdle.filter((_, i) => i % 2 === 0)];
  vtx.forEach((v, i) => {
    const s = Math.sin(t * 0.9 + i * 2.17); if (s < 0.985) return;
    const a = (s - 0.985) / 0.015, [x, y] = P(dia(v)), r = 1.5 + a * 3;
    g.strokeStyle = dark ? `rgba(235,240,255,${(a * 0.9).toFixed(3)})` : col(a * 0.9); g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r); g.stroke();
  });

  /* case: front edges and glass over the stone, with bright corner brackets */
  for (let k = 1; k < 14; k++) { const y = -H + (k / 14) * 2 * H; for (const [a, b] of WALLS) { const A = [a[0], y, a[2]], B = [b[0], y, b[2]]; if (front(A, B)) line(A, B, 0.05); } }
  for (const [a, b] of CASE_EDGES) if (front(a, b)) line(a, b, 0.55, 0.9);
  for (const p of CORNERS) for (let d = 0; d < 3; d++) { const q = [...p]; q[d] = p[d] * 0.82; line(p, q, 0.95 * depth(p), 1.4); }
}
