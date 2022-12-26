// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "../SystemPoolsRegistry.sol";

contract SystemPoolsRegistryMock is SystemPoolsRegistry {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    function defaultValues() external {
        nativeAssetKey = bytes32("NK");
        rewardsAssetKey = bytes32("RK");
    }

    function setExistingLiquidityPool(address _newLP) external {
        existingLiquidityPools[_newLP] = true;
    }

    function setPoolType(bytes32 _assetKey, PoolType _poolType) external {
        poolsInfo[_assetKey].poolType = _poolType;
    }

    function addNewAsset(bytes32 _assetKey, address _assetAddr, PoolType _poolType) external {
        require(!allSupportedAssetKeys.contains(_assetKey), "Asset already set.");

        allSupportedAssetKeys.add(_assetKey);
        poolTypesInfo[_poolType].supportedAssetKeys.add(_assetKey);
        poolsInfo[_assetKey] = PoolInfo(_assetAddr, _poolType);
    }

    function addOracle(bytes32 _assetKey, address _assetAddr, address _chainlinkOracle) external {
        priceManager.addOracle(_assetKey, _assetAddr, _chainlinkOracle);
    }
}
