// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Test-only stand-ins for Lido (stETH, wstETH, the withdrawal queue), close enough to check the vault's staking.
/// stETH is share-based: rewards (reward()) raise every holder's balance; slash() lowers it.
contract MockStETH {
    uint256 public totalShares;
    uint256 public totalPooled;
    mapping(address => uint256) public sharesOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function submit(address) external payable returns (uint256 s) {
        s = totalShares == 0 ? msg.value : (msg.value * totalShares) / totalPooled;
        sharesOf[msg.sender] += s; totalShares += s; totalPooled += msg.value;
    }
    function balanceOf(address a) public view returns (uint256) { return totalShares == 0 ? 0 : (sharesOf[a] * totalPooled) / totalShares; }
    function sharesFor(uint256 amount) public view returns (uint256) { return (amount * totalShares) / totalPooled; }
    function approve(address s, uint256 amount) external returns (bool) { allowance[msg.sender][s] = amount; return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance"); allowance[from][msg.sender] -= amount;
        _move(from, to, sharesFor(amount)); return true;
    }
    function transferShares(address to, uint256 s) external { _move(msg.sender, to, s); }
    function _move(address from, address to, uint256 s) internal { require(sharesOf[from] >= s, "shares"); sharesOf[from] -= s; sharesOf[to] += s; }
    function reward() external payable { totalPooled += msg.value; }
    function slash(uint256 amount) external { totalPooled -= amount; }
    function pay(address to, uint256 amount) external { (bool ok, ) = to.call{value: amount}(""); require(ok); }
    receive() external payable {}
}

contract MockWstETH {
    MockStETH public immutable st;
    mapping(address => uint256) public balanceOf;
    constructor(MockStETH s) { st = s; }
    function stETH() external view returns (address) { return address(st); }
    function wrap(uint256 amount) external returns (uint256 w) {
        w = st.sharesFor(amount);
        st.transferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] += w;
    }
    function unwrap(uint256 w) external returns (uint256 amount) {
        balanceOf[msg.sender] -= w;
        amount = (w * st.totalPooled()) / st.totalShares();
        st.transferShares(msg.sender, w);
    }
    function getStETHByWstETH(uint256 w) external view returns (uint256) { return (w * st.totalPooled()) / st.totalShares(); }
}

contract MockQueue {
    struct Req { uint256 amount; address owner; bool finalized; bool claimed; }
    MockStETH public immutable STETH;
    address public immutable WSTETH;
    Req[] public reqs;
    constructor(MockStETH s, address w) { STETH = s; WSTETH = w; reqs.push(); }
    function requestWithdrawals(uint256[] calldata amounts, address owner) external returns (uint256[] memory ids) {
        ids = new uint256[](amounts.length);
        for (uint256 i; i < amounts.length; i++) {
            require(amounts[i] >= 100, "min");
            STETH.transferFrom(msg.sender, address(this), amounts[i]);
            reqs.push(Req(amounts[i], owner, false, false)); ids[i] = reqs.length - 1;
        }
    }
    /// Test helper: Lido has processed the request and set aside `msg.value` ETH for it.
    function finalize(uint256 id) external payable { reqs[id].finalized = true; reqs[id].amount = msg.value; }
    function claimWithdrawal(uint256 id) external {
        Req storage r = reqs[id];
        require(r.finalized && !r.claimed, "not ready"); require(msg.sender == r.owner, "not owner");
        r.claimed = true;
        (bool ok, ) = msg.sender.call{value: r.amount}(""); require(ok, "pay");
    }
}
