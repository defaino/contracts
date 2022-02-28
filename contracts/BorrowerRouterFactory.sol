// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.8.3;

import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

import "./interfaces/IBorrowerRouter.sol";
import "./interfaces/IBorrowerRouterFactory.sol";
import "./interfaces/IBorrowerRouterRegistry.sol";

import "./Registry.sol";
import "./BorrowerRouter.sol";
import "./common/AbstractDependant.sol";

contract BorrowerRouterFactory is IBorrowerRouterFactory, AbstractDependant {
    Registry private registry;
    IBorrowerRouterRegistry private borrowerRouterRegistry;
    address private integrationCoreAddr;

    modifier onlyIntegrationCore() {
        require(
            integrationCoreAddr == msg.sender,
            "BorrowerRouterFactory: Caller not an IntegrationCore."
        );
        _;
    }

    function setDependencies(Registry _registry) external override onlyInjectorOrZero {
        registry = _registry;
        borrowerRouterRegistry = IBorrowerRouterRegistry(
            _registry.getBorrowerRouterRegistryContract()
        );
        integrationCoreAddr = _registry.getIntegrationCoreContract();
    }

    function newBorrowerRouter(address _userAddr)
        external
        override
        onlyIntegrationCore
        returns (address)
    {
        BeaconProxy _proxy = new BeaconProxy(
            borrowerRouterRegistry.getBorrowerRoutersBeacon(),
            ""
        );

        IBorrowerRouter(address(_proxy)).borrowerRouterInitialize(address(registry), _userAddr);

        return address(_proxy);
    }
}
