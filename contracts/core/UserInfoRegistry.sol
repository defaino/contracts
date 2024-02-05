// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "@solarity/solidity-lib/contracts-registry/AbstractDependant.sol";
import "@solarity/solidity-lib/libs/utils/DecimalsConverter.sol";

import "../interfaces/IRegistry.sol";
import "../interfaces/IDefiCore.sol";
import "../interfaces/IAssetParameters.sol";
import "../interfaces/ISystemParameters.sol";
import "../interfaces/IRewardsDistribution.sol";
import "../interfaces/ISystemPoolsRegistry.sol";
import "../interfaces/IBasicPool.sol";
import "../interfaces/IUserInfoRegistry.sol";

import "../interfaces/IPRT.sol";

import "../libraries/AssetsHelperLibrary.sol";
import "../libraries/MathHelper.sol";

contract UserInfoRegistry is IUserInfoRegistry, AbstractDependant {
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using AssetsHelperLibrary for bytes32;
    using DecimalsConverter for uint256;
    using MathHelper for uint256;

    IDefiCore internal _defiCore;
    ISystemParameters internal _systemParameters;
    IAssetParameters internal _assetParameters;
    IRewardsDistribution internal _rewardsDistribution;
    ISystemPoolsRegistry internal _systemPoolsRegistry;
    IPRT internal _prt;

    mapping(address => EnumerableSet.Bytes32Set) internal _supplyAssets;
    mapping(address => EnumerableSet.Bytes32Set) internal _borrowAssets;

    mapping(address => StatsForPRT) internal _userPRTStats;

    modifier onlyDefiCore() {
        require(address(_defiCore) == msg.sender, "UserInfoRegistry: Caller not a DefiCore.");
        _;
    }

    modifier onlyLiquidityPools() {
        require(
            _systemPoolsRegistry.existingLiquidityPools(msg.sender),
            "UserInfoRegistry: Caller not a LiquidityPool."
        );
        _;
    }

    function setDependencies(address contractsRegistry_, bytes memory) public override dependant {
        IRegistry registry_ = IRegistry(contractsRegistry_);

        _defiCore = IDefiCore(registry_.getDefiCoreContract());
        _assetParameters = IAssetParameters(registry_.getAssetParametersContract());
        _systemParameters = ISystemParameters(registry_.getSystemParametersContract());
        _rewardsDistribution = IRewardsDistribution(registry_.getRewardsDistributionContract());
        _systemPoolsRegistry = ISystemPoolsRegistry(registry_.getSystemPoolsRegistryContract());

        _prt = IPRT(registry_.getPRTContract());
    }

    function updateAssetsAfterTransfer(
        bytes32 assetKey_,
        address from_,
        address to_,
        uint256 amount_
    ) external override onlyLiquidityPools {
        if (IERC20(msg.sender).balanceOf(from_) - amount_ == 0) {
            _supplyAssets[from_].remove(assetKey_);
        }

        _supplyAssets[to_].add(assetKey_);
    }

    function updateUserStatsForPRT(
        address userAddr_,
        uint256 repaysCount_,
        uint256 liquidationsCount_,
        bool isSupply_
    ) external override onlyDefiCore {
        if (repaysCount_ > 0) {
            _userPRTStats[userAddr_].repaysNum += repaysCount_;
        }

        if (liquidationsCount_ > 0) {
            _userPRTStats[userAddr_].liquidationsNum += liquidationsCount_;
        }

        _updateUserPositionStatsForPRT(
            userAddr_,
            isSupply_
                ? _userPRTStats[userAddr_].supplyStats
                : _userPRTStats[userAddr_].borrowStats,
            isSupply_
                ? IDefiCore(msg.sender).getTotalSupplyBalanceInUSD
                : IDefiCore(msg.sender).getTotalBorrowBalanceInUSD,
            isSupply_
                ? _prt.getPRTParams().supplyParams.minAmountInUSD
                : _prt.getPRTParams().borrowParams.minAmountInUSD
        );
    }

    function updateUserAssets(
        address userAddr_,
        bytes32 assetKey_,
        bool isSupply_
    ) external override onlyDefiCore {
        _updateUserAssets(
            userAddr_,
            assetKey_,
            isSupply_ ? _supplyAssets[userAddr_] : _borrowAssets[userAddr_],
            isSupply_
                ? IDefiCore(msg.sender).getUserLiquidityAmount
                : IDefiCore(msg.sender).getUserBorrowedAmount
        );
    }

    function getUserPRTStats(
        address userAddr_
    ) external view override returns (StatsForPRT memory) {
        return _userPRTStats[userAddr_];
    }

    function getUserSupplyAssets(
        address userAddr_
    ) external view override returns (bytes32[] memory) {
        return _supplyAssets[userAddr_].values();
    }

    function getUserBorrowAssets(
        address userAddr_
    ) external view override returns (bytes32[] memory) {
        return _borrowAssets[userAddr_].values();
    }

    function getUserMainInfo(
        address userAddr_
    ) external view override returns (UserMainInfo memory) {
        uint256 totalBorrowBalance_ = _defiCore.getTotalBorrowBalanceInUSD(userAddr_);
        uint256 borrowLimit_ = _defiCore.getCurrentBorrowLimitInUSD(userAddr_);
        uint256 borrowLimitUsed_ = borrowLimit_ > 0
            ? totalBorrowBalance_.divWithPrecision(borrowLimit_)
            : 0;

        return
            UserMainInfo(
                userAddr_.balance,
                _defiCore.getTotalSupplyBalanceInUSD(userAddr_),
                totalBorrowBalance_,
                borrowLimit_,
                borrowLimitUsed_
            );
    }

    function getUserDistributionRewards(
        address _userAddr
    ) external view override returns (RewardsDistributionInfo memory) {
        ISystemPoolsRegistry poolsRegistry_ = _systemPoolsRegistry;
        IRewardsDistribution rewardsDistribution_ = _rewardsDistribution;

        IERC20Metadata rewardsToken_ = IERC20Metadata(_systemParameters.getRewardsTokenAddress());
        ILiquidityPool rewardsPool_ = ILiquidityPool(poolsRegistry_.getRewardsLiquidityPool());

        if (address(rewardsToken_) == address(0) || address(rewardsPool_) == address(0)) {
            return RewardsDistributionInfo(address(0), 0, 0, 0, 0);
        }

        bytes32[] memory allAssets_ = poolsRegistry_.getAllSupportedAssetKeys();

        uint256 totalReward_;

        for (uint256 i = 0; i < allAssets_.length; i++) {
            totalReward_ += rewardsDistribution_.getUserReward(
                allAssets_[i],
                _userAddr,
                address(allAssets_[i].getAssetLiquidityPool(poolsRegistry_))
            );
        }

        uint256 userBalance_ = rewardsToken_.balanceOf(_userAddr).to18(rewardsToken_.decimals());

        return
            RewardsDistributionInfo(
                address(rewardsToken_),
                totalReward_,
                rewardsPool_.getAmountInUSD(totalReward_),
                userBalance_,
                rewardsPool_.getAmountInUSD(userBalance_)
            );
    }

    function getUserSupplyPoolsInfo(
        address userAddr_,
        bytes32[] calldata assetKeys_
    ) external view override returns (UserSupplyPoolInfo[] memory supplyPoolsInfo_) {
        IDefiCore defiCore_ = _defiCore;
        ISystemPoolsRegistry poolsRegistry_ = _systemPoolsRegistry;

        supplyPoolsInfo_ = new UserSupplyPoolInfo[](assetKeys_.length);

        for (uint256 i = 0; i < assetKeys_.length; i++) {
            ILiquidityPool currentLiquidityPool_ = assetKeys_[i].getAssetLiquidityPool(
                poolsRegistry_
            );

            uint256 marketSize_ = currentLiquidityPool_.getTotalLiquidity();
            uint256 userDepositAmount_ = defiCore_.getUserLiquidityAmount(
                userAddr_,
                assetKeys_[i]
            );
            (uint256 distrSupplyAPY_, ) = _rewardsDistribution.getAPY(assetKeys_[i]);

            supplyPoolsInfo_[i] = UserSupplyPoolInfo(
                _getBasePoolInfo(userAddr_, assetKeys_[i], currentLiquidityPool_, defiCore_),
                marketSize_,
                currentLiquidityPool_.getAmountInUSD(marketSize_),
                userDepositAmount_,
                currentLiquidityPool_.getAmountInUSD(userDepositAmount_),
                currentLiquidityPool_.getAPY(),
                distrSupplyAPY_
            );
        }
    }

    function getUserBorrowPoolsInfo(
        address userAddr_,
        bytes32[] calldata assetKeys_
    ) external view override returns (UserBorrowPoolInfo[] memory borrowPoolsInfo_) {
        IDefiCore defiCore_ = _defiCore;
        ISystemPoolsRegistry poolsRegistry_ = _systemPoolsRegistry;

        borrowPoolsInfo_ = new UserBorrowPoolInfo[](assetKeys_.length);

        for (uint256 i = 0; i < assetKeys_.length; i++) {
            ILiquidityPool currentLiquidityPool_ = assetKeys_[i].getAssetLiquidityPool(
                poolsRegistry_
            );

            uint256 availableToBorrow_ = currentLiquidityPool_.getAvailableToBorrowLiquidity();
            uint256 userBorrowAmount_ = defiCore_.getUserBorrowedAmount(userAddr_, assetKeys_[i]);
            (, uint256 distrBorrowAPY_) = _rewardsDistribution.getAPY(assetKeys_[i]);

            borrowPoolsInfo_[i] = UserBorrowPoolInfo(
                _getBasePoolInfo(userAddr_, assetKeys_[i], currentLiquidityPool_, defiCore_),
                availableToBorrow_,
                currentLiquidityPool_.getAmountInUSD(availableToBorrow_),
                userBorrowAmount_,
                currentLiquidityPool_.getAmountInUSD(userBorrowAmount_),
                currentLiquidityPool_.getAnnualBorrowRate(),
                distrBorrowAPY_
            );
        }
    }

    function getUserPoolInfo(
        address userAddr_,
        bytes32 assetKey_
    ) external view override returns (UserPoolInfo memory) {
        IDefiCore defiCore_ = _defiCore;
        IBasicPool basicPool_ = assetKey_.getAssetLiquidityPool(_systemPoolsRegistry);
        IERC20Metadata asset_ = IERC20Metadata(basicPool_.assetAddr());

        uint256 userSupplyBalance_;
        bool isCollateralEnabled_;

        uint256 walletBalance_ = asset_.balanceOf(userAddr_).to18(asset_.decimals());
        uint256 userBorrowedAmount_ = defiCore_.getUserBorrowedAmount(userAddr_, assetKey_);

        if (assetKey_ == _systemPoolsRegistry.nativeAssetKey()) {
            walletBalance_ += userAddr_.balance;
        }

        (, ISystemPoolsRegistry.PoolType poolType_) = _systemPoolsRegistry.poolsInfo(assetKey_);

        if (poolType_ == ISystemPoolsRegistry.PoolType.LIQUIDITY_POOL) {
            userSupplyBalance_ = defiCore_.getUserLiquidityAmount(userAddr_, assetKey_);
            isCollateralEnabled_ = defiCore_.isCollateralAssetEnabled(userAddr_, assetKey_);
        }

        return
            UserPoolInfo(
                walletBalance_,
                basicPool_.getAmountInUSD(walletBalance_),
                userSupplyBalance_,
                basicPool_.getAmountInUSD(userSupplyBalance_),
                userBorrowedAmount_,
                basicPool_.getAmountInUSD(userBorrowedAmount_),
                isCollateralEnabled_
            );
    }

    function getUserMaxValues(
        address userAddr_,
        bytes32 assetKey_
    ) external view override returns (UserMaxValues memory) {
        IDefiCore defiCore_ = _defiCore;

        uint256 maxToSupply_;
        uint256 maxToWithdraw_;

        (, ISystemPoolsRegistry.PoolType poolType_) = _systemPoolsRegistry.poolsInfo(assetKey_);

        if (poolType_ == ISystemPoolsRegistry.PoolType.LIQUIDITY_POOL) {
            maxToSupply_ = defiCore_.getMaxToSupply(userAddr_, assetKey_);
            maxToWithdraw_ = defiCore_.getMaxToWithdraw(userAddr_, assetKey_);
        }

        return
            UserMaxValues(
                maxToSupply_,
                maxToWithdraw_,
                defiCore_.getMaxToBorrow(userAddr_, assetKey_),
                defiCore_.getMaxToRepay(userAddr_, assetKey_)
            );
    }

    function getUsersLiquidiationInfo(
        address[] calldata accounts_
    ) external view override returns (UserLiquidationInfo[] memory resultArr_) {
        IDefiCore defiCore_ = _defiCore;

        resultArr_ = new UserLiquidationInfo[](accounts_.length);

        for (uint256 i = 0; i < accounts_.length; i++) {
            bytes32[] memory allUserSupplyAssets_ = _supplyAssets[accounts_[i]].values();

            bytes32[] memory userSupplyAssets_ = new bytes32[](allUserSupplyAssets_.length);
            uint256 arrIndex_;

            for (uint256 j = 0; j < allUserSupplyAssets_.length; j++) {
                if (defiCore_.isCollateralAssetEnabled(accounts_[i], allUserSupplyAssets_[j])) {
                    userSupplyAssets_[arrIndex_++] = allUserSupplyAssets_[j];
                }
            }

            resultArr_[i] = UserLiquidationInfo(
                accounts_[i],
                _getMainPoolsInfo(_borrowAssets[accounts_[i]].values()),
                _getMainPoolsInfo(userSupplyAssets_),
                defiCore_.getTotalBorrowBalanceInUSD(accounts_[i])
            );
        }
    }

    function getUserLiquidationData(
        address userAddr_,
        bytes32 borrowAssetKey_,
        bytes32 receiveAssetKey_
    ) external view override returns (UserLiquidationData memory) {
        IDefiCore defiCore_ = _defiCore;
        ISystemPoolsRegistry poolsRegistry_ = _systemPoolsRegistry;
        ILiquidityPool borrowLiquidityPool_ = borrowAssetKey_.getAssetLiquidityPool(
            poolsRegistry_
        );

        uint256 receiveAssetPrice_ = receiveAssetKey_
            .getAssetLiquidityPool(poolsRegistry_)
            .getAssetPrice();

        return
            UserLiquidationData(
                borrowLiquidityPool_.getAssetPrice(),
                receiveAssetPrice_,
                receiveAssetPrice_.mulWithPrecision(
                    PERCENTAGE_100 - _assetParameters.getLiquidationDiscount(receiveAssetKey_)
                ),
                defiCore_.getUserBorrowedAmount(userAddr_, borrowAssetKey_),
                defiCore_.getUserLiquidityAmount(userAddr_, receiveAssetKey_),
                borrowLiquidityPool_.getAmountFromUSD(
                    getMaxLiquidationQuantity(userAddr_, receiveAssetKey_, borrowAssetKey_)
                )
            );
    }

    function getMaxLiquidationQuantity(
        address userAddr_,
        bytes32 supplyAssetKey_,
        bytes32 borrowAssetKey_
    ) public view override returns (uint256 maxQuantityInUSD_) {
        IDefiCore defiCore_ = _defiCore;
        ISystemPoolsRegistry poolsRegistry_ = _systemPoolsRegistry;

        uint256 liquidateLimitBySupply_ = defiCore_
            .getUserLiquidityAmount(userAddr_, supplyAssetKey_)
            .mulWithPrecision(
                PERCENTAGE_100 - _assetParameters.getLiquidationDiscount(supplyAssetKey_)
            );

        uint256 userBorrowAmountInUSD_ = borrowAssetKey_
            .getAssetLiquidityPool(poolsRegistry_)
            .getAmountInUSD(defiCore_.getUserBorrowedAmount(userAddr_, borrowAssetKey_));

        maxQuantityInUSD_ = Math.min(
            supplyAssetKey_.getAssetLiquidityPool(poolsRegistry_).getAmountInUSD(
                liquidateLimitBySupply_
            ),
            userBorrowAmountInUSD_
        );

        uint256 maxLiquidatePart_ = defiCore_
            .getTotalBorrowBalanceInUSD(userAddr_)
            .mulWithPrecision(_systemParameters.getLiquidationBoundary());

        maxQuantityInUSD_ = Math.min(maxQuantityInUSD_, maxLiquidatePart_);
    }

    function _updateUserPositionStatsForPRT(
        address userAddr_,
        LastSavedUserPosition storage userPosition_,
        function(address) external view returns (uint256) getUserCurrentUSDAmount_,
        uint256 minUSDAmountForPRT_
    ) internal {
        uint256 userLastSavedUSDAmount_ = userPosition_.amountInUSD;
        uint256 userCurrentUSDAmount_ = getUserCurrentUSDAmount_(userAddr_);

        if (
            userLastSavedUSDAmount_ >= minUSDAmountForPRT_ &&
            userCurrentUSDAmount_ < minUSDAmountForPRT_
        ) {
            userPosition_.timestamp = 0;
        } else if (
            userLastSavedUSDAmount_ < minUSDAmountForPRT_ &&
            userCurrentUSDAmount_ >= minUSDAmountForPRT_
        ) {
            userPosition_.timestamp = block.timestamp;
        }

        userPosition_.amountInUSD = userCurrentUSDAmount_;
    }

    function _updateUserAssets(
        address userAddr_,
        bytes32 assetKey_,
        EnumerableSet.Bytes32Set storage userAssets_,
        function(address, bytes32) external view returns (uint256) getAmount_
    ) internal {
        if (getAmount_(userAddr_, assetKey_) == 0) {
            userAssets_.remove(assetKey_);
        } else {
            userAssets_.add(assetKey_);
        }
    }

    function _getBasePoolInfo(
        address userAddr_,
        bytes32 assetKey_,
        ILiquidityPool liquidityPool_,
        IDefiCore defiCore_
    ) internal view returns (BasePoolInfo memory) {
        return
            BasePoolInfo(
                MainPoolInfo(assetKey_, liquidityPool_.assetAddr()),
                liquidityPool_.getBorrowPercentage(),
                defiCore_.isCollateralAssetEnabled(userAddr_, assetKey_)
            );
    }

    function _getMainPoolsInfo(
        bytes32[] memory assetKeys_
    ) internal view returns (MainPoolInfo[] memory mainPoolsInfo_) {
        ISystemPoolsRegistry poolsRegistry_ = _systemPoolsRegistry;

        mainPoolsInfo_ = new MainPoolInfo[](assetKeys_.length);

        for (uint256 i; i < assetKeys_.length; i++) {
            if (assetKeys_[i] == bytes32(0)) {
                mainPoolsInfo_[i] = MainPoolInfo(assetKeys_[i], address(0));

                continue;
            }

            ILiquidityPool currentLiquidityPool_ = assetKeys_[i].getAssetLiquidityPool(
                poolsRegistry_
            );

            mainPoolsInfo_[i] = MainPoolInfo(assetKeys_[i], currentLiquidityPool_.assetAddr());
        }
    }
}
