const { toBytes } = require("./helpers/bytesCompareLibrary");
const { toBN, accounts, wei } = require("../scripts/utils/utils");
const { ZERO_ADDR } = require("../scripts/utils/constants");

const truffleAssert = require("truffle-assertions");
const Reverter = require("./helpers/reverter");
const { artifacts } = require("hardhat");

const Registry = artifacts.require("Registry");
const PriceManager = artifacts.require("PriceManager");
const SystemPoolsRegistry = artifacts.require("SystemPoolsRegistryMock");
const ChainlinkOracle = artifacts.require("ChainlinkOracleMock");

describe("PriceManager", async () => {
  const reverter = new Reverter();

  let NOTHING;

  let registry;
  let priceManager;
  let systemPoolsRegistry;

  const daiKey = toBytes("DAI");
  const wEthKey = toBytes("WETH");

  before("setup", async () => {
    NOTHING = await accounts(8);
    LIQUIDITY_POOL_REGISTRY = await accounts(9);

    registry = await Registry.new();
    await registry.__OwnableContractsRegistry_init();

    const _priceManager = await PriceManager.new();
    systemPoolsRegistry = await SystemPoolsRegistry.new();

    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), _priceManager.address);

    await registry.addContract(await registry.SYSTEM_POOLS_REGISTRY_NAME(), systemPoolsRegistry.address);

    await registry.addContract(await registry.SYSTEM_PARAMETERS_NAME(), NOTHING);
    await registry.addContract(await registry.ASSET_PARAMETERS_NAME(), NOTHING);
    await registry.addContract(await registry.DEFI_CORE_NAME(), NOTHING);
    await registry.addContract(await registry.REWARDS_DISTRIBUTION_NAME(), NOTHING);
    await registry.addContract(await registry.SYSTEM_POOLS_FACTORY_NAME(), NOTHING);
    await registry.addContract(await registry.ROLE_MANAGER_NAME(), NOTHING);

    priceManager = await PriceManager.at(await registry.getPriceManagerContract());

    await registry.injectDependencies(await registry.PRICE_MANAGER_NAME());
    await registry.injectDependencies(await registry.SYSTEM_POOLS_REGISTRY_NAME());

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("setDependencies", () => {
    it("should revert if not called by injector", async () => {
      let reason = "Dependant: Not an injector";
      await truffleAssert.reverts(priceManager.setDependencies(registry.address), reason);
    });
  });

  describe("addOracle", () => {
    it("should correctly add new oracle", async () => {
      await systemPoolsRegistry.setPoolType(wEthKey, 0);

      const chainlinkOracle = await ChainlinkOracle.new(10, 1);
      await systemPoolsRegistry.addOracle(wEthKey, NOTHING, chainlinkOracle.address);

      const priceFeed = await priceManager.priceFeeds(wEthKey);

      assert.equal(priceFeed.assetAddr, NOTHING);
      assert.equal(priceFeed.chainlinkOracle, chainlinkOracle.address);
    });

    it("should correctly set null address oracle for stable pool", async () => {
      await systemPoolsRegistry.setPoolType(wEthKey, 1);

      await systemPoolsRegistry.addOracle(wEthKey, NOTHING, ZERO_ADDR);

      const priceFeed = await priceManager.priceFeeds(wEthKey);

      assert.equal(priceFeed.assetAddr, NOTHING);
      assert.equal(priceFeed.chainlinkOracle, ZERO_ADDR);
    });

    it("should get exception if try to add null address oracle for liquidity pool", async () => {
      await systemPoolsRegistry.setPoolType(wEthKey, 0);

      const reason = "PriceManager: The oracle must not be a null address.";

      await truffleAssert.reverts(systemPoolsRegistry.addOracle(wEthKey, NOTHING, ZERO_ADDR), reason);
    });

    it("should get exception if caller not a SystemPoolsRegistry contract", async () => {
      const reason = "PriceManager: Caller not a SystemPoolsRegistry.";

      await truffleAssert.reverts(priceManager.addOracle(wEthKey, NOTHING, NOTHING), reason);
    });
  });

  describe("getPrice", () => {
    const decimals = toBN(8);
    let wEthChainlinkPrice = wei(10, decimals);
    let wEthChainlinkOracle;

    beforeEach("setup", async () => {
      wEthChainlinkOracle = await ChainlinkOracle.new(wEthChainlinkPrice, decimals);

      await systemPoolsRegistry.setPoolType(wEthKey, 0);
      await systemPoolsRegistry.addOracle(wEthKey, NOTHING, wEthChainlinkOracle.address);
    });

    it("should get correct price from the chainlink oracle", async () => {
      const result = await priceManager.getPrice(wEthKey);

      assert.equal(toBN(result[0]).toString(), wEthChainlinkPrice.toString());
      assert.equal(toBN(result[1]).toString(), decimals.toString());

      const amount = toBN(200);
      const expectedAmountInUSD = toBN(2000);

      assert.equal(amount.times(result[0]).idiv(toBN(10).pow(result[1])).toString(), expectedAmountInUSD.toString());
    });

    it("should return correct price for stable pool from oracle", async () => {
      const daiChainlinkOracle = await ChainlinkOracle.new(wei(20, decimals), decimals);

      await systemPoolsRegistry.setPoolType(daiKey, 1);
      await systemPoolsRegistry.addOracle(daiKey, NOTHING, daiChainlinkOracle.address);

      const result = await priceManager.getPrice(daiKey);

      assert.equal(toBN(result[0]).toString(), wei(20, decimals).toString());
      assert.equal(toBN(result[1]).toString(), decimals.toString());

      const amount = toBN(200);
      const expectedAmountInUSD = toBN(4000);

      assert.equal(amount.times(result[0]).idiv(toBN(10).pow(result[1])).toString(), expectedAmountInUSD.toString());
    });

    it("should return correct price for stable pool without oracle", async () => {
      await systemPoolsRegistry.setPoolType(daiKey, 1);
      await systemPoolsRegistry.addOracle(daiKey, NOTHING, ZERO_ADDR);

      const result = await priceManager.getPrice(daiKey);

      assert.equal(toBN(result[0]).toString(), wei(1, decimals).toString());
      assert.equal(toBN(result[1]).toString(), decimals.toString());

      const amount = toBN(200);
      const expectedAmountInUSD = toBN(200);

      assert.equal(amount.times(result[0]).idiv(toBN(10).pow(result[1])).toString(), expectedAmountInUSD.toString());
    });

    it("should get exception if try to get price to unexisting asset", async () => {
      const reason = "PriceManager: The oracle for assets does not exists.";

      await truffleAssert.reverts(priceManager.getPrice(daiKey), reason);
    });
  });
});
