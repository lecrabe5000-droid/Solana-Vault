// Cinematic scenes for each Ecrin subject. Each scene is drawn in the on-chain language of the site
// (blocks, transactions, rings, paths, hashes) and has steps; the viewer sets data-step as you scroll the chapters.
// Elements carry data-in="n": visible from step n on. data-out="n": hidden from step n on.
(() => {
  const MARK = (x, y, s, cls = "") => `<g class="mk ${cls}" transform="translate(${x} ${y}) scale(${s})"><rect x="-50" y="-50" width="100" height="100" rx="30" fill="none" stroke="url(#gB)" stroke-width="6"/><path d="M0 -26 L19 0 L0 26 L-19 0Z" fill="url(#gB)"/></g>`;
  const DEFS = `<defs>
    <linearGradient id="gB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fb3ff"/><stop offset="1" stop-color="#2f5bff"/></linearGradient>
    <linearGradient id="gA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd38a"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient>
    <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8f86"/><stop offset="1" stop-color="#c3243a"/></linearGradient>
    <linearGradient id="gG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8af0b8"/><stop offset="1" stop-color="#21b46a"/></linearGradient>
    <radialGradient id="gGlow"><stop offset="0" stop-color="#3d63ff" stop-opacity=".55"/><stop offset="1" stop-color="#3d63ff" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="rgba(140,160,255,.07)" stroke-width="1"/></pattern>
  </defs>`;
  const bg = `<rect width="800" height="600" fill="url(#grid)"/><circle cx="400" cy="300" r="300" fill="url(#gGlow)" opacity=".5"/>`;
  const blocks = (y, n = 9, from = 21404110) => Array.from({ length: n }, (_, i) => `<g transform="translate(${40 + i * 84} ${y})"><rect width="70" height="34" rx="8" fill="rgba(120,140,255,.06)" stroke="rgba(150,170,255,.22)"/><text x="35" y="21" class="m" text-anchor="middle" font-size="9.5">#${(from + i).toLocaleString("en-US")}</text></g>${i < n - 1 ? `<path d="M${110 + i * 84} ${y + 17}h14" stroke="rgba(150,170,255,.3)"/>` : ""}`).join("");
  const ring = (cx, cy, r, cls, color = "url(#gA)", w = 6) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="${w}"/><circle class="${cls}" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" pathLength="100" transform="rotate(-90 ${cx} ${cy})"/>`;
  const pill = (x, y, w, txt, cls = "", fill = "rgba(255,255,255,.06)", stroke = "rgba(255,255,255,.12)", tc = "#d9dcef") => `<g class="${cls}" transform="translate(${x} ${y})"><rect width="${w}" height="34" rx="17" fill="${fill}" stroke="${stroke}"/><text x="${w / 2}" y="22" text-anchor="middle" font-size="13" fill="${tc}" class="s">${txt}</text></g>`;
  const card = (x, y, w, h, inner, attrs = "") => `<g transform="translate(${x} ${y})" ${attrs}><rect width="${w}" height="${h}" rx="18" fill="rgba(14,17,36,.86)" stroke="rgba(150,170,255,.2)"/>${inner}</g>`;
  const svg = (body) => `<svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid meet">${DEFS}${bg}${body}</svg>`;

  const S = {};

  S.safe = () => svg(`
    ${blocks(540)}
    <g data-in="0" class="lift">${card(70, 170, 220, 180, `<text x="24" y="40" class="s" font-size="14" fill="#9aa3c7">Wallet</text><text x="24" y="86" class="h" font-size="34" fill="#fff">$1,608</text><text x="24" y="114" class="s" font-size="13" fill="#7f88ad">spend now</text><rect x="24" y="136" width="172" height="6" rx="3" fill="rgba(255,255,255,.08)"/><rect x="24" y="136" width="70" height="6" rx="3" fill="#8ea4ff"/>`)}</g>
    <g data-in="0" class="lift d1">${card(510, 150, 230, 220, `${MARK(115, 78, .62)}<text x="115" y="160" class="h" font-size="30" fill="#fff" text-anchor="middle">$7,381</text><text x="115" y="190" class="s" font-size="13" fill="#9fb3ff" text-anchor="middle">Safe · on-chain</text>`)}</g>
    <path d="M290 260 C 380 200, 430 320, 510 260" fill="none" stroke="rgba(150,170,255,.35)" stroke-dasharray="4 6"/>
    <g data-in="1">${[0, 1, 2].map((i) => `<circle r="6" fill="#9fb3ff" class="flow f${i}"><animateMotion dur="1s" fill="freeze" begin="indefinite" path="M290 260 C 380 200, 430 320, 510 260"/></circle>`).join("")}
      <text x="400" y="140" text-anchor="middle" class="m" font-size="11" fill="#8ea4ff">tx 0x9c4e…a1f2 · deposit · confirmed</text></g>
    <g data-in="1" class="pop">${pill(520, 470, 210, "Contract · 0x41f2…9be0", "", "rgba(61,99,255,.12)", "rgba(125,151,255,.4)", "#b9c6ff")}</g>
    <g data-in="2">${ring(625, 260, 128, "draw a72")}<text x="625" y="430" text-anchor="middle" class="m" font-size="15" fill="#ffcf8a">withdrawal · 72:00:00</text></g>
    <g data-in="3" class="pop">${pill(80, 400, 96, "24 h")}${pill(186, 400, 120, "72 h · Strong", "", "rgba(61,99,255,.2)", "rgba(125,151,255,.6)", "#fff")}${pill(316, 400, 110, "Locked")}</g>`);

  S.cancel = () => svg(`
    ${blocks(540)}
    <g data-in="0" class="pop" data-out="3">${card(90, 90, 300, 150, `<text x="24" y="36" class="m" font-size="11" fill="#ff8f86">SIGNED BY AN UNKNOWN DEVICE</text><text x="24" y="76" class="h" font-size="28" fill="#fff">Withdraw 24.00 SOL</text><text x="24" y="104" class="m" font-size="12" fill="#9aa3c7">→ 9cRt…X2pa</text><text x="24" y="128" class="m" font-size="11" fill="#6c7398">tx 0x7d1b…e09c</text>`)}</g>
    ${MARK(560, 270, 1.05)}
    <g data-in="1">${ring(560, 270, 130, "draw cdown")}<text x="560" y="440" text-anchor="middle" class="m" font-size="16" fill="#ffcf8a" data-out="3">queued · 71:59:41</text></g>
    <g data-in="2" class="pop" data-out="3">${card(80, 290, 320, 120, `<text x="24" y="38" class="s" font-size="12" fill="#9aa3c7">Telegram · Ecrin</text><text x="24" y="70" class="h" font-size="19" fill="#fff">24.00 SOL is leaving your Safe.</text><text x="24" y="96" class="s" font-size="14" fill="#ffcf8a">Not you? Cancel it. It's free.</text>`)}</g>
    <g data-in="3" class="pop">${card(110, 190, 270, 140, `<circle cx="44" cy="70" r="22" fill="url(#gG)"/><path d="M34 70l7 7 14-14" stroke="#05060c" stroke-width="4" fill="none" stroke-linecap="round"/><text x="80" y="64" class="h" font-size="22" fill="#fff">Cancelled</text><text x="80" y="90" class="s" font-size="14" fill="#8af0b8">24.00 SOL never left.</text>`)}</g>
    <g data-in="3">${ring(560, 270, 130, "full", "url(#gG)")}</g>`);

  S.scams = () => svg(`
    <g data-in="0" class="pop">${card(70, 110, 320, 300, `<rect x="0" y="0" width="320" height="40" rx="18" fill="rgba(255,255,255,.04)"/><circle cx="22" cy="20" r="5" fill="#ff5f57"/><circle cx="40" cy="20" r="5" fill="#febc2e"/><circle cx="58" cy="20" r="5" fill="#28c840"/><text x="190" y="25" class="m" font-size="11" fill="#9aa3c7" text-anchor="middle">claim-sol-airdrop.app</text><text x="28" y="96" class="h" font-size="26" fill="#fff">Claim 500 USDC</text><text x="28" y="124" class="s" font-size="14" fill="#9aa3c7">Connect and sign to receive.</text><rect x="28" y="230" width="264" height="44" rx="22" fill="#2f5bff"/><text x="160" y="258" class="s" font-size="15" fill="#fff" text-anchor="middle">Sign</text>`)}</g>
    <path d="M390 260 H 500" stroke="rgba(255,120,110,.5)" stroke-dasharray="5 6" data-in="0"/>
    <g data-in="1" class="pop"><path d="M600 120l100 38v80c0 66-43 117-100 140-57-23-100-74-100-140v-80z" fill="url(#gR)" fill-opacity=".14" stroke="url(#gR)" stroke-width="3"/><path d="M565 220l70 70M635 220l-70 70" stroke="#ffb3ad" stroke-width="9" stroke-linecap="round"/><text x="600" y="430" text-anchor="middle" class="s" font-size="15" fill="#ff8f86">Known scam site · blocked</text></g>
    <g data-in="1" class="pop d1">${card(430, 455, 340, 70, `<text x="20" y="30" class="s" font-size="12" fill="#9aa3c7">Would leave your wallet</text><text x="20" y="54" class="h" font-size="17" fill="#fff">24.5 SOL · 1,250 USDC · everything</text>`)}</g>
    <g data-in="2" class="pop">${card(70, 440, 330, 100, `<text x="20" y="30" class="s" font-size="12" fill="#ffcf8a">Look-alike address</text><text x="20" y="58" class="m" font-size="14" fill="#fff">9cRt…X2pa <tspan fill="#7f88ad">you use</tspan></text><text x="20" y="82" class="m" font-size="14" fill="#ff8f86">9cRt…X2qa <tspan fill="#7f88ad">this one</tspan></text>`)}</g>`);

  S.sleep = () => svg(`
    ${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 97) % 800}" cy="${(i * 53) % 300}" r="${i % 5 ? 1 : 1.6}" fill="#fff" opacity="${0.2 + (i % 4) * 0.15}" class="star"/>`).join("")}
    <g class="night"><path d="M560 80a80 80 0 1 0 40 104A64 64 0 1 1 560 80z" fill="url(#gB)"/></g>
    <g data-in="0" class="pop">${card(80, 140, 300, 160, `<text x="24" y="40" class="m" font-size="12" fill="#9aa3c7">3:02 A.M.</text><text x="24" y="86" class="h" font-size="28" fill="#fff">Sleep on it?</text><text x="24" y="116" class="s" font-size="14" fill="#9aa3c7">This can leave at 9:00 tomorrow.</text>`)}</g>
    <g data-in="1"><path d="M80 420 H 720" stroke="rgba(150,170,255,.25)"/><circle cx="120" cy="420" r="7" fill="#8ea4ff"/><text x="120" y="450" text-anchor="middle" class="m" font-size="12" fill="#9aa3c7">3:02</text>
      <path class="draw tl" d="M120 420 H 680" stroke="url(#gA)" stroke-width="4" pathLength="100"/><circle cx="680" cy="420" r="9" fill="url(#gA)"/><text x="680" y="450" text-anchor="middle" class="m" font-size="12" fill="#ffcf8a">9:00</text>
      <circle class="sun" cx="690" cy="330" r="34" fill="url(#gA)" opacity=".9"/><text x="400" y="400" text-anchor="middle" class="s" font-size="14" fill="#c7cde8">By morning, the urge has passed.</text></g>
    <g data-in="2" class="pop">${card(470, 470, 290, 90, `<text x="20" y="32" class="s" font-size="12" fill="#9aa3c7">Daily limit</text><rect x="20" y="48" width="250" height="8" rx="4" fill="rgba(255,255,255,.08)"/><rect x="20" y="48" width="96" height="8" rx="4" fill="#8ea4ff"/><text x="20" y="78" class="s" font-size="12" fill="#c7cde8">Raising it waits 24 h</text>`)}</g>`);

  const phone = (x, y, h, src, cls = "") => `<foreignObject x="${x}" y="${y}" width="${(h * 390) / 664 + 16}" height="${h + 16}" class="${cls}"><div xmlns="http://www.w3.org/1999/xhtml" class="pm scn-pm"><img src="${src}" alt=""/></div></foreignObject>`;
  S.wallet = () => svg(`
    <g data-in="0" class="lift">${phone(306, 40, 500, "/img/app-home.webp")}</g>
    <g data-in="1" class="lift">${phone(60, 90, 430, "/img/app-receive.webp")}</g>
    <g data-in="2" class="lift">${phone(560, 90, 430, "/img/app-coin.webp")}</g>`);

  const logo = (k, x, y, s = 44) => `<g data-logo="${k}" transform="translate(${x - s / 2} ${y - s / 2})"><svg width="${s}" height="${s}" viewBox="0 0 64 64" class="lg"></svg></g>`;
  S.swap = () => svg(`
    ${blocks(540)}
    <g data-in="0" class="pop">${card(60, 190, 220, 150, `${logo("base", 46, 50)}<text x="80" y="56" class="h" font-size="18" fill="#fff">Base</text><text x="24" y="104" class="h" font-size="26" fill="#fff">0.50 ETH</text><text x="24" y="128" class="s" font-size="13" fill="#9aa3c7">$1,660</text>`)}</g>
    <g data-in="0" class="pop d1">${card(520, 190, 220, 150, `${logo("sol", 46, 50)}<text x="80" y="56" class="h" font-size="18" fill="#fff">Solana</text><text x="24" y="104" class="h" font-size="26" fill="#fff">22.9 SOL</text><text x="24" y="128" class="s" font-size="13" fill="#9aa3c7">$1,648</text>`)}</g>
    <g data-in="1"><path class="draw rt" d="M280 265 C 360 160, 440 370, 520 265" fill="none" stroke="url(#gB)" stroke-width="3" pathLength="100"/><text x="400" y="190" text-anchor="middle" class="m" font-size="11" fill="#8ea4ff">route · 3 hops · ~40 s</text></g>
    <g data-in="2" class="pop">${card(250, 400, 300, 110, `<text x="20" y="32" class="s" font-size="12" fill="#8af0b8">Simulated · only 0.50 ETH can leave</text><text x="20" y="62" class="s" font-size="13" fill="#c7cde8">Network fee ≈ $0.01</text><text x="20" y="86" class="s" font-size="13" fill="#c7cde8">Ecrin fee 0.875% · included</text>`)}</g>`);

  const NETS = ["btc", "eth", "sol", "base", "arb", "op", "pol", "bnb", "avax", "sui", "hype", "tron", "xrp"], SAFE = ["eth", "base", "arb", "op", "pol", "bnb", "avax", "sui"];
  S.networks = () => { const pts = NETS.map((k, i) => { const a = (i / NETS.length) * Math.PI * 2 - Math.PI / 2; return [k, 400 + Math.cos(a) * 220, 300 + Math.sin(a) * 220]; });
    return svg(`${pts.map(([k, x, y]) => `<path data-in="1" class="draw ln" d="M400 300 L${x} ${y}" stroke="rgba(150,170,255,.35)" pathLength="100"/>`).join("")}
      ${MARK(400, 300, 1)}
      ${pts.map(([k, x, y], i) => `<g data-in="0" class="pop" style="transition-delay:${i * 40}ms">${SAFE.includes(k) ? `<circle data-in="2" class="pop" cx="${x}" cy="${y}" r="34" fill="none" stroke="url(#gB)" stroke-width="2.5"/>` : ""}${logo(k, x, y, 46)}</g>`).join("")}
      <text data-in="2" class="pop" x="400" y="580" text-anchor="middle" class="s" font-size="14" fill="#9fb3ff">Ringed: the Safe is live on these 8 mainnets</text>`); };

  S.rules = () => svg(`
    <g data-in="0" class="pop">${card(80, 80, 300, 200, `<text x="24" y="40" class="m" font-size="11" fill="#ff8f86">FROM AN UNKNOWN DEVICE</text>${["Shorten delay to 1 h", "Trust 4fQk…88aZ", "Guardian → 4fQk…88aZ"].map((t, i) => `<text x="24" y="${84 + i * 36}" class="s" font-size="15" fill="#fff">${t}</text><text x="276" y="${84 + i * 36}" text-anchor="end" class="m" font-size="12" fill="#ffcf8a">7 days</text>`).join("")}`)}</g>
    <g data-in="0"><path d="M440 180 H 740" stroke="rgba(150,170,255,.2)"/><path class="draw lz" d="M440 180 H 740" stroke="url(#gA)" stroke-width="4" pathLength="100"/><text x="590" y="160" text-anchor="middle" class="m" font-size="12" fill="#ffcf8a">waits 7 days · cancel any time</text></g>
    <g data-in="1" class="pop">${card(80, 320, 300, 110, `<text x="24" y="40" class="s" font-size="13" fill="#9aa3c7">Longer delay · lower limit · lock</text><text x="24" y="78" class="h" font-size="22" fill="#8af0b8">Applies now</text>`)}</g>
    <g data-in="1"><circle cx="590" cy="370" r="40" fill="url(#gG)" class="pop"/><path d="M572 370l13 13 24-24" stroke="#05060c" stroke-width="6" fill="none" stroke-linecap="round" class="pop"/></g>
    <g data-in="2" class="pop">${card(440, 450, 320, 110, `<text x="20" y="34" class="s" font-size="13" fill="#fff">Guardian</text><text x="20" y="62" class="s" font-size="13" fill="#8af0b8">✓ Release a withdrawal you asked for</text><text x="20" y="88" class="s" font-size="13" fill="#ff8f86">✕ Start one · choose where it goes</text>`)}</g>`);

  S.security = () => svg(`
    <g data-in="0" class="pop">${card(70, 70, 400, 300, `<text x="24" y="38" class="m" font-size="11" fill="#9aa3c7">programs/vault/src/lib.rs</text>${["pub fn request_withdrawal(ctx, amount) {", "  let vault = &mut ctx.accounts.vault;", "  require!(!vault.paused, Paused);", "  vault.pending = Some(Pending {", "    amount, unlock_at: now + vault.delay,", "  });", "}"].map((l, i) => `<text x="24" y="${78 + i * 30}" class="m" font-size="12.5" fill="${i === 4 ? "#ffcf8a" : "#c7cde8"}">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`).join("")}`)}</g>
    <g data-in="1" class="pop">${card(500, 90, 240, 180, `${["Solana program", "EVM contracts", "Wallet, end to end"].map((t, i) => `<circle cx="30" cy="${46 + i * 46}" r="11" fill="url(#gG)"/><path d="M24 ${46 + i * 46}l4 4 8-8" stroke="#05060c" stroke-width="2.6" fill="none"/><text x="52" y="${51 + i * 46}" class="s" font-size="14" fill="#fff">${t}</text>`).join("")}`)}</g>
    <g data-in="1" class="pop d1">${pill(500, 290, 240, "Base · 0x41f2…9be0", "", "rgba(61,99,255,.12)", "rgba(125,151,255,.4)", "#b9c6ff")}</g>
    <g data-in="2" class="pop">${pill(70, 420, 170, "Non-custodial ✓", "", "rgba(48,209,88,.12)", "rgba(48,209,88,.4)", "#8af0b8")}${pill(250, 420, 160, "Open source ✓", "", "rgba(48,209,88,.12)", "rgba(48,209,88,.4)", "#8af0b8")}${pill(420, 420, 190, "Audit · next", "", "rgba(255,181,71,.12)", "rgba(255,181,71,.45)", "#ffcf8a")}</g>`);

  S.faq = () => svg(`${MARK(400, 280, 2.2)}<text x="400" y="520" text-anchor="middle" class="s" font-size="15" fill="#9fb3ff">An écrin keeps something precious safe.</text>`);

  // network logos inside scenes come from the same set as the cards
  const fillLogos = (root, list) => root.querySelectorAll("[data-logo]").forEach((g) => { const svgEl = g.querySelector("svg"); const hit = list.find(([n, , k]) => k === g.dataset.logo); if (hit && svgEl) { svgEl.outerHTML = hit[1].replace("<svg ", `<svg width="${svgEl.getAttribute("width")}" height="${svgEl.getAttribute("height")}" `); } });
  globalThis.EcrinScenes = { build: (id) => (S[id] ? S[id]() : S.faq()), fillLogos };
})();
