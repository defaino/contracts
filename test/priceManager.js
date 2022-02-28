const PriceManager = artifacts.require("PriceManagerMock");
const Registry = artifacts.require("Registry");
const MockERC20 = artifacts.require("MockERC20");
const ChainlinkOracle = artifacts.require("ChainlinkOracleMock");

const { advanceBlockAtTime } = require("./helpers/ganacheTimeTraveler");
const { toBytes, compareKeys } = require("./helpers/bytesCompareLibrary");
const Reverter = require("./helpers/reverter");
const { assert } = require("chai");

const setCurrentTime = advanceBlockAtTime;

const truffleAssert = require("truffle-assertions");

const { toBN } = require("../scripts/globals");

contract("PriceManager", async (accounts) => {
  const reverter = new Reverter(web3);

  const ADDRESS_NULL = "0x0000000000000000000000000000000000000000";

  const NOTHING = accounts[8];
  const LIQUIDITY_POOL_REGISTRY = accounts[9];

  const onePercent = toBN(10).pow(25);

  let registry;
  let priceManager;

  let dai;

  const daiKey = toBytes("DAI");
  const wEthKey = toBytes("WETH");
  const usdcKey = toBytes("USDC");

  before("setup", async () => {
    registry = await Registry.new();

    dai = await MockERC20.new("MockDAI", "DAI");

    const _priceManager = await PriceManager.new();

    await registry.addContract(await registry.LIQUIDITY_POOL_REGISTRY_NAME(), LIQUIDITY_POOL_REGISTRY);
    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), _priceManager.address);

    priceManager = await PriceManager.at(await registry.getPriceManagerContract());

    await registry.injectDependencies(await registry.PRICE_MANAGER_NAME());
    await priceManager.priceManagerInitialize(daiKey, dai.address);

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("addOracle", async () => {
    it("should correctly add new oracle", async () => {
      const chainlinkOracle = await ChainlinkOracle.new(10, 1);
      const txReceipt = await priceManager.addOracle(wEthKey, NOTHING, chainlinkOracle.address, NOTHING, {
        from: LIQUIDITY_POOL_REGISTRY,
      });

      assert.equal(txReceipt.receipt.logs[0].event, "OracleAdded");
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, wEthKey));
      assert.equal(txReceipt.receipt.logs[0].args._chainlinkOracleAddr, chainlinkOracle.address);
      assert.equal(txReceipt.receipt.logs[0].args._uniswapPoolAddr, NOTHING);

      const priceFeed = await priceManager.priceFeeds(wEthKey);

      assert.equal(priceFeed.assetAddr, NOTHING);
      assert.equal(priceFeed.chainlinkOracle, chainlinkOracle.address);
      assert.equal(priceFeed.uniswapPool, NOTHING);
    });

    it("should get exception if the uniswap pool address is zero address", async () => {
      const reason = "PriceManager: Uniswap pool should not be address zero.";
      await truffleAssert.reverts(
        priceManager.addOracle(wEthKey, NOTHING, ADDRESS_NULL, ADDRESS_NULL, { from: LIQUIDITY_POOL_REGISTRY }),
        reason
      );
    });
  });

  describe("addChainlinkOracle", async () => {
    let chainlinkOracle;

    beforeEach("setup", async () => {
      chainlinkOracle = await ChainlinkOracle.new(10, 1);

      await priceManager.addOracle(wEthKey, NOTHING, ADDRESS_NULL, NOTHING, { from: LIQUIDITY_POOL_REGISTRY });
    });

    it("should correctly add chainlink oracle", async () => {
      assert.equal((await priceManager.priceFeeds(wEthKey)).chainlinkOracle, ADDRESS_NULL);

      const txReceipt = await priceManager.addChainlinkOracle(wEthKey, chainlinkOracle.address);

      assert.equal(txReceipt.receipt.logs[0].event, "ChainlinkOracleAdded");
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, wEthKey));
      assert.equal(txReceipt.receipt.logs[0].args._chainlinkOracleAddr, chainlinkOracle.address);

      assert.equal((await priceManager.priceFeeds(wEthKey)).chainlinkOracle, chainlinkOracle.address);
    });

    it("should get exception if the new chainlink oracle is zero address", async () => {
      const reason = "PriceManager: Chainlink oracle should not be address zero.";
      await truffleAssert.reverts(priceManager.addChainlinkOracle(wEthKey, ADDRESS_NULL), reason);
    });

    it("should get exception if try to modify existing oracle", async () => {
      await priceManager.addChainlinkOracle(wEthKey, chainlinkOracle.address);

      const reason = "PriceManager: Can't modify an existing oracle.";
      await truffleAssert.reverts(priceManager.addChainlinkOracle(wEthKey, chainlinkOracle.address), reason);
    });
  });

  describe("updateRedirectToUniswap", async () => {
    it("should update the redirect correctly", async () => {
      let newValue = true;
      let currentTime = 1;

      await setCurrentTime(currentTime);

      let txReceipt = await priceManager.updateRedirectToUniswap(newValue);

      assert.equal(txReceipt.receipt.logs[0].event, "RedirectUpdated");
      assert.equal(txReceipt.receipt.logs[0].args._updateTimestamp, currentTime);
      assert.equal(txReceipt.receipt.logs[0].args._newValue, newValue);

      assert.equal(await priceManager.redirectToUniswap(), newValue);

      newValue = false;
      currentTime = 10000;

      await setCurrentTime(currentTime);

      txReceipt = await priceManager.updateRedirectToUniswap(newValue);

      assert.equal(txReceipt.receipt.logs[0].event, "RedirectUpdated");
      assert.equal(toBN(txReceipt.receipt.logs[0].args._updateTimestamp).toString(), currentTime);
      assert.equal(txReceipt.receipt.logs[0].args._newValue, newValue);

      assert.equal(await priceManager.redirectToUniswap(), newValue);
    });
  });

  describe("getPrice", async () => {
    const decimals = toBN(8);
    let wEthChainlinkPrice = toBN(10).times(toBN(10).pow(decimals));
    let daiChainlinkPrice = toBN(10).pow(decimals);
    let usdcPrice = toBN(30);
    let wEthPrice = toBN(9);

    let wEthChainlinkOracle;
    let daiChainlinkOracle;

    beforeEach("setup", async () => {
      wEthChainlinkOracle = await ChainlinkOracle.new(wEthChainlinkPrice, decimals);
      daiChainlinkOracle = await ChainlinkOracle.new(daiChainlinkPrice, decimals);

      await priceManager.addOracle(wEthKey, NOTHING, wEthChainlinkOracle.address, NOTHING, {
        from: LIQUIDITY_POOL_REGISTRY,
      });
      await priceManager.addOracle(daiKey, NOTHING, daiChainlinkOracle.address, NOTHING, {
        from: LIQUIDITY_POOL_REGISTRY,
      });

      await priceManager.addOracle(usdcKey, NOTHING, ADDRESS_NULL, NOTHING, { from: LIQUIDITY_POOL_REGISTRY });

      await priceManager.setPrice(usdcKey, usdcPrice);
      await priceManager.setPrice(wEthKey, wEthPrice);
    });

    it("should get correct price from the chainlink oracle", async () => {
      const wEthDecimals = toBN(18);

      const result = await priceManager.getPrice(wEthKey, wEthDecimals);

      assert.equal(toBN(result[0]).toString(), wEthChainlinkPrice.toString());
      assert.equal(toBN(result[1]).toString(), decimals.toString());

      const amount = toBN(200);
      const expectedAmountInUSD = toBN(2000);

      assert.equal(amount.times(result[0]).idiv(toBN(10).pow(result[1])).toString(), expectedAmountInUSD.toString());
    });

    it("should get correct price if the asset is not chainlink oracle", async () => {
      const usdcDecimals = toBN(6);
      const daiDecimals = toBN(18);

      const result = await priceManager.getPrice(usdcKey, usdcDecimals);

      assert.equal(toBN(result[0]).toString(), usdcPrice.times(toBN(10).pow(daiDecimals)).toString());
      assert.equal(toBN(result[1]).toString(), daiDecimals.toString());

      const amount = toBN(300);
      const expectedAmountInUSD = toBN(9000);

      assert.equal(amount.times(result[0]).idiv(toBN(10).pow(result[1])).toString(), expectedAmountInUSD.toString());
    });

    it("should get correct price if redirect to uniswap enabled", async () => {
      await priceManager.updateRedirectToUniswap(true);

      const wEthDecimals = toBN(18);

      const result = await priceManager.getPrice(wEthKey, wEthDecimals);

      assert.equal(toBN(result[0]).toString(), wEthPrice.times(toBN(10).pow(wEthDecimals)).toString());
      assert.equal(toBN(result[1]).toString(), wEthDecimals.toString());

      const amount = toBN(200);
      const expectedAmountInUSD = toBN(1800);

      assert.equal(amount.times(result[0]).idiv(toBN(10).pow(result[1])).toString(), expectedAmountInUSD.toString());
    });

    it("should get correct price from chainlink if asset key is the quote key", async () => {
      const daiDecimals = toBN(18);

      const result = await priceManager.getPrice(daiKey, daiDecimals);

      assert.equal(toBN(result[0]).toString(), daiChainlinkPrice.toString());
      assert.equal(toBN(result[1]).toString(), decimals.toString());

      const amount = toBN(200);
      const expectedAmountInUSD = toBN(200);

      assert.equal(amount.times(result[0]).idiv(toBN(10).pow(result[1])).toString(), expectedAmountInUSD.toString());
    });

    it("should get correct price from uniswap if asset key is the quote key", async () => {
      const daiDecimals = toBN(18);

      await daiChainlinkOracle.setPrice(0);

      const result = await priceManager.getPrice(daiKey, daiDecimals);

      assert.equal(toBN(result[0]).toString(), toBN(10).pow(daiDecimals).toString());
      assert.equal(toBN(result[1]).toString(), daiDecimals.toString());

      const amount = toBN(200);
      const expectedAmountInUSD = toBN(200);

      assert.equal(amount.times(result[0]).idiv(toBN(10).pow(result[1])).toString(), expectedAmountInUSD.toString());
    });
  });
});
