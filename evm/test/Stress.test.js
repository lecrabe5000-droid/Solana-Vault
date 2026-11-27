// Stress test of EcrinVault: long random sequences by two owners, a guardian and a stranger, on ETH and three kinds
// of token (a normal one, one that returns nothing like USDT, one that takes a 1% fee on every transfer), with time
// jumping and the deposit brake switching on and off. After every step the security promises are checked:
//  1. Solvency: the contract holds at least what every Safe says it holds (exactly, for ETH).
//  2. Nothing is promised twice: waiting withdrawals never add up to more than a Safe's balance.
//  3. Money only leaves the way the rules allow: a withdrawal runs only once due and outside a lock, unless the
//     guardian in force releases it; an instant send only goes to an address trusted before; amounts and
//     destinations are exactly what the owner asked.
//  4. A loosening rule never applies at once; the guardian can only hurry a new trusted address.
//  5. While the brake is on, no deposit gets in; every way out keeps working.
// Deterministic (seeded), so a failure can be replayed. STRESS_STEPS / STRESS_SEEDS make it longer.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const HOUR = 3600n, DAY = 86400n;
const K = { SetWithdrawDelay: 0, SetRuleDelay: 1, SetDailyLimit: 2, SetLockedUntil: 3, SetGuardian: 4, AddTrusted: 5, RemoveTrusted: 6, SetTrustedWaits: 7, SetNoExit: 8 };
const ZERO = ethers.ZeroAddress;
// How often each action comes up (case numbers in run()): weighted toward rule changes, instant sends and payouts,
// where the rare combinations (an instant send during a lock, a guardian change) live.
const MIX = [].concat(...[[0, 3], [1, 8], [2, 14], [3, 7], [4, 6], [5, 5], [6, 7], [7, 7], [8, 18], [9, 12], [10, 4], [11, 4]].map(([c, w]) => Array(w).fill(c)));

function rng(seed) {
  let s = BigInt(seed) | 1n;
  const next = () => { s ^= (s << 13n) & 0xffffffffffffffffn; s ^= s >> 7n; s ^= (s << 17n) & 0xffffffffffffffffn; return s; };
  return { below: (n) => Number(next() % BigInt(Math.max(1, n))), pick(xs) { return xs[this.below(xs.length)]; }, chance(p) { return this.below(100) < p; } };
}

// Whether `c` may apply at once, written from the spec, independently of the contract.
function mayApplyNow(v, c) {
  const val = BigInt(c.value);
  switch (c.kind) {
    case K.SetWithdrawDelay: return val >= v.withdrawDelay;
    case K.SetRuleDelay: return val >= v.ruleDelay;
    case K.SetDailyLimit: return val === 0n ? v.dailyLimit === 0n : v.dailyLimit === 0n || val <= v.dailyLimit;
    case K.SetLockedUntil: return val === 0n ? v.lockedUntil === 0n : v.lockedUntil === 0n || val >= v.lockedUntil;
    case K.RemoveTrusted: return true;
    case K.SetTrustedWaits: return val === 1n || !v.trustedWaits;
    case K.SetNoExit: return val === 1n || !v.noExit;
    default: return false; // SetGuardian, AddTrusted
  }
}

async function run(seed, steps) {
  const r = rng(seed);
  const [owner1, owner2, guardian, stranger, ...places] = await ethers.getSigners();
  const dests = places.slice(0, 5).map((s) => s.address);
  const vault = await (await ethers.getContractFactory("EcrinVault")).deploy(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);
  const T = await ethers.getContractFactory("TestToken"), NR = await ethers.getContractFactory("NoReturnToken");
  const plain = await T.deploy("USDC", 0), feeTok = await T.deploy("FEE", 100), usdt = await NR.deploy();
  const tokens = [plain, feeTok, usdt];
  const owners = [owner1, owner2];
  for (const o of owners) for (const t of tokens) { await t.mint(o.address, 10n ** 15n); await t.connect(o).approve(vault.target, ethers.MaxUint256); }
  const hits = {};
  const hit = (k) => (hits[k] = (hits[k] || 0) + 1);
  const ok = async (p) => { try { const tx = await p; return await tx.wait(); } catch (_) { return null; } };
  const evs = (rcpt) => rcpt.logs.map((l) => { try { return vault.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
  const where = (step, what) => `seed ${seed}, step ${step}: ${what}`;
  const asset = () => (r.chance(55) ? null : r.pick(tokens));
  const state = async (o, t) => {
    const v = await vault.getVault(o.address).catch(() => null);
    if (!v) return null;
    if (!t) return { ...v, balance: v.balance, withdrawals: v.withdrawals, dailyLimit: v.dailyLimit };
    const tv = await vault.getTokenVault(o.address, t.target);
    return { ...v, balance: tv.balance, withdrawals: tv.withdrawals, dailyLimit: tv.dailyLimit, changes: tv.changes };
  };

  for (let step = 0; step < steps; step++) {
    await time.increase(r.pick([1, 60, 600, 3600, 6 * 3600, 86400, 4 * 86400]));
    const now = BigInt(await time.latest()) + 1n; // the next block's time
    const o = r.pick(owners), t = asset();
    const who0 = r.pick([o, o, o, guardian, stranger]);
    let who = who0;
    const before = await state(o, t), vBefore = before && { ...(await vault.getVault(o.address)).toObject(), ...(await vault.getStrict(o.address)).toObject() };
    const paused = await vault.depositsPaused();
    const locked = vBefore && vBefore.lockedUntil > now;
    const amt = BigInt(1 + r.below(3000)) * 10n ** 12n;

    switch (r.pick(MIX)) {
      case 0: { // open a Safe, maybe with ETH
        const preset = r.chance(20) ? 0 : 1 + r.below(3), g = preset === 0 || (preset === 3 && r.chance(30)) ? ZERO : guardian.address; // mostly with a guardian, to exercise releases
        const lock = preset >= 2 ? now + BigInt(r.below(20)) * DAY + DAY : 0n;
        const val = r.chance(50) ? amt : 0n;
        const rc = await ok(vault.connect(o).createVault(preset, g, lock, { value: val }));
        if (rc) { hit("open"); if (val > 0n) expect(paused, where(step, "a Safe opened with money while paused")).to.equal(false); }
        break;
      }
      case 1: { // deposit
        const rc = t ? await ok(vault.connect(o).depositToken(t.target, amt)) : await ok(vault.connect(o).deposit({ value: amt }));
        if (rc) { hit("deposit"); expect(paused, where(step, "a deposit got in while paused")).to.equal(false); }
        break;
      }
      case 2: { // instant send: mostly to an address that is trusted, so the deeper checks (lock, limits) are reached
        const d = vBefore?.trusted.length && r.chance(80) ? r.pick(vBefore.trusted) : r.pick(dests);
        const rc = t ? await ok(vault.connect(who).sendTokenToTrusted(t.target, d, amt)) : await ok(vault.connect(who).sendToTrusted(d, amt));
        if (rc) {
          hit("instant");
          expect(who.address, where(step, "instant send by a non-owner")).to.equal(o.address);
          expect(vBefore.trusted, where(step, "instant send to an untrusted address")).to.include(d);
          expect(locked, where(step, "instant send while locked")).to.equal(false);
          expect(vBefore.trustedWaits, where(step, "instant send while trusted sends wait")).to.equal(false);
        }
        break;
      }
      case 3: case 4: { // ask for a withdrawal
        const d = r.pick(dests);
        const rc = t ? await ok(vault.connect(who).requestTokenWithdrawal(t.target, d, amt)) : await ok(vault.connect(who).requestWithdrawal(d, amt));
        if (rc) {
          hit("request");
          expect(who.address, where(step, "a non-owner queued a withdrawal")).to.equal(o.address);
          const e = evs(rc).find((x) => /WithdrawalQueued/.test(x.name));
          expect(e.args.readyAt >= now + vBefore.withdrawDelay, where(step, "withdrawal can leave before the delay")).to.equal(true);
          expect(e.args.readyAt >= vBefore.lockedUntil, where(step, "withdrawal can leave during the lock")).to.equal(true);
        }
        break;
      }
      case 5: { // cancel
        if (!before || !before.withdrawals.length) break;
        const w = r.pick(before.withdrawals);
        const rc = t ? await ok(vault.connect(who).cancelTokenWithdrawal(t.target, w.id)) : await ok(vault.connect(who).cancelWithdrawal(w.id));
        if (rc) { hit("cancel"); expect(who.address, where(step, "a non-owner cancelled")).to.equal(o.address); }
        break;
      }
      case 6: case 7: { // run a withdrawal (anyone) or release it (guardian)
        if (!before || !before.withdrawals.length) break;
        const w = r.pick(before.withdrawals), release = r.chance(40);
        const who = release && r.chance(75) ? guardian : who0; // mostly the real guardian, sometimes an impostor
        const call = release
          ? (t ? vault.connect(who).guardianReleaseToken(o.address, t.target, w.id) : vault.connect(who).guardianRelease(o.address, w.id))
          : (t ? vault.connect(who).executeTokenWithdrawal(o.address, t.target, w.id) : vault.connect(who).executeWithdrawal(o.address, w.id));
        const rc = await ok(call);
        if (rc) {
          hit(release ? "release" : "execute");
          const sent = evs(rc).find((x) => x.name === "Sent" || x.name === "TokenSent");
          expect([sent.args.dest, sent.args.amount], where(step, "a withdrawal changed on the way")).to.deep.equal([w.dest, w.amount]);
          if (release) {
            expect(who.address, where(step, "released by someone other than the guardian")).to.equal(vBefore.guardian);
            expect(vBefore.noExit, where(step, "released with no emergency exit")).to.equal(false);
          }
          else {
            expect(now >= w.readyAt, where(step, "a withdrawal ran early")).to.equal(true);
            expect(locked, where(step, "a withdrawal ran while locked")).to.equal(false);
          }
        }
        break;
      }
      case 8: { // propose a rule change (on the Safe, or a token's limit)
        if (t) {
          const lim = r.chance(30) ? 0n : amt * BigInt(1 + r.below(5));
          const rc = await ok(vault.connect(who).proposeTokenLimit(t.target, lim));
          if (rc) {
            hit("token-limit");
            const applied = evs(rc).some((x) => x.name === "TokenLimitApplied");
            if (applied) expect(mayApplyNow({ dailyLimit: before.dailyLimit }, { kind: K.SetDailyLimit, value: lim }), where(step, "a token limit loosened at once")).to.equal(true);
          }
          break;
        }
        // Trusted addresses and locks open the instant-send and locked paths; guardian changes must always wait.
        const kind = r.pick([K.AddTrusted, K.AddTrusted, K.AddTrusted, K.SetLockedUntil, K.SetLockedUntil, K.SetGuardian, K.SetGuardian, K.SetWithdrawDelay, K.SetRuleDelay, K.SetDailyLimit, K.RemoveTrusted, K.SetTrustedWaits, K.SetNoExit]);
        const value = kind === K.SetWithdrawDelay || kind === K.SetRuleDelay ? r.pick([HOUR - 1n, HOUR, 365n * DAY + 1n, HOUR * BigInt(1 + r.below(24 * 20))])
          : kind === K.SetDailyLimit ? (r.chance(30) ? 0n : amt * BigInt(1 + r.below(5)))
          : kind === K.SetLockedUntil ? (r.chance(30) ? 0n : now + BigInt(r.below(30)) * DAY)
          : kind === K.SetTrustedWaits || kind === K.SetNoExit ? BigInt(r.below(3)) : 0n; // 2 must be refused
        const addr = kind === K.SetGuardian ? r.pick([ZERO, guardian.address, o.address, stranger.address])
          : kind === K.AddTrusted || kind === K.RemoveTrusted ? r.pick(dests) : ZERO;
        const c = { kind, value, addr };
        const rc = await ok(vault.connect(who).proposeChange(c));
        if (rc) {
          hit("propose");
          expect(who.address, where(step, "a non-owner proposed a rule")).to.equal(o.address);
          const applied = evs(rc).some((x) => x.name === "ChangeApplied");
          if (applied) expect(mayApplyNow(vBefore, c), where(step, `a loosening change applied at once (${JSON.stringify(c, (_, x) => (typeof x === "bigint" ? x.toString() : x))})`)).to.equal(true);
          else { const q = evs(rc).find((x) => x.name === "ChangeQueued"); expect(q.args.readyAt >= now + vBefore.ruleDelay, where(step, "loosening waits less than the rule delay")).to.equal(true); }
        }
        break;
      }
      case 9: { // apply, or the guardian hurries, a queued change
        const v = vBefore; if (!v || !v.changes.length) break;
        const c = r.pick(v.changes);
        if (r.chance(50)) {
          const rc = await ok(vault.connect(who).applyChange(o.address, c.id));
          if (rc) { hit("apply"); expect(now >= c.readyAt, where(step, "a change applied early")).to.equal(true); }
        } else {
          const rc = await ok(vault.connect(who).guardianApproveChange(o.address, c.id));
          if (rc) {
            hit("approve");
            expect(who.address, where(step, "approved by someone other than the guardian")).to.equal(v.guardian);
            expect(Number(c.change.kind), where(step, "the guardian hurried something other than a trusted address")).to.equal(K.AddTrusted);
          }
        }
        break;
      }
      case 10: case 99: { // the brake: sometimes the pauser, sometimes someone else
        const by = r.chance(70) ? owner1 : stranger; // owner1 deployed, so it is the pauser
        const rc = await ok(vault.connect(by).setDepositsPaused(r.chance(20)));
        if (rc) { hit("brake"); expect(by.address, where(step, "someone other than the pauser pulled the brake")).to.equal(owner1.address); }
        break;
      }
      default: { // apply a token limit change
        if (!t || !before || !before.changes.length) break;
        const c = r.pick(before.changes);
        const rc = await ok(vault.connect(who).applyTokenChange(o.address, t.target, c.id));
        if (rc) { hit("token-apply"); expect(now >= c.readyAt, where(step, "a token limit applied early")).to.equal(true); }
      }
    }

    // After every step: solvency, and nothing promised twice.
    let ethOwed = 0n;
    for (const x of owners) {
      const v = await vault.getVault(x.address).catch(() => null); if (!v) continue;
      ethOwed += v.balance;
      expect(v.withdrawals.reduce((s, w) => s + w.amount, 0n) <= v.balance, where(step, "ETH promised twice")).to.equal(true);
      for (const tk of tokens) {
        const tv = await vault.getTokenVault(x.address, tk.target);
        expect(tv.withdrawals.reduce((s, w) => s + w.amount, 0n) <= tv.balance, where(step, "tokens promised twice")).to.equal(true);
      }
    }
    expect(await ethers.provider.getBalance(vault.target), where(step, "ETH books don't match")).to.equal(ethOwed);
    for (const tk of tokens) {
      let owed = 0n; for (const x of owners) owed += (await vault.getTokenVault(x.address, tk.target)).balance;
      expect((await tk.balanceOf(vault.target)) >= owed, where(step, "the contract holds fewer tokens than it owes")).to.equal(true);
    }
  }
  return hits;
}

describe("EcrinVault stress", function () {
  this.timeout(0);
  it("random sequences keep every promise (ETH, normal, USDT-style and fee-on-transfer tokens, the brake)", async () => {
    const seeds = Number(process.env.STRESS_SEEDS || 4), steps = Number(process.env.STRESS_STEPS || 500), total = {};
    for (let s = 1; s <= seeds; s++) for (const [k, n] of Object.entries(await run(s * 7919, steps))) total[k] = (total[k] || 0) + n;
    console.log("      reached:", JSON.stringify(total));
    for (const k of ["open", "deposit", "instant", "request", "cancel", "execute", "release", "propose", "apply", "brake", "token-limit"]) expect(total[k] || 0, `never reached: ${k}`).to.be.greaterThan(0);
  });

  it("a hostile token can't re-enter the vault, on the way in or out", async () => {
    const [owner, guardian, dest] = await ethers.getSigners();
    const vault = await (await ethers.getContractFactory("EcrinVault")).deploy(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);
    const evil = await (await ethers.getContractFactory("EvilToken")).deploy();
    await evil.mint(owner.address, 1000n); await evil.connect(owner).approve(vault.target, ethers.MaxUint256);
    await vault.createVault(1, guardian.address, 0);
    await vault.depositToken(evil.target, 500n);
    const rc = await (await vault.requestTokenWithdrawal(evil.target, dest.address, 100n)).wait();
    const id = rc.logs.map((l) => { try { return vault.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "TokenWithdrawalQueued").args.id;
    await evil.setup(vault.target, owner.address, id, 2); // re-enter during the deposit
    await vault.depositToken(evil.target, 10n);
    await evil.setup(vault.target, owner.address, id, 1); // re-enter during the payout
    await vault.connect(guardian).guardianReleaseToken(owner.address, evil.target, id);
    expect(await evil.reentered()).to.equal(false);
    expect((await vault.getTokenVault(owner.address, evil.target)).balance).to.equal(410n);
    expect(await evil.balanceOf(dest.address)).to.equal(100n);
  });
});
