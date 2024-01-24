import { Deployer, Reporter } from "@solarity/hardhat-migrate";

import { parseConfig, Config } from "@/deploy/helpers/configParser";

import {
  Registry__factory,
  DefiCore__factory,
  SystemParameters__factory,
  AssetParameters__factory,
  RewardsDistribution__factory,
  UserInfoRegistry__factory,
  SystemPoolsRegistry__factory,
  SystemPoolsFactory__factory,
  PRT__factory,
  LiquidityPool__factory,
  StablePool__factory,
  PriceManager__factory,
  InterestRateLibrary__factory,
} from "@/generated-types/ethers";

export = async (deployer: Deployer) => {
  const config: Config = parseConfig();

  const registry = await deployer.deploy(Registry__factory);
  await registry.__OwnableContractsRegistry_init();

  const defiCore = await deployer.deploy(DefiCore__factory);
  const systemParameters = await deployer.deploy(SystemParameters__factory);
  const assetParameters = await deployer.deploy(AssetParameters__factory);

  const rewardsDistribution = await deployer.deploy(
    RewardsDistribution__factory
  );
  const userInfoRegistry = await deployer.deploy(UserInfoRegistry__factory);
  const systemPoolsRegistry = await deployer.deploy(
    SystemPoolsRegistry__factory
  );
  const systemPoolsFactory = await deployer.deploy(SystemPoolsFactory__factory);
  const prt = await deployer.deploy(PRT__factory);

  await deployer.deploy(LiquidityPool__factory);

  if (config.isStablePoolsAvailable) {
    await deployer.deploy(StablePool__factory);
  }

  const priceManager = await deployer.deploy(PriceManager__factory);
  const interestRateLibrary = await deployer.deploy(
    InterestRateLibrary__factory
  );

  await registry.addProxyContract(
    await registry.DEFI_CORE_NAME(),
    defiCore.address
  );
  await registry.addProxyContract(
    await registry.SYSTEM_PARAMETERS_NAME(),
    systemParameters.address
  );
  await registry.addProxyContract(
    await registry.ASSET_PARAMETERS_NAME(),
    assetParameters.address
  );
  await registry.addProxyContract(
    await registry.REWARDS_DISTRIBUTION_NAME(),
    rewardsDistribution.address
  );
  await registry.addProxyContract(
    await registry.USER_INFO_REGISTRY_NAME(),
    userInfoRegistry.address
  );
  await registry.addProxyContract(
    await registry.SYSTEM_POOLS_REGISTRY_NAME(),
    systemPoolsRegistry.address
  );
  await registry.addProxyContract(
    await registry.SYSTEM_POOLS_FACTORY_NAME(),
    systemPoolsFactory.address
  );
  await registry.addProxyContract(
    await registry.PRICE_MANAGER_NAME(),
    priceManager.address
  );
  await registry.addProxyContract(await registry.PRT_NAME(), prt.address);

  await registry.addContract(
    await registry.INTEREST_RATE_LIBRARY_NAME(),
    interestRateLibrary.address
  );

  Reporter.reportContracts(
    [await registry.DEFI_CORE_NAME(), defiCore.address],
    [await registry.SYSTEM_PARAMETERS_NAME(), systemParameters.address],
    [await registry.ASSET_PARAMETERS_NAME(), assetParameters.address],
    [await registry.REWARDS_DISTRIBUTION_NAME(), rewardsDistribution.address],
    [await registry.USER_INFO_REGISTRY_NAME(), userInfoRegistry.address],
    [await registry.SYSTEM_POOLS_REGISTRY_NAME(), systemPoolsRegistry.address],
    [await registry.SYSTEM_POOLS_FACTORY_NAME(), systemPoolsFactory.address],
    [await registry.PRICE_MANAGER_NAME(), priceManager.address],
    [await registry.PRT_NAME(), prt.address],
    [await registry.INTEREST_RATE_LIBRARY_NAME(), interestRateLibrary.address]
  );
};
