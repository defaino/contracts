pragma solidity 0.8.17;

import "../DefiCore.sol";

contract DefiCoreMock is DefiCore {
    function getSystemOwnerAddr() public view returns (address) {
        return _systemOwnerAddr;
    }
}
