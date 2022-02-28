const Registry = artifacts.require("Registry");
const SystemParameters = artifacts.require("SystemParameters");
const AssetParameters = artifacts.require("AssetParameters");
const DefiCore = artifacts.require("DefiCore");
const LiquidityPool = artifacts.require("LiquidityPool");
const LiquidityPoolFactory = artifacts.require("LiquidityPoolFactory");
const LiquidityPoolAdmin = artifacts.require("LiquidityPoolAdmin");
const LiquidityPoolRegistry = artifacts.require("LiquidityPoolRegistry");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const RewardsDistribution = artifacts.require("RewardsDistribution");
const AssetsRegistry = artifacts.require("AssetsRegistry");
const PriceManager = artifacts.require("PriceManager");

const IntegrationCore = artifacts.require("IntegrationCore");
const BorrowerRouter = artifacts.require("BorrowerRouterMock");
const BorrowerRouterRegistry = artifacts.require("BorrowerRouterRegistry");
const BorrowerRouterFactory = artifacts.require("BorrowerRouterFactory");

const { logTransaction } = require("./helpers/logger.js");
const { getInterestRateLibraryData, getTokensAddresses } = require("./helpers/deployHelper.js");

module.exports = async (deployer) => {
  const tokensAddresses = getTokensAddresses();

  await deployer.deploy(Registry);
  const registry = await Registry.deployed();

  await deployer.deploy(SystemParameters);
  const systemParameters = await SystemParameters.deployed();

  await deployer.deploy(AssetParameters);
  const assetParameters = await AssetParameters.deployed();

  await deployer.deploy(DefiCore);
  const defiCore = await DefiCore.deployed();

  await deployer.deploy(LiquidityPoolFactory);
  const liquidityPoolFactory = await LiquidityPoolFactory.deployed();

  await deployer.deploy(
    InterestRateLibrary,
    getInterestRateLibraryData("scripts/InterestRatesExactData.txt"),
    getInterestRateLibraryData("scripts/InterestRatesData.txt")
  );
  const interestRateLibrary = await InterestRateLibrary.deployed();

  await deployer.deploy(RewardsDistribution);
  const rewardsDistribution = await RewardsDistribution.deployed();

  await deployer.deploy(AssetsRegistry);
  const assetsRegistry = await AssetsRegistry.deployed();

  await deployer.deploy(PriceManager);
  const priceManager = await PriceManager.deployed();

  await deployer.deploy(LiquidityPool);

  await deployer.deploy(LiquidityPoolAdmin);
  const liquidityPoolAdmin = await LiquidityPoolAdmin.deployed();

  await deployer.deploy(LiquidityPoolRegistry);
  const liquidityPoolRegistry = await LiquidityPoolRegistry.deployed();

  await deployer.deploy(IntegrationCore);
  const integrationCore = await IntegrationCore.deployed();

  await deployer.deploy(BorrowerRouter);

  await deployer.deploy(BorrowerRouterRegistry);
  const borrowerRouterRegistry = await BorrowerRouterRegistry.deployed();

  await deployer.deploy(BorrowerRouterFactory);
  const borrowerRouterFactory = await BorrowerRouterFactory.deployed();

  logTransaction(
    await registry.addProxyContract(await registry.SYSTEM_PARAMETERS_NAME(), systemParameters.address),
    "Add SystemParameters contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.ASSET_PARAMETERS_NAME(), assetParameters.address),
    "Add AssetParameters contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.DEFI_CORE_NAME(), defiCore.address),
    "Add DefiCore contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_FACTORY_NAME(), liquidityPoolFactory.address),
    "Add LiquidityPoolFactory contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.REWARDS_DISTRIBUTION_NAME(), rewardsDistribution.address),
    "Add RewardsDistribution contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.ASSETS_REGISTRY_NAME(), assetsRegistry.address),
    "Add AssetsRegistry contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), priceManager.address),
    "Add PriceManager contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_ADMIN_NAME(), liquidityPoolAdmin.address),
    "Add LiquidityPoolAdmin contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_REGISTRY_NAME(), liquidityPoolRegistry.address),
    "Add LiquidityPoolRegistry contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.INTEGRATION_CORE_NAME(), integrationCore.address),
    "Add IntegrationCore contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.BORROWER_ROUTER_REGISTRY_NAME(), borrowerRouterRegistry.address),
    "Add BorrowerRouterRegistry contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.BORROWER_ROUTER_FACTORY_NAME(), borrowerRouterFactory.address),
    "Add BorrowerRouterFactory contract proxy to the registry"
  );

  console.log();

  logTransaction(
    await registry.addContract(await registry.INTEREST_RATE_LIBRARY_NAME(), interestRateLibrary.address),
    "Add InterestRateLibrary contract to the registry"
  );

  logTransaction(
    await registry.addContract(await registry.GOVERNANCE_TOKEN_NAME(), tokensAddresses[0]),
    "Add GovernanceToken contract to the registry"
  );
};
