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
