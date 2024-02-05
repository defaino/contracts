// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";

import "../libraries/DSMath.sol";

import "../common/Globals.sol";

contract CompoundRateKeeper is Ownable {
    struct CompoundRate {
        uint256 rate;
        uint256 lastUpdate;
    }

    CompoundRate public compoundRate;

    constructor() {
        compoundRate = CompoundRate(PERCENTAGE_100, block.timestamp);
    }

    function getCurrentRate() external view returns (uint256) {
        return compoundRate.rate;
    }

    function getLastUpdate() external view returns (uint256) {
        return compoundRate.lastUpdate;
    }

    function update(uint256 interestRate_) external onlyOwner returns (uint256 newRate_) {
        newRate_ = getNewCompoundRate(interestRate_);

        compoundRate.rate = newRate_;
        compoundRate.lastUpdate = block.timestamp;
    }

    function getNewCompoundRate(uint256 interestRate_) public view returns (uint256 newRate_) {
        uint256 period_ = block.timestamp - compoundRate.lastUpdate;

        newRate_ =
            (compoundRate.rate *
                (DSMath.rpow(interestRate_ + PERCENTAGE_100, period_, PERCENTAGE_100))) /
            PERCENTAGE_100;
    }
}
