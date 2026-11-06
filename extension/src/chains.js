// Every network the wallet supports, behind one shape. Amounts follow the web app: the network's own coin in 1e9
// base units (lamports on Solana, gwei elsewhere), USDC in 1e6 units. The vault code is the web app's own
// (app/chain.js, app/evm.js), so the wallet and the site always agree on the rules.
import { createClient } from "../../app/chain.js";
import { createEvmClient, explainEvmError } from "../../app/evm.js";
import { explainError } from "../../app/chain.js";
import { CONFIG } from "../../app/config.js";
import { SOL_USDC } from "../../app/config-tokens.js";
import { EVM_NETS } from "../../app/config-evm.js";
import { TRON, tronEngine } from "./tron.js";

export const NETS = {
  sol: { key: "sol", fam: "sol", name: "Solana", net: "Devnet", unit: "SOL", cg: "solana", explorer: (k, id) => `https://explorer.solana.com/${k}/${id}?cluster=devnet`, usdc: SOL_USDC.devnet, contract: CONFIG.programId, rpc: CONFIG.rpc, faucet: "https://faucet.solana.com" },
  tron: TRON,
  ...Object.fromEntries(Object.values(EVM_NETS).map((E) => [E.key, { key: E.key, fam: "evm", name: E.name, net: E.net, unit: E.unit, cg: E.cg, explorer: (k, id) => `${E.explorer}/${k}/${id}`, usdc: E.usdc, contract: E.address, rpc: E.rpc, faucet: E.faucet, E, tokens: E.v >= 2 }])),
};
export const BASE = 1e9, USDC_BASE = 1e6;

const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });

/** Metaplex token metadata account: key, update authority, mint, then name, symbol and uri as borsh strings. */
function readMeta(d) {
  try {
    let o = 65; const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const str = () => { const n = dv.getUint32(o, true); o += 4; if (n > 400) throw 0; const v = new TextDecoder().decode(d.slice(o, o + n)); o += n; return v.replace(/\0/g, "").trim(); };
    return { name: str(), symbol: str(), uri: str() };
  } catch (_) { return {}; }
}

/** The wallet on one network. `acct` comes from keyring.deriveAccount; `dev` overrides RPC and program for local tests. */
export function engine({ web3, ethers, acct, net, dev = {} }) {
  const N = NETS[net];
  if (N.fam === "tron") return tronEngine({ ethers, acct, dev });
  return N.fam === "sol" ? solEngine({ web3, acct, N, dev }) : evmEngine({ ethers, acct, N, dev });
}

function solEngine({ web3, acct, N, dev }) {
  const conn = new web3.Connection(dev.solRpc || N.rpc, "confirmed");
  const programId = dev.programId || N.contract, mintAddr = dev.usdcMint || N.usdc;
  const client = createClient({ web3, connection: conn, programId });
  const me = acct.sol.publicKey, kp = acct.sol;
  const mint = new web3.PublicKey(mintAddr), tok = client.token(mint);
  const TOKEN22 = new web3.PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"), MPL = new web3.PublicKey("metaqbxxUerdq28cj1RAAXmS3jR5o5uKWQ1kXYp2yMR");
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
    /** Every other token this address holds (both token programs), with on-chain names where they exist. */
    async listTokens() {
      const progs = [TOKEN, TOKEN22];
      const lists = await Promise.all(progs.map((pid) => conn.getParsedTokenAccountsByOwner(me, { programId: pid }, "confirmed").then((r) => r.value.map((a) => ({ a, pid }))).catch(() => [])));
      const out = [];
      for (const { a, pid } of lists.flat()) {
        const i = a.account.data?.parsed?.info; if (!i) continue;
        const raw = BigInt(i.tokenAmount.amount), deleg = i.delegate && BigInt(i.delegatedAmount?.amount || 0) > 0n ? { delegate: i.delegate, delegated: i.delegatedAmount.amount } : null;
        if (i.mint === mintAddr ? !deleg : raw === 0n && !deleg) continue;
        out.push({ mint: i.mint, acct: a.pubkey.toBase58(), raw: String(raw), dec: i.tokenAmount.decimals, prog: pid.toBase58(), nft: i.tokenAmount.decimals === 0 && raw === 1n, usdc: i.mint === mintAddr, ...(deleg || {}) });
      }
      // Metaplex metadata: name, symbol, link to the picture.
      const pdas = out.map((t) => web3.PublicKey.findProgramAddressSync([new TextEncoder().encode("metadata"), MPL.toBytes(), new web3.PublicKey(t.mint).toBytes()], MPL)[0]);
      for (let i = 0; i < pdas.length; i += 100) {
        const infos = await conn.getMultipleAccountsInfo(pdas.slice(i, i + 100)).catch(() => []);
        infos.forEach((acc, j) => { if (acc) Object.assign(out[i + j], readMeta(acc.data)); });
      }
      // Token-2022 keeps its name inside the token itself (metadata extension).
      const t22 = out.filter((t) => !t.name && t.prog === TOKEN22.toBase58());
      for (let i = 0; i < t22.length; i += 100) {
        const r = await conn.getMultipleParsedAccounts(t22.slice(i, i + 100).map((t) => new web3.PublicKey(t.mint))).catch(() => null);
        r?.value?.forEach((acc, j) => { const md = acc?.data?.parsed?.info?.extensions?.find((x) => x.extension === "tokenMetadata")?.state; if (md) Object.assign(t22[i + j], { name: String(md.name || "").slice(0, 60), symbol: String(md.symbol || "").slice(0, 16), uri: String(md.uri || "") }); });
      }
      return out;
    },
    /** Takes back a permission you gave someone to move your tokens (SPL "Revoke"). */
    revoke: (t) => run(new web3.TransactionInstruction({ programId: new web3.PublicKey(t.prog), data: Uint8Array.of(5), keys: [meta(new web3.PublicKey(t.acct), false, true), meta(me, true, false)] })),
    /** Recent coins that arrived, read from the chain: who sent them, how much, when. */
    async history(limit = 15) {
      const sigs = await conn.getSignaturesForAddress(me, { limit }, "confirmed");
      const txs = await conn.getParsedTransactions(sigs.map((x) => x.signature), { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => []);
      const mine = me.toBase58(), ata = client.ata(me, mint).toBase58(), out = [];
      txs.forEach((tx, i) => {
        if (!tx || tx.meta?.err) return;
        const at = (sigs[i].blockTime || 0) * 1000, sig = sigs[i].signature;
        for (const ix of tx.transaction.message.instructions) {
          const p = ix.parsed; if (!p?.info) continue;
          if (ix.program === "system" && p.type === "transfer" && p.info.destination === mine && p.info.source !== mine) out.push({ t: "recv", a: "native", n: p.info.lamports, from: p.info.source, at, sig });
          if (ix.program === "system" && p.type === "transfer" && p.info.source === mine && p.info.destination !== mine) out.push({ t: "send", a: "native", n: p.info.lamports, to: p.info.destination, at, sig });
          if (ix.program === "spl-token" && /transfer/.test(p.type) && p.info.destination === ata) out.push({ t: "recv", a: "usdc", n: Number(p.info.tokenAmount?.amount ?? p.info.amount), from: p.info.authority || p.info.source, at, sig });
          else if (/^spl-token/.test(ix.program) && /transfer/.test(p.type) && p.info.authority === mine && p.info.tokenAmount) out.push({ t: "tsend", n: Number(p.info.tokenAmount.uiAmountString), sym: p.info.mint === mintAddr ? "USDC" : "tokens", at, sig });
          if (/^spl-token/.test(ix.program) && p.type === "revoke" && p.info.owner === mine) out.push({ t: "revoke", at, sig });
          if (/^spl-token/.test(ix.program) && /^approve/.test(p.type) && p.info.owner === mine) out.push({ t: "ap", kind: "delegate", at, sig, permit: true });
        }
      });
      return out;
    },
    async sendToken(t, to, raw) {
      const dest = key(to), m = new web3.PublicKey(t.mint), pid = new web3.PublicKey(t.prog);
      const ata = (o) => web3.PublicKey.findProgramAddressSync([o.toBytes(), pid.toBytes(), m.toBytes()], ATA)[0];
      const create = new web3.TransactionInstruction({ programId: ATA, data: Uint8Array.of(1), keys: [meta(me, true, true), meta(ata(dest), false, true), meta(dest, false, false), meta(m, false, false), meta(web3.SystemProgram.programId, false, false), meta(pid, false, false)] });
      const data = new Uint8Array(10); data[0] = 12; new DataView(data.buffer).setBigUint64(1, BigInt(raw), true); data[9] = t.dec;
      return run(create, new web3.TransactionInstruction({ programId: pid, data, keys: [meta(ata(me), false, true), meta(m, false, false), meta(ata(dest), false, true), meta(me, true, false)] }));
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
    vaultAddress: () => client.vaultAddress?.(me)?.toBase58?.() || null,
    // Rule changes: stricter ones apply at once, looser ones wait the Safe's rule delay (the program decides).
    propose: (c) => run(client.build.proposeChange(me, { kind: c.kind, value: ["SetGuardian", "AddTrusted", "RemoveTrusted"].includes(c.kind) ? (c.value ? new web3.PublicKey(c.value) : null) : c.value })),
    cancelChange: (id) => run(client.build.cancelChange(me, id)),
    applyChange: (id) => run(client.build.applyChange(me, me, id)),
  };
}

function evmEngine({ ethers, acct, N, dev }) {
  const E = { ...N.E, ...(dev.evm?.[N.key] || {}) };
  const provider = new ethers.JsonRpcProvider(E.rpc, E.chainId, { staticNetwork: true });
  const wallet = acct.evm.connect(provider);
  const client = E.address ? createEvmClient({ ethers, EVM: E, readProvider: provider, getSigner: async () => wallet }) : null;
  const usdc = E.usdc && new ethers.Contract(E.usdc, ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"], wallet);
  const GWEI = 1_000_000_000n;
  const done = async (t) => { const r = await t.wait(); if (!r || r.status !== 1) throw new Error("The transaction failed on-chain."); return t.hash; };
  const vt = client && E.usdc ? client.token(E.usdc) : null;
  async function feeFor(speed) {
    if (!speed || speed === "normal") return {};
    const f = await provider.getFeeData(), m = speed === "fast" ? 150n : 85n;
    if (f.maxFeePerGas) return { maxFeePerGas: (f.maxFeePerGas * m) / 100n, maxPriorityFeePerGas: ((f.maxPriorityFeePerGas || 0n) * m) / 100n };
    return f.gasPrice ? { gasPrice: (f.gasPrice * m) / 100n } : {};
  }
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
      const [w, u] = await Promise.all([provider.getBalance(wallet.address), (usdc ? usdc.balanceOf(wallet.address).catch(() => 0n) : 0n)]);
      return { native: Number(w / GWEI), usdc: Number(u) };
    },
    async vault() {
      if (!client) return null;
      const v = await client.fetchVault(wallet.address);
      if (!v) return null;
      return { main: v, usdc: N.tokens && vt ? await vt.fetch(wallet.address).catch(() => null) : null };
    },
    reserve: async (asset) => (asset === "native" ? gasUnits(21_000) : 0),
    feeText: () => "a little " + N.unit + " for gas",
    /** Slow, normal or fast: the network fee you offer (normal = the network's own suggestion). */
    async send(asset, to, amount, opts = {}) {
      const ov = await feeFor(opts.speed);
      if (asset === "native") return done(await wallet.sendTransaction({ to: ethers.getAddress(to), value: BigInt(amount) * GWEI, ...ov }));
      return done(await usdc.transfer(ethers.getAddress(to), BigInt(amount), ov));
    },
    /** ERC-20 tokens you added by address (Ethereum has no standard way to list every token an address holds). */
    async listTokens(list = []) {
      return (await Promise.all(list.map(async (t) => {
        try {
          const c = new ethers.Contract(t.mint, ["function balanceOf(address) view returns (uint256)"], provider);
          return { ...t, raw: String(await c.balanceOf(wallet.address)) };
        } catch (_) { return { ...t, raw: "0", err: true }; }
      })));
    },
    async tokenInfo(addr) {
      const c = new ethers.Contract(ethers.getAddress(addr), ["function symbol() view returns (string)", "function name() view returns (string)", "function decimals() view returns (uint8)"], provider);
      const [symbol, name, dec] = await Promise.all([c.symbol(), c.name().catch(() => ""), c.decimals()]);
      return { mint: ethers.getAddress(addr), symbol: String(symbol).slice(0, 12), name: String(name || symbol).slice(0, 40), dec: Number(dec) };
    },
    /** How much `spender` may still take of `token` (an ERC-20 allowance). */
    allowance: async (token, spender) => BigInt(await new ethers.Contract(token, ["function allowance(address,address) view returns (uint256)"], provider).allowance(wallet.address, spender)),
    revoke: async (t) => done(await new ethers.Contract(t.token, ["function approve(address,uint256) returns (bool)"], wallet).approve(t.spender, 0n)),
    sendToken: async (t, to, raw) => done(await new ethers.Contract(t.mint, ["function transfer(address,uint256) returns (bool)"], wallet).transfer(ethers.getAddress(to), BigInt(raw))),
    createVault: (kind) => client.ops.create({ kind }),
    protect: (asset, amount) => (asset === "native" ? client.ops.deposit(amount) : vt.ops.deposit(amount)),
    request: (asset, dest, amount) => (asset === "native" ? client.ops.requestWithdrawal(dest, amount) : vt.ops.requestWithdrawal(dest, amount)),
    cancel: (asset, id) => (asset === "native" ? client.ops.cancelWithdrawal(id) : vt.ops.cancelWithdrawal(id)),
    execute: (asset, id) => (asset === "native" ? client.ops.executeWithdrawal(wallet.address, id) : vt.ops.executeWithdrawal(wallet.address, id)),
    chainTime: () => client.chainTime(),
    propose: (c) => client.ops.proposeChange(c),
    cancelChange: (id) => client.ops.cancelChange(id),
    applyChange: (id) => client.ops.applyChange(wallet.address, id),
  };
}
