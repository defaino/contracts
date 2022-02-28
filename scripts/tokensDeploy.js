const MockERC20 = artifacts.require("MockERC20");
const GovernanceToken = artifacts.require("GovernanceToken");

const { getSymbols, getAssetKeys } = require("../migrations/helpers/deployHelper");

const TOKENS_OWNER = "0xc143351Fc176cB67D4b1016b27793b5D47E526C8"; // OWNER ADDRESS

module.exports = async function (callback) {
  const symbols = getSymbols();
  const assetKeys = getAssetKeys();

  let tokenDecimals = 18;

  const governanceTokenSymbol = symbols[0];
  const governanceToken = await GovernanceToken.new(TOKENS_OWNER);

  console.log(`Token symbol - ${governanceTokenSymbol}, token key - ${assetKeys[0]}`);
  console.log(`Token address - ${governanceToken.address}, token decimals - ${tokenDecimals}`);
  console.log("----------------------");

  for (let i = 1; i < symbols.length; i++) {
    tokenDecimals = 18;

    const currentSymbol = symbols[i];
    const token = await MockERC20.new("Mock" + currentSymbol, currentSymbol);

    if (currentSymbol == "USDC" || currentSymbol == "USDT") {
      tokenDecimals = 6;
      await token.setDecimals(tokenDecimals);
    } else if (currentSymbol == "WBTC") {
      tokenDecimals = 8;
      await token.setDecimals(tokenDecimals);
    }

    console.log(`Token symbol - ${currentSymbol}, token key - ${assetKeys[i]}`);
    console.log(`Token address - ${token.address}, token decimals - ${tokenDecimals}`);
    console.log("----------------------");
  }

  callback();
};
