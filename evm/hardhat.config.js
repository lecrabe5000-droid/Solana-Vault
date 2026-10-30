require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Compile with the solc npm package (pinned in package.json) instead of downloading a compiler at build time.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async ({ solcVersion }, hre, runSuper) => {
  const solc = require("solc");
  if (!solc.version().startsWith(solcVersion)) return runSuper();
  return { compilerPath: require.resolve("solc/soljson.js"), isSolcJs: true, version: solcVersion, longVersion: solc.version() };
});

// Deploying to Sepolia reads the key from the environment (a GitHub secret in CI). Never commit a key.
const { SEPOLIA_RPC_URL, SEPOLIA_DEPLOYER_KEY } = process.env;

module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
  networks: {
    sepolia: {
      url: SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: SEPOLIA_DEPLOYER_KEY ? [SEPOLIA_DEPLOYER_KEY.startsWith("0x") ? SEPOLIA_DEPLOYER_KEY : "0x" + SEPOLIA_DEPLOYER_KEY] : [],
    },
  },
};
