const { mine } = require("./helpers/hardhatTimeTraveller");
const { toBytes, compareKeys, deepCompareKeys } = require("./helpers/bytesCompareLibrary");
const { getInterestRateLibraryData } = require("../deploy/helpers/deployHelper");
const { toBN, accounts, getOnePercent, getDecimal, wei } = require("../scripts/utils");

const Reverter = require("./helpers/reverter");
const { assert } = require("chai");

const Registry = artifacts.require("Registry");
const DefiCore = artifacts.require("DefiCore");
const SystemParameters = artifacts.require("SystemParameters");
const AssetParameters = artifacts.require("AssetParameters");
const RewardsDistribution = artifacts.require("RewardsDistributionMock");
const UserInfoRegistry = artifacts.require("UserInfoRegistry");
const LiquidityPoolRegistry = artifacts.require("LiquidityPoolRegistry");
const LiquidityPoolFactory = artifacts.require("LiquidityPoolFactory");
const LiquidityPool = artifacts.require("LiquidityPool");
const PriceManager = artifacts.require("PriceManagerMock");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const GovernanceToken = artifacts.require("GovernanceToken");

const MockERC20 = artifacts.require("MockERC20");
const ChainlinkOracleMock = artifacts.require("ChainlinkOracleMock");

MockERC20.numberFormat = "BigNumber";
DefiCore.numberFormat = "BigNumber";
LiquidityPool.numberFormat = "BigNumber";
UserInfoRegistry.numberFormat = "BigNumber";
GovernanceToken.numberFormat = "BigNumber";

describe("UserInfoRegistry", () => {
  const reverter = new Reverter();

  const ADDRESS_NULL = "0x0000000000000000000000000000000000000000";

  let OWNER;
  let USER1;
  let USER2;
  let NOTHING;

  let registry;
  let defiCore;
  let assetParameters;
  let rewardsDistribution;
  let userInfoRegistry;
  let liquidityPoolRegistry;
  let priceManager;

  let daiPool;

  const tokens = [];

  let daiChainlinkOracle;
  let wEthChainlinkOracle;

  let governanceToken;

  const oneToken = wei(1);
  const tokensAmount = wei(100000);
  const colRatio = getDecimal().times("1.25");
  const reserveFactor = getOnePercent().times("15");

  const firstSlope = getOnePercent().times(4);
  const secondSlope = getDecimal();
  const utilizationBreakingPoint = getOnePercent().times(80);
  const maxUR = getOnePercent().times(95);
  const liquidationDiscount = getOnePercent().times(8);
  const liquidationBoundary = getOnePercent().times(50);

  const priceDecimals = wei(1, 8);
  const chainlinkPriceDecimals = toBN(8);

  const minSupplyDistributionPart = getOnePercent().times(10);
  const minBorrowDistributionPart = getOnePercent().times(10);

  const daiKey = toBytes("DAI");
  const wEthKey = toBytes("WETH");
  const usdtKey = toBytes("USDT");
  const governanceTokenKey = toBytes("GTK");

  async function deployTokens(symbols) {
    for (let i = 0; i < symbols.length; i++) {
      const token = await MockERC20.new("Mock" + symbols[i], symbols[i]);
      await token.mintArbitraryBatch([OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);

      tokens.push(token);
    }
  }

  async function createLiquidityPool(assetKey, asset, symbol, isCollateral, isGovernancePool) {
    let chainlinkOracleAddr = ADDRESS_NULL;

    if (!isGovernancePool) {
      chainlinkOracleAddr = (await ChainlinkOracleMock.new(wei(100, chainlinkPriceDecimals), chainlinkPriceDecimals))
        .address;
    }

    await liquidityPoolRegistry.addLiquidityPool(
      asset.address,
      assetKey,
      chainlinkOracleAddr,
      NOTHING,
      symbol,
      isCollateral
    );

    if (!isGovernancePool) {
      await asset.approveArbitraryBacth(
        await liquidityPoolRegistry.liquidityPools(assetKey),
        [OWNER, USER1, USER2],
        [tokensAmount, tokensAmount, tokensAmount]
      );
    }

    await assetParameters.setupAllParameters(assetKey, [
      [colRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);

    await priceManager.setPrice(assetKey, 100);

    return chainlinkOracleAddr;
  }

  function convertToUSD(amountToConvert, price = toBN(100)) {
    return amountToConvert.times(price).times(priceDecimals).idiv(oneToken);
  }

  function convertToBorrowLimit(amountToConvert, convertColRatio = colRatio, isConvertToUSD = true) {
    if (isConvertToUSD) {
      return convertToUSD(amountToConvert.times(getDecimal()).idiv(convertColRatio));
    }

    return amountToConvert.times(getDecimal()).idiv(convertColRatio);
  }

  before("setup", async () => {
    OWNER = await accounts(0);
    USER1 = await accounts(1);
    USER2 = await accounts(2);
    NOTHING = await accounts(9);

    governanceToken = await GovernanceToken.new(OWNER);
    const interestRateLibrary = await InterestRateLibrary.new(
      getInterestRateLibraryData("deploy/data/InterestRatesExactData.txt")
    );

    registry = await Registry.new();
    const _defiCore = await DefiCore.new();
    const _systemParameters = await SystemParameters.new();
    const _assetParameters = await AssetParameters.new();
    const _rewardsDistribution = await RewardsDistribution.new();
    const _userInfoRegistry = await UserInfoRegistry.new();
    const _liquidityPoolRegistry = await LiquidityPoolRegistry.new();
    const _liquidityPoolFactory = await LiquidityPoolFactory.new();
    const _liquidityPoolImpl = await LiquidityPool.new();
    const _priceManager = await PriceManager.new();

    await registry.addProxyContract(await registry.DEFI_CORE_NAME(), _defiCore.address);
    await registry.addProxyContract(await registry.SYSTEM_PARAMETERS_NAME(), _systemParameters.address);
    await registry.addProxyContract(await registry.ASSET_PARAMETERS_NAME(), _assetParameters.address);
    await registry.addProxyContract(await registry.REWARDS_DISTRIBUTION_NAME(), _rewardsDistribution.address);
    await registry.addProxyContract(await registry.USER_INFO_REGISTRY_NAME(), _userInfoRegistry.address);
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_REGISTRY_NAME(), _liquidityPoolRegistry.address);
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_FACTORY_NAME(), _liquidityPoolFactory.address);
    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), _priceManager.address);

    await registry.addContract(await registry.INTEREST_RATE_LIBRARY_NAME(), interestRateLibrary.address);
    await registry.addContract(await registry.GOVERNANCE_TOKEN_NAME(), governanceToken.address);

    defiCore = await DefiCore.at(await registry.getDefiCoreContract());
    assetParameters = await AssetParameters.at(await registry.getAssetParametersContract());
    userInfoRegistry = await UserInfoRegistry.at(await registry.getUserInfoRegistryContract());
    liquidityPoolRegistry = await LiquidityPoolRegistry.at(await registry.getLiquidityPoolRegistryContract());
    rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());
    priceManager = await PriceManager.at(await registry.getPriceManagerContract());

    const systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());

    await registry.injectDependencies(await registry.DEFI_CORE_NAME());
    await registry.injectDependencies(await registry.ASSET_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.REWARDS_DISTRIBUTION_NAME());
    await registry.injectDependencies(await registry.USER_INFO_REGISTRY_NAME());
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_REGISTRY_NAME());
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_FACTORY_NAME());
    await registry.injectDependencies(await registry.PRICE_MANAGER_NAME());

    tokens.push(governanceToken);
    await deployTokens(["DAI", "WETH", "USDT"]);

    await systemParameters.systemParametersInitialize();
    await assetParameters.assetParametersInitialize();
    await rewardsDistribution.rewardsDistributionInitialize();
    await liquidityPoolRegistry.liquidityPoolRegistryInitialize(_liquidityPoolImpl.address);
    await priceManager.priceManagerInitialize(daiKey, tokens[1].address);

    await interestRateLibrary.addNewRates(
      110, // Start percentage
      getInterestRateLibraryData("deploy/data/InterestRatesData.txt")
    );

    await createLiquidityPool(governanceTokenKey, tokens[0], await governanceToken.symbol(), true, true);
    daiChainlinkOracle = await ChainlinkOracleMock.at(await createLiquidityPool(daiKey, tokens[1], "DAI", true, false));
    wEthChainlinkOracle = await ChainlinkOracleMock.at(
      await createLiquidityPool(wEthKey, tokens[2], "WETH", true, false)
    );
    await createLiquidityPool(usdtKey, tokens[3], "USDT", false, false);

    daiPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(daiKey));

    await systemParameters.setupLiquidationBoundary(liquidationBoundary);

    await rewardsDistribution.setupRewardsPerBlockBatch(
      [daiKey, wEthKey, usdtKey, governanceTokenKey],
      [wei(2), oneToken, wei(5), oneToken]
    );

    await governanceToken.transfer(defiCore.address, tokensAmount.times(10));

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

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

      assert.equal(userMainInfo.totalSupplyBalanceInUSD.toString(), convertToUSD(liquidityAmount).toString());
      assert.equal(userMainInfo.totalBorrowBalanceInUSD.toString(), totalBorrowBalanceInUSD.toString());
      assert.equal(userMainInfo.borrowLimitInUSD.toString(), borrowLimitInUSD.toString());
      assert.equal(
        userMainInfo.borrowLimitUsed.toString(),
        totalBorrowBalanceInUSD.times(getDecimal()).idiv(borrowLimitInUSD).toFixed()
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
        totalBorrowBalanceInUSD.times(getDecimal()).idiv(borrowLimitInUSD).toFixed()
      );
    });
  });

  describe("getUserDistributionRewards", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    it("should get correct rewards", async () => {
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
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await mine(499);

      const expectedRewards = wei(100.1);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });

      await defiCore.claimPoolDistributionRewards(daiKey, { from: USER1 });

      const rewardInfo = await userInfoRegistry.getUserDistributionRewards(USER1);

      assert.equal(rewardInfo.assetAddr, tokens[0].address);
      assert.equal(rewardInfo.distributionReward.toString(), 0);
      assert.equal(rewardInfo.distributionRewardInUSD.toString(), 0);

      const userBalance = await governanceToken.balanceOf(USER1);
      assert.equal(rewardInfo.userBalance.toString(), userBalance.toString());
      assert.equal(rewardInfo.userBalanceInUSD.toString(), convertToUSD(userBalance).toString());

      assert.equal(rewardInfo.userBalance.toString(), expectedRewards.toString());
      assert.equal(rewardInfo.userBalanceInUSD.toString(), convertToUSD(expectedRewards).toString());
    });

    it("should get correct rewards after deposit and borrow", async () => {
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
  });

  describe("getUserSupplyPoolsInfo", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    it("should return correct supply pool data", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(2), { from: USER2 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(2), { from: USER2 });

      await defiCore.borrowFor(daiKey, borrowAmount, USER2, { from: USER2 });
      await defiCore.disableCollateral(wEthKey, { from: USER1 });

      const dataArr = await userInfoRegistry.getUserSupplyPoolsInfo(USER1, [daiKey, wEthKey]);

      let userSupplyPoolInfo = dataArr[0];
      let totalSupplyAmount = liquidityAmount.times(3);

      assert.isTrue(compareKeys(userSupplyPoolInfo.basePoolInfo.assetKey, daiKey));
      assert.equal(userSupplyPoolInfo.basePoolInfo.assetAddr, tokens[1].address);
      assert.equal(
        userSupplyPoolInfo.basePoolInfo.utilizationRatio.toString(),
        borrowAmount.times(getDecimal()).idiv(totalSupplyAmount).toFixed()
      );
      assert.isTrue(userSupplyPoolInfo.basePoolInfo.isCollateralEnabled);

      assert.equal(userSupplyPoolInfo.marketSize.toString(), totalSupplyAmount.toString());
      assert.equal(userSupplyPoolInfo.marketSizeInUSD.toString(), convertToUSD(totalSupplyAmount).toString());
      assert.equal(userSupplyPoolInfo.userDeposit.toString(), liquidityAmount.toString());
      assert.equal(userSupplyPoolInfo.userDepositInUSD.toString(), convertToUSD(liquidityAmount).toString());
      assert.equal(userSupplyPoolInfo.supplyAPY.toString(), (await daiPool.getAPY()).toFixed());

      userSupplyPoolInfo = dataArr[1];
      totalSupplyAmount = liquidityAmount.times(2);

      assert.isTrue(compareKeys(userSupplyPoolInfo.basePoolInfo.assetKey, wEthKey));
      assert.equal(userSupplyPoolInfo.basePoolInfo.assetAddr, tokens[2].address);
      assert.equal(userSupplyPoolInfo.basePoolInfo.utilizationRatio.toString(), 0);
      assert.isFalse(userSupplyPoolInfo.basePoolInfo.isCollateralEnabled);

      assert.equal(userSupplyPoolInfo.marketSize.toString(), totalSupplyAmount.toString());
      assert.equal(userSupplyPoolInfo.marketSizeInUSD.toString(), convertToUSD(totalSupplyAmount).toString());
      assert.equal(userSupplyPoolInfo.userDeposit.toString(), 0);
      assert.equal(userSupplyPoolInfo.userDepositInUSD.toString(), 0);
      assert.equal(userSupplyPoolInfo.supplyAPY.toString(), 0);
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

      assert.isTrue(compareKeys(userBorrowPoolInfo.basePoolInfo.assetKey, daiKey));
      assert.equal(userBorrowPoolInfo.basePoolInfo.assetAddr, tokens[1].address);
      assert.equal(
        userBorrowPoolInfo.basePoolInfo.utilizationRatio.toString(),
        borrowAmount.times(getDecimal()).idiv(totalSupplyAmount).toFixed()
      );
      assert.isTrue(userBorrowPoolInfo.basePoolInfo.isCollateralEnabled);

      const availableToBorrow = totalSupplyAmount.times(maxUR).idiv(getDecimal()).minus(borrowAmount);

      assert.equal(userBorrowPoolInfo.availableToBorrow.toString(), availableToBorrow.toString());
      assert.equal(userBorrowPoolInfo.availableToBorrowInUSD.toString(), convertToUSD(availableToBorrow).toString());
      assert.equal(userBorrowPoolInfo.userBorrowAmount.toString(), borrowAmount.toString());
      assert.equal(userBorrowPoolInfo.userBorrowAmountInUSD.toString(), convertToUSD(borrowAmount).toString());
      assert.equal(userBorrowPoolInfo.borrowAPY.toString(), (await daiPool.getAnnualBorrowRate()).toFixed());
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

      await defiCore.disableCollateral(daiKey, { from: USER2 });

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
  });

  describe("getUserMaxValues", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    it("should return correct max values", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(2), { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      const maxValues = await userInfoRegistry.getUserMaxValues(USER1, daiKey);

      const currentBorrowLimit = convertToBorrowLimit(liquidityAmount.times(2), colRatio, false);
      const maxToWithdraw = liquidityAmount.times(2).minus(borrowAmount.times(colRatio).idiv(getDecimal()));
      const maxToRepay = borrowAmount.times(await daiPool.getNewCompoundRate()).idiv(getDecimal());

      assert.equal(maxValues.maxToSupply.toString(), (await tokens[1].balanceOf(USER1)).toFixed());
      assert.equal(maxValues.maxToWithdraw.toString(), maxToWithdraw.toString());
      assert.equal(maxValues.maxToBorrow.toString(), currentBorrowLimit.minus(borrowAmount).toString());
      assert.equal(maxValues.maxToRepay.toString(), maxToRepay.toString());
    });
  });

  describe("getUsersLiquidiationInfo", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    it("should return correct user liquidation info", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.borrowFor(daiKey, borrowAmount.idiv(2), USER1, { from: USER1 });
      await defiCore.borrowFor(wEthKey, borrowAmount.idiv(2), USER1, { from: USER1 });
      await defiCore.borrowFor(wEthKey, borrowAmount.idiv(2), USER2, { from: USER2 });

      const result = await userInfoRegistry.getUsersLiquidiationInfo([USER1, USER2]);

      assert.isTrue(deepCompareKeys(result[0].borrowAssetKeys, [daiKey, wEthKey]));
      assert.isTrue(deepCompareKeys(result[0].supplyAssetKeys, [daiKey, wEthKey]));
      assert.equal(result[0].totalBorrowedAmount.toString(), convertToUSD(borrowAmount).toString());

      assert.isTrue(deepCompareKeys(result[1].borrowAssetKeys, [wEthKey]));
      assert.isTrue(deepCompareKeys(result[1].supplyAssetKeys, [wEthKey]));
      assert.equal(toBN(result[1].totalBorrowedAmount).toString(), convertToUSD(borrowAmount.idiv(2)).toString());
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
