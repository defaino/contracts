// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@dlsl/dev-modules/contracts-registry/AbstractDependant.sol";

import "./interfaces/IRegistry.sol";
import "./interfaces/IPriceManager.sol";
import "./interfaces/ISystemPoolsRegistry.sol";

import "./common/Globals.sol";

contract PriceManager is IPriceManager, AbstractDependant {
    ISystemPoolsRegistry private systemPoolsRegistry;

    mapping(bytes32 => PriceFeed) public priceFeeds;

    function setDependencies(address _contractsRegistry) external override dependant {
        systemPoolsRegistry = ISystemPoolsRegistry(
            IRegistry(_contractsRegistry).getSystemPoolsRegistryContract()
        );
    }

    function addOracle(
        bytes32 _assetKey,
        address _assetAddr,
        address _chainlinkOracle
    ) external override {
        require(
            address(systemPoolsRegistry) == msg.sender,
            "PriceManager: Caller not a SystemPoolsRegistry."
        );

        (, ISystemPoolsRegistry.PoolType _poolType) = systemPoolsRegistry.poolsInfo(_assetKey);

        if (_poolType == ISystemPoolsRegistry.PoolType.LIQUIDITY_POOL) {
            require(
                _chainlinkOracle != address(0),
                "PriceManager: The oracle must not be a null address."
            );
        }

        priceFeeds[_assetKey] = PriceFeed(_assetAddr, AggregatorV2V3Interface(_chainlinkOracle));

        emit OracleAdded(_assetKey, _chainlinkOracle);
    }

    function getPrice(bytes32 _assetKey) external view override returns (uint256, uint8) {
        require(
            priceFeeds[_assetKey].assetAddr != address(0),
            "PriceManager: The oracle for assets does not exists."
        );

        AggregatorV2V3Interface _priceFeed = priceFeeds[_assetKey].chainlinkOracle;

        if (address(_priceFeed) == address(0)) {
            return (10 ** PRICE_DECIMALS, PRICE_DECIMALS);
        }

        return (uint256(_priceFeed.latestAnswer()), _priceFeed.decimals());
    }
}
