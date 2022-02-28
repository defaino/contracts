// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

interface IBorrowerRouterFactory {
    function newBorrowerRouter(address _userAddr) external returns (address);
}
