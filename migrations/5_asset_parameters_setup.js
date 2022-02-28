const Registry = artifacts.require("Registry");
const AssetParameters = artifacts.require("AssetParameters");
const RewardsDistribution = artifacts.require("RewardsDistribution");

const { logTransaction } = require("./helpers/logger.js");
const {
  getSymbols,
  getAssetKeys,
  getInterestRateModels,
  getMaxURs,
  getLiquidationDiscounts,
  getRewardsPerBlock,
  getDistributionMinimums,
  getColRatios,
  getIntegrationColRatios,
  getReserveFactors,
  getAllowForIntegration,
  getOptimizationRewards,
} = require("./helpers/deployHelper");

module.exports = async (deployer) => {
  const registry = await Registry.deployed();
  const assetParameters = await AssetParameters.at(await registry.getAssetParametersContract());
  const rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());

  const models = getInterestRateModels();
  const maxURs = getMaxURs();
  const liquidationDiscounts = getLiquidationDiscounts();
  const colRatios = getColRatios();
  const integrationColRatios = getIntegrationColRatios();
  const reserveFactors = getReserveFactors();
  const symbols = getSymbols();
  const assetKeys = getAssetKeys();
  const distributionMinimums = getDistributionMinimums();
  const allowForIntegrations = getAllowForIntegration();
  const optimizationRewards = getOptimizationRewards();

  for (let i = 0; i < symbols.length; i++) {
    const currentSymbol = symbols[i];
    const currentKey = assetKeys[i];
    const currentModel = models[i];

    logTransaction(
      await assetParameters.setupInterestRateModel(
        currentKey,
        0,
        currentModel.firstSlope,
        currentModel.secondSlope,
        currentModel.utilizationBreakingPoint
      ),
      `Add interest rate parameters for ${currentSymbol} liquidity pool`
    );

    logTransaction(
      await assetParameters.setupMaxUtilizationRatio(currentKey, maxURs[i]),
      `Add max UR for ${currentSymbol} liquidity pool`
    );

    logTransaction(
      await assetParameters.setupLiquidationDiscount(currentKey, liquidationDiscounts[i]),
      `Add liquidation discount for ${currentSymbol} liquidity pool`
    );

    logTransaction(
      await assetParameters.setupColRatio(currentKey, colRatios[i]),
      `Add collateralization ratio for ${currentSymbol} liquidity pool`
    );

    logTransaction(
      await assetParameters.setupIntegrationColRatio(currentKey, integrationColRatios[i]),
      `Add integration collateralization ratio for ${currentSymbol} liquidity pool`
    );

    logTransaction(
      await assetParameters.setupReserveFactor(currentKey, reserveFactors[i]),
      `Add reserve factor for ${currentSymbol} liquidity pool`
    );

    logTransaction(
      await assetParameters.setupAllowForIntegration(currentKey, allowForIntegrations[i]),
      `Add allow for integrations for ${currentSymbol} liquidity pool`
    );

    logTransaction(
      await assetParameters.setupOptimizationReward(currentKey, optimizationRewards[i]),
      `Add optimization reward percentage param for ${currentSymbol} liquidity pool`
    );

    const currentDistributionMinimums = distributionMinimums[i];

    logTransaction(
      await assetParameters.setupDistributionsMinimums(
        currentKey,
        currentDistributionMinimums.minSupplyDistributionPart,
        currentDistributionMinimums.minBorrowDistributionPart
      ),
      `Set distribution minimums for ${symbols[i]} liquidity pool`
    );

    console.log();
  }

  logTransaction(
    await rewardsDistribution.setupRewardsPerBlockBatch(assetKeys, getRewardsPerBlock()),
    `Set rewards per block for all assets`
  );
};
