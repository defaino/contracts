// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "./IBasicPool.sol";

/**
 * This contract calculates and stores information about the distribution of rewards to users for deposits and credits
 */
interface IRewardsDistribution {
    /// @notice The structure that contains information about the pool, which is necessary for the allocation of tokens
    /// @param rewardPerBlock reward for the block in tokens. Is common for deposits and credits
    /// @param supplyCumulativeSum cumulative sum on deposits
    /// @param borrowCumulativeSum cumulative sum on borrows
    /// @param lastUpdate time of the last cumulative sum update
    struct LiquidityPoolInfo {
        uint256 rewardPerBlock;
        uint256 supplyCumulativeSum;
        uint256 borrowCumulativeSum;
        uint256 lastUpdate;
    }

    /// @notice A structure that contains information about the user's cumulative amounts and his reward
    /// @param lastSupplyCumulativeSum cumulative sum on the deposit at the time of the last update
    /// @param lastBorrowCumulativeSum cumulative sum on the borrow at the time of the last update
    /// @param aggregatedReward aggregated user reward during the last update
    struct UserDistributionInfo {
        uint256 lastSupplyCumulativeSum;
        uint256 lastBorrowCumulativeSum;
        uint256 aggregatedReward;
    }

    /// @notice The system structure, which is needed to avoid stack overflow and stores the pool stats
    /// @param supplyRewardPerBlock current reward for the block, which will go to users who deposited tokens
    /// @param borrowRewardPerBlock the current reward for the block, which will go to users that took on credit
    /// @param totalSupplyPool total pool of tokens on deposit
    /// @param totalBorrowPool total pool of tokens borrowed
    struct LiquidityPoolStats {
        uint256 supplyRewardPerBlock;
        uint256 borrowRewardPerBlock;
        uint256 totalSupplyPool;
        uint256 totalBorrowPool;
    }

    /// @notice Function to update the cumulative sums for a particular user in the passed pool
    /// @dev Can call only by eligible contracts (DefiCore and LiquidityPools)
    /// @param userAddr_ address of the user to whom the cumulative sums will be updated
    /// @param liquidityPool_ required liquidity pool
    function updateCumulativeSums(address userAddr_, address liquidityPool_) external;

    /// @notice Function for withdraw accumulated user rewards. Rewards are updated before withdrawal
    /// @dev Can call only by eligible contracts (DefiCore and LiquidityPools)
    /// @param assetKey_ the key of the desired pool, which will be used to calculate the reward
    /// @param userAddr_ the address of the user for whom the reward will be counted
    /// @param liquidityPool_ required liquidity pool
    /// @return userReward_ total user reward from the passed pool
    function withdrawUserReward(
        bytes32 assetKey_,
        address userAddr_,
        address liquidityPool_
    ) external returns (uint256 userReward_);

    /// @notice Function to update block rewards for desired pools
    /// @dev Can call only by contract owner. The passed arrays must be of the same length
    /// @param assetKeys_ array of pool identifiers
    /// @param rewardsPerBlock_ array of new rewards per block
    function setupRewardsPerBlockBatch(
        bytes32[] calldata assetKeys_,
        uint256[] calldata rewardsPerBlock_
    ) external;

    /// @notice Returns the annual distribution rates for the desired pool
    /// @param assetKey_ required liquidity pool identifier
    /// @return supplyAPY_ annual distribution rate for users who deposited in the passed pool
    /// @return borrowAPY_ annual distribution rate for users who took credit in the passed pool
    function getAPY(
        bytes32 assetKey_
    ) external view returns (uint256 supplyAPY_, uint256 borrowAPY_);

    /// @notice Returns current total user reward from the passed pool
    /// @param assetKey_ the key of the desired pool, which will be used to calculate the reward
    /// @param userAddr_ the address of the user for whom the reward will be counted
    /// @param liquidityPool_ required liquidity pool
    /// @return userReward_ current total user reward from the passed pool
    function getUserReward(
        bytes32 assetKey_,
        address userAddr_,
        address liquidityPool_
    ) external view returns (uint256 userReward_);
}
