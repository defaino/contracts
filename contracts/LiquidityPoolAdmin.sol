// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.8.3;

import "@openzeppelin/contracts/utils/Address.sol";

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./interfaces/ILiquidityPoolAdmin.sol";
import "./interfaces/ILiquidityPoolRegistry.sol";

import "./Registry.sol";
import "./common/Upgrader.sol";
import "./common/AbstractDependant.sol";

contract LiquidityPoolAdmin is ILiquidityPoolAdmin, OwnableUpgradeable, AbstractDependant {
    Registry private registry;
    ILiquidityPoolRegistry private liquidityPoolRegistry;

    Upgrader internal upgrader;
    address internal liquidityPoolImplementationAddress;

    function liquidityPoolAdminInitialize(address _liquidityPoolImplementationAddress)
        external
        initializer
    {
        require(
            _liquidityPoolImplementationAddress != address(0),
            "LiquidityPoolAdmin: Zero address."
        );

        __Ownable_init();

        upgrader = new Upgrader();

        liquidityPoolImplementationAddress = _liquidityPoolImplementationAddress;
    }

    function setDependencies(Registry _registry) external override onlyInjectorOrZero {
        registry = _registry;
        liquidityPoolRegistry = ILiquidityPoolRegistry(
            _registry.getLiquidityPoolRegistryContract()
        );
    }

    function injectDependenciesToExistingLiquidityPools() external onlyOwner {
        Registry _registry = registry;
        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;

        address[] memory _liquidityPools = _poolRegistry.getAllLiquidityPools();

        for (uint256 i = 0; i < _liquidityPools.length; i++) {
            AbstractDependant dependant = AbstractDependant(_liquidityPools[i]);

            if (dependant.injector() == address(0)) {
                dependant.setInjector(address(this));
            }

            dependant.setDependencies(_registry);
        }
    }

    function getUpgrader() external view override returns (address) {
        require(address(upgrader) != address(0), "LiquidityPoolAdmin: Bad upgrader");

        return address(upgrader);
    }

    function getImplementationOfLiquidityPool(address _liquidityPoolAddress)
        external
        view
        override
        returns (address)
    {
        require(
            liquidityPoolRegistry.existingLiquidityPools(_liquidityPoolAddress),
            "LiquidityPoolAdmin: Not a liquidityPool."
        );

        return upgrader.getImplementation(_liquidityPoolAddress);
    }

    function getCurrentLiquidityPoolsImplementation() external view override returns (address) {
        return liquidityPoolImplementationAddress;
    }

    function upgradeLiquidityPools(address _liquidityPoolImpl) external onlyOwner {
        _upgradeLiquidityPools(_liquidityPoolImpl, "");
    }

    /// @notice can only call functions that have no parameters
    function upgradeLiquidityPoolsAndCall(
        address _liquidityPoolImpl,
        string calldata _functionSignature
    ) external onlyOwner {
        _upgradeLiquidityPools(_liquidityPoolImpl, _functionSignature);
    }

    function _setLiquidityPoolImplementation(address _liquidityPoolImpl) internal {
        if (liquidityPoolImplementationAddress != _liquidityPoolImpl) {
            liquidityPoolImplementationAddress = _liquidityPoolImpl;
        }
    }

    function _upgradeLiquidityPools(address _liquidityPoolImpl, string memory _functionSignature)
        internal
    {
        require(_liquidityPoolImpl != address(0), "LiquidityPoolAdmin: Zero address");
        require(Address.isContract(_liquidityPoolImpl), "LiquidityPoolAdmin: Invalid address");

        _setLiquidityPoolImplementation(_liquidityPoolImpl);

        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;

        address[] memory _liquidityPools = _poolRegistry.getAllLiquidityPools();

        for (uint256 i = 0; i < _liquidityPools.length; i++) {
            if (bytes(_functionSignature).length > 0) {
                upgrader.upgradeAndCall(
                    _liquidityPools[i],
                    _liquidityPoolImpl,
                    abi.encodeWithSignature(_functionSignature)
                );
            } else {
                upgrader.upgrade(_liquidityPools[i], _liquidityPoolImpl);
            }
        }
    }
}
