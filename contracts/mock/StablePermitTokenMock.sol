// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "../tokens/StablePermitToken.sol";

contract StablePermitTokenMock is StablePermitToken {
    uint8 private tokenDecimals = 18;

    constructor(
        string memory _name,
        string memory _symbol,
        IRegistry _registry
    ) StablePermitToken(_name, _symbol, _registry) {}

    function setDecimals(uint8 _newDecimals) external {
        tokenDecimals = _newDecimals;
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }
}
