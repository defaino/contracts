const { toBytes } = require("./helpers/bytesCompareLibrary");
const { toBN, accounts, wei } = require("../scripts/utils/utils");
const { ZERO_ADDR } = require("../scripts/utils/constants");
const { getInterestRateLibraryAddr } = require("./helpers/coverage-helper");
const truffleAssert = require("truffle-assertions");
const Reverter = require("./helpers/reverter");

const Registry = artifacts.require("Registry");
const AssetParameters = artifacts.require("AssetParametersMock");
const DefiCore = artifacts.require("DefiCoreMock");
const RewardsDistribution = artifacts.require("RewardsDistributionMock");
const SystemParameters = artifacts.require("SystemParametersMock");
const SystemPoolsRegistry = artifacts.require("SystemPoolsRegistryMock");
const PriceManager = artifacts.require("PriceManager");
const UserInfoRegistry = artifacts.require("UserInfoRegistry");
const SystemPoolsFactory = artifacts.require("SystemPoolsFactory");

describe("Registry", async () => {
  const reverter = new Reverter();

  let NOTHING;

  let registry;
  let assetParameters;
  let defiCore;
  let rewardsDistribution;
  let systemParameters;
  let systemPoolsRegistry;

  before("setup", async () => {
    NOTHING = await accounts(8);
    LIQUIDITY_POOL_REGISTRY = await accounts(9);

    registry = await Registry.new();

    const _defiCore = await DefiCore.new();
    const _systemParameters = await SystemParameters.new();
    const _assetParameters = await AssetParameters.new();
    const _rewardsDistribution = await RewardsDistribution.new();
    const _systemPoolsRegistry = await SystemPoolsRegistry.new();
    const _priceManager = await PriceManager.new();
    const _userInfoRegistry = await UserInfoRegistry.new();
    const _systemPoolsFactory = await SystemPoolsFactory.new();

    await registry.__OwnableContractsRegistry_init();

    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), _priceManager.address);
    await registry.addProxyContract(await registry.USER_INFO_REGISTRY_NAME(), _userInfoRegistry.address);
    await registry.addProxyContract(await registry.SYSTEM_POOLS_FACTORY_NAME(), _systemPoolsFactory.address);

    await registry.addProxyContract(await registry.DEFI_CORE_NAME(), _defiCore.address);
    await registry.addProxyContract(await registry.SYSTEM_PARAMETERS_NAME(), _systemParameters.address);
    await registry.addProxyContract(await registry.ASSET_PARAMETERS_NAME(), _assetParameters.address);
    await registry.addProxyContract(await registry.REWARDS_DISTRIBUTION_NAME(), _rewardsDistribution.address);
    await registry.addProxyContract(await registry.SYSTEM_POOLS_REGISTRY_NAME(), _systemPoolsRegistry.address);

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
      let NEW_OWNER;
      NEW_OWNER = await accounts(2);

      await registry.transferOwnershipAndInject(NEW_OWNER, [
        "ASSET_PARAMETERS",
        "DEFI_CORE",
        "REWARDS_DISTRIBUTION",
        "SYSTEM_PARAMETERS",
        "SYSTEM_POOLS_REGISTRY",
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
  });
});
