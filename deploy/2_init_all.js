const Registry = artifacts.require("Registry");
const DefiCore = artifacts.require("DefiCore");
const SystemParameters = artifacts.require("SystemParameters");
const SystemPoolsRegistry = artifacts.require("SystemPoolsRegistry");
const LiquidityPool = artifacts.require("LiquidityPool");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const Prt = artifacts.require("PRT");

const {
  parsePrtData,
  getAssetKey,
  isStablePoolsAvailable,
  nativeAssetSymbol,
  rewardsAssetSymbol,
  rewardsAssetToken,
} = require("./helpers/deployHelper.js");

module.exports = async (deployer, logger) => {
  const registry = await Registry.deployed();
  const defiCore = await DefiCore.at(await registry.getDefiCoreContract());
  const systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());
  const systemPoolsRegistry = await SystemPoolsRegistry.at(await registry.getSystemPoolsRegistryContract());
  const interestRateLibrary = await InterestRateLibrary.at(await registry.getInterestRateLibraryContract());
  const prt = await Prt.at(await registry.getPRTContract());

  const rewardsAssetKey = getAssetKey(rewardsAssetSymbol());
  const nativeTokenKey = getAssetKey(nativeAssetSymbol());

  const prtArr = parsePrtData("deploy/data/prtData.json");

  console.log();

  logger.logTransaction(await defiCore.defiCoreInitialize(), "Init DefiCore");
  logger.logTransaction(await prt.prtInitialize(prtArr.name, prtArr.symbol, prtArr.prtParams), "Init PRT");
  logger.logTransaction(
    await systemPoolsRegistry.systemPoolsRegistryInitialize(
      (
        await LiquidityPool.deployed()
      ).address,
      nativeTokenKey,
      rewardsAssetKey
    ),
    "Init SystemPoolsRegistry"
  );

  console.log();

  logger.logTransaction(await registry.injectDependencies(await registry.DEFI_CORE_NAME()), "Inject DefiCore");
  logger.logTransaction(
    await registry.injectDependencies(await registry.SYSTEM_PARAMETERS_NAME()),
    "Inject SystemParameters"
  );
  logger.logTransaction(
    await registry.injectDependencies(await registry.ASSET_PARAMETERS_NAME()),
    "Inject AssetParameters"
  );
  logger.logTransaction(
    await registry.injectDependencies(await registry.REWARDS_DISTRIBUTION_NAME()),
    "Inject RewardsDistribution"
  );
  logger.logTransaction(
    await registry.injectDependencies(await registry.USER_INFO_REGISTRY_NAME()),
    "Inject UserInfoRegistry"
  );
  logger.logTransaction(
    await registry.injectDependencies(await registry.SYSTEM_POOLS_REGISTRY_NAME()),
    "Inject SystemPoolsRegistry"
  );
  logger.logTransaction(
    await registry.injectDependencies(await registry.SYSTEM_POOLS_FACTORY_NAME()),
    "Inject SystemPoolsFactory"
  );
  logger.logTransaction(await registry.injectDependencies(await registry.PRICE_MANAGER_NAME()), "Inject PriceManager");

  logger.logTransaction(await registry.injectDependencies(await registry.PRT_NAME()), "Inject PRT");

  if (isStablePoolsAvailable()) {
    logger.logTransaction(await systemParameters.setupStablePoolsAvailability(true), "Allow add stable pools");

    logger.logTransaction(
      await systemPoolsRegistry.addPoolsBeacon(1, (await StablePool.deployed()).address),
      "Add beacon proxy for StablePool type"
    );
  }

  let rewardsAssetAddress = "0x0000000000000000000000000000000000000000";

  if (rewardsAssetSymbol() !== "") {
    rewardsAssetAddress = rewardsAssetToken();

    logger.logTransaction(
      await systemParameters.setRewardsTokenAddress(rewardsAssetAddress),
      "Set rewards token address"
    );
  }

  console.log("\n+--------------------------------------------------------------------------------+\n");

  logger.logContracts(
    ["Registry", registry.address],
    ["SystemParameters", systemParameters.address],
    ["AssetParameters", await registry.getAssetParametersContract()],
    ["DefiCore", await registry.getDefiCoreContract()],
    ["RewardsDistribution", await registry.getRewardsDistributionContract()],
    ["UserInfoRegistry", await registry.getUserInfoRegistryContract()],
    ["SystemPoolsRegistry", systemPoolsRegistry.address],
    ["SystemPoolsFactory", await registry.getSystemPoolsFactoryContract()],
    ["PriceManager", await registry.getPriceManagerContract()],
    ["InterestRateLibrary", interestRateLibrary.address],
    ["RewardsToken", rewardsAssetAddress],
    ["PRT", prt.address]
  );

  console.log("+--------------------------------------------------------------------------------+");
};
