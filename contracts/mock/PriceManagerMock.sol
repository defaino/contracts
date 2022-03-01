// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV2V3Interface.sol";

import "../interfaces/IPriceManager.sol";

import "../libraries/UniswapOracleLibrary.sol";

import "../Registry.sol";
import "../abstract/AbstractDependant.sol";
import "../common/Globals.sol";

contract PriceManagerMock is IPriceManager, OwnableUpgradeable, AbstractDependant {
    Registry private registry;

    uint32 public constant PRICE_PERIOD = 1 hours;

    bool public redirectToUniswap;

    address public quoteToken;
    bytes32 public quoteAssetKey;
    uint8 public quoteTokenDecimals;

    struct PriceFeed {
        address assetAddr;
        AggregatorV2V3Interface chainlinkOracle;
        address uniswapPool;
    }

    mapping(bytes32 => PriceFeed) public priceFeeds;

    mapping(bytes32 => uint256) public uniswapPrices;

    event OracleAdded(bytes32 _assetKey, address _chainlinkOracleAddr, address _uniswapPoolAddr);
    event ChainlinkOracleAdded(bytes32 _assetKey, address _chainlinkOracleAddr);
    event RedirectUpdated(uint256 _updateTimestamp, bool _newValue);

    function priceManagerInitialize(bytes32 _quoteAssetKey, address _quoteToken)
        external
        initializer
    {
        __Ownable_init();

        quoteToken = _quoteToken;
        quoteAssetKey = _quoteAssetKey;
        quoteTokenDecimals = ERC20(_quoteToken).decimals();
    }

    function setDependencies(Registry _registry) external override onlyInjectorOrZero {
        registry = _registry;
    }

    modifier onlyLiquidityPoolRegistry() {
        require(
            registry.getLiquidityPoolRegistryContract() == msg.sender,
            "PriceManager: Caller not an LiquidityPoolRegistry."
        );
        _;
    }

    modifier onlyExistingAssets(bytes32 _assetKey) {
        require(
            priceFeeds[_assetKey].uniswapPool != address(0),
            "PriceManager: The oracle for assets does not exists."
        );
        _;
    }

    function setPrice(bytes32 _assetKey, uint256 _newPrice) external onlyOwner {
        uniswapPrices[_assetKey] = _newPrice;
    }

    function addOracle(
        bytes32 _assetKey,
        address _assetAddr,
        address _newMainOracle,
        address _newBackupOracle
    ) external override onlyLiquidityPoolRegistry {
        if (_assetKey != quoteAssetKey) {
            require(
                _newBackupOracle != address(0),
                "PriceManager: Uniswap pool should not be address zero."
            );
        }

        priceFeeds[_assetKey] = PriceFeed(
            _assetAddr,
            AggregatorV2V3Interface(_newMainOracle),
            _newBackupOracle
        );

        emit OracleAdded(_assetKey, _newMainOracle, _newBackupOracle);
    }

    function addChainlinkOracle(bytes32 _assetKey, address _newChainlinkOracle)
        external
        onlyExistingAssets(_assetKey)
        onlyOwner
    {
        require(
            _newChainlinkOracle != address(0),
            "PriceManager: Chainlink oracle should not be address zero."
        );
        require(
            address(priceFeeds[_assetKey].chainlinkOracle) == address(0),
            "PriceManager: Can't modify an existing oracle."
        );

        priceFeeds[_assetKey].chainlinkOracle = AggregatorV2V3Interface(_newChainlinkOracle);

        emit ChainlinkOracleAdded(_assetKey, _newChainlinkOracle);
    }

    function updateRedirectToUniswap(bool _newValue) external onlyOwner {
        redirectToUniswap = _newValue;

        emit RedirectUpdated(block.timestamp, _newValue);
    }

    function getPrice(bytes32 _assetKey, uint8 _assetDecimals)
        external
        view
        override
        onlyExistingAssets(_assetKey)
        returns (uint256, uint8)
    {
        if (!redirectToUniswap) {
            AggregatorV2V3Interface _priceFeed = priceFeeds[_assetKey].chainlinkOracle;

            int256 _currentAnswer;
            uint8 _decimals;

            if (address(_priceFeed) != address(0)) {
                _currentAnswer = _priceFeed.latestAnswer();
                _decimals = _priceFeed.decimals();
            }

            if (_currentAnswer > 0) {
                return (uint256(_currentAnswer), _decimals);
            }
        }

        if (_assetKey != quoteAssetKey) {
            return (_getPriceFromUniswap(_assetKey, quoteTokenDecimals), quoteTokenDecimals);
        }

        return (10**_assetDecimals, _assetDecimals);
    }

    function _getPriceFromUniswap(bytes32 _assetKey, uint8 _assetDecimals)
        internal
        view
        returns (uint256)
    {
        return uniswapPrices[_assetKey] * 10**_assetDecimals;
    }
}
