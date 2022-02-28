// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

interface YRegistry {
    function getVaultsInfo()
        external
        view
        returns (
            address[] memory vaultsAddresses,
            address[] memory controllerArray,
            address[] memory tokenArray,
            address[] memory strategyArray,
            bool[] memory isWrappedArray,
            bool[] memory isDelegatedArray
        );

    function getVaults() external view returns (address[] memory);

    function getVaultInfo(address _vault)
        external
        view
        returns (
            address controller,
            address token,
            address strategy,
            bool isWrapped,
            bool isDelegated
        );
}
