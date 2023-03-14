pragma solidity 0.8.17;

interface IRoleManager {
    function hasRoleOrAdmin(bytes32 role_, address account_) external view;

    function grantRole(bytes32 role_, address account_) external;

    function revokeRole(bytes32 role, address account) external;
}
