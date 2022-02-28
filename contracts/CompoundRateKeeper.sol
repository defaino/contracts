// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./common/DSMath.sol";
import "./common/Globals.sol";

contract CompoundRateKeeper is Ownable {
    struct CompoundRate {
        uint256 rate;
        uint256 lastUpdate;
    }

    CompoundRate public compoundRate;

    constructor() {
        compoundRate = CompoundRate(DECIMAL, block.timestamp);
    }

    function getCurrentRate() external view returns (uint256) {
        return compoundRate.rate;
    }

    function getLastUpdate() external view returns (uint256) {
        return compoundRate.lastUpdate;
    }

    function update(uint256 _interestRate) external onlyOwner returns (uint256 _newRate) {
        _newRate = getNewCompoundRate(_interestRate);

        compoundRate.rate = _newRate;
        compoundRate.lastUpdate = block.timestamp;
    }

    function getNewCompoundRate(uint256 _interestRate) public view returns (uint256 _newRate) {
        uint256 _period = block.timestamp - compoundRate.lastUpdate;
        _newRate =
            (compoundRate.rate * (DSMath.rpow(_interestRate + DECIMAL, _period, DECIMAL))) /
            DECIMAL;
    }
}
