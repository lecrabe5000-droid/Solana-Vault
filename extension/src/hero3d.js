// The Wall of Time: the landing page hero.
// A glass Ecrin diamond floats inside its Safe. Attacks fly in as red light (a drainer, a phishing signature, a stolen
// phrase, a 2 AM impulse), hit an invisible shell, freeze in mid-air with a countdown on them, and dissolve. Visitors can
// tap anywhere to throw one themselves. Only blue, ivory and black, plus red for the attacks.
// Bundled into app/hero3d.js; site.js loads it after the page has appeared.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

const TAU = Math.PI * 2, rnd = (a, b) => a + Math.random() * (b - a), clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = (k) => 1 - Math.pow(1 - k, 3);
const RED = new THREE.Color("#ff3d4f"), ICE = new THREE.Color("#cfd9ff"), BLUE = new THREE.Color("#2f5bff");
const SHIELD_R = 2.15;

/* ---------- the diamond: a brilliant cut, flat facets so every face catches light ---------- */
function brilliant() {
  const G = 32, T = 16, CROWN = 0.5, PAV = 1.2, TABLE = 0.55;
  const ring = (n, r, y, off = 0) => Array.from({ length: n }, (_, i) => { const a = ((i + off) / n) * TAU; return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r); });
  const girdle = ring(G, 1, 0), girdle2 = ring(G, 1, -0.04), table = ring(T, TABLE, CROWN, 0.5), top = new THREE.Vector3(0, CROWN, 0), culet = new THREE.Vector3(0, -PAV, 0);
  const tris = [];
  for (let i = 0; i < T; i++) {
    const g0 = girdle[2 * i], g1 = girdle[2 * i + 1], g2 = girdle[(2 * i + 2) % G], t0 = table[i], t1 = table[(i + 1) % T];
    tris.push([t0, g1, g0], [t0, g2, g1], [t0, t1, g2], [top, t1, t0]);
  }
  for (let j = 0; j < G; j++) { const a = girdle[j], b = girdle[(j + 1) % G], a2 = girdle2[j], b2 = girdle2[(j + 1) % G]; tris.push([a, a2, b], [b, a2, b2], [a2, culet, b2]); }
  const pos = new Float32Array(tris.length * 9); tris.forEach((t, i) => t.forEach((v, k) => v.toArray(pos, i * 9 + k * 3)));
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}

/* ---------- the Safe: the wallet's lozenge, a rounded square turned 45° ---------- */
function lozengePath(half, r) {
  const c = half - r, pts = [], corners = [[c, c, 0], [-c, c, 1], [-c, -c, 2], [c, -c, 3]];
  corners.forEach(([cx, cy, q], k) => {
    for (let i = 0; i <= 18; i++) { const a = (q * Math.PI) / 2 + (i / 18) * (Math.PI / 2); pts.push(new THREE.Vector3(cx + r * Math.cos(a), cy + r * Math.sin(a), 0)); }
    const [nx, ny, nq] = corners[(k + 1) % 4], a1 = ((q + 1) * Math.PI) / 2, from = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)], to = [nx + r * Math.cos((nq * Math.PI) / 2), ny + r * Math.sin((nq * Math.PI) / 2)];
    for (let i = 1; i < 14; i++) { const f = i / 14; pts.push(new THREE.Vector3(from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, 0)); }
  });
  return new THREE.CatmullRomCurve3(pts, true, "centripetal");
}

/* ---------- the shell: invisible until hit, then it ripples from the impact ---------- */
const MAX_HITS = 8;
function shellMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uT: { value: 0 }, uHits: { value: Array.from({ length: MAX_HITS }, () => new THREE.Vector4(0, 0, 0, -99)) }, uColor: { value: new THREE.Color("#7d97ff") } },
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vec4 w = modelMatrix * vec4(position,1.); vP = w.xyz; vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uT; uniform vec4 uHits[${MAX_HITS}]; uniform vec3 uColor; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      float hex(vec3 p){ vec3 q = abs(fract(p*3.2)-.5); return smoothstep(.46,.5,max(q.x,max(q.y,q.z))); }
      void main(){
        float fres = pow(1. - abs(dot(vN, vV)), 3.);
        float a = fres * .05;
        for (int i = 0; i < ${MAX_HITS}; i++) {
          float age = uT - uHits[i].w; if (age < 0. || age > 2.2) continue;
          float d = distance(normalize(vP), normalize(uHits[i].xyz)) * ${SHIELD_R.toFixed(2)};
          float front = age * 1.6;
          float ring = exp(-pow((d - front) * 5.5, 2.)) * (1. - age / 2.2);
          float core = exp(-d * 3.5) * exp(-age * 2.6);
          a += ring * .38 + core * .55;
        }
        gl_FragColor = vec4(uColor * a * 1.6, a);
      }`,
  });
}

/* ---------- soft round sprite for glows and dust ---------- */
function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,.55)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const WORDS = {
  en: { kinds: ["Drainer", "Casino deposit", "Phishing signature", "One more bet", "Stolen seed phrase", "Chasing losses", "Malicious approval", "100x leverage", "SIM swap", "Revenge trade"], frozen: "frozen", stopped: (n) => `${n} attack${n === 1 ? "" : "s"} stopped`, through: "0 got through", hint: "Tap anywhere to attack the Safe" },
  fr: { kinds: ["Drainer", "Dépôt au casino", "Signature d'hameçonnage", "Encore un pari", "Phrase secrète volée", "Courir après ses pertes", "Approbation piégée", "Levier x100", "Vol de carte SIM", "Trade de revanche"], frozen: "gelé", stopped: (n) => `${n} attaque${n > 1 ? "s" : ""} stoppée${n > 1 ? "s" : ""}`, through: "0 passée", hint: "Touchez n'importe où pour attaquer le Coffre" },
};

export function mountWall({ canvas, labels, onCount, lang = "en", still = false }) {
  const L = WORDS[lang] || WORDS.en;
  const mobile = matchMedia("(max-width: 860px)").matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100); cam.position.set(0, 0, 11.5);
  const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 1.05;

  const world = new THREE.Group(); scene.add(world);
  // a backdrop the glass can bend: a deep blue glow behind the stone
  const tex = glowTexture();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: BLUE, transparent: true, opacity: 0.26, depthWrite: false, blending: THREE.AdditiveBlending })); halo.scale.set(6.2, 6.2, 1); halo.position.z = -2.4; world.add(halo);
  const halo2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color("#9db0ff"), transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending })); halo2.scale.set(2.4, 2.4, 1); halo2.position.z = -1.2; world.add(halo2);

  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color("#020309"), transparent: true, opacity: 0.85, depthWrite: false })); core.scale.set(4.6, 4.6, 1); core.position.z = -1.6; world.add(core);
  const gem = new THREE.Mesh(brilliant(), new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#93a9ff"), metalness: 0, roughness: 0.015, transmission: 1, thickness: 2.3, ior: 2.42, dispersion: 5,
    attenuationColor: new THREE.Color("#2f5bff"), attenuationDistance: 1.6, specularIntensity: 0.9, envMapIntensity: 1.45,
  }));
  gem.scale.setScalar(1.12); gem.rotation.x = 0.34; world.add(gem);
  // star sparkles: tiny four-point glints that flash on the facets as the stone turns
  const starTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.12, "rgba(255,255,255,.6)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = "lighter"; for (const [w, h] of [[128, 3], [3, 128]]) { const l = g.createLinearGradient(64 - w / 2, 64 - h / 2, 64 + w / 2, 64 + h / 2); l.addColorStop(0, "rgba(255,255,255,0)"); l.addColorStop(0.5, "rgba(255,255,255,.95)"); l.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = l; g.fillRect(64 - w / 2, 64 - h / 2, w, h); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const gp = gem.geometry.attributes.position, glints = Array.from({ length: 7 }, (_, i) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, color: new THREE.Color(i % 3 ? "#ffffff" : "#c9d6ff"), transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending })); sp.userData = { at: rnd(0, 4), v: Math.floor(rnd(0, gp.count)) }; gem.add(sp); return sp; });
  // crisp facet edges, so the cut reads even on a small screen
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(gem.geometry, 1), new THREE.LineBasicMaterial({ color: new THREE.Color("#dbe3ff"), transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
  gem.add(edges);

  // the Safe: the wallet's lozenge frame, an engraved dial around it, and the shield
  const safe = new THREE.Group(); world.add(safe);
  const loz = new THREE.Mesh(new THREE.TubeGeometry(lozengePath(1.95, 0.55), 260, 0.02, 10, true), new THREE.MeshBasicMaterial({ color: new THREE.Color("#4f6fff") })); loz.rotation.z = Math.PI / 4; safe.add(loz);
  const fillGeo = new THREE.TubeGeometry(lozengePath(1.95, 0.55), 260, 0.028, 10, true); fillGeo.setDrawRange(0, 0);
  const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color("#aebfff") })); fill.rotation.z = Math.PI / 4; safe.add(fill);
  const dial = new THREE.Group(); safe.add(dial);
  const tickMat = new THREE.LineBasicMaterial({ color: new THREE.Color("#5b7cff"), transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false });
  const tick = []; for (let i = 0; i < 120; i++) { const a = (i / 120) * TAU, r0 = 3.05, r1 = i % 10 === 0 ? 3.32 : i % 5 === 0 ? 3.2 : 3.13; tick.push(Math.cos(a) * r0, Math.sin(a) * r0, 0, Math.cos(a) * r1, Math.sin(a) * r1, 0); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute("position", new THREE.Float32BufferAttribute(tick, 3)); dial.add(new THREE.LineSegments(tg, tickMat));
  const circ = (r, op) => { const p = []; for (let i = 0; i <= 256; i++) { const a = (i / 256) * TAU; p.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)); } return new THREE.Line(new THREE.BufferGeometry().setFromPoints(p), new THREE.LineBasicMaterial({ color: new THREE.Color("#5b7cff"), transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false })); };
  dial.add(circ(2.98, 0.28), circ(3.42, 0.14));
  const shellMat = shellMaterial(); const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(SHIELD_R, 6), shellMat); world.add(shell);

  // dust: a few slow motes for depth
  const N = mobile ? 140 : 260, dpos = new Float32Array(N * 3); for (let i = 0; i < N; i++) { dpos[i * 3] = rnd(-9, 9); dpos[i * 3 + 1] = rnd(-5, 5); dpos[i * 3 + 2] = rnd(-6, 2); }
  const dg = new THREE.BufferGeometry(); dg.setAttribute("position", new THREE.BufferAttribute(dpos, 3));
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ map: tex, size: 0.05, color: new THREE.Color("#8ea4ff"), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(dust);

  // bloom makes the light feel like light
  const size = new THREE.Vector2();
  const rt = new THREE.WebGLRenderTarget(2, 2, { samples: 4, type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, rt); composer.addPass(new RenderPass(scene, cam));
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.42, 0.22, 0.6); composer.addPass(bloom); composer.addPass(new OutputPass());

  /* ---------- attacks ---------- */
  const TRAIL = 26, attacks = [], burst = [];
  const centre = new THREE.Vector3();
  function launch(from) {
    const tgt = world.position.clone();
    const dir = from ? from.clone().sub(tgt).normalize() : new THREE.Vector3(rnd(-1, 1), rnd(-0.75, 0.75), rnd(-0.2, 0.5)).normalize();
    if (Math.abs(dir.x) < 0.25 && !from) dir.x += Math.sign(dir.x || 1) * 0.5;
    if (!from && copyR > 0 && dir.x < 0.1) dir.x = Math.abs(dir.x) + 0.35; // keep automatic attacks off the headline side
    dir.normalize();
    const start = tgt.clone().add(dir.clone().multiplyScalar(13)), hit = tgt.clone().add(dir.clone().multiplyScalar(SHIELD_R + 0.02));
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize().multiplyScalar(rnd(-2.2, 2.2));
    const ctrl = start.clone().lerp(hit, 0.5).add(side);
    const curve = new THREE.QuadraticBezierCurve3(start, ctrl, hit);
    const g = new THREE.BufferGeometry(), pos = new Float32Array(TRAIL * 3), col = new Float32Array(TRAIL * 3);
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: RED.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); head.scale.setScalar(0.42);
    const dots = Array.from({ length: TRAIL }, () => { const d = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: RED.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(d); return d; });
    scene.add(line, head);
    const kind = L.kinds[Math.floor(Math.random() * L.kinds.length)];
    const el = document.createElement("div"); el.className = "wot-l"; el.innerHTML = `<b>${kind}</b><span>${L.frozen} · <i>71:59:59</i></span>`; labels.append(el);
    attacks.push({ curve, line, head, dots, el, t0: clock, dur: rnd(1.05, 1.5) * (from ? 0.8 : 1), hist: [], frozenAt: -1, hit, secs: 72 * 3600 - Math.floor(rnd(0, 9)) });
  }
  let hitIdx = 0;
  function impact(p) {
    const local = p.clone().sub(world.position);
    shellMat.uniforms.uHits.value[hitIdx++ % MAX_HITS].set(local.x, local.y, local.z, clock);
    // a spark burst that slows to a stop: time takes over
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: ICE.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.setScalar(rnd(0.05, 0.12)); s.position.copy(p); scene.add(s);
      burst.push({ s, v: new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(0.8, 2.2)), t0: clock });
    }
    shake = 0.06; frozenCount++; onCount?.(frozenCount); pulse = clock;
  }

  /* ---------- layout, input, loop ---------- */
  let W = 1, H = 1, copyR = 0, clock = 0, last = performance.now(), shake = 0, frozenCount = 0, pulse = -9, nextAuto = 0.6, userAt = -99, running = true, raf = 0;
  const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  function resize() {
    const r = canvas.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false); composer.setSize(W, H); bloom.setSize(W, H); cam.aspect = W / H; cam.updateProjectionMatrix();
    const wide = W / H > 1.15, copy = host?.querySelector(".hero-copy"), cr = copy?.getBoundingClientRect(), r0 = canvas.getBoundingClientRect();
    const visH = 2 * cam.position.z * Math.tan((cam.fov * Math.PI) / 360), u = visH / H, R = 3.45; // R: the dial's radius in world units
    copyR = wide && cr ? cr.right - r0.left + 16 : 0;
    if (wide) {
      const free = cr ? r0.right - cr.right - 24 : W * 0.45, rad = Math.min(free / 2, H * 0.44);
      const sc = clamp((rad * u) / R, 0.55, 0.95), cx = (cr ? cr.right - r0.left + 24 : W * 0.55) + Math.max(free / 2, rad);
      world.position.set((cx - W / 2) * u, -0.12, 0); world.scale.setScalar(sc);
    } else {
      const free = cr ? cr.top - r0.top : H * 0.4, rad = free * 0.47, sc = clamp((rad * u) / R, 0.32, 0.8);
      world.position.set(0, (H / 2 - free / 2 - 6) * u, 0); world.scale.setScalar(sc);
    }
    renderer.getSize(size);
  }
  const host = canvas.closest(".hero-card") || canvas.parentElement;
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  host.addEventListener("pointermove", (e) => { const r = host.getBoundingClientRect(); ptr.tx = ((e.clientX - r.left) / r.width - 0.5) * 2; ptr.ty = ((e.clientY - r.top) / r.height - 0.5) * 2; }, { passive: true });
  host.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a, button, input, .hero-copy p, .hero-copy h1")) return;
    const r = canvas.getBoundingClientRect(), ndc = new THREE.Vector3(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1, 0.5).unproject(cam);
    const dir = ndc.sub(cam.position).normalize(), p = cam.position.clone().add(dir.multiplyScalar((world.position.z - cam.position.z) / dir.z));
    if (p.distanceTo(world.position) < SHIELD_R * world.scale.x) p.add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), 0).normalize().multiplyScalar(3));
    launch(p); userAt = clock;
  });
  const io = new IntersectionObserver(([en]) => { running = en.isIntersecting && !document.hidden; if (running) loop(); }, { threshold: 0.02 }); io.observe(canvas);
  document.addEventListener("visibilitychange", () => { running = !document.hidden; if (running) loop(); });

  const v = new THREE.Vector3();
  function step(dt) {
    clock += dt;
    ptr.x += (ptr.tx - ptr.x) * Math.min(1, dt * 3); ptr.y += (ptr.ty - ptr.y) * Math.min(1, dt * 3);
    gem.rotation.y += dt * 0.28; gem.rotation.x = 0.34 + ptr.y * 0.1; gem.rotation.z = Math.sin(clock * 0.4) * 0.04 - ptr.x * 0.08;
    gem.position.y = Math.sin(clock * 0.9) * 0.06;
    scene.environmentRotation.y = clock * 0.18;
    for (const sp of glints) { const d = clock - sp.userData.at; if (d > 1.1) { sp.userData.at = clock + rnd(0.4, 3.2); sp.userData.v = Math.floor(rnd(0, gp.count)); } const k2 = d < 0 ? 0 : Math.sin(Math.min(1, d / 1.1) * Math.PI); sp.position.fromBufferAttribute(gp, sp.userData.v); sp.material.opacity = k2 * 0.95; sp.material.rotation = d * 0.6; sp.scale.setScalar(0.08 + k2 * 0.3); }
    safe.rotation.y = ptr.x * 0.18; safe.rotation.x = -ptr.y * 0.12; dial.rotation.z = clock * 0.035;
    // the Safe frame fills like the wallet's ring, and pulses when an attack is stopped
    const k = Math.min(1, clock / 2.6), pk = Math.max(0, 1 - (clock - pulse) / 0.9);
    fillGeo.setDrawRange(0, Math.floor(ease(k) * fillGeo.index.count * 0.64));
    loz.material.color.setRGB(0.31 + pk * 0.45, 0.43 + pk * 0.4, 1);
    halo.material.opacity = 0.2 + pk * 0.14; halo2.material.opacity = 0.07 + Math.sin(clock * 1.3) * 0.02 + pk * 0.12;
    shellMat.uniforms.uT.value = clock;
    dust.rotation.y = clock * 0.012; dust.position.y = Math.sin(clock * 0.2) * 0.1;
    // attacks
    if (clock > nextAuto && clock - userAt > 3.5) { launch(); nextAuto = clock + rnd(1.5, 2.6); }
    for (let i = attacks.length - 1; i >= 0; i--) {
      const A = attacks[i], age = clock - A.t0;
      if (A.frozenAt < 0) {
        const u = Math.min(1, age / A.dur), uu = u * u * (3 - 2 * u) * 0.25 + u * 0.75;
        A.curve.getPoint(uu, v); A.hist.unshift(v.clone()); if (A.hist.length > TRAIL) A.hist.length = TRAIL;
        A.head.position.copy(v);
        if (u >= 1) { A.frozenAt = clock; impact(A.hit); A.el.classList.add("on"); }
      }
      const fz = A.frozenAt < 0 ? 0 : clock - A.frozenAt;
      // frozen: the light turns from red to ice, the trail draws itself in, then everything dissolves
      const cool = Math.min(1, fz / 0.45), fade = fz < 2.3 ? 1 : Math.max(0, 1 - (fz - 2.3) / 0.9);
      if (A.frozenAt >= 0) { const squeeze = Math.max(0.08, 1 - fz * 1.4); A.hist = A.hist.map((p, j) => (j === 0 ? p : A.hist[0].clone().lerp(p, squeeze))); }
      const pos = A.line.geometry.attributes.position, col = A.line.geometry.attributes.color, c = RED.clone().lerp(ICE, cool);
      for (let j = 0; j < TRAIL; j++) { const p = A.hist[Math.min(j, A.hist.length - 1)] || A.head.position; pos.setXYZ(j, p.x, p.y, p.z); const f = Math.pow(1 - j / TRAIL, 1.6) * fade; col.setXYZ(j, c.r * f, c.g * f, c.b * f); }
      pos.needsUpdate = true; col.needsUpdate = true;
      for (let j = 0; j < TRAIL; j++) { const d = A.dots[j], p = A.hist[Math.min(j, A.hist.length - 1)] || A.head.position, f = Math.pow(1 - j / TRAIL, 1.3); d.position.copy(p); d.scale.setScalar(0.05 + 0.22 * f); d.material.color.copy(c); d.material.opacity = f * 0.55 * fade; }
      A.head.material.color.copy(c); A.head.material.opacity = fade; A.head.scale.setScalar((A.frozenAt < 0 ? 0.42 : 0.3 + Math.max(0, 0.3 - fz) * 0.8) * (0.9 + Math.sin(clock * 30 + i) * 0.1 * (A.frozenAt < 0)));
      if (A.frozenAt >= 0) {
        // the label follows the frozen point on screen, and its countdown runs
        v.copy(A.head.position).project(cam);
        const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H, s = Math.max(0, A.secs - Math.floor(fz * 37));
        A.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; A.el.style.opacity = copyR && x - 110 < copyR ? 0 : fade;
        A.el.querySelector("i").textContent = `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      }
      if (fade <= 0) { for (const d of A.dots) { scene.remove(d); d.material.dispose(); } scene.remove(A.line, A.head); A.line.geometry.dispose(); A.line.material.dispose(); A.head.material.dispose(); A.el.remove(); attacks.splice(i, 1); }
    }
    for (let i = burst.length - 1; i >= 0; i--) {
      const B = burst[i], a = clock - B.t0; B.s.position.addScaledVector(B.v, dt * Math.exp(-a * 4)); B.s.material.opacity = Math.max(0, 1 - a / 1.6);
      if (a > 1.6) { scene.remove(B.s); B.s.material.dispose(); burst.splice(i, 1); }
    }
    shake *= Math.exp(-dt * 9);
    cam.position.x = ptr.x * 0.35 + (Math.random() - 0.5) * shake; cam.position.y = -ptr.y * 0.22 + (Math.random() - 0.5) * shake; cam.lookAt(world.position.x * 0.35, world.position.y * 0.35, 0);
  }
  function loop() {
    cancelAnimationFrame(raf);
    const f = (now) => { if (!running) return; const dt = Math.min(0.05, (now - last) / 1000); last = now; step(dt); composer.render(); raf = requestAnimationFrame(f); };
    last = performance.now(); raf = requestAnimationFrame(f);
  }
  if (still) { // reduced motion: one beautiful frame, a few attacks already frozen
    for (let i = 0; i < 3; i++) launch(); for (let i = 0; i < 90; i++) step(1 / 60); nextAuto = 1e9; composer.render(); running = false;
  } else loop();
  const api = {
    advance(sec) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) step(1 / 60); composer.render(); },
    stop() { running = false; cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); renderer.dispose(); },
    hint: L.hint, through: L.through,
    // where the Safe sits on screen, so a still image can be cut from the canvas
    frame() { v.copy(world.position).project(cam); const visH = 2 * cam.position.z * Math.tan((cam.fov * Math.PI) / 360); return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, r: (3.5 * world.scale.x * H) / visH, dpr: renderer.getPixelRatio() }; },
    setBackground(hex) { renderer.setClearColor(new THREE.Color(hex), 1); },
    clearAttacks() { for (const A of attacks) A.t0 = -99; nextAuto = clock + 99; },
  };
  canvas.__wot = api; return api;
}
