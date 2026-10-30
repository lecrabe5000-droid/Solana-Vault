// Landing page motion: entrance, reveal on scroll, progress bar, hero tilt and parallax,
// card spotlight, and the pinned scroll story. Everything is decorative and respects reduced motion.
(() => {
  const root = document.documentElement;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.classList.add("js");
  const p = (n) => String(n).padStart(2, "0");

  // Theme switch (theme.js already applied the saved or device theme before paint).
  document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
    const t = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = t;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#0c0d0f" : "#f6f6f3");
    try { localStorage.setItem("ecrin-theme", t); } catch (_) {}
  });

  // The engraved pattern on every case, and the hero dial's ticks.
  document.querySelectorAll("[data-guilloche]").forEach((svg) => {
    svg.innerHTML = Array.from({ length: 34 }, (_, i) => `<circle cx="${330 + Math.cos(i / 2.2) * 14}" cy="${40 + Math.sin(i / 2.2) * 14}" r="${18 + i * 9}"/>`).join("");
  });
  const dial = document.querySelector("[data-hero-dial]");
  if (dial) {
    dial.querySelector(".ticks").innerHTML = Array.from({ length: 60 }, (_, i) => { const an = (i / 60) * 2 * Math.PI, r1 = i % 5 ? 92 : 89, x = (r) => (100 + r * Math.sin(an)).toFixed(1), y = (r) => (100 - r * Math.cos(an)).toFixed(1); return `<line x1="${x(r1)}" y1="${y(r1)}" x2="${x(96)}" y2="${y(96)}"${i % 5 ? "" : ' class="maj"'}/>`; }).join("");
    const C = 2 * Math.PI * 84, total = 72 * 3600, arc = dial.querySelector(".d-arc"), b = dial.querySelector(".d-in b"), sp = dial.querySelector(".d-in span");
    arc.setAttribute("stroke-dasharray", C.toFixed(2));
    let left = total - 12;
    const draw = () => { b.textContent = `${p(Math.floor(left / 3600))}:${p(Math.floor((left % 3600) / 60))}`; sp.textContent = `${p(left % 60)}s`; arc.setAttribute("stroke-dashoffset", (C * (1 - left / total)).toFixed(2)); };
    draw(); setInterval(() => { left = left > 1 ? left - 1 : total - 12; draw(); }, 1000);
  }

  // Story clock: ticks only while the "queued" step is showing.
  const device = document.querySelector(".device");
  let storyLeft = 72 * 3600 - 12;
  setInterval(() => {
    if (!device || device.dataset.state !== "1") return;
    storyLeft--;
    device.querySelector('[data-sc="h"]').textContent = p(Math.floor(storyLeft / 3600));
    device.querySelector('[data-sc="m"]').textContent = p(Math.floor((storyLeft % 3600) / 60));
    device.querySelector('[data-sc="s"]').textContent = p(storyLeft % 60);
  }, 1000);

  // Story steps drive the pinned device.
  const steps = [...document.querySelectorAll(".step")];
  if (steps.length && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      steps.forEach((s) => s.classList.toggle("on", s === e.target));
      if (device) device.dataset.state = e.target.dataset.step;
    }), { rootMargin: matchMedia("(max-width: 960px)").matches ? "-66% 0px -26% 0px" : "-45% 0px -45% 0px" }); // phones: the pinned vault covers the top half
    steps.forEach((s) => io.observe(s));
    steps[0].classList.add("on");
  }

  if (calm) return;

  // Reveal on scroll, staggered within each group.
  const groups = [".sec-head", ".threat", ".path", ".steps li", ".feat", ".tier", ".table-card", ".status-row", ".stage", ".who article", ".help", ".faq details", ".cta-s .wrap > *"];
  const els = [];
  groups.forEach((sel) => document.querySelectorAll(sel).forEach((el) => {
    const sibs = [...el.parentElement.children].filter((c) => c.matches(sel));
    el.style.setProperty("--d", Math.min(sibs.indexOf(el), 6) * 0.07 + "s");
    el.classList.add("rv"); els.push(el);
  }));
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -10% 0px" });
    els.forEach((el) => io.observe(el));
  } else els.forEach((el) => el.classList.add("in"));

  // Scroll progress and hero parallax.
  const bar = document.querySelector(".progress i");
  let ticking = false;
  const onScroll = () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      const y = scrollY, max = root.scrollHeight - innerHeight;
      if (bar) bar.style.setProperty("--p", max > 0 ? (y / max).toFixed(4) : 0);
      if (y < innerHeight * 1.2) root.style.setProperty("--sy", y.toFixed(0));
      ticking = false;
    });
  };
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  // Hero card tilts toward the pointer (desktop pointers only).
  const mock = document.querySelector(".hero-visual .case"), heroS = document.querySelector(".hero-s");
  if (mock && heroS && matchMedia("(pointer: fine)").matches) {
    heroS.addEventListener("pointermove", (e) => {
      const r = heroS.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, yy = (e.clientY - r.top) / r.height - 0.5;
      mock.style.setProperty("--ry", (x * 10).toFixed(2) + "deg"); mock.style.setProperty("--rx", (-yy * 8).toFixed(2) + "deg");
      mock.style.setProperty("--mx", ((x + 0.5) * 100).toFixed(1) + "%"); mock.style.setProperty("--my", ((yy + 0.5) * 100).toFixed(1) + "%");
    });
    heroS.addEventListener("pointerleave", () => { mock.style.setProperty("--ry", "0deg"); mock.style.setProperty("--rx", "0deg"); });
  }

  // Soft spotlight that follows the pointer on cards.
  document.addEventListener("pointermove", (e) => {
    const c = e.target.closest?.(".threat, .feat, .path, .tier, .stage");
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty("--mx", e.clientX - r.left + "px"); c.style.setProperty("--my", e.clientY - r.top + "px");
  }, { passive: true });
})();
