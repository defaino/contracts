const SystemParameters = artifacts.require("SystemParameters");
const AssetParameters = artifacts.require("AssetParameters");
const DefiCore = artifacts.require("DefiCore");
const LiquidityPool = artifacts.require("LiquidityPool");
const LiquidityPoolMock = artifacts.require("LiquidityPoolMock");
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

const { advanceBlockAtTime } = require("./helpers/ganacheTimeTraveler");
const { toBytes } = require("./helpers/bytesCompareLibrary");
const Reverter = require("./helpers/reverter");
const { assert } = require("chai");

const { getInterestRateLibraryData } = require("../migrations/helpers/deployHelper");
const { toBN } = require("../scripts/globals");

const setCurrentTime = advanceBlockAtTime;
const truffleAssert = require("truffle-assertions");

contract("LiquidityPoolAdmin", async (accounts) => {
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
  let priceManager;
  let liquidityPoolAdmin;
  let liquidityPoolRegistry;

  let liquidityPoolImpl;

  let daiPool;

  const tokens = [];

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
  const liquidationDiscount = onePercent.times(8);
  const liquidationBoundary = onePercent.times(50);

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

  before("setup", async () => {
    const governanceToken = await GovernanceToken.new(OWNER);
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
    rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());
    priceManager = await PriceManager.at(await registry.getPriceManagerContract());
    liquidityPoolAdmin = await LiquidityPoolAdmin.at(await registry.getLiquidityPoolAdminContract());
    liquidityPoolRegistry = await LiquidityPoolRegistry.at(await registry.getLiquidityPoolRegistryContract());

    const systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());
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
    await liquidityPoolRegistry.liquidityPoolRegistryInitialize();
    await rewardsDistribution.rewardsDistributionInitialize();
    await priceManager.priceManagerInitialize(daiKey, tokens[1].address);
    await liquidityPoolAdmin.liquidityPoolAdminInitialize(_liquidityPoolImpl.address);
    await borrowerRouterRegistry.borrowerRouterRegistryInitialize(_borrowerRouterImpl.address);

    liquidityPoolImpl = _liquidityPoolImpl;

    await setCurrentTime(1);

    await deployGovernancePool(governanceToken.address, await governanceToken.symbol());

    daiChainlinkOracle = await createLiquidityPool(daiKey, tokens[1], "DAI", true);
    wEthChainlinkOracle = await createLiquidityPool(wEthKey, tokens[2], "WETH", true);
    usdtChainlinkOracle = await createLiquidityPool(usdtKey, tokens[3], "USDT", false);

    daiPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(daiKey));

    await systemParameters.setupLiquidationBoundary(liquidationBoundary);

    await rewardsDistribution.setupRewardsPerBlockBatch(
      [daiKey, wEthKey, usdtKey, governanceTokenKey],
      [oneToken.times(2), oneToken, oneToken.times(5), oneToken]
    );

    await governanceToken.transfer(defiCore.address, tokensAmount.times(10));

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("getImplementationOfLiquidityPool", async () => {
    it("should return correct implementation of liquidity pool", async () => {
      assert.equal(
        await liquidityPoolAdmin.getImplementationOfLiquidityPool.call(daiPool.address),
        liquidityPoolImpl.address
      );
    });
  });

  describe("getCurrentLiquidityPoolsImplementation", async () => {
    it("should return current liquidity pool implementation", async () => {
      assert.equal(await liquidityPoolAdmin.getCurrentLiquidityPoolsImplementation(), liquidityPoolImpl.address);
    });
  });

  describe("upgradeLiquidityPools", async () => {
    it("should correctly update liquidity pools", async () => {
      const newImplementation = await LiquidityPoolMock.new();

      await truffleAssert.reverts(
        (await LiquidityPoolMock.at(daiPool.address)).getNormalizedAmount(10, 10, 10, 50, true)
      );

      await liquidityPoolAdmin.upgradeLiquidityPools(newImplementation.address);

      assert.equal(
        await liquidityPoolAdmin.getImplementationOfLiquidityPool.call(daiPool.address),
        newImplementation.address
      );
      assert.equal(await liquidityPoolAdmin.getCurrentLiquidityPoolsImplementation(), newImplementation.address);

      const newDaiPool = await LiquidityPoolMock.at(daiPool.address);
      await newDaiPool.getNormalizedAmount(10, 100, 100, 50, true);
    });
  });
});
