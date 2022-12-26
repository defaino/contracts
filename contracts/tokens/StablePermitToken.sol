// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

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
        string memory _name,
        string memory _symbol,
        IRegistry _registry
    ) ERC20Permit(_name) ERC20(_name, _symbol) {
        registry = _registry;
    }

    function mint(address _account, uint256 _amount) external override onlyDesiredPool {
        _mint(_account, _amount);
    }

    function burn(address _account, uint256 _amount) external override onlyDesiredPool {
        _burn(_account, _amount);
    }
}
