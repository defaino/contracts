// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.8.3;

import "../libraries/AnnualRatesConverter.sol";
import "../common/Globals.sol";

contract AnnualRatesConverterMock {
    function getAnnualRate(
        uint256 _lowInterestPercentage,
        uint256 _highInterestPercentage,
        uint256 _currentUR,
        uint256 _lowURPercentage,
        uint256 _highURPercentage
    ) external pure returns (uint256) {
        return
            AnnualRatesConverter.getAnnualRate(
                _lowInterestPercentage,
                _highInterestPercentage,
                _currentUR,
                _lowURPercentage,
                _highURPercentage,
                DECIMAL
            );
    }

    function convertToRatePerSecond(IInterestRateLibrary _library, uint256 _interestRatePerYear)
        external
        view
        returns (uint256)
    {
        return
            AnnualRatesConverter.convertToRatePerSecond(
                _library,
                _interestRatePerYear,
                ONE_PERCENT
            );
    }
}
