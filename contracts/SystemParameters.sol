// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./interfaces/ISystemParameters.sol";

import "./libraries/PureParameters.sol";

import "./common/Globals.sol";

contract SystemParameters is ISystemParameters, OwnableUpgradeable {
    using PureParameters for PureParameters.Param;

    bytes32 public constant LIQUIDATION_BOUNDARY_KEY = keccak256("LIQUIDATION_BOUNDARY");
    bytes32 public constant OPTIMIZATION_PERCENTAGE_KEY = keccak256("OPTIMIZATION_PERCENTAGE");

    bytes32 public constant CURVE_REGISTRY_KEY = keccak256("CURVE_REGISTRY");
    bytes32 public constant CURVE_DOLLAR_ZAP_KEY = keccak256("CURVE_DOLLAR_ZAP");
    bytes32 public constant YEARN_REGISTRY_KEY = keccak256("YEARN_REGISTRY");

    mapping(bytes32 => PureParameters.Param) private _parameters;

    function systemParametersInitialize() external initializer {
        __Ownable_init();
    }

    function getLiquidationBoundaryParam() external view override returns (uint256) {
        return _getParam(LIQUIDATION_BOUNDARY_KEY).getUintFromParam();
    }

    function getOptimizationPercentageParam() external view override returns (uint256) {
        return _getParam(OPTIMIZATION_PERCENTAGE_KEY).getUintFromParam();
    }

    function getCurveZapParam() external view override returns (address) {
        return _getParam(CURVE_DOLLAR_ZAP_KEY).getAdrressFromParam();
    }

    function getCurveRegistryParam() external view override returns (address) {
        return _getParam(CURVE_REGISTRY_KEY).getAdrressFromParam();
    }

    function getYEarnRegistryParam() external view override returns (address) {
        return _getParam(YEARN_REGISTRY_KEY).getAdrressFromParam();
    }

    function setupLiquidationBoundary(uint256 _newValue) external onlyOwner {
        require(
            _newValue >= ONE_PERCENT * 50 && _newValue <= ONE_PERCENT * 80,
            "SystemParameters: The new value of the liquidation boundary is invalid."
        );

        _parameters[LIQUIDATION_BOUNDARY_KEY] = PureParameters.makeUintParam(_newValue);

        emit UintParamUpdated(LIQUIDATION_BOUNDARY_KEY, _newValue);
    }

    function setupOptimizationPercentage(uint256 _newValue) external onlyOwner {
        require(
            _newValue >= ONE_PERCENT * 15 && _newValue <= ONE_PERCENT * 40,
            "SystemParameters: The new value of the optimziation percentage is invalid."
        );

        _parameters[OPTIMIZATION_PERCENTAGE_KEY] = PureParameters.makeUintParam(_newValue);

        emit UintParamUpdated(OPTIMIZATION_PERCENTAGE_KEY, _newValue);
    }

    function setupCurveZap(address _newValue) external onlyOwner {
        _parameters[CURVE_DOLLAR_ZAP_KEY] = PureParameters.makeAdrressParam(_newValue);

        emit AddressParamUpdated(CURVE_DOLLAR_ZAP_KEY, _newValue);
    }

    function setupCurveRegistry(address _newValue) external onlyOwner {
        _parameters[CURVE_REGISTRY_KEY] = PureParameters.makeAdrressParam(_newValue);

        emit AddressParamUpdated(CURVE_REGISTRY_KEY, _newValue);
    }

    function setupYEarnRegistry(address _newValue) external onlyOwner {
        _parameters[YEARN_REGISTRY_KEY] = PureParameters.makeAdrressParam(_newValue);

        emit AddressParamUpdated(YEARN_REGISTRY_KEY, _newValue);
    }

    function _getParam(bytes32 _paramKey) internal view returns (PureParameters.Param memory) {
        require(
            PureParameters.paramExists(_parameters[_paramKey]),
            "SystemParameters: Param for this key doesn't exist."
        );

        return _parameters[_paramKey];
    }
}
