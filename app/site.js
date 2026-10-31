// Landing page motion: entrance, reveal on scroll, progress bar, hero tilt and parallax,
// card spotlight, and the pinned scroll story. Everything is decorative and respects reduced motion.
(() => {
  const root = document.documentElement;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.classList.add("js");
  const p = (n) => String(n).padStart(2, "0");

  // Theme switch (theme.js already applied the saved or device theme before paint).
  document.querySelectorAll("[data-theme-toggle]").forEach((b) => b.addEventListener("click", () => {
    const t = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = t;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#0c0d0f" : "#f6f6f3");
    try { localStorage.setItem("ecrin-theme", t); } catch (_) {}
  }));

  // Phone menu: a full-screen sheet; any link inside closes it.
  const menuBtn = document.querySelector("[data-menu]"), menu = document.querySelector("[data-mmenu]");
  const setMenu = (open) => { menu.hidden = !open; menuBtn.setAttribute("aria-expanded", open); root.classList.toggle("menu-open", open); };
  menuBtn?.addEventListener("click", () => setMenu(menu.hidden));
  menu?.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && menu && !menu.hidden) setMenu(false); });

  // Comparison and security tables become stacked cards on phones: each cell carries its column name.
  document.querySelectorAll("table").forEach((t) => {
    const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    t.querySelectorAll("tbody tr").forEach((tr) => [...tr.children].forEach((td, i) => td.setAttribute("data-label", heads[i] || "")));
  });

  // Sticky "Open the app" bar on phones once the hero is passed, hidden again at the final call to action.
  const mcta = document.querySelector("[data-mcta]"), heroEnd = document.querySelector(".hero-s"), finalCta = document.querySelector(".cta-s");
  if (mcta && heroEnd && "IntersectionObserver" in window) {
    let pastHero = false, atEnd = false, inStory = false;
    const show = () => mcta.classList.toggle("on", pastHero && !atEnd && !inStory);
    const story = document.querySelector("#story .story");
    if (story) new IntersectionObserver(([e]) => { inStory = e.isIntersecting; show(); }, { rootMargin: "-10% 0px -10% 0px" }).observe(story);
    new IntersectionObserver(([e]) => { pastHero = !e.isIntersecting && e.boundingClientRect.top < 0; show(); }).observe(heroEnd);
    if (finalCta) new IntersectionObserver(([e]) => { atEnd = e.isIntersecting; show(); }).observe(finalCta);
  }

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

  // Story steps drive the pinned device. The active step is the last one whose top has passed a line on
  // screen (on phones, part way down the space left under the pinned vault). Read from the scroll position on every
  // frame, so it stays right on iPhone Safari while its toolbar grows and shrinks.
  const steps = [...document.querySelectorAll(".step")];
  if (steps.length && device) {
    let active = -1, queued = false;
    const pick = () => {
      queued = false;
      const pin = innerWidth <= 960 && document.querySelector(".story-pin");
      const below = pin ? pin.getBoundingClientRect().bottom : 0;
      const line = pin ? below + (innerHeight - below) * 0.35 : innerHeight * 0.55;
      let i = 0;
      steps.forEach((s, k) => { if ((pin ? s.querySelector("h3") : s).getBoundingClientRect().top < line) i = k; });
      if (i === active) return;
      active = i;
      steps.forEach((s, k) => s.classList.toggle("on", k === i));
      device.dataset.state = steps[i].dataset.step;
    };
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(pick); } };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll, { passive: true });
    pick();
  }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  if (calm) return;

  // Reveal on scroll, staggered within each group.
  const groups = [".sec-head", ".threat", ".path", ".steps li", ".feat", ".tier", ".table-card", ".status-row", ".stage", ".who article", ".help", ".faq details", ".cta-s .wrap > *"];
  const els = [];
  const phone = matchMedia("(max-width: 560px)").matches, carousel = ".threats, .paths, .feats, .tiers, .road, .who";
  groups.forEach((sel) => document.querySelectorAll(sel).forEach((el) => {
    if (phone && el.parentElement.matches(carousel)) return;
    const sibs = [...el.parentElement.children].filter((c) => c.matches(sel));
    el.style.setProperty("--d", Math.min(sibs.indexOf(el), 6) * 0.07 + "s");
    el.classList.add("rv"); els.push(el);
  }));
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px 8% 0px" });
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
