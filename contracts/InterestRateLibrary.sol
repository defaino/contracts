// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.8.3;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IInterestRateLibrary.sol";

/// @dev The contract stores the values of the second rates,
/// which were calculated by the formula ((1 + x) ^ (1/31536000) -1)
contract InterestRateLibrary is IInterestRateLibrary, Ownable {
    // interest rate percent per year (with precision 10) => interest rate percent per second
    mapping(uint256 => uint256) public override ratesPerSecond;

    uint256 public override maxSupportedPercentage;

    constructor(uint256[] memory _exactRatesPerSecond) {
        uint256 _limitOfExactValues = getLimitOfExactValues();

        require(
            _exactRatesPerSecond.length == _limitOfExactValues,
            "InterestRateLibrary: Incorrect number of exact values."
        );

        // Add exact values
        _addRates(0, _exactRatesPerSecond, 1);
    }

    function addNewRates(uint256 _startPercentage, uint256[] calldata _ratesPerSecond)
        external
        override
        onlyOwner
    {
        uint256 _maxSupportedPercentage = maxSupportedPercentage;
        uint256 _libraryPrecision = _maxSupportedPercentage < getLimitOfExactValues()
            ? 1
            : getLibraryPrecision();

        require(
            _startPercentage == _maxSupportedPercentage + _libraryPrecision,
            "InterestRateLibrary: Incorrect starting percentage to add."
        );

        _addRates(_startPercentage, _ratesPerSecond, _libraryPrecision);
    }

    function getLibraryPrecision() public view virtual override returns (uint256) {
        return 10;
    }

    function getLimitOfExactValues() public view virtual override returns (uint256) {
        return 10 * getLibraryPrecision();
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

        maxSupportedPercentage = _startPercentage + _listLengthWithPrecision - _precision;
    }
}
