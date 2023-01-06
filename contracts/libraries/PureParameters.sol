// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/**
 * This library is used to conveniently store and retrieve parameters of different types
 */
library PureParameters {
    /// @notice This is an enumeration with available parameter types
    /// @param NOT_EXIST parameter type is not specified
    /// @param UINT uint256 parameter type
    /// @param ADDRESS address parameter type
    /// @param BYTES32 bytes32 parameter type
    /// @param BOOL bool parameter type
    enum Types {
        NOT_EXIST,
        UINT,
        ADDRESS,
        BYTES32,
        BOOL
    }

    /// @notice This is a structure with fields of available types
    /// @param uintParam uint256 struct field
    /// @param addressParam address struct field
    /// @param bytes32Param bytes32 struct field
    /// @param boolParam bool struct field
    /// @param currentType current parameter type
    struct Param {
        bytes32 param;
        Types currentType;
    }

    /// @notice Function for creating a type Param structure with a type uint256 parameter
    /// @param number_ uint256 parameter value
    /// @return a struct with Param type and uint256 parameter value
    function makeUintParam(uint256 number_) internal pure returns (Param memory) {
        return Param(bytes32(number_), Types.UINT);
    }

    /// @notice Function for creating a type Param structure with a type address parameter
    /// @param address_ address parameter value
    /// @return a struct with Param type and address parameter value
    function makeAddressParam(address address_) internal pure returns (Param memory) {
        return Param(bytes32(uint256(uint160(address_))), Types.ADDRESS);
    }

    /// @notice Function for creating a type Param structure with a type bytes32 parameter
    /// @param hash_ bytes32 parameter value
    /// @return a struct with Param type and bytes32 parameter value
    function makeBytes32Param(bytes32 hash_) internal pure returns (Param memory) {
        return Param(hash_, Types.BYTES32);
    }

    /// @notice Function for creating a type Param structure with a type bool parameter
    /// @param bool_ bool parameter value
    /// @return a struct with Param type and bool parameter value
    function makeBoolParam(bool bool_) internal pure returns (Param memory) {
        return Param(bytes32(uint256(bool_ ? 1 : 0)), Types.BOOL);
    }

    /// @notice Function for getting a value of type uint256 from structure Param
    /// @param param_ object of the structure from which the parameter will be obtained
    /// @return a uint256 parameter
    function getUintFromParam(Param memory param_) internal pure returns (uint256) {
        require(param_.currentType == Types.UINT, "PureParameters: Parameter not contain uint.");

        return uint256(param_.param);
    }

    /// @notice Function for getting a value of type address from structure Param
    /// @param param_ object of the structure from which the parameter will be obtained
    /// @return a address parameter
    function getAddressFromParam(Param memory param_) internal pure returns (address) {
        require(
            param_.currentType == Types.ADDRESS,
            "PureParameters: Parameter not contain address."
        );

        return address(uint160(uint256(param_.param)));
    }

    /// @notice Function for getting a value of type bytes32 from structure Param
    /// @param param_ object of the structure from which the parameter will be obtained
    /// @return a bytes32 parameter
    function getBytes32FromParam(Param memory param_) internal pure returns (bytes32) {
        require(
            param_.currentType == Types.BYTES32,
            "PureParameters: Parameter not contain bytes32."
        );

        return param_.param;
    }

    /// @notice Function for getting a value of type bool from structure Param
    /// @param param_ object of the structure from which the parameter will be obtained
    /// @return a bool parameter
    function getBoolFromParam(Param memory param_) internal pure returns (bool) {
        require(param_.currentType == Types.BOOL, "PureParameters: Parameter not contain bool.");

        return uint256(param_.param) == 1 ? true : false;
    }

    /// @notice Function to check if the parameter exists
    /// @param param_ structure with parameters that will be checked
    /// @return true, if the param exists, false otherwise
    function paramExists(Param memory param_) internal pure returns (bool) {
        return (param_.currentType != Types.NOT_EXIST);
    }
}
