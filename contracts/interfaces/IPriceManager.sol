// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV2V3Interface.sol";

/**
 * This contract is responsible for obtaining asset prices from trusted oracles.
 * The contract code provides for a main oracle and a backup oracle, as well as the ability to switch all price fetches to a backup oracle
 */
interface IPriceManager {
    /// @notice The structure that contains the oracle address token for this token
    /// @param assetAddr address of the asset for which the oracles will be saved
    /// @param chainlinkOracle Chainlink oracle address for the desired asset
    struct PriceFeed {
        address assetAddr;
        AggregatorV2V3Interface chainlinkOracle;
    }

    /// @notice This event is emitted when a new oracle is added
    /// @param _assetKey the pool key for which oracles are added
    /// @param _chainlinkOracle Chainlink oracle address for the pool underlying asset
    event OracleAdded(bytes32 _assetKey, address _chainlinkOracle);

    /// @notice The function you need to add oracles for assets
    /// @dev Only SystemPoolsRegistry contract can call this function
    /// @param _assetKey the pool key for which oracles are added
    /// @param _assetAddr address of the asset for which the oracles will be added
    /// @param _chainlinkOracle the address of the chainlink oracle for the passed asset
    function addOracle(bytes32 _assetKey, address _assetAddr, address _chainlinkOracle) external;

    /// @notice The function that returns the price for the asset for which oracles are saved
    /// @param _assetKey the key of the pool, for the asset for which the price will be obtained
    /// @return answer - the resulting token price, decimals - resulting token price decimals
    function getPrice(bytes32 _assetKey) external view returns (uint256, uint8);
}
