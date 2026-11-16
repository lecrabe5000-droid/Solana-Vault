// Support page: the ways to reach Ecrin (from /api/links, set by the team) and the contact form (/api/report).
(() => {
  const fr = document.documentElement.lang === "fr";
  fetch("/api/links").then((r) => r.json()).then((l) => {
    for (const a of document.querySelectorAll("[data-sup]")) {
      const k = a.dataset.sup, v = l[k]; if (!v) continue;
      a.href = k === "email" ? "mailto:" + v : v; if (k === "email") a.querySelector("span").textContent = v;
      a.hidden = false;
    }
  }).catch(() => {});
  const f = document.querySelector("[data-sup-form]"); if (!f) return;
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = f.querySelector("button"), text = f.text.value.trim(); if (text.length < 5) return f.text.focus();
    b.disabled = true; b.textContent = fr ? "Envoi…" : "Sending…";
    try {
      const r = await fetch("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "support", text, contact: f.contact.value.trim(), info: { platform: "website", lang: fr ? "fr" : "en", size: innerWidth + "x" + innerHeight, agent: navigator.userAgent } }) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "");
      f.querySelectorAll("label, button, .muted-s").forEach((x) => (x.hidden = true)); f.querySelector("[data-sup-done]").hidden = false;
    } catch (err) { b.disabled = false; b.textContent = fr ? "Envoyer" : "Send"; alert(err.message || (fr ? "Envoi impossible. Réessayez dans une minute." : "Couldn't send it. Try again in a minute.")); }
  });
})();
