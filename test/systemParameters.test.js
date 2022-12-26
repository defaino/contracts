const { accounts, getPrecision } = require("../scripts/utils");

const truffleAssert = require("truffle-assertions");
const Reverter = require("./helpers/reverter");

const SystemParameters = artifacts.require("SystemParameters");
const Registry = artifacts.require("Registry");

SystemParameters.numberFormat = "BigNumber";
Registry.numberFormat = "BigNumber";

describe("SystemParameters", () => {
  const reverter = new Reverter();

  const ADDRESS_NULL = "0x0000000000000000000000000000000000000000";

  let OWNER;
  let SOMEBODY;
  let NOTHING;

  let systemParameters;
  let registry;

  before("setup", async () => {
    OWNER = await accounts(0);
    SOMEBODY = await accounts(1);
    NOTHING = await accounts(8);

    registry = await Registry.new();
    const _systemParameters = await SystemParameters.new();

    await registry.__OwnableContractsRegistry_init();

    await registry.addProxyContract(await registry.SYSTEM_PARAMETERS_NAME(), _systemParameters.address);

    systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());

    await registry.injectDependencies(await registry.SYSTEM_PARAMETERS_NAME());

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("setRewardsTokenAddress", async () => {
    it("should correctly set rewards token address", async () => {
      const txReceipt = await systemParameters.setRewardsTokenAddress(ADDRESS_NULL);

      assert.equal(await systemParameters.getRewardsTokenAddress(), ADDRESS_NULL);
      assert.equal(txReceipt.receipt.logs[0].event, "RewardsTokenUpdated");
      assert.equal(txReceipt.receipt.logs[0].args._rewardsToken, ADDRESS_NULL);

      await systemParameters.setRewardsTokenAddress(NOTHING);

      assert.equal(await systemParameters.getRewardsTokenAddress(), NOTHING);
    });

    it("should get exception if try to change rewards token", async () => {
      const reason = "SystemParameters: Unable to change rewards token address.";

      await systemParameters.setRewardsTokenAddress(NOTHING);

      await truffleAssert.reverts(systemParameters.setRewardsTokenAddress(ADDRESS_NULL), reason);
    });
  });

  describe("setupLiquidationBoundary", async () => {
    it("should correctly set new liquidation boundary", async () => {
      const newValue = getPrecision().times(50);

      await systemParameters.setupLiquidationBoundary(newValue);

      assert.equal((await systemParameters.getLiquidationBoundary()).toString(), newValue.toString());
    });

    it("should get exception if try to set invalid value", async () => {
      const reason = "SystemParameters: The new value of the liquidation boundary is invalid.";

      let newValue = getPrecision().times(30);

      await truffleAssert.reverts(systemParameters.setupLiquidationBoundary(newValue), reason);

      newValue = getPrecision().times(90);

      await truffleAssert.reverts(systemParameters.setupLiquidationBoundary(newValue), reason);
    });
  });

  describe("setupStablePoolsAvailability", () => {
    it("should correctly set stable pools availability parameter", async () => {
      const txReceipt = await systemParameters.setupStablePoolsAvailability(true);

      assert.equal(await systemParameters.getStablePoolsAvailability(), true);
      assert.equal(txReceipt.receipt.logs[0].event, "StablePoolsAvailabilityUpdated");
      assert.equal(txReceipt.receipt.logs[0].args._newValue, true);
    });
  });

  describe("onlySystemOwner modifier", () => {
    it("should get exception if not system owner try to call functions", async () => {
      const newValue = getPrecision().times(50);
      const reason = "SystemParameters: Only system owner can call this function.";

      await truffleAssert.reverts(systemParameters.setupLiquidationBoundary(newValue, { from: SOMEBODY }), reason);
      await truffleAssert.reverts(systemParameters.setupStablePoolsAvailability(true, { from: SOMEBODY }), reason);
    });
  });

  describe("getters", () => {
    it("should return correct values", async () => {
      const newValue = getPrecision().times(50);

      await systemParameters.setRewardsTokenAddress(NOTHING);
      await systemParameters.setupLiquidationBoundary(newValue);
      await systemParameters.setupStablePoolsAvailability(true);

      assert.equal(await systemParameters.getRewardsTokenAddress(), NOTHING);
      assert.equal((await systemParameters.getLiquidationBoundary()).toString(), newValue.toString());
      assert.equal(await systemParameters.getStablePoolsAvailability(), true);
    });

    it("should get exception if parameter does not set", async () => {
      const reason = "SystemParameters: Param for this key doesn't exist.";

      await truffleAssert.reverts(systemParameters.getRewardsTokenAddress(), reason);
      await truffleAssert.reverts(systemParameters.getLiquidationBoundary(), reason);
      await truffleAssert.reverts(systemParameters.getStablePoolsAvailability(), reason);
    });
  });
});
