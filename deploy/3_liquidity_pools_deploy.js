const Registry = artifacts.require("Registry");
const SystemPoolsRegistry = artifacts.require("SystemPoolsRegistry");

const { parsePoolsData, getAssetKey, isStablePoolsAvailable } = require("./helpers/deployHelper.js");

module.exports = async (deployer, logger) => {
  const dataArr = parsePoolsData("deploy/data/poolsData.json");

  const registry = await Registry.deployed();
  const systemPoolsRegistry = await SystemPoolsRegistry.at(await registry.getSystemPoolsRegistryContract());

  const stablePoolsAvailable = isStablePoolsAvailable();

  for (let i = 0; i < dataArr.length; i++) {
    const currentPoolData = dataArr[i];
    const currentSymbol = currentPoolData.symbol;

    if (currentPoolData.poolType === "0") {
      logger.logTransaction(
        await systemPoolsRegistry.addLiquidityPool(
          currentPoolData.assetAddr,
          getAssetKey(currentSymbol),
          currentPoolData.chainlinkOracle,
          currentSymbol,
          currentPoolData.isAvailableAsCollateral,
          currentPoolData.isAvailableAsCollateral
        ),
        `Create liquidity pool for ${currentSymbol} asset`
      );

      console.log(`Pool creation parameters:
        SYMBOL: ${currentSymbol}
        ASSET_ADDR: ${currentPoolData.assetAddr}
        ASSET_KEY: ${getAssetKey(currentSymbol)}
        CHAINLINK_ORACLE: ${currentPoolData.chainlinkOracle}
        IS_AVAILABLE_AS_COLLATERL: ${currentPoolData.isAvailableAsCollateral}\n
      `);

      console.log(
        `Liquidity Pool ${currentSymbol} ----- ${(await systemPoolsRegistry.poolsInfo(getAssetKey(currentSymbol)))[0]}`
      );
    } else {
      if (!stablePoolsAvailable) {
        throw new Error("Stable pools are unavailable.");
      }

      logger.logTransaction(
        await systemPoolsRegistry.addStablePool(
          currentPoolData.assetAddr,
          getAssetKey(currentSymbol),
          currentPoolData.chainlinkOracle
        ),
        `Create stable pool for ${currentSymbol} asset`
      );

      console.log(`Pool creation parameters:
        SYMBOL: ${currentSymbol}
        ASSET_ADDR: ${currentPoolData.assetAddr}
        ASSET_KEY: ${getAssetKey(currentSymbol)}
        CHAINLINK_ORACLE: ${currentPoolData.chainlinkOracle}\n
      `);

      console.log(
        `Stable Pool ${currentSymbol} ----- ${(await systemPoolsRegistry.poolsInfo(getAssetKey(currentSymbol)))[0]}`
      );
    }
  }

  console.log("+--------------------------------------------------------------------------------+");
};
