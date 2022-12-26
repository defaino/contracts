// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@dlsl/dev-modules/contracts-registry/AbstractDependant.sol";
import "@dlsl/dev-modules/pool-contracts-registry/pool-factory/PublicBeaconProxy.sol";

import "./interfaces/IRegistry.sol";
import "./interfaces/ISystemPoolsRegistry.sol";
import "./interfaces/ISystemPoolsFactory.sol";
import "./interfaces/IBasicPool.sol";

contract SystemPoolsFactory is ISystemPoolsFactory, AbstractDependant {
    IRegistry private registry;
    ISystemPoolsRegistry private systemPoolsRegistry;

    modifier onlySystemPoolsRegistry() {
        require(
            address(systemPoolsRegistry) == msg.sender,
            "SystemPoolsFactory: Caller not a SystemPoolsRegistry."
        );
        _;
    }

    function setDependencies(address _contractsRegistry) external override dependant {
        registry = IRegistry(_contractsRegistry);

        systemPoolsRegistry = ISystemPoolsRegistry(registry.getSystemPoolsRegistryContract());
    }

    function newLiquidityPool(
        address _assetAddr,
        bytes32 _assetKey,
        string calldata _tokenSymbol
    ) external override onlySystemPoolsRegistry returns (address) {
        address _proxyAddr = _createPool(ISystemPoolsRegistry.PoolType.LIQUIDITY_POOL);

        ILiquidityPool(_proxyAddr).liquidityPoolInitialize(_assetAddr, _assetKey, _tokenSymbol);

        return _proxyAddr;
    }

    function newStablePool(
        address _assetAddr,
        bytes32 _assetKey
    ) external override onlySystemPoolsRegistry returns (address) {
        address _proxyAddr = _createPool(ISystemPoolsRegistry.PoolType.STABLE_POOL);

        IStablePool(_proxyAddr).stablePoolInitialize(_assetAddr, _assetKey);

        return _proxyAddr;
    }

    function _createPool(ISystemPoolsRegistry.PoolType _poolType) internal returns (address) {
        ISystemPoolsRegistry _poolsRegistry = systemPoolsRegistry;

        address _proxyAddr = address(
            new PublicBeaconProxy(_poolsRegistry.getPoolsBeacon(_poolType), "")
        );

        AbstractDependant(_proxyAddr).setDependencies(address(registry));
        AbstractDependant(_proxyAddr).setInjector(address(_poolsRegistry));

        return _proxyAddr;
    }
}
