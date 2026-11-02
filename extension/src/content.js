// Ecrin Wallet's messenger in web pages (an isolated content script: the page can't see or change it).
// It passes the page's requests to the extension and the answers back, and covers the page with a warning if the
// site is on a phishing list. The extension decides everything; this file only carries messages.
const CH = "ecrin-wallet";
const target = location.origin === "null" ? "*" : location.origin;
const post = (d) => window.postMessage({ ch: CH, dir: "out", ...d }, target);

window.addEventListener("message", (e) => {
  const d = e.data;
  if (e.source !== window || !d || d.ch !== CH || d.dir !== "in" || typeof d.id !== "string") return;
  chrome.runtime.sendMessage({ type: "dapp", fam: d.fam === "sol" ? "sol" : "evm", method: String(d.method), params: d.params })
    .then((r) => post({ id: d.id, ...(r || { error: { code: 4900, message: "Ecrin Wallet didn't answer." } }) }))
    .catch(() => post({ id: d.id, error: { code: 4900, message: "Ecrin Wallet was updated or restarted. Reload this page." } }));
});

chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === "dapp-event" && (!m.origin || m.origin === location.origin)) post({ event: m.event, fam: m.fam, data: m.data });
});

// Phishing check: ask the extension once per page.
if (window.top === window && /^https?:$/.test(location.protocol)) {
  chrome.runtime.sendMessage({ type: "check-site" }).then((r) => { if (r?.phish) block(r); }).catch(() => {});
}

function block(r) {
  const host = document.createElement("ecrin-shield");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    :host { all: initial; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; }
    .w { position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; background: #000; color: #fff; font: 400 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .c { max-width: 520px; }
    .k { display: inline-flex; align-items: center; gap: 10px; color: #ff6b6b; font-size: 13px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 16px 0 12px; font-size: 34px; line-height: 1.1; letter-spacing: -.02em; font-weight: 600; }
    p { margin: 0 0 12px; color: #a0a0a0; } b { color: #fff; font-weight: 600; } code { color: #fff; }
    .row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 28px; }
    button { height: 48px; padding: 0 22px; border: 0; border-radius: 999px; background: #2f5bff; color: #fff; font: 600 15px system-ui, sans-serif; cursor: pointer; }
    .ig { height: auto; padding: 0; background: none; color: #707070; font-weight: 400; font-size: 13px; text-decoration: underline; }
  </style>
  <div class="w"><div class="c">
    <span class="k">● Ecrin Wallet · phishing warning</span>
    <h1>This site is on a phishing list.</h1>
    <p><code></code> is listed as a scam site. Sites like this copy real apps to trick you into signing away your money.</p>
    <p>Ecrin blocked it before anything happened. <b>Don't enter your recovery phrase or approve anything here.</b></p>
    <div class="row"><button class="go">Get me out of here</button><button class="ig">I understand the risk, show the site</button></div>
  </div></div>`;
  root.querySelector("code").textContent = location.hostname;
  root.querySelector(".go").onclick = () => { if (history.length > 1) history.back(); setTimeout(() => location.replace("https://ecrinprotocol.app/"), 300); };
  let ignored = false;
  root.querySelector(".ig").onclick = () => { ignored = true; chrome.runtime.sendMessage({ type: "allow-site" }).catch(() => {}); host.remove(); };
  const put = () => { if (!ignored && !host.isConnected) (document.documentElement || document).appendChild(host); };
  if (document.documentElement) put(); else document.addEventListener("readystatechange", put, { once: true });
  // A scam page may try to delete the warning: put it straight back.
  new MutationObserver(put).observe(document, { childList: true, subtree: true });
}
