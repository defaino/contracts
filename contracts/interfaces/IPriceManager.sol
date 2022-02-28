// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

interface IPriceManager {
    function addOracle(
        bytes32 _assetKey,
        address _assetAddr,
        address _newMainOracle,
        address _newBackupOracle
    ) external;

    function getPrice(bytes32 _assetKey, uint8 _assetDecimals)
        external
        view
        returns (uint256, uint8);
}
