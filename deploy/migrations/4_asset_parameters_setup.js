const Registry = artifacts.require("Registry");
const AssetParameters = artifacts.require("AssetParameters");
const RewardsDistribution = artifacts.require("RewardsDistribution");

const { logTransaction } = require("../runners/logger.js");
const { parsePoolsData, getAssetKey, percentToStr } = require("../helpers/deployHelper");

module.exports = async (deployer) => {
  const dataArr = parsePoolsData("deploy/data/poolsData.json");

  const registry = await Registry.deployed();
  const assetParameters = await AssetParameters.at(await registry.getAssetParametersContract());
  const rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());

  const assetKeys = [];
  const rewardsPerBlock = [];

  for (let i = 0; i < dataArr.length; i++) {
    const currentPoolData = dataArr[i];
    const currentSymbol = currentPoolData.symbol;
    const currentKey = getAssetKey(currentSymbol);

    logTransaction(
      await assetParameters.setupAllParameters(currentKey, [
        currentPoolData.mainParams,
        currentPoolData.interestRateParams,
        currentPoolData.distributionMinimums,
      ]),
      `Setup all parameters for ${currentSymbol} liquidity pool`
    );

    console.log(`${currentSymbol} liquidity pool asset parameters:
      Main parameters:
        COLLATERALIZATION_RATIO: ${percentToStr(currentPoolData.mainParams[0], true)}
        RESERVE_FACTOR: ${percentToStr(currentPoolData.mainParams[1])}
        LIQUIDATION_DISCOUNT: ${percentToStr(currentPoolData.mainParams[2])}
        MAX_UTILIZATION_RATIO: ${percentToStr(currentPoolData.mainParams[3])}

      Interest rate parameters:
        BASE_PERCENTAGE: ${percentToStr(currentPoolData.interestRateParams[0])}
        FIRST_SLOPE: ${percentToStr(currentPoolData.interestRateParams[1])}
        SECOND_SLOPE: ${percentToStr(currentPoolData.interestRateParams[2])}
        UTILIZATION_BREAKING_POINT: ${percentToStr(currentPoolData.interestRateParams[3])}

      Distribution minimums:
        MINIMUM_SUPPLY_DISTRIBUTION_PART: ${percentToStr(currentPoolData.distributionMinimums[0])}
        MINIMUM_BORROW_DISTRIBUTION_PART: ${percentToStr(currentPoolData.distributionMinimums[1])}\n
    `);

    assetKeys.push(currentKey);
    rewardsPerBlock.push(currentPoolData.rewardPerBlock);

    console.log();
  }

  logTransaction(
    await rewardsDistribution.setupRewardsPerBlockBatch(assetKeys, rewardsPerBlock),
    `Set rewards per block for all assets`
  );

  console.log("+--------------------------------------------------------------------------------+");
};
