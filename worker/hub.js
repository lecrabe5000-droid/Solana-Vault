// AlertHub: one Durable Object (SQLite) that holds alert subscriptions and runs the minute-by-minute check.
// Channels: Telegram (TELEGRAM_BOT_TOKEN secret) and email through Resend (RESEND_API_KEY secret, from
// ALERTS_FROM or alerts@ecrinprotocol.app). Each channel switches on when its secret is set.
import { DurableObject } from "cloudflare:workers";
import { CONFIG } from "../app/config.js";
import { EVM_NETS } from "../app/config-evm.js";
import { SOL_USDC } from "../app/config-tokens.js";
import { newVapidKeys, vapidPublic, sendPush, allowedEndpoint } from "./push.js";
import { alertLinks, base58, b64, decodeSolVault, decodeSolTokenVault, emptyTokenSnap, tokenVaultAddresses, tokenAmount, diffSol, decodeEvmLog, message, ownerTopic, short, esc, NETS, USDC } from "./alerts.js";

const SITE = "https://ecrinprotocol.app";
const NET_NAME = Object.fromEntries(Object.entries(NETS).map(([k, n]) => [k, n.name]));
const isEvm = (net) => net !== "sol";
/** One switch covers every network of a family: a Solana wallet's alerts, or an Ethereum address on all EVM networks. */
const famWhere = (net) => (isEvm(net) ? "net != 'sol'" : "net = 'sol'");
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, ETH_ADDR = /^0x[0-9a-fA-F]{40}$/, EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,24}$/i;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const token = (n = 24) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");

async function sha256hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** The secret Telegram echoes back on every webhook call, derived from the bot token so there is nothing else to configure. */
export const webhookSecret = async (tok) => (await sha256hex("ecrin-webhook:" + tok)).slice(0, 48);

async function rpc(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

// ------------------------------------------------------------------ email rendering

/** Turns the Telegram text (b, code, newlines) into the email's subject and body. */
export function emailFrom(text) {
  const lines = text.split("\n").filter((l, i, a) => !(l === "" && a[i - 1] === ""));
  const subject = (lines.find((l, i) => i > 0 && /<b>/.test(l)) || lines[0]).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  const html = lines.map((l) => l.replace(/<code>/g, '<code style="font-family:ui-monospace,Menlo,monospace;background:#f1f1ed;padding:1px 5px;border-radius:5px">')).join("<br>");
  return { subject: "Ecrin · " + subject, html };
}

export function emailPage({ body, button, second, unsub, lang }) {
  const fr = lang === "fr";
  return `<!doctype html><html><body style="margin:0;background:#f6f6f3;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#101114">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f3;padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e6e6e1;border-radius:18px">
      <tr><td style="padding:26px 28px 6px;font-size:13px;letter-spacing:.3em;font-weight:700;color:#2f5bff">ECRIN</td></tr>
      <tr><td style="padding:10px 28px 4px;font-size:15px;line-height:1.6;color:#45484f">${body}</td></tr>
      ${button ? `<tr><td style="padding:18px 28px 26px"><a href="${button[1]}" style="display:inline-block;background:#101114;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:999px">${button[0]}</a>${second ? `&nbsp;&nbsp;<a href="${second[1]}" style="display:inline-block;border:1px solid #1f6fd1;color:#1f6fd1;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:999px">${second[0]}</a>` : ""}</td></tr>` : ""}
    </table>
    <p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#8b8d93">${fr ? "Ecrin, bêta sur réseaux de test · Pas audité : jetons de test seulement." : "Ecrin testnet beta · Not audited: test coins only."}${unsub ? ` <a href="${unsub}" style="color:#8b8d93">${fr ? "Se désabonner" : "Unsubscribe"}</a>` : ""}</p>
  </td></tr></table></body></html>`;
}

const page = (title, text) => new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Ecrin</title>
  <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f3;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#101114">
  <main style="max-width:420px;margin:24px;padding:32px;background:#fff;border:1px solid #e6e6e1;border-radius:20px;text-align:center">
  <p style="margin:0 0 10px;font-size:12px;letter-spacing:.3em;font-weight:700;color:#2f5bff">ECRIN</p><h1 style="margin:0 0 10px;font-size:22px">${title}</h1>
  <p style="margin:0 0 22px;color:#45484f;line-height:1.55">${text}</p><a href="${SITE}/app" style="display:inline-block;background:#101114;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">Open Ecrin</a></main>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

// ------------------------------------------------------------------ the hub

export class AlertHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS pending (code TEXT PRIMARY KEY, net TEXT, owner TEXT, vault TEXT, created INTEGER, chat TEXT);
      CREATE TABLE IF NOT EXISTS subs (chat TEXT, net TEXT, owner TEXT, vault TEXT, created INTEGER, PRIMARY KEY (chat, net, owner));
      CREATE TABLE IF NOT EXISTS emails (email TEXT, net TEXT, owner TEXT, vault TEXT, token TEXT UNIQUE, confirmed INTEGER, created INTEGER, PRIMARY KEY (email, net, owner));
      CREATE TABLE IF NOT EXISTS snaps (net TEXT, k TEXT, data TEXT, PRIMARY KEY (net, k));
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS pushes (endpoint TEXT PRIMARY KEY, net TEXT, owner TEXT, vault TEXT, p256dh TEXT, auth TEXT, lang TEXT, created INTEGER);
      CREATE TABLE IF NOT EXISTS waitlist (email TEXT PRIMARY KEY, lang TEXT, token TEXT UNIQUE, confirmed INTEGER, created INTEGER);`);
    // Each subscription remembers its language (en / fr); added after launch, so older rows read as English.
    for (const t of ["pending", "subs", "emails"]) { try { this.sql.exec(`ALTER TABLE ${t} ADD COLUMN lang TEXT`); } catch (_) {} }
    // One device can follow several wallets (a Solana one and an Ethereum one), so device subscriptions are keyed by both.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT, net TEXT, owner TEXT, vault TEXT, p256dh TEXT, auth TEXT, lang TEXT, created INTEGER, PRIMARY KEY (endpoint, owner));
      INSERT OR IGNORE INTO push_subs SELECT endpoint, net, owner, vault, p256dh, auth, lang, created FROM pushes;
      DELETE FROM pushes;`);
    try { this.sql.exec("ALTER TABLE pending ADD COLUMN also TEXT"); } catch (_) {}
  }

  get(k) { return this.sql.exec("SELECT v FROM kv WHERE k = ?", k).toArray()[0]?.v ?? null; }
  set(k, v) { this.sql.exec("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", k, String(v)); }

  // --- Telegram
  async tg(method, body) {
    const r = await fetch(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return r.json().catch(() => ({ ok: false }));
  }
  async say(chat, text, net, links, lang) {
    const body = { chat_id: chat, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } };
    if (net) { const ls = links?.length ? links : [{ label: lang === "fr" ? "Ouvrir Ecrin" : "Open Ecrin", url: `${SITE}/app?net=${net}&tab=vault` }]; body.reply_markup = { inline_keyboard: [ls.map((l) => ({ text: l.label, url: l.url }))] }; }
    const r = await this.tg("sendMessage", body);
    // The person blocked the bot or deleted the chat: stop sending there.
    if (!r.ok && r.error_code === 403) this.sql.exec("DELETE FROM subs WHERE chat = ?", String(chat));
    return r.ok;
  }

  // --- email
  async mail(to, subject, html, unsub) {
    const headers = unsub ? { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: `Bearer ${this.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.env.ALERTS_FROM || "Ecrin Alerts <alerts@ecrinprotocol.app>", to: [to], subject, html, headers }),
    });
    if (!r.ok) console.error("resend", r.status, await r.text().catch(() => ""));
    return r.ok;
  }
  async emailAlert(row, text, net, links) {
    const { subject, html } = emailFrom(text), unsub = `${SITE}/api/alerts/unsub?t=${row.token}`;
    const [l, l2] = links?.length ? links : [{ label: row.lang === "fr" ? "Ouvrir Ecrin" : "Open Ecrin", url: `${SITE}/app?net=${net}&tab=vault` }];
    return this.mail(row.email, subject, emailPage({ body: html, button: [l.label, l.url], second: l2 && [l2.label, l2.url], unsub, lang: row.lang }), unsub);
  }

  /** Sends one alert to every Telegram chat and confirmed email watching this vault, each in its own language.
   *  `render(lang)` returns { text, links } or null. */
  async notify(net, match, render) {
    const cache = {}, get = (lang) => (lang in cache ? cache[lang] : (cache[lang] = render(lang === "fr" ? "fr" : "en")));
    const fw = famWhere(net);
    if (this.env.TELEGRAM_BOT_TOKEN) for (const s of this.sql.exec(`SELECT chat, MAX(lang) AS lang FROM subs WHERE ${fw} AND ${match.col} = ? GROUP BY chat`, match.val).toArray()) { const m = get(s.lang); if (m) await this.say(s.chat, m.text, net, m.links, s.lang); }
    if (this.env.RESEND_API_KEY) for (const e of this.sql.exec(`SELECT email, MIN(token) AS token, MAX(lang) AS lang FROM emails WHERE confirmed = 1 AND ${fw} AND ${match.col} = ? GROUP BY email`, match.val).toArray()) { const m = get(e.lang); if (m) await this.emailAlert(e, m.text, net, m.links); }
    const pushes = this.sql.exec(`SELECT endpoint, MAX(p256dh) AS p256dh, MAX(auth) AS auth, MAX(lang) AS lang FROM push_subs WHERE ${fw} AND ${match.col} = ? GROUP BY endpoint`, match.val).toArray();
    if (pushes.length) {
      const keys = await this.vapid();
      for (const p of pushes) {
        const m = get(p.lang);
        if (!m) continue;
        const status = await sendPush(p, AlertHub.pushPayload(m.text, m.links, net), keys).catch(() => 0);
        // The browser unsubscribed or the subscription expired: forget it.
        if (status === 404 || status === 410) this.sql.exec("DELETE FROM push_subs WHERE endpoint = ?", p.endpoint);
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url), tg = !!this.env.TELEGRAM_BOT_TOKEN, mail = !!this.env.RESEND_API_KEY;
    try {
      if (url.pathname === "/start" && request.method === "POST") return tg ? await this.start(await request.json()) : json({ error: "Telegram alerts aren't switched on yet." }, 503);
      if (url.pathname === "/status") return this.status(url.searchParams.get("code") || "");
      if (url.pathname === "/telegram" && request.method === "POST") return tg ? await this.telegram(request) : json({ ok: false }, 503);
      if (url.pathname === "/email" && request.method === "POST") return mail ? await this.subscribeEmail(await request.json()) : json({ error: "Email alerts aren't switched on yet." }, 503);
      if (url.pathname === "/confirm") return this.confirmEmail(url.searchParams.get("t") || "");
      if (url.pathname === "/unsub") return this.unsubscribe(url.searchParams.get("t") || "", request.method);
      if (url.pathname === "/tick") { await this.tick(); return json({ ok: true }); }
      if (url.pathname === "/waitlist" && request.method === "POST") return mail ? await this.joinWaitlist(await request.json()) : json({ error: "The waitlist isn't open yet." }, 503);
      if (url.pathname === "/wconfirm") return this.confirmWaitlist(url.searchParams.get("t") || "");
      if (url.pathname === "/stats") return this.stats();
      if (url.pathname === "/pushkey") return json({ key: vapidPublic((await this.vapid()).publicJwk) });
      if (url.pathname === "/pushsub" && request.method === "POST") return this.pushSubscribe(await request.json());
      if (url.pathname === "/pushunsub" && request.method === "POST") { const { endpoint } = await request.json(); this.sql.exec("DELETE FROM push_subs WHERE endpoint = ?", String(endpoint || "")); return json({ ok: true }); }
    } catch (e) { console.error(e); return json({ error: "Something went wrong. Try again." }, 500); }
    return json({ error: "Not found" }, 404);
  }

  validVault(net, owner, vault) {
    if (!(net in NET_NAME)) return "Unknown network";
    if (net === "sol" ? !(SOL_ADDR.test(owner || "") && SOL_ADDR.test(vault || "")) : !ETH_ADDR.test(owner || "")) return "That address isn't valid";
    return null;
  }

  /** The wallet asked about, plus up to two more the same device follows (its Solana and Ethereum wallets). */
  targets(net, owner, vault, also) {
    const list = [{ net, owner, vault }, ...(Array.isArray(also) ? also.slice(0, 2) : [])].map((t) => ({ net: String(t?.net || ""), owner: String(t?.owner || ""), vault: t?.vault ? String(t.vault) : "" }));
    const out = [];
    for (const t of list) {
      if (this.validVault(t.net, t.owner, t.vault)) continue;
      t.owner = isEvm(t.net) ? t.owner.toLowerCase() : t.owner;
      if (!out.some((o) => isEvm(o.net) === isEvm(t.net) && o.owner === t.owner)) out.push(t);
    }
    return out;
  }

  /** The app asks for a Telegram link for one vault; the person proves the chat is theirs by pressing Start. */
  async start({ net, owner, vault, lang, also }) {
    const bad = this.validVault(net, owner, vault);
    if (bad) return json({ error: bad }, 400);
    const now = Date.now();
    this.sql.exec("DELETE FROM pending WHERE created < ?", now - 3600_000);
    if (this.sql.exec("SELECT COUNT(*) AS n FROM pending").one().n > 5000) return json({ error: "Too many requests right now. Try again in a minute." }, 429);
    const code = token(12);
    this.sql.exec("INSERT INTO pending (code, net, owner, vault, created, lang, also) VALUES (?, ?, ?, ?, ?, ?, ?)", code, net, isEvm(net) ? owner.toLowerCase() : owner, vault || "", now, lang === "fr" ? "fr" : "en", JSON.stringify(this.targets(net, owner, vault, also).slice(1)));
    let bot = this.get("bot");
    if (!bot) { const me = await this.tg("getMe", {}); bot = me.result?.username; if (!bot) return json({ error: "The Telegram bot isn't reachable." }, 503); this.set("bot", bot); }
    await this.ensureWebhook();
    return json({ code, url: `https://t.me/${bot}?start=${code}` });
  }

  status(code) {
    const row = this.sql.exec("SELECT chat FROM pending WHERE code = ?", code).toArray()[0];
    return json({ linked: !!row?.chat });
  }

  /** Email sign-up is double opt-in: nothing is sent to an address until its owner clicks the link. */
  async subscribeEmail({ net, owner, vault, email, lang, also }) {
    lang = lang === "fr" ? "fr" : "en";
    const bad = this.validVault(net, owner, vault);
    if (bad) return json({ error: bad }, 400);
    email = String(email || "").trim().toLowerCase();
    if (!EMAIL.test(email)) return json({ error: "That email address doesn't look right." }, 400);
    owner = isEvm(net) ? owner.toLowerCase() : owner;
    const all = this.targets(net, owner, vault, also);
    const have = (t) => this.sql.exec("SELECT confirmed, created FROM emails WHERE email = ? AND net = ? AND owner = ?", email, t.net, t.owner).toArray()[0];
    const todo = all.filter((t) => !have(t)?.confirmed);
    if (!todo.length) return json({ ok: true, already: true });
    const row = have(todo[0]);
    if (row && Date.now() - row.created < 120_000) return json({ ok: true, sent: true });
    if (this.sql.exec("SELECT COUNT(*) AS n FROM emails WHERE email = ?", email).one().n >= 10) return json({ error: "That address already follows 10 vaults." }, 429);
    if (this.sql.exec("SELECT COUNT(*) AS n FROM emails WHERE confirmed = 0 AND created > ?", Date.now() - 3600_000).one().n > 500) return json({ error: "Too many requests right now. Try again later." }, 429);
    // Every wallet in this request shares one moment, so one click confirms them all.
    const now = Date.now(), t = token();
    todo.forEach((x, i) => this.sql.exec("INSERT OR REPLACE INTO emails (email, net, owner, vault, token, confirmed, created, lang) VALUES (?, ?, ?, ?, ?, 0, ?, ?)", email, x.net, x.owner, x.vault || "", i ? token() : t, now, lang));
    const fr = lang === "fr", what = todo.map((x) => `<b>${esc(short(x.owner))}</b> (${isEvm(x.net) ? (fr ? "tous les réseaux Ethereum" : "every Ethereum network") : "Solana"})`).join(fr ? " et " : " and ");
    const ok = await this.mail(email, fr ? "Confirmez vos alertes Ecrin" : "Confirm your Ecrin alerts", emailPage({
      body: fr ? `Confirmez que vous voulez un courriel dès qu'il se passe quelque chose dans ${todo.length > 1 ? "les coffres" : "le coffre"} ${what} : retraits, dépôts et changements de règles.<br><br>Si vous n'avez rien demandé, ignorez ce courriel et rien ne sera envoyé.`
        : `Confirm that you want an email the moment anything happens to ${todo.length > 1 ? "vaults" : "vault"} ${what}: withdrawals, deposits and rule changes.<br><br>If you didn't ask for this, ignore this email and nothing will be sent.`,
      button: [fr ? "Confirmer les alertes" : "Confirm alerts", `${SITE}/api/alerts/confirm?t=${t}`], lang,
    }));
    return ok ? json({ ok: true, sent: true }) : json({ error: "We couldn't send the email. Try again in a minute." }, 502);
  }

  confirmEmail(t) {
    const row = this.sql.exec("SELECT email, net, owner, lang, created FROM emails WHERE token = ?", t).toArray()[0];
    if (!row) return page("Link expired", "This confirmation link isn't valid anymore. Ask for alerts again from your vault in Ecrin.");
    this.sql.exec("UPDATE emails SET confirmed = 1 WHERE email = ? AND created = ?", row.email, row.created);
    if (row.lang === "fr") return page("Les alertes par courriel sont activées", `Nous écrirons à <b>${esc(row.email)}</b> en moins d'une minute à chaque retrait, dépôt ou changement de règle sur le coffre <b>${esc(short(row.owner))}</b>. Chaque courriel a un lien pour se désabonner.`);
    return page("Email alerts are on", `We'll email <b>${esc(row.email)}</b> within a minute of any withdrawal, deposit or rule change on vault <b>${esc(short(row.owner))}</b>. Every email has an unsubscribe link.`);
  }

  unsubscribe(t, method) {
    // One link stops every alert to that address: emails cover a wallet on all its networks, so stop them all.
    const who = this.sql.exec("SELECT email FROM emails WHERE token = ?", t).toArray()[0]?.email;
    const gone = who ? this.sql.exec("DELETE FROM emails WHERE email = ? RETURNING email", who).toArray().length : 0;
    if (method === "POST") return json({ ok: true });
    return page(gone ? "You're unsubscribed" : "Already unsubscribed", "Ecrin won't email you anymore. You can turn alerts back on from your vault any time.");
  }

  // --- phone and browser notifications (Web Push). The signing keys are made here on first use and never leave.
  async vapid() {
    let k = this.get("vapid");
    if (!k) { k = JSON.stringify(await newVapidKeys()); this.set("vapid", k); }
    return JSON.parse(k);
  }

  pushSubscribe({ net, owner, vault, lang, sub, also }) {
    const bad = this.validVault(net, owner, vault);
    if (bad) return json({ error: bad }, 400);
    const endpoint = String(sub?.endpoint || ""), p256dh = String(sub?.keys?.p256dh || ""), auth = String(sub?.keys?.auth || "");
    if (!allowedEndpoint(endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) return json({ error: "That browser can't receive notifications." }, 400);
    if (this.sql.exec("SELECT COUNT(*) AS n FROM push_subs").one().n > 50_000) return json({ error: "Too many devices right now." }, 429);
    for (const t of this.targets(net, owner, vault, also))
      this.sql.exec("INSERT OR REPLACE INTO push_subs (endpoint, net, owner, vault, p256dh, auth, lang, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", endpoint, t.net, t.owner, t.vault || "", p256dh, auth, lang === "fr" ? "fr" : "en", Date.now());
    return json({ ok: true });
  }

  /** Turns an alert's text and first button into a notification. */
  static pushPayload(text, links, net) {
    const lines = text.split("\n").map((l) => l.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim()).filter(Boolean);
    return { title: lines[1] || "Ecrin", body: lines.slice(2).join(" ").slice(0, 220), url: links?.[0]?.url || `${SITE}/app?net=${net}&tab=vault` };
  }

  // --- Ecrin Wallet waitlist: double opt-in like email alerts (nothing is sent until the link is clicked).
  async joinWaitlist({ email, lang }) {
    email = String(email || "").trim().toLowerCase(); lang = lang === "fr" ? "fr" : "en";
    const fr = lang === "fr";
    if (!EMAIL.test(email)) return json({ error: fr ? "Cette adresse courriel ne semble pas valide." : "That email address doesn't look right." }, 400);
    const row = this.sql.exec("SELECT confirmed, created FROM waitlist WHERE email = ?", email).toArray()[0];
    if (row?.confirmed) return json({ ok: true, already: true });
    if (row && Date.now() - row.created < 120_000) return json({ ok: true, sent: true });
    if (this.sql.exec("SELECT COUNT(*) AS n FROM waitlist WHERE confirmed = 0 AND created > ?", Date.now() - 3600_000).one().n > 300) return json({ error: fr ? "Trop de demandes. Réessayez plus tard." : "Too many requests right now. Try again later." }, 429);
    const t = token();
    this.sql.exec("INSERT OR REPLACE INTO waitlist (email, lang, token, confirmed, created) VALUES (?, ?, ?, 0, ?)", email, lang, t, Date.now());
    const ok = await this.mail(email, fr ? "Confirmez votre place sur la liste Ecrin Wallet" : "Confirm your spot on the Ecrin Wallet list", emailPage({
      body: fr ? "Confirmez que vous voulez être averti quand Ecrin Wallet ouvre : le portefeuille où votre épargne est dans un coffre par défaut.<br><br>Si vous n'avez rien demandé, ignorez ce courriel."
        : "Confirm that you want to hear when Ecrin Wallet opens: the wallet where your savings sit in a vault by default.<br><br>If you didn't ask for this, ignore this email.",
      button: [fr ? "Confirmer" : "Confirm", `${SITE}/api/waitlist/confirm?t=${t}`], lang,
    }));
    return ok ? json({ ok: true, sent: true }) : json({ error: fr ? "Impossible d'envoyer le courriel. Réessayez dans une minute." : "We couldn't send the email. Try again in a minute." }, 502);
  }

  confirmWaitlist(t) {
    const row = this.sql.exec("SELECT lang FROM waitlist WHERE token = ?", t).toArray()[0];
    if (!row) return page("Link expired", "This link isn't valid anymore. Join the list again from ecrinprotocol.app.");
    this.sql.exec("UPDATE waitlist SET confirmed = 1 WHERE token = ?", t);
    return row.lang === "fr" ? page("Vous êtes sur la liste", "On vous écrira quand Ecrin Wallet ouvrira. Rien d'autre.") : page("You're on the list", "We'll email you when Ecrin Wallet opens. Nothing else.");
  }

  // --- Live numbers for the landing page, read from the chains and cached for 10 minutes.
  async stats() {
    const cached = this.get("stats"), at = Number(this.get("stats_at") || 0);
    if (!cached || Date.now() - at > 10 * 60_000) {
      try { await this.computeStats(); } catch (e) { console.error("stats", e); if (!cached) return json({ error: "unavailable" }, 503); }
    }
    return new Response(this.get("stats"), { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
  }

  async computeStats() {
    const out = { vaults: 0, sol: "0", tokenVaults: 0, networks: 0, waitlist: this.sql.exec("SELECT COUNT(*) AS n FROM waitlist WHERE confirmed = 1").one().n, at: Date.now() };
    if (CONFIG.programId) {
      out.networks++;
      const disc = async (name) => base58(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("account:" + name))).slice(0, 8));
      const vaults = await rpc(CONFIG.rpc, "getProgramAccounts", [CONFIG.programId, { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 41, length: 8 }, filters: [{ memcmp: { offset: 0, bytes: await disc("VaultAccount") } }] }]);
      let lamports = 0n;
      for (const a of vaults) { const d = b64(a.account.data[0]); if (d.length === 8) lamports += new DataView(d.buffer, d.byteOffset, 8).getBigUint64(0, true); }
      out.vaults += vaults.length; out.sol = String(lamports);
      const tv = await rpc(CONFIG.rpc, "getProgramAccounts", [CONFIG.programId, { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 0 }, filters: [{ memcmp: { offset: 0, bytes: await disc("TokenVaultAccount") } }] }]).catch(() => []);
      out.tokenVaults = tv.length;
    }
    // Ethereum-style networks: count VaultCreated logs, scanning only blocks not seen yet.
    const created = "0x597fbcb71eb7ed6d840f5b85c8b386c7a28ff717ed702eca46f373d330158bb4";
    for (const [net, E] of Object.entries(EVM_NETS)) {
      if (!E.address) continue;
      out.networks++;
      try {
        const key = `stats_${net}_${E.address.toLowerCase()}`;
        let { from, n } = JSON.parse(this.get(key) || "null") || { from: E.fromBlock || 0, n: 0 };
        const head = parseInt(await rpc(E.rpc, "eth_blockNumber", []), 16) - 2;
        for (let i = 0; i < 20 && from <= head; i++) {
          const to = Math.min(head, from + 49_999);
          const logs = await rpc(E.rpc, "eth_getLogs", [{ address: E.address, fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), topics: [created] }]);
          n += logs.length; from = to + 1;
        }
        this.set(key, JSON.stringify({ from, n }));
        out.vaults += n;
      } catch (e) { console.error("stats", net, e.message); }
    }
    this.set("stats", JSON.stringify(out)); this.set("stats_at", Date.now());
  }

  async telegram(request) {
    if (request.headers.get("x-telegram-bot-api-secret-token") !== (await webhookSecret(this.env.TELEGRAM_BOT_TOKEN))) return json({ ok: false }, 401);
    const update = await request.json();
    const msg = update.message, chat = msg?.chat?.id, text = (msg?.text || "").trim();
    if (!chat || msg.chat.type !== "private") return json({ ok: true });
    const [cmd, arg] = text.split(/\s+/);
    const fr = /^fr/i.test(msg.from?.language_code || "") || this.sql.exec("SELECT lang FROM subs WHERE chat = ? AND lang = 'fr' LIMIT 1", String(chat)).toArray().length > 0;
    if (cmd === "/start" && arg) {
      const p = this.sql.exec("SELECT * FROM pending WHERE code = ? AND created > ?", arg, Date.now() - 3600_000).toArray()[0];
      if (!p) { await this.say(chat, fr ? "Ce lien a expiré. Ouvrez Ecrin et touchez <b>Recevoir les alertes sur Telegram</b> de nouveau." : "That link has expired. Open Ecrin and tap <b>Get alerts on Telegram</b> again."); return json({ ok: true }); }
      const pf = p.lang === "fr";
      if (this.sql.exec("SELECT COUNT(*) AS n FROM subs WHERE chat = ?", String(chat)).one().n >= 10) { await this.say(chat, pf ? "Vous suivez déjà 10 coffres ici, le maximum pour une conversation." : "You're already watching 10 vaults here, the most one chat can follow."); return json({ ok: true }); }
      let extra = []; try { extra = JSON.parse(p.also || "[]"); } catch (_) {}
      for (const t of [{ net: p.net, owner: p.owner, vault: p.vault }, ...extra].slice(0, 3))
        this.sql.exec("INSERT OR REPLACE INTO subs (chat, net, owner, vault, created, lang) VALUES (?, ?, ?, ?, ?, ?)", String(chat), t.net, t.owner, t.vault || "", Date.now(), p.lang || "en");
      this.sql.exec("UPDATE pending SET chat = ? WHERE code = ?", String(chat), arg);
      await this.say(chat, pf ? `🛡 <b>Les alertes sont activées</b>\nEcrin vous écrira ici en moins d'une minute à chaque retrait, dépôt ou changement de règle sur le coffre <code>${esc(short(p.owner))}</code> (${NET_NAME[p.net]}).\n\nEnvoyez /list pour voir ce que vous suivez, /stop pour désactiver les alertes.`
        : `🛡 <b>Alerts are on</b>\nEcrin will message you here within a minute of any withdrawal, deposit or rule change on vault <code>${esc(short(p.owner))}</code> (${NET_NAME[p.net]}).\n\nSend /list to see what you follow, /stop to turn alerts off.`, p.net, null, p.lang);
    } else if (cmd === "/stop") {
      this.sql.exec("DELETE FROM subs WHERE chat = ?", String(chat));
      await this.say(chat, fr ? "Les alertes sont désactivées. Ouvrez Ecrin pour les réactiver en tout temps." : "Alerts are off. Open Ecrin to turn them on again any time.");
    } else if (cmd === "/list") {
      const rows = this.sql.exec("SELECT net, owner FROM subs WHERE chat = ?", String(chat)).toArray();
      await this.say(chat, rows.length ? (fr ? "Vous suivez :\n" : "You follow:\n") + rows.map((r) => `• <code>${esc(short(r.owner))}</code> · ${NET_NAME[r.net]}`).join("\n") : fr ? "Vous ne suivez aucun coffre. Ouvrez Ecrin et touchez <b>Recevoir les alertes sur Telegram</b>." : "You don't follow any vault yet. Open Ecrin and tap <b>Get alerts on Telegram</b>.");
    } else {
      await this.say(chat, fr ? "Ceci est le bot d'alertes Ecrin. Ouvrez Ecrin, allez dans votre coffre et touchez <b>Recevoir les alertes sur Telegram</b> pour le connecter.\n\n/list · ce que vous suivez\n/stop · désactiver les alertes"
        : "This is the Ecrin alert bot. Open Ecrin, go to your vault and tap <b>Get alerts on Telegram</b> to connect it.\n\n/list · what you follow\n/stop · turn alerts off");
    }
    return json({ ok: true });
  }

  async ensureWebhook() {
    if (!this.env.TELEGRAM_BOT_TOKEN) return;
    const want = `${SITE}/api/telegram`;
    if (this.get("webhook") === want) return;
    const r = await this.tg("setWebhook", { url: want, secret_token: await webhookSecret(this.env.TELEGRAM_BOT_TOKEN), allowed_updates: ["message"] });
    if (r.ok) this.set("webhook", want);
  }

  async tick() {
    await this.ensureWebhook();
    const now = Math.floor(Date.now() / 1000);
    await this.tickSol(now).catch((e) => console.error("sol", e));
    for (const net of Object.keys(EVM_NETS)) await this.tickEvm(net, now).catch((e) => console.error(net, e));
  }

  /** Solana vaults someone watches, with their owners. */
  watchedSol() {
    const rows = [...this.sql.exec("SELECT owner, vault FROM subs WHERE net = 'sol'").toArray(), ...this.sql.exec("SELECT owner, vault FROM emails WHERE net = 'sol' AND confirmed = 1").toArray(), ...this.sql.exec("SELECT owner, vault FROM push_subs WHERE net = 'sol'").toArray()];
    return [...new Map(rows.map((r) => [r.vault, r.owner])).entries()].map(([vault, owner]) => ({ vault, owner }));
  }

  /** Vaults (Solana) or owners (Ethereum) someone watches on any channel. */
  watched(net, col) {
    return [...new Set([
      ...this.sql.exec(`SELECT ${col} AS v FROM subs WHERE ${famWhere(net)}`).toArray(),
      ...this.sql.exec(`SELECT ${col} AS v FROM emails WHERE ${famWhere(net)} AND confirmed = 1`).toArray(),
      ...this.sql.exec(`SELECT ${col} AS v FROM push_subs WHERE ${famWhere(net)}`).toArray(),
    ].map((r) => r.v))];
  }

  /** Reads each watched vault, and its USDC token vault and token account, and reports what changed since last time. */
  async tickSol(now) {
    const watched = this.watchedSol();
    if (!watched.length || !CONFIG.programId) return;
    const mint = CONFIG.tokens ? SOL_USDC[CONFIG.cluster] : null;
    const disc = async (name) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("account:" + name))).slice(0, 8);
    const dv = await disc("VaultAccount"), dt = await disc("TokenVaultAccount");
    const is = (acc, d) => { if (!acc || acc.owner !== CONFIG.programId) return null; const data = b64(acc.data[0]); return d.every((b, k) => data[k] === b) ? data : null; };
    const per = mint ? 3 : 1;
    for (let i = 0; i < watched.length; i += Math.floor(99 / per)) {
      const batch = watched.slice(i, i + Math.floor(99 / per));
      const keys = [];
      for (const w of batch) {
        keys.push(w.vault);
        if (mint) { const t = (w.t ||= await tokenVaultAddresses(w.owner, mint, CONFIG.programId).catch(() => null)); keys.push(t?.vault || w.vault, t?.holds || w.vault); }
      }
      const res = await rpc(CONFIG.rpc, "getMultipleAccounts", [keys, { encoding: "base64", commitment: "confirmed" }]);
      for (let j = 0; j < batch.length; j++) {
        const w = batch[j], base = j * per;
        const data = is(res.value[base], dv);
        await this.solDiff(w.vault, w.vault, data ? decodeSolVault(data) : null, now, null);
        if (mint && w.t) {
          const td = is(res.value[base + 1], dt), holds = res.value[base + 2];
          const next = td ? decodeSolTokenVault(td, holds ? tokenAmount(b64(holds.data[0])) : 0) : null;
          await this.solDiff("usdc:" + w.vault, w.vault, next, now, USDC, w.owner);
        }
      }
    }
  }

  /** Compares one snapshot with the last one stored under `key` and alerts everyone watching `vault`. */
  async solDiff(key, vault, next, now, asset, owner) {
    const row = this.sql.exec("SELECT data FROM snaps WHERE net = 'sol' AND k = ?", key).toArray()[0];
    if (row) {
      let prev = JSON.parse(row.data);
      // A token vault that just appeared: diff against an empty one, so its first deposit is reported.
      if (asset && !prev && next) prev = emptyTokenSnap;
      for (const ev of diffSol(prev, next)) {
        if (asset) ev.asset = asset;
        const who = next?.owner || prev?.owner || owner || vault;
        await this.notify("sol", { col: "vault", val: vault }, (lang) => { const m = message(ev, { net: "sol", owner: who, now, lang }); return m && { text: m.text, links: alertLinks(ev, "sol", SITE, who, lang) }; });
      }
    }
    this.sql.exec("INSERT OR REPLACE INTO snaps (net, k, data) VALUES ('sol', ?, ?)", key, JSON.stringify(next));
  }

  /** Reads new contract events on one Ethereum-style network for the owners someone watches. */
  async tickEvm(net, now) {
    const E = EVM_NETS[net];
    if (!E?.address) return;
    const head = parseInt(await rpc(E.rpc, "eth_blockNumber", []), 16) - 2; // a couple of confirmations
    const ck = net === "eth" ? "eth_cursor" : `cursor_${net}`;
    const cursor = Number(this.get(ck) || 0);
    if (!cursor) { this.set(ck, head); return; }
    const owners = this.watched(net, "owner");
    const from = cursor + 1, to = Math.min(head, from + 1999);
    if (from > to) return;
    if (owners.length) {
      const logs = await rpc(E.rpc, "eth_getLogs", [{ address: E.address, fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), topics: [null, owners.map(ownerTopic)] }]);
      for (const log of logs) {
        const d = decodeEvmLog(log, E.usdc);
        if (!d) continue;
        const key = `wd:${d.owner}:${d.event.id}`;
        // Remember queued amounts so a cancel can say how much stayed (ids are unique across coins).
        if (d.event.type === "requested") this.sql.exec("INSERT OR REPLACE INTO snaps (net, k, data) VALUES (?, ?, ?)", net, key, JSON.stringify(d.event));
        if (d.event.type === "cancelled") {
          const q = this.sql.exec("SELECT data FROM snaps WHERE net = ? AND k = ?", net, key).toArray()[0];
          if (q) { Object.assign(d.event, { amount: JSON.parse(q.data).amount }); this.sql.exec("DELETE FROM snaps WHERE net = ? AND k = ?", net, key); }
        }
        await this.notify(net, { col: "owner", val: d.owner }, (lang) => { const m = message(d.event, { net, owner: d.owner, now, lang }); return m && { text: m.text, links: alertLinks(d.event, net, SITE, d.owner, lang) }; });
      }
    }
    this.set(ck, to);
  }
}
