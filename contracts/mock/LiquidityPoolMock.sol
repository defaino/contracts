// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "../LiquidityPool.sol";

contract LiquidityPoolMock is LiquidityPool {
    function getNormalizedAmount(
        uint256 amountWithoutInterest_,
        uint256 normalizedAmount_,
        uint256 additionalAmount_,
        uint256 currentRate_,
        bool isAdding_
    ) external pure returns (uint256) {
        return
            MathHelper.getNormalizedAmount(
                amountWithoutInterest_,
                normalizedAmount_,
                additionalAmount_,
                currentRate_,
                isAdding_
            );
    }

    function getPriceManager() external view returns (address) {
        return address(_priceManager);
    }

    function abstractPoolInitialize(address assetAddr_, bytes32 assetKey_) external {
        _abstractPoolInitialize(assetAddr_, assetKey_);
    }
}
