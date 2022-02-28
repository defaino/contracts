// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

/**
 * @notice Part of the VaultAPI interface from yearn protocol repository
 * https://github.com/yearn/yearn-vaults/blob/main/contracts/BaseStrategy.sol
 */

interface IYearnVault {
    // NOTE: Vyper produces multiple signatures for a given function with "default" args
    function deposit() external returns (uint256);

    function deposit(uint256 amount) external returns (uint256);

    function deposit(uint256 amount, address recipient) external returns (uint256);

    // NOTE: Vyper produces multiple signatures for a given function with "default" args
    function withdraw() external returns (uint256);

    function withdraw(uint256 maxShares) external returns (uint256);

    function withdraw(uint256 maxShares, address recipient) external returns (uint256);

    function token() external view returns (address);

    function pricePerShare() external view returns (uint256);
}
