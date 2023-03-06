const Registry = artifacts.require("Registry");
const SystemParameters = artifacts.require("SystemParameters");

const { getPrecision, wei } = require("../scripts/utils/utils");

module.exports = async (deployer, logger) => {
  const registry = await Registry.deployed();
  const systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());

  const liquidationBoundary = getPrecision().times(50);

  logger.logTransaction(
    await systemParameters.setupLiquidationBoundary(liquidationBoundary),
    "Add liquidation boundary parameter"
  );

  const minCurrencyAmount = wei(0.01);

  logger.logTransaction(
    await systemParameters.setupMinCurrencyAmount(minCurrencyAmount),
    "Add min currency amount parameter"
  );
};
