pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";

contract RoleManager is AccessControlUpgradeable {
    bytes32 constant ROLE_MANAGER_ADMIN = keccak256("ROLE_MANAGER_ADMIN");

    bytes32 constant ROLE_MANAGER_ROLE_GOVERNOR = keccak256("ROLE_MANAGER_ROLE_GOVERNOR");

    bytes32 constant ASSET_PARAMETERS_MANAGER = keccak256("ASSET_PARAMETERS_MANAGER");

    bytes32 constant DEFI_CORE_PAUSER = keccak256("DEFI_CORE_PAUSER");

    bytes32 constant PRT_PARAM_UPDATER = keccak256("PRT_PARAM_UPDATER");

    bytes32 constant REWARDS_DISTRIBUTION_MANAGER = keccak256("REWARDS_DISTRIBUTION_MANAGER");

    bytes32 constant SYSTEM_PARAMETERS_MANAGER = keccak256("SYSTEM_PARAMETERS_MANAGER");

    bytes32 constant SYSTEM_POOLS_MANAGER = keccak256("SYSTEM_POOLS_MANAGER");

    bytes32 constant SYSTEM_POOLS_RESERVE_FUNDS_MANAGER =
        keccak256("SYSTEM_POOLS_RESERVE_FUNDS_MANAGER");

    function roleManagerInitialize(
        bytes32[] calldata roles_,
        address[] calldata accounts_
    ) external initializer {
        require(
            roles_.length == accounts_.length,
            "RoleManager: passed arrays are of different sizes"
        );
        for (uint256 i = 0; i < roles_.length; ++i) {
            _setupRole(roles_[i], accounts_[i]);
        }
        _setupRole(ROLE_MANAGER_ADMIN, msg.sender);
    }

    function isAssetParametersManager(address account_) external view {
        _hasRoleOrAdmin(ASSET_PARAMETERS_MANAGER, account_);
    }

    function isDefiCorePauser(address account_) external view {
        _hasRoleOrAdmin(DEFI_CORE_PAUSER, account_);
    }

    function isPRTParamUpdater(address account_) external view {
        _hasRoleOrAdmin(PRT_PARAM_UPDATER, account_);
    }

    function isRewardsDistributionManager(address account_) external view {
        _hasRoleOrAdmin(REWARDS_DISTRIBUTION_MANAGER, account_);
    }

    function isSystemParametersManager(address account_) external view {
        _hasRoleOrAdmin(SYSTEM_PARAMETERS_MANAGER, account_);
    }

    function isSystemPoolsManager(address account_) external view {
        _hasRoleOrAdmin(SYSTEM_POOLS_MANAGER, account_);
    }

    function isSystemPoolsReserveFundsManager(address account_) external view {
        _hasRoleOrAdmin(SYSTEM_POOLS_RESERVE_FUNDS_MANAGER, account_);
    }

    function grantRole(bytes32 role_, address account_) public override {
        _hasRoleOrAdmin(ROLE_MANAGER_ROLE_GOVERNOR, msg.sender);

        _grantRole(role_, account_);
    }

    function revokeRole(bytes32 role_, address account_) public override {
        _hasRoleOrAdmin(ROLE_MANAGER_ROLE_GOVERNOR, msg.sender);

        _revokeRole(role_, account_);
    }

    function _hasRoleOrAdmin(bytes32 role_, address account_) internal view virtual {
        require(
            hasRole(role_, account_) || hasRole(ROLE_MANAGER_ADMIN, account_),
            string(
                abi.encodePacked(
                    "RoleManager: account is missing role ",
                    StringsUpgradeable.toHexString(uint256(role_), 32)
                )
            )
        );
    }
}
