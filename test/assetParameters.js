const AssetParameters = artifacts.require("AssetParameters");
const SystemParameters = artifacts.require("SystemParameters");
const Registry = artifacts.require("Registry");
const LiquidityPool = artifacts.require("LiquidityPool");
const LiquidityPoolFactory = artifacts.require("LiquidityPoolFactory");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const MockERC20 = artifacts.require("MockERC20");
const DefiCore = artifacts.require("DefiCore");
const RewardsDistribution = artifacts.require("RewardsDistributionMock");
const GovernanceToken = artifacts.require("GovernanceToken");
const PriceManager = artifacts.require("PriceManagerMock");
const ChainlinkOracleMock = artifacts.require("ChainlinkOracleMock");
const AssetsRegistry = artifacts.require("AssetsRegistry");
const LiquidityPoolAdmin = artifacts.require("LiquidityPoolAdmin");
const LiquidityPoolRegistry = artifacts.require("LiquidityPoolRegistry");

const IntegrationCore = artifacts.require("IntegrationCore");
const BorrowerRouter = artifacts.require("BorrowerRouter");
const BorrowerRouterFactory = artifacts.require("BorrowerRouterFactory");
const BorrowerRouterRegistry = artifacts.require("BorrowerRouterRegistry");

const { toBytes, fromBytes, deepCompareKeys, compareKeys } = require("./helpers/bytesCompareLibrary");
const Reverter = require("./helpers/reverter");
const { assert } = require("chai");

const truffleAssert = require("truffle-assertions");

const { getInterestRateLibraryData } = require("../migrations/helpers/deployHelper");
const { toBN } = require("../scripts/globals");

contract("AssetParameters", async (accounts) => {
  const reverter = new Reverter(web3);

  const ADDRESS_NULL = "0x0000000000000000000000000000000000000000";

  const OWNER = accounts[0];
  const SOMEBODY = accounts[1];
  const USER1 = accounts[2];
  const USER2 = accounts[3];
  const NOTHING = accounts[8];
  const TEST_ASSET = accounts[9];

  const onePercent = toBN(10).pow(25);
  const decimal = onePercent.times(100);
  const colRatio = decimal.times("1.25");
  const oneToken = toBN(10).pow(18);
  const tokensAmount = oneToken.times(100000);
  const reserveFactor = onePercent.times("15");

  const firstSlope = onePercent.times(4);
  const secondSlope = decimal;
  const utilizationBreakingPoint = onePercent.times(80);
  const maxUR = onePercent.times(95);

  const liquidationDiscount = onePercent.times(8);

  const minSupplyDistributionPart = onePercent.times(15);
  const minBorrowDistributionPart = onePercent.times(10);

  let assetParameters;
  let defiCore;
  let registry;
  let rewardsDistribution;
  let priceManager;
  let liquidityPoolRegistry;

  const governanceTokenKey = toBytes("NDG");
  const daiKey = toBytes("DAI");

  async function getTokens(symbols) {
    const neededTokens = [];

    for (let i = 0; i < symbols.length; i++) {
      const token = await MockERC20.new("Mock" + symbols[i], symbols[i]);
      await token.mintArbitraryBatch([OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);

      neededTokens.push(token);
    }

    return neededTokens;
  }

  async function createLiquidityPool(assetKey, symbol, isCollateral) {
    const token = await MockERC20.new("Mock" + symbol, symbol);
    await token.mintArbitraryBatch([OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);

    const chainlinkOracle = await ChainlinkOracleMock.new(10, 8);

    await liquidityPoolRegistry.addLiquidityPool(
      token.address,
      assetKey,
      chainlinkOracle.address,
      NOTHING,
      symbol,
      isCollateral
    );

    await token.approveArbitraryBacth(
      await liquidityPoolRegistry.liquidityPools(assetKey),
      [OWNER, USER1, USER2],
      [tokensAmount, tokensAmount, tokensAmount]
    );

    await assetParameters.setupInterestRateModel(assetKey, 0, firstSlope, secondSlope, utilizationBreakingPoint);
    await assetParameters.setupMaxUtilizationRatio(assetKey, maxUR);

    await assetParameters.setupDistributionsMinimums(assetKey, minSupplyDistributionPart, minBorrowDistributionPart);

    await assetParameters.setupLiquidationDiscount(assetKey, liquidationDiscount);

    await assetParameters.setupColRatio(assetKey, colRatio);
    await assetParameters.setupReserveFactor(assetKey, reserveFactor);

    await priceManager.setPrice(assetKey, 100);

    return token;
  }

  async function deployGovernancePool(governanceTokenAddr, symbol) {
    await liquidityPoolRegistry.addLiquidityPool(
      governanceTokenAddr,
      governanceTokenKey,
      ADDRESS_NULL,
      NOTHING,
      symbol,
      true
    );

    await assetParameters.setupInterestRateModel(
      governanceTokenKey,
      0,
      firstSlope,
      secondSlope,
      utilizationBreakingPoint
    );
    await assetParameters.setupMaxUtilizationRatio(governanceTokenKey, maxUR);
    await assetParameters.setupDistributionsMinimums(
      governanceTokenKey,
      minSupplyDistributionPart,
      minBorrowDistributionPart
    );

    await assetParameters.setupColRatio(governanceTokenKey, colRatio);
    await assetParameters.setupReserveFactor(governanceTokenKey, reserveFactor);

    await priceManager.setPrice(governanceTokenKey, 10);

    await rewardsDistribution.setupRewardsPerBlockBatch([governanceTokenKey], [oneToken.times(2)]);
  }

  before("setup", async () => {
    const interestRateLibrary = await InterestRateLibrary.new(
      getInterestRateLibraryData("scripts/InterestRatesExactData.txt"),
      getInterestRateLibraryData("scripts/InterestRatesData.txt")
    );
    const governanceToken = await GovernanceToken.new(OWNER);

    registry = await Registry.new();
    const _defiCore = await DefiCore.new();
    const _systemParameters = await SystemParameters.new();
    const _assetParameters = await AssetParameters.new();
    const _liquidityPoolFactory = await LiquidityPoolFactory.new();
    const _rewardsDistribution = await RewardsDistribution.new();
    const _assetsRegistry = await AssetsRegistry.new();
    const _priceManager = await PriceManager.new();
    const _liquidityPoolAdmin = await LiquidityPoolAdmin.new();
    const _liquidityPoolImpl = await LiquidityPool.new();
    const _liquidityPoolRegistry = await LiquidityPoolRegistry.new();

    const _integrationCore = await IntegrationCore.new();
    const _borrowerRouterImpl = await BorrowerRouter.new();
    const _borrowerRouterFactory = await BorrowerRouterFactory.new();
    const _borrowerRouterRegistry = await BorrowerRouterRegistry.new();

    const daiToken = (await getTokens("DAI"))[0];

    await registry.addProxyContract(await registry.DEFI_CORE_NAME(), _defiCore.address);
    await registry.addProxyContract(await registry.ASSET_PARAMETERS_NAME(), _assetParameters.address);
    await registry.addProxyContract(await registry.SYSTEM_PARAMETERS_NAME(), _systemParameters.address);
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_FACTORY_NAME(), _liquidityPoolFactory.address);
    await registry.addProxyContract(await registry.REWARDS_DISTRIBUTION_NAME(), _rewardsDistribution.address);
    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), _priceManager.address);
    await registry.addProxyContract(await registry.ASSETS_REGISTRY_NAME(), _assetsRegistry.address);
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_ADMIN_NAME(), _liquidityPoolAdmin.address);
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_REGISTRY_NAME(), _liquidityPoolRegistry.address);

    await registry.addProxyContract(await registry.INTEGRATION_CORE_NAME(), _integrationCore.address);
    await registry.addProxyContract(await registry.BORROWER_ROUTER_FACTORY_NAME(), _borrowerRouterFactory.address);
    await registry.addProxyContract(await registry.BORROWER_ROUTER_REGISTRY_NAME(), _borrowerRouterRegistry.address);

    await registry.addContract(await registry.INTEREST_RATE_LIBRARY_NAME(), interestRateLibrary.address);
    await registry.addContract(await registry.GOVERNANCE_TOKEN_NAME(), governanceToken.address);

    defiCore = await DefiCore.at(await registry.getDefiCoreContract());
    assetParameters = await AssetParameters.at(await registry.getAssetParametersContract());
    rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());
    priceManager = await PriceManager.at(await registry.getPriceManagerContract());
    liquidityPoolRegistry = await LiquidityPoolRegistry.at(await registry.getLiquidityPoolRegistryContract());

    const systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());
    const liquidityPoolAdmin = await LiquidityPoolAdmin.at(await registry.getLiquidityPoolAdminContract());
    const borrowerRouterRegistry = await BorrowerRouterRegistry.at(await registry.getBorrowerRouterRegistryContract());

    await registry.injectDependencies(await registry.DEFI_CORE_NAME());
    await registry.injectDependencies(await registry.ASSET_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_FACTORY_NAME());
    await registry.injectDependencies(await registry.REWARDS_DISTRIBUTION_NAME());
    await registry.injectDependencies(await registry.ASSETS_REGISTRY_NAME());
    await registry.injectDependencies(await registry.PRICE_MANAGER_NAME());
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_ADMIN_NAME());
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_REGISTRY_NAME());

    await registry.injectDependencies(await registry.INTEGRATION_CORE_NAME());
    await registry.injectDependencies(await registry.BORROWER_ROUTER_FACTORY_NAME());
    await registry.injectDependencies(await registry.BORROWER_ROUTER_REGISTRY_NAME());

    await systemParameters.systemParametersInitialize();
    await liquidityPoolRegistry.liquidityPoolRegistryInitialize();
    await assetParameters.assetParametersInitialize();
    await rewardsDistribution.rewardsDistributionInitialize();
    await priceManager.priceManagerInitialize(daiKey, daiToken.address);
    await liquidityPoolAdmin.liquidityPoolAdminInitialize(_liquidityPoolImpl.address);
    await borrowerRouterRegistry.borrowerRouterRegistryInitialize(_borrowerRouterImpl.address);

    await deployGovernancePool(governanceToken.address, await governanceToken.symbol());

    await governanceToken.transfer(defiCore.address, tokensAmount.times(10));

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("isPoolFrozen", async () => {
    const assetKey = toBytes("SOME_ASSET");

    beforeEach("setup", async () => {
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, assetKey, NOTHING, NOTHING, "SOME_ASSET", true);
    });

    it("should return true if pool frozen", async () => {
      await assetParameters.freeze(assetKey);

      assert.equal(await assetParameters.isPoolFrozen(assetKey), true);
    });

    it("should return false if the pool is not frozen", async () => {
      assert.equal(await assetParameters.isPoolFrozen(assetKey), false);
    });
  });

  describe("isAvailableAsCollateral", async () => {
    const daiKey = toBytes("DAI");
    const wEthKey = toBytes("WETH");

    beforeEach("setup", async () => {
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, daiKey, NOTHING, NOTHING, "DAI", true);
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, wEthKey, NOTHING, NOTHING, "WETH", false);
    });

    it("should correctly return is asset collateral", async () => {
      const result1 = await assetParameters.isAvailableAsCollateral(daiKey);
      const result2 = await assetParameters.isAvailableAsCollateral(wEthKey);

      assert.equal(result1, true);
      assert.equal(result2, false);
    });

    it("should correctly return is asset collateral after changes", async () => {
      await assetParameters.enableCollateral(wEthKey);
      const result2 = await assetParameters.isAvailableAsCollateral(wEthKey);

      assert.equal(result2, true);
    });
  });

  describe("getInterestRateParams", async () => {
    const daiKey = toBytes("DAI");

    it("should return correct interest rate params", async () => {
      await createLiquidityPool(daiKey, "DAI", true);

      const params = await assetParameters.getInterestRateParams(daiKey);

      assert.equal(toBN(params.basePercentage).toString(), 0);
      assert.equal(toBN(params.firstSlope).toString(), firstSlope.toString());
      assert.equal(toBN(params.secondSlope).toString(), secondSlope.toString());
      assert.equal(toBN(params.utilizationBreakingPoint).toString(), utilizationBreakingPoint.toString());
    });
  });

  describe("getMaxUtilizationRatio", async () => {
    const daiKey = toBytes("DAI");

    it("should return correct max utilization ratio", async () => {
      await createLiquidityPool(daiKey, "DAI", true);

      assert.equal(toBN(await assetParameters.getMaxUtilizationRatio(daiKey)).toString(), maxUR.toString());
    });
  });

  describe("getLiquidationDiscount", async () => {
    const daiKey = toBytes("DAI");

    it("should return correct liquidation discount", async () => {
      await createLiquidityPool(daiKey, "DAI", true);

      assert.equal(
        toBN(await assetParameters.getLiquidationDiscount(daiKey)).toString(),
        liquidationDiscount.toString()
      );
    });
  });

  describe("getDistributionMinimums", async () => {
    const daiKey = toBytes("DAI");

    it("should return correct distribution minimums", async () => {
      await createLiquidityPool(daiKey, "DAI", true);

      const minimums = await assetParameters.getDistributionMinimums(daiKey);

      assert.equal(toBN(minimums[0]).toString(), minSupplyDistributionPart.toString());
      assert.equal(toBN(minimums[1]).toString(), minBorrowDistributionPart.toString());
    });
  });

  describe("getAssetPrice", async () => {
    const daiKey = toBytes("DAI");
    const usdtKey = toBytes("USDT");
    const wEthKey = toBytes("WETH");

    const priceDecimals = toBN(10).pow(8);

    beforeEach("setup", async () => {
      await createLiquidityPool(daiKey, "DAI", true);
      await createLiquidityPool(usdtKey, "USDT", true);
      await createLiquidityPool(wEthKey, "WETH", true);

      let chainlinkOracle = (await priceManager.priceFeeds(daiKey)).chainlinkOracle;
      await (await ChainlinkOracleMock.at(chainlinkOracle)).setPrice(0);

      chainlinkOracle = (await priceManager.priceFeeds(usdtKey)).chainlinkOracle;
      await (await ChainlinkOracleMock.at(chainlinkOracle)).setPrice(0);

      chainlinkOracle = (await priceManager.priceFeeds(wEthKey)).chainlinkOracle;
      await (await ChainlinkOracleMock.at(chainlinkOracle)).setPrice(0);
    });

    it("should return correct price for quote asset", async () => {
      assert.equal(toBN(await assetParameters.getAssetPrice(daiKey, 18)).toString(), priceDecimals.toString());
    });

    it("should return correct price for asset with 6 decimals", async () => {
      assert.equal(
        toBN(await assetParameters.getAssetPrice(usdtKey, 6)).toString(),
        priceDecimals.times(100).toString()
      );
    });

    it("should return correct price for asset with 18 decimals", async () => {
      assert.equal(
        toBN(await assetParameters.getAssetPrice(wEthKey, 18)).toString(),
        priceDecimals.times(100).toString()
      );
    });
  });

  describe("freeze", async () => {
    const paramKey = "SUPPLY";
    const paramKeyBytes = toBytes(paramKey);

    beforeEach("setup", async () => {
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, paramKeyBytes, NOTHING, NOTHING, paramKey, false);
    });

    it("should correctly freeze the pool", async () => {
      const result = await assetParameters.freeze(paramKeyBytes);

      assert.equal(result.logs.length, 1);

      assert.equal(result.logs[0].event, "BoolParamUpdated");

      assert.isTrue(compareKeys(result.logs[0].args._assetKey, paramKeyBytes));
      assert.equal(result.logs[0].args._newValue, true);
    });

    it("should not access to freeze the pool by not core", async () => {
      await truffleAssert.reverts(assetParameters.freeze(paramKeyBytes, { from: SOMEBODY }));
    });

    it("should not access to freeze pool of the not exists token", async () => {
      await truffleAssert.reverts(assetParameters.freeze(toBytes("SOME_KEY")));
    });
  });

  describe("enableCollateral", async () => {
    const assetKeyRow = "DAI";
    const assetKeyBytes = toBytes(assetKeyRow);

    beforeEach("setup", async () => {
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, assetKeyBytes, NOTHING, NOTHING, assetKeyRow, false);
    });

    it("should correctly freeze the asset", async () => {
      const result = await assetParameters.enableCollateral(assetKeyBytes);

      assert.equal(result.receipt.logs[0].event, "BoolParamUpdated");

      assert.equal(fromBytes(result.receipt.logs[0].args._assetKey), assetKeyRow);
      assert.equal(result.receipt.logs[0].args._paramKey, await assetParameters.ENABLE_COLLATERAL_KEY());
    });

    it("should get exception if not owner try to change collateral status", async () => {
      await truffleAssert.reverts(assetParameters.enableCollateral(assetKeyBytes, { from: SOMEBODY }));
    });
  });

  describe("setupInterestRateModel", async () => {
    const daiKey = toBytes("DAI");

    beforeEach("setup", async () => {
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, daiKey, NOTHING, NOTHING, "DAI", true);
    });

    it("should correct setup interest rate model", async () => {
      await assetParameters.setupInterestRateModel(daiKey, 0, firstSlope, secondSlope, utilizationBreakingPoint);

      const params = await assetParameters.getInterestRateParams(daiKey);

      assert.equal(toBN(params.basePercentage).toString(), 0);
      assert.equal(toBN(params.firstSlope).toString(), firstSlope.toString());
      assert.equal(toBN(params.secondSlope).toString(), secondSlope.toString());
      assert.equal(toBN(params.utilizationBreakingPoint).toString(), utilizationBreakingPoint.toString());
    });

    it("should get exception if base percentage is invalid", async () => {
      const reason = "AssetParameters: The new value of the base percentage is invalid.";

      await truffleAssert.reverts(
        assetParameters.setupInterestRateModel(
          daiKey,
          onePercent.times(4),
          firstSlope,
          secondSlope,
          utilizationBreakingPoint
        ),
        reason
      );
    });

    it("should get exception if first slope is invalid", async () => {
      const reason = "AssetParameters: The new value of the first slope is invalid.";

      await truffleAssert.reverts(
        assetParameters.setupInterestRateModel(daiKey, 0, onePercent.times(22), secondSlope, utilizationBreakingPoint),
        reason
      );
      await truffleAssert.reverts(
        assetParameters.setupInterestRateModel(daiKey, 0, onePercent.times(2), secondSlope, utilizationBreakingPoint),
        reason
      );
    });

    it("should get exception if second slope is invalid", async () => {
      const reason = "AssetParameters: The new value of the second slope is invalid.";

      await truffleAssert.reverts(
        assetParameters.setupInterestRateModel(daiKey, 0, firstSlope, onePercent.times(40), utilizationBreakingPoint),
        reason
      );
      await truffleAssert.reverts(
        assetParameters.setupInterestRateModel(daiKey, 0, firstSlope, onePercent.times(120), utilizationBreakingPoint),
        reason
      );
    });

    it("should get exception if the utilization breaking point is invalid", async () => {
      const reason = "AssetParameters: The new value of the utilization breaking point is invalid.";

      await truffleAssert.reverts(
        assetParameters.setupInterestRateModel(daiKey, 0, firstSlope, secondSlope, onePercent.times(55)),
        reason
      );
      await truffleAssert.reverts(
        assetParameters.setupInterestRateModel(daiKey, 0, firstSlope, secondSlope, onePercent.times(95)),
        reason
      );
    });
  });

  describe("setupMaxUtilizationRatio", async () => {
    const daiKey = toBytes("DAI");

    beforeEach("setup", async () => {
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, daiKey, NOTHING, NOTHING, "DAI", true);
    });

    it("should correct setup max utilization ratio", async () => {
      await assetParameters.setupMaxUtilizationRatio(daiKey, maxUR);

      assert.equal(toBN(await assetParameters.getMaxUtilizationRatio(daiKey)).toString(), maxUR.toString());
    });

    it("should get exception if max utilization ratio is invalid", async () => {
      const reason = "AssetParameters: The new value of the max utilization ratio is invalid.";

      await truffleAssert.reverts(assetParameters.setupMaxUtilizationRatio(daiKey, onePercent.times(90)), reason);
      await truffleAssert.reverts(assetParameters.setupMaxUtilizationRatio(daiKey, onePercent.times(99)), reason);
    });
  });

  describe("setupLiquidationDiscount", async () => {
    const daiKey = toBytes("DAI");

    beforeEach("setup", async () => {
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, daiKey, NOTHING, NOTHING, "DAI", true);
    });

    it("should correct setup liquidation discount", async () => {
      await assetParameters.setupLiquidationDiscount(daiKey, liquidationDiscount);

      assert.equal(
        toBN(await assetParameters.getLiquidationDiscount(daiKey)).toString(),
        liquidationDiscount.toString()
      );
    });

    it("should get exception if liquidation discount is invalid", async () => {
      const reason = "AssetParameters: The new value of the liquidation discount is invalid.";

      await truffleAssert.reverts(assetParameters.setupLiquidationDiscount(daiKey, onePercent.times(15)), reason);
    });
  });

  describe("setupDistributionsMinimums", async () => {
    const daiKey = toBytes("DAI");

    beforeEach("setup", async () => {
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, daiKey, NOTHING, NOTHING, "DAI", true);
    });

    it("should correct setup distribution minimums", async () => {
      await assetParameters.setupDistributionsMinimums(daiKey, minSupplyDistributionPart, minBorrowDistributionPart);

      const minimums = await assetParameters.getDistributionMinimums(daiKey);

      assert.equal(toBN(minimums[0]).toString(), minSupplyDistributionPart.toString());
      assert.equal(toBN(minimums[1]).toString(), minBorrowDistributionPart.toString());
    });

    it("should get exception if the minimum supply part is invalid", async () => {
      const reason = "AssetParameters: The new value of the minimum supply part is invalid.";

      await truffleAssert.reverts(
        assetParameters.setupDistributionsMinimums(daiKey, onePercent.times(2), minBorrowDistributionPart),
        reason
      );
      await truffleAssert.reverts(
        assetParameters.setupDistributionsMinimums(daiKey, onePercent.times(35), minBorrowDistributionPart),
        reason
      );
    });

    it("should get exception if the minimum borrow part is invalid", async () => {
      const reason = "AssetParameters: The new value of the minimum borrow part is invalid.";

      await truffleAssert.reverts(
        assetParameters.setupDistributionsMinimums(daiKey, minSupplyDistributionPart, onePercent.times(2)),
        reason
      );
      await truffleAssert.reverts(
        assetParameters.setupDistributionsMinimums(daiKey, minSupplyDistributionPart, onePercent.times(35)),
        reason
      );
    });
  });
});
