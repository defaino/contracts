const { mine, getCurrentBlockTime } = require("./helpers/block-helper");
const { toBytes, compareKeys, deepCompareKeys } = require("./helpers/bytesCompareLibrary");
const { getInterestRateLibraryAddr } = require("./helpers/coverage-helper");
const { toBN, accounts, getPrecision, getPercentage100, wei } = require("../scripts/utils/utils");
const { ZERO_ADDR } = require("../scripts/utils/constants");

const truffleAssert = require("truffle-assertions");
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
const Prt = artifacts.require("PRT");
const WETH = artifacts.require("WETH");
const StablePermitToken = artifacts.require("StablePermitTokenMock");

const MockERC20 = artifacts.require("MockERC20");
const ChainlinkOracleMock = artifacts.require("ChainlinkOracleMock");

MockERC20.numberFormat = "BigNumber";
DefiCore.numberFormat = "BigNumber";
LiquidityPool.numberFormat = "BigNumber";
UserInfoRegistry.numberFormat = "BigNumber";
WETH.numberFormat = "BigNumber";

describe("UserInfoRegistry", () => {
  const reverter = new Reverter();

  let OWNER;
  let USER1;
  let USER2;
  let USER3;
  let USER4;

  let registry;
  let defiCore;
  let assetParameters;
  let systemParameters;
  let userInfoRegistry;
  let systemPoolsRegistry;
  let rewardsDistribution;
  let prt;

  let nativePool;
  let daiPool;

  const tokens = [];

  let daiChainlinkOracle;
  let wEthChainlinkOracle;

  let rewardsToken;
  let nativeToken;

  const oneToken = wei(1);
  const tokensAmount = wei(100000);
  const colRatio = getPercentage100().times("1.25");
  const reserveFactor = getPrecision().times("15");

  const annualBorrowRate = getPrecision().times(3);
  const firstSlope = getPrecision().times(4);
  const secondSlope = getPercentage100();
  const utilizationBreakingPoint = getPrecision().times(80);
  const maxUR = getPrecision().times(95);
  const liquidationDiscount = getPrecision().times(8);
  const liquidationBoundary = getPrecision().times(50);

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
      await token.mintArbitraryBatch(
        [OWNER, USER1, USER2, USER3, USER4],
        [tokensAmount, tokensAmount, tokensAmount, tokensAmount, tokensAmount]
      );

      tokens.push(token);
    }
  }

  async function createLiquidityPool(assetKey, asset, symbol, isCollateral, isRewardsPool) {
    const chainlinkOracle = await ChainlinkOracleMock.new(wei(100, chainlinkPriceDecimals), chainlinkPriceDecimals);

    await systemPoolsRegistry.addLiquidityPool(
      asset.address,
      assetKey,
      chainlinkOracle.address,
      symbol,
      isCollateral,
      isCollateral
    );

    if (!isRewardsPool && assetKey != nativeTokenKey) {
      await asset.approveArbitraryBatch(
        await getLiquidityPoolAddr(assetKey),
        [OWNER, USER1, USER2, USER3, USER4],
        [tokensAmount, tokensAmount, tokensAmount, tokensAmount, tokensAmount]
      );
    }

    await assetParameters.setupAllParameters(assetKey, [
      [colRatio, colRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);

    return chainlinkOracle;
  }

  async function createStablePool(assetKey, assetAddr) {
    await systemPoolsRegistry.addStablePool(assetAddr, assetKey, ZERO_ADDR);

    await assetParameters.setupAnnualBorrowRate(assetKey, annualBorrowRate);
    await assetParameters.setupMainParameters(assetKey, [
      colRatio,
      colRatio,
      reserveFactor,
      liquidationDiscount,
      maxUR,
    ]);
  }

  function convertToUSD(amountToConvert, price = toBN(100)) {
    return amountToConvert.times(price).times(priceDecimals).idiv(oneToken);
  }

  function convertFromUSD(amountToConvert, price = toBN(100)) {
    return amountToConvert.times(oneToken).idiv(priceDecimals.times(price));
  }

  function convertToBorrowLimit(amountToConvert, convertColRatio = colRatio, isConvertToUSD = true) {
    if (isConvertToUSD) {
      return convertToUSD(amountToConvert.times(getPercentage100()).idiv(convertColRatio));
    }

    return amountToConvert.times(getPercentage100()).idiv(convertColRatio);
  }

  before("setup", async () => {
    OWNER = await accounts(0);
    USER1 = await accounts(1);
    USER2 = await accounts(2);
    USER3 = await accounts(3);
    USER4 = await accounts(4);
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
    prt = await Prt.at(await registry.getPRTContract());

    await registry.injectDependencies(await registry.DEFI_CORE_NAME());
    await registry.injectDependencies(await registry.SYSTEM_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.ASSET_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.REWARDS_DISTRIBUTION_NAME());
    await registry.injectDependencies(await registry.USER_INFO_REGISTRY_NAME());
    await registry.injectDependencies(await registry.SYSTEM_POOLS_REGISTRY_NAME());
    await registry.injectDependencies(await registry.SYSTEM_POOLS_FACTORY_NAME());
    await registry.injectDependencies(await registry.PRICE_MANAGER_NAME());
    await registry.injectDependencies(await registry.PRT_NAME());

    tokens.push(rewardsToken);
    await deployTokens(["DAI", "WETH", "USDT"]);
    tokens.push(nativeToken);

    await defiCore.defiCoreInitialize();
    await systemPoolsRegistry.systemPoolsRegistryInitialize(_liquidityPoolImpl.address, nativeTokenKey, zeroKey);
    await prt.prtInitialize("Platform Reputation Token", "PRT", [
      [1000000000000, 100],
      [300000000000, 100],
    ]);

    await systemPoolsRegistry.addPoolsBeacon(1, _stablePoolImpl.address);
    await systemParameters.setupStablePoolsAvailability(true);

    await createLiquidityPool(rewardsTokenKey, tokens[0], await rewardsToken.symbol(), true, true);
    await createStablePool(stableKey, stableToken.address);

    daiChainlinkOracle = await createLiquidityPool(daiKey, tokens[1], "DAI", true, false);
    wEthChainlinkOracle = await createLiquidityPool(wEthKey, tokens[2], "WETH", true, false);
    usdtChainlinkOracle = await createLiquidityPool(usdtKey, tokens[3], "USDT", true, false);

    await createLiquidityPool(nativeTokenKey, tokens[4], "BNB", true, false);

    usdtPool = await LiquidityPool.at(await getLiquidityPoolAddr(usdtKey));
    nativePool = await LiquidityPool.at(await getLiquidityPoolAddr(nativeTokenKey));
    daiPool = await LiquidityPool.at(await getLiquidityPoolAddr(daiKey));

    await systemParameters.setupLiquidationBoundary(liquidationBoundary);
    await systemParameters.setRewardsTokenAddress(ZERO_ADDR);

    // await rewardsDistribution.setupRewardsPerBlockBatch(
    //   [daiKey, wEthKey, usdtKey, rewardsTokenKey, nativeTokenKey],
    //   [wei(2), oneToken, wei(5), oneToken, oneToken]
    // );

    await rewardsToken.mintArbitrary(defiCore.address, tokensAmount);
    await nativeToken.approve(nativePool.address, tokensAmount);

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("getUserPRTStats", () => {
    it("PRTStats should be set correctly after suppy, borrow, repay and liqudiation", async () => {
      const liquidityAmount = wei(10000);
      const amountToBorrow = wei(3000);
      let price = wei(1, 7);

      await daiChainlinkOracle.setPrice(price);
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      let prtStats = await userInfoRegistry.getUserPRTStats(USER1);

      assert.equal(toBN(prtStats.liquidationsNum).toString(), toBN(0).toString());
      assert.equal(toBN(prtStats.repaysNum).toString(), toBN(0).toString());
      assert.equal(toBN(prtStats.borrowStats.amountInUSD).toString(), toBN(0).toString());
      assert.equal(toBN(prtStats.borrowStats.timestamp).toString(), toBN(0).toString());
      assert.equal(toBN(prtStats.supplyStats.amountInUSD).toString(), toBN(10000).times(wei(1, 7)));
      assert.equal(toBN(prtStats.supplyStats.timestamp).toString(), toBN(0).toString());

      await defiCore.addLiquidity(daiKey, liquidityAmount.times(9), { from: USER1 });
      prtStats = await userInfoRegistry.getUserPRTStats(USER1);

      assert.equal(toBN(prtStats.liquidationsNum).toString(), toBN(0).toString());
      assert.equal(toBN(prtStats.repaysNum).toString(), toBN(0).toString());
      assert.equal(toBN(prtStats.borrowStats.amountInUSD).toString(), toBN(0).toString());
      assert.equal(toBN(prtStats.borrowStats.timestamp).toString(), toBN(0).toString());
      assert.equal(toBN(prtStats.supplyStats.amountInUSD).toString(), toBN(10000).times(wei(1, 8)).toString());
      assert.equal(toBN(prtStats.supplyStats.timestamp).toString(), toBN(await getCurrentBlockTime()).toString());

      price = wei(1, 7);
      await usdtChainlinkOracle.setPrice(price);
      await usdtPool.updateCompoundRate(false);

      await defiCore.addLiquidity(usdtKey, amountToBorrow.times(20), { from: USER2 });
      await defiCore.borrowFor(usdtKey, amountToBorrow, USER1, { from: USER1 });

      prtStats = await userInfoRegistry.getUserPRTStats(USER1);
      assert.equal(toBN(prtStats.liquidationsNum).toString(), toBN(0).toString());
      assert.equal(toBN(prtStats.repaysNum).toString(), toBN(0).toString());
      assert.equal(toBN(prtStats.borrowStats.amountInUSD).toString(), toBN(3000).times(wei(1, 7)).toString());
      assert.equal(toBN(prtStats.borrowStats.timestamp).toString(), toBN(0).toString());
      assert.equal(toBN(prtStats.supplyStats.amountInUSD).toString(), toBN(10000).times(wei(1, 8)).toString());
      assert.equal(toBN(prtStats.supplyStats.timestamp).toString(), toBN((await getCurrentBlockTime()) - 4).toString());

      await defiCore.borrowFor(usdtKey, amountToBorrow.times(11), USER1, { from: USER1 });

      prtStats = await userInfoRegistry.getUserPRTStats(USER1);
      assert.equal(toBN(prtStats.liquidationsNum).toString(), toBN(0).toString());
      assert.equal(toBN(prtStats.repaysNum).toString(), toBN(0).toString());
      assert.equal(toBN(prtStats.borrowStats.amountInUSD).toString(), toBN(3600).times(wei(1, 8)).toString());
      assert.equal(toBN(prtStats.borrowStats.timestamp).toString(), toBN(await getCurrentBlockTime()).toString());
      assert.equal(toBN(prtStats.supplyStats.amountInUSD).toString(), toBN(10000).times(wei(1, 8)).toString());
      assert.equal(toBN(prtStats.supplyStats.timestamp).toString(), toBN((await getCurrentBlockTime()) - 5).toString());

      let amountToRepayBorrow = amountToBorrow;

      await defiCore.repayBorrow(usdtKey, amountToRepayBorrow, false, { from: USER1 });
      prtStats = await userInfoRegistry.getUserPRTStats(USER1);
      assert.equal(toBN(prtStats.liquidationsNum).toString(), toBN(0).toString());
      assert.equal(toBN(prtStats.repaysNum).toString(), toBN(1).toString());
      assert.equal(
        toBN(prtStats.borrowStats.amountInUSD).toNumber(),
        (await await defiCore.getTotalBorrowBalanceInUSD(USER1)).toNumber()
      );
      assert.equal(toBN(prtStats.borrowStats.timestamp).toString(), toBN((await getCurrentBlockTime()) - 1).toString());
      assert.equal(toBN(prtStats.supplyStats.amountInUSD).toString(), toBN(10000).times(wei(1, 8)).toString());
      assert.equal(toBN(prtStats.supplyStats.timestamp).toString(), toBN((await getCurrentBlockTime()) - 6).toString());

      price = toBN(46);
      liquidateAmount = await userInfoRegistry.getMaxLiquidationQuantity(USER1, daiKey, usdtKey);
      await usdtChainlinkOracle.setPrice(price.times(priceDecimals));

      await defiCore.liquidation(USER1, daiKey, usdtKey, liquidateAmount, { from: USER2 });

      assert.equal(toBN(prtStats.liquidationsNum).toString(), toBN(0).toString());
      assert.equal(toBN(prtStats.repaysNum).toString(), toBN(1).toString());
    });
  });

  describe("modifiers check", () => {
    it("should get exception if not a DefiCore call functions", async () => {
      const reason = "UserInfoRegistry: Caller not a DefiCore.";

      await truffleAssert.reverts(userInfoRegistry.updateUserAssets(USER1, daiKey, true), reason);
      await truffleAssert.reverts(userInfoRegistry.updateUserAssets(USER1, daiKey, false), reason);
    });

    it("should get exception if caller not a LiquidityPool", async () => {
      const reason = "UserInfoRegistry: Caller not a LiquidityPool.";

      await truffleAssert.reverts(userInfoRegistry.updateAssetsAfterTransfer(daiKey, USER1, USER2, wei(10)), reason);
    });
  });

  describe("getUserSupplyAssets", () => {
    const liquidityAmount = wei(100);

    it("should return empty array if user does not have any deposits", async () => {
      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserSupplyAssets(USER1), []));
    });

    it("should return correct assets array", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(usdtKey, liquidityAmount, { from: USER1 });

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserSupplyAssets(USER1), [daiKey, usdtKey]));

      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserSupplyAssets(USER1), [daiKey, usdtKey, wEthKey]));

      await defiCore.withdrawLiquidity(usdtKey, 0, true, { from: USER1 });

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserSupplyAssets(USER1), [daiKey, wEthKey]));
    });
  });

  describe("getUserBorrowAssets", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(10);

    it("should return empty array if user does not have any borrows", async () => {
      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), []));
    });

    it("should return correct assets array", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(usdtKey, liquidityAmount, { from: USER1 });

      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });
      await defiCore.borrowFor(usdtKey, borrowAmount, USER1, { from: USER1 });

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), [daiKey, usdtKey]));

      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(wEthKey, borrowAmount, USER1, { from: USER1 });

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), [daiKey, usdtKey, wEthKey]));

      await defiCore.repayBorrow(usdtKey, 0, true, { from: USER1 });

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserBorrowAssets(USER1), [daiKey, wEthKey]));
    });
  });

  describe("getUserMainInfo", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(20);

    it("should return correct user main info", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });
      await defiCore.borrowFor(wEthKey, borrowAmount, USER1, { from: USER1 });

      let userMainInfo = await userInfoRegistry.getUserMainInfo(USER1);

      let totalBorrowBalanceInUSD = convertToUSD(borrowAmount.times(2));
      let borrowLimitInUSD = convertToBorrowLimit(liquidityAmount);

      assert.equal(userMainInfo.userCurrencyBalance.toString(), toBN(await web3.eth.getBalance(USER1)).toFixed());
      assert.equal(userMainInfo.totalSupplyBalanceInUSD.toString(), convertToUSD(liquidityAmount).toString());
      assert.equal(userMainInfo.totalBorrowBalanceInUSD.toString(), totalBorrowBalanceInUSD.toString());
      assert.equal(userMainInfo.borrowLimitInUSD.toString(), borrowLimitInUSD.toString());
      assert.equal(
        userMainInfo.borrowLimitUsed.toString(),
        totalBorrowBalanceInUSD.times(getPercentage100()).idiv(borrowLimitInUSD).toFixed()
      );

      await defiCore.addLiquidity(wEthKey, liquidityAmount.idiv(2), { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount.idiv(2), USER1, { from: USER1 });

      userMainInfo = await userInfoRegistry.getUserMainInfo(USER1);

      totalBorrowBalanceInUSD = convertToUSD(borrowAmount.times(2.5));
      borrowLimitInUSD = convertToBorrowLimit(liquidityAmount.times(1.5));

      assert.equal(
        userMainInfo.totalSupplyBalanceInUSD.toString(),
        convertToUSD(liquidityAmount.times(1.5)).toString()
      );
      assert.equal(userMainInfo.totalBorrowBalanceInUSD.toString(), totalBorrowBalanceInUSD.toString());
      assert.equal(userMainInfo.borrowLimitInUSD.toString(), borrowLimitInUSD.toString());
      assert.equal(
        userMainInfo.borrowLimitUsed.toString(),
        totalBorrowBalanceInUSD.times(getPercentage100()).idiv(borrowLimitInUSD).toFixed()
      );
    });
  });

  describe("getUserDistributionRewards", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    it("should get correct rewards", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [wei(2)]);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await mine(499);

      const expectedRewards = wei(100);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      const rewardInfo = await userInfoRegistry.getUserDistributionRewards(USER1);

      assert.equal(rewardInfo.assetAddr, tokens[0].address);
      assert.equal(rewardInfo.distributionReward.toString(), expectedRewards.toString());
      assert.equal(rewardInfo.distributionRewardInUSD.toString(), convertToUSD(expectedRewards).toString());
      assert.equal(rewardInfo.userBalance.toString(), 0);
      assert.equal(rewardInfo.userBalanceInUSD.toString(), 0);
    });

    it("should get correct rewards after claim", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [wei(2)]);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await mine(499);

      const expectedRewards = wei(100.1);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });

      const userBalanceBefore = toBN(await rewardsToken.balanceOf(USER1));

      await defiCore.claimDistributionRewards([daiKey], false, { from: USER1 });

      const userBalanceAfter = toBN(await rewardsToken.balanceOf(USER1));

      const rewardInfo = await userInfoRegistry.getUserDistributionRewards(USER1);

      assert.equal(rewardInfo.assetAddr, tokens[0].address);
      assert.equal(rewardInfo.distributionReward.toString(), 0);
      assert.equal(rewardInfo.distributionRewardInUSD.toString(), 0);

      const userBalance = await rewardsToken.balanceOf(USER1);
      assert.equal(rewardInfo.userBalance.toString(), userBalance.toString());
      assert.equal(rewardInfo.userBalanceInUSD.toString(), convertToUSD(userBalance).toString());

      assert.closeTo(
        userBalanceAfter.minus(userBalanceBefore).toNumber(),
        expectedRewards.toNumber(),
        wei(0.01).toNumber()
      );
    });

    it("should get correct rewards after deposit and borrow", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [wei(2)]);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      await mine(500);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount.idiv(2), USER1, { from: USER1 });

      const rewardInfo = await userInfoRegistry.getUserDistributionRewards(USER1);
      const expectedReward = wei(1004.2);

      assert.equal(rewardInfo.assetAddr, tokens[0].address);
      assert.equal(rewardInfo.distributionReward.toString(), expectedReward.toFixed());
      assert.equal(rewardInfo.distributionRewardInUSD.toString(), convertToUSD(expectedReward).toFixed());
      assert.equal(rewardInfo.userBalance.toString(), 0);
      assert.equal(rewardInfo.userBalanceInUSD.toString(), 0);
    });

    it("should return emtpy structure if rewards token does not set", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await mine(10);

      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      const rewardInfo = await userInfoRegistry.getUserDistributionRewards(USER1);

      assert.equal(rewardInfo.assetAddr, ZERO_ADDR);
      assert.equal(rewardInfo.distributionReward.toString(), 0);
      assert.equal(rewardInfo.distributionRewardInUSD.toString(), 0);
      assert.equal(rewardInfo.userBalance.toString(), 0);
      assert.equal(rewardInfo.userBalanceInUSD.toString(), 0);
    });
  });

  describe("getUserSupplyPoolsInfo", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    it("should return correct supply pool data", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey, wEthKey], [wei(2), oneToken]);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(2), { from: USER2 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(2), { from: USER2 });

      await defiCore.borrowFor(daiKey, borrowAmount, USER2, { from: USER2 });
      await defiCore.updateCollateral(wEthKey, true, { from: USER1 });

      const dataArr = await userInfoRegistry.getUserSupplyPoolsInfo(USER1, [daiKey, wEthKey]);

      let userSupplyPoolInfo = dataArr[0];
      let totalSupplyAmount = liquidityAmount.times(3);

      assert.isTrue(compareKeys(userSupplyPoolInfo.basePoolInfo.mainInfo.assetKey, daiKey));
      assert.equal(userSupplyPoolInfo.basePoolInfo.mainInfo.assetAddr, tokens[1].address);
      assert.equal(
        userSupplyPoolInfo.basePoolInfo.utilizationRatio.toString(),
        borrowAmount.times(getPercentage100()).idiv(totalSupplyAmount).toFixed()
      );
      assert.isTrue(userSupplyPoolInfo.basePoolInfo.isCollateralEnabled);

      assert.equal(userSupplyPoolInfo.marketSize.toString(), totalSupplyAmount.toString());
      assert.equal(userSupplyPoolInfo.marketSizeInUSD.toString(), convertToUSD(totalSupplyAmount).toString());
      assert.equal(userSupplyPoolInfo.userDeposit.toString(), liquidityAmount.toString());
      assert.equal(userSupplyPoolInfo.userDepositInUSD.toString(), convertToUSD(liquidityAmount).toString());
      assert.equal(userSupplyPoolInfo.supplyAPY.toString(), (await daiPool.getAPY()).toFixed());

      let distrAPYs = await rewardsDistribution.getAPY(daiKey);

      assert.equal(userSupplyPoolInfo.distrSupplyAPY.toString(), toBN(distrAPYs[0]).toFixed());

      userSupplyPoolInfo = dataArr[1];
      totalSupplyAmount = liquidityAmount.times(2);

      assert.isTrue(compareKeys(userSupplyPoolInfo.basePoolInfo.mainInfo.assetKey, wEthKey));
      assert.equal(userSupplyPoolInfo.basePoolInfo.mainInfo.assetAddr, tokens[2].address);
      assert.equal(userSupplyPoolInfo.basePoolInfo.utilizationRatio.toString(), 0);
      assert.isFalse(userSupplyPoolInfo.basePoolInfo.isCollateralEnabled);

      assert.equal(userSupplyPoolInfo.marketSize.toString(), totalSupplyAmount.toString());
      assert.equal(userSupplyPoolInfo.marketSizeInUSD.toString(), convertToUSD(totalSupplyAmount).toString());
      assert.equal(userSupplyPoolInfo.userDeposit.toString(), 0);
      assert.equal(userSupplyPoolInfo.userDepositInUSD.toString(), 0);
      assert.equal(userSupplyPoolInfo.supplyAPY.toString(), 0);

      distrAPYs = await rewardsDistribution.getAPY(wEthKey);

      assert.equal(userSupplyPoolInfo.distrSupplyAPY.toString(), toBN(distrAPYs[0]).toFixed());
    });
  });

  describe("getUserBorrowPoolsInfo", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    it("should return correct borrow pool data", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(2), { from: USER2 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(2), { from: USER2 });

      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      const userBorrowPoolInfo = (await userInfoRegistry.getUserBorrowPoolsInfo(USER1, [daiKey]))[0];
      const totalSupplyAmount = liquidityAmount.times(3);

      assert.isTrue(compareKeys(userBorrowPoolInfo.basePoolInfo.mainInfo.assetKey, daiKey));
      assert.equal(userBorrowPoolInfo.basePoolInfo.mainInfo.assetAddr, tokens[1].address);
      assert.equal(
        userBorrowPoolInfo.basePoolInfo.utilizationRatio.toString(),
        borrowAmount.times(getPercentage100()).idiv(totalSupplyAmount).toFixed()
      );
      assert.isTrue(userBorrowPoolInfo.basePoolInfo.isCollateralEnabled);

      const availableToBorrow = totalSupplyAmount.times(maxUR).idiv(getPercentage100()).minus(borrowAmount);

      assert.equal(userBorrowPoolInfo.availableToBorrow.toString(), availableToBorrow.toString());
      assert.equal(userBorrowPoolInfo.availableToBorrowInUSD.toString(), convertToUSD(availableToBorrow).toString());
      assert.equal(userBorrowPoolInfo.userBorrowAmount.toString(), borrowAmount.toString());
      assert.equal(userBorrowPoolInfo.userBorrowAmountInUSD.toString(), convertToUSD(borrowAmount).toString());
      assert.equal(userBorrowPoolInfo.borrowAPY.toString(), (await daiPool.getAnnualBorrowRate()).toFixed());

      const distrAPYs = await rewardsDistribution.getAPY(daiKey);

      assert.equal(userBorrowPoolInfo.distrBorrowAPY.toString(), toBN(distrAPYs[1]).toFixed());
    });
  });

  describe("getUserPoolInfo", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    it("should return correct user pool info", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(2), { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(2), { from: USER2 });

      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount, USER2, { from: USER2 });

      await defiCore.updateCollateral(daiKey, true, { from: USER2 });

      let userPoolInfo = await userInfoRegistry.getUserPoolInfo(USER1, daiKey);
      let userBalance = await tokens[1].balanceOf(USER1);

      assert.equal(userPoolInfo.userWalletBalance.toString(), userBalance.toFixed());
      assert.equal(userPoolInfo.userWalletBalanceInUSD.toString(), convertToUSD(userBalance).toString());
      assert.equal(userPoolInfo.userSupplyBalance.toString(), liquidityAmount.times(2).toString());
      assert.equal(userPoolInfo.userSupplyBalanceInUSD.toString(), convertToUSD(liquidityAmount.times(2)).toString());
      assert.equal(userPoolInfo.userBorrowBalance.toString(), borrowAmount.toString());
      assert.equal(userPoolInfo.userBorrowBalanceInUSD.toString(), convertToUSD(borrowAmount).toString());
      assert.equal(userPoolInfo.isCollateralEnabled, true);

      userPoolInfo = await userInfoRegistry.getUserPoolInfo(USER2, daiKey);
      userBalance = await tokens[1].balanceOf(USER2);

      assert.equal(userPoolInfo.userWalletBalance.toString(), userBalance.toFixed());
      assert.equal(userPoolInfo.userWalletBalanceInUSD.toString(), convertToUSD(userBalance).toString());
      assert.equal(userPoolInfo.userSupplyBalance.toString(), 0);
      assert.equal(userPoolInfo.userSupplyBalanceInUSD.toString(), 0);
      assert.equal(userPoolInfo.userBorrowBalance.toString(), borrowAmount.toString());
      assert.equal(userPoolInfo.userBorrowBalanceInUSD.toString(), convertToUSD(borrowAmount).toString());
      assert.equal(userPoolInfo.isCollateralEnabled, false);
    });

    it("should return correct user pool info for native pool", async () => {
      await defiCore.addLiquidity(nativeTokenKey, liquidityAmount, { from: OWNER, value: liquidityAmount });
      await defiCore.borrowFor(nativeTokenKey, borrowAmount, OWNER, { from: OWNER });

      const userPoolInfo = await userInfoRegistry.getUserPoolInfo(OWNER, nativeTokenKey);
      const userBalance = (await tokens[0].balanceOf(OWNER)).plus(await web3.eth.getBalance(OWNER));

      assert.closeTo(
        toBN(userPoolInfo.userWalletBalance).toNumber(),
        userBalance.toNumber(),
        oneToken.idiv(1000).toNumber()
      );
      assert.closeTo(
        toBN(userPoolInfo.userWalletBalanceInUSD).toNumber(),
        convertToUSD(userBalance).toNumber(),
        wei(0.01, priceDecimals).toNumber()
      );
    });

    it("should return correct user pool info for stable pool", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(stableKey, borrowAmount, USER1, { from: USER1 });

      const userPoolInfo = await userInfoRegistry.getUserPoolInfo(USER1, stableKey);

      assert.equal(userPoolInfo.userWalletBalance.toString(), borrowAmount.toFixed());
      assert.equal(userPoolInfo.userWalletBalanceInUSD.toString(), convertToUSD(borrowAmount, 1).toString());
      assert.equal(userPoolInfo.userSupplyBalance.toString(), 0);
      assert.equal(userPoolInfo.userSupplyBalanceInUSD.toString(), 0);
      assert.equal(userPoolInfo.userBorrowBalance.toString(), borrowAmount.toString());
      assert.equal(userPoolInfo.userBorrowBalanceInUSD.toString(), convertToUSD(borrowAmount, 1).toString());
      assert.equal(userPoolInfo.isCollateralEnabled, false);
    });
  });

  describe("getUserMaxValues", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    it("should return correct max values", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(2), { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      const maxValues = await userInfoRegistry.getUserMaxValues(USER1, daiKey);

      const currentBorrowLimit = convertToBorrowLimit(liquidityAmount.times(2), colRatio, false);
      const maxToWithdraw = liquidityAmount.times(2).minus(borrowAmount.times(colRatio).idiv(getPercentage100()));
      const maxToRepay = borrowAmount.times(await daiPool.getNewCompoundRate()).idiv(getPercentage100());

      assert.equal(maxValues.maxToSupply.toString(), (await tokens[1].balanceOf(USER1)).toFixed());
      assert.equal(maxValues.maxToWithdraw.toString(), maxToWithdraw.toString());
      assert.equal(maxValues.maxToBorrow.toString(), currentBorrowLimit.minus(borrowAmount).toString());
      assert.equal(maxValues.maxToRepay.toString(), maxToRepay.toString());
    });

    it("should return correct values for stable pool", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(2), { from: USER1 });
      await defiCore.borrowFor(stableKey, borrowAmount, USER1, { from: USER1 });

      const maxValues = await userInfoRegistry.getUserMaxValues(USER1, stableKey);

      const currentBorrowLimit = convertToBorrowLimit(liquidityAmount.times(2), colRatio, true);
      const maxToRepay = borrowAmount.times(await daiPool.getNewCompoundRate()).idiv(getPercentage100());

      assert.equal(maxValues.maxToSupply.toString(), 0);
      assert.equal(maxValues.maxToWithdraw.toString(), 0);
      assert.equal(
        maxValues.maxToBorrow.toString(),
        convertFromUSD(currentBorrowLimit, 1).minus(borrowAmount).toFixed()
      );
      assert.equal(maxValues.maxToRepay.toString(), maxToRepay.toString());
    });
  });

  describe("getUsersLiquidiationInfo", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    const validMainPoolInfo = (mainInfo, expectedMainInfo) => {
      assert.isTrue(compareKeys(mainInfo.assetKey, expectedMainInfo[0]));
      assert.equal(mainInfo.assetAddr, expectedMainInfo[1]);
    };

    it("should return correct user liquidation info", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.borrowFor(daiKey, borrowAmount.idiv(2), USER1, { from: USER1 });
      await defiCore.borrowFor(wEthKey, borrowAmount.idiv(2), USER1, { from: USER1 });
      await defiCore.borrowFor(wEthKey, borrowAmount.idiv(2), USER2, { from: USER2 });

      const result = await userInfoRegistry.getUsersLiquidiationInfo([USER1, USER2]);

      assert.equal(result[0].userAddr, USER1);

      let expectedMainInfos = [
        [daiKey, tokens[1].address],
        [wEthKey, tokens[2].address],
      ];

      for (let i = 0; i < result[0].borrowPoolsInfo.length; i++) {
        validMainPoolInfo(result[0].borrowPoolsInfo[i], expectedMainInfos[i]);
        validMainPoolInfo(result[0].sypplyPoolsInfo[i], expectedMainInfos[i]);
      }

      assert.equal(result[0].totalBorrowedAmount.toString(), convertToUSD(borrowAmount).toString());

      assert.equal(result[1].userAddr, USER2);

      expectedMainInfos = [[wEthKey, tokens[2].address]];

      validMainPoolInfo(result[1].borrowPoolsInfo[0], expectedMainInfos[0]);
      validMainPoolInfo(result[1].sypplyPoolsInfo[0], expectedMainInfos[0]);

      assert.equal(toBN(result[1].totalBorrowedAmount).toString(), convertToUSD(borrowAmount.idiv(2)).toString());
    });

    it("should return correct user supply assets", async () => {
      let liquiditySupplyAmount = wei(100);
      await defiCore.addLiquidity(daiKey, liquiditySupplyAmount, { from: USER3 });
      await defiCore.addLiquidity(usdtKey, liquiditySupplyAmount, { from: USER3 });
      await defiCore.addLiquidity(wEthKey, liquiditySupplyAmount, { from: USER3 });

      await defiCore.addLiquidity(daiKey, liquiditySupplyAmount, { from: USER4 });
      await defiCore.addLiquidity(usdtKey, liquiditySupplyAmount, { from: USER4 });
      await defiCore.addLiquidity(wEthKey, liquiditySupplyAmount, { from: USER4 });

      await defiCore.updateCollateral(daiKey, true, { from: USER4 });

      const result = await userInfoRegistry.getUsersLiquidiationInfo([USER3, USER4]);
      let expectedMainInfos = [
        [daiKey, tokens[1].address],
        [wEthKey, tokens[2].address],
        ["0x0", ZERO_ADDR],
      ];

      for (let i = 0; i < result[0].sypplyPoolsInfo.length; i++) {
        validMainPoolInfo(result[0].sypplyPoolsInfo[i], expectedMainInfos[i]);
      }

      expectedMainInfos = [
        [wEthKey, tokens[2].address],
        ["0x0", ZERO_ADDR],
        ["0x0", ZERO_ADDR],
      ];

      for (let i = 0; i < result[1].sypplyPoolsInfo.length; i++) {
        validMainPoolInfo(result[1].sypplyPoolsInfo[i], expectedMainInfos[i]);
      }
    });
  });

  describe("getUserLiquidationData", () => {
    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(50);

    beforeEach("setup", async () => {
      await daiChainlinkOracle.setPrice(wei(20, chainlinkPriceDecimals));
      await wEthChainlinkOracle.setPrice(wei(30, chainlinkPriceDecimals));
    });

    it("should return correct user liquidation info if supply amount less than liquidation amount", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.idiv(10), { from: USER1 });

      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      const result = await userInfoRegistry.getUserLiquidationData(USER1, daiKey, wEthKey);

      assert.equal(result.borrowAssetPrice.toString(), wei(20, chainlinkPriceDecimals).toString());
      assert.equal(result.receiveAssetPrice.toString(), wei(30, chainlinkPriceDecimals).toString());
      assert.equal(result.bonusReceiveAssetPrice.toString(), wei(30, chainlinkPriceDecimals).times(0.92).toString());

      assert.equal(result.borrowedAmount.toString(), borrowAmount.toString());
      assert.equal(result.supplyAmount.toString(), liquidityAmount.idiv(10).toString());

      const expectedMaxQuantity = oneToken.times(13.8);
      assert.equal(result.maxQuantity.toString(), expectedMaxQuantity.toString());
    });

    it("should return correct user liquidation info that equals to borrow amount", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.borrowFor(daiKey, borrowAmount.idiv(2), USER1, { from: USER1 });
      await defiCore.borrowFor(wEthKey, borrowAmount.idiv(5), USER1, { from: USER1 });

      const result = await userInfoRegistry.getUserLiquidationData(USER1, wEthKey, daiKey);

      assert.equal(result.borrowAssetPrice.toString(), wei(30, chainlinkPriceDecimals).toString());
      assert.equal(result.receiveAssetPrice.toString(), wei(20, chainlinkPriceDecimals).toString());
      assert.equal(result.bonusReceiveAssetPrice.toString(), wei(20, chainlinkPriceDecimals).times(0.92).toString());

      assert.equal(result.borrowedAmount.toString(), borrowAmount.idiv(5).toString());
      assert.equal(result.supplyAmount.toString(), liquidityAmount.toString());

      const expectedMaxQuantity = oneToken.times(10);
      assert.equal(result.maxQuantity.toString(), expectedMaxQuantity.toString());
    });

    it("should return correct user liquidation info equals to max liquidation part", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.borrowFor(daiKey, borrowAmount.idiv(2), USER1, { from: USER1 });
      await defiCore.borrowFor(wEthKey, borrowAmount.idiv(2), USER1, { from: USER1 });

      const result = await userInfoRegistry.getUserLiquidationData(USER1, wEthKey, daiKey);

      assert.equal(result.borrowAssetPrice.toString(), wei(30, chainlinkPriceDecimals).toString());
      assert.equal(result.receiveAssetPrice.toString(), wei(20, chainlinkPriceDecimals).toString());
      assert.equal(result.bonusReceiveAssetPrice.toString(), wei(20, chainlinkPriceDecimals).times(0.92).toString());

      assert.equal(result.borrowedAmount.toString(), borrowAmount.idiv(2).toString());
      assert.equal(result.supplyAmount.toString(), liquidityAmount.toString());

      const expectedMaxQuantity = toBN("20833333333333333333");
      assert.equal(result.maxQuantity.toString(), expectedMaxQuantity.toString());
    });
  });

  describe("getMaxLiquidationQuantity", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(25);

    it("should return correct max quantity with max liquidation boundary parameter", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });
      await defiCore.borrowFor(wEthKey, borrowAmount, USER1, { from: USER1 });

      assert.equal(
        (await userInfoRegistry.getMaxLiquidationQuantity(USER1, wEthKey, daiKey)).toString(),
        convertToUSD(borrowAmount).toString()
      );
    });

    it("should return correct max quantity by supply", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount.idiv(4), { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      await defiCore.borrowFor(wEthKey, borrowAmount.times(3), USER1, { from: USER1 });

      assert.equal(
        (await userInfoRegistry.getMaxLiquidationQuantity(USER1, daiKey, wEthKey)).toString(),
        convertToUSD(liquidityAmount.idiv(4).times(0.92)).toString()
      );
    });

    it("should return correct max quantity by borrow", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(2), { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.borrowFor(daiKey, borrowAmount.times(3), USER1, { from: USER1 });
      await defiCore.borrowFor(wEthKey, borrowAmount, USER1, { from: USER1 });

      assert.equal(
        (await userInfoRegistry.getMaxLiquidationQuantity(USER1, daiKey, wEthKey)).toString(),
        convertToUSD(borrowAmount).toString()
      );
    });
  });
});
