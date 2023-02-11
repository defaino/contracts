const { setNextBlockTime, setTime, mine, getCurrentBlockTime } = require("./helpers/block-helper");
const { toBytes, compareKeys, deepCompareKeys } = require("./helpers/bytesCompareLibrary");
const { getInterestRateLibraryAddr } = require("./helpers/coverage-helper");
const { toBN, accounts, getPrecision, getPercentage100, wei } = require("../scripts/utils/utils");
const { ZERO_ADDR } = require("../scripts/utils/constants");

const Reverter = require("./helpers/reverter");
const truffleAssert = require("truffle-assertions");
const { web3 } = require("hardhat");
const { assert } = require("chai");

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
const Prt = artifacts.require("PRT");

const MockERC20 = artifacts.require("MockERC20");
const ChainlinkOracleMock = artifacts.require("ChainlinkOracleMock");

MockERC20.numberFormat = "BigNumber";
DefiCore.numberFormat = "BigNumber";
LiquidityPool.numberFormat = "BigNumber";
UserInfoRegistry.numberFormat = "BigNumber";

describe("DefiCore", async () => {
  const reverter = new Reverter();

  let OWNER;
  let USER1;
  let USER2;

  let registry;
  let defiCore;
  let assetParameters;
  let systemParameters;
  let rewardsDistribution;
  let userInfoRegistry;
  let systemPoolsRegistry;
  let prt;

  let nativePool;
  let daiPool;
  let wEthPool;
  let usdtPool;

  const tokens = [];

  let daiChainlinkOracle;
  let wEthChainlinkOracle;
  let usdtChainlinkOracle;

  let rewardsToken;
  let nativeToken;

  const oneToken = wei(1);
  const tokensAmount = wei(5000);
  const standardColRatio = getPercentage100().times("1.25");
  const reserveFactor = getPrecision().times("15");

  const annualBorrowRate = getPrecision().times(3);
  const firstSlope = getPrecision().times(4);
  const secondSlope = getPercentage100();
  const utilizationBreakingPoint = getPrecision().times(80);
  const maxUR = getPrecision().times(95);
  const liquidationDiscount = getPrecision().times(8);
  const liquidationBoundary = getPrecision().times(50);
  const minCurrencyAmount = wei(0.1);

  const priceDecimals = wei(1, 8);
  const chainlinkPriceDecimals = toBN(8);

  const minSupplyDistributionPart = getPrecision().times(10);
  const minBorrowDistributionPart = getPrecision().times(10);

  const zeroKey = toBytes("");
  const daiKey = toBytes("DAI");
  const wEthKey = toBytes("WETH");
  const usdtKey = toBytes("USDT");
  const rewardsTokenKey = toBytes("RTK");
  const nativeTokenKey = toBytes("BNB");
  const stableKey = toBytes("ST");

  async function getLiquidityPoolAddr(assetKey) {
    return (await systemPoolsRegistry.poolsInfo(assetKey))[0];
  }

  async function deployTokens(symbols) {
    for (let i = 0; i < symbols.length; i++) {
      const token = await MockERC20.new("Mock" + symbols[i], symbols[i]);
      await token.mintArbitraryBatch([OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);

      tokens.push(token);
    }
  }

  async function createLiquidityPool(assetKey, asset, symbol, isCollateral) {
    const chainlinkOracle = await ChainlinkOracleMock.new(wei(100, chainlinkPriceDecimals), chainlinkPriceDecimals);

    await systemPoolsRegistry.addLiquidityPool(
      asset.address,
      assetKey,
      chainlinkOracle.address,
      symbol,
      isCollateral,
      isCollateral
    );

    if (assetKey != nativeTokenKey) {
      await asset.approveArbitraryBatch(
        await getLiquidityPoolAddr(assetKey),
        [OWNER, USER1, USER2],
        [tokensAmount, tokensAmount, tokensAmount]
      );
    }

    await assetParameters.setupAllParameters(assetKey, [
      [standardColRatio, standardColRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);

    return chainlinkOracle;
  }

  async function createStablePool(assetKey, assetAddr) {
    await systemPoolsRegistry.addStablePool(assetAddr, assetKey, ZERO_ADDR);

    await assetParameters.setupAnnualBorrowRate(assetKey, annualBorrowRate);
    await assetParameters.setupMainParameters(assetKey, [
      standardColRatio,
      standardColRatio,
      reserveFactor,
      liquidationDiscount,
      maxUR,
    ]);
  }

  async function deployRewardsPool(rewardsTokenAddr, symbol) {
    const chainlinkOracle = await ChainlinkOracleMock.new(wei(100, chainlinkPriceDecimals), chainlinkPriceDecimals);

    await systemPoolsRegistry.addLiquidityPool(
      rewardsTokenAddr,
      rewardsTokenKey,
      chainlinkOracle.address,
      symbol,
      true,
      true
    );

    await assetParameters.setupAllParameters(rewardsTokenKey, [
      [standardColRatio, standardColRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);
  }

  function getNormalizedAmount(normalizedAmount, additionalAmount, currentRate, isAdding) {
    const normalizedAdditionalAmount = additionalAmount.times(getPercentage100()).idiv(currentRate);

    return isAdding
      ? normalizedAmount.plus(normalizedAdditionalAmount)
      : normalizedAmount.minus(normalizedAdditionalAmount);
  }

  before("setup", async () => {
    OWNER = await accounts(0);
    USER1 = await accounts(1);
    USER2 = await accounts(2);
    NOTHING = await accounts(9);

    rewardsToken = await MockERC20.new("MockRTK", "RTK");
    nativeToken = await WETH.new();
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
    const _prt = await Prt.new();

    await registry.__OwnableContractsRegistry_init();

    const stableToken = await StablePermitToken.new("Stable Token", "ST", registry.address);

    await registry.addProxyContract(await registry.DEFI_CORE_NAME(), _defiCore.address);
    await registry.addProxyContract(await registry.SYSTEM_PARAMETERS_NAME(), _systemParameters.address);
    await registry.addProxyContract(await registry.ASSET_PARAMETERS_NAME(), _assetParameters.address);
    await registry.addProxyContract(await registry.REWARDS_DISTRIBUTION_NAME(), _rewardsDistribution.address);
    await registry.addProxyContract(await registry.USER_INFO_REGISTRY_NAME(), _userInfoRegistry.address);
    await registry.addProxyContract(await registry.SYSTEM_POOLS_REGISTRY_NAME(), _systemPoolsRegistry.address);
    await registry.addProxyContract(await registry.SYSTEM_POOLS_FACTORY_NAME(), _liquidityPoolFactory.address);
    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), _priceManager.address);
    await registry.addProxyContract(await registry.PRT_NAME(), _prt.address);

    await registry.addContract(await registry.INTEREST_RATE_LIBRARY_NAME(), interestRateLibrary.address);

    defiCore = await DefiCore.at(await registry.getDefiCoreContract());
    assetParameters = await AssetParameters.at(await registry.getAssetParametersContract());
    userInfoRegistry = await UserInfoRegistry.at(await registry.getUserInfoRegistryContract());
    systemPoolsRegistry = await SystemPoolsRegistry.at(await registry.getSystemPoolsRegistryContract());
    rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());
    systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());

    await registry.injectDependencies(await registry.DEFI_CORE_NAME());
    await registry.injectDependencies(await registry.SYSTEM_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.ASSET_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.REWARDS_DISTRIBUTION_NAME());
    await registry.injectDependencies(await registry.USER_INFO_REGISTRY_NAME());
    await registry.injectDependencies(await registry.SYSTEM_POOLS_REGISTRY_NAME());
    await registry.injectDependencies(await registry.SYSTEM_POOLS_FACTORY_NAME());
    await registry.injectDependencies(await registry.PRICE_MANAGER_NAME());
    await registry.injectDependencies(await registry.PRT_NAME());

    tokens.push(rewardsToken.address);
    await deployTokens(["DAI", "WETH", "USDT"]);
    tokens.push(nativeToken);

    await defiCore.defiCoreInitialize();
    await systemPoolsRegistry.systemPoolsRegistryInitialize(_liquidityPoolImpl.address, nativeTokenKey, zeroKey);

    await systemPoolsRegistry.addPoolsBeacon(1, _stablePoolImpl.address);
    await systemParameters.setupStablePoolsAvailability(true);
    await systemParameters.setupMinCurrencyAmount(minCurrencyAmount);
    await systemParameters.setRewardsTokenAddress(ZERO_ADDR);

    await deployRewardsPool(rewardsToken.address, await rewardsToken.symbol());
    await createStablePool(stableKey, stableToken.address);

    daiChainlinkOracle = await createLiquidityPool(daiKey, tokens[1], "DAI", true);
    wEthChainlinkOracle = await createLiquidityPool(wEthKey, tokens[2], "WETH", true);
    usdtChainlinkOracle = await createLiquidityPool(usdtKey, tokens[3], "USDT", false);
    await createLiquidityPool(nativeTokenKey, tokens[4], "BNB", true);

    nativePool = await LiquidityPool.at(await getLiquidityPoolAddr(nativeTokenKey));
    daiPool = await LiquidityPool.at(await getLiquidityPoolAddr(daiKey));
    wEthPool = await LiquidityPool.at(await getLiquidityPoolAddr(wEthKey));
    usdtPool = await LiquidityPool.at(await getLiquidityPoolAddr(usdtKey));

    await systemParameters.setupLiquidationBoundary(liquidationBoundary);

    await rewardsToken.mintArbitrary(defiCore.address, tokensAmount);

    await nativeToken.approve(nativePool.address, tokensAmount);
    await nativeToken.approve(nativePool.address, tokensAmount.times(1000), { from: USER1 });

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("getTotalSupplyBalanceInUSD", () => {
    const liquidityAmount = wei(100);
    const price = toBN(100);

    it("should return 0 if user if the user has no deposits", async () => {
      assert.equal(await defiCore.getTotalSupplyBalanceInUSD(USER1), 0);
    });

    it("should return correct total balance", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(2), { from: USER1 });

      assert.equal(
        (await defiCore.getTotalSupplyBalanceInUSD(USER1)).toString(),
        liquidityAmount.times(3).times(price).times(priceDecimals).idiv(oneToken).toString()
      );
    });
  });

  describe("getCurrentBorrowLimitInUSD", () => {
    const liquidityAmount = wei(100);
    const price = toBN(100);

    it("should return 0 if user if the user has no deposits", async () => {
      assert.equal(await defiCore.getCurrentBorrowLimitInUSD(USER1), 0);
    });

    it("should return 0 if the user has no enabled as collateral assets", async () => {
      await defiCore.updateCollateral(daiKey, true, { from: USER1 });
      await defiCore.updateCollateral(wEthKey, true, { from: USER1 });

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(2), { from: USER1 });

      assert.equal((await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), 0);
    });

    it("should return correct borrow limit", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(2), { from: USER1 });

      await defiCore.updateCollateral(wEthKey, true, { from: USER1 });

      const expectedLimit = liquidityAmount
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(getPercentage100())
        .idiv(standardColRatio);

      assert.equal((await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedLimit.toString());
    });

    it("should return 0 if the user has no enabled as collateral assets, including assets which are not posible to be enabled", async () => {
      await defiCore.updateCollateral(daiKey, true, { from: USER1 });

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(usdtKey, liquidityAmount.times(2), { from: USER1 });

      assert.equal((await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), 0);
    });

    it("should return correct borrow limit for assets with different collateralization ratio", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      let expectedLimit = liquidityAmount
        .times(2)
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(getPercentage100())
        .idiv(standardColRatio);

      assert.equal((await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedLimit.toString());

      const newDaiColRatio = getPercentage100().times(1.15);
      const newWEthColRatio = getPercentage100().times(1.3);

      await assetParameters.setupMainParameters(daiKey, [
        newDaiColRatio,
        newDaiColRatio,
        reserveFactor,
        liquidationDiscount,
        maxUR,
      ]);
      await assetParameters.setupMainParameters(wEthKey, [
        newWEthColRatio,
        newWEthColRatio,
        reserveFactor,
        liquidationDiscount,
        maxUR,
      ]);

      const daiPart = liquidityAmount
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(getPercentage100())
        .idiv(newDaiColRatio);
      const wEthPart = liquidityAmount
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(getPercentage100())
        .idiv(newWEthColRatio);

      expectedLimit = daiPart.plus(wEthPart);

      assert.equal((await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedLimit.toString());
    });
  });

  describe("getNewBorrowLimitInUSD", () => {
    const liquidityAmount = wei(100);
    const price = toBN(100);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(2), { from: USER1 });

      const expectedLimit = liquidityAmount
        .times(3)
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(getPercentage100())
        .idiv(standardColRatio);

      assert.equal((await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedLimit.toString());
    });

    it("should return correct value if collateral enabled and supply", async () => {
      const expectedLimit = liquidityAmount
        .times(4)
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(getPercentage100())
        .idiv(standardColRatio);

      const result = await defiCore.getNewBorrowLimitInUSD(USER1, daiKey, liquidityAmount, true);
      assert.equal(result.toString(), expectedLimit.toString());
    });

    it("should return correct value if collateral enabled and withdraw", async () => {
      const expectedLimit = liquidityAmount
        .times(2.5)
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(getPercentage100())
        .idiv(standardColRatio);

      const result = await defiCore.getNewBorrowLimitInUSD(USER1, daiKey, liquidityAmount.idiv(2), false);
      assert.equal(result.toString(), expectedLimit.toString());
    });

    it("should return correct value if collateral disabled", async () => {
      await defiCore.updateCollateral(daiKey, true, { from: USER1 });
      const expectedLimit = liquidityAmount
        .times(2)
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(getPercentage100())
        .idiv(standardColRatio);

      let result = await defiCore.getNewBorrowLimitInUSD(USER1, daiKey, liquidityAmount.idiv(2), false);
      assert.equal(result.toString(), expectedLimit.toString());

      result = await defiCore.getNewBorrowLimitInUSD(USER1, daiKey, liquidityAmount.idiv(2), true);
      assert.equal(result.toString(), expectedLimit.toString());
    });

    it("should return correct value if collateral enabled and withdraw amount greater than current limit", async () => {
      const result = await defiCore.getNewBorrowLimitInUSD(USER1, daiKey, liquidityAmount.times(4), false);
      assert.equal(result.toString(), 0);
    });
  });

  describe("getTotalBorrowBalanceInUSD", () => {
    const liquidityAmount = wei(100);
    const amountToBorrow = wei(50);
    const price = toBN(100);
    const neededTime = 10000;

    it("should return 0 if user if the user has no borrows", async () => {
      assert.equal(await defiCore.getTotalBorrowBalanceInUSD(USER1), 0);
    });

    it("should return correct borrow balance", async () => {
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(2), { from: USER2 });
      await defiCore.addLiquidity(usdtKey, liquidityAmount.times(2), { from: USER2 });

      await defiCore.addLiquidity(daiKey, liquidityAmount.times(2), { from: USER1 });

      await defiCore.borrowFor(wEthKey, amountToBorrow, USER1, { from: USER1 });
      await defiCore.borrowFor(usdtKey, amountToBorrow, USER1, { from: USER1 });

      await setNextBlockTime(neededTime);

      await wEthPool.updateCompoundRate(false);
      await usdtPool.updateCompoundRate(false);

      const totalBorrowedAmount = (await defiCore.getUserBorrowedAmount(USER1, wEthKey)).plus(
        await defiCore.getUserBorrowedAmount(USER1, usdtKey)
      );

      assert.closeTo(
        (await defiCore.getTotalBorrowBalanceInUSD(USER1)).toNumber(),
        totalBorrowedAmount.times(price).times(priceDecimals).idiv(oneToken).toNumber(),
        10
      );
    });
  });

  describe("getAvailableLiquidity", () => {
    const liquidityAmount = wei(100);
    const amountToBorrow = wei(50);
    const keysArr = [daiKey, wEthKey, usdtKey];
    const price = toBN(100);
    const startTime = toBN(100000);

    beforeEach("setup", async () => {
      for (let i = 0; i < keysArr.length; i++) {
        await defiCore.addLiquidity(keysArr[i], liquidityAmount, { from: USER2 });
      }

      assert.equal((await userInfoRegistry.getUserSupplyAssets(USER2)).length, 3);
    });

    it("should return zero if user has no tokens in the system", async () => {
      const result = await defiCore.getAvailableLiquidity(USER1);

      assert.equal(toBN(result[0]).toString(), 0);
      assert.equal(result[1], 0);
    });

    it("should return correct available liquidity", async () => {
      const result = await defiCore.getAvailableLiquidity(USER2);

      const expectedAvailableLiquidity = liquidityAmount
        .times(2)
        .times(price)
        .times(priceDecimals)
        .div(oneToken)
        .times(getPercentage100())
        .idiv(standardColRatio);

      assert.equal(result[0].toString(), expectedAvailableLiquidity.toString());
      assert.equal(result[1], 0);
    });

    it("should return correct values if try to withdraw all liquidity", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      const currentTotalLiquidityAmount = liquidityAmount.times(2).times(price).times(priceDecimals).idiv(oneToken);
      const expectedLimit = currentTotalLiquidityAmount.times(getPercentage100()).idiv(standardColRatio);

      let result = await defiCore.getAvailableLiquidity(USER1);
      assert.equal(result[0].toString(), expectedLimit.toString());
      assert.equal(result[1], 0);

      await defiCore.withdrawLiquidity(daiKey, liquidityAmount, false, { from: USER1 });
      await defiCore.withdrawLiquidity(wEthKey, liquidityAmount, false, { from: USER1 });

      result = await defiCore.getAvailableLiquidity(USER1);
      assert.equal(result[0].toString(), 0);
      assert.equal(result[1], 0);
    });

    it("should return correct values if total borrowed amount equals to zero", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      let currentTotalLiquidityAmount = liquidityAmount.times(2).times(price).times(priceDecimals).idiv(oneToken);
      let expectedLimit = currentTotalLiquidityAmount.times(getPercentage100()).idiv(standardColRatio);

      let result = await defiCore.getAvailableLiquidity(USER1);
      assert.equal(result[0].toString(), expectedLimit.toString());
      assert.equal(result[1], 0);

      await setNextBlockTime(startTime.times(2).toNumber());
      await defiCore.withdrawLiquidity(daiKey, liquidityAmount, false, { from: USER1 });

      currentTotalLiquidityAmount = liquidityAmount.times(price).times(priceDecimals).idiv(oneToken);
      expectedLimit = currentTotalLiquidityAmount.times(getPercentage100()).idiv(standardColRatio);

      result = await defiCore.getAvailableLiquidity(USER1);
      assert.equal(result[0].toString(), expectedLimit.toString());
      assert.equal(result[1], 0);
    });

    it("should return correct values after borrow/repayBorrow", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      await setNextBlockTime(startTime.toNumber());
      await usdtPool.updateCompoundRate(false);

      await defiCore.borrowFor(usdtKey, amountToBorrow, USER1, { from: USER1 });

      let borrowLimit = await defiCore.getCurrentBorrowLimitInUSD(USER1);
      let totalBorrowedAmount = await defiCore.getTotalBorrowBalanceInUSD(USER1);

      let result = await defiCore.getAvailableLiquidity(USER1);
      assert.closeTo(result[0].toNumber(), borrowLimit.minus(totalBorrowedAmount).toNumber(), 10);
      assert.equal(result[1], 0);

      await setNextBlockTime(startTime.times(100).toNumber());
      await usdtPool.updateCompoundRate(false);

      const amountToRepayBorrow = amountToBorrow.div(2);
      await defiCore.repayBorrow(usdtKey, amountToRepayBorrow, false, { from: USER1 });

      borrowLimit = await defiCore.getCurrentBorrowLimitInUSD(USER1);
      totalBorrowedAmount = await defiCore.getTotalBorrowBalanceInUSD(USER1);

      result = await defiCore.getAvailableLiquidity(USER1);
      assert.closeTo(result[0].toNumber(), borrowLimit.minus(totalBorrowedAmount).toNumber(), 10);
      assert.equal(result[1], 0);
    });
  });

  describe("updateCollateral", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);
    const price = toBN(100);

    it("should correctly enable collateral", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.updateCollateral(daiKey, true, { from: USER1 });

      assert.equal((await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), 0);

      const txReceipt = await defiCore.updateCollateral(daiKey, false, { from: USER1 });

      assert.equal(
        (await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(),
        liquidityAmount
          .times(price)
          .times(priceDecimals)
          .idiv(oneToken)
          .times(getPercentage100())
          .idiv(standardColRatio)
          .toString()
      );

      assert.equal(await defiCore.disabledCollateralAssets(USER1, daiKey), false);

      assert.equal(txReceipt.receipt.logs[0].event, "CollateralUpdated");
      assert.equal(txReceipt.receipt.logs[0].args.userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args.assetKey, daiKey));
      assert.equal(txReceipt.receipt.logs[0].args.newValue, false);
    });

    it("should correctly disable collateral", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      const expectedBorrowLimit = liquidityAmount
        .times(price)
        .times(priceDecimals)
        .div(oneToken)
        .times(getPercentage100())
        .div(standardColRatio);
      assert.equal((await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedBorrowLimit.toString());

      await defiCore.updateCollateral(daiKey, true, { from: USER1 });

      assert.equal((await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), 0);

      assert.equal(await defiCore.disabledCollateralAssets(USER1, daiKey), true);
    });

    it("should get exception if borrow limit after disable will be higher than borrow balance", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      const reason = "DefiCore: It is impossible to disable the asset as a collateral.";
      await truffleAssert.reverts(defiCore.updateCollateral(daiKey, true, { from: USER1 }), reason);
    });

    it("should get exception if asset already enabled", async () => {
      const reason = "DefiCore: The new value cannot be equal to the current value.";
      await truffleAssert.reverts(defiCore.updateCollateral(daiKey, false, { from: USER1 }), reason);
    });

    it("should get exception if asset is not collateral", async () => {
      const reason = "DefiCore: Asset is blocked for collateral.";
      await truffleAssert.reverts(defiCore.updateCollateral(usdtKey, true, { from: USER1 }), reason);
    });
  });

  describe("addLiquidity", () => {
    const liquidityAmount = wei(100);

    it("should correctly add liquidity to the pool", async () => {
      const txReceipt = await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal((await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), liquidityAmount.toString());
      assert.equal((await tokens[1].balanceOf(USER1)).toString(), tokensAmount.minus(liquidityAmount).toString());

      assert.equal(txReceipt.receipt.logs.length, 1);

      assert.equal(txReceipt.receipt.logs[0].event, "LiquidityAdded");
      assert.equal(txReceipt.receipt.logs[0].args.userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args.assetKey, daiKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args.liquidityAmount).toString(), liquidityAmount.toString());

      assert.equal((await userInfoRegistry.getUserSupplyAssets(USER1)).length, 1);
      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserSupplyAssets(USER1), [daiKey]));
    });

    it("should correctly mint LPTokens for token with 6 getPercentage100() places", async () => {
      const USER3 = await accounts(5);

      await tokens[1].setDecimals(6);

      const amountToTransfer = wei(1000, 6);
      await tokens[1].transfer(USER3, amountToTransfer, { from: USER1 });

      await tokens[1].approve(daiPool.address, liquidityAmount, { from: USER3 });
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER3 });

      assert.equal((await daiPool.getUnderlyingDecimals()).toString(), 6);
      assert.equal((await daiPool.balanceOf(USER3)).toString(), liquidityAmount.toString());
      assert.equal((await defiCore.getUserLiquidityAmount(USER3, daiKey)).toString(), liquidityAmount.toString());

      const supplyAssetInfo = (await userInfoRegistry.getUserSupplyPoolsInfo(USER3, [daiKey]))[0];
      assert.equal(supplyAssetInfo.userDepositInUSD.toString(), priceDecimals.times(10000).toString());
      assert.equal(supplyAssetInfo.userDeposit.toString(), liquidityAmount.toString());
    });

    it("should get exception if the asset amount to transfer equal to zero", async () => {
      await tokens[1].setDecimals(6);

      let liquidityAmount = toBN(10).pow(6).times(100);

      const reason = "AbstractPool: Incorrect asset amount after conversion.";

      await truffleAssert.reverts(defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 }), reason);

      liquidityAmount = toBN(10).pow(13);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal((await daiPool.exchangeRate()).toString(), getPercentage100().toString());
      assert.equal((await daiPool.balanceOf(USER1)).toString(), liquidityAmount.toString());
    });

    it("should get exception if liquidity amount is zero", async () => {
      const reason = "DefiCore: Liquidity amount must be greater than zero.";
      await truffleAssert.reverts(defiCore.addLiquidity(daiKey, 0, { from: USER1 }), reason);
    });

    it("should get exception if liquidity pool does not exists", async () => {
      const someKey = toBytes("SOME_KEY");

      const reason = "AssetsHelperLibrary: LiquidityPool doesn't exists.";
      await truffleAssert.reverts(defiCore.addLiquidity(someKey, liquidityAmount, { from: USER1 }), reason);
    });
  });

  describe("withdrawLiquidity", () => {
    const liquidityAmount = wei(100);
    const amountToBorrow = wei(75);
    const amountToWithdraw = wei(50);
    const startTime = toBN(100000);
    const withdrawTime = startTime.times(2);
    const price = toBN(100);

    it("should correctly withdraw liquidity from the pool", async () => {
      await setNextBlockTime(startTime.toNumber());
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal((await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), liquidityAmount.toString());
      assert.equal((await tokens[1].balanceOf(USER1)).toString(), tokensAmount.minus(liquidityAmount).toString());

      await setNextBlockTime(withdrawTime.toNumber());
      const txReceipt = await defiCore.withdrawLiquidity(daiKey, amountToWithdraw, false, { from: USER1 });

      assert.equal(
        (await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(),
        liquidityAmount.minus(amountToWithdraw).toString()
      );
      assert.equal(
        (await tokens[1].balanceOf(USER1)).toString(),
        tokensAmount.minus(liquidityAmount).plus(amountToWithdraw).toString()
      );

      assert.equal(txReceipt.receipt.logs.length, 1);

      assert.equal(txReceipt.receipt.logs[0].event, "LiquidityWithdrawn");
      assert.equal(txReceipt.receipt.logs[0].args.userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args.assetKey, daiKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args.liquidityAmount).toString(), amountToWithdraw.toString());

      assert.equal((await userInfoRegistry.getUserSupplyAssets(USER1)).length, 1);

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserSupplyAssets(USER1), [daiKey]));
    });

    it("should return correct values if try to withdraw all liquidity", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(usdtKey, liquidityAmount, { from: USER1 });

      await defiCore.updateCollateral(wEthKey, true, { from: USER1 });

      const currentTotalLiquidityAmount = liquidityAmount.times(price).times(priceDecimals).idiv(oneToken);
      const expectedLimit = currentTotalLiquidityAmount.times(getPercentage100()).idiv(standardColRatio);

      let result = await defiCore.getAvailableLiquidity(USER1);
      assert.equal(result[0].toString(), expectedLimit.toString());
      assert.equal(result[1], 0);

      await defiCore.withdrawLiquidity(wEthKey, liquidityAmount, true, { from: USER1 });
      await defiCore.withdrawLiquidity(usdtKey, liquidityAmount, true, { from: USER1 });
      const txReceipt = await defiCore.withdrawLiquidity(daiKey, liquidityAmount, true, { from: USER1 });

      assert.equal((await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), 0);
      assert.equal((await tokens[1].balanceOf(USER1)).toString(), tokensAmount.toString());

      assert.equal((await defiCore.getUserLiquidityAmount(USER1, usdtKey)).toString(), 0);
      assert.equal((await tokens[3].balanceOf(USER1)).toString(), tokensAmount.toString());

      assert.equal(txReceipt.receipt.logs.length, 1);

      assert.equal(txReceipt.receipt.logs[0].event, "LiquidityWithdrawn");
      assert.equal(txReceipt.receipt.logs[0].args.userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args.assetKey, daiKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args.liquidityAmount).toString(), liquidityAmount.toString());
    });

    it("should correctly withdraw with disabled collateral", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.updateCollateral(daiKey, true, { from: USER1 });

      await setNextBlockTime(withdrawTime.toNumber());
      await defiCore.withdrawLiquidity(daiKey, amountToWithdraw, false, { from: USER1 });

      assert.equal((await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), amountToWithdraw.toString());
      assert.equal((await tokens[1].balanceOf(USER1)).toString(), tokensAmount.minus(amountToWithdraw).toString());
    });

    it("should correctly withdraw with assets which are not possible to be enabled as collateral", async () => {
      await defiCore.addLiquidity(usdtKey, liquidityAmount, { from: USER1 });
      await defiCore.withdrawLiquidity(usdtKey, liquidityAmount.minus(1), false, { from: USER1 });

      assert.equal((await defiCore.getUserLiquidityAmount(USER1, usdtKey)).toString(), (1).toString());
      assert.equal((await tokens[3].balanceOf(USER1)).toString(), tokensAmount.minus(1).toString());
    });

    it("should correctly withdraw all funds of one asset", async () => {
      const newDaiPrice = toBN(10).times(priceDecimals);
      const newWEthPrice = toBN(120).times(priceDecimals);

      await daiChainlinkOracle.setPrice(newDaiPrice);
      await wEthChainlinkOracle.setPrice(newWEthPrice);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      let expectedTotalSupply = toBN(13000).times(priceDecimals);
      let expectedAvailableLiquidity = expectedTotalSupply.times(getPercentage100()).idiv(standardColRatio);

      assert.equal((await defiCore.getTotalSupplyBalanceInUSD(USER1)).toString(), expectedTotalSupply.toString());
      assert.equal((await defiCore.getAvailableLiquidity(USER1))[0].toString(), expectedAvailableLiquidity.toString());

      // console.log(`BL - ${toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString()}`);
      // console.log(`Total Supply balance - ${toBN(await defiCore.getTotalSupplyBalanceInUSD(USER1)).toString()}`);
      // console.log(`AL - ${toBN((await defiCore.getAvailableLiquidity(USER1))[0]).toString()}`);

      await defiCore.borrowFor(daiKey, liquidityAmount.idiv(2), USER1, { from: USER1 });

      let expectedTotalBorrow = toBN(500).times(priceDecimals);
      expectedAvailableLiquidity = expectedAvailableLiquidity.minus(expectedTotalBorrow);

      assert.equal((await defiCore.getTotalBorrowBalanceInUSD(USER1)).toString(), expectedTotalBorrow.toString());
      assert.equal((await defiCore.getAvailableLiquidity(USER1))[0].toString(), expectedAvailableLiquidity.toString());

      // console.log("----------------------");
      // console.log(`BL - ${toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString()}`);
      // console.log(`Borrow balance - ${toBN(await defiCore.getTotalBorrowBalanceInUSD(USER1)).toString()}`);
      // console.log(`AL - ${toBN((await defiCore.getAvailableLiquidity(USER1))[0]).toString()}`);

      await defiCore.withdrawLiquidity(wEthKey, liquidityAmount, true, { from: USER1 });

      expectedTotalSupply = toBN(1000).times(priceDecimals);
      expectedAvailableLiquidity = expectedTotalSupply
        .times(getPercentage100())
        .idiv(standardColRatio)
        .minus(expectedTotalBorrow);

      assert.equal((await defiCore.getTotalSupplyBalanceInUSD(USER1)).toString(), expectedTotalSupply.toString());
      assert.equal((await defiCore.getAvailableLiquidity(USER1))[0].toString(), expectedAvailableLiquidity.toString());

      // console.log("----------------------");
      // console.log(`BL - ${toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString()}`);
      // console.log(`Total Supply balance - ${toBN(await defiCore.getTotalSupplyBalanceInUSD(USER1)).toString()}`);
      // console.log(`AL - ${toBN((await defiCore.getAvailableLiquidity(USER1))[0]).toString()}`);
    });

    it("should correctly withdraw all liquidity", async () => {
      await setNextBlockTime(startTime.toNumber());

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });

      assert.equal((await daiPool.balanceOf(USER1)).toString(), liquidityAmount.toString());
      assert.equal((await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), liquidityAmount.toString());

      await defiCore.borrowFor(daiKey, amountToBorrow, USER2, { from: USER2 });

      await setNextBlockTime(startTime.times(100).toNumber());

      await defiCore.updateCompoundRate(daiKey, false);

      assert.isTrue((await daiPool.getCurrentRate()).gt(getPercentage100()));

      await defiCore.withdrawLiquidity(daiKey, 0, true, { from: USER1 });

      assert.equal((await daiPool.balanceOf(USER1)).toString(), 0);
      assert.equal((await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), 0);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await setNextBlockTime(startTime.times(1000).toNumber());

      await defiCore.updateCompoundRate(daiKey, false);

      await defiCore.withdrawLiquidity(daiKey, 0, true, { from: USER1 });

      assert.equal((await daiPool.balanceOf(USER1)).toString(), 0);
      assert.equal((await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), 0);
    });

    it("should get exception if liquidity amount is zero", async () => {
      const reason = "DefiCore: Liquidity amount must be greater than zero.";
      await truffleAssert.reverts(defiCore.withdrawLiquidity(daiKey, 0, false, { from: USER1 }), reason);
    });

    it("should get exception if liquidity pool does not exists", async () => {
      const someKey = toBytes("SOME_KEY");

      const reason = "AssetsHelperLibrary: LiquidityPool doesn't exists.";
      await truffleAssert.reverts(defiCore.withdrawLiquidity(someKey, liquidityAmount, false, { from: USER1 }), reason);
    });

    it("should get exception if user not enough available liquidity", async () => {
      await setNextBlockTime(startTime.toNumber());
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.borrowFor(wEthKey, amountToBorrow, USER1, { from: USER1 });

      const expectedLimit = liquidityAmount
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(getPercentage100())
        .idiv(standardColRatio);
      assert.equal((await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedLimit.toString());

      const expectedTotalBorrowedBalance = amountToBorrow.times(price).times(priceDecimals).idiv(oneToken);
      assert.equal(
        (await defiCore.getTotalBorrowBalanceInUSD(USER1)).toString(),
        expectedTotalBorrowedBalance.toString()
      );

      const expectedAvailableLiquidity = expectedLimit.minus(expectedTotalBorrowedBalance);

      assert.equal((await defiCore.getAvailableLiquidity(USER1))[0].toString(), expectedAvailableLiquidity.toString());

      await setNextBlockTime(withdrawTime.toNumber());
      const reason = "DefiCore: Borrow limit used greater than 100%.";
      await truffleAssert.reverts(defiCore.withdrawLiquidity(daiKey, amountToWithdraw, false, { from: USER1 }), reason);
    });

    it("should get exception if the asset amount to transfer equal to zero", async () => {
      await tokens[1].setDecimals(6);

      const liquidityAmount = wei(100);
      const amountToWithdraw = wei(50, 6);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      const reason = "AbstractPool: Incorrect asset amount after conversion.";

      await truffleAssert.reverts(defiCore.withdrawLiquidity(daiKey, amountToWithdraw, false, { from: USER1 }), reason);
    });

    it("should not fail getDetailedLiquidityPoolInfo request", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.borrowFor(daiKey, amountToBorrow, USER2, { from: USER2 });
      await defiCore.withdrawLiquidity(daiKey, 0, true, { from: USER1 });

      await systemPoolsRegistry.getDetailedLiquidityPoolInfo(daiKey);
    });
  });

  describe("check account assets", () => {
    const liquidityAmount = wei(100);
    const amountToWithdraw = wei(50);
    const amountToBorrow = wei(50);
    const keysArr = [daiKey, wEthKey, usdtKey];

    beforeEach("setup", async () => {
      for (let i = 0; i < keysArr.length; i++) {
        await defiCore.addLiquidity(keysArr[i], liquidityAmount, { from: USER2 });
      }

      assert.equal((await userInfoRegistry.getUserSupplyAssets(USER2)).length, 3);
    });

    it("should correctly update assets after addLiquidity/withdrawLiquidity", async () => {
      const startTime = toBN(100000);

      await setNextBlockTime(startTime.toNumber());
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(usdtKey, liquidityAmount, { from: USER1 });

      assert.equal((await userInfoRegistry.getUserSupplyAssets(USER1)).length, 3);
      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserSupplyAssets(USER1), [daiKey, wEthKey, usdtKey]));

      await setNextBlockTime(startTime.times(2).toNumber());
      await defiCore.withdrawLiquidity(daiKey, amountToWithdraw, false, { from: USER1 });
      await defiCore.withdrawLiquidity(wEthKey, liquidityAmount, false, { from: USER1 });

      assert.equal((await userInfoRegistry.getUserSupplyAssets(USER1)).length, 2);
      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserSupplyAssets(USER1), [daiKey, usdtKey]));

      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      assert.equal((await userInfoRegistry.getUserSupplyAssets(USER1)).length, 3);
      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserSupplyAssets(USER1), [daiKey, usdtKey, wEthKey]));
    });

    it("should correctly update assets after borrow/repayBorrow", async () => {
      const startTime = toBN(100000);

      await setNextBlockTime(startTime.toNumber());
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.borrowFor(usdtKey, amountToBorrow, USER1, { from: USER1 });

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserSupplyAssets(USER1), [daiKey]));
      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), [usdtKey]));

      await defiCore.repayBorrow(usdtKey, amountToBorrow.div(2), false, { from: USER1 });

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserSupplyAssets(USER1), [daiKey]));
      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), [usdtKey]));

      await defiCore.repayBorrow(usdtKey, amountToBorrow, false, { from: USER1 });

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserSupplyAssets(USER1), [daiKey]));
      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), []));

      await setNextBlockTime(startTime.times(2).plus(1).toNumber());
      await defiCore.borrowFor(usdtKey, amountToBorrow, USER1, { from: USER1 });

      await setNextBlockTime(startTime.times(2).plus(2).toNumber());
      await defiCore.repayBorrow(usdtKey, amountToBorrow, true, { from: USER1 });

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserSupplyAssets(USER1), [daiKey]));
      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), []));
    });
  });

  describe("borrow", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
    });

    it("should correctly borrow tokens", async () => {
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await wEthPool.updateCompoundRate(false);
      const txReceipt = await defiCore.borrowFor(wEthKey, borrowAmount, USER1, { from: USER1 });

      assert.equal(txReceipt.receipt.logs.length, 1);

      assert.equal(txReceipt.receipt.logs[0].event, "Borrowed");
      assert.equal(txReceipt.receipt.logs[0].args.borrower, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args.assetKey, wEthKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args.borrowedAmount).toString(), borrowAmount.toString());

      const currentRate = await wEthPool.getCurrentRate();
      const expectedNormalizedAmount = getNormalizedAmount(toBN(0), borrowAmount, currentRate, true);

      assert.equal(
        (await wEthPool.borrowInfos(USER1)).normalizedAmount.toString(),
        expectedNormalizedAmount.toString()
      );
      assert.equal(
        (await wEthPool.aggregatedNormalizedBorrowedAmount()).toString(),
        expectedNormalizedAmount.toString()
      );

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), [wEthKey]));
    });

    it("should get exception if borrow amount is zero", async () => {
      const reason = "DefiCore: Borrow amount must be greater than zero.";
      await truffleAssert.reverts(defiCore.borrowFor(daiKey, 0, USER1, { from: USER1 }), reason);
    });

    it("should get exception if asset does not exists", async () => {
      const someAssetKey = toBytes("SOME_ASSET");
      const reason = "AssetParameters: Param for this asset doesn't exist.";
      await truffleAssert.reverts(defiCore.borrowFor(someAssetKey, liquidityAmount, USER1, { from: USER1 }), reason);
    });

    it("should get exception if not enough available liquidity", async () => {
      const reason = "DefiCore: Not enough available liquidity.";
      await truffleAssert.reverts(defiCore.borrowFor(daiKey, liquidityAmount.times(2), USER2, { from: USER2 }), reason);
    });

    it("should get exception if liquidity pool is freezed", async () => {
      await assetParameters.freeze(daiKey);

      const reason = "DefiCore: Pool is freeze for borrow operations.";
      await truffleAssert.reverts(defiCore.borrowFor(daiKey, liquidityAmount, USER1, { from: USER1 }), reason);
    });
  });

  describe("repayBorrow", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(75);
    const repayBorrowAmount = wei(50);
    const startTime = toBN(100000);

    beforeEach("setup", async () => {
      await setNextBlockTime(startTime.toNumber());

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await wEthPool.updateCompoundRate(false);
      await defiCore.borrowFor(wEthKey, borrowAmount, USER1, { from: USER1 });

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), [wEthKey]));
    });

    it("should correctly repay borrow", async () => {
      await setNextBlockTime(startTime.times(100).toNumber());

      const currentNormalizedAmount = (await wEthPool.borrowInfos(USER1)).normalizedAmount;

      await wEthPool.updateCompoundRate(false);
      const txReceipt = await defiCore.repayBorrow(wEthKey, repayBorrowAmount, false, { from: USER1 });

      const currentRate = await wEthPool.getCurrentRate();
      const expectedNormalizedAmount = getNormalizedAmount(
        currentNormalizedAmount,
        repayBorrowAmount,
        currentRate,
        false
      );

      assert.equal(txReceipt.receipt.logs.length, 1);

      assert.equal(txReceipt.receipt.logs[0].event, "BorrowRepaid");
      assert.equal(txReceipt.receipt.logs[0].args.userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args.assetKey, wEthKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args.repaidAmount).toString(), repayBorrowAmount.toString());

      assert.equal(
        (await wEthPool.borrowInfos(USER1)).normalizedAmount.toString(),
        expectedNormalizedAmount.toString()
      );
      assert.equal(
        (await wEthPool.aggregatedNormalizedBorrowedAmount()).toString(),
        expectedNormalizedAmount.toString()
      );

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), [wEthKey]));
    });

    it("should fully repay borrow and remove assets from the list", async () => {
      await setNextBlockTime(startTime.times(100).toNumber());

      await wEthPool.updateCompoundRate(false);
      await defiCore.repayBorrow(wEthKey, 0, true, { from: USER1 });

      assert.equal((await wEthPool.borrowInfos(USER1)).normalizedAmount.toString(), 0);
      assert.equal((await wEthPool.aggregatedNormalizedBorrowedAmount()).toString(), 0);

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), []));
    });

    it("should correctly repay full borrow immediately after borrow", async () => {
      await setNextBlockTime(startTime.times(10).toNumber());

      await wEthPool.updateCompoundRate(false);

      await setNextBlockTime(startTime.times(10).plus(10).toNumber());
      await defiCore.borrowFor(wEthKey, wei(10), USER2, { from: USER2 });

      await setNextBlockTime(startTime.times(10).plus(11).toNumber());
      await defiCore.repayBorrow(wEthKey, 0, true, { from: USER2 });

      assert.equal((await wEthPool.borrowInfos(USER2)).normalizedAmount.toString(), 0);

      await defiCore.repayBorrow(wEthKey, 0, true, { from: USER1 });

      assert.equal((await wEthPool.borrowInfos(USER1)).normalizedAmount.toString(), 0);
      assert.equal((await wEthPool.aggregatedNormalizedBorrowedAmount()).toString(), 0);
    });

    it("should get exception if repay borrow amount is zero", async () => {
      const reason = "DefiCore: Zero amount cannot be repaid.";
      await truffleAssert.reverts(defiCore.repayBorrow(daiKey, 0, false, { from: USER1 }), reason);
    });
  });

  describe("liquidation", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(75);
    const liquidateAmount = wei(20);

    beforeEach("setup", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey, wEthKey], [wei(2), oneToken]);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await wEthPool.updateCompoundRate(false);
      await defiCore.borrowFor(wEthKey, borrowAmount, USER1, { from: USER1 });

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), [wEthKey]));
    });

    it("should correctly liquidate user's assets", async () => {
      await defiCore.addLiquidity(usdtKey, liquidityAmount, { from: USER1 });
      const price = toBN(46);

      await daiChainlinkOracle.setPrice(price.times(priceDecimals));
      await usdtChainlinkOracle.setPrice(price.times(priceDecimals));

      await defiCore.liquidation(USER1, daiKey, wEthKey, liquidateAmount, { from: USER2 });
    });

    it("should correctly liquidate user's asset", async () => {
      const price = toBN(92);

      await daiChainlinkOracle.setPrice(price.times(priceDecimals));

      await defiCore.liquidation(USER1, daiKey, wEthKey, liquidateAmount, { from: USER2 });
    });

    it("should correctly update cumulative sums after liquidation", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      await mine(500);

      let expectedUser1Reward = wei(900.73);
      let expectedUser2Reward = wei(100.46);

      assert.closeTo(
        toBN(await rewardsDistribution.getUserReward(daiKey, USER1, daiPool.address)).toNumber(),
        expectedUser1Reward.toNumber(),
        oneToken.idiv(10).toNumber()
      );
      assert.closeTo(
        toBN(await rewardsDistribution.getUserReward(daiKey, USER2, daiPool.address)).toNumber(),
        expectedUser2Reward.toNumber(),
        oneToken.idiv(10).toNumber()
      );

      const price = toBN(82).times(priceDecimals);
      await daiChainlinkOracle.setPrice(price);

      // await setNextBlockTime(toBN(await getCurrentBlockTime()).plus(10).toNumber());
      const amountToLiquidate = wei(75);
      await defiCore.liquidation(USER1, daiKey, daiKey, amountToLiquidate, { from: USER2 });

      rewardsPerBlock = await rewardsDistribution.getRewardsPerBlock(daiKey, toBN(135223522372517110));

      await mine(500);

      expectedUser1Reward = wei(1858.56);
      expectedUser2Reward = wei(146.63);

      assert.closeTo(
        toBN(await rewardsDistribution.getUserReward(daiKey, USER1, daiPool.address)).toNumber(),
        expectedUser1Reward.toNumber(),
        oneToken.idiv(10).toNumber()
      );
      assert.closeTo(
        toBN(await rewardsDistribution.getUserReward(daiKey, USER2, daiPool.address)).toNumber(),
        expectedUser2Reward.toNumber(),
        oneToken.idiv(10).toNumber()
      );
    });

    it("should correctly update user supply assets after liquidation", async () => {
      await defiCore.addLiquidity(wEthKey, liquidityAmount.idiv(10), { from: USER1 });

      const price = toBN(82).times(priceDecimals);
      await daiChainlinkOracle.setPrice(price);

      const expectedBorrowLimit = toBN(7360).times(priceDecimals);

      assert.equal(toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedBorrowLimit.toString());

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserSupplyAssets(USER1), [daiKey, wEthKey]));

      const amountToLiquidate = wei(9.2);
      await defiCore.liquidation(USER1, wEthKey, wEthKey, amountToLiquidate, { from: USER2 });

      assert.closeTo(
        toBN(await defiCore.getUserLiquidityAmount(USER1, wEthKey)).toNumber(),
        0,
        oneToken.idiv(100).toNumber()
      );
    });

    it("should correctly update user borrow assets after liquidation", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      const price = toBN(82).times(priceDecimals);
      await daiChainlinkOracle.setPrice(price);

      const expectedBorrowLimit = toBN(13120).times(priceDecimals);

      assert.equal(toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedBorrowLimit.toString());

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), [wEthKey, daiKey]));

      const amountToLiquidate = wei(75);
      await defiCore.liquidation(USER1, daiKey, daiKey, amountToLiquidate, { from: USER2 });

      assert.closeTo(
        toBN(await defiCore.getUserBorrowedAmount(USER1, daiKey)).toNumber(),
        0,
        oneToken.idiv(100).toNumber()
      );
    });

    it("should get exception if user try to liquidate his position", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      const price = toBN(82).times(priceDecimals);
      await daiChainlinkOracle.setPrice(price);

      const reason = "DefiCore: User cannot liquidate his position.";
      await truffleAssert.reverts(
        defiCore.liquidation(USER1, daiKey, daiKey, liquidateAmount, { from: USER1 }),
        reason
      );
    });

    it("should get exception if try to liquidate zero amount", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      const price = toBN(82).times(priceDecimals);
      await daiChainlinkOracle.setPrice(price);

      const reason = "DefiCore: Liquidation amount should be more than zero.";
      await truffleAssert.reverts(defiCore.liquidation(USER1, daiKey, daiKey, 0, { from: USER2 }), reason);
    });

    it("should get exception if try to liquidate disabled as collateral asset", async () => {
      const reason = "DefiCore: Supply asset key must be enabled as collateral.";

      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });
      await defiCore.updateCollateral(wEthKey, true, { from: USER1 });

      await daiChainlinkOracle.setPrice(toBN(92).times(priceDecimals));

      await truffleAssert.reverts(
        defiCore.liquidation(USER1, wEthKey, wEthKey, liquidateAmount, { from: USER2 }),
        reason
      );
    });

    it("should get exception if try to liquidate more then posible", async () => {
      await daiChainlinkOracle.setPrice(toBN(92).times(priceDecimals));

      const reason = "DefiCore: Liquidation amount should be less than max quantity.";
      await truffleAssert.reverts(
        defiCore.liquidation(USER1, daiKey, wEthKey, liquidateAmount.times(4), { from: USER2 }),
        reason
      );
    });

    it("should get exception if not need to liquidate", async () => {
      await daiChainlinkOracle.setPrice(toBN(94).times(priceDecimals));

      const reason = "DefiCore: Not enough dept for liquidation.";
      await truffleAssert.reverts(
        defiCore.liquidation(USER1, daiKey, wEthKey, liquidateAmount.times(2), { from: USER2 }),
        reason
      );
    });
  });

  describe("claimDistributionRewards", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);
    const keys = [daiKey, wEthKey, usdtKey];

    it("should claim correct rewards", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey, wEthKey, usdtKey], [wei(2), oneToken, wei(5)]);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await mine(499);

      const expectedRewards = wei(100);

      const userBalanceBefore = toBN(await rewardsToken.balanceOf(USER1));

      await defiCore.claimDistributionRewards([], true, { from: USER1 });

      const userBalanceAfter = toBN(await rewardsToken.balanceOf(USER1));

      const userInfo = await rewardsDistribution.usersDistributionInfo(daiKey, USER1);

      assert.equal(toBN(userInfo.aggregatedReward).toString(), 0);
      assert.equal(
        toBN(userInfo.lastSupplyCumulativeSum).toString(),
        toBN((await rewardsDistribution.liquidityPoolsInfo(daiKey)).supplyCumulativeSum).toString()
      );
      assert.equal(toBN(userInfo.lastBorrowCumulativeSum).toString(), 0);

      assert.closeTo(
        userBalanceAfter.minus(userBalanceBefore).toNumber(),
        expectedRewards.toNumber(),
        wei(0.01).toNumber()
      );
    });

    it("should claim correct rewards from several pools", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey, wEthKey, usdtKey], [wei(2), oneToken, wei(5)]);

      for (let i = 0; i < keys.length; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
      }

      await mine(500 - keys.length);

      const expectedRewards = wei(398.9);

      const userBalanceBefore = toBN(await rewardsToken.balanceOf(USER1));

      await defiCore.claimDistributionRewards(keys, false, { from: USER1 });

      const userBalanceAfter = toBN(await rewardsToken.balanceOf(USER1));

      assert.closeTo(
        userBalanceAfter.minus(userBalanceBefore).toNumber(),
        expectedRewards.toNumber(),
        wei(0.01).toNumber()
      );
    });

    it("should claim correct rewards after deposit and borrow", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey, wEthKey, usdtKey], [wei(2), oneToken, wei(5)]);

      await defiCore.addLiquidity(daiKey, liquidityAmount.times(2), { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      await mine(498);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount.idiv(2), USER1, { from: USER1 });

      const userBalanceBefore = toBN(await rewardsToken.balanceOf(USER1));

      await defiCore.claimDistributionRewards([], true, { from: USER1 });

      const userBalanceAfter = toBN(await rewardsToken.balanceOf(USER1));

      const userInfo = await rewardsDistribution.usersDistributionInfo(daiKey, USER1);
      const poolInfo = await rewardsDistribution.liquidityPoolsInfo(daiKey);

      assert.equal(toBN(userInfo.aggregatedReward).toString(), 0);
      assert.equal(toBN(userInfo.lastSupplyCumulativeSum).toString(), toBN(poolInfo.supplyCumulativeSum).toString());
      assert.equal(toBN(userInfo.lastBorrowCumulativeSum).toString(), toBN(poolInfo.borrowCumulativeSum));

      const expectedRewards = wei(1002.2);

      assert.closeTo(
        userBalanceAfter.minus(userBalanceBefore).toNumber(),
        expectedRewards.toNumber(),
        wei(0.01).toNumber()
      );
    });

    it("should claim correct rewards from several pools with deposits and borrows", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey, wEthKey, usdtKey], [wei(2), oneToken, wei(5)]);

      for (let i = 0; i < keys.length; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
        await defiCore.borrowFor(keys[i], borrowAmount, USER1, { from: USER1 });
      }

      await mine(500);

      for (let i = 0; i < keys.length; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
        await defiCore.borrowFor(keys[i], borrowAmount, USER1, { from: USER1 });
      }

      const userBalanceBefore = toBN(await rewardsToken.balanceOf(USER1));

      await defiCore.claimDistributionRewards(keys, false, { from: USER1 });

      const userBalanceAfter = toBN(await rewardsToken.balanceOf(USER1));

      const expectedRewards = wei(4066.8);

      assert.closeTo(
        userBalanceAfter.minus(userBalanceBefore).toNumber(),
        expectedRewards.toNumber(),
        wei(0.01).toNumber()
      );
    });

    it("should get exception if rewards token doesn't set", async () => {
      const reason = "DefiCore: Unable to claim distribution rewards.";

      await truffleAssert.reverts(defiCore.claimDistributionRewards([], true, { from: USER1 }), reason);
    });

    it("should get exception if contract balance less than claim amount", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);

      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [wei(200)]);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      await mine(50);

      const reason = "DefiCore: Not enough rewards tokens on the contract.";
      await truffleAssert.reverts(defiCore.claimDistributionRewards([], true, { from: USER1 }), reason);
    });

    it("should get exception if nothing to claim", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);

      const reason = "DefiCore: Nothing to claim.";

      await truffleAssert.reverts(defiCore.claimDistributionRewards([], true, { from: USER1 }), reason);
    });
  });

  describe("approveToDelegateBorrow", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    it("should add approve borrow delegatee to the system", async () => {
      amountToBorrow = wei(100);

      const txReceipt = await defiCore.approveToDelegateBorrow(wEthKey, amountToBorrow, USER2, 0, { from: USER1 });

      const result = await wEthPool.borrowAllowances(USER1, USER2);

      assert.equal(amountToBorrow.toString(), toBN(result).toString());

      assert.equal(txReceipt.receipt.logs[0].event, "DelegateBorrowApproved");
      assert.equal(txReceipt.receipt.logs[0].args.userAddr, USER1);
      assert.equal(txReceipt.receipt.logs[0].args.delegateeAddr, USER2);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args.assetKey, wEthKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args.newAmount).toString(), amountToBorrow.toString());
    });

    it("should get exception if expected allowance is not the same as current", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.approveToDelegateBorrow(daiKey, borrowAmount, USER2, 0, { from: USER1 });

      assert.equal(toBN(await daiPool.borrowAllowances(USER1, USER2)).toString(), borrowAmount);

      await defiCore.delegateBorrow(daiKey, borrowAmount, USER1, { from: USER2 });

      assert.equal(toBN(await daiPool.borrowAllowances(USER1, USER2)).toString(), 0);

      const reason = "AbstractPool: The current allowance is not the same as expected.";

      await truffleAssert.reverts(
        defiCore.approveToDelegateBorrow(daiKey, borrowAmount, USER2, borrowAmount, { from: USER1 }),
        reason
      );
    });
  });

  describe("delegateBorrow", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.approveToDelegateBorrow(wEthKey, borrowAmount, USER2, 0, { from: USER1 });
    });

    it("should correctly borrow tokens", async () => {
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await wEthPool.updateCompoundRate(false);
      const txReceipt = await defiCore.delegateBorrow(wEthKey, borrowAmount, USER1, { from: USER2 });

      assert.equal(txReceipt.receipt.logs.length, 1);

      assert.equal(txReceipt.receipt.logs[0].event, "Borrowed");
      assert.equal(txReceipt.receipt.logs[0].args.borrower, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args.assetKey, wEthKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args.borrowedAmount).toString(), borrowAmount.toString());

      const currentRate = toBN(await wEthPool.getCurrentRate());
      const expectedNormalizedAmount = getNormalizedAmount(toBN(0), borrowAmount, currentRate, true);

      assert.equal(
        toBN((await wEthPool.borrowInfos(USER1)).normalizedAmount).toString(),
        expectedNormalizedAmount.toString()
      );
      assert.equal(
        toBN(await wEthPool.aggregatedNormalizedBorrowedAmount()).toString(),
        expectedNormalizedAmount.toString()
      );
      assert.equal(
        toBN(await tokens[2].balanceOf(USER2)).toString(),
        tokensAmount.minus(expectedNormalizedAmount).toString()
      );
      assert.equal(toBN(await wEthPool.borrowAllowances(USER1, USER2)).toString(), toBN(0).toString());
      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), [wEthKey]));
    });

    it("should get exception if user is not a part of delegation", async () => {
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await wEthPool.updateCompoundRate(false);

      const reason = "AbstractPool: Not enough allowed to borrow amount.";
      await truffleAssert.reverts(defiCore.delegateBorrow(wEthKey, borrowAmount, USER1, { from: OWNER }), reason);
    });

    it("should get exception if borrow amount is zero", async () => {
      const reason = "DefiCore: Borrow amount must be greater than zero.";
      await truffleAssert.reverts(defiCore.delegateBorrow(wEthKey, 0, USER1, { from: USER2 }), reason);
    });

    it("should get exception if asset does not exists", async () => {
      const someAssetKey = toBytes("SOME_ASSET");
      const reason = "AssetParameters: Param for this asset doesn't exist.";
      await truffleAssert.reverts(defiCore.delegateBorrow(someAssetKey, borrowAmount, USER1, { from: USER2 }), reason);
    });

    it("should get exception if not enough available liquidity", async () => {
      const reason = "DefiCore: Not enough available liquidity.";
      await truffleAssert.reverts(
        defiCore.delegateBorrow(wEthKey, liquidityAmount.times(2), USER1, { from: USER2 }),
        reason
      );
    });

    it("should get exception if liquidity pool sis freezed", async () => {
      await assetParameters.freeze(wEthKey);

      const reason = "DefiCore: Pool is freeze for borrow operations.";
      await truffleAssert.reverts(defiCore.delegateBorrow(wEthKey, borrowAmount, USER1, { from: USER2 }), reason);
    });
  });

  describe("delegateRepayBorrow", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(75);
    const repayBorrowAmount = wei(50);
    const startTime = toBN(100000);

    beforeEach("setup", async () => {
      await setNextBlockTime(startTime.toNumber());

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.approveToDelegateBorrow(wEthKey, borrowAmount, USER2, 0, { from: USER1 });
      await wEthPool.updateCompoundRate(false);
      await defiCore.delegateBorrow(wEthKey, borrowAmount, USER1, { from: USER2 });

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), [wEthKey]));
    });

    it("should correctly repay borrow", async () => {
      await setNextBlockTime(startTime.times(100).toNumber());

      const currentNormalizedAmount = toBN((await wEthPool.borrowInfos(USER1)).normalizedAmount);

      await wEthPool.updateCompoundRate(false);
      const txReceipt = await defiCore.delegateRepayBorrow(wEthKey, repayBorrowAmount, USER1, false, { from: USER2 });

      const currentRate = toBN(await wEthPool.getCurrentRate());
      const expectedNormalizedAmount = getNormalizedAmount(
        currentNormalizedAmount,
        repayBorrowAmount,
        currentRate,
        false
      );

      assert.equal(txReceipt.receipt.logs.length, 1);

      assert.equal(txReceipt.receipt.logs[0].event, "BorrowRepaid");
      assert.equal(txReceipt.receipt.logs[0].args.userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args.assetKey, wEthKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args.repaidAmount).toString(), repayBorrowAmount.toString());

      assert.equal(
        (await wEthPool.borrowInfos(USER1)).normalizedAmount.toString(),
        expectedNormalizedAmount.toString()
      );
      assert.equal(
        toBN(await wEthPool.aggregatedNormalizedBorrowedAmount()).toString(),
        expectedNormalizedAmount.toString()
      );
      assert.equal((await tokens[2].balanceOf(USER2)).toString(), tokensAmount.minus(borrowAmount).toString());

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), [wEthKey]));
    });

    it("should fully repay borrow and remove assets from the list", async () => {
      await setNextBlockTime(startTime.times(100).toNumber());

      await wEthPool.updateCompoundRate(false);
      await await defiCore.delegateRepayBorrow(wEthKey, borrowAmount.times(2), USER1, { from: USER2 });

      assert.equal((await wEthPool.borrowInfos(USER1)).normalizedAmount.toString(), 0);
      assert.equal((await wEthPool.aggregatedNormalizedBorrowedAmount()).toString(), 0);

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), []));
    });

    it("should get exception if repay borrow amount is zero", async () => {
      const reason = "DefiCore: Zero amount cannot be repaid.";
      await truffleAssert.reverts(defiCore.delegateRepayBorrow(wEthKey, 0, USER1, { from: USER2 }), reason);
    });
  });

  describe("borrowFor", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
    });

    it("should correctly borrow tokens", async () => {
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await wEthPool.updateCompoundRate(false);
      const txReceipt = await defiCore.borrowFor(wEthKey, borrowAmount, USER2, { from: USER1 });

      assert.equal(txReceipt.receipt.logs.length, 1);

      assert.equal(txReceipt.receipt.logs[0].event, "Borrowed");
      assert.equal(txReceipt.receipt.logs[0].args.borrower, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args.assetKey, wEthKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args.borrowedAmount).toString(), borrowAmount.toString());

      const currentRate = toBN(await wEthPool.getCurrentRate());
      const expectedNormalizedAmount = getNormalizedAmount(toBN(0), borrowAmount, currentRate, true);

      assert.equal(
        toBN((await wEthPool.borrowInfos(USER1)).normalizedAmount).toString(),
        expectedNormalizedAmount.toString()
      );
      assert.equal(
        toBN(await wEthPool.aggregatedNormalizedBorrowedAmount()).toString(),
        expectedNormalizedAmount.toString()
      );
      assert.equal(
        toBN(await tokens[2].balanceOf(USER2)).toString(),
        tokensAmount.minus(expectedNormalizedAmount).toString()
      );
      assert.equal(toBN(await wEthPool.borrowAllowances(USER1, USER2)).toString(), toBN(0).toString());
      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), [wEthKey]));
    });

    it("should get exception if debt higher than zero", async () => {
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await defiCore.borrowFor(wEthKey, borrowAmount.times(1.5), USER2, { from: USER2 });

      const price = toBN(82).times(priceDecimals);
      await daiChainlinkOracle.setPrice(price);

      const reason = "DefiCore: Unable to borrow because the account is in arrears.";
      await truffleAssert.reverts(defiCore.borrowFor(daiKey, borrowAmount.idiv(5), USER2, { from: USER2 }), reason);
    });

    it("should get exception if borrow amount is zero", async () => {
      const reason = "DefiCore: Borrow amount must be greater than zero.";
      await truffleAssert.reverts(defiCore.borrowFor(wEthKey, 0, USER2, { from: USER1 }), reason);
    });

    it("should get exception if asset does not exists", async () => {
      const someAssetKey = toBytes("SOME_ASSET");
      const reason = "AssetParameters: Param for this asset doesn't exist.";
      await truffleAssert.reverts(defiCore.borrowFor(someAssetKey, borrowAmount, USER2, { from: USER1 }), reason);
    });

    it("should get exception if not enough available liquidity", async () => {
      const reason = "DefiCore: Not enough available liquidity.";
      await truffleAssert.reverts(
        defiCore.borrowFor(wEthKey, liquidityAmount.times(2), USER2, { from: USER1 }),
        reason
      );
    });

    it("should get exception if liquidity pool sis freezed", async () => {
      await assetParameters.freeze(wEthKey);

      const reason = "DefiCore: Pool is freeze for borrow operations.";
      await truffleAssert.reverts(defiCore.borrowFor(wEthKey, borrowAmount, USER2, { from: USER1 }), reason);
    });
  });

  describe("getMaxToWithdraw - withdrawLiquidity - exchangeRate integration tests", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(30);

    it("should correctly change exchange rate after withdraw and repay", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: OWNER });

      await defiCore.borrowFor(daiKey, borrowAmount, OWNER, { from: OWNER });

      await setNextBlockTime(10000000);

      await daiPool.updateCompoundRate(false);

      await defiCore.withdrawLiquidity(daiKey, await defiCore.getUserLiquidityAmount(USER1, daiKey), true, {
        from: USER1,
      });

      assert.equal(toBN(await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), 0);

      await defiCore.repayBorrow(daiKey, 0, true, { from: OWNER });

      await defiCore.withdrawLiquidity(daiKey, await defiCore.getUserLiquidityAmount(USER2, daiKey), true, {
        from: USER2,
      });
      assert.equal(toBN(await defiCore.getUserLiquidityAmount(USER2, daiKey)).toString(), 0);

      assert.equal(
        toBN(await tokens[1].balanceOf(daiPool.address)).toString(),
        toBN(await daiPool.totalReserves()).toString()
      );
    });

    it("should correctly withdraw max possible liquidity", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: OWNER });

      await defiCore.borrowFor(daiKey, borrowAmount, OWNER, { from: OWNER });

      await setNextBlockTime(10000000);

      await daiPool.updateCompoundRate(false);
      await defiCore.withdrawLiquidity(daiKey, await defiCore.getUserLiquidityAmount(USER1, daiKey), true, {
        from: USER1,
      });
      assert.equal((await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), 0);

      await defiCore.repayBorrow(daiKey, borrowAmount.idiv(2), false, { from: OWNER });

      await setNextBlockTime(100000000);

      await daiPool.updateCompoundRate(false);
      await defiCore.withdrawLiquidity(daiKey, await defiCore.getMaxToWithdraw(USER2, daiKey), true, { from: USER2 });

      assert.equal((await defiCore.getMaxToWithdraw(USER2, daiKey)).toString(), 0);
      assert.closeTo(
        (await daiPool.getBorrowPercentage()).toNumber(),
        maxUR.toNumber(),
        getPrecision().idiv(100).toNumber()
      );
    });

    it("should correctly borrow max possible liquidity and return user info", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(2), { from: USER1 });

      let borrowAmount = await defiCore.getMaxToBorrow(USER1, daiKey);

      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      assert.closeTo(
        (await daiPool.getBorrowPercentage()).toNumber(),
        getPrecision().times(95).toNumber(),
        getPrecision().idiv(100).toNumber()
      );

      const currentTime = toBN(await getCurrentBlockTime());

      await setNextBlockTime(currentTime.plus(1000000).toNumber());

      await defiCore.repayBorrow(daiKey, 0, true, { from: USER1 });

      await defiCore.withdrawLiquidity(daiKey, liquidityAmount.idiv(2), false, { from: USER1 });

      await defiCore.addLiquidity(daiKey, liquidityAmount.idiv(2), { from: USER2 });

      borrowAmount = await defiCore.getMaxToBorrow(USER1, daiKey);

      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      assert.closeTo(
        (await daiPool.getBorrowPercentage()).toNumber(),
        getPrecision().times(95).toNumber(),
        getPrecision().idiv(100).toNumber()
      );

      await systemPoolsRegistry.getLiquidityPoolsInfo([daiKey]);
      await userInfoRegistry.getUserMainInfo(USER1);
    });
  });

  describe("getMaxToSupply", () => {
    it("should return correct amount", async () => {
      assert.equal(
        (await defiCore.getMaxToSupply(USER1, daiKey)).toString(),
        (await tokens[1].balanceOf(USER1)).toString()
      );
    });

    it("should return correct amount to native pool", async () => {
      const depositAmount = wei(100);

      await nativeToken.deposit({ from: USER1, value: depositAmount });

      const expectedMaxToSupply = toBN(await web3.eth.getBalance(USER1)).plus(depositAmount);

      assert.equal((await defiCore.getMaxToSupply(USER1, nativeTokenKey)).toString(), expectedMaxToSupply.toString());
    });
  });

  describe("getMaxToWithdraw", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    it("should return correct value if BA = 0", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await setTime(
        toBN(await getCurrentBlockTime())
          .plus(100)
          .toNumber()
      );

      assert.equal((await defiCore.getMaxToWithdraw(USER1, daiKey)).toString(), wei(100).toString());
    });

    it("should return correct value if BA > 0", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount.idiv(2), { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.idiv(10), { from: USER1 });

      await defiCore.borrowFor(wEthKey, borrowAmount.idiv(2), USER1, { from: USER1 });

      await setNextBlockTime(
        toBN(await getCurrentBlockTime())
          .plus(100)
          .toNumber()
      );

      assert.equal((await defiCore.getMaxToWithdraw(USER1, daiKey)).toString(), wei(28.75).toString());
      assert.equal((await defiCore.getMaxToWithdraw(USER1, wEthKey)).toString(), wei(10).toString());
    });

    it("should return correct value if AL = 0", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.borrowFor(wEthKey, wei(80), USER1, { from: USER1 });

      await setNextBlockTime(
        toBN(await getCurrentBlockTime())
          .plus(100)
          .toNumber()
      );

      assert.equal((await defiCore.getMaxToWithdraw(USER1, daiKey)).toString(), 0);
    });

    it("should return correct value if BA > 0", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      await setNextBlockTime(1000000);

      await defiCore.repayBorrow(daiKey, 0, true, { from: USER1 });

      await defiCore.withdrawLiquidity(daiKey, await defiCore.getMaxToWithdraw(USER1, daiKey), true, {
        from: USER1,
      });

      assert.equal((await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), 0);
    });

    it("should return correct value if UR = maxUR", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(2), { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      const maxBorrowAmount = await defiCore.getMaxToBorrow(USER1, wEthKey);

      await defiCore.borrowFor(wEthKey, maxBorrowAmount, USER1, { from: USER1 });

      assert.equal((await wEthPool.getBorrowPercentage()).toString(), maxUR.toString());
      assert.equal((await defiCore.getMaxToWithdraw(USER2, wEthKey)).toString(), 0);
    });

    it("should return correct values if users debt > 0", async () => {
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });

      await defiCore.borrowFor(daiKey, borrowAmount.times(1.5), USER1, { from: USER1 });

      const price = toBN(90);

      await wEthChainlinkOracle.setPrice(wei(price, chainlinkPriceDecimals));

      const res = await defiCore.getAvailableLiquidity(USER1);

      assert.equal(res[0].toString(), 0);
      assert.isTrue(res[1].gt(0));

      assert.equal((await defiCore.getMaxToWithdraw(USER1, wEthKey)).toString(), 0);
    });
  });

  describe("getMaxToBorrow", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(75);

    it("should return correct value if available liquidity less than pool capacity", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal((await defiCore.getMaxToBorrow(USER1, daiKey)).toString(), wei(80).toString());
    });

    it("should return correct value if available liquidity greater than pool capacity", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      assert.equal((await defiCore.getMaxToBorrow(USER1, daiKey)).toString(), wei(95).toString());
    });

    it("should return correct value UR = max UR", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(3), { from: USER2 });
      await defiCore.borrowFor(daiKey, wei(95), USER2, { from: USER2 });

      assert.equal((await defiCore.getMaxToBorrow(USER1, daiKey)).toString(), 0);
    });

    it("should return correct value if users debt > 0", async () => {
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });

      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      const price = toBN(90);

      await wEthChainlinkOracle.setPrice(wei(price, chainlinkPriceDecimals));

      const res = await defiCore.getAvailableLiquidity(USER1);

      assert.equal(res[0].toString(), 0);
      assert.isTrue(res[1].gt(0));

      assert.equal((await defiCore.getMaxToBorrow(USER1, daiKey)).toString(), 0);
    });

    it("should correct borrow maximum", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.borrowFor(daiKey, await defiCore.getMaxToBorrow(USER1, daiKey), USER1, { from: USER1 });

      assert.equal((await defiCore.getAvailableLiquidity(USER1))[0].toString(), 0);
    });

    it("should return correct max borrow amount for stable pool", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      assert.equal((await defiCore.getMaxToBorrow(USER1, stableKey)).toFixed(), wei(16000).toFixed());
    });
  });

  describe("getMaxToRepay", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    it("should return correct value if BA = 0", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal(toBN(await defiCore.getMaxToRepay(USER1, daiKey)).toString(), 0);
    });

    it("should return correct value if available liquidity greater than pool capacity", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      await setTime(100000);

      const currentInterest = toBN(await defiCore.getMaxToRepay(USER1, daiKey)).minus(
        await daiPool.aggregatedBorrowedAmount()
      );

      await defiCore.repayBorrow(daiKey, 0, true, { from: USER1 });

      assert.closeTo(
        (await daiPool.getAggregatedLiquidityAmount()).toNumber(),
        liquidityAmount.plus(currentInterest.times(0.85)).toNumber(),
        oneToken.idiv(10).toNumber()
      );

      assert.closeTo(
        (await tokens[1].balanceOf(daiPool.address)).toNumber(),
        liquidityAmount.plus(currentInterest).toNumber(),
        oneToken.idiv(10).toNumber()
      );

      assert.closeTo(
        (await daiPool.totalReserves()).toNumber(),
        toBN(currentInterest.times(0.15).toFixed(0, 2)).toNumber(),
        oneToken.idiv(10).toNumber()
      );
    });

    it("should correct repay all debt", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      await setNextBlockTime(100000);

      await defiCore.repayBorrow(daiKey, 0, true, { from: USER1 });

      assert.equal((await defiCore.getUserBorrowedAmount(USER1, daiKey)).toString(), 0);
    });

    it("should get correct amount for native pool", async () => {
      let currentBalance = toBN(await web3.eth.getBalance(USER1)).minus(wei(40));

      await defiCore.addLiquidity(nativeTokenKey, currentBalance, { from: USER1, value: currentBalance });
      await defiCore.borrowFor(nativeTokenKey, borrowAmount, USER1, { from: USER1 });

      await web3.eth.sendTransaction({ to: USER2, from: USER1, gas: wei(1, 7), value: borrowAmount });

      currentBalance = toBN(await web3.eth.getBalance(USER1));
      assert.equal(
        (await defiCore.getMaxToRepay(USER1, nativeTokenKey)).toString(),
        currentBalance.minus(minCurrencyAmount).toString()
      );

      const depositAmount = currentBalance.idiv(2);
      await nativeToken.deposit({ from: USER1, value: depositAmount });

      currentBalance = toBN(await web3.eth.getBalance(USER1));
      assert.equal(
        (await defiCore.getMaxToRepay(USER1, nativeTokenKey)).toString(),
        depositAmount.plus(currentBalance).minus(minCurrencyAmount).toString()
      );
    });
  });

  describe("pause/unpause", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    it("should correctly pause and unpause system", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.pause();

      const reason = "Pausable: paused";

      await truffleAssert.reverts(defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 }), reason);
      await truffleAssert.reverts(defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 }), reason);

      await defiCore.unpause();

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });
    });

    it("should get exception if call by non system owner", async () => {
      const reason = "DefiCore: Only system owner can call this function.";

      await truffleAssert.reverts(defiCore.pause({ from: USER1 }), reason);
    });
  });
});
