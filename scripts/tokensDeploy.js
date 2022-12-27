const MockERC20 = artifacts.require("MockERC20");
const WETH = artifacts.require("WETH");

const { getAssetKey, parsePoolsData } = require("../deploy/helpers/deployHelper");

async function main() {
  const dataArr = parsePoolsData("deploy/data/poolsData.json");

  let tokenDecimals = 18;

  const rewardsTokenSymbol = dataArr[0].symbol;
  const rewardsToken = await MockERC20.new("Mock" + rewardsTokenSymbol, rewardsTokenSymbol);

  console.log(`Token symbol - ${rewardsTokenSymbol}, token key - ${getAssetKey(rewardsTokenSymbol)}`);
  console.log(`Token address - ${rewardsToken.address}, token decimals - ${tokenDecimals}`);
  console.log("----------------------");

  const nativeTokenSymbol = dataArr[1].symbol;
  const nativeToken = await WETH.new();

  console.log(`Token symbol - ${nativeTokenSymbol}, token key - ${getAssetKey(nativeTokenSymbol)}`);
  console.log(`Token address - ${nativeToken.address}, token decimals - ${tokenDecimals}`);
  console.log("----------------------");

  for (let i = 2; i < dataArr.length; i++) {
    tokenDecimals = 18;

    const currentSymbol = dataArr[i].symbol;
    const token = await MockERC20.new("Mock" + currentSymbol, currentSymbol);

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
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
