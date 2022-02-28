// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

/**
 * @notice The RegistryAPI interface from yearn protocol repository
 * https://github.com/yearn/yearn-vaults/blob/main/contracts/BaseRouter.sol
 */

interface IVaultRegistry {
    function governance() external view returns (address);

    function latestVault(address token) external view returns (address);

    function numVaults(address token) external view returns (uint256);

    function vaults(address token, uint256 deploymentId) external view returns (address);
}
