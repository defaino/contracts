// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "@solarity/solidity-lib/contracts-registry/AbstractDependant.sol";

import "../interfaces/IRegistry.sol";
import "../interfaces/IAssetParameters.sol";
import "../interfaces/IRewardsDistribution.sol";
import "../interfaces/ISystemPoolsRegistry.sol";
import "../interfaces/IBasicPool.sol";

import "../libraries/MathHelper.sol";

import "../common/Globals.sol";

contract RewardsDistribution is IRewardsDistribution, AbstractDependant {
    using MathHelper for uint256;

    address internal _systemOwnerAddr;
    address internal _defiCoreAddr;
    IAssetParameters internal _assetParameters;
    ISystemPoolsRegistry internal _systemPoolsRegistry;

    mapping(bytes32 => LiquidityPoolInfo) public liquidityPoolsInfo;
    mapping(bytes32 => mapping(address => UserDistributionInfo)) public usersDistributionInfo;

    modifier onlyEligibleContracts() {
        require(
            _defiCoreAddr == msg.sender || _systemPoolsRegistry.existingLiquidityPools(msg.sender),
            "RewardsDistribution: Caller not an eligible contract."
        );
        _;
    }

    modifier onlySystemOwner() {
        require(
            msg.sender == _systemOwnerAddr,
            "RewardsDistribution: Only system owner can call this function."
        );
        _;
    }

    function setDependencies(address contractsRegistry_, bytes memory) public override dependant {
        IRegistry registry_ = IRegistry(contractsRegistry_);

        _systemOwnerAddr = registry_.getSystemOwner();
        _defiCoreAddr = registry_.getDefiCoreContract();
        _assetParameters = IAssetParameters(registry_.getAssetParametersContract());
        _systemPoolsRegistry = ISystemPoolsRegistry(registry_.getSystemPoolsRegistryContract());
    }

    function updateCumulativeSums(
        address userAddr_,
        address liquidityPool_
    ) external override onlyEligibleContracts {
        if (_onlyExistingRewardsAssetKey()) {
            _updateSumsWithUserReward(
                userAddr_,
                IBasicPool(liquidityPool_).assetKey(),
                liquidityPool_
            );
        }
    }

    function withdrawUserReward(
        bytes32 assetKey_,
        address userAddr_,
        address liquidityPool_
    ) external override onlyEligibleContracts returns (uint256 userReward_) {
        if (_onlyExistingRewardsAssetKey()) {
            _updateSumsWithUserReward(userAddr_, assetKey_, liquidityPool_);

            UserDistributionInfo storage userInfo = usersDistributionInfo[assetKey_][userAddr_];

            userReward_ = userInfo.aggregatedReward;

            if (userReward_ > 0) {
                delete userInfo.aggregatedReward;
            }
        }
    }

    function setupRewardsPerBlockBatch(
        bytes32[] calldata assetKeys_,
        uint256[] calldata rewardsPerBlock_
    ) external override onlySystemOwner {
        require(
            _onlyExistingRewardsAssetKey(),
            "RewardsDistributionL Unable to setup rewards per block."
        );

        require(
            assetKeys_.length == rewardsPerBlock_.length,
            "RewardsDistribution: Length mismatch."
        );

        ISystemPoolsRegistry poolsRegistry_ = _systemPoolsRegistry;

        for (uint256 i = 0; i < assetKeys_.length; i++) {
            bytes32 currentKey_ = assetKeys_[i];

            if (liquidityPoolsInfo[currentKey_].rewardPerBlock != 0) {
                (address poolAddr_, ISystemPoolsRegistry.PoolType poolType_) = poolsRegistry_
                    .poolsInfo(currentKey_);

                _updateCumulativeSums(currentKey_, poolAddr_, poolType_);
            } else {
                liquidityPoolsInfo[currentKey_].lastUpdate = block.number;
            }

            liquidityPoolsInfo[currentKey_].rewardPerBlock = rewardsPerBlock_[i];
        }
    }

    function getAPY(
        bytes32 assetKey_
    ) external view override returns (uint256 supplyAPY_, uint256 borrowAPY_) {
        IBasicPool rewardsLP_ = IBasicPool(_systemPoolsRegistry.getRewardsLiquidityPool());

        if (address(rewardsLP_) == address(0)) {
            return (supplyAPY_, borrowAPY_);
        }

        (
            address liquidityPoolAddr_,
            ISystemPoolsRegistry.PoolType poolType_
        ) = _systemPoolsRegistry.poolsInfo(assetKey_);
        ILiquidityPool liquidityPool_ = ILiquidityPool(liquidityPoolAddr_);

        LiquidityPoolStats memory stats_ = _getLiquidityPoolStats(
            assetKey_,
            liquidityPoolAddr_,
            poolType_
        );

        if (stats_.supplyRewardPerBlock != 0) {
            uint256 annualSupplyReward_ = rewardsLP_.getAmountInUSD(stats_.supplyRewardPerBlock) *
                BLOCKS_PER_YEAR *
                PERCENTAGE_100;
            uint256 totalSupplyPoolInUSD_ = liquidityPool_.getAmountInUSD(
                liquidityPool_.convertLPTokensToAsset(stats_.totalSupplyPool)
            );

            if (totalSupplyPoolInUSD_ != 0) {
                supplyAPY_ = annualSupplyReward_ / totalSupplyPoolInUSD_;
            }
        }

        uint256 annualBorrowReward_ = rewardsLP_.getAmountInUSD(stats_.borrowRewardPerBlock) *
            BLOCKS_PER_YEAR *
            PERCENTAGE_100;
        uint256 totalBorrowPoolInUSD_ = liquidityPool_.getAmountInUSD(stats_.totalBorrowPool);

        if (totalBorrowPoolInUSD_ != 0) {
            borrowAPY_ = annualBorrowReward_ / totalBorrowPoolInUSD_;
        }
    }

    function getUserReward(
        bytes32 assetKey_,
        address userAddr_,
        address liquidityPool_
    ) external view override returns (uint256 userReward_) {
        if (_onlyExistingRewardsAssetKey()) {
            (, ISystemPoolsRegistry.PoolType poolType_) = _systemPoolsRegistry.poolsInfo(
                assetKey_
            );

            (
                uint256 newSupplyCumulativeSum_,
                uint256 newBorrowCumulativeSum_
            ) = _getNewCumulativeSums(assetKey_, liquidityPool_, poolType_);
            userReward_ = _getNewUserReward(
                userAddr_,
                assetKey_,
                liquidityPool_,
                newSupplyCumulativeSum_,
                newBorrowCumulativeSum_,
                poolType_
            );
        }
    }

    function _updateSumsWithUserReward(
        address userAddr_,
        bytes32 assetKey_,
        address liquidityPool_
    ) internal {
        (, ISystemPoolsRegistry.PoolType poolType_) = _systemPoolsRegistry.poolsInfo(assetKey_);

        (uint256 newSupplyCumulativeSum_, uint256 newBorrowCumulativeSum_) = _updateCumulativeSums(
            assetKey_,
            liquidityPool_,
            poolType_
        );
        uint256 newReward_ = _getNewUserReward(
            userAddr_,
            assetKey_,
            liquidityPool_,
            newSupplyCumulativeSum_,
            newBorrowCumulativeSum_,
            poolType_
        );

        usersDistributionInfo[assetKey_][userAddr_] = UserDistributionInfo(
            newSupplyCumulativeSum_,
            newBorrowCumulativeSum_,
            newReward_
        );
    }

    function _updateCumulativeSums(
        bytes32 assetKey_,
        address liquidityPool_,
        ISystemPoolsRegistry.PoolType poolType_
    ) internal returns (uint256 newSupplyCumulativeSum_, uint256 newBorrowCumulativeSum_) {
        (newSupplyCumulativeSum_, newBorrowCumulativeSum_) = _getNewCumulativeSums(
            assetKey_,
            liquidityPool_,
            poolType_
        );

        LiquidityPoolInfo storage liquidityPoolInfo = liquidityPoolsInfo[assetKey_];

        if (liquidityPoolInfo.lastUpdate != block.number) {
            liquidityPoolInfo.supplyCumulativeSum = newSupplyCumulativeSum_;
            liquidityPoolInfo.borrowCumulativeSum = newBorrowCumulativeSum_;
            liquidityPoolInfo.lastUpdate = block.number;
        }
    }

    function _getNewUserReward(
        address userAddr_,
        bytes32 assetKey_,
        address liquidityPool_,
        uint256 newSupplyCumulativeSum_,
        uint256 newBorrowCumulativeSum_,
        ISystemPoolsRegistry.PoolType poolType_
    ) internal view returns (uint256 newAggregatedReward_) {
        UserDistributionInfo storage userInfo = usersDistributionInfo[assetKey_][userAddr_];

        newAggregatedReward_ = userInfo.aggregatedReward;

        uint256 liquidityAmount_;

        if (poolType_ == ISystemPoolsRegistry.PoolType.LIQUIDITY_POOL) {
            liquidityAmount_ = ERC20(liquidityPool_).balanceOf(userAddr_);
        }

        (uint256 borrowAmount_, ) = IBasicPool(liquidityPool_).borrowInfos(userAddr_);

        if (liquidityAmount_ > 0) {
            newAggregatedReward_ += (newSupplyCumulativeSum_ - userInfo.lastSupplyCumulativeSum)
                .mulWithPrecision(liquidityAmount_);
        }

        if (borrowAmount_ > 0) {
            newAggregatedReward_ += (newBorrowCumulativeSum_ - userInfo.lastBorrowCumulativeSum)
                .mulWithPrecision(borrowAmount_);
        }
    }

    function _getNewCumulativeSums(
        bytes32 assetKey_,
        address liquidityPool_,
        ISystemPoolsRegistry.PoolType poolType_
    ) internal view returns (uint256 newSupplyCumulativeSum_, uint256 newBorrowCumulativeSum_) {
        LiquidityPoolInfo storage liquidityPoolInfo = liquidityPoolsInfo[assetKey_];

        uint256 lastUpdate_ = liquidityPoolInfo.lastUpdate;
        lastUpdate_ = lastUpdate_ == 0 ? block.number : lastUpdate_;

        uint256 blocksDelta_ = block.number - lastUpdate_;

        newSupplyCumulativeSum_ = liquidityPoolInfo.supplyCumulativeSum;
        newBorrowCumulativeSum_ = liquidityPoolInfo.borrowCumulativeSum;

        if (blocksDelta_ != 0) {
            LiquidityPoolStats memory stats_ = _getLiquidityPoolStats(
                assetKey_,
                liquidityPool_,
                poolType_
            );

            if (stats_.totalSupplyPool != 0) {
                newSupplyCumulativeSum_ = _countNewCumulativeSum(
                    stats_.supplyRewardPerBlock,
                    stats_.totalSupplyPool,
                    newSupplyCumulativeSum_,
                    blocksDelta_
                );
            }

            if (stats_.totalBorrowPool != 0) {
                newBorrowCumulativeSum_ = _countNewCumulativeSum(
                    stats_.borrowRewardPerBlock,
                    stats_.totalBorrowPool,
                    newBorrowCumulativeSum_,
                    blocksDelta_
                );
            }
        }
    }

    function _getLiquidityPoolStats(
        bytes32 assetKey_,
        address liquidityPool_,
        ISystemPoolsRegistry.PoolType poolType_
    ) internal view returns (LiquidityPoolStats memory) {
        uint256 supplyRewardPerBlock_;
        uint256 borrowRewardPerBlock_;
        uint256 totalSupplyPool_;

        if (poolType_ == ISystemPoolsRegistry.PoolType.LIQUIDITY_POOL) {
            (supplyRewardPerBlock_, borrowRewardPerBlock_) = _getRewardsPerBlock(
                assetKey_,
                ILiquidityPool(liquidityPool_).getBorrowPercentage()
            );

            totalSupplyPool_ = ERC20(liquidityPool_).totalSupply();
        } else {
            borrowRewardPerBlock_ = liquidityPoolsInfo[assetKey_].rewardPerBlock;
        }

        uint256 totalBorrowPool_ = IBasicPool(liquidityPool_).aggregatedBorrowedAmount();

        return
            LiquidityPoolStats(
                supplyRewardPerBlock_,
                borrowRewardPerBlock_,
                totalSupplyPool_,
                totalBorrowPool_
            );
    }

    function _getRewardsPerBlock(
        bytes32 assetKey_,
        uint256 currentUR_
    ) internal view returns (uint256 supplyRewardPerBlock_, uint256 borrowRewardPerBlock_) {
        uint256 totalRewardPerBlock_ = liquidityPoolsInfo[assetKey_].rewardPerBlock;

        if (totalRewardPerBlock_ == 0) {
            return (supplyRewardPerBlock_, borrowRewardPerBlock_);
        }

        IAssetParameters.DistributionMinimums memory distrMinimums_ = _assetParameters
            .getDistributionMinimums(assetKey_);

        uint256 _supplyRewardPerBlockPart = (PERCENTAGE_100 -
            distrMinimums_.minBorrowDistrPart -
            distrMinimums_.minSupplyDistrPart).mulWithPrecision(currentUR_) +
            distrMinimums_.minSupplyDistrPart;

        supplyRewardPerBlock_ = totalRewardPerBlock_.mulWithPrecision(_supplyRewardPerBlockPart);
        borrowRewardPerBlock_ = totalRewardPerBlock_ - supplyRewardPerBlock_;
    }

    function _onlyExistingRewardsAssetKey() internal view returns (bool) {
        return _systemPoolsRegistry.rewardsAssetKey() != bytes32(0);
    }

    function _countNewCumulativeSum(
        uint256 rewardPerBlock_,
        uint256 totalPool_,
        uint256 prevCumulativeSum_,
        uint256 blocksDelta_
    ) internal pure returns (uint256) {
        uint256 _newPrice = rewardPerBlock_.divWithPrecision(totalPool_);
        return blocksDelta_ * _newPrice + prevCumulativeSum_;
    }
}
