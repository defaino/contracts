// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "../libraries/PureParameters.sol";

contract PureParametersMock {
    using PureParameters for PureParameters.Param;

    function makeUintParam(uint256 _num) external pure returns (PureParameters.Param memory) {
        return PureParameters.makeUintParam(_num);
    }

    function getUintFromParam(PureParameters.Param memory _param) external pure returns (uint256) {
        return PureParameters.getUintFromParam(_param);
    }

    function makeAdrressParam(address _address)
        external
        pure
        returns (PureParameters.Param memory)
    {
        return PureParameters.makeAdrressParam(_address);
    }

    function getAdrressFromParam(PureParameters.Param memory _param)
        external
        pure
        returns (address)
    {
        return PureParameters.getAdrressFromParam(_param);
    }

    function makeBytes32Param(bytes32 _hash) external pure returns (PureParameters.Param memory) {
        return PureParameters.makeBytes32Param(_hash);
    }

    function getBytes32FromParam(PureParameters.Param memory _param)
        external
        pure
        returns (bytes32)
    {
        return PureParameters.getBytes32FromParam(_param);
    }

    function makeBoolParam(bool _bool) external pure returns (PureParameters.Param memory) {
        return PureParameters.makeBoolParam(_bool);
    }

    function getBoolParam(PureParameters.Param memory _param) external pure returns (bool) {
        return PureParameters.getBoolFromParam(_param);
    }

    function paramExists(PureParameters.Param memory _param) external pure returns (bool) {
        return PureParameters.paramExists(_param);
    }
}
