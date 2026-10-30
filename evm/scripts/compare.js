// Compares the bytecode deployed at the address in app/config-evm.js with a fresh local build.
const { ethers, artifacts } = require("hardhat");
const fs = require("fs"), path = require("path");

// Solidity appends CBOR metadata; its length is in the last 2 bytes.
const split = (hex) => { const h = hex.replace(/^0x/, "").toLowerCase(); const n = parseInt(h.slice(-4), 16) * 2 + 4; return [h.slice(0, -n), h.slice(-n)]; };

async function main() {
  const cfg = fs.readFileSync(path.join(__dirname, "..", "..", "app", "config-evm.js"), "utf8");
  const addr = cfg.match(/0x[0-9a-fA-F]{40}/)[0];
  const onchain = await ethers.provider.getCode(addr);
  const local = (await artifacts.readArtifact("EcrinVault")).deployedBytecode;
  const [oc, om] = split(onchain), [lc, lm] = split(local);
  console.log(`address ${addr}`);
  console.log(`on-chain code ${oc.length / 2} bytes, metadata ${om}`);
  console.log(`local    code ${lc.length / 2} bytes, metadata ${lm}`);
  let i = 0; while (i < oc.length && oc[i] === lc[i]) i++;
  console.log(oc === lc ? "executable code IDENTICAL" : `executable code differs at byte ${i / 2}: on-chain ${oc.slice(i, i + 40)} vs local ${lc.slice(i, i + 40)}`);
  console.log(om === lm ? "metadata IDENTICAL" : "metadata differs");
}
main().catch((e) => { console.error(e); process.exit(1); });
