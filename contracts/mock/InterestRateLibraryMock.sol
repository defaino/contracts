// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @dev The contract stores the values of the second rates,
/// which were calculated by the formula ((1 + x) ^ (1/31536000) -1)
contract InterestRateLibraryMock is Ownable {
    // interest rate percent per year (with precision 10) => interest rate percent per second
    mapping(uint256 => uint256) public ratesPerSecond;

    uint256 public MAX_SUPPORTED_PERCENTAGE;

    constructor(uint256[] memory exactRatesPerSecond_) {
        uint256 limitOfExactValues_ = getLimitOfExactValues();

        require(
            exactRatesPerSecond_.length == limitOfExactValues_,
            "InterestRateLibrary: Incorrect number of exact values."
        );

        // Add exact values
        _addRates(1, exactRatesPerSecond_, 1);
    }

    function addNewRates(
        uint256 _startPercentage,
        uint256[] calldata _ratesPerSecond
    ) external onlyOwner {
        uint256 _libraryPrecision = LIBRARY_PRECISION();

        require(
            _startPercentage == MAX_SUPPORTED_PERCENTAGE + _libraryPrecision,
            "InterestRateLibrary: Incorrect starting percentage to add."
        );

        _addRates(_startPercentage, _ratesPerSecond, _libraryPrecision);
    }

    function getRatePerSecond(uint256 annualRate_) external view returns (uint256) {
        require(
            annualRate_ <= MAX_SUPPORTED_PERCENTAGE,
            "InterestRateLibrary: Unsupported percentage."
        );

        return ratesPerSecond[annualRate_];
    }

    function LIBRARY_PRECISION() public view virtual returns (uint256) {
        return 10;
    }

    function getLimitOfExactValues() public view virtual returns (uint256) {
        return 100 * LIBRARY_PRECISION();
    }

    function _addRates(
        uint256 _startPercentage,
        uint256[] memory _ratesPerSecond,
        uint256 _precision
    ) internal virtual {
        uint256 _listLengthWithPrecision = _ratesPerSecond.length * _precision;

        for (uint256 i = 0; i < _listLengthWithPrecision; i += _precision) {
            ratesPerSecond[_startPercentage + i] = _ratesPerSecond[i / _precision];
        }

        MAX_SUPPORTED_PERCENTAGE = _startPercentage + _listLengthWithPrecision - _precision;
    }
}
