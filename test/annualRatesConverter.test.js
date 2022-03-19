const { getInterestRateLibraryData } = require("../deploy/helpers/deployHelper");
const { toBN } = require("../scripts/utils");

const truffleAssert = require("truffle-assertions");
const Reverter = require("./helpers/reverter");

const AnnualRatesConverter = artifacts.require("AnnualRatesConverterMock");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");

AnnualRatesConverter.numberFormat = "BigNumber";
InterestRateLibrary.numberFormat = "BigNumber";

describe("AnnualRatesConverter", () => {
  const reverter = new Reverter();

  const onePercent = toBN(10).pow(25);
  const decimal = onePercent.times(100);

  let annualRatesConverter;
  let interestRateLibrary;

  before("setup", async () => {
    annualRatesConverter = await AnnualRatesConverter.new();
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

  describe("getAnnualRate", () => {
    const firstSlope = onePercent.times(5);
    const secondSlope = onePercent.times(100);
    const breakingPoint = onePercent.times(70);

    it("should return correct annual rate if current UR = 0", async () => {
      const result = await annualRatesConverter.getAnnualRate(0, firstSlope, 0, 0, breakingPoint);

      assert.equal(result, 0);
    });

    it("should return correct annual rate if current UR = 55%", async () => {
      const currentUR = onePercent.times(55);

      const expectedAnnualRate = toBN("39285714280000000000000000");
      const result = await annualRatesConverter.getAnnualRate(0, firstSlope, currentUR, 0, breakingPoint);

      assert.closeTo(result.toNumber(), expectedAnnualRate.toNumber(), onePercent.idiv(1000).toNumber());
    });

    it("should return correct annual rate if current UR = 85%", async () => {
      const currentUR = onePercent.times(85);

      const expectedAnnualRate = toBN("525000000000000000000000000");
      const result = await annualRatesConverter.getAnnualRate(
        firstSlope,
        secondSlope,
        currentUR,
        breakingPoint,
        decimal
      );

      assert.closeTo(result.toNumber(), expectedAnnualRate.toNumber(), 10);
    });
  });

  describe("convertToRatePerSecond", () => {
    it("should return correct rate per second if rate per year is an integer", async () => {
      let ratePerYear = onePercent.times(13);
      let dataArr = getInterestRateLibraryData("deploy/data/InterestRatesData.txt");

      assert.equal(
        (await annualRatesConverter.convertToRatePerSecond(interestRateLibrary.address, ratePerYear)).toString(),
        toBN(dataArr[2]).toString()
      );

      ratePerYear = onePercent.times(4);
      dataArr = getInterestRateLibraryData("deploy/data/InterestRatesExactData.txt");

      assert.equal(
        (await annualRatesConverter.convertToRatePerSecond(interestRateLibrary.address, ratePerYear)).toString(),
        toBN(dataArr[39]).toString()
      );
    });

    it("should return correct rate per second if annual rate > 10%", async () => {
      const ratePerYear = onePercent.times(27.18);

      const expectedPercentage = toBN("7623946000000000000");
      assert.equal(
        (await annualRatesConverter.convertToRatePerSecond(interestRateLibrary.address, ratePerYear)).toString(),
        expectedPercentage.toString()
      );
    });

    it("should return correct rate per second if annual rate < 10%", async () => {
      let ratePerYear = onePercent.times(2.2);

      let expectedPercentage = toBN("690052000000000000");
      assert.equal(
        (await annualRatesConverter.convertToRatePerSecond(interestRateLibrary.address, ratePerYear)).toString(),
        expectedPercentage.toString()
      );

      ratePerYear = onePercent.times(3.55);

      expectedPercentage = toBN("1106170000000000000");
      assert.equal(
        (await annualRatesConverter.convertToRatePerSecond(interestRateLibrary.address, ratePerYear)).toString(),
        expectedPercentage.toString()
      );

      ratePerYear = onePercent.times(6.789);

      expectedPercentage = toBN("2082851900000000000");
      assert.equal(
        (await annualRatesConverter.convertToRatePerSecond(interestRateLibrary.address, ratePerYear)).toString(),
        expectedPercentage.toString()
      );
    });

    it("should get exception if passed rate is not supported", async () => {
      const ratePerYear = onePercent.times(220);
      const reason = "AnnualRatesConverter: Interest rate is not supported.";

      await truffleAssert.reverts(
        annualRatesConverter.convertToRatePerSecond(interestRateLibrary.address, ratePerYear),
        reason
      );
    });
  });
});
