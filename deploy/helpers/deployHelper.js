const { toBN, wei, getPrecision, getPercentage100 } = require("../../scripts/utils.js");
const fs = require("fs");
const web3 = require("web3");

require("dotenv").config();

function getAssetKey(symbol) {
  return toBytes(symbol);
}

function toBytes(string) {
  return web3.utils.asciiToHex(string);
}

function nonEmptyField(field, fieldName, onlyUndefined = false) {
  if (field != undefined && (onlyUndefined || field !== "")) {
    return field;
  }

  throw new Error(`Incorrect ${fieldName} field in .env file.`);
}

function percentToStr(percent, isColRatio = false) {
  if (isColRatio) {
    return toBN(100).times(getPercentage100()).div(percent).toFixed() + "%";
  }

  return toBN(percent).idiv(getPrecision()).toFixed() + "%";
}

function parsePoolsData(path) {
  let poolsData = JSON.parse(fs.readFileSync(path, "utf8"));

  for (let i = 0; i < poolsData.length; i++) {
    if (poolsData[i].poolType === "0") {
      convertToPercents(poolsData[i].interestRateParams);
      convertToPercents(poolsData[i].distributionMinimums);

      poolsData[i].isAvailableAsCollateral = poolsData[i].isAvailableAsCollateral === "true";
    } else {
      poolsData[i].annualBorrowRate = convertToPercents([poolsData[i].annualBorrowRate])[0];
    }

    convertToPercents(poolsData[i].mainParams);
    poolsData[i].rewardPerBlock = wei(poolsData[i].rewardPerBlock);
  }

  return poolsData;
}

function convertToPercents(arr) {
  const onePercent = getPrecision();

  for (let i = 0; i < arr.length; i++) {
    arr[i] = onePercent.times(arr[i]);
  }

  return arr;
}

function isStablePoolsAvailable() {
  return nonEmptyField(process.env.STABLE_POOLS_AVAILABLE, "STABLE_POOLS_AVAILABLE") === "true";
}

function nativeAssetSymbol() {
  return nonEmptyField(process.env.NATIVE_ASSET_SYMBOL, "NATIVE_ASSET_SYMBOL");
}

function rewardsAssetSymbol() {
  return nonEmptyField(process.env.REWARDS_ASSET_SYMBOL, "REWARDS_ASSET_SYMBOL", true);
}

function rewardsAssetToken() {
  return nonEmptyField(process.env.REWARDS_ASSET_TOKEN, "REWARDS_ASSET_TOKEN", true);
}

module.exports = {
  getAssetKey,
  parsePoolsData,
  percentToStr,
  isStablePoolsAvailable,
  nativeAssetSymbol,
  rewardsAssetSymbol,
  rewardsAssetToken,
};
