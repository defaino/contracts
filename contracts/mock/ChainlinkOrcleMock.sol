// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV2V3Interface.sol";

contract ChainlinkOracleMock is AggregatorV2V3Interface {
    int256 public price;
    uint8 public override decimals;

    string public override description = "Description";

    constructor(int256 price_, uint8 decimals_) {
        price = price_;
        decimals = decimals_;
    }

    function setPrice(int256 newPrice_) external {
        price = newPrice_;
    }

    function setDecimals(uint8 newDecimals_) external {
        decimals = newDecimals_;
    }

    function latestAnswer() external view override returns (int256) {
        return price;
    }

    function latestTimestamp() external view override returns (uint256) {
        return block.timestamp;
    }

    function latestRound() external view override returns (uint256) {
        return block.timestamp;
    }

    function getAnswer(uint256) external view override returns (int256) {
        return price;
    }

    function getTimestamp(uint256) external view override returns (uint256) {
        return block.timestamp;
    }

    function version() external view override returns (uint256) {
        return uint256(price);
    }

    function getRoundData(
        uint80 roundId_
    ) external view override returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId_, price, block.timestamp, block.timestamp, roundId_);
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (0, price, block.timestamp, block.timestamp, 0);
    }
}
