// Deploys EcrinVault to the network hardhat was started with and records it in app/deployments-evm.js,
// which the site and the alert worker read. Run once per network: npx hardhat run scripts/deploy.js --network baseSepolia
const { ethers, network } = require("hardhat");
const fs = require("fs"), path = require("path");

const OUT = path.join(__dirname, "..", "..", "app", "deployments-evm.js");
const ERC20 = ["function symbol() view returns (string)", "function decimals() view returns (uint8)"];
// 2 = the contract holds tokens too; 3 = it also has the emergency brake on new deposits; 4 = staking (with Lido
// where the network has it, off elsewhere).
const VERSION = 4;
const LOCATOR = ["function lido() view returns (address)", "function withdrawalQueue() view returns (address)"];
const QUEUE = ["function WSTETH() view returns (address)", "function STETH() view returns (address)"];

async function main() {
  const { EVM_NETS, EVM_MAIN } = await import(path.join(__dirname, "..", "..", "app", "config-evm.js"));
  const cfg = [...Object.values(EVM_NETS), ...Object.values(EVM_MAIN)].find((n) => n.hardhat === network.name);
  if (!cfg) throw new Error(`${network.name} isn't one of the networks in app/config-evm.js`);
  // "all" leaves networks that already have a current contract alone, so vaults people made there keep working.
  // Picking one network by name redeploys it on purpose (REDEPLOY=1).
  const text0 = fs.readFileSync(OUT, "utf8"), have = JSON.parse(text0.slice(text0.indexOf("{"), text0.lastIndexOf("}") + 1))[network.name];
  // Networks without Lido gain nothing from v 4, so their v 3 contracts (and the Safes in them) stay.
  if (have?.v >= (cfg.lidoLocator ? VERSION : 3) && process.env.REDEPLOY !== "1") { console.log(`Already live on ${network.name} at ${have.address}; skipping. Pick ${network.name} by itself to replace it.`); return; }
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer key. Set the EVM_DEPLOYER_KEY (or SEPOLIA_DEPLOYER_KEY) secret.");
  // A real network deploys only from the deploy-evm-mainnet workflow, where its name was typed to confirm.
  if (cfg.real && process.env.CONFIRM_MAINNET !== network.name.toUpperCase()) throw new Error("Mainnet deploys run only from the deploy-evm-mainnet workflow, confirmed with the network's name.");
  // A deployer that has already sent something here, with no Safe recorded, may have deployed it already (a run that
  // failed after sending). Stop rather than put a second copy at another address; record the first one instead.
  if (cfg.real && !have && (await ethers.provider.getTransactionCount(deployer.address)) > 0 && process.env.DEPLOY_ANYWAY !== "1") {
    throw new Error(`The deployer has already sent a transaction on ${network.name}, but no Safe is recorded for it. It may already be deployed at ${ethers.getCreateAddress({ from: deployer.address, nonce: 0 })}: check, and record it in app/deployments-evm.js.`);
  }

  // The USDC the site will offer on this network must really be a 6-decimal USDC (networks without one show the coin only).
  if (cfg.usdc) {
    const usdc = new ethers.Contract(cfg.usdc, ERC20, ethers.provider);
    const [symbol, decimals] = await Promise.all([usdc.symbol(), usdc.decimals()]).catch(() => [null, null]);
    if (symbol !== "USDC" || Number(decimals) !== 6) throw new Error(`${cfg.usdc} on ${network.name} isn't USDC (got ${symbol}, ${decimals} decimals). Fix app/config-evm.js.`);
  }

  // Staking: Lido's addresses come from its on-chain directory, never typed in, and must point at each other.
  let lidoArgs = [ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress];
  // Staking stays off on every real network until the audit.
  if (cfg.lidoLocator && !cfg.real) {
    const loc = new ethers.Contract(cfg.lidoLocator, LOCATOR, ethers.provider);
    const [lido, queue] = await Promise.all([loc.lido(), loc.withdrawalQueue()]);
    const q = new ethers.Contract(queue, QUEUE, ethers.provider);
    const [wst, st] = await Promise.all([q.WSTETH(), q.STETH()]);
    if (st.toLowerCase() !== lido.toLowerCase()) throw new Error(`Lido's withdrawal queue ${queue} doesn't point at stETH ${lido}`);
    lidoArgs = [lido, wst, queue];
    console.log(`Lido on ${network.name}: stETH ${lido}, wstETH ${wst}, withdrawal queue ${queue}`);
  }
  const factory = await ethers.getContractFactory("EcrinVault");
  const bal = await ethers.provider.getBalance(deployer.address);
  const gas = await ethers.provider.estimateGas(await factory.getDeployTransaction(...lidoArgs));
  const fee = await ethers.provider.getFeeData();
  const need = (gas * (fee.maxFeePerGas || fee.gasPrice || 0n) * 3n) / 2n;
  console.log(`Deployer ${deployer.address} has ${ethers.formatEther(bal)} ${cfg.unit} on ${network.name}; the deploy needs about ${ethers.formatEther(need)}`);
  if (bal < need) throw new Error(cfg.real ? `Not enough ${cfg.unit} on ${cfg.name}: the deployer has ${ethers.formatEther(bal)}, the deploy needs about ${ethers.formatEther(need)}. Send a little more ${cfg.unit} on ${cfg.name} to ${deployer.address}.` : `Not enough ${cfg.unit} on ${network.name}. Send some test ${cfg.unit} to ${deployer.address} (${cfg.faucetName}: ${cfg.faucet}).`);

  const vault = await factory.deploy(...lidoArgs);
  const receipt = await vault.deploymentTransaction().wait(2);
  const address = await vault.getAddress();
  console.log(`EcrinVault deployed at ${address} (block ${receipt.blockNumber}, tx ${receipt.hash})`);
  if (await vault.hasVault(deployer.address)) throw new Error("Unexpected vault on a fresh contract");

  const text = fs.readFileSync(OUT, "utf8");
  const deployed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  deployed[network.name] = { address, fromBlock: receipt.blockNumber, v: VERSION, staking: !!cfg.lidoLocator, args: lidoArgs };
  fs.writeFileSync(OUT, `// Written by the deploy-evm workflow after each deploy (evm/scripts/deploy.js). v 2 = holds tokens too; v 3 = has the deposit brake; v 4 = staking (on where staking: true).
export const DEPLOYED = ${JSON.stringify(deployed, null, 2)};
`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Ecrin is on ${cfg.name} ${cfg.net}\n\nContract: [\`${address}\`](${cfg.explorer}/address/${address})\n\n`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
