// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "../RewardsDistribution.sol";

contract RewardsDistributionMock is RewardsDistribution {
    function getRewardsPerBlock(
        bytes32 _assetKey,
        uint256 _currentUR
    ) external view returns (uint256, uint256) {
        return _getRewardsPerBlock(_assetKey, _currentUR);
    }

    function getNewCumulativeSum(
        uint256 _rewardPerBlock,
        uint256 _totalPool,
        uint256 _prevAP,
        uint256 _blocksDelta
    ) external pure returns (uint256) {
        return _countNewCumulativeSum(_rewardPerBlock, _totalPool, _prevAP, _blocksDelta);
    }
}
