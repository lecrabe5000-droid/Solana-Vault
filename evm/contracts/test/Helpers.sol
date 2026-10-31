// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../EcrinVault.sol";

/// Test-only: a destination that refuses ETH.
contract Refuser {
    receive() external payable { revert("no"); }
}

/// Test-only: owns a vault and tries to re-enter it when paid.
contract Reenterer {
    EcrinVault public immutable vault;
    uint32 public id;
    bool public tried;

    constructor(EcrinVault v) payable { vault = v; }

    function setup() external {
        vault.createVault{value: 1 ether}(EcrinVault.Preset.Gentle, address(0), 0);
        vault.proposeChange(EcrinVault.Change(EcrinVault.Kind.AddTrusted, 0, address(this)));
    }

    function applyTrust(uint32 changeId) external { vault.applyChange(address(this), changeId); }

    function sendToSelf(uint256 amount) external { vault.sendToTrusted(address(this), amount); }

    receive() external payable {
        if (tried) return;
        tried = true;
        vault.sendToTrusted(address(this), 0.5 ether); // must revert with Reentered
    }
}

/// Test-only: a minimal ERC-20 like USDC (6 decimals, returns true). `fee` takes a cut of every transfer,
/// `noReturn` returns nothing like USDT, `fails` returns false instead of reverting.
contract TestToken {
    string public symbol;
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public feeBps;
    bool public fails;

    constructor(string memory s, uint256 fee) { symbol = s; feeBps = fee; }

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function setFails(bool f) external { fails = f; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }

    function transfer(address to, uint256 amount) external returns (bool) { return _move(msg.sender, to, amount); }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (fails) return false;
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        return _move(from, to, amount);
    }

    function _move(address from, address to, uint256 amount) private returns (bool) {
        if (fails) return false;
        require(balanceOf[from] >= amount, "balance");
        uint256 fee = amount * feeBps / 10_000;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        return true;
    }
}

/// Test-only: like USDT, transfer and transferFrom return nothing.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external { allowance[msg.sender][spender] = amount; }
    function transfer(address to, uint256 amount) external { require(balanceOf[msg.sender] >= amount); balanceOf[msg.sender] -= amount; balanceOf[to] += amount; }
    function transferFrom(address from, address to, uint256 amount) external {
        require(allowance[from][msg.sender] >= amount && balanceOf[from] >= amount);
        allowance[from][msg.sender] -= amount; balanceOf[from] -= amount; balanceOf[to] += amount;
    }
}
