// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "../interfaces/IInterestRateLibrary.sol";

library AnnualRatesConverter {
    function getAnnualRate(
        uint256 _lowInterestPercentage,
        uint256 _highInterestPercentage,
        uint256 _currentUR,
        uint256 _lowURPercentage,
        uint256 _highURPercentage,
        uint256 _decimal
    ) internal pure returns (uint256) {
        uint256 _interestPerPercent =
            ((_highInterestPercentage - _lowInterestPercentage) * _decimal) /
                (_highURPercentage - _lowURPercentage);

        return
            (_interestPerPercent * (_currentUR - _lowURPercentage)) /
            _decimal +
            _lowInterestPercentage;
    }

    function convertToRatePerSecond(
        IInterestRateLibrary _library,
        uint256 _interestRatePerYear,
        uint256 _onePercent
    ) internal view returns (uint256) {
        uint256 _libraryPrecision = _library.getLibraryPrecision();

        require(
            _interestRatePerYear * _libraryPrecision <=
                _library.maxSupportedPercentage() * _onePercent,
            "AnnualRatesConverter: Interest rate is not supported."
        );

        uint256 _precisionFactor = _libraryPrecision;

        if (
            _interestRatePerYear * _libraryPrecision <
            _library.getLimitOfExactValues() * _onePercent
        ) {
            _interestRatePerYear *= _libraryPrecision;

            _precisionFactor = 1;
        }

        uint256 _leftBorder = (_interestRatePerYear / _onePercent) * _precisionFactor;
        uint256 _rightBorder = _leftBorder + _precisionFactor;

        if (_interestRatePerYear % _onePercent == 0) {
            return _library.ratesPerSecond(_leftBorder);
        }

        uint256 _firstRatePerSecond = _library.ratesPerSecond(_leftBorder);
        uint256 _secondRatePerSecond = _library.ratesPerSecond(_rightBorder);

        return
            ((_secondRatePerSecond - _firstRatePerSecond) *
                (_interestRatePerYear - (_leftBorder * _onePercent) / _precisionFactor)) /
            _onePercent +
            _firstRatePerSecond;
    }
}
