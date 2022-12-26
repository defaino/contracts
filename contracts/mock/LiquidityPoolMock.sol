// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "../LiquidityPool.sol";

contract LiquidityPoolMock is LiquidityPool {
    function getNormalizedAmount(
        uint256 _amountWithoutInterest,
        uint256 _normalizedAmount,
        uint256 _additionalAmount,
        uint256 _currentRate,
        bool _isAdding
    ) external pure returns (uint256) {
        return
            MathHelper.getNormalizedAmount(
                _amountWithoutInterest,
                _normalizedAmount,
                _additionalAmount,
                _currentRate,
                _isAdding
            );
    }

    function getPriceManager() external view returns (address) {
        return address(priceManager);
    }
}
