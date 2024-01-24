// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "../libraries/PureParameters.sol";

contract PureParametersMock {
    using PureParameters for PureParameters.Param;

    function makeUintParam(uint256 num_) external pure returns (PureParameters.Param memory) {
        return PureParameters.makeUintParam(num_);
    }

    function getUintFromParam(PureParameters.Param memory param_) external pure returns (uint256) {
        return PureParameters.getUintFromParam(param_);
    }

    function makeAddressParam(
        address address_
    ) external pure returns (PureParameters.Param memory) {
        return PureParameters.makeAddressParam(address_);
    }

    function getAddressFromParam(
        PureParameters.Param memory param_
    ) external pure returns (address) {
        return PureParameters.getAddressFromParam(param_);
    }

    function makeBytes32Param(bytes32 hash_) external pure returns (PureParameters.Param memory) {
        return PureParameters.makeBytes32Param(hash_);
    }

    function getBytes32FromParam(
        PureParameters.Param memory param_
    ) external pure returns (bytes32) {
        return PureParameters.getBytes32FromParam(param_);
    }

    function makeBoolParam(bool bool_) external pure returns (PureParameters.Param memory) {
        return PureParameters.makeBoolParam(bool_);
    }

    function getBoolParam(PureParameters.Param memory param_) external pure returns (bool) {
        return PureParameters.getBoolFromParam(param_);
    }

    function paramExists(PureParameters.Param memory param_) external pure returns (bool) {
        return PureParameters.paramExists(param_);
    }
}
