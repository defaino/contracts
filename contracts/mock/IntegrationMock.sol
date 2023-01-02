// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "../interfaces/IDefiCore.sol";

contract IntegrationMock {
    function addLiquidity(
        address defiCoreAddr_,
        bytes32 assetKey_,
        uint256 liquidityAmount_
    ) external payable {
        IDefiCore(defiCoreAddr_).addLiquidity{value: msg.value}(assetKey_, liquidityAmount_);
    }
}
