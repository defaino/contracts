// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "./ISystemPoolsRegistry.sol";

/**
 * This contract is a factory for deploying new system pools
 */
interface ISystemPoolsFactory {
    /// @notice This function is needed for deploying a new liquidity pool
    /// @dev Only SystemPoolsRegistry contract can call this function
    /// @param assetAddr_ address of the underlying pool asset
    /// @param assetKey_ pool key of the new liquidity pool
    /// @param tokenSymbol_ symbol of the underlying pool asset
    /// @return a new liquidity pool address
    function newLiquidityPool(
        address assetAddr_,
        bytes32 assetKey_,
        string calldata tokenSymbol_
    ) external returns (address);

    /// @notice This function is needed for deploying a new stable pool
    /// @dev Only SystemPoolsRegistry contract can call this function
    /// @param assetAddr_ address of the underlying pool asset
    /// @param assetKey_ pool key of the new stable pool
    /// @return a new stable pool address
    function newStablePool(address assetAddr_, bytes32 assetKey_) external returns (address);
}
