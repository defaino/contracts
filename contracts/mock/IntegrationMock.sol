// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "../interfaces/IDefiCore.sol";

contract IntegrationMock {
    function addLiquidity(
        address _defiCoreAddr,
        bytes32 _assetKey,
        uint256 _liquidityAmount
    ) external payable {
        IDefiCore(_defiCoreAddr).addLiquidity{value: msg.value}(_assetKey, _liquidityAmount);
    }
}
