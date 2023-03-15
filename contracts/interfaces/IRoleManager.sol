pragma solidity 0.8.17;

interface IRoleManager {
    function grantRole(bytes32 role_, address account_) external;

    function revokeRole(bytes32 role, address account) external;

    function isAssetParametersManager(address account_) external view;

    function isDefiCorePauser(address account_) external view;

    function isPRTParamUpdater(address account_) external view;

    function isRewardsDistributionManager(address account_) external view;

    function isSystemParametersManager(address account_) external view;

    function isSystemPoolsManager(address account_) external view;

    function isSystemPoolsReserveFundsManager(address account_) external view;
}
