// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

interface IStablePermitToken {
    function mint(address _account, uint256 _amount) external;

    function burn(address _account, uint256 _amount) external;
}
