const Registry = artifacts.require("Registry");
const LiquidityPoolRegistry = artifacts.require("LiquidityPoolRegistry");

const { logTransaction } = require("./helpers/logger.js");
const {
  getSymbols,
  getAssetKeys,
  getCollateralProperties,
  getTokensAddresses,
  getChainlinkOracles,
  getUniswapPools,
} = require("./helpers/deployHelper.js");

module.exports = async (deployer) => {
  const registry = await Registry.deployed();

  const liquidityPoolRegistry = await LiquidityPoolRegistry.at(await registry.getLiquidityPoolRegistryContract());

  const symbols = getSymbols();
  const collProp = getCollateralProperties();
  const assetKeys = getAssetKeys();
  const tokensAddresses = getTokensAddresses();
  const chainlinkOracles = getChainlinkOracles();
  const uniswapPools = getUniswapPools();

  for (let i = 0; i < symbols.length; i++) {
    const currentSymbol = symbols[i];
    const currentAssetKey = assetKeys[i];

    logTransaction(
      await liquidityPoolRegistry.addLiquidityPool(
        tokensAddresses[i],
        currentAssetKey,
        chainlinkOracles[i],
        uniswapPools[i],
        currentSymbol,
        collProp[i]
      ),
      `Create liquidity pool for ${currentSymbol} asset`
    );
    console.log(`Liquidity Pool ${currentSymbol} - ${await liquidityPoolRegistry.liquidityPools(currentAssetKey)}\n`);
  }
};
