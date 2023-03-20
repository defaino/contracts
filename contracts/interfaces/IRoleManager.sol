// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

/**
 * This contract stores different roles across the protocol and their corresponding accounts.
 * It also can be used for checking whether a particular user has a specific role, creating, granting and revoking the roles.
 * The contract also stores a set of constants with the role names which are used across the protocol.
 */
interface IRoleManager {
    /// @notice Function for granting the role to the specified account
    /// @dev Only user with the ROLE_MANAGER_ROLE_GOVERNOR or ROLE_MANAGER_ADMIN role can call this function
    /// @param role_ role to grant to the account
    /// @param account_ account to grant the role to
    function grantRole(bytes32 role_, address account_) external;

    /// @notice Function for revoking the role from the specified account
    /// @dev Only user with the ROLE_MANAGER_ROLE_GOVERNOR or ROLE_MANAGER_ADMIN role can call this function
    /// @param role_ role to revoke from the account
    /// @param account_ account to revoke the role from
    function revokeRole(bytes32 role_, address account_) external;

    /// @notice Function to check whether the address has the ASSET_PARAMETERS_MANAGER or ROLE_MANAGER_ADMIN role
    /// @dev Used in AssetParameters contract to check the caller's roles in some function. Reverts if the account has neither of the roles mentioned above.
    function isAssetParametersManager(address account_) external view;

    /// @notice Function to check whether the address has the DEFI_CORE_PAUSER or ROLE_MANAGER_ADMIN role
    /// @dev Used in DefiCore contract to check the caller's roles in some function. Reverts if the account has neither of the roles mentioned above.
    function isDefiCorePauser(address account_) external view;

    /// @notice Function to check whether the address has the PRT_PARAM_UPDATER or ROLE_MANAGER_ADMIN role
    /// @dev Used in PRT contract to check the caller's roles in some function. Reverts if the account has neither of the roles mentioned above.
    function isPRTParamUpdater(address account_) external view;

    /// @notice Function to check whether the address has the REWARDS_DISTRIBUTION_MANAGER or ROLE_MANAGER_ADMIN role
    /// @dev Used in RewardsDistribution contract to check the caller's roles in some function. Reverts if the account has neither of the roles mentioned above.
    function isRewardsDistributionManager(address account_) external view;

    /// @notice Function to check whether the address has the SYSTEM_PARAMETERS_MANAGER or ROLE_MANAGER_ADMIN role
    /// @dev Used in SystemParameters contract to check the caller's roles in some function. Reverts if the account has neither of the roles mentioned above.
    function isSystemParametersManager(address account_) external view;

    /// @notice Function to check whether the address has the SYSTEM_POOLS_MANAGER or ROLE_MANAGER_ADMIN role
    /// @dev Used in SystemPoolManager contract to check the caller's roles in some function. Reverts if the account has neither of the roles mentioned above.
    function isSystemPoolsManager(address account_) external view;

    /// @notice Function to check whether the address has the SYSTEM_POOLS_RESERVE_FUNDS_MANAGER or ROLE_MANAGER_ADMIN role
    /// @dev Used in SystemPoolManager contract to check the caller's roles in some function. Reverts if the account has neither of the roles mentioned above.
    function isSystemPoolsReserveFundsManager(address account_) external view;
}
