// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Ecrin vault for Ethereum
/// @notice The same rules as the Solana program (crates/vault-core): every way out of the vault is slower than
/// an impulse or an attacker.
/// - Sends to trusted addresses arrive at once (subject to the daily limit).
/// - Any other withdrawal waits for the owner's delay, and the owner can cancel it until it runs.
/// - Making the rules stricter applies at once. Loosening them, and any guardian change, waits for the rule delay.
/// - A guardian can never move funds on their own. They can only approve something the owner asked for.
/// One contract holds one vault per owner address: their ETH, and any ERC-20 token (USDC) they put in.
/// Each token keeps its own balance, daily limit and queue; the delays, the lock, the guardian and the trusted
/// addresses are the vault's, so one set of rules covers every coin.
/// Tokens that change balances on their own (rebasing) are not supported; the app only offers stablecoins.
contract EcrinVault {
    uint64 public constant HOUR = 3600;
    uint64 public constant DAY = 86400;
    uint256 public constant MAX_TRUSTED = 8;
    uint256 public constant MAX_PENDING_WITHDRAWALS = 4;
    uint256 public constant MAX_PENDING_CHANGES = 4;

    enum Kind { SetWithdrawDelay, SetRuleDelay, SetDailyLimit, SetLockedUntil, SetGuardian, AddTrusted, RemoveTrusted }
    enum Preset { Gentle, Strong, Locked }

    /// `value` carries a delay, a limit or a date (0 = none for the limit and the lock);
    /// `addr` carries a guardian or a trusted address (address(0) = no guardian).
    struct Change { Kind kind; uint256 value; address addr; }
    struct Withdrawal { uint32 id; uint256 amount; address dest; uint64 readyAt; }
    struct PendingChange { uint32 id; Change change; uint64 readyAt; }

    struct Vault {
        bool exists;
        uint256 balance;
        uint64 withdrawDelay;
        uint64 ruleDelay;
        uint256 dailyLimit; // 0 = no limit
        uint64 lockedUntil; // 0 = no lock
        address guardian; // address(0) = none
        uint32 nextId;
        uint64 spentDay;
        uint256 spentToday;
        address[] trusted;
        Withdrawal[] withdrawals;
        PendingChange[] changes;
    }

    /// One token inside a vault. `changes` only ever holds daily-limit changes for this token.
    struct TokenVault {
        uint256 balance;
        uint256 dailyLimit; // 0 = no limit, in the token's own units
        uint64 spentDay;
        uint256 spentToday;
        Withdrawal[] withdrawals;
        PendingChange[] changes;
    }

    mapping(address => Vault) private vaults;
    mapping(address => mapping(address => TokenVault)) private tokenVaults; // owner => token => state
    bool private entered;

    error NotOwner();
    error NotGuardian();
    error NoGuardian();
    error ZeroAmount();
    error InsufficientFunds();
    error NotTrusted();
    error Locked();
    error TooEarly();
    error DailyLimit();
    error NotFound();
    error TooManyPending();
    error TooManyTrusted();
    error InvalidValue();
    error VaultExists();
    error TransferFailed();
    error Reentered();

    event VaultCreated(address indexed owner, Preset preset, address guardian, uint64 lockedUntil);
    event Deposited(address indexed owner, uint256 amount);
    event Sent(address indexed owner, address indexed dest, uint256 amount);
    event WithdrawalQueued(address indexed owner, uint32 id, address dest, uint256 amount, uint64 readyAt);
    event WithdrawalCancelled(address indexed owner, uint32 id);
    event ChangeQueued(address indexed owner, uint32 id, Kind kind, uint256 value, address addr, uint64 readyAt);
    event ChangeApplied(address indexed owner, Kind kind, uint256 value, address addr);
    event ChangeCancelled(address indexed owner, uint32 id);
    event TokenDeposited(address indexed owner, address indexed token, uint256 amount);
    event TokenSent(address indexed owner, address indexed token, address indexed dest, uint256 amount);
    event TokenWithdrawalQueued(address indexed owner, address indexed token, uint32 id, address dest, uint256 amount, uint64 readyAt);
    event TokenWithdrawalCancelled(address indexed owner, address indexed token, uint32 id);
    event TokenLimitQueued(address indexed owner, address indexed token, uint32 id, uint256 limit, uint64 readyAt);
    event TokenLimitApplied(address indexed owner, address indexed token, uint256 limit);
    event TokenLimitCancelled(address indexed owner, address indexed token, uint32 id);

    modifier nonReentrant() {
        if (entered) revert Reentered();
        entered = true;
        _;
        entered = false;
    }

    // ------------------------------------------------------------------ owner

    /// Creates the caller's vault. Gentle: 24 h / 3 days, no guardian. Strong: 72 h / 7 days, guardian optional.
    /// Locked: like Strong, nothing leaves before `lockUntil`, guardian required for emergencies.
    /// Any ETH sent along is deposited.
    function createVault(Preset preset, address guardian, uint64 lockUntil) external payable {
        Vault storage v = vaults[msg.sender];
        if (v.exists) revert VaultExists();
        if (guardian == msg.sender) revert InvalidValue();
        v.exists = true;
        v.nextId = 1;
        if (preset == Preset.Gentle) {
            if (guardian != address(0) || lockUntil != 0) revert InvalidValue();
            (v.withdrawDelay, v.ruleDelay) = (24 * HOUR, 3 * DAY);
        } else {
            (v.withdrawDelay, v.ruleDelay) = (72 * HOUR, 7 * DAY);
            v.guardian = guardian;
            if (preset == Preset.Locked) {
                if (guardian == address(0) || lockUntil <= block.timestamp) revert InvalidValue();
                v.lockedUntil = lockUntil;
            } else if (lockUntil != 0) revert InvalidValue();
        }
        emit VaultCreated(msg.sender, preset, guardian, v.lockedUntil);
        if (msg.value > 0) { v.balance = msg.value; emit Deposited(msg.sender, msg.value); }
    }

    function deposit() external payable {
        Vault storage v = _vault(msg.sender);
        if (msg.value == 0) revert ZeroAmount();
        v.balance += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// Instant send to an address the owner trusted earlier. Still blocked while locked.
    function sendToTrusted(address dest, uint256 amount) external nonReentrant {
        Vault storage v = _vault(msg.sender);
        if (amount == 0) revert ZeroAmount();
        if (!_isTrusted(v, dest)) revert NotTrusted();
        if (_isLocked(v)) revert Locked();
        if (amount > available(msg.sender)) revert InsufficientFunds();
        _spend(v, amount);
        _pay(msg.sender, dest, amount);
    }

    /// Queues a withdrawal to any address. It can run after the delay, or after the lock ends if that is later.
    function requestWithdrawal(address dest, uint256 amount) external returns (uint32 id) {
        Vault storage v = _vault(msg.sender);
        if (amount == 0) revert ZeroAmount();
        if (dest == address(0)) revert InvalidValue();
        if (amount > available(msg.sender)) revert InsufficientFunds();
        if (v.withdrawals.length >= MAX_PENDING_WITHDRAWALS) revert TooManyPending();
        uint64 readyAt = _max(uint64(block.timestamp) + v.withdrawDelay, v.lockedUntil);
        id = _nextId(v);
        v.withdrawals.push(Withdrawal(id, amount, dest, readyAt));
        emit WithdrawalQueued(msg.sender, id, dest, amount, readyAt);
    }

    /// The owner can cancel any queued withdrawal at any time. The funds simply stay.
    function cancelWithdrawal(uint32 id) external {
        Vault storage v = _vault(msg.sender);
        _removeW(v.withdrawals, _findW(v.withdrawals, id));
        emit WithdrawalCancelled(msg.sender, id);
    }

    /// Proposes a rule change. Stricter changes apply at once; looser ones wait for the rule delay
    /// (and never before the lock ends).
    function proposeChange(Change calldata change) external returns (uint32 id) {
        Vault storage v = _vault(msg.sender);
        _checkChange(v, msg.sender, change);
        if (isStricter(msg.sender, change)) {
            _apply(v, msg.sender, change);
            return 0;
        }
        if (v.changes.length >= MAX_PENDING_CHANGES) revert TooManyPending();
        uint64 readyAt = _max(uint64(block.timestamp) + v.ruleDelay, v.lockedUntil);
        id = _nextId(v);
        v.changes.push(PendingChange(id, change, readyAt));
        emit ChangeQueued(msg.sender, id, change.kind, change.value, change.addr, readyAt);
    }

    function cancelChange(uint32 id) external {
        Vault storage v = _vault(msg.sender);
        _removeC(v.changes, _findC(v.changes, id));
        emit ChangeCancelled(msg.sender, id);
    }

    // ------------------------------------------------------------------ anyone (cranks)

    /// Runs a queued withdrawal once its time has come. Anyone may call it; the funds go to the
    /// destination the owner chose, so the caller gains nothing.
    function executeWithdrawal(address owner, uint32 id) external nonReentrant {
        Vault storage v = _vault(owner);
        uint256 i = _findW(v.withdrawals, id);
        Withdrawal memory w = v.withdrawals[i];
        if (block.timestamp < w.readyAt) revert TooEarly();
        // A lock added after the request still holds it back.
        if (_isLocked(v)) revert Locked();
        _spend(v, w.amount);
        _removeW(v.withdrawals, i);
        _pay(owner, w.dest, w.amount);
    }

    /// Applies a queued change once its time has come. Anyone may call it.
    function applyChange(address owner, uint32 id) external {
        Vault storage v = _vault(owner);
        uint256 i = _findC(v.changes, id);
        PendingChange memory c = v.changes[i];
        if (block.timestamp < c.readyAt) revert TooEarly();
        _removeC(v.changes, i);
        _apply(v, owner, c.change);
    }

    // ------------------------------------------------------------------ guardian

    /// Emergency exit: the guardian co-signs a withdrawal the owner already requested, and it runs now,
    /// lock and delay included. The guardian can't create one, change its amount or its destination.
    function guardianRelease(address owner, uint32 id) external nonReentrant {
        Vault storage v = _vault(owner);
        _guardianOnly(v);
        uint256 i = _findW(v.withdrawals, id);
        Withdrawal memory w = v.withdrawals[i];
        _spend(v, w.amount);
        _removeW(v.withdrawals, i);
        _pay(owner, w.dest, w.amount);
    }

    /// The guardian can approve a queued change early, but only adding a trusted address.
    function guardianApproveChange(address owner, uint32 id) external {
        Vault storage v = _vault(owner);
        _guardianOnly(v);
        uint256 i = _findC(v.changes, id);
        PendingChange memory c = v.changes[i];
        if (c.change.kind != Kind.AddTrusted) revert TooEarly();
        _removeC(v.changes, i);
        _apply(v, owner, c.change);
    }

    // ------------------------------------------------------------------ tokens (USDC and other ERC-20s)

    /// Moves tokens from the owner into their vault. The caller approves this contract first. Only what
    /// actually arrived is counted, so a token that takes a fee on transfer can't inflate the balance.
    function depositToken(address token, uint256 amount) external nonReentrant {
        _vault(msg.sender);
        if (amount == 0) revert ZeroAmount();
        if (token.code.length == 0) revert InvalidValue();
        uint256 before = _held(token);
        _call(token, abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amount)); // transferFrom
        uint256 got = _held(token) - before;
        if (got == 0) revert ZeroAmount();
        tokenVaults[msg.sender][token].balance += got;
        emit TokenDeposited(msg.sender, token, got);
    }

    function sendTokenToTrusted(address token, address dest, uint256 amount) external nonReentrant {
        Vault storage v = _vault(msg.sender);
        TokenVault storage t = tokenVaults[msg.sender][token];
        if (amount == 0) revert ZeroAmount();
        if (!_isTrusted(v, dest)) revert NotTrusted();
        if (_isLocked(v)) revert Locked();
        if (amount > availableToken(msg.sender, token)) revert InsufficientFunds();
        _spendToken(t, amount);
        _payToken(msg.sender, token, dest, amount);
    }

    function requestTokenWithdrawal(address token, address dest, uint256 amount) external returns (uint32 id) {
        Vault storage v = _vault(msg.sender);
        TokenVault storage t = tokenVaults[msg.sender][token];
        if (amount == 0) revert ZeroAmount();
        if (dest == address(0)) revert InvalidValue();
        if (amount > availableToken(msg.sender, token)) revert InsufficientFunds();
        if (t.withdrawals.length >= MAX_PENDING_WITHDRAWALS) revert TooManyPending();
        uint64 readyAt = _max(uint64(block.timestamp) + v.withdrawDelay, v.lockedUntil);
        id = _nextId(v);
        t.withdrawals.push(Withdrawal(id, amount, dest, readyAt));
        emit TokenWithdrawalQueued(msg.sender, token, id, dest, amount, readyAt);
    }

    function cancelTokenWithdrawal(address token, uint32 id) external {
        _vault(msg.sender);
        Withdrawal[] storage q = tokenVaults[msg.sender][token].withdrawals;
        _removeW(q, _findW(q, id));
        emit TokenWithdrawalCancelled(msg.sender, token, id);
    }

    /// Anyone may run a due token withdrawal; the coins go to the destination the owner chose.
    function executeTokenWithdrawal(address owner, address token, uint32 id) external nonReentrant {
        Vault storage v = _vault(owner);
        TokenVault storage t = tokenVaults[owner][token];
        uint256 i = _findW(t.withdrawals, id);
        Withdrawal memory w = t.withdrawals[i];
        if (block.timestamp < w.readyAt) revert TooEarly();
        if (_isLocked(v)) revert Locked();
        _spendToken(t, w.amount);
        _removeW(t.withdrawals, i);
        _payToken(owner, token, w.dest, w.amount);
    }

    /// The vault's guardian releases a token withdrawal the owner already requested, delay and lock included.
    function guardianReleaseToken(address owner, address token, uint32 id) external nonReentrant {
        Vault storage v = _vault(owner);
        _guardianOnly(v);
        TokenVault storage t = tokenVaults[owner][token];
        uint256 i = _findW(t.withdrawals, id);
        Withdrawal memory w = t.withdrawals[i];
        _spendToken(t, w.amount);
        _removeW(t.withdrawals, i);
        _payToken(owner, token, w.dest, w.amount);
    }

    /// Sets a token's daily limit (0 = none). Lowering it applies at once; raising or removing it waits for
    /// the rule delay (and never before the lock ends).
    function proposeTokenLimit(address token, uint256 limit) external returns (uint32 id) {
        Vault storage v = _vault(msg.sender);
        TokenVault storage t = tokenVaults[msg.sender][token];
        if (_limitStricter(t.dailyLimit, limit)) {
            t.dailyLimit = limit;
            emit TokenLimitApplied(msg.sender, token, limit);
            return 0;
        }
        if (t.changes.length >= MAX_PENDING_CHANGES) revert TooManyPending();
        uint64 readyAt = _max(uint64(block.timestamp) + v.ruleDelay, v.lockedUntil);
        id = _nextId(v);
        t.changes.push(PendingChange(id, Change(Kind.SetDailyLimit, limit, token), readyAt));
        emit TokenLimitQueued(msg.sender, token, id, limit, readyAt);
    }

    function cancelTokenChange(address token, uint32 id) external {
        _vault(msg.sender);
        PendingChange[] storage q = tokenVaults[msg.sender][token].changes;
        _removeC(q, _findC(q, id));
        emit TokenLimitCancelled(msg.sender, token, id);
    }

    function applyTokenChange(address owner, address token, uint32 id) external {
        _vault(owner);
        TokenVault storage t = tokenVaults[owner][token];
        uint256 i = _findC(t.changes, id);
        PendingChange memory c = t.changes[i];
        if (block.timestamp < c.readyAt) revert TooEarly();
        _removeC(t.changes, i);
        t.dailyLimit = c.change.value;
        emit TokenLimitApplied(owner, token, c.change.value);
    }

    function getTokenVault(address owner, address token) external view returns (
        uint256 balance, uint256 dailyLimit, uint64 spentDay, uint256 spentToday,
        Withdrawal[] memory withdrawals, PendingChange[] memory changes
    ) {
        TokenVault storage t = tokenVaults[owner][token];
        return (t.balance, t.dailyLimit, t.spentDay, t.spentToday, t.withdrawals, t.changes);
    }

    function availableToken(address owner, address token) public view returns (uint256) {
        TokenVault storage t = tokenVaults[owner][token];
        uint256 queued;
        for (uint256 i; i < t.withdrawals.length; i++) queued += t.withdrawals[i].amount;
        return t.balance > queued ? t.balance - queued : 0;
    }

    // ------------------------------------------------------------------ views

    function hasVault(address owner) external view returns (bool) { return vaults[owner].exists; }

    function getVault(address owner) external view returns (
        uint256 balance, uint64 withdrawDelay, uint64 ruleDelay, uint256 dailyLimit, uint64 lockedUntil,
        address guardian, uint64 spentDay, uint256 spentToday,
        address[] memory trusted, Withdrawal[] memory withdrawals, PendingChange[] memory changes
    ) {
        Vault storage v = _vault(owner);
        return (v.balance, v.withdrawDelay, v.ruleDelay, v.dailyLimit, v.lockedUntil, v.guardian, v.spentDay, v.spentToday,
            v.trusted, v.withdrawals, v.changes);
    }

    /// Funds not already promised to a queued withdrawal.
    function available(address owner) public view returns (uint256) {
        Vault storage v = vaults[owner];
        uint256 queued;
        for (uint256 i; i < v.withdrawals.length; i++) queued += v.withdrawals[i].amount;
        return v.balance > queued ? v.balance - queued : 0;
    }

    /// True when the change only makes the vault harder to drain, so it may apply at once.
    /// Any guardian change waits: a guardian can release a withdrawal at once, so a key thief who could
    /// name their own wallet as guardian would skip every delay.
    function isStricter(address owner, Change calldata c) public view returns (bool) {
        Vault storage v = vaults[owner];
        if (c.kind == Kind.SetWithdrawDelay) return c.value >= v.withdrawDelay;
        if (c.kind == Kind.SetRuleDelay) return c.value >= v.ruleDelay;
        if (c.kind == Kind.SetDailyLimit) return _limitStricter(v.dailyLimit, c.value);
        if (c.kind == Kind.SetLockedUntil) {
            if (c.value == 0) return v.lockedUntil == 0;
            return v.lockedUntil == 0 || c.value >= v.lockedUntil;
        }
        if (c.kind == Kind.RemoveTrusted) return true;
        return false; // SetGuardian, AddTrusted
    }

    /// Plain ETH transfers would be stuck with no owner, so they are refused.
    receive() external payable { revert InvalidValue(); }

    // ------------------------------------------------------------------ internals

    function _vault(address owner) private view returns (Vault storage v) {
        v = vaults[owner];
        if (!v.exists) revert NotFound();
    }

    function _guardianOnly(Vault storage v) private view {
        if (v.guardian == address(0)) revert NoGuardian();
        if (v.guardian != msg.sender) revert NotGuardian();
    }

    function _isLocked(Vault storage v) private view returns (bool) { return block.timestamp < v.lockedUntil; }

    function _isTrusted(Vault storage v, address a) private view returns (bool) {
        for (uint256 i; i < v.trusted.length; i++) if (v.trusted[i] == a) return true;
        return false;
    }

    function _nextId(Vault storage v) private returns (uint32 id) {
        id = v.nextId;
        unchecked { v.nextId = id + 1 == 0 ? 1 : id + 1; }
    }

    /// Counts `amount` against today's limit (UTC day) and takes it from the balance.
    function _spend(Vault storage v, uint256 amount) private {
        uint64 day = uint64(block.timestamp / DAY);
        uint256 after_ = (day == v.spentDay ? v.spentToday : 0) + amount;
        if (v.dailyLimit != 0 && after_ > v.dailyLimit) revert DailyLimit();
        if (amount > v.balance) revert InsufficientFunds();
        v.balance -= amount;
        v.spentDay = day;
        v.spentToday = after_;
    }

    function _pay(address owner, address dest, uint256 amount) private {
        emit Sent(owner, dest, amount);
        (bool ok, ) = dest.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _checkChange(Vault storage v, address owner, Change calldata c) private view {
        if (c.kind == Kind.SetWithdrawDelay || c.kind == Kind.SetRuleDelay) _delay(c.value);
        else if (c.kind == Kind.SetLockedUntil) { if (c.value > type(uint64).max) revert InvalidValue(); }
        else if (c.kind == Kind.SetGuardian) { if (c.addr == owner) revert InvalidValue(); }
        else if (c.kind == Kind.AddTrusted) {
            if (c.addr == address(0) || _isTrusted(v, c.addr)) revert InvalidValue();
            if (v.trusted.length >= MAX_TRUSTED) revert TooManyTrusted();
        } else if (c.kind == Kind.RemoveTrusted) { if (!_isTrusted(v, c.addr)) revert NotFound(); }
        // SetDailyLimit: any value; 0 means no limit.
    }

    /// A delay under an hour isn't a cooldown; over a year is almost certainly a typo.
    function _delay(uint256 s) private pure returns (uint64) {
        if (s < HOUR || s > 365 * DAY) revert InvalidValue();
        return uint64(s);
    }

    function _apply(Vault storage v, address owner, Change memory c) private {
        if (c.kind == Kind.SetWithdrawDelay) v.withdrawDelay = uint64(c.value);
        else if (c.kind == Kind.SetRuleDelay) v.ruleDelay = uint64(c.value);
        else if (c.kind == Kind.SetDailyLimit) v.dailyLimit = c.value;
        else if (c.kind == Kind.SetLockedUntil) v.lockedUntil = uint64(c.value);
        else if (c.kind == Kind.SetGuardian) v.guardian = c.addr;
        else if (c.kind == Kind.AddTrusted) {
            if (!_isTrusted(v, c.addr)) {
                if (v.trusted.length >= MAX_TRUSTED) revert TooManyTrusted();
                v.trusted.push(c.addr);
            }
        } else {
            uint256 n = v.trusted.length;
            for (uint256 i; i < n; i++) if (v.trusted[i] == c.addr) { v.trusted[i] = v.trusted[n - 1]; v.trusted.pop(); break; }
        }
        emit ChangeApplied(owner, c.kind, c.value, c.addr);
    }

    /// A new daily limit (0 = none) is stricter when it adds a limit or lowers it.
    function _limitStricter(uint256 old, uint256 next) private pure returns (bool) {
        if (next == 0) return old == 0;
        return old == 0 || next <= old;
    }

    function _spendToken(TokenVault storage t, uint256 amount) private {
        uint64 day = uint64(block.timestamp / DAY);
        uint256 after_ = (day == t.spentDay ? t.spentToday : 0) + amount;
        if (t.dailyLimit != 0 && after_ > t.dailyLimit) revert DailyLimit();
        if (amount > t.balance) revert InsufficientFunds();
        t.balance -= amount;
        t.spentDay = day;
        t.spentToday = after_;
    }

    function _payToken(address owner, address token, address dest, uint256 amount) private {
        emit TokenSent(owner, token, dest, amount);
        _call(token, abi.encodeWithSelector(0xa9059cbb, dest, amount)); // transfer
    }

    /// Calls a token and accepts both standard tokens (return true) and ones that return nothing (USDT).
    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    function _held(address token) private view returns (uint256) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSelector(0x70a08231, address(this))); // balanceOf
        if (!ok || ret.length < 32) revert InvalidValue();
        return abi.decode(ret, (uint256));
    }

    function _findW(Withdrawal[] storage q, uint32 id) private view returns (uint256) {
        for (uint256 i; i < q.length; i++) if (q[i].id == id) return i;
        revert NotFound();
    }

    function _findC(PendingChange[] storage q, uint32 id) private view returns (uint256) {
        for (uint256 i; i < q.length; i++) if (q[i].id == id) return i;
        revert NotFound();
    }

    function _removeW(Withdrawal[] storage q, uint256 i) private {
        for (; i + 1 < q.length; i++) q[i] = q[i + 1];
        q.pop();
    }

    function _removeC(PendingChange[] storage q, uint256 i) private {
        for (; i + 1 < q.length; i++) q[i] = q[i + 1];
        q.pop();
    }

    function _max(uint64 a, uint64 b) private pure returns (uint64) { return a > b ? a : b; }
}
