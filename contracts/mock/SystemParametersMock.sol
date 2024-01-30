// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "../core/SystemParameters.sol";

contract SystemParametersMock is SystemParameters {
    function getSystemOwnerAddr() public view returns (address) {
        return _systemOwnerAddr;
    }
}
