// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "../GovernanceToken.sol";

contract GovernanceTokenMock is GovernanceToken {
    constructor(address _recipient) GovernanceToken(_recipient) {}

    function mintArbitrary(address _to, uint256 _amount) public {
        _mint(_to, _amount);
    }
}
