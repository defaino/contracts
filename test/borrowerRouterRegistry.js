const Registry = artifacts.require("Registry");
const IntegrationCore = artifacts.require("IntegrationCore");
const BorrowerRouter = artifacts.require("BorrowerRouter");
const BorrowerRouterMock = artifacts.require("BorrowerRouterMockUpgradeable");
const BorrowerRouterRegistry = artifacts.require("BorrowerRouterRegistry");
const BorrowerRouterFactory = artifacts.require("BorrowerRouterFactory");
const UpgradeableBeacon = artifacts.require("UpgradeableBeacon");

const { advanceBlockAtTime } = require("./helpers/ganacheTimeTraveler");
const Reverter = require("./helpers/reverter");
const { assert } = require("chai");

const setCurrentTime = advanceBlockAtTime;
const truffleAssert = require("truffle-assertions");

contract("BorrowerRouterRegistry", async (accounts) => {
  const reverter = new Reverter(web3);

  const USER1 = accounts[1];
  const USER2 = accounts[2];
  const NOTHING = accounts[9];

  let integrationCore;
  let borrowerRouterRegistry;
  let borrowerRouterImpl;

  before("setup", async () => {
    registry = await Registry.new();

    const _integrationCore = await IntegrationCore.new();
    const _borrowerRouterRegistry = await BorrowerRouterRegistry.new();
    const _borrowerRouterFactory = await BorrowerRouterFactory.new();
    borrowerRouterImpl = await BorrowerRouter.new();

    await registry.addContract(await registry.ASSET_PARAMETERS_NAME(), NOTHING);
    await registry.addContract(await registry.SYSTEM_PARAMETERS_NAME(), NOTHING);
    await registry.addContract(await registry.REWARDS_DISTRIBUTION_NAME(), NOTHING);
    await registry.addContract(await registry.ASSETS_REGISTRY_NAME(), NOTHING);
    await registry.addContract(await registry.DEFI_CORE_NAME(), NOTHING);
    await registry.addContract(await registry.LIQUIDITY_POOL_REGISTRY_NAME(), NOTHING);

    await registry.addProxyContract(await registry.INTEGRATION_CORE_NAME(), _integrationCore.address);
    await registry.addProxyContract(await registry.BORROWER_ROUTER_REGISTRY_NAME(), _borrowerRouterRegistry.address);
    await registry.addProxyContract(await registry.BORROWER_ROUTER_FACTORY_NAME(), _borrowerRouterFactory.address);

    await registry.injectDependencies(await registry.INTEGRATION_CORE_NAME());
    await registry.injectDependencies(await registry.BORROWER_ROUTER_REGISTRY_NAME());
    await registry.injectDependencies(await registry.BORROWER_ROUTER_FACTORY_NAME());

    integrationCore = await IntegrationCore.at(await registry.getIntegrationCoreContract());
    borrowerRouterRegistry = await BorrowerRouterRegistry.at(await registry.getBorrowerRouterRegistryContract());

    await borrowerRouterRegistry.borrowerRouterRegistryInitialize(borrowerRouterImpl.address);

    await setCurrentTime(1);

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("updateUserBorrowerRouter", async () => {
    it("should correct update user borrower router", async () => {
      assert.isFalse(await borrowerRouterRegistry.isBorrowerRouterExists(USER1));

      await integrationCore.deployBorrowerRouter({ from: USER1 });

      assert.isTrue(await borrowerRouterRegistry.isBorrowerRouterExists(USER1));
    });
  });

  describe("getBorrowerRoutersBeacon", async () => {
    it("should correct set implementation", async () => {
      const borrowerRouterBeacon = await UpgradeableBeacon.at(await borrowerRouterRegistry.getBorrowerRoutersBeacon());

      assert.equal(borrowerRouterImpl.address, await borrowerRouterBeacon.implementation());
    });
  });

  describe("upgradeBorrowerRouterImpl", async () => {
    it("should correctly update implementation for the borrower routers", async () => {
      await integrationCore.deployBorrowerRouter({ from: USER1 });
      await integrationCore.deployBorrowerRouter({ from: USER2 });

      const user1BorrowerRouterAddr = await borrowerRouterRegistry.borrowerRouters(USER1);
      const user2BorrowerRouterAddr = await borrowerRouterRegistry.borrowerRouters(USER2);

      let user1CurrentBorrowerRouter = await BorrowerRouterMock.at(user1BorrowerRouterAddr);
      let user2CurrentBorrowerRouter = await BorrowerRouterMock.at(user2BorrowerRouterAddr);

      await truffleAssert.reverts(user1CurrentBorrowerRouter.changeUser(USER2));
      await truffleAssert.reverts(user1CurrentBorrowerRouter.changeUser(USER1));

      const newImplementation = await BorrowerRouterMock.new();

      await borrowerRouterRegistry.upgradeBorrowerRouterImpl(newImplementation.address);

      assert.equal(await user1CurrentBorrowerRouter.user(), USER1);
      assert.equal(await user2CurrentBorrowerRouter.user(), USER2);

      await user1CurrentBorrowerRouter.changeUser(USER2);
      await user2CurrentBorrowerRouter.changeUser(USER1);

      assert.equal(await user1CurrentBorrowerRouter.user(), USER2);
      assert.equal(await user2CurrentBorrowerRouter.user(), USER1);
    });
  });
});
