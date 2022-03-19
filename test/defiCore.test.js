const { setNextBlockTime, setTime, mine, getCurrentBlockTime } = require("./helpers/hardhatTimeTraveller");
const { toBytes, compareKeys, deepCompareKeys } = require("./helpers/bytesCompareLibrary");
const { getInterestRateLibraryData } = require("../deploy/helpers/deployHelper");
const { toBN, accounts, getOnePercent, getDecimal, wei } = require("../scripts/utils");

const Reverter = require("./helpers/reverter");
const truffleAssert = require("truffle-assertions");

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

describe("DefiCore", async () => {
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
  let liquidityPoolRegistry;
  let priceManager;

  let daiPool;
  let wEthPool;
  let usdtPool;

  const tokens = [];

  let daiChainlinkOracle;
  let wEthChainlinkOracle;
  let usdtChainlinkOracle;

  let governanceToken;

  const oneToken = wei(1);
  const tokensAmount = wei(100000);
  const standardColRatio = getDecimal().times("1.25");
  const reserveFactor = getOnePercent().times("15");

  const firstSlope = getOnePercent().times(4);
  const secondSlope = getDecimal();
  const utilizationBreakingPoint = getOnePercent().times(80);
  const maxUR = getOnePercent().times(95);
  const maxWithdrawUR = getOnePercent().times(94);
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

  async function createLiquidityPool(assetKey, asset, symbol, isCollateral) {
    const chainlinkOracle = await ChainlinkOracleMock.new(
      toBN(100).times(toBN(10).pow(chainlinkPriceDecimals)),
      chainlinkPriceDecimals
    );

    await liquidityPoolRegistry.addLiquidityPool(
      asset.address,
      assetKey,
      chainlinkOracle.address,
      NOTHING,
      symbol,
      isCollateral
    );

    await asset.approveArbitraryBacth(
      await liquidityPoolRegistry.liquidityPools(assetKey),
      [OWNER, USER1, USER2],
      [tokensAmount, tokensAmount, tokensAmount]
    );

    await assetParameters.setupAllParameters(assetKey, [
      [standardColRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);

    await priceManager.setPrice(assetKey, 100);

    return chainlinkOracle;
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

    await assetParameters.setupAllParameters(governanceTokenKey, [
      [standardColRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);

    await priceManager.setPrice(governanceTokenKey, 10);
  }

  function getNormalizedAmount(normalizedAmount, additionalAmount, currentRate, isAdding) {
    const normalizedAdditionalAmount = additionalAmount.times(getDecimal()).idiv(currentRate);

    return isAdding
      ? normalizedAmount.plus(normalizedAdditionalAmount)
      : normalizedAmount.minus(normalizedAdditionalAmount);
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

    await deployTokens([await governanceToken.symbol(), "DAI", "WETH", "USDT"]);

    await systemParameters.systemParametersInitialize();
    await assetParameters.assetParametersInitialize();
    await rewardsDistribution.rewardsDistributionInitialize();
    await liquidityPoolRegistry.liquidityPoolRegistryInitialize(_liquidityPoolImpl.address);
    await priceManager.priceManagerInitialize(daiKey, tokens[1].address);

    await interestRateLibrary.addNewRates(
      110, // Start percentage
      getInterestRateLibraryData("deploy/data/InterestRatesData.txt")
    );

    await deployGovernancePool(governanceToken.address, await governanceToken.symbol());

    daiChainlinkOracle = await createLiquidityPool(daiKey, tokens[1], "DAI", true);
    wEthChainlinkOracle = await createLiquidityPool(wEthKey, tokens[2], "WETH", true);
    usdtChainlinkOracle = await createLiquidityPool(usdtKey, tokens[3], "USDT", false);

    daiPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(daiKey));
    wEthPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(wEthKey));
    usdtPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(usdtKey));

    await systemParameters.setupLiquidationBoundary(liquidationBoundary);

    await rewardsDistribution.setupRewardsPerBlockBatch(
      [daiKey, wEthKey, usdtKey, governanceTokenKey],
      [wei(2), oneToken, wei(5), oneToken]
    );

    await governanceToken.transfer(defiCore.address, tokensAmount.times(10));

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
        .times(getDecimal())
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
        .times(getDecimal())
        .idiv(standardColRatio);

      assert.equal((await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedLimit.toString());

      const newDaiColRatio = getDecimal().times(1.15);
      const newWEthColRatio = getDecimal().times(1.3);

      await assetParameters.setupMainParameters(daiKey, [newDaiColRatio, reserveFactor, liquidationDiscount, maxUR]);
      await assetParameters.setupMainParameters(wEthKey, [newWEthColRatio, reserveFactor, liquidationDiscount, maxUR]);

      const daiPart = liquidityAmount
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(getDecimal())
        .idiv(newDaiColRatio);
      const wEthPart = liquidityAmount
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(getDecimal())
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
        .times(getDecimal())
        .idiv(standardColRatio);

      assert.equal((await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedLimit.toString());
    });

    it("should return correct value if collateral enabled and supply", async () => {
      const expectedLimit = liquidityAmount
        .times(4)
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(getDecimal())
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
        .times(getDecimal())
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
        .times(getDecimal())
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
        .times(getDecimal())
        .idiv(standardColRatio);

      assert.equal(result[0].toString(), expectedAvailableLiquidity.toString());
      assert.equal(result[1], 0);
    });

    it("should return correct values if try to withdraw all liquidity", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      const currentTotalLiquidityAmount = liquidityAmount.times(2).times(price).times(priceDecimals).idiv(oneToken);
      const expectedLimit = currentTotalLiquidityAmount.times(getDecimal()).idiv(standardColRatio);

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
      let expectedLimit = currentTotalLiquidityAmount.times(getDecimal()).idiv(standardColRatio);

      let result = await defiCore.getAvailableLiquidity(USER1);
      assert.equal(result[0].toString(), expectedLimit.toString());
      assert.equal(result[1], 0);

      await setNextBlockTime(startTime.times(2).toNumber());
      await defiCore.withdrawLiquidity(daiKey, liquidityAmount, false, { from: USER1 });

      currentTotalLiquidityAmount = liquidityAmount.times(price).times(priceDecimals).idiv(oneToken);
      expectedLimit = currentTotalLiquidityAmount.times(getDecimal()).idiv(standardColRatio);

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
    const price = toBN(100);

    it("should correctly enable collateral", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.updateCollateral(daiKey, true, { from: USER1 });

      assert.equal((await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), 0);

      await defiCore.updateCollateral(daiKey, false, { from: USER1 });

      assert.equal(
        (await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(),
        liquidityAmount
          .times(price)
          .times(priceDecimals)
          .idiv(oneToken)
          .times(getDecimal())
          .idiv(standardColRatio)
          .toString()
      );

      assert.equal(await defiCore.disabledCollateralAssets(USER1, daiKey), false);
    });

    it("should correctly disable collateral", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      const expectedBorrowLimit = liquidityAmount
        .times(price)
        .times(priceDecimals)
        .div(oneToken)
        .times(getDecimal())
        .div(standardColRatio);
      assert.equal((await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedBorrowLimit.toString());

      await defiCore.updateCollateral(daiKey, true, { from: USER1 });

      assert.equal((await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), 0);

      assert.equal(await defiCore.disabledCollateralAssets(USER1, daiKey), true);
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
      assert.equal(txReceipt.receipt.logs[0].args._userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, daiKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args._liquidityAmount).toString(), liquidityAmount.toString());

      assert.equal((await userInfoRegistry.getUserSupplyAssets(USER1)).length, 1);
      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserSupplyAssets(USER1), [daiKey]));
    });

    it("should correctly mint LPTokens for token with 6 getDecimal() places", async () => {
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

      const reason = "LiquidityPool: Incorrect asset amount after conversion.";

      await truffleAssert.reverts(defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 }), reason);

      liquidityAmount = toBN(10).pow(13);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal((await daiPool.exchangeRate()).toString(), getDecimal().toString());
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
      assert.equal(txReceipt.receipt.logs[0].args._userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, daiKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args._liquidityAmount).toString(), amountToWithdraw.toString());

      assert.equal((await userInfoRegistry.getUserSupplyAssets(USER1)).length, 1);

      assert.isTrue(deepCompareKeys(await userInfoRegistry.getUserSupplyAssets(USER1), [daiKey]));
    });

    it("should return correct values if try to withdraw all liquidity", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(usdtKey, liquidityAmount, { from: USER1 });

      await defiCore.updateCollateral(wEthKey, true, { from: USER1 });

      const currentTotalLiquidityAmount = liquidityAmount.times(price).times(priceDecimals).idiv(oneToken);
      const expectedLimit = currentTotalLiquidityAmount.times(getDecimal()).idiv(standardColRatio);

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
      assert.equal(txReceipt.receipt.logs[0].args._userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, daiKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args._liquidityAmount).toString(), liquidityAmount.toString());
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
      let expectedAvailableLiquidity = expectedTotalSupply.times(getDecimal()).idiv(standardColRatio);

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
        .times(getDecimal())
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

      assert.isTrue((await daiPool.getCurrentRate()).gt(getDecimal()));

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
        .times(getDecimal())
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

      const reason = "LiquidityPool: Incorrect asset amount after conversion.";

      await truffleAssert.reverts(defiCore.withdrawLiquidity(daiKey, amountToWithdraw, false, { from: USER1 }), reason);
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
      assert.equal(txReceipt.receipt.logs[0].args._borrower, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, wEthKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args._borrowedAmount).toString(), borrowAmount.toString());

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

    it("should get exception if liquidity pool sis freezed", async () => {
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
      assert.equal(txReceipt.receipt.logs[0].args._userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, wEthKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args._repaidAmount).toString(), repayBorrowAmount.toString());

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

      const reason = "DefiCore: Liquidation amount should be less then max quantity.";
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
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await mine(499);

      const expectedRewards = wei(100);

      await defiCore.claimDistributionRewards([], true, { from: USER1 });

      const userInfo = await rewardsDistribution.usersDistributionInfo(daiKey, USER1);

      assert.equal(toBN(userInfo.aggregatedReward).toString(), 0);
      assert.equal(
        toBN(userInfo.lastSupplyCumulativeSum).toString(),
        toBN((await rewardsDistribution.liquidityPoolsInfo(daiKey)).supplyCumulativeSum).toString()
      );
      assert.equal(toBN(userInfo.lastBorrowCumulativeSum).toString(), 0);

      assert.equal(toBN(await governanceToken.balanceOf(USER1)).toString(), expectedRewards.toString());
    });

    it("should claim correct rewards from several pools", async () => {
      for (let i = 0; i < keys.length; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
      }

      await mine(500 - keys.length);

      const expectedRewards = wei(398.9);

      await defiCore.claimDistributionRewards(keys, false, { from: USER1 });

      assert.equal(toBN(await governanceToken.balanceOf(USER1)).toString(), expectedRewards.toString());
    });

    it("should claim correct rewards after deposit and borrow", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(2), { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      await mine(498);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount.idiv(2), USER1, { from: USER1 });

      await defiCore.claimDistributionRewards([], true, { from: USER1 });

      const userInfo = await rewardsDistribution.usersDistributionInfo(daiKey, USER1);
      const poolInfo = await rewardsDistribution.liquidityPoolsInfo(daiKey);

      assert.equal(toBN(userInfo.aggregatedReward).toString(), 0);
      assert.equal(toBN(userInfo.lastSupplyCumulativeSum).toString(), toBN(poolInfo.supplyCumulativeSum).toString());
      assert.equal(toBN(userInfo.lastBorrowCumulativeSum).toString(), toBN(poolInfo.borrowCumulativeSum));

      const expectedRewards = wei(1002.2);
      assert.closeTo(
        toBN(await governanceToken.balanceOf(USER1)).toNumber(),
        expectedRewards.toNumber(),
        oneToken.idiv(100).toNumber()
      );
    });

    it("should claim correct rewards from several pools with deposits and borrows", async () => {
      for (let i = 0; i < keys.length; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
        await defiCore.borrowFor(keys[i], borrowAmount, USER1, { from: USER1 });
      }

      await mine(500);

      for (let i = 0; i < keys.length; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
        await defiCore.borrowFor(keys[i], borrowAmount, USER1, { from: USER1 });
      }

      await defiCore.claimDistributionRewards(keys, false, { from: USER1 });

      const expectedRewards = wei(4066.8);
      assert.closeTo(
        toBN(await governanceToken.balanceOf(USER1)).toNumber(),
        expectedRewards.toNumber(),
        oneToken.idiv(100).toNumber()
      );
    });

    it("should get exception if nothing to claim", async () => {
      const reason = "DefiCore: Nothing to claim.";

      await truffleAssert.reverts(defiCore.claimDistributionRewards([], true, { from: USER1 }), reason);
    });
  });

  describe("approveToDelegateBorrow", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    it("should add approve borrow delegatee to the system", async () => {
      amountToBorrow = wei(100);

      await defiCore.approveToDelegateBorrow(wEthKey, amountToBorrow, USER2, 0, { from: USER1 });

      const result = await wEthPool.borrowAllowances(USER1, USER2);

      assert.equal(amountToBorrow.toString(), toBN(result).toString());
    });

    it("should get exception if expected allowance is not the same as current", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.approveToDelegateBorrow(daiKey, borrowAmount, USER2, 0, { from: USER1 });

      assert.equal(toBN(await daiPool.borrowAllowances(USER1, USER2)).toString(), borrowAmount);

      await defiCore.delegateBorrow(daiKey, borrowAmount, USER1, { from: USER2 });

      assert.equal(toBN(await daiPool.borrowAllowances(USER1, USER2)).toString(), 0);

      const reason = "LiquidityPool: The current allowance is not the same as expected.";

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
      assert.equal(txReceipt.receipt.logs[0].args._borrower, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, wEthKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args._borrowedAmount).toString(), borrowAmount.toString());

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

      const reason = "LiquidityPool: Not enough allowed to borrow amount.";
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
      assert.equal(txReceipt.receipt.logs[0].args._userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, wEthKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args._repaidAmount).toString(), repayBorrowAmount.toString());

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
      assert.equal(txReceipt.receipt.logs[0].args._borrower, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, wEthKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args._borrowedAmount).toString(), borrowAmount.toString());

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
        maxWithdrawUR.toNumber(),
        getOnePercent().idiv(100).toNumber()
      );
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
  });

  describe("getMaxToBorrow", () => {
    const liquidityAmount = wei(100);

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

    it("should correct borrow maximum", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.borrowFor(daiKey, await defiCore.getMaxToBorrow(USER1, daiKey), USER1, { from: USER1 });

      assert.equal((await defiCore.getAvailableLiquidity(USER1))[0].toString(), 0);
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
  });
});
