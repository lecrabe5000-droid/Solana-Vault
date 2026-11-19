// If Jupiter refuses Ecrin's fee account, swaps still get a quote (without the fee) instead of an error.
import assert from "node:assert";
import { handleSwap } from "./swap.js";
const SOL = "So11111111111111111111111111111111111111112", USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const env = { JUPITER_API_KEY: "test", SWAP_ENABLED: "1", JUPITER_REFERRAL_ACCOUNT: "9FV9MRrSvGHxyuvAeLKZ7MYs3XCL5mppCjzf4tXzrdx" };
const req = new Request(`https://x/api/swap?inputMint=${SOL}&outputMint=${USDC}&amount=1000`);
const calls = [];
const ok = JSON.stringify({ transaction: "AAAA", requestId: "r1", outAmount: "1" });
// 1. Jupiter refuses the referral account: a second request without it, and that answer comes back.
globalThis.fetch = async (u) => { calls.push(String(u)); return /referralAccount/.test(String(u)) ? new Response(JSON.stringify({ error: "Please check that referralAccount is initialized" }), { status: 400 }) : new Response(ok, { status: 200 }); };
let r = await handleSwap(req, env), j = await r.json();
assert.equal(calls.length, 2); assert.ok(/referralAccount/.test(calls[0]) && !/referralAccount/.test(calls[1])); assert.equal(j.requestId, "r1");
// 2. Jupiter accepts it: one request, with the fee.
calls.length = 0; globalThis.fetch = async (u) => { calls.push(String(u)); return new Response(ok, { status: 200 }); };
r = await handleSwap(req, env); j = await r.json();
assert.equal(calls.length, 1); assert.ok(/referralFee=88/.test(calls[0])); assert.equal(j.transaction, "AAAA");
// 3. Any other Jupiter error is passed through as it is (no retry without the fee).
calls.length = 0; globalThis.fetch = async (u) => { calls.push(String(u)); return new Response(JSON.stringify({ error: "Insufficient liquidity" }), { status: 400 }); };
r = await handleSwap(req, env); assert.equal(calls.length, 1); assert.equal(r.status, 400);
console.log("swap fee fallback ok");
