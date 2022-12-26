const { setNextBlockTime } = require("./helpers/hardhatTimeTraveller");
const { toBN, accounts, getPercentage100 } = require("../scripts/utils");
const truffleAssert = require("truffle-assertions");

const CompoundRateKeeper = artifacts.require("./contracts/common/CompoundRateKeeper");

CompoundRateKeeper.numberFormat = "BigNumber";

describe("CompoundRateKeeper", () => {
  describe("update()", () => {
    it("Should get correct calculation result of compound rates", async () => {
      const compoundRateKeeper = await CompoundRateKeeper.new();
      const creationTime = (await compoundRateKeeper.compoundRate()).lastUpdate.toNumber();

      await setNextBlockTime(creationTime + 10);

      const interestRate = getPercentage100().multipliedBy(0.01);
      await compoundRateKeeper.update(interestRate);

      const actualRate = toBN((await compoundRateKeeper.compoundRate()).rate).decimalPlaces(27);

      // 1.10462212541120451001 * 10^27
      const expRate = toBN("1.10462212541120451001e+27").decimalPlaces(27);
      assert.equal(toBN(actualRate).toString(), toBN(expRate).toString());
    });

    it("should check auth", async () => {
      const rateKeeper = await CompoundRateKeeper.new();

      const NOT_OWNER = await accounts(1);
      await truffleAssert.reverts(
        rateKeeper.update(getPercentage100().multipliedBy(0.01), { from: NOT_OWNER }),
        "Ownable: caller is not the owner"
      );
    });
  });
});
