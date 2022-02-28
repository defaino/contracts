// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract GovernanceToken is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 69_000_000 * 10**18;

    constructor(address _recipient) ERC20("New DeFi Governance", "NDG") {
        _mint(_recipient, TOTAL_SUPPLY);
    }
}
