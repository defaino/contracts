// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.8.3;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

import "./interfaces/IBorrowerRouterRegistry.sol";

import "./Registry.sol";
import "./BorrowerRouter.sol";
import "./common/AbstractDependant.sol";

contract BorrowerRouterRegistry is IBorrowerRouterRegistry, AbstractDependant, OwnableUpgradeable {
    address private integrationCoreAddr;
    UpgradeableBeacon private borrowerRoutersBeacon;

    // User address => borrower router address
    mapping(address => address) public override borrowerRouters;

    event BorrowerRouterUpdated(
        address _userAddr,
        address _prevBorrowerRouter,
        address _newBorrowerRouter
    );

    modifier onlyIntegrationCore() {
        require(
            integrationCoreAddr == msg.sender,
            "BorrowerRouterRegistry: Caller not an IntegrationCore."
        );
        _;
    }

    function borrowerRouterRegistryInitialize(address _borrowerRouterImplementation)
        external
        initializer
    {
        __Ownable_init();

        borrowerRoutersBeacon = new UpgradeableBeacon(_borrowerRouterImplementation);
    }

    function setDependencies(Registry _registry) external override onlyInjectorOrZero {
        integrationCoreAddr = _registry.getIntegrationCoreContract();
    }

    function getBorrowerRoutersBeacon() external view override returns (address) {
        return address(borrowerRoutersBeacon);
    }

    function isBorrowerRouterExists(address _userAddr) external view override returns (bool) {
        return borrowerRouters[_userAddr] != address(0);
    }

    function updateUserBorrowerRouter(address _userAddr, address _newBorrowerRouter)
        external
        override
        onlyIntegrationCore
    {
        address _currentBorrowerRouter = borrowerRouters[_userAddr];

        if (_currentBorrowerRouter != _newBorrowerRouter) {
            borrowerRouters[_userAddr] = _newBorrowerRouter;

            emit BorrowerRouterUpdated(_userAddr, _currentBorrowerRouter, _newBorrowerRouter);
        }
    }

    function upgradeBorrowerRouterImpl(address _newBorrowerRouterImpl) external onlyOwner {
        borrowerRoutersBeacon.upgradeTo(_newBorrowerRouterImpl);
    }
}
