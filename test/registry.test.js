const { accounts } = require("../scripts/utils");

const truffleAssert = require("truffle-assertions");
const Reverter = require("./helpers/reverter");

const Registry = artifacts.require("Registry");
const GovernanceToken = artifacts.require("GovernanceToken");
const GovernanceTokenMock = artifacts.require("GovernanceTokenMock");

describe("Registry", () => {
  const reverter = new Reverter(web3);

  const ADDRESS_NULL = "0x0000000000000000000000000000000000000000";

  let OWNER;

  let registry;

  before("setup", async () => {
    OWNER = await accounts(0);
    registry = await Registry.new();

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("addContract", () => {
    let governanceToken;

    beforeEach("setup", async () => {
      governanceToken = await GovernanceToken.new(OWNER);
    });

    it("should correctly add new contract to the registry", async () => {
      const txReceipt = await registry.addContract(await registry.GOVERNANCE_TOKEN_NAME(), governanceToken.address);

      assert.equal(await registry.getGovernanceTokenContract(), governanceToken.address);
    });

    it("should get exception if try to change contract address", async () => {
      await registry.addContract(await registry.GOVERNANCE_TOKEN_NAME(), governanceToken.address);

      const reason = "Registry: Unable to change the contract.";
      await truffleAssert.reverts(
        registry.addContract(await registry.GOVERNANCE_TOKEN_NAME(), governanceToken.address),
        reason
      );
    });

    it("should get exception if the contract address is zero address", async () => {
      const reason = "Registry: Null address is forbidden.";
      await truffleAssert.reverts(registry.addContract(await registry.GOVERNANCE_TOKEN_NAME(), ADDRESS_NULL), reason);
    });
  });

  describe("addProxyContract", () => {
    let governanceTokenImpl;

    beforeEach("setup", async () => {
      governanceTokenImpl = await GovernanceToken.new(OWNER);
    });

    it("should correctly add new contract to the registry", async () => {
      const txReceipt = await registry.addProxyContract(
        await registry.GOVERNANCE_TOKEN_NAME(),
        governanceTokenImpl.address
      );
    });

    it("should get exception if try to change contract address", async () => {
      await registry.addProxyContract(await registry.GOVERNANCE_TOKEN_NAME(), governanceTokenImpl.address);

      const reason = "Registry: Unable to change the contract.";
      await truffleAssert.reverts(
        registry.addProxyContract(await registry.GOVERNANCE_TOKEN_NAME(), governanceTokenImpl.address),
        reason
      );
    });

    it("should get exception if the contract address is zero address", async () => {
      const reason = "Registry: Null address is forbidden.";
      await truffleAssert.reverts(
        registry.addProxyContract(await registry.GOVERNANCE_TOKEN_NAME(), ADDRESS_NULL),
        reason
      );
    });
  });

  describe("upgradeContract", () => {
    it("should correctlry upgrade contract", async () => {
      const oldImplementation = await GovernanceToken.new(OWNER);
      const newImplementation = await GovernanceTokenMock.new(OWNER);

      await registry.addProxyContract(await registry.REWARDS_DISTRIBUTION_NAME(), oldImplementation.address);

      const proxyAddr = await registry.getRewardsDistributionContract();

      assert.equal(
        await registry.getImplementation(await registry.REWARDS_DISTRIBUTION_NAME()),
        oldImplementation.address
      );
      await truffleAssert.reverts((await GovernanceTokenMock.at(proxyAddr)).mintArbitrary(await accounts(1), 1000));

      await registry.upgradeContract(await registry.REWARDS_DISTRIBUTION_NAME(), newImplementation.address);

      assert.equal(await registry.getRewardsDistributionContract(), proxyAddr);
      assert.equal(
        await registry.getImplementation(await registry.REWARDS_DISTRIBUTION_NAME()),
        newImplementation.address
      );

      const governanceToken = await GovernanceTokenMock.at(proxyAddr);
      await governanceToken.mintArbitrary(await accounts(1), 1000);

      assert.equal(await governanceToken.balanceOf(await accounts(1)), 1000);
    });
  });
});
