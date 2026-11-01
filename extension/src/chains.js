// Every network the wallet supports, behind one shape. Amounts follow the web app: the network's own coin in 1e9
// base units (lamports on Solana, gwei elsewhere), USDC in 1e6 units. The vault code is the web app's own
// (app/chain.js, app/evm.js), so the wallet and the site always agree on the rules.
import { createClient } from "../../app/chain.js";
import { createEvmClient, explainEvmError } from "../../app/evm.js";
import { explainError } from "../../app/chain.js";
import { CONFIG } from "../../app/config.js";
import { SOL_USDC } from "../../app/config-tokens.js";
import { EVM_NETS } from "../../app/config-evm.js";

export const NETS = {
  sol: { key: "sol", fam: "sol", name: "Solana", net: "Devnet", unit: "SOL", cg: "solana", explorer: (k, id) => `https://explorer.solana.com/${k}/${id}?cluster=devnet`, usdc: SOL_USDC.devnet, contract: CONFIG.programId, rpc: CONFIG.rpc, faucet: "https://faucet.solana.com" },
  ...Object.fromEntries(Object.values(EVM_NETS).map((E) => [E.key, { key: E.key, fam: "evm", name: E.name, net: E.net, unit: E.unit, cg: E.cg, explorer: (k, id) => `${E.explorer}/${k}/${id}`, usdc: E.usdc, contract: E.address, rpc: E.rpc, faucet: E.faucet, E, tokens: E.v >= 2 }])),
};
export const BASE = 1e9, USDC_BASE = 1e6;

const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });

/** The wallet on one network. `acct` comes from keyring.deriveAccount; `dev` overrides RPC and program for local tests. */
export function engine({ web3, ethers, acct, net, dev = {} }) {
  const N = NETS[net];
  return N.fam === "sol" ? solEngine({ web3, acct, N, dev }) : evmEngine({ ethers, acct, N, dev });
}

function solEngine({ web3, acct, N, dev }) {
  const conn = new web3.Connection(dev.solRpc || N.rpc, "confirmed");
  const programId = dev.programId || N.contract, mintAddr = dev.usdcMint || N.usdc;
  const client = createClient({ web3, connection: conn, programId });
  const me = acct.sol.publicKey, kp = acct.sol;
  const mint = new web3.PublicKey(mintAddr), tok = client.token(mint);
  const TOKEN = new web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), ATA = new web3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  const createAta = (payer, who) => new web3.TransactionInstruction({ programId: ATA, data: Uint8Array.of(1), keys: [meta(payer, true, true), meta(client.ata(who, mint), false, true), meta(who, false, false), meta(mint, false, false), meta(web3.SystemProgram.programId, false, false), meta(TOKEN, false, false)] });

  async function run(...ixs) {
    const list = (await Promise.all(ixs.flat())).flat();
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const tx = new web3.Transaction({ feePayer: me, blockhash, lastValidBlockHeight }).add(...list);
    tx.sign(kp);
    const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
    const r = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (r.value.err) throw new Error("The transaction failed on-chain.");
    return sig;
  }
  const key = (s) => { try { const k = new web3.PublicKey(String(s).trim()); return k; } catch (_) { return null; } };

  return {
    N, address: me.toBase58(), key, explain: explainError,
    isAddress: (s) => !!key(s),
    async balances() {
      const [native, usdc] = await Promise.all([conn.getBalance(me, "confirmed"), tok.walletBalance(me)]);
      return { native, usdc };
    },
    async vault() {
      const v = await client.fetchVault(me);
      if (!v) return null;
      const t = await tok.fetch(me).catch(() => null);
      return { main: v, usdc: t };
    },
    /** What to keep back so "100%" still pays the network fee. */
    reserve: (asset) => (asset === "native" ? 10_000 : 0),
    feeText: () => "≈ 0.000005 SOL",
    async send(asset, to, amount) {
      const dest = key(to);
      if (asset === "native") return run(web3.SystemProgram.transfer({ fromPubkey: me, toPubkey: dest, lamports: amount }));
      // transferChecked (12): amount u64, decimals u8; the receiver's token account is created first if missing.
      const data = new Uint8Array(10); data[0] = 12; new DataView(data.buffer).setBigUint64(1, BigInt(amount), true); data[9] = 6;
      return run(createAta(me, dest), new web3.TransactionInstruction({ programId: TOKEN, data, keys: [meta(client.ata(me, mint), false, true), meta(mint, false, false), meta(client.ata(dest, mint), false, true), meta(me, true, false)] }));
    },
    createVault: (kind) => run(client.build.initialize(me, { kind })),
    async protect(asset, amount) {
      if (asset === "native") return run(client.build.deposit(me, amount));
      const t = await tok.fetch(me).catch(() => null);
      return run(...(t ? [] : [tok.build.open(me)]), tok.build.deposit(me, amount));
    },
    request: (asset, dest, amount) => run(asset === "native" ? client.build.requestWithdrawal(me, key(dest), amount) : tok.build.requestWithdrawal(me, key(dest), amount)),
    cancel: (asset, id) => run(asset === "native" ? client.build.cancelWithdrawal(me, id) : tok.build.cancelWithdrawal(me, id)),
    execute: (asset, id, dest) => run(asset === "native" ? client.build.executeWithdrawal(me, me, id, key(dest)) : tok.build.executeWithdrawal(me, me, id, key(dest))),
    chainTime: () => client.chainTime(),
  };
}

function evmEngine({ ethers, acct, N, dev }) {
  const E = { ...N.E, ...(dev.evm?.[N.key] || {}) };
  const provider = new ethers.JsonRpcProvider(E.rpc, E.chainId, { staticNetwork: true });
  const wallet = acct.evm.connect(provider);
  const client = E.address ? createEvmClient({ ethers, EVM: E, readProvider: provider, getSigner: async () => wallet }) : null;
  const usdc = new ethers.Contract(E.usdc, ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"], wallet);
  const GWEI = 1_000_000_000n;
  const done = async (t) => { const r = await t.wait(); if (!r || r.status !== 1) throw new Error("The transaction failed on-chain."); return t.hash; };
  const vt = client ? client.token(E.usdc) : null;
  async function gasUnits(limit) {
    const f = await provider.getFeeData();
    const price = f.maxFeePerGas || f.gasPrice || 0n;
    // Layer-2 networks add a small fee for posting to Ethereum; keep a margin for it.
    return Number((BigInt(limit) * price * 13n) / 10n / GWEI) + (E.key === "eth" || E.key === "pol" ? 0 : 20_000);
  }
  return {
    N, address: wallet.address, key: (s) => { try { return ethers.getAddress(String(s).trim()); } catch (_) { return null; } },
    isAddress: (s) => { try { ethers.getAddress(String(s).trim()); return true; } catch (_) { return false; } },
    explain: (e) => explainEvmError(e, client?.iface), hasVaults: !!client, tokens: N.tokens,
    async balances() {
      const [w, u] = await Promise.all([provider.getBalance(wallet.address), usdc.balanceOf(wallet.address).catch(() => 0n)]);
      return { native: Number(w / GWEI), usdc: Number(u) };
    },
    async vault() {
      if (!client) return null;
      const v = await client.fetchVault(wallet.address);
      if (!v) return null;
      return { main: v, usdc: N.tokens ? await vt.fetch(wallet.address).catch(() => null) : null };
    },
    reserve: async (asset) => (asset === "native" ? gasUnits(21_000) : 0),
    feeText: () => "a little " + N.unit + " for gas",
    async send(asset, to, amount) {
      if (asset === "native") return done(await wallet.sendTransaction({ to: ethers.getAddress(to), value: BigInt(amount) * GWEI }));
      return done(await usdc.transfer(ethers.getAddress(to), BigInt(amount)));
    },
    createVault: (kind) => client.ops.create({ kind }),
    protect: (asset, amount) => (asset === "native" ? client.ops.deposit(amount) : vt.ops.deposit(amount)),
    request: (asset, dest, amount) => (asset === "native" ? client.ops.requestWithdrawal(dest, amount) : vt.ops.requestWithdrawal(dest, amount)),
    cancel: (asset, id) => (asset === "native" ? client.ops.cancelWithdrawal(id) : vt.ops.cancelWithdrawal(id)),
    execute: (asset, id) => (asset === "native" ? client.ops.executeWithdrawal(wallet.address, id) : vt.ops.executeWithdrawal(wallet.address, id)),
    chainTime: () => client.chainTime(),
  };
}
