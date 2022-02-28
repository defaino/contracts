const InterestRateLibrary = artifacts.require("InterestRateLibrary");

const Reverter = require("./helpers/reverter");

const { getInterestRateLibraryData } = require("../migrations/helpers/deployHelper");
const { toBN } = require("../scripts/globals");

const truffleAssert = require("truffle-assertions");

contract("InterestRateLibrary", async (accounts) => {
  const reverter = new Reverter(web3);

  const libraryPrecision = toBN(10);

  let interestRateLibrary;

  before("setup", async () => {
    interestRateLibrary = await InterestRateLibrary.new(
      getInterestRateLibraryData("scripts/InterestRatesExactData.txt"),
      getInterestRateLibraryData("scripts/InterestRatesData.txt")
    );

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("creation", async () => {
    it("should fill in data correctly", async () => {
      assert.equal(toBN(await interestRateLibrary.maxSupportedPercentage()).toString(), libraryPrecision.times(100));

      const percent = libraryPrecision.times(35);
      assert.equal(toBN(await interestRateLibrary.ratesPerSecond(percent)).toString(), toBN("9.51625e18").toString());
    });

    it("should get correct precise values", async () => {
      const percent = libraryPrecision.times(3.8);
      assert.equal(toBN(await interestRateLibrary.ratesPerSecond(percent)).toString(), toBN("1.18264e18").toString());
    });
  });

  describe("addNewRates", async () => {
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
        toBN(await interestRateLibrary.maxSupportedPercentage()).toString(),
        libraryPrecision.times(105).toString()
      );

      const percent = libraryPrecision.times(103);
      assert.equal(toBN(await interestRateLibrary.ratesPerSecond(percent)).toString(), toBN("2.24517e19").toString());
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
