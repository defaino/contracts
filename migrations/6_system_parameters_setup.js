const Registry = artifacts.require("Registry");
const SystemParameters = artifacts.require("SystemParameters");

const { logTransaction } = require("./helpers/logger.js");
const { getOnePercent } = require("../scripts/globals.js");
const { getIntegrationAddresses } = require("./helpers/deployHelper");

module.exports = async (deployer) => {
  const registry = await Registry.deployed();
  const systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());

  const liquidationBoundary = getOnePercent().times(50);
  const optimizationPercentage = getOnePercent().times(20);

  logTransaction(
    await systemParameters.setupLiquidationBoundary(liquidationBoundary),
    "Add liquidation boundary parameter"
  );

  logTransaction(
    await systemParameters.setupOptimizationPercentage(optimizationPercentage),
    "Add optimization percentage parameter"
  );

  const integrationAddresses = getIntegrationAddresses();

  logTransaction(await systemParameters.setupCurveRegistry(integrationAddresses[0]), "Add curve registry parameter");
  logTransaction(await systemParameters.setupCurveZap(integrationAddresses[1]), "Add curve zap parameter");
  logTransaction(await systemParameters.setupYEarnRegistry(integrationAddresses[2]), "Add yearn registry parameter");
};
