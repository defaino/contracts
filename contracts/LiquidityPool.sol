// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "./interfaces/IRewardsDistribution.sol";
import "./interfaces/IUserInfoRegistry.sol";
import "./interfaces/tokens/IWETH.sol";

import "./abstract/AbstractPool.sol";

contract LiquidityPool is ILiquidityPool, AbstractPool, ERC20Upgradeable {
    using SafeERC20 for IERC20;
    using DecimalsConverter for uint256;
    using MathHelper for uint256;

    IRewardsDistribution private rewardsDistribution;
    IUserInfoRegistry private userInfoRegistry;

    mapping(address => UserLastLiquidity) public override lastLiquidity;

    function liquidityPoolInitialize(
        address _assetAddr,
        bytes32 _assetKey,
        string calldata _tokenSymbol
    ) external override initializer {
        __ERC20_init(
            string(abi.encodePacked("DlDeFiCore ", _tokenSymbol)),
            string(abi.encodePacked("lp", _tokenSymbol))
        );
        _abstractPoolInitialize(_assetAddr, _assetKey);
    }

    function setDependencies(address _contractsRegistry) public virtual override dependant {
        super.setDependencies(_contractsRegistry);

        rewardsDistribution = IRewardsDistribution(
            IRegistry(_contractsRegistry).getRewardsDistributionContract()
        );
        userInfoRegistry = IUserInfoRegistry(
            IRegistry(_contractsRegistry).getUserInfoRegistryContract()
        );
    }

    receive() external payable {}

    function addLiquidity(
        address _userAddr,
        uint256 _liquidityAmount
    ) external payable override onlyDefiCore {
        _ifNativePoolCheck(_userAddr, _liquidityAmount);

        uint256 _assetAmount = _convertToUnderlyingAsset(_liquidityAmount);

        require(
            IERC20(assetAddr).balanceOf(_userAddr) >= _assetAmount,
            "LiquidityPool: Not enough tokens on account."
        );

        updateCompoundRate(true);

        uint256 _mintAmount = convertAssetToLPTokens(_liquidityAmount);

        _updateUserLastLiquidity(_userAddr, _mintAmount, true);

        _mint(_userAddr, _mintAmount);

        IERC20(assetAddr).safeTransferFrom(_userAddr, address(this), _assetAmount);
    }

    function withdrawLiquidity(
        address _userAddr,
        uint256 _liquidityAmount,
        bool _isMaxWithdraw
    ) external override onlyDefiCore {
        if (!_isMaxWithdraw) {
            require(
                getAggregatedLiquidityAmount() >= _liquidityAmount,
                "LiquidityPool: Not enough liquidity available on the contract."
            );
        }

        uint256 _toBurnLP = convertAssetToLPTokens(_liquidityAmount);

        if (_isMaxWithdraw) {
            uint256 _userLPBalance = balanceOf(_userAddr);

            /// @dev Needed to withdraw all funds without a balance
            if (convertLPTokensToAsset(_userLPBalance) <= _liquidityAmount) {
                _toBurnLP = _userLPBalance;
            }
        } else {
            require(
                balanceOf(_userAddr) - getCurrentLastLiquidity(_userAddr) >= _toBurnLP,
                "LiquidityPool: Not enough lpTokens to withdraw liquidity."
            );
        }

        _burn(_userAddr, _toBurnLP);

        _sendAssetTokens(_userAddr, _liquidityAmount);

        if (!_isMaxWithdraw) {
            require(
                getBorrowPercentage() <= assetParameters.getMaxUtilizationRatio(assetKey),
                "LiquidityPool: Utilization ratio after withdraw cannot be greater than the maximum."
            );
        }
    }

    function liquidate(
        address _userAddr,
        address _liquidatorAddr,
        uint256 _liquidityAmount
    ) external override onlyDefiCore {
        updateCompoundRate(true);

        _burn(_userAddr, convertAssetToLPTokens(_liquidityAmount));

        _sendAssetTokens(_liquidatorAddr, _liquidityAmount);
    }

    function getAPY() external view override returns (uint256) {
        uint256 _totalBorrowedAmount = aggregatedBorrowedAmount;

        if (totalSupply() == 0) {
            return 0;
        }

        uint256 _currentInterest = _totalBorrowedAmount.mulWithPrecision(
            PERCENTAGE_100 + getAnnualBorrowRate()
        ) - _totalBorrowedAmount;

        return
            _currentInterest.mulDiv(
                PERCENTAGE_100 - assetParameters.getReserveFactor(assetKey),
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
        uint256 _absoluteBorrowAmount = aggregatedBorrowedAmount;
        uint256 _maxAvailableLiquidity = (_absoluteBorrowAmount + getAggregatedLiquidityAmount())
            .mulWithPrecision(assetParameters.getMaxUtilizationRatio(assetKey));

        if (_maxAvailableLiquidity <= _absoluteBorrowAmount) return 0;

        return _maxAvailableLiquidity - _absoluteBorrowAmount;
    }

    function getAnnualBorrowRate()
        public
        view
        override(IBasicPool, AbstractPool)
        returns (uint256)
    {
        uint256 _utilizationRatio = getBorrowPercentage();

        if (_utilizationRatio == 0) {
            return 0;
        }

        IAssetParameters.InterestRateParams memory _params = assetParameters.getInterestRateParams(
            assetKey
        );
        uint256 _utilizationBreakingPoint = _params.utilizationBreakingPoint;

        if (_utilizationRatio < _utilizationBreakingPoint) {
            return
                AnnualRatesConverter.getAnnualRate(
                    0,
                    _params.firstSlope,
                    _utilizationRatio,
                    0,
                    _utilizationBreakingPoint,
                    PERCENTAGE_100
                );
        } else {
            return
                AnnualRatesConverter.getAnnualRate(
                    _params.firstSlope,
                    _params.secondSlope,
                    _utilizationRatio,
                    _utilizationBreakingPoint,
                    PERCENTAGE_100,
                    PERCENTAGE_100
                );
        }
    }

    function convertAssetToLPTokens(uint256 _assetAmount) public view override returns (uint256) {
        return _assetAmount.divWithPrecision(exchangeRate());
    }

    function convertLPTokensToAsset(
        uint256 _lpTokensAmount
    ) public view override returns (uint256) {
        return _lpTokensAmount.mulWithPrecision(exchangeRate());
    }

    function exchangeRate() public view override returns (uint256) {
        uint256 _totalSupply = totalSupply();

        if (_totalSupply == 0) {
            return PERCENTAGE_100;
        }

        uint256 _aggregatedBorrowedAmount = aggregatedBorrowedAmount;
        uint256 _totalBorrowedAmount = getTotalBorrowedAmount();
        uint256 _currentBorrowInterest = _totalBorrowedAmount > _aggregatedBorrowedAmount
            ? (_totalBorrowedAmount - _aggregatedBorrowedAmount).mulWithPrecision(
                PERCENTAGE_100 - assetParameters.getReserveFactor(assetKey)
            )
            : 0;

        return
            (_currentBorrowInterest + _aggregatedBorrowedAmount + getAggregatedLiquidityAmount())
                .divWithPrecision(_totalSupply);
    }

    function getCurrentLastLiquidity(address _userAddr) public view override returns (uint256) {
        UserLastLiquidity storage userLastLiquidity = lastLiquidity[_userAddr];

        return userLastLiquidity.blockNumber == block.number ? userLastLiquidity.liquidity : 0;
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0)) {
            IDefiCore _defiCore = defiCore;
            IRewardsDistribution _rewardsDistribution = rewardsDistribution;

            if (_defiCore.isCollateralAssetEnabled(from, assetKey)) {
                uint256 _newBorrowLimit = _defiCore.getNewBorrowLimitInUSD(
                    from,
                    assetKey,
                    amount,
                    false
                );
                require(
                    _newBorrowLimit >= _defiCore.getTotalBorrowBalanceInUSD(from),
                    "LiquidityPool: Borrow limit used after transfer greater than 100%."
                );
            }

            uint256 _freeLiquidity = balanceOf(from) - getCurrentLastLiquidity(from);

            if (amount > _freeLiquidity) {
                uint256 _lastLiquidityNeeded = amount - _freeLiquidity;

                _updateUserLastLiquidity(to, _lastLiquidityNeeded, true);
                _updateUserLastLiquidity(from, _lastLiquidityNeeded, false);
            }

            userInfoRegistry.updateAssetsAfterTransfer(assetKey, from, to, amount);

            _rewardsDistribution.updateCumulativeSums(from, address(this));
            _rewardsDistribution.updateCumulativeSums(to, address(this));
        }
    }

    function _borrowAssetTokens(uint256 _amountToBorrow, address _recipient) internal override {
        _sendAssetTokens(_recipient, _amountToBorrow);
    }

    function _repayAssetTokens(uint256 _repayAmount, address _payerAddr) internal override {
        IERC20(assetAddr).safeTransferFrom(
            _payerAddr,
            address(this),
            _convertToUnderlyingAsset(_repayAmount)
        );
    }

    function _beforeBorrowCheck(uint256 _amountToBorrow, address _borrowerAddr) internal override {
        require(
            getAggregatedLiquidityAmount() >= _amountToBorrow,
            "LiquidityPool: Not enough available to borrow amount."
        );

        require(
            _getBorrowPercentage(_amountToBorrow) <=
                assetParameters.getMaxUtilizationRatio(assetKey),
            "LiquidityPool: Utilization ratio after borrow cannot be greater than the maximum."
        );
    }

    function _beforeRepayCheck(uint256 _repayAmount, address _payerAddr) internal override {
        _ifNativePoolCheck(_payerAddr, _repayAmount);
    }

    function _ifNativePoolCheck(address _userAddr, uint256 _neededAmount) internal {
        if (assetKey == systemPoolsRegistry.nativeAssetKey()) {
            IWETH _nativeToken = IWETH(assetAddr);
            uint256 _userTokenBalance = _nativeToken.balanceOf(_userAddr).to18(
                _nativeToken.decimals()
            );

            if (_neededAmount > _userTokenBalance) {
                uint256 _toDepositAmount = _neededAmount - _userTokenBalance;
                require(
                    msg.value >= _toDepositAmount,
                    "LiquidityPool: Wrong native currency amount."
                );

                _nativeToken.depositTo{value: _toDepositAmount}(_userAddr);

                uint256 _extraCurrency = msg.value - _toDepositAmount;

                if (_extraCurrency > 0) {
                    (bool _success, ) = _userAddr.call{value: _extraCurrency}("");
                    require(_success, "LiquidityPool: Failed to return extra currency.");
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

    function _sendAssetTokens(address _recipient, uint256 _amountToSend) internal {
        if (assetKey != systemPoolsRegistry.nativeAssetKey()) {
            IERC20(assetAddr).safeTransfer(_recipient, _convertToUnderlyingAsset(_amountToSend));
        } else {
            IWETH(assetAddr).withdrawTo(_recipient, _convertToUnderlyingAsset(_amountToSend));
        }
    }

    function _updateUserLastLiquidity(
        address _userAddr,
        uint256 _liquidityAmount,
        bool _isAdding
    ) internal {
        UserLastLiquidity storage userLastLiquidity = lastLiquidity[_userAddr];

        if (_isAdding) {
            userLastLiquidity.liquidity = getCurrentLastLiquidity(_userAddr) + _liquidityAmount;
        } else {
            userLastLiquidity.liquidity -= _liquidityAmount;
        }

        userLastLiquidity.blockNumber = block.number;
    }

    function _getBorrowPercentage(
        uint256 _additionalBorrowAmount
    ) internal view returns (uint256) {
        uint256 _absoluteBorrowAmount = aggregatedBorrowedAmount + _additionalBorrowAmount;
        uint256 _aggregatedLiquidityAmount = getAggregatedLiquidityAmount() -
            _additionalBorrowAmount;

        if (_aggregatedLiquidityAmount == 0 && _absoluteBorrowAmount == 0) {
            return 0;
        }

        return
            _absoluteBorrowAmount.divWithPrecision(
                _absoluteBorrowAmount + _aggregatedLiquidityAmount
            );
    }
}
