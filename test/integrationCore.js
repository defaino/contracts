const Registry = artifacts.require("Registry");
const AssetParameters = artifacts.require("AssetParameters");
const SystemParameters = artifacts.require("SystemParameters");
const AssetsRegistry = artifacts.require("AssetsRegistry");
const DefiCore = artifacts.require("DefiCore");
const RewardsDistribution = artifacts.require("RewardsDistributionMock");
const LiquidityPool = artifacts.require("LiquidityPool");
const LiquidityPoolAdmin = artifacts.require("LiquidityPoolAdmin");
const LiquidityPoolRegistry = artifacts.require("LiquidityPoolRegistry");
const LiquidityPoolFactory = artifacts.require("LiquidityPoolFactory");
const PriceManager = artifacts.require("PriceManagerMock");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const GovernanceToken = artifacts.require("GovernanceToken");

const IntegrationCore = artifacts.require("IntegrationCore");
const BorrowerRouter = artifacts.require("BorrowerRouterMock");
const BorrowerRouterRegistry = artifacts.require("BorrowerRouterRegistry");
const BorrowerRouterFactory = artifacts.require("BorrowerRouterFactory");

const MockERC20 = artifacts.require("MockERC20");
const ChainlinkOracleMock = artifacts.require("ChainlinkOracleMock");
const YearnVaultMock = artifacts.require("YearnVaultMock");
const VaultRegistryMock = artifacts.require("VaultRegistryMock");
const CurvePoolMock = artifacts.require("CurvePoolMock");
const CurveZapMock = artifacts.require("CurveZapMock");
const CurveRegistryMock = artifacts.require("CurveRegistryMock");

const { toBN, oneToken, getOnePercent } = require("../scripts/globals");
const { getInterestRateLibraryData } = require("../migrations/helpers/deployHelper");
const { advanceBlockAtTime, advanceBlocks } = require("./helpers/ganacheTimeTraveler");
const { toBytes, compareKeys, deepCompareKeys } = require("./helpers/bytesCompareLibrary");
const {
  convertToUSD,
  convertFromUSD,
  convertToBorrowLimit,
  convertFromBorrowLimit,
  mintAndApprove,
  saveCoins,
} = require("./helpers/helperFunctions");

const Reverter = require("./helpers/reverter");
const { assert } = require("chai");

const setCurrentTime = advanceBlockAtTime;
const truffleAssert = require("truffle-assertions");

contract("IntegrationCore", async (accounts) => {
  const reverter = new Reverter(web3);

  const ADDRESS_NULL = "0x0000000000000000000000000000000000000000";

  const OWNER = accounts[0];
  const USER1 = accounts[1];
  const USER2 = accounts[2];
  const NOTHING = accounts[9];

  let registry;
  let assetParameters;
  let liquidityPoolRegistry;
  let assetsRegistry;
  let defiCore;
  let rewardsDistribution;
  let priceManager;
  let integrationCore;
  let borrowerRouterRegistry;

  let basePool;
  let baseToken;

  let curveRegistry;
  let vaultRegistry;
  let depositContract;

  let user1BorrowerRouter;

  let daiPool;
  let usdcPool;
  let wEthPool;
  let xrpPool;

  let usdcPriceOracle;

  const numberOfBaseCoins = 3;
  const baseCoins = [];
  const lpTokens = [];

  const tokens = [];

  const onePercent = getOnePercent();
  const decimal = onePercent.times(100);
  const tokensAmount = oneToken(18).times(100000);
  const standardColRatio = decimal.times("1.25");
  const integrationColRatio = decimal.times("1.1");
  const reserveFactor = onePercent.times("15");

  const firstSlope = onePercent.times(4);
  const secondSlope = decimal;
  const utilizationBreakingPoint = onePercent.times(80);
  const maxUR = onePercent.times(95);
  const maxWithdrawUR = onePercent.times(94);
  const liquidationDiscount = onePercent.times(8);
  const liquidationBoundary = onePercent.times(50);
  const optimizationPercentage = onePercent.times(20);
  const optimizationReward = onePercent;

  const priceDecimals = toBN(10).pow(8);
  const chainlinkPriceDecimals = toBN(8);

  const minSupplyDistributionPart = onePercent.times(10);
  const minBorrowDistributionPart = onePercent.times(10);

  const daiKey = toBytes("DAI");
  const usdtKey = toBytes("USDT");
  const usdcKey = toBytes("USDC");
  const wEthKey = toBytes("WETH");
  const xrpKey = toBytes("XRP");
  const governanceTokenKey = toBytes("NDG");

  async function deployTokens(array, symbols) {
    for (let i = 0; i < symbols.length; i++) {
      const token = await MockERC20.new("Mock" + symbols[i], symbols[i]);
      await token.mintArbitraryBatch([OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);

      array.push(token);
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
    await assetParameters.setupIntegrationColRatio(assetKey, integrationColRatio);
    await assetParameters.setupReserveFactor(assetKey, reserveFactor);

    await assetParameters.setupAllowForIntegration(assetKey, isCollateral);
    await assetParameters.setupOptimizationReward(assetKey, optimizationReward);

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

    await assetParameters.setupAllowForIntegration(governanceTokenKey, false);
    await assetParameters.setupOptimizationReward(governanceTokenKey, optimizationReward);

    await priceManager.setPrice(governanceTokenKey, 10);
  }

  async function deployMetaPool() {
    const currentUnderlyingCoins = [];
    const currentCoins = [];

    const metaToken = await MockERC20.new("Test Meta", "TM");
    lpTokens.push(metaToken.address);

    await saveCoins(currentCoins, 1);
    currentCoins.push(baseToken.address);

    currentUnderlyingCoins.push(currentCoins[0]);
    for (let i = 0; i < numberOfBaseCoins; i++) {
      currentUnderlyingCoins.push(baseCoins[i]);
    }

    const metaPool = await CurvePoolMock.new(true, metaToken.address, currentCoins, currentUnderlyingCoins);

    await curveRegistry.addPool(metaPool.address, metaToken.address);

    await mintAndApprove(
      depositContract.address,
      currentUnderlyingCoins,
      [OWNER, USER1, USER2],
      [tokensAmount, tokensAmount, tokensAmount]
    );

    return currentUnderlyingCoins;
  }

  async function deployVaults(tokensAddr) {
    for (const tokenAddr of tokensAddr) {
      const newVault = await YearnVaultMock.new("Test Vault", "TV", tokenAddr);

      await vaultRegistry.addVault(tokenAddr, newVault.address);
    }
  }

  before("setup", async () => {
    const governanceToken = await GovernanceToken.new(OWNER);
    const interestRateLibrary = await InterestRateLibrary.new(
      getInterestRateLibraryData("scripts/InterestRatesExactData.txt"),
      getInterestRateLibraryData("scripts/InterestRatesData.txt")
    );

    registry = await Registry.new();
    const _assetParameters = await AssetParameters.new();
    const _systemParameters = await SystemParameters.new();
    const _assetsRegistry = await AssetsRegistry.new();
    const _defiCore = await DefiCore.new();
    const _rewardsDistribution = await RewardsDistribution.new();
    const _liquidityPoolImpl = await LiquidityPool.new();
    const _liquidityPoolAdmin = await LiquidityPoolAdmin.new();
    const _liquidityPoolRegistry = await LiquidityPoolRegistry.new();
    const _liquidityPoolFactory = await LiquidityPoolFactory.new();
    const _priceManager = await PriceManager.new();

    const _integrationCore = await IntegrationCore.new();
    const _borrowerRouterImpl = await BorrowerRouter.new();
    const _borrowerRouterFactory = await BorrowerRouterFactory.new();
    const _borrowerRouterRegistry = await BorrowerRouterRegistry.new();

    await registry.addProxyContract(await registry.ASSET_PARAMETERS_NAME(), _assetParameters.address);
    await registry.addProxyContract(await registry.SYSTEM_PARAMETERS_NAME(), _systemParameters.address);
    await registry.addProxyContract(await registry.ASSETS_REGISTRY_NAME(), _assetsRegistry.address);
    await registry.addProxyContract(await registry.DEFI_CORE_NAME(), _defiCore.address);
    await registry.addProxyContract(await registry.REWARDS_DISTRIBUTION_NAME(), _rewardsDistribution.address);
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_ADMIN_NAME(), _liquidityPoolAdmin.address);
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_REGISTRY_NAME(), _liquidityPoolRegistry.address);
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_FACTORY_NAME(), _liquidityPoolFactory.address);
    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), _priceManager.address);

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
    borrowerRouterRegistry = await BorrowerRouterRegistry.at(await registry.getBorrowerRouterRegistryContract());
    integrationCore = await IntegrationCore.at(await registry.getIntegrationCoreContract());
    liquidityPoolRegistry = await LiquidityPoolRegistry.at(await registry.getLiquidityPoolRegistryContract());

    const systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());
    const liquidityPoolAdmin = await LiquidityPoolAdmin.at(await registry.getLiquidityPoolAdminContract());

    await registry.injectDependencies(await registry.ASSET_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.ASSETS_REGISTRY_NAME());
    await registry.injectDependencies(await registry.DEFI_CORE_NAME());
    await registry.injectDependencies(await registry.REWARDS_DISTRIBUTION_NAME());
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_ADMIN_NAME());
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_FACTORY_NAME());
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_REGISTRY_NAME());
    await registry.injectDependencies(await registry.PRICE_MANAGER_NAME());
    await registry.injectDependencies(await registry.INTEGRATION_CORE_NAME());
    await registry.injectDependencies(await registry.BORROWER_ROUTER_FACTORY_NAME());
    await registry.injectDependencies(await registry.BORROWER_ROUTER_REGISTRY_NAME());

    await deployTokens(tokens, ["DAI", "USDT", "USDC", "WETH", "XRP"]);
    tokens.push(governanceToken.address);

    await assetParameters.assetParametersInitialize();
    await systemParameters.systemParametersInitialize();
    await rewardsDistribution.rewardsDistributionInitialize();
    await liquidityPoolRegistry.liquidityPoolRegistryInitialize();
    await liquidityPoolAdmin.liquidityPoolAdminInitialize(_liquidityPoolImpl.address);
    await priceManager.priceManagerInitialize(daiKey, tokens[0].address);
    await borrowerRouterRegistry.borrowerRouterRegistryInitialize(_borrowerRouterImpl.address);

    await setCurrentTime(1);

    await deployGovernancePool(governanceToken.address, await governanceToken.symbol());

    await createLiquidityPool(daiKey, tokens[0], "DAI", true);
    await createLiquidityPool(usdtKey, tokens[1], "USDT", false);
    usdcPriceOracle = await createLiquidityPool(usdcKey, tokens[2], "USDC", true);
    await createLiquidityPool(wEthKey, tokens[3], "WETH", true);
    await createLiquidityPool(xrpKey, tokens[4], "XRP", true);

    daiPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(daiKey));
    xrpPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(xrpKey));
    usdcPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(usdcKey));

    await systemParameters.setupLiquidationBoundary(liquidationBoundary);
    await systemParameters.setupOptimizationPercentage(optimizationPercentage);

    await rewardsDistribution.setupRewardsPerBlockBatch(
      [daiKey, usdcKey, usdtKey, wEthKey, xrpKey, governanceTokenKey],
      [oneToken(18), oneToken(18).times(2), oneToken(18).times(3), oneToken(18), oneToken(18), oneToken(18).times(2)]
    );

    await governanceToken.transfer(defiCore.address, tokensAmount.times(10));

    curveRegistry = await CurveRegistryMock.new();
    vaultRegistry = await VaultRegistryMock.new();

    baseToken = await MockERC20.new("Test 3Crv", "T3Crv");

    lpTokens.push(baseToken.address);

    for (let i = 0; i < numberOfBaseCoins; i++) {
      baseCoins.push(tokens[i].address);
    }

    basePool = await CurvePoolMock.new(false, baseToken.address, baseCoins, baseCoins);
    await curveRegistry.addPool(basePool.address, baseToken.address);

    depositContract = await CurveZapMock.new(basePool.address, baseToken.address);

    await mintAndApprove(
      depositContract.address,
      baseCoins,
      [OWNER, USER1, USER2],
      [tokensAmount, tokensAmount, tokensAmount]
    );

    await systemParameters.setupCurveRegistry(curveRegistry.address);
    await systemParameters.setupYEarnRegistry(vaultRegistry.address);
    await systemParameters.setupCurveZap(depositContract.address);

    await deployMetaPool();
    await deployMetaPool();
    await deployMetaPool();

    await deployVaults(baseCoins);
    await deployVaults(lpTokens);

    await integrationCore.deployBorrowerRouter({ from: USER1 });

    user1BorrowerRouter = await BorrowerRouter.at(await borrowerRouterRegistry.borrowerRouters(USER1));

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("deployBorrowerRouter", async () => {
    it("should correctly create new borrower router", async () => {
      assert.isFalse(await borrowerRouterRegistry.isBorrowerRouterExists(USER2));

      await integrationCore.deployBorrowerRouter({ from: USER2 });

      assert.isTrue(await borrowerRouterRegistry.isBorrowerRouterExists(USER2));
    });

    it("should get exception if the borrower router has already been created", async () => {
      const reason = "IntegrationCore: Borrower router already exists.";

      await truffleAssert.reverts(integrationCore.deployBorrowerRouter({ from: USER1 }), reason);
    });
  });

  describe("addLiquidity", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(50);
    const integrationLiquidityAmount = oneToken().times(50);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal(toBN(await daiPool.balanceOf(USER1)).toString(), liquidityAmount.toString());

      const expectedBorrowLimitInUSD = convertToUSD(convertToBorrowLimit(liquidityAmount));

      assert.equal(
        toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(),
        expectedBorrowLimitInUSD.toString()
      );

      await daiPool.approve(integrationCore.address, integrationLiquidityAmount, { from: USER1 });
    });

    it("should correctly add liquidity", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await defiCore.borrow(daiKey, borrowAmount, { from: USER2 });

      await setCurrentTime(10000);

      await defiCore.updateCompoundRate(daiKey);

      assert.isTrue(toBN(await daiPool.exchangeRate()).gt(decimal));

      assert.equal(toBN(await integrationCore.getCurrentBorrowLimitInUSD(USER1)).toString(), 0);

      const txReceipt = await integrationCore.addLiquidity(daiKey, integrationLiquidityAmount, { from: USER1 });

      const expectedLPAmount = toBN(await daiPool.convertAssetToNTokens(integrationLiquidityAmount));

      assert.equal(toBN(await daiPool.balanceOf(user1BorrowerRouter.address)).toString(), expectedLPAmount.toString());

      assert.equal(txReceipt.receipt.logs[0].event, "LiquidityAdded");
      assert.equal(txReceipt.receipt.logs[0].args._userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, daiKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args._liquidityAmount).toString(), integrationLiquidityAmount);

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserIntegrationSupplyAssets(USER1), [daiKey]));
    });

    it("should correctly update cumulative sums", async () => {
      await advanceBlocks(49);

      let expectedReward = oneToken().times(5);
      assert.equal(
        toBN(await rewardsDistribution.getUserReward(daiKey, USER1, daiPool.address)).toString(),
        expectedReward.toString()
      );

      await integrationCore.addLiquidity(daiKey, integrationLiquidityAmount, { from: USER1 });

      await advanceBlocks(49);

      expectedReward = oneToken().times(10);
      assert.equal(
        toBN(await rewardsDistribution.getUserReward(daiKey, USER1, daiPool.address)).toString(),
        expectedReward.toString()
      );
    });

    it("should get exception if borrow limit after deposit greater than 100%", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await defiCore.borrow(daiKey, borrowAmount, { from: USER1 });

      assert.equal(
        toBN(await defiCore.getTotalBorrowBalanceInUSD(USER1)).toString(),
        convertToUSD(borrowAmount).toString()
      );

      const reason = "IntegrationCore: Borrow limit used greater than 100%.";

      await truffleAssert.reverts(
        integrationCore.addLiquidity(daiKey, integrationLiquidityAmount, { from: USER1 }),
        reason
      );
    });

    it("should get exception if asset completely disabled as collateral", async () => {
      const reason = "IntegrationCore: It is impossible to lock an asset that cannot be a collateral.";

      await truffleAssert.reverts(
        integrationCore.addLiquidity(usdtKey, integrationLiquidityAmount, { from: USER1 }),
        reason
      );
    });

    it("should get exception if amount equals to zero", async () => {
      const reason = "IntegrationCore: Liquidity amount must be greater than zero.";

      await truffleAssert.reverts(integrationCore.addLiquidity(daiKey, 0, { from: USER1 }), reason);
    });
  });

  describe("withdrawLiquidity", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(50);
    const withdrawAmount = oneToken().times(50);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal(toBN(await daiPool.balanceOf(USER1)).toString(), liquidityAmount.toString());

      const expectedBorrowLimitInUSD = convertToUSD(convertToBorrowLimit(liquidityAmount));

      assert.equal(
        toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).toString(),
        expectedBorrowLimitInUSD.toString()
      );

      await daiPool.approve(integrationCore.address, liquidityAmount, { from: USER1 });
      await integrationCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal(
        toBN(await integrationCore.getTotalSupplyBalanceInUSD(USER1)).toString(),
        convertToUSD(liquidityAmount).toString()
      );
    });

    it("should correctly withdraw part of liquidity from integration core", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await defiCore.borrow(daiKey, borrowAmount, { from: USER2 });

      await setCurrentTime(10000);

      await defiCore.updateCompoundRate(daiKey);

      assert.isTrue(toBN(await daiPool.exchangeRate()).gt(decimal));

      assert.equal(toBN(await daiPool.balanceOf(USER1)).toString(), 0);

      const txReceipt = await integrationCore.withdrawLiquidity(daiKey, withdrawAmount, false, { from: USER1 });

      const expectedLPAmount = toBN(await daiPool.convertAssetToNTokens(withdrawAmount));

      assert.equal(toBN(await daiPool.balanceOf(USER1)).toString(), expectedLPAmount.toString());

      assert.equal(txReceipt.receipt.logs[0].event, "LiquidityWithdrawn");
      assert.equal(txReceipt.receipt.logs[0].args._userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, daiKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args._liquidityAmount).toString(), withdrawAmount.toString());

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserIntegrationSupplyAssets(USER1), [daiKey]));
    });

    it("should correctly withdraw all", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await defiCore.borrow(daiKey, borrowAmount, { from: USER2 });

      await setCurrentTime(10000);

      await defiCore.updateCompoundRate(daiKey);

      assert.isTrue(toBN(await daiPool.exchangeRate()).gt(decimal));

      assert.equal(toBN(await daiPool.balanceOf(USER1)).toString(), 0);

      await integrationCore.withdrawLiquidity(daiKey, withdrawAmount, true, { from: USER1 });

      assert.equal(toBN(await daiPool.balanceOf(USER1)).toString(), liquidityAmount.toString());

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserIntegrationSupplyAssets(USER1), []));
    });

    it("should get exception if borrow limit used greater than 100%", async () => {
      await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 });

      const reason = "IntegrationCore: Borrow limit used greater than 100%.";

      await truffleAssert.reverts(
        integrationCore.withdrawLiquidity(daiKey, withdrawAmount, false, { from: USER1 }),
        reason
      );
    });

    it("should get exception if try to withdraw zero amount", async () => {
      const reason = "IntegrationCore: Liquidity amount must be greater than zero.";

      await truffleAssert.reverts(integrationCore.withdrawLiquidity(daiKey, 0, false, { from: USER1 }), reason);
    });
  });

  describe("borrow", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(50);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await daiPool.approve(integrationCore.address, liquidityAmount, { from: USER1 });
      await integrationCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
    });

    it("should correctly borrow", async () => {
      const txReceipt = await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 });

      assert.isTrue(await integrationCore.isBorrowExists(USER1, daiKey));
      assert.equal(
        toBN(await integrationCore.getTotalBorrowBalanceInUSD(USER1)).toString(),
        convertToUSD(borrowAmount).toString()
      );

      assert.equal(
        toBN(await integrationCore.getUserBorrowedAmount(USER1, daiKey)).toString(),
        borrowAmount.toString()
      );

      assert.equal(txReceipt.receipt.logs[0].event, "Borrowed");
      assert.equal(txReceipt.receipt.logs[0].args._borrower, USER1);
      assert.equal(txReceipt.receipt.logs[0].args._recipient, user1BorrowerRouter.address);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, daiKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args._borrowedAmount).toString(), borrowAmount.toString());

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserIntegrationBorrowAssets(USER1), [daiKey]));
    });

    it("should get exception if borrow limit used greater than 100%", async () => {
      const reason = "IntegrationCore: Not enough available liquidity.";

      await truffleAssert.reverts(
        integrationCore.borrow(daiKey, baseToken.address, liquidityAmount.plus(1), { from: USER1 }),
        reason
      );
    });

    it("should get exception if pool is disallow for integration", async () => {
      await assetParameters.setupAllowForIntegration(daiKey, false);

      const reason = "IntegrationCore: Asset not allowed for integration.";

      await truffleAssert.reverts(
        integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 }),
        reason
      );
    });

    it("should get exception if pool is frozen", async () => {
      await assetParameters.freeze(daiKey);

      const reason = "IntegrationCore: Pool is freeze for borrow operations.";

      await truffleAssert.reverts(
        integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 }),
        reason
      );
    });

    it("should get exception if amount equals to zero", async () => {
      const reason = "IntegrationCore: Borrow amount must be greater than zero.";

      await truffleAssert.reverts(integrationCore.borrow(daiKey, baseToken.address, 0, { from: USER1 }), reason);
    });
  });

  describe("repayBorrow", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(70);
    const repayAmount = oneToken().times(50);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await daiPool.approve(integrationCore.address, liquidityAmount, { from: USER1 });
      await integrationCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 });
    });

    it("should correctly repay part of borrow", async () => {
      assert.equal(
        toBN(await integrationCore.getTotalBorrowBalanceInUSD(USER1)).toString(),
        convertToUSD(borrowAmount).toString()
      );

      assert.equal(
        toBN(await tokens[0].balanceOf(daiPool.address)).toString(),
        liquidityAmount.minus(borrowAmount).toString()
      );

      const currentRate = await daiPool.getNewCompoundRate();

      const txReceipt = await integrationCore.repayBorrow(daiKey, repayAmount, false, { from: USER1 });

      const repayNormalizedAmount = repayAmount.times(decimal).idiv(currentRate);
      const expectedAmount = borrowAmount.minus(repayNormalizedAmount).times(currentRate).idiv(decimal);

      assert.equal(
        toBN(await tokens[0].balanceOf(daiPool.address)).toString(),
        liquidityAmount.minus(borrowAmount).plus(repayAmount).toString()
      );

      assert.closeTo(
        toBN(await integrationCore.getTotalBorrowBalanceInUSD(USER1)).toNumber(),
        convertToUSD(expectedAmount).toNumber(),
        oneToken().idiv(1000).toNumber()
      );
      assert.closeTo(
        toBN(await integrationCore.getUserBorrowedAmount(USER1, daiKey)).toNumber(),
        expectedAmount.toNumber(),
        oneToken().idiv(1000).toNumber()
      );

      assert.equal(
        toBN(await user1BorrowerRouter.depositOfAssetInToken(baseToken.address, tokens[0].address)).toString(),
        borrowAmount.toString()
      );

      assert.equal(txReceipt.receipt.logs[0].event, "BorrowRepaid");
      assert.equal(txReceipt.receipt.logs[0].args._userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, daiKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args._repaidAmount).toString(), repayAmount.toString());

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserIntegrationBorrowAssets(USER1), [daiKey]));
    });

    it("should correctly repay all borrow", async () => {
      assert.equal(
        toBN(await integrationCore.getTotalBorrowBalanceInUSD(USER1)).toString(),
        convertToUSD(borrowAmount).toString()
      );
      assert.equal(
        toBN(await tokens[0].balanceOf(daiPool.address)).toString(),
        liquidityAmount.minus(borrowAmount).toString()
      );

      const currentRate = await daiPool.getNewCompoundRate();
      const poolBalanceBefore = toBN(await tokens[0].balanceOf(daiPool.address));

      await integrationCore.repayBorrow(daiKey, 0, true, { from: USER1 });

      const poolBalanceAfter = toBN(await tokens[0].balanceOf(daiPool.address));
      const expectedAmount = borrowAmount.times(currentRate).idiv(decimal);

      assert.closeTo(
        poolBalanceAfter.minus(poolBalanceBefore).toNumber(),
        expectedAmount.toNumber(),
        oneToken().idiv(1000).toNumber()
      );

      assert.equal(toBN(await integrationCore.getTotalBorrowBalanceInUSD(USER1)).toString(), 0);
      assert.equal(toBN(await integrationCore.getUserBorrowedAmount(USER1, daiKey)).toString(), 0);

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserIntegrationBorrowAssets(USER1), [daiKey]));
    });

    it("should get exception if amount equals to zero", async () => {
      const reason = "IntegrationCore: Zero amount cannot be repaid.";

      await truffleAssert.reverts(integrationCore.repayBorrow(daiKey, 0, false, { from: USER1 }), reason);
    });
  });

  describe("repayBorrowIntegration", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(70);
    const repayAmount = oneToken().times(50);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await daiPool.approve(integrationCore.address, liquidityAmount, { from: USER1 });
      await integrationCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 });
    });

    it("should correctly repay part of integration borrow", async () => {
      const currentUserBalance = toBN(await tokens[0].balanceOf(USER1));

      const currentRate = await daiPool.getNewCompoundRate();

      const txReceipt = await integrationCore.repayBorrowIntegration(daiKey, baseToken.address, repayAmount, false, {
        from: USER1,
      });

      const repayNormalizedAmount = repayAmount.times(decimal).idiv(currentRate);
      const expectedAmount = borrowAmount.minus(repayNormalizedAmount).times(currentRate).idiv(decimal);

      assert.equal(
        toBN(await tokens[0].balanceOf(daiPool.address)).toString(),
        liquidityAmount.minus(borrowAmount).plus(repayAmount).toString()
      );

      assert.closeTo(
        toBN(await integrationCore.getTotalBorrowBalanceInUSD(USER1)).toNumber(),
        convertToUSD(expectedAmount).toNumber(),
        oneToken().idiv(1000).toNumber()
      );
      assert.closeTo(
        toBN(await integrationCore.getUserBorrowedAmount(USER1, daiKey)).toNumber(),
        expectedAmount.toNumber(),
        oneToken().idiv(1000).toNumber()
      );

      assert.equal(toBN(await tokens[0].balanceOf(USER1)).toString(), currentUserBalance.toString());

      assert.equal(
        toBN(await user1BorrowerRouter.depositOfAssetInToken(baseToken.address, tokens[0].address)).toString(),
        borrowAmount.minus(repayAmount).toString()
      );

      assert.equal(txReceipt.receipt.logs[0].event, "BorrowRepaid");
      assert.equal(txReceipt.receipt.logs[0].args._userAddr, USER1);
      assert.isTrue(compareKeys(txReceipt.receipt.logs[0].args._assetKey, daiKey));
      assert.equal(toBN(txReceipt.receipt.logs[0].args._repaidAmount).toString(), repayAmount.toString());

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserIntegrationBorrowAssets(USER1), [daiKey]));
    });

    it("should correctly repay all integration borrow and check balances", async () => {
      await setCurrentTime(10000);

      const totalDebt = toBN(await integrationCore.getMaxToRepay(USER1, daiKey));

      const userBalanceBefore = toBN(await tokens[0].balanceOf(USER1));
      const poolBalanceBefore = toBN(await tokens[0].balanceOf(daiPool.address));

      await integrationCore.repayBorrowIntegration(daiKey, baseToken.address, 0, true, { from: USER1 });

      const userBalanceAfter = toBN(await tokens[0].balanceOf(USER1));
      const poolBalanceAfter = toBN(await tokens[0].balanceOf(daiPool.address));

      const expectedUserRepayAmount = totalDebt.minus(borrowAmount);

      assert.closeTo(
        userBalanceBefore.minus(userBalanceAfter).toNumber(),
        expectedUserRepayAmount.toNumber(),
        oneToken().idiv(1000).toNumber()
      );
      assert.closeTo(
        poolBalanceAfter.minus(poolBalanceBefore).toNumber(),
        totalDebt.toNumber(),
        oneToken().idiv(1000).toNumber()
      );
    });

    it("should correctly repay all integration borrow", async () => {
      const currentRate = await daiPool.getNewCompoundRate();
      const poolBalanceBefore = toBN(await tokens[0].balanceOf(daiPool.address));

      await integrationCore.repayBorrowIntegration(daiKey, baseToken.address, 0, true, { from: USER1 });

      const poolBalanceAfter = toBN(await tokens[0].balanceOf(daiPool.address));
      const expectedAmount = borrowAmount.times(currentRate).idiv(decimal);

      assert.closeTo(
        poolBalanceAfter.minus(poolBalanceBefore).toNumber(),
        expectedAmount.toNumber(),
        oneToken().idiv(1000).toNumber()
      );

      assert.equal(toBN(await integrationCore.getTotalBorrowBalanceInUSD(USER1)).toString(), 0);
      assert.equal(toBN(await integrationCore.getUserBorrowedAmount(USER1, daiKey)).toString(), 0);

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserIntegrationBorrowAssets(USER1), []));
    });

    it("should send reward to user", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await daiPool.approve(integrationCore.address, liquidityAmount, { from: USER2 });
      await integrationCore.deployBorrowerRouter({ from: USER2 });
      await integrationCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER2 });

      const newVaultExchangeRate = getOnePercent().times(105);
      const vault = await YearnVaultMock.at(await vaultRegistry.latestVault(baseToken.address));

      await vault.setExchangeRate(newVaultExchangeRate);

      await setCurrentTime(10000);

      const totalDebt = toBN(await integrationCore.getMaxToRepay(USER1, daiKey));
      const expectedReceivedAmount = borrowAmount.times(newVaultExchangeRate).idiv(decimal);
      const expectedReward = expectedReceivedAmount.minus(totalDebt);

      const userBalanceBefore = toBN(await tokens[0].balanceOf(USER1));

      await integrationCore.repayBorrowIntegration(daiKey, baseToken.address, 0, true, { from: USER1 });

      const userBalanceAfter = toBN(await tokens[0].balanceOf(USER1));

      assert.closeTo(
        userBalanceAfter.minus(userBalanceBefore).toNumber(),
        expectedReward.toNumber(),
        oneToken().idiv(1000).toNumber()
      );

      assert.equal(toBN(await integrationCore.getTotalBorrowBalanceInUSD(USER1)).toString(), 0);
      assert.equal(toBN(await integrationCore.getUserBorrowedAmount(USER1, daiKey)).toString(), 0);

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserIntegrationBorrowAssets(USER1), []));
    });

    it("should return assets directly to user account", async () => {
      await integrationCore.repayBorrow(daiKey, 0, true, { from: USER1 });

      assert.equal(toBN(await integrationCore.getTotalBorrowBalanceInUSD(USER1)).toString(), 0);
      assert.equal(toBN(await integrationCore.getUserBorrowedAmount(USER1, daiKey)).toString(), 0);

      const currentUserBalance = toBN(await tokens[0].balanceOf(USER1));

      await integrationCore.repayBorrowIntegration(daiKey, baseToken.address, 0, true, { from: USER1 });

      assert.equal(
        toBN(await tokens[0].balanceOf(USER1))
          .minus(currentUserBalance)
          .toString(),
        borrowAmount.toString()
      );
    });

    it("should get exception if amount equals to zero", async () => {
      const reason = "IntegrationCore: Zero amount cannot be repaid.";

      await truffleAssert.reverts(
        integrationCore.repayBorrowIntegration(daiKey, baseToken.address, 0, false, { from: USER1 }),
        reason
      );
    });
  });

  describe("isBorrowExists", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(70);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await daiPool.approve(integrationCore.address, liquidityAmount, { from: USER1 });
      await integrationCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
    });

    it("should return false if borrow does not exist", async () => {
      assert.isFalse(await integrationCore.isBorrowExists(USER1, daiKey));
    });

    it("should return true if borrow exists", async () => {
      await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 });

      assert.isTrue(await integrationCore.isBorrowExists(USER1, daiKey));
    });

    it("should return correct values", async () => {
      await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 });

      assert.isTrue(await integrationCore.isBorrowExists(USER1, daiKey));

      await integrationCore.repayBorrow(daiKey, 0, true, { from: USER1 });

      assert.isTrue(await integrationCore.isBorrowExists(USER1, daiKey));

      await integrationCore.repayBorrowIntegration(daiKey, baseToken.address, 0, true, { from: USER1 });

      assert.isFalse(await integrationCore.isBorrowExists(USER1, daiKey));
    });
  });

  describe("getUserVaultTokens", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(15);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await daiPool.approve(integrationCore.address, liquidityAmount, { from: USER1 });
      await integrationCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
    });

    it("should return empty array if user does not have any borrows", async () => {
      assert.deepEqual(await integrationCore.getUserVaultTokens(USER1, daiKey), []);
    });

    it("should return correct values", async () => {
      await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 });

      assert.deepEqual(await integrationCore.getUserVaultTokens(USER1, daiKey), [baseToken.address]);

      await integrationCore.borrow(daiKey, tokens[0].address, borrowAmount, { from: USER1 });

      assert.deepEqual(await integrationCore.getUserVaultTokens(USER1, daiKey), [baseToken.address, tokens[0].address]);

      await integrationCore.repayBorrowIntegration(daiKey, baseToken.address, 0, true, { from: USER1 });

      assert.deepEqual(await integrationCore.getUserVaultTokens(USER1, daiKey), [tokens[0].address]);
    });
  });

  describe("getUserLiquidityAmount", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(30);

    it("should return zero if borrower router does not deploy", async () => {
      assert.equal(toBN(await integrationCore.getUserLiquidityAmount(USER2, daiKey)).toString(), 0);
    });

    it("should return correct user liquidity amount", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await daiPool.approve(integrationCore.address, liquidityAmount, { from: USER1 });
      await integrationCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal(
        toBN(await integrationCore.getUserLiquidityAmount(USER1, daiKey)).toString(),
        liquidityAmount.toString()
      );
    });

    it("should return correct user liquidity amount if exchange rate > 1", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await daiPool.approve(integrationCore.address, liquidityAmount, { from: USER1 });
      await integrationCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await defiCore.borrow(daiKey, borrowAmount, { from: USER2 });

      await setCurrentTime(100000);

      await defiCore.updateCompoundRate(daiKey);

      assert.isTrue(toBN(await daiPool.exchangeRate()).gt(decimal));

      const expectedAssetAmount = toBN(await daiPool.convertNTokensToAsset(liquidityAmount));
      assert.equal(
        toBN(await integrationCore.getUserLiquidityAmount(USER1, daiKey)).toString(),
        expectedAssetAmount.toString()
      );
    });
  });

  describe("getTotalSupplyBalanceInUSD", async () => {
    const liquidityAmount = oneToken().times(100);

    it("should return zero if user does not have any deposits", async () => {
      assert.equal(toBN(await integrationCore.getTotalSupplyBalanceInUSD(USER1)).toString(), 0);
    });

    it("should return correct total supply balance in USD", async () => {
      const keys = [daiKey, usdcKey, xrpKey];
      const pools = [daiPool, usdcPool, xrpPool];

      for (let i = 0; i < 3; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount.times(i + 1), { from: USER1 });

        await pools[i].approve(integrationCore.address, liquidityAmount.times(i + 1), { from: USER1 });
        await integrationCore.addLiquidity(keys[i], liquidityAmount.times(i + 1), { from: USER1 });
      }

      const expectedAmount = convertToUSD(liquidityAmount.times(6));

      assert.equal(toBN(await integrationCore.getTotalSupplyBalanceInUSD(USER1)).toString(), expectedAmount.toString());
    });
  });

  describe("getTotalBorrowBalanceInUSD", async () => {
    const liquidityAmount = oneToken().times(100);

    it("should return zero if user does not have any borrows", async () => {
      assert.equal(toBN(await integrationCore.getTotalBorrowBalanceInUSD(USER1)).toString(), 0);
    });

    it("should return correct total borrow balance in USD", async () => {
      const keys = [daiKey, usdcKey, xrpKey];
      const pools = [daiPool, usdcPool, xrpPool];

      for (let i = 0; i < 3; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount.times(i + 1), { from: USER1 });

        await pools[i].approve(integrationCore.address, liquidityAmount.times(i + 1), { from: USER1 });
        await integrationCore.addLiquidity(keys[i], liquidityAmount.times(i + 1), { from: USER1 });
        await integrationCore;
      }

      const expectedAmount = convertToUSD(liquidityAmount.times(6));

      assert.equal(toBN(await integrationCore.getTotalSupplyBalanceInUSD(USER1)).toString(), expectedAmount.toString());
    });
  });

  describe("getTotalBorrowBalanceInUSD", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(70);

    it("should return zero if user does not have any deposits", async () => {
      assert.equal(toBN(await integrationCore.getTotalBorrowBalanceInUSD(USER1)).toString(), 0);
    });

    it("should return correct current total borrow in USD", async () => {
      const keys = [daiKey, usdcKey];
      const pools = [daiPool, usdcPool];

      for (let i = 0; i < 2; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount.times(i + 1), { from: USER1 });

        await pools[i].approve(integrationCore.address, liquidityAmount.times(i + 1), { from: USER1 });
        await integrationCore.addLiquidity(keys[i], liquidityAmount.times(i + 1), { from: USER1 });
        await integrationCore.borrow(keys[i], baseToken.address, borrowAmount.times(i + 1), { from: USER1 });
      }

      assert.equal(
        toBN(await integrationCore.getTotalBorrowBalanceInUSD(USER1)).toString(),
        convertToUSD(borrowAmount.times(3)).toString()
      );
    });
  });

  describe("getMaxToSupply", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(50);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await defiCore.borrow(daiKey, borrowAmount, { from: USER2 });

      assert.equal(toBN(await daiPool.balanceOf(USER1)).toString(), liquidityAmount.toString());

      await setCurrentTime(10000);

      await defiCore.updateCompoundRate(daiKey);

      assert.isTrue(toBN(await daiPool.exchangeRate()).gt(decimal));
    });

    it("should return zero if nothing to supply", async () => {
      assert.equal(toBN(await integrationCore.getMaxToSupply(OWNER, daiKey)).toString(), 0);
    });

    it("should return correct max to supply amount if asset disabled as collateral", async () => {
      await defiCore.addLiquidity(usdtKey, liquidityAmount, { from: USER1 });

      assert.equal(toBN(await integrationCore.getMaxToSupply(USER1, usdtKey)).toString(), liquidityAmount.toString());
    });

    it("should return correct max to supply amount without any borrows", async () => {
      assert.equal(
        toBN(await integrationCore.getMaxToSupply(USER1, daiKey)).toString(),
        toBN(await daiPool.convertNTokensToAsset(liquidityAmount)).toString()
      );
    });

    it("should return correct max to supply amount if borrow amount > 0", async () => {
      const maxToSupply = toBN(await integrationCore.getMaxToSupply(USER2, daiKey));
      const freeLimit = toBN(await defiCore.getCurrentBorrowLimitInUSD(USER2)).minus(
        await defiCore.getTotalBorrowBalanceInUSD(USER2)
      );
      const expectedMaxToSupply = convertFromUSD(convertFromBorrowLimit(freeLimit));

      assert.closeTo(maxToSupply.toNumber(), expectedMaxToSupply.toNumber(), oneToken().idiv(1000).toNumber());
    });
  });

  describe("getMaxToWithdraw", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(50);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await daiPool.approve(integrationCore.address, liquidityAmount, { from: USER1 });
      await integrationCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
    });

    it("should return zero if nothing to withdraw", async () => {
      await integrationCore.deployBorrowerRouter();
      assert.equal(toBN(await integrationCore.getMaxToWithdraw(OWNER, daiKey)).toString(), 0);
    });

    it("should return correct max to withdraw amount if asset disabled as collateral", async () => {
      await defiCore.addLiquidity(usdcKey, liquidityAmount, { from: USER1 });

      await usdcPool.approve(integrationCore.address, liquidityAmount, { from: USER1 });
      await integrationCore.addLiquidity(usdcKey, liquidityAmount, { from: USER1 });

      await integrationCore.borrow(usdcKey, baseToken.address, borrowAmount, { from: USER1 });

      await integrationCore.disableCollateral(usdcKey, { from: USER1 });

      assert.equal(toBN(await integrationCore.getMaxToWithdraw(USER1, usdcKey)).toString(), liquidityAmount.toString());
    });

    it("should return correct max to supply amount without any borrows", async () => {
      assert.equal(toBN(await integrationCore.getMaxToWithdraw(USER1, daiKey)).toString(), liquidityAmount.toString());
    });

    it("should return correct max to withdraw amount if borrow amount > 0", async () => {
      await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 });

      const maxToWithdraw = toBN(await integrationCore.getMaxToWithdraw(USER1, daiKey));
      const freeLimit = toBN(await integrationCore.getCurrentBorrowLimitInUSD(USER1)).minus(
        await integrationCore.getTotalBorrowBalanceInUSD(USER1)
      );
      const expectedMaxToWithdraw = convertFromUSD(convertFromBorrowLimit(freeLimit, integrationColRatio));

      assert.closeTo(maxToWithdraw.toNumber(), expectedMaxToWithdraw.toNumber(), oneToken().idiv(1000).toNumber());
    });
  });

  describe("optimization", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(50);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await daiPool.approve(integrationCore.address, liquidityAmount, { from: USER1 });
      await integrationCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
    });

    it("should correctly do optimization", async () => {
      await defiCore.addLiquidity(usdcKey, liquidityAmount, { from: USER2 });
      await integrationCore.borrow(usdcKey, baseToken.address, oneToken().times(90), { from: USER1 });

      const newPrice = toBN(120);
      await usdcPriceOracle.setPrice(newPrice.times(priceDecimals));

      let result = await integrationCore.getAvailableLiquidity(USER1);
      assert.equal(toBN(result[0]).toString(), 0);

      const totalUserDebt = toBN(await integrationCore.getUserBorrowedAmount(USER1, usdcKey));
      const optimizationAmount = totalUserDebt.times(optimizationPercentage).idiv(decimal);
      const userReward = optimizationAmount.times(optimizationReward).idiv(decimal);

      const optimizatorBalanceBeforeOptimization = toBN(await tokens[2].balanceOf(USER2));

      await integrationCore.optimization(USER1, usdcKey, baseToken.address, { from: USER2 });

      const optimizatorBalanceAfterOptimization = toBN(await tokens[2].balanceOf(USER2));

      assert.equal(
        optimizatorBalanceAfterOptimization.minus(optimizatorBalanceBeforeOptimization).toString(),
        userReward.toString()
      );
      assert.closeTo(
        toBN(await integrationCore.getUserBorrowedAmount(USER1, usdcKey)).toNumber(),
        totalUserDebt.minus(optimizationAmount.minus(userReward)).toNumber(),
        oneToken().toNumber()
      );

      result = await integrationCore.getAvailableLiquidity(USER1);
      assert.equal(toBN(result[1]).toString(), 0);
    });

    it("should correctly update vault tokens", async () => {
      await defiCore.addLiquidity(usdcKey, liquidityAmount, { from: USER2 });
      await integrationCore.borrow(usdcKey, baseToken.address, oneToken().times(75), { from: USER1 });
      await integrationCore.borrow(usdcKey, tokens[2].address, oneToken().times(15), { from: USER1 });

      const newPrice = toBN(120);
      await usdcPriceOracle.setPrice(newPrice.times(priceDecimals));

      let result = await integrationCore.getAvailableLiquidity(USER1);
      assert.equal(toBN(result[0]).toString(), 0);

      assert.isTrue(
        deepCompareKeys(await integrationCore.getUserVaultTokens(USER1, usdcKey), [
          baseToken.address,
          tokens[2].address,
        ])
      );

      const totalUserDebt = toBN(await integrationCore.getUserBorrowedAmount(USER1, usdcKey));
      const optimizationAmount = oneToken().times(15);
      const userReward = optimizationAmount.times(optimizationReward).idiv(decimal);

      const optimizatorBalanceBeforeOptimization = toBN(await tokens[2].balanceOf(USER2));

      await integrationCore.optimization(USER1, usdcKey, tokens[2].address, { from: USER2 });

      const optimizatorBalanceAfterOptimization = toBN(await tokens[2].balanceOf(USER2));

      assert.equal(
        optimizatorBalanceAfterOptimization.minus(optimizatorBalanceBeforeOptimization).toString(),
        userReward.toString()
      );
      assert.closeTo(
        toBN(await integrationCore.getUserBorrowedAmount(USER1, usdcKey)).toNumber(),
        totalUserDebt.minus(optimizationAmount.minus(userReward)).toNumber(),
        oneToken().toNumber()
      );

      assert.isTrue(deepCompareKeys(await integrationCore.getUserVaultTokens(USER1, usdcKey), [baseToken.address]));

      result = await integrationCore.getAvailableLiquidity(USER1);
      assert.equal(toBN(result[1]).toString(), 0);
    });

    it("check normalized amount", async () => {
      await defiCore.addLiquidity(usdcKey, liquidityAmount.times(2), { from: USER2 });

      await defiCore.borrow(usdcKey, oneToken().times(15), { from: USER2 });

      await integrationCore.borrow(usdcKey, baseToken.address, oneToken().times(90), { from: USER1 });

      const newPrice = toBN(120);
      await usdcPriceOracle.setPrice(newPrice.times(priceDecimals));

      let result = await integrationCore.getAvailableLiquidity(USER1);
      assert.equal(toBN(result[0]).toString(), 0);

      const totalBorrowedAmount = oneToken().times(105);

      assert.equal(
        toBN(await usdcPool.aggregatedNormalizedBorrowedAmount()).toString(),
        totalBorrowedAmount.toString()
      );
      assert.equal(toBN(await usdcPool.aggregatedBorrowedAmount()).toString(), totalBorrowedAmount.toString());

      await setCurrentTime(100000);

      const newRate = toBN(await defiCore.updateCompoundRate.call(usdcKey));
      await defiCore.updateCompoundRate(usdcKey);

      const totalUserDebt = toBN(await integrationCore.getUserBorrowedAmount(USER1, usdcKey));

      await integrationCore.optimization(USER1, usdcKey, baseToken.address, { from: USER2 });

      const optimizationAmount = totalUserDebt.times(optimizationPercentage).idiv(decimal);
      const userReward = optimizationAmount.times(optimizationReward).idiv(decimal);
      const amountToRepay = optimizationAmount.minus(userReward);
      const normalizedRepayAmount = amountToRepay.times(decimal).idiv(newRate);

      assert.equal(
        toBN(await usdcPool.aggregatedNormalizedBorrowedAmount()).toString(),
        totalBorrowedAmount.minus(normalizedRepayAmount).toString()
      );
      assert.closeTo(
        toBN(await usdcPool.aggregatedBorrowedAmount()).toNumber(),
        totalBorrowedAmount
          .minus(amountToRepay)
          .minus(toBN(await usdcPool.totalReserves()))
          .toNumber(),
        oneToken().toNumber()
      );
    });

    it("should get exception if user does not have borrowed amount", async () => {
      await defiCore.addLiquidity(usdcKey, liquidityAmount, { from: USER2 });
      await integrationCore.borrow(usdcKey, baseToken.address, oneToken().times(85), { from: USER1 });
      await integrationCore.borrow(daiKey, baseToken.address, oneToken().times(5), { from: USER1 });

      const newPrice = toBN(120);
      await usdcPriceOracle.setPrice(newPrice.times(priceDecimals));

      const result = await integrationCore.getAvailableLiquidity(USER1);

      assert.equal(toBN(result[0]).toString(), 0);

      await integrationCore.repayBorrow(daiKey, 0, true, { from: USER1 });

      assert.equal(toBN(await integrationCore.getUserBorrowedAmount(USER1, daiKey)).toString(), 0);

      const reason = "IntegrationCore: User borrowed amount is zero.";

      await truffleAssert.reverts(
        integrationCore.optimization(USER1, daiKey, baseToken.address, { from: USER2 }),
        reason
      );
    });

    it("should get exception if user debt is zero", async () => {
      await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 });

      const reason = "IntegrationCore: User debt must be greater than zero.";

      await truffleAssert.reverts(
        integrationCore.optimization(USER1, daiKey, baseToken.address, { from: USER2 }),
        reason
      );
    });

    it("should get exception if user does not have current vault token", async () => {
      const reason = "IntegrationCore: User does not have current vault token address.";

      await truffleAssert.reverts(
        integrationCore.optimization(USER1, daiKey, tokens[0].address, { from: USER2 }),
        reason
      );
    });
  });

  describe("getOptimizationInfo", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(30);

    it("should return correct values", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(3), { from: USER1 });
      await defiCore.addLiquidity(usdcKey, liquidityAmount.times(3), { from: USER2 });

      await daiPool.approve(integrationCore.address, liquidityAmount.times(3), { from: USER1 });
      await integrationCore.addLiquidity(daiKey, liquidityAmount.times(3), { from: USER1 });

      await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 });
      await integrationCore.borrow(usdcKey, baseToken.address, borrowAmount, { from: USER1 });

      const result = (await integrationCore.getOptimizationInfo([USER1]))[0];

      const price = toBN(100).times(priceDecimals);
      const totalBorrowBalanceInUSD = borrowAmount.times(2).idiv(oneToken()).times(price);

      assert.isTrue(deepCompareKeys(result.borrowAssetKeys, [daiKey, usdcKey]));
      assert.equal(toBN(result.totalBorrowedAmount).toString(), totalBorrowBalanceInUSD.toString());
    });
  });

  describe("getUserOptimizationInfo", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(30);

    it("should return correct values", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(3), { from: USER1 });
      await defiCore.addLiquidity(usdcKey, liquidityAmount.times(3), { from: USER2 });

      await daiPool.approve(integrationCore.address, liquidityAmount.times(3), { from: USER1 });
      await integrationCore.addLiquidity(daiKey, liquidityAmount.times(3), { from: USER1 });

      await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 });
      await integrationCore.borrow(daiKey, tokens[0].address, borrowAmount, { from: USER1 });

      const result = await integrationCore.getUserOptimizationInfo(USER1, daiKey, baseToken.address);

      const price = toBN(100).times(priceDecimals);
      const rewardAmount = borrowAmount
        .times(2)
        .times(optimizationPercentage)
        .idiv(decimal)
        .times(optimizationReward)
        .idiv(decimal);

      assert.equal(toBN(result.totalBorrowAmount).toString(), borrowAmount.times(2).toString());
      assert.equal(toBN(result.borrowAmountInVault).toString(), borrowAmount.toString());
      assert.equal(toBN(result.rewardAmount).toString(), rewardAmount.toString());
      assert.equal(toBN(result.rewardAmountInUSD).toString(), rewardAmount.times(price).idiv(oneToken()).toString());
    });
  });
});
