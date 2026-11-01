// Sets the theme before the page paints. Light unless the visitor switched it; their choice ("ecrin-theme") applies
// to every page (landing, app, security) and follows into other open tabs. The device's setting is not used.
(() => {
  const root = document.documentElement;
  const apply = (t) => {
    root.dataset.theme = t === "dark" ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#0c0d0f" : "#f6f6f3");
  };
  let t = null;
  try { t = localStorage.getItem("ecrin-theme"); } catch (_) {}
  apply(t);
  addEventListener("storage", (e) => { if (e.key === "ecrin-theme") { apply(e.newValue); dispatchEvent(new Event("ecrin-theme")); } });
})();
