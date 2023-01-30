pragma solidity 0.8.17;

import "../SystemParameters.sol";

contract SystemParametersMock is SystemParameters {
    function getSystemOwnerAddr() public view returns (address) {
        return _systemOwnerAddr;
    }
}
