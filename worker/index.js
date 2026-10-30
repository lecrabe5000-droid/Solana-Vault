// Serves the site from app/ and keeps one official address: www and the production workers.dev host
// redirect (301) to https://ecrinprotocol.app, path and query kept. Version previews
// (<id>-solana-vault.<account>.workers.dev) are left alone.
const CANONICAL = "ecrinprotocol.app";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www." + CANONICAL || /^solana-vault\.[^.]+\.workers\.dev$/.test(url.hostname)) {
      url.protocol = "https:";
      url.hostname = CANONICAL;
      url.port = "";
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
