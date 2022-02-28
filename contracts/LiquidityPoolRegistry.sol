// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

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

    LiquidityPoolFactory private liquidityPoolFactory;
    IRewardsDistribution private rewardsDistribution;
    IAssetParameters private assetParameters;
    IPriceManager private priceManager;

    EnumerableSet.Bytes32Set private _supportedAssets;

    bytes32 public constant GOVERNANCE_TOKEN_KEY = bytes32("NDG");

    mapping(bytes32 => address) public override liquidityPools;
    mapping(address => bool) public override existingLiquidityPools;

    function liquidityPoolRegistryInitialize() external initializer {
        __Ownable_init();
    }

    function setDependencies(Registry _registry) external override onlyInjectorOrZero {
        liquidityPoolFactory = LiquidityPoolFactory(_registry.getLiquidityPoolFactoryContract());
        assetParameters = IAssetParameters(_registry.getAssetParametersContract());
        priceManager = IPriceManager(_registry.getPriceManagerContract());
        rewardsDistribution = IRewardsDistribution(_registry.getRewardsDistributionContract());
    }

    function onlyExistingPool(bytes32 _assetKey) public view override returns (bool) {
        return liquidityPools[_assetKey] != address(0);
    }

    function getAllSupportedAssets() public view override returns (bytes32[] memory _resultArr) {
        uint256 _assetsCount = _supportedAssets.length();

        _resultArr = new bytes32[](_assetsCount);

        _resultArr = getSupportedAssets(0, _assetsCount);
    }

    function getAllLiquidityPools() external view override returns (address[] memory _resultArr) {
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

    function getAllowForIntegrationAssets()
        external
        view
        override
        returns (bytes32[] memory _resultArr, uint256 _assetsCount)
    {
        IAssetParameters _parameters = assetParameters;
        uint256 _allAssetsCount = _supportedAssets.length();

        _resultArr = new bytes32[](_allAssetsCount);

        uint256 _currentIndex;

        for (uint256 i = 0; i < _allAssetsCount; i++) {
            bytes32 _currentAssetKey = _supportedAssets.at(i);

            if (_parameters.isAllowForIntegration(_currentAssetKey)) {
                _resultArr[_currentIndex++] = _currentAssetKey;
            }
        }

        if (_currentIndex > 0) {
            _assetsCount = _currentIndex;
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

    function getLiquidityPoolsInfo(uint256 _offset, uint256 _limit)
        external
        view
        override
        returns (LiquidityPoolInfo[] memory _resultArr)
    {
        IRewardsDistribution _rewardsDistributon = rewardsDistribution;

        bytes32[] memory _assetsKeys = getSupportedAssets(_offset, _limit);
        _resultArr = new LiquidityPoolInfo[](_assetsKeys.length);

        for (uint256 i = 0; i < _assetsKeys.length; i++) {
            bytes32 _currentKey = _assetsKeys[i];
            ILiquidityPool _currentLiquidityPool = ILiquidityPool(liquidityPools[_currentKey]);

            uint256 _marketSize = _currentLiquidityPool.getTotalLiquidity();
            uint256 _totalBorrowed = _currentLiquidityPool.getTotalBorrowedAmount();

            (uint256 _distrSupplyAPY, uint256 _distrBorrowAPY) = _rewardsDistributon.getAPY(
                _currentLiquidityPool
            );

            PoolAPYInfo memory _poolAPYInfo = PoolAPYInfo(
                _currentLiquidityPool.getAPY(),
                _currentLiquidityPool.getAnnualBorrowRate(),
                _distrSupplyAPY,
                _distrBorrowAPY
            );

            _resultArr[i] = LiquidityPoolInfo(
                _currentKey,
                _currentLiquidityPool.assetAddr(),
                _marketSize,
                _currentLiquidityPool.getAmountInUSD(_marketSize),
                _totalBorrowed,
                _currentLiquidityPool.getAmountInUSD(_totalBorrowed),
                _poolAPYInfo
            );
        }
    }

    function getDetailedLiquidityPoolInfo(bytes32 _assetKey)
        external
        view
        override
        returns (DetailedLiquidityPoolInfo memory)
    {
        ILiquidityPool _currentLiquidityPool = ILiquidityPool(liquidityPools[_assetKey]);
        IAssetParameters _parameters = assetParameters;

        uint256 _totalBorrowed = _currentLiquidityPool.getTotalBorrowedAmount();

        (uint256 _distrSupplyAPY, uint256 _distrBorrowAPY) = rewardsDistribution.getAPY(
            _currentLiquidityPool
        );

        IAssetParameters.LiquidityPoolParams memory _liquidityPoolParams = _parameters
            .getLiquidityPoolParams(_assetKey);

        PoolAPYInfo memory _poolAPYInfo = PoolAPYInfo(
            _currentLiquidityPool.getAPY(),
            _currentLiquidityPool.getAnnualBorrowRate(),
            _distrSupplyAPY,
            _distrBorrowAPY
        );

        return
            DetailedLiquidityPoolInfo(
                _currentLiquidityPool.getAmountInUSD(_totalBorrowed),
                _currentLiquidityPool.getAmountInUSD(
                    _currentLiquidityPool.getAvailableToBorrowLiquidity()
                ),
                _currentLiquidityPool.getBorrowPercentage(),
                _liquidityPoolParams,
                _poolAPYInfo
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
}
