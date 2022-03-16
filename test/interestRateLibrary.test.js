const { getInterestRateLibraryData } = require("../deploy/helpers/deployHelper");
const { toBN } = require("../scripts/utils");

const truffleAssert = require("truffle-assertions");
const Reverter = require("./helpers/reverter");

const InterestRateLibrary = artifacts.require("InterestRateLibrary");

InterestRateLibrary.numberFormat = "BigNumber";

describe("InterestRateLibrary", () => {
  const reverter = new Reverter();

  const libraryPrecision = toBN(10);

  let interestRateLibrary;

  before("setup", async () => {
    interestRateLibrary = await InterestRateLibrary.new(
      getInterestRateLibraryData("deploy/data/InterestRatesExactData.txt")
    );

    await interestRateLibrary.addNewRates(
      110, // Start percentage
      getInterestRateLibraryData("deploy/data/InterestRatesData.txt")
    );

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("creation", () => {
    it("should fill in data correctly", async () => {
      assert.equal((await interestRateLibrary.maxSupportedPercentage()).toString(), libraryPrecision.times(100));

      const percent = libraryPrecision.times(35);
      assert.equal((await interestRateLibrary.ratesPerSecond(percent)).toString(), toBN("9.51625e18").toString());
    });

    it("should get correct precise values", async () => {
      const percent = libraryPrecision.times(3.8);
      assert.equal((await interestRateLibrary.ratesPerSecond(percent)).toString(), toBN("1.18264e18").toString());
    });
  });

  describe("addNewRates", () => {
    it("should correctly add new rates", async () => {
      const newRates = [
        toBN("2.21377e19").toString(),
        toBN("2.22951e19").toString(),
        toBN("2.24517e19").toString(),
        toBN("2.26075e19").toString(),
        toBN("2.27626e19").toString(),
      ];
      const startPercentage = libraryPrecision.times(101);

      await interestRateLibrary.addNewRates(startPercentage, newRates);

      assert.equal(
        (await interestRateLibrary.maxSupportedPercentage()).toString(),
        libraryPrecision.times(105).toString()
      );

      const percent = libraryPrecision.times(103);
      assert.equal((await interestRateLibrary.ratesPerSecond(percent)).toString(), toBN("2.24517e19").toString());
    });

    it("should get exception if start percentage is invalid", async () => {
      const newRates = [
        toBN("2.21377e19").toString(),
        toBN("2.22951e19").toString(),
        toBN("2.24517e19").toString(),
        toBN("2.26075e19").toString(),
        toBN("2.27626e19").toString(),
      ];
      let startPercentage = libraryPrecision.times(36);

      const reason = "InterestRateLibrary: Incorrect starting percentage to add.";
      await truffleAssert.reverts(interestRateLibrary.addNewRates(startPercentage, newRates), reason);

      startPercentage = libraryPrecision.times(120);
      await truffleAssert.reverts(interestRateLibrary.addNewRates(startPercentage, newRates), reason);
    });
  });
});
