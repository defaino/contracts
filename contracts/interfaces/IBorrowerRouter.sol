// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

interface IBorrowerRouter {
    struct VaultDepositInfo {
        uint256 amountInVaultToken;
        address vaultAddr;
    }

    function borrowerRouterInitialize(address _registryAddr, address _userAddr) external;

    function getUserDepositedAmountInAsset(address _assetAddr, address _vaultTokenAddr)
        external
        view
        returns (uint256);

    function getUserRewardInAsset(address _assetAddr, address _vaultTokenAddr)
        external
        view
        returns (uint256);

    function increaseAllowance(address _tokenAddr) external;

    function depositOfAssetInToken(address _assetAddr, address _vaultTokenAddr)
        external
        view
        returns (uint256);

    function deposit(address _assetAddr, address _vaultTokenAddr) external;

    function withdraw(
        address _assetAddr,
        address _vaultTokenAddr,
        uint256 _amount,
        bool _isMaxWithdraw
    ) external returns (uint256);
}
