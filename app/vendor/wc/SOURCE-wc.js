// WalletConnect for Ecrin (Reown AppKit), bundled once into app/vendor/walletconnect.js and loaded only when
// someone picks WalletConnect. It returns providers the app already knows how to use:
// Solana: { publicKey, signTransaction } like Phantom; Ethereum: an EIP-1193 provider like MetaMask.
import { createAppKit } from "@reown/appkit";
import { SolanaAdapter } from "@reown/appkit-adapter-solana";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { solanaDevnet, sepolia } from "@reown/appkit/networks";

let kit = null;

export function initWalletConnect({ projectId, theme = "light" }) {
  if (kit) return kit;
  kit = createAppKit({
    projectId,
    adapters: [new SolanaAdapter(), new EthersAdapter()],
    networks: [solanaDevnet, sepolia],
    defaultNetwork: solanaDevnet,
    metadata: { name: "Ecrin", description: "Crypto that can't be taken in a hurry.", url: "https://ecrinprotocol.app", icons: ["https://ecrinprotocol.app/icon-192.png"] },
    themeMode: theme,
    themeVariables: { "--w3m-accent": "#2f5bff", "--w3m-border-radius-master": "2px", "--w3m-font-family": "Manrope, system-ui, sans-serif" },
    features: { analytics: false, email: false, socials: false, onramp: false, swaps: false, send: false, history: false, receive: false },
    allowUnsupportedChain: false,
  });
  return kit;
}

/** Opens the modal for one network ("solana" or "eip155") and resolves with that network's provider and address. */
export function connectWith(namespace) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; unsubP(); unsubS(); fn(v); };
    const tryResolve = () => {
      const acct = kit.getAccount(namespace), provider = kit.getProvider(namespace);
      if (acct?.isConnected && acct.address && provider) finish(resolve, { provider, address: acct.address });
    };
    const unsubP = kit.subscribeProviders(tryResolve);
    const unsubS = kit.subscribeState((st) => { if (!st.open && !done) setTimeout(() => { tryResolve(); finish(reject, Object.assign(new Error("Closed"), { code: 4001 })); }, 400); });
    tryResolve();
    if (!done) kit.open({ view: "Connect", namespace });
  });
}

export const disconnectWalletConnect = () => kit?.disconnect().catch(() => {});
export const walletConnectTheme = (t) => kit?.setThemeMode(t);
