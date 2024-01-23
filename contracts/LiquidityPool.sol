// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "./interfaces/IRewardsDistribution.sol";
import "./interfaces/IUserInfoRegistry.sol";
import "./interfaces/tokens/IWETH.sol";

import "./abstract/AbstractPool.sol";

contract LiquidityPool is ILiquidityPool, AbstractPool, ERC20Upgradeable {
    using SafeERC20 for IERC20;
    using DecimalsConverter for uint256;
    using MathHelper for uint256;

    IRewardsDistribution internal _rewardsDistribution;
    IUserInfoRegistry internal _userInfoRegistry;

    mapping(address => UserLastLiquidity) public override lastLiquidity;

    function liquidityPoolInitialize(
        address assetAddr_,
        bytes32 assetKey_,
        string calldata tokenSymbol_
    ) external override initializer {
        __ERC20_init(
            string(abi.encodePacked("DlDeFiCore ", tokenSymbol_)),
            string(abi.encodePacked("lp", tokenSymbol_))
        );
        _abstractPoolInitialize(assetAddr_, assetKey_);
    }

    function setDependencies(
        address contractsRegistry_,
        bytes memory data_
    ) public virtual override dependant {
        super.setDependencies(contractsRegistry_, data_);

        _rewardsDistribution = IRewardsDistribution(
            IRegistry(contractsRegistry_).getRewardsDistributionContract()
        );
        _userInfoRegistry = IUserInfoRegistry(
            IRegistry(contractsRegistry_).getUserInfoRegistryContract()
        );
    }

    receive() external payable {}

    function addLiquidity(
        address userAddr_,
        uint256 liquidityAmount_
    ) external payable override onlyDefiCore {
        _ifNativePoolCheck(userAddr_, liquidityAmount_);

        uint256 assetAmount_ = _convertToUnderlyingAsset(liquidityAmount_);

        require(
            IERC20(assetAddr).balanceOf(userAddr_) >= assetAmount_,
            "LiquidityPool: Not enough tokens on account."
        );

        updateCompoundRate(true);

        uint256 mintAmount_ = convertAssetToLPTokens(liquidityAmount_);

        _updateUserLastLiquidity(userAddr_, mintAmount_, true);

        _mint(userAddr_, mintAmount_);

        IERC20(assetAddr).safeTransferFrom(userAddr_, address(this), assetAmount_);
    }

    function withdrawLiquidity(
        address userAddr_,
        uint256 liquidityAmount_,
        bool isMaxWithdraw_
    ) external override onlyDefiCore {
        if (!isMaxWithdraw_) {
            require(
                getAggregatedLiquidityAmount() >= liquidityAmount_,
                "LiquidityPool: Not enough liquidity available on the contract."
            );
        }

        uint256 toBurnLP_ = convertAssetToLPTokens(liquidityAmount_);

        if (isMaxWithdraw_) {
            uint256 userLPBalance_ = balanceOf(userAddr_);

            /// @dev Needed to withdraw all funds without a balance
            if (convertLPTokensToAsset(userLPBalance_) <= liquidityAmount_) {
                toBurnLP_ = userLPBalance_;
            }
        } else {
            require(
                balanceOf(userAddr_) - getCurrentLastLiquidity(userAddr_) >= toBurnLP_,
                "LiquidityPool: Not enough lpTokens to withdraw liquidity."
            );
        }

        _burn(userAddr_, toBurnLP_);

        _sendAssetTokens(userAddr_, liquidityAmount_);

        if (!isMaxWithdraw_) {
            require(
                getBorrowPercentage() <= _assetParameters.getMaxUtilizationRatio(assetKey),
                "LiquidityPool: Utilization ratio after withdraw cannot be greater than the maximum."
            );
        }
    }

    function liquidate(
        address userAddr_,
        address liquidatorAddr_,
        uint256 liquidityAmount_
    ) external override onlyDefiCore {
        updateCompoundRate(true);

        _burn(userAddr_, convertAssetToLPTokens(liquidityAmount_));

        _sendAssetTokens(liquidatorAddr_, liquidityAmount_);
    }

    function getAPY() external view override returns (uint256) {
        uint256 totalBorrowedAmount_ = aggregatedBorrowedAmount;

        if (totalSupply() == 0) {
            return 0;
        }

        uint256 currentInterest_ = totalBorrowedAmount_.mulWithPrecision(
            PERCENTAGE_100 + getAnnualBorrowRate()
        ) - totalBorrowedAmount_;

        return
            currentInterest_.mulDiv(
                PERCENTAGE_100 - _assetParameters.getReserveFactor(assetKey),
                getTotalLiquidity()
            );
    }

    function getTotalLiquidity() public view override returns (uint256) {
        return convertLPTokensToAsset(totalSupply());
    }

    function getAggregatedLiquidityAmount() public view override returns (uint256) {
        return
            _convertFromUnderlyingAsset(IERC20(assetAddr).balanceOf(address(this))) -
            totalReserves;
    }

    function getBorrowPercentage() public view override returns (uint256) {
        return _getBorrowPercentage(0);
    }

    function getAvailableToBorrowLiquidity() public view override returns (uint256) {
        uint256 absoluteBorrowAmount_ = aggregatedBorrowedAmount;
        uint256 maxAvailableLiquidity_ = (absoluteBorrowAmount_ + getAggregatedLiquidityAmount())
            .mulWithPrecision(_assetParameters.getMaxUtilizationRatio(assetKey));

        if (maxAvailableLiquidity_ <= absoluteBorrowAmount_) return 0;

        return maxAvailableLiquidity_ - absoluteBorrowAmount_;
    }

    function getAnnualBorrowRate()
        public
        view
        override(IBasicPool, AbstractPool)
        returns (uint256)
    {
        uint256 utilizationRatio_ = getBorrowPercentage();

        if (utilizationRatio_ == 0) {
            return 0;
        }

        IAssetParameters.InterestRateParams memory params_ = _assetParameters
            .getInterestRateParams(assetKey);
        uint256 utilizationBreakingPoint_ = params_.utilizationBreakingPoint;

        if (utilizationRatio_ < utilizationBreakingPoint_) {
            return
                AnnualRatesConverter.getAnnualRate(
                    0,
                    params_.firstSlope,
                    utilizationRatio_,
                    0,
                    utilizationBreakingPoint_,
                    PERCENTAGE_100
                );
        } else {
            return
                AnnualRatesConverter.getAnnualRate(
                    params_.firstSlope,
                    params_.secondSlope,
                    utilizationRatio_,
                    utilizationBreakingPoint_,
                    PERCENTAGE_100,
                    PERCENTAGE_100
                );
        }
    }

    function convertAssetToLPTokens(uint256 assetAmount_) public view override returns (uint256) {
        return assetAmount_.divWithPrecision(exchangeRate());
    }

    function convertLPTokensToAsset(
        uint256 lpTokensAmount_
    ) public view override returns (uint256) {
        return lpTokensAmount_.mulWithPrecision(exchangeRate());
    }

    function exchangeRate() public view override returns (uint256) {
        uint256 totalSupply_ = totalSupply();

        if (totalSupply_ == 0) {
            return PERCENTAGE_100;
        }

        uint256 aggregatedBorrowedAmount_ = aggregatedBorrowedAmount;
        uint256 totalBorrowedAmount_ = getTotalBorrowedAmount();
        uint256 currentBorrowInterest_ = totalBorrowedAmount_ > aggregatedBorrowedAmount_
            ? (totalBorrowedAmount_ - aggregatedBorrowedAmount_).mulWithPrecision(
                PERCENTAGE_100 - _assetParameters.getReserveFactor(assetKey)
            )
            : 0;

        return
            (currentBorrowInterest_ + aggregatedBorrowedAmount_ + getAggregatedLiquidityAmount())
                .divWithPrecision(totalSupply_);
    }

    function getCurrentLastLiquidity(address _userAddr) public view override returns (uint256) {
        UserLastLiquidity storage userLastLiquidity = lastLiquidity[_userAddr];

        return userLastLiquidity.blockNumber == block.number ? userLastLiquidity.liquidity : 0;
    }

    function _beforeTokenTransfer(address from_, address to_, uint256 amount_) internal override {
        if (from_ != address(0) && to_ != address(0)) {
            IDefiCore defiCore_ = _defiCore;
            IRewardsDistribution rewardsDistribution_ = _rewardsDistribution;

            if (defiCore_.isCollateralAssetEnabled(from_, assetKey)) {
                uint256 newBorrowLimit_ = defiCore_.getNewBorrowLimitInUSD(
                    from_,
                    assetKey,
                    amount_,
                    false
                );
                require(
                    newBorrowLimit_ >= defiCore_.getTotalBorrowBalanceInUSD(from_),
                    "LiquidityPool: Borrow limit used after transfer greater than 100%."
                );
            }

            uint256 freeLiquidity_ = balanceOf(from_) - getCurrentLastLiquidity(from_);

            if (amount_ > freeLiquidity_) {
                uint256 _lastLiquidityNeeded = amount_ - freeLiquidity_;

                _updateUserLastLiquidity(to_, _lastLiquidityNeeded, true);
                _updateUserLastLiquidity(from_, _lastLiquidityNeeded, false);
            }

            _userInfoRegistry.updateAssetsAfterTransfer(assetKey, from_, to_, amount_);

            rewardsDistribution_.updateCumulativeSums(from_, address(this));
            rewardsDistribution_.updateCumulativeSums(to_, address(this));
        }
    }

    function _borrowAssetTokens(uint256 amountToBorrow_, address recipient_) internal override {
        _sendAssetTokens(recipient_, amountToBorrow_);
    }

    function _repayAssetTokens(uint256 repayAmount_, address payerAddr_) internal override {
        IERC20(assetAddr).safeTransferFrom(
            payerAddr_,
            address(this),
            _convertToUnderlyingAsset(repayAmount_)
        );
    }

    function _beforeBorrowCheck(uint256 amountToBorrow_, address) internal override {
        require(
            getAggregatedLiquidityAmount() >= amountToBorrow_,
            "LiquidityPool: Not enough available to borrow amount."
        );

        require(
            _getBorrowPercentage(amountToBorrow_) <=
                _assetParameters.getMaxUtilizationRatio(assetKey),
            "LiquidityPool: Utilization ratio after borrow cannot be greater than the maximum."
        );
    }

    function _beforeRepayCheck(uint256 repayAmount_, address payerAddr_) internal override {
        _ifNativePoolCheck(payerAddr_, repayAmount_);
    }

    function _ifNativePoolCheck(address userAddr_, uint256 neededAmount_) internal {
        if (assetKey == _systemPoolsRegistry.nativeAssetKey()) {
            IWETH nativeToken_ = IWETH(assetAddr);
            uint256 userTokenBalance_ = nativeToken_.balanceOf(userAddr_).to18(
                nativeToken_.decimals()
            );

            if (neededAmount_ > userTokenBalance_) {
                uint256 toDepositAmount_ = neededAmount_ - userTokenBalance_;
                require(
                    msg.value >= toDepositAmount_,
                    "LiquidityPool: Wrong native currency amount."
                );

                nativeToken_.depositTo{value: toDepositAmount_}(userAddr_);

                uint256 extraCurrency_ = msg.value - toDepositAmount_;

                if (extraCurrency_ > 0) {
                    (bool success_, ) = userAddr_.call{value: extraCurrency_}("");
                    require(success_, "LiquidityPool: Failed to return extra currency.");
                }
            } else {
                require(
                    msg.value == 0,
                    "LiquidityPool: There are enough tokens to deposit the entire amount."
                );
            }
        } else {
            require(msg.value == 0, "LiquidityPool: Unable to add currency to a nonnative pool.");
        }
    }

    function _sendAssetTokens(address recipient_, uint256 amountToSend_) internal {
        if (assetKey != _systemPoolsRegistry.nativeAssetKey()) {
            IERC20(assetAddr).safeTransfer(recipient_, _convertToUnderlyingAsset(amountToSend_));
        } else {
            IWETH(assetAddr).withdrawTo(recipient_, _convertToUnderlyingAsset(amountToSend_));
        }
    }

    function _updateUserLastLiquidity(
        address userAddr_,
        uint256 liquidityAmount_,
        bool isAdding_
    ) internal {
        UserLastLiquidity storage userLastLiquidity = lastLiquidity[userAddr_];

        if (isAdding_) {
            userLastLiquidity.liquidity = getCurrentLastLiquidity(userAddr_) + liquidityAmount_;
        } else {
            userLastLiquidity.liquidity -= liquidityAmount_;
        }

        userLastLiquidity.blockNumber = block.number;
    }

    function _getBorrowPercentage(
        uint256 additionalBorrowAmount_
    ) internal view returns (uint256) {
        uint256 absoluteBorrowAmount_ = aggregatedBorrowedAmount + additionalBorrowAmount_;
        uint256 aggregatedLiquidityAmount_ = getAggregatedLiquidityAmount() -
            additionalBorrowAmount_;

        if (aggregatedLiquidityAmount_ == 0 && absoluteBorrowAmount_ == 0) {
            return 0;
        }

        return
            absoluteBorrowAmount_.divWithPrecision(
                absoluteBorrowAmount_ + aggregatedLiquidityAmount_
            );
    }
}
