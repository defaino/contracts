const BigNumber = require("bignumber.js");

const toBN = (value) => new BigNumber(value);

const wei = (value, decimal = 18) => {
  return toBN(value).times(toBN(10).pow(decimal));
};

const fromWei = (value, decimal = 18) => {
  return toBN(value).div(toBN(10).pow(decimal)).toFixed();
};

const accounts = async (index) => {
  return (await web3.eth.getAccounts())[index];
};

function getOnePercent() {
  return toBN(10).pow(25);
}

function getDecimal() {
  return getOnePercent().times(100);
}

module.exports = {
  toBN,
  accounts,
  wei,
  fromWei,
  getOnePercent,
  getDecimal,
};
