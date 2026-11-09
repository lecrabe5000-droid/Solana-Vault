// Sets the theme before the page paints. Light unless the visitor switched it; their choice ("ecrin-theme") applies
// to every page (landing, app, security) and follows into other open tabs. The device's setting is not used.
(() => {
  const root = document.documentElement;
  // "ecrin" is the wallet's Ecrin mode: dark, with the ink-blue skin where a page has one (the app does).
  const apply = (t) => {
    root.dataset.theme = t === "dark" || t === "ecrin" ? "dark" : "light";
    if (t === "ecrin") root.dataset.skin = "ecrin"; else delete root.dataset.skin;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "ecrin" ? "#070b1d" : t === "dark" ? "#0c0d0f" : "#f6f6f3");
  };
  let t = null;
  try { t = localStorage.getItem("ecrin-theme"); } catch (_) {}
  apply(t);
  addEventListener("storage", (e) => { if (e.key === "ecrin-theme") { apply(e.newValue); dispatchEvent(new Event("ecrin-theme")); } });
})();
