import { Deployer } from "@solarity/hardhat-migrate";

import { parseConfig, Config } from "@/deploy/helpers/configParser";
import { paramsToString } from "@/deploy/helpers/deployHelper";

import {
  Registry__factory,
  SystemParameters__factory,
} from "@/generated-types/ethers";

export = async (deployer: Deployer) => {
  const config: Config = parseConfig();

  const registry = await deployer.deployed(Registry__factory);
  const systemParameters = await deployer.deployed(
    SystemParameters__factory,
    await registry.getSystemParametersContract()
  );

  console.log(config.systemParameters.minCurrencyAmount);

  await systemParameters.setupLiquidationBoundary(
    config.systemParameters.liquidationBoundary
  );
  await systemParameters.setupMinCurrencyAmount(
    config.systemParameters.minCurrencyAmount
  );

  console.log(`System parameters - ${paramsToString(config.systemParameters)}`);
};
