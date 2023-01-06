// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@dlsl/dev-modules/contracts-registry/AbstractDependant.sol";

import "./interfaces/IRegistry.sol";
import "./interfaces/IPriceManager.sol";
import "./interfaces/ISystemPoolsRegistry.sol";

import "./common/Globals.sol";

contract PriceManager is IPriceManager, AbstractDependant {
    ISystemPoolsRegistry internal _systemPoolsRegistry;

    mapping(bytes32 => PriceFeed) public priceFeeds;

    function setDependencies(address contractsRegistry_) external override dependant {
        _systemPoolsRegistry = ISystemPoolsRegistry(
            IRegistry(contractsRegistry_).getSystemPoolsRegistryContract()
        );
    }

    function addOracle(
        bytes32 assetKey_,
        address assetAddr_,
        address chainlinkOracle_
    ) external override {
        require(
            address(_systemPoolsRegistry) == msg.sender,
            "PriceManager: Caller not a SystemPoolsRegistry."
        );

        (, ISystemPoolsRegistry.PoolType poolType_) = _systemPoolsRegistry.poolsInfo(assetKey_);

        if (poolType_ == ISystemPoolsRegistry.PoolType.LIQUIDITY_POOL) {
            require(
                chainlinkOracle_ != address(0),
                "PriceManager: The oracle must not be a null address."
            );
        }

        priceFeeds[assetKey_] = PriceFeed(assetAddr_, AggregatorV2V3Interface(chainlinkOracle_));

        emit OracleAdded(assetKey_, chainlinkOracle_);
    }

    function getPrice(bytes32 assetKey_) external view override returns (uint256, uint8) {
        require(
            priceFeeds[assetKey_].assetAddr != address(0),
            "PriceManager: The oracle for assets does not exists."
        );

        AggregatorV2V3Interface priceFeed_ = priceFeeds[assetKey_].chainlinkOracle;

        if (address(priceFeed_) == address(0)) {
            return (10 ** PRICE_DECIMALS, PRICE_DECIMALS);
        }

        return (uint256(priceFeed_.latestAnswer()), priceFeed_.decimals());
    }
}
