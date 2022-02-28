// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "../Registry.sol";
import "../BorrowerRouter.sol";

contract BorrowerRouterMockUpgradeable is BorrowerRouter {
    function changeUser(address _newUser) external {
        user = _newUser;
    }
}
