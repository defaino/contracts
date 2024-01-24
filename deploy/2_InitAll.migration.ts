import { Deployer } from "@solarity/hardhat-migrate";
import { ethers } from "hardhat";

import { parseConfig, Config } from "@/deploy/helpers/configParser";
import { getAssetKey } from "@/deploy/helpers/deployHelper";

import {
  Registry__factory,
  DefiCore__factory,
  SystemParameters__factory,
  SystemPoolsRegistry__factory,
  PRT__factory,
  LiquidityPool__factory,
  StablePool__factory,
} from "@/generated-types/ethers";

export = async (deployer: Deployer) => {
  const config: Config = parseConfig();

  const registry = await deployer.deployed(Registry__factory);

  const defiCore = await deployer.deployed(
    DefiCore__factory,
    await registry.getDefiCoreContract()
  );
  const systemParameters = await deployer.deployed(
    SystemParameters__factory,
    await registry.getSystemParametersContract()
  );
  const systemPoolsRegistry = await deployer.deployed(
    SystemPoolsRegistry__factory,
    await registry.getSystemPoolsRegistryContract()
  );
  const prt = await deployer.deployed(
    PRT__factory,
    await registry.getPRTContract()
  );

  const rewardsAssetKey = getAssetKey(config.rewardsAssetSymbol);
  const nativeTokenKey = getAssetKey(config.nativeAssetSymbol);

  await defiCore.defiCoreInitialize();
  await prt.prtInitialize(
    config.prtData.name,
    config.prtData.symbol,
    config.prtData.prtParams
  );
  await systemPoolsRegistry.systemPoolsRegistryInitialize(
    (
      await deployer.deployed(LiquidityPool__factory)
    ).address,
    nativeTokenKey,
    rewardsAssetKey
  );

  await registry.injectDependencies(await registry.DEFI_CORE_NAME());
  await registry.injectDependencies(await registry.SYSTEM_PARAMETERS_NAME());
  await registry.injectDependencies(await registry.ASSET_PARAMETERS_NAME());
  await registry.injectDependencies(await registry.REWARDS_DISTRIBUTION_NAME());
  await registry.injectDependencies(await registry.USER_INFO_REGISTRY_NAME());
  await registry.injectDependencies(
    await registry.SYSTEM_POOLS_REGISTRY_NAME()
  );
  await registry.injectDependencies(await registry.SYSTEM_POOLS_FACTORY_NAME());
  await registry.injectDependencies(await registry.PRICE_MANAGER_NAME());
  await registry.injectDependencies(await registry.PRT_NAME());

  if (config.isStablePoolsAvailable) {
    await systemParameters.setupStablePoolsAvailability(true);
    await systemPoolsRegistry.addPoolsBeacon(
      1,
      (
        await deployer.deployed(StablePool__factory)
      ).address
    );
  }

  let rewardsAssetAddress = ethers.constants.AddressZero;

  if (config.rewardsAssetSymbol !== "") {
    rewardsAssetAddress = config.rewardsAssetToken;

    await systemParameters.setRewardsTokenAddress(rewardsAssetAddress);
  }
};
