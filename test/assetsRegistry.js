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
const { advanceBlockAtTime } = require("./helpers/ganacheTimeTraveler");
const { toBytes, deepCompareKeys } = require("./helpers/bytesCompareLibrary");
const {
  convertToUSD,
  convertToBorrowLimit,
  convertFromBorrowLimit,
  mintAndApprove,
  saveCoins,
  mulDiv,
} = require("./helpers/helperFunctions");

const Reverter = require("./helpers/reverter");
const { assert } = require("chai");

const setCurrentTime = advanceBlockAtTime;
const truffleAssert = require("truffle-assertions");

contract("AssetsRegistry", async (accounts) => {
  const reverter = new Reverter(web3);

  const ADDRESS_NULL = "0x0000000000000000000000000000000000000000";

  const OWNER = accounts[0];
  const USER1 = accounts[1];
  const USER2 = accounts[2];
  const NOTHING = accounts[9];

  let registry;
  let assetParameters;
  let assetsRegistry;
  let defiCore;
  let rewardsDistribution;
  let priceManager;
  let integrationCore;
  let liquidityPoolRegistry;
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

  const numberOfBaseCoins = 3;
  const baseCoins = [];
  const lpTokens = [];

  const tokens = [];

  const onePercent = getOnePercent();
  const decimal = onePercent.times(100);
  const tokensAmount = oneToken().times(100000);
  const standardColRatio = decimal.times("1.25");
  const integrationColRatio = decimal.times("1.1");
  const reserveFactor = onePercent.times("15");

  const firstSlope = onePercent.times(4);
  const secondSlope = decimal;
  const utilizationBreakingPoint = onePercent.times(80);
  const maxUR = onePercent.times(95);
  const liquidationDiscount = onePercent.times(8);
  const liquidationBoundary = onePercent.times(50);

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
    const _liquidityPoolFactory = await LiquidityPoolFactory.new();
    const _priceManager = await PriceManager.new();
    const _liquidityPoolRegistry = await LiquidityPoolRegistry.new();

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
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_FACTORY_NAME(), _liquidityPoolFactory.address);
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_REGISTRY_NAME(), _liquidityPoolRegistry.address);
    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), _priceManager.address);

    await registry.addProxyContract(await registry.INTEGRATION_CORE_NAME(), _integrationCore.address);
    await registry.addProxyContract(await registry.BORROWER_ROUTER_FACTORY_NAME(), _borrowerRouterFactory.address);
    await registry.addProxyContract(await registry.BORROWER_ROUTER_REGISTRY_NAME(), _borrowerRouterRegistry.address);

    await registry.addContract(await registry.INTEREST_RATE_LIBRARY_NAME(), interestRateLibrary.address);
    await registry.addContract(await registry.GOVERNANCE_TOKEN_NAME(), governanceToken.address);

    defiCore = await DefiCore.at(await registry.getDefiCoreContract());
    assetParameters = await AssetParameters.at(await registry.getAssetParametersContract());
    assetsRegistry = await AssetsRegistry.at(await registry.getAssetsRegistryContract());
    liquidityPoolRegistry = await LiquidityPoolRegistry.at(await registry.getLiquidityPoolRegistryContract());
    rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());
    priceManager = await PriceManager.at(await registry.getPriceManagerContract());
    borrowerRouterRegistry = await BorrowerRouterRegistry.at(await registry.getBorrowerRouterRegistryContract());
    integrationCore = await IntegrationCore.at(await registry.getIntegrationCoreContract());

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

    tokens.push(governanceToken.address);
    await deployTokens(tokens, ["DAI", "USDT", "USDC", "WETH", "XRP"]);

    await assetParameters.assetParametersInitialize();
    await systemParameters.systemParametersInitialize();
    await liquidityPoolRegistry.liquidityPoolRegistryInitialize();
    await rewardsDistribution.rewardsDistributionInitialize();
    await liquidityPoolAdmin.liquidityPoolAdminInitialize(_liquidityPoolImpl.address);
    await priceManager.priceManagerInitialize(daiKey, tokens[1].address);
    await borrowerRouterRegistry.borrowerRouterRegistryInitialize(_borrowerRouterImpl.address);

    await setCurrentTime(1);

    await deployGovernancePool(governanceToken.address, await governanceToken.symbol());

    await createLiquidityPool(daiKey, tokens[1], "DAI", true);
    await createLiquidityPool(usdtKey, tokens[2], "USDT", false);
    await createLiquidityPool(usdcKey, tokens[3], "USDC", true);
    await createLiquidityPool(wEthKey, tokens[4], "WETH", true);
    await createLiquidityPool(xrpKey, tokens[5], "XRP", true);

    daiPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(daiKey));
    xrpPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(xrpKey));
    usdcPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(usdcKey));
    wEthPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(wEthKey));
    await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(usdtKey));

    await systemParameters.setupLiquidationBoundary(liquidationBoundary);

    await rewardsDistribution.setupRewardsPerBlockBatch(
      [daiKey, usdcKey, usdtKey, wEthKey, xrpKey, governanceTokenKey],
      [oneToken(), oneToken().times(2), oneToken().times(3), oneToken(), oneToken(), oneToken().times(2)]
    );

    await governanceToken.transfer(defiCore.address, tokensAmount.times(10));

    curveRegistry = await CurveRegistryMock.new();
    vaultRegistry = await VaultRegistryMock.new();

    baseToken = await MockERC20.new("Test 3Crv", "T3Crv");

    lpTokens.push(baseToken.address);

    for (let i = 0; i < numberOfBaseCoins; i++) {
      baseCoins.push(tokens[i + 1].address);
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

  describe("getUserSupplyAssets", async () => {
    const liquidityAmount = oneToken().times(100);

    it("should return empty array if user does not have any deposits", async () => {
      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserSupplyAssets(USER1), []));
    });

    it("should return correct assets array", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(usdtKey, liquidityAmount, { from: USER1 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserSupplyAssets(USER1), [daiKey, usdtKey]));

      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserSupplyAssets(USER1), [daiKey, usdtKey, wEthKey]));

      await defiCore.withdrawLiquidity(usdtKey, 0, true, { from: USER1 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserSupplyAssets(USER1), [daiKey, wEthKey]));
    });
  });

  describe("getUserIntegrationSupplyAssets", async () => {
    const liquidityAmount = oneToken().times(100);
    let keys = [daiKey, usdcKey, wEthKey, xrpKey];

    beforeEach("setup", async () => {
      const pools = [daiPool, usdcPool, wEthPool, xrpPool];

      for (let i = 0; i < keys.length; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
        await pools[i].approve(integrationCore.address, liquidityAmount, { from: USER1 });
      }
    });

    it("should return empty array if user does not have any deposits", async () => {
      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserIntegrationSupplyAssets(USER1), []));
    });

    it("should return correct assets array", async () => {
      await integrationCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await integrationCore.addLiquidity(usdcKey, liquidityAmount, { from: USER1 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserIntegrationSupplyAssets(USER1), [daiKey, usdcKey]));

      await integrationCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      assert.isTrue(
        deepCompareKeys(await assetsRegistry.getUserIntegrationSupplyAssets(USER1), [daiKey, usdcKey, wEthKey])
      );

      await integrationCore.withdrawLiquidity(usdcKey, 0, true, { from: USER1 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserIntegrationSupplyAssets(USER1), [daiKey, wEthKey]));
    });
  });

  describe("getUserBorrowAssets", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(10);

    it("should return empty array if user does not have any borrows", async () => {
      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), []));
    });

    it("should return correct assets array", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(usdtKey, liquidityAmount, { from: USER1 });

      await defiCore.borrow(daiKey, borrowAmount, { from: USER1 });
      await defiCore.borrow(usdtKey, borrowAmount, { from: USER1 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), [daiKey, usdtKey]));

      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });
      await defiCore.borrow(wEthKey, borrowAmount, { from: USER1 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), [daiKey, usdtKey, wEthKey]));

      await defiCore.repayBorrow(usdtKey, 0, true, { from: USER1 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserBorrowAssets(USER1), [daiKey, wEthKey]));
    });
  });

  describe("getUserIntegrationBorrowAssets", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(10);
    let keys = [daiKey, usdcKey, wEthKey, xrpKey];

    beforeEach("setup", async () => {
      const pools = [daiPool, usdcPool, wEthPool, xrpPool];

      for (let i = 0; i < keys.length; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
        await pools[i].approve(integrationCore.address, liquidityAmount, { from: USER1 });
        await integrationCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
      }
    });

    it("should return empty array if user does not have any deposits", async () => {
      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserIntegrationBorrowAssets(USER1), []));
    });

    it("should return correct assets array", async () => {
      await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 });
      await integrationCore.borrow(usdcKey, baseToken.address, borrowAmount, { from: USER1 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserIntegrationBorrowAssets(USER1), [daiKey, usdcKey]));

      await integrationCore.repayBorrowIntegration(usdcKey, baseToken.address, 0, true, { from: USER1 });

      assert.isTrue(deepCompareKeys(await assetsRegistry.getUserIntegrationBorrowAssets(USER1), [daiKey]));
    });
  });

  describe("getSupplyAssets", async () => {
    const liquidityAmount = oneToken().times(100);
    let keys = [governanceTokenKey, daiKey, usdtKey, usdcKey, wEthKey, xrpKey];

    it("should return correct assets arrays if the user does not have a deposits", async () => {
      const arrays = await assetsRegistry.getSupplyAssets(USER1);

      assert.isTrue(deepCompareKeys(arrays[0], keys));
      assert.isTrue(deepCompareKeys(arrays[1], []));
    });

    it("should return correct assets arrays if the user have deposits", async () => {
      const depositKeys = [];

      for (let i = 1; i < 4; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
        depositKeys.push(keys[i]);
      }

      const availableKeys = keys.filter((key) => depositKeys.indexOf(key) == -1);
      const arrays = await assetsRegistry.getSupplyAssets(USER1);

      assert.isTrue(deepCompareKeys(arrays[0], availableKeys));
      assert.isTrue(deepCompareKeys(arrays[1], depositKeys));
    });

    it("should return correct assets arrays if the user doesn't have available assets", async () => {
      const depositKeys = [];

      for (let i = 1; i < keys.length; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
        depositKeys.push(keys[i]);
      }

      const arrays = await assetsRegistry.getSupplyAssets(USER1);

      assert.isTrue(deepCompareKeys(arrays[0], [governanceTokenKey]));
      assert.isTrue(deepCompareKeys(arrays[1], depositKeys));
    });
  });

  describe("getIntegrationSupplyAssets", async () => {
    const liquidityAmount = oneToken().times(100);
    let keys = [daiKey, usdcKey, wEthKey, xrpKey];

    beforeEach("setup", async () => {
      const pools = [daiPool, usdcPool, wEthPool, xrpPool];

      for (let i = 0; i < keys.length; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
        await pools[i].approve(integrationCore.address, liquidityAmount, { from: USER1 });
      }
    });

    it("should return correct values if user does not have any deposits", async () => {
      const arrays = await assetsRegistry.getIntegrationSupplyAssets(USER1);

      assert.isTrue(deepCompareKeys(arrays[0], keys));
      assert.isTrue(deepCompareKeys(arrays[1], []));
    });

    it("should return correct assets arrays", async () => {
      const depositKeys = [];

      for (let i = 1; i < 3; i++) {
        await integrationCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });

        depositKeys.push(keys[i]);
      }

      const availableKeys = keys.filter((key) => depositKeys.indexOf(key) == -1);
      const arrays = await assetsRegistry.getIntegrationSupplyAssets(USER1);

      assert.isTrue(deepCompareKeys(arrays[0], availableKeys));
      assert.isTrue(deepCompareKeys(arrays[1], depositKeys));
    });

    it("should return correct assets arrays if the user doesn't have available assets", async () => {
      const depositKeys = [];

      for (let i = 0; i < keys.length; i++) {
        await integrationCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });

        depositKeys.push(keys[i]);
      }

      const arrays = await assetsRegistry.getIntegrationSupplyAssets(USER1);

      assert.isTrue(deepCompareKeys(arrays[0], []));
      assert.isTrue(deepCompareKeys(arrays[1], depositKeys));
    });

    it("should return correct assets array if asset not allow as collateral", async () => {
      await integrationCore.deployBorrowerRouter({ from: USER2 });

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });
      await defiCore.addLiquidity(usdtKey, liquidityAmount, { from: USER2 });
      await defiCore.addLiquidity(usdcKey, liquidityAmount, { from: USER2 });

      await daiPool.approve(integrationCore.address, liquidityAmount, { from: USER2 });

      await integrationCore.addLiquidity(daiKey, liquidityAmount, { from: USER2 });

      const arrays = await assetsRegistry.getIntegrationSupplyAssets(USER2);

      assert.isTrue(deepCompareKeys(arrays[0], [usdcKey]));
      assert.isTrue(deepCompareKeys(arrays[1], [daiKey]));
    });
  });

  describe("getBorrowAssets", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(10);
    let keys = [governanceTokenKey, daiKey, usdtKey, usdcKey, wEthKey, xrpKey];

    beforeEach("setup", async () => {});

    it("should return correct assets arrays if the user does not have any borrows", async () => {
      const arrays = await assetsRegistry.getBorrowAssets(USER1);

      assert.isTrue(deepCompareKeys(arrays[0], keys));
      assert.isTrue(deepCompareKeys(arrays[1], []));
    });

    it("should return correct assets arrays if the user have borrows", async () => {
      const borrowKeys = [];

      for (let i = 1; i < 3; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
        await defiCore.borrow(keys[i], borrowAmount, { from: USER1 });
        borrowKeys.push(keys[i]);
      }

      const availableKeys = keys.filter((key) => borrowKeys.indexOf(key) == -1);
      const arrays = await assetsRegistry.getBorrowAssets(USER1);

      assert.isTrue(deepCompareKeys(arrays[0], availableKeys));
      assert.isTrue(deepCompareKeys(arrays[1], borrowKeys));
    });

    it("should return correct assets arrays if the user doesn't have available assets", async () => {
      const borrowKeys = [];

      for (let i = 1; i < keys.length; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
        await defiCore.borrow(keys[i], borrowAmount, { from: USER1 });
        borrowKeys.push(keys[i]);
      }

      const arrays = await assetsRegistry.getSupplyAssets(USER1);

      assert.isTrue(deepCompareKeys(arrays[0], [governanceTokenKey]));
      assert.isTrue(deepCompareKeys(arrays[1], borrowKeys));
    });
  });

  describe("getIntegrationBorrowAssets", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(10);
    let keys = [daiKey, usdcKey, wEthKey, xrpKey];

    beforeEach("setup", async () => {
      const pools = [daiPool, usdcPool, wEthPool, xrpPool];

      for (let i = 0; i < keys.length; i++) {
        await defiCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
        await pools[i].approve(integrationCore.address, liquidityAmount, { from: USER1 });
        await integrationCore.addLiquidity(keys[i], liquidityAmount, { from: USER1 });
      }
    });

    it("should return correct values if user does not have any borrows", async () => {
      const arrays = await assetsRegistry.getIntegrationBorrowAssets(USER1);

      assert.isTrue(deepCompareKeys(arrays[0], keys));
      assert.isTrue(deepCompareKeys(arrays[1], []));
    });

    it("should return correct assets arrays", async () => {
      const borrowKeys = [];

      for (let i = 0; i < 2; i++) {
        await integrationCore.borrow(keys[i], baseToken.address, borrowAmount, { from: USER1 });

        borrowKeys.push(keys[i]);
      }

      const availableKeys = keys.filter((key) => borrowKeys.indexOf(key) == -1);
      const arrays = await assetsRegistry.getIntegrationBorrowAssets(USER1);

      assert.isTrue(deepCompareKeys(arrays[0], availableKeys));
      assert.isTrue(deepCompareKeys(arrays[1], borrowKeys));
    });
  });

  describe("getSupplyAssetsInfo", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(50);

    it("should return correct data", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.borrow(daiKey, borrowAmount, { from: USER2 });

      const supplyInfo = (await assetsRegistry.getSupplyAssetsInfo([daiKey], USER1))[0];

      assert.equal(supplyInfo.assetAddr, tokens[1].address);
      assert.equal(toBN(supplyInfo.supplyAPY).toString(), toBN(await daiPool.getAPY()).toString());
      assert.equal(
        toBN(supplyInfo.distributionSupplyAPY).toString(),
        toBN((await rewardsDistribution.getAPY(daiPool.address))[0]).toString()
      );

      assert.equal(toBN(supplyInfo.userSupplyBalance).toString(), liquidityAmount.toString());
      assert.equal(toBN(supplyInfo.userSupplyBalanceInUSD).toString(), convertToUSD(liquidityAmount).toString());

      assert.equal(
        toBN(supplyInfo.maxSupplyValues.maxToSupply).toString(),
        toBN(await tokens[1].balanceOf(USER1)).toString()
      );
      assert.closeTo(
        toBN(supplyInfo.maxSupplyValues.maxToWithdraw).toNumber(),
        liquidityAmount.minus(borrowAmount.div(maxUR.minus(onePercent)).times(decimal)).toNumber(),
        oneToken().idiv(10).toNumber()
      );

      assert.equal(supplyInfo.isPossibleToBeCollateral, true);
      assert.equal(supplyInfo.isCollateralEnabled, true);
    });

    it("should get exception if the asset pool does not exists", async () => {
      const someKey = toBytes("SOME_KEY");

      const reason = "AssetsHelperLibrary: LiquidityPool doesn't exists.";
      await truffleAssert.reverts(assetsRegistry.getSupplyAssetsInfo([someKey], USER1), reason);
    });
  });

  describe("getIntegrationSupplyAssetsInfo", async () => {
    const liquidityAmount = oneToken().times(100);
    const integrationLiquidityAmount = oneToken().times(70);
    const borrowAmount = oneToken().times(20);

    it("should return correct data", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await daiPool.approve(integrationCore.address, integrationLiquidityAmount, { from: USER1 });
      await integrationCore.addLiquidity(daiKey, integrationLiquidityAmount, { from: USER1 });

      await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 });

      const supplyInfo = (await assetsRegistry.getIntegrationSupplyAssetsInfo([daiKey], USER1))[0];

      assert.equal(supplyInfo.assetAddr, tokens[1].address);
      assert.equal(toBN(supplyInfo.supplyAPY).toString(), toBN(await daiPool.getAPY()).toString());
      assert.equal(
        toBN(supplyInfo.distributionSupplyAPY).toString(),
        toBN((await rewardsDistribution.getAPY(daiPool.address))[0]).toString()
      );

      assert.equal(toBN(supplyInfo.userSupplyBalance).toString(), integrationLiquidityAmount.toString());
      assert.equal(
        toBN(supplyInfo.userSupplyBalanceInUSD).toString(),
        convertToUSD(integrationLiquidityAmount).toString()
      );

      assert.equal(
        toBN(supplyInfo.maxSupplyValues.maxToSupply).toString(),
        liquidityAmount.minus(integrationLiquidityAmount).toString()
      );

      const currentBorrowLimit = convertToBorrowLimit(integrationLiquidityAmount, integrationColRatio);
      const expectedMaxToWithdraw = convertFromBorrowLimit(currentBorrowLimit.minus(borrowAmount), integrationColRatio);

      assert.closeTo(
        toBN(supplyInfo.maxSupplyValues.maxToWithdraw).toNumber(),
        expectedMaxToWithdraw.toNumber(),
        oneToken().idiv(10).toNumber()
      );

      assert.equal(supplyInfo.isPossibleToBeCollateral, true);
      assert.equal(supplyInfo.isCollateralEnabled, true);
    });

    it("should get exception if the asset pool does not exists", async () => {
      const someKey = toBytes("SOME_KEY");

      const reason = "AssetsHelperLibrary: LiquidityPool doesn't exists.";
      await truffleAssert.reverts(assetsRegistry.getIntegrationSupplyAssetsInfo([someKey], USER1), reason);
    });
  });

  describe("getBorrowAssetsInfo", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(50);

    it("should return correct data", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.borrow(wEthKey, borrowAmount, { from: USER1 });

      const borrowInfo = (await assetsRegistry.getBorrowAssetsInfo([wEthKey], USER1))[0];

      assert.equal(borrowInfo.assetAddr, tokens[4].address);
      assert.equal(toBN(borrowInfo.borrowAPY).toString(), toBN(await wEthPool.getAnnualBorrowRate()).toString());
      assert.equal(
        toBN(borrowInfo.distributionBorrowAPY).toString(),
        toBN((await rewardsDistribution.getAPY(wEthPool.address))[1]).toString()
      );

      assert.equal(toBN(borrowInfo.userBorrowBalance).toString(), borrowAmount.toString());
      assert.equal(toBN(borrowInfo.userBorrowBalanceInUSD).toString(), convertToUSD(borrowAmount).toString());

      assert.equal(toBN(borrowInfo.maxBorrowValues.maxToBorrow).toString(), oneToken().times(30).toString());
      assert.closeTo(
        toBN(borrowInfo.maxBorrowValues.maxToRepay).toNumber(),
        borrowAmount.toNumber(),
        oneToken().idiv(1000).toNumber()
      );

      assert.equal(
        toBN(borrowInfo.borrowPercentage).toString(),
        borrowAmount.times(decimal).idiv(liquidityAmount).toString()
      );
    });

    it("should get exception if the asset pool does not exists", async () => {
      const someKey = toBytes("SOME_KEY");

      const reason = "AssetsHelperLibrary: LiquidityPool doesn't exists.";
      await truffleAssert.reverts(assetsRegistry.getBorrowAssetsInfo([someKey], USER1), reason);
    });
  });

  describe("getIntegrationBorrowAssetsInfo", async () => {
    const liquidityAmount = oneToken().times(100);
    const integrationLiquidityAmount = oneToken().times(70);
    const borrowAmount = oneToken().times(20);

    it("should return correct data", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await daiPool.approve(integrationCore.address, integrationLiquidityAmount, { from: USER1 });
      await integrationCore.addLiquidity(daiKey, integrationLiquidityAmount, { from: USER1 });

      await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 });

      const borrowInfo = (await assetsRegistry.getIntegrationBorrowAssetsInfo([daiKey], USER1))[0];

      assert.equal(borrowInfo.borrowAssetInfo.assetAddr, tokens[1].address);
      assert.equal(
        toBN(borrowInfo.borrowAssetInfo.borrowAPY).toString(),
        toBN(await daiPool.getAnnualBorrowRate()).toString()
      );
      assert.equal(
        toBN(borrowInfo.borrowAssetInfo.distributionBorrowAPY).toString(),
        toBN((await rewardsDistribution.getAPY(daiPool.address))[1]).toString()
      );

      assert.equal(toBN(borrowInfo.borrowAssetInfo.userBorrowBalance).toString(), borrowAmount.toString());
      assert.equal(
        toBN(borrowInfo.borrowAssetInfo.userBorrowBalanceInUSD).toString(),
        convertToUSD(borrowAmount).toString()
      );

      const currentBorrowLimit = convertToBorrowLimit(integrationLiquidityAmount, integrationColRatio);

      assert.closeTo(
        toBN(borrowInfo.borrowAssetInfo.maxBorrowValues.maxToBorrow).toNumber(),
        currentBorrowLimit.minus(borrowAmount).toNumber(),
        oneToken().idiv(1000).toNumber()
      );
      assert.closeTo(
        toBN(borrowInfo.borrowAssetInfo.maxBorrowValues.maxToRepay).toNumber(),
        borrowAmount.toNumber(),
        oneToken().idiv(1000).toNumber()
      );

      assert.equal(
        toBN(borrowInfo.borrowAssetInfo.borrowPercentage).toString(),
        borrowAmount.times(decimal).idiv(liquidityAmount).toString()
      );
    });

    it("should return correct vault infos array", async () => {
      await tokens[1].setDecimals(6);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await daiPool.approve(integrationCore.address, liquidityAmount, { from: USER1 });
      await integrationCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 });
      await integrationCore.borrow(daiKey, tokens[1].address, borrowAmount.times(2), { from: USER1 });
      await integrationCore.borrow(daiKey, lpTokens[1], borrowAmount.idiv(2), { from: USER1 });

      const newDaiVaultExchangeRate = getOnePercent().times(105);
      const daiVault = await YearnVaultMock.at(await vaultRegistry.latestVault(tokens[1].address));
      await daiVault.setExchangeRate(newDaiVaultExchangeRate);

      const newBaseVaultExchangeRate = getOnePercent().times(115);
      const baseVault = await YearnVaultMock.at(await vaultRegistry.latestVault(baseToken.address));
      await baseVault.setExchangeRate(newBaseVaultExchangeRate);

      const borrowInfo = (await assetsRegistry.getIntegrationBorrowAssetsInfo([daiKey], USER1))[0];

      const vaultsInfo = borrowInfo.vaultsInfo;

      assert.equal(toBN(vaultsInfo.length).toString(), 3);

      const expectedVaults = [baseToken.address, tokens[1].address, lpTokens[1]];
      const expectedDepositedAmounts = [borrowAmount, borrowAmount.times(2), borrowAmount.idiv(2)];
      const exchangedRates = [newBaseVaultExchangeRate, newDaiVaultExchangeRate, decimal];

      for (let i = 0; i < vaultsInfo.length; i++) {
        assert.equal(vaultsInfo[i].vaultTokenAddr, expectedVaults[i]);

        const currentDepositedAmount = expectedDepositedAmounts[i];
        assert.equal(toBN(vaultsInfo[i].depositedAmount).toString(), currentDepositedAmount.toString());

        const currentReward = mulDiv(currentDepositedAmount, exchangedRates[i]).minus(currentDepositedAmount);

        assert.equal(toBN(vaultsInfo[i].currentReward).toString(), currentReward.toString());
      }
    });

    it("should get exception if the asset pool does not exists", async () => {
      const someKey = toBytes("SOME_KEY");

      const reason = "AssetsHelperLibrary: LiquidityPool doesn't exists.";
      await truffleAssert.reverts(assetsRegistry.getIntegrationSupplyAssetsInfo([someKey], USER1), reason);
    });
  });

  describe("getAssetsInfo", async () => {
    const liquidityAmount = oneToken().times(100);
    const borrowAmount = oneToken().times(50);
    const userBalance = tokensAmount.times(5);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount);
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER2 });

      await defiCore.borrow(daiKey, borrowAmount, { from: USER2 });
    });

    it("should return correct data if the flag is set on the supply", async () => {
      const assetInfo = (await assetsRegistry.getAssetsInfo([daiKey], USER1, true))[0];

      assert.equal(assetInfo.assetAddr, tokens[1].address);
      assert.equal(toBN(assetInfo.apy).toString(), toBN(await daiPool.getAPY()).toString());
      assert.equal(
        toBN(assetInfo.distributionAPY).toString(),
        toBN((await rewardsDistribution.getAPY(daiPool.address))[0]).toString()
      );

      assert.equal(toBN(assetInfo.userBalance).toString(), userBalance.toString());
      assert.equal(toBN(assetInfo.userBalanceInUSD).toString(), convertToUSD(userBalance).toString());

      assert.equal(toBN(assetInfo.poolCapacity).toString(), oneToken().times(45).toString());
      assert.equal(toBN(assetInfo.maxValue).toString(), toBN(await tokens[1].balanceOf(USER1)).toString());

      assert.equal(assetInfo.isPossibleToBeCollateral, true);
      assert.equal(assetInfo.isCollateralEnabled, true);
    });

    it("should return correct data if the flag is set on the borrow", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      const assetInfo = (await assetsRegistry.getAssetsInfo([daiKey], USER1, false))[0];

      assert.equal(assetInfo.assetAddr, tokens[1].address);
      assert.equal(toBN(assetInfo.apy).toString(), toBN(await daiPool.getAnnualBorrowRate()).toString());
      assert.equal(
        toBN(assetInfo.distributionAPY).toString(),
        toBN((await rewardsDistribution.getAPY(daiPool.address))[1]).toString()
      );

      assert.equal(toBN(assetInfo.userBalance).toString(), userBalance.minus(liquidityAmount).toString());
      assert.equal(
        toBN(assetInfo.userBalanceInUSD).toString(),
        convertToUSD(userBalance.minus(liquidityAmount)).toString()
      );

      assert.equal(toBN(assetInfo.poolCapacity).toString(), oneToken().times(140).toString());
      assert.equal(toBN(assetInfo.maxValue).toString(), oneToken().times(80).toString());

      assert.equal(assetInfo.isPossibleToBeCollateral, true);
      assert.equal(assetInfo.isCollateralEnabled, true);
    });
  });

  describe("getIntegrationAssetsInfo", async () => {
    const liquidityAmount = oneToken().times(100);
    const integrationLiquidityAmount = oneToken().times(70);
    const borrowAmount = oneToken().times(50);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await daiPool.approve(integrationCore.address, liquidityAmount, { from: USER1 });
      await integrationCore.addLiquidity(daiKey, integrationLiquidityAmount, { from: USER1 });
      await integrationCore.borrow(daiKey, baseToken.address, borrowAmount, { from: USER1 });
    });

    it("should return correct data if the flag is set on the supply", async () => {
      const assetInfo = (await assetsRegistry.getIntegrationAssetsInfo([daiKey], USER1, true))[0];

      assert.equal(assetInfo.assetAddr, tokens[1].address);
      assert.equal(toBN(assetInfo.apy).toString(), toBN(await daiPool.getAPY()).toString());
      assert.equal(
        toBN(assetInfo.distributionAPY).toString(),
        toBN((await rewardsDistribution.getAPY(daiPool.address))[0]).toString()
      );

      const expectedUserBalance = liquidityAmount.minus(integrationLiquidityAmount);

      assert.equal(toBN(assetInfo.userBalance).toString(), expectedUserBalance.toString());
      assert.equal(toBN(assetInfo.userBalanceInUSD).toString(), convertToUSD(expectedUserBalance).toString());

      assert.equal(toBN(assetInfo.poolCapacity).toString(), oneToken().times(45).toString());
      assert.equal(
        toBN(assetInfo.maxValue).toString(),
        toBN(await integrationCore.getMaxToSupply(USER1, daiKey)).toString()
      );

      assert.equal(assetInfo.isPossibleToBeCollateral, true);
      assert.equal(assetInfo.isCollateralEnabled, true);
    });

    it("should return correct data if the flag is set on the borrow", async () => {
      const assetInfo = (await assetsRegistry.getIntegrationAssetsInfo([daiKey], USER1, false))[0];

      assert.equal(assetInfo.assetAddr, tokens[1].address);
      assert.equal(toBN(assetInfo.apy).toString(), toBN(await daiPool.getAnnualBorrowRate()).toString());
      assert.equal(
        toBN(assetInfo.distributionAPY).toString(),
        toBN((await rewardsDistribution.getAPY(daiPool.address))[1]).toString()
      );

      const expectedUserBalance = liquidityAmount.minus(integrationLiquidityAmount);

      assert.equal(toBN(assetInfo.userBalance).toString(), expectedUserBalance.toString());
      assert.equal(toBN(assetInfo.userBalanceInUSD).toString(), convertToUSD(expectedUserBalance).toString());

      assert.equal(toBN(assetInfo.poolCapacity).toString(), oneToken().times(45).toString());
      assert.equal(
        toBN(assetInfo.maxValue).toString(),
        toBN(await integrationCore.getMaxToBorrow(USER1, daiKey)).toString()
      );

      assert.equal(assetInfo.isPossibleToBeCollateral, true);
      assert.equal(assetInfo.isCollateralEnabled, true);
    });

    it("should get exception if the asset pool does not exists", async () => {
      const someKey = toBytes("SOME_KEY");

      const reason = "AssetsHelperLibrary: LiquidityPool doesn't exists.";
      await truffleAssert.reverts(assetsRegistry.getIntegrationAssetsInfo([someKey], USER1, true), reason);
    });
  });
});
