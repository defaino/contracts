// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

import "@dlsl/dev-modules/contracts-registry/AbstractDependant.sol";
import "@dlsl/dev-modules/libs/arrays/Paginator.sol";

import "./interfaces/IRegistry.sol";
import "./interfaces/ISystemParameters.sol";
import "./interfaces/IAssetParameters.sol";
import "./interfaces/IDefiCore.sol";
import "./interfaces/IRewardsDistribution.sol";
import "./interfaces/ISystemPoolsRegistry.sol";
import "./interfaces/IBasicPool.sol";
import "./interfaces/IPriceManager.sol";
import "./interfaces/ISystemPoolsFactory.sol";
import "./interfaces/IRoleManager.sol";

contract SystemPoolsRegistry is ISystemPoolsRegistry, Initializable, AbstractDependant {
    using Paginator for EnumerableSet.Bytes32Set;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using Math for uint256;

    bytes32 public override nativeAssetKey;
    bytes32 public override rewardsAssetKey;

    address internal _systemOwnerAddr;
    IRegistry internal _registry;
    ISystemParameters internal _systemParameters;
    IAssetParameters internal _assetParameters;
    IDefiCore internal _defiCore;
    IRewardsDistribution internal _rewardsDistribution;
    ISystemPoolsFactory internal _systemPoolsFactory;
    IPriceManager internal _priceManager;
    IRoleManager internal _roleManager;
    EnumerableSet.Bytes32Set internal _allSupportedAssetKeys;

    mapping(bytes32 => PoolInfo) public override poolsInfo;
    mapping(address => bool) public override existingLiquidityPools;
    mapping(PoolType => PoolTypeInfo) internal _poolTypesInfo;

    modifier onlySystemPoolsManager() {
        _onlySystemPoolsManager();
        _;
    }

    modifier onlySystemPoolsReserveFundsManager() {
        _onlySystemPoolsReserveFundsManager();
        _;
    }

    function systemPoolsRegistryInitialize(
        address liquidityPoolImpl_,
        bytes32 nativeAssetKey_,
        bytes32 rewardsAssetKey_
    ) external initializer {
        _poolTypesInfo[PoolType.LIQUIDITY_POOL].poolBeaconAddr = address(
            new UpgradeableBeacon(liquidityPoolImpl_)
        );

        nativeAssetKey = nativeAssetKey_;
        rewardsAssetKey = rewardsAssetKey_;
    }

    function setDependencies(address contractsRegistry_) external override dependant {
        IRegistry registry_ = IRegistry(contractsRegistry_);

        _registry = registry_;
        _systemOwnerAddr = registry_.getSystemOwner();
        _systemParameters = ISystemParameters(registry_.getSystemParametersContract());
        _assetParameters = IAssetParameters(registry_.getAssetParametersContract());
        _defiCore = IDefiCore(registry_.getDefiCoreContract());
        _priceManager = IPriceManager(registry_.getPriceManagerContract());
        _rewardsDistribution = IRewardsDistribution(registry_.getRewardsDistributionContract());
        _systemPoolsFactory = ISystemPoolsFactory(registry_.getSystemPoolsFactoryContract());
        _roleManager = IRoleManager(registry_.getRoleManagerContract());
    }

    function updateRewardsAssetKey(bytes32 newRewardsAssetKey_) external onlySystemPoolsManager {
        require(
            IBasicPool(poolsInfo[newRewardsAssetKey_].poolAddr).assetAddr() ==
                _systemParameters.getRewardsTokenAddress(),
            "SystemPoolsRegistry: Incorrect new rewards asset key."
        );

        rewardsAssetKey = newRewardsAssetKey_;
    }

    function addPoolsBeacon(
        PoolType poolType_,
        address poolImpl_
    ) external override onlySystemPoolsManager {
        PoolTypeInfo storage _poolTypeInfo = _poolTypesInfo[poolType_];

        require(
            _poolTypeInfo.poolBeaconAddr == address(0),
            "SystemPoolsRegistry: Pools beacon for passed pool type already set."
        );

        _poolTypeInfo.poolBeaconAddr = address(new UpgradeableBeacon(poolImpl_));
    }

    function addLiquidityPool(
        address assetAddr_,
        bytes32 assetKey_,
        address chainlinkOracle_,
        string calldata tokenSymbol_,
        bool isCollateral_,
        bool isCollateralWithPRT_
    ) external override onlySystemPoolsManager {
        _addPool(
            assetAddr_,
            assetKey_,
            chainlinkOracle_,
            tokenSymbol_,
            isCollateral_,
            isCollateralWithPRT_,
            PoolType.LIQUIDITY_POOL
        );
    }

    function addStablePool(
        address assetAddr_,
        bytes32 assetKey_,
        address chainlinkOracle_
    ) external override onlySystemPoolsManager {
        require(
            _systemParameters.getStablePoolsAvailability(),
            "SystemPoolsRegistry: Stable pools are unavailable."
        );

        _addPool(assetAddr_, assetKey_, chainlinkOracle_, "", true, true, PoolType.STABLE_POOL);
    }

    function withdrawReservedFunds(
        address recipientAddr_,
        bytes32 assetKey_,
        uint256 amountToWithdraw_,
        bool isAllFunds_
    ) external override onlySystemPoolsReserveFundsManager {
        require(onlyExistingPool(assetKey_), "SystemPoolsRegistry: Pool doesn't exist.");

        if (!isAllFunds_) {
            require(
                amountToWithdraw_ > 0,
                "SystemPoolsRegistry: Amount to withdraw must be greater than zero."
            );
        }

        IBasicPool(poolsInfo[assetKey_].poolAddr).withdrawReservedFunds(
            recipientAddr_,
            amountToWithdraw_,
            isAllFunds_
        );
    }

    function withdrawAllReservedFunds(
        address recipientAddr_,
        uint256 offset_,
        uint256 limit_
    ) external override onlySystemPoolsReserveFundsManager {
        bytes32[] memory _assetsKeys = getSupportedAssetKeys(offset_, limit_);

        for (uint256 i = 0; i < _assetsKeys.length; i++) {
            IBasicPool(poolsInfo[_assetsKeys[i]].poolAddr).withdrawReservedFunds(
                recipientAddr_,
                0,
                true
            );
        }
    }

    function upgradePoolsImpl(
        PoolType poolType_,
        address newPoolsImpl_
    ) external override onlySystemPoolsManager {
        address poolBeacon_ = _poolTypesInfo[poolType_].poolBeaconAddr;

        require(poolBeacon_ != address(0), "SystemPoolsRegistry: Unsupported pool type.");

        UpgradeableBeacon(poolBeacon_).upgradeTo(newPoolsImpl_);
    }

    function injectDependenciesToExistingPools() external override onlySystemPoolsManager {
        IRegistry registry_ = _registry;

        address[] memory allPools_ = getAllPools();

        for (uint256 i = 0; i < allPools_.length; i++) {
            AbstractDependant(allPools_[i]).setDependencies(address(registry_));
        }
    }

    function injectDependencies(
        uint256 offset_,
        uint256 limit_
    ) external override onlySystemPoolsManager {
        IRegistry registry_ = _registry;

        address[] memory _pools = getPools(offset_, limit_);

        for (uint256 i = 0; i < _pools.length; i++) {
            AbstractDependant(_pools[i]).setDependencies(address(registry_));
        }
    }

    function getLiquidityPoolsInfo(
        bytes32[] calldata assetKeys_,
        bool withPRT_
    ) external view override returns (LiquidityPoolInfo[] memory poolsInfo_) {
        IAssetParameters assetParameters_ = _assetParameters;

        poolsInfo_ = new LiquidityPoolInfo[](assetKeys_.length);

        for (uint256 i = 0; i < assetKeys_.length; i++) {
            poolsInfo_[i] = _getLiquidityPoolInfo(
                assetKeys_[i],
                ILiquidityPool(poolsInfo[assetKeys_[i]].poolAddr),
                assetParameters_,
                withPRT_
            );
        }
    }

    function getStablePoolsInfo(
        bytes32[] calldata assetKeys_
    ) external view override returns (StablePoolInfo[] memory poolsInfo_) {
        poolsInfo_ = new StablePoolInfo[](assetKeys_.length);

        for (uint256 i = 0; i < assetKeys_.length; i++) {
            poolsInfo_[i] = StablePoolInfo(
                _getBasePoolInfo(assetKeys_[i], IBasicPool(poolsInfo[assetKeys_[i]].poolAddr))
            );
        }
    }

    function getDetailedLiquidityPoolInfo(
        bytes32 assetKey_,
        bool withPRT_
    ) external view override returns (DetailedLiquidityPoolInfo memory) {
        ILiquidityPool liquidityPool_ = ILiquidityPool(poolsInfo[assetKey_].poolAddr);
        IAssetParameters parameters_ = _assetParameters;

        IAssetParameters.MainPoolParams memory mainPoolParams_ = parameters_.getMainPoolParams(
            assetKey_
        );

        uint256 availableToBorrow_ = liquidityPool_.getAvailableToBorrowLiquidity();
        uint256 totalReserves_ = liquidityPool_.totalReserves();
        (uint256 distrSupplyAPY_, uint256 distrBorrowAPY_) = _rewardsDistribution.getAPY(
            assetKey_
        );

        return
            DetailedLiquidityPoolInfo(
                _getLiquidityPoolInfo(assetKey_, liquidityPool_, parameters_, withPRT_),
                mainPoolParams_,
                availableToBorrow_,
                liquidityPool_.getAmountInUSD(availableToBorrow_),
                totalReserves_,
                liquidityPool_.getAmountInUSD(totalReserves_),
                distrSupplyAPY_,
                distrBorrowAPY_
            );
    }

    function getRewardsLiquidityPool() external view override returns (address) {
        return poolsInfo[rewardsAssetKey].poolAddr;
    }

    function getPoolsBeacon(PoolType poolType_) external view override returns (address) {
        return _poolTypesInfo[poolType_].poolBeaconAddr;
    }

    function getPoolsImpl(PoolType poolType_) external view override returns (address) {
        return UpgradeableBeacon(_poolTypesInfo[poolType_].poolBeaconAddr).implementation();
    }

    function onlyExistingPool(bytes32 assetKey_) public view override returns (bool) {
        return poolsInfo[assetKey_].poolAddr != address(0);
    }

    function getAllSupportedAssetKeysCount() public view override returns (uint256) {
        return _allSupportedAssetKeys.length();
    }

    function getSupportedAssetKeysCountByType(
        PoolType poolType_
    ) public view override returns (uint256) {
        return _poolTypesInfo[poolType_].supportedAssetKeys.length();
    }

    function getAllSupportedAssetKeys() public view override returns (bytes32[] memory) {
        return _allSupportedAssetKeys.part(0, getAllSupportedAssetKeysCount());
    }

    function getAllSupportedAssetKeysByType(
        PoolType poolType_
    ) public view override returns (bytes32[] memory) {
        return
            getSupportedAssetKeysByType(poolType_, 0, getSupportedAssetKeysCountByType(poolType_));
    }

    function getSupportedAssetKeys(
        uint256 offset_,
        uint256 limit_
    ) public view override returns (bytes32[] memory) {
        return _allSupportedAssetKeys.part(offset_, limit_);
    }

    function getSupportedAssetKeysByType(
        PoolType poolType_,
        uint256 offset_,
        uint256 limit_
    ) public view override returns (bytes32[] memory) {
        return _poolTypesInfo[poolType_].supportedAssetKeys.part(offset_, limit_);
    }

    function getAllPools() public view override returns (address[] memory) {
        return _getPoolsAddresses(getAllSupportedAssetKeys());
    }

    function getAllPoolsByType(
        PoolType poolType_
    ) external view override returns (address[] memory) {
        return _getPoolsAddresses(getAllSupportedAssetKeysByType(poolType_));
    }

    function getPools(
        uint256 offset_,
        uint256 limit_
    ) public view override returns (address[] memory) {
        return _getPoolsAddresses(getSupportedAssetKeys(offset_, limit_));
    }

    function getPoolsByType(
        PoolType poolType_,
        uint256 offset_,
        uint256 limit_
    ) external view override returns (address[] memory) {
        return _getPoolsAddresses(getSupportedAssetKeysByType(poolType_, offset_, limit_));
    }

    function _onlySystemPoolsManager() internal {
        _roleManager.isSystemPoolsManager(msg.sender);
    }

    function _onlySystemPoolsReserveFundsManager() internal {
        _roleManager.isSystemPoolsReserveFundsManager(msg.sender);
    }

    function _addPool(
        address assetAddr_,
        bytes32 assetKey_,
        address chainlinkOracle_,
        string memory tokenSymbol_,
        bool isCollateral_,
        bool isCollateralWithPRT_,
        PoolType poolType_
    ) internal {
        require(assetKey_ > 0, "SystemPoolsRegistry: Unable to add an asset without a key.");
        require(
            assetAddr_ != address(0),
            "SystemPoolsRegistry: Unable to add an asset with a zero address."
        );
        require(
            !onlyExistingPool(assetKey_),
            "SystemPoolsRegistry: Liquidity pool with such a key already exists."
        );

        address poolAddr_;

        if (poolType_ == PoolType.LIQUIDITY_POOL) {
            poolAddr_ = _systemPoolsFactory.newLiquidityPool(assetAddr_, assetKey_, tokenSymbol_);
        } else {
            poolAddr_ = _systemPoolsFactory.newStablePool(assetAddr_, assetKey_);
        }

        _assetParameters.setPoolInitParams(assetKey_, isCollateral_, isCollateralWithPRT_);

        _allSupportedAssetKeys.add(assetKey_);
        _poolTypesInfo[poolType_].supportedAssetKeys.add(assetKey_);

        poolsInfo[assetKey_] = PoolInfo(poolAddr_, poolType_);
        existingLiquidityPools[poolAddr_] = true;

        _priceManager.addOracle(assetKey_, assetAddr_, chainlinkOracle_);

        emit PoolAdded(assetKey_, assetAddr_, poolAddr_, poolType_);
    }

    function _getLiquidityPoolInfo(
        bytes32 assetKey_,
        ILiquidityPool liquidityPool_,
        IAssetParameters parameters_,
        bool withPRT_
    ) internal view returns (LiquidityPoolInfo memory) {
        uint256 marketSize_ = liquidityPool_.getTotalLiquidity();
        (uint256 distrSupplyAPY_, ) = _rewardsDistribution.getAPY(assetKey_);

        return
            LiquidityPoolInfo(
                _getBasePoolInfo(assetKey_, liquidityPool_),
                liquidityPool_.getAPY(),
                distrSupplyAPY_,
                marketSize_,
                liquidityPool_.getAmountInUSD(marketSize_),
                liquidityPool_.getBorrowPercentage(),
                parameters_.isAvailableAsCollateral(assetKey_, withPRT_)
            );
    }

    function _getBasePoolInfo(
        bytes32 assetKey_,
        IBasicPool basicPool_
    ) internal view returns (BasePoolInfo memory) {
        uint256 _totalBorrowed = basicPool_.getTotalBorrowedAmount();
        (, uint256 _distrBorrowAPY) = _rewardsDistribution.getAPY(assetKey_);

        return
            BasePoolInfo(
                assetKey_,
                basicPool_.assetAddr(),
                basicPool_.getAnnualBorrowRate(),
                _distrBorrowAPY,
                _totalBorrowed,
                basicPool_.getAmountInUSD(_totalBorrowed)
            );
    }

    function _getPoolsAddresses(
        bytes32[] memory assetKeys_
    ) internal view returns (address[] memory _poolsArr) {
        _poolsArr = new address[](assetKeys_.length);

        for (uint256 i = 0; i < assetKeys_.length; i++) {
            _poolsArr[i] = poolsInfo[assetKeys_[i]].poolAddr;
        }
    }
}
