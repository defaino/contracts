// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "../RewardsDistribution.sol";

contract RewardsDistributionMock is RewardsDistribution {
    function getRewardsPerBlock(
        bytes32 assetKey_,
        uint256 currentUR_
    ) external view returns (uint256, uint256) {
        return _getRewardsPerBlock(assetKey_, currentUR_);
    }

    function getNewCumulativeSum(
        uint256 rewardPerBlock_,
        uint256 totalPool_,
        uint256 prevAP_,
        uint256 blocksDelta_
    ) external pure returns (uint256) {
        return _countNewCumulativeSum(rewardPerBlock_, totalPool_, prevAP_, blocksDelta_);
    }
}
