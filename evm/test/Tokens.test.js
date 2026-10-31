// Token vaults: USDC and other ERC-20s under the same rules as ETH.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const HOUR = 3600, DAY = 86400;
const Gentle = 0, Strong = 1, Locked = 2;
const K = { AddTrusted: 5 };
const ZERO = ethers.ZeroAddress;
const usd = (n) => ethers.parseUnits(String(n), 6);

async function deploy() {
  const [owner, guardian, bank, casino, thief, other] = await ethers.getSigners();
  const vault = await (await ethers.getContractFactory("EcrinVault")).deploy();
  const T = await ethers.getContractFactory("TestToken");
  const usdc = await T.deploy("USDC", 0);
  for (const s of [owner, thief, other]) { await usdc.mint(s.address, usd(1000)); await usdc.connect(s).approve(vault.target, ethers.MaxUint256); }
  return { vault, usdc, T, owner, guardian, bank, casino, thief, other };
}
async function withVault(preset = Strong) {
  const f = await loadFixture(deploy);
  await f.vault.createVault(preset, preset === Gentle ? ZERO : f.guardian.address, 0);
  await f.vault.depositToken(f.usdc.target, usd(500));
  return f;
}
const ev = async (tx, vault, name) => {
  const r = await (await tx).wait();
  return r.logs.map((l) => { try { return vault.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === name)?.args;
};
const tv = (f, who = f.owner) => f.vault.getTokenVault(who.address, f.usdc.target);

describe("EcrinVault tokens", () => {
  it("deposits need a vault, and count what arrived", async () => {
    const f = await loadFixture(deploy);
    await expect(f.vault.depositToken(f.usdc.target, usd(1))).to.be.revertedWithCustomError(f.vault, "NotFound");
    await f.vault.createVault(Gentle, ZERO, 0);
    await expect(f.vault.depositToken(f.usdc.target, usd(250))).to.emit(f.vault, "TokenDeposited").withArgs(f.owner.address, f.usdc.target, usd(250));
    expect((await tv(f)).balance).to.equal(usd(250));
    expect(await f.usdc.balanceOf(f.vault.target)).to.equal(usd(250));
    await expect(f.vault.depositToken(f.casino.address, 1)).to.be.revertedWithCustomError(f.vault, "InvalidValue");
    await expect(f.vault.depositToken(f.usdc.target, 0)).to.be.revertedWithCustomError(f.vault, "ZeroAmount");
  });

  it("a withdrawal waits for the vault's delay, then anyone can run it", async () => {
    const f = await withVault();
    const { id, readyAt } = await ev(f.vault.requestTokenWithdrawal(f.usdc.target, f.casino.address, usd(120)), f.vault, "TokenWithdrawalQueued");
    expect(readyAt - BigInt(await time.latest())).to.equal(72n * BigInt(HOUR));
    await expect(f.vault.connect(f.thief).executeTokenWithdrawal(f.owner.address, f.usdc.target, id)).to.be.revertedWithCustomError(f.vault, "TooEarly");
    await time.increaseTo(readyAt);
    await expect(f.vault.connect(f.thief).executeTokenWithdrawal(f.owner.address, f.usdc.target, id)).to.changeTokenBalances(f.usdc, [f.casino, f.vault], [usd(120), -usd(120)]);
    expect((await tv(f)).balance).to.equal(usd(380));
  });

  it("the owner can cancel; ids are shared with the ETH side", async () => {
    const f = await withVault();
    const a = await ev(f.vault.requestTokenWithdrawal(f.usdc.target, f.casino.address, usd(1)), f.vault, "TokenWithdrawalQueued");
    await f.vault.proposeChange({ kind: K.AddTrusted, value: 0, addr: f.bank.address });
    const c = await ev(f.vault.requestTokenWithdrawal(f.usdc.target, f.casino.address, usd(2)), f.vault, "TokenWithdrawalQueued");
    expect(c.id).to.equal(a.id + 2n); // the trusted-address change took the id in between
    await f.vault.cancelTokenWithdrawal(f.usdc.target, a.id);
    await expect(f.vault.connect(f.thief).cancelTokenWithdrawal(f.usdc.target, c.id)).to.be.revertedWithCustomError(f.vault, "NotFound");
    expect((await tv(f)).withdrawals.map((w) => w.id)).to.deep.equal([c.id]);
    expect(await f.vault.availableToken(f.owner.address, f.usdc.target)).to.equal(usd(498));
  });

  it("can't promise more than the balance, or queue more than four", async () => {
    const f = await withVault();
    await f.vault.requestTokenWithdrawal(f.usdc.target, f.casino.address, usd(400));
    await expect(f.vault.requestTokenWithdrawal(f.usdc.target, f.casino.address, usd(101))).to.be.revertedWithCustomError(f.vault, "InsufficientFunds");
    for (let i = 0; i < 3; i++) await f.vault.requestTokenWithdrawal(f.usdc.target, f.casino.address, usd(1));
    await expect(f.vault.requestTokenWithdrawal(f.usdc.target, f.casino.address, usd(1))).to.be.revertedWithCustomError(f.vault, "TooManyPending");
  });

  it("the guardian releases a requested withdrawal now, and can't do anything else", async () => {
    const f = await withVault();
    const { id } = await ev(f.vault.requestTokenWithdrawal(f.usdc.target, f.bank.address, usd(300)), f.vault, "TokenWithdrawalQueued");
    await expect(f.vault.connect(f.thief).guardianReleaseToken(f.owner.address, f.usdc.target, id)).to.be.revertedWithCustomError(f.vault, "NotGuardian");
    await expect(f.vault.connect(f.guardian).guardianReleaseToken(f.owner.address, f.usdc.target, id)).to.changeTokenBalance(f.usdc, f.bank, usd(300));
    await expect(f.vault.connect(f.guardian).requestTokenWithdrawal(f.usdc.target, f.guardian.address, 1)).to.be.revertedWithCustomError(f.vault, "NotFound");
  });

  it("instant sends go only to the vault's trusted addresses, and stop while locked", async () => {
    const f = await loadFixture(deploy);
    const until = (await time.latest()) + 30 * DAY;
    await f.vault.createVault(Locked, f.guardian.address, until);
    await f.vault.depositToken(f.usdc.target, usd(100));
    await expect(f.vault.sendTokenToTrusted(f.usdc.target, f.bank.address, usd(1))).to.be.revertedWithCustomError(f.vault, "NotTrusted");
    const { id } = await ev(f.vault.proposeChange({ kind: K.AddTrusted, value: 0, addr: f.bank.address }), f.vault, "ChangeQueued");
    await f.vault.connect(f.guardian).guardianApproveChange(f.owner.address, id);
    await expect(f.vault.sendTokenToTrusted(f.usdc.target, f.bank.address, usd(1))).to.be.revertedWithCustomError(f.vault, "Locked");
    await time.increaseTo(until);
    await expect(f.vault.sendTokenToTrusted(f.usdc.target, f.bank.address, usd(40))).to.emit(f.vault, "TokenSent").withArgs(f.owner.address, f.usdc.target, f.bank.address, usd(40));
    expect(await f.usdc.balanceOf(f.bank.address)).to.equal(usd(40));
  });

  it("a lock added after a request still holds it back", async () => {
    const f = await withVault();
    const { id, readyAt } = await ev(f.vault.requestTokenWithdrawal(f.usdc.target, f.casino.address, usd(5)), f.vault, "TokenWithdrawalQueued");
    await f.vault.proposeChange({ kind: 3, value: (await time.latest()) + 10 * DAY, addr: ZERO });
    await time.increaseTo(readyAt);
    await expect(f.vault.executeTokenWithdrawal(f.owner.address, f.usdc.target, id)).to.be.revertedWithCustomError(f.vault, "Locked");
  });

  it("each token has its own daily limit: lowering applies at once, raising waits", async () => {
    const f = await withVault();
    const { id: tid } = await ev(f.vault.proposeChange({ kind: K.AddTrusted, value: 0, addr: f.bank.address }), f.vault, "ChangeQueued");
    await f.vault.connect(f.guardian).guardianApproveChange(f.owner.address, tid);
    await expect(f.vault.proposeTokenLimit(f.usdc.target, usd(50))).to.emit(f.vault, "TokenLimitApplied");
    await f.vault.sendTokenToTrusted(f.usdc.target, f.bank.address, usd(30));
    await expect(f.vault.sendTokenToTrusted(f.usdc.target, f.bank.address, usd(21))).to.be.revertedWithCustomError(f.vault, "DailyLimit");
    const { id, readyAt } = await ev(f.vault.proposeTokenLimit(f.usdc.target, usd(500)), f.vault, "TokenLimitQueued");
    expect(readyAt - BigInt(await time.latest())).to.equal(7n * BigInt(DAY));
    await expect(f.vault.applyTokenChange(f.owner.address, f.usdc.target, id)).to.be.revertedWithCustomError(f.vault, "TooEarly");
    await time.increaseTo(readyAt);
    await f.vault.connect(f.thief).applyTokenChange(f.owner.address, f.usdc.target, id);
    expect((await tv(f)).dailyLimit).to.equal(usd(500));
    // The ETH limit is untouched.
    expect((await f.vault.getVault(f.owner.address)).dailyLimit).to.equal(0);
  });

  it("vaults and tokens are kept apart", async () => {
    const f = await withVault();
    await f.vault.connect(f.other).createVault(Gentle, ZERO, 0);
    await f.vault.connect(f.other).depositToken(f.usdc.target, usd(10));
    const dai = await f.T.deploy("DAI", 0);
    await dai.mint(f.owner.address, usd(5)); await dai.approve(f.vault.target, usd(5));
    await f.vault.depositToken(dai.target, usd(5));
    await expect(f.vault.connect(f.other).requestTokenWithdrawal(f.usdc.target, f.thief.address, usd(11))).to.be.revertedWithCustomError(f.vault, "InsufficientFunds");
    await expect(f.vault.requestTokenWithdrawal(dai.target, f.thief.address, usd(6))).to.be.revertedWithCustomError(f.vault, "InsufficientFunds");
    expect((await tv(f)).balance).to.equal(usd(500));
    expect((await f.vault.getTokenVault(f.owner.address, dai.target)).balance).to.equal(usd(5));
  });

  it("works with a token that returns nothing (like USDT)", async () => {
    const f = await withVault();
    const usdt = await (await ethers.getContractFactory("NoReturnToken")).deploy();
    await usdt.mint(f.owner.address, usd(100)); await usdt.approve(f.vault.target, usd(100));
    await f.vault.depositToken(usdt.target, usd(100));
    const { id } = await ev(f.vault.requestTokenWithdrawal(usdt.target, f.bank.address, usd(60)), f.vault, "TokenWithdrawalQueued");
    await f.vault.connect(f.guardian).guardianReleaseToken(f.owner.address, usdt.target, id);
    expect(await usdt.balanceOf(f.bank.address)).to.equal(usd(60));
  });

  it("counts only what arrives from a token that takes a fee", async () => {
    const f = await withVault();
    const fee = await f.T.deploy("FEE", 100); // 1%
    await fee.mint(f.owner.address, usd(100)); await fee.approve(f.vault.target, usd(100));
    await expect(f.vault.depositToken(fee.target, usd(100))).to.emit(f.vault, "TokenDeposited").withArgs(f.owner.address, fee.target, usd(99));
    expect(await f.vault.availableToken(f.owner.address, fee.target)).to.equal(usd(99));
  });

  it("refuses a token transfer that reports failure", async () => {
    const f = await withVault();
    const { id } = await ev(f.vault.requestTokenWithdrawal(f.usdc.target, f.bank.address, usd(10)), f.vault, "TokenWithdrawalQueued");
    await f.usdc.setFails(true);
    await expect(f.vault.connect(f.guardian).guardianReleaseToken(f.owner.address, f.usdc.target, id)).to.be.revertedWithCustomError(f.vault, "TransferFailed");
    await expect(f.vault.depositToken(f.usdc.target, usd(1))).to.be.revertedWithCustomError(f.vault, "TransferFailed");
    await f.usdc.setFails(false);
    expect((await tv(f)).withdrawals).to.have.length(1);
    expect((await tv(f)).balance).to.equal(usd(500));
  });
});
