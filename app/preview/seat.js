// Preview landing: a film of the Ecrin Safe that plays with the scroll (frames rendered by tools/seat3d),
// the page colour that changes behind it, and the words that come and go. Nothing plays by itself.
(() => {
  const N = 150, still = matchMedia("(prefers-reduced-motion: reduce)").matches, phone = matchMedia("(max-width: 860px)").matches;
  const pad = (i) => String(i).padStart(3, "0");
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const film = document.querySelector("[data-film]"), cv = document.querySelector("[data-canvas]"), g = cv.getContext("2d");
  const beats = [...document.querySelectorAll("[data-beat]")].map((el) => ({ el, r: el.dataset.beat.split(",").map(Number) }));
  const counts = [...document.querySelectorAll("[data-count]")].map((el) => ({ el, r: el.dataset.count.split(",").map(Number) }));
  const giant = document.querySelector("[data-giant]"), prog = document.querySelector("[data-prog]"), root = document.documentElement;

  // ---- frames: the light set first (everything playable fast), then the sharp set, nearest the current frame first
  const lo = new Array(N), hi = new Array(N);
  const load = (set, dir, i) => new Promise((res) => { const im = new Image(); im.decoding = "async"; im.onload = () => { set[i] = im; res(); if (Math.abs(i - Math.round(cur)) < 2) draw(true); }; im.onerror = res; im.src = `/preview/seat/${dir}/f-${pad(i)}.webp?v=3`; });
  const queue = async (set, dir, order, par = 6) => { let k = 0; await Promise.all(Array.from({ length: par }, async () => { while (k < order.length) await load(set, dir, order[k++]); })); };
  const around = (c) => Array.from({ length: N }, (_, i) => i).sort((a, b) => Math.abs(a - c) - Math.abs(b - c));
  const wantHi = !phone || (devicePixelRatio || 1) > 1.5;
  (async () => { await load(lo, "lo", 0); await queue(lo, "lo", around(0).slice(1)); if (wantHi) queue(hi, "hi", around(Math.round(cur)), 4); })();

  // ---- the page colour through the film (light → ice → Ecrin blue → night)
  const STOPS = [[0, [238, 240, 245]], [0.18, [228, 234, 251]], [0.44, [228, 234, 251]], [0.5, [47, 91, 255]], [0.7, [47, 91, 255]], [0.77, [11, 13, 20]], [1, [11, 13, 20]]];
  const colourAt = (p) => { for (let i = 1; i < STOPS.length; i++) if (p <= STOPS[i][0]) { const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], k = (p - a) / Math.max(1e-6, b - a); return ca.map((v, j) => Math.round(v + (cb[j] - v) * k)); } return STOPS[STOPS.length - 1][1]; };
  const WORDS = [[0, "ECRIN"], [0.18, "WAIT"], [0.46, "CANCEL"], [0.75, "EVERY"]];
  let lastDark = null, lastWord = "";
  const paint = (p) => {
    const [r, gg, b] = colourAt(p), L = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255, dark = L < 0.45;
    const bg = `rgb(${r},${gg},${b})`; root.style.setProperty("--bg", bg); root.style.background = bg; document.body.style.background = bg;
    if (dark !== lastDark) { lastDark = dark; root.classList.toggle("dark", dark);
      root.style.setProperty("--ink", dark ? "#f4f1ea" : "#0b0d14"); root.style.setProperty("--soft", dark ? "rgba(244,241,234,.7)" : "rgba(11,13,20,.62)");
      root.style.setProperty("--line", dark ? "rgba(244,241,234,.22)" : "rgba(11,13,20,.12)"); root.style.setProperty("--giant", dark ? "rgba(255,255,255,.07)" : "rgba(11,13,20,.055)");
      root.style.color = dark ? "#f4f1ea" : "#0b0d14"; document.querySelector('meta[name="theme-color"]').content = bg; }
    const w = [...WORDS].reverse().find(([a]) => p >= a)[1]; if (w !== lastWord) { lastWord = w; giant.textContent = w; }
  };

  // ---- drawing: between two frames, blended, so slow scrolling stays smooth
  let cur = 0, target = 0, size = 0, dpr = 1, drawn = -1;
  const resize = () => { dpr = Math.min(2, devicePixelRatio || 1); size = Math.round(phone ? Math.min(innerWidth * 1.16, innerHeight * 0.68) : Math.min(innerHeight * 1.08, innerWidth * 0.68)); cv.style.setProperty("--cv", size + "px"); cv.width = cv.height = Math.round(size * dpr); drawn = -1; draw(true); };
  function pick(i) { return hi[i] || lo[i]; }
  function draw(force) {
    const f = clamp(cur, 0, N - 1), i = Math.floor(f), k = f - i, key = Math.round(f * 20);
    if (!force && key === drawn) return; drawn = key;
    const a = pick(i), b = pick(Math.min(N - 1, i + 1)); if (!a) return;
    g.clearRect(0, 0, cv.width, cv.height); g.globalAlpha = 1; g.drawImage(a, 0, 0, cv.width, cv.height);
    if (b && k > 0.02) { g.globalAlpha = k; g.drawImage(b, 0, 0, cv.width, cv.height); g.globalAlpha = 1; }
  }

  // ---- the words: each beat fades and rises in its own stretch of the film
  const fade = (p, [a, b]) => { const e = 0.035; return clamp(Math.min((p - a) / e, (b - p) / e)); };
  const scroll = () => { const r = film.getBoundingClientRect(); return clamp(-r.top / Math.max(1, r.height - innerHeight)); };
  const frame = () => {
    const p = scroll(); target = p * (N - 1);
    cur += (target - cur) * (still ? 1 : 0.22); if (Math.abs(target - cur) < 0.01) cur = target;
    draw(false); paint(p);
    for (const { el, r } of beats) { const o = r[0] <= 0 && p < r[1] ? clamp((r[1] - p) / 0.035) : r[1] > 1 ? clamp((p - r[0]) / 0.035) : fade(p, r); el.style.opacity = o.toFixed(3); el.style.setProperty("--y", ((1 - o) * 18).toFixed(1)); el.classList.toggle("on", o > 0.5); }
    for (const { el, r } of counts) { const [from, to, a, b] = r; el.textContent = Math.round(from + (to - from) * clamp((p - a) / (b - a))); }
    // desktop: the object steps aside (right) while words sit on the left, and takes the centre for the blue scene
    if (!phone) { const side = innerWidth * (p < 0.18 ? 0.21 : p < 0.6 ? 0.21 - (Math.min(p, 0.3) - 0.18) / 0.12 * 0.04 : 0.12), k = p < 0.44 ? 1 : p < 0.5 ? 1 - (p - 0.44) / 0.06 : p < 0.72 ? 0 : p < 0.78 ? (p - 0.72) / 0.06 : 1;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; cv.style.setProperty("--cx", (side * e).toFixed(1) + "px"); }
    giant.style.setProperty("--gy", (-(p * 1600) % 400 * 0.15).toFixed(1));
    if (prog) prog.style.scale = `1 ${p.toFixed(4)}`;
    requestAnimationFrame(frame);
  };

  // ---- smooth wheel on desktop, native scroll on phones
  if (!still && !phone && globalThis.Lenis) { const lenis = new Lenis({ lerp: 0.1 }); const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); }; requestAnimationFrame(raf);
    document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => { const t = document.querySelector(a.getAttribute("href")); if (!t) return; e.preventDefault();
      const r = beats.find((x) => x.el === t)?.r; lenis.scrollTo(r ? film.offsetTop + (film.offsetHeight - innerHeight) * (r[0] + 0.06) : t, { duration: 1.6 }); })); }
  addEventListener("resize", resize); resize(); requestAnimationFrame(frame);

  // ---- read everything: the subjects and their chapters, taken from the home page so both always say the same
  const list = document.querySelector("[data-read]");
  if (list) fetch("/", { credentials: "omit" }).then((r) => r.text()).then((html) => {
    const doc = new DOMParser().parseFromString(html, "text/html"), arts = [...doc.querySelectorAll("article.subj")];
    if (!arts.length) return;
    list.innerHTML = arts.map((a, i) => {
      const title = a.querySelector("h3")?.textContent || "", line = a.dataset.line || "", body = a.querySelector(".chapters")?.innerHTML || "";
      return `<details class="r" id="learn-${a.id}"><summary><span class="n mono">${String(i + 1).padStart(2, "0")}</span><b>${title}</b><span class="line">${line}</span><i class="pm" aria-hidden="true"></i></summary><div class="body">${body}</div></details>`;
    }).join("");
  }).catch(() => {});
})();
