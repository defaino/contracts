const { toBytes } = require("./helpers/bytesCompareLibrary");
const { getCurrentBlockTime, setNextBlockTime } = require("./helpers/block-helper");
const { getInterestRateLibraryAddr } = require("./helpers/coverage-helper");
const { toBN, accounts, getPrecision, getPercentage100, wei } = require("../scripts/utils/utils");
const { ZERO_ADDR } = require("../scripts/utils/constants");

const Reverter = require("./helpers/reverter");

const Registry = artifacts.require("Registry");
const DefiCore = artifacts.require("DefiCore");
const SystemParameters = artifacts.require("SystemParameters");
const AssetParameters = artifacts.require("AssetParameters");
const RewardsDistribution = artifacts.require("RewardsDistributionMock");
const UserInfoRegistry = artifacts.require("UserInfoRegistry");
const SystemPoolsRegistry = artifacts.require("SystemPoolsRegistry");
const SystemPoolsFactory = artifacts.require("SystemPoolsFactory");
const LiquidityPool = artifacts.require("LiquidityPool");
const StablePool = artifacts.require("StablePool");
const PriceManager = artifacts.require("PriceManager");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const WETH = artifacts.require("WETH");
const StablePermitToken = artifacts.require("StablePermitTokenMock");

const MockERC20 = artifacts.require("MockERC20");
const ChainlinkOracleMock = artifacts.require("ChainlinkOracleMock");

StablePermitToken.numberFormat = "BigNumber";
StablePool.numberFormat = "BigNumber";
DefiCore.numberFormat = "BigNumber";

describe("StablePool", async () => {
  const reverter = new Reverter();

  let OWNER;
  let USER1;

  let registry;
  let defiCore;
  let assetParameters;
  let systemPoolsRegistry;
  let stableToken;

  let stablePool;

  const tokens = [];

  const annualBorrowRate = getPrecision().times(3);

  const tokensAmount = wei(5000);
  const standardColRatio = getPercentage100().times("1.25");
  const reserveFactor = getPrecision().times("15");

  const firstSlope = getPrecision().times(4);
  const secondSlope = getPercentage100();
  const utilizationBreakingPoint = getPrecision().times(80);
  const maxUR = getPrecision().times(95);
  const liquidationDiscount = getPrecision().times(8);
  const liquidationBoundary = getPrecision().times(50);

  const minSupplyDistributionPart = getPrecision().times(10);
  const minBorrowDistributionPart = getPrecision().times(10);

  const chainlinkPriceDecimals = toBN(8);

  const rewardsTokenKey = toBytes("RTK");
  const nativeTokenKey = toBytes("BNB");
  const daiKey = toBytes("DAI");
  const stableKey = toBytes("ST");

  async function getPoolAddr(assetKey) {
    return (await systemPoolsRegistry.poolsInfo(assetKey))[0];
  }

  async function deployTokens(symbols) {
    for (let i = 0; i < symbols.length; i++) {
      const token = await MockERC20.new("Mock" + symbols[i], symbols[i]);
      await token.mintArbitraryBatch([OWNER, USER1], [tokensAmount, tokensAmount]);

      tokens.push(token);
    }
  }

  async function createLiquidityPool(assetKey, asset, symbol, isCollateral) {
    const chainlinkOracle = await ChainlinkOracleMock.new(wei(100, chainlinkPriceDecimals), chainlinkPriceDecimals);

    await systemPoolsRegistry.addLiquidityPool(asset.address, assetKey, chainlinkOracle.address, symbol, isCollateral);

    if (assetKey != nativeTokenKey) {
      await asset.approveArbitraryBacth(await getPoolAddr(assetKey), [OWNER, USER1], [tokensAmount, tokensAmount]);
    }

    await assetParameters.setupAllParameters(assetKey, [
      [standardColRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);

    return chainlinkOracle;
  }

  async function createStablePool(assetKey, assetAddr) {
    await systemPoolsRegistry.addStablePool(assetAddr, assetKey, ZERO_ADDR);

    await assetParameters.setupAnnualBorrowRate(assetKey, annualBorrowRate);
    await assetParameters.setupMainParameters(assetKey, [standardColRatio, reserveFactor, liquidationDiscount, maxUR]);
  }

  async function deployGovernancePool(rewardsTokenAddr, symbol) {
    const chainlinkOracle = await ChainlinkOracleMock.new(wei(100, chainlinkPriceDecimals), chainlinkPriceDecimals);

    await systemPoolsRegistry.addLiquidityPool(
      rewardsTokenAddr,
      rewardsTokenKey,
      chainlinkOracle.address,
      symbol,
      true
    );

    await assetParameters.setupAllParameters(rewardsTokenKey, [
      [standardColRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);
  }

  before("setup", async () => {
    OWNER = await accounts(0);
    USER1 = await accounts(1);

    const rewardsToken = await MockERC20.new("MockRTK", "RTK");
    const nativeToken = await WETH.new();

    const interestRateLibrary = await InterestRateLibrary.at(await getInterestRateLibraryAddr());

    registry = await Registry.new();
    const _defiCore = await DefiCore.new();
    const _systemParameters = await SystemParameters.new();
    const _assetParameters = await AssetParameters.new();
    const _rewardsDistribution = await RewardsDistribution.new();
    const _userInfoRegistry = await UserInfoRegistry.new();
    const _systemPoolsRegistry = await SystemPoolsRegistry.new();
    const _liquidityPoolFactory = await SystemPoolsFactory.new();
    const _liquidityPoolImpl = await LiquidityPool.new();
    const _stablePoolImpl = await StablePool.new();
    const _priceManager = await PriceManager.new();

    await registry.__OwnableContractsRegistry_init();

    stableToken = await StablePermitToken.new("Stable Token", "ST", registry.address);

    await registry.addProxyContract(await registry.DEFI_CORE_NAME(), _defiCore.address);
    await registry.addProxyContract(await registry.SYSTEM_PARAMETERS_NAME(), _systemParameters.address);
    await registry.addProxyContract(await registry.ASSET_PARAMETERS_NAME(), _assetParameters.address);
    await registry.addProxyContract(await registry.REWARDS_DISTRIBUTION_NAME(), _rewardsDistribution.address);
    await registry.addProxyContract(await registry.USER_INFO_REGISTRY_NAME(), _userInfoRegistry.address);
    await registry.addProxyContract(await registry.SYSTEM_POOLS_REGISTRY_NAME(), _systemPoolsRegistry.address);
    await registry.addProxyContract(await registry.SYSTEM_POOLS_FACTORY_NAME(), _liquidityPoolFactory.address);
    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), _priceManager.address);

    await registry.addContract(await registry.INTEREST_RATE_LIBRARY_NAME(), interestRateLibrary.address);

    defiCore = await DefiCore.at(await registry.getDefiCoreContract());
    assetParameters = await AssetParameters.at(await registry.getAssetParametersContract());
    systemPoolsRegistry = await SystemPoolsRegistry.at(await registry.getSystemPoolsRegistryContract());
    const systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());
    const rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());

    await registry.injectDependencies(await registry.DEFI_CORE_NAME());
    await registry.injectDependencies(await registry.SYSTEM_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.ASSET_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.REWARDS_DISTRIBUTION_NAME());
    await registry.injectDependencies(await registry.USER_INFO_REGISTRY_NAME());
    await registry.injectDependencies(await registry.SYSTEM_POOLS_REGISTRY_NAME());
    await registry.injectDependencies(await registry.SYSTEM_POOLS_FACTORY_NAME());
    await registry.injectDependencies(await registry.PRICE_MANAGER_NAME());

    tokens.push(rewardsToken.address, stableToken.address);
    await deployTokens(["DAI"]);
    tokens.push(nativeToken);

    await defiCore.defiCoreInitialize();
    await systemPoolsRegistry.systemPoolsRegistryInitialize(
      _liquidityPoolImpl.address,
      nativeTokenKey,
      rewardsTokenKey
    );

    await systemPoolsRegistry.addPoolsBeacon(1, _stablePoolImpl.address);

    await systemParameters.setupLiquidationBoundary(liquidationBoundary);
    await systemParameters.setupStablePoolsAvailability(true);
    await systemParameters.setRewardsTokenAddress(rewardsToken.address);

    await deployGovernancePool(rewardsToken.address, await rewardsToken.symbol());
    await createStablePool(stableKey, stableToken.address);
    await createLiquidityPool(daiKey, tokens[2], "DAI", true);
    await createLiquidityPool(nativeTokenKey, tokens[3], "BNB", true);

    stablePool = await StablePool.at(await getPoolAddr(stableKey));

    await rewardsDistribution.setupRewardsPerBlockBatch(
      [daiKey, rewardsTokenKey, stableKey, nativeTokenKey],
      [wei(2), wei(1), wei(0.5), wei(1)]
    );

    await rewardsToken.mintArbitrary(defiCore.address, tokensAmount);

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("getAnnualBorrowRate", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);
    const oneYear = toBN(31536000);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(stableKey, borrowAmount, USER1, { from: USER1 });
    });

    it("should return correct annual borrow rate", async () => {
      assert.equal((await stablePool.getAnnualBorrowRate()).toString(), annualBorrowRate.toString());
    });

    it("should correct count percents with fixed rate", async () => {
      const startBorrowAmount = await defiCore.getUserBorrowedAmount(USER1, stableKey);
      assert.closeTo(startBorrowAmount.toNumber(), borrowAmount.toNumber(), wei(0.001).toNumber());

      await setNextBlockTime(
        toBN(await getCurrentBlockTime())
          .plus(oneYear)
          .toNumber()
      );

      await defiCore.updateCompoundRate(stableKey, true);

      const endBorrowAmount = await defiCore.getUserBorrowedAmount(USER1, stableKey);

      assert.closeTo(
        endBorrowAmount.times(getPercentage100()).idiv(startBorrowAmount).toNumber(),
        getPercentage100().plus(annualBorrowRate).toNumber(),
        getPrecision().idiv(10000).toNumber()
      );
    });

    it("should correct count percents with fixed rate after changing rate param", async () => {
      const startBorrowAmount = await defiCore.getUserBorrowedAmount(USER1, stableKey);
      assert.closeTo(startBorrowAmount.toNumber(), borrowAmount.toNumber(), wei(0.001).toNumber());

      await setNextBlockTime(
        toBN(await getCurrentBlockTime())
          .plus(oneYear)
          .toNumber()
      );

      const newRate = getPrecision().times(5);
      await assetParameters.setupAnnualBorrowRate(stableKey, newRate);

      await defiCore.updateCompoundRate(stableKey, true);

      const endBorrowAmount = await defiCore.getUserBorrowedAmount(USER1, stableKey);

      assert.closeTo(
        endBorrowAmount.times(getPercentage100()).idiv(startBorrowAmount).toNumber(),
        getPercentage100().plus(annualBorrowRate).toNumber(),
        getPrecision().idiv(10000).toNumber()
      );
    });
  });

  describe("borrowFor", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(500);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
    });

    it("should correctly borrow from stable pool", async () => {
      await defiCore.borrowFor(stableKey, borrowAmount, USER1, { from: USER1 });

      assert.equal((await defiCore.getUserBorrowedAmount(USER1, stableKey)).toString(), borrowAmount.toString());
      assert.equal(
        (await defiCore.getTotalBorrowBalanceInUSD(USER1)).toString(),
        wei(500, chainlinkPriceDecimals).toString()
      );
      assert.equal((await stableToken.balanceOf(USER1)).toString(), borrowAmount.toString());
    });

    it("should correctly borrow from stable pool if stable token has 8 decimals", async () => {
      const newDecimals = 8;

      await stableToken.setDecimals(newDecimals);

      await defiCore.borrowFor(stableKey, borrowAmount, USER1, { from: USER1 });

      assert.equal((await defiCore.getUserBorrowedAmount(USER1, stableKey)).toString(), borrowAmount);
      assert.equal(
        (await defiCore.getTotalBorrowBalanceInUSD(USER1)).toString(),
        wei(500, chainlinkPriceDecimals).toString()
      );
      assert.equal((await stableToken.balanceOf(USER1)).toString(), wei(500, newDecimals).toString());
    });
  });

  describe("repayBorrow", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(500);
    const repayAmount = wei(250);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount);
      await defiCore.borrowFor(stableKey, borrowAmount, USER1, { from: USER1 });
    });

    it("should correctly repay borrow from stable pool", async () => {
      await defiCore.repayBorrow(stableKey, repayAmount, false, { from: USER1 });

      assert.closeTo(
        (await defiCore.getUserBorrowedAmount(USER1, stableKey)).toNumber(),
        borrowAmount.minus(repayAmount).toNumber(),
        wei(1).idiv(1000).toNumber()
      );

      const expectedTotalBorrowBalance = wei(borrowAmount.minus(repayAmount).idiv(wei(1)), chainlinkPriceDecimals);

      assert.closeTo(
        (await defiCore.getTotalBorrowBalanceInUSD(USER1)).toNumber(),
        expectedTotalBorrowBalance.toNumber(),
        wei(1).idiv(1000).toNumber()
      );
      assert.equal((await stableToken.balanceOf(USER1)).toString(), borrowAmount.minus(repayAmount).toString());

      await defiCore.borrowFor(stableKey, borrowAmount, USER1);

      const currentDebt = await defiCore.getUserBorrowedAmount(USER1, stableKey);
      const currentBalance = await stableToken.balanceOf(USER1);

      await defiCore.repayBorrow(stableKey, 0, true, { from: USER1 });

      assert.equal((await defiCore.getUserBorrowedAmount(USER1, stableKey)).toString(), 0);
      assert.equal((await defiCore.getTotalBorrowBalanceInUSD(USER1)).toString(), 0);
      assert.closeTo(
        (await stableToken.balanceOf(USER1)).toNumber(),
        currentBalance.minus(currentDebt).toNumber(),
        wei(1).idiv(10000).toNumber()
      );
    });

    it("should correctly repay borrow from stable pool with 8 decimals", async () => {
      const newDecimals = 8;

      await stableToken.setDecimals(newDecimals);

      await defiCore.borrowFor(stableKey, borrowAmount, OWNER, { from: OWNER });
      await defiCore.repayBorrow(stableKey, repayAmount, false, { from: OWNER });

      const expectedTotalBorrowBalance = wei(borrowAmount.minus(repayAmount).idiv(wei(1)), chainlinkPriceDecimals);

      assert.closeTo(
        (await defiCore.getTotalBorrowBalanceInUSD(USER1)).toNumber(),
        expectedTotalBorrowBalance.toNumber(),
        wei(1).idiv(1000).toNumber()
      );
      assert.equal((await stableToken.balanceOf(OWNER)).toString(), wei(250, newDecimals).toString());

      await stableToken.transfer(OWNER, wei(500, newDecimals), { from: USER1 });
      await defiCore.repayBorrow(stableKey, 0, true, { from: OWNER });

      assert.equal((await defiCore.getUserBorrowedAmount(OWNER, stableKey)).toString(), 0);
      assert.equal((await defiCore.getTotalBorrowBalanceInUSD(OWNER)).toString(), 0);
      assert.closeTo(
        (await stableToken.balanceOf(OWNER)).toNumber(),
        wei(500, newDecimals).toNumber(),
        wei(1).idiv(10000).toNumber()
      );
    });
  });
});
