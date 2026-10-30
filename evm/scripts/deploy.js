// Deploys EcrinVault to the network hardhat was started with and writes app/config-evm.js for the site.
const { ethers, network } = require("hardhat");
const fs = require("fs"), path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer key. Set SEPOLIA_DEPLOYER_KEY.");
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer ${deployer.address} has ${ethers.formatEther(bal)} ETH on ${network.name}`);
  if (bal < ethers.parseEther("0.005")) throw new Error(`Not enough ETH to deploy. Send Sepolia ETH to ${deployer.address} (faucets: cloud.google.com/application/web3/faucet/ethereum/sepolia).`);

  const vault = await (await ethers.getContractFactory("EcrinVault")).deploy();
  const receipt = await vault.deploymentTransaction().wait(2);
  const address = await vault.getAddress();
  console.log(`EcrinVault deployed at ${address} (block ${receipt.blockNumber}, tx ${receipt.hash})`);

  // Smoke check: the contract answers and refuses a vault that doesn't exist.
  if (await vault.hasVault(deployer.address)) throw new Error("Unexpected vault on a fresh contract");

  const { chainId } = await ethers.provider.getNetwork();
  const out = path.join(__dirname, "..", "..", "app", "config-evm.js");
  fs.writeFileSync(out, `// Written by the deploy-sepolia workflow after each deploy. address null = not deployed yet.
export const EVM = { network: "sepolia", chainId: ${chainId}, rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io", address: "${address}", fromBlock: ${receipt.blockNumber} };
`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Ecrin is on Sepolia\n\nContract: [\`${address}\`](https://sepolia.etherscan.io/address/${address})\n\nDeployer: \`${deployer.address}\`\n`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
