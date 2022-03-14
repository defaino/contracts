const Registry = artifacts.require("Registry");
const SystemParameters = artifacts.require("SystemParameters");
const AssetParameters = artifacts.require("AssetParameters");
const DefiCore = artifacts.require("DefiCore");
const LiquidityPool = artifacts.require("LiquidityPool");
const LiquidityPoolFactory = artifacts.require("LiquidityPoolFactory");
const LiquidityPoolRegistry = artifacts.require("LiquidityPoolRegistry");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const RewardsDistribution = artifacts.require("RewardsDistribution");
const UserInfoRegistry = artifacts.require("UserInfoRegistry");
const PriceManager = artifacts.require("PriceManager");

const { logTransaction } = require("../runners/logger.js");
const { getInterestRateLibraryData, parsePoolsData } = require("../helpers/deployHelper.js");

module.exports = async (deployer) => {
  const dataArr = parsePoolsData("deploy/data/poolsData.json");

  await deployer.deploy(Registry);
  const registry = await Registry.deployed();

  await deployer.deploy(DefiCore);
  const defiCore = await DefiCore.deployed();

  await deployer.deploy(SystemParameters);
  const systemParameters = await SystemParameters.deployed();

  await deployer.deploy(AssetParameters);
  const assetParameters = await AssetParameters.deployed();

  await deployer.deploy(RewardsDistribution);
  const rewardsDistribution = await RewardsDistribution.deployed();

  await deployer.deploy(UserInfoRegistry);
  const userInfoRegistry = await UserInfoRegistry.deployed();

  await deployer.deploy(LiquidityPoolRegistry);
  const liquidityPoolRegistry = await LiquidityPoolRegistry.deployed();

  await deployer.deploy(LiquidityPoolFactory);
  const liquidityPoolFactory = await LiquidityPoolFactory.deployed();

  await deployer.deploy(LiquidityPool);

  await deployer.deploy(PriceManager);
  const priceManager = await PriceManager.deployed();

  await deployer.deploy(InterestRateLibrary, getInterestRateLibraryData("deploy/data/InterestRatesExactData.txt"));
  const interestRateLibrary = await InterestRateLibrary.deployed();

  logTransaction(
    await registry.addProxyContract(await registry.DEFI_CORE_NAME(), defiCore.address),
    "Add DefiCore contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.SYSTEM_PARAMETERS_NAME(), systemParameters.address),
    "Add SystemParameters contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.ASSET_PARAMETERS_NAME(), assetParameters.address),
    "Add AssetParameters contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.REWARDS_DISTRIBUTION_NAME(), rewardsDistribution.address),
    "Add RewardsDistribution contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.USER_INFO_REGISTRY_NAME(), userInfoRegistry.address),
    "Add UserInfoRegistry contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_REGISTRY_NAME(), liquidityPoolRegistry.address),
    "Add LiquidityPoolRegistry contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_FACTORY_NAME(), liquidityPoolFactory.address),
    "Add LiquidityPoolFactory contract proxy to the registry"
  );

  logTransaction(
    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), priceManager.address),
    "Add PriceManager contract proxy to the registry"
  );

  console.log();

  logTransaction(
    await registry.addContract(await registry.INTEREST_RATE_LIBRARY_NAME(), interestRateLibrary.address),
    "Add InterestRateLibrary contract to the registry"
  );

  logTransaction(
    await registry.addContract(await registry.GOVERNANCE_TOKEN_NAME(), dataArr[0].assetAddr),
    "Add GovernanceToken contract to the registry"
  );

  console.log("+--------------------------------------------------------------------------------+");
};
