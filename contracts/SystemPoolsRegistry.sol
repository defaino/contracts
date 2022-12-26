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

contract SystemPoolsRegistry is ISystemPoolsRegistry, Initializable, AbstractDependant {
    using Paginator for EnumerableSet.Bytes32Set;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using Math for uint256;

    address internal systemOwnerAddr;
    IRegistry internal registry;
    ISystemParameters internal systemParameters;
    IAssetParameters internal assetParameters;
    IDefiCore internal defiCore;
    IRewardsDistribution internal rewardsDistribution;
    ISystemPoolsFactory internal systemPoolsFactory;
    IPriceManager internal priceManager;

    bytes32 public override nativeAssetKey;
    bytes32 public override rewardsAssetKey;
    EnumerableSet.Bytes32Set internal allSupportedAssetKeys;

    mapping(PoolType => PoolTypeInfo) internal poolTypesInfo;
    mapping(bytes32 => PoolInfo) public override poolsInfo;
    mapping(address => bool) public override existingLiquidityPools;

    modifier onlySystemOwner() {
        require(
            msg.sender == systemOwnerAddr,
            "SystemPoolsRegistry: Only system owner can call this function."
        );
        _;
    }

    function systemPoolsRegistryInitialize(
        address _liquidityPoolImpl,
        bytes32 _nativeAssetKey,
        bytes32 _rewardsAssetKey
    ) external initializer {
        poolTypesInfo[PoolType.LIQUIDITY_POOL].poolBeaconAddr = address(
            new UpgradeableBeacon(_liquidityPoolImpl)
        );

        nativeAssetKey = _nativeAssetKey;
        rewardsAssetKey = _rewardsAssetKey;
    }

    function setDependencies(address _contractsRegistry) external override dependant {
        IRegistry _registry = IRegistry(_contractsRegistry);

        registry = _registry;
        systemOwnerAddr = _registry.getSystemOwner();
        systemParameters = ISystemParameters(_registry.getSystemParametersContract());
        assetParameters = IAssetParameters(_registry.getAssetParametersContract());
        defiCore = IDefiCore(_registry.getDefiCoreContract());
        priceManager = IPriceManager(_registry.getPriceManagerContract());
        rewardsDistribution = IRewardsDistribution(_registry.getRewardsDistributionContract());
        systemPoolsFactory = ISystemPoolsFactory(_registry.getSystemPoolsFactoryContract());
    }

    function updateRewardsAssetKey(bytes32 _newRewardsAssetKey) external onlySystemOwner {
        require(
            IBasicPool(poolsInfo[_newRewardsAssetKey].poolAddr).assetAddr() ==
                systemParameters.getRewardsTokenAddress(),
            "SystemPoolsRegistry: Incorrect new rewards asset key."
        );

        rewardsAssetKey = _newRewardsAssetKey;
    }

    function addPoolsBeacon(
        PoolType _poolType,
        address _poolImpl
    ) external override onlySystemOwner {
        PoolTypeInfo storage _poolTypeInfo = poolTypesInfo[_poolType];

        require(
            _poolTypeInfo.poolBeaconAddr == address(0),
            "SystemPoolsRegistry: Pools beacon for passed pool type already set."
        );

        _poolTypeInfo.poolBeaconAddr = address(new UpgradeableBeacon(_poolImpl));
    }

    function addLiquidityPool(
        address _assetAddr,
        bytes32 _assetKey,
        address _chainlinkOracle,
        string calldata _tokenSymbol,
        bool _isCollateral
    ) external override onlySystemOwner {
        _addPool(
            _assetAddr,
            _assetKey,
            _chainlinkOracle,
            _tokenSymbol,
            _isCollateral,
            PoolType.LIQUIDITY_POOL
        );
    }

    function addStablePool(
        address _assetAddr,
        bytes32 _assetKey,
        address _chainlinkOracle
    ) external override onlySystemOwner {
        require(
            systemParameters.getStablePoolsAvailability(),
            "SystemPoolsRegistry: Stable pools are unavailable."
        );

        _addPool(_assetAddr, _assetKey, _chainlinkOracle, "", true, PoolType.STABLE_POOL);
    }

    function withdrawReservedFunds(
        address _recipientAddr,
        bytes32 _assetKey,
        uint256 _amountToWithdraw,
        bool _isAllFunds
    ) external override onlySystemOwner {
        require(onlyExistingPool(_assetKey), "SystemPoolsRegistry: Pool doesn't exist.");

        if (!_isAllFunds) {
            require(
                _amountToWithdraw > 0,
                "SystemPoolsRegistry: Amount to withdraw must be greater than zero."
            );
        }

        IBasicPool(poolsInfo[_assetKey].poolAddr).withdrawReservedFunds(
            _recipientAddr,
            _amountToWithdraw,
            _isAllFunds
        );
    }

    function withdrawAllReservedFunds(
        address _recipientAddr,
        uint256 _offset,
        uint256 _limit
    ) external override onlySystemOwner {
        bytes32[] memory _assetsKeys = getSupportedAssetKeys(_offset, _limit);

        for (uint256 i = 0; i < _assetsKeys.length; i++) {
            IBasicPool(poolsInfo[_assetsKeys[i]].poolAddr).withdrawReservedFunds(
                _recipientAddr,
                0,
                true
            );
        }
    }

    function upgradePoolsImpl(
        PoolType _poolType,
        address _newPoolsImpl
    ) external override onlySystemOwner {
        address _poolBeacon = poolTypesInfo[_poolType].poolBeaconAddr;

        require(_poolBeacon != address(0), "SystemPoolsRegistry: Unsupported pool type.");

        UpgradeableBeacon(_poolBeacon).upgradeTo(_newPoolsImpl);
    }

    function injectDependenciesToExistingPools() external override onlySystemOwner {
        IRegistry _registry = registry;

        address[] memory _allPools = getAllPools();

        for (uint256 i = 0; i < _allPools.length; i++) {
            AbstractDependant(_allPools[i]).setDependencies(address(_registry));
        }
    }

    function injectDependencies(
        uint256 _offset,
        uint256 _limit
    ) external override onlySystemOwner {
        IRegistry _registry = registry;

        address[] memory _pools = getPools(_offset, _limit);

        for (uint256 i = 0; i < _pools.length; i++) {
            AbstractDependant(_pools[i]).setDependencies(address(_registry));
        }
    }

    function getLiquidityPoolsInfo(
        bytes32[] calldata _assetKeys
    ) external view override returns (LiquidityPoolInfo[] memory _poolsInfo) {
        IAssetParameters _assetParametrs = assetParameters;

        _poolsInfo = new LiquidityPoolInfo[](_assetKeys.length);

        for (uint256 i = 0; i < _assetKeys.length; i++) {
            _poolsInfo[i] = _getLiquidityPoolInfo(
                _assetKeys[i],
                ILiquidityPool(poolsInfo[_assetKeys[i]].poolAddr),
                _assetParametrs
            );
        }
    }

    function getStablePoolsInfo(
        bytes32[] calldata _assetKeys
    ) external view override returns (StablePoolInfo[] memory _poolsInfo) {
        _poolsInfo = new StablePoolInfo[](_assetKeys.length);

        for (uint256 i = 0; i < _assetKeys.length; i++) {
            _poolsInfo[i] = StablePoolInfo(
                _getBasePoolInfo(_assetKeys[i], IBasicPool(poolsInfo[_assetKeys[i]].poolAddr))
            );
        }
    }

    function getDetailedLiquidityPoolInfo(
        bytes32 _assetKey
    ) external view override returns (DetailedLiquidityPoolInfo memory) {
        ILiquidityPool _liquidityPool = ILiquidityPool(poolsInfo[_assetKey].poolAddr);
        IAssetParameters _parameters = assetParameters;

        IAssetParameters.MainPoolParams memory _mainPoolParams = _parameters.getMainPoolParams(
            _assetKey
        );

        uint256 _availableToBorrow = _liquidityPool.getAvailableToBorrowLiquidity();
        uint256 _totalReserves = _liquidityPool.totalReserves();
        (uint256 _distrSupplyAPY, uint256 _distrBorrowAPY) = rewardsDistribution.getAPY(_assetKey);

        return
            DetailedLiquidityPoolInfo(
                _getLiquidityPoolInfo(_assetKey, _liquidityPool, _parameters),
                _mainPoolParams,
                _availableToBorrow,
                _liquidityPool.getAmountInUSD(_availableToBorrow),
                _totalReserves,
                _liquidityPool.getAmountInUSD(_totalReserves),
                _distrSupplyAPY,
                _distrBorrowAPY
            );
    }

    function getRewardsLiquidityPool() external view override returns (address) {
        return poolsInfo[rewardsAssetKey].poolAddr;
    }

    function getPoolsBeacon(PoolType _poolType) external view override returns (address) {
        return poolTypesInfo[_poolType].poolBeaconAddr;
    }

    function getPoolsImpl(PoolType _poolType) external view override returns (address) {
        return UpgradeableBeacon(poolTypesInfo[_poolType].poolBeaconAddr).implementation();
    }

    function onlyExistingPool(bytes32 _assetKey) public view override returns (bool) {
        return poolsInfo[_assetKey].poolAddr != address(0);
    }

    function getAllSupportedAssetKeysCount()
        public
        view
        override
        returns (uint256 _allAsetsCount)
    {
        return allSupportedAssetKeys.length();
    }

    function getSupportedAssetKeysCountByType(
        PoolType _poolType
    ) public view override returns (uint256) {
        return poolTypesInfo[_poolType].supportedAssetKeys.length();
    }

    function getAllSupportedAssetKeys() public view override returns (bytes32[] memory) {
        return allSupportedAssetKeys.part(0, getAllSupportedAssetKeysCount());
    }

    function getAllSupportedAssetKeysByType(
        PoolType _poolType
    ) public view override returns (bytes32[] memory) {
        return
            getSupportedAssetKeysByType(_poolType, 0, getSupportedAssetKeysCountByType(_poolType));
    }

    function getSupportedAssetKeys(
        uint256 _offset,
        uint256 _limit
    ) public view override returns (bytes32[] memory) {
        return allSupportedAssetKeys.part(_offset, _limit);
    }

    function getSupportedAssetKeysByType(
        PoolType _poolType,
        uint256 _offset,
        uint256 _limit
    ) public view override returns (bytes32[] memory) {
        return poolTypesInfo[_poolType].supportedAssetKeys.part(_offset, _limit);
    }

    function getAllPools() public view override returns (address[] memory) {
        return _getPoolsAddresses(getAllSupportedAssetKeys());
    }

    function getAllPoolsByType(
        PoolType _poolType
    ) external view override returns (address[] memory) {
        return _getPoolsAddresses(getAllSupportedAssetKeysByType(_poolType));
    }

    function getPools(
        uint256 _offset,
        uint256 _limit
    ) public view override returns (address[] memory) {
        return _getPoolsAddresses(getSupportedAssetKeys(_offset, _limit));
    }

    function getPoolsByType(
        PoolType _poolType,
        uint256 _offset,
        uint256 _limit
    ) external view override returns (address[] memory) {
        return _getPoolsAddresses(getSupportedAssetKeysByType(_poolType, _offset, _limit));
    }

    function _addPool(
        address _assetAddr,
        bytes32 _assetKey,
        address _chainlinkOracle,
        string memory _tokenSymbol,
        bool _isCollateral,
        PoolType _poolType
    ) internal {
        require(_assetKey > 0, "SystemPoolsRegistry: Unable to add an asset without a key.");
        require(
            _assetAddr != address(0),
            "SystemPoolsRegistry: Unable to add an asset with a zero address."
        );
        require(
            !onlyExistingPool(_assetKey),
            "SystemPoolsRegistry: Liquidity pool with such a key already exists."
        );

        address _poolAddr;

        if (_poolType == PoolType.LIQUIDITY_POOL) {
            _poolAddr = systemPoolsFactory.newLiquidityPool(_assetAddr, _assetKey, _tokenSymbol);
        } else {
            _poolAddr = systemPoolsFactory.newStablePool(_assetAddr, _assetKey);
        }

        assetParameters.setPoolInitParams(_assetKey, _isCollateral);

        allSupportedAssetKeys.add(_assetKey);
        poolTypesInfo[_poolType].supportedAssetKeys.add(_assetKey);

        poolsInfo[_assetKey] = PoolInfo(_poolAddr, _poolType);
        existingLiquidityPools[_poolAddr] = true;

        priceManager.addOracle(_assetKey, _assetAddr, _chainlinkOracle);

        emit PoolAdded(_assetKey, _assetAddr, _poolAddr, _poolType);
    }

    function _getLiquidityPoolInfo(
        bytes32 _assetKey,
        ILiquidityPool _liquidityPool,
        IAssetParameters _parameters
    ) internal view returns (LiquidityPoolInfo memory) {
        uint256 _marketSize = _liquidityPool.getTotalLiquidity();
        (uint256 _distrSupplyAPY, ) = rewardsDistribution.getAPY(_assetKey);

        return
            LiquidityPoolInfo(
                _getBasePoolInfo(_assetKey, _liquidityPool),
                _liquidityPool.getAPY(),
                _distrSupplyAPY,
                _marketSize,
                _liquidityPool.getAmountInUSD(_marketSize),
                _liquidityPool.getBorrowPercentage(),
                _parameters.isAvailableAsCollateral(_assetKey)
            );
    }

    function _getBasePoolInfo(
        bytes32 _assetKey,
        IBasicPool _basicPool
    ) internal view returns (BasePoolInfo memory) {
        uint256 _totalBorrowed = _basicPool.getTotalBorrowedAmount();
        (, uint256 _distrBorrowAPY) = rewardsDistribution.getAPY(_assetKey);

        return
            BasePoolInfo(
                _assetKey,
                _basicPool.assetAddr(),
                _basicPool.getAnnualBorrowRate(),
                _distrBorrowAPY,
                _totalBorrowed,
                _basicPool.getAmountInUSD(_totalBorrowed)
            );
    }

    function _getPoolsAddresses(
        bytes32[] memory _assetKeys
    ) internal view returns (address[] memory _poolsArr) {
        _poolsArr = new address[](_assetKeys.length);

        for (uint256 i = 0; i < _assetKeys.length; i++) {
            _poolsArr[i] = poolsInfo[_assetKeys[i]].poolAddr;
        }
    }
}
