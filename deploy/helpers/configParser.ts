import * as fs from "fs";

import { ethers } from "hardhat";
import { BigNumberish } from "@ethersproject/bignumber";
import { convertToPercent } from "@/deploy/helpers/deployHelper";

const { wei } = require("@/scripts/utils/utils.js");

import { IPRT, IAssetParameters } from "@/generated-types/ethers";

export enum PoolTypes {
  LiquidityPool,
  StablePool,
}

export type Config = {
  nativeAssetSymbol: string;
  rewardsAssetSymbol: string;
  rewardsAssetToken: string;
  isStablePoolsAvailable: boolean;
  systemParameters: SystemParameters;
  prtData: PRTData;
  liquidityPoolsData: LiquidityPoolData[];
  stablePoolsData?: StablePoolData[];
};

export type PRTData = {
  name: string;
  symbol: string;
  prtParams: IPRT.PRTParamsStruct;
};

export type LiquidityPoolData = {
  symbol: string;
  assetAddr: string;
  priceFeedAddr: string;
  isAvailableAsCollateral: boolean;
  isAvailableAsCollateralWithPrt: boolean;
  rewardPerBlock: BigNumberish;
  allPoolParams: IAssetParameters.AllPoolParamsStruct;
};

export type StablePoolData = {
  symbol: string;
  assetAddr: string;
  priceFeedAddr: string;
  rewardPerBlock: BigNumberish;
  annualBorrowRate: BigNumberish;
  mainParams: IAssetParameters.MainPoolParamsStruct;
};

export type SystemParameters = {
  liquidationBoundary: BigNumberish;
  minCurrencyAmount: BigNumberish;
};

export function parseConfig(
  configPath: string = "deploy/data/config.json"
): Config {
  const config: Config = JSON.parse(
    fs.readFileSync(configPath, "utf-8")
  ) as Config;

  if (
    config.rewardsAssetToken !== "" &&
    !ethers.utils.isAddress(config.rewardsAssetToken)
  ) {
    throw new Error(
      `Invalid rewardsAssetToken address - ${config.rewardsAssetToken}`
    );
  }

  validateSystemParameters(config.systemParameters);

  for (const liquidityPoolData of config.liquidityPoolsData) {
    validateLiquidityPoolData(liquidityPoolData);
  }

  if (config.stablePoolsData) {
    for (const stablePoolData of config.stablePoolsData) {
      validateStablePoolData(stablePoolData);
    }
  }

  return config;
}

function validateSystemParameters(systemParameters: SystemParameters) {
  systemParameters.liquidationBoundary = convertToPercent(
    systemParameters.liquidationBoundary
  );
  systemParameters.minCurrencyAmount = wei(
    systemParameters.minCurrencyAmount
  ).toFixed();
}

function validateLiquidityPoolData(liquidityPoolData: LiquidityPoolData) {
  validateMainPoolParams(liquidityPoolData.allPoolParams.mainParams);

  liquidityPoolData.allPoolParams.interestRateParams.basePercentage =
    convertToPercent(
      liquidityPoolData.allPoolParams.interestRateParams.basePercentage
    );
  liquidityPoolData.allPoolParams.interestRateParams.firstSlope =
    convertToPercent(
      liquidityPoolData.allPoolParams.interestRateParams.firstSlope
    );
  liquidityPoolData.allPoolParams.interestRateParams.secondSlope =
    convertToPercent(
      liquidityPoolData.allPoolParams.interestRateParams.secondSlope
    );
  liquidityPoolData.allPoolParams.interestRateParams.utilizationBreakingPoint =
    convertToPercent(
      liquidityPoolData.allPoolParams.interestRateParams
        .utilizationBreakingPoint
    );

  liquidityPoolData.allPoolParams.distrMinimums.minSupplyDistrPart =
    convertToPercent(
      liquidityPoolData.allPoolParams.distrMinimums.minSupplyDistrPart
    );
  liquidityPoolData.allPoolParams.distrMinimums.minBorrowDistrPart =
    convertToPercent(
      liquidityPoolData.allPoolParams.distrMinimums.minBorrowDistrPart
    );
}

function validateStablePoolData(stablePoolData: StablePoolData) {
  validateMainPoolParams(stablePoolData.mainParams);
}

function validateMainPoolParams(
  mainParams: IAssetParameters.MainPoolParamsStruct
) {
  mainParams.collateralizationRatio = convertToPercent(
    mainParams.collateralizationRatio
  );
  mainParams.collateralizationRatioWithPRT = convertToPercent(
    mainParams.collateralizationRatioWithPRT
  );
  mainParams.reserveFactor = convertToPercent(mainParams.reserveFactor);
  mainParams.liquidationDiscount = convertToPercent(
    mainParams.liquidationDiscount
  );
  mainParams.maxUtilizationRatio = convertToPercent(
    mainParams.maxUtilizationRatio
  );
}
