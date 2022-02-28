// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "../interfaces/IBasicCore.sol";
import "../interfaces/ISystemParameters.sol";
import "../interfaces/IAssetParameters.sol";
import "../interfaces/IAssetsRegistry.sol";
import "../interfaces/IRewardsDistribution.sol";
import "../interfaces/ILiquidityPool.sol";
import "../interfaces/ILiquidityPoolRegistry.sol";

import "../libraries/AssetsHelperLibrary.sol";
import "../libraries/DecimalsConverter.sol";
import "../libraries/MathHelper.sol";

import "../Registry.sol";
import "../common/AbstractDependant.sol";

abstract contract AbstractCore is IBasicCore, AbstractDependant {
    using AssetsHelperLibrary for bytes32;
    using DecimalsConverter for uint256;
    using MathHelper for uint256;

    IAssetParameters internal assetParameters;
    ISystemParameters internal systemParameters;
    IAssetsRegistry internal assetsRegistry;
    ILiquidityPoolRegistry internal liquidityPoolRegistry;
    IRewardsDistribution internal rewardsDistribution;

    mapping(address => mapping(bytes32 => bool)) public override disabledCollateralAssets;

    event LiquidityAdded(address _userAddr, bytes32 _assetKey, uint256 _liquidityAmount);
    event LiquidityWithdrawn(address _userAddr, bytes32 _assetKey, uint256 _liquidityAmount);
    event Borrowed(
        address _borrower,
        address _recipient,
        bytes32 _assetKey,
        uint256 _borrowedAmount
    );
    event BorrowRepaid(address _userAddr, bytes32 _assetKey, uint256 _repaidAmount);

    function setDependencies(Registry _registry) external virtual override onlyInjectorOrZero {
        assetParameters = IAssetParameters(_registry.getAssetParametersContract());
        systemParameters = ISystemParameters(_registry.getSystemParametersContract());
        assetsRegistry = IAssetsRegistry(_registry.getAssetsRegistryContract());
        rewardsDistribution = IRewardsDistribution(_registry.getRewardsDistributionContract());
        liquidityPoolRegistry = ILiquidityPoolRegistry(
            _registry.getLiquidityPoolRegistryContract()
        );
    }

    function isCollateralAssetEnabled(address _userAddr, bytes32 _assetKey)
        public
        view
        virtual
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

    function getMaxToSupply(address _userAddr, bytes32 _assetKey)
        external
        view
        virtual
        override
        returns (uint256);

    function getMaxToWithdraw(address _userAddr, bytes32 _assetKey)
        external
        view
        virtual
        override
        returns (uint256);

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
        uint256 _normalizedAmount = _getNormalizedAmount(_userAddr, _liquidityPool);

        return
            Math.min(
                _asset.balanceOf(_userAddr).convertTo18(_asset.decimals()),
                _normalizedAmount.mulWithPrecision(_liquidityPool.getNewCompoundRate())
            );
    }

    function getUserLiquidityAmount(address _userAddr, bytes32 _assetKey)
        external
        view
        virtual
        override
        returns (uint256 _userLiquidityAmount);

    function getUserBorrowedAmount(address _userAddr, bytes32 _assetKey)
        public
        view
        virtual
        override
        returns (uint256 _userBorrowedAmount)
    {
        ILiquidityPool _liquidityPool = _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        return
            _getNormalizedAmount(_userAddr, _liquidityPool).mulWithPrecision(
                _liquidityPool.getCurrentRate()
            );
    }

    function isBorrowExists(address _userAddr, bytes32 _assetKey)
        external
        view
        virtual
        override
        returns (bool)
    {
        return getUserBorrowedAmount(_userAddr, _assetKey) != 0;
    }

    function getTotalSupplyBalanceInUSD(address _userAddr)
        external
        view
        virtual
        override
        returns (uint256 _totalSupplyBalance);

    function getTotalBorrowBalanceInUSD(address _userAddr)
        public
        view
        virtual
        override
        returns (uint256 _totalBorrowBalance);

    function getCurrentBorrowLimitInUSD(address _userAddr)
        public
        view
        virtual
        override
        returns (uint256 _currentBorrowLimit);

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

        uint256 _newAmount =
            _getCorrectLimitPart(
                _assetKey,
                _liquidityPool.getAmountInUSD(_tokensAmount),
                assetParameters
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

    function enableCollateral(bytes32 _assetKey) external override returns (uint256) {
        require(
            assetParameters.isAvailableAsCollateral(_assetKey),
            "AbstractCore: Asset is blocked for collateral."
        );

        require(
            disabledCollateralAssets[msg.sender][_assetKey],
            "AbstractCore: Asset already enabled as collateral."
        );

        delete disabledCollateralAssets[msg.sender][_assetKey];

        return getCurrentBorrowLimitInUSD(msg.sender);
    }

    function disableCollateral(bytes32 _assetKey) external override returns (uint256) {
        require(
            !disabledCollateralAssets[msg.sender][_assetKey],
            "AbstractCore: Asset must be enabled as collateral."
        );

        IAssetParameters _parameters = assetParameters;

        uint256 _currentSupplyAmount =
            _getCurrentSupplyAmountInUSD(_assetKey, msg.sender, liquidityPoolRegistry);

        if (_parameters.isAvailableAsCollateral(_assetKey) && _currentSupplyAmount > 0) {
            (uint256 _availableLiquidity, ) = getAvailableLiquidity(msg.sender);
            uint256 _currentLimitPart =
                _getCorrectLimitPart(_assetKey, _currentSupplyAmount, _parameters);

            require(
                _availableLiquidity >= _currentLimitPart,
                "AbstractCore: It is impossible to disable the asset as a collateral."
            );
        }

        disabledCollateralAssets[msg.sender][_assetKey] = true;

        return getCurrentBorrowLimitInUSD(msg.sender);
    }

    function addLiquidity(bytes32 _assetKey, uint256 _liquidityAmount) external virtual override;

    function withdrawLiquidity(
        bytes32 _assetKey,
        uint256 _liquidityAmount,
        bool _isMaxWithdraw
    ) external virtual override;

    function repayBorrow(
        bytes32 _assetKey,
        uint256 _repayAmount,
        bool _isMaxRepay
    ) external virtual override;

    function _getCorrectLimitPart(
        bytes32 _assetKey,
        uint256 _currentSupplyAmount,
        IAssetParameters _parameters
    ) internal view returns (uint256) {
        uint256 _correctColRatio =
            _isIntegrationCore()
                ? _parameters.getIntegrationColRatio(_assetKey)
                : _parameters.getColRatio(_assetKey);

        return _currentSupplyAmount.divWithPrecision(_correctColRatio);
    }

    function _getNormalizedAmount(address _userAddr, ILiquidityPool _liquidityPool)
        internal
        view
        returns (uint256 _normalizedAmount)
    {
        if (_isIntegrationCore()) {
            (_normalizedAmount, ) = _liquidityPool.integrationBorrowInfos(_userAddr);
        } else {
            (_normalizedAmount, ) = _liquidityPool.borrowInfos(_userAddr);
        }
    }

    function _isIntegrationCore() internal pure virtual returns (bool);

    function _getCurrentSupplyAmountInUSD(
        bytes32 _assetKey,
        address _userAddr,
        ILiquidityPoolRegistry _poolsRegistry
    ) internal view virtual returns (uint256);

    function _countMaxToWithdraw(
        uint256 _maxToWithdraw,
        uint256 _currentColRatio,
        uint256 _totalBorrowBalance,
        uint256 _currentBorrowLimit,
        bool _isCollateralEnabled,
        ILiquidityPool _liquidityPool
    ) internal view returns (uint256) {
        if (_isCollateralEnabled) {
            uint256 _userLiquidityInUSD = _liquidityPool.getAmountInUSD(_maxToWithdraw);
            uint256 _residualLimit =
                _currentBorrowLimit - _userLiquidityInUSD.divWithPrecision(_currentColRatio);

            if (_residualLimit < _totalBorrowBalance) {
                uint256 missingAmount =
                    (_totalBorrowBalance - _residualLimit).mulWithPrecision(_currentColRatio);
                _maxToWithdraw = _liquidityPool.getAmountFromUSD(
                    _userLiquidityInUSD - missingAmount
                );
            }
        }

        return _maxToWithdraw;
    }
}
