// Ecrin landing. Everything moves with the scroll, nothing plays by itself.
(() => {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(pointer: fine)").matches;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const pad = (n) => String(n).padStart(2, "0");

  // ---- smooth, weighted scrolling on desktop ----
  let lenis = null;
  if (!still && fine && globalThis.Lenis) { lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 }); const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); }; requestAnimationFrame(raf); }
  const scrollToY = (y) => (lenis ? lenis.scrollTo(y, { duration: 1.2 }) : scrollTo({ top: y, behavior: still ? "auto" : "smooth" }));
  document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => { const t = document.querySelector(a.getAttribute("href")); if (t) { e.preventDefault(); scrollToY(t.getBoundingClientRect().top + scrollY); } }));

  // ---- hero: a field of on-chain nodes that assembles into the Ecrin mark ----
  const hero = document.querySelector("[data-hero]"), cv = document.querySelector("[data-net]"), ctx = cv?.getContext("2d");
  let P = [], W = 0, H = 0, DPR = 1;
  const markPoints = (n, cx, cy, s) => {
    const out = [], R = 0.32 * s, half = s / 2;
    const per = (t) => { const L = 4 * (2 * half - 2 * R) + 2 * Math.PI * R; let d = t * L; const seg = 2 * half - 2 * R, arc = (Math.PI / 2) * R;
      const pts = [[-half + R, -half, 1, 0], null, [half, -half + R, 0, 1], null, [half - R, half, -1, 0], null, [-half, half - R, 0, -1], null];
      const corners = [[half - R, -half + R, -Math.PI / 2], [half - R, half - R, 0], [-half + R, half - R, Math.PI / 2], [-half + R, -half + R, Math.PI]];
      for (let k = 0; k < 4; k++) { const [x0, y0, dx, dy] = pts[k * 2]; if (d <= seg) return [x0 + dx * d, y0 + dy * d]; d -= seg; const [ax, ay, a0] = corners[k]; if (d <= arc) { const a = a0 + d / R; return [ax + Math.cos(a) * R, ay + Math.sin(a) * R]; } d -= arc; }
      return [-half + R, -half]; };
    const frameN = Math.round(n * 0.62);
    for (let i = 0; i < frameN; i++) { const [x, y] = per(i / frameN); const j = (Math.random() - 0.5) * s * 0.05; out.push([cx + x + j, cy + y + j * 0.6]); }
    for (let i = out.length; i < n; i++) { let x, y; do { x = (Math.random() - 0.5) * 2; y = (Math.random() - 0.5) * 2; } while (Math.abs(x) / 0.36 + Math.abs(y) / 0.5 > 1); out.push([cx + x * s * 0.2, cy + y * s * 0.27]); }
    return out;
  };
  const build = () => {
    if (!cv) return; DPR = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * DPR; cv.height = H * DPR;
    const n = W < 700 ? 420 : 820, s = W < 700 ? Math.min(W * 0.52, H * 0.27) : Math.min(W * 0.26, H * 0.3), cx = W / 2, cy = H * (W < 700 ? 0.27 : 0.25);
    const targets = markPoints(n, cx, cy, s);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    P = targets.map(([tx, ty], i) => ({ x0: rnd() * W, y0: rnd() * H, tx, ty, r: 0.6 + rnd() * 1.4, d: rnd(), red: i % 37 === 0 }));
    drawHero();
  };
  const labels = ["block #21,404,118", "tx 0x9c4e…a1f2 · queued", "withdraw 24.00 SOL · 71:59:48", "block #21,404,119", "approve(0x7d1b…) · blocked", "tx 0x41f2…9be0 · confirmed"];
  let heroP = -1;
  function drawHero() {
    if (!ctx) return; const r = hero.getBoundingClientRect(), span = r.height - innerHeight; const p = still ? 1 : clamp(-r.top / span);
    if (Math.abs(p - heroP) < 0.0005 && heroP >= 0) return; heroP = p;
    const k = ease(clamp(p / 0.62));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    // links between nearby nodes while the network is loose
    if (k < 0.85) { ctx.lineWidth = 1; ctx.strokeStyle = `rgba(130,150,255,${0.12 * (1 - k)})`; ctx.beginPath(); for (let i = 0; i < P.length; i += 2) { const a = P[i], b = P[(i * 7 + 13) % P.length]; const ax = a.x0 + (a.tx - a.x0) * k, ay = a.y0 + (a.ty - a.y0) * k, bx = b.x0 + (b.tx - b.x0) * k, by = b.y0 + (b.ty - b.y0) * k; if (Math.abs(ax - bx) + Math.abs(ay - by) < 160) { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); } } ctx.stroke(); }
    for (const q of P) { const kk = ease(clamp((k - q.d * 0.18) / 0.82)); const x = q.x0 + (q.tx - q.x0) * kk, y = q.y0 + (q.ty - q.y0) * kk;
      ctx.fillStyle = q.red && k < 0.5 ? `rgba(255,120,110,${0.75 - k})` : `rgba(${150 + kk * 40},${170 + kk * 30},255,${0.35 + kk * 0.6})`; ctx.beginPath(); ctx.arc(x, y, q.r * (1 + kk * 0.35), 0, Math.PI * 2); ctx.fill(); }
    // a soft glow as the mark completes
    if (k > 0.6) { const g = ctx.createRadialGradient(W / 2, H * 0.25, 0, W / 2, H * 0.25, Math.min(W, H) * 0.45); g.addColorStop(0, `rgba(61,99,255,${0.22 * (k - 0.6) / 0.4})`); g.addColorStop(1, "rgba(61,99,255,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    // on-chain labels drift away as the mark forms
    ctx.font = `500 ${W < 700 ? 10 : 11}px "JetBrains Mono", monospace`; labels.forEach((t, i) => { const a = clamp(0.55 - k * 1.1); if (a <= 0) return; ctx.fillStyle = `rgba(150,165,220,${a})`; const lx = ((i * 0.27 + 0.08) % 0.9) * W, ly = H * (0.12 + ((i * 0.31) % 0.6)) - p * 120; ctx.fillText(t, lx, ly); });
    // the words arrive in order with the scroll
    document.querySelectorAll("[data-h]").forEach((el) => { const i = Number(el.dataset.h); el.style.setProperty("--o", String(still ? 1 : clamp((p - 0.02 - i * 0.12) / 0.16))); });
    document.querySelector("[data-cue]")?.style.setProperty("--c", String(clamp(1 - p * 6)));
  }

  // ---- explore: vertical scroll moves the curved row; hovering shows each subject ----
  const ex = document.querySelector("[data-explore]"), ring = document.querySelector("[data-ring]"), all = [...document.querySelectorAll(".subj")];
  const D = { num: document.querySelector("[data-dnum]"), tot: document.querySelector("[data-dtot]"), tag: document.querySelector("[data-dtag]"), title: document.querySelector("[data-dtitle]"), line: document.querySelector("[data-dline]"), box: document.querySelector(".ex-desc") };
  const TAG = { protect: "Protection", wallet: "Wallet", trust: "Trust" };
  let list = all.slice(), offset = 0, shownDesc = null, hoverEl = null; const progressEl = document.querySelector("[data-exprog]");
  const PER = () => (innerWidth < 860 ? 1.05 : 1.1) * innerHeight;
  const sizeEx = () => { ex.style.height = `${innerHeight + (list.length - 1) * PER()}px`; };
  const desc = (el) => { if (!el || el === shownDesc) return; shownDesc = el; const i = list.indexOf(el);
    D.num.textContent = pad(i + 1); D.tot.textContent = pad(list.length); D.tag.textContent = TAG[el.dataset.tag]; D.title.textContent = el.querySelector("h3").textContent; D.line.textContent = el.dataset.line;
    D.box.classList.remove("swap"); void D.box.offsetWidth; D.box.classList.add("swap"); };
  const layoutRow = () => {
    const w = all[0].offsetWidth + Math.max(14, innerWidth * 0.012), R = Math.max(innerWidth * 0.95, 900), n = list.length;
    all.forEach((el) => el.classList.toggle("hide", !list.includes(el)));
    list.forEach((el, i) => { const x = (i - offset) * w, a = x / R, z = (1 - Math.cos(a)) * R * 0.9;
      el.style.transform = `translate3d(${Math.sin(a) * R}px, 0, ${z}px) rotateY(${-a * 57.3}deg)`; el.style.zIndex = String(1000 - Math.round(Math.abs(x))); el.classList.toggle("cur", Math.abs(x) < w / 2); });
    if (!hoverEl) desc(list[clamp(Math.round(offset), 0, n - 1)]);
    if (progressEl) progressEl.style.transform = `scaleX(${n > 1 ? offset / (n - 1) : 1})`;
  };
  let exTarget = 0, exAnim = 0;
  const hold = (raw) => { const i = Math.floor(raw), f = raw - i; const g = f < 0.3 ? 0 : f > 0.7 ? 1 : ease((f - 0.3) / 0.4); return i + g; }; // each subject rests, then glides on
  const exStep = () => { exAnim = 0; offset += (exTarget - offset) * (still ? 1 : 0.1); if (Math.abs(exTarget - offset) < 0.0008) offset = exTarget; else exAnim = requestAnimationFrame(exStep); layoutRow(); };
  const exFrame = () => { const r = ex.getBoundingClientRect(); const p = clamp(-r.top / Math.max(1, r.height - innerHeight)); exTarget = hold(p * (list.length - 1)); if (!exAnim) exAnim = requestAnimationFrame(exStep); };
  all.forEach((el) => { el.addEventListener("pointerenter", () => { if (!fine) return; hoverEl = el; desc(el); }); el.addEventListener("pointerleave", () => { hoverEl = null; layoutRow(); }); });
  document.querySelectorAll(".tabs [data-f]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs [data-f]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    list = b.dataset.f === "all" ? all.slice() : all.filter((el) => el.dataset.tag === b.dataset.f); shownDesc = null; sizeEx();
    scrollToY(ex.getBoundingClientRect().top + scrollY); setTimeout(exFrame, 50);
  }));
  // card visuals are sized from the card's own width
  const sizeArt = (a) => a.style.setProperty("--u", `${a.offsetWidth / 100}px`);
  const ro = "ResizeObserver" in window ? new ResizeObserver((es) => es.forEach((e) => sizeArt(e.target))) : null;
  document.querySelectorAll(".art").forEach((a) => { sizeArt(a); ro?.observe(a); });
  let LOGOS = [];
  fetch("/preview/logos.json").then((r) => r.json()).then((l) => { LOGOS = l; document.querySelectorAll("[data-logos]").forEach((el) => { el.innerHTML = l.slice(0, 10).map(([, svg]) => `<i>${svg}</i>`).join(""); }); }).catch(() => {});

  // ---- blocks below rise with the scroll ----
  const rise = [...document.querySelectorAll("[data-s]")];
  const riseFrame = () => rise.forEach((el) => { const r = el.getBoundingClientRect(); el.style.setProperty("--o", String(still ? 1 : clamp((innerHeight - r.top) / (innerHeight * 0.35)))); });

  // ---- one loop for everything scroll-driven ----
  let ticking = false;
  const frame = () => { ticking = false; drawHero(); exFrame(); riseFrame(); };
  const ask = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  addEventListener("scroll", ask, { passive: true });
  addEventListener("resize", () => { build(); sizeEx(); heroP = -1; ask(); });
  build(); sizeEx(); frame();

  // ---- a subject, opened: the scene plays out as you read its chapters ----
  const viewer = document.querySelector("[data-viewer]"), vscene = document.querySelector("[data-vscene]"), vtext = document.querySelector("[data-vtext]"), vsteps = document.querySelector("[data-vsteps]"), vcount = document.querySelector("[data-vcount]");
  let openEl = null, chIO = null;
  const setStep = (s) => {
    const svg = vscene.querySelector("svg"); if (!svg) return; vscene.dataset.step = s;
    svg.querySelectorAll("[data-in]").forEach((g) => g.classList.toggle("vis", Number(g.dataset.in) <= s));
    svg.querySelectorAll("[data-out]").forEach((g) => g.classList.toggle("gone", Number(g.dataset.out) <= s));
    if (s >= 1) svg.querySelectorAll("animateMotion").forEach((m, i) => { if (!m.dataset.ran) { m.dataset.ran = 1; setTimeout(() => { try { m.beginElement(); } catch (_) {} }, i * 180); } });
    vsteps.querySelectorAll("i").forEach((d, i) => d.classList.toggle("on", i === s));
    vtext.querySelectorAll(".v-ch").forEach((c, i) => c.classList.toggle("on", i === s));
  };
  const open = (el, push = true) => {
    openEl = el; const chs = [...el.querySelectorAll(".chapters section")], i = list.indexOf(el);
    vscene.innerHTML = globalThis.EcrinScenes ? EcrinScenes.build(el.dataset.scene) : ""; if (LOGOS.length) EcrinScenes.fillLogos(vscene, LOGOS);
    vsteps.innerHTML = chs.map(() => "<i></i>").join("");
    vcount.textContent = `${pad(i + 1)} / ${pad(list.length)}`;
    vtext.innerHTML = `<header class="v-head"><p class="ex-meta mono"><b>${pad(i + 1)}</b><span>/</span><span>${pad(list.length)}</span><i></i><span>${TAG[el.dataset.tag]}</span></p><h2>${el.querySelector("h3").textContent}</h2><p>${el.dataset.line}</p></header>`
      + chs.map((c, k) => `<section class="v-ch"><span class="n">${pad(k + 1)}</span>${c.innerHTML}</section>`).join("")
      + `<div class="v-end"><a class="btn" href="https://chromewebstore.google.com/detail/ecrin-wallet/nmehcocofmbhkjgjhbhbnfmhcbjpcpbd" target="_blank" rel="noopener">Add to Chrome</a><p>Free. The Safe is in early access and not audited yet: start with small amounts.</p></div>`;
    viewer.hidden = false; lenis?.stop(); document.documentElement.style.overflow = "hidden"; vtext.scrollTop = 0; requestAnimationFrame(() => viewer.classList.add("on"));
    chIO?.disconnect(); chIO = new IntersectionObserver((es) => { const vis = es.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]; if (vis) setStep([...vtext.querySelectorAll(".v-ch")].indexOf(vis.target)); }, { root: vtext, rootMargin: "-35% 0px -35% 0px", threshold: [0, 0.25, 0.5, 1] });
    vtext.querySelectorAll(".v-ch").forEach((c) => chIO.observe(c)); setStep(0);
    if (push) history.pushState({ s: el.id }, "", "#" + el.id);
  };
  const close = (pop = false) => { if (viewer.hidden) return; viewer.classList.remove("on"); chIO?.disconnect(); setTimeout(() => { viewer.hidden = true; document.documentElement.style.overflow = ""; lenis?.start(); }, 450); if (!pop && location.hash) history.pushState({}, "", location.pathname + location.search); };
  const step = (d) => { const i = list.indexOf(openEl), n = list.length; open(list[(i + d + n) % n]); };
  all.forEach((el) => { el.tabIndex = 0; el.setAttribute("role", "button"); el.setAttribute("aria-label", "Open " + el.querySelector("h3").textContent); el.addEventListener("click", () => open(el)); el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(el); } }); });
  viewer.querySelector("[data-close]").addEventListener("click", () => close());
  viewer.querySelector("[data-vprev]").addEventListener("click", () => step(-1));
  viewer.querySelector("[data-vnext]").addEventListener("click", () => step(1));
  addEventListener("keydown", (e) => { if (viewer.hidden) return; if (e.key === "Escape") close(); if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); });
  addEventListener("popstate", () => { const el = location.hash && document.getElementById(location.hash.slice(1)); if (el?.classList.contains("subj")) open(el, false); else close(true); });
  if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el?.classList.contains("subj")) setTimeout(() => open(el, false), 200); }
})();
