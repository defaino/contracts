// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

interface ILiquidityPoolAdmin {
    function getUpgrader() external view returns (address);

    function getImplementationOfLiquidityPool(address _liquidityPoolAddress)
        external
        returns (address);

    function getCurrentLiquidityPoolsImplementation() external view returns (address);
}
