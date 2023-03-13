pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

contract RoleManager is AccessControlUpgradeable {
    bytes32 public constant ROLE_MANAGER_ADMIN = keccak256("ROLE_MANAGER_ADMIN");

    bytes32 public constant ASSET_PARAMETERS_PARAM_SETTER =
        keccak256("ASSET_PARAMETERS_PARAM_SETTER");
    bytes32 public constant ASSET_PARAMETERS_FREEZER = keccak256("ASSET_PARAMETERS_FREEZER");
    bytes32 public constant ASSET_PARAMETERS_COLLATERAL_ENABLER =
        keccak256("ASSET_PARAMETERS_COLLATERAL_ENABLER");

    bytes32 public constant DEFI_CORE_PAUZER = keccak256("DEFI_CORE_PAUZER");

    bytes32 public constant PRT_PARAM_UPDATER = keccak256("PRT_PARAM_UPDATER");

    bytes32 public constant REGISTRY_OWNER_UPDATER_AND_INJECTOR =
        keccak256("REGISTRY_OWNER_UPDATER_AND_INJECTOR");

    bytes32 public constant REWARDS_DISTRIBUTION_REWARDS_SETTER =
        keccak256("REWARDS_DISTRIBUTION_REWARDS_SETTER");

    bytes32 public constant SYSTEM_PARAMETERS_REWARDS_TOKEN_SETTER =
        keccak256("SYSTEM_PARAMETERS_REWARDS_TOKEN_SETTER");
    bytes32 public constant SYSTEM_PARAMETERS_LIQUIDATION_BOUNDARY_SETTER =
        keccak256("SYSTEM_PARAMETERS_LIQUIDATION_BOUNDARY_SETTER");
    bytes32 public constant SYSTEM_PARAMETERS_STABLE_POOLS_AVAILABILITY_SETTER =
        keccak256("SYSTEM_PARAMETERS_STABLE_POOLS_AVAILABILITY_SETTER");
    bytes32 public constant SYSTEM_PARAMETERS_MIN_CURRENCY_AMOUNT_SETTER =
        keccak256("SYSTEM_PARAMETERS_MIN_CURRENCY_AMOUNT_SETTER");

    bytes32 public constant SYSTEM_POOLS_REGISTRY_POOLS_MANAGER =
        keccak256("SYSTEM_POOLS_REGISTRY_POOLS_MANAGER");
    //Should create an injector for every contract which has dependencies?
    bytes32 public constant SYSTEM_POOLS_REGISTRY_INJECTOR =
        keccak256("SYSTEM_POOLS_REGISTRY_INJECTOR");
    bytes32 public constant SYSTEM_POOLS_RESERVE_FUNDS_MANAGER =
        keccak256("SYSTEM_POOLS_RESERVE_FUNDS_MANAGER");

    function roleManagerInitialize() external initializer {
        _setupRole(ROLE_MANAGER_ADMIN, msg.sender);
        _setRoleAdmin(ROLE_MANAGER_ADMIN, ROLE_MANAGER_ADMIN);
    }

    function checkRole(bytes32 role, address account) public view virtual {
        _checkRole(role, account);
    }
}

/*example:

pragma solidity 0.8.17;

import "./interfaces/IRoleManager.sol";

contract PRT is IPRT, ERC721Upgradeable, AbstractDependant, ReentrancyGuardUpgradeable {

    ....

    IRoleManager internal _roleManager;

    modifier onlyRole(bytes32 role) {
        _roleManager.checkRole(role, msg.sender);
        _;
    }

    function updatePRTParams(PRTParams calldata prtParams_) external override onlyRole(keccak256("PRT_PARAM_UPDATER")) {
        _prtParams = prtParams_;
    }

}
*/
