import { Deployer } from "@solarity/hardhat-migrate";
import { ethers } from "hardhat";

import { parseConfig, Config } from "@/deploy/helpers/configParser";
import { getAssetKey } from "@/deploy/helpers/deployHelper";

import {
  Registry__factory,
  SystemPoolsRegistry__factory,
} from "@/generated-types/ethers";

export = async (deployer: Deployer) => {
  const config: Config = parseConfig();

  const registry = await deployer.deployed(Registry__factory);
  const systemPoolsRegistry = await deployer.deployed(
    SystemPoolsRegistry__factory,
    await registry.getSystemPoolsRegistryContract()
  );

  for (const liquidityPoolData of config.liquidityPoolsData) {
    await systemPoolsRegistry.addLiquidityPool(
      liquidityPoolData.assetAddr,
      getAssetKey(liquidityPoolData.symbol),
      liquidityPoolData.priceFeedAddr,
      liquidityPoolData.symbol,
      liquidityPoolData.isAvailableAsCollateral,
      liquidityPoolData.isAvailableAsCollateralWithPrt
    );

    console.log(`Pool creation parameters:
      SYMBOL: ${liquidityPoolData.symbol}
      ASSET_ADDR: ${liquidityPoolData.assetAddr}
      ASSET_KEY: ${getAssetKey(liquidityPoolData.symbol)}
      PRICE_FEED_ADDR: ${liquidityPoolData.priceFeedAddr}
      IS_AVAILABLE_AS_COLLATERAL: ${liquidityPoolData.isAvailableAsCollateral}
      IS_AVAILABLE_AS_COLLATERAL WITH PRT: ${
        liquidityPoolData.isAvailableAsCollateralWithPrt
      }\n
    `);

    console.log(
      `Liquidity Pool ${liquidityPoolData.symbol} ----- ${
        (
          await systemPoolsRegistry.poolsInfo(
            getAssetKey(liquidityPoolData.symbol)
          )
        )[0]
      }`
    );
  }

  if (config.isStablePoolsAvailable && config.stablePoolsData) {
    for (const stablePoolData of config.stablePoolsData) {
      await systemPoolsRegistry.addStablePool(
        stablePoolData.assetAddr,
        getAssetKey(stablePoolData.symbol),
        stablePoolData.priceFeedAddr
      );

      console.log(`Pool creation parameters:
        SYMBOL: ${stablePoolData.symbol}
        ASSET_ADDR: ${stablePoolData.assetAddr}
        ASSET_KEY: ${getAssetKey(stablePoolData.symbol)}
        CHAINLINK_ORACLE: ${stablePoolData.priceFeedAddr}\n
      `);

      console.log(
        `Stable Pool ${stablePoolData.symbol} ----- ${
          (
            await systemPoolsRegistry.poolsInfo(
              getAssetKey(stablePoolData.symbol)
            )
          )[0]
        }`
      );
    }
  }
};
