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

// Deploying to Sepolia reads the key from the environment (a GitHub secret in CI). Never commit a key.
const { SEPOLIA_RPC_URL, SEPOLIA_DEPLOYER_KEY, ETHERSCAN_API_KEY } = process.env;

module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
  // Publishes the source on Etherscan so anyone, wallet scanners included, can read the contract.
  // Sourcify is off: this plugin version still calls its removed v1 API.
  etherscan: { apiKey: ETHERSCAN_API_KEY || "" },
  sourcify: { enabled: false },
  networks: {
    sepolia: {
      url: SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: SEPOLIA_DEPLOYER_KEY ? [SEPOLIA_DEPLOYER_KEY.startsWith("0x") ? SEPOLIA_DEPLOYER_KEY : "0x" + SEPOLIA_DEPLOYER_KEY] : [],
    },
  },
};
