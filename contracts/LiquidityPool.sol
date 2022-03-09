// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import "./interfaces/IDefiCore.sol";
import "./interfaces/ISystemParameters.sol";
import "./interfaces/IAssetParameters.sol";
import "./interfaces/IUserInfoRegistry.sol";
import "./interfaces/ILiquidityPool.sol";
import "./interfaces/IInterestRateLibrary.sol";
import "./interfaces/IRewardsDistribution.sol";
import "./interfaces/ILiquidityPoolRegistry.sol";

import "./libraries/AnnualRatesConverter.sol";
import "./libraries/DecimalsConverter.sol";
import "./libraries/MathHelper.sol";

import "./Registry.sol";
import "./CompoundRateKeeper.sol";
import "./abstract/AbstractDependant.sol";
import "./common/Globals.sol";

contract LiquidityPool is ILiquidityPool, ERC20Upgradeable, AbstractDependant {
    using DecimalsConverter for uint256;
    using MathHelper for uint256;

    IDefiCore private defiCore;
    IAssetParameters private assetParameters;
    IUserInfoRegistry private userInfoRegistry;
    IInterestRateLibrary private interestRateLibrary;
    IRewardsDistribution private rewardsDistribution;
    ILiquidityPoolRegistry private liquidityPoolRegistry;

    CompoundRateKeeper public compoundRateKeeper;

    uint256 public constant UPDATE_RATE_INTERVAL = 1 hours;

    address public override assetAddr;
    bytes32 public override assetKey;

    mapping(address => mapping(uint256 => uint256)) public override lastLiquidity;
    mapping(address => mapping(address => uint256)) public borrowAllowances;

    mapping(address => BorrowInfo) public override borrowInfos;

    uint256 public override aggregatedBorrowedAmount;
    uint256 public aggregatedNormalizedBorrowedAmount;
    uint256 public override totalReserves;

    event FundsWithdrawn(address _recipient, address _liquidityPool, uint256 _amount);
    event BorrowApproval(address _userAddr, uint256 _borrowAmount, address _delegateeAddr);

    modifier onlyDefiCore() {
        require(address(defiCore) == msg.sender, "LiquidityPool: Caller not a DefiCore.");
        _;
    }

    modifier onlyLiquidityPoolRegistry() {
        require(
            address(liquidityPoolRegistry) == msg.sender,
            "LiquidityPool: Caller not an ILiquidityPoolRegistry."
        );
        _;
    }

    function liquidityPoolInitialize(
        address _assetAddr,
        bytes32 _assetKey,
        string calldata _tokenSymbol
    ) external override initializer {
        __ERC20_init(
            string(abi.encodePacked("DL Defi Core ", _tokenSymbol)),
            string(abi.encodePacked("lp", _tokenSymbol))
        );
        compoundRateKeeper = new CompoundRateKeeper();
        assetAddr = _assetAddr;
        assetKey = _assetKey;
    }

    function setDependencies(Registry _registry) external override onlyInjectorOrZero {
        defiCore = IDefiCore(_registry.getDefiCoreContract());
        assetParameters = IAssetParameters(_registry.getAssetParametersContract());
        userInfoRegistry = IUserInfoRegistry(_registry.getUserInfoRegistryContract());
        interestRateLibrary = IInterestRateLibrary(_registry.getInterestRateLibraryContract());
        rewardsDistribution = IRewardsDistribution(_registry.getRewardsDistributionContract());
        liquidityPoolRegistry = ILiquidityPoolRegistry(
            _registry.getLiquidityPoolRegistryContract()
        );
    }

    function getTotalLiquidity() external view override returns (uint256) {
        return convertLPTokensToAsset(totalSupply());
    }

    function getTotalBorrowedAmount() public view override returns (uint256) {
        return
            aggregatedNormalizedBorrowedAmount.mulWithPrecision(
                compoundRateKeeper.getCurrentRate()
            );
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
        uint256 _maxUR = assetParameters.getMaxUtilizationRatio(assetKey);
        uint256 _absoluteBorrowAmount = aggregatedBorrowedAmount;

        return
            (_absoluteBorrowAmount + getAggregatedLiquidityAmount()).mulWithPrecision(_maxUR) -
            _absoluteBorrowAmount;
    }

    function getAnnualBorrowRate() public view override returns (uint256 _annualBorrowRate) {
        uint256 _utilizationRatio = getBorrowPercentage();

        if (_utilizationRatio == 0) {
            return 0;
        }

        IAssetParameters.InterestRateParams memory _params = assetParameters.getInterestRateParams(
            assetKey
        );
        uint256 _utilizationBreakingPoint = _params.utilizationBreakingPoint;

        if (_utilizationRatio < _utilizationBreakingPoint) {
            _annualBorrowRate = AnnualRatesConverter.getAnnualRate(
                0,
                _params.firstSlope,
                _utilizationRatio,
                0,
                _utilizationBreakingPoint,
                DECIMAL
            );
        } else {
            _annualBorrowRate = AnnualRatesConverter.getAnnualRate(
                _params.firstSlope,
                _params.secondSlope,
                _utilizationRatio,
                _utilizationBreakingPoint,
                DECIMAL,
                DECIMAL
            );
        }
    }

    function getAPY() external view override returns (uint256) {
        uint256 _totalBorrowedAmount = aggregatedBorrowedAmount;
        uint256 _currentTotalSupply = totalSupply();

        if (_currentTotalSupply == 0) {
            return 0;
        }

        uint256 _currentInterest = _totalBorrowedAmount.mulWithPrecision(
            DECIMAL + getAnnualBorrowRate()
        ) - _totalBorrowedAmount;

        return
            _currentInterest.mulDiv(
                DECIMAL - assetParameters.getReserveFactor(assetKey),
                _currentTotalSupply
            );
    }

    function convertAssetToLPTokens(uint256 _assetAmount) public view override returns (uint256) {
        return _assetAmount.divWithPrecision(exchangeRate());
    }

    function convertLPTokensToAsset(uint256 _lpTokensAmount)
        public
        view
        override
        returns (uint256)
    {
        return _lpTokensAmount.mulWithPrecision(exchangeRate());
    }

    function exchangeRate() public view override returns (uint256) {
        uint256 _totalSupply = totalSupply();

        if (_totalSupply == 0) {
            return DECIMAL;
        }

        uint256 _aggregatedBorrowedAmount = aggregatedBorrowedAmount;
        uint256 _currentBorrowInterest = (getTotalBorrowedAmount() - _aggregatedBorrowedAmount)
            .mulWithPrecision(DECIMAL - assetParameters.getReserveFactor(assetKey));

        return
            (_currentBorrowInterest + _aggregatedBorrowedAmount + getAggregatedLiquidityAmount())
                .divWithPrecision(_totalSupply);
    }

    function getAmountInUSD(uint256 _assetAmount) public view override returns (uint256) {
        return _assetAmount.mulDiv(getAssetPrice(), ONE_TOKEN);
    }

    function getAmountFromUSD(uint256 _usdAmount) public view override returns (uint256) {
        return _usdAmount.mulDiv(ONE_TOKEN, getAssetPrice());
    }

    function getAssetPrice() public view override returns (uint256) {
        return assetParameters.getAssetPrice(assetKey, getUnderlyingDecimals());
    }

    function getUnderlyingDecimals() public view override returns (uint8) {
        return ERC20(assetAddr).decimals();
    }

    function getCurrentRate() public view override returns (uint256) {
        return compoundRateKeeper.getCurrentRate();
    }

    function getNewCompoundRate() public view override returns (uint256) {
        return
            compoundRateKeeper.getNewCompoundRate(
                AnnualRatesConverter.convertToRatePerSecond(
                    interestRateLibrary,
                    getAnnualBorrowRate(),
                    ONE_PERCENT
                )
            );
    }

    function updateCompoundRate() public override returns (uint256) {
        return
            compoundRateKeeper.update(
                AnnualRatesConverter.convertToRatePerSecond(
                    interestRateLibrary,
                    getAnnualBorrowRate(),
                    ONE_PERCENT
                )
            );
    }

    function updateRateWithInterval() public override returns (uint256) {
        if (compoundRateKeeper.getLastUpdate() + UPDATE_RATE_INTERVAL > block.timestamp) {
            return compoundRateKeeper.getCurrentRate();
        } else {
            return updateCompoundRate();
        }
    }

    function addLiquidity(address _userAddr, uint256 _liquidityAmount)
        external
        override
        onlyDefiCore
    {
        uint256 _assetAmount = _convertToUnderlyingAsset(_liquidityAmount);

        require(
            IERC20(assetAddr).balanceOf(_userAddr) >= _assetAmount,
            "LiquidityPool: Not enough tokens on account."
        );

        updateRateWithInterval();

        uint256 _mintAmount = convertAssetToLPTokens(_liquidityAmount);

        lastLiquidity[_userAddr][block.number] += _mintAmount;

        _mint(_userAddr, _mintAmount);

        IERC20(assetAddr).transferFrom(_userAddr, address(this), _assetAmount);
    }

    function withdrawLiquidity(
        address _userAddr,
        uint256 _liquidityAmount,
        bool _isMaxWithdraw
    ) external override onlyDefiCore {
        require(
            getAggregatedLiquidityAmount() >= _liquidityAmount,
            "LiquidityPool: Not enough liquidity available on the contract."
        );

        if (_isMaxWithdraw) {
            uint256 _userLPBalance = balanceOf(_userAddr);
            uint256 _toBurnLP;

            /// @dev Needed to withdraw all funds without a balance
            if (convertLPTokensToAsset(_userLPBalance) <= _liquidityAmount) {
                _toBurnLP = _userLPBalance;
            } else {
                _toBurnLP = convertAssetToLPTokens(_liquidityAmount);
            }

            _burn(_userAddr, _toBurnLP);

            IERC20(assetAddr).transfer(_userAddr, _convertToUnderlyingAsset(_liquidityAmount));
        } else {
            uint256 _burnAmount = convertAssetToLPTokens(_liquidityAmount);

            require(
                balanceOf(_userAddr) - lastLiquidity[_userAddr][block.number] >= _burnAmount,
                "LiquidityPool: Not enough lpTokens to withdraw liquidity."
            );

            _burn(_userAddr, _burnAmount);

            IERC20(assetAddr).transfer(_userAddr, _convertToUnderlyingAsset(_liquidityAmount));

            require(
                getBorrowPercentage() <= assetParameters.getMaxUtilizationRatio(assetKey),
                "LiquidityPool: Utilization ratio after withdraw cannot be greater than the maximum."
            );
        }
    }

    function approveToBorrow(
        address _userAddr,
        uint256 _borrowAmount,
        address _delegateeAddr,
        uint256 _currentAllowance
    ) external override onlyDefiCore {
        require(
            borrowAllowances[_userAddr][_delegateeAddr] == _currentAllowance,
            "LiquidityPool: The current allowance is not the same as expected."
        );
        borrowAllowances[_userAddr][_delegateeAddr] = _borrowAmount;

        emit BorrowApproval(_userAddr, _borrowAmount, _delegateeAddr);
    }

    function delegateBorrow(
        address _userAddr,
        address _delegatee,
        uint256 _amountToBorrow
    ) external override onlyDefiCore {
        uint256 borrowAllowance = borrowAllowances[_userAddr][_delegatee];

        require(
            borrowAllowance >= _amountToBorrow,
            "LiquidityPool: Not enough allowed to borrow amount."
        );

        borrowAllowances[_userAddr][_delegatee] = borrowAllowance - _amountToBorrow;

        _borrowFor(_userAddr, _delegatee, _amountToBorrow);
    }

    function borrowFor(
        address _userAddr,
        address _recipient,
        uint256 _amountToBorrow
    ) external override onlyDefiCore {
        _borrowFor(_userAddr, _recipient, _amountToBorrow);
    }

    function repayBorrowFor(
        address _userAddr,
        address _closureAddr,
        uint256 _repayAmount,
        bool _isMaxRepay
    ) external override onlyDefiCore returns (uint256) {
        RepayBorrowVars memory _repayBorrowVars = _getRepayBorrowVars(
            _userAddr,
            _repayAmount,
            _isMaxRepay
        );

        if (_repayBorrowVars.currentAbsoluteAmount == 0) {
            return 0;
        }

        IERC20 _assetToken = IERC20(assetAddr);
        uint256 _repayAmountInUnderlying = _convertToUnderlyingAsset(_repayBorrowVars.repayAmount);

        BorrowInfo storage borrowInfo = borrowInfos[_userAddr];

        uint256 _currentInterest = _repayBorrowVars.currentAbsoluteAmount -
            borrowInfo.borrowAmount;

        if (_repayBorrowVars.repayAmount > _currentInterest) {
            borrowInfo.borrowAmount =
                _repayBorrowVars.currentAbsoluteAmount -
                _repayBorrowVars.repayAmount;
            aggregatedBorrowedAmount -= _repayBorrowVars.repayAmount - _currentInterest;
        }

        aggregatedNormalizedBorrowedAmount = MathHelper.getNormalizedAmount(
            aggregatedBorrowedAmount,
            aggregatedNormalizedBorrowedAmount,
            _repayBorrowVars.repayAmount,
            _repayBorrowVars.currentRate,
            false
        );

        borrowInfo.normalizedAmount = MathHelper.getNormalizedAmount(
            borrowInfo.borrowAmount,
            _repayBorrowVars.normalizedAmount,
            _repayBorrowVars.repayAmount,
            _repayBorrowVars.currentRate,
            false
        );

        uint256 _reserveFunds = _currentInterest.mulWithPrecision(
            assetParameters.getReserveFactor(assetKey)
        );

        totalReserves += _reserveFunds;

        _assetToken.transferFrom(_closureAddr, address(this), _repayAmountInUnderlying);

        return _repayBorrowVars.repayAmount;
    }

    function liquidate(
        address _userAddr,
        address _liquidatorAddr,
        uint256 _liquidityAmount
    ) external override onlyDefiCore {
        require(
            getAggregatedLiquidityAmount() >= _liquidityAmount,
            "LiquidityPool: Not enough liquidity available on the contract."
        );

        updateRateWithInterval();

        uint256 _burnAmount = convertAssetToLPTokens(_liquidityAmount);

        require(
            balanceOf(_userAddr) >= _burnAmount,
            "LiquidityPool: Not enough lpTokens to liquidate amount."
        );

        _burn(_userAddr, _burnAmount);

        IERC20(assetAddr).transfer(_liquidatorAddr, _convertToUnderlyingAsset(_liquidityAmount));
    }

    function withdrawReservedFunds(
        address _recipientAddr,
        uint256 _amountToWithdraw,
        bool _isAllFunds
    ) external override onlyLiquidityPoolRegistry {
        uint256 _currentReserveAmount = totalReserves;

        if (_currentReserveAmount == 0) {
            return;
        }

        if (_isAllFunds) {
            _amountToWithdraw = _currentReserveAmount;
        } else {
            require(
                _amountToWithdraw <= _currentReserveAmount,
                "LiquidityPool: Not enough reserved funds."
            );
        }

        totalReserves = _currentReserveAmount - _amountToWithdraw;

        IERC20(assetAddr).transfer(_recipientAddr, _convertToUnderlyingAsset(_amountToWithdraw));

        emit FundsWithdrawn(_recipientAddr, address(this), _amountToWithdraw);
    }

    function _getBorrowPercentage(uint256 _additionalBorrowAmount)
        internal
        view
        returns (uint256)
    {
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

    function _convertToUnderlyingAsset(uint256 _amountToConvert)
        internal
        view
        returns (uint256 _assetAmount)
    {
        _assetAmount = _amountToConvert.convertFrom18(getUnderlyingDecimals());

        require(_assetAmount > 0, "LiquidityPool: Incorrect asset amount after conversion.");
    }

    function _convertFromUnderlyingAsset(uint256 _amountToConvert)
        internal
        view
        returns (uint256 _assetAmount)
    {
        return _amountToConvert.convertTo18(getUnderlyingDecimals());
    }

    function _borrowFor(
        address _userAddr,
        address _recipient,
        uint256 _amountToBorrow
    ) internal {
        require(
            getAggregatedLiquidityAmount() >= _amountToBorrow,
            "LiquidityPool: Not enough available to borrow amount."
        );

        uint256 _currentRate = updateRateWithInterval();

        require(
            _getBorrowPercentage(_amountToBorrow) <=
                assetParameters.getMaxUtilizationRatio(assetKey),
            "LiquidityPool: Utilization ratio after borrow cannot be greater than the maximum."
        );

        aggregatedBorrowedAmount += _amountToBorrow;
        aggregatedNormalizedBorrowedAmount = MathHelper.getNormalizedAmount(
            0,
            aggregatedNormalizedBorrowedAmount,
            _amountToBorrow,
            _currentRate,
            true
        );

        BorrowInfo storage borrowInfo = borrowInfos[_userAddr];

        borrowInfo.borrowAmount += _amountToBorrow;
        borrowInfo.normalizedAmount = MathHelper.getNormalizedAmount(
            0,
            borrowInfo.normalizedAmount,
            _amountToBorrow,
            _currentRate,
            true
        );

        IERC20(assetAddr).transfer(_recipient, _convertToUnderlyingAsset(_amountToBorrow));
    }

    function _borrowInternal(uint256 _amountToBorrow) internal returns (uint256 _currentRate) {
        require(
            getAggregatedLiquidityAmount() >= _amountToBorrow,
            "LiquidityPool: Not enough available to borrow amount."
        );

        _currentRate = updateRateWithInterval();

        require(
            _getBorrowPercentage(_amountToBorrow) <=
                assetParameters.getMaxUtilizationRatio(assetKey),
            "LiquidityPool: Utilization ratio after borrow cannot be greater than the maximum."
        );

        aggregatedBorrowedAmount += _amountToBorrow;
        aggregatedNormalizedBorrowedAmount = MathHelper.getNormalizedAmount(
            0,
            aggregatedNormalizedBorrowedAmount,
            _amountToBorrow,
            _currentRate,
            true
        );
    }

    function _getRepayBorrowVars(
        address _userAddr,
        uint256 _repayAmount,
        bool _isMaxRepay
    ) internal returns (RepayBorrowVars memory _repayBorrowVars) {
        _repayBorrowVars.userAddr = _userAddr;
        _repayBorrowVars.currentRate = updateCompoundRate();
        _repayBorrowVars.normalizedAmount = borrowInfos[_userAddr].normalizedAmount;
        _repayBorrowVars.currentAbsoluteAmount = _repayBorrowVars
            .normalizedAmount
            .mulWithPrecision(_repayBorrowVars.currentRate);

        if (_isMaxRepay) {
            _repayBorrowVars.repayAmount = Math.min(
                _convertFromUnderlyingAsset(IERC20(assetAddr).balanceOf(_userAddr)),
                _repayBorrowVars.currentAbsoluteAmount
            );

            require(
                _repayBorrowVars.repayAmount > 0,
                "LiquidityPool: Repay amount cannot be a zero."
            );
        } else {
            _repayBorrowVars.repayAmount = Math.min(
                _repayBorrowVars.currentAbsoluteAmount,
                _repayAmount
            );
        }
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
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

            userInfoRegistry.updateAssetsAfterTransfer(assetKey, from, to, amount);
            _rewardsDistribution.updateCumulativeSums(from, this);
            _rewardsDistribution.updateCumulativeSums(to, this);
        }
    }
}
