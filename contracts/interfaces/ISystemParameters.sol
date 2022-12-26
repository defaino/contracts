// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

/**
 * This is a contract for storage and convenient retrieval of system parameters
 */
interface ISystemParameters {
    /// @notice The event that is emmited after updating of the rewards token address parameter
    /// @param _rewardsToken a new rewards token address value
    event RewardsTokenUpdated(address _rewardsToken);

    /// @notice The event that is emmited after updating the parameter with the same name
    /// @param _newValue new liquidation boundary parameter value
    event LiquidationBoundaryUpdated(uint256 _newValue);

    /// @notice The event that is emmited after updating the parameter with the same name
    /// @param _newValue new stable pools availability parameter value
    event StablePoolsAvailabilityUpdated(bool _newValue);

    /// @notice The event that is emmited after updating the parameter with the same name
    /// @param _newValue new min currency amount parameter value
    event MinCurrencyAmountUpdated(uint256 _newValue);

    /// @notice The function that updates the rewards token address. Can update only if current rewards token address is zero address
    /// @dev Only owner of this contract can call this function
    /// @param _rewardsToken new value of the rewards token parameter
    function setRewardsTokenAddress(address _rewardsToken) external;

    /// @notice The function that updates the parameter of the same name to a new value
    /// @dev Only owner of this contract can call this function
    /// @param _newValue new value of the liquidation boundary parameter
    function setupLiquidationBoundary(uint256 _newValue) external;

    /// @notice The function that updates the parameter of the same name to a new value
    /// @dev Only owner of this contract can call this function
    /// @param _newValue new value of the stable pools availability parameter
    function setupStablePoolsAvailability(bool _newValue) external;

    /// @notice The function that updates the parameter of the same name
    /// @dev Only owner of this contract can call this function
    /// @param _newMinCurrencyAmount new value of the min currency amount parameter
    function setupMinCurrencyAmount(uint256 _newMinCurrencyAmount) external;

    ///@notice The function that returns the values of rewards token parameter
    ///@return current rewards token address
    function getRewardsTokenAddress() external view returns (address);

    ///@notice The function that returns the values of liquidation boundary parameter
    ///@return current liquidation boundary parameter value
    function getLiquidationBoundary() external view returns (uint256);

    ///@notice The function that returns the values of stable pools availability parameter
    ///@return current stable pools availability parameter value
    function getStablePoolsAvailability() external view returns (bool);

    ///@notice The function that returns the value of the min currency amount parameter
    ///@return current min currency amount parameter value
    function getMinCurrencyAmount() external view returns (uint256);
}
