// Requests from websites: what Ecrin shows before you approve, and how it signs once you do.
// The rule: show exactly what would leave your wallet, in plain words, before anything is signed. Solana
// transactions are simulated against the network (your balances before and after); Ethereum transactions and
// signatures are read field by field, with the dangerous kinds (unlimited approvals, permits, handing over an
// account) called out in red.
import { EVM_NETS } from "../../app/config-evm.js";
import { SOL_USDC } from "../../app/config-tokens.js";
import { ed25519 } from "@noble/curves/ed25519";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SYSTEM = "11111111111111111111111111111111";
const MAX = 2n ** 255n;
const byChain = (id) => Object.values(EVM_NETS).find((n) => n.chainId === Number(id));

/** 12345678901n, 9 → "123.45678901" (trailing zeros trimmed, at most `keep` decimals). */
export function units(v, dec, keep = 6) {
  v = BigInt(v); const neg = v < 0n; if (neg) v = -v;
  const s = v.toString().padStart(dec + 1, "0"), whole = s.slice(0, s.length - dec), frac = s.slice(s.length - dec).slice(0, keep).replace(/0+$/, "");
  return (neg ? "−" : "") + Number(whole).toLocaleString("en-US") + (frac ? "." + frac : "");
}
const printable = (s) => !/[\u0000-\u0008\u000e-\u001f�]/.test(s);

export function makeApprovals({ web3, ethers, getAcct, getDev }) {
  /* ---------- reading what a request does ---------- */
  async function evmProvider(chainId) {
    const N = byChain(chainId), dev = await getDev();
    const rpc = dev?.evm?.[N.key]?.rpc || N.rpc;
    return { N, provider: new ethers.JsonRpcProvider(rpc, N.chainId, { staticNetwork: true }) };
  }
  async function tokenMeta(provider, addr) {
    const c = new ethers.Contract(addr, ["function symbol() view returns (string)", "function decimals() view returns (uint8)", "function name() view returns (string)"], provider);
    const [symbol, decimals] = await Promise.all([c.symbol().catch(() => null), c.decimals().catch(() => null)]);
    return { symbol: symbol || "tokens", decimals: decimals == null ? null : Number(decimals), known: symbol != null };
  }
  const amountText = (v, meta) => (v >= MAX ? "every" : meta.decimals == null ? v.toString() : units(v, meta.decimals));

  async function previewEvmTx(req) {
    const tx = req.tx, me = getAcct().evm.address;
    const { N, provider } = await evmProvider(req.chainId);
    const out = { leaves: [], gets: [], notes: [], danger: [], to: tx.to || null, net: `${N.name} ${N.net}` };
    const value = BigInt(tx.value || 0);
    if (value > 0n) out.leaves.push({ amt: units(value, 18), unit: N.unit, to: tx.to });
    const data = String(tx.data || tx.input || "0x");
    const sel = data.slice(0, 10).toLowerCase();
    const arg = (i) => "0x" + data.slice(10 + i * 64, 10 + (i + 1) * 64);
    const addr = (i) => ethers.getAddress("0x" + arg(i).slice(26));
    try {
      if (!tx.to) out.danger.push("This creates a new contract. Only do this if you are deploying your own code.");
      else if (data === "0x" || data === "") { if (await provider.getCode(tx.to).catch(() => "0x") !== "0x") out.notes.push("The receiver is a contract, not a person's wallet."); }
      else if (sel === "0xa9059cbb") { const m = await tokenMeta(provider, tx.to); out.leaves.push({ amt: amountText(BigInt(arg(1)), m), unit: m.symbol, to: addr(0) }); }
      else if (sel === "0x23b872dd" && addr(0).toLowerCase() === me.toLowerCase()) { const m = await tokenMeta(provider, tx.to); out.leaves.push({ amt: amountText(BigInt(arg(2)), m), unit: m.symbol, to: addr(1) }); }
      else if (sel === "0x095ea7b3" || sel === "0x39509351") {
        const m = await tokenMeta(provider, tx.to), v = BigInt(arg(1)), spender = addr(0);
        if (v === 0n && sel === "0x095ea7b3") out.notes.push(`Removes ${short(spender)}'s permission to spend your ${m.symbol}.`);
        else if (v >= MAX) out.danger.push(`Lets ${short(spender)} take ALL your ${m.symbol}, now and later, without asking again.`);
        else out.danger.push(`Lets ${short(spender)} take up to ${amountText(v, m)} ${m.symbol} from your wallet without asking again.`);
        out.permit = { spender, token: tx.to };
      }
      else if (sel === "0xa22cb465") {
        const on = BigInt(arg(1)) !== 0n;
        out[on ? "danger" : "notes"].push(on ? `Lets ${short(addr(0))} move EVERY item you own in this collection.` : `Removes ${short(addr(0))}'s access to this collection.`);
      }
      else out.notes.push(`Calls a contract (function ${sel}). Ecrin can't read what it does, so only approve if you trust this site.`);
    } catch (e) { out.notes.push("Ecrin couldn't read this transaction in full."); }
    // Would it work, and what does the network charge?
    try {
      const gas = tx.gas || tx.gasLimit ? BigInt(tx.gas || tx.gasLimit) : await provider.estimateGas({ from: me, to: tx.to || undefined, data, value });
      const f = await provider.getFeeData(), price = f.maxFeePerGas || f.gasPrice || 0n;
      out.fee = `up to ${units(gas * price, 18, 6)} ${N.unit}`;
    } catch (e) { out.fail = shortErr(e); }
    return out;
  }

  function previewTyped(req, host) {
    let d; try { d = JSON.parse(req.data); } catch (_) { return { danger: ["This signature request is malformed."], fields: [] }; }
    const out = { danger: [], notes: [], fields: [], title: d.primaryType || "Signature" };
    const m = d.message || {}, dom = d.domain || {};
    if (dom.chainId && Number(dom.chainId) !== Number(req.chainId)) out.notes.push(`It names another network (chain ${Number(dom.chainId)}).`);
    const pt = String(d.primaryType || "");
    if (/^Permit/.test(pt) || "spender" in m) {
      const spender = m.spender || m.details?.spender, token = m.details?.token || (pt === "Permit" ? dom.verifyingContract : null);
      const v = m.value ?? m.details?.amount ?? m.permitted?.amount;
      const big = v != null && BigInt(v) >= MAX;
      out.danger.push(`This is a permit: it lets ${short(spender || "someone")} take ${big ? "ALL your" : v != null ? `up to ${v} units of your` : "your"} ${token ? `tokens (${short(token)})` : "tokens"} without another approval${m.deadline || m.details?.expiration ? `, until ${new Date(Number(m.deadline || m.details.expiration) * 1000).toLocaleDateString()}` : ""}. Scammers use these to empty wallets.`);
    }
    if (/Order/.test(pt)) out.danger.push("This is a marketplace order: signing it can sell or hand over your items.");
    const flat = (o, p = "") => Object.entries(o || {}).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [[p + k, String(v)]]));
    out.fields = [["Signing for", [dom.name, dom.version && `v${dom.version}`].filter(Boolean).join(" ") || "—"], ...(dom.verifyingContract ? [["Contract", dom.verifyingContract]] : []), ...flat(m).slice(0, 24)];
    return out;
  }

  function previewMessage(bytesOrHex, fam, host) {
    let text, raw = false;
    if (fam === "evm") {
      const s = String(bytesOrHex ?? "");
      if (/^0x[0-9a-f]*$/i.test(s)) { try { text = ethers.toUtf8String(s); if (!printable(text)) throw 0; } catch (_) { text = s; raw = true; } }
      else text = s;
    } else {
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytesOrHex)); if (!printable(text)) throw 0; } catch (_) { text = "0x" + [...bytesOrHex].map((b) => b.toString(16).padStart(2, "0")).join(""); raw = true; }
    }
    const out = { text, raw, danger: [], notes: [] };
    const siwe = text.match(/^(\S+) wants you to sign in with your (Ethereum|Solana) account/);
    if (siwe) {
      out.signin = true;
      const dom = siwe[1].replace(/^https?:\/\//, "").replace(/:\d+$/, "");
      if (dom !== host) out.danger.push(`This sign-in is for ${dom}, but the request comes from ${host}. A site is trying to sign in somewhere else as you.`);
    }
    if (raw) out.notes.push("This isn't readable text. Signing unreadable data can authorize things you can't see.");
    return out;
  }

  async function solConn(chain) {
    const dev = await getDev();
    return new web3.Connection(dev?.solRpc || "https://api.devnet.solana.com", "confirmed");
  }

  /** Simulates the transaction and compares your balances before and after. */
  async function previewSolTx(req) {
    const conn = await solConn(req.chain), me = getAcct().sol.publicKey, meS = me.toBase58();
    const out = { leaves: [], gets: [], danger: [], notes: [], net: "Solana Devnet" };
    const txs = req.txs.map((b) => web3.VersionedTransaction.deserialize(Uint8Array.from(b)));
    const usdc = SOL_USDC.devnet, dev = await getDev(), usdcMint = dev?.usdcMint || usdc;
    let feeTotal = 0;
    for (const vtx of txs) {
      const msg = vtx.message;
      // Account keys, including those in lookup tables.
      let keys = msg.staticAccountKeys.map(String);
      if (msg.addressTableLookups?.length) {
        const alts = await Promise.all(msg.addressTableLookups.map((l) => conn.getAddressLookupTable(l.accountKey).then((r) => r.value)));
        const lk = msg.getAccountKeys({ addressLookupTableAccounts: alts.filter(Boolean) });
        keys = [...lk.staticAccountKeys, ...(lk.accountKeysFromLookups?.writable || []), ...(lk.accountKeysFromLookups?.readonly || [])].map(String);
      }
      const signers = keys.slice(0, msg.header.numRequiredSignatures);
      if (!signers.includes(meS)) out.notes.push("This transaction doesn't need your signature.");
      // Dangerous instructions, read directly.
      for (const ix of msg.compiledInstructions) {
        const prog = keys[ix.programIdIndex], acc = (i) => keys[ix.accountKeyIndexes[i]], d = ix.data;
        if (prog === SYSTEM && d[0] === 1 && acc(0) === meS) out.danger.push(`Gives your whole account to the program ${short(new web3.PublicKey(d.slice(4, 36)).toBase58())}. You would lose control of it.`);
        if ((prog === TOKEN || prog === TOKEN22) && d[0] === 6 && acc(1) === meS) out.danger.push("Hands control of one of your token accounts to someone else.");
        if ((prog === TOKEN || prog === TOKEN22) && (d[0] === 4 || d[0] === 13) && acc(d[0] === 4 ? 2 : 3) === meS) out.danger.push(`Lets ${short(acc(d[0] === 4 ? 1 : 2))} spend tokens from your account without asking again.`);
      }
      // Simulate: balances of you and of your token accounts that this transaction touches, before and after.
      const mine = await Promise.all([TOKEN, TOKEN22].map((p) => conn.getTokenAccountsByOwner(me, { programId: new web3.PublicKey(p) }).then((r) => r.value).catch(() => [])));
      const writable = keys.filter((_, i) => msg.isAccountWritable(i));
      const watch = [...new Set([meS, ...mine.flat().map((a) => a.pubkey.toBase58()), ...writable])].slice(0, 60);
      const pre = await conn.getMultipleAccountsInfo(watch.map((k) => new web3.PublicKey(k)));
      const sim = await conn.simulateTransaction(vtx, { sigVerify: false, replaceRecentBlockhash: true, accounts: { encoding: "base64", addresses: watch } });
      if (sim.value.err) {
        const logs = sim.value.logs || [], poor = logs.some((l) => /insufficient/i.test(l));
        const log = logs.filter((l) => /error|failed/i.test(l)).slice(-1)[0];
        out.fail = poor ? "It would fail: there isn't enough in your wallet for this." : `It would fail: ${log ? log.replace(/^Program \w+ /, "") : JSON.stringify(sim.value.err)}`;
        continue;
      }
      const fee = (await conn.getFeeForMessage(msg).catch(() => null))?.value || 5000;
      if (signers[0] === meS) feeTotal += fee;
      const tok = (data) => (data && data.length >= 72 ? { mint: new web3.PublicKey(data.slice(0, 32)).toBase58(), owner: new web3.PublicKey(data.slice(32, 64)).toBase58(), amount: new DataView(Uint8Array.from(data.slice(64, 72)).buffer).getBigUint64(0, true) } : null);
      const deltas = {};
      watch.forEach((k, i) => {
        const a = pre[i], b = sim.value.accounts?.[i];
        const postData = b ? Uint8Array.from(atob(b.data[0]), (c) => c.charCodeAt(0)) : null;
        if (k === meS) { const dl = BigInt((b?.lamports ?? a?.lamports ?? 0)) - BigInt(a?.lamports ?? 0); deltas.SOL = (deltas.SOL || 0n) + dl; return; }
        const owners = [a?.owner?.toBase58?.(), b?.owner].map(String);
        if (!owners.some((o) => o === TOKEN || o === TOKEN22)) return;
        const t0 = tok(a?.data), t1 = tok(postData);
        if ((t0?.owner || t1?.owner) !== meS) return;
        const mint = t1?.mint || t0?.mint, dl = (t1?.amount ?? 0n) - (t0?.amount ?? 0n);
        if (dl) deltas[mint] = (deltas[mint] || 0n) + dl;
      });
      // Simulation already takes the fee off your SOL when you pay it; show the transfer apart from the fee.
      if (deltas.SOL != null && signers[0] === meS) deltas.SOL += BigInt(fee);
      for (const [k, dl] of Object.entries(deltas)) {
        if (!dl) continue;
        let unit = "SOL", dec = 9;
        if (k !== "SOL") {
          unit = k === usdcMint ? "USDC" : short(k);
          dec = k === usdcMint ? 6 : (await conn.getParsedAccountInfo(new web3.PublicKey(k)).then((r) => r.value?.data?.parsed?.info?.decimals).catch(() => null)) ?? 0;
        }
        (dl < 0n ? out.leaves : out.gets).push({ amt: units(dl < 0n ? -dl : dl, dec), unit });
      }
    }
    out.fee = `${units(BigInt(feeTotal), 9)} SOL`;
    if (txs.length > 1) out.notes.push(`${txs.length} transactions, shown together.`);
    return out;
  }

  /* ---------- signing, once you approve ---------- */
  async function sign(req) {
    const A = getAcct();
    if (req.kind === "connect") return true;
    if (req.fam === "evm") {
      if (req.kind === "sign") { const s = String(req.message ?? ""); return A.evm.signMessage(/^0x[0-9a-f]*$/i.test(s) ? ethers.getBytes(s) : s); }
      if (req.kind === "typed") { const d = JSON.parse(req.data), types = { ...d.types }; delete types.EIP712Domain; return A.evm.signTypedData(d.domain || {}, types, d.message || {}); }
      if (req.kind === "tx") {
        const { provider, N } = await evmProvider(req.chainId), t = req.tx, w = A.evm.connect(provider);
        const sent = await w.sendTransaction({ to: t.to || null, data: t.data || t.input || "0x", value: BigInt(t.value || 0), chainId: N.chainId, ...(t.gas || t.gasLimit ? { gasLimit: BigInt(t.gas || t.gasLimit) } : {}), ...(t.nonce != null ? { nonce: Number(t.nonce) } : {}) });
        return sent.hash;
      }
    }
    if (req.kind === "solmsg") return Array.from(ed25519.sign(Uint8Array.from(req.message), A.sol.secretKey.slice(0, 32)));
    if (req.kind === "soltx") {
      const conn = await solConn(req.chain), out = [];
      for (const b of req.txs) {
        const vtx = web3.VersionedTransaction.deserialize(Uint8Array.from(b));
        vtx.sign([A.sol]);
        if (req.send) { await conn.sendRawTransaction(vtx.serialize(), { maxRetries: 5 }); out.push(Array.from(vtx.signatures[0])); }
        else out.push(Array.from(vtx.serialize()));
      }
      return out;
    }
    throw new Error("Unknown request");
  }

  async function preview(req) {
    if (req.kind === "connect") return {};
    if (req.kind === "sign" || req.kind === "solmsg") return previewMessage(req.fam === "evm" ? req.message : req.message, req.fam, req.site.host);
    if (req.kind === "typed") return previewTyped(req, req.site.host);
    if (req.kind === "tx") return previewEvmTx(req);
    if (req.kind === "soltx") return previewSolTx(req);
    return {};
  }
  return { preview, sign };
}

const short = (a) => (a ? `${String(a).slice(0, 6)}…${String(a).slice(-4)}` : "");
function shortErr(e) {
  const m = e?.shortMessage || e?.info?.error?.message || e?.message || String(e);
  return /could not coalesce|fetch|network|ENOTFOUND|failed to fetch/i.test(m) ? "Ecrin couldn't reach the network to check this transaction." : `It would fail: ${m.replace(/\(.*$/, "").slice(0, 160)}`;
}
