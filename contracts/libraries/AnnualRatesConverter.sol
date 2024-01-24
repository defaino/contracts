// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "../interfaces/IInterestRateLibrary.sol";

/**
 * This library is needed to convert annual rates and work with them
 */
library AnnualRatesConverter {
    /// @notice Function to get the annual percentage
    /// @param lowInterestPercentage_ lower boundary of annual interest
    /// @param highInterestPercentage_ upper boundary of annual interest
    /// @param currentUR_ current utilization ratio
    /// @param lowURPercentage_ lower boundary of utilization ratio
    /// @param highURPercentage_ upper boundary of utilization ratio
    /// @param decimal_ current decimal
    /// @return a calculated annual percentage
    function getAnnualRate(
        uint256 lowInterestPercentage_,
        uint256 highInterestPercentage_,
        uint256 currentUR_,
        uint256 lowURPercentage_,
        uint256 highURPercentage_,
        uint256 decimal_
    ) internal pure returns (uint256) {
        uint256 interestPerPercent_ = ((highInterestPercentage_ - lowInterestPercentage_) *
            decimal_) / (highURPercentage_ - lowURPercentage_);

        return
            (interestPerPercent_ * (currentUR_ - lowURPercentage_)) /
            decimal_ +
            lowInterestPercentage_;
    }

    /// @notice Function to convert annual rate to second rate
    /// @param library_ address of the InterestRateLibrary
    /// @param interestRatePerYear_ annual rate to be converted to a second rate
    /// @param onePercent_ current one percentage value
    /// @return a calculated second rate
    function convertToRatePerSecond(
        IInterestRateLibrary library_,
        uint256 interestRatePerYear_,
        uint256 onePercent_
    ) internal view returns (uint256) {
        uint256 libraryPrecision_ = library_.LIBRARY_PRECISION();

        interestRatePerYear_ *= libraryPrecision_;

        require(
            interestRatePerYear_ <= library_.MAX_SUPPORTED_PERCENTAGE() * onePercent_,
            "AnnualRatesConverter: Interest rate is not supported."
        );

        uint256 leftBorder_ = interestRatePerYear_ / onePercent_;
        uint256 rightBorder_ = leftBorder_ + 1;

        if (interestRatePerYear_ % onePercent_ == 0) {
            return library_.getRatePerSecond(leftBorder_);
        }

        uint256 firstRatePerSecond_ = library_.getRatePerSecond(leftBorder_);
        uint256 secondRatePerSecond_ = library_.getRatePerSecond(rightBorder_);

        return
            ((secondRatePerSecond_ - firstRatePerSecond_) *
                (interestRatePerYear_ - (leftBorder_ * onePercent_))) /
            onePercent_ +
            firstRatePerSecond_;
    }
}
