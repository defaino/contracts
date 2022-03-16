// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "../interfaces/IDefiCore.sol";
import "../interfaces/ILiquidityPoolRegistry.sol";
import "../interfaces/ILiquidityPool.sol";

/**
 * This is a library with auxiliary functions for working with liquidity pools
 */
library AssetsHelperLibrary {
    /// @notice Function to get the amount of user borrow in dollars from a specific pool
    /// @param _assetKey the key of the pool from which you want to get information
    /// @param _userAddr Address of the user for whom you want to get information
    /// @param _registry address of the LiquidityPoolRegistry contract
    /// @param _core address of the DefiCore contract
    /// @return a user borrow amount in dollars
    function getCurrentBorrowAmountInUSD(
        bytes32 _assetKey,
        address _userAddr,
        ILiquidityPoolRegistry _registry,
        IDefiCore _core
    ) internal view returns (uint256) {
        ILiquidityPool _currentLiquidityPool = ILiquidityPool(_registry.liquidityPools(_assetKey));

        return
            _currentLiquidityPool.getAmountInUSD(
                _core.getUserBorrowedAmount(_userAddr, _assetKey)
            );
    }

    /// @notice Function to get the address of the liquidity pool with check for
    /// @param _assetKey the key of the pool whose address you want to get
    /// @param _registry address of the LiquidityPoolRegistry contract
    /// @return a resulting liquidity pool
    function getAssetLiquidityPool(bytes32 _assetKey, ILiquidityPoolRegistry _registry)
        internal
        view
        returns (ILiquidityPool)
    {
        ILiquidityPool _assetLiquidityPool = ILiquidityPool(_registry.liquidityPools(_assetKey));

        require(
            address(_assetLiquidityPool) != address(0),
            "AssetsHelperLibrary: LiquidityPool doesn't exists."
        );

        return _assetLiquidityPool;
    }
}
