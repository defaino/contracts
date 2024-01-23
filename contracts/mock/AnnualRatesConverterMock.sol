// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "../libraries/AnnualRatesConverter.sol";
import "../common/Globals.sol";

contract AnnualRatesConverterMock {
    function getAnnualRate(
        uint256 lowInterestPercentage_,
        uint256 highInterestPercentage_,
        uint256 currentUR_,
        uint256 lowURPercentage_,
        uint256 highURPercentage_
    ) external pure returns (uint256) {
        return
            AnnualRatesConverter.getAnnualRate(
                lowInterestPercentage_,
                highInterestPercentage_,
                currentUR_,
                lowURPercentage_,
                highURPercentage_,
                PERCENTAGE_100
            );
    }

    function convertToRatePerSecond(
        IInterestRateLibrary library_,
        uint256 interestRatePerYear_
    ) external view returns (uint256) {
        return
            AnnualRatesConverter.convertToRatePerSecond(library_, interestRatePerYear_, PRECISION);
    }
}
