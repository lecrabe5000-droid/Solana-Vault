// Price alerts, with no I/O: what a valid alert is, when one is due, and the words of its notification.
import { COINS } from "./prices.js";

/** null when the alert is fine, else what's wrong with it (shown to the user). */
export function priceAlertInput({ cg, dir, price }) {
  if (!Object.hasOwn(COINS, String(cg)) || cg === "usd-coin" || cg === "euro-coin") return "Price alerts aren't available for that coin.";
  if (dir === "move") return [5, 10].includes(Number(price)) ? null : "Choose 5% or 10%.";
  if (dir !== "above" && dir !== "below") return "Choose above or below.";
  const n = Number(price); if (!Number.isFinite(n) || n <= 0 || n > 1e9) return "Enter a price above zero.";
  return null;
}

/** Is this alert due at today's prices ({ [cg]: { usd, usd_24h_change } })? A daily-move alert ("move", price = 5 or
 *  10 %) is due once per direction per day: `day` is today's date (YYYY-MM-DD), `a.last` the last day+direction sent. */
export function priceAlertDue(a, prices, day) {
  const p = prices?.[a.cg], now = p?.usd;
  if (a.dir === "move") { const ch = p?.usd_24h_change; if (ch == null || Math.abs(ch) < a.price) return false; return a.last !== `${day}:${ch > 0 ? "up" : "dn"}`; }
  return now > 0 && (a.dir === "above" ? now >= a.price : now <= a.price);
}

/** The notification: "BTC is above $70,000" / "Now $70,123. Tap to open Ecrin." (English or French). */
export function priceAlertText(a, now, lang, ch) {
  const sym = COINS[a.cg], f = (n) => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : n >= 1 ? 2 : 6 });
  if (a.dir === "move") { const up = ch > 0, pc = Math.abs(ch).toFixed(1);
    return lang === "fr"
      ? { title: `${sym} ${up ? "en hausse" : "en baisse"} de ${pc.replace(".", ",")} % aujourd\u2019hui`, body: `Maintenant ${f(now)}. Touchez pour ouvrir Ecrin.` }
      : { title: `${sym} is ${up ? "up" : "down"} ${pc}% today`, body: `Now ${f(now)}. Tap to open Ecrin.` }; }
  return lang === "fr"
    ? { title: `${sym} ${a.dir === "above" ? "dépasse" : "passe sous"} ${f(a.price)}`, body: `Maintenant ${f(now)}. Touchez pour ouvrir Ecrin.` }
    : { title: `${sym} is ${a.dir === "above" ? "above" : "below"} ${f(a.price)}`, body: `Now ${f(now)}. Tap to open Ecrin.` };
}
