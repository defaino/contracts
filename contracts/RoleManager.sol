pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import "@openzeppelin/contracts-upgradeable/utils/StringsUpgradeable.sol";

import "./common/Globals.sol";

contract RoleManager is AccessControlUpgradeable {
    function roleManagerInitialize() external initializer {
        _setupRole(ROLE_MANAGER_ADMIN, msg.sender);
    }

    function hasRoleOrAdmin(bytes32 role_, address account_) public view virtual {
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

    function grantRole(bytes32 role_, address account_) public override {
        require(
            hasRole(ROLE_MANAGER_ADMIN, msg.sender),
            "RoleManager: only ROLE_MANAGER_ADMIN can grant roles"
        );

        _grantRole(role_, account_);
    }

    function revokeRole(bytes32 role_, address account_) public override {
        require(
            hasRole(ROLE_MANAGER_ADMIN, msg.sender),
            "RoleManager: only ROLE_MANAGER_ADMIN can revoke roles"
        );

        _revokeRole(role_, account_);
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
