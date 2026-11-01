// Serves the site from app/, keeps one official address, and runs Ecrin alerts.
// - www and the production workers.dev host redirect (301) to https://ecrinprotocol.app, path and query kept.
//   Version previews (<id>-solana-vault.<account>.workers.dev) are left alone.
// - /api/alerts/* (Telegram link, email sign-up, confirm, unsubscribe), /api/telegram, /api/waitlist and /api/stats go to the AlertHub
//   Durable Object; a cron runs its check every minute once a channel's secret is set.
import { AlertHub } from "./hub.js";

export { AlertHub };

const CANONICAL = "ecrinprotocol.app";
const hub = (env) => env.HUB.get(env.HUB.idFromName("main"));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www." + CANONICAL || /^solana-vault\.[^.]+\.workers\.dev$/.test(url.hostname)) {
      url.protocol = "https:";
      url.hostname = CANONICAL;
      url.port = "";
      return Response.redirect(url.toString(), 301);
    }
    const route = { "/api/alerts/start": "/start", "/api/alerts/status": "/status", "/api/alerts/email": "/email", "/api/alerts/confirm": "/confirm", "/api/alerts/unsub": "/unsub", "/api/telegram": "/telegram", "/api/waitlist": "/waitlist", "/api/waitlist/confirm": "/wconfirm", "/api/stats": "/stats", "/api/push/key": "/pushkey", "/api/push/subscribe": "/pushsub", "/api/push/unsubscribe": "/pushunsub" }[url.pathname];
    if (route) return hub(env).fetch(new Request("https://hub" + route + url.search, request));
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, env, ctx) {
    // Telegram and email need their secrets; phone notifications need nothing, so the check always runs.
    ctx.waitUntil(hub(env).fetch("https://hub/tick", { method: "POST" }));
  },
};
