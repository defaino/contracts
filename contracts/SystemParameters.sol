// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@dlsl/dev-modules/contracts-registry/AbstractDependant.sol";

import "./interfaces/IRegistry.sol";
import "./interfaces/ISystemParameters.sol";

import "./libraries/PureParameters.sol";

import "./common/Globals.sol";

contract SystemParameters is ISystemParameters, AbstractDependant {
    using PureParameters for PureParameters.Param;

    bytes32 public constant REWARDS_TOKEN_KEY = keccak256("REWARDS_TOKEN");
    bytes32 public constant LIQUIDATION_BOUNDARY_KEY = keccak256("LIQUIDATION_BOUNDARY");
    bytes32 public constant STABLE_POOLS_AVAILABILITY_KEY = keccak256("STABLE_POOLS_AVAILABILITY");
    bytes32 public constant MIN_CURRENCY_AMOUNT_KEY = keccak256("MIN_CURRENCY_AMOUNT");

    address private systemOwnerAddr;

    mapping(bytes32 => PureParameters.Param) private _parameters;

    modifier onlySystemOwner() {
        require(
            msg.sender == systemOwnerAddr,
            "SystemParameters: Only system owner can call this function."
        );
        _;
    }

    function setDependencies(address _contractsRegistry) external override dependant {
        systemOwnerAddr = IRegistry(_contractsRegistry).getSystemOwner();
    }

    function setRewardsTokenAddress(address _rewardsToken) external override onlySystemOwner {
        PureParameters.Param memory _currentParam = _parameters[REWARDS_TOKEN_KEY];

        if (PureParameters.paramExists(_currentParam)) {
            require(
                _currentParam.getAddressFromParam() == address(0),
                "SystemParameters: Unable to change rewards token address."
            );
        }

        _parameters[REWARDS_TOKEN_KEY] = PureParameters.makeAddressParam(_rewardsToken);

        emit RewardsTokenUpdated(_rewardsToken);
    }

    function setupLiquidationBoundary(uint256 _newValue) external override onlySystemOwner {
        require(
            _newValue >= PRECISION * 50 && _newValue <= PRECISION * 80,
            "SystemParameters: The new value of the liquidation boundary is invalid."
        );

        _parameters[LIQUIDATION_BOUNDARY_KEY] = PureParameters.makeUintParam(_newValue);

        emit LiquidationBoundaryUpdated(_newValue);
    }

    function setupStablePoolsAvailability(bool _newValue) external override onlySystemOwner {
        _parameters[STABLE_POOLS_AVAILABILITY_KEY] = PureParameters.makeBoolParam(_newValue);

        emit StablePoolsAvailabilityUpdated(_newValue);
    }

    function setupMinCurrencyAmount(
        uint256 _newMinCurrencyAmount
    ) external override onlySystemOwner {
        _parameters[MIN_CURRENCY_AMOUNT_KEY] = PureParameters.makeUintParam(_newMinCurrencyAmount);

        emit MinCurrencyAmountUpdated(_newMinCurrencyAmount);
    }

    function getRewardsTokenAddress() external view override returns (address) {
        return _getParam(REWARDS_TOKEN_KEY).getAddressFromParam();
    }

    function getLiquidationBoundary() external view override returns (uint256) {
        return _getParam(LIQUIDATION_BOUNDARY_KEY).getUintFromParam();
    }

    function getStablePoolsAvailability() external view override returns (bool) {
        return _getParam(STABLE_POOLS_AVAILABILITY_KEY).getBoolFromParam();
    }

    function getMinCurrencyAmount() external view override returns (uint256) {
        return _getParam(MIN_CURRENCY_AMOUNT_KEY).getUintFromParam();
    }

    function _getParam(bytes32 _paramKey) internal view returns (PureParameters.Param memory) {
        require(
            PureParameters.paramExists(_parameters[_paramKey]),
            "SystemParameters: Param for this key doesn't exist."
        );

        return _parameters[_paramKey];
    }
}
