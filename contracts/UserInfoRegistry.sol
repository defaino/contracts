// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./interfaces/IDefiCore.sol";
import "./interfaces/IAssetParameters.sol";
import "./interfaces/ISystemParameters.sol";
import "./interfaces/IRewardsDistribution.sol";
import "./interfaces/ILiquidityPoolRegistry.sol";
import "./interfaces/ILiquidityPool.sol";
import "./interfaces/IUserInfoRegistry.sol";

import "./libraries/DecimalsConverter.sol";
import "./libraries/AssetsHelperLibrary.sol";
import "./libraries/MathHelper.sol";

import "./Registry.sol";
import "./abstract/AbstractDependant.sol";

contract UserInfoRegistry is IUserInfoRegistry, AbstractDependant {
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using AssetsHelperLibrary for bytes32;
    using DecimalsConverter for uint256;
    using MathHelper for uint256;

    mapping(address => EnumerableSet.Bytes32Set) internal _supplyAssets;
    mapping(address => EnumerableSet.Bytes32Set) internal _borrowAssets;

    IERC20Metadata internal governanceToken;
    IDefiCore internal defiCore;
    ISystemParameters internal systemParameters;
    IAssetParameters internal assetParameters;
    IRewardsDistribution internal rewardsDistribution;
    ILiquidityPoolRegistry internal liquidityPoolRegistry;

    modifier onlyDefiCore() {
        require(address(defiCore) == msg.sender, "UserInfoRegistry: Caller not a DefiCore.");
        _;
    }

    modifier onlyLiquidityPools() {
        require(
            liquidityPoolRegistry.existingLiquidityPools(msg.sender),
            "UserInfoRegistry: Caller not a LiquidityPool."
        );
        _;
    }

    function setDependencies(Registry _registry) external override onlyInjectorOrZero {
        defiCore = IDefiCore(_registry.getDefiCoreContract());
        assetParameters = IAssetParameters(_registry.getAssetParametersContract());
        systemParameters = ISystemParameters(_registry.getSystemParametersContract());
        rewardsDistribution = IRewardsDistribution(_registry.getRewardsDistributionContract());
        liquidityPoolRegistry = ILiquidityPoolRegistry(
            _registry.getLiquidityPoolRegistryContract()
        );
        governanceToken = IERC20Metadata(_registry.getGovernanceTokenContract());
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

    function updateUserSupplyAssets(address _userAddr, bytes32 _assetKey)
        external
        override
        onlyDefiCore
    {
        if (IDefiCore(msg.sender).getUserLiquidityAmount(_userAddr, _assetKey) == 0) {
            _supplyAssets[_userAddr].remove(_assetKey);
        } else {
            _supplyAssets[_userAddr].add(_assetKey);
        }
    }

    function updateUserBorrowAssets(address _userAddr, bytes32 _assetKey)
        external
        override
        onlyDefiCore
    {
        if (IDefiCore(msg.sender).getUserBorrowedAmount(_userAddr, _assetKey) == 0) {
            _borrowAssets[_userAddr].remove(_assetKey);
        } else {
            _borrowAssets[_userAddr].add(_assetKey);
        }
    }

    function getUserSupplyAssets(address _userAddr)
        external
        view
        override
        returns (bytes32[] memory)
    {
        return _getUserAssets(_supplyAssets[_userAddr]);
    }

    function getUserBorrowAssets(address _userAddr)
        external
        view
        override
        returns (bytes32[] memory)
    {
        return _getUserAssets(_borrowAssets[_userAddr]);
    }

    function getUserMainInfo(address _userAddr)
        external
        view
        override
        returns (UserMainInfo memory)
    {
        uint256 _totalBorrowBalance = defiCore.getTotalBorrowBalanceInUSD(_userAddr);
        uint256 _borrowLimit = defiCore.getCurrentBorrowLimitInUSD(_userAddr);

        return
            UserMainInfo(
                defiCore.getTotalSupplyBalanceInUSD(_userAddr),
                _totalBorrowBalance,
                _borrowLimit,
                _totalBorrowBalance.divWithPrecision(_borrowLimit)
            );
    }

    function getUserDistributionRewards(address _userAddr)
        external
        view
        override
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
        IERC20Metadata _governanceToken = governanceToken;

        uint256 _userBalance = _governanceToken.balanceOf(_userAddr).convertTo18(
            _governanceToken.decimals()
        );

        return
            RewardsDistributionInfo(
                address(_governanceToken),
                _totalReward,
                _governancePool.getAmountInUSD(_totalReward),
                _userBalance,
                _governancePool.getAmountInUSD(_userBalance)
            );
    }

    function getUserSupplyPoolsInfo(address _userAddr, bytes32[] calldata _assetKeys)
        external
        view
        override
        returns (UserSupplyPoolInfo[] memory _supplyPoolsInfo)
    {
        IDefiCore _defiCore = defiCore;
        ILiquidityPoolRegistry _liquidityPoolRegistry = liquidityPoolRegistry;

        _supplyPoolsInfo = new UserSupplyPoolInfo[](_assetKeys.length);

        for (uint256 i = 0; i < _assetKeys.length; i++) {
            ILiquidityPool _currentLiquidityPool = _assetKeys[i].getAssetLiquidityPool(
                _liquidityPoolRegistry
            );

            uint256 _marketSize = _currentLiquidityPool.getTotalLiquidity();
            uint256 _userDepositAmount = _defiCore.getUserLiquidityAmount(
                _userAddr,
                _assetKeys[i]
            );

            _supplyPoolsInfo[i] = UserSupplyPoolInfo(
                _getBasePoolInfo(_userAddr, _assetKeys[i], _currentLiquidityPool, _defiCore),
                _marketSize,
                _currentLiquidityPool.getAmountInUSD(_marketSize),
                _userDepositAmount,
                _currentLiquidityPool.getAmountInUSD(_userDepositAmount),
                _currentLiquidityPool.getAPY()
            );
        }
    }

    function getUserBorrowPoolsInfo(address _userAddr, bytes32[] calldata _assetKeys)
        external
        view
        override
        returns (UserBorrowPoolInfo[] memory _borrowPoolsInfo)
    {
        IDefiCore _defiCore = defiCore;
        ILiquidityPoolRegistry _liquidityPoolRegistry = liquidityPoolRegistry;

        _borrowPoolsInfo = new UserBorrowPoolInfo[](_assetKeys.length);

        for (uint256 i = 0; i < _assetKeys.length; i++) {
            ILiquidityPool _currentLiquidityPool = _assetKeys[i].getAssetLiquidityPool(
                _liquidityPoolRegistry
            );

            uint256 _availableToBorrow = _currentLiquidityPool.getAvailableToBorrowLiquidity();
            uint256 _userBorrowAmount = _defiCore.getUserBorrowedAmount(_userAddr, _assetKeys[i]);

            _borrowPoolsInfo[i] = UserBorrowPoolInfo(
                _getBasePoolInfo(_userAddr, _assetKeys[i], _currentLiquidityPool, _defiCore),
                _availableToBorrow,
                _currentLiquidityPool.getAmountInUSD(_availableToBorrow),
                _userBorrowAmount,
                _currentLiquidityPool.getAmountInUSD(_userBorrowAmount),
                _currentLiquidityPool.getAnnualBorrowRate()
            );
        }
    }

    function getUserPoolInfo(address _userAddr, bytes32 _assetKey)
        external
        view
        override
        returns (UserPoolInfo memory)
    {
        IDefiCore _defiCore = defiCore;
        ILiquidityPool _liquidityPool = _assetKey.getAssetLiquidityPool(liquidityPoolRegistry);
        IERC20Metadata _asset = IERC20Metadata(_liquidityPool.assetAddr());

        uint256 _walletBalance = _asset.balanceOf(_userAddr).convertTo18(_asset.decimals());
        uint256 _userSupplyBalance = _defiCore.getUserLiquidityAmount(_userAddr, _assetKey);
        uint256 _userBorrowedAmount = _defiCore.getUserBorrowedAmount(_userAddr, _assetKey);

        return
            UserPoolInfo(
                _walletBalance,
                _liquidityPool.getAmountInUSD(_walletBalance),
                _userSupplyBalance,
                _liquidityPool.getAmountInUSD(_userSupplyBalance),
                _userBorrowedAmount,
                _liquidityPool.getAmountInUSD(_userBorrowedAmount),
                _defiCore.isCollateralAssetEnabled(_userAddr, _assetKey)
            );
    }

    function getUserMaxValues(address _userAddr, bytes32 _assetKey)
        external
        view
        override
        returns (UserMaxValues memory)
    {
        IDefiCore _defiCore = defiCore;

        return
            UserMaxValues(
                _defiCore.getMaxToSupply(_userAddr, _assetKey),
                _defiCore.getMaxToWithdraw(_userAddr, _assetKey),
                _defiCore.getMaxToBorrow(_userAddr, _assetKey),
                _defiCore.getMaxToRepay(_userAddr, _assetKey)
            );
    }

    function getUsersLiquidiationInfo(address[] calldata _accounts)
        external
        view
        override
        returns (UserLiquidationInfo[] memory _resultArr)
    {
        IDefiCore _defiCore = defiCore;

        _resultArr = new UserLiquidationInfo[](_accounts.length);

        for (uint256 i = 0; i < _accounts.length; i++) {
            bytes32[] memory _allUserSupplyAssets = _getUserAssets(_supplyAssets[_accounts[i]]);

            bytes32[] memory _userSupplyAssets = new bytes32[](_allUserSupplyAssets.length);
            uint256 _arrIndex;

            for (uint256 j = 0; j < _allUserSupplyAssets.length; j++) {
                if (_defiCore.isCollateralAssetEnabled(_accounts[i], _allUserSupplyAssets[j])) {
                    _userSupplyAssets[_arrIndex++] = _allUserSupplyAssets[j];
                }
            }

            _resultArr[i] = UserLiquidationInfo(
                _getUserAssets(_borrowAssets[_accounts[i]]),
                _userSupplyAssets,
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
        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;
        ILiquidityPool _borrowLiquidityPool = _borrowAssetKey.getAssetLiquidityPool(_poolRegistry);

        uint256 _receiveAssetPrice = _receiveAssetKey
            .getAssetLiquidityPool(_poolRegistry)
            .getAssetPrice();

        return
            UserLiquidationData(
                _borrowLiquidityPool.getAssetPrice(),
                _receiveAssetPrice,
                _receiveAssetPrice.mulWithPrecision(
                    DECIMAL - assetParameters.getLiquidationDiscount(_receiveAssetKey)
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
        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;

        uint256 _liquidateLimitBySupply = (_defiCore.getUserLiquidityAmount(
            _userAddr,
            _supplyAssetKey
        ) * (DECIMAL - assetParameters.getLiquidationDiscount(_supplyAssetKey))) / DECIMAL;

        uint256 _userBorrowAmountInUSD = _borrowAssetKey
            .getAssetLiquidityPool(_poolRegistry)
            .getAmountInUSD(_defiCore.getUserBorrowedAmount(_userAddr, _borrowAssetKey));

        _maxQuantityInUSD = Math.min(
            _supplyAssetKey.getAssetLiquidityPool(_poolRegistry).getAmountInUSD(
                _liquidateLimitBySupply
            ),
            _userBorrowAmountInUSD
        );

        uint256 _maxLiquidatePart = _defiCore
            .getTotalBorrowBalanceInUSD(_userAddr)
            .mulWithPrecision(systemParameters.getLiquidationBoundaryParam());

        _maxQuantityInUSD = Math.min(_maxQuantityInUSD, _maxLiquidatePart);
    }

    function _getBasePoolInfo(
        address _userAddr,
        bytes32 _assetKey,
        ILiquidityPool _liquidityPool,
        IDefiCore _defiCore
    ) internal view returns (BasePoolInfo memory) {
        return
            BasePoolInfo(
                _assetKey,
                _liquidityPool.assetAddr(),
                _liquidityPool.getBorrowPercentage(),
                _defiCore.isCollateralAssetEnabled(_userAddr, _assetKey)
            );
    }

    function _getUserAssets(EnumerableSet.Bytes32Set storage _userAssets)
        internal
        view
        returns (bytes32[] memory _userAssetsArr)
    {
        uint256 _assetsCount = _userAssets.length();

        _userAssetsArr = new bytes32[](_assetsCount);

        for (uint256 i = 0; i < _assetsCount; i++) {
            _userAssetsArr[i] = _userAssets.at(i);
        }
    }
}
