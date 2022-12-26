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
    interestRateLibrary = await InterestRateLibrary.new();

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("creation", () => {
    it("should fill in data correctly", async () => {
      assert.equal((await interestRateLibrary.MAX_SUPPORTED_PERCENTAGE()).toString(), libraryPrecision.times(100));

      const percent = libraryPrecision.times(35);
      assert.equal((await interestRateLibrary.getRatePerSecond(percent)).toString(), toBN("9.51625e18").toString());
    });

    it("should get correct precise values", async () => {
      let percent = libraryPrecision.times(3.8);
      assert.equal((await interestRateLibrary.getRatePerSecond(percent)).toString(), toBN("1.18264e18").toString());

      percent = libraryPrecision.times(10);
      assert.equal(
        (await interestRateLibrary.getRatePerSecond(percent)).toString(),
        toBN("3022270000000000000").toString()
      );
    });
  });

  describe("getRatePerSecond", () => {
    it("should return correct rate per second", async () => {
      let percent = libraryPrecision.times(0);
      assert.equal((await interestRateLibrary.getRatePerSecond(percent)).toString(), 0);

      percent = libraryPrecision.times(2.5);
      assert.equal((await interestRateLibrary.getRatePerSecond(percent)).toString(), "782998000000000000");

      percent = libraryPrecision.times(10);
      assert.equal((await interestRateLibrary.getRatePerSecond(percent)).toString(), "3022270000000000000");

      percent = libraryPrecision.times(25);
      assert.equal((await interestRateLibrary.getRatePerSecond(percent)).toString(), "7075840000000000000");

      percent = libraryPrecision.times(100);
      assert.equal((await interestRateLibrary.getRatePerSecond(percent)).toString(), "21979600000000000000");
    });

    it("should get exception if pass incorrect annual rate", async () => {
      const reason = "InterestRateLibrary: Unsupported percentage.";

      await truffleAssert.reverts(interestRateLibrary.getRatePerSecond(libraryPrecision.times(101)), reason);
    });
  });
});
