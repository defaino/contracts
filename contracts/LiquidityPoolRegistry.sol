// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

import "./interfaces/ILiquidityPoolRegistry.sol";
import "./interfaces/ILiquidityPool.sol";
import "./interfaces/IPriceManager.sol";
import "./interfaces/IRewardsDistribution.sol";
import "./interfaces/IAssetParameters.sol";

import "./LiquidityPoolFactory.sol";
import "./AssetParameters.sol";

contract LiquidityPoolRegistry is ILiquidityPoolRegistry, OwnableUpgradeable, AbstractDependant {
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using Math for uint256;

    Registry private registry;
    UpgradeableBeacon private liquidityPoolsBeacon;
    LiquidityPoolFactory private liquidityPoolFactory;
    IRewardsDistribution private rewardsDistribution;
    IAssetParameters private assetParameters;
    IPriceManager private priceManager;

    EnumerableSet.Bytes32Set private _supportedAssets;

    bytes32 public constant GOVERNANCE_TOKEN_KEY = bytes32("GTK");

    mapping(bytes32 => address) public override liquidityPools;
    mapping(address => bool) public override existingLiquidityPools;

    function liquidityPoolRegistryInitialize(address _liquidityPoolImpl) external initializer {
        __Ownable_init();

        liquidityPoolsBeacon = new UpgradeableBeacon(_liquidityPoolImpl);
    }

    function setDependencies(Registry _registry) external override onlyInjectorOrZero {
        registry = _registry;
        liquidityPoolFactory = LiquidityPoolFactory(_registry.getLiquidityPoolFactoryContract());
        assetParameters = IAssetParameters(_registry.getAssetParametersContract());
        priceManager = IPriceManager(_registry.getPriceManagerContract());
        rewardsDistribution = IRewardsDistribution(_registry.getRewardsDistributionContract());
    }

    function getLiquidityPoolsBeacon() external view override returns (address) {
        return address(liquidityPoolsBeacon);
    }

    function onlyExistingPool(bytes32 _assetKey) public view override returns (bool) {
        return liquidityPools[_assetKey] != address(0);
    }

    function getSupportedAssetsCount() external view override returns (uint256) {
        return _supportedAssets.length();
    }

    function getAllSupportedAssets() public view override returns (bytes32[] memory _resultArr) {
        uint256 _assetsCount = _supportedAssets.length();

        _resultArr = new bytes32[](_assetsCount);

        _resultArr = getSupportedAssets(0, _assetsCount);
    }

    function getAllLiquidityPools() public view override returns (address[] memory _resultArr) {
        uint256 _assetsCount = _supportedAssets.length();

        _resultArr = new address[](_assetsCount);

        _resultArr = getLiquidityPools(0, _assetsCount);
    }

    function getSupportedAssets(uint256 _offset, uint256 _limit)
        public
        view
        override
        returns (bytes32[] memory _resultArr)
    {
        uint256 _to = (_offset + _limit).min(_supportedAssets.length()).max(_offset);

        _resultArr = new bytes32[](_to - _offset);

        for (uint256 i = _offset; i < _to; i++) {
            _resultArr[i] = _supportedAssets.at(i);
        }
    }

    function getLiquidityPools(uint256 _offset, uint256 _limit)
        public
        view
        override
        returns (address[] memory _resultArr)
    {
        bytes32[] memory _assetKeys = getSupportedAssets(_offset, _limit);

        _resultArr = new address[](_assetKeys.length);

        for (uint256 i = 0; i < _assetKeys.length; i++) {
            _resultArr[i] = liquidityPools[_assetKeys[i]];
        }
    }

    function getGovernanceLiquidityPool() external view override returns (address) {
        return liquidityPools[GOVERNANCE_TOKEN_KEY];
    }

    function getTotalMarketsSize() external view override returns (uint256 _totalMarketsSize) {
        bytes32[] memory _assetsKeys = getAllSupportedAssets();

        for (uint256 i = 0; i < _assetsKeys.length; i++) {
            ILiquidityPool _liquidityPool = ILiquidityPool(liquidityPools[_assetsKeys[i]]);
            _totalMarketsSize += _liquidityPool.getAmountInUSD(_liquidityPool.getTotalLiquidity());
        }
    }

    function getLiquidityPoolsInfo(bytes32[] calldata _assetKeys)
        external
        view
        override
        returns (LiquidityPoolInfo[] memory _poolsInfo)
    {
        IAssetParameters _assetParametrs = assetParameters;

        _poolsInfo = new LiquidityPoolInfo[](_assetKeys.length);

        for (uint256 i = 0; i < _assetKeys.length; i++) {
            ILiquidityPool _currentLiquidityPool = ILiquidityPool(liquidityPools[_assetKeys[i]]);

            _poolsInfo[i] = _getLiquidityPoolInfo(
                _assetKeys[i],
                _currentLiquidityPool,
                _assetParametrs
            );
        }
    }

    function getDetailedLiquidityPoolInfo(bytes32 _assetKey)
        external
        view
        override
        returns (DetailedLiquidityPoolInfo memory)
    {
        ILiquidityPool _liquidityPool = ILiquidityPool(liquidityPools[_assetKey]);
        IAssetParameters _parameters = assetParameters;

        IAssetParameters.LiquidityPoolParams memory _liquidityPoolParams = _parameters
            .getLiquidityPoolParams(_assetKey);

        uint256 _availableToBorrow = _liquidityPool.getAvailableToBorrowLiquidity();
        uint256 _totalReserves = _liquidityPool.totalReserves();
        (uint256 _distrSupplyAPY, uint256 _distrBorrowAPY) = rewardsDistribution.getAPY(
            _liquidityPool
        );

        return
            DetailedLiquidityPoolInfo(
                _getLiquidityPoolInfo(_assetKey, _liquidityPool, _parameters),
                _liquidityPoolParams,
                _availableToBorrow,
                _liquidityPool.getAmountInUSD(_availableToBorrow),
                _totalReserves,
                _liquidityPool.getAmountInUSD(_totalReserves),
                _distrSupplyAPY,
                _distrBorrowAPY
            );
    }

    function addLiquidityPool(
        address _assetAddr,
        bytes32 _assetKey,
        address _mainOracle,
        address _backupOracle,
        string calldata _tokenSymbol,
        bool _isCollateral
    ) external onlyOwner {
        require(_assetKey > 0, "LiquidityPoolRegistry: Unable to add an asset without a key.");
        require(
            _assetAddr != address(0),
            "LiquidityPoolRegistry: Unable to add an asset with a zero address."
        );
        require(
            !onlyExistingPool(_assetKey),
            "LiquidityPoolRegistry: Liquidity pool with such a key already exists."
        );

        address _poolAddr = liquidityPoolFactory.newLiquidityPool(
            _assetAddr,
            _assetKey,
            _tokenSymbol
        );

        liquidityPools[_assetKey] = _poolAddr;

        _supportedAssets.add(_assetKey);

        assetParameters.addLiquidityPoolAssetInfo(_assetKey, _isCollateral);

        existingLiquidityPools[_poolAddr] = true;

        priceManager.addOracle(_assetKey, _assetAddr, _mainOracle, _backupOracle);

        emit PoolAdded(_assetKey, _assetAddr, _poolAddr);
    }

    function withdrawReservedFunds(
        address _recipientAddr,
        bytes32 _assetKey,
        uint256 _amountToWithdraw,
        bool _isAllFunds
    ) external onlyOwner {
        require(onlyExistingPool(_assetKey), "LiquidityPoolRegistry: Pool doesn't exist.");

        if (!_isAllFunds) {
            require(
                _amountToWithdraw > 0,
                "LiquidityPoolRegistry: Amount to withdraw must be greater than zero."
            );
        }

        ILiquidityPool(liquidityPools[_assetKey]).withdrawReservedFunds(
            _recipientAddr,
            _amountToWithdraw,
            _isAllFunds
        );
    }

    function withdrawAllReservedFunds(
        address _recipientAddr,
        uint256 _offset,
        uint256 _limit
    ) external onlyOwner {
        bytes32[] memory _assetsKeys = getSupportedAssets(_offset, _limit);

        for (uint256 i = 0; i < _assetsKeys.length; i++) {
            ILiquidityPool(liquidityPools[_assetsKeys[i]]).withdrawReservedFunds(
                _recipientAddr,
                0,
                true
            );
        }
    }

    function upgradeLiquidityPoolsImpl(address _newLiquidityPoolImpl) external onlyOwner {
        liquidityPoolsBeacon.upgradeTo(_newLiquidityPoolImpl);
    }

    function injectDependenciesToExistingLiquidityPools() external onlyOwner {
        Registry _registry = registry;

        address[] memory _liquidityPools = getAllLiquidityPools();

        for (uint256 i = 0; i < _liquidityPools.length; i++) {
            AbstractDependant dependant = AbstractDependant(_liquidityPools[i]);

            if (dependant.injector() == address(0)) {
                dependant.setInjector(address(this));
            }

            dependant.setDependencies(_registry);
        }
    }

    function injectDependencies(uint256 _offset, uint256 _limit) external onlyOwner {
        Registry _registry = registry;

        bytes32[] memory _assets = getSupportedAssets(_offset, _limit);

        for (uint256 i = 0; i < _assets.length; i++) {
            AbstractDependant dependant = AbstractDependant(liquidityPools[_assets[i]]);

            if (dependant.injector() == address(0)) {
                dependant.setInjector(address(this));
            }

            dependant.setDependencies(_registry);
        }
    }

    function _getLiquidityPoolInfo(
        bytes32 _assetKey,
        ILiquidityPool _liquidityPool,
        IAssetParameters _parameters
    ) internal view returns (LiquidityPoolInfo memory) {
        uint256 _marketSize = _liquidityPool.getTotalLiquidity();
        uint256 _totalBorrowed = _liquidityPool.getTotalBorrowedAmount();

        BaseInfo memory _baseInfo = BaseInfo(
            _assetKey,
            _liquidityPool.assetAddr(),
            _liquidityPool.getAPY(),
            _liquidityPool.getAnnualBorrowRate(),
            _liquidityPool.getBorrowPercentage(),
            _parameters.isAvailableAsCollateral(_assetKey)
        );

        return
            LiquidityPoolInfo(
                _baseInfo,
                _marketSize,
                _liquidityPool.getAmountInUSD(_marketSize),
                _totalBorrowed,
                _liquidityPool.getAmountInUSD(_totalBorrowed)
            );
    }
}
