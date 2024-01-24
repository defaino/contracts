const { setNextBlockTime, getCurrentBlockTime } = require("./helpers/block-helper");
const { toBytes, fromBytes, deepCompareKeys, compareKeys } = require("./helpers/bytesCompareLibrary");
const { getInterestRateLibraryAddr } = require("./helpers/coverage-helper");
const { toBN, accounts, getPrecision, getPercentage100, wei } = require("../scripts/utils/utils");
const { ZERO_ADDR } = require("../scripts/utils/constants");

const truffleAssert = require("truffle-assertions");
const Reverter = require("./helpers/reverter");
const { assert } = require("chai");
const { artifacts } = require("hardhat");

const Registry = artifacts.require("Registry");
const DefiCore = artifacts.require("DefiCore");
const SystemParameters = artifacts.require("SystemParameters");
const AssetParameters = artifacts.require("AssetParameters");
const RewardsDistribution = artifacts.require("RewardsDistributionMock");
const UserInfoRegistry = artifacts.require("UserInfoRegistry");
const SystemPoolsRegistry = artifacts.require("SystemPoolsRegistry");
const SystemPoolsRegistryMock = artifacts.require("SystemPoolsRegistryMock");
const SystemPoolsFactory = artifacts.require("SystemPoolsFactory");
const LiquidityPool = artifacts.require("LiquidityPool");
const StablePool = artifacts.require("StablePool");
const LiquidityPoolMock = artifacts.require("LiquidityPoolMock");
const AbstractPool = artifacts.require("AbstractPool");
const PriceManager = artifacts.require("PriceManager");
const Prt = artifacts.require("PRT");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const StablePermitToken = artifacts.require("StablePermitTokenMock");
const PublicBeaconProxy = artifacts.require("PublicBeaconProxy");

const MockERC20 = artifacts.require("MockERC20");
const ChainlinkOracleMock = artifacts.require("ChainlinkOracleMock");

LiquidityPool.numberFormat = "BigNumber";
SystemPoolsRegistry.numberFormat = "BigNumber";
SystemPoolsRegistryMock.numberFormat = "BigNumber";

describe("SystemPoolsRegistry", () => {
  const reverter = new Reverter();

  const annualBorrowRate = getPrecision().times(3);
  const colRatio = getPercentage100().times("1.25");
  const oneToken = toBN(10).pow(18);
  const tokensAmount = wei(1000);
  const reserveFactor = getPrecision().times("15");
  const priceDecimals = toBN(8);
  const price = toBN(100);

  const firstSlope = getPrecision().times(4);
  const secondSlope = getPercentage100();
  const utilizationBreakingPoint = getPrecision().times(80);
  const maxUR = getPrecision().times(95);

  const liquidationDiscount = getPrecision().times(8);

  const minSupplyDistributionPart = getPrecision().times(15);
  const minBorrowDistributionPart = getPrecision().times(10);

  let OWNER;
  let USER1;
  let USER2;
  let NOTHING;
  let TEST_ASSET;

  let systemParameters;
  let assetParameters;
  let defiCore;
  let registry;
  let rewardsDistribution;
  let systemPoolsRegistry;
  let liquidityPoolFactory;
  let prt;

  let rewardsToken;

  const zeroKey = toBytes("");
  const rewardsTokenKey = toBytes("RTK");
  const nativeTokenKey = toBytes("BNB");
  const daiKey = toBytes("DAI");

  async function getLiquidityPoolAddr(assetKey) {
    return (await systemPoolsRegistry.poolsInfo(assetKey))[0];
  }

  async function createLiquidityPool(assetKey, symbol, isCollateral) {
    const token = await MockERC20.new("Mock" + symbol, symbol);
    await token.mintArbitraryBatch([OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);

    const chainlinkOracle = await ChainlinkOracleMock.new(wei(price, priceDecimals), priceDecimals);

    await systemPoolsRegistry.addLiquidityPool(
      token.address,
      assetKey,
      chainlinkOracle.address,
      symbol,
      isCollateral,
      isCollateral
    );

    if (assetKey != nativeTokenKey) {
      await token.approveArbitraryBatch(
        await getLiquidityPoolAddr(assetKey),
        [OWNER, USER1, USER2],
        [tokensAmount, tokensAmount, tokensAmount]
      );
    }

    await assetParameters.setupAllParameters(assetKey, [
      [colRatio, colRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);

    return token;
  }

  async function createStablePool(assetKey, assetAddr) {
    await systemPoolsRegistry.addStablePool(assetAddr, assetKey, ZERO_ADDR);

    await assetParameters.setupAnnualBorrowRate(assetKey, annualBorrowRate);
    await assetParameters.setupMainParameters(assetKey, [
      colRatio,
      colRatio,
      reserveFactor,
      liquidationDiscount,
      maxUR,
    ]);
  }

  async function deployRewardsPool(rewardsTokenAddr, symbol) {
    const chainlinkOracle = await ChainlinkOracleMock.new(wei(10, priceDecimals), priceDecimals);

    await systemPoolsRegistry.addLiquidityPool(
      rewardsTokenAddr,
      rewardsTokenKey,
      chainlinkOracle.address,
      symbol,
      true,
      true
    );

    await assetParameters.setupAllParameters(rewardsTokenKey, [
      [colRatio, colRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);
  }

  before("setup", async () => {
    OWNER = await accounts(0);
    USER1 = await accounts(1);
    USER2 = await accounts(2);
    NOTHING = await accounts(8);
    TEST_ASSET = await accounts(9);

    rewardsToken = await MockERC20.new("MockRTK", "RTK");

    const interestRateLibrary = await InterestRateLibrary.at(await getInterestRateLibraryAddr());

    registry = await Registry.new();
    const _defiCore = await DefiCore.new();
    const _systemParameters = await SystemParameters.new();
    const _assetParameters = await AssetParameters.new();
    const _rewardsDistribution = await RewardsDistribution.new();
    const _userInfoRegistry = await UserInfoRegistry.new();
    const _systemPoolsRegistry = await SystemPoolsRegistry.new();
    const _liquidityPoolFactory = await SystemPoolsFactory.new();
    const _liquidityPoolImpl = await LiquidityPool.new();
    const _priceManager = await PriceManager.new();
    const _prt = await Prt.new();

    await registry.__OwnableContractsRegistry_init();

    await registry.addProxyContract(await registry.DEFI_CORE_NAME(), _defiCore.address);
    await registry.addProxyContract(await registry.SYSTEM_PARAMETERS_NAME(), _systemParameters.address);
    await registry.addProxyContract(await registry.ASSET_PARAMETERS_NAME(), _assetParameters.address);
    await registry.addProxyContract(await registry.REWARDS_DISTRIBUTION_NAME(), _rewardsDistribution.address);
    await registry.addProxyContract(await registry.USER_INFO_REGISTRY_NAME(), _userInfoRegistry.address);
    await registry.addProxyContract(await registry.SYSTEM_POOLS_REGISTRY_NAME(), _systemPoolsRegistry.address);
    await registry.addProxyContract(await registry.SYSTEM_POOLS_FACTORY_NAME(), _liquidityPoolFactory.address);
    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), _priceManager.address);
    await registry.addProxyContract(await registry.PRT_NAME(), _prt.address);

    await registry.addContract(await registry.INTEREST_RATE_LIBRARY_NAME(), interestRateLibrary.address);

    defiCore = await DefiCore.at(await registry.getDefiCoreContract());
    assetParameters = await AssetParameters.at(await registry.getAssetParametersContract());
    systemPoolsRegistry = await SystemPoolsRegistry.at(await registry.getSystemPoolsRegistryContract());
    rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());
    systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());
    liquidityPoolFactory = await SystemPoolsFactory.at(await registry.getSystemPoolsFactoryContract());

    await registry.injectDependencies(await registry.DEFI_CORE_NAME());
    await registry.injectDependencies(await registry.SYSTEM_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.ASSET_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.REWARDS_DISTRIBUTION_NAME());
    await registry.injectDependencies(await registry.USER_INFO_REGISTRY_NAME());
    await registry.injectDependencies(await registry.SYSTEM_POOLS_REGISTRY_NAME());
    await registry.injectDependencies(await registry.SYSTEM_POOLS_FACTORY_NAME());
    await registry.injectDependencies(await registry.PRICE_MANAGER_NAME());
    await registry.injectDependencies(await registry.PRT_NAME());

    await defiCore.defiCoreInitialize();
    await systemPoolsRegistry.systemPoolsRegistryInitialize(_liquidityPoolImpl.address, nativeTokenKey, zeroKey);

    await systemParameters.setupStablePoolsAvailability(true);
    await systemParameters.setRewardsTokenAddress(ZERO_ADDR);

    await deployRewardsPool(rewardsToken.address, await rewardsToken.symbol());

    await rewardsToken.mintArbitrary(defiCore.address, tokensAmount);

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("setDependencies()", () => {
    it("should revert if not called by injector", async () => {
      let reason = "Dependant: not an injector";
      await truffleAssert.reverts(systemPoolsRegistry.setDependencies(registry.address, "0x"), reason);
    });
  });

  describe("systemPoolsRegistryInitialize()", () => {
    it("should revert if called after the initializing", async () => {
      const reason = "Initializable: contract is already initialized";
      const _liquidityPoolImpl = await LiquidityPool.new();
      await truffleAssert.reverts(
        systemPoolsRegistry.systemPoolsRegistryInitialize(_liquidityPoolImpl.address, nativeTokenKey, zeroKey),
        reason
      );
    });
  });

  describe("systemPoolsFactory setDependencies", () => {
    it("should revert if not called by injector", async () => {
      let reason = "Dependant: not an injector";
      await truffleAssert.reverts(liquidityPoolFactory.setDependencies(registry.address, "0x"), reason);
    });
  });

  describe("systemPoolsFactory newStablePool", () => {
    it("should revert if not called by SystemPoolsRegistry", async () => {
      let reason = "SystemPoolsFactory: Caller not a SystemPoolsRegistry.";

      const key = toBytes("NEW_ASSET_KEY");
      const new_asset = await MockERC20.new("NEW_ASSEY", "NEW_ASSET");

      await truffleAssert.reverts(liquidityPoolFactory.newStablePool(new_asset.address, key), reason);
    });
  });

  describe("updateRewardsAssetKey", () => {
    it("should correctly update rewards asset key", async () => {
      assert.isTrue(compareKeys(await systemPoolsRegistry.rewardsAssetKey(), zeroKey));
      assert.equal(await getLiquidityPoolAddr(zeroKey), await systemPoolsRegistry.getRewardsLiquidityPool());

      const newRewardsTokenKey = toBytes("NEWRTK");
      const newRewardsToken = await createLiquidityPool(newRewardsTokenKey, "NEWRTK", true);

      await systemParameters.setRewardsTokenAddress(newRewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(newRewardsTokenKey);

      assert.isTrue(compareKeys(await systemPoolsRegistry.rewardsAssetKey(), newRewardsTokenKey));
      assert.equal(await getLiquidityPoolAddr(newRewardsTokenKey), await systemPoolsRegistry.getRewardsLiquidityPool());
    });

    it("should get exception if try to set incorrect rewards asset key", async () => {
      const reason = "SystemPoolsRegistry: Incorrect new rewards asset key.";

      const newRewardsTokenKey = toBytes("NEWRTK");
      const newRewardsToken = await createLiquidityPool(newRewardsTokenKey, "NEWRTK", true);

      await systemParameters.setRewardsTokenAddress(newRewardsToken.address);

      const someKey = toBytes("some key");
      await truffleAssert.reverts(systemPoolsRegistry.updateRewardsAssetKey(someKey));

      await createLiquidityPool(someKey, "some key", true);

      await truffleAssert.reverts(systemPoolsRegistry.updateRewardsAssetKey(someKey), reason);
    });

    it("should get exception if called by not a system owner", async () => {
      const reason = "SystemPoolsRegistry: Only system owner can call this function.";

      assert.isTrue(compareKeys(await systemPoolsRegistry.rewardsAssetKey(), zeroKey));
      assert.equal(await getLiquidityPoolAddr(zeroKey), await systemPoolsRegistry.getRewardsLiquidityPool());

      const newRewardsTokenKey = toBytes("NEWRTK");
      const newRewardsToken = await createLiquidityPool(newRewardsTokenKey, "NEWRTK", true);

      await systemParameters.setRewardsTokenAddress(newRewardsToken.address);

      await truffleAssert.reverts(
        systemPoolsRegistry.updateRewardsAssetKey(newRewardsTokenKey, { from: USER1 }),
        reason
      );
    });
  });

  describe("addPoolsBeacon", () => {
    it("should correctly add new pools beacon", async () => {
      assert.equal(await systemPoolsRegistry.getPoolsBeacon(1), ZERO_ADDR);

      const someAddr = systemPoolsRegistry.address;
      await systemPoolsRegistry.addPoolsBeacon(1, someAddr);

      assert.notEqual(await systemPoolsRegistry.getPoolsBeacon(1), ZERO_ADDR);
      assert.equal(await systemPoolsRegistry.getPoolsImpl(1), someAddr);
    });

    it("should get exception if the pools beacon already set", async () => {
      const reason = "SystemPoolsRegistry: Pools beacon for passed pool type already set.";

      await truffleAssert.reverts(systemPoolsRegistry.addPoolsBeacon(0, NOTHING), reason);
    });

    it("should get exception if not system owner try to call this function", async () => {
      const reason = "SystemPoolsRegistry: Only system owner can call this function.";

      await truffleAssert.reverts(systemPoolsRegistry.addPoolsBeacon(1, NOTHING, { from: USER1 }), reason);
    });
  });

  describe("addLiquidityPool", () => {
    let chainlinkOracle;

    beforeEach("setup", async () => {
      chainlinkOracle = await ChainlinkOracleMock.new(wei(10, 8), 8);
    });

    it("should correctly add liquidity pool", async () => {
      const txReceipt = await systemPoolsRegistry.addLiquidityPool(
        TEST_ASSET,
        daiKey,
        chainlinkOracle.address,
        "DAI",
        true,
        true
      );

      assert.equal(txReceipt.receipt.logs.length, 2);

      assert.equal(txReceipt.receipt.logs[1].event, "PoolAdded");

      assert.equal(fromBytes(txReceipt.receipt.logs[1].args.assetKey), "DAI");
      assert.equal(txReceipt.receipt.logs[1].args.poolAddr, await getLiquidityPoolAddr(daiKey));
    });

    it("should get exception if asset key is empty string", async () => {
      const reason = "SystemPoolsRegistry: Unable to add an asset without a key.";

      await truffleAssert.reverts(
        systemPoolsRegistry.addLiquidityPool(TEST_ASSET, toBytes(""), NOTHING, "DAI", false, false),
        reason
      );
    });

    it("should get exception if asset address is zero address", async () => {
      const reason = "SystemPoolsRegistry: Unable to add an asset with a zero address.";

      await truffleAssert.reverts(
        systemPoolsRegistry.addLiquidityPool(ZERO_ADDR, daiKey, NOTHING, "DAI", true, true),
        reason
      );
    });

    it("should get exception if try to add a pool to a key that already exists", async () => {
      await systemPoolsRegistry.addLiquidityPool(TEST_ASSET, daiKey, NOTHING, "DAI", false, false);

      const reason = "SystemPoolsRegistry: Liquidity pool with such a key already exists.";

      await truffleAssert.reverts(
        systemPoolsRegistry.addLiquidityPool(TEST_ASSET, daiKey, NOTHING, "DAI", false, false),
        reason
      );
    });

    it("should get exception if try to call factory function directrly", async () => {
      const reason = "SystemPoolsFactory: Caller not a SystemPoolsRegistry.";

      await truffleAssert.reverts(liquidityPoolFactory.newLiquidityPool(TEST_ASSET, daiKey, "DAI"), reason);
    });

    it("should get exception if called by not a system owner", async () => {
      const reason = "SystemPoolsRegistry: Only system owner can call this function.";

      await truffleAssert.reverts(
        systemPoolsRegistry.addLiquidityPool(TEST_ASSET, daiKey, chainlinkOracle.address, "DAI", true, true, {
          from: USER1,
        }),
        reason
      );
    });
  });

  describe("addStablePool", () => {
    const symbol = "STA";
    const someKey = toBytes("STA");
    let someToken;

    beforeEach("setup", async () => {
      someToken = await MockERC20.new("Mock" + symbol, symbol);

      const _stablePoolImpl = await StablePool.new();

      await systemPoolsRegistry.addPoolsBeacon(1, _stablePoolImpl.address);
    });

    it("should correctly add new stable pool", async () => {
      const txReceipt = await systemPoolsRegistry.addStablePool(someToken.address, someKey, NOTHING);
      const result = await systemPoolsRegistry.poolsInfo(someKey);

      assert.equal(txReceipt.receipt.logs[1].event, "PoolAdded");
      assert.isTrue(compareKeys(txReceipt.receipt.logs[1].args.assetKey, someKey));
      assert.equal(txReceipt.receipt.logs[1].args.assetAddr, someToken.address);
      assert.equal(txReceipt.receipt.logs[1].args.poolAddr, result[0]);
      assert.equal(txReceipt.receipt.logs[1].args.poolType, 1);
      assert.equal(result[1], 1);
    });

    it("should get exception if stable pools unavailable", async () => {
      await systemParameters.setupStablePoolsAvailability(false);

      const reason = "SystemPoolsRegistry: Stable pools are unavailable.";

      const someKey = toBytes("SOME_KEY");
      await truffleAssert.reverts(systemPoolsRegistry.addStablePool(NOTHING, someKey, NOTHING), reason);
    });

    it("should get exception if called by not a system owner", async () => {
      const reason = "SystemPoolsRegistry: Only system owner can call this function.";

      await truffleAssert.reverts(
        systemPoolsRegistry.addStablePool(someToken.address, someKey, NOTHING, { from: USER1 }),
        reason
      );
    });
  });

  describe("upgradePoolsImpl", () => {
    it("should correctly update liquidity pools", async () => {
      await createLiquidityPool(daiKey, "DAI", true);
      const daiPool = await LiquidityPool.at(await getLiquidityPoolAddr(daiKey));

      const newImplementation = await LiquidityPoolMock.new();

      await truffleAssert.reverts(
        (await LiquidityPoolMock.at(daiPool.address)).getNormalizedAmount(10, 10, 10, 50, true)
      );

      await systemPoolsRegistry.upgradePoolsImpl(0, newImplementation.address);

      assert.equal(await systemPoolsRegistry.getPoolsImpl(0), newImplementation.address);

      const proxy = await PublicBeaconProxy.at(daiPool.address);
      assert.equal(await proxy.implementation(), newImplementation.address);

      const newDaiPool = await LiquidityPoolMock.at(daiPool.address);
      await newDaiPool.getNormalizedAmount(10, 100, 100, 50, true);
    });

    it("should get exception if try to upgrade implementation for unsupported pool type", async () => {
      const reason = "SystemPoolsRegistry: Unsupported pool type.";

      await truffleAssert.reverts(systemPoolsRegistry.upgradePoolsImpl(1, NOTHING), reason);
    });
    it("should get exception if called by not a system owner", async () => {
      const reason = "SystemPoolsRegistry: Only system owner can call this function.";
      await createLiquidityPool(daiKey, "DAI", true);
      const daiPool = await LiquidityPool.at(await getLiquidityPoolAddr(daiKey));

      const newImplementation = await LiquidityPoolMock.new();

      await truffleAssert.reverts(
        (await LiquidityPoolMock.at(daiPool.address)).getNormalizedAmount(10, 10, 10, 50, true)
      );

      await truffleAssert.reverts(
        systemPoolsRegistry.upgradePoolsImpl(0, newImplementation.address, { from: USER1 }),
        reason
      );
    });
  });

  describe("injectDependenciesToExistingPools/injectDependencies", () => {
    const symbols = ["FIRST", "SECOND", "THIRD"];
    const keys = [toBytes("FIRST_KEY"), toBytes("SECOND_KEY"), toBytes("THIRD_KEY")];

    const tokens = [];
    const liquidityPools = [];

    const abstractPoolKeys = [toBytes("AbstractPoolKey")];
    const abstractPools = [];

    beforeEach("setup", async () => {
      for (let i = 0; i < keys.length; i++) {
        tokens.push(await createLiquidityPool(keys[i], symbols[i], true));

        const currentLiquidityPool = await LiquidityPoolMock.at(await getLiquidityPoolAddr(keys[i]));
        liquidityPools.push(currentLiquidityPool);
      }

      tokens.push(await createLiquidityPool(abstractPoolKeys[0], "ABSTR", true));
      const currentAbstractPool = await AbstractPool.at(await getLiquidityPoolAddr(abstractPoolKeys[0]));
      abstractPools.push(currentAbstractPool);

      const newImplementation = await LiquidityPoolMock.new();
      await systemPoolsRegistry.upgradePoolsImpl(0, newImplementation.address);
    });

    it("should correctly inject dependencies to all pools", async () => {
      const currentPriceManager = await registry.getPriceManagerContract();
      const newPriceManager = await PriceManager.new();

      for (let i = 0; i < keys.length; i++) {
        assert.equal(await liquidityPools[i].getPriceManager(), currentPriceManager);
      }

      await registry.addContract(await registry.PRICE_MANAGER_NAME(), newPriceManager.address);

      await systemPoolsRegistry.injectDependenciesToExistingPools();

      for (let i = 0; i < keys.length; i++) {
        assert.equal(await liquidityPools[i].getPriceManager(), newPriceManager.address);
      }
    });

    it("should correctly inject dependencies to slice of pools", async () => {
      const currentPriceManager = await registry.getPriceManagerContract();
      const newPriceManager = await PriceManager.new();

      for (let i = 0; i < keys.length; i++) {
        assert.equal(await liquidityPools[i].getPriceManager(), currentPriceManager);
      }

      await registry.addContract(await registry.PRICE_MANAGER_NAME(), newPriceManager.address);

      await systemPoolsRegistry.injectDependencies(2, 5);

      assert.equal(await liquidityPools[0].getPriceManager(), currentPriceManager);

      for (let i = 1; i < keys.length; i++) {
        assert.equal(await liquidityPools[i].getPriceManager(), newPriceManager.address);
      }
    });

    it("should get exception if try to inject dependencies directly", async () => {
      const reason = "Dependant: not an injector";

      await truffleAssert.reverts(liquidityPools[0].setDependencies(registry.address, "0x"), reason);
    });

    it("should get exception if try to inject dependencies to abstract pool directly", async () => {
      const reason = "Dependant: not an injector";

      await truffleAssert.reverts(abstractPools[0].setDependencies(registry.address, "0x", { from: USER2 }), reason);
    });

    it("injectDependenciesToExistingPools() should get exception if called by not a system owner", async () => {
      const reason = "SystemPoolsRegistry: Only system owner can call this function.";

      const currentPriceManager = await registry.getPriceManagerContract();
      const newPriceManager = await PriceManager.new();

      for (let i = 0; i < keys.length; i++) {
        assert.equal(await liquidityPools[i].getPriceManager(), currentPriceManager);
      }

      await registry.addContract(await registry.PRICE_MANAGER_NAME(), newPriceManager.address);

      await truffleAssert.reverts(systemPoolsRegistry.injectDependenciesToExistingPools({ from: USER1 }), reason);
    });
    it("injectDependencies() should get exception if called by not a system owner", async () => {
      const reason = "SystemPoolsRegistry: Only system owner can call this function.";
      const currentPriceManager = await registry.getPriceManagerContract();
      const newPriceManager = await PriceManager.new();

      for (let i = 0; i < keys.length; i++) {
        assert.equal(await liquidityPools[i].getPriceManager(), currentPriceManager);
      }

      await registry.addContract(await registry.PRICE_MANAGER_NAME(), newPriceManager.address);

      await truffleAssert.reverts(systemPoolsRegistry.injectDependencies(2, 5, { from: USER1 }), reason);
    });
  });

  describe("getLiquidityPoolsInfo", () => {
    const firstKey = toBytes("FIRST_KEY");
    const secondKey = toBytes("SECOND_KEY");
    const thirdKey = toBytes("THIRD_KEY");
    const symbols = ["FIRST", "SECOND", "THIRD"];
    const keys = [firstKey, secondKey, thirdKey];

    const tokens = [];
    const liquidityPools = [];

    const liquidityAmount = wei(100);
    const borrowAmount = wei(60);
    const startTime = toBN(10000);

    beforeEach("setup", async () => {
      for (let i = 0; i < keys.length; i++) {
        const currentTime = toBN(await getCurrentBlockTime());
        await setNextBlockTime(currentTime.plus(startTime).toNumber());
        tokens.push(await createLiquidityPool(keys[i], symbols[i], true));

        const currentLiquidityPool = await LiquidityPool.at(await getLiquidityPoolAddr(keys[i]));
        liquidityPools.push(currentLiquidityPool);

        await defiCore.addLiquidity(keys[i], liquidityAmount.times(i + 1), { from: USER1 });
        await defiCore.borrowFor(keys[i], borrowAmount.times(i + 1), USER1, { from: USER1 });
      }
    });

    it("should return correct data", async () => {
      const liquidityPoolsInfo = await systemPoolsRegistry.getLiquidityPoolsInfo(keys, false);

      for (let i = 0; i < liquidityPoolsInfo.length; i++) {
        const currentInfo = liquidityPoolsInfo[i];

        assert.isTrue(compareKeys(currentInfo.baseInfo.assetKey, keys[i]));

        assert.equal(currentInfo.baseInfo.assetAddr, tokens[i].address);

        const totalBorrowedAmount = borrowAmount.times(i + 1);
        assert.equal(currentInfo.baseInfo.totalBorrowBalance.toString(), totalBorrowedAmount.plus(1).toString());
        assert.equal(
          currentInfo.baseInfo.totalBorrowBalanceInUSD.toString(),
          (await liquidityPools[i].getAmountInUSD(totalBorrowedAmount)).toString()
        );

        const totalPoolLiquidity = liquidityAmount.times(i + 1);
        assert.equal(currentInfo.marketSize.toString(), totalPoolLiquidity.toString());
        assert.equal(
          currentInfo.marketSizeInUSD.toString(),
          (await liquidityPools[i].getAmountInUSD(totalPoolLiquidity)).toString()
        );

        const expectedSupplyAPY = getPrecision().times(1.53);
        const expectedBorrowAPY = getPrecision().times(3);

        assert.equal(currentInfo.supplyAPY.toString(), expectedSupplyAPY.toFixed());
        assert.equal(currentInfo.baseInfo.borrowAPY.toString(), expectedBorrowAPY.toFixed());
      }
    });
  });

  describe("getStablePoolsInfo", () => {
    const stableKey = toBytes("ST");
    const daiKey = toBytes("DAI");
    const liquidityAmount = wei(100);
    const borrowAmount = wei(60);
    let stableToken;

    beforeEach("setup", async () => {
      stableToken = await StablePermitToken.new("Stable Token", "ST", registry.address);
      const _stablePoolImpl = await StablePool.new();

      await systemPoolsRegistry.addPoolsBeacon(1, _stablePoolImpl.address);

      await createStablePool(stableKey, stableToken.address);
      await createLiquidityPool(daiKey, "DAI", true);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(stableKey, borrowAmount, USER1, { from: USER1 });
    });

    it("should return correct stable pool info", async () => {
      const stablePoolInfo = (await systemPoolsRegistry.getStablePoolsInfo([stableKey]))[0];

      assert.isTrue(compareKeys(stablePoolInfo.baseInfo.assetKey, stableKey));

      assert.equal(stablePoolInfo.baseInfo.assetAddr, stableToken.address);

      assert.equal(stablePoolInfo.baseInfo.totalBorrowBalance.toString(), borrowAmount.plus(1).toString());
      assert.equal(
        stablePoolInfo.baseInfo.totalBorrowBalanceInUSD.toString(),
        borrowAmount.times(wei(1, priceDecimals)).idiv(oneToken).toString()
      );
      assert.equal(stablePoolInfo.baseInfo.borrowAPY.toString(), annualBorrowRate.toFixed());

      const distrAPYs = await rewardsDistribution.getAPY(stableKey);

      assert.equal(stablePoolInfo.baseInfo.distrBorrowAPY.toString(), toBN(distrAPYs[1]).toFixed());
    });
  });

  describe("getDetailedLiquidityPoolInfo", () => {
    const symbols = ["FIRST", "SECOND", "THIRD"];
    const keys = [toBytes("FIRST_KEY"), toBytes("SECOND_KEY"), toBytes("THIRD_KEY")];

    const liquidityAmount = wei(100);
    const borrowAmount = wei(60);
    const pricePerToken = wei(price, priceDecimals);

    beforeEach("setup", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);

      for (let i = 0; i < keys.length; i++) {
        await createLiquidityPool(keys[i], symbols[i], true);

        await defiCore.addLiquidity(keys[i], liquidityAmount.times(i + 1), { from: USER1 });
        await defiCore.borrowFor(keys[i], borrowAmount.times(i + 1), USER1, { from: USER1 });
      }

      await rewardsDistribution.setupRewardsPerBlockBatch(keys, [wei(2), oneToken, wei(3)]);
    });

    it("should return correct detailed info", async () => {
      for (let i = 0; i < keys.length; i++) {
        const detailedInfo = await systemPoolsRegistry.getDetailedLiquidityPoolInfo(keys[i], false);

        const totalBorrowedAmount = borrowAmount.times(i + 1);
        const availableLiquidity = liquidityAmount
          .times(i + 1)
          .times(maxUR)
          .idiv(getPercentage100())
          .minus(totalBorrowedAmount);

        assert.equal(
          detailedInfo.poolInfo.baseInfo.totalBorrowBalance.toString(),
          totalBorrowedAmount.plus(1).toString()
        );
        assert.equal(
          detailedInfo.poolInfo.baseInfo.totalBorrowBalanceInUSD.toString(),
          totalBorrowedAmount.idiv(oneToken).times(pricePerToken).toString()
        );

        assert.equal(detailedInfo.availableLiquidity.toString(), availableLiquidity.toString());
        assert.equal(
          detailedInfo.availableLiquidityInUSD.toString(),
          availableLiquidity.idiv(oneToken).times(pricePerToken).toString()
        );
        assert.equal(detailedInfo.poolInfo.utilizationRatio.toString(), getPrecision().times(60).toFixed());
        assert.equal(detailedInfo.poolInfo.isAvailableAsCollateral, true);

        assert.equal(detailedInfo.mainPoolParams.collateralizationRatio.toString(), colRatio.toFixed());
        assert.equal(detailedInfo.mainPoolParams.reserveFactor.toString(), reserveFactor.toFixed());
        assert.equal(detailedInfo.mainPoolParams.liquidationDiscount.toString(), liquidationDiscount.toFixed());
        assert.equal(detailedInfo.mainPoolParams.maxUtilizationRatio.toString(), maxUR.toFixed());

        const expectedSupplyAPY = getPrecision().times(1.53);
        const expectedBorrowAPY = getPrecision().times(3);

        assert.equal(detailedInfo.poolInfo.supplyAPY.toString(), expectedSupplyAPY.toFixed());
        assert.equal(detailedInfo.poolInfo.baseInfo.borrowAPY.toString(), expectedBorrowAPY.toFixed());
      }
    });
  });

  describe("getAllSupportedAssetKeysCount", () => {
    it("should return correct asset keys count", async () => {
      const systemPoolsRegistryMock = await SystemPoolsRegistryMock.new();

      assert.equal((await systemPoolsRegistryMock.getAllSupportedAssetKeysCount()).toString(), 0);

      const keysCount = 5;

      for (let i = 0; i < keysCount; i++) {
        await systemPoolsRegistryMock.addNewAsset(toBytes("TAS" + i), NOTHING, 0);
      }

      assert.equal((await systemPoolsRegistryMock.getAllSupportedAssetKeysCount()).toString(), keysCount);
    });
  });

  describe("getSupportedAssetKeysCountByType", () => {
    it("should return correct asset keys count by types", async () => {
      const systemPoolsRegistryMock = await SystemPoolsRegistryMock.new();

      let keysCount = 5;

      for (let i = 0; i < keysCount; i++) {
        await systemPoolsRegistryMock.addNewAsset(toBytes("TALS" + i), NOTHING, 0);
      }

      assert.equal((await systemPoolsRegistryMock.getSupportedAssetKeysCountByType(0)).toString(), keysCount);

      keysCount = 3;

      for (let i = 0; i < keysCount; i++) {
        await systemPoolsRegistryMock.addNewAsset(toBytes("TASS" + i), NOTHING, 1);
      }

      assert.equal((await systemPoolsRegistryMock.getSupportedAssetKeysCountByType(1)).toString(), keysCount);
    });
  });

  describe("getAllSupportedAssetKeys/getAllSupportedAssetKeysByType", () => {
    let allAssetKeys = [];
    let lpAssetKeys = [];
    let sAssetKeys = [];
    let systemPoolsRegistryMock;

    beforeEach("setup", async () => {
      systemPoolsRegistryMock = await SystemPoolsRegistryMock.new();

      let keysCount = 5;

      for (let i = 0; i < keysCount; i++) {
        const currentKey = toBytes("LAK" + i);

        await systemPoolsRegistryMock.addNewAsset(currentKey, NOTHING, 0);

        allAssetKeys.push(currentKey);
        lpAssetKeys.push(currentKey);
      }

      keysCount = 3;

      for (let i = 0; i < keysCount; i++) {
        const currentKey = toBytes("SAK" + i);

        await systemPoolsRegistryMock.addNewAsset(currentKey, NOTHING, 1);

        allAssetKeys.push(currentKey);
        sAssetKeys.push(currentKey);
      }
    });

    afterEach("clear", async () => {
      allAssetKeys = [];
      lpAssetKeys = [];
      sAssetKeys = [];
    });

    it("should return correct all supported asset keys", async () => {
      const assetKeys = await systemPoolsRegistryMock.getAllSupportedAssetKeys();

      assert.equal(assetKeys.length, 8);
      assert.isTrue(deepCompareKeys(assetKeys, allAssetKeys));
    });

    it("should return correct all supported asset keys by types", async () => {
      let assetKeys = await systemPoolsRegistryMock.getAllSupportedAssetKeysByType(0);

      assert.equal(assetKeys.length, 5);
      assert.isTrue(deepCompareKeys(assetKeys, lpAssetKeys));

      assetKeys = await systemPoolsRegistryMock.getAllSupportedAssetKeysByType(1);

      assert.equal(assetKeys.length, 3);
      assert.isTrue(deepCompareKeys(assetKeys, sAssetKeys));
    });
  });

  describe("getSupportedAssetKeys/getSupportedAssetKeysByType", async () => {
    let allAssetKeys = [];
    let lpAssetKeys = [];
    let sAssetKeys = [];
    let systemPoolsRegistryMock;

    beforeEach("setup", async () => {
      systemPoolsRegistryMock = await SystemPoolsRegistryMock.new();

      const keysCount = 5;

      for (let i = 0; i < keysCount; i++) {
        const currentLpKey = toBytes("LAK" + i);
        const currentSKey = toBytes("SAK" + i);

        await systemPoolsRegistryMock.addNewAsset(currentLpKey, NOTHING, 0);
        await systemPoolsRegistryMock.addNewAsset(currentSKey, NOTHING, 1);

        allAssetKeys.push(currentLpKey, currentSKey);
        lpAssetKeys.push(currentLpKey);
        sAssetKeys.push(currentSKey);
      }
    });

    afterEach("clear", async () => {
      allAssetKeys = [];
      lpAssetKeys = [];
      sAssetKeys = [];
    });

    it("should return correct asset keys arr with pagination", async () => {
      let resultArr = await systemPoolsRegistryMock.getSupportedAssetKeys(0, 15);

      assert.isTrue(deepCompareKeys(resultArr, allAssetKeys));

      resultArr = await systemPoolsRegistryMock.getSupportedAssetKeys(5, 10);

      assert.isTrue(deepCompareKeys(resultArr, allAssetKeys.slice(5)));

      resultArr = await systemPoolsRegistryMock.getSupportedAssetKeys(2, 5);

      assert.isTrue(deepCompareKeys(resultArr, allAssetKeys.slice(2, 7)));

      resultArr = await systemPoolsRegistryMock.getSupportedAssetKeys(11, 5);

      assert.isTrue(deepCompareKeys(resultArr, []));
    });

    it("should return correct asset keys arr with pagination by type", async () => {
      let resultArr = await systemPoolsRegistryMock.getSupportedAssetKeysByType(0, 0, 10);

      assert.isTrue(deepCompareKeys(resultArr, lpAssetKeys));

      resultArr = await systemPoolsRegistryMock.getSupportedAssetKeysByType(0, 2, 10);

      assert.isTrue(deepCompareKeys(resultArr, lpAssetKeys.slice(2)));

      resultArr = await systemPoolsRegistryMock.getSupportedAssetKeysByType(1, 2, 2);

      assert.isTrue(deepCompareKeys(resultArr, sAssetKeys.slice(2, 4)));

      resultArr = await systemPoolsRegistryMock.getSupportedAssetKeysByType(1, 6, 2);

      assert.isTrue(deepCompareKeys(resultArr, []));
    });
  });

  describe("getAllPools/getAllPoolsByType/getPools/getPoolsByType", () => {
    let allPoolsArr = [];
    let lpPoolsArr = [];
    let sPoolsArr = [];

    let systemPoolsRegistryMock;

    beforeEach("setup", async () => {
      systemPoolsRegistryMock = await SystemPoolsRegistryMock.new();

      const keysCount = 5;

      for (let i = 0; i < keysCount; i++) {
        const lpSymbol = "LAK" + i;
        const currentLpKey = toBytes(lpSymbol);
        const currentLpToken = await MockERC20.new("Mock" + lpSymbol, lpSymbol);

        await systemPoolsRegistryMock.addNewAsset(currentLpKey, currentLpToken.address, 0);

        lpPoolsArr.push(currentLpToken.address);

        const sSymbol = "SAK" + i;
        const currentSKey = toBytes(sSymbol);
        const currentSToken = await MockERC20.new("Mock" + sSymbol, sSymbol);

        await systemPoolsRegistryMock.addNewAsset(currentSKey, currentSToken.address, 1);

        sPoolsArr.push(currentSToken.address);

        allPoolsArr.push(currentLpToken.address, currentSToken.address);
      }
    });

    afterEach("clear", async () => {
      allPoolsArr = [];
      lpPoolsArr = [];
      sPoolsArr = [];
    });

    it("should return correct all pools arr", async () => {
      assert.deepEqual(await systemPoolsRegistryMock.getAllPools(), allPoolsArr);
    });

    it("should return correct all pools arr by types", async () => {
      assert.deepEqual(await systemPoolsRegistryMock.getAllPoolsByType(0), lpPoolsArr);
      assert.deepEqual(await systemPoolsRegistryMock.getAllPoolsByType(1), sPoolsArr);
    });

    it("should return correct pools arr with pagination", async () => {
      assert.deepEqual(await systemPoolsRegistryMock.getPools(0, 15), allPoolsArr);
      assert.deepEqual(await systemPoolsRegistryMock.getPools(4, 10), allPoolsArr.slice(4));
      assert.deepEqual(await systemPoolsRegistryMock.getPools(2, 5), allPoolsArr.slice(2, 7));
      assert.deepEqual(await systemPoolsRegistryMock.getPools(11, 2), []);
    });

    it("should return correct pools arr with pagination by types", async () => {
      assert.deepEqual(await systemPoolsRegistryMock.getPoolsByType(0, 0, 10), lpPoolsArr);
      assert.deepEqual(await systemPoolsRegistryMock.getPoolsByType(0, 2, 8), lpPoolsArr.slice(2));
      assert.deepEqual(await systemPoolsRegistryMock.getPoolsByType(1, 1, 3), sPoolsArr.slice(1, 4));
      assert.deepEqual(await systemPoolsRegistryMock.getPoolsByType(1, 6, 10), []);
    });
  });
});
