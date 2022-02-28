const Registry = artifacts.require("Registry");
const SystemParameters = artifacts.require("SystemParameters");
const AssetParameters = artifacts.require("AssetParameters");
const LiquidityPool = artifacts.require("LiquidityPool");
const LiquidityPoolAdmin = artifacts.require("LiquidityPoolAdmin");
const LiquidityPoolRegistry = artifacts.require("LiquidityPoolRegistry");
const RewardsDistribution = artifacts.require("RewardsDistribution");
const PriceManager = artifacts.require("PriceManager");

const IntegrationCore = artifacts.require("IntegrationCore");
const BorrowerRouter = artifacts.require("BorrowerRouterMock");
const BorrowerRouterRegistry = artifacts.require("BorrowerRouterRegistry");
const BorrowerRouterFactory = artifacts.require("BorrowerRouterFactory");

const { logTransaction, logAddress } = require("./helpers/logger.js");
const { getAssetKeys, getTokensAddresses } = require("./helpers/deployHelper.js");

module.exports = async (deployer) => {
  const registry = await Registry.deployed();

  const systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());
  const assetParameters = await AssetParameters.at(await registry.getAssetParametersContract());
  const rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());
  const priceManager = await PriceManager.at(await registry.getPriceManagerContract());
  const liquidityPoolAdmin = await LiquidityPoolAdmin.at(await registry.getLiquidityPoolAdminContract());
  const liquidityPoolRegistry = await LiquidityPoolRegistry.at(await registry.getLiquidityPoolRegistryContract());
  const integrationCore = await IntegrationCore.at(await registry.getIntegrationCoreContract());
  const borrowerRouterRegistry = await BorrowerRouterRegistry.at(await registry.getBorrowerRouterRegistryContract());
  const borrowerRouterFactory = await BorrowerRouterFactory.at(await registry.getBorrowerRouterFactoryContract());

  logTransaction(await systemParameters.systemParametersInitialize(), "Init SystemParameters");
  logTransaction(await assetParameters.assetParametersInitialize(), "Init AssetParameters");
  logTransaction(await rewardsDistribution.rewardsDistributionInitialize(), "Init RewardsDistribution");
  logTransaction(
    await priceManager.priceManagerInitialize(getAssetKeys()[1], getTokensAddresses()[1]),
    "Init PriceManager"
  );
  logTransaction(
    await liquidityPoolAdmin.liquidityPoolAdminInitialize((await LiquidityPool.deployed()).address),
    "Init LiquidityPoolAdmin"
  );
  logTransaction(await liquidityPoolRegistry.liquidityPoolRegistryInitialize(), "Init LiquidityPoolRegistry");
  logTransaction(
    await borrowerRouterRegistry.borrowerRouterRegistryInitialize((await BorrowerRouter.deployed()).address),
    "Init BorrowerRouterRegistry"
  );

  console.log();

  logTransaction(await registry.injectDependencies(await registry.DEFI_CORE_NAME()), "Inject DefiCore");
  logTransaction(await registry.injectDependencies(await registry.ASSET_PARAMETERS_NAME()), "Inject AssetParameters");
  logTransaction(
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_FACTORY_NAME()),
    "Inject LiquidityPoolFactory"
  );
  logTransaction(
    await registry.injectDependencies(await registry.REWARDS_DISTRIBUTION_NAME()),
    "Inject RewardsDistribution"
  );
  logTransaction(await registry.injectDependencies(await registry.ASSETS_REGISTRY_NAME()), "Inject AssetsRegistry");
  logTransaction(await registry.injectDependencies(await registry.PRICE_MANAGER_NAME()), "Inject PriceManager");
  logTransaction(
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_ADMIN_NAME()),
    "Inject LiquidityPoolAdmin"
  );
  logTransaction(
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_REGISTRY_NAME()),
    "Inject LiquidityPoolRegistry"
  );
  logTransaction(await registry.injectDependencies(await registry.INTEGRATION_CORE_NAME()), "Inject IntegrationCore");
  logTransaction(
    await registry.injectDependencies(await registry.BORROWER_ROUTER_REGISTRY_NAME()),
    "Inject BorrowerRouterRegistry"
  );
  logTransaction(
    await registry.injectDependencies(await registry.BORROWER_ROUTER_FACTORY_NAME()),
    "Inject BorrowerRouterFactory"
  );

  console.log("\n+--------------------------------------------------------------------------------+\n");

  logAddress("Registry", registry.address);

  logAddress("SystemParameters", systemParameters.address);
  logAddress("AssetParameters", assetParameters.address);

  logAddress("AssetsRegistry", await registry.getAssetsRegistryContract());

  logAddress("DefiCore", await registry.getDefiCoreContract());
  logAddress("RewardsDistribution", rewardsDistribution.address);
  logAddress("PriceManager", priceManager.address);

  logAddress("LiquidityPoolFactory", await registry.getLiquidityPoolFactoryContract());
  logAddress("LiquidityPoolAdmin", liquidityPoolAdmin.address);
  logAddress("LiquidityPoolRegistry", liquidityPoolRegistry.address);

  logAddress("IntegrationCore", integrationCore.address);
  logAddress("BorrowerRouterRegistry", borrowerRouterRegistry.address);
  logAddress("BorrowerRouterFactory", borrowerRouterFactory.address);

  logAddress("InterestRateLibrary", await registry.getInterestRateLibraryContract());
  logAddress("GovernanceToken", await registry.getGovernanceTokenContract());

  console.log("+--------------------------------------------------------------------------------+");
};
