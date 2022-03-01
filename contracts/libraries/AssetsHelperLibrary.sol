// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/utils/math/Math.sol";

import "../interfaces/IDefiCore.sol";
import "../interfaces/IAssetParameters.sol";
import "../interfaces/ILiquidityPoolRegistry.sol";
import "../interfaces/ISystemParameters.sol";
import "../interfaces/ILiquidityPool.sol";

import "./MathHelper.sol";
import "../common/Globals.sol";

library AssetsHelperLibrary {
    using MathHelper for uint256;

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
