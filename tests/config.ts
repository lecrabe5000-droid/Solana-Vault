// The program-wide settings account (the emergency brake on new deposits): set up once by the upgrade authority.
// Every test file calls ensureConfig() first; it does nothing when the settings already exist.
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CooldownVault } from "../target/types/cooldown_vault";

const LOADER = new anchor.web3.PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

export const configAddress = (program: Program<CooldownVault>) =>
  anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
export const programDataAddress = (program: Program<CooldownVault>) =>
  anchor.web3.PublicKey.findProgramAddressSync([program.programId.toBuffer()], LOADER)[0];

export async function ensureConfig(program: Program<CooldownVault>, authority: anchor.web3.PublicKey) {
  const config = configAddress(program);
  if (await program.provider.connection.getAccountInfo(config)) return config;
  await program.methods.initConfig()
    .accountsPartial({ authority, config, program: program.programId, programData: programDataAddress(program) })
    .rpc();
  return config;
}
