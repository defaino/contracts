const {
  toBN,
  wei,
  getPrecision,
  getPercentage100,
} = require("../../scripts/utils/utils.js");

import { ethers } from "hardhat";
import { BigNumberish } from "@ethersproject/bignumber";
import { PromiseOrValue } from "@/generated-types/ethers/common";

export function getAssetKey(symbol: string) {
  return stringToBytes32(symbol);
}

export function convertToPercent(
  numberToConvert: PromiseOrValue<BigNumberish>
) {
  const onePercent = getPrecision();

  return onePercent.times(numberToConvert).toFixed();
}

export function paramsToString(params: any) {
  return JSON.stringify(params, null, 4);
}

function toBytes(string: string) {
  return ethers.utils.hexlify(ethers.utils.toUtf8Bytes(string));
}

function stringToBytes32(str: string) {
  let result = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(str));

  while (result.length < 66) {
    result += "0";
  }
  if (result.length !== 66) {
    throw new Error("invalid web3 implicit bytes32");
  }
  return result;
}

// function nonEmptyField(field, fieldName, onlyUndefined = false) {
//   if (field != undefined && (onlyUndefined || field !== "")) {
//     return field;
//   }

//   throw new Error(`Incorrect ${fieldName} field in .env file.`);
// }

// function percentToStr(percent, isColRatio = false) {
//   if (isColRatio) {
//     return toBN(100).times(getPercentage100()).div(percent).toFixed() + "%";
//   }

//   return toBN(percent).idiv(getPrecision()).toFixed() + "%";
// }

// function parsePoolsData(path) {
//   let poolsData = JSON.parse(fs.readFileSync(path, "utf8"));

//   for (let i = 0; i < poolsData.length; i++) {
//     if (poolsData[i].poolType === "0") {
//       convertToPercents(poolsData[i].interestRateParams);
//       convertToPercents(poolsData[i].distributionMinimums);

//       poolsData[i].isAvailableAsCollateral = poolsData[i].isAvailableAsCollateral === "true";
//       poolsData[i].isAvailableAsCollateralWithPrt = poolsData[i].isAvailableAsCollateralWithPrt === "true";
//     } else {
//       poolsData[i].annualBorrowRate = convertToPercents([poolsData[i].annualBorrowRate])[0];
//     }

//     convertToPercents(poolsData[i].mainParams);
//     poolsData[i].rewardPerBlock = wei(poolsData[i].rewardPerBlock);
//   }

//   return poolsData;
// }

// function parsePrtData(path) {
//   let prtData = JSON.parse(fs.readFileSync(path, "utf8"));

//   return prtData;
// }

// function convertToPercents(arr) {
//   const onePercent = getPrecision();

//   for (let i = 0; i < arr.length; i++) {
//     arr[i] = onePercent.times(arr[i]);
//   }

//   return arr;
// }

// module.exports = {
//   getAssetKey,
//   // parsePoolsData,
//   // parsePrtData,
//   // percentToStr,
// };
