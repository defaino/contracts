// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./interfaces/ILiquidityPoolRegistry.sol";
import "./interfaces/IAssetParameters.sol";
import "./interfaces/IPriceManager.sol";

import "./libraries/PureParameters.sol";
import "./libraries/DecimalsConverter.sol";

import "./common/Globals.sol";
import "./common/AbstractDependant.sol";

contract AssetParameters is IAssetParameters, OwnableUpgradeable, AbstractDependant {
    using PureParameters for PureParameters.Param;
    using MathUpgradeable for uint256;
    using DecimalsConverter for uint256;

    ILiquidityPoolRegistry private liquidityPoolRegistry;
    IPriceManager private priceManager;

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

    mapping(bytes32 => mapping(bytes32 => PureParameters.Param)) private _parameters;

    event InterestRateParamsUpdated(
        bytes32 _assetKey,
        uint256 _basePercentage,
        uint256 _firstSlope,
        uint256 _secondSlope,
        uint256 _utilizationBreakingPoint
    );
    event MainParamsUpdated(
        bytes32 _assetKey,
        uint256 _colRatio,
        uint256 _reserveFactor,
        uint256 _liquidationDiscount,
        uint256 _maxUR
    );
    event IntegrationParamsUpdated(
        bytes32 _assetKey,
        uint256 _integrationColRatio,
        uint256 _optimizationReward,
        bool _allowForIntegration
    );
    event DistributionMinimumsUpdated(
        bytes32 _assetKey,
        uint256 _supplyDistrPart,
        uint256 _borrowDistrPart
    );

    modifier onlyExists(bytes32 _assetKey) {
        require(
            liquidityPoolRegistry.onlyExistingPool(_assetKey),
            "AssetParameters: Asset doesn't exist."
        );
        _;
    }

    modifier onlyLiquidityPoolRegistry() {
        require(
            address(liquidityPoolRegistry) == msg.sender,
            "PriceManager: Caller not an LiquidityPoolRegistry."
        );
        _;
    }

    function assetParametersInitialize() external initializer {
        __Ownable_init();
    }

    function setDependencies(Registry _registry) external override onlyInjectorOrZero {
        liquidityPoolRegistry = ILiquidityPoolRegistry(
            _registry.getLiquidityPoolRegistryContract()
        );
        priceManager = IPriceManager(_registry.getPriceManagerContract());
    }

    function isPoolFrozen(bytes32 _assetKey) external view override returns (bool) {
        return _getParam(_assetKey, FREEZE_KEY).getBoolFromParam();
    }

    function isAvailableAsCollateral(bytes32 _assetKey) external view override returns (bool) {
        return _getParam(_assetKey, ENABLE_COLLATERAL_KEY).getBoolFromParam();
    }

    function getInterestRateParams(bytes32 _assetKey)
        external
        view
        override
        returns (InterestRateParams memory _params)
    {
        _params = InterestRateParams(
            _getParam(_assetKey, BASE_PERCENTAGE_KEY).getUintFromParam(),
            _getParam(_assetKey, FIRST_SLOPE_KEY).getUintFromParam(),
            _getParam(_assetKey, SECOND_SLOPE_KEY).getUintFromParam(),
            _getParam(_assetKey, UTILIZATION_BREAKING_POINT_KEY).getUintFromParam()
        );
    }

    function getMaxUtilizationRatio(bytes32 _assetKey) external view override returns (uint256) {
        return _getParam(_assetKey, MAX_UTILIZATION_RATIO_KEY).getUintFromParam();
    }

    function getLiquidationDiscount(bytes32 _assetKey) external view override returns (uint256) {
        return _getParam(_assetKey, LIQUIDATION_DISCOUNT_KEY).getUintFromParam();
    }

    function getDistributionMinimums(bytes32 _assetKey)
        external
        view
        override
        returns (uint256 _minSupplyPart, uint256 _minBorrowPart)
    {
        _minSupplyPart = _getParam(_assetKey, MIN_SUPPLY_DISTRIBUTION_PART_KEY).getUintFromParam();
        _minBorrowPart = _getParam(_assetKey, MIN_BORROW_DISTRIBUTION_PART_KEY).getUintFromParam();
    }

    function getColRatio(bytes32 _assetKey) external view override returns (uint256) {
        return _getParam(_assetKey, COL_RATIO_KEY).getUintFromParam();
    }

    function getReserveFactor(bytes32 _assetKey) external view override returns (uint256) {
        return _getParam(_assetKey, RESERVE_FACTOR_KEY).getUintFromParam();
    }

    function getAssetPrice(bytes32 _assetKey, uint8 _assetDecimals)
        external
        view
        override
        returns (uint256)
    {
        (uint256 _price, uint8 _currentPriceDecimals) = priceManager.getPrice(
            _assetKey,
            _assetDecimals
        );

        return _price.convert(_currentPriceDecimals, PRICE_DECIMALS);
    }

    function getLiquidityPoolParams(bytes32 _assetKey)
        external
        view
        override
        returns (LiquidityPoolParams memory)
    {
        return
            LiquidityPoolParams(
                _getParam(_assetKey, COL_RATIO_KEY).getUintFromParam(),
                _getParam(_assetKey, RESERVE_FACTOR_KEY).getUintFromParam(),
                _getParam(_assetKey, LIQUIDATION_DISCOUNT_KEY).getUintFromParam(),
                _getParam(_assetKey, MAX_UTILIZATION_RATIO_KEY).getUintFromParam(),
                _getParam(_assetKey, ENABLE_COLLATERAL_KEY).getBoolFromParam()
            );
    }

    function addLiquidityPoolAssetInfo(bytes32 _assetKey, bool _isCollateral)
        external
        override
        onlyLiquidityPoolRegistry
    {
        _parameters[_assetKey][FREEZE_KEY] = PureParameters.makeBoolParam(false);
        emit BoolParamUpdated(_assetKey, FREEZE_KEY, false);

        _parameters[_assetKey][ENABLE_COLLATERAL_KEY] = PureParameters.makeBoolParam(
            _isCollateral
        );
        emit BoolParamUpdated(_assetKey, ENABLE_COLLATERAL_KEY, _isCollateral);
    }

    function freeze(bytes32 _assetKey) external onlyOwner onlyExists(_assetKey) {
        _parameters[_assetKey][FREEZE_KEY] = PureParameters.makeBoolParam(true);

        emit BoolParamUpdated(_assetKey, FREEZE_KEY, true);
    }

    function enableCollateral(bytes32 _assetKey) external onlyOwner onlyExists(_assetKey) {
        _parameters[_assetKey][ENABLE_COLLATERAL_KEY] = PureParameters.makeBoolParam(true);

        emit BoolParamUpdated(_assetKey, ENABLE_COLLATERAL_KEY, true);
    }

    function setupInterestRateModel(bytes32 _assetKey, InterestRateParams calldata _interestParams)
        public
        onlyOwner
        onlyExists(_assetKey)
    {
        _setupInterestRateParams(_assetKey, _interestParams);
    }

    function setupMainParameters(bytes32 _assetKey, MainPoolParams calldata _mainParams)
        public
        onlyOwner
        onlyExists(_assetKey)
    {
        _setupMainParameters(_assetKey, _mainParams);
    }

    function setupDistributionsMinimums(
        bytes32 _assetKey,
        DistributionMinimums calldata _distrMinimums
    ) public onlyOwner onlyExists(_assetKey) {
        _setupDistributionsMinimums(_assetKey, _distrMinimums);
    }

    function setupAllParameters(bytes32 _assetKey, AllPoolParams calldata _poolParams)
        external
        onlyOwner
        onlyExists(_assetKey)
    {
        _setupInterestRateParams(_assetKey, _poolParams.interestRateParams);
        _setupMainParameters(_assetKey, _poolParams.mainParams);
        _setupDistributionsMinimums(_assetKey, _poolParams.distrMinimums);
    }

    function _setupInterestRateParams(
        bytes32 _assetKey,
        InterestRateParams calldata _interestParams
    ) internal {
        require(
            _interestParams.basePercentage <= ONE_PERCENT * 3,
            "AssetParameters: The new value of the base percentage is invalid."
        );
        require(
            _interestParams.firstSlope >= ONE_PERCENT * 3 &&
                _interestParams.firstSlope <= ONE_PERCENT * 20,
            "AssetParameters: The new value of the first slope is invalid."
        );
        require(
            _interestParams.secondSlope >= ONE_PERCENT * 50 &&
                _interestParams.secondSlope <= DECIMAL,
            "AssetParameters: The new value of the second slope is invalid."
        );
        require(
            _interestParams.utilizationBreakingPoint >= ONE_PERCENT * 60 &&
                _interestParams.utilizationBreakingPoint <= ONE_PERCENT * 90,
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

    function _setupMainParameters(bytes32 _assetKey, MainPoolParams calldata _mainParams)
        internal
    {
        require(
            _mainParams.collateralizationRatio >= ONE_PERCENT * 111 &&
                _mainParams.collateralizationRatio <= ONE_PERCENT * 200,
            "AssetParameters: The new value of the collateralization ratio is invalid."
        );
        require(
            _mainParams.reserveFactor >= ONE_PERCENT * 10 &&
                _mainParams.reserveFactor <= ONE_PERCENT * 20,
            "AssetParameters: The new value of the reserve factor is invalid."
        );
        require(
            _mainParams.liquidationDiscount <= ONE_PERCENT * 10,
            "AssetParameters: The new value of the liquidation discount is invalid."
        );
        require(
            _mainParams.maxUtilizationRatio >= ONE_PERCENT * 94 &&
                _mainParams.maxUtilizationRatio <= ONE_PERCENT * 97,
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
            _distrMinimums.minSupplyDistrPart >= ONE_PERCENT * 5 &&
                _distrMinimums.minSupplyDistrPart <= ONE_PERCENT * 15,
            "AssetParameters: The new value of the minimum supply part is invalid."
        );
        require(
            _distrMinimums.minBorrowDistrPart >= ONE_PERCENT * 5 &&
                _distrMinimums.minBorrowDistrPart <= ONE_PERCENT * 15,
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

    function _getParam(bytes32 _assetKey, bytes32 _paramKey)
        internal
        view
        returns (PureParameters.Param memory)
    {
        require(
            PureParameters.paramExists(_parameters[_assetKey][_paramKey]),
            "AssetParameters: Param for this asset doesn't exist."
        );

        return _parameters[_assetKey][_paramKey];
    }
}
