// Hyperliquid refuses the big-blocks switch ("evmUserModify") for an address that has never existed on HyperCore.
// This gives the deployer a HyperCore account from its own HYPE: HYPE sent on HyperEVM to the system address
// 0x2222…2222 is credited to the sender's own HyperCore spot balance. It does nothing if the account already exists.
//   node scripts/hyper-core-activate.js          (DEPLOYER_KEY; HyperEVM mainnet)
const { ethers } = require("ethers");
const RPC = "https://rpc.hyperliquid.xyz/evm", INFO = "https://api.hyperliquid.xyz/info";
const SYSTEM = "0x2222222222222222222222222222222222222222", KEEP = ethers.parseEther("0.0032"); // kept on HyperEVM for the deploy (~0.0008 needed)

const role = async (user) => {
  const r = await fetch(INFO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "userRole", user }) });
  const j = await r.json().catch(() => null); return j?.role || JSON.stringify(j);
};

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC, 999), wallet = new ethers.Wallet(process.env.DEPLOYER_KEY, provider);
  const before = await role(wallet.address);
  console.log("HyperCore role of", wallet.address, ":", before);
  if (before !== "missing") return console.log("Already on HyperCore, nothing to do.");
  const bal = await provider.getBalance(wallet.address);
  // Opening a HyperCore account takes a minimum first deposit (a tiny one is credited but doesn't open it), so
  // everything above what the deploy needs goes across.
  const amount = bal - KEEP;
  if (amount < ethers.parseEther("0.01")) throw new Error(`The deployer holds ${ethers.formatEther(bal)} HYPE; it needs about 0.014 (0.01+ to open HyperCore, the rest to deploy).`);
  const tx = await wallet.sendTransaction({ to: SYSTEM, value: amount });
  console.log(`Sent ${ethers.formatEther(amount)} HYPE to HyperCore:`, tx.hash); await tx.wait();
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const now = await role(wallet.address); console.log("HyperCore role:", now);
    if (now !== "missing") return;
  }
  throw new Error("The HYPE was sent but HyperCore doesn't show the account yet. Run the workflow again in a few minutes.");
})().catch((e) => { console.error(e.message || e); process.exit(1); });
