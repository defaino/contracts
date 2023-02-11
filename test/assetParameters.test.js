const { toBytes, fromBytes, compareKeys } = require("./helpers/bytesCompareLibrary");
const { getInterestRateLibraryAddr } = require("./helpers/coverage-helper");
const { toBN, accounts, wei, getPrecision, getPercentage100 } = require("../scripts/utils/utils");
const { ZERO_ADDR } = require("../scripts/utils/constants");

const truffleAssert = require("truffle-assertions");
const Reverter = require("./helpers/reverter");

const AssetParameters = artifacts.require("AssetParameters");
const SystemParameters = artifacts.require("SystemParameters");
const UserInfoRegistry = artifacts.require("UserInfoRegistry");
const Registry = artifacts.require("Registry");
const LiquidityPool = artifacts.require("LiquidityPool");
const StablePool = artifacts.require("StablePool");
const SystemPoolsFactory = artifacts.require("SystemPoolsFactory");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const MockERC20 = artifacts.require("MockERC20");
const DefiCore = artifacts.require("DefiCore");
const RewardsDistribution = artifacts.require("RewardsDistributionMock");
const PriceManager = artifacts.require("PriceManager");
const ChainlinkOracleMock = artifacts.require("ChainlinkOracleMock");
const SystemPoolsRegistry = artifacts.require("SystemPoolsRegistry");
const Prt = artifacts.require("PRT");

DefiCore.numberFormat = "BigNumber";
AssetParameters.numberFormat = "BigNumber";
SystemParameters.numberFormat = "BigNumber";
Registry.numberFormat = "BigNumber";
LiquidityPool.numberFormat = "BigNumber";
SystemPoolsFactory.numberFormat = "BigNumber";
SystemPoolsRegistry.numberFormat = "BigNumber";

describe("AssetParameters", () => {
  const reverter = new Reverter();

  const colRatio = getPercentage100().times("1.25");
  const tokensAmount = wei(1000);
  const reserveFactor = getPrecision().times("15");

  const firstSlope = getPrecision().times(4);
  const secondSlope = getPercentage100();
  const utilizationBreakingPoint = getPrecision().times(80);
  const maxUR = getPrecision().times(95);

  const liquidationDiscount = getPrecision().times(8);

  const minSupplyDistributionPart = getPrecision().times(15);
  const minBorrowDistributionPart = getPrecision().times(10);

  const zeroKey = toBytes("");
  const rewardsTokenKey = toBytes("RTK");
  const stableKey = toBytes("STK");
  const daiKey = toBytes("DAI");
  const wEthKey = toBytes("WETH");

  let OWNER;
  let SOMEBODY;
  let USER1;
  let USER2;
  let NOTHING;
  let TEST_ASSET;

  let systemParameters;
  let assetParameters;
  let registry;
  let rewardsDistribution;
  let systemPoolsRegistry;
  let rewardsToken;
  let prt;

  async function createLiquidityPool(assetKey, symbol, isCollateral) {
    const token = await MockERC20.new("Mock" + symbol, symbol);
    await token.mintArbitraryBatch([OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);

    const chainlinkOracle = await ChainlinkOracleMock.new(wei(100, 8), 8);

    await systemPoolsRegistry.addLiquidityPool(
      token.address,
      assetKey,
      chainlinkOracle.address,
      symbol,
      isCollateral,
      isCollateral
    );

    await token.approveArbitraryBatch(
      (
        await systemPoolsRegistry.poolsInfo(assetKey)
      )[0],
      [OWNER, USER1, USER2],
      [tokensAmount, tokensAmount, tokensAmount]
    );

    await assetParameters.setupAllParameters(assetKey, [
      [colRatio, colRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);

    return token;
  }

  async function deployRewardsPool(rewardsTokenAddr, symbol) {
    const chainlinkOracle = await ChainlinkOracleMock.new(wei(100, 8), 8);

    await systemPoolsRegistry.addLiquidityPool(
      rewardsTokenAddr,
      rewardsTokenKey,
      chainlinkOracle.address,
      symbol,
      true,
      true
    );

    await assetParameters.setupAllParameters(rewardsTokenKey, [
      [colRatio, colRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);
  }

  before("setup", async () => {
    OWNER = await accounts(0);
    SOMEBODY = await accounts(1);
    USER1 = await accounts(2);
    USER2 = await accounts(3);
    NOTHING = await accounts(8);
    TEST_ASSET = await accounts(9);

    const interestRateLibrary = await InterestRateLibrary.at(await getInterestRateLibraryAddr());
    rewardsToken = await MockERC20.new("MockRTK", "RTK");

    registry = await Registry.new();
    const _defiCore = await DefiCore.new();
    const _systemParameters = await SystemParameters.new();
    const _assetParameters = await AssetParameters.new();
    const _userInfoRegistry = await UserInfoRegistry.new();
    const _liquidityPoolFactory = await SystemPoolsFactory.new();
    const _rewardsDistribution = await RewardsDistribution.new();
    const _priceManager = await PriceManager.new();
    const _liquidityPoolImpl = await LiquidityPool.new();
    const _stablePoolImpl = await StablePool.new();
    const _systemPoolsRegistry = await SystemPoolsRegistry.new();
    const _prt = await Prt.new();

    await registry.__OwnableContractsRegistry_init();

    await registry.addProxyContract(await registry.DEFI_CORE_NAME(), _defiCore.address);
    await registry.addProxyContract(await registry.ASSET_PARAMETERS_NAME(), _assetParameters.address);
    await registry.addProxyContract(await registry.SYSTEM_PARAMETERS_NAME(), _systemParameters.address);
    await registry.addProxyContract(await registry.USER_INFO_REGISTRY_NAME(), _userInfoRegistry.address);
    await registry.addProxyContract(await registry.SYSTEM_POOLS_FACTORY_NAME(), _liquidityPoolFactory.address);
    await registry.addProxyContract(await registry.REWARDS_DISTRIBUTION_NAME(), _rewardsDistribution.address);
    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), _priceManager.address);
    await registry.addProxyContract(await registry.SYSTEM_POOLS_REGISTRY_NAME(), _systemPoolsRegistry.address);
    await registry.addProxyContract(await registry.PRT_NAME(), _prt.address);

    await registry.addContract(await registry.INTEREST_RATE_LIBRARY_NAME(), interestRateLibrary.address);

    systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());
    assetParameters = await AssetParameters.at(await registry.getAssetParametersContract());
    rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());
    systemPoolsRegistry = await SystemPoolsRegistry.at(await registry.getSystemPoolsRegistryContract());

    const defiCore = await DefiCore.at(await registry.getDefiCoreContract());

    await registry.injectDependencies(await registry.DEFI_CORE_NAME());
    await registry.injectDependencies(await registry.SYSTEM_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.ASSET_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.SYSTEM_POOLS_FACTORY_NAME());
    await registry.injectDependencies(await registry.REWARDS_DISTRIBUTION_NAME());
    await registry.injectDependencies(await registry.PRICE_MANAGER_NAME());
    await registry.injectDependencies(await registry.SYSTEM_POOLS_REGISTRY_NAME());
    await registry.injectDependencies(await registry.USER_INFO_REGISTRY_NAME());
    await registry.injectDependencies(await registry.PRT_NAME());

    await defiCore.defiCoreInitialize();
    await systemPoolsRegistry.systemPoolsRegistryInitialize(_liquidityPoolImpl.address, rewardsTokenKey, zeroKey);

    await systemPoolsRegistry.addPoolsBeacon(1, _stablePoolImpl.address);

    await systemParameters.setupStablePoolsAvailability(true);
    await systemParameters.setRewardsTokenAddress(ZERO_ADDR);

    await deployRewardsPool(rewardsToken.address, await rewardsToken.symbol());

    await rewardsToken.mintArbitrary(defiCore.address, tokensAmount.times(1000));

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("isPoolFrozen", () => {
    beforeEach("setup", async () => {
      await systemPoolsRegistry.addLiquidityPool(TEST_ASSET, daiKey, NOTHING, "DAI", true, true);
    });

    it("should return true if pool frozen", async () => {
      await assetParameters.freeze(daiKey);

      assert.equal(await assetParameters.isPoolFrozen(daiKey), true);
    });

    it("should return false if the pool is not frozen", async () => {
      assert.equal(await assetParameters.isPoolFrozen(daiKey), false);
    });
  });

  describe("isAvailableAsCollateral", () => {
    beforeEach("setup", async () => {
      await systemPoolsRegistry.addLiquidityPool(TEST_ASSET, daiKey, NOTHING, "DAI", true, true);
      await systemPoolsRegistry.addLiquidityPool(TEST_ASSET, wEthKey, NOTHING, "WETH", false, false);
    });

    it("should correctly return is asset collateral", async () => {
      const result1 = await assetParameters.isAvailableAsCollateral(daiKey, false);
      const result2 = await assetParameters.isAvailableAsCollateral(wEthKey, false);

      assert.equal(result1, true);
      assert.equal(result2, false);
    });

    it("should correctly return is asset collateral after changes", async () => {
      await assetParameters.enableCollateral(wEthKey, false);
      const result2 = await assetParameters.isAvailableAsCollateral(wEthKey, false);

      assert.equal(result2, true);
    });
  });

  describe("getInterestRateParams", () => {
    it("should return correct interest rate params", async () => {
      await createLiquidityPool(daiKey, "DAI", true);

      const params = await assetParameters.getInterestRateParams(daiKey);

      assert.equal(toBN(params.basePercentage).toString(), 0);
      assert.equal(toBN(params.firstSlope).toString(), firstSlope.toString());
      assert.equal(toBN(params.secondSlope).toString(), secondSlope.toString());
      assert.equal(toBN(params.utilizationBreakingPoint).toString(), utilizationBreakingPoint.toString());
    });
  });

  describe("getMaxUtilizationRatio", () => {
    it("should return correct max utilization ratio", async () => {
      await createLiquidityPool(daiKey, "DAI", true);

      assert.equal(toBN(await assetParameters.getMaxUtilizationRatio(daiKey)).toString(), maxUR.toString());
    });
  });

  describe("getLiquidationDiscount", () => {
    it("should return correct liquidation discount", async () => {
      await createLiquidityPool(daiKey, "DAI", true);

      assert.equal(
        toBN(await assetParameters.getLiquidationDiscount(daiKey)).toString(),
        liquidationDiscount.toString()
      );
    });
  });

  describe("getDistributionMinimums", () => {
    it("should return correct distribution minimums", async () => {
      await createLiquidityPool(daiKey, "DAI", true);

      const minimums = await assetParameters.getDistributionMinimums(daiKey);

      assert.equal(toBN(minimums.minSupplyDistrPart).toString(), minSupplyDistributionPart.toString());
      assert.equal(toBN(minimums.minBorrowDistrPart).toString(), minBorrowDistributionPart.toString());
    });
  });

  describe("freeze", () => {
    beforeEach("setup", async () => {
      await systemPoolsRegistry.addLiquidityPool(TEST_ASSET, daiKey, NOTHING, "DAI", false, false);
    });

    it("should correctly freeze the pool", async () => {
      const result = await assetParameters.freeze(daiKey);

      assert.equal(result.logs.length, 1);

      assert.equal(result.logs[0].event, "FreezeParamUpdated");

      assert.isTrue(compareKeys(result.logs[0].args.assetKey, daiKey));
      assert.equal(result.logs[0].args.newValue, true);
    });

    it("should not access to freeze the pool by not core", async () => {
      await truffleAssert.reverts(assetParameters.freeze(daiKey, { from: SOMEBODY }));
    });

    it("should not access to freeze pool of the not exists token", async () => {
      await truffleAssert.reverts(assetParameters.freeze(toBytes("SOME_KEY")));
    });
  });

  describe("enableCollateral", () => {
    beforeEach("setup", async () => {
      await systemPoolsRegistry.addLiquidityPool(TEST_ASSET, daiKey, NOTHING, "DAI", false, false);
    });

    it("should correctly freeze the asset", async () => {
      const result = await assetParameters.enableCollateral(daiKey, false);

      assert.equal(result.receipt.logs[0].event, "CollateralParamUpdated");

      assert.equal(fromBytes(result.receipt.logs[0].args.assetKey), "DAI");
      assert.equal(result.receipt.logs[0].args.isCollateral, true);
    });

    it("should get exception if not owner try to change collateral status", async () => {
      await truffleAssert.reverts(assetParameters.enableCollateral(daiKey, false, { from: SOMEBODY }));
    });
  });

  describe("setupInterestRateModel", () => {
    beforeEach("setup", async () => {
      await systemPoolsRegistry.addLiquidityPool(TEST_ASSET, daiKey, NOTHING, "DAI", true, true);
    });

    it("should correct setup interest rate model", async () => {
      await assetParameters.setupInterestRateModel(daiKey, [0, firstSlope, secondSlope, utilizationBreakingPoint]);

      const params = await assetParameters.getInterestRateParams(daiKey);

      assert.equal(toBN(params.basePercentage).toString(), 0);
      assert.equal(toBN(params.firstSlope).toString(), firstSlope.toString());
      assert.equal(toBN(params.secondSlope).toString(), secondSlope.toString());
      assert.equal(toBN(params.utilizationBreakingPoint).toString(), utilizationBreakingPoint.toString());
    });

    it("should get exception if base percentage is invalid", async () => {
      const reason = "AssetParameters: The new value of the base percentage is invalid.";

      await truffleAssert.reverts(
        assetParameters.setupInterestRateModel(daiKey, [
          getPrecision().times(4),
          firstSlope,
          secondSlope,
          utilizationBreakingPoint,
        ]),
        reason
      );
    });

    it("should get exception if first slope is invalid", async () => {
      const reason = "AssetParameters: The new value of the first slope is invalid.";

      await truffleAssert.reverts(
        assetParameters.setupInterestRateModel(daiKey, [
          0,
          getPrecision().times(22),
          secondSlope,
          utilizationBreakingPoint,
        ]),
        reason
      );
      await truffleAssert.reverts(
        assetParameters.setupInterestRateModel(daiKey, [
          0,
          getPrecision().times(2),
          secondSlope,
          utilizationBreakingPoint,
        ]),
        reason
      );
    });

    it("should get exception if second slope is invalid", async () => {
      const reason = "AssetParameters: The new value of the second slope is invalid.";

      await truffleAssert.reverts(
        assetParameters.setupInterestRateModel(daiKey, [
          0,
          firstSlope,
          getPrecision().times(40),
          utilizationBreakingPoint,
        ]),
        reason
      );
      await truffleAssert.reverts(
        assetParameters.setupInterestRateModel(daiKey, [
          0,
          firstSlope,
          getPrecision().times(120),
          utilizationBreakingPoint,
        ]),
        reason
      );
    });

    it("should get exception if the utilization breaking point is invalid", async () => {
      const reason = "AssetParameters: The new value of the utilization breaking point is invalid.";

      await truffleAssert.reverts(
        assetParameters.setupInterestRateModel(daiKey, [0, firstSlope, secondSlope, getPrecision().times(55)]),
        reason
      );
      await truffleAssert.reverts(
        assetParameters.setupInterestRateModel(daiKey, [0, firstSlope, secondSlope, getPrecision().times(95)]),
        reason
      );
    });
  });

  describe("setupMainParameters", () => {
    beforeEach("setup", async () => {
      await systemPoolsRegistry.addLiquidityPool(TEST_ASSET, daiKey, NOTHING, "DAI", true, true);
    });

    it("should correct setup main parameters", async () => {
      await assetParameters.setupMainParameters(daiKey, [
        colRatio,
        colRatio,
        reserveFactor,
        liquidationDiscount,
        maxUR,
      ]);

      assert.equal((await assetParameters.getColRatio(daiKey, false)).toString(), colRatio.toString());
      assert.equal((await assetParameters.getReserveFactor(daiKey)).toString(), reserveFactor.toString());
      assert.equal((await assetParameters.getLiquidationDiscount(daiKey)).toString(), liquidationDiscount.toString());
      assert.equal((await assetParameters.getMaxUtilizationRatio(daiKey)).toString(), maxUR.toString());
    });

    it("should get exception if max utilization ratio is invalid", async () => {
      const reason = "AssetParameters: The new value of the max utilization ratio is invalid.";

      await truffleAssert.reverts(
        assetParameters.setupMainParameters(daiKey, [
          colRatio,
          colRatio,
          reserveFactor,
          liquidationDiscount,
          getPrecision().times(90),
        ]),
        reason
      );
    });

    it("should get exception if liquidation discount is invalid", async () => {
      const reason = "AssetParameters: The new value of the liquidation discount is invalid.";

      await truffleAssert.reverts(
        assetParameters.setupMainParameters(daiKey, [
          colRatio,
          colRatio,
          reserveFactor,
          getPrecision().times(15),
          maxUR,
        ]),
        reason
      );
    });

    it("should get exception if collateralization ratio is invalid", async () => {
      const reason = "AssetParameters: The new value of the collateralization ratio is invalid.";

      await truffleAssert.reverts(
        assetParameters.setupMainParameters(daiKey, [
          getPrecision().times(90),
          getPrecision().times(90),
          reserveFactor,
          liquidationDiscount,
          maxUR,
        ]),
        reason
      );
      await truffleAssert.reverts(
        assetParameters.setupMainParameters(daiKey, [
          getPrecision().times(201),
          getPrecision().times(201),
          reserveFactor,
          liquidationDiscount,
          maxUR,
        ]),
        reason
      );
    });

    it("should get exception if reserve factor is invalid", async () => {
      const reason = "AssetParameters: The new value of the reserve factor is invalid.";

      await truffleAssert.reverts(
        assetParameters.setupMainParameters(daiKey, [
          colRatio,
          colRatio,
          getPrecision().times(7),
          liquidationDiscount,
          maxUR,
        ]),
        reason
      );
    });
  });

  describe("setupDistributionsMinimums", () => {
    beforeEach("setup", async () => {
      await systemPoolsRegistry.addLiquidityPool(TEST_ASSET, daiKey, NOTHING, "DAI", true, true);
    });

    it("should correct setup distribution minimums", async () => {
      await assetParameters.setupDistributionsMinimums(daiKey, [minSupplyDistributionPart, minBorrowDistributionPart]);

      const minimums = await assetParameters.getDistributionMinimums(daiKey);

      assert.equal(toBN(minimums[0]).toString(), minSupplyDistributionPart.toString());
      assert.equal(toBN(minimums[1]).toString(), minBorrowDistributionPart.toString());
    });

    it("should get exception if the minimum supply part is invalid", async () => {
      const reason = "AssetParameters: The new value of the minimum supply part is invalid.";

      await truffleAssert.reverts(
        assetParameters.setupDistributionsMinimums(daiKey, [getPrecision().times(2), minBorrowDistributionPart]),
        reason
      );
      await truffleAssert.reverts(
        assetParameters.setupDistributionsMinimums(daiKey, [getPrecision().times(35), minBorrowDistributionPart]),
        reason
      );
    });

    it("should get exception if the minimum borrow part is invalid", async () => {
      const reason = "AssetParameters: The new value of the minimum borrow part is invalid.";

      await truffleAssert.reverts(
        assetParameters.setupDistributionsMinimums(daiKey, [minSupplyDistributionPart, getPrecision().times(2)]),
        reason
      );
      await truffleAssert.reverts(
        assetParameters.setupDistributionsMinimums(daiKey, [minSupplyDistributionPart, getPrecision().times(35)]),
        reason
      );
    });
  });

  describe("setupAnnualBorrowRate", () => {
    const annualBorrowRate = getPrecision().times(2);

    beforeEach("setup", async () => {
      await systemPoolsRegistry.addLiquidityPool(TEST_ASSET, daiKey, NOTHING, "DAI", true, true);
      await systemPoolsRegistry.addStablePool(TEST_ASSET, stableKey, ZERO_ADDR);
    });

    it("should correctly set annual rate for stable pool", async () => {
      await assetParameters.setupAnnualBorrowRate(stableKey, annualBorrowRate);

      assert.equal((await assetParameters.getAnnualBorrowRate(stableKey)).toString(), annualBorrowRate.toString());
    });

    it("should get exception if stable pools unavailable", async () => {
      await systemParameters.setupStablePoolsAvailability(false);

      const reason = "AssetParameters: Stable pools unavailable.";

      await truffleAssert.reverts(assetParameters.setupAnnualBorrowRate(stableKey, annualBorrowRate), reason);
    });

    it("should get exception if try to set rate to nonstable pool", async () => {
      const reason = "AssetParameters: Incorrect pool type.";

      await truffleAssert.reverts(assetParameters.setupAnnualBorrowRate(daiKey, annualBorrowRate), reason);
    });

    it("should get exception if new annual borrow rate bigger than max possible", async () => {
      const newRate = getPrecision().times(30);

      const reason = "AssetParameters: Annual borrow rate is higher than possible.";

      await truffleAssert.reverts(assetParameters.setupAnnualBorrowRate(stableKey, newRate), reason);
    });
  });

  describe("setPoolInitParams", () => {
    it("should correctly set init pool parameters", async () => {
      const reason = "AssetParameters: Param for this asset doesn't exist.";

      await truffleAssert.reverts(assetParameters.isAvailableAsCollateral(daiKey, false), reason);
      await truffleAssert.reverts(assetParameters.isPoolFrozen(daiKey), reason);

      await systemPoolsRegistry.addLiquidityPool(TEST_ASSET, daiKey, NOTHING, "DAI", true, true);

      assert.equal(await assetParameters.isAvailableAsCollateral(daiKey, false), true);
      assert.equal(await assetParameters.isPoolFrozen(daiKey), false);
    });

    it("should get exception if caller not a SystemPoolsRegistry contrac", async () => {
      const reason = "AssetParameters: Caller not a SystemPoolsRegistry.";

      await truffleAssert.reverts(assetParameters.setPoolInitParams(daiKey, true, true), reason);
    });
  });
});
