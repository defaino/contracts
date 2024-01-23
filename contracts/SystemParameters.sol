// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "@solarity/solidity-lib/contracts-registry/AbstractDependant.sol";

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

    address internal _systemOwnerAddr;

    mapping(bytes32 => PureParameters.Param) internal _parameters;

    modifier onlySystemOwner() {
        require(
            msg.sender == _systemOwnerAddr,
            "SystemParameters: Only system owner can call this function."
        );
        _;
    }

    function setDependencies(address contractsRegistry_, bytes memory) public override dependant {
        _systemOwnerAddr = IRegistry(contractsRegistry_).getSystemOwner();
    }

    function setRewardsTokenAddress(address rewardsToken_) external override onlySystemOwner {
        PureParameters.Param memory currentParam_ = _parameters[REWARDS_TOKEN_KEY];

        if (PureParameters.paramExists(currentParam_)) {
            require(
                currentParam_.getAddressFromParam() == address(0),
                "SystemParameters: Unable to change rewards token address."
            );
        }

        _parameters[REWARDS_TOKEN_KEY] = PureParameters.makeAddressParam(rewardsToken_);

        emit RewardsTokenUpdated(rewardsToken_);
    }

    function setupLiquidationBoundary(uint256 newValue_) external override onlySystemOwner {
        require(
            newValue_ >= PRECISION * 50 && newValue_ <= PRECISION * 80,
            "SystemParameters: The new value of the liquidation boundary is invalid."
        );

        _parameters[LIQUIDATION_BOUNDARY_KEY] = PureParameters.makeUintParam(newValue_);

        emit LiquidationBoundaryUpdated(newValue_);
    }

    function setupStablePoolsAvailability(bool newValue_) external override onlySystemOwner {
        _parameters[STABLE_POOLS_AVAILABILITY_KEY] = PureParameters.makeBoolParam(newValue_);

        emit StablePoolsAvailabilityUpdated(newValue_);
    }

    function setupMinCurrencyAmount(
        uint256 newMinCurrencyAmount_
    ) external override onlySystemOwner {
        _parameters[MIN_CURRENCY_AMOUNT_KEY] = PureParameters.makeUintParam(newMinCurrencyAmount_);

        emit MinCurrencyAmountUpdated(newMinCurrencyAmount_);
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

    function _getParam(bytes32 paramKey_) internal view returns (PureParameters.Param memory) {
        require(
            PureParameters.paramExists(_parameters[paramKey_]),
            "SystemParameters: Param for this key doesn't exist."
        );

        return _parameters[paramKey_];
    }
}
