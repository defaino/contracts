// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "./interfaces/IAssetsRegistry.sol";
import "./interfaces/IAssetParameters.sol";
import "./interfaces/IAssetParameters.sol";
import "./interfaces/ILiquidityPool.sol";
import "./interfaces/IDefiCore.sol";
import "./interfaces/IRewardsDistribution.sol";
import "./interfaces/ILiquidityPoolRegistry.sol";

import "./libraries/AssetsHelperLibrary.sol";
import "./libraries/DecimalsConverter.sol";

import "./Registry.sol";
import "./abstract/AbstractDependant.sol";
import "./common/Globals.sol";

contract AssetsRegistry is IAssetsRegistry, AbstractDependant {
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using AssetsHelperLibrary for bytes32;
    using DecimalsConverter for uint256;

    mapping(address => EnumerableSet.Bytes32Set) internal _supplyAssets;
    mapping(address => EnumerableSet.Bytes32Set) internal _borrowAssets;

    mapping(address => EnumerableSet.Bytes32Set) internal _supplyIntegrationAssets;
    mapping(address => EnumerableSet.Bytes32Set) internal _borrowIntegrationAssets;

    IDefiCore private defiCore;
    IAssetParameters private assetParameters;
    IRewardsDistribution private rewardsDistribution;
    ILiquidityPoolRegistry private liquidityPoolRegistry;

    modifier onlyDefiCore() {
        require(address(defiCore) == msg.sender, "AssetsRegistry: Caller not a DefiCore.");
        _;
    }

    modifier onlyLiquidityPools() {
        require(
            liquidityPoolRegistry.existingLiquidityPools(msg.sender),
            "AssetsRegistry: Caller not a LiquidityPool."
        );
        _;
    }

    function setDependencies(Registry _registry) external override onlyInjectorOrZero {
        defiCore = IDefiCore(_registry.getDefiCoreContract());
        assetParameters = IAssetParameters(_registry.getAssetParametersContract());
        rewardsDistribution = IRewardsDistribution(_registry.getRewardsDistributionContract());
        liquidityPoolRegistry = ILiquidityPoolRegistry(
            _registry.getLiquidityPoolRegistryContract()
        );
    }

    function getUserSupplyAssets(address _userAddr)
        external
        view
        override
        returns (bytes32[] memory _userSupplyAssets)
    {
        _userSupplyAssets = _getUserAssets(_supplyAssets[_userAddr]);
    }

    function getUserBorrowAssets(address _userAddr)
        external
        view
        override
        returns (bytes32[] memory _userBorrowAssets)
    {
        _userBorrowAssets = _getUserAssets(_borrowAssets[_userAddr]);
    }

    function getSupplyAssets(address _userAddr)
        external
        view
        override
        returns (bytes32[] memory _availableAssets, bytes32[] memory _userSupplyAssets)
    {
        return
            _getAssets(liquidityPoolRegistry.getSupportedAssets(0, 100), _supplyAssets[_userAddr]);
    }

    function getBorrowAssets(address _userAddr)
        external
        view
        override
        returns (bytes32[] memory _availableAssets, bytes32[] memory _userBorrowAssets)
    {
        return
            _getAssets(liquidityPoolRegistry.getSupportedAssets(0, 100), _borrowAssets[_userAddr]);
    }

    function getSupplyAssetsInfo(bytes32[] calldata _assetsKeys, address _userAddr)
        external
        view
        override
        returns (SupplyAssetInfo[] memory)
    {
        return _getSupplyAssetsInfo(_assetsKeys, _userAddr, IDefiCore(address(defiCore)));
    }

    function getBorrowAssetsInfo(bytes32[] calldata _assetsKeys, address _userAddr)
        external
        view
        override
        returns (BorrowAssetInfo[] memory _resultArr)
    {
        ILiquidityPoolRegistry _poolRegistry = liquidityPoolRegistry;
        IRewardsDistribution _rewardsDistribution = rewardsDistribution;

        _resultArr = new BorrowAssetInfo[](_assetsKeys.length);

        for (uint256 i = 0; i < _assetsKeys.length; i++) {
            _resultArr[i] = _getBorrowAssetInfo(
                _assetsKeys[i],
                _userAddr,
                _poolRegistry,
                _rewardsDistribution,
                IDefiCore(address(defiCore))
            );
        }
    }

    function getAssetsInfo(
        bytes32[] calldata _assetsKeys,
        address _userAddr,
        bool _isSupply
    ) external view override returns (AssetInfo[] memory _resultArr) {
        IDefiCore _defiCore = defiCore;

        _resultArr = new AssetInfo[](_assetsKeys.length);

        for (uint256 i = 0; i < _assetsKeys.length; i++) {
            bytes32 _currentKey = _assetsKeys[i];

            ILiquidityPool _currentLiquidityPool = _currentKey.getAssetLiquidityPool(
                liquidityPoolRegistry
            );

            uint256 _userBalance = ERC20(_currentLiquidityPool.assetAddr())
                .balanceOf(_userAddr)
                .convertTo18(_currentLiquidityPool.getUnderlyingDecimals());

            _resultArr[i] = _getAssetInfo(
                _userAddr,
                _currentKey,
                _userBalance,
                _currentLiquidityPool,
                _defiCore,
                _isSupply
            );
        }
    }

    function updateAssetsAfterTransfer(
        bytes32 _assetKey,
        address _from,
        address _to,
        uint256 _amount
    ) external override onlyLiquidityPools {
        if (ERC20(msg.sender).balanceOf(_from) - _amount == 0) {
            _supplyAssets[_from].remove(_assetKey);
        }

        _supplyAssets[_to].add(_assetKey);
    }

    function updateUserAssets(
        address _userAddr,
        bytes32 _assetKey,
        bool _isSuply
    ) external override onlyDefiCore {
        IDefiCore _core = IDefiCore(defiCore);

        (bool _isRemove, EnumerableSet.Bytes32Set storage _userAssets) = _getUpdateInfo(
            _userAddr,
            _assetKey,
            _isSuply,
            true,
            _core
        );

        if (_isRemove) {
            _userAssets.remove(_assetKey);
        } else {
            _userAssets.add(_assetKey);
        }
    }

    function _getSupplyAssetsInfo(
        bytes32[] calldata _assetsKeys,
        address _userAddr,
        IDefiCore _core
    ) internal view returns (SupplyAssetInfo[] memory _resultArr) {
        IRewardsDistribution _rewardsDistribution = rewardsDistribution;
        IAssetParameters _parameters = assetParameters;
        ILiquidityPoolRegistry _poolsRegistry = liquidityPoolRegistry;

        _resultArr = new SupplyAssetInfo[](_assetsKeys.length);

        for (uint256 i = 0; i < _assetsKeys.length; i++) {
            bytes32 _currentKey = _assetsKeys[i];

            _resultArr[i] = _getSupplyAssetInfo(
                _currentKey,
                _userAddr,
                _currentKey.getAssetLiquidityPool(_poolsRegistry),
                _rewardsDistribution,
                _parameters,
                _core
            );
        }
    }

    function _getSupplyAssetInfo(
        bytes32 _assetKey,
        address _userAddr,
        ILiquidityPool _liquidityPool,
        IRewardsDistribution _rewardsDistribution,
        IAssetParameters _parameters,
        IDefiCore _core
    ) internal view returns (SupplyAssetInfo memory) {
        uint256 _userLiquidityAmount = _core.getUserLiquidityAmount(_userAddr, _assetKey);
        (uint256 _userDistributionAPY, ) = _rewardsDistribution.getAPY(_liquidityPool);

        return
            SupplyAssetInfo(
                _liquidityPool.assetAddr(),
                _liquidityPool.getAPY(),
                _userDistributionAPY,
                _liquidityPool.getAmountInUSD(_userLiquidityAmount),
                _userLiquidityAmount,
                MaxSupplyValues(
                    _core.getMaxToSupply(_userAddr, _assetKey),
                    _core.getMaxToWithdraw(_userAddr, _assetKey)
                ),
                _parameters.isAvailableAsCollateral(_assetKey),
                _core.isCollateralAssetEnabled(_userAddr, _assetKey)
            );
    }

    function _getBorrowAssetInfo(
        bytes32 _assetKey,
        address _userAddr,
        ILiquidityPoolRegistry _poolsRegistry,
        IRewardsDistribution _rewardsDistribution,
        IDefiCore _core
    ) internal view returns (BorrowAssetInfo memory) {
        ILiquidityPool _currentLiquidityPool = _assetKey.getAssetLiquidityPool(_poolsRegistry);

        uint256 _userBorrowedAmount = _core.getUserBorrowedAmount(_userAddr, _assetKey);
        (, uint256 _userDistributionAPY) = _rewardsDistribution.getAPY(_currentLiquidityPool);

        return
            BorrowAssetInfo(
                _currentLiquidityPool.assetAddr(),
                _currentLiquidityPool.getAnnualBorrowRate(),
                _userDistributionAPY,
                _currentLiquidityPool.getAmountInUSD(_userBorrowedAmount),
                _userBorrowedAmount,
                MaxBorrowValues(
                    _core.getMaxToBorrow(_userAddr, _assetKey),
                    _core.getMaxToRepay(_userAddr, _assetKey)
                ),
                _currentLiquidityPool.getBorrowPercentage()
            );
    }

    function _getAssetInfo(
        address _userAddr,
        bytes32 _assetKey,
        uint256 _userBalance,
        ILiquidityPool _liquidityPool,
        IDefiCore _core,
        bool _isSupply
    ) internal view returns (AssetInfo memory) {
        return
            AssetInfo(
                _liquidityPool.assetAddr(),
                _isSupply ? _liquidityPool.getAPY() : _liquidityPool.getAnnualBorrowRate(),
                _getCorrectApy(_isSupply, rewardsDistribution, _liquidityPool),
                _liquidityPool.getAmountInUSD(_userBalance),
                _userBalance,
                _liquidityPool.getAvailableToBorrowLiquidity(),
                _isSupply
                    ? _core.getMaxToSupply(_userAddr, _assetKey)
                    : _core.getMaxToBorrow(_userAddr, _assetKey),
                assetParameters.isAvailableAsCollateral(_assetKey),
                _core.isCollateralAssetEnabled(_userAddr, _assetKey)
            );
    }

    function _getAssets(
        bytes32[] memory _allAssets,
        EnumerableSet.Bytes32Set storage _currentUserAssets
    ) internal view returns (bytes32[] memory _availableAssets, bytes32[] memory _userAssets) {
        uint256 _allAssetsCount = _allAssets.length;
        uint256 _currentAssetsCount = _currentUserAssets.length();

        _userAssets = new bytes32[](_currentAssetsCount);
        _availableAssets = new bytes32[](_allAssetsCount - _currentAssetsCount);

        uint256 _userAssetsIndex;
        uint256 _availableAssetsIndex;

        for (uint256 i = 0; i < _allAssetsCount; i++) {
            bytes32 _currentKey = _allAssets[i];

            if (_currentUserAssets.contains(_currentKey)) {
                _userAssets[_userAssetsIndex++] = _currentKey;
            } else {
                _availableAssets[_availableAssetsIndex++] = _currentKey;
            }
        }
    }

    function _getUpdateInfo(
        address _userAddr,
        bytes32 _assetKey,
        bool _isSupply,
        bool _isDefiCore,
        IDefiCore _core
    ) internal view returns (bool, EnumerableSet.Bytes32Set storage) {
        bool _isRemove;
        EnumerableSet.Bytes32Set storage _userAssets;

        _isRemove = _core.getUserLiquidityAmount(_userAddr, _assetKey) == 0;

        if (_isDefiCore) {
            if (_isSupply) {
                _userAssets = _supplyAssets[_userAddr];
            } else {
                _userAssets = _borrowAssets[_userAddr];
            }
        } else {
            if (_isSupply) {
                _userAssets = _supplyIntegrationAssets[_userAddr];
            } else {
                _userAssets = _borrowIntegrationAssets[_userAddr];
            }
        }

        return (_isRemove, _userAssets);
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

    function _getCorrectApy(
        bool _isSupply,
        IRewardsDistribution _rewardsDistribution,
        ILiquidityPool _currentLiquidityPool
    ) internal view returns (uint256) {
        (uint256 _userSupplyAPY, uint256 _userBorrowAPY) = _rewardsDistribution.getAPY(
            _currentLiquidityPool
        );

        return _isSupply ? _userSupplyAPY : _userBorrowAPY;
    }
}
