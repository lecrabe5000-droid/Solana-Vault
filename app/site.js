// Ticks the hero mock's countdown. Purely decorative.
(() => {
  const el = document.querySelector("[data-hero-clock]");
  if (!el) return;
  const b = el.querySelectorAll("b"), p = (n) => String(n).padStart(2, "0");
  let left = 2 * 86400 + 23 * 3600 + 59 * 60 + 41;
  setInterval(() => {
    left = left > 0 ? left - 1 : 3 * 86400;
    b[0].textContent = Math.floor(left / 86400);
    b[1].textContent = p(Math.floor((left % 86400) / 3600));
    b[2].textContent = p(Math.floor((left % 3600) / 60));
    b[3].textContent = p(left % 60);
  }, 1000);
})();
