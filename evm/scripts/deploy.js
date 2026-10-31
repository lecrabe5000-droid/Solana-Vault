// Deploys EcrinVault to the network hardhat was started with and records it in app/deployments-evm.js,
// which the site and the alert worker read. Run once per network: npx hardhat run scripts/deploy.js --network baseSepolia
const { ethers, network } = require("hardhat");
const fs = require("fs"), path = require("path");

const OUT = path.join(__dirname, "..", "..", "app", "deployments-evm.js");
const ERC20 = ["function symbol() view returns (string)", "function decimals() view returns (uint8)"];

async function main() {
  const { EVM_NETS } = await import(path.join(__dirname, "..", "..", "app", "config-evm.js"));
  const cfg = Object.values(EVM_NETS).find((n) => n.hardhat === network.name);
  if (!cfg) throw new Error(`${network.name} isn't one of the networks in app/config-evm.js`);
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer key. Set the EVM_DEPLOYER_KEY (or SEPOLIA_DEPLOYER_KEY) secret.");

  // The USDC the site will offer on this network must really be a 6-decimal USDC.
  const usdc = new ethers.Contract(cfg.usdc, ERC20, ethers.provider);
  const [symbol, decimals] = await Promise.all([usdc.symbol(), usdc.decimals()]).catch(() => [null, null]);
  if (symbol !== "USDC" || Number(decimals) !== 6) throw new Error(`${cfg.usdc} on ${network.name} isn't USDC (got ${symbol}, ${decimals} decimals). Fix app/config-evm.js.`);

  const factory = await ethers.getContractFactory("EcrinVault");
  const bal = await ethers.provider.getBalance(deployer.address);
  const gas = await ethers.provider.estimateGas(await factory.getDeployTransaction());
  const fee = await ethers.provider.getFeeData();
  const need = (gas * (fee.maxFeePerGas || fee.gasPrice || 0n) * 3n) / 2n;
  console.log(`Deployer ${deployer.address} has ${ethers.formatEther(bal)} ${cfg.unit} on ${network.name}; the deploy needs about ${ethers.formatEther(need)}`);
  if (bal < need) throw new Error(`Not enough ${cfg.unit} on ${network.name}. Send some test ${cfg.unit} to ${deployer.address} (${cfg.faucetName}: ${cfg.faucet}).`);

  const vault = await factory.deploy();
  const receipt = await vault.deploymentTransaction().wait(2);
  const address = await vault.getAddress();
  console.log(`EcrinVault deployed at ${address} (block ${receipt.blockNumber}, tx ${receipt.hash})`);
  if (await vault.hasVault(deployer.address)) throw new Error("Unexpected vault on a fresh contract");

  const text = fs.readFileSync(OUT, "utf8");
  const deployed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  deployed[network.name] = { address, fromBlock: receipt.blockNumber, v: 2 };
  fs.writeFileSync(OUT, `// Written by the deploy-evm workflow after each deploy (evm/scripts/deploy.js). v 2 = the contract holds tokens too.
export const DEPLOYED = ${JSON.stringify(deployed, null, 2)};
`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Ecrin is on ${cfg.name} ${cfg.net}\n\nContract: [\`${address}\`](${cfg.explorer}/address/${address})\n\n`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
