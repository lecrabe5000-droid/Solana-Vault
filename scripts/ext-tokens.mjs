// Local test only: gives the test wallet a named token, a spam-named token and a 1-of-1 collectible (Token-2022 with
// its metadata extension), on a local validator. Usage: node scripts/ext-tokens.mjs <owner address>
import * as web3 from "@solana/web3.js";
import { ExtensionType, TOKEN_2022_PROGRAM_ID, createInitializeMetadataPointerInstruction, createInitializeMintInstruction, getMintLen, LENGTH_SIZE, TYPE_SIZE, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { createInitializeInstruction, pack } from "@solana/spl-token-metadata";
const c = new web3.Connection("http://127.0.0.1:8899", "confirmed"), owner = new web3.PublicKey(process.argv[2]);
const payer = web3.Keypair.generate(); await c.confirmTransaction(await c.requestAirdrop(payer.publicKey, 5e9));
async function make(name, symbol, uri, dec, amount) {
  const mint = web3.Keypair.generate(), md = { mint: mint.publicKey, name, symbol, uri, additionalMetadata: [] };
  const len = getMintLen([ExtensionType.MetadataPointer]), mdLen = TYPE_SIZE + LENGTH_SIZE + pack(md).length;
  const tx = new web3.Transaction().add(
    web3.SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, space: len, lamports: await c.getMinimumBalanceForRentExemption(len + mdLen), programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeMetadataPointerInstruction(mint.publicKey, payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint.publicKey, dec, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({ programId: TOKEN_2022_PROGRAM_ID, metadata: mint.publicKey, updateAuthority: payer.publicKey, mint: mint.publicKey, mintAuthority: payer.publicKey, name, symbol, uri }));
  await web3.sendAndConfirmTransaction(c, tx, [payer, mint]);
  const ata = await getOrCreateAssociatedTokenAccount(c, payer, mint.publicKey, owner, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID);
  await mintTo(c, payer, mint.publicKey, ata.address, payer, amount, [], undefined, TOKEN_2022_PROGRAM_ID);
  return mint.publicKey.toBase58();
}
const out = { good: await make("Ecrin Test Token", "ETT", "", 6, 42_500_000), spam: await make("Visit claim-sol.xyz to claim 500 SOL", "CLAIM", "", 0, 1000), nft: await make("Ecrin Diamond #7", "ECD", "http://127.0.0.1:8092/nft.json", 0, 1) };
console.log(JSON.stringify(out));
