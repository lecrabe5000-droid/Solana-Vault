// Staking from the vault through Lido (stand-ins in contracts/test/Lido.sol): staked ETH stays booked to its
// owner as wstETH and can only come back into that owner's vault.
const { expect } = require("chai");
const { ethers } = require("hardhat");

const eth = (n) => ethers.parseEther(String(n));
const Gentle = 0;

async function setup() {
  const [owner, other, cranker] = await ethers.getSigners();
  const st = await (await ethers.getContractFactory("MockStETH")).deploy();
  const wst = await (await ethers.getContractFactory("MockWstETH")).deploy(await st.getAddress());
  const q = await (await ethers.getContractFactory("MockQueue")).deploy(await st.getAddress(), await wst.getAddress());
  const vault = await (await ethers.getContractFactory("EcrinVault")).deploy(await st.getAddress(), await wst.getAddress(), await q.getAddress());
  // Seed Lido with someone else's ETH so the share rate is realistic.
  await st.connect(other).submit(ZERO(), { value: eth(100) });
  await vault.createVault(Gentle, ZERO(), 0, { value: eth(10) });
  return { owner, other, cranker, st, wst, q, vault };
}
const ZERO = () => ethers.ZeroAddress;
const held = async (vault) => ethers.provider.getBalance(await vault.getAddress());

describe("Staking from the vault (Lido)", () => {
  it("checks the Lido addresses belong together at deploy", async () => {
    const { st, wst, q } = await setup();
    const F = await ethers.getContractFactory("EcrinVault");
    await expect(F.deploy(await st.getAddress(), ZERO(), ZERO())).to.be.revertedWithCustomError(F, "InvalidValue");
    const other = await (await ethers.getContractFactory("MockStETH")).deploy();
    await expect(F.deploy(await other.getAddress(), await wst.getAddress(), await q.getAddress())).to.be.revertedWithCustomError(F, "InvalidValue");
  });

  it("is off where Lido isn't set", async () => {
    const F = await ethers.getContractFactory("EcrinVault");
    const v = await F.deploy(ZERO(), ZERO(), ZERO());
    await v.createVault(Gentle, ZERO(), 0, { value: eth(1) });
    await expect(v.stakeEth(eth(1))).to.be.revertedWithCustomError(v, "StakingOff");
    await expect(v.unstakeEth(1)).to.be.revertedWithCustomError(v, "StakingOff");
  });

  it("stakes only free ETH, and the books still match what the contract holds", async () => {
    const { owner, vault, wst } = await setup();
    await vault.requestWithdrawal(owner.address, eth(2));
    await expect(vault.stakeEth(eth(9))).to.be.revertedWithCustomError(vault, "InsufficientFunds");
    await expect(vault.stakeEth(0)).to.be.revertedWithCustomError(vault, "ZeroAmount");
    await vault.stakeEth(eth(8));
    const [w] = await vault.getStake(owner.address);
    expect(w).to.be.gt(0);
    expect(await wst.balanceOf(await vault.getAddress())).to.equal(w);
    expect(await vault.totalStakedWst()).to.equal(w);
    expect((await vault.getVault(owner.address))[0]).to.equal(eth(2));
    expect(await held(vault)).to.equal(eth(2)); // ETH held == ETH booked, exactly
    expect(await vault.available(owner.address)).to.equal(0);
  });

  it("another wallet can't unstake or claim someone else's stake into their own vault", async () => {
    const { owner, other, vault } = await setup();
    await vault.stakeEth(eth(5));
    await expect(vault.connect(other).unstakeEth(1)).to.be.revertedWithCustomError(vault, "NotFound");
    await vault.connect(other).createVault(Gentle, ZERO(), 0, { value: eth(1) });
    await expect(vault.connect(other).unstakeEth(1)).to.be.revertedWithCustomError(vault, "InsufficientFunds");
    const id = await vault.unstakeEth.staticCall(eth(1)); await vault.unstakeEth(eth(1));
    await expect(vault.claimUnstaked(other.address, id)).to.be.revertedWithCustomError(vault, "NotFound");
  });

  it("unstakes through the exit queue and the ETH, rewards included, comes back only into the owner's vault", async () => {
    const { owner, other, cranker, st, q, vault } = await setup();
    await vault.stakeEth(eth(5));
    await st.connect(other).reward({ value: eth(10.5) }); // Lido rewards: +10% on everything staked
    const [w] = await vault.getStake(owner.address);
    const id = await vault.unstakeEth.staticCall(w);
    await expect(vault.unstakeEth(w)).to.emit(vault, "UnstakeRequested");
    expect((await vault.getStake(owner.address))[1]).to.deep.equal([id]);
    // not paid out yet
    await expect(vault.connect(cranker).claimUnstaked(owner.address, id)).to.be.reverted;
    const [amount] = await q.reqs(id);
    expect(amount).to.be.closeTo(eth(5.5), 10n);
    await q.finalize(id, { value: amount });
    const before = (await vault.getVault(owner.address))[0];
    const crankerBefore = await ethers.provider.getBalance(cranker.address);
    const tx = await vault.connect(cranker).claimUnstaked(owner.address, id);
    const gas = (await tx.wait()).fee;
    expect((await vault.getVault(owner.address))[0] - before).to.equal(amount);
    expect(await ethers.provider.getBalance(cranker.address)).to.equal(crankerBefore - gas); // the cranker gained nothing
    expect(await held(vault)).to.equal((await vault.getVault(owner.address))[0]);
    expect((await vault.getStake(owner.address))[1]).to.deep.equal([]);
    await expect(vault.claimUnstaked(owner.address, id)).to.be.revertedWithCustomError(vault, "NotFound");
  });

  it("still refuses plain ETH from anyone but Lido's queue", async () => {
    const { other, vault } = await setup();
    await expect(other.sendTransaction({ to: await vault.getAddress(), value: 1 })).to.be.revertedWithCustomError(vault, "InvalidValue");
  });

  it("the brake on deposits never blocks unstaking or claiming; at most 4 open unstakes", async () => {
    const { owner, q, vault } = await setup();
    await vault.stakeEth(eth(5));
    await vault.setDepositsPaused(true);
    const ids = [];
    for (let i = 0; i < 4; i++) { ids.push(await vault.unstakeEth.staticCall(eth(0.5))); await vault.unstakeEth(eth(0.5)); }
    await expect(vault.unstakeEth(eth(0.5))).to.be.revertedWithCustomError(vault, "TooManyPending");
    const [a] = await q.reqs(ids[2]); await q.finalize(ids[2], { value: a });
    await vault.claimUnstaked(owner.address, ids[2]);
    expect((await vault.getStake(owner.address))[1].length).to.equal(3);
  });

  it("a queued withdrawal still runs in full while the rest is staked", async () => {
    const { owner, other, vault } = await setup();
    await vault.requestWithdrawal(other.address, eth(3));
    await vault.stakeEth(eth(7));
    await ethers.provider.send("evm_increaseTime", [25 * 3600]); await ethers.provider.send("evm_mine", []);
    await expect(vault.executeWithdrawal(owner.address, 1)).to.changeEtherBalance(other, eth(3));
    expect(await held(vault)).to.equal(0);
  });
});
