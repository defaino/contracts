// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "@dlsl/dev-modules/contracts-registry/AbstractDependant.sol";
import "@dlsl/dev-modules/libs/decimals/DecimalsConverter.sol";

import "./interfaces/IRegistry.sol";
import "./interfaces/IDefiCore.sol";
import "./interfaces/IAssetParameters.sol";
import "./interfaces/ISystemParameters.sol";
import "./interfaces/IRewardsDistribution.sol";
import "./interfaces/ISystemPoolsRegistry.sol";
import "./interfaces/IBasicPool.sol";
import "./interfaces/IUserInfoRegistry.sol";

import "./libraries/AssetsHelperLibrary.sol";
import "./libraries/MathHelper.sol";

contract UserInfoRegistry is IUserInfoRegistry, AbstractDependant {
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using AssetsHelperLibrary for bytes32;
    using DecimalsConverter for uint256;
    using MathHelper for uint256;

    IDefiCore internal defiCore;
    ISystemParameters internal systemParameters;
    IAssetParameters internal assetParameters;
    IRewardsDistribution internal rewardsDistribution;
    ISystemPoolsRegistry internal systemPoolsRegistry;

    mapping(address => EnumerableSet.Bytes32Set) internal _supplyAssets;
    mapping(address => EnumerableSet.Bytes32Set) internal _borrowAssets;

    modifier onlyDefiCore() {
        require(address(defiCore) == msg.sender, "UserInfoRegistry: Caller not a DefiCore.");
        _;
    }

    modifier onlyLiquidityPools() {
        require(
            systemPoolsRegistry.existingLiquidityPools(msg.sender),
            "UserInfoRegistry: Caller not a LiquidityPool."
        );
        _;
    }

    function setDependencies(address _contractsRegistry) external override dependant {
        IRegistry _registry = IRegistry(_contractsRegistry);

        defiCore = IDefiCore(_registry.getDefiCoreContract());
        assetParameters = IAssetParameters(_registry.getAssetParametersContract());
        systemParameters = ISystemParameters(_registry.getSystemParametersContract());
        rewardsDistribution = IRewardsDistribution(_registry.getRewardsDistributionContract());
        systemPoolsRegistry = ISystemPoolsRegistry(_registry.getSystemPoolsRegistryContract());
    }

    function updateAssetsAfterTransfer(
        bytes32 _assetKey,
        address _from,
        address _to,
        uint256 _amount
    ) external override onlyLiquidityPools {
        if (IERC20(msg.sender).balanceOf(_from) - _amount == 0) {
            _supplyAssets[_from].remove(_assetKey);
        }

        _supplyAssets[_to].add(_assetKey);
    }

    function updateUserSupplyAssets(
        address _userAddr,
        bytes32 _assetKey
    ) external override onlyDefiCore {
        _updateUserAssets(
            _userAddr,
            _assetKey,
            _supplyAssets[_userAddr],
            IDefiCore(msg.sender).getUserLiquidityAmount
        );
    }

    function updateUserBorrowAssets(
        address _userAddr,
        bytes32 _assetKey
    ) external override onlyDefiCore {
        _updateUserAssets(
            _userAddr,
            _assetKey,
            _borrowAssets[_userAddr],
            IDefiCore(msg.sender).getUserBorrowedAmount
        );
    }

    function getUserSupplyAssets(
        address _userAddr
    ) external view override returns (bytes32[] memory) {
        return _supplyAssets[_userAddr].values();
    }

    function getUserBorrowAssets(
        address _userAddr
    ) external view override returns (bytes32[] memory) {
        return _borrowAssets[_userAddr].values();
    }

    function getUserMainInfo(
        address _userAddr
    ) external view override returns (UserMainInfo memory) {
        uint256 _totalBorrowBalance = defiCore.getTotalBorrowBalanceInUSD(_userAddr);
        uint256 _borrowLimit = defiCore.getCurrentBorrowLimitInUSD(_userAddr);
        uint256 _borrowLimitUsed = _borrowLimit > 0
            ? _totalBorrowBalance.divWithPrecision(_borrowLimit)
            : 0;

        return
            UserMainInfo(
                _userAddr.balance,
                defiCore.getTotalSupplyBalanceInUSD(_userAddr),
                _totalBorrowBalance,
                _borrowLimit,
                _borrowLimitUsed
            );
    }

    function getUserDistributionRewards(
        address _userAddr
    ) external view override returns (RewardsDistributionInfo memory) {
        ISystemPoolsRegistry _poolsRegistry = systemPoolsRegistry;
        IRewardsDistribution _rewardsDistribution = rewardsDistribution;

        IERC20Metadata _rewardsToken = IERC20Metadata(systemParameters.getRewardsTokenAddress());
        ILiquidityPool _rewardsPool = ILiquidityPool(_poolsRegistry.getRewardsLiquidityPool());

        if (address(_rewardsToken) == address(0) || address(_rewardsPool) == address(0)) {
            return RewardsDistributionInfo(address(0), 0, 0, 0, 0);
        }

        bytes32[] memory _allAssets = _poolsRegistry.getAllSupportedAssetKeys();

        uint256 _totalReward;

        for (uint256 i = 0; i < _allAssets.length; i++) {
            _totalReward += _rewardsDistribution.getUserReward(
                _allAssets[i],
                _userAddr,
                address(_allAssets[i].getAssetLiquidityPool(_poolsRegistry))
            );
        }

        uint256 _userBalance = _rewardsToken.balanceOf(_userAddr).to18(_rewardsToken.decimals());

        return
            RewardsDistributionInfo(
                address(_rewardsToken),
                _totalReward,
                _rewardsPool.getAmountInUSD(_totalReward),
                _userBalance,
                _rewardsPool.getAmountInUSD(_userBalance)
            );
    }

    function getUserSupplyPoolsInfo(
        address _userAddr,
        bytes32[] calldata _assetKeys
    ) external view override returns (UserSupplyPoolInfo[] memory _supplyPoolsInfo) {
        IDefiCore _defiCore = defiCore;
        ISystemPoolsRegistry _poolsRegistry = systemPoolsRegistry;

        _supplyPoolsInfo = new UserSupplyPoolInfo[](_assetKeys.length);

        for (uint256 i = 0; i < _assetKeys.length; i++) {
            ILiquidityPool _currentLiquidityPool = _assetKeys[i].getAssetLiquidityPool(
                _poolsRegistry
            );

            uint256 _marketSize = _currentLiquidityPool.getTotalLiquidity();
            uint256 _userDepositAmount = _defiCore.getUserLiquidityAmount(
                _userAddr,
                _assetKeys[i]
            );
            (uint256 _distrSupplyAPY, ) = rewardsDistribution.getAPY(_assetKeys[i]);

            _supplyPoolsInfo[i] = UserSupplyPoolInfo(
                _getBasePoolInfo(_userAddr, _assetKeys[i], _currentLiquidityPool, _defiCore),
                _marketSize,
                _currentLiquidityPool.getAmountInUSD(_marketSize),
                _userDepositAmount,
                _currentLiquidityPool.getAmountInUSD(_userDepositAmount),
                _currentLiquidityPool.getAPY(),
                _distrSupplyAPY
            );
        }
    }

    function getUserBorrowPoolsInfo(
        address _userAddr,
        bytes32[] calldata _assetKeys
    ) external view override returns (UserBorrowPoolInfo[] memory _borrowPoolsInfo) {
        IDefiCore _defiCore = defiCore;
        ISystemPoolsRegistry _poolsRegistry = systemPoolsRegistry;

        _borrowPoolsInfo = new UserBorrowPoolInfo[](_assetKeys.length);

        for (uint256 i = 0; i < _assetKeys.length; i++) {
            ILiquidityPool _currentLiquidityPool = _assetKeys[i].getAssetLiquidityPool(
                _poolsRegistry
            );

            uint256 _availableToBorrow = _currentLiquidityPool.getAvailableToBorrowLiquidity();
            uint256 _userBorrowAmount = _defiCore.getUserBorrowedAmount(_userAddr, _assetKeys[i]);
            (, uint256 _distrBorrowAPY) = rewardsDistribution.getAPY(_assetKeys[i]);

            _borrowPoolsInfo[i] = UserBorrowPoolInfo(
                _getBasePoolInfo(_userAddr, _assetKeys[i], _currentLiquidityPool, _defiCore),
                _availableToBorrow,
                _currentLiquidityPool.getAmountInUSD(_availableToBorrow),
                _userBorrowAmount,
                _currentLiquidityPool.getAmountInUSD(_userBorrowAmount),
                _currentLiquidityPool.getAnnualBorrowRate(),
                _distrBorrowAPY
            );
        }
    }

    function getUserPoolInfo(
        address _userAddr,
        bytes32 _assetKey
    ) external view override returns (UserPoolInfo memory) {
        IDefiCore _defiCore = defiCore;
        IBasicPool _basicPool = _assetKey.getAssetLiquidityPool(systemPoolsRegistry);
        IERC20Metadata _asset = IERC20Metadata(_basicPool.assetAddr());

        uint256 _userSupplyBalance;
        bool _isCollateralEnabled;

        uint256 _walletBalance = _asset.balanceOf(_userAddr).to18(_asset.decimals());
        uint256 _userBorrowedAmount = _defiCore.getUserBorrowedAmount(_userAddr, _assetKey);

        if (_assetKey == systemPoolsRegistry.nativeAssetKey()) {
            _walletBalance += _userAddr.balance;
        }

        (, ISystemPoolsRegistry.PoolType _poolType) = systemPoolsRegistry.poolsInfo(_assetKey);

        if (_poolType == ISystemPoolsRegistry.PoolType.LIQUIDITY_POOL) {
            _userSupplyBalance = _defiCore.getUserLiquidityAmount(_userAddr, _assetKey);
            _isCollateralEnabled = _defiCore.isCollateralAssetEnabled(_userAddr, _assetKey);
        }

        return
            UserPoolInfo(
                _walletBalance,
                _basicPool.getAmountInUSD(_walletBalance),
                _userSupplyBalance,
                _basicPool.getAmountInUSD(_userSupplyBalance),
                _userBorrowedAmount,
                _basicPool.getAmountInUSD(_userBorrowedAmount),
                _isCollateralEnabled
            );
    }

    function getUserMaxValues(
        address _userAddr,
        bytes32 _assetKey
    ) external view override returns (UserMaxValues memory) {
        IDefiCore _defiCore = defiCore;

        uint256 _maxToSupply;
        uint256 _maxToWithdraw;

        (, ISystemPoolsRegistry.PoolType _poolType) = systemPoolsRegistry.poolsInfo(_assetKey);

        if (_poolType == ISystemPoolsRegistry.PoolType.LIQUIDITY_POOL) {
            _maxToSupply = _defiCore.getMaxToSupply(_userAddr, _assetKey);
            _maxToWithdraw = _defiCore.getMaxToWithdraw(_userAddr, _assetKey);
        }

        return
            UserMaxValues(
                _maxToSupply,
                _maxToWithdraw,
                _defiCore.getMaxToBorrow(_userAddr, _assetKey),
                _defiCore.getMaxToRepay(_userAddr, _assetKey)
            );
    }

    function getUsersLiquidiationInfo(
        address[] calldata _accounts
    ) external view override returns (UserLiquidationInfo[] memory _resultArr) {
        IDefiCore _defiCore = defiCore;

        _resultArr = new UserLiquidationInfo[](_accounts.length);

        for (uint256 i = 0; i < _accounts.length; i++) {
            bytes32[] memory _allUserSupplyAssets = _supplyAssets[_accounts[i]].values();

            bytes32[] memory _userSupplyAssets = new bytes32[](_allUserSupplyAssets.length);
            uint256 _arrIndex;

            for (uint256 j = 0; j < _allUserSupplyAssets.length; j++) {
                if (_defiCore.isCollateralAssetEnabled(_accounts[i], _allUserSupplyAssets[j])) {
                    _userSupplyAssets[_arrIndex++] = _allUserSupplyAssets[j];
                }
            }

            _resultArr[i] = UserLiquidationInfo(
                _accounts[i],
                _getMainPoolsInfo(_borrowAssets[_accounts[i]].values()),
                _getMainPoolsInfo(_userSupplyAssets),
                _defiCore.getTotalBorrowBalanceInUSD(_accounts[i])
            );
        }
    }

    function getUserLiquidationData(
        address _userAddr,
        bytes32 _borrowAssetKey,
        bytes32 _receiveAssetKey
    ) external view override returns (UserLiquidationData memory) {
        IDefiCore _defiCore = defiCore;
        ISystemPoolsRegistry _poolsRegistry = systemPoolsRegistry;
        ILiquidityPool _borrowLiquidityPool = _borrowAssetKey.getAssetLiquidityPool(
            _poolsRegistry
        );

        uint256 _receiveAssetPrice = _receiveAssetKey
            .getAssetLiquidityPool(_poolsRegistry)
            .getAssetPrice();

        return
            UserLiquidationData(
                _borrowLiquidityPool.getAssetPrice(),
                _receiveAssetPrice,
                _receiveAssetPrice.mulWithPrecision(
                    PERCENTAGE_100 - assetParameters.getLiquidationDiscount(_receiveAssetKey)
                ),
                _defiCore.getUserBorrowedAmount(_userAddr, _borrowAssetKey),
                _defiCore.getUserLiquidityAmount(_userAddr, _receiveAssetKey),
                _borrowLiquidityPool.getAmountFromUSD(
                    getMaxLiquidationQuantity(_userAddr, _receiveAssetKey, _borrowAssetKey)
                )
            );
    }

    function getMaxLiquidationQuantity(
        address _userAddr,
        bytes32 _supplyAssetKey,
        bytes32 _borrowAssetKey
    ) public view override returns (uint256 _maxQuantityInUSD) {
        IDefiCore _defiCore = defiCore;
        ISystemPoolsRegistry _poolsRegistry = systemPoolsRegistry;

        uint256 _liquidateLimitBySupply = _defiCore
            .getUserLiquidityAmount(_userAddr, _supplyAssetKey)
            .mulWithPrecision(
                PERCENTAGE_100 - assetParameters.getLiquidationDiscount(_supplyAssetKey)
            );

        uint256 _userBorrowAmountInUSD = _borrowAssetKey
            .getAssetLiquidityPool(_poolsRegistry)
            .getAmountInUSD(_defiCore.getUserBorrowedAmount(_userAddr, _borrowAssetKey));

        _maxQuantityInUSD = Math.min(
            _supplyAssetKey.getAssetLiquidityPool(_poolsRegistry).getAmountInUSD(
                _liquidateLimitBySupply
            ),
            _userBorrowAmountInUSD
        );

        uint256 _maxLiquidatePart = _defiCore
            .getTotalBorrowBalanceInUSD(_userAddr)
            .mulWithPrecision(systemParameters.getLiquidationBoundary());

        _maxQuantityInUSD = Math.min(_maxQuantityInUSD, _maxLiquidatePart);
    }

    function _updateUserAssets(
        address _userAddr,
        bytes32 _assetKey,
        EnumerableSet.Bytes32Set storage _userAssets,
        function(address, bytes32) external view returns (uint256) _getAmount
    ) internal {
        if (_getAmount(_userAddr, _assetKey) == 0) {
            _userAssets.remove(_assetKey);
        } else {
            _userAssets.add(_assetKey);
        }
    }

    function _getBasePoolInfo(
        address _userAddr,
        bytes32 _assetKey,
        ILiquidityPool _liquidityPool,
        IDefiCore _defiCore
    ) internal view returns (BasePoolInfo memory) {
        return
            BasePoolInfo(
                MainPoolInfo(_assetKey, _liquidityPool.assetAddr()),
                _liquidityPool.getBorrowPercentage(),
                _defiCore.isCollateralAssetEnabled(_userAddr, _assetKey)
            );
    }

    function _getMainPoolsInfo(
        bytes32[] memory _assetKeys
    ) internal view returns (MainPoolInfo[] memory _mainPoolsInfo) {
        ISystemPoolsRegistry _poolsRegistry = systemPoolsRegistry;

        _mainPoolsInfo = new MainPoolInfo[](_assetKeys.length);

        for (uint256 i; i < _assetKeys.length; i++) {
            if (_assetKeys[i] == bytes32(0)) {
                _mainPoolsInfo[i] = MainPoolInfo(_assetKeys[i], address(0));

                continue;
            }

            ILiquidityPool _currentLiquidityPool = _assetKeys[i].getAssetLiquidityPool(
                _poolsRegistry
            );

            _mainPoolsInfo[i] = MainPoolInfo(_assetKeys[i], _currentLiquidityPool.assetAddr());
        }
    }
}
