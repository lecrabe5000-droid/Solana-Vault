// The deposit brake's holder (pauser) on one network: shows it, or offers it to a multisig.
//   PAUSER_ACTION=status  npx hardhat run scripts/pauser.js --network base     (read only, no key needed)
//   PAUSER_ACTION=propose PAUSER_NEXT=0x<Safe multisig> npx hardhat run scripts/pauser.js --network base
// "propose" is step one of two: the multisig then calls acceptPauser() itself (a transaction in the Safe app), so a
// typo can never hand the brake to a wrong address. The brake only stops NEW deposits; it can never move or hold money.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const net = hre.network.name, action = process.env.PAUSER_ACTION || "status";
  const t = fs.readFileSync(path.join(__dirname, "../../app/deployments-evm.js"), "utf8");
  const d = process.env.PAUSER_CONTRACT ? { address: process.env.PAUSER_CONTRACT } : JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1))[net]; // override: tests
  if (!d?.address) { console.log(`${net}: no Ecrin Safe contract`); return; }
  const v = await hre.ethers.getContractAt("EcrinVault", d.address);
  const [pauser, pending, paused] = await Promise.all([v.pauser(), v.pendingPauser(), v.depositsPaused()]);
  const kind = async (a) => (a === hre.ethers.ZeroAddress ? "none" : (await hre.ethers.provider.getCode(a)) === "0x" ? "a plain key" : "a contract (multisig)");
  console.log(`${net} ${d.address}: pauser ${pauser} (${await kind(pauser)}), offered to ${pending} (${await kind(pending)}), deposits ${paused ? "PAUSED" : "open"}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `| ${net} | \`${pauser}\` (${await kind(pauser)}) | \`${pending}\` | ${paused ? "paused" : "open"} |\n`);
  if (action !== "propose") return;

  const next = process.env.PAUSER_NEXT || "";
  if (!hre.ethers.isAddress(next) || next === hre.ethers.ZeroAddress) throw new Error("PAUSER_NEXT must be the multisig's address");
  // A multisig is a contract. A plain key here would put the brake back in one person's hands.
  if ((await hre.ethers.provider.getCode(next)) === "0x") throw new Error(`${next} has no code on ${net}: create the Safe multisig on this network first`);
  const [me] = await hre.ethers.getSigners();
  if (pauser.toLowerCase() !== me.address.toLowerCase()) throw new Error(`The deployer ${me.address} isn't the pauser on ${net} (it's ${pauser}); nothing to hand over`);
  if (pending.toLowerCase() === next.toLowerCase()) { console.log(`${net}: already offered to ${next}; accept it from the multisig`); return; }
  const tx = await v.proposePauser(next);
  await tx.wait();
  console.log(`${net}: offered to ${next} (tx ${tx.hash}). Next: in the Safe app on ${net}, call acceptPauser() on ${d.address}.`);
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
