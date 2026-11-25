// Ecrin landing: the Safe you can turn, the door that opens as you scroll, the screens that slide by,
// wallet pieces that drift, things that settle in as they arrive. One rAF loop, transforms only.
(() => {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const N = 48, DOORS = 24, pad = (n) => String(n).padStart(2, "0");

  // ---- the Safe: 48 pre-rendered frames; drag to turn it, it idles slowly on its own ----
  const spin = document.querySelector("[data-spin]"), img = spin?.querySelector("img");
  const hint = document.querySelector(".hint");
  if (spin && img) {
    const frames = [];
    const load = () => { for (let i = 0; i < N; i++) { const im = new Image(); im.decoding = "async"; im.src = `/preview/safe/spin-${pad(i)}.webp`; frames[i] = im; } };
    if (document.readyState === "complete") setTimeout(load, 200); else addEventListener("load", () => setTimeout(load, 200));
    let pos = 0, vel = still ? 0 : 0.035, dragging = false, lastX = 0, lastT = 0, shown = -1, seen = true;
    const show = () => { const i = ((Math.round(pos) % N) + N) % N; if (i !== shown && frames[i]?.complete) { img.src = frames[i].src; shown = i; } };
    spin.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; lastT = performance.now(); spin.classList.add("drag"); spin.setPointerCapture(e.pointerId); hint?.classList.add("gone"); });
    spin.addEventListener("pointermove", (e) => { if (!dragging) return; const dx = e.clientX - lastX, now = performance.now(); pos -= dx / 9; vel = -dx / 9 / Math.max(1, (now - lastT) / 16); lastX = e.clientX; lastT = now; show(); });
    const end = () => { dragging = false; spin.classList.remove("drag"); };
    spin.addEventListener("pointerup", end); spin.addEventListener("pointercancel", end);
    new IntersectionObserver(([e]) => { seen = e.isIntersecting; }).observe(spin);
    const idle = () => {
      if (seen && !dragging) { vel += ((still ? 0 : 0.035) - vel) * 0.04; pos += vel; show(); }
      requestAnimationFrame(idle);
    };
    requestAnimationFrame(idle);
  }

  // ---- the door: 24 frames, driven by scroll ----
  const door = document.querySelector(".door"), doorImg = document.querySelector("[data-door]"), doorFrames = [];
  if (doorImg) for (let i = 0; i < DOORS; i++) { const im = new Image(); im.decoding = "async"; im.src = `/preview/safe/open-${pad(i)}.webp`; doorFrames[i] = im; }
  const phones = document.querySelector(".phones"), track = document.querySelector("[data-track]");
  const say = document.querySelector(".say"), frags = [...document.querySelectorAll(".frag[data-speed]")];
  const il = document.querySelector(".il-h");
  const progress = (el) => { const r = el.getBoundingClientRect(), span = r.height - innerHeight; return span > 0 ? clamp(-r.top / span) : clamp((innerHeight - r.top) / (innerHeight + r.height)); };

  let ticking = false;
  const frame = () => {
    ticking = false;
    if (door && doorImg) {
      const p = still ? 1 : progress(door);
      const i = Math.round(clamp((p - 0.18) / 0.55) * (DOORS - 1));
      if (doorFrames[i]?.complete && doorImg.dataset.i !== String(i)) { doorImg.src = doorFrames[i].src; doorImg.dataset.i = i; }
      door.dataset.s = p < 0.22 ? "0" : p < 0.45 ? "1" : p < 0.72 ? "2" : "3";
    }
    if (phones && track && !still) {
      const p = progress(phones), max = Math.max(0, track.scrollWidth - innerWidth);
      track.style.transform = `translate3d(${-p * max}px,0,0)`;
    }
    if (say && !still) {
      const r = say.getBoundingClientRect(), mid = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
      if (r.bottom > 0 && r.top < innerHeight) for (const f of frags) f.style.translate = `0 ${mid * Number(f.dataset.speed) * 260}px`;
    }
    if (il && !still) { const r = il.getBoundingClientRect(); il.style.setProperty("--y", `${clamp((innerHeight - r.top) / (innerHeight + r.height)) * 100}%`); }
  };
  const ask = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  addEventListener("scroll", ask, { passive: true }); addEventListener("resize", ask); frame();

  // ---- networks: the 13 logos, copied in once from the wallet's set ----
  const logos = document.querySelector("[data-logos]");
  if (logos) fetch("/preview/logos.json").then((r) => r.json()).then((list) => { logos.innerHTML = list.map(([name, svg]) => `<span data-reveal><i>${svg}</i>${name}</span>`).join(""); reveal(); }).catch(() => {});

  // ---- arriving: settle in as they come into view ----
  const io = "IntersectionObserver" in window && !still ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" }) : null;
  function reveal() { document.querySelectorAll(".say-h, .il-p, .th-head, .card, .nets h2, .dt-head, .acc details, .end-h, .g, [data-reveal]").forEach((el, i) => { if (el.dataset.rv) return; el.dataset.rv = 1; el.setAttribute("data-reveal", ""); if (el.classList.contains("card") || el.classList.contains("g")) el.style.transitionDelay = `${(i % 3) * 80}ms`; io ? io.observe(el) : el.classList.add("in"); }); }
  reveal();
})();
