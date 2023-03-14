// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@dlsl/dev-modules/utils/Globals.sol";

uint256 constant BLOCKS_PER_DAY = 4900;
uint256 constant BLOCKS_PER_YEAR = BLOCKS_PER_DAY * 365;

uint8 constant PRICE_DECIMALS = 8;

bytes32 constant ROLE_MANAGER_ADMIN = keccak256("ROLE_MANAGER_ADMIN");

bytes32 constant ASSET_PARAMETERS_MANAGER = keccak256("ASSET_PARAMETERS_MANAGER");

bytes32 constant DEFI_CORE_PAUSER = keccak256("DEFI_CORE_PAUSER");

bytes32 constant PRT_PARAM_UPDATER = keccak256("PRT_PARAM_UPDATER");

bytes32 constant REWARDS_DISTRIBUTION_MANAGER = keccak256("REWARDS_DISTRIBUTION_MANAGER");

bytes32 constant SYSTEM_PARAMETERS_MANAGER = keccak256("SYSTEM_PARAMETERS_MANAGER");

bytes32 constant SYSTEM_POOLS_MANAGER = keccak256("SYSTEM_POOLS_MANAGER");

bytes32 constant SYSTEM_POOLS_RESERVE_FUNDS_MANAGER = keccak256(
    "SYSTEM_POOLS_RESERVE_FUNDS_MANAGER"
);
