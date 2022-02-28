const CompoundRateKeeper = artifacts.require("./contracts/common/CompoundRateKeeper");
const { advanceBlockAtTime } = require("./helpers/ganacheTimeTraveler");

const { getDecimal, toBN } = require("../scripts/globals");
const truffleAssert = require("truffle-assertions");

contract("CompoundRateKeeper", async (accounts) => {
  describe("update()", async () => {
    it("Should get correct calculation result of compound rates", async () => {
      const compoundRateKeeper = await CompoundRateKeeper.new();
      const creationTime = (await compoundRateKeeper.compoundRate()).lastUpdate.toNumber();

      await advanceBlockAtTime(creationTime + 10);

      const interestRate = getDecimal().multipliedBy(0.01);
      await compoundRateKeeper.update(interestRate);

      const actualRate = toBN((await compoundRateKeeper.compoundRate()).rate).decimalPlaces(27);

      // 1.10462212541120451001 * 10^27
      const expRate = toBN("1.10462212541120451001e+27").decimalPlaces(27);
      assert.equal(toBN(actualRate).toString(), toBN(expRate).toString());
    });

    it("should check auth", async () => {
      const OWNER = accounts[0];
      const rateKeeper = await CompoundRateKeeper.new({ from: OWNER });

      const NOT_OWNER = accounts[1];
      await truffleAssert.reverts(
        rateKeeper.update(getDecimal().multipliedBy(0.01), { from: NOT_OWNER }),
        "Ownable: caller is not the owner"
      );
    });
  });
});
