// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@dlsl/dev-modules/contracts-registry/AbstractDependant.sol";
import "@dlsl/dev-modules/pool-contracts-registry/pool-factory/PublicBeaconProxy.sol";

import "./interfaces/IRegistry.sol";
import "./interfaces/ISystemPoolsRegistry.sol";
import "./interfaces/ISystemPoolsFactory.sol";
import "./interfaces/IBasicPool.sol";

contract SystemPoolsFactory is ISystemPoolsFactory, AbstractDependant {
    IRegistry internal _registry;
    ISystemPoolsRegistry internal _systemPoolsRegistry;

    modifier onlySystemPoolsRegistry() {
        require(
            address(_systemPoolsRegistry) == msg.sender,
            "SystemPoolsFactory: Caller not a SystemPoolsRegistry."
        );
        _;
    }

    function setDependencies(address _contractsRegistry) external override dependant {
        _registry = IRegistry(_contractsRegistry);

        _systemPoolsRegistry = ISystemPoolsRegistry(_registry.getSystemPoolsRegistryContract());
    }

    function newLiquidityPool(
        address assetAddr_,
        bytes32 assetKey_,
        string calldata tokenSymbol_
    ) external override onlySystemPoolsRegistry returns (address) {
        address proxyAddr_ = _createPool(ISystemPoolsRegistry.PoolType.LIQUIDITY_POOL);

        ILiquidityPool(proxyAddr_).liquidityPoolInitialize(assetAddr_, assetKey_, tokenSymbol_);

        return proxyAddr_;
    }

    function newStablePool(
        address assetAddr_,
        bytes32 assetKey_
    ) external override onlySystemPoolsRegistry returns (address) {
        address proxyAddr_ = _createPool(ISystemPoolsRegistry.PoolType.STABLE_POOL);

        IStablePool(proxyAddr_).stablePoolInitialize(assetAddr_, assetKey_);

        return proxyAddr_;
    }

    function _createPool(ISystemPoolsRegistry.PoolType poolType_) internal returns (address) {
        ISystemPoolsRegistry _poolsRegistry = _systemPoolsRegistry;

        address proxyAddr_ = address(
            new PublicBeaconProxy(_poolsRegistry.getPoolsBeacon(poolType_), "")
        );

        AbstractDependant(proxyAddr_).setDependencies(address(_registry));
        AbstractDependant(proxyAddr_).setInjector(address(_poolsRegistry));

        return proxyAddr_;
    }
}
