// Runs the browser client (app/evm.js) against the contract on Hardhat's in-process chain, the way the app uses it.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const path = require("path");
const { pathToFileURL } = require("url");

describe("app/evm.js client", () => {
  let mod, vaultAddr, owner, guardian, bank, client, gclient;
  before(async () => {
    mod = await import(pathToFileURL(path.join(__dirname, "..", "..", "app", "evm.js")).href);
    [owner, guardian, bank] = await ethers.getSigners();
    vaultAddr = await (await (await ethers.getContractFactory("EcrinVault")).deploy()).getAddress();
    const EVM = { chainId: 31337, address: vaultAddr };
    client = mod.createEvmClient({ ethers, EVM, readProvider: ethers.provider, getSigner: async () => owner });
    gclient = mod.createEvmClient({ ethers, EVM, readProvider: ethers.provider, getSigner: async () => guardian });
  });

  it("reads nothing before a vault exists, then the same shape as the Solana client", async () => {
    expect(await client.fetchVault(owner.address)).to.equal(null);
    await client.ops.create({ kind: "strong", guardian: client.key(guardian.address) });
    await client.ops.deposit(2.5e9); // 2.5 ETH in gwei units
    const v = await client.fetchVault(client.key(owner.address));
    expect(v.balance).to.equal(2.5e9);
    expect(v.available).to.equal(2.5e9);
    expect(v.withdrawDelay).to.equal(72 * 3600);
    expect(v.guardian.equals(guardian.address)).to.equal(true);
    expect(v.dailyLimit).to.equal(null);
    expect(v.lockedUntil).to.equal(null);
    expect(v.owner.toBase58()).to.equal(owner.address);
  });

  it("queues, shows and cancels a withdrawal", async () => {
    const hash = await client.ops.requestWithdrawal(client.key(bank.address), 1e9);
    expect(hash).to.match(/^0x[0-9a-f]{64}$/);
    let v = await client.fetchVault(owner.address);
    expect(v.withdrawals).to.have.length(1);
    expect(v.withdrawals[0].amount).to.equal(1e9);
    expect(v.withdrawals[0].dest.equals(bank.address)).to.equal(true);
    expect(v.available).to.equal(1.5e9);
    await client.ops.cancelWithdrawal(v.withdrawals[0].id);
    v = await client.fetchVault(owner.address);
    expect(v.withdrawals).to.have.length(0);
  });

  it("encodes and decodes every kind of rule change", async () => {
    await client.ops.proposeChange({ kind: "SetDailyLimit", value: 0.5e9 });
    await client.ops.proposeChange({ kind: "AddTrusted", value: client.key(bank.address) });
    await client.ops.proposeChange({ kind: "SetWithdrawDelay", value: 3600 });
    const until = (await time.latest()) + 30 * 86400;
    await client.ops.proposeChange({ kind: "SetLockedUntil", value: until });
    let v = await client.fetchVault(owner.address);
    expect(v.dailyLimit).to.equal(0.5e9);
    expect(v.lockedUntil).to.equal(until);
    expect(v.changes.map((c) => c.change.kind)).to.deep.equal(["AddTrusted", "SetWithdrawDelay"]);
    expect(v.changes[0].change.value.equals(bank.address)).to.equal(true);
    expect(v.changes[1].change.value).to.equal(3600);
    await gclient.ops.guardianApproveChange(owner.address, v.changes[0].id);
    v = await client.fetchVault(owner.address);
    expect(v.trusted.map(String)).to.deep.equal([bank.address]);
    await client.ops.proposeChange({ kind: "SetGuardian", value: null });
    expect((await client.fetchVault(owner.address)).changes.at(-1).change).to.deep.equal({ kind: "SetGuardian", value: null });
  });

  it("explains contract errors in plain words", async () => {
    try { await client.ops.requestWithdrawal(client.key(bank.address), 100e9); expect.fail("should revert"); }
    catch (e) { expect(mod.explainEvmError(e)).to.deep.equal({ code: "InsufficientFunds", message: "Not enough funds that aren't already queued." }); }
    try { await client.ops.create({ kind: "gentle" }); expect.fail("should revert"); }
    catch (e) { expect(mod.explainEvmError(e).code).to.equal("VaultExists"); }
  });
});

describe("app/evm.js token client", () => {
  let mod, owner, guardian, bank, client, gclient, usdc, tok, gtok;
  const USD = 1_000_000;
  before(async () => {
    mod = await import(pathToFileURL(path.join(__dirname, "..", "..", "app", "evm.js")).href);
    [owner, guardian, bank] = await ethers.getSigners();
    const vaultAddr = await (await (await ethers.getContractFactory("EcrinVault")).deploy()).getAddress();
    usdc = await (await ethers.getContractFactory("TestToken")).deploy("USDC", 0);
    await usdc.mint(owner.address, 500 * USD);
    const EVM = { chainId: 31337, address: vaultAddr };
    client = mod.createEvmClient({ ethers, EVM, readProvider: ethers.provider, getSigner: async () => owner });
    gclient = mod.createEvmClient({ ethers, EVM, readProvider: ethers.provider, getSigner: async () => guardian });
    tok = client.token(usdc.target); gtok = gclient.token(usdc.target);
  });

  it("approves and deposits, then reads the same shape as the Solana token client", async () => {
    expect(await tok.fetch(owner.address)).to.equal(null);
    await client.ops.create({ kind: "strong", guardian: client.key(guardian.address) });
    await tok.ops.deposit(200 * USD);
    const t = await tok.fetch(owner.address);
    expect(t.balance).to.equal(200 * USD);
    expect(t.available).to.equal(200 * USD);
    expect(t.dailyLimit).to.equal(null);
    expect(await tok.walletBalance(owner.address)).to.equal(300 * USD);
  });

  it("queues, releases through the guardian, and cancels", async () => {
    await tok.ops.requestWithdrawal(client.key(bank.address), 50 * USD);
    let t = await tok.fetch(owner.address);
    expect(t.withdrawals).to.have.length(1);
    await gtok.ops.guardianRelease(owner.address, t.withdrawals[0].id);
    expect(await tok.walletBalance(bank.address)).to.equal(50 * USD);
    await tok.ops.requestWithdrawal(client.key(bank.address), 1 * USD);
    t = await tok.fetch(owner.address);
    await tok.ops.cancelWithdrawal(t.withdrawals[0].id);
    t = await tok.fetch(owner.address);
    expect(t.withdrawals).to.have.length(0);
    expect(t.balance).to.equal(150 * USD);
  });

  it("limits: lowering applies, raising waits", async () => {
    await tok.ops.proposeLimit(10 * USD);
    expect((await tok.fetch(owner.address)).dailyLimit).to.equal(10 * USD);
    await tok.ops.proposeLimit(null);
    const t = await tok.fetch(owner.address);
    expect(t.changes).to.have.length(1);
    expect(t.changes[0].change).to.deep.equal({ kind: "SetDailyLimit", value: null });
    await time.increaseTo(t.changes[0].readyAt);
    await tok.ops.applyChange(owner.address, t.changes[0].id);
    expect((await tok.fetch(owner.address)).dailyLimit).to.equal(null);
  });
});
