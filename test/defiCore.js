const SystemParameters = artifacts.require("SystemParameters");
const AssetParameters = artifacts.require("AssetParameters");
const DefiCore = artifacts.require("DefiCore");
const LiquidityPool = artifacts.require("LiquidityPool");
const Registry = artifacts.require("Registry");
const MockERC20 = artifacts.require("MockERC20");
const LiquidityPoolFactory = artifacts.require("LiquidityPoolFactory");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
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

const { advanceBlockAtTime, advanceBlocks } = require("./helpers/ganacheTimeTraveler");
const { toBytes, compareKeys, deepCompareKeys } = require("./helpers/bytesCompareLibrary");
const Reverter = require("./helpers/reverter");
const { assert } = require("chai");

const { getInterestRateLibraryData } = require("../migrations/helpers/deployHelper");
const { toBN } = require("../scripts/globals");

const setCurrentTime = advanceBlockAtTime;
const truffleAssert = require("truffle-assertions");

contract("DefiCore", async (accounts) => {
  const reverter = new Reverter(web3);

  const ADDRESS_NULL = "0x0000000000000000000000000000000000000000";

  const OWNER = accounts[0];
  const USER1 = accounts[1];
  const USER2 = accounts[2];
  const NOTHING = accounts[9];

  let registry;
  let defiCore;
  let assetParameters;
  let rewardsDistribution;
  let assetsRegistry;
  let priceManager;
  let liquidityPoolRegistry;

  let daiPool;
  let wEthPool;
  let usdtPool;

  const tokens = [];

  let daiChainlinkOracle;
  let wEthChainlinkOracle;
  let usdtChainlinkOracle;

  let governanceToken;

  const onePercent = toBN(10).pow(25);
  const decimal = onePercent.times(100);
  const oneToken = toBN(10).pow(18);
  const tokensAmount = oneToken.times(100000);
  const standardColRatio = decimal.times("1.25");
  const reserveFactor = onePercent.times("15");

  const firstSlope = onePercent.times(4);
  const secondSlope = decimal;
  const utilizationBreakingPoint = onePercent.times(80);
  const maxUR = onePercent.times(95);
  const maxWithdrawUR = onePercent.times(94);
  const liquidationDiscount = onePercent.times(8);
  const liquidationBoundary = onePercent.times(50);

  const priceDecimals = toBN(10).pow(8);
  const chainlinkPriceDecimals = toBN(8);

  const minSupplyDistributionPart = onePercent.times(10);
  const minBorrowDistributionPart = onePercent.times(10);

  const daiKey = toBytes("DAI");
  const wEthKey = toBytes("WETH");
  const usdtKey = toBytes("USDT");
  const governanceTokenKey = toBytes("NDG");

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

    await assetParameters.setupInterestRateModel(assetKey, 0, firstSlope, secondSlope, utilizationBreakingPoint);
    await assetParameters.setupMaxUtilizationRatio(assetKey, maxUR);
    await assetParameters.setupDistributionsMinimums(assetKey, minSupplyDistributionPart, minBorrowDistributionPart);

    await assetParameters.setupLiquidationDiscount(assetKey, liquidationDiscount);

    await assetParameters.setupColRatio(assetKey, standardColRatio);
    await assetParameters.setupReserveFactor(assetKey, reserveFactor);

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

    await assetParameters.setupColRatio(governanceTokenKey, standardColRatio);
    await assetParameters.setupReserveFactor(governanceTokenKey, reserveFactor);

    await priceManager.setPrice(governanceTokenKey, 10);
  }

  function getNormalizedAmount(normalizedAmount, additionalAmount, currentRate, isAdding) {
    const normalizedAdditionalAmount = additionalAmount.times(decimal).idiv(currentRate);

    return isAdding
      ? normalizedAmount.plus(normalizedAdditionalAmount)
      : normalizedAmount.minus(normalizedAdditionalAmount);
  }

  before("setup", async () => {
    governanceToken = await GovernanceToken.new(OWNER);
    const interestRateLibrary = await InterestRateLibrary.new(
      getInterestRateLibraryData("scripts/InterestRatesExactData.txt"),
      getInterestRateLibraryData("scripts/InterestRatesData.txt")
    );

    registry = await Registry.new();
    const _defiCore = await DefiCore.new();
    const _systemParameters = await SystemParameters.new();
    const _assetParameters = await AssetParameters.new();
    const _liquidityPoolFactory = await LiquidityPoolFactory.new();
    const _rewardsDistribution = await RewardsDistribution.new();
    const _assetsRegistry = await AssetsRegistry.new();
    const _liquidityPoolAdmin = await LiquidityPoolAdmin.new();
    const _liquidityPoolImpl = await LiquidityPool.new();
    const _priceManager = await PriceManager.new();
    const _liquidityPoolRegistry = await LiquidityPoolRegistry.new();

    const _integrationCore = await IntegrationCore.new();
    const _borrowerRouterImpl = await BorrowerRouter.new();
    const _borrowerRouterFactory = await BorrowerRouterFactory.new();
    const _borrowerRouterRegistry = await BorrowerRouterRegistry.new();

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
    assetsRegistry = await AssetsRegistry.at(await registry.getAssetsRegistryContract());
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

    await deployTokens([await governanceToken.symbol(), "DAI", "WETH", "USDT"]);

    await systemParameters.systemParametersInitialize();
    await assetParameters.assetParametersInitialize();
    await rewardsDistribution.rewardsDistributionInitialize();
    await priceManager.priceManagerInitialize(daiKey, tokens[1].address);
    await liquidityPoolAdmin.liquidityPoolAdminInitialize(_liquidityPoolImpl.address);
    await liquidityPoolRegistry.liquidityPoolRegistryInitialize();
    await borrowerRouterRegistry.borrowerRouterRegistryInitialize(_borrowerRouterImpl.address);

    await setCurrentTime(1);

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
      [oneToken.times(2), oneToken, oneToken.times(5), oneToken]
    );

    await governanceToken.transfer(defiCore.address, tokensAmount.times(10));

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("getTotalSupplyBalanceInUSD", async () => {
    const liquidityAmount = oneToken.times(100);
    const price = toBN(100);

    it("should return 0 if user if the user has no deposits", async () => {
      assert.equal(await defiCore.getTotalSupplyBalanceInUSD(USER1), 0);
    });

    it("should return correct total balance", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(2), { from: USER1 });

      assert.equal(
        toBN(await defiCore.getTotalSupplyBalanceInUSD(USER1)).toString(),
        liquidityAmount.times(3).times(price).times(priceDecimals).idiv(oneToken).toString()
      );
    });
  });

  describe("getCurrentBorrowLimitInUSD", async () => {
    const liquidityAmount = oneToken.times(100);
    const price = toBN(100);

    it("should return 0 if user if the user has no deposits", async () => {
      assert.equal(await defiCore.getCurrentBorrowLimitInUSD(USER1), 0);
    });

    it("should return 0 if the user has no enabled as collateral assets", async () => {
      await defiCore.disableCollateral(daiKey, { from: USER1 });
      await defiCore.disableCollateral(wEthKey, { from: USER1 });

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(2), { from: USER1 });

      assert.equal(toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), 0);
    });

    it("should return correct borrow limit", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(2), { from: USER1 });

      await defiCore.disableCollateral(wEthKey, { from: USER1 });

      const expectedLimit = liquidityAmount
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(decimal)
        .idiv(standardColRatio);

      assert.equal(toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedLimit.toString());
    });

    it("should return 0 if the user has no enabled as collateral assets, including assets which are not posible to be enabled", async () => {
      await defiCore.disableCollateral(daiKey, { from: USER1 });

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(usdtKey, liquidityAmount.times(2), { from: USER1 });

      assert.equal(toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), 0);
    });

    it("should return correct borrow limit regardless of disableCollateral function", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(usdtKey, liquidityAmount.times(2), { from: USER1 });

      const expectedLimit = liquidityAmount
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(decimal)
        .idiv(standardColRatio);

      assert.equal(toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedLimit.toString());

      await defiCore.disableCollateral(usdtKey, { from: USER1 });

      assert.equal(toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedLimit.toString());
    });

    it("should return correct borrow limit for assets with different collateralization ratio", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      let expectedLimit = liquidityAmount
        .times(2)
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(decimal)
        .idiv(standardColRatio);

      assert.equal(toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedLimit.toString());

      const newDaiColRatio = decimal.times(1.15);
      const newWEthColRatio = decimal.times(1.3);

      await assetParameters.setupColRatio(daiKey, newDaiColRatio);
      await assetParameters.setupColRatio(wEthKey, newWEthColRatio);

      const daiPart = liquidityAmount
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(decimal)
        .idiv(newDaiColRatio);
      const wEthPart = liquidityAmount
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(decimal)
        .idiv(newWEthColRatio);

      expectedLimit = daiPart.plus(wEthPart);

      assert.equal(toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedLimit.toString());
    });
  });

  describe("getNewBorrowLimitInUSD", async () => {
    const liquidityAmount = oneToken.times(100);
    const price = toBN(100);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(2), { from: USER1 });

      const expectedLimit = liquidityAmount
        .times(3)
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(decimal)
        .idiv(standardColRatio);

      assert.equal(toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedLimit.toString());
    });

    it("should return correct value if collateral enabled and supply", async () => {
      const expectedLimit = liquidityAmount
        .times(4)
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(decimal)
        .idiv(standardColRatio);

      const result = toBN(await defiCore.getNewBorrowLimitInUSD(USER1, daiKey, liquidityAmount, true));
      assert.equal(result.toString(), expectedLimit.toString());
    });

    it("should return correct value if collateral enabled and withdraw", async () => {
      const expectedLimit = liquidityAmount
        .times(2.5)
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(decimal)
        .idiv(standardColRatio);

      const result = toBN(await defiCore.getNewBorrowLimitInUSD(USER1, daiKey, liquidityAmount.idiv(2), false));
      assert.equal(result.toString(), expectedLimit.toString());
    });

    it("should return correct value if collateral disabled", async () => {
      await defiCore.disableCollateral(daiKey, { from: USER1 });
      const expectedLimit = liquidityAmount
        .times(2)
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(decimal)
        .idiv(standardColRatio);

      let result = toBN(await defiCore.getNewBorrowLimitInUSD(USER1, daiKey, liquidityAmount.idiv(2), false));
      assert.equal(result.toString(), expectedLimit.toString());

      result = toBN(await defiCore.getNewBorrowLimitInUSD(USER1, daiKey, liquidityAmount.idiv(2), true));
      assert.equal(result.toString(), expectedLimit.toString());
    });

    it("should return correct value if collateral enabled and withdraw amount greater than current limit", async () => {
      const result = toBN(await defiCore.getNewBorrowLimitInUSD(USER1, daiKey, liquidityAmount.times(4), false));
      assert.equal(result.toString(), 0);
    });
  });

  describe("getTotalBorrowBalanceInUSD", async () => {
    const liquidityAmount = oneToken.times(100);
    const amountToBorrow = oneToken.times(50);
    const price = toBN(100);
    const neededTime = toBN(100000);

    it("should return 0 if user if the user has no borrows", async () => {
      assert.equal(await defiCore.getTotalBorrowBalanceInUSD(USER1), 0);
    });

    it("should return correct borrow balance", async () => {
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(2), { from: USER2 });
      await defiCore.addLiquidity(usdtKey, liquidityAmount.times(2), { from: USER2 });

      await defiCore.addLiquidity(daiKey, liquidityAmount.times(2), { from: USER1 });

      await defiCore.borrow(wEthKey, amountToBorrow, { from: USER1 });
      await defiCore.borrow(usdtKey, amountToBorrow, { from: USER1 });

      await setCurrentTime(neededTime);

      await wEthPool.updateCompoundRate();
      await usdtPool.updateCompoundRate();

      const totalBorrowedAmount = toBN(await defiCore.getUserBorrowedAmount(USER1, wEthKey)).plus(
        await defiCore.getUserBorrowedAmount(USER1, usdtKey)
      );

      assert.closeTo(
        toBN(await defiCore.getTotalBorrowBalanceInUSD(USER1)).toNumber(),
        totalBorrowedAmount.times(price).times(priceDecimals).idiv(oneToken).toNumber(),
        10
      );
    });
  });

  describe("getAvailableLiquidity", async () => {
    const liquidityAmount = oneToken.times(100);
    const amountToBorrow = oneToken.times(50);
    const keysArr = [daiKey, wEthKey, usdtKey];
    const price = toBN(100);
    const startTime = toBN(100000);

    beforeEach("setup", async () => {
      for (let i = 0; i < keysArr.length; i++) {
        await defiCore.addLiquidity(keysArr[i], liquidityAmount, { from: USER2 });
      }

      assert.equal((await assetsRegistry.getUserSupplyAssets(USER2)).length, 3);
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
        .times(decimal)
        .idiv(standardColRatio);

      assert.equal(toBN(result[0]).toString(), expectedAvailableLiquidity.toString());
      assert.equal(result[1], 0);
    });

    it("should return correct values if try to withdraw all liquidity", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      const currentTotalLiquidityAmount = liquidityAmount.times(2).times(price).times(priceDecimals).idiv(oneToken);
      const expectedLimit = currentTotalLiquidityAmount.times(decimal).idiv(standardColRatio);

      let result = await defiCore.getAvailableLiquidity(USER1);
      assert.equal(toBN(result[0]).toString(), expectedLimit.toString());
      assert.equal(result[1], 0);

      await defiCore.withdrawLiquidity(daiKey, liquidityAmount, false, { from: USER1 });
      await defiCore.withdrawLiquidity(wEthKey, liquidityAmount, false, { from: USER1 });

      result = await defiCore.getAvailableLiquidity(USER1);
      assert.equal(toBN(result[0]).toString(), 0);
      assert.equal(result[1], 0);
    });

    it("should return correct values if total borrowed amount equals to zero", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      let currentTotalLiquidityAmount = liquidityAmount.times(2).times(price).times(priceDecimals).idiv(oneToken);
      let expectedLimit = currentTotalLiquidityAmount.times(decimal).idiv(standardColRatio);

      let result = await defiCore.getAvailableLiquidity(USER1);
      assert.equal(toBN(result[0]).toString(), expectedLimit.toString());
      assert.equal(result[1], 0);

      await setCurrentTime(startTime.times(2));
      await defiCore.withdrawLiquidity(daiKey, liquidityAmount, false, { from: USER1 });

      currentTotalLiquidityAmount = liquidityAmount.times(price).times(priceDecimals).idiv(oneToken);
      expectedLimit = currentTotalLiquidityAmount.times(decimal).idiv(standardColRatio);

      result = await defiCore.getAvailableLiquidity(USER1);
      assert.equal(toBN(result[0]).toString(), expectedLimit.toString());
      assert.equal(result[1], 0);
    });

    it("should return correct values after borrow/repayBorrow", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      await setCurrentTime(startTime);
      await usdtPool.updateCompoundRate();

      await defiCore.borrow(usdtKey, amountToBorrow, { from: USER1 });

      let borrowLimit = toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1));
      let totalBorrowedAmount = toBN(await defiCore.getTotalBorrowBalanceInUSD(USER1));

      let result = await defiCore.getAvailableLiquidity(USER1);
      assert.closeTo(toBN(result[0]).toNumber(), borrowLimit.minus(totalBorrowedAmount).toNumber(), 10);
      assert.equal(result[1], 0);

      await setCurrentTime(startTime.times(100));
      await usdtPool.updateCompoundRate();

      const amountToRepayBorrow = amountToBorrow.div(2);
      await defiCore.repayBorrow(usdtKey, amountToRepayBorrow, false, { from: USER1 });

      borrowLimit = toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1));
      totalBorrowedAmount = toBN(await defiCore.getTotalBorrowBalanceInUSD(USER1));

      result = await defiCore.getAvailableLiquidity(USER1);
      assert.closeTo(toBN(result[0]).toNumber(), borrowLimit.minus(totalBorrowedAmount).toNumber(), 10);
      assert.equal(result[1], 0);
    });
  });

  describe("enableCollateral", async () => {
    const liquidityAmount = oneToken.times(100);
    const price = toBN(100);

    it("should correctly enable collateral", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.disableCollateral(daiKey, { from: USER1 });

      const result = toBN(await defiCore.enableCollateral.call(daiKey, { from: USER1 }));
      assert.equal(
        result.toString(),
        liquidityAmount
          .times(price)
          .times(priceDecimals)
          .idiv(oneToken)
          .times(decimal)
          .idiv(standardColRatio)
          .toString()
      );

      await defiCore.enableCollateral(daiKey, { from: USER1 });

      assert.equal(await defiCore.disabledCollateralAssets(USER1, daiKey), false);
    });

    it("should get exception if asset already enabled", async () => {
      const reason = "AbstractCore: Asset already enabled as collateral.";
      await truffleAssert.reverts(defiCore.enableCollateral(daiKey, { from: USER1 }), reason);
    });

    it("should get exception if asset is not collateral", async () => {
      const reason = "AbstractCore: Asset is blocked for collateral.";
      await truffleAssert.reverts(defiCore.enableCollateral(usdtKey, { from: USER1 }), reason);
    });
  });

  describe("disableCollateral", async () => {
    const liquidityAmount = oneToken.times(100);
    const amountToBorrow = oneToken.times(50);
    const price = toBN(100);

    it("should correctly disable collateral", async () => {
      let result = await defiCore.disableCollateral.call(daiKey, { from: USER1 });
      assert.equal(result, 0);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      const expectedBorrowLimit = liquidityAmount
        .times(price)
        .times(priceDecimals)
        .div(oneToken)
        .times(decimal)
        .div(standardColRatio);
      assert.equal(toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedBorrowLimit.toString());

      result = await defiCore.disableCollateral.call(daiKey, { from: USER1 });
      assert.equal(result.toString(), 0);

      await defiCore.disableCollateral(daiKey, { from: USER1 });

      assert.equal(await defiCore.disabledCollateralAssets(USER1, daiKey), true);
    });

    it("should get exception if not enough available liquidity after disable", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.borrow(wEthKey, amountToBorrow, { from: USER1 });

      const reason = "AbstractCore: It is impossible to disable the asset as a collateral.";
      await truffleAssert.reverts(defiCore.disableCollateral(daiKey, { from: USER1 }), reason);
    });

    it("should get exception if asset not enabled", async () => {
      await defiCore.disableCollateral(daiKey, { from: USER1 });

      const reason = "AbstractCore: Asset must be enabled as collateral.";
      await truffleAssert.reverts(defiCore.disableCollateral(daiKey, { from: USER1 }), reason);
    });
  });

  describe("addLiquidity", async () => {
    const liquidityAmount = oneToken.times(100);

    it("should correctly add liquidity to the pool", async () => {
      const txReceipt = await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal(toBN(await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), liquidityAmount.toString());
      assert.equal(toBN(await tokens[1].balanceOf(USER1)).toString(), tokensAmount.minus(liquidityAmount).toString());

      assert.equal(txReceipt.receipt.logs.length, 1);

      assert.equal(txReceipt.receipt.logs[0].event, "LiquidityAdded");
      assert.equal(txReceipt.receipt.logs[0].args._userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, daiKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args._liquidityAmount).toString(), liquidityAmount.toString());

      assert.equal((await assetsRegistry.getUserSupplyAssets(USER1)).length, 1);
      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserSupplyAssets(USER1), [daiKey]));
    });

    it("should correctly mint NTokens for token with 6 decimal places", async () => {
      const USER3 = accounts[5];

      await tokens[1].setDecimals(6);

      const amountToTransfer = toBN(10).pow(6).times(1000);
      await tokens[1].transfer(USER3, amountToTransfer, { from: USER1 });

      await tokens[1].approve(daiPool.address, liquidityAmount, { from: USER3 });
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER3 });

      assert.equal(toBN(await daiPool.getUnderlyingDecimals()).toString(), 6);
      assert.equal(toBN(await daiPool.balanceOf(USER3)).toString(), liquidityAmount.toString());
      assert.equal(toBN(await defiCore.getUserLiquidityAmount(USER3, daiKey)).toString(), liquidityAmount.toString());

      const supplyAssetInfo = (await assetsRegistry.getSupplyAssetsInfo([daiKey], USER3))[0];
      assert.equal(toBN(supplyAssetInfo.userSupplyBalanceInUSD).toString(), priceDecimals.times(10000).toString());
      assert.equal(toBN(supplyAssetInfo.userSupplyBalance).toString(), liquidityAmount.toString());
    });

    it("should get exception if the asset amount to transfer equal to zero", async () => {
      await tokens[1].setDecimals(6);

      let liquidityAmount = toBN(10).pow(6).times(100);

      const reason = "LiquidityPool: Incorrect asset amount after conversion.";

      await truffleAssert.reverts(defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 }), reason);

      liquidityAmount = toBN(10).pow(13);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal(toBN(await daiPool.exchangeRate()).toString(), decimal.toString());
      assert.equal(toBN(await daiPool.balanceOf(USER1)).toString(), liquidityAmount.toString());
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

  describe("withdrawLiquidity", async () => {
    const liquidityAmount = oneToken.times(100);
    const amountToBorrow = oneToken.times(75);
    const amountToWithdraw = oneToken.times(50);
    const startTime = toBN(100000);
    const withdrawTime = startTime.times(2);
    const price = toBN(100);

    it("should correctly withdraw liquidity from the pool", async () => {
      await setCurrentTime(startTime);
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal(toBN(await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), liquidityAmount.toString());
      assert.equal(toBN(await tokens[1].balanceOf(USER1)).toString(), tokensAmount.minus(liquidityAmount).toString());

      await setCurrentTime(withdrawTime);
      const txReceipt = await defiCore.withdrawLiquidity(daiKey, amountToWithdraw, false, { from: USER1 });

      assert.equal(
        toBN(await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(),
        liquidityAmount.minus(amountToWithdraw).toString()
      );
      assert.equal(
        toBN(await tokens[1].balanceOf(USER1)).toString(),
        tokensAmount.minus(liquidityAmount).plus(amountToWithdraw).toString()
      );

      assert.equal(txReceipt.receipt.logs.length, 1);

      assert.equal(txReceipt.receipt.logs[0].event, "LiquidityWithdrawn");
      assert.equal(txReceipt.receipt.logs[0].args._userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, daiKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args._liquidityAmount).toString(), amountToWithdraw.toString());

      assert.equal((await assetsRegistry.getUserSupplyAssets(USER1)).length, 1);

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserSupplyAssets(USER1), [daiKey]));
    });

    it("should return correct values if try to withdraw all liquidity", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(usdtKey, liquidityAmount, { from: USER1 });

      await defiCore.disableCollateral(wEthKey, { from: USER1 });

      const currentTotalLiquidityAmount = liquidityAmount.times(price).times(priceDecimals).idiv(oneToken);
      const expectedLimit = currentTotalLiquidityAmount.times(decimal).idiv(standardColRatio);

      let result = await defiCore.getAvailableLiquidity(USER1);
      assert.equal(toBN(result[0]).toString(), expectedLimit.toString());
      assert.equal(result[1], 0);

      await defiCore.withdrawLiquidity(wEthKey, liquidityAmount, true, { from: USER1 });
      await defiCore.withdrawLiquidity(usdtKey, liquidityAmount, true, { from: USER1 });
      const txReceipt = await defiCore.withdrawLiquidity(daiKey, liquidityAmount, true, { from: USER1 });

      assert.equal(toBN(await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), 0);
      assert.equal(toBN(await tokens[1].balanceOf(USER1)).toString(), tokensAmount.toString());

      assert.equal(toBN(await defiCore.getUserLiquidityAmount(USER1, usdtKey)).toString(), 0);
      assert.equal(toBN(await tokens[3].balanceOf(USER1)).toString(), tokensAmount.toString());

      assert.equal(txReceipt.receipt.logs.length, 1);

      assert.equal(txReceipt.receipt.logs[0].event, "LiquidityWithdrawn");
      assert.equal(txReceipt.receipt.logs[0].args._userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, daiKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args._liquidityAmount).toString(), liquidityAmount.toString());
    });

    it("should correctly withdraw with disabled collateral", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.disableCollateral(daiKey, { from: USER1 });

      await setCurrentTime(withdrawTime);
      await defiCore.withdrawLiquidity(daiKey, amountToWithdraw, false, { from: USER1 });

      assert.equal(toBN(await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), amountToWithdraw.toString());
      assert.equal(toBN(await tokens[1].balanceOf(USER1)).toString(), tokensAmount.minus(amountToWithdraw).toString());
    });

    it("should correctly withdraw with assets which are not possible to be enabled as collateral", async () => {
      await defiCore.addLiquidity(usdtKey, liquidityAmount, { from: USER1 });

      await defiCore.disableCollateral(usdtKey, { from: USER1 });

      await defiCore.withdrawLiquidity(usdtKey, liquidityAmount.minus(1), false, { from: USER1 });

      assert.equal(toBN(await defiCore.getUserLiquidityAmount(USER1, usdtKey)).toString(), toBN(1).toString());
      assert.equal(toBN(await tokens[3].balanceOf(USER1)).toString(), tokensAmount.minus(1).toString());
    });

    it("should correctly withdraw all funds of one asset", async () => {
      const newDaiPrice = toBN(10).times(priceDecimals);
      const newWEthPrice = toBN(120).times(priceDecimals);

      await daiChainlinkOracle.setPrice(newDaiPrice);
      await wEthChainlinkOracle.setPrice(newWEthPrice);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      let expectedTotalSupply = toBN(13000).times(priceDecimals);
      let expectedAvailableLiquidity = expectedTotalSupply.times(decimal).idiv(standardColRatio);

      assert.equal(toBN(await defiCore.getTotalSupplyBalanceInUSD(USER1)).toString(), expectedTotalSupply.toString());
      assert.equal(
        toBN((await defiCore.getAvailableLiquidity(USER1))[0]).toString(),
        expectedAvailableLiquidity.toString()
      );

      // console.log(`BL - ${toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString()}`);
      // console.log(`Total Supply balance - ${toBN(await defiCore.getTotalSupplyBalanceInUSD(USER1)).toString()}`);
      // console.log(`AL - ${toBN((await defiCore.getAvailableLiquidity(USER1))[0]).toString()}`);

      await defiCore.borrow(daiKey, liquidityAmount.idiv(2), { from: USER1 });

      let expectedTotalBorrow = toBN(500).times(priceDecimals);
      expectedAvailableLiquidity = expectedAvailableLiquidity.minus(expectedTotalBorrow);

      assert.equal(toBN(await defiCore.getTotalBorrowBalanceInUSD(USER1)).toString(), expectedTotalBorrow.toString());
      assert.equal(
        toBN((await defiCore.getAvailableLiquidity(USER1))[0]).toString(),
        expectedAvailableLiquidity.toString()
      );

      // console.log("----------------------");
      // console.log(`BL - ${toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString()}`);
      // console.log(`Borrow balance - ${toBN(await defiCore.getTotalBorrowBalanceInUSD(USER1)).toString()}`);
      // console.log(`AL - ${toBN((await defiCore.getAvailableLiquidity(USER1))[0]).toString()}`);

      await defiCore.withdrawLiquidity(wEthKey, liquidityAmount, true, { from: USER1 });

      expectedTotalSupply = toBN(1000).times(priceDecimals);
      expectedAvailableLiquidity = expectedTotalSupply.times(decimal).idiv(standardColRatio).minus(expectedTotalBorrow);

      assert.equal(toBN(await defiCore.getTotalSupplyBalanceInUSD(USER1)).toString(), expectedTotalSupply.toString());
      assert.equal(
        toBN((await defiCore.getAvailableLiquidity(USER1))[0]).toString(),
        expectedAvailableLiquidity.toString()
      );

      // console.log("----------------------");
      // console.log(`BL - ${toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString()}`);
      // console.log(`Total Supply balance - ${toBN(await defiCore.getTotalSupplyBalanceInUSD(USER1)).toString()}`);
      // console.log(`AL - ${toBN((await defiCore.getAvailableLiquidity(USER1))[0]).toString()}`);
    });

    it("should correctly withdraw all liquidity", async () => {
      await setCurrentTime(startTime);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });

      assert.equal(toBN(await daiPool.balanceOf(USER1)).toString(), liquidityAmount.toString());
      assert.equal(toBN(await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), liquidityAmount.toString());

      await defiCore.borrow(daiKey, amountToBorrow, { from: USER2 });

      await setCurrentTime(startTime.times(100));

      await defiCore.updateCompoundRate(daiKey);

      assert.isTrue(toBN(await daiPool.getCurrentRate()).gt(decimal));

      await defiCore.withdrawLiquidity(daiKey, 0, true, { from: USER1 });

      assert.equal(toBN(await daiPool.balanceOf(USER1)).toString(), 0);
      assert.equal(toBN(await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), 0);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await setCurrentTime(startTime.times(1000));

      await defiCore.updateCompoundRate(daiKey);

      await defiCore.withdrawLiquidity(daiKey, 0, true, { from: USER1 });

      assert.equal(toBN(await daiPool.balanceOf(USER1)).toString(), 0);
      assert.equal(toBN(await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), 0);
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
      await setCurrentTime(startTime);
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.borrow(wEthKey, amountToBorrow, { from: USER1 });

      const expectedLimit = liquidityAmount
        .times(price)
        .times(priceDecimals)
        .idiv(oneToken)
        .times(decimal)
        .idiv(standardColRatio);
      assert.equal(toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedLimit.toString());

      const expectedTotalBorrowedBalance = amountToBorrow.times(price).times(priceDecimals).idiv(oneToken);
      assert.equal(
        toBN(await defiCore.getTotalBorrowBalanceInUSD(USER1)).toString(),
        expectedTotalBorrowedBalance.toString()
      );

      const expectedAvailableLiquidity = toBN(expectedLimit).minus(expectedTotalBorrowedBalance);

      assert.equal(
        toBN((await defiCore.getAvailableLiquidity(USER1))[0]).toString(),
        expectedAvailableLiquidity.toString()
      );

      await setCurrentTime(withdrawTime);
      const reason = "DefiCore: Borrow limit used greater than 100%.";
      await truffleAssert.reverts(defiCore.withdrawLiquidity(daiKey, amountToWithdraw, false, { from: USER1 }), reason);
    });

    it("should get exception if the asset amount to transfer equal to zero", async () => {
      await tokens[1].setDecimals(6);

      const liquidityAmount = oneToken.times(100);
      const amountToWithdraw = toBN(10).pow(6).times(50);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      const reason = "LiquidityPool: Incorrect asset amount after conversion.";

      await truffleAssert.reverts(defiCore.withdrawLiquidity(daiKey, amountToWithdraw, false, { from: USER1 }), reason);
    });
  });

  describe("check account assets", async () => {
    const liquidityAmount = oneToken.times(100);
    const amountToWithdraw = oneToken.times(50);
    const amountToBorrow = oneToken.times(50);
    const keysArr = [daiKey, wEthKey, usdtKey];

    beforeEach("setup", async () => {
      for (let i = 0; i < keysArr.length; i++) {
        await defiCore.addLiquidity(keysArr[i], liquidityAmount, { from: USER2 });
      }

      assert.equal((await assetsRegistry.getUserSupplyAssets(USER2)).length, 3);
    });

    it("should correctly update assets after addLiquidity/withdrawLiquidity", async () => {
      const startTime = toBN(100000);

      await setCurrentTime(startTime);
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(usdtKey, liquidityAmount, { from: USER1 });

      assert.equal((await assetsRegistry.getUserSupplyAssets(USER1)).length, 3);
      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserSupplyAssets(USER1), [daiKey, wEthKey, usdtKey]));

      await setCurrentTime(startTime.times(2));
      await defiCore.withdrawLiquidity(daiKey, amountToWithdraw, false, { from: USER1 });
      await defiCore.withdrawLiquidity(wEthKey, liquidityAmount, false, { from: USER1 });

      assert.equal((await assetsRegistry.getUserSupplyAssets(USER1)).length, 2);
      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserSupplyAssets(USER1), [daiKey, usdtKey]));

      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      assert.equal((await assetsRegistry.getUserSupplyAssets(USER1)).length, 3);
      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserSupplyAssets(USER1), [daiKey, usdtKey, wEthKey]));
    });

    it("should correctly update assets after borrow/repayBorrow", async () => {
      const startTime = toBN(100000);

      await setCurrentTime(startTime);
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.borrow(usdtKey, amountToBorrow, { from: USER1 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserSupplyAssets(USER1), [daiKey]));
      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), [usdtKey]));

      await defiCore.repayBorrow(usdtKey, amountToBorrow.div(2), false, { from: USER1 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserSupplyAssets(USER1), [daiKey]));
      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), [usdtKey]));

      await defiCore.repayBorrow(usdtKey, amountToBorrow, false, { from: USER1 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserSupplyAssets(USER1), [daiKey]));
      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), []));

      await setCurrentTime(startTime.times(2).plus(1));
      await defiCore.borrow(usdtKey, amountToBorrow, { from: USER1 });

      await setCurrentTime(startTime.times(2).plus(2));
      await defiCore.repayBorrow(usdtKey, amountToBorrow, true, { from: USER1 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserSupplyAssets(USER1), [daiKey]));
      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), []));
    });
  });

  describe("borrow", async () => {
    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(50);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
    });

    it("should correctly borrow tokens", async () => {
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await wEthPool.updateCompoundRate();
      const txReceipt = await defiCore.borrow(wEthKey, borrowAmount, { from: USER1 });

      assert.equal(txReceipt.receipt.logs.length, 1);

      assert.equal(txReceipt.receipt.logs[0].event, "Borrowed");
      assert.equal(txReceipt.receipt.logs[0].args._userAddr, USER1);
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

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), [wEthKey]));
    });

    it("should get exception if borrow amount is zero", async () => {
      const reason = "DefiCore: Borrow amount must be greater than zero.";
      await truffleAssert.reverts(defiCore.borrow(daiKey, 0, { from: USER1 }), reason);
    });

    it("should get exception if asset does not exists", async () => {
      const someAssetKey = toBytes("SOME_ASSET");
      const reason = "AssetParameters: Param for this asset doesn't exist.";
      await truffleAssert.reverts(defiCore.borrow(someAssetKey, liquidityAmount, { from: USER1 }), reason);
    });

    it("should get exception if not enough available liquidity", async () => {
      const reason = "DefiCore: Not enough available liquidity.";
      await truffleAssert.reverts(defiCore.borrow(daiKey, liquidityAmount.times(2), { from: USER2 }), reason);
    });

    it("should get exception if liquidity pool sis freezed", async () => {
      await assetParameters.freeze(daiKey);

      const reason = "DefiCore: Pool is freeze for borrow operations.";
      await truffleAssert.reverts(defiCore.borrow(daiKey, liquidityAmount, { from: USER1 }), reason);
    });
  });

  describe("repayBorrow", async () => {
    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(75);
    const repayBorrowAmount = oneToken.times(50);
    const startTime = toBN(100000);

    beforeEach("setup", async () => {
      await setCurrentTime(startTime);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await wEthPool.updateCompoundRate();
      await defiCore.borrow(wEthKey, borrowAmount, { from: USER1 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), [wEthKey]));
    });

    it("should correctly repay borrow", async () => {
      await setCurrentTime(startTime.times(100));

      const currentNormalizedAmount = toBN((await wEthPool.borrowInfos(USER1)).normalizedAmount);

      await wEthPool.updateCompoundRate();
      const txReceipt = await defiCore.repayBorrow(wEthKey, repayBorrowAmount, false, { from: USER1 });

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
        toBN((await wEthPool.borrowInfos(USER1)).normalizedAmount).toString(),
        expectedNormalizedAmount.toString()
      );
      assert.equal(
        toBN(await wEthPool.aggregatedNormalizedBorrowedAmount()).toString(),
        expectedNormalizedAmount.toString()
      );

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), [wEthKey]));
    });

    it("should fully repay borrow and remove assets from the list", async () => {
      await setCurrentTime(startTime.times(100));

      await wEthPool.updateCompoundRate();
      await defiCore.repayBorrow(wEthKey, 0, true, { from: USER1 });

      assert.equal(toBN((await wEthPool.borrowInfos(USER1)).normalizedAmount).toString(), 0);
      assert.equal(toBN(await wEthPool.aggregatedNormalizedBorrowedAmount()).toString(), 0);

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), []));
    });

    it("should correctly repay full borrow immediately after borrow", async () => {
      await setCurrentTime(startTime.times(10));

      await wEthPool.updateCompoundRate();

      await setCurrentTime(startTime.times(10).plus(10));
      await defiCore.borrow(wEthKey, oneToken.times(10), { from: USER2 });

      await setCurrentTime(startTime.times(10).plus(11));
      await defiCore.repayBorrow(wEthKey, 0, true, { from: USER2 });

      assert.equal(toBN((await wEthPool.borrowInfos(USER2)).normalizedAmount).toString(), 0);

      await defiCore.repayBorrow(wEthKey, 0, true, { from: USER1 });

      assert.equal(toBN((await wEthPool.borrowInfos(USER1)).normalizedAmount).toString(), 0);
      assert.equal(toBN(await wEthPool.aggregatedNormalizedBorrowedAmount()).toString(), 0);
    });

    it("should get exception if repay borrow amount is zero", async () => {
      const reason = "DefiCore: Zero amount cannot be repaid.";
      await truffleAssert.reverts(defiCore.repayBorrow(daiKey, 0, false, { from: USER1 }), reason);
    });
  });

  describe("liquidation", async () => {
    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(75);
    const liquidateAmount = oneToken.times(20);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await wEthPool.updateCompoundRate();
      await defiCore.borrow(wEthKey, borrowAmount, { from: USER1 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), [wEthKey]));
    });

    it("should correctly liquidate user's assets", async () => {
      await defiCore.addLiquidity(usdtKey, liquidityAmount, { from: USER1 });
      const price = toBN(46);

      await daiChainlinkOracle.setPrice(price.times(priceDecimals));
      await usdtChainlinkOracle.setPrice(price.times(priceDecimals));

      const result = await defiCore.liquidation(USER1, daiKey, wEthKey, liquidateAmount, { from: USER2 });

      assert.equal(result.receipt.logs.length, 2);

      assert.equal(result.receipt.logs[0].event, "LiquidateBorrow");
      assert.isTrue(deepCompareKeys([result.receipt.logs[0].args._paramKey], [wEthKey]));
      assert.equal(result.logs[0].args._userAddr, USER1);
      assert.equal(toBN(result.logs[0].args._amount).toString(), toBN(liquidateAmount).toString());

      assert.equal(result.receipt.logs[1].event, "LiquidatorPay");
      assert.isTrue(deepCompareKeys([result.receipt.logs[1].args._paramKey], [daiKey]));
      assert.equal(result.logs[1].args._liquidatorAddr, USER2);
      assert.equal(
        toBN(result.logs[1].args._amount).toString(),
        toBN(liquidateAmount.times(100).idiv(price).idiv("0.92")).toString()
      );
    });

    it("should correctly liquidate user's asset", async () => {
      const price = toBN(92);

      await daiChainlinkOracle.setPrice(price.times(priceDecimals));

      const result = await defiCore.liquidation(USER1, daiKey, wEthKey, liquidateAmount, { from: USER2 });

      assert.equal(result.receipt.logs.length, 2);

      assert.equal(result.receipt.logs[0].event, "LiquidateBorrow");
      assert.isTrue(deepCompareKeys([result.receipt.logs[0].args._paramKey], [wEthKey]));
      assert.equal(result.logs[0].args._userAddr, USER1);
      assert.equal(toBN(result.logs[0].args._amount).toString(), toBN(liquidateAmount).toString());

      assert.equal(result.receipt.logs[1].event, "LiquidatorPay");
      assert.isTrue(deepCompareKeys([result.receipt.logs[1].args._paramKey], [daiKey]));
      assert.equal(result.logs[1].args._liquidatorAddr, USER2);
      assert.equal(
        toBN(result.logs[1].args._amount).toString(),
        toBN(liquidateAmount.times(100).idiv(price).idiv("0.92")).toString()
      );
    });

    it("should correctly update cumulative sums after liquidation", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrow(daiKey, borrowAmount, { from: USER1 });

      await advanceBlocks(500);

      let expectedUser1Reward = oneToken.times(900.73);
      let expectedUser2Reward = oneToken.times(100.46);

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

      await setCurrentTime(10);
      const amountToLiquidate = oneToken.times(75);
      await defiCore.liquidation(USER1, daiKey, daiKey, amountToLiquidate, { from: USER2 });

      rewardsPerBlock = await rewardsDistribution.getRewardsPerBlock(daiKey, toBN(135223522372517110));

      await advanceBlocks(500);

      expectedUser1Reward = oneToken.times(1860.36);
      expectedUser2Reward = oneToken.times(146.83);

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

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserSupplyAssets(USER1), [daiKey, wEthKey]));

      const amountToLiquidate = oneToken.times(9.2);
      await defiCore.liquidation(USER1, wEthKey, wEthKey, amountToLiquidate, { from: USER2 });

      assert.closeTo(
        toBN(await defiCore.getUserLiquidityAmount(USER1, wEthKey)).toNumber(),
        0,
        oneToken.idiv(100).toNumber()
      );
    });

    it("should correctly update user borrow assets after liquidation", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrow(daiKey, borrowAmount, { from: USER1 });

      const price = toBN(82).times(priceDecimals);
      await daiChainlinkOracle.setPrice(price);

      const expectedBorrowLimit = toBN(13120).times(priceDecimals);

      assert.equal(toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(), expectedBorrowLimit.toString());

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), [wEthKey, daiKey]));

      const amountToLiquidate = oneToken.times(75);
      await defiCore.liquidation(USER1, daiKey, daiKey, amountToLiquidate, { from: USER2 });

      assert.closeTo(
        toBN(await defiCore.getUserBorrowedAmount(USER1, daiKey)).toNumber(),
        0,
        oneToken.idiv(100).toNumber()
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

  describe("claimDistributionRewards", async () => {
    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(50);
    const keys = [daiKey, wEthKey, usdtKey];

    it("should claim correct rewards", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await advanceBlocks(499);

      const expectedRewards = oneToken.times(100);

      await defiCore.claimDistributionRewards({ from: USER1 });

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

      await advanceBlocks(500 - keys.length);

      const expectedRewards = oneToken.times(398.9);

      await defiCore.claimDistributionRewards({ from: USER1 });

      assert.equal(toBN(await governanceToken.balanceOf(USER1)).toString(), expectedRewards.toString());
    });

    it("should claim correct rewards after deposit and borrow", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(2), { from: USER1 });
      await defiCore.borrow(daiKey, borrowAmount, { from: USER1 });

      await advanceBlocks(498);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrow(daiKey, borrowAmount.idiv(2), { from: USER1 });

      await defiCore.claimDistributionRewards({ from: USER1 });

      const userInfo = await rewardsDistribution.usersDistributionInfo(daiKey, USER1);
      const poolInfo = await rewardsDistribution.liquidityPoolsInfo(daiKey);

      assert.equal(toBN(userInfo.aggregatedReward).toString(), 0);
      assert.equal(toBN(userInfo.lastSupplyCumulativeSum).toString(), toBN(poolInfo.supplyCumulativeSum).toString());
      assert.equal(toBN(userInfo.lastBorrowCumulativeSum).toString(), toBN(poolInfo.borrowCumulativeSum));

      const expectedRewards = oneToken.times(1002.2);
      assert.closeTo(
        toBN(await governanceToken.balanceOf(USER1)).toNumber(),
        expectedRewards.toNumber(),
        oneToken.idiv(100).toNumber()
      );
    });

    it("should claim correct rewards from several pools with deposits and borrows", async () => {
      for (let i = 0; i < keys.length; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
        await defiCore.borrow(keys[i], borrowAmount, { from: USER1 });
      }

      await advanceBlocks(500);

      for (let i = 0; i < keys.length; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
        await defiCore.borrow(keys[i], borrowAmount, { from: USER1 });
      }

      await defiCore.claimDistributionRewards({ from: USER1 });

      const expectedRewards = oneToken.times(4066.8);
      assert.closeTo(
        toBN(await governanceToken.balanceOf(USER1)).toNumber(),
        expectedRewards.toNumber(),
        oneToken.idiv(100).toNumber()
      );
    });

    it("should get exception if nothing to claim", async () => {
      const reason = "DefiCore: Nothing to claim.";

      await truffleAssert.reverts(defiCore.claimDistributionRewards({ from: USER1 }), reason);
    });
  });

  describe("claimPoolDistributionRewards", async () => {
    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(50);

    it("should claim correct rewards", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await advanceBlocks(499);

      const expectedRewards = oneToken.times(100);

      await defiCore.claimPoolDistributionRewards(daiKey, { from: USER1 });

      const userInfo = await rewardsDistribution.usersDistributionInfo(daiKey, USER1);

      assert.equal(toBN(userInfo.aggregatedReward).toString(), 0);
      assert.equal(
        toBN(userInfo.lastSupplyCumulativeSum).toString(),
        toBN((await rewardsDistribution.liquidityPoolsInfo(daiKey)).supplyCumulativeSum).toString()
      );
      assert.equal(toBN(userInfo.lastBorrowCumulativeSum).toString(), 0);

      assert.equal(toBN(await governanceToken.balanceOf(USER1)).toString(), expectedRewards.toString());
    });

    it("should claim correct rewards after deposit and borrow", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrow(daiKey, borrowAmount, { from: USER1 });

      await advanceBlocks(500);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrow(daiKey, borrowAmount.idiv(2), { from: USER1 });

      await defiCore.claimPoolDistributionRewards(daiKey, { from: USER1 });

      const userInfo = await rewardsDistribution.usersDistributionInfo(daiKey, USER1);
      const poolInfo = await rewardsDistribution.liquidityPoolsInfo(daiKey);

      assert.equal(toBN(userInfo.aggregatedReward).toString(), 0);
      assert.equal(toBN(userInfo.lastSupplyCumulativeSum).toString(), toBN(poolInfo.supplyCumulativeSum).toString());
      assert.equal(toBN(userInfo.lastBorrowCumulativeSum).toString(), toBN(poolInfo.borrowCumulativeSum));

      const expectedRewards = oneToken.times(1006.2);
      assert.equal(toBN(await governanceToken.balanceOf(USER1)).toString(), expectedRewards.toString());
    });

    it("should get exception if user not have rewards", async () => {
      const reason = "User have not rewards from this pool.";
      await truffleAssert.reverts(defiCore.claimPoolDistributionRewards(daiKey, { from: USER2 }), reason);
    });
  });

  describe("getUserDistributionRewards", async () => {
    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(50);

    it("should get correct rewards", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await advanceBlocks(499);

      const expectedRewards = oneToken.times(100);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      const rewardInfo = await defiCore.getUserDistributionRewards(USER1);

      assert.equal(toBN(rewardInfo.distributionReward).toString(), expectedRewards.toString());
      assert.equal(toBN(rewardInfo.userBalance).toString(), 0);
    });

    it("should get correct rewards after claim", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await advanceBlocks(499);

      const expectedRewards = oneToken.times(100.1);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });

      await defiCore.claimPoolDistributionRewards(daiKey, { from: USER1 });

      let rewardInfo = await defiCore.getUserDistributionRewards(USER1);

      assert.equal(toBN(await governanceToken.balanceOf(USER1)).toString(), toBN(rewardInfo.userBalance).toString());
      assert.equal(toBN(rewardInfo.userBalance).toString(), expectedRewards.toString());

      assert.equal(toBN(rewardInfo.distributionReward).toString(), 0);
    });

    it("should get correct rewards after deposit and borrow", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrow(daiKey, borrowAmount, { from: USER1 });

      await advanceBlocks(500);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrow(daiKey, borrowAmount.idiv(2), { from: USER1 });

      const rewardInfo = await defiCore.getUserDistributionRewards(USER1);
      const expectedReward = oneToken.times(1004.2);

      assert.equal(toBN(rewardInfo.distributionReward).toString(), expectedReward.toString());
      assert.equal(toBN(rewardInfo.userBalance).toString(), 0);
    });
  });

  describe("approveToDelegateBorrow", async () => {
    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(50);

    it("should add approve borrow delegatee to the system", async () => {
      amountToBorrow = oneToken.times(100);

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

  describe("delegateBorrow", async () => {
    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(50);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.approveToDelegateBorrow(wEthKey, borrowAmount, USER2, 0, { from: USER1 });
    });

    it("should correctly borrow tokens", async () => {
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await wEthPool.updateCompoundRate();
      const txReceipt = await defiCore.delegateBorrow(wEthKey, borrowAmount, USER1, { from: USER2 });

      assert.equal(txReceipt.receipt.logs.length, 1);

      assert.equal(txReceipt.receipt.logs[0].event, "Borrowed");
      assert.equal(txReceipt.receipt.logs[0].args._userAddr, USER1);
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
      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), [wEthKey]));
    });

    it("should get exception if user is not a part of delegation", async () => {
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await wEthPool.updateCompoundRate();

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

  describe("delegateRepayBorrow", async () => {
    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(75);
    const repayBorrowAmount = oneToken.times(50);
    const startTime = toBN(100000);

    beforeEach("setup", async () => {
      await setCurrentTime(startTime);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.approveToDelegateBorrow(wEthKey, borrowAmount, USER2, 0, { from: USER1 });
      await wEthPool.updateCompoundRate();
      await defiCore.delegateBorrow(wEthKey, borrowAmount, USER1, { from: USER2 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), [wEthKey]));
    });

    it("should correctly repay borrow", async () => {
      await setCurrentTime(startTime.times(100));

      const currentNormalizedAmount = toBN((await wEthPool.borrowInfos(USER1)).normalizedAmount);

      await wEthPool.updateCompoundRate();
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
        toBN((await wEthPool.borrowInfos(USER1)).normalizedAmount).toString(),
        expectedNormalizedAmount.toString()
      );
      assert.equal(
        toBN(await wEthPool.aggregatedNormalizedBorrowedAmount()).toString(),
        expectedNormalizedAmount.toString()
      );
      assert.equal(toBN(await tokens[2].balanceOf(USER2)).toString(), tokensAmount.minus(borrowAmount).toString());

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), [wEthKey]));
    });

    it("should fully repay borrow and remove assets from the list", async () => {
      await setCurrentTime(startTime.times(100));

      await wEthPool.updateCompoundRate();
      await await defiCore.delegateRepayBorrow(wEthKey, borrowAmount.times(2), USER1, { from: USER2 });

      assert.equal(toBN((await wEthPool.borrowInfos(USER1)).normalizedAmount).toString(), 0);
      assert.equal(toBN(await wEthPool.aggregatedNormalizedBorrowedAmount()).toString(), 0);

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), []));
    });

    it("should get exception if repay borrow amount is zero", async () => {
      const reason = "DefiCore: Zero amount cannot be repaid.";
      await truffleAssert.reverts(defiCore.delegateRepayBorrow(wEthKey, 0, USER1, { from: USER2 }), reason);
    });
  });

  describe("borrowFor", async () => {
    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(50);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
    });

    it("should correctly borrow tokens", async () => {
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await wEthPool.updateCompoundRate();
      const txReceipt = await defiCore.borrowFor(wEthKey, borrowAmount, USER2, { from: USER1 });

      assert.equal(txReceipt.receipt.logs.length, 1);

      assert.equal(txReceipt.receipt.logs[0].event, "Borrowed");
      assert.equal(txReceipt.receipt.logs[0].args._userAddr, USER1);
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
      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), [wEthKey]));
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

  describe("getUserLiquidationInfo", async () => {
    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(50);
    const chainlinkPriceDecimals = toBN(10).pow(8);

    beforeEach("setup", async () => {
      await daiChainlinkOracle.setPrice(toBN(20).times(chainlinkPriceDecimals));
      await wEthChainlinkOracle.setPrice(toBN(30).times(chainlinkPriceDecimals));
    });

    it("should return correct user liquidation info if supply amount less than liquidation amount", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.idiv(10), { from: USER1 });

      await defiCore.borrow(daiKey, borrowAmount, { from: USER1 });

      const result = await defiCore.getUserLiquidationInfo(USER1, daiKey, wEthKey);

      assert.equal(toBN(result.borrowAssetPrice).toString(), chainlinkPriceDecimals.times(20).toString());
      assert.equal(toBN(result.receiveAssetPrice).toString(), chainlinkPriceDecimals.times(30).toString());
      assert.equal(
        toBN(result.bonusReceiveAssetPrice).toString(),
        chainlinkPriceDecimals.times(30).times(0.92).toString()
      );

      assert.equal(toBN(result.borrowedAmount).toString(), borrowAmount.toString());
      assert.equal(toBN(result.supplyAmount).toString(), liquidityAmount.idiv(10).toString());

      const expectedMaxQuantity = toBN(oneToken.times(13.8));
      assert.equal(toBN(result.maxQuantity).toString(), expectedMaxQuantity.toString());
    });

    it("should return correct user liquidation info that equals to borrow amount", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.borrow(daiKey, borrowAmount.idiv(2), { from: USER1 });
      await defiCore.borrow(wEthKey, borrowAmount.idiv(5), { from: USER1 });

      const result = await defiCore.getUserLiquidationInfo(USER1, wEthKey, daiKey);

      assert.equal(toBN(result.borrowAssetPrice).toString(), chainlinkPriceDecimals.times(30).toString());
      assert.equal(toBN(result.receiveAssetPrice).toString(), chainlinkPriceDecimals.times(20).toString());
      assert.equal(
        toBN(result.bonusReceiveAssetPrice).toString(),
        chainlinkPriceDecimals.times(20).times(0.92).toString()
      );

      assert.equal(toBN(result.borrowedAmount).toString(), borrowAmount.idiv(5).toString());
      assert.equal(toBN(result.supplyAmount).toString(), liquidityAmount.toString());

      const expectedMaxQuantity = toBN(oneToken.times(10));
      assert.equal(toBN(result.maxQuantity).toString(), expectedMaxQuantity.toString());
    });

    it("should return correct user liquidation info equals to max liquidation part", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.borrow(daiKey, borrowAmount.idiv(2), { from: USER1 });
      await defiCore.borrow(wEthKey, borrowAmount.idiv(2), { from: USER1 });

      const result = await defiCore.getUserLiquidationInfo(USER1, wEthKey, daiKey);

      assert.equal(toBN(result.borrowAssetPrice).toString(), chainlinkPriceDecimals.times(30).toString());
      assert.equal(toBN(result.receiveAssetPrice).toString(), chainlinkPriceDecimals.times(20).toString());
      assert.equal(
        toBN(result.bonusReceiveAssetPrice).toString(),
        chainlinkPriceDecimals.times(20).times(0.92).toString()
      );

      assert.equal(toBN(result.borrowedAmount).toString(), borrowAmount.idiv(2).toString());
      assert.equal(toBN(result.supplyAmount).toString(), liquidityAmount.toString());

      const expectedMaxQuantity = toBN("20833333333333333333");
      assert.equal(toBN(result.maxQuantity).toString(), expectedMaxQuantity.toString());
    });
  });

  describe("getLiquidiationInfo", async () => {
    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(50);

    it("should return correct liquidation info", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.borrow(daiKey, borrowAmount.idiv(2), { from: USER1 });
      await defiCore.borrow(wEthKey, borrowAmount.idiv(2), { from: USER1 });
      await defiCore.borrow(wEthKey, borrowAmount.idiv(2), { from: USER2 });

      const result = await defiCore.getLiquidiationInfo([USER1, USER2]);

      assert.isTrue(deepCompareKeys(result[0].borrowAssetKeys, [daiKey, wEthKey]));
      assert.isTrue(deepCompareKeys(result[0].supplyAssetKeys, [daiKey, wEthKey]));
      assert.equal(toBN(result[0].totalBorrowedAmount).toString(), toBN(5000).times(priceDecimals).toString());

      assert.isTrue(deepCompareKeys(result[1].borrowAssetKeys, [wEthKey]));
      assert.isTrue(deepCompareKeys(result[1].supplyAssetKeys, [wEthKey]));
      assert.equal(toBN(result[1].totalBorrowedAmount).toString(), toBN(2500).times(priceDecimals).toString());
    });
  });

  describe("getMaxToWithdraw - withdrawLiquidity - exchangeRate integration tests", async () => {
    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(30);

    it("should correctly change exchange rate after withdraw and repay", async () => {
      await setCurrentTime(1);
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: OWNER });

      await defiCore.borrow(daiKey, borrowAmount, { from: OWNER });

      await setCurrentTime(10000000);

      await daiPool.updateCompoundRate();

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
      await setCurrentTime(1);
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: OWNER });

      await defiCore.borrow(daiKey, borrowAmount, { from: OWNER });

      await setCurrentTime(10000000);

      await daiPool.updateCompoundRate();
      await defiCore.withdrawLiquidity(daiKey, await defiCore.getUserLiquidityAmount(USER1, daiKey), true, {
        from: USER1,
      });
      assert.equal(toBN(await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), 0);

      await defiCore.repayBorrow(daiKey, borrowAmount.idiv(2), false, { from: OWNER });

      await setCurrentTime(100000000);

      await daiPool.updateCompoundRate();
      await defiCore.withdrawLiquidity(daiKey, await defiCore.getMaxToWithdraw(USER2, daiKey), true, { from: USER2 });

      assert.equal(toBN(await defiCore.getMaxToWithdraw(USER2, daiKey)).toString(), 0);
      assert.closeTo(
        toBN(await daiPool.getBorrowPercentage()).toNumber(),
        maxWithdrawUR.toNumber(),
        onePercent.idiv(100).toNumber()
      );
    });
  });

  describe("getMaxToWithdraw", async () => {
    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(50);

    it("should return correct value if BA = 0", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await setCurrentTime(100);

      assert.equal(toBN(await defiCore.getMaxToWithdraw(USER1, daiKey)).toString(), oneToken.times(100).toString());
    });

    it("should return correct value if BA > 0", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount.idiv(2), { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.idiv(10), { from: USER1 });

      await defiCore.borrow(wEthKey, borrowAmount.idiv(2), { from: USER1 });

      await setCurrentTime(100);

      assert.equal(toBN(await defiCore.getMaxToWithdraw(USER1, daiKey)).toString(), oneToken.times(28.75).toString());
      assert.equal(toBN(await defiCore.getMaxToWithdraw(USER1, wEthKey)).toString(), oneToken.times(10).toString());
    });

    it("should return correct value if AL = 0", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.borrow(wEthKey, oneToken.times(80), { from: USER1 });

      await setCurrentTime(100);

      assert.equal(toBN(await defiCore.getMaxToWithdraw(USER1, daiKey)).toString(), 0);
    });

    it("should return correct value if BA > 0", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrow(daiKey, borrowAmount, { from: USER1 });

      await setCurrentTime(1000000);

      await defiCore.repayBorrow(daiKey, 0, true, { from: USER1 });

      await defiCore.withdrawLiquidity(daiKey, toBN(await defiCore.getMaxToWithdraw(USER1, daiKey)), true, {
        from: USER1,
      });

      assert.equal(toBN(await defiCore.getUserLiquidityAmount(USER1, daiKey)).toString(), 0);
    });
  });

  describe("getMaxToBorrow", async () => {
    const liquidityAmount = oneToken.times(100);

    it("should return correct value if available liquidity less than pool capacity", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal(toBN(await defiCore.getMaxToBorrow(USER1, daiKey)).toString(), oneToken.times(80).toString());
    });

    it("should return correct value if available liquidity greater than pool capacity", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      assert.equal(toBN(await defiCore.getMaxToBorrow(USER1, daiKey)).toString(), oneToken.times(95).toString());
    });

    it("should return correct value UR = max UR", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(3), { from: USER2 });
      await defiCore.borrow(daiKey, oneToken.times(95), { from: USER2 });

      assert.equal(toBN(await defiCore.getMaxToBorrow(USER1, daiKey)).toString(), 0);
    });

    it("should correct borrow maximum", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.borrow(daiKey, await defiCore.getMaxToBorrow(USER1, daiKey), { from: USER1 });

      assert.equal(toBN((await defiCore.getAvailableLiquidity(USER1))[0]).toString(), 0);
    });
  });

  describe("getMaxToRepay", async () => {
    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(50);

    it("should return correct value if BA = 0", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal(toBN(await defiCore.getMaxToRepay(USER1, daiKey)).toString(), 0);
    });

    it("should return correct value if available liquidity greater than pool capacity", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrow(daiKey, borrowAmount, { from: USER1 });

      await setCurrentTime(100000);

      const currentInterest = toBN(await defiCore.getMaxToRepay(USER1, daiKey)).minus(
        await daiPool.aggregatedBorrowedAmount()
      );

      await defiCore.repayBorrow(daiKey, 0, true, { from: USER1 });

      assert.equal(
        toBN(await daiPool.getAggregatedLiquidityAmount()).toString(),
        liquidityAmount.plus(currentInterest.times(0.85)).toFixed(0, 2)
      );

      assert.equal(
        toBN(await tokens[1].balanceOf(daiPool.address)).toString(),
        liquidityAmount.plus(currentInterest).toString()
      );

      assert.closeTo(
        toBN(await daiPool.totalReserves()).toNumber(),
        toBN(currentInterest.times(0.15).toFixed(0, 2)).toNumber(),
        toBN(10).toNumber()
      );
    });

    it("should correct repay all debt", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrow(daiKey, borrowAmount, { from: USER1 });

      await setCurrentTime(100000);

      await defiCore.repayBorrow(daiKey, 0, true, { from: USER1 });

      assert.equal(toBN(await defiCore.getUserBorrowedAmount(USER1, daiKey)).toString(), 0);
    });
  });
});
