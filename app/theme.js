// Sets the theme before the page paints: the saved choice, else the device's preference.
(() => {
  let t = null;
  try { t = localStorage.getItem("ecrin-theme"); } catch (_) {}
  if (t !== "light" && t !== "dark") t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#0c0d0f" : "#f6f6f3");
})();
