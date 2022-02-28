// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

interface ISystemParameters {
    event UintParamUpdated(bytes32 _paramKey, uint256 _newValue);
    event AddressParamUpdated(bytes32 _paramKey, address _newValue);

    /**
     * @notice Getter for parameter by key LIQUIDATION_BOUNDARY_KEY
     * @return current liquidation boundary parameter value
     */
    function getLiquidationBoundaryParam() external view returns (uint256);

    function getOptimizationPercentageParam() external view returns (uint256);

    /**
     * @notice Getter for parameter by key YEARN_CONTROLLER_KEY
     * @return current YEarn controller parameter value
     */
    function getYEarnRegistryParam() external view returns (address);

    /**
     * @notice Getter for parameter by key CURVE_REGISTRY_KEY
     * @return current cerve pool parameter value
     */
    function getCurveRegistryParam() external view returns (address);

    /**
     * @notice Getter for parameter by key CURVE_DOLLAR_ZAP_KEY
     * @return current cerve zap parameter value
     */
    function getCurveZapParam() external view returns (address);
}
