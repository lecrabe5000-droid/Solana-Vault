// After a devnet deploy: checks the program account exists and is executable, and that the browser client
// can talk to it (looks up the deployer's vault, which may or may not exist yet).
import * as web3 from "@solana/web3.js";
import { createClient } from "../app/chain.js";
const rpc = process.env.RPC || "https://api.devnet.solana.com", programId = new web3.PublicKey(process.env.PROGRAM_ID), who = new web3.PublicKey(process.env.DEPLOYER);
const connection = new web3.Connection(rpc, "confirmed");
const info = await connection.getAccountInfo(programId);
if (!info?.executable) { console.error("program account missing or not executable"); process.exit(1); }
const client = createClient({ web3, connection, programId });
const vault = await client.fetchVault(who);
console.log(`program ${programId.toBase58()} is live on devnet; deployer vault: ${vault ? "exists" : "none yet"} (${client.vaultAddress(who).toBase58()})`);
