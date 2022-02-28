// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "./interfaces/IBasicCore.sol";
import "./interfaces/ISystemParameters.sol";
import "./interfaces/IAssetParameters.sol";
import "./interfaces/IAssetsRegistry.sol";
import "./interfaces/IRewardsDistribution.sol";
import "./interfaces/ILiquidityPool.sol";

import "./interfaces/IBorrowerRouter.sol";
import "./interfaces/IBorrowerRouterFactory.sol";
import "./interfaces/IBorrowerRouterRegistry.sol";

import "./libraries/AssetsHelperLibrary.sol";
import "./libraries/MathHelper.sol";

import "./Registry.sol";
import "./GovernanceToken.sol";
import "./common/Globals.sol";
import "./common/AbstractDependant.sol";
import "./abstract/AbstractCore.sol";

contract IntegrationCore is IIntegrationCore, AbstractCore {
    using EnumerableSet for EnumerableSet.AddressSet;
    using AssetsHelperLibrary for bytes32;
    using MathHelper for uint256;

    IBorrowerRouterFactory private borrowerRouterFactory;
    IBorrowerRouterRegistry private borrowerRouterRegistry;
    IBasicCore private defiCore;

    // user address => asset key => vault tokens array
    mapping(address => mapping(bytes32 => EnumerableSet.AddressSet)) internal _userVaultTokens;

    modifier onlyExistingBorrowerRouter(address _userAddr) {
        require(
            borrowerRouterRegistry.isBorrowerRouterExists(_userAddr),
            "IntegrationCore: Borrower router does not exist."
        );
        _;
    }

    modifier updateUserAssets(bytes32 _assetKey, bool _isSupplyAssets) {
        _;
        assetsRegistry.updateUserAssets(msg.sender, _assetKey, _isSupplyAssets);
    }

    function setDependencies(Registry _registry) external override onlyInjectorOrZero {
        assetParameters = IAssetParameters(_registry.getAssetParametersContract());
        systemParameters = ISystemParameters(_registry.getSystemParametersContract());
        assetsRegistry = IAssetsRegistry(_registry.getAssetsRegistryContract());
        rewardsDistribution = IRewardsDistribution(_registry.getRewardsDistributionContract());
        liquidityPoolRegistry = ILiquidityPoolRegistry(
            _registry.getLiquidityPoolRegistryContract()
        );

        borrowerRouterFactory = IBorrowerRouterFactory(
            _registry.getBorrowerRouterFactoryContract()
        );
        borrowerRouterRegistry = IBorrowerRouterRegistry(
            _registry.getBorrowerRouterRegistryContract()
        );
        defiCore = IBasicCore(_registry.getDefiCoreContract());
    }

    function getUserVaultTokens(address _userAddr, bytes32 _assetKey)
        external
        view
        override
        returns (address[] memory _vaultTokens)
    {
        uint256 _vaultTokensCount = _userVaultTokens[_userAddr][_assetKey].length();

        _vaultTokens = new address[](_vaultTokensCount);

        for (uint256 i = 0; i < _vaultTokensCount; i++) {
            _vaultTokens[i] = _userVaultTokens[_userAddr][_assetKey].at(i);
        }
    }

    function getOptimizationInfo(address[] memory _accounts)
        external
        view
        returns (OptimizationInfo[] memory _resultArr)
    {
        IAssetsRegistry _assetsRegistry = assetsRegistry;
        _resultArr = new OptimizationInfo[](_accounts.length);

        for (uint256 i = 0; i < _accounts.length; i++) {
            bytes32[] memory _assetKeys =
                _assetsRegistry.getUserIntegrationBorrowAssets(_accounts[i]);

            _resultArr[i] = OptimizationInfo(_assetKeys, getTotalBorrowBalanceInUSD(_accounts[i]));
        }
    }

    function getUserOptimizationInfo(
        address _userAddr,
        bytes32 _assetKey,
        address _vaultTokenAddr
    ) external view onlyExistingBorrowerRouter(_userAddr) returns (UserOptimizationInfo memory) {
        require(
            _userVaultTokens[_userAddr][_assetKey].contains(_vaultTokenAddr),
            "IntegrationCore: User does not have current vault token address"
        );

        IBorrowerRouter _router =
            IBorrowerRouter(borrowerRouterRegistry.borrowerRouters(_userAddr));
        ILiquidityPool _liquidityPool = _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        uint256 _totalBorrowAmount = getUserBorrowedAmount(_userAddr, _assetKey);
        uint256 _depositInVaultAmount =
            _router.getUserDepositedAmountInAsset(_liquidityPool.assetAddr(), _vaultTokenAddr);

        uint256 _rewardAmount =
            _totalBorrowAmount
                .mulWithPrecision(systemParameters.getOptimizationPercentageParam())
                .mulWithPrecision(assetParameters.getOptimiztionReward(_assetKey));

        return
            UserOptimizationInfo(
                _totalBorrowAmount,
                _depositInVaultAmount,
                _rewardAmount,
                _liquidityPool.getAmountInUSD(_rewardAmount)
            );
    }

    function isCollateralAssetEnabled(address _userAddr, bytes32 _assetKey)
        public
        view
        override(IBasicCore, AbstractCore)
        returns (bool)
    {
        return !disabledCollateralAssets[_userAddr][_assetKey];
    }

    function getMaxToSupply(address _userAddr, bytes32 _assetKey)
        external
        view
        override(IBasicCore, AbstractCore)
        returns (uint256 _maxToSupply)
    {
        IBasicCore _defiCore = defiCore;

        ILiquidityPool _liquidityPool = _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        uint256 _maxNumber =
            _liquidityPool.convertNTokensToAsset(
                IERC20(address(_liquidityPool)).balanceOf(_userAddr)
            );

        _maxToSupply = _countMaxToWithdraw(
            _maxNumber,
            assetParameters.getColRatio(_assetKey),
            _defiCore.getTotalBorrowBalanceInUSD(_userAddr),
            _defiCore.getCurrentBorrowLimitInUSD(_userAddr),
            _defiCore.isCollateralAssetEnabled(_userAddr, _assetKey),
            _liquidityPool
        );
    }

    function getMaxToWithdraw(address _userAddr, bytes32 _assetKey)
        public
        view
        override(IBasicCore, AbstractCore)
        onlyExistingBorrowerRouter(_userAddr)
        returns (uint256 _maxToWithdraw)
    {
        ILiquidityPool _liquidityPool = _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        uint256 _maxNumber =
            _liquidityPool.convertNTokensToAsset(
                IERC20(address(_liquidityPool)).balanceOf(
                    borrowerRouterRegistry.borrowerRouters(_userAddr)
                )
            );

        _maxToWithdraw = _countMaxToWithdraw(
            _maxNumber,
            assetParameters.getIntegrationColRatio(_assetKey),
            getTotalBorrowBalanceInUSD(_userAddr),
            getCurrentBorrowLimitInUSD(_userAddr),
            isCollateralAssetEnabled(_userAddr, _assetKey),
            _liquidityPool
        );
    }

    function getUserLiquidityAmount(address _userAddr, bytes32 _assetKey)
        public
        view
        override(IBasicCore, AbstractCore)
        returns (uint256 _userLiquidityAmount)
    {
        address _borrowerRouterAddr = borrowerRouterRegistry.borrowerRouters(_userAddr);

        if (_borrowerRouterAddr != address(0)) {
            ILiquidityPool _liquidityPool = _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

            _userLiquidityAmount = _liquidityPool.convertNTokensToAsset(
                IERC20(address(_liquidityPool)).balanceOf(_borrowerRouterAddr)
            );
        }
    }

    function isBorrowExists(address _userAddr, bytes32 _assetKey)
        external
        view
        override(IBasicCore, AbstractCore)
        returns (bool)
    {
        bool _isActiveBorrow = getUserBorrowedAmount(_userAddr, _assetKey) != 0;

        return _userVaultTokens[_userAddr][_assetKey].length() > 0 || _isActiveBorrow;
    }

    function getTotalSupplyBalanceInUSD(address _userAddr)
        external
        view
        override(IBasicCore, AbstractCore)
        onlyExistingBorrowerRouter(_userAddr)
        returns (uint256 _totalSupplyBalance)
    {
        address _borrowerRouterAddr = borrowerRouterRegistry.borrowerRouters(_userAddr);
        ILiquidityPoolRegistry _poolsRegistry = liquidityPoolRegistry;

        bytes32[] memory _userSupplyAssets =
            assetsRegistry.getUserIntegrationSupplyAssets(_userAddr);

        for (uint256 i = 0; i < _userSupplyAssets.length; i++) {
            _totalSupplyBalance += _getCurrentSupplyAmountInUSD(
                _userSupplyAssets[i],
                _borrowerRouterAddr,
                _poolsRegistry
            );
        }
    }

    function getTotalBorrowBalanceInUSD(address _userAddr)
        public
        view
        override(IBasicCore, AbstractCore)
        onlyExistingBorrowerRouter(_userAddr)
        returns (uint256 _totalBorrowBalance)
    {
        ILiquidityPoolRegistry _poolsRegistry = liquidityPoolRegistry;
        bytes32[] memory _userBorrowAssets =
            assetsRegistry.getUserIntegrationBorrowAssets(_userAddr);

        for (uint256 i = 0; i < _userBorrowAssets.length; i++) {
            _totalBorrowBalance += _userBorrowAssets[i].getCurrentBorrowAmountInUSD(
                _userAddr,
                _poolsRegistry,
                IBasicCore(address(this))
            );
        }
    }

    function getCurrentBorrowLimitInUSD(address _userAddr)
        public
        view
        override(IBasicCore, AbstractCore)
        onlyExistingBorrowerRouter(_userAddr)
        returns (uint256 _currentBorrowLimit)
    {
        address _borrowerRouterAddr = borrowerRouterRegistry.borrowerRouters(_userAddr);
        IAssetParameters _parameters = assetParameters;
        ILiquidityPoolRegistry _poolsRegistry = liquidityPoolRegistry;

        bytes32[] memory _userSupplyAssets =
            assetsRegistry.getUserIntegrationSupplyAssets(_userAddr);

        for (uint256 i = 0; i < _userSupplyAssets.length; i++) {
            bytes32 _currentAssetKey = _userSupplyAssets[i];

            if (!disabledCollateralAssets[_userAddr][_currentAssetKey]) {
                uint256 _currentTokensAmount =
                    _getCurrentSupplyAmountInUSD(
                        _userSupplyAssets[i],
                        _borrowerRouterAddr,
                        _poolsRegistry
                    );

                _currentBorrowLimit += _currentTokensAmount.divWithPrecision(
                    _parameters.getIntegrationColRatio(_currentAssetKey)
                );
            }
        }
    }

    function deployBorrowerRouter() external {
        require(
            !borrowerRouterRegistry.isBorrowerRouterExists(msg.sender),
            "IntegrationCore: Borrower router already exists."
        );

        borrowerRouterRegistry.updateUserBorrowerRouter(
            msg.sender,
            borrowerRouterFactory.newBorrowerRouter(msg.sender)
        );
    }

    function addLiquidity(bytes32 _assetKey, uint256 _liquidityAmount)
        external
        override(IBasicCore, AbstractCore)
        onlyExistingBorrowerRouter(msg.sender)
        updateUserAssets(_assetKey, true)
    {
        require(
            _liquidityAmount > 0,
            "IntegrationCore: Liquidity amount must be greater than zero."
        );

        ILiquidityPool _assetLiquidityPool =
            _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        require(
            assetParameters.isAvailableAsCollateral(_assetKey),
            "IntegrationCore: It is impossible to lock an asset that cannot be a collateral."
        );

        IBasicCore _defiCore = defiCore;

        if (!_defiCore.disabledCollateralAssets(msg.sender, _assetKey)) {
            uint256 _newBorrowLimit =
                _defiCore.getNewBorrowLimitInUSD(msg.sender, _assetKey, _liquidityAmount, false);
            require(
                _newBorrowLimit >= _defiCore.getTotalBorrowBalanceInUSD(msg.sender),
                "IntegrationCore: Borrow limit used greater than 100%."
            );
        }

        rewardsDistribution.updateCumulativeSums(msg.sender, _assetLiquidityPool);

        IERC20(address(_assetLiquidityPool)).transferFrom(
            msg.sender,
            borrowerRouterRegistry.borrowerRouters(msg.sender),
            _assetLiquidityPool.convertAssetToNTokens(_liquidityAmount)
        );

        emit LiquidityAdded(msg.sender, _assetKey, _liquidityAmount);
    }

    function withdrawLiquidity(
        bytes32 _assetKey,
        uint256 _liquidityAmount,
        bool _isMaxWithdraw
    )
        external
        override(IBasicCore, AbstractCore)
        onlyExistingBorrowerRouter(msg.sender)
        updateUserAssets(_assetKey, true)
    {
        ILiquidityPool _assetLiquidityPool =
            _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        rewardsDistribution.updateCumulativeSums(msg.sender, _assetLiquidityPool);

        if (!_isMaxWithdraw) {
            require(
                _liquidityAmount > 0,
                "IntegrationCore: Liquidity amount must be greater than zero."
            );

            if (!disabledCollateralAssets[msg.sender][_assetKey]) {
                uint256 _newBorrowLimit =
                    getNewBorrowLimitInUSD(msg.sender, _assetKey, _liquidityAmount, false);
                require(
                    _newBorrowLimit >= getTotalBorrowBalanceInUSD(msg.sender),
                    "IntegrationCore: Borrow limit used greater than 100%."
                );
            }
        } else {
            _liquidityAmount = getMaxToWithdraw(msg.sender, _assetKey);
        }

        IBorrowerRouter _router =
            IBorrowerRouter(borrowerRouterRegistry.borrowerRouters(msg.sender));

        _router.increaseAllowance(address(_assetLiquidityPool));

        IERC20(address(_assetLiquidityPool)).transferFrom(
            address(_router),
            msg.sender,
            _assetLiquidityPool.convertAssetToNTokens(_liquidityAmount)
        );

        emit LiquidityWithdrawn(msg.sender, _assetKey, _liquidityAmount);
    }

    function borrow(
        bytes32 _assetKey,
        address _tokenToDeposit,
        uint256 _borrowAmount
    ) external onlyExistingBorrowerRouter(msg.sender) updateUserAssets(_assetKey, false) {
        require(_borrowAmount > 0, "IntegrationCore: Borrow amount must be greater than zero.");

        IAssetParameters _parameters = assetParameters;

        require(
            !_parameters.isPoolFrozen(_assetKey),
            "IntegrationCore: Pool is freeze for borrow operations."
        );

        require(
            _parameters.isAllowForIntegration(_assetKey),
            "IntegrationCore: Asset not allowed for integration."
        );

        (uint256 _availableLiquidity, ) = getAvailableLiquidity(msg.sender);

        ILiquidityPool _assetLiquidityPool =
            _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        require(
            _availableLiquidity > 0 &&
                _availableLiquidity >= _assetLiquidityPool.getAmountInUSD(_borrowAmount),
            "IntegrationCore: Not enough available liquidity."
        );

        rewardsDistribution.updateCumulativeSums(msg.sender, _assetLiquidityPool);

        IBorrowerRouter _userBorrowerRouter =
            IBorrowerRouter(borrowerRouterRegistry.borrowerRouters(msg.sender));

        _assetLiquidityPool.borrowFor(msg.sender, address(_userBorrowerRouter), _borrowAmount);

        _userBorrowerRouter.deposit(_assetLiquidityPool.assetAddr(), _tokenToDeposit);

        _updateVaultTokens(
            msg.sender,
            _assetKey,
            _tokenToDeposit,
            _assetLiquidityPool,
            _userBorrowerRouter,
            true
        );

        emit Borrowed(msg.sender, address(_userBorrowerRouter), _assetKey, _borrowAmount);
    }

    function repayBorrow(
        bytes32 _assetKey,
        uint256 _repayAmount,
        bool _isMaxRepay
    )
        external
        override(IBasicCore, AbstractCore)
        onlyExistingBorrowerRouter(msg.sender)
        updateUserAssets(_assetKey, false)
    {
        if (!_isMaxRepay) {
            require(_repayAmount > 0, "IntegrationCore: Zero amount cannot be repaid.");
        }

        ILiquidityPool _assetLiquidityPool =
            _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        rewardsDistribution.updateCumulativeSums(msg.sender, _assetLiquidityPool);

        _repayAmount = _assetLiquidityPool.repayBorrowFor(
            msg.sender,
            msg.sender,
            _repayAmount,
            _isMaxRepay
        );

        emit BorrowRepaid(msg.sender, _assetKey, _repayAmount);
    }

    function repayBorrowIntegration(
        bytes32 _assetKey,
        address _vaultTokenAddr,
        uint256 _repayAmount,
        bool _isMaxRepay
    ) external onlyExistingBorrowerRouter(msg.sender) updateUserAssets(_assetKey, false) {
        if (!_isMaxRepay) {
            require(_repayAmount > 0, "IntegrationCore: Zero amount cannot be repaid.");
        }

        IBorrowerRouter _userBorrowerRouter =
            IBorrowerRouter(borrowerRouterRegistry.borrowerRouters(msg.sender));
        ILiquidityPool _assetLiquidityPool =
            _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        rewardsDistribution.updateCumulativeSums(msg.sender, _assetLiquidityPool);

        _repayAmount = _assetLiquidityPool.repayBorrowIntegration(
            msg.sender,
            _vaultTokenAddr,
            address(_userBorrowerRouter),
            _repayAmount,
            _isMaxRepay
        );

        _updateVaultTokens(
            msg.sender,
            _assetKey,
            _vaultTokenAddr,
            _assetLiquidityPool,
            _userBorrowerRouter,
            false
        );

        emit BorrowRepaid(msg.sender, _assetKey, _repayAmount);
    }

    function optimization(
        address _userAddr,
        bytes32 _assetKey,
        address _vaultTokenAddr
    ) external onlyExistingBorrowerRouter(_userAddr) {
        require(
            _userVaultTokens[_userAddr][_assetKey].contains(_vaultTokenAddr),
            "IntegrationCore: User does not have current vault token address."
        );

        (, uint256 _debt) = getAvailableLiquidity(_userAddr);

        require(_debt > 0, "IntegrationCore: User debt must be greater than zero.");

        uint256 _userBorrowedAmount = getUserBorrowedAmount(_userAddr, _assetKey);
        require(_userBorrowedAmount > 0, "IntegrationCore: User borrowed amount is zero.");

        ILiquidityPool _liquidityPool = _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);
        IBorrowerRouter _router =
            IBorrowerRouter(borrowerRouterRegistry.borrowerRouters(_userAddr));

        uint256 _optimizationAmount =
            _userBorrowedAmount.mulWithPrecision(
                systemParameters.getOptimizationPercentageParam()
            );

        _liquidityPool.optimization(
            _userAddr,
            msg.sender,
            _vaultTokenAddr,
            address(_router),
            _optimizationAmount
        );

        _updateVaultTokens(_userAddr, _assetKey, _vaultTokenAddr, _liquidityPool, _router, false);
    }

    function _getMaxToWithdraw(
        address _from,
        bytes32 _assetKey,
        uint256 _currentColRatio,
        uint256 _totalBorrowBalance,
        uint256 _currentBorrowLimit,
        bool _disabledAsCollateral
    ) internal view returns (uint256) {
        ILiquidityPool _assetLiquidityPool =
            _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);

        uint256 _maxToWithdraw =
            _assetLiquidityPool.convertNTokensToAsset(
                IERC20(address(_assetLiquidityPool)).balanceOf(_from)
            );

        if (!_disabledAsCollateral) {
            uint256 _userLiquidityInUSD = _assetLiquidityPool.getAmountInUSD(_maxToWithdraw);
            uint256 _residualLimit =
                _currentBorrowLimit - _userLiquidityInUSD.divWithPrecision(_currentColRatio);

            if (_residualLimit < _totalBorrowBalance) {
                uint256 missingAmount =
                    (_totalBorrowBalance - _residualLimit).mulWithPrecision(_currentColRatio);
                _maxToWithdraw = _assetLiquidityPool.getAmountFromUSD(
                    _userLiquidityInUSD - missingAmount
                );
            }
        }

        return _maxToWithdraw;
    }

    function _isIntegrationCore() internal pure override returns (bool) {
        return true;
    }

    function _getCurrentSupplyAmountInUSD(
        bytes32 _assetKey,
        address _userRouterAddr,
        ILiquidityPoolRegistry _poolsRegistry
    ) internal view override returns (uint256) {
        ILiquidityPool _currentLiquidityPool = _assetKey.getAssetLiquidityPool(_poolsRegistry);

        return
            _currentLiquidityPool.getAmountInUSD(
                _currentLiquidityPool.convertNTokensToAsset(
                    IERC20(address(_currentLiquidityPool)).balanceOf(_userRouterAddr)
                )
            );
    }

    function _updateVaultTokens(
        address _userAddr,
        bytes32 _assetKey,
        address _vaultTokenAddr,
        ILiquidityPool _liquidityPool,
        IBorrowerRouter _router,
        bool _isAdding
    ) internal {
        if (_isAdding) {
            _userVaultTokens[_userAddr][_assetKey].add(_vaultTokenAddr);
        } else if (
            _router.depositOfAssetInToken(_vaultTokenAddr, _liquidityPool.assetAddr()) == 0
        ) {
            _userVaultTokens[_userAddr][_assetKey].remove(_vaultTokenAddr);
        }
    }
}
