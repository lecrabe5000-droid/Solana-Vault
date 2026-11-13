// HyperEVM has small blocks (~2M gas, every second) and big blocks (30M gas, about every minute). The Ecrin contract
// needs ~3.5M gas to deploy, so the deployer must be switched to big blocks first. That switch is not an EVM
// transaction: it is a HyperCore action ("evmUserModify"), signed as an L1 action and posted to Hyperliquid's API.
//   node scripts/hyper-big-blocks.js on|off      (uses DEPLOYER_KEY; testnet API unless HL_MAINNET=1)
// Signing follows Hyperliquid's L1 action scheme: keccak(msgpack(action) ‖ nonce(8 bytes, big-endian) ‖ 0x00 for "no
// vault"), wrapped in a "phantom agent" { source: "b" on testnet / "a" on mainnet, connectionId } signed with EIP-712
// under the domain { name: "Exchange", version: "1", chainId: 1337, verifyingContract: 0x0 }.
const { ethers } = require("ethers");
// The one message this script signs is a tiny map of short strings and a boolean, so it is MessagePack-encoded by hand
// (no extra package): fixmap, fixstr keys and values in insertion order, true/false. Same bytes as Python's msgpack.packb.
function encode(obj) {
  const out = [], str = (v) => { const b = Buffer.from(v, "utf8"); if (b.length > 31) throw new Error("string too long"); out.push(0xa0 | b.length, ...b); };
  const keys = Object.keys(obj); if (keys.length > 15) throw new Error("map too big"); out.push(0x80 | keys.length);
  for (const k of keys) { str(k); const v = obj[k]; if (typeof v === "boolean") out.push(v ? 0xc3 : 0xc2); else if (typeof v === "string") str(v); else throw new Error("unsupported value"); }
  return Uint8Array.from(out);
}

const MAINNET = process.env.HL_MAINNET === "1";
const API = MAINNET ? "https://api.hyperliquid.xyz/exchange" : "https://api.hyperliquid-testnet.xyz/exchange";

function actionHash(action, nonce) {
  const packed = encode(action);
  const n = Buffer.alloc(8); n.writeBigUInt64BE(BigInt(nonce));
  return ethers.keccak256(Buffer.concat([Buffer.from(packed), n, Buffer.from([0])]));
}
async function signL1(wallet, action, nonce) {
  const agent = { source: MAINNET ? "a" : "b", connectionId: actionHash(action, nonce) };
  const domain = { name: "Exchange", version: "1", chainId: 1337, verifyingContract: ethers.ZeroAddress };
  const types = { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] };
  const sig = ethers.Signature.from(await wallet.signTypedData(domain, types, agent));
  return { r: sig.r, s: sig.s, v: sig.v };
}

async function setBigBlocks(on) {
  const key = process.env.DEPLOYER_KEY; if (!key) throw new Error("DEPLOYER_KEY is not set");
  const wallet = new ethers.Wallet(key.startsWith("0x") ? key : "0x" + key);
  const action = { type: "evmUserModify", usingBigBlocks: !!on }, nonce = Date.now();
  const body = { action, nonce, signature: await signL1(wallet, action, nonce), vaultAddress: null };
  const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.status !== "ok") throw new Error(`Hyperliquid refused (${r.status}): ${JSON.stringify(j)}. The deployer ${wallet.address} may need to exist on HyperCore first (receive any test USDC or HYPE there).`);
  console.log(`Big blocks ${on ? "on" : "off"} for ${wallet.address}`);
}

module.exports = { actionHash, signL1 };
if (require.main === module) setBigBlocks(process.argv[2] !== "off").catch((e) => { console.error(e.message); process.exit(1); });
