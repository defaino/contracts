// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "../interfaces/IDefiCore.sol";
import "../interfaces/ISystemPoolsRegistry.sol";
import "../interfaces/IBasicPool.sol";

/**
 * This is a library with auxiliary functions for working with liquidity pools
 */
library AssetsHelperLibrary {
    /// @notice Function to get the amount of user deposit in dollars from a specific pool
    /// @param assetKey_ the key of the pool from which you want to get information
    /// @param userAddr_ address of the user for whom you want to get information
    /// @param poolsRegistry_ address of the SystemPoolsRegistry contract
    /// @param core_ address of the DefiCore contract
    /// @return a user supply amount in dollars
    function getCurrentSupplyAmountInUSD(
        bytes32 assetKey_,
        address userAddr_,
        ISystemPoolsRegistry poolsRegistry_,
        IDefiCore core_
    ) internal view returns (uint256) {
        return
            getAssetLiquidityPool(assetKey_, poolsRegistry_).getAmountInUSD(
                core_.getUserLiquidityAmount(userAddr_, assetKey_)
            );
    }

    /// @notice Function to get the amount of user borrow in dollars from a specific pool
    /// @param assetKey_ the key of the pool from which you want to get information
    /// @param userAddr_ address of the user for whom you want to get information
    /// @param poolsRegistry_ address of the SystemPoolsRegistry contract
    /// @param core_ address of the DefiCore contract
    /// @return a user borrow amount in dollars
    function getCurrentBorrowAmountInUSD(
        bytes32 assetKey_,
        address userAddr_,
        ISystemPoolsRegistry poolsRegistry_,
        IDefiCore core_
    ) internal view returns (uint256) {
        return
            getAssetLiquidityPool(assetKey_, poolsRegistry_).getAmountInUSD(
                core_.getUserBorrowedAmount(userAddr_, assetKey_)
            );
    }

    /// @notice Function to get the address of the liquidity pool with check for
    /// @param assetKey_ the key of the pool whose address you want to get
    /// @param poolsRegistry_ address of the SystemPoolsRegistry contract
    /// @return a resulting liquidity pool
    function getAssetLiquidityPool(
        bytes32 assetKey_,
        ISystemPoolsRegistry poolsRegistry_
    ) internal view returns (ILiquidityPool) {
        (address poolAddr_, ) = poolsRegistry_.poolsInfo(assetKey_);

        require(poolAddr_ != address(0), "AssetsHelperLibrary: LiquidityPool doesn't exists.");

        return ILiquidityPool(poolAddr_);
    }
}
