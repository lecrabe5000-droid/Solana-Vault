// After a deploy: creates the program-wide settings (the emergency brake on new deposits) if they don't exist yet.
// Signed by the upgrade authority (~/.config/solana/id.json), the only key the program accepts for this.
// Usage: RPC=… PROGRAM_ID=… node scripts/init-config.mjs
import * as web3 from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import { createHash } from "node:crypto";

const rpc = process.env.RPC || "https://api.devnet.solana.com", programId = new web3.PublicKey(process.env.PROGRAM_ID);
const connection = new web3.Connection(rpc, "confirmed");
const authority = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/id.json`, "utf8"))));
const LOADER = new web3.PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const config = web3.PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
const programData = web3.PublicKey.findProgramAddressSync([programId.toBuffer()], LOADER)[0];

if (await connection.getAccountInfo(config)) {
  console.log(`settings already exist at ${config.toBase58()}`);
  process.exit(0);
}
const data = createHash("sha256").update("global:init_config").digest().subarray(0, 8);
const ix = new web3.TransactionInstruction({
  programId, data,
  keys: [
    { pubkey: authority.publicKey, isSigner: true, isWritable: true },
    { pubkey: config, isSigner: false, isWritable: true },
    { pubkey: programId, isSigner: false, isWritable: false },
    { pubkey: programData, isSigner: false, isWritable: false },
    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
  ],
});
// Confirm by polling: some RPC providers never answer the websocket sendAndConfirm waits on.
const tx = new web3.Transaction().add(ix);
tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash; tx.feePayer = authority.publicKey; tx.sign(authority);
const sig = await connection.sendRawTransaction(tx.serialize());
for (let i = 0; ; i++) {
  const st = (await connection.getSignatureStatuses([sig])).value[0];
  if (st?.err) throw new Error(`init_config failed: ${JSON.stringify(st.err)}`);
  if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") break;
  if (i > 60) throw new Error(`init_config not confirmed after 2 minutes: ${sig}`);
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(`settings created at ${config.toBase58()} (${sig}); the brake holder is ${authority.publicKey.toBase58()}`);
