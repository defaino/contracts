// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "../core/AssetParameters.sol";

contract AssetParametersMock is AssetParameters {
    function getSystemOwnerAddr() public view returns (address) {
        return _systemOwnerAddr;
    }
}
