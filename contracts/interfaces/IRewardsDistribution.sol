// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "./ILiquidityPool.sol";

interface IRewardsDistribution {
    struct LiquidityPoolInfo {
        uint256 rewardPerBlock;
        uint256 supplyCumulativeSum;
        uint256 borrowCumulativeSum;
        uint256 lastUpdate;
    }

    struct UserDistributionInfo {
        uint256 lastSupplyCumulativeSum;
        uint256 lastBorrowCumulativeSum;
        uint256 aggregatedReward;
    }

    /**
     * @notice Returns APY for a specific liquidity pool
     * @param _liquidityPool Required liquidity pool
     * @return _supplyAPY - current supply APY
     * @return _borrowAPY - current borrow APY
     */
    function getAPY(ILiquidityPool _liquidityPool)
        external
        view
        returns (uint256 _supplyAPY, uint256 _borrowAPY);

    /**
     * @notice Returns current user reward of Governance Tokens
     * @param _assetKey Asset key of the liquidity pool
     * @param _userAddr Address of the user
     * @param _liquidityPool Required liquidity pool
     * @return _userReward - current user reward
     */
    function getUserReward(
        bytes32 _assetKey,
        address _userAddr,
        ILiquidityPool _liquidityPool
    ) external view returns (uint256 _userReward);

    /**
     * @notice Function for updating cumulative sums. Can only be called from DefiCore
     * @param _userAddr Address of the user
     * @param _liquidityPool Required liquidity pool
     */
    function updateCumulativeSums(address _userAddr, ILiquidityPool _liquidityPool) external;

    /**
     * @notice Function for withdraw accumulated rewards. Can only be called from DefiCore
     * @dev Cumulative sums are updated before withdrawal
     * @param _assetKey Asset key of the liquidity pool
     * @param _userAddr Address of the user
     * @param _liquidityPool Required liquidity pool
     * @return _userReward - current user reward
     */
    function withdrawUserReward(
        bytes32 _assetKey,
        address _userAddr,
        ILiquidityPool _liquidityPool
    ) external returns (uint256 _userReward);

    /**
     * @notice Function to update rewards per block
     * @dev The passed arrays must be of the same length
     * @param _assetKeys Arrays of asset keys
     * @param _rewardsPerBlock Arrays of new rewards per block
     */
    function setupRewardsPerBlockBatch(
        bytes32[] calldata _assetKeys,
        uint256[] calldata _rewardsPerBlock
    ) external;
}
