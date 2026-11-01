require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-verify");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Compile with the solc npm package (pinned in package.json) instead of downloading a compiler at build time.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async ({ solcVersion }, hre, runSuper) => {
  const solc = require("solc");
  if (!solc.version().startsWith(solcVersion)) return runSuper();
  // Etherscan expects the plain long version ("0.8.24+commit.e11b9ed9"); the bytecode is the same either way.
  const longVersion = solc.version().replace(/\.Emscripten.*$/, "");
  return { compilerPath: require.resolve("solc/soljson.js"), isSolcJs: true, version: solcVersion, longVersion };
});

// Deploying reads the key from the environment (a GitHub secret in CI). Never commit a key.
// One testnet-only key deploys to every network below; each needs a little of its own test coin for gas.
const { DEPLOYER_KEY, SEPOLIA_DEPLOYER_KEY, ETHERSCAN_API_KEY } = process.env;
const key = DEPLOYER_KEY || SEPOLIA_DEPLOYER_KEY;
const accounts = key ? [key.startsWith("0x") ? key : "0x" + key] : [];
// RPC_<NETWORK> overrides a public RPC, e.g. RPC_BASESEPOLIA (SEPOLIA_RPC_URL still works for Sepolia).
const rpc = (name, url) => process.env["RPC_" + name.toUpperCase()] || (name === "sepolia" && process.env.SEPOLIA_RPC_URL) || url;

module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
  // Publishes the source on Etherscan (and its sister explorers, one Etherscan key covers them all) so anyone,
  // wallet scanners included, can read the contract. Sourcify is off: this plugin version still calls its removed v1 API.
  etherscan: { apiKey: ETHERSCAN_API_KEY || "" },
  sourcify: { enabled: false },
  networks: {
    // `npx hardhat node`: its default gas limit per transaction is above the node's own cap, so set one.
    localhost: { url: "http://127.0.0.1:8545", gas: 10_000_000 },
    sepolia: { url: rpc("sepolia", "https://ethereum-sepolia-rpc.publicnode.com"), chainId: 11155111, accounts },
    baseSepolia: { url: rpc("baseSepolia", "https://sepolia.base.org"), chainId: 84532, accounts },
    arbitrumSepolia: { url: rpc("arbitrumSepolia", "https://sepolia-rollup.arbitrum.io/rpc"), chainId: 421614, accounts },
    optimismSepolia: { url: rpc("optimismSepolia", "https://sepolia.optimism.io"), chainId: 11155420, accounts },
    polygonAmoy: { url: rpc("polygonAmoy", "https://polygon-amoy-bor-rpc.publicnode.com"), chainId: 80002, accounts },
  },
};
