// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "./ISystemPoolsRegistry.sol";

/**
 * This contract is a factory for deploying new system pools
 */
interface ISystemPoolsFactory {
    /// @notice This function is needed for deploying a new liquidity pool
    /// @dev Only SystemPoolsRegistry contract can call this function
    /// @param _assetAddr address of the underlying pool asset
    /// @param _assetKey pool key of the new liquidity pool
    /// @param _tokenSymbol symbol of the underlying pool asset
    /// @return a new liquidity pool address
    function newLiquidityPool(
        address _assetAddr,
        bytes32 _assetKey,
        string calldata _tokenSymbol
    ) external returns (address);

    /// @notice This function is needed for deploying a new stable pool
    /// @dev Only SystemPoolsRegistry contract can call this function
    /// @param _assetAddr address of the underlying pool asset
    /// @param _assetKey pool key of the new stable pool
    /// @return a new stable pool address
    function newStablePool(address _assetAddr, bytes32 _assetKey) external returns (address);
}
