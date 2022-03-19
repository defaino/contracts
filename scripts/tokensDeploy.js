const MockERC20 = artifacts.require("MockERC20");
const GovernanceToken = artifacts.require("GovernanceToken");

const { getAssetKey, parsePoolsData } = require("../deploy/helpers/deployHelper");

const TOKENS_OWNER = "0xc143351Fc176cB67D4b1016b27793b5D47E526C8"; // OWNER ADDRESS

module.exports = async (deployer) => {
  const dataArr = parsePoolsData("deploy/data/poolsData.json");

  let tokenDecimals = 18;

  const governanceTokenSymbol = dataArr[0].symbol;
  const governanceToken = await deployer.new(GovernanceToken, TOKENS_OWNER);

  console.log(`Token symbol - ${governanceTokenSymbol}, token key - ${getAssetKey(governanceTokenSymbol)}`);
  console.log(`Token address - ${governanceToken.address}, token decimals - ${tokenDecimals}`);
  console.log("----------------------");

  for (let i = 1; i < dataArr.length; i++) {
    tokenDecimals = 18;

    const currentSymbol = dataArr[i].symbol;
    const token = await deployer.new(MockERC20, "Mock" + currentSymbol, currentSymbol);

    if (currentSymbol == "USDC" || currentSymbol == "USDT") {
      tokenDecimals = 6;
      await token.setDecimals(tokenDecimals);
    } else if (currentSymbol == "WBTC") {
      tokenDecimals = 8;
      await token.setDecimals(tokenDecimals);
    }

    console.log(`Token symbol - ${currentSymbol}, token key - ${getAssetKey(currentSymbol)}`);
    console.log(`Token address - ${token.address}, token decimals - ${tokenDecimals}`);
    console.log("----------------------");
  }
};
