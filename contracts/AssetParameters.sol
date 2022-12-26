// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";

import "@dlsl/dev-modules/contracts-registry/AbstractDependant.sol";

import "./interfaces/IRegistry.sol";
import "./interfaces/ISystemParameters.sol";
import "./interfaces/IAssetParameters.sol";
import "./interfaces/ISystemPoolsRegistry.sol";
import "./interfaces/IBasicPool.sol";
import "./interfaces/IPriceManager.sol";

import "./libraries/PureParameters.sol";

import "./common/Globals.sol";

contract AssetParameters is IAssetParameters, AbstractDependant {
    using PureParameters for PureParameters.Param;
    using MathUpgradeable for uint256;

    bytes32 public constant FREEZE_KEY = keccak256("FREEZE");
    bytes32 public constant ENABLE_COLLATERAL_KEY = keccak256("ENABLE_COLLATERAL");

    bytes32 public constant BASE_PERCENTAGE_KEY = keccak256("BASE_PERCENTAGE");
    bytes32 public constant FIRST_SLOPE_KEY = keccak256("FIRST_SLOPE");
    bytes32 public constant SECOND_SLOPE_KEY = keccak256("SECOND_SLOPE");
    bytes32 public constant UTILIZATION_BREAKING_POINT_KEY =
        keccak256("UTILIZATION_BREAKING_POINT");
    bytes32 public constant MAX_UTILIZATION_RATIO_KEY = keccak256("MAX_UTILIZATION_RATIO");
    bytes32 public constant LIQUIDATION_DISCOUNT_KEY = keccak256("LIQUIDATION_DISCOUNT");

    bytes32 public constant MIN_SUPPLY_DISTRIBUTION_PART_KEY =
        keccak256("MIN_SUPPLY_DISTRIBUTION_PART");
    bytes32 public constant MIN_BORROW_DISTRIBUTION_PART_KEY =
        keccak256("MIN_BORROW_DISTRIBUTION_PART");

    bytes32 public constant COL_RATIO_KEY = keccak256("COL_RATIO");
    bytes32 public constant RESERVE_FACTOR_KEY = keccak256("RESERVE_FACTOR");

    bytes32 public constant ANNUAL_BORROW_RATE_KEY = keccak256("ANNUAL_BORROW_RATE");

    address private systemOwnerAddr;
    ISystemParameters private systemParameters;
    ISystemPoolsRegistry private systemPoolsRegistry;
    IPriceManager private priceManager;

    mapping(bytes32 => mapping(bytes32 => PureParameters.Param)) private _parameters;

    modifier onlyExists(bytes32 _assetKey) {
        require(
            systemPoolsRegistry.onlyExistingPool(_assetKey),
            "AssetParameters: Asset doesn't exist."
        );
        _;
    }

    modifier onlySystemOwner() {
        require(
            msg.sender == systemOwnerAddr,
            "AssetParameters: Only system owner can call this function."
        );
        _;
    }

    function setDependencies(address _contractsRegistry) external override dependant {
        IRegistry _registry = IRegistry(_contractsRegistry);

        systemOwnerAddr = _registry.getSystemOwner();
        systemParameters = ISystemParameters(_registry.getSystemParametersContract());
        systemPoolsRegistry = ISystemPoolsRegistry(_registry.getSystemPoolsRegistryContract());
        priceManager = IPriceManager(_registry.getPriceManagerContract());
    }

    function setPoolInitParams(bytes32 _assetKey, bool _isCollateral) external override {
        require(
            address(systemPoolsRegistry) == msg.sender,
            "AssetParameters: Caller not a SystemPoolsRegistry."
        );

        _parameters[_assetKey][FREEZE_KEY] = PureParameters.makeBoolParam(false);
        emit FreezeParamUpdated(_assetKey, false);

        _parameters[_assetKey][ENABLE_COLLATERAL_KEY] = PureParameters.makeBoolParam(
            _isCollateral
        );
        emit CollateralParamUpdated(_assetKey, _isCollateral);
    }

    function setupAnnualBorrowRate(
        bytes32 _assetKey,
        uint256 _newAnnualBorrowRate
    ) external override onlySystemOwner onlyExists(_assetKey) {
        require(
            systemParameters.getStablePoolsAvailability(),
            "AssetParameters: Stable pools unavailable."
        );
        (address _poolAddr, ISystemPoolsRegistry.PoolType _poolType) = systemPoolsRegistry
            .poolsInfo(_assetKey);

        require(
            _poolType == ISystemPoolsRegistry.PoolType.STABLE_POOL,
            "AssetParameters: Incorrect pool type."
        );

        require(
            _newAnnualBorrowRate <= PRECISION * 25,
            "AssetParameters: Annual borrow rate is higher than possible."
        );

        if (PureParameters.paramExists(_parameters[_assetKey][ANNUAL_BORROW_RATE_KEY])) {
            IBasicPool(_poolAddr).updateCompoundRate(false);
        }

        _parameters[_assetKey][ANNUAL_BORROW_RATE_KEY] = PureParameters.makeUintParam(
            _newAnnualBorrowRate
        );

        emit AnnualBorrowRateUpdated(_assetKey, _newAnnualBorrowRate);
    }

    function setupMainParameters(
        bytes32 _assetKey,
        MainPoolParams calldata _mainParams
    ) external override onlySystemOwner onlyExists(_assetKey) {
        _setupMainParameters(_assetKey, _mainParams);
    }

    function setupInterestRateModel(
        bytes32 _assetKey,
        InterestRateParams calldata _interestParams
    ) external override onlySystemOwner onlyExists(_assetKey) {
        _setupInterestRateParams(_assetKey, _interestParams);
    }

    function setupDistributionsMinimums(
        bytes32 _assetKey,
        DistributionMinimums calldata _distrMinimums
    ) external override onlySystemOwner onlyExists(_assetKey) {
        _setupDistributionsMinimums(_assetKey, _distrMinimums);
    }

    function setupAllParameters(
        bytes32 _assetKey,
        AllPoolParams calldata _poolParams
    ) external override onlySystemOwner onlyExists(_assetKey) {
        _setupInterestRateParams(_assetKey, _poolParams.interestRateParams);
        _setupMainParameters(_assetKey, _poolParams.mainParams);
        _setupDistributionsMinimums(_assetKey, _poolParams.distrMinimums);
    }

    function freeze(bytes32 _assetKey) external override onlySystemOwner onlyExists(_assetKey) {
        _parameters[_assetKey][FREEZE_KEY] = PureParameters.makeBoolParam(true);

        emit FreezeParamUpdated(_assetKey, true);
    }

    function enableCollateral(
        bytes32 _assetKey
    ) external override onlySystemOwner onlyExists(_assetKey) {
        _parameters[_assetKey][ENABLE_COLLATERAL_KEY] = PureParameters.makeBoolParam(true);

        emit CollateralParamUpdated(_assetKey, true);
    }

    function isPoolFrozen(bytes32 _assetKey) external view override returns (bool) {
        return _getParam(_assetKey, FREEZE_KEY).getBoolFromParam();
    }

    function isAvailableAsCollateral(bytes32 _assetKey) external view override returns (bool) {
        return _getParam(_assetKey, ENABLE_COLLATERAL_KEY).getBoolFromParam();
    }

    function getAnnualBorrowRate(bytes32 _assetKey) external view override returns (uint256) {
        return _getParam(_assetKey, ANNUAL_BORROW_RATE_KEY).getUintFromParam();
    }

    function getMainPoolParams(
        bytes32 _assetKey
    ) external view override returns (MainPoolParams memory) {
        return
            MainPoolParams(
                _getParam(_assetKey, COL_RATIO_KEY).getUintFromParam(),
                _getParam(_assetKey, RESERVE_FACTOR_KEY).getUintFromParam(),
                _getParam(_assetKey, LIQUIDATION_DISCOUNT_KEY).getUintFromParam(),
                _getParam(_assetKey, MAX_UTILIZATION_RATIO_KEY).getUintFromParam()
            );
    }

    function getInterestRateParams(
        bytes32 _assetKey
    ) external view override returns (InterestRateParams memory) {
        return
            InterestRateParams(
                _getParam(_assetKey, BASE_PERCENTAGE_KEY).getUintFromParam(),
                _getParam(_assetKey, FIRST_SLOPE_KEY).getUintFromParam(),
                _getParam(_assetKey, SECOND_SLOPE_KEY).getUintFromParam(),
                _getParam(_assetKey, UTILIZATION_BREAKING_POINT_KEY).getUintFromParam()
            );
    }

    function getDistributionMinimums(
        bytes32 _assetKey
    ) external view override returns (DistributionMinimums memory) {
        return
            DistributionMinimums(
                _getParam(_assetKey, MIN_SUPPLY_DISTRIBUTION_PART_KEY).getUintFromParam(),
                _getParam(_assetKey, MIN_BORROW_DISTRIBUTION_PART_KEY).getUintFromParam()
            );
    }

    function getColRatio(bytes32 _assetKey) external view override returns (uint256) {
        return _getParam(_assetKey, COL_RATIO_KEY).getUintFromParam();
    }

    function getReserveFactor(bytes32 _assetKey) external view override returns (uint256) {
        return _getParam(_assetKey, RESERVE_FACTOR_KEY).getUintFromParam();
    }

    function getLiquidationDiscount(bytes32 _assetKey) external view override returns (uint256) {
        return _getParam(_assetKey, LIQUIDATION_DISCOUNT_KEY).getUintFromParam();
    }

    function getMaxUtilizationRatio(bytes32 _assetKey) external view override returns (uint256) {
        return _getParam(_assetKey, MAX_UTILIZATION_RATIO_KEY).getUintFromParam();
    }

    function _setupInterestRateParams(
        bytes32 _assetKey,
        InterestRateParams calldata _interestParams
    ) internal {
        require(
            _interestParams.basePercentage <= PRECISION * 3,
            "AssetParameters: The new value of the base percentage is invalid."
        );
        require(
            _interestParams.firstSlope >= PRECISION * 3 &&
                _interestParams.firstSlope <= PRECISION * 20,
            "AssetParameters: The new value of the first slope is invalid."
        );
        require(
            _interestParams.secondSlope >= PRECISION * 50 &&
                _interestParams.secondSlope <= PERCENTAGE_100,
            "AssetParameters: The new value of the second slope is invalid."
        );
        require(
            _interestParams.utilizationBreakingPoint >= PRECISION * 60 &&
                _interestParams.utilizationBreakingPoint <= PRECISION * 90,
            "AssetParameters: The new value of the utilization breaking point is invalid."
        );

        _parameters[_assetKey][BASE_PERCENTAGE_KEY] = PureParameters.makeUintParam(
            _interestParams.basePercentage
        );
        _parameters[_assetKey][FIRST_SLOPE_KEY] = PureParameters.makeUintParam(
            _interestParams.firstSlope
        );
        _parameters[_assetKey][SECOND_SLOPE_KEY] = PureParameters.makeUintParam(
            _interestParams.secondSlope
        );
        _parameters[_assetKey][UTILIZATION_BREAKING_POINT_KEY] = PureParameters.makeUintParam(
            _interestParams.utilizationBreakingPoint
        );

        emit InterestRateParamsUpdated(
            _assetKey,
            _interestParams.basePercentage,
            _interestParams.firstSlope,
            _interestParams.secondSlope,
            _interestParams.utilizationBreakingPoint
        );
    }

    function _setupMainParameters(
        bytes32 _assetKey,
        MainPoolParams calldata _mainParams
    ) internal {
        require(
            _mainParams.collateralizationRatio >= PRECISION * 111 &&
                _mainParams.collateralizationRatio <= PRECISION * 200,
            "AssetParameters: The new value of the collateralization ratio is invalid."
        );
        require(
            _mainParams.reserveFactor >= PRECISION * 10 &&
                _mainParams.reserveFactor <= PRECISION * 35,
            "AssetParameters: The new value of the reserve factor is invalid."
        );
        require(
            _mainParams.liquidationDiscount <= PRECISION * 10,
            "AssetParameters: The new value of the liquidation discount is invalid."
        );
        require(
            _mainParams.maxUtilizationRatio >= PRECISION * 94 &&
                _mainParams.maxUtilizationRatio <= PRECISION * 97,
            "AssetParameters: The new value of the max utilization ratio is invalid."
        );

        _parameters[_assetKey][COL_RATIO_KEY] = PureParameters.makeUintParam(
            _mainParams.collateralizationRatio
        );
        _parameters[_assetKey][RESERVE_FACTOR_KEY] = PureParameters.makeUintParam(
            _mainParams.reserveFactor
        );
        _parameters[_assetKey][LIQUIDATION_DISCOUNT_KEY] = PureParameters.makeUintParam(
            _mainParams.liquidationDiscount
        );
        _parameters[_assetKey][MAX_UTILIZATION_RATIO_KEY] = PureParameters.makeUintParam(
            _mainParams.maxUtilizationRatio
        );

        emit MainParamsUpdated(
            _assetKey,
            _mainParams.collateralizationRatio,
            _mainParams.reserveFactor,
            _mainParams.liquidationDiscount,
            _mainParams.maxUtilizationRatio
        );
    }

    function _setupDistributionsMinimums(
        bytes32 _assetKey,
        DistributionMinimums calldata _distrMinimums
    ) internal {
        require(
            _distrMinimums.minSupplyDistrPart >= PRECISION * 5 &&
                _distrMinimums.minSupplyDistrPart <= PRECISION * 15,
            "AssetParameters: The new value of the minimum supply part is invalid."
        );
        require(
            _distrMinimums.minBorrowDistrPart >= PRECISION * 5 &&
                _distrMinimums.minBorrowDistrPart <= PRECISION * 15,
            "AssetParameters: The new value of the minimum borrow part is invalid."
        );

        _parameters[_assetKey][MIN_SUPPLY_DISTRIBUTION_PART_KEY] = PureParameters.makeUintParam(
            _distrMinimums.minSupplyDistrPart
        );
        _parameters[_assetKey][MIN_BORROW_DISTRIBUTION_PART_KEY] = PureParameters.makeUintParam(
            _distrMinimums.minBorrowDistrPart
        );

        emit DistributionMinimumsUpdated(
            _assetKey,
            _distrMinimums.minSupplyDistrPart,
            _distrMinimums.minBorrowDistrPart
        );
    }

    function _getParam(
        bytes32 _assetKey,
        bytes32 _paramKey
    ) internal view returns (PureParameters.Param memory) {
        require(
            PureParameters.paramExists(_parameters[_assetKey][_paramKey]),
            "AssetParameters: Param for this asset doesn't exist."
        );

        return _parameters[_assetKey][_paramKey];
    }
}
