const MockERC20 = artifacts.require("MockERC20");

const { toBN, getDecimal, oneToken } = require("../../scripts/globals");

async function mintAndApprove(spender, coins, users, amounts) {
  for (let i = 0; i < coins.length; i++) {
    const token = await MockERC20.at(coins[i]);

    await token.mintArbitraryBatch(users, amounts);
    await token.approveArbitraryBacth(spender, users, amounts);
  }
}

async function saveCoins(array, numberOfCoins) {
  for (let i = 0; i < numberOfCoins; i++) {
    array.push((await MockERC20.new("Test Coin" + i, "TC" + i)).address);
  }
}

function convertToUSD(amountToConvert, tokenDecimals = 18, oraclePriceDecimals = toBN(10).pow(8), price = toBN(100)) {
  return mulDiv(amountToConvert, price.times(oraclePriceDecimals), oneToken(tokenDecimals));
}

function convertFromUSD(amountToConvert, tokenDecimals = 18, oraclePriceDecimals = toBN(10).pow(8), price = toBN(100)) {
  return mulDiv(amountToConvert, oneToken(tokenDecimals), price.times(oraclePriceDecimals));
}

function convertToBorrowLimit(amountToConvert, colRatio = getDecimal().times(1.25)) {
  return mulDiv(amountToConvert, getDecimal(), colRatio);
}

function convertFromBorrowLimit(amountToConvert, colRatio = getDecimal().times(1.25)) {
  return mulDiv(amountToConvert, colRatio);
}

function mulDiv(number1, number2, number3 = getDecimal()) {
  return number1.times(number2).idiv(number3);
}

module.exports = {
  mintAndApprove,
  saveCoins,
  convertToUSD,
  convertFromUSD,
  convertToBorrowLimit,
  convertFromBorrowLimit,
  mulDiv,
};
