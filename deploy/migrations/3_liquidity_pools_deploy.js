const Registry = artifacts.require("Registry");
const LiquidityPoolRegistry = artifacts.require("LiquidityPoolRegistry");

const { logTransaction, logAddress } = require("../runners/logger.js");
const { parsePoolsData, getAssetKey } = require("../helpers/deployHelper.js");

module.exports = async (deployer) => {
  const dataArr = parsePoolsData("deploy/data/poolsData.json");

  const registry = await Registry.deployed();

  const liquidityPoolRegistry = await LiquidityPoolRegistry.at(await registry.getLiquidityPoolRegistryContract());

  for (let i = 0; i < dataArr.length; i++) {
    const currentPoolData = dataArr[i];
    const currentSymbol = currentPoolData.symbol;

    logTransaction(
      await liquidityPoolRegistry.addLiquidityPool(
        currentPoolData.assetAddr,
        getAssetKey(currentSymbol),
        currentPoolData.chainlinkOracle,
        currentPoolData.uniswapPool,
        currentSymbol,
        currentPoolData.isAvailableAsCollateral
      ),
      `Create liquidity pool for ${currentSymbol} asset`
    );

    console.log(`Pool creation parameters:
      SYMBOL: ${currentSymbol}
      ASSET_ADDR: ${currentPoolData.assetAddr}
      ASSET_KEY: ${getAssetKey(currentSymbol)}
      CHAINLINK_ORACLE: ${currentPoolData.chainlinkOracle}
      UNISWAP_POOL: ${currentPoolData.uniswapPool}
      IS_AVAILABLE_AS_COLLATERL: ${currentPoolData.isAvailableAsCollateral}\n
    `);

    logAddress(
      `Liquidity Pool ${currentSymbol}`,
      await liquidityPoolRegistry.liquidityPools(getAssetKey(currentSymbol))
    );
  }

  console.log("+--------------------------------------------------------------------------------+");
};
