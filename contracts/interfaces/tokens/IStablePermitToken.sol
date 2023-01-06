// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

interface IStablePermitToken {
    function mint(address account_, uint256 amount_) external;

    function burn(address account_, uint256 amount_) external;
}
