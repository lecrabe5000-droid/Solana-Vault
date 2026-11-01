// Test-only: makes a funded wallet (20 SOL, 500 test USDC) for the Ecrin Wallet extension tests. Local validator only.
import * as web3 from "@solana/web3.js";
import { ethers } from "../extension/node_modules/ethers/lib.esm/index.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { newPhrase, deriveAccount } from "../extension/src/keyring.js";
const c = new web3.Connection("http://127.0.0.1:8899", "confirmed");
const phrase = newPhrase(), { sol } = deriveAccount(phrase, { web3, ethers });
const payer = web3.Keypair.generate();
for (const k of [sol.publicKey, payer.publicKey]) await c.confirmTransaction(await c.requestAirdrop(k, 20 * web3.LAMPORTS_PER_SOL), "confirmed");
const mint = await createMint(c, payer, payer.publicKey, null, 6);
await mintTo(c, payer, mint, (await getOrCreateAssociatedTokenAccount(c, payer, mint, sol.publicKey)).address, payer, 500_000_000);
console.log(JSON.stringify({ phrase, address: sol.publicKey.toBase58(), mint: mint.toBase58(), friend: web3.Keypair.generate().publicKey.toBase58() }));
