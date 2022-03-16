// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

/**
 * This contract is a factory for deploying new pools
 */
interface ILiquidityPoolFactory {
    /// @notice This function is needed for deploying a new pool
    /// @dev Only LiquidityPoolRegistry contract can call this function
    /// @param _assetAddr address of the underlying pool asset
    /// @param _assetKey pool key of the new liquidity pool
    /// @param _tokenSymbol symbol of the underlying pool asset
    /// @return a new liquidity pool address
    function newLiquidityPool(
        address _assetAddr,
        bytes32 _assetKey,
        string calldata _tokenSymbol
    ) external returns (address);
}
