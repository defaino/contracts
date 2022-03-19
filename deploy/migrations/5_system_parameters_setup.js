const Registry = artifacts.require("Registry");
const SystemParameters = artifacts.require("SystemParameters");

const { logTransaction } = require("../runners/logger.js");
const { getOnePercent } = require("../../scripts/utils.js");

module.exports = async (deployer) => {
  const registry = await Registry.deployed();
  const systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());

  const liquidationBoundary = getOnePercent().times(50);

  logTransaction(
    await systemParameters.setupLiquidationBoundary(liquidationBoundary),
    "Add liquidation boundary parameter"
  );
};
