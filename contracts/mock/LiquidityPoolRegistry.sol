// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.8.3;

import "../LiquidityPoolRegistry.sol";

contract LiquidityPoolRegistryMock is LiquidityPoolRegistry {
    function setExistingLiquidityPool(address _newLP) external {
        existingLiquidityPools[_newLP] = true;
    }
}
