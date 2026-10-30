// AlertHub: one Durable Object (SQLite) that holds alert subscriptions and runs the minute-by-minute check.
// Telegram is the only channel for now; it needs the TELEGRAM_BOT_TOKEN secret on the Worker.
import { DurableObject } from "cloudflare:workers";
import { CONFIG } from "../app/config.js";
import { EVM } from "../app/config-evm.js";
import { b64, decodeSolVault, diffSol, decodeEvmLog, message, ownerTopic, short, esc } from "./alerts.js";

const SITE = "https://ecrinprotocol.app";
const NET_NAME = { sol: "Solana devnet", eth: "Ethereum Sepolia" };
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, ETH_ADDR = /^0x[0-9a-fA-F]{40}$/;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function sha256hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** The secret Telegram echoes back on every webhook call, derived from the bot token so there is nothing else to configure. */
export const webhookSecret = async (token) => (await sha256hex("ecrin-webhook:" + token)).slice(0, 48);

async function rpc(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

export class AlertHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS pending (code TEXT PRIMARY KEY, net TEXT, owner TEXT, vault TEXT, created INTEGER, chat TEXT);
      CREATE TABLE IF NOT EXISTS subs (chat TEXT, net TEXT, owner TEXT, vault TEXT, created INTEGER, PRIMARY KEY (chat, net, owner));
      CREATE TABLE IF NOT EXISTS snaps (net TEXT, k TEXT, data TEXT, PRIMARY KEY (net, k));
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);`);
  }

  get(k) { return this.sql.exec("SELECT v FROM kv WHERE k = ?", k).toArray()[0]?.v ?? null; }
  set(k, v) { this.sql.exec("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", k, String(v)); }

  async tg(method, body) {
    const r = await fetch(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return r.json().catch(() => ({ ok: false }));
  }
  async say(chat, text, net) {
    const body = { chat_id: chat, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } };
    if (net) body.reply_markup = { inline_keyboard: [[{ text: "Open Ecrin", url: `${SITE}/app?net=${net}&tab=vault` }]] };
    const r = await this.tg("sendMessage", body);
    // The person blocked the bot or deleted the chat: stop sending there.
    if (!r.ok && r.error_code === 403) this.sql.exec("DELETE FROM subs WHERE chat = ?", String(chat));
    return r.ok;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (!this.env.TELEGRAM_BOT_TOKEN) return json({ error: "Alerts aren't switched on yet." }, 503);
    try {
      if (url.pathname === "/start" && request.method === "POST") return await this.start(await request.json());
      if (url.pathname === "/status") return this.status(url.searchParams.get("code") || "");
      if (url.pathname === "/telegram" && request.method === "POST") return await this.telegram(request);
      if (url.pathname === "/tick") { await this.tick(); return json({ ok: true }); }
    } catch (e) { console.error(e); return json({ error: "Something went wrong. Try again." }, 500); }
    return json({ error: "Not found" }, 404);
  }

  /** The app asks for a Telegram link for one vault; the person proves the chat is theirs by pressing Start. */
  async start({ net, owner, vault }) {
    if (!(net in NET_NAME)) return json({ error: "Unknown network" }, 400);
    if (net === "sol" ? !(SOL_ADDR.test(owner || "") && SOL_ADDR.test(vault || "")) : !ETH_ADDR.test(owner || "")) return json({ error: "That address isn't valid" }, 400);
    const now = Date.now();
    this.sql.exec("DELETE FROM pending WHERE created < ?", now - 3600_000);
    if (this.sql.exec("SELECT COUNT(*) AS n FROM pending").one().n > 5000) return json({ error: "Too many requests right now. Try again in a minute." }, 429);
    const code = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
    this.sql.exec("INSERT INTO pending (code, net, owner, vault, created) VALUES (?, ?, ?, ?, ?)", code, net, net === "eth" ? owner.toLowerCase() : owner, vault || "", now);
    let bot = this.get("bot");
    if (!bot) { const me = await this.tg("getMe", {}); bot = me.result?.username; if (!bot) return json({ error: "The Telegram bot isn't reachable." }, 503); this.set("bot", bot); }
    await this.ensureWebhook();
    return json({ code, url: `https://t.me/${bot}?start=${code}` });
  }

  status(code) {
    const row = this.sql.exec("SELECT chat FROM pending WHERE code = ?", code).toArray()[0];
    return json({ linked: !!row?.chat });
  }

  async telegram(request) {
    if (request.headers.get("x-telegram-bot-api-secret-token") !== (await webhookSecret(this.env.TELEGRAM_BOT_TOKEN))) return json({ ok: false }, 401);
    const update = await request.json();
    const msg = update.message, chat = msg?.chat?.id, text = (msg?.text || "").trim();
    if (!chat || msg.chat.type !== "private") return json({ ok: true });
    const [cmd, arg] = text.split(/\s+/);
    if (cmd === "/start" && arg) {
      const p = this.sql.exec("SELECT * FROM pending WHERE code = ? AND created > ?", arg, Date.now() - 3600_000).toArray()[0];
      if (!p) { await this.say(chat, "That link has expired. Open Ecrin and tap <b>Get alerts on Telegram</b> again."); return json({ ok: true }); }
      if (this.sql.exec("SELECT COUNT(*) AS n FROM subs WHERE chat = ?", String(chat)).one().n >= 10) { await this.say(chat, "You're already watching 10 vaults here, the most one chat can follow."); return json({ ok: true }); }
      this.sql.exec("INSERT OR REPLACE INTO subs (chat, net, owner, vault, created) VALUES (?, ?, ?, ?, ?)", String(chat), p.net, p.owner, p.vault, Date.now());
      this.sql.exec("UPDATE pending SET chat = ? WHERE code = ?", String(chat), arg);
      await this.say(chat, `🛡 <b>Alerts are on</b>\nEcrin will message you here within a minute of any withdrawal, deposit or rule change on vault <code>${esc(short(p.owner))}</code> (${NET_NAME[p.net]}).\n\nSend /list to see what you follow, /stop to turn alerts off.`, p.net);
    } else if (cmd === "/stop") {
      this.sql.exec("DELETE FROM subs WHERE chat = ?", String(chat));
      await this.say(chat, "Alerts are off. Open Ecrin to turn them on again any time.");
    } else if (cmd === "/list") {
      const rows = this.sql.exec("SELECT net, owner FROM subs WHERE chat = ?", String(chat)).toArray();
      await this.say(chat, rows.length ? "You follow:\n" + rows.map((r) => `• <code>${esc(short(r.owner))}</code> · ${NET_NAME[r.net]}`).join("\n") : "You don't follow any vault yet. Open Ecrin and tap <b>Get alerts on Telegram</b>.");
    } else {
      await this.say(chat, "This is the Ecrin alert bot. Open Ecrin, go to your vault and tap <b>Get alerts on Telegram</b> to connect it.\n\n/list · what you follow\n/stop · turn alerts off");
    }
    return json({ ok: true });
  }

  async ensureWebhook() {
    const want = `${SITE}/api/telegram`;
    if (this.get("webhook") === want) return;
    const r = await this.tg("setWebhook", { url: want, secret_token: await webhookSecret(this.env.TELEGRAM_BOT_TOKEN), allowed_updates: ["message"] });
    if (r.ok) this.set("webhook", want);
  }

  async tick() {
    await this.ensureWebhook();
    const now = Math.floor(Date.now() / 1000);
    await this.tickSol(now).catch((e) => console.error("sol", e));
    await this.tickEth(now).catch((e) => console.error("eth", e));
  }

  async tickSol(now) {
    const subs = this.sql.exec("SELECT chat, owner, vault FROM subs WHERE net = 'sol'").toArray();
    if (!subs.length || !CONFIG.programId) return;
    const vaults = [...new Set(subs.map((s) => s.vault))];
    const disc = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("account:VaultAccount"))).slice(0, 8);
    for (let i = 0; i < vaults.length; i += 100) {
      const batch = vaults.slice(i, i + 100);
      const res = await rpc(CONFIG.rpc, "getMultipleAccounts", [batch, { encoding: "base64", commitment: "confirmed" }]);
      for (let j = 0; j < batch.length; j++) {
        const acc = res.value[j], vault = batch[j];
        let next = null;
        if (acc && acc.owner === CONFIG.programId) {
          const data = b64(acc.data[0]);
          if (disc.every((b, k) => data[k] === b)) next = decodeSolVault(data);
        }
        const row = this.sql.exec("SELECT data FROM snaps WHERE net = 'sol' AND k = ?", vault).toArray()[0];
        if (row) {
          const prev = JSON.parse(row.data);
          for (const ev of diffSol(prev, next)) {
            const owner = next?.owner || prev?.owner || vault, m = message(ev, { net: "sol", owner, now });
            if (m) for (const s of subs.filter((s) => s.vault === vault)) await this.say(s.chat, m.text, "sol");
          }
        }
        this.sql.exec("INSERT OR REPLACE INTO snaps (net, k, data) VALUES ('sol', ?, ?)", vault, JSON.stringify(next));
      }
    }
  }

  async tickEth(now) {
    if (!EVM.address) return;
    const head = parseInt(await rpc(EVM.rpc, "eth_blockNumber", []), 16) - 2; // a couple of confirmations
    const cursor = Number(this.get("eth_cursor") || 0);
    if (!cursor) { this.set("eth_cursor", head); return; }
    const subs = this.sql.exec("SELECT chat, owner FROM subs WHERE net = 'eth'").toArray();
    const from = cursor + 1, to = Math.min(head, from + 1999);
    if (from > to) return;
    if (subs.length) {
      const owners = [...new Set(subs.map((s) => s.owner))];
      const logs = await rpc(EVM.rpc, "eth_getLogs", [{ address: EVM.address, fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), topics: [null, owners.map(ownerTopic)] }]);
      for (const log of logs) {
        const d = decodeEvmLog(log);
        if (!d) continue;
        const key = `wd:${d.owner}:${d.event.id}`;
        // Remember queued amounts so a cancel can say how much stayed.
        if (d.event.type === "requested") this.sql.exec("INSERT OR REPLACE INTO snaps (net, k, data) VALUES ('eth', ?, ?)", key, JSON.stringify(d.event));
        if (d.event.type === "cancelled") {
          const q = this.sql.exec("SELECT data FROM snaps WHERE net = 'eth' AND k = ?", key).toArray()[0];
          if (q) { Object.assign(d.event, { amount: JSON.parse(q.data).amount }); this.sql.exec("DELETE FROM snaps WHERE net = 'eth' AND k = ?", key); }
        }
        const m = message(d.event, { net: "eth", owner: d.owner, now });
        if (m) for (const s of subs.filter((s) => s.owner === d.owner)) await this.say(s.chat, m.text, "eth");
      }
    }
    this.set("eth_cursor", to);
  }
}
