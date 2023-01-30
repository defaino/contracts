pragma solidity 0.8.17;

import "../AssetParameters.sol";

contract AssetParametersMock is AssetParameters {
    function getSystemOwnerAddr() public view returns (address) {
        return _systemOwnerAddr;
    }
}
