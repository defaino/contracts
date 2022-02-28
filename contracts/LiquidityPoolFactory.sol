// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.8.3;

import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import "./interfaces/ILiquidityPoolAdmin.sol";
import "./interfaces/ILiquidityPool.sol";

import "./Registry.sol";
import "./common/AbstractDependant.sol";

contract LiquidityPoolFactory is AbstractDependant {
    Registry private registry;
    ILiquidityPoolAdmin private liquidityPoolAdmin;
    address private liquidityPoolRegistry;

    function setDependencies(Registry _registry) external override onlyInjectorOrZero {
        registry = _registry;
        liquidityPoolAdmin = ILiquidityPoolAdmin(_registry.getLiquidityPoolAdminContract());
        liquidityPoolRegistry = registry.getLiquidityPoolRegistryContract();
    }

    modifier onlyLiquidityPoolRegistry() {
        require(
            liquidityPoolRegistry == msg.sender,
            "LiquidityPoolFactory: Caller not an AssetParameters."
        );
        _;
    }

    function newLiquidityPool(
        address _assetAddr,
        bytes32 _assetKey,
        string calldata _tokenSymbol
    ) external onlyLiquidityPoolRegistry returns (address) {
        ILiquidityPoolAdmin _liquidityPoolAdmin = liquidityPoolAdmin;

        TransparentUpgradeableProxy _proxy =
            new TransparentUpgradeableProxy(
                _liquidityPoolAdmin.getCurrentLiquidityPoolsImplementation(),
                _liquidityPoolAdmin.getUpgrader(),
                ""
            );

        ILiquidityPool(address(_proxy)).liquidityPoolInitialize(
            _assetAddr,
            _assetKey,
            _tokenSymbol
        );

        AbstractDependant(address(_proxy)).setDependencies(registry);
        AbstractDependant(address(_proxy)).setInjector(address(_liquidityPoolAdmin));

        return address(_proxy);
    }
}
