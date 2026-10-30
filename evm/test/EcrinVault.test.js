// Mirrors crates/vault-core/tests/rules.rs, plus the Ethereum-only cases (reentrancy, refused transfers).
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const HOUR = 3600, DAY = 86400;
const Gentle = 0, Strong = 1, Locked = 2;
const K = { SetWithdrawDelay: 0, SetRuleDelay: 1, SetDailyLimit: 2, SetLockedUntil: 3, SetGuardian: 4, AddTrusted: 5, RemoveTrusted: 6 };
const ZERO = ethers.ZeroAddress;
const eth = (n) => ethers.parseEther(String(n));
const ch = (kind, value = 0, addr = ZERO) => ({ kind, value, addr });

async function deploy() {
  const [owner, guardian, bank, casino, thief] = await ethers.getSigners();
  const vault = await (await ethers.getContractFactory("EcrinVault")).deploy();
  return { vault, owner, guardian, bank, casino, thief };
}
const idOf = async (tx, vault, event) => {
  const r = await (await tx).wait();
  return r.logs.map((l) => { try { return vault.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === event)?.args;
};
const withdrawals = async (vault, who) => (await vault.getVault(who)).withdrawals;

describe("EcrinVault", () => {
  it("withdrawal waits for the delay, then anyone can run it", async () => {
    const { vault, owner, casino, thief } = await loadFixture(deploy);
    await vault.createVault(Strong, ZERO, 0, { value: eth(10) });
    const { id, readyAt } = await idOf(vault.requestWithdrawal(casino.address, eth(4)), vault, "WithdrawalQueued");
    expect(readyAt - BigInt(await time.latest())).to.equal(72n * BigInt(HOUR));
    await expect(vault.connect(thief).executeWithdrawal(owner.address, id)).to.be.revertedWithCustomError(vault, "TooEarly");
    await time.increaseTo(readyAt);
    await expect(vault.connect(thief).executeWithdrawal(owner.address, id)).to.changeEtherBalance(casino, eth(4));
    expect((await vault.getVault(owner.address)).balance).to.equal(eth(6));
  });

  it("owner can cancel and the money stays", async () => {
    const { vault, owner, casino } = await loadFixture(deploy);
    await vault.createVault(Gentle, ZERO, 0, { value: eth(10) });
    const { id } = await idOf(vault.requestWithdrawal(casino.address, eth(9)), vault, "WithdrawalQueued");
    await vault.cancelWithdrawal(id);
    expect(await withdrawals(vault, owner.address)).to.have.length(0);
    expect(await vault.available(owner.address)).to.equal(eth(10));
    await time.increase(2 * DAY);
    await expect(vault.executeWithdrawal(owner.address, id)).to.be.revertedWithCustomError(vault, "NotFound");
  });

  it("queued withdrawals cannot promise more than the balance", async () => {
    const { vault, casino } = await loadFixture(deploy);
    await vault.createVault(Gentle, ZERO, 0, { value: eth(10) });
    await vault.requestWithdrawal(casino.address, eth(7));
    await expect(vault.requestWithdrawal(casino.address, eth(4))).to.be.revertedWithCustomError(vault, "InsufficientFunds");
  });

  it("a trusted address must wait before it is trusted", async () => {
    const { vault, owner, bank } = await loadFixture(deploy);
    await vault.createVault(Gentle, ZERO, 0, { value: eth(10) });
    const { id, readyAt } = await idOf(vault.proposeChange(ch(K.AddTrusted, 0, bank.address)), vault, "ChangeQueued");
    await expect(vault.sendToTrusted(bank.address, eth(1))).to.be.revertedWithCustomError(vault, "NotTrusted");
    await expect(vault.applyChange(owner.address, id)).to.be.revertedWithCustomError(vault, "TooEarly");
    await time.increaseTo(readyAt);
    await vault.applyChange(owner.address, id);
    await expect(vault.sendToTrusted(bank.address, eth(1))).to.changeEtherBalance(bank, eth(1));
  });

  it("guardian can approve a trusted address early, nothing else", async () => {
    const { vault, owner, guardian, bank } = await loadFixture(deploy);
    await vault.createVault(Strong, guardian.address, 0, { value: eth(10) });
    const { id } = await idOf(vault.proposeChange(ch(K.AddTrusted, 0, bank.address)), vault, "ChangeQueued");
    await vault.connect(guardian).guardianApproveChange(owner.address, id);
    expect((await vault.getVault(owner.address)).trusted).to.deep.equal([bank.address]);
    const loosen = await idOf(vault.proposeChange(ch(K.SetWithdrawDelay, HOUR)), vault, "ChangeQueued");
    await expect(vault.connect(guardian).guardianApproveChange(owner.address, loosen.id)).to.be.revertedWithCustomError(vault, "TooEarly");
  });

  it("stricter changes apply at once, looser ones and any guardian change wait", async () => {
    const { vault, owner, guardian } = await loadFixture(deploy);
    await vault.createVault(Gentle, ZERO, 0);
    await expect(vault.proposeChange(ch(K.SetWithdrawDelay, 72 * HOUR))).to.emit(vault, "ChangeApplied");
    await expect(vault.proposeChange(ch(K.SetDailyLimit, eth(2)))).to.emit(vault, "ChangeApplied");
    await expect(vault.proposeChange(ch(K.SetGuardian, 0, guardian.address))).to.emit(vault, "ChangeQueued");
    expect((await vault.getVault(owner.address)).withdrawDelay).to.equal(72n * BigInt(HOUR));
    await expect(vault.proposeChange(ch(K.SetWithdrawDelay, 24 * HOUR))).to.emit(vault, "ChangeQueued");
    await expect(vault.proposeChange(ch(K.SetDailyLimit, 0))).to.emit(vault, "ChangeQueued");
  });

  it("a lock blocks everything until its date", async () => {
    const { vault, owner, guardian, bank, casino } = await loadFixture(deploy);
    const until = (await time.latest()) + 30 * DAY;
    await vault.createVault(Locked, guardian.address, until, { value: eth(10) });
    const add = await idOf(vault.proposeChange(ch(K.AddTrusted, 0, bank.address)), vault, "ChangeQueued");
    expect(add.readyAt).to.equal(BigInt(until));
    await vault.connect(guardian).guardianApproveChange(owner.address, add.id);
    await expect(vault.sendToTrusted(bank.address, eth(1))).to.be.revertedWithCustomError(vault, "Locked");
    const w = await idOf(vault.requestWithdrawal(casino.address, eth(1)), vault, "WithdrawalQueued");
    expect(w.readyAt).to.equal(BigInt(until));
    const end = await idOf(vault.proposeChange(ch(K.SetLockedUntil, 0)), vault, "ChangeQueued");
    expect(end.readyAt).to.equal(BigInt(until));
  });

  it("guardian emergency release only for what the owner requested", async () => {
    const { vault, owner, guardian, bank, casino } = await loadFixture(deploy);
    await vault.createVault(Locked, guardian.address, (await time.latest()) + 30 * DAY, { value: eth(10) });
    const { id } = await idOf(vault.requestWithdrawal(bank.address, eth(3)), vault, "WithdrawalQueued");
    await expect(vault.connect(casino).guardianRelease(owner.address, id)).to.be.revertedWithCustomError(vault, "NotGuardian");
    await expect(vault.connect(guardian).guardianRelease(owner.address, id)).to.changeEtherBalance(bank, eth(3));
    expect((await vault.getVault(owner.address)).balance).to.equal(eth(7));
    await expect(vault.connect(guardian).guardianRelease(owner.address, 999)).to.be.revertedWithCustomError(vault, "NotFound");
  });

  it("the daily limit counts every outgoing transfer and resets the next UTC day", async () => {
    const { vault, owner, guardian, bank } = await loadFixture(deploy);
    await vault.createVault(Strong, guardian.address, 0, { value: eth(10) });
    await vault.proposeChange(ch(K.SetDailyLimit, eth(2.5)));
    const { id } = await idOf(vault.proposeChange(ch(K.AddTrusted, 0, bank.address)), vault, "ChangeQueued");
    await vault.connect(guardian).guardianApproveChange(owner.address, id);
    const dayStart = Math.ceil(((await time.latest()) + 1) / DAY) * DAY;
    await time.increaseTo(dayStart + HOUR);
    await vault.sendToTrusted(bank.address, eth(2));
    await expect(vault.sendToTrusted(bank.address, eth(1))).to.be.revertedWithCustomError(vault, "DailyLimit");
    await time.increaseTo(dayStart + DAY + HOUR);
    await vault.sendToTrusted(bank.address, eth(1));
  });

  it("only the owner can move or change their vault", async () => {
    const { vault, owner, thief, casino } = await loadFixture(deploy);
    await vault.createVault(Gentle, ZERO, 0, { value: eth(10) });
    const { id } = await idOf(vault.requestWithdrawal(casino.address, eth(1)), vault, "WithdrawalQueued");
    // Another account acts on its own (non-existent) vault, never on the owner's.
    await expect(vault.connect(thief).requestWithdrawal(thief.address, eth(1))).to.be.revertedWithCustomError(vault, "NotFound");
    await expect(vault.connect(thief).cancelWithdrawal(id)).to.be.revertedWithCustomError(vault, "NotFound");
    await expect(vault.connect(thief).proposeChange(ch(K.SetWithdrawDelay, HOUR))).to.be.revertedWithCustomError(vault, "NotFound");
    expect(await withdrawals(vault, owner.address)).to.have.length(1);
  });

  it("nonsense rules are refused", async () => {
    const { vault, owner, guardian } = await loadFixture(deploy);
    await expect(vault.createVault(Gentle, guardian.address, 0)).to.be.revertedWithCustomError(vault, "InvalidValue");
    await expect(vault.createVault(Strong, owner.address, 0)).to.be.revertedWithCustomError(vault, "InvalidValue");
    await expect(vault.createVault(Locked, guardian.address, 1)).to.be.revertedWithCustomError(vault, "InvalidValue");
    await expect(vault.createVault(Locked, ZERO, (await time.latest()) + DAY)).to.be.revertedWithCustomError(vault, "InvalidValue");
    await vault.createVault(Gentle, ZERO, 0);
    await expect(vault.createVault(Gentle, ZERO, 0)).to.be.revertedWithCustomError(vault, "VaultExists");
    await expect(vault.proposeChange(ch(K.SetGuardian, 0, owner.address))).to.be.revertedWithCustomError(vault, "InvalidValue");
    await expect(vault.proposeChange(ch(K.SetWithdrawDelay, 60))).to.be.revertedWithCustomError(vault, "InvalidValue");
    await expect(vault.proposeChange(ch(K.SetRuleDelay, 400 * DAY))).to.be.revertedWithCustomError(vault, "InvalidValue");
  });

  it("a lock added later still holds back a queued withdrawal", async () => {
    const { vault, owner, casino } = await loadFixture(deploy);
    await vault.createVault(Gentle, ZERO, 0, { value: eth(10) });
    const { id, readyAt } = await idOf(vault.requestWithdrawal(casino.address, eth(1)), vault, "WithdrawalQueued");
    const until = (await time.latest()) + 10 * DAY;
    await expect(vault.proposeChange(ch(K.SetLockedUntil, until))).to.emit(vault, "ChangeApplied");
    await time.increaseTo(readyAt);
    await expect(vault.executeWithdrawal(owner.address, id)).to.be.revertedWithCustomError(vault, "Locked");
    await time.increaseTo(until);
    await expect(vault.executeWithdrawal(owner.address, id)).to.changeEtherBalance(casino, eth(1));
  });

  it("a stolen key cannot name its own guardian and rush a withdrawal", async () => {
    const { vault, owner, thief } = await loadFixture(deploy);
    await vault.createVault(Gentle, ZERO, 0, { value: eth(10) });
    await expect(vault.proposeChange(ch(K.SetGuardian, 0, thief.address))).to.emit(vault, "ChangeQueued");
    const { id } = await idOf(vault.requestWithdrawal(thief.address, eth(10)), vault, "WithdrawalQueued");
    await expect(vault.connect(thief).guardianRelease(owner.address, id)).to.be.revertedWithCustomError(vault, "NoGuardian");
    expect((await vault.getVault(owner.address)).balance).to.equal(eth(10));
  });

  it("a stolen key can freeze but never loosen", async () => {
    const { vault, owner, guardian, bank } = await loadFixture(deploy);
    await vault.createVault(Strong, guardian.address, 0, { value: eth(10) });
    const { id } = await idOf(vault.proposeChange(ch(K.AddTrusted, 0, bank.address)), vault, "ChangeQueued");
    await vault.connect(guardian).guardianApproveChange(owner.address, id);
    // Stricter: instant.
    await expect(vault.proposeChange(ch(K.RemoveTrusted, 0, bank.address))).to.emit(vault, "ChangeApplied");
    // Looser: waits.
    await expect(vault.proposeChange(ch(K.SetWithdrawDelay, HOUR))).to.emit(vault, "ChangeQueued");
    await expect(vault.proposeChange(ch(K.SetGuardian, 0, ZERO))).to.emit(vault, "ChangeQueued");
  });

  it("refuses plain ETH transfers and a destination that refuses ETH keeps the withdrawal queued", async () => {
    const { vault, owner } = await loadFixture(deploy);
    await expect(owner.sendTransaction({ to: await vault.getAddress(), value: eth(1) })).to.be.revertedWithCustomError(vault, "InvalidValue");
    const refuser = await (await ethers.getContractFactory("Refuser")).deploy();
    await vault.createVault(Gentle, ZERO, 0, { value: eth(10) });
    const { id, readyAt } = await idOf(vault.requestWithdrawal(await refuser.getAddress(), eth(1)), vault, "WithdrawalQueued");
    await time.increaseTo(readyAt);
    await expect(vault.executeWithdrawal(owner.address, id)).to.be.revertedWithCustomError(vault, "TransferFailed");
    expect(await withdrawals(vault, owner.address)).to.have.length(1);
    expect((await vault.getVault(owner.address)).balance).to.equal(eth(10));
  });

  it("cannot be re-entered while paying out", async () => {
    const { vault } = await loadFixture(deploy);
    const r = await (await ethers.getContractFactory("Reenterer")).deploy(await vault.getAddress(), { value: eth(1) });
    await r.setup();
    const ev = (await vault.queryFilter(vault.filters.ChangeQueued(await r.getAddress())))[0];
    await time.increaseTo(ev.args.readyAt);
    await r.applyTrust(ev.args.id);
    await expect(r.sendToSelf(eth(0.5))).to.be.revertedWithCustomError(vault, "TransferFailed");
    expect((await vault.getVault(await r.getAddress())).balance).to.equal(eth(1));
  });
});
