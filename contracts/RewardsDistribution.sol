// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./interfaces/IAssetParameters.sol";
import "./interfaces/IBorrowerRouterRegistry.sol";
import "./interfaces/IRewardsDistribution.sol";
import "./interfaces/ILiquidityPoolRegistry.sol";
import "./interfaces/ILiquidityPool.sol";

import "./libraries/MathHelper.sol";

import "./Registry.sol";
import "./common/Globals.sol";
import "./common/AbstractDependant.sol";

contract RewardsDistribution is IRewardsDistribution, OwnableUpgradeable, AbstractDependant {
    using MathHelper for uint256;

    IAssetParameters private assetParameters;
    IBorrowerRouterRegistry private borrowerRouterRegistry;
    ILiquidityPoolRegistry private liquidityPoolsRegistry;
    address private defiCoreAddr;
    address private integrationCoreAddr;

    struct LiquidityPoolStats {
        uint256 supplyRewardPerBlock;
        uint256 borrowRewardPerBlock;
        uint256 totalSupplyPool;
        uint256 totalBorrowPool;
    }

    mapping(bytes32 => LiquidityPoolInfo) public liquidityPoolsInfo;
    mapping(bytes32 => mapping(address => UserDistributionInfo)) public usersDistributionInfo;

    modifier onlyEligibleContracts {
        require(
            defiCoreAddr == msg.sender ||
                integrationCoreAddr == msg.sender ||
                liquidityPoolsRegistry.existingLiquidityPools(msg.sender),
            "RewardsDistribution: Caller not an eligible contract."
        );
        _;
    }

    function rewardsDistributionInitialize() external initializer {
        __Ownable_init();
    }

    function setDependencies(Registry _registry) external override onlyInjectorOrZero {
        defiCoreAddr = _registry.getDefiCoreContract();
        integrationCoreAddr = _registry.getIntegrationCoreContract();
        assetParameters = IAssetParameters(_registry.getAssetParametersContract());
        borrowerRouterRegistry = IBorrowerRouterRegistry(
            _registry.getBorrowerRouterRegistryContract()
        );
        liquidityPoolsRegistry = ILiquidityPoolRegistry(
            _registry.getLiquidityPoolRegistryContract()
        );
    }

    function getAPY(ILiquidityPool _liquidityPool)
        external
        view
        override
        returns (uint256 _supplyAPY, uint256 _borrowAPY)
    {
        ILiquidityPool _governanceLP =
            ILiquidityPool(liquidityPoolsRegistry.getGovernanceLiquidityPool());
        bytes32 _assetKey = _liquidityPool.assetKey();

        LiquidityPoolStats memory _stats = _getLiquidityPoolStats(_assetKey, _liquidityPool);

        uint256 _annualSupplyReward =
            _governanceLP.getAmountInUSD(_stats.supplyRewardPerBlock) * BLOCKS_PER_YEAR * DECIMAL;
        uint256 _totalSupplyPoolInUSD =
            _liquidityPool.getAmountInUSD(
                _liquidityPool.convertNTokensToAsset(_stats.totalSupplyPool)
            );

        if (_totalSupplyPoolInUSD != 0) {
            _supplyAPY = _annualSupplyReward / _totalSupplyPoolInUSD;
        }

        uint256 _annualBorrowReward =
            _governanceLP.getAmountInUSD(_stats.borrowRewardPerBlock) * BLOCKS_PER_YEAR * DECIMAL;
        uint256 _totalBorrowPoolInUSD = _liquidityPool.getAmountInUSD(_stats.totalBorrowPool);

        if (_totalBorrowPoolInUSD != 0) {
            _borrowAPY = _annualBorrowReward / _totalBorrowPoolInUSD;
        }
    }

    function getUserReward(
        bytes32 _assetKey,
        address _userAddr,
        ILiquidityPool _liquidityPool
    ) external view override returns (uint256 _userReward) {
        (uint256 _newSupplyCumulativeSum, uint256 _newBorrowCumulativeSum) =
            _getNewCumulativeSums(_assetKey, _liquidityPool);
        _userReward = _getNewUserReward(
            _userAddr,
            _assetKey,
            _liquidityPool,
            _newSupplyCumulativeSum,
            _newBorrowCumulativeSum
        );
    }

    function updateCumulativeSums(address _userAddr, ILiquidityPool _liquidityPool)
        external
        override
        onlyEligibleContracts
    {
        _updateSumsWithUserReward(_userAddr, _liquidityPool.assetKey(), _liquidityPool);
    }

    function withdrawUserReward(
        bytes32 _assetKey,
        address _userAddr,
        ILiquidityPool _liquidityPool
    ) external override onlyEligibleContracts returns (uint256 _userReward) {
        _updateSumsWithUserReward(_userAddr, _assetKey, _liquidityPool);

        UserDistributionInfo storage userInfo = usersDistributionInfo[_assetKey][_userAddr];

        _userReward = userInfo.aggregatedReward;

        if (_userReward > 0) {
            delete userInfo.aggregatedReward;
        }
    }

    function setupRewardsPerBlockBatch(
        bytes32[] calldata _assetKeys,
        uint256[] calldata _rewardsPerBlock
    ) external override onlyOwner {
        require(
            _assetKeys.length == _rewardsPerBlock.length,
            "RewardsDistribution: Length mismatch."
        );

        ILiquidityPoolRegistry _registry = liquidityPoolsRegistry;

        for (uint256 i = 0; i < _assetKeys.length; i++) {
            bytes32 _currentKey = _assetKeys[i];

            if (liquidityPoolsInfo[_currentKey].rewardPerBlock != 0) {
                _updateCumulativeSums(
                    _currentKey,
                    ILiquidityPool(_registry.liquidityPools(_currentKey))
                );
            } else {
                liquidityPoolsInfo[_currentKey].lastUpdate = block.number;
            }

            liquidityPoolsInfo[_currentKey].rewardPerBlock = _rewardsPerBlock[i];
        }
    }

    function _updateSumsWithUserReward(
        address _userAddr,
        bytes32 _assetKey,
        ILiquidityPool _liquidityPool
    ) internal {
        (uint256 _newSupplyCumulativeSum, uint256 _newBorrowCumulativeSum) =
            _updateCumulativeSums(_assetKey, _liquidityPool);
        uint256 _newReward =
            _getNewUserReward(
                _userAddr,
                _assetKey,
                _liquidityPool,
                _newSupplyCumulativeSum,
                _newBorrowCumulativeSum
            );

        usersDistributionInfo[_assetKey][_userAddr] = UserDistributionInfo(
            _newSupplyCumulativeSum,
            _newBorrowCumulativeSum,
            _newReward
        );
    }

    function _updateCumulativeSums(bytes32 _assetKey, ILiquidityPool _liquidityPool)
        internal
        returns (uint256 _newSupplyCumulativeSum, uint256 _newBorrowCumulativeSum)
    {
        (_newSupplyCumulativeSum, _newBorrowCumulativeSum) = _getNewCumulativeSums(
            _assetKey,
            _liquidityPool
        );

        LiquidityPoolInfo storage liquidityPoolInfo = liquidityPoolsInfo[_assetKey];

        liquidityPoolInfo.supplyCumulativeSum = _newSupplyCumulativeSum;
        liquidityPoolInfo.borrowCumulativeSum = _newBorrowCumulativeSum;
        liquidityPoolInfo.lastUpdate = block.number;
    }

    function _getNewUserReward(
        address _userAddr,
        bytes32 _assetKey,
        ILiquidityPool _liquidityPool,
        uint256 _newSupplyCumulativeSum,
        uint256 _newBorrowCumulativeSum
    ) internal view returns (uint256 _newAggregatedReward) {
        UserDistributionInfo storage userInfo = usersDistributionInfo[_assetKey][_userAddr];

        _newAggregatedReward = userInfo.aggregatedReward;

        ERC20 _lpToken = ERC20(address(_liquidityPool));
        address _borrowerRouterAddr = borrowerRouterRegistry.borrowerRouters(_userAddr);

        uint256 _liquidityAmount = _lpToken.balanceOf(_userAddr);
        if (_borrowerRouterAddr != address(0)) {
            _liquidityAmount += _lpToken.balanceOf(_borrowerRouterAddr);
        }

        uint256 _borrowAmount = _liquidityPool.getUserTotalBorrowedAmount(_userAddr);

        if (_liquidityAmount > 0) {
            _newAggregatedReward += (_newSupplyCumulativeSum - userInfo.lastSupplyCumulativeSum)
                .mulWithPrecision(_liquidityAmount);
        }

        if (_borrowAmount > 0) {
            _newAggregatedReward += (_newBorrowCumulativeSum - userInfo.lastBorrowCumulativeSum)
                .mulWithPrecision(_borrowAmount);
        }
    }

    function _getNewCumulativeSums(bytes32 _assetKey, ILiquidityPool _liquidityPool)
        internal
        view
        returns (uint256 _newSupplyCumulativeSum, uint256 _newBorrowCumulativeSum)
    {
        LiquidityPoolInfo storage liquidityPoolInfo = liquidityPoolsInfo[_assetKey];

        uint256 _lastUpdate = liquidityPoolInfo.lastUpdate;
        _lastUpdate = _lastUpdate == 0 ? block.number : _lastUpdate;

        uint256 _blocksDelta = block.number - _lastUpdate;

        _newSupplyCumulativeSum = liquidityPoolInfo.supplyCumulativeSum;
        _newBorrowCumulativeSum = liquidityPoolInfo.borrowCumulativeSum;

        if (_blocksDelta != 0) {
            LiquidityPoolStats memory _stats = _getLiquidityPoolStats(_assetKey, _liquidityPool);

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

    function _getLiquidityPoolStats(bytes32 _assetKey, ILiquidityPool _liquidityPool)
        internal
        view
        returns (LiquidityPoolStats memory)
    {
        (uint256 _supplyRewardPerBlock, uint256 _borrowRewardPerBlock) =
            _getRewardsPerBlock(_assetKey, _liquidityPool.getBorrowPercentage());
        uint256 _totalBorrowPool = _liquidityPool.aggregatedBorrowedAmount();

        return
            LiquidityPoolStats(
                _supplyRewardPerBlock,
                _borrowRewardPerBlock,
                ERC20(address(_liquidityPool)).totalSupply(),
                _totalBorrowPool
            );
    }

    function _getRewardsPerBlock(bytes32 _assetKey, uint256 _currentUR)
        internal
        view
        returns (uint256 _supplyRewardPerBlock, uint256 _borrowRewardPerBlock)
    {
        (uint256 _minSupplyPart, uint256 _minBorrowPart) =
            assetParameters.getDistributionMinimums(_assetKey);

        uint256 _totalRewardPerBlock = liquidityPoolsInfo[_assetKey].rewardPerBlock;

        uint256 _supplyRewardPerBlockPart =
            (DECIMAL - _minBorrowPart - _minSupplyPart).mulWithPrecision(_currentUR) +
                _minSupplyPart;

        _supplyRewardPerBlock = _totalRewardPerBlock.mulWithPrecision(_supplyRewardPerBlockPart);
        _borrowRewardPerBlock = _totalRewardPerBlock - _supplyRewardPerBlock;
    }

    function _countAPY(
        uint256 _userAmount,
        uint256 _totalReward,
        ILiquidityPool _liquidityPool,
        ILiquidityPool _governanceLP
    ) internal view returns (uint256 _resultAPY) {
        _resultAPY = _governanceLP.getAmountInUSD(_totalReward).divWithPrecision(
            _liquidityPool.getAmountInUSD(_userAmount)
        );
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
