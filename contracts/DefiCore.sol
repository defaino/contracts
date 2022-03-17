// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./interfaces/IDefiCore.sol";
import "./interfaces/ISystemParameters.sol";
import "./interfaces/IAssetParameters.sol";
import "./interfaces/IUserInfoRegistry.sol";
import "./interfaces/ILiquidityPoolRegistry.sol";
import "./interfaces/IRewardsDistribution.sol";
import "./interfaces/ILiquidityPool.sol";

import "./libraries/AssetsHelperLibrary.sol";
import "./libraries/DecimalsConverter.sol";
import "./libraries/MathHelper.sol";

import "./Registry.sol";
import "./GovernanceToken.sol";
import "./abstract/AbstractDependant.sol";
import "./common/Globals.sol";

contract DefiCore is IDefiCore, AbstractDependant {
    using AssetsHelperLibrary for bytes32;
    using DecimalsConverter for uint256;
    using MathHelper for uint256;

    IERC20 internal governanceToken;
    IAssetParameters internal assetParameters;
    ISystemParameters internal systemParameters;
    IUserInfoRegistry internal userInfoRegistry;
    ILiquidityPoolRegistry internal liquidityPoolRegistry;
    IRewardsDistribution internal rewardsDistribution;

    mapping(address => mapping(bytes32 => bool)) public override disabledCollateralAssets;

    modifier onlyLiquidityPools() {
        require(
            liquidityPoolRegistry.existingLiquidityPools(msg.sender),
            "DefiCore: Caller not a LiquidityPool"
        );
        _;
    }

    function setDependencies(Registry _registry) external override onlyInjectorOrZero {
        governanceToken = IERC20(_registry.getGovernanceTokenContract());
        assetParameters = IAssetParameters(_registry.getAssetParametersContract());
        systemParameters = ISystemParameters(_registry.getSystemParametersContract());
        userInfoRegistry = IUserInfoRegistry(_registry.getUserInfoRegistryContract());
        rewardsDistribution = IRewardsDistribution(_registry.getRewardsDistributionContract());
        liquidityPoolRegistry = ILiquidityPoolRegistry(
            _registry.getLiquidityPoolRegistryContract()
        );
    }

    function updateCollateral(bytes32 _assetKey, bool _isDisabled) external override {
        require(
            assetParameters.isAvailableAsCollateral(_assetKey),
            "DefiCore: Asset is blocked for collateral."
        );

        require(
            disabledCollateralAssets[msg.sender][_assetKey] != _isDisabled,
            "DefiCore: The new value cannot be equal to the current value."
        );

        IAssetParameters _parameters = assetParameters;

        uint256 _currentSupplyAmount = _assetKey.getCurrentSupplyAmountInUSD(
            msg.sender,
            liquidityPoolRegistry,
            IDefiCore(address(this))
        );

        if (
            _isDisabled &&
            _parameters.isAvailableAsCollateral(_assetKey) &&
            _currentSupplyAmount > 0
        ) {
            (uint256 _availableLiquidity, ) = getAvailableLiquidity(msg.sender);
            uint256 _currentLimitPart = _currentSupplyAmount.divWithPrecision(
                _parameters.getColRatio(_assetKey)
            );

            require(
                _availableLiquidity >= _currentLimitPart,
                "DefiCore: It is impossible to disable the asset as a collateral."
            );
        }

        disabledCollateralAssets[msg.sender][_assetKey] = _isDisabled;
    }

    function updateCompoundRate(bytes32 _assetKey, bool _withInterval)
        external
        override
        returns (uint256)
    {
        return
            _assetKey.getAssetLiquidityPool(liquidityPoolRegistry).updateCompoundRate(
                _withInterval
            );
    }

    function addLiquidity(bytes32 _assetKey, uint256 _liquidityAmount) external override {
        require(_liquidityAmount > 0, "DefiCore: Liquidity amount must be greater than zero.");

        ILiquidityPool _assetLiquidityPool = _assetKey.getAssetLiquidityPool(
            liquidityPoolRegistry
        );

        rewardsDistribution.updateCumulativeSums(msg.sender, _assetLiquidityPool);

        _assetLiquidityPool.addLiquidity(msg.sender, _liquidityAmount);

        userInfoRegistry.updateUserSupplyAssets(msg.sender, _assetKey);

        emit LiquidityAdded(msg.sender, _assetKey, _liquidityAmount);
    }

    function withdrawLiquidity(
        bytes32 _assetKey,
        uint256 _liquidityAmount,
        bool _isMaxWithdraw
    ) external override {
        ILiquidityPool _assetLiquidityPool = _assetKey.getAssetLiquidityPool(
            liquidityPoolRegistry
        );

        rewardsDistribution.updateCumulativeSums(msg.sender, _assetLiquidityPool);

        _assetLiquidityPool.updateCompoundRate(true);

        if (!_isMaxWithdraw) {
            require(_liquidityAmount > 0, "DefiCore: Liquidity amount must be greater than zero.");

            if (isCollateralAssetEnabled(msg.sender, _assetKey)) {
                uint256 _newBorrowLimit = getNewBorrowLimitInUSD(
                    msg.sender,
                    _assetKey,
                    _liquidityAmount,
                    false
                );
                require(
                    _newBorrowLimit >= getTotalBorrowBalanceInUSD(msg.sender),
                    "DefiCore: Borrow limit used greater than 100%."
                );
            }
        } else {
            _liquidityAmount = getMaxToWithdraw(msg.sender, _assetKey);
        }

        _assetLiquidityPool.withdrawLiquidity(msg.sender, _liquidityAmount, _isMaxWithdraw);

        emit LiquidityWithdrawn(msg.sender, _assetKey, _liquidityAmount);

        userInfoRegistry.updateUserSupplyAssets(msg.sender, _assetKey);
    }

    function approveToDelegateBorrow(
        bytes32 _assetKey,
        uint256 _approveAmount,
        address _delegateeAddr,
        uint256 _currentAllowance
    ) external override {
        ILiquidityPool(_assetKey.getAssetLiquidityPool(liquidityPoolRegistry)).approveToBorrow(
            msg.sender,
            _approveAmount,
            _delegateeAddr,
            _currentAllowance
        );
    }

    function borrowFor(
        bytes32 _assetKey,
        uint256 _borrowAmount,
        address _recipientAddr
    ) external override {
        _borrowInternal(_assetKey, _borrowAmount, msg.sender);

        _assetKey.getAssetLiquidityPool(liquidityPoolRegistry).borrowFor(
            msg.sender,
            _recipientAddr,
            _borrowAmount
        );

        userInfoRegistry.updateUserBorrowAssets(msg.sender, _assetKey);

        emit Borrowed(msg.sender, _recipientAddr, _assetKey, _borrowAmount);
    }

    function delegateBorrow(
        bytes32 _assetKey,
        uint256 _borrowAmount,
        address _borrowerAddr
    ) external override {
        _borrowInternal(_assetKey, _borrowAmount, _borrowerAddr);

        _assetKey.getAssetLiquidityPool(liquidityPoolRegistry).delegateBorrow(
            _borrowerAddr,
            msg.sender,
            _borrowAmount
        );

        userInfoRegistry.updateUserBorrowAssets(_borrowerAddr, _assetKey);

        emit Borrowed(_borrowerAddr, msg.sender, _assetKey, _borrowAmount);
    }

    function repayBorrow(
        bytes32 _assetKey,
        uint256 _repayAmount,
        bool _isMaxRepay
    ) external override {
        if (!_isMaxRepay) {
            require(_repayAmount > 0, "DefiCore: Zero amount cannot be repaid.");
        }

        ILiquidityPool _assetLiquidityPool = _assetKey.getAssetLiquidityPool(
            liquidityPoolRegistry
        );

        rewardsDistribution.updateCumulativeSums(msg.sender, _assetLiquidityPool);

        _repayAmount = _assetLiquidityPool.repayBorrowFor(
            msg.sender,
            msg.sender,
            _repayAmount,
            _isMaxRepay
        );

        emit BorrowRepaid(msg.sender, _assetKey, _repayAmount);

        userInfoRegistry.updateUserBorrowAssets(msg.sender, _assetKey);
    }

    function delegateRepayBorrow(
        bytes32 _assetKey,
        uint256 _repayAmount,
        address _recipientAddr,
        bool _isMaxRepay
    ) external override {
        require(_repayAmount > 0, "DefiCore: Zero amount cannot be repaid.");

        ILiquidityPool _assetLiquidityPool = _assetKey.getAssetLiquidityPool(
            liquidityPoolRegistry
        );

        rewardsDistribution.updateCumulativeSums(_recipientAddr, _assetLiquidityPool);

        _assetLiquidityPool.repayBorrowFor(_recipientAddr, msg.sender, _repayAmount, _isMaxRepay);

        emit BorrowRepaid(_recipientAddr, _assetKey, _repayAmount);

        userInfoRegistry.updateUserBorrowAssets(_recipientAddr, _assetKey);
    }

    function liquidation(
        address _userAddr,
        bytes32 _supplyAssetKey,
        bytes32 _borrowAssetKey,
        uint256 _liquidationAmount
    ) external override {
        require(_userAddr != msg.sender, "DefiCore: User cannot liquidate his position.");

        uint256 _totalBorrowBalanceInUSD = getTotalBorrowBalanceInUSD(_userAddr);
        require(
            _totalBorrowBalanceInUSD > getCurrentBorrowLimitInUSD(_userAddr),
            "DefiCore: Not enough dept for liquidation."
        );

        require(_liquidationAmount > 0, "DefiCore: Liquidation amount should be more then zero.");

        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;
        IAssetParameters _parameters = assetParameters;

        ILiquidityPool _borrowAssetsPool = _borrowAssetKey.getAssetLiquidityPool(_poolRegistry);
        ILiquidityPool _supplyAssetsPool = _supplyAssetKey.getAssetLiquidityPool(_poolRegistry);

        require(
            _borrowAssetsPool.getAmountInUSD(_liquidationAmount) <=
                userInfoRegistry.getMaxLiquidationQuantity(
                    _userAddr,
                    _supplyAssetKey,
                    _borrowAssetKey
                ),
            "DefiCore: Liquidation amount should be less then max quantity."
        );

        IRewardsDistribution _rewardsDistribution = rewardsDistribution;

        _rewardsDistribution.updateCumulativeSums(_userAddr, _supplyAssetsPool);
        _rewardsDistribution.updateCumulativeSums(_userAddr, _borrowAssetsPool);

        uint256 _amountToLiquidateInUsd = _borrowAssetsPool.getAmountInUSD(
            _borrowAssetsPool.repayBorrowFor(_userAddr, msg.sender, _liquidationAmount, false)
        );

        uint256 _repayAmount = _supplyAssetsPool
            .getAmountFromUSD(_amountToLiquidateInUsd)
            .divWithPrecision(DECIMAL - _parameters.getLiquidationDiscount(_supplyAssetKey));

        _supplyAssetsPool.liquidate(_userAddr, msg.sender, _repayAmount);

        IUserInfoRegistry _userInfoRegistry = userInfoRegistry;

        _userInfoRegistry.updateUserSupplyAssets(_userAddr, _supplyAssetKey);
        _userInfoRegistry.updateUserBorrowAssets(_userAddr, _borrowAssetKey);
    }

    function claimDistributionRewards(bytes32[] memory _assetKeys, bool _isAllPools)
        external
        override
        returns (uint256 _totalReward)
    {
        IRewardsDistribution _rewardsDistribution = rewardsDistribution;
        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;

        if (_isAllPools) {
            _assetKeys = _poolRegistry.getAllSupportedAssets();
        }

        for (uint256 i = 0; i < _assetKeys.length; i++) {
            _totalReward += _rewardsDistribution.withdrawUserReward(
                _assetKeys[i],
                msg.sender,
                _assetKeys[i].getAssetLiquidityPool(_poolRegistry)
            );
        }

        require(_totalReward > 0, "DefiCore: Nothing to claim.");

        IERC20 _governanceToken = governanceToken;

        require(
            _governanceToken.balanceOf(address(this)) >= _totalReward,
            "DefiCore: Not enough governance tokens on the contract."
        );

        _governanceToken.transfer(msg.sender, _totalReward);

        emit DistributionRewardWithdrawn(msg.sender, _totalReward);
    }

    function getTotalSupplyBalanceInUSD(address _userAddr)
        external
        view
        override
        returns (uint256 _totalSupplyBalance)
    {
        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;
        bytes32[] memory _userSupplyAssets = userInfoRegistry.getUserSupplyAssets(_userAddr);

        for (uint256 i = 0; i < _userSupplyAssets.length; i++) {
            _totalSupplyBalance += _userSupplyAssets[i].getCurrentSupplyAmountInUSD(
                _userAddr,
                _poolRegistry,
                IDefiCore(address(this))
            );
        }
    }

    function getMaxToBorrow(address _userAddr, bytes32 _assetKey)
        external
        view
        override
        returns (uint256)
    {
        ILiquidityPool _liquidityPool = _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        uint256 _availableToBorrowAmount = _liquidityPool.getAvailableToBorrowLiquidity();
        (uint256 _availableLiquidityInUSD, ) = getAvailableLiquidity(_userAddr);

        _availableLiquidityInUSD = Math.min(
            _availableLiquidityInUSD,
            _liquidityPool.getAmountInUSD(_availableToBorrowAmount)
        );
        return _liquidityPool.getAmountFromUSD(_availableLiquidityInUSD);
    }

    function getMaxToRepay(address _userAddr, bytes32 _assetKey)
        external
        view
        override
        returns (uint256)
    {
        ILiquidityPool _liquidityPool = _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        ERC20 _asset = ERC20(_liquidityPool.assetAddr());
        (, uint256 _normalizedAmount) = _liquidityPool.borrowInfos(_userAddr);

        return
            Math.min(
                _asset.balanceOf(_userAddr).convertTo18(_asset.decimals()),
                _normalizedAmount.mulWithPrecision(_liquidityPool.getNewCompoundRate())
            );
    }

    function getMaxToSupply(address _userAddr, bytes32 _assetKey)
        external
        view
        override
        returns (uint256 _maxToSupply)
    {
        ILiquidityPool _liquidityPool = _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        _maxToSupply = IERC20(_liquidityPool.assetAddr()).balanceOf(_userAddr).convertTo18(
            _liquidityPool.getUnderlyingDecimals()
        );
    }

    function getMaxToWithdraw(address _userAddr, bytes32 _assetKey)
        public
        view
        override
        returns (uint256 _maxToWithdraw)
    {
        IAssetParameters _parameters = assetParameters;
        ILiquidityPool _liquidityPool = _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        _maxToWithdraw =
            getUserLiquidityAmount(_userAddr, _assetKey) -
            _liquidityPool.convertLPTokensToAsset(
                _liquidityPool.lastLiquidity(_userAddr, block.number)
            );

        uint256 _totalBorrowBalance = getTotalBorrowBalanceInUSD(_userAddr);
        uint256 _colRatio = _parameters.getColRatio(_assetKey);

        if (isCollateralAssetEnabled(_userAddr, _assetKey)) {
            uint256 _userLiquidityInUSD = _liquidityPool.getAmountInUSD(_maxToWithdraw);
            uint256 _residualLimit = getCurrentBorrowLimitInUSD(_userAddr) -
                _userLiquidityInUSD.divWithPrecision(_colRatio);

            if (_residualLimit < _totalBorrowBalance) {
                uint256 missingAmount = (_totalBorrowBalance - _residualLimit).mulWithPrecision(
                    _colRatio
                );
                _maxToWithdraw = _liquidityPool.getAmountFromUSD(
                    _userLiquidityInUSD - missingAmount
                );
            }
        }

        uint256 _aggregatedBorrowedAmount = _liquidityPool.aggregatedBorrowedAmount();
        uint256 _maxWithdrawUR = assetParameters.getMaxUtilizationRatio(_assetKey) - ONE_PERCENT; // If maxUR = 95%, maxWithdrawUR = 94% for more safety
        uint256 _maxAvailableLiquidity = (_liquidityPool.getAggregatedLiquidityAmount() +
            _aggregatedBorrowedAmount) -
            _aggregatedBorrowedAmount.divWithPrecision(_maxWithdrawUR);

        _maxToWithdraw = Math.min(_maxToWithdraw, _maxAvailableLiquidity);
    }

    function isCollateralAssetEnabled(address _userAddr, bytes32 _assetKey)
        public
        view
        override
        returns (bool)
    {
        if (
            assetParameters.isAvailableAsCollateral(_assetKey) &&
            !disabledCollateralAssets[_userAddr][_assetKey]
        ) {
            return true;
        }

        return false;
    }

    function getUserLiquidityAmount(address _userAddr, bytes32 _assetKey)
        public
        view
        override
        returns (uint256 _userLiquidityAmount)
    {
        ILiquidityPool _liquidityPool = _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        return
            _liquidityPool.convertLPTokensToAsset(
                IERC20(address(_liquidityPool)).balanceOf(_userAddr)
            );
    }

    function getUserBorrowedAmount(address _userAddr, bytes32 _assetKey)
        public
        view
        override
        returns (uint256 _userBorrowedAmount)
    {
        ILiquidityPool _liquidityPool = _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);
        (, uint256 _normalizedAmount) = _liquidityPool.borrowInfos(_userAddr);

        return _normalizedAmount.mulWithPrecision(_liquidityPool.getCurrentRate());
    }

    function getTotalBorrowBalanceInUSD(address _userAddr)
        public
        view
        override
        returns (uint256 _totalBorrowBalance)
    {
        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;
        bytes32[] memory _userBorrowAssets = userInfoRegistry.getUserBorrowAssets(_userAddr);

        for (uint256 i = 0; i < _userBorrowAssets.length; i++) {
            _totalBorrowBalance += _userBorrowAssets[i].getCurrentBorrowAmountInUSD(
                _userAddr,
                _poolRegistry,
                IDefiCore(address(this))
            );
        }
    }

    function getCurrentBorrowLimitInUSD(address _userAddr)
        public
        view
        override
        returns (uint256 _currentBorrowLimit)
    {
        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;
        IAssetParameters _parameters = assetParameters;
        bytes32[] memory _userSupplyAssets = userInfoRegistry.getUserSupplyAssets(_userAddr);

        for (uint256 i = 0; i < _userSupplyAssets.length; i++) {
            bytes32 _currentAssetKey = _userSupplyAssets[i];

            if (isCollateralAssetEnabled(_userAddr, _currentAssetKey)) {
                uint256 _currentTokensAmount = _currentAssetKey.getCurrentSupplyAmountInUSD(
                    _userAddr,
                    _poolRegistry,
                    IDefiCore(address(this))
                );

                _currentBorrowLimit += _currentTokensAmount.divWithPrecision(
                    _parameters.getColRatio(_currentAssetKey)
                );
            }
        }
    }

    function getNewBorrowLimitInUSD(
        address _userAddr,
        bytes32 _assetKey,
        uint256 _tokensAmount,
        bool _isAdding
    ) public view override returns (uint256) {
        uint256 _newLimit = getCurrentBorrowLimitInUSD(_userAddr);

        if (!isCollateralAssetEnabled(_userAddr, _assetKey)) {
            return _newLimit;
        }

        ILiquidityPool _liquidityPool = _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        uint256 _newAmount = _liquidityPool.getAmountInUSD(_tokensAmount).divWithPrecision(
            assetParameters.getColRatio(_assetKey)
        );

        if (_isAdding) {
            _newLimit += _newAmount;
        } else if (_newAmount < _newLimit) {
            _newLimit -= _newAmount;
        } else {
            _newLimit = 0;
        }

        return _newLimit;
    }

    function getAvailableLiquidity(address _userAddr)
        public
        view
        override
        returns (uint256, uint256)
    {
        uint256 _borrowedLimitInUSD = getCurrentBorrowLimitInUSD(_userAddr);
        uint256 _totalBorrowedAmountInUSD = getTotalBorrowBalanceInUSD(_userAddr);

        if (_borrowedLimitInUSD > _totalBorrowedAmountInUSD) {
            return (_borrowedLimitInUSD - _totalBorrowedAmountInUSD, 0);
        } else {
            return (0, _totalBorrowedAmountInUSD - _borrowedLimitInUSD);
        }
    }

    function _borrowInternal(
        bytes32 _assetKey,
        uint256 _borrowAmount,
        address _borrowerAddr
    ) internal {
        require(
            !assetParameters.isPoolFrozen(_assetKey),
            "DefiCore: Pool is freeze for borrow operations."
        );

        require(_borrowAmount > 0, "DefiCore: Borrow amount must be greater than zero.");

        (uint256 _availableLiquidity, uint256 _debtAmount) = getAvailableLiquidity(_borrowerAddr);

        require(_debtAmount == 0, "DefiCore: Unable to borrow because the account is in arrears.");

        ILiquidityPool _assetLiquidityPool = _assetKey.getAssetLiquidityPool(
            liquidityPoolRegistry
        );

        require(
            _availableLiquidity >= _assetLiquidityPool.getAmountInUSD(_borrowAmount),
            "DefiCore: Not enough available liquidity."
        );

        rewardsDistribution.updateCumulativeSums(_borrowerAddr, _assetLiquidityPool);
    }
}
