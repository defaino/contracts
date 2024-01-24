// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";

import "../interfaces/IRegistry.sol";
import "../interfaces/ISystemPoolsRegistry.sol";
import "../interfaces/IBasicPool.sol";
import "../interfaces/tokens/IStablePermitToken.sol";

import "../Registry.sol";

contract StablePermitToken is IStablePermitToken, ERC20Permit {
    IRegistry public immutable registry;

    modifier onlyDesiredPool() {
        require(
            ISystemPoolsRegistry(registry.getSystemPoolsRegistryContract()).existingLiquidityPools(
                msg.sender
            ),
            "StablePermitToken: Caller not a system pool."
        );
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        IRegistry registry_
    ) ERC20Permit(name_) ERC20(name_, symbol_) {
        registry = registry_;
    }

    function mint(address account_, uint256 amount_) external override onlyDesiredPool {
        _mint(account_, amount_);
    }

    function burn(address account_, uint256 amount_) external override onlyDesiredPool {
        _burn(account_, amount_);
    }
}
