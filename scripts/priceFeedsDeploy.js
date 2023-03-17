const ChainlinkOracleMock = artifacts.require("ChainlinkOracleMock");

const fs = require("fs");

const { wei } = require("../scripts/utils/utils");
const { parsePoolsData } = require("../deploy/helpers/deployHelper");

async function main() {
  const pathToFile = "deploy/data/poolsData.json";
  const dataArr = parsePoolsData(pathToFile);

  const currentFile = JSON.parse(fs.readFileSync(pathToFile, "utf8"));

  const prices = ["2", "1600", "1.0001", "0.99995", "1.0001", "25000"];
  const priceFeedDecimals = 8;

  if (dataArr.length != prices.length) {
    throw new Error("Length missmatch");
  }

  for (let i = 0; i < prices.length; i++) {
    const priceFeed = await ChainlinkOracleMock.new(wei(prices[i], priceFeedDecimals), priceFeedDecimals);
    currentFile[i].chainlinkOracle = priceFeed.address;

    console.log(
      `${i}. Price feed for ${dataArr[i].symbol} - ${priceFeed.address}, price - ${wei(
        prices[i]
      ).toFixed()}, price feed decimals - ${priceFeedDecimals}`
    );
  }

  fs.writeFileSync(pathToFile, JSON.stringify(currentFile));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
