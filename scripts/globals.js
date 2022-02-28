const BigNumber = require("bignumber.js");

function getOnePercent() {
  return toBN(10).pow(25);
}

function getDecimal() {
  return getOnePercent().times(100);
}

function oneToken(decimals = 18) {
  return toBN(10).pow(decimals);
}

function toBN(num) {
  return new BigNumber(num);
}

module.exports = {
  getDecimal,
  getOnePercent,
  oneToken,
  toBN,
};
