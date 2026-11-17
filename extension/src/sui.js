// Sui for Ecrin Wallet: SUI and USDC, send and receive, on Sui Testnet and mainnet, and the Safe (sui/sources/safe.move)
// where it is published (Testnet for now).
// Keys: the recovery phrase at m/44'/784'/i'/0'/0' (ed25519, the path Sui Wallet and Slush use), so the same phrase
// works there. Every transaction is built and signed here, byte by byte (Sui's BCS format); the server only estimates
// gas and relays the signed bytes, so it can't change the receiver or the amount. The server is Sui's public GraphQL
// service (Sui switched off JSON-RPC on its public nodes in 2026).
import { ed25519 } from "@noble/curves/ed25519";
import { blake2b } from "@noble/hashes/blake2b";
import bs58 from "bs58";
import { emitSent, viaProxy, fetchFirst } from "./netmode.js";
import { SUI_SAFE } from "../../app/deployments-sui.js";

export const SUI = {
  key: "sui", fam: "sui", name: "Sui", net: "Testnet", unit: "SUI", cg: "sui", contract: SUI_SAFE.testnet?.package || null, safe: SUI_SAFE.testnet || null,
  api: "https://graphql.testnet.sui.io/graphql", faucet: "https://faucet.sui.io/?network=testnet",
  // Circle's test USDC on Sui Testnet (developers.circle.com, USDC contract addresses)
  usdc: "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
  explorer: (k, id) => `https://suiscan.xyz/testnet/${k === "tx" ? "tx" : k === "token" ? "coin" : "account"}/${id}`,
};
// Mainnet, real money. USDC is Circle's (developers.circle.com), checked on-chain (symbol USDC, 6 decimals).
export const SUI_MAIN = {
  ...SUI, key: "suim", net: "Mainnet", real: true, api: "https://graphql.mainnet.sui.io/graphql", faucet: null, contract: null, safe: null,
  usdc: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  explorer: (k, id) => `https://suiscan.xyz/mainnet/${k === "tx" ? "tx" : k === "token" ? "coin" : "account"}/${id}`,
};
export const SUI_COIN = "0x2::sui::SUI";

const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h) => Uint8Array.from(h.replace(/^0x/, "").match(/.{2}/g) || [], (b) => parseInt(b, 16));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const h256 = (u8) => blake2b(u8, { dkLen: 32 });

/** The 0x… address for an ed25519 public key: blake2b-256 of the scheme flag (0) and the key. */
export const suiAddress = (pub) => "0x" + hex(h256(cat(Uint8Array.of(0), pub)));
/** A 0x… address with 64 hex digits (shorter ones are zero-padded, like Sui does), or null. */
export function normAddr(s) {
  const m = /^0x([0-9a-f]{1,64})$/i.exec(String(s || "").trim());
  return m ? "0x" + m[1].toLowerCase().padStart(64, "0") : null;
}

// ---- BCS, just the parts a transfer needs
export const uleb = (n) => { n = Number(n); const o = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; o.push(b); } while (n); return Uint8Array.from(o); };
export const u64 = (v) => { const o = new Uint8Array(8); new DataView(o.buffer).setBigUint64(0, BigInt(v), true); return o; };
const u16 = (v) => Uint8Array.of(v & 0xff, v >> 8);
const vec = (items) => cat(uleb(items.length), ...items);
const bytes = (b) => cat(uleb(b.length), b);
const str = (s) => bytes(new TextEncoder().encode(s));
const addr = (a) => { const n = normAddr(a); if (!n) throw new Error("That isn't a Sui address."); return unhex(n); };
const objRef = (o) => cat(addr(o.address), u64(o.version), bytes(bs58.decode(o.digest)));
// Argument: 0 gas coin, 1 input, 2 result, 3 nested result
const GAS = Uint8Array.of(0), input = (i) => cat(Uint8Array.of(1), u16(i)), nested = (c, i) => cat(Uint8Array.of(3), u16(c), u16(i));
// CallArg: 0 pure bytes, 1 object (0 = an object the sender owns), 2 a withdrawal from the sender's address balance
const pure = (b) => cat(Uint8Array.of(0), bytes(b)), owned = (o) => cat(Uint8Array.of(1, 0), objRef(o));
/** A coin type as a TypeTag (only plain `0x…::module::Name` structs are needed here). */
export function typeTag(t) {
  const m = /^(0x[0-9a-f]+)::(\w+)::(\w+)$/i.exec(t); if (!m) throw new Error("Unsupported coin type");
  return cat(Uint8Array.of(7), addr(m[1]), str(m[2]), str(m[3]), uleb(0));
}
// FundsWithdrawal { reservation: MaxAmountU64(amount), type_arg: Balance(T), withdraw_from: Sender }
const withdrawal = (amount, type) => cat(Uint8Array.of(2, 0), u64(amount), Uint8Array.of(0), typeTag(type), Uint8Array.of(0));
// Command: 0 MoveCall, 1 TransferObjects, 2 SplitCoins, 3 MergeCoins
const moveCall = (pkg, mod, fn, types, args) => cat(Uint8Array.of(0), addr(pkg), str(mod), str(fn), vec(types.map(typeTag)), vec(args));
const transferObjects = (objs, to) => cat(Uint8Array.of(1), vec(objs), to);
const splitCoins = (coin, amounts) => cat(Uint8Array.of(2), coin, vec(amounts));
const mergeCoins = (into, from) => cat(Uint8Array.of(3), into, vec(from));

/**
 * TransactionData::V1 with a programmable transaction.
 * gas = { payment: [coin refs], price, budget } pays with coins (no expiry);
 * gas = { payment: [], price, budget, epoch, chain, nonce } pays from the address balance, valid for this epoch and the next.
 */
export function txData({ sender, inputs, commands, gas }) {
  const kind = cat(Uint8Array.of(0), vec(inputs), vec(commands)); // ProgrammableTransaction
  const gasData = cat(vec(gas.payment.map(objRef)), addr(sender), u64(gas.price), u64(gas.budget));
  const exp = gas.payment.length ? Uint8Array.of(0) // None
    : cat(Uint8Array.of(2, 1), u64(gas.epoch), Uint8Array.of(1), u64(BigInt(gas.epoch) + 1n), Uint8Array.of(0, 0), bytes(bs58.decode(gas.chain)), (() => { const o = new Uint8Array(4); new DataView(o.buffer).setUint32(0, gas.nonce >>> 0, true); return o; })());
  return cat(Uint8Array.of(0), kind, addr(sender), gasData, exp);
}

/**
 * Sends `amount` of coin `type` to `to`. Funds can sit in coin objects, in the address balance, or both:
 * `coins` are the sender's coins of that type to use (merged), `fromBalance` is what to withdraw from the address balance.
 * For SUI paid with coins, the gas coin itself is the source (useGas).
 */
export function transfer({ sender, to, type, amount, coins = [], fromBalance = 0n, useGas = false, gas }) {
  const inputs = [], commands = [], add = (x) => (inputs.push(x), input(inputs.length - 1)), cmd = (x) => (commands.push(x), commands.length - 1);
  let base = useGas ? GAS : null;
  if (!useGas && coins.length) { base = add(owned(coins[0])); const rest = coins.slice(1).map((c) => add(owned(c))); if (rest.length) cmd(mergeCoins(base, rest)); }
  if (fromBalance > 0n) {
    const r = nested(cmd(moveCall("0x2", "coin", "redeem_funds", [type], [add(withdrawal(fromBalance, type))])), 0);
    if (base) cmd(mergeCoins(base, [r])); else base = r;
  }
  const recipient = add(pure(addr(to)));
  // Withdrawn exactly the amount and nothing else: hand that coin over as is.
  const out = !useGas && !coins.length && fromBalance === BigInt(amount) ? base : nested(cmd(splitCoins(base, [add(pure(u64(amount)))])), 0);
  cmd(transferObjects([out], recipient));
  return txData({ sender, inputs, commands, gas });
}

// ---- The Safe
// CallArg Object(SharedObject { id, initial_shared_version, mutability })
const shared = (o, mutable) => cat(Uint8Array.of(1, 1), addr(o.id), u64(o.isv), Uint8Array.of(mutable ? 1 : 0));
export const optU64 = (v) => (v == null ? Uint8Array.of(0) : cat(Uint8Array.of(1), u64(v)));
export const optAddr = (a) => (a == null ? Uint8Array.of(0) : cat(Uint8Array.of(1), addr(a)));
export const CLOCK = { id: "0x6", isv: 1 };
/**
 * One call to `<pkg>::safe::<fn><SUI>`. Each arg is { obj: { id, isv }, mut } for a shared object, { clock: true },
 * { pure: bytes }, or { deposit: amount }: a SUI coin of that amount, split from the gas coin when gas is paid with
 * coins, otherwise withdrawn from the address balance.
 */
export function safeTx({ sender, pkg, fn, args, gas }) {
  const inputs = [], commands = [], add = (x) => (inputs.push(x), input(inputs.length - 1)), cmd = (x) => (commands.push(x), commands.length - 1);
  const a = args.map((x) => {
    if (x.obj) return add(shared(x.obj, x.mut !== false));
    if (x.clock) return add(shared(CLOCK, false));
    if (x.pure) return add(pure(x.pure));
    if (x.deposit != null) return gas.payment.length
      ? nested(cmd(splitCoins(GAS, [add(pure(u64(x.deposit)))])), 0)
      : nested(cmd(moveCall("0x2", "coin", "redeem_funds", [SUI_COIN], [add(withdrawal(BigInt(x.deposit), SUI_COIN))])), 0);
    throw new Error("Unknown Safe argument");
  });
  cmd(moveCall(pkg, "safe", fn, [SUI_COIN], a));
  return txData({ sender, inputs, commands, gas });
}
/** The Safe's rules as the wallet's presets (the same as on Solana and the EVM networks). */
export const SUI_PRESETS = { gentle: [24 * 3600, 3 * 86400], strong: [72 * 3600, 7 * 86400], locked: [72 * 3600, 7 * 86400] };
// Move abort codes in sui/sources/safe.move, in vault-core's order.
const SAFE_ERRORS = ["Only the Safe's owner can do that.", "Only the guardian can do that.", "This Safe has no guardian.", "Enter an amount above zero.",
  "Not enough in the Safe (some may already be waiting to leave).", "That address isn't trusted yet.", "The Safe is locked until its unlock date.",
  "It isn't time yet.", "That's over the Safe's daily limit.", "That request isn't there anymore.", "Too many requests waiting: cancel or finish one first.",
  "You can trust at most 8 addresses.", "That value isn't allowed.", "That number is too large.", "This wallet already has a Safe on Sui."];
/** Turns "MoveAbort(... safe ..., 7)" into words. */
export function explainSuiSafe(text) {
  // Sui words it two ways: "MoveAbort(... name: Identifier("safe") ..., 7)" and "from '0x…::safe::create' (instruction 64), abort code: 14"
  const t = String(text || ""), m = /::safe::\w+'?[^]*?abort code:\s*(\d+)/.exec(t) || /MoveAbort[^]*?safe[^]*?,\s*(\d+)\)/.exec(t);
  return m && SAFE_ERRORS[Number(m[1])] ? SAFE_ERRORS[Number(m[1])] : null;
}
/** A Move enum or Option as GraphQL's JSON gives it, read leniently. */
const variantOf = (c) => {
  if (!c || typeof c !== "object") return { kind: null, value: null };
  const kind = c["@variant"] || c.variant || c.$kind || Object.keys(c).find((k) => /^[A-Z]/.test(k));
  const rest = Object.entries(c).filter(([k]) => !["@variant", "variant", "$kind"].includes(k));
  let v = c[kind] !== undefined ? c[kind] : rest.length ? rest[0][1] : null;
  if (v && typeof v === "object" && !Array.isArray(v)) { const vals = Object.values(v); if (vals.length === 1) v = vals[0]; }
  return { kind, value: v };
};
const opt = (v) => (v == null ? null : Array.isArray(v) ? (v.length ? v[0] : null) : typeof v === "object" && "vec" in v ? (v.vec.length ? v.vec[0] : null) : v);

/** Signs transaction bytes: ed25519 over blake2b-256(intent ‖ tx). Returns Sui's serialized signature (base64) and the digest. */
export function signTx(tx, priv) {
  const sig = ed25519.sign(h256(cat(Uint8Array.of(0, 0, 0), tx)), priv), pub = ed25519.getPublicKey(priv);
  return { signature: b64(cat(Uint8Array.of(0), sig, pub)), digest: txDigest(tx) };
}
export const txDigest = (tx) => bs58.encode(h256(cat(new TextEncoder().encode("TransactionData::"), tx)));

export function suiEngine({ acct, dev = {}, N = SUI }) {
  const apis = dev.suiApi ? [dev.suiApi] : viaProxy(N.key, N.api), priv = acct.sui, me = dev.as || suiAddress(ed25519.getPublicKey(priv));
  async function gql(query, variables = {}) {
    const r = await fetchFirst(apis, "", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
    if (!r.ok) throw new Error(`Sui network error (${r.status})`);
    const j = await r.json();
    if (j.errors?.length) throw new Error(`Sui: ${j.errors[0].message}`);
    return j.data;
  }
  async function coins(type) {
    const out = []; let after = null;
    for (let page = 0; page < 5; page++) {
      const d = await gql(`query($o:SuiAddress!,$t:String!,$a:String){address(address:$o){objects(first:50,after:$a,filter:{type:$t}){nodes{address version digest contents{json}} pageInfo{hasNextPage endCursor}}}}`, { o: me, t: `0x2::coin::Coin<${type}>`, a: after });
      const c = d.address?.objects; if (!c) break;
      for (const o of c.nodes) out.push({ address: o.address, version: o.version, digest: o.digest, balance: BigInt(o.contents?.json?.balance ?? 0) });
      if (!c.pageInfo.hasNextPage) break; after = c.pageInfo.endCursor;
    }
    return out.sort((a, b) => (b.balance > a.balance ? 1 : -1));
  }
  async function balance(type) {
    const d = await gql(`query($o:SuiAddress!,$t:String!){address(address:$o){balance(coinType:$t){totalBalance coinBalance addressBalance}}}`, { o: me, t: type });
    const b = d.address?.balance || {};
    return { total: BigInt(b.totalBalance ?? 0), inCoins: BigInt(b.coinBalance ?? 0), inBalance: BigInt(b.addressBalance ?? 0) };
  }
  const CAP = 50_000_000n; // the most a send may spend on fees: 0.05 SUI
  /**
   * Plans a send and builds it. Pays the fee from the address balance when it holds enough SUI (no coin objects
   * needed), otherwise from SUI coins. The amount comes from coins first, then the address balance.
   */
  async function plan(type, to, amount) {
    const isSui = type === SUI_COIN;
    const [sc, sb, tc, tb, ep] = await Promise.all([coins(SUI_COIN), balance(SUI_COIN), isSui ? null : coins(type), isSui ? null : balance(type),
      gql(`{epoch{epochId referenceGasPrice} chainIdentifier}`)]);
    const price = BigInt(ep.epoch.referenceGasPrice), epoch = ep.epoch.epochId, chain = ep.chainIdentifier, nonce = crypto.getRandomValues(new Uint32Array(1))[0];
    const tCoins = isSui ? sc : tc, tBal = isSui ? sb.inBalance : tb.inBalance;
    const pick = (list, want) => { const use = []; let sum = 0n; for (const c of list) { if (sum >= want) break; use.push(c); sum += c.balance; } return { use, sum }; };
    const coinTotal = (list) => list.reduce((n, c) => n + c.balance, 0n);
    let build;
    // 1) fee from the address balance
    { const { use, sum } = pick(tCoins.slice(0, 200), amount), fromBalance = sum >= amount ? 0n : amount - sum;
      const feeRoom = sb.inBalance - (isSui ? fromBalance : 0n);
      if (fromBalance <= tBal && feeRoom >= 2_000_000n) {
        const cap = feeRoom < CAP ? feeRoom : CAP;
        build = (budget) => transfer({ sender: me, to, type, amount, coins: use, fromBalance, gas: { payment: [], price, budget, epoch, chain, nonce } });
        return finish(build, cap);
      } }
    // 2) fee from SUI coins (for SUI, the gas coin is also where the amount comes from)
    if (!sc.length) throw new Error("You need a little SUI to pay the network fee.");
    const payment = sc.slice(0, 200), held = coinTotal(payment);
    if (isSui) {
      const fromBalance = held >= amount + 2_000_000n ? 0n : amount + 2_000_000n - held;
      if (fromBalance > tBal) throw new Error("Not enough SUI for this amount and the network fee.");
      const room = held + fromBalance - amount, cap = room < CAP ? room : CAP;
      build = (budget) => transfer({ sender: me, to, type, amount, useGas: true, fromBalance, gas: { payment, price, budget } });
      return finish(build, cap);
    }
    const { use, sum } = pick(tCoins.slice(0, 200), amount), fromBalance = sum >= amount ? 0n : amount - sum;
    if (fromBalance > tBal) throw new Error("Not enough of that coin.");
    const cap = held < CAP ? held : CAP;
    build = (budget) => transfer({ sender: me, to, type, amount, coins: use, fromBalance, gas: { payment, price, budget } });
    return finish(build, cap);
  }
  // A dry run at the highest budget tells the real cost; the signed budget is that plus a margin.
  async function finish(build, cap) {
    const sim = await gql(`query($t:JSON!){simulateTransaction(transaction:$t){effects{status executionError{message} gasEffects{gasSummary{computationCost storageCost storageRebate}}}}}`,
      { t: { bcs: { value: b64(build(cap)) } } });
    const e = sim.simulateTransaction?.effects;
    if (!e) throw new Error("Sui couldn't check this transaction. Try again in a moment.");
    if (e.status !== "SUCCESS") throw new Error(`Sui would refuse this: ${e.executionError?.message || e.status}`);
    const g = e.gasEffects?.gasSummary, cost = BigInt(g.computationCost) + BigInt(g.storageCost);
    let budget = (cost * 13n) / 10n + 1_000_000n; if (budget > cap) budget = cap;
    return build(budget);
  }
  // ---- The Safe on Sui
  const SAFE = N.safe, pkg = SAFE?.package;
  let safeId = null;
  const isvCache = {};
  async function sharedRef(id) {
    if (isvCache[id]) return isvCache[id];
    const d = await gql(`query($a:SuiAddress!){object(address:$a){owner{... on Shared{initialSharedVersion}}}}`, { a: id });
    const isv = d.object?.owner?.initialSharedVersion; if (isv == null) throw new Error("Sui couldn't find the Safe.");
    return (isvCache[id] = { id, isv: Number(isv) });
  }
  /** This wallet's Safe: found from the SafeCreated event it emitted (one Safe per owner and coin). */
  async function findSafe() {
    if (safeId || !pkg) return safeId;
    const d = await gql(`query($t:String!,$s:SuiAddress!){events(last:20,filter:{type:$t,sender:$s}){nodes{contents{json}}}}`, { t: `${pkg}::safe::SafeCreated`, s: me });
    const hit = (d.events?.nodes || []).map((n) => n.contents?.json).find((j) => j && normAddr(j.owner) === normAddr(me) && /::sui::SUI$/.test(String(j.coin?.name || j.coin || "")));
    return (safeId = hit ? normAddr(hit.safe) : null);
  }
  const num = (x) => (x == null ? 0 : Number(typeof x === "object" ? x.value ?? 0 : x));
  async function readSafe() {
    const id = await findSafe(); if (!id) return null;
    const d = await gql(`query($a:SuiAddress!){object(address:$a){asMoveObject{contents{json}}}}`, { a: id });
    const j = d.object?.asMoveObject?.contents?.json; if (!j) return null;
    const p = j.policy || {}, A = (a) => ({ a: normAddr(a), toBase58() { return this.a; }, toString() { return this.a; }, equals(o) { return !!o && normAddr(String(o)) === this.a; } });
    const withdrawals = (j.withdrawals || []).map((w) => ({ id: Number(w.id), amount: Number(w.amount), dest: A(w.dest), readyAt: Number(w.ready_at) }));
    const balance = num(j.balance);
    const change = (c) => {
      const { kind, value } = variantOf(c);
      const v = kind === "SetDailyLimit" ? (opt(value) == null ? null : Number(opt(value)))
        : kind === "SetLockedUntil" ? (opt(value) == null ? null : Number(opt(value)))
        : kind === "SetGuardian" ? (opt(value) ? A(opt(value)) : null)
        : kind === "AddTrusted" || kind === "RemoveTrusted" ? A(value) : Number(value);
      return { kind, value: v };
    };
    return {
      owner: A(j.owner), address: A(id), balance, available: Math.max(0, balance - withdrawals.reduce((s, w) => s + w.amount, 0)),
      withdrawDelay: Number(p.withdraw_delay), ruleDelay: Number(p.rule_delay),
      dailyLimit: opt(p.daily_limit) == null ? null : Number(opt(p.daily_limit)), lockedUntil: opt(p.locked_until) == null ? null : Number(opt(p.locked_until)),
      guardian: opt(p.guardian) ? A(opt(p.guardian)) : null,
      trusted: (j.trusted || []).map(A), withdrawals,
      changes: (j.changes || []).map((c) => ({ id: Number(c.id), change: change(c.change), readyAt: Number(c.ready_at) })),
      spentDay: Number(j.spent_day || 0), spentToday: Number(j.spent_today || 0),
    };
  }
  /** Builds, checks (dry run), signs and sends one Safe call. Gas from the address balance when it can, else SUI coins. */
  async function safeRun(fn, args, depositAmount = 0n) {
    if (!pkg) throw new Error("The Safe isn't on this Sui network yet.");
    const [sc, sb, ep] = await Promise.all([coins(SUI_COIN), balance(SUI_COIN), gql(`{epoch{epochId referenceGasPrice} chainIdentifier}`)]);
    const price = BigInt(ep.epoch.referenceGasPrice), dep = BigInt(depositAmount);
    let gas, cap;
    if (sb.inBalance >= dep + 2_000_000n) {
      const room = sb.inBalance - dep; cap = room < CAP ? room : CAP;
      gas = { payment: [], price, epoch: ep.epoch.epochId, chain: ep.chainIdentifier, nonce: crypto.getRandomValues(new Uint32Array(1))[0] };
    } else {
      const payment = sc.slice(0, 200), held = payment.reduce((n, c) => n + c.balance, 0n);
      if (held < dep + 2_000_000n) throw new Error(dep ? "Not enough SUI for this amount and the network fee." : "You need a little SUI to pay the network fee.");
      const room = held - dep; cap = room < CAP ? room : CAP; gas = { payment, price };
    }
    const build = (budget) => safeTx({ sender: me, pkg, fn, args: typeof args === "function" ? args() : args, gas: { ...gas, budget } });
    try { return await execute(await finish(build, cap)); }
    catch (e) { const w = explainSuiSafe(e?.message); if (w) throw new Error(w); throw e; }
  }
  const safeObj = async () => { const id = await findSafe(); if (!id) throw new Error("Open your Safe on Sui first."); return { obj: await sharedRef(id) }; };
  const toSecs = (v) => BigInt(Math.round(Number(v)));
  async function propose(c) {
    const s = await safeObj(), v = c.value, fns = {
      SetWithdrawDelay: ["set_withdraw_delay", u64(toSecs(v))], SetRuleDelay: ["set_rule_delay", u64(toSecs(v))],
      SetDailyLimit: ["set_daily_limit", optU64(v == null ? null : BigInt(Math.round(Number(v))))], SetLockedUntil: ["set_locked_until", optU64(v == null ? null : toSecs(v))],
      SetGuardian: ["set_guardian", optAddr(v == null ? null : String(v))], AddTrusted: ["add_trusted", addr(String(v))], RemoveTrusted: ["remove_trusted", addr(String(v))],
    }[c.kind];
    if (!fns) throw new Error("Unknown rule change " + c.kind);
    return safeRun(fns[0], [s, { pure: fns[1] }, { clock: true }]);
  }

  async function execute(tx) {
    const { signature, digest } = signTx(tx, priv);
    emitSent(digest);
    const d = await gql(`mutation($t:Base64!,$s:[Base64!]!){executeTransaction(transactionDataBcs:$t,signatures:$s){effects{digest status executionError{message}}}}`, { t: b64(tx), s: [signature] });
    const e = d.executeTransaction?.effects;
    if (e?.status && e.status !== "SUCCESS") throw new Error(`Sui refused the transaction: ${e.executionError?.message || e.status}`);
    return e?.digest || digest;
  }
  return {
    N, address: me, key: (s) => normAddr(s),
    isAddress: (s) => !!normAddr(s),
    explain: (e) => ({ message: String(e?.message || e) }),
    // Balances in the wallet's common units: the coin in 1e9 (mist already is), USDC in 1e6.
    async balances() {
      const [s, u] = await Promise.all([balance(SUI_COIN), balance(N.usdc).catch(() => ({ total: 0n }))]);
      return { native: Number(s.total), usdc: Number(u.total) };
    },
    hasVaults: !!pkg,
    async vault() { const v = pkg ? await readSafe() : null; return v ? { main: v, usdc: null } : null; },
    vaultAddress: () => safeId,
    async createVault(kind = "strong", { guardian = null, until = null } = {}) {
      const [wd, rd] = SUI_PRESETS[kind] || SUI_PRESETS.strong;
      const r = await safeRun("create", [{ obj: await sharedRef(normAddr(SAFE.registry)) }, { pure: u64(wd) }, { pure: u64(rd) }, { pure: optU64(null) }, { pure: optU64(until) }, { pure: optAddr(guardian) }, { clock: true }]);
      safeId = null; await findSafe().catch(() => {}); return r;
    },
    async protect(asset, amount) { if (asset !== "native") throw new Error("On Sui, the Safe holds SUI for now."); return safeRun("deposit", [await safeObj(), { deposit: BigInt(Math.round(amount)) }], BigInt(Math.round(amount))); },
    async request(asset, dest, amount) { if (asset !== "native") throw new Error("On Sui, the Safe holds SUI for now."); return safeRun("request_withdrawal", [await safeObj(), { pure: addr(String(dest)) }, { pure: u64(BigInt(Math.round(amount))) }, { clock: true }]); },
    async sendTrusted(asset, dest, amount) { return safeRun("send_to_trusted", [await safeObj(), { pure: addr(String(dest)) }, { pure: u64(BigInt(Math.round(amount))) }, { clock: true }]); },
    async cancel(asset, id) { return safeRun("cancel_withdrawal", [await safeObj(), { pure: u64(id) }]); },
    async execute(asset, id) { return safeRun("execute_withdrawal", [await safeObj(), { pure: u64(id) }, { clock: true }]); },
    propose,
    async cancelChange(id) { return safeRun("cancel_change", [await safeObj(), { pure: u64(id) }]); },
    async applyChange(id) { return safeRun("apply_change", [await safeObj(), { pure: u64(id) }, { clock: true }]); },
    async chainTime() { const d = await gql(`{checkpoint{timestamp}}`); return Math.floor(Date.parse(d.checkpoint.timestamp) / 1000); },
    reserve: (asset) => (asset === "native" ? 10_000_000 : 0), // keep 0.01 SUI for fees
    feeText: () => "≈ 0.002 SUI",
    async send(asset, to, amount) {
      if (!normAddr(to)) throw new Error("That isn't a Sui address.");
      if (asset === "usdc") return execute(await plan(N.usdc, to, BigInt(Math.round(amount))));
      return execute(await plan(SUI_COIN, to, BigInt(Math.round(amount))));
    },
    async listTokens() { return []; },
    async sendToken(t, to, raw) {
      if (!normAddr(to)) throw new Error("That isn't a Sui address.");
      return execute(await plan(t.mint, to, BigInt(raw)));
    },
    plan, // for tests
    // Recent activity: transactions that touched this address, newest first.
    async history(n = 20) {
      const d = await gql(`query($o:SuiAddress!,$n:Int){transactions(last:$n,filter:{affectedAddress:$o}){nodes{digest sender{address} effects{status timestamp balanceChangesJson}}}}`, { o: me, n });
      return (d.transactions?.nodes || []).reverse().map((t) => ({ sig: t.digest, from: t.sender?.address, ok: t.effects?.status === "SUCCESS", time: t.effects?.timestamp ? Date.parse(t.effects.timestamp) / 1000 : null, changes: t.effects?.balanceChangesJson }));
    },
  };
}
