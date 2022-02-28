// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

library PureParameters {
    enum Types {NOT_EXIST, UINT, ADDRESS, BYTES32, BOOL}

    struct Param {
        uint256 uintParam;
        address addressParam;
        bytes32 bytes32Param;
        bool boolParam;
        Types currentType;
    }

    function makeUintParam(uint256 _num) internal pure returns (Param memory) {
        return
            Param({
                uintParam: _num,
                currentType: Types.UINT,
                addressParam: address(0),
                bytes32Param: bytes32(0),
                boolParam: false
            });
    }

    function getUintFromParam(Param memory _param) internal pure returns (uint256) {
        require(_param.currentType == Types.UINT, "PureParameters: Parameter not contain uint.");

        return _param.uintParam;
    }

    function makeAdrressParam(address _address) internal pure returns (Param memory) {
        return
            Param({
                addressParam: _address,
                currentType: Types.ADDRESS,
                uintParam: uint256(0),
                bytes32Param: bytes32(0),
                boolParam: false
            });
    }

    function getAdrressFromParam(Param memory _param) internal pure returns (address) {
        require(
            _param.currentType == Types.ADDRESS,
            "PureParameters: Parameter not contain address."
        );

        return _param.addressParam;
    }

    function makeBytes32Param(bytes32 _hash) internal pure returns (Param memory) {
        return
            Param({
                bytes32Param: _hash,
                currentType: Types.BYTES32,
                addressParam: address(0),
                uintParam: uint256(0),
                boolParam: false
            });
    }

    function getBytes32FromParam(Param memory _param) internal pure returns (bytes32) {
        require(
            _param.currentType == Types.BYTES32,
            "PureParameters: Parameter not contain bytes32."
        );

        return _param.bytes32Param;
    }

    function makeBoolParam(bool _bool) internal pure returns (Param memory) {
        return
            Param({
                boolParam: _bool,
                currentType: Types.BOOL,
                addressParam: address(0),
                uintParam: uint256(0),
                bytes32Param: bytes32(0)
            });
    }

    function getBoolFromParam(Param memory _param) internal pure returns (bool) {
        require(_param.currentType == Types.BOOL, "PureParameters: Parameter not contain bool.");

        return _param.boolParam;
    }

    function paramExists(Param memory _param) internal pure returns (bool) {
        return (_param.currentType != Types.NOT_EXIST);
    }
}
