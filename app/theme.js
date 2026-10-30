// Sets the theme before the page paints: the visitor's saved choice; otherwise the page's default
// (<html data-default-theme="light"> on the landing page), else the device's preference.
(() => {
  const root = document.documentElement;
  let t = null;
  try { t = localStorage.getItem("ecrin-theme"); } catch (_) {}
  if (t !== "light" && t !== "dark") t = root.dataset.defaultTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  root.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#0c0d0f" : "#f6f6f3");
})();
