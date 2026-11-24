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
  try {
    t = localStorage.getItem("ecrin-theme");
    // The site turned dark by default: a "light" saved before that is reset once, on the site's pages only.
    if (root.dataset.defaultTheme === "dark" && !localStorage.getItem("ecrin-dark-default")) {
      if (t === "light") { localStorage.removeItem("ecrin-theme"); t = null; }
      localStorage.setItem("ecrin-dark-default", "1");
    }
  } catch (_) {}
  apply(root.dataset.forceTheme || t || root.dataset.defaultTheme); // the landing always wears the hero's colours // a page can start dark (the landing does); the visitor's own choice wins
  addEventListener("storage", (e) => { if (e.key === "ecrin-theme") { apply(e.newValue); dispatchEvent(new Event("ecrin-theme")); } });
})();
