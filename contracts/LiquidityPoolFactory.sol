// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.8.3;

import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

import "./interfaces/ILiquidityPool.sol";
import "./interfaces/ILiquidityPoolRegistry.sol";

import "./Registry.sol";
import "./abstract/AbstractDependant.sol";

contract LiquidityPoolFactory is AbstractDependant {
    Registry private registry;
    ILiquidityPoolRegistry private liquidityPoolRegistry;

    function setDependencies(Registry _registry) external override onlyInjectorOrZero {
        registry = _registry;
        liquidityPoolRegistry = ILiquidityPoolRegistry(
            registry.getLiquidityPoolRegistryContract()
        );
    }

    function newLiquidityPool(
        address _assetAddr,
        bytes32 _assetKey,
        string calldata _tokenSymbol
    ) external returns (address) {
        ILiquidityPoolRegistry _liquidityPoolRegistry = liquidityPoolRegistry;

        require(
            address(_liquidityPoolRegistry) == msg.sender,
            "LiquidityPoolFactory: Caller not an AssetParameters."
        );

        BeaconProxy _proxy = new BeaconProxy(_liquidityPoolRegistry.getLiquidityPoolsBeacon(), "");

        ILiquidityPool(address(_proxy)).liquidityPoolInitialize(
            _assetAddr,
            _assetKey,
            _tokenSymbol
        );

        AbstractDependant(address(_proxy)).setDependencies(registry);
        AbstractDependant(address(_proxy)).setInjector(address(_liquidityPoolRegistry));

        return address(_proxy);
    }
}
