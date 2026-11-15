// Mainnet or Testnet (Settings → Networks), for every part of the wallet: the popup, the background worker that
// answers websites, the approval screen and WalletConnect. Small on purpose: no blockchain libraries.
import { EVM_NETS, EVM_MAIN } from "../../app/config-evm.js";

export const DEFAULT_MODE = "test"; // flips to "main" when mainnet launches
/** The chosen mode, read from the wallet's own storage (extension) or the page's (phone wallet). */
export async function getMode() {
  try {
    const st = globalThis.chrome?.storage?.local ? await chrome.storage.local.get("netMode") : JSON.parse(localStorage.getItem("ecrin-wallet-web") || "{}");
    return st.netMode === "main" || st.netMode === "test" ? st.netMode : DEFAULT_MODE;
  } catch (_) { return DEFAULT_MODE; }
}
// Solana network ids (CAIP-2: the first 32 characters of each network's genesis hash).
export const SOL_DEV_CAIP = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const SOL_MAIN_CAIP = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const solIsMain = (c) => ["solana:mainnet", "solana:mainnet-beta", SOL_MAIN_CAIP].includes(String(c));
export const solChainFor = (mode) => (mode === "main" ? "solana:mainnet" : "solana:devnet");
/** The Ethereum-style networks of one mode, and one of them by chain id. */
export const evmOfMode = (mode) => Object.values(mode === "main" ? EVM_MAIN : EVM_NETS);
export const evmByChain = (id) => [...Object.values(EVM_NETS), ...Object.values(EVM_MAIN)].find((n) => n.chainId === Number(id));
// Solana servers per mode (mainnet: Ecrin's route first, so a private node can serve it).
export const SOL_RPC = { test: "https://api.devnet.solana.com", main: "https://ecrinprotocol.app/api/rpc/solm" };

/** The moment a transaction reaches the network (before it's confirmed): engines call txEvents.sent(id), and the
 *  wallet's progress sheet listens, so "Sent to the network" lights up with its explorer link. */
export const txEvents = { sent: null };
export const emitSent = (id) => { try { txEvents.sent?.(id); } catch (_) {} };
