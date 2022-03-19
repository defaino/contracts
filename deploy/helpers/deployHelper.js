const { toBN, wei, getOnePercent, getDecimal } = require("../../scripts/utils.js");
const fs = require("fs");
const web3 = require("web3");

function getAssetKey(symbol) {
  return toBytes(symbol);
}

function toBytes(string) {
  return web3.utils.asciiToHex(string);
}

function percentToStr(percent, isColRatio = false) {
  if (isColRatio) {
    return toBN(100).times(getDecimal()).div(percent).toFixed() + "%";
  }

  return toBN(percent).idiv(getOnePercent()).toFixed() + "%";
}

function getInterestRateLibraryData(path) {
  let fileContent = fs.readFileSync(path, "utf8");
  fileContent = fileContent.replace(/[\{\}]/g, "").replace(/×10\^/g, "e");

  const partsArr = fileContent.split(", ");
  const interestRates = [];

  for (let i = 0; i < partsArr.length; i++) {
    interestRates.push(toBN(partsArr[i]).toString());
  }

  return interestRates;
}

function parsePoolsData(path) {
  let poolsData = JSON.parse(fs.readFileSync(path, "utf8"));

  for (let i = 0; i < poolsData.length; i++) {
    poolsData[i].rewardPerBlock = wei(poolsData[i].rewardPerBlock);

    convertToPercents(poolsData[i].mainParams);
    convertToPercents(poolsData[i].interestRateParams);
    convertToPercents(poolsData[i].distributionMinimums);
  }

  return poolsData;
}

function convertToPercents(arr) {
  const onePercent = getOnePercent();

  for (let i = 0; i < arr.length; i++) {
    arr[i] = onePercent.times(arr[i]);
  }

  return arr;
}

module.exports = {
  getAssetKey,
  getInterestRateLibraryData,
  parsePoolsData,
  percentToStr,
};
