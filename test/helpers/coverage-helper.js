const { toBN } = require("../../scripts/utils/utils");
const fs = require("fs");

const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const InterestRateLibraryMock = artifacts.require("InterestRateLibraryMock");

const dotenv = require("dotenv");
dotenv.config();

function isCoverage() {
  return process.env.IS_COVERAGE === "true";
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

async function getInterestRateLibraryAddr() {
  if (isCoverage()) {
    return (await InterestRateLibraryMock.new(getInterestRateLibraryData("test/data/InterestRatesExactData.txt")))
      .address;
  } else {
    return (await InterestRateLibrary.new()).address;
  }
}

module.exports = {
  isCoverage,
  getInterestRateLibraryAddr,
};
