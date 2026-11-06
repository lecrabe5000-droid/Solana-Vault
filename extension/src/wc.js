// WalletConnect for Ecrin Wallet on phones: connect to any website or app that shows a WalletConnect QR code.
// Loaded only when used. Every request a site makes goes through the same approval screen as the browser extension
// (the exact preview of what leaves your wallet, phishing checks), and is answered back through WalletConnect.
// Beta: Solana Devnet and the EVM test networks only.
import { Core } from "@walletconnect/core";
import { WalletKit } from "@reown/walletkit";
import { buildApprovedNamespaces, getSdkError } from "@walletconnect/utils";
import bs58 from "bs58";
import { EVM_NETS } from "../../app/config-evm.js";

export const WC_PROJECT = "668bdc733a6710a91a28ad02dd980f43"; // public by design; Reown's domain allow-list protects it
export const SOL_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM_METHODS = ["eth_sendTransaction", "personal_sign", "eth_sign", "eth_signTypedData", "eth_signTypedData_v4"];
const SOL_METHODS = ["solana_signTransaction", "solana_signAndSendTransaction", "solana_signMessage", "solana_signAllTransactions"];

const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Turns a WalletConnect request into the request shape the approval screen and signer already understand. */
export function toRequest(method, params, chainId, evmAddr) {
  if (method === "personal_sign") { const [a, b] = params; return { fam: "evm", kind: "sign", message: String(a).toLowerCase() === evmAddr?.toLowerCase() ? b : a }; }
  if (method === "eth_sign") return { fam: "evm", kind: "sign", message: params[1] };
  if (method.startsWith("eth_signTypedData")) { const [a, b] = params, d = String(a).toLowerCase() === evmAddr?.toLowerCase() ? b : a; return { fam: "evm", kind: "typed", data: typeof d === "string" ? d : JSON.stringify(d) }; }
  if (method === "eth_sendTransaction") return { fam: "evm", kind: "tx", tx: params[0] || {}, chainId: Number(String(chainId).split(":")[1]) };
  if (method === "solana_signMessage") return { fam: "sol", kind: "solmsg", message: Array.from(bs58.decode(params.message)) };
  if (method === "solana_signTransaction" || method === "solana_signAndSendTransaction") return { fam: "sol", kind: "soltx", txs: [Array.from(unb64(params.transaction))], send: method === "solana_signAndSendTransaction", chain: "solana:devnet" };
  if (method === "solana_signAllTransactions") return { fam: "sol", kind: "soltx", txs: params.transactions.map((t) => Array.from(unb64(t))), send: false, chain: "solana:devnet" };
  throw new Error(`Ecrin Wallet doesn't support ${method} yet.`);
}

/** Turns what the signer returns into the answer WalletConnect expects for that method. */
export function toResult(method, out) {
  if (method === "solana_signMessage") return { signature: bs58.encode(Uint8Array.from(out)) };
  if (method === "solana_signTransaction") { const tx = Uint8Array.from(out[0]); return { signature: bs58.encode(tx.slice(1, 65)), transaction: b64(tx) }; }
  if (method === "solana_signAndSendTransaction") return { signature: bs58.encode(Uint8Array.from(out[0])) };
  if (method === "solana_signAllTransactions") return { transactions: out.map((t) => b64(Uint8Array.from(t))) };
  return out; // EVM: a signature or a transaction hash
}

export async function startWC({ solAddr, evmAddr, onProposal, onRequest, onChange }) {
  const core = new Core({ projectId: WC_PROJECT });
  const kit = await WalletKit.init({ core, metadata: { name: "Ecrin Wallet", description: "A wallet with a Safe nobody can rush.", url: "https://ecrinprotocol.app", icons: ["https://ecrinprotocol.app/icon2-192.png"] } });
  const evmChains = Object.values(EVM_NETS).map((n) => `eip155:${n.chainId}`);
  const supported = {
    ...(solAddr ? { solana: { chains: [SOL_DEVNET], methods: SOL_METHODS, events: [], accounts: [`${SOL_DEVNET}:${solAddr}`] } } : {}),
    ...(evmAddr ? { eip155: { chains: evmChains, methods: EVM_METHODS, events: ["accountsChanged", "chainChanged"], accounts: evmChains.map((c) => `${c}:${evmAddr}`) } } : {}),
  };
  kit.on("session_proposal", (p) => {
    let ns = null, why = "";
    try { ns = buildApprovedNamespaces({ proposal: p.params, supportedNamespaces: supported }); } catch (e) { why = e?.message || String(e); }
    onProposal({ id: p.id, meta: p.params.proposer.metadata, verify: p.verifyContext?.verified, ns, why });
  });
  kit.on("session_request", (e) => {
    const s = kit.getActiveSessions()[e.topic];
    onRequest({ id: e.id, topic: e.topic, method: e.params.request.method, params: e.params.request.params, chainId: e.params.chainId, meta: s?.peer?.metadata, verify: e.verifyContext?.verified });
  });
  kit.on("session_delete", () => onChange?.());
  return {
    pair: (uri) => kit.pair({ uri }),
    approve: async (p) => { await kit.approveSession({ id: p.id, namespaces: p.ns }); onChange?.(); },
    reject: (p) => kit.rejectSession({ id: p.id, reason: getSdkError("USER_REJECTED") }),
    answer: (r, result) => kit.respondSessionRequest({ topic: r.topic, response: { id: r.id, jsonrpc: "2.0", result } }),
    refuse: (r, msg) => kit.respondSessionRequest({ topic: r.topic, response: { id: r.id, jsonrpc: "2.0", error: { code: 5000, message: msg || "The user rejected the request." } } }),
    sessions: () => Object.values(kit.getActiveSessions()).map((s) => ({ topic: s.topic, name: s.peer.metadata.name, url: s.peer.metadata.url, icon: s.peer.metadata.icons?.[0] })),
    disconnect: async (topic) => { await kit.disconnectSession({ topic, reason: getSdkError("USER_DISCONNECTED") }); onChange?.(); },
  };
}
