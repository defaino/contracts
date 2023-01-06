const Registry = artifacts.require("Registry");
const AssetParameters = artifacts.require("AssetParameters");
const RewardsDistribution = artifacts.require("RewardsDistribution");

const {
  parsePoolsData,
  getAssetKey,
  percentToStr,
  isStablePoolsAvailable,
  rewardsAssetSymbol,
} = require("./helpers/deployHelper");

module.exports = async (deployer, logger) => {
  const dataArr = parsePoolsData("deploy/data/poolsData.json");

  const registry = await Registry.deployed();
  const assetParameters = await AssetParameters.at(await registry.getAssetParametersContract());
  const rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());

  const assetKeys = [];
  const rewardsPerBlock = [];

  const stablePoolsAvailable = isStablePoolsAvailable();

  for (let i = 0; i < dataArr.length; i++) {
    const currentPoolData = dataArr[i];
    const currentSymbol = currentPoolData.symbol;
    const currentKey = getAssetKey(currentSymbol);

    if (currentPoolData.poolType === "0") {
      logger.logTransaction(
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
    } else {
      if (!stablePoolsAvailable) {
        throw new Error("Stable pools are unavailable.");
      }

      logger.logTransaction(
        await assetParameters.setupAnnualBorrowRate(currentKey, currentPoolData.annualBorrowRate),
        `Setup annual borrow rate for ${currentSymbol} stable pool`
      );

      logger.logTransaction(
        await assetParameters.setupMainParameters(currentKey, currentPoolData.mainParams),
        `Setup main parameters for ${currentSymbol} stable pool`
      );

      console.log(`${currentSymbol} stable pool asset parameters:
        ANNUAL_BORROW_RATE: ${percentToStr(currentPoolData.annualBorrowRate)}
        Main parameters:
          COLLATERALIZATION_RATIO: ${percentToStr(currentPoolData.mainParams[0], true)}
          RESERVE_FACTOR: ${percentToStr(currentPoolData.mainParams[1])}
          LIQUIDATION_DISCOUNT: ${percentToStr(currentPoolData.mainParams[2])}
          MAX_UTILIZATION_RATIO: ${percentToStr(currentPoolData.mainParams[3])}\n
      `);
    }

    assetKeys.push(currentKey);
    rewardsPerBlock.push(currentPoolData.rewardPerBlock);

    console.log();
  }

  if (rewardsAssetSymbol() !== "") {
    logger.logTransaction(
      await rewardsDistribution.setupRewardsPerBlockBatch(assetKeys, rewardsPerBlock),
      `Set rewards per block for all assets`
    );
  }

  console.log("+--------------------------------------------------------------------------------+");
};
