import { Deployer } from "@solarity/hardhat-migrate";

import { parseConfig, Config } from "@/deploy/helpers/configParser";
import { getAssetKey, paramsToString } from "@/deploy/helpers/deployHelper";

import {
  AssetParameters__factory,
  Registry__factory,
  RewardsDistribution__factory,
} from "@/generated-types/ethers";

export = async (deployer: Deployer) => {
  const config: Config = parseConfig();

  const registry = await deployer.deployed(Registry__factory);
  const assetParameters = await deployer.deployed(
    AssetParameters__factory,
    await registry.getAssetParametersContract()
  );
  const rewardsDistribution = await deployer.deployed(
    RewardsDistribution__factory,
    await registry.getRewardsDistributionContract()
  );

  const assetKeys = [];
  const rewardsPerBlock = [];

  for (const liquidityPoolData of config.liquidityPoolsData) {
    const currentKey = getAssetKey(liquidityPoolData.symbol);

    await assetParameters.setupAllParameters(
      currentKey,
      liquidityPoolData.allPoolParams
    );

    console.log(
      `${
        liquidityPoolData.symbol
      } liquidity pool asset parameters: ${paramsToString(
        liquidityPoolData.allPoolParams
      )}`
    );

    assetKeys.push(currentKey);
    rewardsPerBlock.push(liquidityPoolData.rewardPerBlock);
  }

  if (config.isStablePoolsAvailable && config.stablePoolsData) {
    for (const stablePoolData of config.stablePoolsData) {
      const currentKey = getAssetKey(stablePoolData.symbol);

      await assetParameters.setupAnnualBorrowRate(
        currentKey,
        stablePoolData.annualBorrowRate
      );
      await assetParameters.setupMainParameters(
        currentKey,
        stablePoolData.mainParams
      );

      console.log(`${stablePoolData.symbol} stable pool asset parameters:
        ANNUAL_BORROW_RATE: ${stablePoolData.annualBorrowRate}
        MAIN_PARAMS: ${paramsToString(stablePoolData.mainParams)}
      `);

      assetKeys.push(currentKey);
      rewardsPerBlock.push(stablePoolData.rewardPerBlock);
    }
  }

  if (config.rewardsAssetSymbol !== "") {
    await rewardsDistribution.setupRewardsPerBlockBatch(
      assetKeys,
      rewardsPerBlock
    );
  }
};
