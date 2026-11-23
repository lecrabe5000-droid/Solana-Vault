// Tests for worker/pricealert.js. Run: node worker/pricealert.test.mjs
import { priceAlertInput, priceAlertDue, priceAlertText } from "./pricealert.js";

let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.log("FAIL", name, "\n ", e.message); } };
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

test("a normal alert is accepted", () => eq(priceAlertInput({ cg: "bitcoin", dir: "above", price: 70000 }), null));
test("a coin Ecrin doesn't price is refused", () => eq(typeof priceAlertInput({ cg: "dogecoin", dir: "above", price: 1 }), "string"));
test("stablecoins are refused", () => eq(typeof priceAlertInput({ cg: "usd-coin", dir: "below", price: 0.99 }), "string"));
test("a made-up key like __proto__ is refused", () => eq(typeof priceAlertInput({ cg: "__proto__", dir: "above", price: 1 }), "string"));
test("direction must be above or below", () => eq(typeof priceAlertInput({ cg: "solana", dir: "sideways", price: 1 }), "string"));
test("zero, negative, huge and text prices are refused", () => { for (const price of [0, -5, 2e9, "abc", NaN]) eq(typeof priceAlertInput({ cg: "solana", dir: "above", price }), "string"); });
test("above: due at or over the price", () => { const a = { cg: "solana", dir: "above", price: 100 }; eq(priceAlertDue(a, { solana: { usd: 99.99 } }), false); eq(priceAlertDue(a, { solana: { usd: 100 } }), true); });
test("below: due at or under the price", () => { const a = { cg: "solana", dir: "below", price: 60 }; eq(priceAlertDue(a, { solana: { usd: 60.5 } }), false); eq(priceAlertDue(a, { solana: { usd: 59 } }), true); });
test("no price (feed down) is never due", () => { eq(priceAlertDue({ cg: "solana", dir: "below", price: 60 }, {}), false); eq(priceAlertDue({ cg: "solana", dir: "below", price: 60 }, { solana: { usd: 0 } }), false); });
test("English words", () => eq(priceAlertText({ cg: "bitcoin", dir: "above", price: 70000 }, 70123.4, "en"), { title: "BTC is above $70,000", body: "Now $70,123. Tap to open Ecrin." }));
test("French words", () => eq(priceAlertText({ cg: "solana", dir: "below", price: 60 }, 59.5, "fr"), { title: "SOL passe sous $60", body: "Maintenant $59.5. Touchez pour ouvrir Ecrin." }));
test("small prices keep their decimals", () => eq(priceAlertText({ cg: "tron", dir: "above", price: 0.25 }, 0.2512, "en").title, "TRX is above $0.25"));

test("daily move: 5 or 10 only", () => { eq(priceAlertInput({ cg: "solana", dir: "move", price: 5 }), null); eq(typeof priceAlertInput({ cg: "solana", dir: "move", price: 7 }), "string"); });
test("daily move: due once per direction per day", () => {
  const a = { cg: "solana", dir: "move", price: 5 }, P = { solana: { usd: 70, usd_24h_change: -6.2 } };
  eq(priceAlertDue(a, P, "2026-11-23"), true); eq(priceAlertDue({ ...a, last: "2026-11-23:dn" }, P, "2026-11-23"), false);
  eq(priceAlertDue({ ...a, last: "2026-11-23:dn" }, { solana: { usd: 80, usd_24h_change: 7 } }, "2026-11-23"), true); // the other way is new
  eq(priceAlertDue({ ...a, last: "2026-11-22:dn" }, P, "2026-11-23"), true); // a new day
  eq(priceAlertDue(a, { solana: { usd: 70, usd_24h_change: 4.9 } }, "2026-11-23"), false);
});
test("daily move words", () => eq(priceAlertText({ cg: "solana", dir: "move", price: 5 }, 65.4, "en", -6.24).title, "SOL is down 6.2% today"));
console.log(`${passed} passed, ${failed} failed`); if (failed) process.exit(1);
