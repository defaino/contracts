// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "@dlsl/dev-modules/contracts-registry/AbstractDependant.sol";

import "./interfaces/IRegistry.sol";
import "./interfaces/IAssetParameters.sol";
import "./interfaces/IRewardsDistribution.sol";
import "./interfaces/ISystemPoolsRegistry.sol";
import "./interfaces/IBasicPool.sol";

import "./libraries/MathHelper.sol";

import "./common/Globals.sol";

contract RewardsDistribution is IRewardsDistribution, AbstractDependant {
    using MathHelper for uint256;

    address private systemOwnerAddr;
    address private defiCoreAddr;
    IAssetParameters private assetParameters;
    ISystemPoolsRegistry private systemPoolsRegistry;

    mapping(bytes32 => LiquidityPoolInfo) public liquidityPoolsInfo;
    mapping(bytes32 => mapping(address => UserDistributionInfo)) public usersDistributionInfo;

    modifier onlyEligibleContracts() {
        require(
            defiCoreAddr == msg.sender || systemPoolsRegistry.existingLiquidityPools(msg.sender),
            "RewardsDistribution: Caller not an eligible contract."
        );
        _;
    }

    modifier onlySystemOwner() {
        require(
            msg.sender == systemOwnerAddr,
            "RewardsDistribution: Only system owner can call this function."
        );
        _;
    }

    function setDependencies(address _contractsRegistry) external override dependant {
        IRegistry _registry = IRegistry(_contractsRegistry);

        systemOwnerAddr = _registry.getSystemOwner();
        defiCoreAddr = _registry.getDefiCoreContract();
        assetParameters = IAssetParameters(_registry.getAssetParametersContract());
        systemPoolsRegistry = ISystemPoolsRegistry(_registry.getSystemPoolsRegistryContract());
    }

    function updateCumulativeSums(
        address _userAddr,
        address _liquidityPool
    ) external override onlyEligibleContracts {
        if (_onlyExistingRewardsAssetKey()) {
            _updateSumsWithUserReward(
                _userAddr,
                IBasicPool(_liquidityPool).assetKey(),
                _liquidityPool
            );
        }
    }

    function withdrawUserReward(
        bytes32 _assetKey,
        address _userAddr,
        address _liquidityPool
    ) external override onlyEligibleContracts returns (uint256 _userReward) {
        if (_onlyExistingRewardsAssetKey()) {
            _updateSumsWithUserReward(_userAddr, _assetKey, _liquidityPool);

            UserDistributionInfo storage userInfo = usersDistributionInfo[_assetKey][_userAddr];

            _userReward = userInfo.aggregatedReward;

            if (_userReward > 0) {
                delete userInfo.aggregatedReward;
            }
        }
    }

    function setupRewardsPerBlockBatch(
        bytes32[] calldata _assetKeys,
        uint256[] calldata _rewardsPerBlock
    ) external override onlySystemOwner {
        require(
            _onlyExistingRewardsAssetKey(),
            "RewardsDistributionL Unable to setup rewards per block."
        );

        require(
            _assetKeys.length == _rewardsPerBlock.length,
            "RewardsDistribution: Length mismatch."
        );

        ISystemPoolsRegistry _poolsRegistry = systemPoolsRegistry;

        for (uint256 i = 0; i < _assetKeys.length; i++) {
            bytes32 _currentKey = _assetKeys[i];

            if (liquidityPoolsInfo[_currentKey].rewardPerBlock != 0) {
                (address _poolAddr, ISystemPoolsRegistry.PoolType _poolType) = _poolsRegistry
                    .poolsInfo(_currentKey);

                _updateCumulativeSums(_currentKey, _poolAddr, _poolType);
            } else {
                liquidityPoolsInfo[_currentKey].lastUpdate = block.number;
            }

            liquidityPoolsInfo[_currentKey].rewardPerBlock = _rewardsPerBlock[i];
        }
    }

    function getAPY(
        bytes32 _assetKey
    ) external view override returns (uint256 _supplyAPY, uint256 _borrowAPY) {
        IBasicPool _rewardsLP = IBasicPool(systemPoolsRegistry.getRewardsLiquidityPool());

        if (address(_rewardsLP) == address(0)) {
            return (_supplyAPY, _borrowAPY);
        }

        (address _liquidityPoolAddr, ISystemPoolsRegistry.PoolType _poolType) = systemPoolsRegistry
            .poolsInfo(_assetKey);
        ILiquidityPool _liquidityPool = ILiquidityPool(_liquidityPoolAddr);

        LiquidityPoolStats memory _stats = _getLiquidityPoolStats(
            _assetKey,
            _liquidityPoolAddr,
            _poolType
        );

        if (_stats.supplyRewardPerBlock != 0) {
            uint256 _annualSupplyReward = _rewardsLP.getAmountInUSD(_stats.supplyRewardPerBlock) *
                BLOCKS_PER_YEAR *
                PERCENTAGE_100;
            uint256 _totalSupplyPoolInUSD = _liquidityPool.getAmountInUSD(
                _liquidityPool.convertLPTokensToAsset(_stats.totalSupplyPool)
            );

            if (_totalSupplyPoolInUSD != 0) {
                _supplyAPY = _annualSupplyReward / _totalSupplyPoolInUSD;
            }
        }

        uint256 _annualBorrowReward = _rewardsLP.getAmountInUSD(_stats.borrowRewardPerBlock) *
            BLOCKS_PER_YEAR *
            PERCENTAGE_100;
        uint256 _totalBorrowPoolInUSD = _liquidityPool.getAmountInUSD(_stats.totalBorrowPool);

        if (_totalBorrowPoolInUSD != 0) {
            _borrowAPY = _annualBorrowReward / _totalBorrowPoolInUSD;
        }
    }

    function getUserReward(
        bytes32 _assetKey,
        address _userAddr,
        address _liquidityPool
    ) external view override returns (uint256 _userReward) {
        if (_onlyExistingRewardsAssetKey()) {
            (, ISystemPoolsRegistry.PoolType _poolType) = systemPoolsRegistry.poolsInfo(_assetKey);

            (
                uint256 _newSupplyCumulativeSum,
                uint256 _newBorrowCumulativeSum
            ) = _getNewCumulativeSums(_assetKey, _liquidityPool, _poolType);
            _userReward = _getNewUserReward(
                _userAddr,
                _assetKey,
                _liquidityPool,
                _newSupplyCumulativeSum,
                _newBorrowCumulativeSum,
                _poolType
            );
        }
    }

    function _updateSumsWithUserReward(
        address _userAddr,
        bytes32 _assetKey,
        address _liquidityPool
    ) internal {
        (, ISystemPoolsRegistry.PoolType _poolType) = systemPoolsRegistry.poolsInfo(_assetKey);

        (uint256 _newSupplyCumulativeSum, uint256 _newBorrowCumulativeSum) = _updateCumulativeSums(
            _assetKey,
            _liquidityPool,
            _poolType
        );
        uint256 _newReward = _getNewUserReward(
            _userAddr,
            _assetKey,
            _liquidityPool,
            _newSupplyCumulativeSum,
            _newBorrowCumulativeSum,
            _poolType
        );

        usersDistributionInfo[_assetKey][_userAddr] = UserDistributionInfo(
            _newSupplyCumulativeSum,
            _newBorrowCumulativeSum,
            _newReward
        );
    }

    function _updateCumulativeSums(
        bytes32 _assetKey,
        address _liquidityPool,
        ISystemPoolsRegistry.PoolType _poolType
    ) internal returns (uint256 _newSupplyCumulativeSum, uint256 _newBorrowCumulativeSum) {
        (_newSupplyCumulativeSum, _newBorrowCumulativeSum) = _getNewCumulativeSums(
            _assetKey,
            _liquidityPool,
            _poolType
        );

        LiquidityPoolInfo storage liquidityPoolInfo = liquidityPoolsInfo[_assetKey];

        if (liquidityPoolInfo.lastUpdate != block.number) {
            liquidityPoolInfo.supplyCumulativeSum = _newSupplyCumulativeSum;
            liquidityPoolInfo.borrowCumulativeSum = _newBorrowCumulativeSum;
            liquidityPoolInfo.lastUpdate = block.number;
        }
    }

    function _getNewUserReward(
        address _userAddr,
        bytes32 _assetKey,
        address _liquidityPool,
        uint256 _newSupplyCumulativeSum,
        uint256 _newBorrowCumulativeSum,
        ISystemPoolsRegistry.PoolType _poolType
    ) internal view returns (uint256 _newAggregatedReward) {
        UserDistributionInfo storage userInfo = usersDistributionInfo[_assetKey][_userAddr];

        _newAggregatedReward = userInfo.aggregatedReward;

        uint256 _liquidityAmount;

        if (_poolType == ISystemPoolsRegistry.PoolType.LIQUIDITY_POOL) {
            _liquidityAmount = ERC20(_liquidityPool).balanceOf(_userAddr);
        }

        (uint256 _borrowAmount, ) = IBasicPool(_liquidityPool).borrowInfos(_userAddr);

        if (_liquidityAmount > 0) {
            _newAggregatedReward += (_newSupplyCumulativeSum - userInfo.lastSupplyCumulativeSum)
                .mulWithPrecision(_liquidityAmount);
        }

        if (_borrowAmount > 0) {
            _newAggregatedReward += (_newBorrowCumulativeSum - userInfo.lastBorrowCumulativeSum)
                .mulWithPrecision(_borrowAmount);
        }
    }

    function _getNewCumulativeSums(
        bytes32 _assetKey,
        address _liquidityPool,
        ISystemPoolsRegistry.PoolType _poolType
    ) internal view returns (uint256 _newSupplyCumulativeSum, uint256 _newBorrowCumulativeSum) {
        LiquidityPoolInfo storage liquidityPoolInfo = liquidityPoolsInfo[_assetKey];

        uint256 _lastUpdate = liquidityPoolInfo.lastUpdate;
        _lastUpdate = _lastUpdate == 0 ? block.number : _lastUpdate;

        uint256 _blocksDelta = block.number - _lastUpdate;

        _newSupplyCumulativeSum = liquidityPoolInfo.supplyCumulativeSum;
        _newBorrowCumulativeSum = liquidityPoolInfo.borrowCumulativeSum;

        if (_blocksDelta != 0) {
            LiquidityPoolStats memory _stats = _getLiquidityPoolStats(
                _assetKey,
                _liquidityPool,
                _poolType
            );

            if (_stats.totalSupplyPool != 0) {
                _newSupplyCumulativeSum = _countNewCumulativeSum(
                    _stats.supplyRewardPerBlock,
                    _stats.totalSupplyPool,
                    _newSupplyCumulativeSum,
                    _blocksDelta
                );
            }

            if (_stats.totalBorrowPool != 0) {
                _newBorrowCumulativeSum = _countNewCumulativeSum(
                    _stats.borrowRewardPerBlock,
                    _stats.totalBorrowPool,
                    _newBorrowCumulativeSum,
                    _blocksDelta
                );
            }
        }
    }

    function _getLiquidityPoolStats(
        bytes32 _assetKey,
        address _liquidityPool,
        ISystemPoolsRegistry.PoolType _poolType
    ) internal view returns (LiquidityPoolStats memory) {
        uint256 _supplyRewardPerBlock;
        uint256 _borrowRewardPerBlock;
        uint256 _totalSupplyPool;

        if (_poolType == ISystemPoolsRegistry.PoolType.LIQUIDITY_POOL) {
            (_supplyRewardPerBlock, _borrowRewardPerBlock) = _getRewardsPerBlock(
                _assetKey,
                ILiquidityPool(_liquidityPool).getBorrowPercentage()
            );

            _totalSupplyPool = ERC20(_liquidityPool).totalSupply();
        } else {
            _borrowRewardPerBlock = liquidityPoolsInfo[_assetKey].rewardPerBlock;
        }

        uint256 _totalBorrowPool = IBasicPool(_liquidityPool).aggregatedBorrowedAmount();

        return
            LiquidityPoolStats(
                _supplyRewardPerBlock,
                _borrowRewardPerBlock,
                _totalSupplyPool,
                _totalBorrowPool
            );
    }

    function _getRewardsPerBlock(
        bytes32 _assetKey,
        uint256 _currentUR
    ) internal view returns (uint256 _supplyRewardPerBlock, uint256 _borrowRewardPerBlock) {
        uint256 _totalRewardPerBlock = liquidityPoolsInfo[_assetKey].rewardPerBlock;

        if (_totalRewardPerBlock == 0) {
            return (_supplyRewardPerBlock, _borrowRewardPerBlock);
        }

        IAssetParameters.DistributionMinimums memory _distrMinimums = assetParameters
            .getDistributionMinimums(_assetKey);

        uint256 _supplyRewardPerBlockPart = (PERCENTAGE_100 -
            _distrMinimums.minBorrowDistrPart -
            _distrMinimums.minSupplyDistrPart).mulWithPrecision(_currentUR) +
            _distrMinimums.minSupplyDistrPart;

        _supplyRewardPerBlock = _totalRewardPerBlock.mulWithPrecision(_supplyRewardPerBlockPart);
        _borrowRewardPerBlock = _totalRewardPerBlock - _supplyRewardPerBlock;
    }

    function _onlyExistingRewardsAssetKey() internal view returns (bool) {
        return systemPoolsRegistry.rewardsAssetKey() != bytes32(0);
    }

    function _countNewCumulativeSum(
        uint256 _rewardPerBlock,
        uint256 _totalPool,
        uint256 _prevCumulativeSum,
        uint256 _blocksDelta
    ) internal pure returns (uint256) {
        uint256 _newPrice = _rewardPerBlock.divWithPrecision(_totalPool);
        return _blocksDelta * _newPrice + _prevCumulativeSum;
    }
}
