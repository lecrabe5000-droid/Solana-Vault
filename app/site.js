// Landing page motion: entrance, reveal on scroll, progress bar, hero tilt and parallax,
// card spotlight, and the pinned scroll story. Everything is decorative and respects reduced motion.
(() => {
  const root = document.documentElement;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.classList.add("js");
  const p = (n) => String(n).padStart(2, "0");

  // Hero mock countdown.
  const hero = document.querySelector("[data-hero-clock]");
  if (hero) {
    const b = hero.querySelectorAll("b");
    let left = 2 * 86400 + 23 * 3600 + 59 * 60 + 41;
    setInterval(() => {
      left = left > 0 ? left - 1 : 3 * 86400;
      b[0].textContent = Math.floor(left / 86400); b[1].textContent = p(Math.floor((left % 86400) / 3600));
      b[2].textContent = p(Math.floor((left % 3600) / 60)); b[3].textContent = p(left % 60);
    }, 1000);
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
  const mock = document.querySelector(".mock"), heroS = document.querySelector(".hero-s");
  if (mock && heroS && matchMedia("(pointer: fine)").matches) {
    heroS.addEventListener("pointermove", (e) => {
      const r = heroS.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, yy = (e.clientY - r.top) / r.height - 0.5;
      mock.style.setProperty("--ry", (x * 8).toFixed(2) + "deg"); mock.style.setProperty("--rx", (-yy * 6).toFixed(2) + "deg");
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
