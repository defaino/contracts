const Registry = artifacts.require("Registry");
const SystemParameters = artifacts.require("SystemParameters");
const AssetParameters = artifacts.require("AssetParameters");
const DefiCore = artifacts.require("DefiCore");
const LiquidityPool = artifacts.require("LiquidityPool");
const StablePool = artifacts.require("StablePool");
const SystemPoolsFactory = artifacts.require("SystemPoolsFactory");
const SystemPoolsRegistry = artifacts.require("SystemPoolsRegistry");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const RewardsDistribution = artifacts.require("RewardsDistribution");
const UserInfoRegistry = artifacts.require("UserInfoRegistry");
const PriceManager = artifacts.require("PriceManager");
const Prt = artifacts.require("PRT");
const RoleManager = artifacts.require("RoleManager");

const { artifacts } = require("hardhat");
const { isStablePoolsAvailable } = require("./helpers/deployHelper.js");

require("dotenv").config();

module.exports = async (deployer, logger) => {
  let registry;

  if (process.env.REGISTRY === "") {
    await deployer.deploy(Registry);
    registry = await Registry.deployed();

    logger.logTransaction(await registry.__OwnableContractsRegistry_init(), "Init Registry contract");
  } else {
    registry = await Registry.at(process.env.REGISTRY);

    await deployer.setAsDeployed(Registry, registry);
  }

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

  await deployer.deploy(SystemPoolsRegistry);
  const systemPoolsRegistry = await SystemPoolsRegistry.deployed();

  await deployer.deploy(SystemPoolsFactory);
  const systemPoolsFactory = await SystemPoolsFactory.deployed();

  await deployer.deploy(Prt);
  const prt = await Prt.deployed();

  await deployer.deploy(RoleManager);
  const roleManager = await RoleManager.deployed();

  await deployer.deploy(LiquidityPool);

  if (isStablePoolsAvailable()) {
    await deployer.deploy(StablePool);
  }

  await deployer.deploy(PriceManager);
  const priceManager = await PriceManager.deployed();

  await deployer.deploy(InterestRateLibrary);
  const interestRateLibrary = await InterestRateLibrary.deployed();

  logger.logTransaction(
    await registry.addProxyContract(await registry.DEFI_CORE_NAME(), defiCore.address),
    "Add DefiCore contract proxy to the registry"
  );

  logger.logTransaction(
    await registry.addProxyContract(await registry.SYSTEM_PARAMETERS_NAME(), systemParameters.address),
    "Add SystemParameters contract proxy to the registry"
  );

  logger.logTransaction(
    await registry.addProxyContract(await registry.ASSET_PARAMETERS_NAME(), assetParameters.address),
    "Add AssetParameters contract proxy to the registry"
  );

  logger.logTransaction(
    await registry.addProxyContract(await registry.REWARDS_DISTRIBUTION_NAME(), rewardsDistribution.address),
    "Add RewardsDistribution contract proxy to the registry"
  );

  logger.logTransaction(
    await registry.addProxyContract(await registry.USER_INFO_REGISTRY_NAME(), userInfoRegistry.address),
    "Add UserInfoRegistry contract proxy to the registry"
  );

  logger.logTransaction(
    await registry.addProxyContract(await registry.SYSTEM_POOLS_REGISTRY_NAME(), systemPoolsRegistry.address),
    "Add SystemPoolsRegistry contract proxy to the registry"
  );

  logger.logTransaction(
    await registry.addProxyContract(await registry.SYSTEM_POOLS_FACTORY_NAME(), systemPoolsFactory.address),
    "Add SystemPoolsFactory contract proxy to the registry"
  );

  logger.logTransaction(
    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), priceManager.address),
    "Add PriceManager contract proxy to the registry"
  );

  logger.logTransaction(
    await registry.addProxyContract(await registry.PRT_NAME(), prt.address),
    "Add Prt contract proxy to the registry"
  );

  logger.logTransaction(
    await registry.addProxyContract(await registry.ROLE_MANAGER_NAME(), roleManager.address),
    "Add RoleManager contract proxy to the registry"
  );

  console.log();

  logger.logTransaction(
    await registry.addContract(await registry.INTEREST_RATE_LIBRARY_NAME(), interestRateLibrary.address),
    "Add InterestRateLibrary contract to the registry"
  );

  console.log("+--------------------------------------------------------------------------------+");
};
