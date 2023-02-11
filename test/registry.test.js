const { toBytes } = require("./helpers/bytesCompareLibrary");
const { toBN, accounts, wei } = require("../scripts/utils/utils");
const { ZERO_ADDR } = require("../scripts/utils/constants");
const { getInterestRateLibraryAddr } = require("./helpers/coverage-helper");
const truffleAssert = require("truffle-assertions");
const Reverter = require("./helpers/reverter");
const { Assertion } = require("chai");

const Registry = artifacts.require("Registry");
const AssetParameters = artifacts.require("AssetParametersMock");
const DefiCore = artifacts.require("DefiCoreMock");
const RewardsDistribution = artifacts.require("RewardsDistributionMock");
const SystemParameters = artifacts.require("SystemParametersMock");
const SystemPoolsRegistry = artifacts.require("SystemPoolsRegistryMock");
const PriceManager = artifacts.require("PriceManager");
const UserInfoRegistry = artifacts.require("UserInfoRegistry");
const SystemPoolsFactory = artifacts.require("SystemPoolsFactory");
const Prt = artifacts.require("PRT");

describe("Registry", async () => {
  const reverter = new Reverter();
  let NOT_AN_OWNER;
  let NEW_OWNER;

  let registry;
  let assetParameters;
  let defiCore;
  let rewardsDistribution;
  let systemParameters;
  let systemPoolsRegistry;
  let prt;

  before("setup", async () => {
    LIQUIDITY_POOL_REGISTRY = await accounts(9);
    NEW_OWNER = await accounts(2);
    NOT_AN_OWNER = await accounts(3);
    registry = await Registry.new();

    const _defiCore = await DefiCore.new();
    const _systemParameters = await SystemParameters.new();
    const _assetParameters = await AssetParameters.new();
    const _rewardsDistribution = await RewardsDistribution.new();
    const _systemPoolsRegistry = await SystemPoolsRegistry.new();
    const _priceManager = await PriceManager.new();
    const _userInfoRegistry = await UserInfoRegistry.new();
    const _systemPoolsFactory = await SystemPoolsFactory.new();
    const _prt = await Prt.new();

    await registry.__OwnableContractsRegistry_init();

    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), _priceManager.address);
    await registry.addProxyContract(await registry.USER_INFO_REGISTRY_NAME(), _userInfoRegistry.address);
    await registry.addProxyContract(await registry.SYSTEM_POOLS_FACTORY_NAME(), _systemPoolsFactory.address);

    await registry.addProxyContract(await registry.DEFI_CORE_NAME(), _defiCore.address);
    await registry.addProxyContract(await registry.SYSTEM_PARAMETERS_NAME(), _systemParameters.address);
    await registry.addProxyContract(await registry.ASSET_PARAMETERS_NAME(), _assetParameters.address);
    await registry.addProxyContract(await registry.REWARDS_DISTRIBUTION_NAME(), _rewardsDistribution.address);
    await registry.addProxyContract(await registry.SYSTEM_POOLS_REGISTRY_NAME(), _systemPoolsRegistry.address);
    await registry.addProxyContract(await registry.PRT_NAME(), _prt.address);

    defiCore = await DefiCore.at(await registry.getDefiCoreContract());
    assetParameters = await AssetParameters.at(await registry.getAssetParametersContract());
    systemPoolsRegistry = await SystemPoolsRegistry.at(await registry.getSystemPoolsRegistryContract());
    rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());
    systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("transferOwnershipAndInject", () => {
    it("should correctly change the owner and set the _systemOwnerAddr on contracts", async () => {
      await registry.transferOwnershipAndInject(NEW_OWNER, [
        await registry.ASSET_PARAMETERS_NAME(),
        await registry.DEFI_CORE_NAME(),
        await registry.REWARDS_DISTRIBUTION_NAME(),
        await registry.SYSTEM_PARAMETERS_NAME(),
        await registry.SYSTEM_POOLS_REGISTRY_NAME(),
      ]);

      assetParamOwner = await assetParameters.getSystemOwnerAddr();
      defiCoreOwner = await defiCore.getSystemOwnerAddr();
      rewDistribOwner = await rewardsDistribution.getSystemOwnerAddr();
      sysParamsOwner = await systemParameters.getSystemOwnerAddr();
      sysPoolsRegOwner = await systemPoolsRegistry.getSystemOwnerAddr();

      assert.equal(NEW_OWNER, assetParamOwner);
      assert.equal(NEW_OWNER, defiCoreOwner);
      assert.equal(NEW_OWNER, rewDistribOwner);
      assert.equal(NEW_OWNER, sysParamsOwner);
      assert.equal(NEW_OWNER, sysPoolsRegOwner);
    });

    it("should get exception if called not by the owner", async () => {
      const reason = "Ownable: caller is not the owner";

      await truffleAssert.reverts(
        registry.transferOwnershipAndInject(
          NEW_OWNER,
          [
            await registry.ASSET_PARAMETERS_NAME(),
            await registry.DEFI_CORE_NAME(),
            await registry.REWARDS_DISTRIBUTION_NAME(),
            await registry.SYSTEM_PARAMETERS_NAME(),
            await registry.SYSTEM_POOLS_REGISTRY_NAME(),
          ],
          { from: NOT_AN_OWNER }
        ),
        reason
      );
    });
  });

  describe("renounceOwnership()", () => {
    it("should get exception if called by owner and by not an owner", async () => {
      let reason = "Registry: renounceOwnership is prohibbited";

      await truffleAssert.reverts(registry.renounceOwnership(), reason);

      reason = "Ownable: caller is not the owner";

      await truffleAssert.reverts(registry.renounceOwnership({ from: NOT_AN_OWNER }), reason);
    });
  });
});
