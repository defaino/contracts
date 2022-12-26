// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@dlsl/dev-modules/contracts-registry/presets/OwnableContractsRegistry.sol";

import "./interfaces/IRegistry.sol";

contract Registry is IRegistry, OwnableContractsRegistry {
    string public constant DEFI_CORE_NAME = "DEFI_CORE";

    string public constant SYSTEM_PARAMETERS_NAME = "SYSTEM_PARAMETERS";
    string public constant ASSET_PARAMETERS_NAME = "ASSET_PARAMETERS";

    string public constant REWARDS_DISTRIBUTION_NAME = "REWARDS_DISTRIBUTION";

    string public constant USER_INFO_REGISTRY_NAME = "USER_INFO_REGISTRY";
    string public constant SYSTEM_POOLS_REGISTRY_NAME = "SYSTEM_POOLS_REGISTRY";

    string public constant SYSTEM_POOLS_FACTORY_NAME = "SYSTEM_POOLS_FACTORY";
    string public constant PRICE_MANAGER_NAME = "PRICE_MANAGER";

    string public constant INTEREST_RATE_LIBRARY_NAME = "INTEREST_RATE_LIBRARY";

    function getSystemOwner() external view override returns (address) {
        return owner();
    }

    function getDefiCoreContract() external view override returns (address) {
        return getContract(DEFI_CORE_NAME);
    }

    function getSystemParametersContract() external view override returns (address) {
        return getContract(SYSTEM_PARAMETERS_NAME);
    }

    function getAssetParametersContract() external view override returns (address) {
        return getContract(ASSET_PARAMETERS_NAME);
    }

    function getRewardsDistributionContract() external view override returns (address) {
        return getContract(REWARDS_DISTRIBUTION_NAME);
    }

    function getUserInfoRegistryContract() external view override returns (address) {
        return getContract(USER_INFO_REGISTRY_NAME);
    }

    function getSystemPoolsRegistryContract() external view override returns (address) {
        return getContract(SYSTEM_POOLS_REGISTRY_NAME);
    }

    function getSystemPoolsFactoryContract() external view override returns (address) {
        return getContract(SYSTEM_POOLS_FACTORY_NAME);
    }

    function getPriceManagerContract() external view override returns (address) {
        return getContract(PRICE_MANAGER_NAME);
    }

    function getInterestRateLibraryContract() external view override returns (address) {
        return getContract(INTEREST_RATE_LIBRARY_NAME);
    }
}
