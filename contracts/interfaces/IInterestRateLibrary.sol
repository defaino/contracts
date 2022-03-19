// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

/**
 * This contract is needed to store and obtain the second rates of their annual rates
 */
interface IInterestRateLibrary {
    /// @notice Function for adding new values to the interest rate library
    /// @dev Only contract owner can call this function
    /// @param _startPercentage Percentage at which the addition will start
    /// @param _ratesPerSecond an array with second rates
    function addNewRates(uint256 _startPercentage, uint256[] calldata _ratesPerSecond) external;

    /// @notice The function returns the second rate for the passed annual rate
    /// @param _annualRate annual rate to be converted
    /// @return _ratePerSecond converted second rate
    function ratesPerSecond(uint256 _annualRate) external view returns (uint256 _ratePerSecond);

    /// @notice The function returns the library precision
    /// @dev For default library precision equals to 10^1
    /// @return _libraryPrecision current library precision
    function getLibraryPrecision() external view returns (uint256 _libraryPrecision);

    /// @notice The function returns the limit of exact values with current library precision
    /// @return limit of exact values
    function getLimitOfExactValues() external view returns (uint256);

    /// @notice The function returns the current max supported percentage
    /// @return max supported percentage with library decimals
    function maxSupportedPercentage() external view returns (uint256);
}
