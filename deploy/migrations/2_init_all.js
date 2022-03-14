const Registry = artifacts.require("Registry");
const SystemParameters = artifacts.require("SystemParameters");
const AssetParameters = artifacts.require("AssetParameters");
const RewardsDistribution = artifacts.require("RewardsDistribution");
const LiquidityPoolRegistry = artifacts.require("LiquidityPoolRegistry");
const LiquidityPool = artifacts.require("LiquidityPool");
const PriceManager = artifacts.require("PriceManager");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");

const { logTransaction, logAddress } = require("../runners/logger.js");
const { getAssetKey, parsePoolsData, getInterestRateLibraryData } = require("../helpers/deployHelper.js");

module.exports = async (deployer) => {
  const dataArr = parsePoolsData("deploy/data/poolsData.json");

  const registry = await Registry.deployed();

  const systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());
  const assetParameters = await AssetParameters.at(await registry.getAssetParametersContract());
  const rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());
  const priceManager = await PriceManager.at(await registry.getPriceManagerContract());
  const liquidityPoolRegistry = await LiquidityPoolRegistry.at(await registry.getLiquidityPoolRegistryContract());
  const interestRateLibrary = await InterestRateLibrary.at(await registry.getInterestRateLibraryContract());

  console.log();

  logTransaction(await systemParameters.systemParametersInitialize(), "Init SystemParameters");
  logTransaction(await assetParameters.assetParametersInitialize(), "Init AssetParameters");
  logTransaction(await rewardsDistribution.rewardsDistributionInitialize(), "Init RewardsDistribution");
  logTransaction(
    await priceManager.priceManagerInitialize(getAssetKey(dataArr[1].symbol), dataArr[1].assetAddr),
    "Init PriceManager"
  );
  logTransaction(
    await liquidityPoolRegistry.liquidityPoolRegistryInitialize((await LiquidityPool.deployed()).address),
    "Init LiquidityPoolRegistry"
  );

  console.log();

  logTransaction(await registry.injectDependencies(await registry.DEFI_CORE_NAME()), "Inject DefiCore");
  logTransaction(await registry.injectDependencies(await registry.ASSET_PARAMETERS_NAME()), "Inject AssetParameters");
  logTransaction(
    await registry.injectDependencies(await registry.REWARDS_DISTRIBUTION_NAME()),
    "Inject RewardsDistribution"
  );
  logTransaction(
    await registry.injectDependencies(await registry.USER_INFO_REGISTRY_NAME()),
    "Inject UserInfoRegistry"
  );
  logTransaction(
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_REGISTRY_NAME()),
    "Inject LiquidityPoolRegistry"
  );
  logTransaction(
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_FACTORY_NAME()),
    "Inject LiquidityPoolFactory"
  );
  logTransaction(await registry.injectDependencies(await registry.PRICE_MANAGER_NAME()), "Inject PriceManager");

  logTransaction(
    await interestRateLibrary.addNewRates(
      100, // Start percentage
      getInterestRateLibraryData("deploy/data/InterestRatesData.txt")
    ),
    "Add rates to Interest rate library"
  );

  console.log("\n+--------------------------------------------------------------------------------+\n");

  logAddress("Registry", registry.address);

  logAddress("SystemParameters", systemParameters.address);
  logAddress("AssetParameters", assetParameters.address);

  logAddress("DefiCore", await registry.getDefiCoreContract());
  logAddress("RewardsDistribution", rewardsDistribution.address);
  logAddress("UserInfoRegistry", await registry.getUserInfoRegistryContract());
  logAddress("LiquidityPoolRegistry", liquidityPoolRegistry.address);
  logAddress("LiquidityPoolFactory", await registry.getLiquidityPoolFactoryContract());
  logAddress("PriceManager", priceManager.address);

  logAddress("InterestRateLibrary", interestRateLibrary.address);
  logAddress("GovernanceToken", await registry.getGovernanceTokenContract());

  console.log("+--------------------------------------------------------------------------------+");
};
