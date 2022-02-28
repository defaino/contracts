const { oneToken, toBN, getOnePercent } = require("../../scripts/globals.js");
const fs = require("fs");
const web3 = require("web3");

function getSymbols() {
  return ["NDG", "DAI", "USDC", "USDT", "BAT", "XRP", "WBTC"];
}

function getAssetKeys() {
  const symbols = getSymbols();
  const assetKeys = [];

  for (let i = 0; i < symbols.length; i++) {
    assetKeys.push(toBytes(symbols[i]));
  }

  return assetKeys;
}

function getAssetKey(symbol) {
  return toBytes(symbol);
}

function toBytes(string) {
  return web3.utils.asciiToHex(string);
}

function getIntegrationAddresses() {
  return [
    "0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5", // Curve registry mainnet address
    "0xA79828DF1850E8a3A3064576f380D90aECDD3359", // Curve USD zap mainnet address
    "0x50c1a2eA0a861A967D9d0FFE2AE4012c2E053804", // YEarn registry address
  ];
}

function getBaseCoinsAddresses() {
  return [
    "0x889368d73c60078f6eAe232360D59a19aEdA4f85", // DAI mainnet address
    "0xf8013517d0cC309D68790E7e2e4FE85cdBC73fAD", // USDC mainnet address
    "0xA147a098Ed0dFC337a35e1729e6Ab2Bc90cE5d88", // USDT mainnet address
  ];
}

function getTokensAddresses() {
  return [
    "0x509A58F7d246613Db49DC8972731d05f2387031e", // NDG rinkeby
    "0x889368d73c60078f6eAe232360D59a19aEdA4f85", // DAI rinkeby
    "0xf8013517d0cC309D68790E7e2e4FE85cdBC73fAD", // USDC rinkeby
    "0xA147a098Ed0dFC337a35e1729e6Ab2Bc90cE5d88", // USDT rinkeby
    "0xdAb3ED852DA2fC1ff4F0A35bFF91543d0d431e9E", // BAT rinkeby
    "0x3aFf83fFfA0Cc7f7D34b4517aAe0a2cf7A0Ab7e2", // XRP rinkeby
    "0x239339A2046947378fb61AD42393923c45727BcC", // WBTC rinkeby
  ];
}

function getChainlinkOracles() {
  return [
    "0x0000000000000000000000000000000000000000", // NDG
    "0x2bA49Aaa16E6afD2a993473cfB70Fa8559B523cF", // DAI
    "0xa24de01df22b63d23Ebc1882a5E3d4ec0d907bFB", // USDC
    "0xa24de01df22b63d23Ebc1882a5E3d4ec0d907bFB", // USDT
    "0x031dB56e01f82f20803059331DC6bEe9b17F7fC9", // BAT
    "0xc3E76f41CAbA4aB38F00c7255d4df663DA02A024", // XRP
    "0xECe365B379E1dD183B20fc5f022230C044d51404", // WBTC
  ];
}

function getUniswapPools() {
  return [
    "0x56e09e916B5603a63dBd713aDD526030ABa14eE6", // NDG - DAI rinkeby
    "0x0000000000000000000000000000000000000000", // DAI - DAI rinkeby
    "0xb7bEF6418ec7423B4B43cb4b3772fc767c701Ce2", // USDC - DAI rinkeby
    "0xFBe975B9196783e76fed9aF27E78Dc1897F6347F", // USDT - DAI rinkeby
    "0x148F057d16BFa6638404bc9ec869E087Ce828604", // BAT - DAI rinkeby
    "0x9Cd0A978204C61e362033BaA3dDAb4817df53886", // XRP - DAI rinkeby
    "0x4B0baBe9fA771bd14B7796d272Abdc6a680fbb3E", // WBTC - DAI rinkeby
  ];
}

function getCollateralProperties() {
  return [true, true, true, false, true, false, true];
}

function getRewardsPerBlock() {
  return [
    oneToken(18),
    oneToken(18).times(2),
    oneToken(18),
    oneToken(18).times(3),
    oneToken(18),
    oneToken(18).times(2),
    oneToken(18),
  ];
}

function getMaxURs() {
  const onePercent = getOnePercent();

  return [
    onePercent.times(95),
    onePercent.times(95),
    onePercent.times(95),
    onePercent.times(95),
    onePercent.times(95),
    onePercent.times(95),
    onePercent.times(95),
  ];
}

function getLiquidationDiscounts() {
  const onePercent = getOnePercent();

  return [
    onePercent.times(5),
    onePercent.times(5),
    onePercent.times(8),
    onePercent.times(5),
    onePercent.times(7),
    onePercent.times(7),
    onePercent.times(6),
  ];
}

function getColRatios() {
  const onePercent = getOnePercent();

  return [
    onePercent.times(125),
    onePercent.times(115),
    onePercent.times(115),
    onePercent.times(150),
    onePercent.times(115),
    onePercent.times(130),
    onePercent.times(130),
  ];
}

function getIntegrationColRatios() {
  const onePercent = getOnePercent();

  return [
    onePercent.times(118),
    onePercent.times(110),
    onePercent.times(110),
    onePercent.times(135),
    onePercent.times(110),
    onePercent.times(120),
    onePercent.times(120),
  ];
}

function getReserveFactors() {
  const onePercent = getOnePercent();

  return [
    onePercent.times(15),
    onePercent.times(10),
    onePercent.times(18),
    onePercent.times(20),
    onePercent.times(15),
    onePercent.times(12),
    onePercent.times(13),
  ];
}

function getAllowForIntegration() {
  return [false, true, true, true, true, true, false, true];
}

function getOptimizationRewards() {
  const onePercent = getOnePercent();

  return [
    onePercent,
    onePercent,
    onePercent,
    onePercent,
    onePercent.times(2),
    onePercent.times(2),
    onePercent.times(3),
  ];
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

function getInterestRateModels() {
  const onePercent = getOnePercent();

  return [
    new InterestRateParams(onePercent.times(6), onePercent.times(90), onePercent.times(85)),
    new InterestRateParams(onePercent.times(7), onePercent.times(100), onePercent.times(75)),
    new InterestRateParams(onePercent.times(5), onePercent.times(85), onePercent.times(70)),
    new InterestRateParams(onePercent.times(10), onePercent.times(85), onePercent.times(80)),
    new InterestRateParams(onePercent.times(9), onePercent.times(80), onePercent.times(85)),
    new InterestRateParams(onePercent.times(4), onePercent.times(70), onePercent.times(80)),
    new InterestRateParams(onePercent.times(10), onePercent.times(100), onePercent.times(85)),
  ];
}

function getDistributionMinimums() {
  const onePercent = getOnePercent();

  return [
    new DistributionMinimums(onePercent.times(15), onePercent.times(15)),
    new DistributionMinimums(onePercent.times(10), onePercent.times(10)),
    new DistributionMinimums(onePercent.times(10), onePercent.times(10)),
    new DistributionMinimums(onePercent.times(10), onePercent.times(15)),
    new DistributionMinimums(onePercent.times(5), onePercent.times(5)),
    new DistributionMinimums(onePercent.times(5), onePercent.times(10)),
    new DistributionMinimums(onePercent.times(5), onePercent.times(10)),
  ];
}

function InterestRateParams(firstSlope, secondSlope, utilizationBreakingPoint) {
  this.firstSlope = firstSlope;
  this.secondSlope = secondSlope;
  this.utilizationBreakingPoint = utilizationBreakingPoint;
}

function DistributionMinimums(minSupplyDistributionPart, minBorrowDistributionPart) {
  this.minSupplyDistributionPart = minSupplyDistributionPart;
  this.minBorrowDistributionPart = minBorrowDistributionPart;
}

module.exports = {
  getSymbols,
  getAssetKey,
  getAssetKeys,
  getTokensAddresses,
  getChainlinkOracles,
  getUniswapPools,
  getRewardsPerBlock,
  getMaxURs,
  getLiquidationDiscounts,
  getCollateralProperties,
  getColRatios,
  getIntegrationColRatios,
  getReserveFactors,
  getAllowForIntegration,
  getOptimizationRewards,
  getInterestRateLibraryData,
  getInterestRateModels,
  getDistributionMinimums,
  getIntegrationAddresses,
  getBaseCoinsAddresses,
};
