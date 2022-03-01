// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./interfaces/ISystemParameters.sol";

import "./libraries/PureParameters.sol";

import "./common/Globals.sol";

contract SystemParameters is ISystemParameters, OwnableUpgradeable {
    using PureParameters for PureParameters.Param;

    bytes32 public constant LIQUIDATION_BOUNDARY_KEY = keccak256("LIQUIDATION_BOUNDARY");

    mapping(bytes32 => PureParameters.Param) private _parameters;

    function systemParametersInitialize() external initializer {
        __Ownable_init();
    }

    function getLiquidationBoundaryParam() external view override returns (uint256) {
        return _getParam(LIQUIDATION_BOUNDARY_KEY).getUintFromParam();
    }

    function setupLiquidationBoundary(uint256 _newValue) external onlyOwner {
        require(
            _newValue >= ONE_PERCENT * 50 && _newValue <= ONE_PERCENT * 80,
            "SystemParameters: The new value of the liquidation boundary is invalid."
        );

        _parameters[LIQUIDATION_BOUNDARY_KEY] = PureParameters.makeUintParam(_newValue);

        emit UintParamUpdated(LIQUIDATION_BOUNDARY_KEY, _newValue);
    }

    function _getParam(bytes32 _paramKey) internal view returns (PureParameters.Param memory) {
        require(
            PureParameters.paramExists(_parameters[_paramKey]),
            "SystemParameters: Param for this key doesn't exist."
        );

        return _parameters[_paramKey];
    }
}
