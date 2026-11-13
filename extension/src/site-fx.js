// ecrinprotocol.app: the extra motion layer. Real network logos, a slow logo band, cards that catch the light,
// the 3D Safe from the wallet, and a little depth on the hero. Everything respects reduced motion.
import { LOGOS } from "./logos.js";
import { mountVault3d } from "./vault3d.js";

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const NAME = { sol: "sol", eth: "eth", base: "base", arb: "arb", op: "op", pol: "pol", bnb: "bnb", avax: "avax", hype: "hype", rh: "rh", tron: "tron", usdc: "usdc", usdt: "usdt" };

// 1. Official logos in every coin dot.
document.querySelectorAll("i.coin").forEach((el) => { const k = [...el.classList].find((c) => NAME[c]); if (k && LOGOS[k]) { el.innerHTML = LOGOS[k]; el.classList.add("real"); } });

// 2. The network cloud becomes a slow, endless band of logos.
const cloud = document.querySelector(".net-cloud");
if (cloud) {
  const have = new Set([...cloud.querySelectorAll("i.coin")].map((i) => [...i.classList].find((c) => NAME[c])));
  const extra = [["bnb", "BNB Chain"], ["avax", "Avalanche"], ["tron", "Tron"], ["usdt", "USDT"]].filter(([k]) => !have.has(k));
  for (const [k, n] of extra) cloud.insertAdjacentHTML("beforeend", `<span class="net"><i class="coin ${k} real">${LOGOS[k]}</i>${n}</span>`);
  if (!still) { const track = document.createElement("div"); track.className = "net-track"; track.append(...cloud.childNodes); track.insertAdjacentHTML("beforeend", track.innerHTML); track.querySelectorAll(".rv").forEach((n) => n.classList.add("in")); cloud.append(track); cloud.classList.add("band"); }

}

// 3. Cards catch a soft light under the pointer and lift a little.
const cards = ".assets-mock, .sec .card, .cmp-card, .rm-card, .faq details, .story-s .phone, [class*='-card']";
document.addEventListener("pointermove", (e) => {
  const c = e.target.closest?.(cards); if (!c || c.closest(".hero-card")) return;
  const r = c.getBoundingClientRect(); c.style.setProperty("--mx", `${e.clientX - r.left}px`); c.style.setProperty("--my", `${e.clientY - r.top}px`); c.classList.add("lit");
}, { passive: true });
document.addEventListener("pointerout", (e) => { const c = e.target.closest?.(cards); if (c && !c.contains(e.relatedTarget)) c.classList.remove("lit"); });

// 4. The 3D Safe, in the wallet section.
const w = document.querySelector("#wallet .big-head");
if (w) { w.insertAdjacentHTML("afterbegin", `<div class="site-v3d" aria-hidden="true"><canvas data-vault3d></canvas></div>`); mountVault3d(w); }

// (No scroll depth on the hero: the top card stays perfectly still.)
