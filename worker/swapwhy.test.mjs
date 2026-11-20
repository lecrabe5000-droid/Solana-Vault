import { swapWhy } from "./bridge.js";
import assert from "node:assert/strict";
const c = (e) => swapWhy(e).code;
assert.equal(c("No available quotes for the requested transfer | AMOUNT_TOO_LOW The amount is too low"), "AMOUNT_LOW");
assert.equal(c("No available quotes for the requested transfer"), "NO_ROUTE");
assert.equal(c("insufficient balance"), "BALANCE");
assert.equal(c("Price impact too high"), "IMPACT");
assert.equal(c("weird thing"), "OTHER");
console.log("swap why ok");
