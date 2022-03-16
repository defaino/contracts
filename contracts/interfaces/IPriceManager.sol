// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV2V3Interface.sol";

/**
 * This contract is responsible for obtaining asset prices from trusted oracles.
 * The contract code provides for a main oracle and a backup oracle, as well as the ability to switch all price fetches to a backup oracle
 */
interface IPriceManager {
    /// @notice The structure that contains the oracle address token for this token
    /// @param assetAddr address of the asset for which the oracles will be saved
    /// @param chainlinkOracle Chainlink oracle address for the desired asset
    /// @param uniswapPool the uniswap v3 pool address for the desired token paired with the set stablcoin
    struct PriceFeed {
        address assetAddr;
        AggregatorV2V3Interface chainlinkOracle;
        address uniswapPool;
    }

    /// @notice This event is emitted when a new oracle is added
    /// @param _assetKey the pool key for which oracles are added
    /// @param _chainlinkOracleAddr Chainlink oracle address for the pool underlying asset
    /// @param _uniswapPoolAddr the uniswap v3 pool address for the desired token paired with the set stablcoin
    event OracleAdded(bytes32 _assetKey, address _chainlinkOracleAddr, address _uniswapPoolAddr);

    /// @notice This event is emitted by separately adding a chainlink oracle for an asset
    /// @param _assetKey the pool key for which oracle is added
    /// @param _chainlinkOracleAddr Chainlink oracle address for the desired asset
    event ChainlinkOracleAdded(bytes32 _assetKey, address _chainlinkOracleAddr);

    /// @notice this event is emitted when the redirection value to the backup oracle changes
    /// @param _updateTimestamp time at the moment of value change
    /// @param _newValue new redirection value
    event RedirectUpdated(uint256 _updateTimestamp, bool _newValue);

    /// @notice The function you need to add oracles for assets
    /// @dev Only LiquidityPoolRegistry contract can call this function
    /// @param _assetKey the pool key for which oracles are added
    /// @param _assetAddr address of the asset for which the oracles will be added
    /// @param _newMainOracle the address of the main oracle for the passed asset
    /// @param _newBackupOracle address of the backup oracle for the passed asset
    function addOracle(
        bytes32 _assetKey,
        address _assetAddr,
        address _newMainOracle,
        address _newBackupOracle
    ) external;

    /// @notice Function to add a chainlink oracle that was not added originally
    /// @dev Only contract owner can call this function
    /// @param _assetKey the pool key for which oracle is added
    /// @param _newChainlinkOracle Chainlink oracle address for the desired asset
    function addChainlinkOracle(bytes32 _assetKey, address _newChainlinkOracle) external;

    /// @notice This function is needed to update redirection to the backup oracle
    /// @dev Only contract owner can call this function
    /// @param _newValue new redirection value
    function updateRedirectToUniswap(bool _newValue) external;

    /// @notice The function that returns the price for the asset for which oracles are saved
    /// @param _assetKey the key of the pool, for the asset for which the price will be obtained
    /// @param _assetDecimals underlying asset decimals
    /// @return answer - the resulting token price, decimals - resulting token price decimals
    function getPrice(bytes32 _assetKey, uint8 _assetDecimals)
        external
        view
        returns (uint256, uint8);
}
