document.getElementById("reset")?.addEventListener("click", () => { try { localStorage.removeItem("ecrin-demo-local"); } catch (_) {} location.reload(); });
