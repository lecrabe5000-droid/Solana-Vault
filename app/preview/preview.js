// Ecrin landing: the Safe you can turn; a curved row of subjects you can scroll, drag, filter and open.
(() => {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pad = (n) => String(n).padStart(2, "0"), SPIN = 60;

  // ---- the Safe: rests facing you, sways, drag to turn it all the way round ----
  const stage = document.querySelector("[data-spin]"), img = stage?.querySelector("img");
  if (stage && img) {
    let frames = [];
    const start = () => { frames = Array.from({ length: SPIN }, (_, i) => { const im = new Image(); im.decoding = "async"; im.src = `/preview/safe/spin-${pad(i)}.webp`; return im; }); };
    if (document.readyState === "complete") setTimeout(start, 150); else addEventListener("load", () => setTimeout(start, 150));
    let pos = 5, vel = 0, drag = false, lastX = 0, shown = 5, seen = true; const FRONT = 5, t0 = performance.now();
    const show = () => { const i = ((Math.round(pos) % SPIN) + SPIN) % SPIN; if (i !== shown && frames[i]?.complete && frames[i].naturalWidth) { img.src = frames[i].src; shown = i; } };
    stage.addEventListener("pointerdown", (e) => { drag = true; lastX = e.clientX; stage.classList.add("drag"); stage.setPointerCapture(e.pointerId); });
    stage.addEventListener("pointermove", (e) => { if (!drag) return; const dx = e.clientX - lastX; lastX = e.clientX; pos -= dx / 7; vel = -dx / 7; show(); });
    const end = () => { drag = false; stage.classList.remove("drag"); }; stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", end);
    new IntersectionObserver(([e]) => { seen = e.isIntersecting; }).observe(stage);
    const loop = (t) => { if (seen && !drag && frames.length) { const sway = still ? 0 : Math.sin((t - t0) / 2600) * 3.2, k = Math.round((pos - FRONT) / SPIN); vel = vel * 0.9 + (FRONT + k * SPIN + sway - pos) * 0.012; pos += vel; show(); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // ---- card contents are sized from the card's own width (1% of it = --u) ----
  const sizeArt = (a) => a.style.setProperty("--u", `${a.offsetWidth / 100}px`);
  const ro = "ResizeObserver" in window ? new ResizeObserver((es) => es.forEach((e) => sizeArt(e.target))) : null;
  const watchArts = (root) => root.querySelectorAll(".art").forEach((a) => { sizeArt(a); ro?.observe(a); });
  watchArts(document);

  // ---- floating objects drift a little with the scroll ----
  const floats = [...document.querySelectorAll(".float[data-depth]")];
  if (!still && floats.length) addEventListener("scroll", () => { const y = scrollY; floats.forEach((f) => { f.style.transform = `translate3d(0, ${y * Number(f.dataset.depth)}px, 0)`; }); }, { passive: true });

  // ---- network logos for the Networks card ----
  fetch("/preview/logos.json").then((r) => r.json()).then((list) => document.querySelectorAll("[data-logos]").forEach((el) => { el.innerHTML = list.slice(0, 10).map(([, svg]) => `<i>${svg}</i>`).join(""); })).catch(() => {});

  // ---- the curved row ----
  const ring = document.querySelector("[data-ring]"), all = [...document.querySelectorAll(".subj")];
  const curEl = document.querySelector("[data-cur]"), countEl = document.querySelector("[data-count]");
  let list = all.slice(), offset = 0, target = 0, dragging = false, moved = 0, lastX = 0;
  const gapOf = () => all[0].getBoundingClientRect().width / (all[0].style.transform ? 1 : 1) || 300;
  const W = () => all[0].offsetWidth + Math.max(14, innerWidth * 0.012);
  const layout = () => {
    const w = W(), R = Math.max(innerWidth * 0.9, 900), n = list.length;
    all.forEach((el) => { if (!list.includes(el)) el.classList.add("hide"); });
    list.forEach((el, i) => {
      el.classList.remove("hide");
      let x = (i - offset) * w; const span = n * w; x = ((x % span) + span * 1.5) % span - span / 2; // wrap around
      const a = x / R, z = (1 - Math.cos(a)) * R * 0.9;                                             // bend toward the viewer at the edges
      el.style.transform = `translate3d(${Math.sin(a) * R}px, 0, ${z}px) rotateY(${-a * 57.3}deg)`;
      el.style.zIndex = String(1000 - Math.round(Math.abs(x)));
      el.classList.toggle("cur", Math.abs(x) < w / 2);
    });
    const i = ((Math.round(offset) % n) + n) % n, c = list[i];
    if (c && curEl) curEl.innerHTML = `<b>${c.querySelector("h3").textContent}</b><span>${c.querySelector(".sub").textContent}</span>`;
  };
  let anim = 0;
  const tick = () => { offset += (target - offset) * (still ? 1 : 0.12); layout(); if (Math.abs(target - offset) > 0.001) anim = requestAnimationFrame(tick); else { offset = target; layout(); anim = 0; } };
  const go = (t) => { target = t; if (!anim) anim = requestAnimationFrame(tick); };
  ring.addEventListener("pointerdown", (e) => { dragging = true; moved = 0; lastX = e.clientX; ring.classList.add("drag"); });
  addEventListener("pointermove", (e) => { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; moved += Math.abs(dx); target -= dx / W(); offset = target; layout(); });
  addEventListener("pointerup", () => { if (!dragging) return; dragging = false; ring.classList.remove("drag"); go(Math.round(target)); });
  // wheel / trackpad sideways scrolling moves the row; plain vertical scrolling still scrolls the page
  ring.addEventListener("wheel", (e) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); go(target + e.deltaX / W()); clearTimeout(ring._s); ring._s = setTimeout(() => go(Math.round(target)), 140); } }, { passive: false });
  document.querySelector("[data-prev]").onclick = () => go(Math.round(target) - 1);
  document.querySelector("[data-next]").onclick = () => go(Math.round(target) + 1);
  addEventListener("keydown", (e) => { if (viewer.hidden && ring.getBoundingClientRect().top < innerHeight && ring.getBoundingClientRect().bottom > 0) { if (e.key === "ArrowRight") go(Math.round(target) + 1); if (e.key === "ArrowLeft") go(Math.round(target) - 1); } });
  addEventListener("resize", layout);
  // filters
  document.querySelectorAll(".tabs [data-f]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs [data-f]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    list = b.dataset.f === "all" ? all.slice() : all.filter((el) => el.dataset.tag === b.dataset.f);
    if (countEl) countEl.textContent = String(list.length); offset = target = 0; layout();
  }));
  layout();

  // ---- opening a subject: its picture grows into the left side, the story slides in from the right ----
  const viewer = document.querySelector("[data-viewer]"), vmedia = document.querySelector("[data-vmedia]"), vbody = document.querySelector("[data-vbody]");
  let openEl = null;
  const open = (el, push = true) => {
    openEl = el; const art = el.querySelector(".art"), from = art.getBoundingClientRect();
    vmedia.innerHTML = ""; const big = art.cloneNode(true); vmedia.append(big); watchArts(vmedia);
    const gal = el.querySelector(".gal"); if (gal) vmedia.append(gal.cloneNode(true));
    vbody.innerHTML = `<h3>${el.querySelector("h3").textContent}</h3><p class="sub">${el.querySelector(".sub").textContent}</p>` + el.querySelector(".detail").innerHTML;
    viewer.hidden = false; document.body.classList.add("locked"); vmedia.scrollTop = 0; viewer.querySelector(".v-panel").scrollTop = 0;
    const to = big.getBoundingClientRect();
    if (!still) big.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})`, borderRadius: "18px" }, { transform: "none", borderRadius: "22px" }], { duration: 650, easing: "cubic-bezier(.2,.8,.15,1)" });
    requestAnimationFrame(() => viewer.classList.add("on"));
    if (push) history.pushState({ s: el.id }, "", "#" + el.id);
    viewer.querySelector("[data-close]").focus({ preventScroll: true });
  };
  const close = (pop = false) => {
    if (viewer.hidden) return; viewer.classList.remove("on");
    setTimeout(() => { viewer.hidden = true; document.body.classList.remove("locked"); }, still ? 0 : 420);
    if (!pop && location.hash) history.pushState({}, "", location.pathname + location.search);
    openEl?.querySelector(".art")?.focus?.();
  };
  all.forEach((el) => { el.tabIndex = 0; el.setAttribute("role", "button"); el.setAttribute("aria-label", "Open " + el.querySelector("h3").textContent);
    el.addEventListener("click", () => { if (moved > 6) return; const i = list.indexOf(el); const n = list.length; const cur = ((Math.round(target) % n) + n) % n; if (i !== cur) { let d = i - cur; if (d > n / 2) d -= n; if (d < -n / 2) d += n; go(Math.round(target) + d); setTimeout(() => open(el), 380); } else open(el); });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(el); } }); });
  viewer.querySelector("[data-close]").addEventListener("click", () => close());
  addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  addEventListener("popstate", () => { const el = location.hash && document.getElementById(location.hash.slice(1)); if (el?.classList.contains("subj")) open(el, false); else close(true); });
  if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el?.classList.contains("subj")) setTimeout(() => open(el, false), 300); }
})();
