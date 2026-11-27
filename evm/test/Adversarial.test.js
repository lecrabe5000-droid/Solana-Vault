// Adversarial tests, grouped by attacker. Each case is a way someone would try to get money out of a Safe sooner,
// somewhere else, or at all, and what stops them. (Random sequences live in Stress.test.js; hostile tokens there too.)
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const HOUR = 3600, DAY = 86400;
const Gentle = 0, Strong = 1, Locked = 2, LockedNoExit = 3;
const K = { SetWithdrawDelay: 0, SetRuleDelay: 1, SetDailyLimit: 2, SetLockedUntil: 3, SetGuardian: 4, AddTrusted: 5, RemoveTrusted: 6, SetTrustedWaits: 7, SetNoExit: 8 };
const ZERO = ethers.ZeroAddress;
const eth = (n) => ethers.parseEther(String(n));
const ch = (kind, value = 0, addr = ZERO) => ({ kind, value, addr });

async function deploy() {
  const [owner, guardian, bank, casino, thief, other] = await ethers.getSigners();
  const vault = await (await ethers.getContractFactory("EcrinVault")).deploy(ZERO, ZERO, ZERO);
  const usdc = await (await ethers.getContractFactory("TestToken")).deploy("USDC", 0);
  for (const s of [owner, other]) { await usdc.mint(s.address, 10n ** 12n); await usdc.connect(s).approve(vault.target, ethers.MaxUint256); }
  return { vault, usdc, owner, guardian, bank, casino, thief, other };
}
const ev = async (tx, vault, name) => {
  const r = await (await tx).wait();
  return r.logs.map((l) => { try { return vault.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === name)?.args;
};
const err = (vault, name) => [vault, name];

describe("Adversarial", () => {
  describe("someone who stole the owner's key", () => {
    it("can't make any way out faster: every loosening waits for the rule delay", async () => {
      const { vault, owner, guardian, thief, casino } = await loadFixture(deploy);
      await vault.createVault(Strong, guardian.address, 0, { value: eth(10) });
      await vault.proposeChange(ch(K.SetDailyLimit, eth(1)));
      await vault.proposeChange(ch(K.SetTrustedWaits, 1));
      await vault.proposeChange(ch(K.SetNoExit, 1));
      // the "thief" here signs with the owner's key, so they are msg.sender == owner
      for (const c of [ch(K.SetWithdrawDelay, HOUR), ch(K.SetRuleDelay, HOUR), ch(K.SetDailyLimit, 0), ch(K.SetGuardian, 0, thief.address),
        ch(K.SetGuardian, 0, ZERO), ch(K.AddTrusted, 0, casino.address), ch(K.SetTrustedWaits, 0), ch(K.SetNoExit, 0)]) {
        const q = await ev(vault.proposeChange(c), vault, "ChangeQueued");
        expect(q, `kind ${c.kind} applied at once`).to.not.equal(undefined);
        expect(q.readyAt - BigInt(await time.latest())).to.equal(7n * BigInt(DAY));
        await vault.cancelChange(q.id); // four slots: free it for the next attempt
      }
      const v = await vault.getVault(owner.address);
      expect([v.withdrawDelay, v.ruleDelay, v.dailyLimit, v.guardian]).to.deep.equal([72n * BigInt(HOUR), 7n * BigInt(DAY), eth(1), guardian.address]);
      expect(v.trusted).to.have.length(0);
    });

    it("can't use the four change slots to block the real owner from tightening", async () => {
      const { vault, casino } = await loadFixture(deploy);
      await vault.createVault(Gentle, ZERO, 0, { value: eth(10) });
      for (let i = 0; i < 4; i++) await vault.proposeChange(ch(K.SetWithdrawDelay, HOUR + i));
      await expect(vault.proposeChange(ch(K.AddTrusted, 0, casino.address))).to.be.revertedWithCustomError(vault, "TooManyPending");
      // stricter changes never need a slot: a freeze still goes through at once
      await expect(vault.proposeChange(ch(K.SetLockedUntil, (await time.latest()) + DAY))).to.emit(vault, "ChangeApplied");
    });

    it("can't swap the destination of a withdrawal that is already due: a new one starts a new delay", async () => {
      const { vault, owner, bank, casino } = await loadFixture(deploy);
      await vault.createVault(Strong, ZERO, 0, { value: eth(10) });
      const a = await ev(vault.requestWithdrawal(bank.address, eth(4)), vault, "WithdrawalQueued");
      await time.increaseTo(a.readyAt);
      await vault.cancelWithdrawal(a.id);
      const b = await ev(vault.requestWithdrawal(casino.address, eth(4)), vault, "WithdrawalQueued");
      expect(b.readyAt - BigInt(await time.latest())).to.equal(72n * BigInt(HOUR));
      await expect(vault.executeWithdrawal(owner.address, b.id)).to.be.revertedWithCustomError(vault, "TooEarly");
      await expect(vault.executeWithdrawal(owner.address, a.id)).to.be.revertedWithCustomError(vault, "NotFound");
    });

    it("can't leave a single second early, and a lock ending is exact too", async () => {
      const { vault, owner, bank } = await loadFixture(deploy);
      const until = (await time.latest()) + 10 * DAY;
      await vault.createVault(Locked, (await ethers.getSigners())[1].address, until, { value: eth(10) });
      const w = await ev(vault.requestWithdrawal(bank.address, eth(1)), vault, "WithdrawalQueued");
      expect(w.readyAt).to.equal(BigInt(until));
      await time.setNextBlockTimestamp(until - 1);
      await expect(vault.executeWithdrawal(owner.address, w.id)).to.be.revertedWithCustomError(vault, "TooEarly");
      await time.setNextBlockTimestamp(until);
      await expect(vault.executeWithdrawal(owner.address, w.id)).to.changeEtherBalance(bank, eth(1));
    });

    it("can't spread a big withdrawal over many queued ones to beat the daily limit", async () => {
      const { vault, owner, casino } = await loadFixture(deploy);
      await vault.createVault(Gentle, ZERO, 0, { value: eth(10) });
      await vault.proposeChange(ch(K.SetDailyLimit, eth(1)));
      const ids = [];
      for (let i = 0; i < 4; i++) ids.push((await ev(vault.requestWithdrawal(casino.address, eth(1)), vault, "WithdrawalQueued")).id);
      await time.increase(DAY + 1);
      await vault.executeWithdrawal(owner.address, ids[0]);
      for (const id of ids.slice(1)) await expect(vault.executeWithdrawal(owner.address, id)).to.be.revertedWithCustomError(vault, "DailyLimit");
    });

    it("can't use staking as a way out when staking is off on the network", async () => {
      const { vault } = await loadFixture(deploy);
      await vault.createVault(Gentle, ZERO, 0, { value: eth(1) });
      await expect(vault.stakeEth(eth(1))).to.be.revertedWithCustomError(vault, "StakingOff");
    });
  });

  describe("a guardian gone bad", () => {
    it("can't start, redirect, cancel or rush anything but what the owner asked for", async () => {
      const { vault, owner, guardian, bank, casino } = await loadFixture(deploy);
      await vault.createVault(Strong, guardian.address, 0, { value: eth(10) });
      const w = await ev(vault.requestWithdrawal(bank.address, eth(2)), vault, "WithdrawalQueued");
      const g = vault.connect(guardian);
      await expect(g.requestWithdrawal(casino.address, eth(1))).to.be.revertedWithCustomError(vault, "NotFound"); // the guardian has no Safe of their own
      await expect(g.cancelWithdrawal(w.id)).to.be.revertedWithCustomError(vault, "NotFound");
      await expect(g.proposeChange(ch(K.SetWithdrawDelay, HOUR))).to.be.revertedWithCustomError(vault, "NotFound");
      const q = await ev(vault.proposeChange(ch(K.SetWithdrawDelay, HOUR)), vault, "ChangeQueued");
      await expect(g.guardianApproveChange(owner.address, q.id)).to.be.revertedWithCustomError(vault, "TooEarly");
      // the release goes exactly where the owner chose, for exactly the amount
      await expect(g.guardianRelease(owner.address, w.id)).to.changeEtherBalances([bank, casino], [eth(2), 0]);
      await expect(g.guardianRelease(owner.address, w.id)).to.be.revertedWithCustomError(vault, "NotFound");
    });

    it("can't release a withdrawal from another owner's Safe, or the ETH one through a token", async () => {
      const { vault, usdc, owner, guardian, other, bank } = await loadFixture(deploy);
      await vault.createVault(Strong, guardian.address, 0, { value: eth(5) });
      await vault.connect(other).createVault(Strong, ZERO, 0, { value: eth(5) });
      const mine = await ev(vault.connect(other).requestWithdrawal(bank.address, eth(1)), vault, "WithdrawalQueued");
      await expect(vault.connect(guardian).guardianRelease(other.address, mine.id)).to.be.revertedWithCustomError(vault, "NoGuardian");
      const w = await ev(vault.requestWithdrawal(bank.address, eth(1)), vault, "WithdrawalQueued");
      await expect(vault.connect(guardian).guardianReleaseToken(owner.address, usdc.target, w.id)).to.be.revertedWithCustomError(vault, "NotFound");
    });

    it("can't release anything once the owner chose no emergency exit, ETH or tokens", async () => {
      const { vault, usdc, owner, guardian, bank } = await loadFixture(deploy);
      await vault.createVault(Strong, guardian.address, 0, { value: eth(5) });
      await vault.depositToken(usdc.target, 1000n);
      const a = await ev(vault.requestWithdrawal(bank.address, eth(1)), vault, "WithdrawalQueued");
      const b = await ev(vault.requestTokenWithdrawal(usdc.target, bank.address, 10n), vault, "TokenWithdrawalQueued");
      await vault.proposeChange(ch(K.SetNoExit, 1));
      await expect(vault.connect(guardian).guardianRelease(owner.address, a.id)).to.be.revertedWithCustomError(vault, "NoExit");
      await expect(vault.connect(guardian).guardianReleaseToken(owner.address, usdc.target, b.id)).to.be.revertedWithCustomError(vault, "NoExit");
    });
  });

  describe("a stranger", () => {
    it("can run a due withdrawal but only to the owner's destination, and can't touch anything else", async () => {
      const { vault, owner, thief, bank } = await loadFixture(deploy);
      await vault.createVault(Strong, ZERO, 0, { value: eth(5) });
      const w = await ev(vault.requestWithdrawal(bank.address, eth(1)), vault, "WithdrawalQueued");
      const q = await ev(vault.proposeChange(ch(K.SetWithdrawDelay, HOUR)), vault, "ChangeQueued");
      const s = vault.connect(thief);
      await expect(s.guardianRelease(owner.address, w.id)).to.be.revertedWithCustomError(vault, "NoGuardian");
      await expect(s.applyChange(owner.address, q.id)).to.be.revertedWithCustomError(vault, "TooEarly");
      await time.increaseTo(w.readyAt);
      await expect(s.executeWithdrawal(owner.address, w.id)).to.changeEtherBalances([bank, thief], [eth(1), 0]);
    });

    it("can't strand coins by sending them straight to the contract, or make it pay itself", async () => {
      const { vault, thief, owner } = await loadFixture(deploy);
      await expect(thief.sendTransaction({ to: vault.target, value: 1n })).to.be.revertedWithCustomError(vault, "InvalidValue");
      await vault.createVault(Gentle, ZERO, 0, { value: eth(1) });
      await expect(vault.requestWithdrawal(vault.target, 1n)).to.be.revertedWithCustomError(vault, "InvalidValue");
      await expect(vault.proposeChange(ch(K.AddTrusted, 0, vault.target))).to.be.revertedWithCustomError(vault, "InvalidValue");
      expect((await vault.getVault(owner.address)).balance).to.equal(eth(1));
    });

    it("can't take ETH from one Safe through another's books: the contract always holds what the Safes add up to", async () => {
      const { vault, owner, other, bank, casino } = await loadFixture(deploy);
      await vault.createVault(Gentle, ZERO, 0, { value: eth(3) });
      await vault.connect(other).createVault(Gentle, ZERO, 0, { value: eth(4) });
      const a = await ev(vault.requestWithdrawal(bank.address, eth(2)), vault, "WithdrawalQueued");
      const b = await ev(vault.connect(other).requestWithdrawal(casino.address, eth(1)), vault, "WithdrawalQueued");
      await time.increase(DAY);
      await vault.executeWithdrawal(owner.address, a.id);
      // ids are per Safe: the same number on the other Safe runs that Safe's own withdrawal, to its own destination
      await expect(vault.executeWithdrawal(other.address, b.id)).to.changeEtherBalance(casino, eth(1));
      const sum = (await vault.getVault(owner.address)).balance + (await vault.getVault(other.address)).balance;
      expect(await ethers.provider.getBalance(vault.target)).to.equal(sum);
    });
  });
});
