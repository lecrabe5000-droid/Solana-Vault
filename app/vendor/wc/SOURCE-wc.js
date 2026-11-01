// WalletConnect for Ecrin (Reown AppKit), bundled once into app/vendor/walletconnect.js and loaded only when
// someone picks WalletConnect. It returns providers the app already knows how to use:
// Solana: { publicKey, signTransaction } like Phantom; Ethereum: an EIP-1193 provider like MetaMask.
import { createAppKit } from "@reown/appkit";
import { SolanaAdapter } from "@reown/appkit-adapter-solana";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { solanaDevnet, sepolia, baseSepolia, arbitrumSepolia, optimismSepolia, polygonAmoy } from "@reown/appkit/networks";

let kit = null;

// The wallets people use most, shown first. The wallet directory lists most wallets under their main networks only,
// and Ecrin asks for test networks, so without this many familiar wallets would be filtered out of the list.
const FEATURED = [
  "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96", // MetaMask
  "a797aa35c0fadbfc1a53e7f675162ed5226968b44a19ee3d24385c64d1d3c393", // Phantom
  "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0", // Trust Wallet
  "fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa", // Coinbase Wallet
  "1ca0bdd4747578705b1939af023d120677c64fe6ca76add81fda36e350605e79", // Solflare
  "1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369", // Rainbow
  "971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709", // OKX Wallet
  "18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1", // Rabby
  "ecc4036f814562b41a5268adc86270fba1365471402006302e70169465b7ac18", // Zerion
  "c03dfee351b6fcc421b4494ea33b9d4b92a984f87aa76d1663bb28705e95034a", // Uniswap Wallet
  "2bd8c14e035c2d48f184aaa168559e86b0e3433228d3c4075900a221785019b0", // Backpack
  "19177a98252e07ddfc9af2083ba8e07ef627cb6103467ffebb3f8f4205fd7927", // Ledger Live
];

export function initWalletConnect({ projectId, theme = "light", solana = true }) {
  if (kit) return kit;
  kit = createAppKit({
    projectId,
    adapters: [new SolanaAdapter(), new EthersAdapter()],
    networks: [solanaDevnet, sepolia, baseSepolia, arbitrumSepolia, optimismSepolia, polygonAmoy],
    defaultNetwork: solana ? solanaDevnet : sepolia,
    featuredWalletIds: FEATURED,
    metadata: { name: "Ecrin", description: "Crypto that can't be taken in a hurry.", url: "https://ecrinprotocol.app", icons: ["https://ecrinprotocol.app/icon-192.png"] },
    themeMode: theme,
    themeVariables: { "--w3m-accent": "#2f5bff", "--w3m-border-radius-master": "2px", "--w3m-font-family": "Manrope, system-ui, sans-serif" },
    features: { analytics: false, email: false, socials: false, onramp: false, swaps: false, send: false, history: false, receive: false },
    allowUnsupportedChain: false,
  });
  return kit;
}

/** Opens the modal with every wallet (Solana and Ethereum ones alike) and resolves with whichever network the person
 *  connected: { namespace: "solana" | "eip155", provider, address }. `prefer` wins if a wallet connects both. */
export function connectWith(prefer) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; unsubP(); unsubS(); fn(v); };
    const tryResolve = () => {
      for (const ns of [prefer, prefer === "solana" ? "eip155" : "solana"]) {
        const acct = kit.getAccount(ns), provider = kit.getProvider(ns);
        if (acct?.isConnected && acct.address && provider) return finish(resolve, { namespace: ns, provider, address: acct.address });
      }
    };
    const unsubP = kit.subscribeProviders(tryResolve);
    const unsubS = kit.subscribeState((st) => { if (!st.open && !done) setTimeout(() => { tryResolve(); finish(reject, Object.assign(new Error("Closed"), { code: 4001 })); }, 400); });
    tryResolve();
    if (!done) kit.open({ view: "Connect" });
  });
}

export const disconnectWalletConnect = () => kit?.disconnect().catch(() => {});
export const walletConnectTheme = (t) => kit?.setThemeMode(t);
