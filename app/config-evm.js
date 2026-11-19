// The Ethereum-style networks Ecrin runs on: the test networks (with the Safe) and, below, the main networks (real money,
// no Safe until the contract's audit). Contract addresses come from deployments-evm.js, which the
// deploy-evm workflow writes after each deploy; a network without one shows "not deployed yet".
// USDC addresses are Circle's official testnet USDC (developers.circle.com/stablecoins/usdc-contract-addresses).
import { DEPLOYED } from "./deployments-evm.js";

const NETWORKS = {
  eth: {
    hardhat: "sepolia", name: "Ethereum", net: "Sepolia", chainId: 11155111, unit: "ETH", cg: "ethereum",
    rpc: "https://ethereum-sepolia-rpc.publicnode.com", rpc2: "https://sepolia.drpc.org", explorer: "https://sepolia.etherscan.io",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    faucet: "https://sepolia-faucet.pk910.de", faucetName: "the pk910 Sepolia faucet (no balance needed)",
  },
  base: {
    hardhat: "baseSepolia", name: "Base", net: "Sepolia", chainId: 84532, unit: "ETH", cg: "ethereum",
    rpc: "https://base-sepolia-rpc.publicnode.com", rpc2: "https://sepolia.base.org", explorer: "https://sepolia.basescan.org",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    faucet: "https://docs.base.org/base-chain/tools/network-faucets", faucetName: "a Base Sepolia faucet",
  },
  arb: {
    hardhat: "arbitrumSepolia", name: "Arbitrum", net: "Sepolia", chainId: 421614, unit: "ETH", cg: "ethereum",
    rpc: "https://arbitrum-sepolia-rpc.publicnode.com", rpc2: "https://sepolia-rollup.arbitrum.io/rpc", explorer: "https://sepolia.arbiscan.io",
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    faucet: "https://bridge.arbitrum.io/?destinationChain=arbitrum-sepolia&sourceChain=sepolia", faucetName: "the Arbitrum bridge (move Sepolia ETH over)",
  },
  op: {
    hardhat: "optimismSepolia", name: "Optimism", net: "Sepolia", chainId: 11155420, unit: "ETH", cg: "ethereum",
    rpc: "https://optimism-sepolia-rpc.publicnode.com", rpc2: "https://sepolia.optimism.io", explorer: "https://sepolia-optimism.etherscan.io",
    usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    faucet: "https://console.optimism.io/faucet", faucetName: "the OP Sepolia faucet",
  },
  pol: {
    hardhat: "polygonAmoy", name: "Polygon", net: "Amoy", chainId: 80002, unit: "POL", cg: "polygon-ecosystem-token",
    rpc: "https://polygon-amoy-bor-rpc.publicnode.com", rpc2: "https://rpc-amoy.polygon.technology", explorer: "https://amoy.polygonscan.com",
    usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    faucet: "https://faucet.polygon.technology", faucetName: "the Polygon faucet",
  },
  // Ethereum's Hoodi test network: the one where Lido runs, so the Safe can stake test ETH here. Lido's addresses
  // are read at deploy from its on-chain directory (LidoLocator, from github.com/lidofinance/core deployed-hoodi.json).
  // Chain id, servers, explorer and faucet: viem's hoodi definition and hoodi.ethpandaops.io. No official test USDC.
  hoodi: {
    hardhat: "hoodi", name: "Ethereum", net: "Hoodi", chainId: 560048, unit: "ETH", cg: "ethereum",
    rpc: "https://hoodi.drpc.org", rpc2: "https://rpc.hoodi.ethpandaops.io", explorer: "https://hoodi.etherscan.io",
    usdc: null, lidoLocator: "0xe2EF9536DAAAEBFf5b1c130957AB3E80056b06D8",
    faucet: "https://hoodi-faucet.pk910.de", faucetName: "the pk910 Hoodi faucet (no balance needed)",
  },
  // Circle has no official test USDC on BNB Chain, so that network shows BNB only.
  bnb: {
    hardhat: "bscTestnet", name: "BNB Chain", net: "Testnet", chainId: 97, unit: "BNB", cg: "binancecoin",
    rpc: "https://bsc-testnet-rpc.publicnode.com", rpc2: "https://data-seed-prebsc-1-s1.bnbchain.org:8545", explorer: "https://testnet.bscscan.com",
    usdc: null,
    faucet: "https://www.bnbchain.org/en/testnet-faucet", faucetName: "the BNB Chain faucet",
  },
  avax: {
    hardhat: "avalancheFuji", name: "Avalanche", net: "Fuji", chainId: 43113, unit: "AVAX", cg: "avalanche-2",
    rpc: "https://avalanche-fuji-c-chain-rpc.publicnode.com", rpc2: "https://api.avax-test.network/ext/bc/C/rpc", explorer: "https://testnet.snowtrace.io",
    usdc: "0x5425890298aed601595a70AB815c96711a31Bc65",
    faucet: "https://core.app/tools/testnet-faucet/?subnet=c&token=c", faucetName: "the Avalanche faucet",
  },
  // Robinhood Chain (an Arbitrum Orbit network). No official test USDC yet.
  rh: {
    hardhat: "robinhoodTestnet", name: "Robinhood Chain", net: "Testnet", chainId: 46630, unit: "ETH", cg: "ethereum",
    rpc: "https://rpc.testnet.chain.robinhood.com", rpc2: null, explorer: "https://explorer.testnet.chain.robinhood.com",
    usdc: null,
    faucet: "https://faucet.testnet.chain.robinhood.com", faucetName: "the Robinhood Chain faucet",
  },
  // Hyperliquid's HyperEVM. Gas is HYPE. No official test USDC on it yet.
  hype: {
    hardhat: "hyperevmTestnet", name: "HyperEVM", net: "Testnet", chainId: 998, unit: "HYPE", cg: "hyperliquid",
    // No explorer: testnet.purrsec.com is gone (its parent domain now serves a gambling site) and hyperevmscan has no testnet.
    rpc: "https://rpc.hyperliquid-testnet.xyz/evm", rpc2: "https://rpcs.chain.link/hyperevm/testnet", explorer: null,
    usdc: null,
    faucet: "https://faucet.quicknode.com/hyperliquid", faucetName: "the QuickNode HyperEVM faucet",
  },
};

// Main networks: real money. Chain IDs checked against each network's own server; USDC is Circle's native USDC
// (developers.circle.com/stablecoins/usdc-contract-addresses), checked on-chain (symbol USDC, 6 decimals).
// Servers: PublicNode first, dRPC as backup. No contract: the Safe arrives on mainnet after its audit.
const MAINNETS = {
  ethm: { name: "Ethereum", net: "Mainnet", chainId: 1, unit: "ETH", cg: "ethereum", rpc: "https://ethereum-rpc.publicnode.com", rpc2: "https://eth.drpc.org", explorer: "https://etherscan.io", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  basem: { hardhat: "base", name: "Base", net: "Mainnet", chainId: 8453, unit: "ETH", cg: "ethereum", rpc: "https://base-rpc.publicnode.com", rpc2: "https://base.drpc.org", explorer: "https://basescan.org", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  arbm: { name: "Arbitrum", net: "Mainnet", chainId: 42161, unit: "ETH", cg: "ethereum", rpc: "https://arbitrum-one-rpc.publicnode.com", rpc2: "https://arbitrum.drpc.org", explorer: "https://arbiscan.io", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
  opm: { name: "Optimism", net: "Mainnet", chainId: 10, unit: "ETH", cg: "ethereum", rpc: "https://optimism-rpc.publicnode.com", rpc2: "https://optimism.drpc.org", explorer: "https://optimistic.etherscan.io", usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
  polm: { name: "Polygon", net: "Mainnet", chainId: 137, unit: "POL", cg: "polygon-ecosystem-token", rpc: "https://polygon-bor-rpc.publicnode.com", rpc2: "https://polygon.drpc.org", explorer: "https://polygonscan.com", usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
  // Circle has no native USDC on BNB Chain: BNB only.
  bnbm: { name: "BNB Chain", net: "Mainnet", chainId: 56, unit: "BNB", cg: "binancecoin", rpc: "https://bsc-rpc.publicnode.com", rpc2: "https://bsc.drpc.org", explorer: "https://bscscan.com", usdc: null },
  avaxm: { name: "Avalanche", net: "Mainnet", chainId: 43114, unit: "AVAX", cg: "avalanche-2", rpc: "https://avalanche-c-chain-rpc.publicnode.com", rpc2: "https://avalanche.drpc.org", explorer: "https://snowtrace.io", usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" },
  hypem: { name: "HyperEVM", net: "Mainnet", chainId: 999, unit: "HYPE", cg: "hyperliquid", rpc: "https://rpc.hyperliquid.xyz/evm", rpc2: null, explorer: "https://hyperevmscan.io", usdc: "0xb88339CB7199b77E23DB6E890353E22632Ba630f" },
};
/** Main networks (real money), same shape as EVM_NETS. Kept apart so the alert worker, which watches the test
 *  networks' Safe contracts, never touches them. */
// Base has an early-access Safe (unaudited; the wallet shows it only to someone who turns it on in Settings).
export const EVM_MAIN = Object.fromEntries(Object.entries(MAINNETS).map(([k, n]) => { const d = n.hardhat && DEPLOYED[n.hardhat]; return [k, { key: k, ...n, real: true, address: null, fromBlock: 0, v: 2, faucet: null, ...(d ? { address: d.address, fromBlock: d.fromBlock, v: d.v } : {}) }]; }));

/** Each network with its deployment: address (null until deployed), fromBlock, and v (2 = holds tokens too). */
export const EVM_NETS = Object.fromEntries(Object.entries(NETWORKS).map(([k, n]) => [k, { key: k, ...n, address: null, fromBlock: 0, v: 1, ...(DEPLOYED[n.hardhat] || {}) }]));

/** Sepolia, for code that only knows one Ethereum network. */
export const EVM = EVM_NETS.eth;
