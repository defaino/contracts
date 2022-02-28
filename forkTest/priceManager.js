const PriceManager = artifacts.require("PriceManager");
const Registry = artifacts.require("Registry");
const AggregatorV2V3Interface = artifacts.require("AggregatorV2V3Interface");

const { toBytes } = require("../test/helpers/bytesCompareLibrary");
const Reverter = require("../test/helpers/reverter");
const { assert } = require("chai");

const { toBN } = require("../scripts/globals");

contract("PriceManager", async (accounts) => {
  const reverter = new Reverter(web3);

  const ADDRESS_NULL = "0x0000000000000000000000000000000000000000";

  const ASSET_PARAMETERS = accounts[9];

  const onePercent = toBN(10).pow(25);
  const decimal = onePercent.times(100);

  let registry;
  let priceManager;

  const decimals = [18, 18, 6, 6, 18];
  const keys = [toBytes("DAI"), toBytes("COMP"), toBytes("USDC"), toBytes("USDT"), toBytes("AAVE")];
  const tokensAddresses = [
    "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI address
    "0xc00e94cb662c3520282e6f5717214004a7f26888", // COMP address
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC address
    "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT address
    "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", // AAVE address
  ];

  const chainlinkOracles = [
    "0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9", // DAI address
    "0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5", // COMP address
    "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", // USDC address
    "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D", // USDT address
    "0x547a514d5e3769680Ce22B2361c10Ea13619e8a9", // AAVE address
  ];

  const uniswapPools = [
    "0x6c6Bc977E13Df9b0de53b251522280BB72383700", // DAI address
    "0xF15054BC50c39ad15FDC67f2AedD7c2c945ca5f6", // COMP address
    ADDRESS_NULL, // USDC address
    "0x7858E59e0C01EA06Df3aF3D20aC7B0003275D4Bf", // USDT address
    "0xdceaf5d0E5E0dB9596A47C0c4120654e80B1d706", // AAVE address
  ];

  before("setup", async () => {
    registry = await Registry.new();

    const _priceManager = await PriceManager.new();

    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), _priceManager.address);
    await registry.addContract(await registry.ASSET_PARAMETERS_NAME(), ASSET_PARAMETERS);

    priceManager = await PriceManager.at(await registry.getPriceManagerContract());

    await registry.injectDependencies(await registry.PRICE_MANAGER_NAME());

    await priceManager.priceManagerInitialize(keys[2], tokensAddresses[2]);

    for (let i = 0; i < keys.length; i++) {
      await priceManager.addOracle(keys[i], tokensAddresses[i], chainlinkOracles[i], uniswapPools[i], {
        from: ASSET_PARAMETERS,
      });
    }

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("test chainlink oracles", async () => {
    it("get dai price from chainlink", async () => {
      const assetIndex = 0;

      const oracle = await AggregatorV2V3Interface.at(chainlinkOracles[assetIndex]);

      console.log("DAI price from chainlink");
      console.log(
        `Current timestamp - ${toBN(await oracle.latestTimestamp()).toString()}, current round - ${toBN(
          await oracle.latestRound()
        ).toString()}, current answer - ${toBN(await oracle.latestAnswer()).toString()}`
      );

      const result = await priceManager.getPrice(keys[assetIndex], decimals[assetIndex]);
      console.log(`Price manager value - ${toBN(result[0]).toString()}, decimals - ${toBN(result[1]).toString()}`);
    });

    it("get comp price from chainlink", async () => {
      const assetIndex = 1;

      const oracle = await AggregatorV2V3Interface.at(chainlinkOracles[assetIndex]);

      console.log("COMP price from chainlink");
      console.log(
        `Current timestamp - ${toBN(await oracle.latestTimestamp()).toString()}, current round - ${toBN(
          await oracle.latestRound()
        ).toString()}, current answer - ${toBN(await oracle.latestAnswer()).toString()}`
      );

      const result = await priceManager.getPrice(keys[assetIndex], decimals[assetIndex]);
      console.log(`Price manager value - ${toBN(result[0]).toString()}, decimals - ${toBN(result[1]).toString()}`);
    });

    it("get usdc price from chainlink", async () => {
      const assetIndex = 2;

      const oracle = await AggregatorV2V3Interface.at(chainlinkOracles[assetIndex]);

      console.log("USDC price from chainlink");
      console.log(
        `Current timestamp - ${toBN(await oracle.latestTimestamp()).toString()}, current round - ${toBN(
          await oracle.latestRound()
        ).toString()}, current answer - ${toBN(await oracle.latestAnswer()).toString()}`
      );

      const result = await priceManager.getPrice(keys[assetIndex], decimals[assetIndex]);
      console.log(`Price manager value - ${toBN(result[0]).toString()}, decimals - ${toBN(result[1]).toString()}`);
    });

    it("get usdt price from chainlink", async () => {
      const assetIndex = 3;

      const oracle = await AggregatorV2V3Interface.at(chainlinkOracles[assetIndex]);

      console.log("USDT price from chainlink");
      console.log(
        `Current timestamp - ${toBN(await oracle.latestTimestamp()).toString()}, current round - ${toBN(
          await oracle.latestRound()
        ).toString()}, current answer - ${toBN(await oracle.latestAnswer()).toString()}`
      );

      const result = await priceManager.getPrice(keys[assetIndex], decimals[assetIndex]);
      console.log(`Price manager value - ${toBN(result[0]).toString()}, decimals - ${toBN(result[1]).toString()}`);
    });

    it("get aave price from chainlink", async () => {
      const assetIndex = 4;

      const oracle = await AggregatorV2V3Interface.at(chainlinkOracles[assetIndex]);

      console.log("AAVE price from chainlink");
      console.log(
        `Current timestamp - ${toBN(await oracle.latestTimestamp()).toString()}, current round - ${toBN(
          await oracle.latestRound()
        ).toString()}, current answer - ${toBN(await oracle.latestAnswer()).toString()}`
      );

      const result = await priceManager.getPrice(keys[assetIndex], decimals[assetIndex]);
      console.log(`Price manager value - ${toBN(result[0]).toString()}, decimals - ${toBN(result[1]).toString()}`);
    });
  });

  describe("test uniswap oracles", async () => {
    beforeEach("setup", async () => {
      await priceManager.updateRedirectToUniswap(true);
    });

    it("get dai price from uniswap", async () => {
      const assetIndex = 0;

      console.log("DAI price from uniswap");

      const result = await priceManager.getPrice(keys[assetIndex], decimals[assetIndex]);
      console.log(`Price manager value - ${toBN(result[0]).toString()}, decimals - ${toBN(result[1]).toString()}`);
    });

    it("get comp price from uniswap", async () => {
      const assetIndex = 1;

      console.log("COMP price from uniswap");

      const result = await priceManager.getPrice(keys[assetIndex], decimals[assetIndex]);
      console.log(`Price manager value - ${toBN(result[0]).toString()}, decimals - ${toBN(result[1]).toString()}`);
    });

    it("get usdc price from uniswap", async () => {
      const assetIndex = 2;

      console.log("USDC price from uniswap");

      const result = await priceManager.getPrice(keys[assetIndex], decimals[assetIndex]);
      console.log(`Price manager value - ${toBN(result[0]).toString()}, decimals - ${toBN(result[1]).toString()}`);
    });

    it("get usdt price from uniswap", async () => {
      const assetIndex = 3;

      console.log("USDT price from uniswap");

      const result = await priceManager.getPrice(keys[assetIndex], decimals[assetIndex]);
      console.log(`Price manager value - ${toBN(result[0]).toString()}, decimals - ${toBN(result[1]).toString()}`);
    });

    it("get aave price from uniswap", async () => {
      const assetIndex = 4;

      console.log("AAVE price from uniswap");

      const result = await priceManager.getPrice(keys[assetIndex], decimals[assetIndex]);
      console.log(`Price manager value - ${toBN(result[0]).toString()}, decimals - ${toBN(result[1]).toString()}`);
    });

    it("check stablecoins price", async () => {
      const usdcPrice = toBN((await priceManager.getPrice(keys[2], decimals[2]))[1]);
      const usdtPrice = toBN((await priceManager.getPrice(keys[3], decimals[3]))[1]);
      const daiPrice = toBN((await priceManager.getPrice(keys[0], decimals[0]))[1]);

      let actualRatio = usdcPrice.times(decimal).idiv(usdtPrice);
      assert.closeTo(actualRatio.toNumber(), decimal.toNumber(), onePercent.times(3).toNumber());

      actualRatio = usdcPrice.times(decimal).idiv(daiPrice);
      assert.closeTo(actualRatio.toNumber(), decimal.toNumber(), onePercent.times(3).toNumber());

      actualRatio = daiPrice.times(decimal).idiv(usdtPrice);
      assert.closeTo(actualRatio.toNumber(), decimal.toNumber(), onePercent.times(3).toNumber());
    });
  });
});
