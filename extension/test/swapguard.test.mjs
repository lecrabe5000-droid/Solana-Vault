// The swap safety check (chains.js swapSign): an honest swap passes and gets signed; swaps that take more than
// chosen, take another coin, hand a token account away, add a spending permission or need another signer are refused.
// A tiny fake Solana node answers the wallet's questions, so this runs without the network.
import assert from "node:assert/strict";
import http from "node:http";
import * as web3 from "@solana/web3.js";
import { ethers } from "ethers";
import { deriveAccount } from "../src/keyring.js";
import { engine } from "../src/chains.js";

const acct = deriveAccount("legal winner thank year wave sausage worth useful legal winner thank yellow", { web3, ethers });
const me = acct.sol.publicKey, TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const USDC = new web3.PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), BONK = web3.Keypair.generate().publicKey, thief = web3.Keypair.generate().publicKey;
const usdcAcc = web3.Keypair.generate().publicKey, bonkAcc = web3.Keypair.generate().publicKey;
const tokData = (mint, owner, amount, deleg = false) => { const d = Buffer.alloc(165); mint.toBuffer().copy(d, 0); owner.toBuffer().copy(d, 32); d.writeBigUInt64LE(BigInt(amount), 64); if (deleg) { d.writeUInt32LE(1, 72); thief.toBuffer().copy(d, 76); } d[108] = 1; return d.toString("base64"); };
const SOL = 2_000_000_000;
let after; // what the dry run reports for [me, usdcAcc, bonkAcc]
const acc = (lamports, data, owner = "11111111111111111111111111111111") => ({ data: [data || "", "base64"], executable: false, lamports, owner, rentEpoch: 0, space: data ? 165 : 0 });
const srv = http.createServer((q, r) => { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => {
  const c = JSON.parse(b), ctx = { slot: 1 }; let result;
  if (c.method === "getTokenAccountsByOwner") result = { context: ctx, value: c.params[1].programId === TOKEN ? [{ pubkey: usdcAcc.toBase58(), account: acc(2039280, tokData(USDC, me, 50_000_000), TOKEN) }, { pubkey: bonkAcc.toBase58(), account: acc(2039280, tokData(BONK, me, 9_000_000), TOKEN) }] : [] };
  else if (c.method === "getBalance") result = { context: ctx, value: SOL };
  else if (c.method === "simulateTransaction") result = { context: ctx, value: { err: null, logs: [], accounts: after, unitsConsumed: 1000, returnData: null } };
  else result = null;
  r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ jsonrpc: "2.0", id: c.id, result }));
}); });
await new Promise((ok) => srv.listen(0, ok));
const e = engine({ web3, ethers, acct, net: "solm", dev: { solRpc: `http://127.0.0.1:${srv.address().port}` } });
const swapTx = (payer = me, extraSigner = null) => {
  const ixs = [web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: thief, lamports: 1 })];
  if (extraSigner) ixs.push(web3.SystemProgram.transfer({ fromPubkey: extraSigner, toPubkey: thief, lamports: 1 }));
  const m = new web3.TransactionMessage({ payerKey: payer, recentBlockhash: "11111111111111111111111111111111", instructions: ixs }).compileToV0Message();
  return Buffer.from(new web3.VersionedTransaction(m).serialize()).toString("base64");
};
const pay1 = { inMint: "So11111111111111111111111111111111111111112", inRaw: "1000000000" }; // paying 1 SOL
const ok = (s) => assert.ok(s && typeof s === "string");
const no = async (f, re) => assert.rejects(f, (x) => { assert.match(x.message, re); return true; });

// honest: 1 SOL + fees out, 150 USDC in
after = [acc(SOL - 1_000_000_000 - 2_100_000), acc(2039280, tokData(USDC, me, 200_000_000), TOKEN), acc(2039280, tokData(BONK, me, 9_000_000), TOKEN)];
const signed = await e.swapSign(swapTx(), pay1); ok(signed);
const vt = web3.VersionedTransaction.deserialize(Buffer.from(signed, "base64"));
assert.ok(vt.signatures[0].some((x) => x !== 0), "signed");
// more SOL than chosen
after = [acc(SOL - 1_500_000_000), after[1], after[2]];
await no(() => e.swapSign(swapTx(), pay1), /more SOL/);
// another coin leaves
after = [acc(SOL - 1_000_000_000 - 2_000_000), acc(2039280, tokData(USDC, me, 200_000_000), TOKEN), acc(2039280, tokData(BONK, me, 1), TOKEN)];
await no(() => e.swapSign(swapTx(), pay1), /coin you didn't choose/);
// a token account handed to someone else
after = [acc(SOL - 1_000_000_000 - 2_000_000), acc(2039280, tokData(USDC, thief, 50_000_000), TOKEN), after[2]];
await no(() => e.swapSign(swapTx(), pay1), /someone else/);
// a spending permission added
after = [acc(SOL - 1_000_000_000 - 2_000_000), acc(2039280, tokData(USDC, me, 200_000_000, true), TOKEN), acc(2039280, tokData(BONK, me, 9_000_000), TOKEN)];
await no(() => e.swapSign(swapTx(), pay1), /permission/);
// paying USDC: taking more USDC than typed
after = [acc(SOL - 2_000_000), acc(2039280, tokData(USDC, me, 0), TOKEN), acc(2039280, tokData(BONK, me, 9_000_000), TOKEN)];
await no(() => e.swapSign(swapTx(), { inMint: USDC.toBase58(), inRaw: "10000000" }), /more than you typed/);
// someone else pays / signs
await no(() => e.swapSign(swapTx(thief), pay1), /another signer/);
await no(() => e.swapSign(swapTx(me, thief), pay1), /another signer/);
srv.close();
console.log("swap guard ok");
