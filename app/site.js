// Landing page: theme switch, phone menu, card rails, the page tone that follows the scroll, the scroll story,
// reveal on scroll and the progress bar. Everything is decorative and respects reduced motion.
(() => {
  const root = document.documentElement;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.classList.add("js");
  const p = (n) => String(n).padStart(2, "0");

  // Theme switch (theme.js already applied the saved or device theme before paint).
  document.querySelectorAll("[data-theme-toggle]").forEach((b) => b.addEventListener("click", () => {
    const t = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = t;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#0c0d0f" : "#f3f2ee");
    try { localStorage.setItem("ecrin-theme", t); } catch (_) {}
  }));

  // The language you read the site in is the app's language too (i18n.js reads "ecrin-lang").
  try { if (root.lang === "fr" && !localStorage.getItem("ecrin-lang")) localStorage.setItem("ecrin-lang", "fr"); } catch (_) {}
  document.querySelectorAll("a[hreflang]").forEach((a) => a.addEventListener("click", () => { try { localStorage.setItem("ecrin-lang", a.hreflang); } catch (_) {} }));

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


  // Card rails: arrows scroll one card at a time and grey out at either end.
  document.querySelectorAll("[data-rail]").forEach((rail) => {
    const track = rail.querySelector(".rail-track"), prev = rail.querySelector("[data-rail-prev]"), next = rail.querySelector("[data-rail-next]");
    if (!track) return;
    const step = () => (track.firstElementChild?.getBoundingClientRect().width || 320) + 14;
    const sync = () => { if (prev) prev.disabled = track.scrollLeft < 4; if (next) next.disabled = track.scrollLeft + track.clientWidth > track.scrollWidth - 4; };
    prev?.addEventListener("click", () => track.scrollBy({ left: -step(), behavior: "smooth" }));
    next?.addEventListener("click", () => track.scrollBy({ left: step(), behavior: "smooth" }));
    track.addEventListener("scroll", sync, { passive: true }); addEventListener("resize", sync); sync();
  });

  // The page changes tone with the section in the middle of the screen: base, night (security), accent (the end).
  const toned = [...document.querySelectorAll("[data-tone]")];
  if (toned.length) {
    let tq = false;
    const tone = () => {
      tq = false;
      const mid = innerHeight * 0.5;
      const hit = toned.find((el) => { const r = el.getBoundingClientRect(); return r.top <= mid && r.bottom > mid; });
      const t = hit?.dataset.tone || (scrollY + innerHeight >= root.scrollHeight - 4 ? "accent" : "base");
      if (document.body.dataset.tone !== t) document.body.dataset.tone = t;
    };
    addEventListener("scroll", () => { if (!tq) { tq = true; requestAnimationFrame(tone); } }, { passive: true });
    tone();
  }

  // The playable vault in the hero: an attack arrives with a countdown; Cancel keeps the money, then the next one comes.
  const play = document.querySelector("[data-play]");
  if (play) {
    const $p = (k) => play.querySelector(`[data-pl-${k}]`);
    const fr = root.lang === "fr";
    const T = fr
      ? { asked: "Quelqu'un vient de demander un retrait", done: "Annulé · gratuit et instantané", kept: (a) => `En sécurité. Les ${a.amt} ${a.unit} ne sont jamais sortis.`, count: (n) => `${n} attaque${n > 1 ? "s" : ""} bloquée${n > 1 ? "s" : ""}` }
      : { asked: "Someone just asked to withdraw", done: "Cancelled · free and instant", kept: (a) => `Kept safe. ${a.amt} ${a.unit} never left.`, count: (n) => `${n} attack${n === 1 ? "" : "s"} stopped` };
    const attacks = [
      { amt: fr ? "24,00" : "24.00", unit: "SOL", to: "9cRt…X2pa", why: fr ? "un drainer signé par erreur" : "a drainer you signed by mistake" },
      { amt: fr ? "1 500,00" : "1,500.00", unit: "USDC", to: "0x7a3…e91F", why: fr ? "une fausse page de soutien" : "a fake support page" },
      { amt: fr ? "3,20" : "3.20", unit: "ETH", to: "0xd04…1c2B", why: fr ? "quelqu'un qui a votre phrase secrète" : "someone with your seed phrase" },
      { amt: fr ? "0,80" : "0.80", unit: "SOL", to: "CaSn…oN1t", why: fr ? "vous, à 3 h du matin, vers un casino" : "you, at 3 a.m., to a casino" },
    ];
    let k = 0, left = 72 * 3600 - 12, stopped = 0, busy = false;
    const show = () => {
      const a = attacks[k % attacks.length];
      $p("amt").textContent = a.amt; $p("unit").textContent = a.unit; $p("to").textContent = a.to; $p("why").textContent = a.why;
      $p("title").textContent = T.asked;
      play.classList.remove("safe"); play.querySelector(".pl-attack").hidden = false; play.querySelector(".pl-safe").hidden = true;
      left = 72 * 3600 - 12 - Math.floor(Math.random() * 600); busy = false;
    };
    setInterval(() => { if (busy) return; left--; $p("clock").textContent = `${p(Math.floor(left / 3600))}:${p(Math.floor((left % 3600) / 60))}:${p(left % 60)}`; }, 1000);
    $p("cancel").addEventListener("click", () => {
      if (busy) return; busy = true;
      const a = attacks[k % attacks.length];
      stopped++; navigator.vibrate?.([14, 40, 22]);
      $p("count").textContent = T.count(stopped);
      $p("safe").textContent = T.kept(a);
      $p("title").textContent = T.done;
      play.classList.add("safe"); play.querySelector(".pl-attack").hidden = true; play.querySelector(".pl-safe").hidden = false;
      k++; setTimeout(show, 2600);
    });
    show();
  }

  // Live numbers from the chains (cached by the worker); stays hidden if they can't be read.
  const live = document.querySelector("[data-stats]");
  if (live) fetch("/api/stats").then((r) => (r.ok ? r.json() : null)).then((st) => {
    if (!st || !st.vaults) return;
    const loc = root.lang === "fr" ? "fr-CA" : "en-US";
    live.querySelector('[data-st="vaults"]').textContent = st.vaults.toLocaleString(loc);
    live.querySelector('[data-st="sol"]').textContent = (Number(BigInt(st.sol || "0") / 10_000_000n) / 100).toLocaleString(loc, { maximumFractionDigits: 2 });
    live.querySelector('[data-st="networks"]').textContent = st.networks;
    live.hidden = false;
  }).catch(() => {});

  // Ecrin Wallet waitlist: the worker emails a confirmation link.
  document.querySelectorAll("[data-waitlist]").forEach((f) => f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = f.parentElement.querySelector("[data-wl-note]"), btn = f.querySelector("button"), fr = root.lang === "fr";
    btn.disabled = true;
    try {
      const r = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: f.email.value, lang: fr ? "fr" : "en" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || (fr ? "Réessayez dans une minute." : "Try again in a minute."));
      note.className = "wl-note ok";
      note.textContent = j.already ? (fr ? "Vous êtes déjà sur la liste." : "You're already on the list.") : (fr ? "Vérifiez vos courriels pour confirmer." : "Check your inbox to confirm.");
      f.reset();
    } catch (err) { note.className = "wl-note err"; note.textContent = err.message; }
    btn.disabled = false;
  }));

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

  // On phones each step shows its own copy of the vault, frozen in that step's state (CSS shows them only there).
  const device = document.querySelector(".device");
  if (device) document.querySelectorAll(".step").forEach((st) => {
    const c = device.cloneNode(true);
    c.classList.add("step-device"); c.dataset.state = st.dataset.step; c.setAttribute("aria-hidden", "true");
    st.prepend(c);
  });

  // Story clock: ticks while the "queued" vault is showing (the pinned one on that step, or the phone copy).
  let storyLeft = 72 * 3600 - 12;
  setInterval(() => {
    const live = [...document.querySelectorAll('.device[data-state="1"]')];
    if (!live.length) return;
    storyLeft--;
    for (const d of live) {
      d.querySelector('[data-sc="h"]').textContent = p(Math.floor(storyLeft / 3600));
      d.querySelector('[data-sc="m"]').textContent = p(Math.floor((storyLeft % 3600) / 60));
      d.querySelector('[data-sc="s"]').textContent = p(storyLeft % 60);
    }
  }, 1000);

  // Story steps drive the pinned device (desktop). The active step is the last one whose top has passed the
  // middle of the screen, read from the scroll position on every frame.
  const steps = [...document.querySelectorAll(".step")];
  if (steps.length && device) {
    let active = -1, queued = false;
    const pick = () => {
      queued = false;
      const line = innerHeight * 0.55;
      let i = 0;
      steps.forEach((s, k) => { if (s.getBoundingClientRect().top < line) i = k; });
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

  const fine = matchMedia("(pointer: fine)").matches;
  const phone = matchMedia("(max-width: 560px)").matches;

  // Headlines arrive word by word. Words keep their nowrap groups and the inline mark counts as a word.
  function splitWords(el) {
    let i = 0;
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const parts = n.nodeValue.split(/(\s+)/);
          const frag = document.createDocumentFragment();
          parts.forEach((p) => {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
            const w = document.createElement("span"); w.className = "w"; w.style.setProperty("--i", i++);
            const inner = document.createElement("span"); inner.textContent = p; w.appendChild(inner); frag.appendChild(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.classList.contains("mk")) { n.classList.add("w-mk"); n.style.setProperty("--i", i++); }
        else if (n.nodeType === 1) walk(n);
      });
    };
    walk(el); el.classList.add("words");
  }
  document.querySelectorAll(".hero-copy h1, .big-head h2").forEach(splitWords);

  // Reveal on scroll, staggered within each group (headlines reveal by word, rails fan in).
  const groups = [".hero-copy h1", ".big-head h2", ".big-head > :not(h2)", ".sec-head", ".steps li", ".net", ".assets-mock", ".tier", ".table-card", ".faq details", ".shortcuts h3", ".live", ".foot-card", ".compare tbody tr", ".cta-s .hero-cta"];
  const els = [];
  groups.forEach((sel) => document.querySelectorAll(sel).forEach((el) => {
    if (el.closest(".hero-copy") && !el.matches("h1")) return;
    const sibs = [...el.parentElement.children].filter((c) => c.matches(sel));
    el.style.setProperty("--d", Math.min(sibs.indexOf(el), 8) * 0.07 + "s");
    el.classList.add(el.matches("h1, h2") ? "rv-w" : "rv"); els.push(el);
  }));
  document.querySelectorAll(".rail").forEach((r) => { r.classList.add("rv-rail"); els.push(r); [...r.querySelectorAll(".rail-track > *")].forEach((c, k) => c.style.setProperty("--k", Math.min(k, 6))); });
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -6% 0px" });
    els.forEach((el) => io.observe(el));
  } else els.forEach((el) => el.classList.add("in"));

  // Scroll: progress bar, and the hero card settling back (a slight zoom out) as you leave it.
  const bar = document.querySelector(".progress i"), heroCard = document.querySelector(".hero-card");
  let ticking = false;
  const onScroll = () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      const y = scrollY, max = root.scrollHeight - innerHeight;
      if (bar) bar.style.setProperty("--p", max > 0 ? (y / max).toFixed(4) : 0);
      if (heroCard && y < innerHeight * 1.4) {
        const k = Math.min(1, y / (innerHeight * 0.9));
        heroCard.style.setProperty("--hz", (1 - k * 0.06).toFixed(4));
        heroCard.style.setProperty("--hy", (k * 40).toFixed(1) + "px");
      }
      ticking = false;
    });
  };
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  // The hero follows the pointer: the ribbons drift against it, the card leans a little.
  if (heroCard && fine) {
    let raf = 0, tx = 0, ty = 0, cx = 0, cy = 0;
    const loop = () => {
      cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
      heroCard.style.setProperty("--px", cx.toFixed(4)); heroCard.style.setProperty("--py", cy.toFixed(4));
      raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.001 ? requestAnimationFrame(loop) : 0;
    };
    heroCard.addEventListener("pointermove", (e) => {
      const r = heroCard.getBoundingClientRect(); tx = (e.clientX - r.left) / r.width - 0.5; ty = (e.clientY - r.top) / r.height - 0.5;
      heroCard.style.setProperty("--gx", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%"); heroCard.style.setProperty("--gy", ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%");
      if (!raf) raf = requestAnimationFrame(loop);
    });
    heroCard.addEventListener("pointerleave", () => { tx = 0; ty = 0; if (!raf) raf = requestAnimationFrame(loop); });
  }

  // Magnetic buttons: the main calls to action lean toward the pointer.
  if (fine) document.querySelectorAll(".hero-cta .btn, .nav-cta .btn.blue, .cta-s .btn, .wl-form .btn, .pl-btn").forEach((b) => {
    b.classList.add("mag");
    b.addEventListener("pointermove", (e) => { const r = b.getBoundingClientRect(); b.style.setProperty("--mx", ((e.clientX - r.left - r.width / 2) * 0.22).toFixed(1) + "px"); b.style.setProperty("--my", ((e.clientY - r.top - r.height / 2) * 0.3).toFixed(1) + "px"); });
    b.addEventListener("pointerleave", () => { b.style.setProperty("--mx", "0px"); b.style.setProperty("--my", "0px"); });
  });

  // A soft light follows the pointer across the cards.
  if (fine) document.addEventListener("pointermove", (e) => {
    const c = e.target.closest?.(".tcard, .hcard, .scard, .tier, .stage, .assets-mock, .play");
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty("--lx", e.clientX - r.left + "px"); c.style.setProperty("--ly", e.clientY - r.top + "px");
  }, { passive: true });

  // Rails can be dragged with the mouse, with a little momentum.
  if (fine) document.querySelectorAll(".rail-track").forEach((t) => {
    let down = false, sx = 0, sl = 0, v = 0, last = 0, moved = false;
    t.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse" || e.target.closest("a, button")) return; down = true; moved = false; sx = e.clientX; sl = t.scrollLeft; last = e.clientX; v = 0; t.classList.add("dragging"); });
    addEventListener("pointermove", (e) => { if (!down) return; const dx = e.clientX - sx; if (Math.abs(dx) > 4) moved = true; t.scrollLeft = sl - dx; v = e.clientX - last; last = e.clientX; });
    addEventListener("pointerup", () => {
      if (!down) return; down = false; t.classList.remove("dragging");
      let vel = -v * 1.6; const glide = () => { if (Math.abs(vel) < 0.5) return; t.scrollLeft += vel; vel *= 0.92; requestAnimationFrame(glide); }; glide();
    });
    t.addEventListener("click", (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
  });

  // Numbers count up when they come into view.
  const countUp = (el) => {
    const raw = el.textContent.trim(), fr = root.lang === "fr";
    const num = Number(raw.replace(/[^\d.,]/g, "").replace(fr ? /\s|\./g : /,/g, "").replace(",", "."));
    if (!Number.isFinite(num) || num === 0) return;
    const dec = (raw.split(fr ? "," : ".")[1] || "").replace(/\D/g, "").length, loc = fr ? "fr-CA" : "en-US", t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 1400), e = 1 - Math.pow(1 - k, 4); el.textContent = (num * e).toLocaleString(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec }); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  const liveBox = document.querySelector("[data-stats]");
  if (liveBox && "MutationObserver" in window) new MutationObserver(() => { if (!liveBox.hidden && !liveBox.dataset.counted) { liveBox.dataset.counted = "1"; liveBox.querySelectorAll("b").forEach(countUp); } }).observe(liveBox, { attributes: true });

})();

// The wallet in the hero: its net worth counts up once, the way the real wallet does when it opens.
(() => {
  const el = document.querySelector(".hero-phone [data-count]");
  if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const end = Number(el.dataset.count), fmt = (v) => "$" + Math.round(v).toLocaleString("en-US");
  const t0 = performance.now() + 700, dur = 1800;
  el.textContent = fmt(end * 0.82);
  const step = (now) => {
    const k = Math.min(1, Math.max(0, (now - t0) / dur)), e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(end * (0.82 + 0.18 * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
})();
