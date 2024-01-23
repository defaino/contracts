// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "../tokens/StablePermitToken.sol";

contract StablePermitTokenMock is StablePermitToken {
    uint8 private _tokenDecimals = 18;

    constructor(
        string memory name_,
        string memory symbol_,
        IRegistry registry_
    ) StablePermitToken(name_, symbol_, registry_) {}

    function setDecimals(uint8 newDecimals_) external {
        _tokenDecimals = newDecimals_;
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }
}
