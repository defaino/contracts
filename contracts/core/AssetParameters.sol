// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";

import "@solarity/solidity-lib/contracts-registry/AbstractDependant.sol";

import "../interfaces/IRegistry.sol";
import "../interfaces/ISystemParameters.sol";
import "../interfaces/IAssetParameters.sol";
import "../interfaces/ISystemPoolsRegistry.sol";
import "../interfaces/IBasicPool.sol";
import "../interfaces/IPriceManager.sol";

import "../libraries/PureParameters.sol";

import "../common/Globals.sol";

contract AssetParameters is IAssetParameters, AbstractDependant {
    using PureParameters for PureParameters.Param;
    using MathUpgradeable for uint256;

    bytes32 public constant FREEZE_KEY = keccak256("FREEZE");

    bytes32 public constant ENABLE_COLLATERAL_KEY = keccak256("ENABLE_COLLATERAL");
    bytes32 public constant ENABLE_COLLATERAL_WITH_PRT_KEY =
        keccak256("ENABLE_COLLATERAL_WITH_PRT");

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
    bytes32 public constant COL_RATIO_WITH_PRT_KEY = keccak256("COL_RATIO_WITH_PRT");

    bytes32 public constant RESERVE_FACTOR_KEY = keccak256("RESERVE_FACTOR");

    bytes32 public constant ANNUAL_BORROW_RATE_KEY = keccak256("ANNUAL_BORROW_RATE");

    address internal _systemOwnerAddr;
    ISystemParameters internal _systemParameters;
    ISystemPoolsRegistry internal _systemPoolsRegistry;

    mapping(bytes32 => mapping(bytes32 => PureParameters.Param)) internal _parameters;

    modifier onlyExists(bytes32 _assetKey) {
        require(
            _systemPoolsRegistry.onlyExistingPool(_assetKey),
            "AssetParameters: Asset doesn't exist."
        );
        _;
    }

    modifier onlySystemOwner() {
        require(
            msg.sender == _systemOwnerAddr,
            "AssetParameters: Only system owner can call this function."
        );
        _;
    }

    function setDependencies(address contractsRegistry_, bytes memory) public override dependant {
        IRegistry registry_ = IRegistry(contractsRegistry_);

        _systemOwnerAddr = registry_.getSystemOwner();
        _systemParameters = ISystemParameters(registry_.getSystemParametersContract());
        _systemPoolsRegistry = ISystemPoolsRegistry(registry_.getSystemPoolsRegistryContract());
    }

    function setPoolInitParams(
        bytes32 assetKey_,
        bool isCollateral_,
        bool isCollateralWithPRT_
    ) external override {
        require(
            address(_systemPoolsRegistry) == msg.sender,
            "AssetParameters: Caller not a SystemPoolsRegistry."
        );

        _parameters[assetKey_][FREEZE_KEY] = PureParameters.makeBoolParam(false);
        emit FreezeParamUpdated(assetKey_, false);

        _parameters[assetKey_][ENABLE_COLLATERAL_KEY] = PureParameters.makeBoolParam(
            isCollateral_
        );

        _parameters[assetKey_][ENABLE_COLLATERAL_WITH_PRT_KEY] = PureParameters.makeBoolParam(
            isCollateralWithPRT_
        );
        emit CollateralParamUpdated(assetKey_, isCollateral_);
    }

    function setupAnnualBorrowRate(
        bytes32 assetKey_,
        uint256 newAnnualBorrowRate_
    ) external override onlySystemOwner onlyExists(assetKey_) {
        require(
            _systemParameters.getStablePoolsAvailability(),
            "AssetParameters: Stable pools unavailable."
        );
        (address poolAddr_, ISystemPoolsRegistry.PoolType poolType_) = _systemPoolsRegistry
            .poolsInfo(assetKey_);

        require(
            poolType_ == ISystemPoolsRegistry.PoolType.STABLE_POOL,
            "AssetParameters: Incorrect pool type."
        );

        require(
            newAnnualBorrowRate_ <= PRECISION * 25,
            "AssetParameters: Annual borrow rate is higher than possible."
        );

        if (PureParameters.paramExists(_parameters[assetKey_][ANNUAL_BORROW_RATE_KEY])) {
            IBasicPool(poolAddr_).updateCompoundRate(false);
        }

        _parameters[assetKey_][ANNUAL_BORROW_RATE_KEY] = PureParameters.makeUintParam(
            newAnnualBorrowRate_
        );

        emit AnnualBorrowRateUpdated(assetKey_, newAnnualBorrowRate_);
    }

    function setupMainParameters(
        bytes32 assetKey_,
        MainPoolParams calldata mainParams_
    ) external override onlySystemOwner onlyExists(assetKey_) {
        _setupMainParameters(assetKey_, mainParams_);
    }

    function setupInterestRateModel(
        bytes32 assetKey_,
        InterestRateParams calldata interestParams_
    ) external override onlySystemOwner onlyExists(assetKey_) {
        _setupInterestRateParams(assetKey_, interestParams_);
    }

    function setupDistributionsMinimums(
        bytes32 assetKey_,
        DistributionMinimums calldata distrMinimums_
    ) external override onlySystemOwner onlyExists(assetKey_) {
        _setupDistributionsMinimums(assetKey_, distrMinimums_);
    }

    function setupAllParameters(
        bytes32 assetKey_,
        AllPoolParams calldata poolParams_
    ) external override onlySystemOwner onlyExists(assetKey_) {
        _setupInterestRateParams(assetKey_, poolParams_.interestRateParams);
        _setupMainParameters(assetKey_, poolParams_.mainParams);
        _setupDistributionsMinimums(assetKey_, poolParams_.distrMinimums);
    }

    function freeze(bytes32 assetKey_) external override onlySystemOwner onlyExists(assetKey_) {
        _parameters[assetKey_][FREEZE_KEY] = PureParameters.makeBoolParam(true);

        emit FreezeParamUpdated(assetKey_, true);
    }

    function enableCollateral(
        bytes32 assetKey_,
        bool forPRT_
    ) external override onlySystemOwner onlyExists(assetKey_) {
        forPRT_
            ? _parameters[assetKey_][ENABLE_COLLATERAL_WITH_PRT_KEY] = PureParameters
                .makeBoolParam(true)
            : _parameters[assetKey_][ENABLE_COLLATERAL_KEY] = PureParameters.makeBoolParam(true);

        emit CollateralParamUpdated(assetKey_, true);
    }

    function isPoolFrozen(bytes32 assetKey_) external view override returns (bool) {
        return _getParam(assetKey_, FREEZE_KEY).getBoolFromParam();
    }

    function isAvailableAsCollateral(
        bytes32 assetKey_,
        bool withPRT_
    ) external view override returns (bool) {
        return
            withPRT_
                ? _getParam(assetKey_, ENABLE_COLLATERAL_WITH_PRT_KEY).getBoolFromParam()
                : _getParam(assetKey_, ENABLE_COLLATERAL_KEY).getBoolFromParam();
    }

    function getAnnualBorrowRate(bytes32 assetKey_) external view override returns (uint256) {
        return _getParam(assetKey_, ANNUAL_BORROW_RATE_KEY).getUintFromParam();
    }

    function getMainPoolParams(
        bytes32 assetKey_
    ) external view override returns (MainPoolParams memory) {
        return
            MainPoolParams(
                _getParam(assetKey_, COL_RATIO_KEY).getUintFromParam(),
                _getParam(assetKey_, COL_RATIO_WITH_PRT_KEY).getUintFromParam(),
                _getParam(assetKey_, RESERVE_FACTOR_KEY).getUintFromParam(),
                _getParam(assetKey_, LIQUIDATION_DISCOUNT_KEY).getUintFromParam(),
                _getParam(assetKey_, MAX_UTILIZATION_RATIO_KEY).getUintFromParam()
            );
    }

    function getInterestRateParams(
        bytes32 assetKey_
    ) external view override returns (InterestRateParams memory) {
        return
            InterestRateParams(
                _getParam(assetKey_, BASE_PERCENTAGE_KEY).getUintFromParam(),
                _getParam(assetKey_, FIRST_SLOPE_KEY).getUintFromParam(),
                _getParam(assetKey_, SECOND_SLOPE_KEY).getUintFromParam(),
                _getParam(assetKey_, UTILIZATION_BREAKING_POINT_KEY).getUintFromParam()
            );
    }

    function getDistributionMinimums(
        bytes32 assetKey_
    ) external view override returns (DistributionMinimums memory) {
        return
            DistributionMinimums(
                _getParam(assetKey_, MIN_SUPPLY_DISTRIBUTION_PART_KEY).getUintFromParam(),
                _getParam(assetKey_, MIN_BORROW_DISTRIBUTION_PART_KEY).getUintFromParam()
            );
    }

    function getColRatio(
        bytes32 assetKey_,
        bool withPRT_
    ) external view override returns (uint256) {
        return
            withPRT_
                ? _getParam(assetKey_, COL_RATIO_WITH_PRT_KEY).getUintFromParam()
                : _getParam(assetKey_, COL_RATIO_KEY).getUintFromParam();
    }

    function getReserveFactor(bytes32 assetKey_) external view override returns (uint256) {
        return _getParam(assetKey_, RESERVE_FACTOR_KEY).getUintFromParam();
    }

    function getLiquidationDiscount(bytes32 assetKey_) external view override returns (uint256) {
        return _getParam(assetKey_, LIQUIDATION_DISCOUNT_KEY).getUintFromParam();
    }

    function getMaxUtilizationRatio(bytes32 assetKey_) external view override returns (uint256) {
        return _getParam(assetKey_, MAX_UTILIZATION_RATIO_KEY).getUintFromParam();
    }

    function _setupInterestRateParams(
        bytes32 assetKey_,
        InterestRateParams calldata interestParams_
    ) internal {
        require(
            interestParams_.basePercentage <= PRECISION * 3,
            "AssetParameters: The new value of the base percentage is invalid."
        );
        require(
            interestParams_.firstSlope >= PRECISION * 3 &&
                interestParams_.firstSlope <= PRECISION * 20,
            "AssetParameters: The new value of the first slope is invalid."
        );
        require(
            interestParams_.secondSlope >= PRECISION * 50 &&
                interestParams_.secondSlope <= PERCENTAGE_100,
            "AssetParameters: The new value of the second slope is invalid."
        );
        require(
            interestParams_.utilizationBreakingPoint >= PRECISION * 60 &&
                interestParams_.utilizationBreakingPoint <= PRECISION * 90,
            "AssetParameters: The new value of the utilization breaking point is invalid."
        );

        _parameters[assetKey_][BASE_PERCENTAGE_KEY] = PureParameters.makeUintParam(
            interestParams_.basePercentage
        );
        _parameters[assetKey_][FIRST_SLOPE_KEY] = PureParameters.makeUintParam(
            interestParams_.firstSlope
        );
        _parameters[assetKey_][SECOND_SLOPE_KEY] = PureParameters.makeUintParam(
            interestParams_.secondSlope
        );
        _parameters[assetKey_][UTILIZATION_BREAKING_POINT_KEY] = PureParameters.makeUintParam(
            interestParams_.utilizationBreakingPoint
        );

        emit InterestRateParamsUpdated(
            assetKey_,
            interestParams_.basePercentage,
            interestParams_.firstSlope,
            interestParams_.secondSlope,
            interestParams_.utilizationBreakingPoint
        );
    }

    function _setupMainParameters(
        bytes32 assetKey_,
        MainPoolParams calldata mainParams_
    ) internal {
        require(
            mainParams_.collateralizationRatio >= PRECISION * 111 &&
                mainParams_.collateralizationRatio <= PRECISION * 200,
            "AssetParameters: The new value of the collateralization ratio is invalid."
        );
        require(
            mainParams_.reserveFactor >= PRECISION * 10 &&
                mainParams_.reserveFactor <= PRECISION * 35,
            "AssetParameters: The new value of the reserve factor is invalid."
        );
        require(
            mainParams_.liquidationDiscount <= PRECISION * 10,
            "AssetParameters: The new value of the liquidation discount is invalid."
        );
        require(
            mainParams_.maxUtilizationRatio >= PRECISION * 94 &&
                mainParams_.maxUtilizationRatio <= PRECISION * 97,
            "AssetParameters: The new value of the max utilization ratio is invalid."
        );

        _parameters[assetKey_][COL_RATIO_KEY] = PureParameters.makeUintParam(
            mainParams_.collateralizationRatio
        );

        _parameters[assetKey_][COL_RATIO_WITH_PRT_KEY] = PureParameters.makeUintParam(
            mainParams_.collateralizationRatioWithPRT
        );
        _parameters[assetKey_][RESERVE_FACTOR_KEY] = PureParameters.makeUintParam(
            mainParams_.reserveFactor
        );
        _parameters[assetKey_][LIQUIDATION_DISCOUNT_KEY] = PureParameters.makeUintParam(
            mainParams_.liquidationDiscount
        );
        _parameters[assetKey_][MAX_UTILIZATION_RATIO_KEY] = PureParameters.makeUintParam(
            mainParams_.maxUtilizationRatio
        );

        emit MainParamsUpdated(
            assetKey_,
            mainParams_.collateralizationRatio,
            mainParams_.reserveFactor,
            mainParams_.liquidationDiscount,
            mainParams_.maxUtilizationRatio
        );
    }

    function _setupDistributionsMinimums(
        bytes32 assetKey_,
        DistributionMinimums calldata distrMinimums_
    ) internal {
        require(
            distrMinimums_.minSupplyDistrPart >= PRECISION * 5 &&
                distrMinimums_.minSupplyDistrPart <= PRECISION * 15,
            "AssetParameters: The new value of the minimum supply part is invalid."
        );
        require(
            distrMinimums_.minBorrowDistrPart >= PRECISION * 5 &&
                distrMinimums_.minBorrowDistrPart <= PRECISION * 15,
            "AssetParameters: The new value of the minimum borrow part is invalid."
        );

        _parameters[assetKey_][MIN_SUPPLY_DISTRIBUTION_PART_KEY] = PureParameters.makeUintParam(
            distrMinimums_.minSupplyDistrPart
        );
        _parameters[assetKey_][MIN_BORROW_DISTRIBUTION_PART_KEY] = PureParameters.makeUintParam(
            distrMinimums_.minBorrowDistrPart
        );

        emit DistributionMinimumsUpdated(
            assetKey_,
            distrMinimums_.minSupplyDistrPart,
            distrMinimums_.minBorrowDistrPart
        );
    }

    function _getParam(
        bytes32 assetKey_,
        bytes32 paramKey_
    ) internal view returns (PureParameters.Param memory) {
        require(
            PureParameters.paramExists(_parameters[assetKey_][paramKey_]),
            "AssetParameters: Param for this asset doesn't exist."
        );

        return _parameters[assetKey_][paramKey_];
    }
}
