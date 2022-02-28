// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "../../interfaces/YEarn/IVaultRegistry.sol";

/**
 * @notice Implicit implementation of IController interface
 */

contract VaultRegistryMock is IVaultRegistry {
    using EnumerableSet for EnumerableSet.AddressSet;

    address public override governance = address(0);

    mapping(address => EnumerableSet.AddressSet) internal _vaults;

    function latestVault(address token) external view override returns (address _vaultAddr) {
        uint256 _vaultsCount = _vaults[token].length();

        if (_vaultsCount > 0) {
            _vaultAddr = _vaults[token].at(_vaultsCount - 1);
        }
    }

    function numVaults(address token) external view override returns (uint256) {
        return _vaults[token].length();
    }

    function vaults(address token, uint256 deploymentId) external view override returns (address) {
        uint256 _vaultsCount = _vaults[token].length();

        require(deploymentId < _vaultsCount, "VaultRegistryMock: Index out of bounds.");

        return _vaults[token].at(deploymentId);
    }

    function addVault(address tokenAddr, address vaultAddr) external {
        _vaults[tokenAddr].add(vaultAddr);
    }

    function clearVaults(address tokenAddr) external {
        delete _vaults[tokenAddr];
    }
}
