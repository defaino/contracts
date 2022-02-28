// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "../common/Globals.sol";

library MathHelper {
    function getNormalizedAmount(
        uint256 _amountWithoutInterest,
        uint256 _normalizedAmount,
        uint256 _additionalAmount,
        uint256 _currentRate,
        bool _isAdding
    ) internal pure returns (uint256 _newNormalizedAmount) {
        if (_isAdding || _amountWithoutInterest != 0) {
            uint256 _normalizedAdditionalAmount = mulDiv(_additionalAmount, DECIMAL, _currentRate);

            _newNormalizedAmount = _isAdding
                ? _normalizedAmount + _normalizedAdditionalAmount
                : _normalizedAmount - _normalizedAdditionalAmount;
        }
    }

    function divWithPrecision(uint256 _number, uint256 _denominator)
        internal
        pure
        returns (uint256)
    {
        return mulDiv(_number, DECIMAL, _denominator);
    }

    function mulWithPrecision(uint256 _number, uint256 _numerator)
        internal
        pure
        returns (uint256)
    {
        return mulDiv(_number, _numerator, DECIMAL);
    }

    function mulDiv(
        uint256 _number,
        uint256 _numerator,
        uint256 _denominator
    ) internal pure returns (uint256) {
        return (_number * _numerator) / _denominator;
    }
}
