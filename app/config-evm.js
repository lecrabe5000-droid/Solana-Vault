// The Ethereum-style test networks Ecrin runs on. Contract addresses come from deployments-evm.js, which the
// deploy-evm workflow writes after each deploy; a network without one shows "not deployed yet".
// USDC addresses are Circle's official testnet USDC (developers.circle.com/stablecoins/usdc-contract-addresses).
import { DEPLOYED } from "./deployments-evm.js";

const NETWORKS = {
  eth: {
    hardhat: "sepolia", name: "Ethereum", net: "Sepolia", chainId: 11155111, unit: "ETH", cg: "ethereum",
    rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    faucet: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia", faucetName: "the Google Cloud Sepolia faucet",
  },
  base: {
    hardhat: "baseSepolia", name: "Base", net: "Sepolia", chainId: 84532, unit: "ETH", cg: "ethereum",
    rpc: "https://base-sepolia-rpc.publicnode.com", explorer: "https://sepolia.basescan.org",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    faucet: "https://docs.base.org/base-chain/tools/network-faucets", faucetName: "a Base Sepolia faucet",
  },
  arb: {
    hardhat: "arbitrumSepolia", name: "Arbitrum", net: "Sepolia", chainId: 421614, unit: "ETH", cg: "ethereum",
    rpc: "https://arbitrum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.arbiscan.io",
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    faucet: "https://www.alchemy.com/faucets/arbitrum-sepolia", faucetName: "the Arbitrum Sepolia faucet",
  },
  op: {
    hardhat: "optimismSepolia", name: "Optimism", net: "Sepolia", chainId: 11155420, unit: "ETH", cg: "ethereum",
    rpc: "https://optimism-sepolia-rpc.publicnode.com", explorer: "https://sepolia-optimism.etherscan.io",
    usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    faucet: "https://console.optimism.io/faucet", faucetName: "the OP Sepolia faucet",
  },
  pol: {
    hardhat: "polygonAmoy", name: "Polygon", net: "Amoy", chainId: 80002, unit: "POL", cg: "polygon-ecosystem-token",
    rpc: "https://polygon-amoy-bor-rpc.publicnode.com", explorer: "https://amoy.polygonscan.com",
    usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    faucet: "https://faucet.polygon.technology", faucetName: "the Polygon faucet",
  },
};

/** Each network with its deployment: address (null until deployed), fromBlock, and v (2 = holds tokens too). */
export const EVM_NETS = Object.fromEntries(Object.entries(NETWORKS).map(([k, n]) => [k, { key: k, ...n, address: null, fromBlock: 0, v: 1, ...(DEPLOYED[n.hardhat] || {}) }]));

/** Sepolia, for code that only knows one Ethereum network. */
export const EVM = EVM_NETS.eth;
