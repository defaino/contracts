// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./interfaces/IBasicCore.sol";
import "./interfaces/ISystemParameters.sol";
import "./interfaces/IAssetParameters.sol";
import "./interfaces/IAssetsRegistry.sol";
import "./interfaces/ILiquidityPoolRegistry.sol";
import "./interfaces/IRewardsDistribution.sol";
import "./interfaces/ILiquidityPool.sol";

import "./libraries/AssetsHelperLibrary.sol";
import "./libraries/MathHelper.sol";

import "./Registry.sol";
import "./GovernanceToken.sol";
import "./common/Globals.sol";
import "./abstract/AbstractCore.sol";

contract DefiCore is IDefiCore, AbstractCore {
    using AssetsHelperLibrary for bytes32;
    using DecimalsConverter for uint256;
    using MathHelper for uint256;

    IERC20 private governanceToken;

    event Borrowed(address _userAddr, bytes32 _assetKey, uint256 _borrowedAmount);
    event DistributionRewardWithdrawn(address _userAddr, uint256 _rewardAmount);

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
        assetsRegistry = IAssetsRegistry(_registry.getAssetsRegistryContract());
        rewardsDistribution = IRewardsDistribution(_registry.getRewardsDistributionContract());
        liquidityPoolRegistry = ILiquidityPoolRegistry(
            _registry.getLiquidityPoolRegistryContract()
        );
    }

    function getLiquidiationInfo(address[] calldata _accounts)
        external
        view
        returns (LiquidationInfo[] memory _resultArr)
    {
        IAssetsRegistry _assetsRegistry = assetsRegistry;
        _resultArr = new LiquidationInfo[](_accounts.length);

        for (uint256 i = 0; i < _accounts.length; i++) {
            _resultArr[i] = LiquidationInfo(
                _assetsRegistry.getUserBorrowAssets(_accounts[i]),
                _assetsRegistry.getUserSupplyAssets(_accounts[i]),
                getTotalBorrowBalanceInUSD(_accounts[i])
            );
        }
    }

    function getUserLiquidationInfo(
        address _userAddr,
        bytes32 _borrowAssetKey,
        bytes32 _receiveAssetKey
    ) external view returns (UserLiquidationInfo memory _liquidationInfo) {
        IAssetParameters _assetParameters = assetParameters;
        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;

        ILiquidityPool _borrowLiquidityPool = ILiquidityPool(
            _poolRegistry.liquidityPools(_borrowAssetKey)
        );
        ILiquidityPool _receiveLiquidityPool = ILiquidityPool(
            _poolRegistry.liquidityPools(_receiveAssetKey)
        );

        uint256 _receiveAssetPrice = _receiveLiquidityPool.getAssetPrice();
        uint256 _bonusPrice = _receiveAssetPrice.mulWithPrecision(
            DECIMAL - _assetParameters.getLiquidationDiscount(_receiveAssetKey)
        );

        uint256 _liquidationLimitByBorrow = getTotalBorrowBalanceInUSD(_userAddr).mulWithPrecision(
            systemParameters.getLiquidationBoundaryParam()
        );

        uint256 _maxQuantityInUSD = _getMaxQuantity(
            _receiveAssetKey,
            _borrowAssetKey,
            _userAddr,
            _liquidationLimitByBorrow,
            _receiveLiquidityPool,
            _borrowLiquidityPool,
            _assetParameters
        );

        _liquidationInfo = UserLiquidationInfo(
            _borrowLiquidityPool.getAssetPrice(),
            _receiveAssetPrice,
            _bonusPrice,
            getUserBorrowedAmount(_userAddr, _borrowAssetKey),
            getUserLiquidityAmount(_userAddr, _receiveAssetKey),
            _borrowLiquidityPool.getAmountFromUSD(_maxQuantityInUSD)
        );
    }

    function getMaxToSupply(address _userAddr, bytes32 _assetKey)
        external
        view
        override(IBasicCore, AbstractCore)
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
        override(IBasicCore, AbstractCore)
        returns (uint256 _maxToWithdraw)
    {
        IAssetParameters _parameters = assetParameters;
        ILiquidityPool _liquidityPool = _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        _maxToWithdraw =
            getUserLiquidityAmount(_userAddr, _assetKey) -
            _liquidityPool.convertNTokensToAsset(
                _liquidityPool.lastLiquidity(_userAddr, block.number)
            );

        _maxToWithdraw = _countMaxToWithdraw(
            _maxToWithdraw,
            _parameters.getColRatio(_assetKey),
            getTotalBorrowBalanceInUSD(_userAddr),
            getCurrentBorrowLimitInUSD(_userAddr),
            isCollateralAssetEnabled(_userAddr, _assetKey),
            _liquidityPool
        );

        uint256 _aggregatedBorrowedAmount = _liquidityPool.aggregatedBorrowedAmount();
        uint256 _maxWithdrawUR = assetParameters.getMaxUtilizationRatio(_assetKey) - ONE_PERCENT; // If maxUR = 95%, maxWithdrawUR = 94% for more safety
        uint256 _maxAvailableLiquidity = (_liquidityPool.getAggregatedLiquidityAmount() +
            _aggregatedBorrowedAmount) -
            _aggregatedBorrowedAmount.divWithPrecision(_maxWithdrawUR);

        _maxToWithdraw = Math.min(_maxToWithdraw, _maxAvailableLiquidity);
    }

    function getUserLiquidityAmount(address _userAddr, bytes32 _assetKey)
        public
        view
        override(IBasicCore, AbstractCore)
        returns (uint256 _userLiquidityAmount)
    {
        ILiquidityPool _liquidityPool = _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        return
            _liquidityPool.convertNTokensToAsset(
                IERC20(address(_liquidityPool)).balanceOf(_userAddr)
            );
    }

    function getTotalSupplyBalanceInUSD(address _userAddr)
        external
        view
        override(IBasicCore, AbstractCore)
        returns (uint256 _totalSupplyBalance)
    {
        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;
        bytes32[] memory _userSupplyAssets = assetsRegistry.getUserSupplyAssets(_userAddr);

        for (uint256 i = 0; i < _userSupplyAssets.length; i++) {
            _totalSupplyBalance += _getCurrentSupplyAmountInUSD(
                _userSupplyAssets[i],
                _userAddr,
                _poolRegistry
            );
        }
    }

    function getTotalBorrowBalanceInUSD(address _userAddr)
        public
        view
        override(IBasicCore, AbstractCore)
        returns (uint256 _totalBorrowBalance)
    {
        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;
        bytes32[] memory _userBorrowAssets = assetsRegistry.getUserBorrowAssets(_userAddr);

        for (uint256 i = 0; i < _userBorrowAssets.length; i++) {
            _totalBorrowBalance += _userBorrowAssets[i].getCurrentBorrowAmountInUSD(
                _userAddr,
                _poolRegistry,
                IBasicCore(address(this))
            );
        }
    }

    function getCurrentBorrowLimitInUSD(address _userAddr)
        public
        view
        override(IBasicCore, AbstractCore)
        returns (uint256 _currentBorrowLimit)
    {
        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;
        IAssetParameters _parameters = assetParameters;
        bytes32[] memory _userSupplyAssets = assetsRegistry.getUserSupplyAssets(_userAddr);

        for (uint256 i = 0; i < _userSupplyAssets.length; i++) {
            bytes32 _currentAssetKey = _userSupplyAssets[i];

            if (isCollateralAssetEnabled(_userAddr, _currentAssetKey)) {
                uint256 _currentTokensAmount = _getCurrentSupplyAmountInUSD(
                    _currentAssetKey,
                    _userAddr,
                    _poolRegistry
                );

                _currentBorrowLimit += _currentTokensAmount.divWithPrecision(
                    _parameters.getColRatio(_currentAssetKey)
                );
            }
        }
    }

    function getUserDistributionRewards(address _userAddr)
        external
        view
        returns (RewardsDistributionInfo memory)
    {
        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;
        IRewardsDistribution _rewardsDistribution = rewardsDistribution;

        bytes32[] memory _allAssets = _poolRegistry.getAllSupportedAssets();

        uint256 _totalReward;

        for (uint256 i = 0; i < _allAssets.length; i++) {
            _totalReward += _rewardsDistribution.getUserReward(
                _allAssets[i],
                _userAddr,
                _allAssets[i].getAssetLiquidityPool(_poolRegistry)
            );
        }

        ILiquidityPool _governancePool = ILiquidityPool(
            _poolRegistry.getGovernanceLiquidityPool()
        );
        IERC20 _governanceToken = governanceToken;

        uint256 _userBalance = _governanceToken.balanceOf(_userAddr);

        return
            RewardsDistributionInfo(
                address(_governanceToken),
                _totalReward,
                _governancePool.getAmountInUSD(_totalReward),
                _userBalance,
                _governancePool.getAmountInUSD(_userBalance)
            );
    }

    function updateCompoundRate(bytes32 _assetKey) external returns (uint256) {
        return _assetKey.getAssetLiquidityPool(liquidityPoolRegistry).updateCompoundRate();
    }

    function addLiquidity(bytes32 _assetKey, uint256 _liquidityAmount)
        external
        override(IBasicCore, AbstractCore)
    {
        require(_liquidityAmount > 0, "DefiCore: Liquidity amount must be greater than zero.");

        ILiquidityPool _assetLiquidityPool = _assetKey.getAssetLiquidityPool(
            liquidityPoolRegistry
        );

        rewardsDistribution.updateCumulativeSums(msg.sender, _assetLiquidityPool);

        _assetLiquidityPool.addLiquidity(msg.sender, _liquidityAmount);
        emit LiquidityAdded(msg.sender, _assetKey, _liquidityAmount);

        assetsRegistry.updateUserAssets(msg.sender, _assetKey, true);
    }

    function withdrawLiquidity(
        bytes32 _assetKey,
        uint256 _liquidityAmount,
        bool _isMaxWithdraw
    ) external override(IBasicCore, AbstractCore) {
        ILiquidityPool _assetLiquidityPool = _assetKey.getAssetLiquidityPool(
            liquidityPoolRegistry
        );

        rewardsDistribution.updateCumulativeSums(msg.sender, _assetLiquidityPool);

        _assetLiquidityPool.updateRateWithInterval();

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

        assetsRegistry.updateUserAssets(msg.sender, _assetKey, true);
    }

    function approveToDelegateBorrow(
        bytes32 _assetKey,
        uint256 _borrowAmount,
        address _delegatee,
        uint256 _expectedAllowance
    ) external {
        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;

        ILiquidityPool(_assetKey.getAssetLiquidityPool(_poolRegistry)).approveToBorrow(
            msg.sender,
            _borrowAmount,
            _delegatee,
            _expectedAllowance
        );
    }

    function borrow(bytes32 _assetKey, uint256 _borrowAmount) external {
        _borrowInternal(_assetKey, _borrowAmount, msg.sender);

        ILiquidityPool _assetLiquidityPool = _assetKey.getAssetLiquidityPool(
            liquidityPoolRegistry
        );

        _assetLiquidityPool.borrowFor(msg.sender, msg.sender, _borrowAmount);

        emit Borrowed(msg.sender, _assetKey, _borrowAmount);

        assetsRegistry.updateUserAssets(msg.sender, _assetKey, false);
    }

    function delegateBorrow(
        bytes32 _assetKey,
        uint256 _borrowAmount,
        address _borrowerAddr
    ) external {
        _borrowInternal(_assetKey, _borrowAmount, _borrowerAddr);

        ILiquidityPool _assetLiquidityPool = _assetKey.getAssetLiquidityPool(
            liquidityPoolRegistry
        );

        _assetLiquidityPool.delegateBorrow(_borrowerAddr, msg.sender, _borrowAmount);

        emit Borrowed(_borrowerAddr, _assetKey, _borrowAmount);

        assetsRegistry.updateUserAssets(_borrowerAddr, _assetKey, false);
    }

    function borrowFor(
        bytes32 _assetKey,
        uint256 _borrowAmount,
        address _recipientAddr
    ) external {
        _borrowInternal(_assetKey, _borrowAmount, msg.sender);

        ILiquidityPool _assetLiquidityPool = _assetKey.getAssetLiquidityPool(
            liquidityPoolRegistry
        );

        _assetLiquidityPool.borrowFor(msg.sender, _recipientAddr, _borrowAmount);

        emit Borrowed(msg.sender, _assetKey, _borrowAmount);

        assetsRegistry.updateUserAssets(msg.sender, _assetKey, false);
    }

    function repayBorrow(
        bytes32 _assetKey,
        uint256 _repayAmount,
        bool _isMaxRepay
    ) external override(IBasicCore, AbstractCore) {
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

        assetsRegistry.updateUserAssets(msg.sender, _assetKey, false);
    }

    function delegateRepayBorrow(
        bytes32 _assetKey,
        uint256 _repayAmount,
        address _recipientAddr,
        bool _isMaxRepay
    ) external {
        require(_repayAmount > 0, "DefiCore: Zero amount cannot be repaid.");

        ILiquidityPool _assetLiquidityPool = _assetKey.getAssetLiquidityPool(
            liquidityPoolRegistry
        );

        rewardsDistribution.updateCumulativeSums(_recipientAddr, _assetLiquidityPool);

        _assetLiquidityPool.repayBorrowFor(_recipientAddr, msg.sender, _repayAmount, _isMaxRepay);

        emit BorrowRepaid(_recipientAddr, _assetKey, _repayAmount);

        assetsRegistry.updateUserAssets(_recipientAddr, _assetKey, false);
    }

    function liquidation(
        address _userAddr,
        bytes32 _supplyAssetKey,
        bytes32 _borrowAssetKey,
        uint256 _liquidationAmount
    ) external {
        require(_userAddr != msg.sender, "DefiCore: User cannot liquidate his position.");

        uint256 _totalBorrowBalanceInUSD = getTotalBorrowBalanceInUSD(_userAddr);
        require(
            _totalBorrowBalanceInUSD > getCurrentBorrowLimitInUSD(_userAddr),
            "DefiCore: Not enough dept for liquidation."
        );

        require(_liquidationAmount > 0, "DefiCore: Liquidation amount should be more then zero.");

        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;
        IAssetParameters _parameters = assetParameters;

        ILiquidityPool _borrowAssetsPool = ILiquidityPool(
            _poolRegistry.liquidityPools(_borrowAssetKey)
        );

        ILiquidityPool _supplyAssetsPool = ILiquidityPool(
            _poolRegistry.liquidityPools(_supplyAssetKey)
        );

        require(
            _borrowAssetsPool.getAmountInUSD(_liquidationAmount) <=
                _getMaxQuantity(
                    _supplyAssetKey,
                    _borrowAssetKey,
                    _userAddr,
                    _totalBorrowBalanceInUSD.mulWithPrecision(
                        systemParameters.getLiquidationBoundaryParam()
                    ),
                    _supplyAssetsPool,
                    _borrowAssetsPool,
                    _parameters
                ),
            "DefiCore: Liquidation amount should be less then max quantity."
        );

        IRewardsDistribution _rewardsDistribution = rewardsDistribution;

        _rewardsDistribution.updateCumulativeSums(_userAddr, _supplyAssetsPool);
        _rewardsDistribution.updateCumulativeSums(_userAddr, _borrowAssetsPool);

        uint256 _amountToLiquidateInUsd = _borrowAssetsPool.getAmountInUSD(
            _borrowAssetsPool.repayBorrowFor(_userAddr, msg.sender, _liquidationAmount, false)
        );

        emit LiquidateBorrow(_borrowAssetKey, _userAddr, _liquidationAmount);

        uint256 _repayAmount = _supplyAssetsPool
            .getAmountFromUSD(_amountToLiquidateInUsd)
            .divWithPrecision(DECIMAL - _parameters.getLiquidationDiscount(_supplyAssetKey));

        emit LiquidatorPay(_supplyAssetKey, msg.sender, _repayAmount);

        _supplyAssetsPool.liquidate(_userAddr, msg.sender, _repayAmount);

        IAssetsRegistry _assetsRegistry = assetsRegistry;

        _assetsRegistry.updateUserAssets(_userAddr, _supplyAssetKey, true);
        _assetsRegistry.updateUserAssets(_userAddr, _borrowAssetKey, false);
    }

    function claimPoolDistributionRewards(bytes32 _assetKey) external returns (uint256 _reward) {
        IRewardsDistribution _rewardsDistribution = rewardsDistribution;
        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;

        _reward = _rewardsDistribution.withdrawUserReward(
            _assetKey,
            msg.sender,
            ILiquidityPool(_poolRegistry.liquidityPools(_assetKey))
        );

        require(_reward > 0, "DefiCore: User have not rewards from this pool");

        IERC20 _governanceToken = governanceToken;

        require(
            _governanceToken.balanceOf(address(this)) >= _reward,
            "DefiCore: Not enough governance tokens on the contract."
        );

        _governanceToken.transfer(msg.sender, _reward);

        emit DistributionRewardWithdrawn(msg.sender, _reward);
    }

    function claimDistributionRewards() external returns (uint256 _totalReward) {
        IRewardsDistribution _rewardsDistribution = rewardsDistribution;
        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;

        bytes32[] memory _assetKeys = _poolRegistry.getAllSupportedAssets();

        for (uint256 i = 0; i < _assetKeys.length; i++) {
            _totalReward += _rewardsDistribution.withdrawUserReward(
                _assetKeys[i],
                msg.sender,
                ILiquidityPool(_poolRegistry.liquidityPools(_assetKeys[i]))
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

    function _getMaxQuantity(
        bytes32 _supplyAssetKey,
        bytes32 _borrowAssetKey,
        address _userAddr,
        uint256 _maxLiquidatePart,
        ILiquidityPool _supplyAssetsPool,
        ILiquidityPool _borrowAssetsPool,
        IAssetParameters _assetParameters
    ) internal view returns (uint256 _maxQuantityInUSD) {
        uint256 _liquidateLimitBySupply = (getUserLiquidityAmount(_userAddr, _supplyAssetKey) *
            (DECIMAL - _assetParameters.getLiquidationDiscount(_supplyAssetKey))) / DECIMAL;

        uint256 _userBorrowAmountInUSD = _borrowAssetsPool.getAmountInUSD(
            getUserBorrowedAmount(_userAddr, _borrowAssetKey)
        );

        _maxQuantityInUSD = Math.min(
            _supplyAssetsPool.getAmountInUSD(_liquidateLimitBySupply),
            _userBorrowAmountInUSD
        );

        _maxQuantityInUSD = Math.min(_maxQuantityInUSD, _maxLiquidatePart);
    }

    function _isIntegrationCore() internal pure override returns (bool) {
        return false;
    }

    function _getCurrentSupplyAmountInUSD(
        bytes32 _assetKey,
        address _userAddr,
        ILiquidityPoolRegistry _poolsRegistry
    ) internal view override returns (uint256) {
        ILiquidityPool _currentLiquidityPool = ILiquidityPool(
            _poolsRegistry.liquidityPools(_assetKey)
        );

        return _currentLiquidityPool.getAmountInUSD(getUserLiquidityAmount(_userAddr, _assetKey));
    }
}
