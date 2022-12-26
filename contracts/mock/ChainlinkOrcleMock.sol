// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV2V3Interface.sol";

contract ChainlinkOracleMock is AggregatorV2V3Interface {
    int256 public price;
    uint8 public override decimals;

    string public override description = "Description";

    constructor(int256 _price, uint8 _decimals) {
        price = _price;
        decimals = _decimals;
    }

    function setPrice(int256 _newPrice) external {
        price = _newPrice;
    }

    function setDecimals(uint8 _newDecimals) external {
        decimals = _newDecimals;
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

    function getAnswer(uint256 roundId) external view override returns (int256) {
        roundId;
        return price;
    }

    function getTimestamp(uint256 roundId) external view override returns (uint256) {
        roundId;
        return block.timestamp;
    }

    function version() external view override returns (uint256) {
        return uint256(price);
    }

    // getRoundData and latestRoundData should both raise "No data present"
    // if they do not have data to report, instead of returning unset values
    // which could be misinterpreted as actual reported values.
    function getRoundData(
        uint80 _roundId
    )
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        _roundId;
        return (_roundId, price, block.timestamp, block.timestamp, _roundId);
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (roundId, price, block.timestamp, block.timestamp, roundId);
    }
}
