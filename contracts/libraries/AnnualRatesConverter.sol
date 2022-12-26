// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "../interfaces/IInterestRateLibrary.sol";

/**
 * This library is needed to convert annual rates and work with them
 */
library AnnualRatesConverter {
    /// @notice Function to get the annual percentage
    /// @param _lowInterestPercentage lower boundary of annual interest
    /// @param _highInterestPercentage upper boundary of annual interest
    /// @param _currentUR current utilization ratio
    /// @param _lowURPercentage lower boundary of utilization ratio
    /// @param _highURPercentage upper boundary of utilization ratio
    /// @param _decimal current decimal
    /// @return a calculated annual percentage
    function getAnnualRate(
        uint256 _lowInterestPercentage,
        uint256 _highInterestPercentage,
        uint256 _currentUR,
        uint256 _lowURPercentage,
        uint256 _highURPercentage,
        uint256 _decimal
    ) internal pure returns (uint256) {
        uint256 _interestPerPercent = ((_highInterestPercentage - _lowInterestPercentage) *
            _decimal) / (_highURPercentage - _lowURPercentage);

        return
            (_interestPerPercent * (_currentUR - _lowURPercentage)) /
            _decimal +
            _lowInterestPercentage;
    }

    /// @notice Function to convert annual rate to second rate
    /// @param _library address of the InterestRateLibrary
    /// @param _interestRatePerYear annual rate to be converted to a second rate
    /// @param _onePercent current one percentage value
    /// @return a calculated second rate
    function convertToRatePerSecond(
        IInterestRateLibrary _library,
        uint256 _interestRatePerYear,
        uint256 _onePercent
    ) internal view returns (uint256) {
        uint256 _libraryPrecision = _library.LIBRARY_PRECISION();

        _interestRatePerYear *= _libraryPrecision;

        require(
            _interestRatePerYear <= _library.MAX_SUPPORTED_PERCENTAGE() * _onePercent,
            "AnnualRatesConverter: Interest rate is not supported."
        );

        uint256 _leftBorder = _interestRatePerYear / _onePercent;
        uint256 _rightBorder = _leftBorder + 1;

        if (_interestRatePerYear % _onePercent == 0) {
            return _library.getRatePerSecond(_leftBorder);
        }

        uint256 _firstRatePerSecond = _library.getRatePerSecond(_leftBorder);
        uint256 _secondRatePerSecond = _library.getRatePerSecond(_rightBorder);

        return
            ((_secondRatePerSecond - _firstRatePerSecond) *
                (_interestRatePerYear - (_leftBorder * _onePercent))) /
            _onePercent +
            _firstRatePerSecond;
    }
}
