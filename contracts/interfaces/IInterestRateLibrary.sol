// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

/**
 * This contract is needed to store and obtain the second rates of their annual rates
 */
interface IInterestRateLibrary {
    /// @notice The function returns the library precision
    /// @dev For default library precision equals to 10^1
    /// @return a current library precision
    function LIBRARY_PRECISION() external view returns (uint256);

    /// @notice The function returns the current max supported percentage
    /// @return a max supported percentage with library precision
    function MAX_SUPPORTED_PERCENTAGE() external view returns (uint256);

    /// @notice The function returns the second rate for the passed annual rate
    /// @dev The passed annual rate must be with the precision of the library
    /// @param annualRate_ annual rate to be converted
    /// @return a converted second rate
    function getRatePerSecond(uint256 annualRate_) external view returns (uint256);
}
