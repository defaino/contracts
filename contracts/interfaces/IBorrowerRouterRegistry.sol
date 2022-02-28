// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

interface IBorrowerRouterRegistry {
    function borrowerRouters(address _userAddr) external view returns (address);

    function getBorrowerRoutersBeacon() external view returns (address);

    function isBorrowerRouterExists(address _userAddr) external view returns (bool);

    function updateUserBorrowerRouter(address _userAddr, address _newBorrowerRouter) external;
}
