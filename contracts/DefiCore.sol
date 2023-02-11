// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "@dlsl/dev-modules/contracts-registry/AbstractDependant.sol";
import "@dlsl/dev-modules/libs/decimals/DecimalsConverter.sol";

import "./interfaces/IRegistry.sol";
import "./interfaces/IDefiCore.sol";
import "./interfaces/ISystemParameters.sol";
import "./interfaces/IAssetParameters.sol";
import "./interfaces/IUserInfoRegistry.sol";
import "./interfaces/ISystemPoolsRegistry.sol";
import "./interfaces/IRewardsDistribution.sol";
import "./interfaces/IBasicPool.sol";
import "./interfaces/IPRT.sol";

import "./libraries/AssetsHelperLibrary.sol";
import "./libraries/MathHelper.sol";

import "./common/Globals.sol";

contract DefiCore is
    IDefiCore,
    AbstractDependant,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using AssetsHelperLibrary for bytes32;
    using DecimalsConverter for uint256;
    using MathHelper for uint256;
    using SafeERC20 for IERC20;

    address internal _systemOwnerAddr;
    IAssetParameters internal _assetParameters;
    ISystemParameters internal _systemParameters;
    IUserInfoRegistry internal _userInfoRegistry;
    ISystemPoolsRegistry internal _systemPoolsRegistry;
    IRewardsDistribution internal _rewardsDistribution;
    IPRT internal _prt;

    mapping(address => mapping(bytes32 => bool)) public override disabledCollateralAssets;

    modifier onlySystemOwner() {
        require(
            msg.sender == _systemOwnerAddr,
            "DefiCore: Only system owner can call this function."
        );
        _;
    }

    function defiCoreInitialize() external initializer {
        __Pausable_init();
        __ReentrancyGuard_init();
    }

    function setDependencies(address contractsRegistry_) external override dependant {
        IRegistry registry_ = IRegistry(contractsRegistry_);

        _systemOwnerAddr = registry_.getSystemOwner();
        _assetParameters = IAssetParameters(registry_.getAssetParametersContract());
        _systemParameters = ISystemParameters(registry_.getSystemParametersContract());
        _userInfoRegistry = IUserInfoRegistry(registry_.getUserInfoRegistryContract());
        _rewardsDistribution = IRewardsDistribution(registry_.getRewardsDistributionContract());
        _systemPoolsRegistry = ISystemPoolsRegistry(registry_.getSystemPoolsRegistryContract());
        _prt = IPRT(registry_.getPRTContract());
    }

    function pause() external override onlySystemOwner {
        _pause();
    }

    function unpause() external override onlySystemOwner {
        _unpause();
    }

    function updateCollateral(
        bytes32 assetKey_,
        bool isDisabled_
    ) external override whenNotPaused nonReentrant {
        bool hasPRT_ = _prt.hasValidPRT(msg.sender);
        IAssetParameters assetParameters_ = _assetParameters;

        require(
            assetParameters_.isAvailableAsCollateral(assetKey_, hasPRT_),
            "DefiCore: Asset is blocked for collateral."
        );

        require(
            disabledCollateralAssets[msg.sender][assetKey_] != isDisabled_,
            "DefiCore: The new value cannot be equal to the current value."
        );

        uint256 currentSupplyAmount_ = assetKey_.getCurrentSupplyAmountInUSD(
            msg.sender,
            _systemPoolsRegistry,
            IDefiCore(address(this))
        );

        if (isDisabled_ && currentSupplyAmount_ > 0) {
            (uint256 availableLiquidity_, ) = getAvailableLiquidity(msg.sender);
            uint256 currentLimitPart_ = currentSupplyAmount_.divWithPrecision(
                assetParameters_.getColRatio(assetKey_, hasPRT_)
            );

            require(
                availableLiquidity_ >= currentLimitPart_,
                "DefiCore: It is impossible to disable the asset as a collateral."
            );
        }

        disabledCollateralAssets[msg.sender][assetKey_] = isDisabled_;

        emit CollateralUpdated(msg.sender, assetKey_, isDisabled_);
    }

    function updateCompoundRate(
        bytes32 assetKey_,
        bool withInterval_
    ) external override whenNotPaused returns (uint256) {
        return
            assetKey_.getAssetLiquidityPool(_systemPoolsRegistry).updateCompoundRate(
                withInterval_
            );
    }

    function addLiquidity(
        bytes32 assetKey_,
        uint256 liquidityAmount_
    ) external payable override whenNotPaused nonReentrant {
        require(liquidityAmount_ > 0, "DefiCore: Liquidity amount must be greater than zero.");

        ILiquidityPool assetLiquidityPool_ = assetKey_.getAssetLiquidityPool(_systemPoolsRegistry);

        _rewardsDistribution.updateCumulativeSums(msg.sender, address(assetLiquidityPool_));

        assetLiquidityPool_.addLiquidity{value: msg.value}(msg.sender, liquidityAmount_);

        _userInfoRegistry.updateUserAssets(msg.sender, assetKey_, true);

        _userInfoRegistry.updateUserStatsForPRT(msg.sender, 0, 0, true);

        emit LiquidityAdded(msg.sender, assetKey_, liquidityAmount_);
    }

    function withdrawLiquidity(
        bytes32 assetKey_,
        uint256 liquidityAmount_,
        bool isMaxWithdraw_
    ) external override whenNotPaused nonReentrant {
        ILiquidityPool assetLiquidityPool_ = assetKey_.getAssetLiquidityPool(_systemPoolsRegistry);

        _rewardsDistribution.updateCumulativeSums(msg.sender, address(assetLiquidityPool_));

        assetLiquidityPool_.updateCompoundRate(true);

        if (!isMaxWithdraw_) {
            require(liquidityAmount_ > 0, "DefiCore: Liquidity amount must be greater than zero.");

            if (isCollateralAssetEnabled(msg.sender, assetKey_)) {
                uint256 newBorrowLimit_ = getNewBorrowLimitInUSD(
                    msg.sender,
                    assetKey_,
                    liquidityAmount_,
                    false
                );

                require(
                    newBorrowLimit_ >= getTotalBorrowBalanceInUSD(msg.sender),
                    "DefiCore: Borrow limit used greater than 100%."
                );
            }
        } else {
            liquidityAmount_ = getMaxToWithdraw(msg.sender, assetKey_);
        }

        assetLiquidityPool_.withdrawLiquidity(msg.sender, liquidityAmount_, isMaxWithdraw_);

        _userInfoRegistry.updateUserAssets(msg.sender, assetKey_, true);

        _userInfoRegistry.updateUserStatsForPRT(msg.sender, 0, 0, true);

        emit LiquidityWithdrawn(msg.sender, assetKey_, liquidityAmount_);
    }

    function approveToDelegateBorrow(
        bytes32 assetKey_,
        uint256 approveAmount_,
        address delegateeAddr_,
        uint256 currentAllowance_
    ) external override whenNotPaused {
        ILiquidityPool(assetKey_.getAssetLiquidityPool(_systemPoolsRegistry)).approveToBorrow(
            msg.sender,
            approveAmount_,
            delegateeAddr_,
            currentAllowance_
        );

        emit DelegateBorrowApproved(msg.sender, assetKey_, delegateeAddr_, approveAmount_);
    }

    function borrowFor(
        bytes32 assetKey_,
        uint256 borrowAmount_,
        address recipientAddr_
    ) external override whenNotPaused nonReentrant {
        _borrowInternal(assetKey_, borrowAmount_, msg.sender);

        assetKey_.getAssetLiquidityPool(_systemPoolsRegistry).borrowFor(
            msg.sender,
            recipientAddr_,
            borrowAmount_
        );

        _userInfoRegistry.updateUserAssets(msg.sender, assetKey_, false);

        _userInfoRegistry.updateUserStatsForPRT(msg.sender, 0, 0, false);

        emit Borrowed(msg.sender, recipientAddr_, assetKey_, borrowAmount_);
    }

    function delegateBorrow(
        bytes32 assetKey_,
        uint256 borrowAmount_,
        address borrowerAddr_
    ) external override whenNotPaused nonReentrant {
        _borrowInternal(assetKey_, borrowAmount_, borrowerAddr_);

        assetKey_.getAssetLiquidityPool(_systemPoolsRegistry).delegateBorrow(
            borrowerAddr_,
            msg.sender,
            borrowAmount_
        );

        _userInfoRegistry.updateUserAssets(borrowerAddr_, assetKey_, false);

        _userInfoRegistry.updateUserStatsForPRT(borrowerAddr_, 0, 0, false);

        emit Borrowed(borrowerAddr_, msg.sender, assetKey_, borrowAmount_);
    }

    function repayBorrow(
        bytes32 assetKey_,
        uint256 repayAmount_,
        bool isMaxRepay_
    ) external payable override whenNotPaused nonReentrant {
        if (!isMaxRepay_) {
            require(repayAmount_ > 0, "DefiCore: Zero amount cannot be repaid.");
        }

        ILiquidityPool assetLiquidityPool_ = assetKey_.getAssetLiquidityPool(_systemPoolsRegistry);

        _rewardsDistribution.updateCumulativeSums(msg.sender, address(assetLiquidityPool_));

        repayAmount_ = assetLiquidityPool_.repayBorrowFor{value: msg.value}(
            msg.sender,
            msg.sender,
            repayAmount_,
            isMaxRepay_
        );

        _userInfoRegistry.updateUserAssets(msg.sender, assetKey_, false);

        _userInfoRegistry.updateUserStatsForPRT(msg.sender, 1, 0, false);

        emit BorrowRepaid(msg.sender, assetKey_, repayAmount_);
    }

    function delegateRepayBorrow(
        bytes32 assetKey_,
        uint256 repayAmount_,
        address recipientAddr_,
        bool isMaxRepay_
    ) external payable override whenNotPaused nonReentrant {
        require(repayAmount_ > 0, "DefiCore: Zero amount cannot be repaid.");

        ILiquidityPool assetLiquidityPool_ = assetKey_.getAssetLiquidityPool(_systemPoolsRegistry);

        _rewardsDistribution.updateCumulativeSums(recipientAddr_, address(assetLiquidityPool_));

        assetLiquidityPool_.repayBorrowFor{value: msg.value}(
            recipientAddr_,
            msg.sender,
            repayAmount_,
            isMaxRepay_
        );

        _userInfoRegistry.updateUserAssets(recipientAddr_, assetKey_, false);

        _userInfoRegistry.updateUserStatsForPRT(recipientAddr_, 1, 0, false);

        emit BorrowRepaid(recipientAddr_, assetKey_, repayAmount_);
    }

    function liquidation(
        address userAddr_,
        bytes32 supplyAssetKey_,
        bytes32 borrowAssetKey_,
        uint256 liquidationAmount_
    ) external payable override whenNotPaused nonReentrant {
        require(userAddr_ != msg.sender, "DefiCore: User cannot liquidate his position.");
        require(
            isCollateralAssetEnabled(userAddr_, supplyAssetKey_),
            "DefiCore: Supply asset key must be enabled as collateral."
        );

        uint256 totalBorrowBalanceInUSD_ = getTotalBorrowBalanceInUSD(userAddr_);
        require(
            totalBorrowBalanceInUSD_ > getCurrentBorrowLimitInUSD(userAddr_),
            "DefiCore: Not enough dept for liquidation."
        );

        require(liquidationAmount_ > 0, "DefiCore: Liquidation amount should be more than zero.");

        ISystemPoolsRegistry poolsRegistry_ = _systemPoolsRegistry;
        IAssetParameters assetParameters_ = _assetParameters;

        ILiquidityPool borrowAssetsPool_ = borrowAssetKey_.getAssetLiquidityPool(poolsRegistry_);
        ILiquidityPool supplyAssetsPool_ = supplyAssetKey_.getAssetLiquidityPool(poolsRegistry_);

        require(
            borrowAssetsPool_.getAmountInUSD(liquidationAmount_) <=
                _userInfoRegistry.getMaxLiquidationQuantity(
                    userAddr_,
                    supplyAssetKey_,
                    borrowAssetKey_
                ),
            "DefiCore: Liquidation amount should be less than max quantity."
        );

        IRewardsDistribution rewardsDistribution_ = _rewardsDistribution;

        rewardsDistribution_.updateCumulativeSums(userAddr_, address(supplyAssetsPool_));
        rewardsDistribution_.updateCumulativeSums(userAddr_, address(borrowAssetsPool_));

        uint256 amountToLiquidateInUsd_ = borrowAssetsPool_.getAmountInUSD(
            borrowAssetsPool_.repayBorrowFor{value: msg.value}(
                userAddr_,
                msg.sender,
                liquidationAmount_,
                false
            )
        );

        uint256 repayAmount_ = supplyAssetsPool_
            .getAmountFromUSD(amountToLiquidateInUsd_)
            .divWithPrecision(
                PERCENTAGE_100 - assetParameters_.getLiquidationDiscount(supplyAssetKey_)
            );

        supplyAssetsPool_.liquidate(userAddr_, msg.sender, repayAmount_);

        IUserInfoRegistry userInfoRegistry_ = _userInfoRegistry;

        userInfoRegistry_.updateUserAssets(userAddr_, supplyAssetKey_, true);
        userInfoRegistry_.updateUserAssets(userAddr_, borrowAssetKey_, false);

        _userInfoRegistry.updateUserStatsForPRT(userAddr_, 0, 1, true);
        _userInfoRegistry.updateUserStatsForPRT(userAddr_, 0, 0, false);

        emit Liquidation(userAddr_, supplyAssetKey_, borrowAssetKey_, liquidationAmount_);
    }

    function claimDistributionRewards(
        bytes32[] memory assetKeys_,
        bool isAllPools_
    ) external override whenNotPaused nonReentrant returns (uint256 totalReward_) {
        IRewardsDistribution rewardsDistribution_ = _rewardsDistribution;
        ISystemPoolsRegistry poolsRegistry_ = _systemPoolsRegistry;

        IERC20 rewardsToken_ = IERC20(_systemParameters.getRewardsTokenAddress());

        require(
            address(rewardsToken_) != address(0),
            "DefiCore: Unable to claim distribution rewards."
        );

        if (isAllPools_) {
            assetKeys_ = poolsRegistry_.getAllSupportedAssetKeys();
        }

        for (uint256 i = 0; i < assetKeys_.length; i++) {
            totalReward_ += rewardsDistribution_.withdrawUserReward(
                assetKeys_[i],
                msg.sender,
                address(assetKeys_[i].getAssetLiquidityPool(poolsRegistry_))
            );
        }

        require(totalReward_ > 0, "DefiCore: Nothing to claim.");

        require(
            rewardsToken_.balanceOf(address(this)) >= totalReward_,
            "DefiCore: Not enough rewards tokens on the contract."
        );

        rewardsToken_.safeTransfer(msg.sender, totalReward_);

        emit DistributionRewardWithdrawn(msg.sender, totalReward_);
    }

    function getTotalSupplyBalanceInUSD(
        address userAddr_
    ) external view override returns (uint256 totalSupplyBalance_) {
        ISystemPoolsRegistry poolsRegistry_ = _systemPoolsRegistry;
        bytes32[] memory userSupplyAssets_ = _userInfoRegistry.getUserSupplyAssets(userAddr_);

        for (uint256 i = 0; i < userSupplyAssets_.length; i++) {
            totalSupplyBalance_ += userSupplyAssets_[i].getCurrentSupplyAmountInUSD(
                userAddr_,
                poolsRegistry_,
                IDefiCore(address(this))
            );
        }
    }

    function getMaxToBorrow(
        address userAddr_,
        bytes32 assetKey_
    ) external view override returns (uint256) {
        ILiquidityPool liquidityPool_ = assetKey_.getAssetLiquidityPool(_systemPoolsRegistry);

        (, ISystemPoolsRegistry.PoolType _poolType) = _systemPoolsRegistry.poolsInfo(assetKey_);
        (uint256 availableLiquidityInUSD_, uint256 debtAmount_) = getAvailableLiquidity(userAddr_);

        if (debtAmount_ > 0) {
            return 0;
        }

        if (_poolType == ISystemPoolsRegistry.PoolType.LIQUIDITY_POOL) {
            uint256 _availableToBorrowAmount = liquidityPool_.getAvailableToBorrowLiquidity();

            availableLiquidityInUSD_ = Math.min(
                availableLiquidityInUSD_,
                liquidityPool_.getAmountInUSD(_availableToBorrowAmount)
            );
        }

        return liquidityPool_.getAmountFromUSD(availableLiquidityInUSD_);
    }

    function getMaxToRepay(
        address userAddr_,
        bytes32 assetKey_
    ) external view override returns (uint256) {
        ILiquidityPool liquidityPool_ = assetKey_.getAssetLiquidityPool(_systemPoolsRegistry);

        (, uint256 normalizedAmount_) = liquidityPool_.borrowInfos(userAddr_);
        uint256 userBalance_ = IERC20(liquidityPool_.assetAddr()).balanceOf(userAddr_).to18(
            liquidityPool_.getUnderlyingDecimals()
        );

        if (assetKey_ == _systemPoolsRegistry.nativeAssetKey()) {
            uint256 minCurrencyAmount_ = _systemParameters.getMinCurrencyAmount();

            userBalance_ += userAddr_.balance > minCurrencyAmount_
                ? userAddr_.balance - minCurrencyAmount_
                : 0;
        }

        return
            Math.min(
                userBalance_,
                normalizedAmount_.mulWithPrecision(liquidityPool_.getNewCompoundRate())
            );
    }

    function getMaxToSupply(
        address userAddr_,
        bytes32 assetKey_
    ) external view override returns (uint256 maxToSupply_) {
        ILiquidityPool liquidityPool_ = assetKey_.getAssetLiquidityPool(_systemPoolsRegistry);

        maxToSupply_ = IERC20(liquidityPool_.assetAddr()).balanceOf(userAddr_).to18(
            liquidityPool_.getUnderlyingDecimals()
        );

        if (assetKey_ == _systemPoolsRegistry.nativeAssetKey()) {
            maxToSupply_ += userAddr_.balance;
        }
    }

    function getMaxToWithdraw(
        address userAddr_,
        bytes32 assetKey_
    ) public view override returns (uint256 maxToWithdraw_) {
        bool hasPRT_ = _prt.hasValidPRT(userAddr_);
        IAssetParameters assetParameters_ = _assetParameters;
        ILiquidityPool liquidityPool_ = assetKey_.getAssetLiquidityPool(_systemPoolsRegistry);

        maxToWithdraw_ =
            getUserLiquidityAmount(userAddr_, assetKey_) -
            liquidityPool_.convertLPTokensToAsset(
                liquidityPool_.getCurrentLastLiquidity(userAddr_)
            );

        uint256 totalBorrowBalance_ = getTotalBorrowBalanceInUSD(userAddr_);
        uint256 colRatio_ = assetParameters_.getColRatio(assetKey_, hasPRT_);

        if (isCollateralAssetEnabled(userAddr_, assetKey_)) {
            uint256 borrowLimitInUSD_ = getCurrentBorrowLimitInUSD(userAddr_);

            if (totalBorrowBalance_ > borrowLimitInUSD_) return 0;

            uint256 userLiquidityInUSD_ = liquidityPool_.getAmountInUSD(maxToWithdraw_);
            uint256 residualLimit_ = borrowLimitInUSD_ -
                userLiquidityInUSD_.divWithPrecision(colRatio_);

            if (residualLimit_ < totalBorrowBalance_) {
                uint256 missingAmount = (totalBorrowBalance_ - residualLimit_).mulWithPrecision(
                    colRatio_
                );
                maxToWithdraw_ = liquidityPool_.getAmountFromUSD(
                    userLiquidityInUSD_ - missingAmount
                );
            }
        }

        uint256 aggregatedBorrowedAmount_ = liquidityPool_.aggregatedBorrowedAmount();
        uint256 expectedTotalLiquidity_ = aggregatedBorrowedAmount_.divWithPrecision(
            assetParameters_.getMaxUtilizationRatio(assetKey_)
        );
        uint256 currentTotalLiquidity_ = liquidityPool_.getAggregatedLiquidityAmount() +
            aggregatedBorrowedAmount_;
        uint256 maxAvailableLiquidity_ = currentTotalLiquidity_ > expectedTotalLiquidity_
            ? currentTotalLiquidity_ - expectedTotalLiquidity_
            : 0;

        maxToWithdraw_ = Math.min(maxToWithdraw_, maxAvailableLiquidity_);
    }

    function isCollateralAssetEnabled(
        address userAddr_,
        bytes32 assetKey_
    ) public view override returns (bool) {
        bool hasPRT_ = _prt.hasValidPRT(userAddr_);
        if (
            _assetParameters.isAvailableAsCollateral(assetKey_, hasPRT_) &&
            !disabledCollateralAssets[userAddr_][assetKey_]
        ) {
            return true;
        }

        return false;
    }

    function getUserLiquidityAmount(
        address userAddr_,
        bytes32 assetKey_
    ) public view override returns (uint256) {
        ILiquidityPool liquidityPool_ = assetKey_.getAssetLiquidityPool(_systemPoolsRegistry);

        return
            liquidityPool_.convertLPTokensToAsset(
                IERC20(address(liquidityPool_)).balanceOf(userAddr_)
            );
    }

    function getUserBorrowedAmount(
        address userAddr_,
        bytes32 assetKey_
    ) public view override returns (uint256) {
        ILiquidityPool liquidityPool_ = assetKey_.getAssetLiquidityPool(_systemPoolsRegistry);
        (, uint256 normalizedAmount_) = liquidityPool_.borrowInfos(userAddr_);

        return normalizedAmount_.mulWithPrecision(liquidityPool_.getCurrentRate());
    }

    function getTotalBorrowBalanceInUSD(
        address userAddr_
    ) public view override returns (uint256 totalBorrowBalance_) {
        ISystemPoolsRegistry poolsRegistry_ = _systemPoolsRegistry;
        bytes32[] memory userBorrowAssets_ = _userInfoRegistry.getUserBorrowAssets(userAddr_);

        for (uint256 i = 0; i < userBorrowAssets_.length; i++) {
            totalBorrowBalance_ += userBorrowAssets_[i].getCurrentBorrowAmountInUSD(
                userAddr_,
                poolsRegistry_,
                IDefiCore(address(this))
            );
        }
    }

    function getCurrentBorrowLimitInUSD(
        address userAddr_
    ) public view override returns (uint256 currentBorrowLimit_) {
        bool hasPRT_ = _prt.hasValidPRT(userAddr_);
        ISystemPoolsRegistry poolsRegistry_ = _systemPoolsRegistry;
        IAssetParameters assetParameters_ = _assetParameters;
        bytes32[] memory userSupplyAssets_ = _userInfoRegistry.getUserSupplyAssets(userAddr_);

        for (uint256 i = 0; i < userSupplyAssets_.length; i++) {
            bytes32 currentAssetKey_ = userSupplyAssets_[i];

            if (isCollateralAssetEnabled(userAddr_, currentAssetKey_)) {
                uint256 currentTokensAmount_ = currentAssetKey_.getCurrentSupplyAmountInUSD(
                    userAddr_,
                    poolsRegistry_,
                    IDefiCore(address(this))
                );

                currentBorrowLimit_ += currentTokensAmount_.divWithPrecision(
                    assetParameters_.getColRatio(currentAssetKey_, hasPRT_)
                );
            }
        }
    }

    function getNewBorrowLimitInUSD(
        address userAddr_,
        bytes32 assetKey_,
        uint256 tokensAmount_,
        bool isAdding_
    ) public view override returns (uint256) {
        bool hasPRT_ = _prt.hasValidPRT(userAddr_);
        uint256 newLimit_ = getCurrentBorrowLimitInUSD(userAddr_);

        if (!isCollateralAssetEnabled(userAddr_, assetKey_)) {
            return newLimit_;
        }

        ILiquidityPool _liquidityPool = assetKey_.getAssetLiquidityPool(_systemPoolsRegistry);

        uint256 _newAmount = _liquidityPool.getAmountInUSD(tokensAmount_).divWithPrecision(
            _assetParameters.getColRatio(assetKey_, hasPRT_)
        );

        if (isAdding_) {
            newLimit_ += _newAmount;
        } else if (_newAmount < newLimit_) {
            newLimit_ -= _newAmount;
        } else {
            newLimit_ = 0;
        }

        return newLimit_;
    }

    function getAvailableLiquidity(
        address userAddr_
    ) public view override returns (uint256, uint256) {
        uint256 borrowLimitInUSD_ = getCurrentBorrowLimitInUSD(userAddr_);
        uint256 totalBorrowedAmountInUSD_ = getTotalBorrowBalanceInUSD(userAddr_);

        if (borrowLimitInUSD_ > totalBorrowedAmountInUSD_) {
            return (borrowLimitInUSD_ - totalBorrowedAmountInUSD_, 0);
        } else {
            return (0, totalBorrowedAmountInUSD_ - borrowLimitInUSD_);
        }
    }

    function _borrowInternal(
        bytes32 assetKey_,
        uint256 borrowAmount_,
        address borrowerAddr_
    ) internal {
        require(
            !_assetParameters.isPoolFrozen(assetKey_),
            "DefiCore: Pool is freeze for borrow operations."
        );

        require(borrowAmount_ > 0, "DefiCore: Borrow amount must be greater than zero.");

        (uint256 availableLiquidity_, uint256 debtAmount_) = getAvailableLiquidity(borrowerAddr_);

        require(debtAmount_ == 0, "DefiCore: Unable to borrow because the account is in arrears.");

        ILiquidityPool assetLiquidityPool_ = assetKey_.getAssetLiquidityPool(_systemPoolsRegistry);

        require(
            availableLiquidity_ >= assetLiquidityPool_.getAmountInUSD(borrowAmount_),
            "DefiCore: Not enough available liquidity."
        );

        _rewardsDistribution.updateCumulativeSums(borrowerAddr_, address(assetLiquidityPool_));
    }
}
