// Serves the site from app/, keeps one official address, and runs Ecrin alerts.
// - www and the production workers.dev host redirect (301) to https://ecrinprotocol.app, path and query kept.
//   Version previews (<id>-solana-vault.<account>.workers.dev) are left alone.
// - /api/alerts/* and /api/telegram go to the AlertHub Durable Object; a cron runs its check every minute.
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
    const route = { "/api/alerts/start": "/start", "/api/alerts/status": "/status", "/api/telegram": "/telegram" }[url.pathname];
    if (route) return hub(env).fetch(new Request("https://hub" + route + url.search, request));
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, env, ctx) {
    if (env.TELEGRAM_BOT_TOKEN) ctx.waitUntil(hub(env).fetch("https://hub/tick", { method: "POST" }));
  },
};
