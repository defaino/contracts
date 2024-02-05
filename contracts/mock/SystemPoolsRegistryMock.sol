// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "../core/SystemPoolsRegistry.sol";

contract SystemPoolsRegistryMock is SystemPoolsRegistry {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    function defaultValues() external {
        nativeAssetKey = bytes32("NK");
        rewardsAssetKey = bytes32("RK");
    }

    function getSystemOwnerAddr() public view returns (address) {
        return _systemOwnerAddr;
    }

    function setExistingLiquidityPool(address newLP_) external {
        existingLiquidityPools[newLP_] = true;
    }

    function setPoolType(bytes32 assetKey_, PoolType poolType_) external {
        poolsInfo[assetKey_].poolType = poolType_;
    }

    function addNewAsset(bytes32 assetKey_, address assetAddr_, PoolType poolType_) external {
        require(!_allSupportedAssetKeys.contains(assetKey_), "Asset already set.");

        _allSupportedAssetKeys.add(assetKey_);
        _poolTypesInfo[poolType_].supportedAssetKeys.add(assetKey_);
        poolsInfo[assetKey_] = PoolInfo(assetAddr_, poolType_);
    }

    function setRewardsAssetKeyToZero() external {
        rewardsAssetKey = bytes32(0);
    }

    function setRewardsAssetPoolToZero() external {
        poolsInfo[rewardsAssetKey].poolAddr = address(0);
    }

    function addOracle(bytes32 assetKey_, address assetAddr_, address chainlinkOracle_) external {
        _priceManager.addOracle(assetKey_, assetAddr_, chainlinkOracle_);
    }
}
