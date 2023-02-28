const { mine, getCurrentBlockNumber } = require("./helpers/block-helper");
const { toBytes } = require("./helpers/bytesCompareLibrary");
const { getInterestRateLibraryAddr } = require("./helpers/coverage-helper");
const { toBN, accounts, getPrecision, getPercentage100, wei } = require("../scripts/utils/utils");
const { ZERO_ADDR } = require("../scripts/utils/constants");

const Reverter = require("./helpers/reverter");
const truffleAssert = require("truffle-assertions");

const Registry = artifacts.require("Registry");
const DefiCore = artifacts.require("DefiCore");
const SystemParameters = artifacts.require("SystemParameters");
const AssetParameters = artifacts.require("AssetParameters");
const RewardsDistribution = artifacts.require("RewardsDistributionMock");
const UserInfoRegistry = artifacts.require("UserInfoRegistry");
const SystemPoolsRegistry = artifacts.require("SystemPoolsRegistryMock");
const SystemPoolsFactory = artifacts.require("SystemPoolsFactory");
const LiquidityPool = artifacts.require("LiquidityPool");
const StablePool = artifacts.require("StablePool");
const PriceManager = artifacts.require("PriceManager");
const Prt = artifacts.require("PRT");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const WETH = artifacts.require("WETH");
const StablePermitToken = artifacts.require("StablePermitTokenMock");

const MockERC20 = artifacts.require("MockERC20");
const ChainlinkOracleMock = artifacts.require("ChainlinkOracleMock");

LiquidityPool.numberFormat = "BigNumber";
RewardsDistribution.numberFormat = "BigNumber";

describe("RewardsDistribution", () => {
  const reverter = new Reverter();

  let OWNER;
  let USER1;
  let USER2;

  let registry;
  let defiCore;
  let assetParameters;
  let systemParameters;
  let rewardsDistribution;
  let systemPoolsRegistry;
  let prt;

  let daiPool;

  let rewardsToken;

  const oneToken = toBN(10).pow(18);
  const tokensAmount = wei(5000);
  const colRatio = getPercentage100().times("1.25");
  const reserveFactor = getPrecision().times("15");
  const liquidationDiscount = getPrecision().times(8);

  const annualBorrowRate = getPrecision().times(3);

  const firstSlope = getPrecision().times(4);
  const secondSlope = getPercentage100();
  const utilizationBreakingPoint = getPrecision().times(80);
  const maxUR = getPrecision().times(95);

  const chainlinkPriceDecimals = toBN(8);

  const minSupplyDistributionPart = getPrecision().times(10);
  const minBorrowDistributionPart = getPrecision().times(10);

  const zeroKey = toBytes("");
  const daiKey = toBytes("DAI");
  const wEthKey = toBytes("WETH");
  const rewardsTokenKey = toBytes("RTK");
  const nativeTokenKey = toBytes("BNB");
  const stableKey = toBytes("ST");

  const tokens = [];

  async function getLiquidityPoolAddr(assetKey) {
    return (await systemPoolsRegistry.poolsInfo(assetKey))[0];
  }

  async function deployTokens(symbols) {
    for (let i = 0; i < symbols.length; i++) {
      const token = await MockERC20.new("Mock" + symbols[i], symbols[i]);
      await token.mintArbitraryBatch([OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);

      tokens.push(token);
    }
  }

  async function createLiquidityPool(assetKey, asset, symbol, isCollateral) {
    const chainlinkOracle = await ChainlinkOracleMock.new(wei(100, chainlinkPriceDecimals), chainlinkPriceDecimals);

    await systemPoolsRegistry.addLiquidityPool(
      asset.address,
      assetKey,
      chainlinkOracle.address,
      symbol,
      isCollateral,
      isCollateral
    );

    if (assetKey != nativeTokenKey) {
      await asset.approveArbitraryBatch(
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

    return chainlinkOracle;
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
    const chainlinkOracle = await ChainlinkOracleMock.new(wei(10, chainlinkPriceDecimals), chainlinkPriceDecimals);

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

  function getNewCumulativeSum(rewardPerBlock, totalPool, prevAP, blocksDelta) {
    return rewardPerBlock.times(getPercentage100()).idiv(totalPool).times(blocksDelta).plus(prevAP);
  }

  function getUserAggregatedReward(newAP, prevAP, userLiquidityAmount, prevReward) {
    return userLiquidityAmount.times(newAP.minus(prevAP)).idiv(getPercentage100()).plus(prevReward);
  }

  async function getRewardsPerBlock(assetKey, liquidityPool) {
    return await rewardsDistribution.getRewardsPerBlock(assetKey, await liquidityPool.getBorrowPercentage());
  }

  async function checkSupplyUserDistributionInfo(assetKey, userAddr, cumulativeSum, aggregatedReward) {
    userInfo = await rewardsDistribution.usersDistributionInfo(assetKey, userAddr);

    assert.equal(userInfo.lastSupplyCumulativeSum.toString(), cumulativeSum.toString());
    assert.equal(userInfo.aggregatedReward.toString(), aggregatedReward.toString());
  }

  async function checkBorrowUserDistributionInfo(assetKey, userAddr, cumulativeSum, aggregatedReward) {
    userInfo = await rewardsDistribution.usersDistributionInfo(assetKey, userAddr);

    assert.closeTo(
      userInfo.lastBorrowCumulativeSum.toNumber(),
      cumulativeSum.toNumber(),
      getPrecision().idiv(1000).toNumber()
    );
    assert.closeTo(userInfo.aggregatedReward.toNumber(), aggregatedReward.toNumber(), oneToken.idiv(10).toNumber());
  }

  async function checkLiquidityPoolInfo(
    assetKey,
    expectedSupplyCumulativeSum,
    expectedBorrowCumulativeSum,
    expectedLastUpdate
  ) {
    assert.closeTo(
      (await rewardsDistribution.liquidityPoolsInfo(assetKey)).supplyCumulativeSum.toNumber(),
      expectedSupplyCumulativeSum.toNumber(),
      getPrecision().idiv(1000).toNumber()
    );
    assert.closeTo(
      (await rewardsDistribution.liquidityPoolsInfo(assetKey)).borrowCumulativeSum.toNumber(),
      expectedBorrowCumulativeSum.toNumber(),
      getPrecision().idiv(1000).toNumber()
    );
    assert.equal(
      (await rewardsDistribution.liquidityPoolsInfo(assetKey)).lastUpdate.toString(),
      expectedLastUpdate.toString()
    );
  }

  before("setup", async () => {
    OWNER = await accounts(0);
    USER1 = await accounts(1);
    USER2 = await accounts(2);
    NOTHING = await accounts(9);

    rewardsToken = await MockERC20.new("MockRTK", "RTK");
    const nativeToken = await WETH.new();
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
    const _stablePoolImpl = await StablePool.new();
    const _priceManager = await PriceManager.new();
    const _prt = await Prt.new();

    await registry.__OwnableContractsRegistry_init();

    const stableToken = await StablePermitToken.new("Stable Token", "ST", registry.address);

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

    await registry.injectDependencies(await registry.DEFI_CORE_NAME());
    await registry.injectDependencies(await registry.SYSTEM_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.ASSET_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.REWARDS_DISTRIBUTION_NAME());
    await registry.injectDependencies(await registry.USER_INFO_REGISTRY_NAME());
    await registry.injectDependencies(await registry.SYSTEM_POOLS_REGISTRY_NAME());
    await registry.injectDependencies(await registry.SYSTEM_POOLS_FACTORY_NAME());
    await registry.injectDependencies(await registry.PRICE_MANAGER_NAME());
    await registry.injectDependencies(await registry.PRT_NAME());

    tokens.push(rewardsToken, stableToken);
    await deployTokens(["DAI", "WETH"]);
    tokens.push(nativeToken);

    await defiCore.defiCoreInitialize();
    await systemPoolsRegistry.systemPoolsRegistryInitialize(_liquidityPoolImpl.address, nativeTokenKey, zeroKey);

    await systemPoolsRegistry.addPoolsBeacon(1, _stablePoolImpl.address);
    await systemParameters.setupStablePoolsAvailability(true);
    await systemParameters.setRewardsTokenAddress(ZERO_ADDR);

    await deployRewardsPool(rewardsToken.address, await rewardsToken.symbol());
    await createStablePool(stableKey, stableToken.address);
    await createLiquidityPool(daiKey, tokens[2], "DAI", true);
    await createLiquidityPool(wEthKey, tokens[3], "WETH", true);
    await createLiquidityPool(nativeTokenKey, tokens[4], "BNB", true);

    daiPool = await LiquidityPool.at(await getLiquidityPoolAddr(daiKey));

    await rewardsToken.mintArbitrary(defiCore.address, tokensAmount);

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("setDependencies", () => {
    it("should revert if not called by injector", async () => {
      let reason = "Dependant: Not an injector";
      await truffleAssert.reverts(rewardsDistribution.setDependencies(registry.address), reason);
    });
  });

  describe("withdrawUserReward", () => {
    it("should revert if called directly, not by defiCore or any liquidity pool ", async () => {
      let reason = "RewardsDistribution: Caller not an eligible contract.";

      daiPool = await LiquidityPool.at(await getLiquidityPoolAddr(daiKey));
      await truffleAssert.reverts(rewardsDistribution.withdrawUserReward(daiKey, USER1, daiPool.address), reason);
    });
  });

  describe("getRewardsPerBlock", () => {
    const rewardPerBlock = wei(4);

    beforeEach("setup", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [rewardPerBlock]);
    });

    it("should return correct rewards per block if current UR = 0", async () => {
      const result = await rewardsDistribution.getRewardsPerBlock(daiKey, 0);

      const expectedSupplyReward = rewardPerBlock.times(minSupplyDistributionPart).div(getPercentage100());
      const expectedBorrowReward = rewardPerBlock.minus(expectedSupplyReward);

      assert.equal(result[0].toString(), expectedSupplyReward.toString());
      assert.equal(result[1].toString(), expectedBorrowReward.toString());
    });

    it("should return correct rewards per block if current UR = 100", async () => {
      const result = await rewardsDistribution.getRewardsPerBlock(daiKey, getPercentage100());

      const expectedBorrowReward = rewardPerBlock.times(minBorrowDistributionPart).div(getPercentage100());
      const expectedSupplyReward = rewardPerBlock.minus(expectedBorrowReward);

      assert.equal(result[0].toString(), expectedSupplyReward.toString());
      assert.equal(result[1].toString(), expectedBorrowReward.toString());
    });

    it("should return correct rewards per block if current UR = 50", async () => {
      const currentUR = getPrecision().times(50);
      const result = await rewardsDistribution.getRewardsPerBlock(daiKey, currentUR);

      const supplyPart = currentUR
        .times(getPercentage100().minus(minBorrowDistributionPart).minus(minSupplyDistributionPart))
        .div(getPercentage100())
        .plus(minSupplyDistributionPart);

      const expectedSupplyReward = rewardPerBlock.times(supplyPart).div(getPercentage100());
      const expectedBorrowReward = rewardPerBlock.minus(expectedSupplyReward);

      assert.equal(result[0].toString(), expectedSupplyReward.toString());
      assert.equal(result[1].toString(), expectedBorrowReward.toString());
    });

    it("should return correct rewards per block if total reward per block = 0", async () => {
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [0]);

      const currentUR = getPrecision().times(50);
      const result = await rewardsDistribution.getRewardsPerBlock(daiKey, currentUR);

      assert.equal(result[0].toString(), 0);
      assert.equal(result[1].toString(), 0);
    });
  });

  describe("countNewCumulativeSum", () => {
    it("should return correct new accumulated price", async () => {
      const rewardsPerBlock = wei(4);
      const blocksDelta = 10;
      let totalPool = wei(1200);
      let prevAP = 0;

      let expectedCumulativeSum = rewardsPerBlock.times(getPercentage100()).idiv(totalPool).times(blocksDelta);
      let actualCumulativeSum = await rewardsDistribution.getNewCumulativeSum(
        rewardsPerBlock,
        totalPool,
        prevAP,
        blocksDelta
      );

      assert.equal(actualCumulativeSum.toString(), expectedCumulativeSum.toString());

      prevAP = actualCumulativeSum;

      totalPool = wei(800);

      expectedCumulativeSum = rewardsPerBlock.times(getPercentage100()).idiv(totalPool).times(blocksDelta).plus(prevAP);
      actualCumulativeSum = await rewardsDistribution.getNewCumulativeSum(
        rewardsPerBlock,
        totalPool,
        prevAP,
        blocksDelta
      );

      assert.equal(actualCumulativeSum.toString(), expectedCumulativeSum.toString());
    });
  });

  describe("updateCumulativeSums", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);
    const totalRewardPerBlock = wei(2);
    const supplyRewardsPerBlock = totalRewardPerBlock.times(minSupplyDistributionPart).div(getPercentage100());
    const blocksDelta = toBN(9);

    beforeEach("setup", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey, wEthKey], [wei(2), oneToken]);
    });

    it("should correctly update cumulative sum after several deposits", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      const startBlock = toBN(await getCurrentBlockNumber());

      let totalPool = liquidityAmount;

      await checkSupplyUserDistributionInfo(daiKey, USER1, 0, 0);
      await checkLiquidityPoolInfo(daiKey, toBN(0), toBN(0), startBlock);

      await mine(blocksDelta);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      let currentBlock = toBN(await getCurrentBlockNumber());
      let newCumulativeSum = getNewCumulativeSum(supplyRewardsPerBlock, totalPool, 0, blocksDelta.plus(1));
      let aggregatedReward = getUserAggregatedReward(newCumulativeSum, 0, liquidityAmount, 0);

      await checkSupplyUserDistributionInfo(daiKey, USER1, newCumulativeSum, aggregatedReward);
      await checkLiquidityPoolInfo(daiKey, newCumulativeSum, toBN(0), currentBlock);

      totalPool = liquidityAmount.times(2);

      await mine(blocksDelta);

      await defiCore.addLiquidity(daiKey, liquidityAmount.times(2), { from: USER2 });

      currentBlock = toBN(await getCurrentBlockNumber());
      newCumulativeSum = getNewCumulativeSum(supplyRewardsPerBlock, totalPool, newCumulativeSum, blocksDelta.plus(1));

      assert.equal(newCumulativeSum.toString(), getPrecision().times(3).toString());

      await checkSupplyUserDistributionInfo(daiKey, USER2, newCumulativeSum, 0);
      await checkLiquidityPoolInfo(daiKey, newCumulativeSum, toBN(0), currentBlock);

      totalPool = liquidityAmount.times(4);

      await mine(blocksDelta);

      const user1LSAP = (await rewardsDistribution.usersDistributionInfo(daiKey, USER1)).lastSupplyCumulativeSum;

      await defiCore.withdrawLiquidity(daiKey, liquidityAmount, false, { from: USER1 });

      currentBlock = toBN(await getCurrentBlockNumber());
      newCumulativeSum = getNewCumulativeSum(supplyRewardsPerBlock, totalPool, newCumulativeSum, blocksDelta.plus(1));

      const user1Amount = liquidityAmount.times(2);
      aggregatedReward = getUserAggregatedReward(newCumulativeSum, user1LSAP, user1Amount, aggregatedReward);

      await checkSupplyUserDistributionInfo(daiKey, USER1, newCumulativeSum, aggregatedReward);
      await checkLiquidityPoolInfo(daiKey, newCumulativeSum, toBN(0), currentBlock);
    });

    it("should correctly update information after several borrows and repays", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(10));
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(20), { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(20), { from: USER2 });

      await defiCore.borrowFor(daiKey, borrowAmount.times(10), USER1, { from: USER1 });
      const startBlock = toBN(await getCurrentBlockNumber());

      let newSupplyCumulativeSum = getNewCumulativeSum(wei("0.2"), liquidityAmount.times(10), 0, toBN(3));

      let totalPool = borrowAmount.times(10);

      await checkBorrowUserDistributionInfo(daiKey, USER1, toBN(0), toBN(0));
      await checkLiquidityPoolInfo(daiKey, newSupplyCumulativeSum, toBN(0), startBlock);

      await mine(blocksDelta);

      let rewardsPerBlock = await getRewardsPerBlock(daiKey, daiPool);

      await defiCore.borrowFor(daiKey, borrowAmount.times(5), USER2, { from: USER2 });

      let currentBlock = toBN(await getCurrentBlockNumber());
      newSupplyCumulativeSum = getNewCumulativeSum(
        toBN(rewardsPerBlock[0]),
        liquidityAmount.times(10),
        newSupplyCumulativeSum,
        blocksDelta.plus(1)
      );
      let newBorrowCumulativeSum = getNewCumulativeSum(toBN(rewardsPerBlock[1]), totalPool, 0, blocksDelta.plus(1));

      await checkBorrowUserDistributionInfo(daiKey, USER2, newBorrowCumulativeSum, toBN(0));
      await checkLiquidityPoolInfo(daiKey, newSupplyCumulativeSum, newBorrowCumulativeSum, currentBlock);

      totalPool = borrowAmount.times(15);

      await mine(blocksDelta);

      rewardsPerBlock = await getRewardsPerBlock(daiKey, daiPool);

      await defiCore.repayBorrow(daiKey, borrowAmount.times(4), false, { from: USER1 });

      currentBlock = toBN(await getCurrentBlockNumber());
      newSupplyCumulativeSum = getNewCumulativeSum(
        toBN(rewardsPerBlock[0]),
        liquidityAmount.times(10),
        newSupplyCumulativeSum,
        blocksDelta.plus(1)
      );
      newBorrowCumulativeSum = getNewCumulativeSum(
        toBN(rewardsPerBlock[1]),
        totalPool,
        newBorrowCumulativeSum,
        blocksDelta.plus(1)
      );
      let aggregatedReward = getUserAggregatedReward(newBorrowCumulativeSum, 0, borrowAmount.times(10), 0);

      await checkBorrowUserDistributionInfo(daiKey, USER1, newBorrowCumulativeSum, aggregatedReward);
      await checkLiquidityPoolInfo(daiKey, newSupplyCumulativeSum, newBorrowCumulativeSum, currentBlock);

      totalPool = borrowAmount.times(11);

      await mine(blocksDelta);

      rewardsPerBlock = await getRewardsPerBlock(daiKey, daiPool);

      const prevAP = toBN((await rewardsDistribution.usersDistributionInfo(daiKey, USER2)).lastBorrowCumulativeSum);

      await defiCore.repayBorrow(daiKey, borrowAmount.times(5), false, { from: USER2 });

      currentBlock = toBN(await getCurrentBlockNumber());
      newSupplyCumulativeSum = getNewCumulativeSum(
        toBN(rewardsPerBlock[0]),
        liquidityAmount.times(10),
        newSupplyCumulativeSum,
        blocksDelta.plus(1)
      );
      newBorrowCumulativeSum = getNewCumulativeSum(
        toBN(rewardsPerBlock[1]),
        totalPool,
        newBorrowCumulativeSum,
        blocksDelta.plus(1)
      );
      aggregatedReward = getUserAggregatedReward(newBorrowCumulativeSum, prevAP, borrowAmount.times(5), 0);

      await checkBorrowUserDistributionInfo(daiKey, USER2, newBorrowCumulativeSum, aggregatedReward);
      await checkLiquidityPoolInfo(daiKey, newSupplyCumulativeSum, newBorrowCumulativeSum, currentBlock);
    });

    it("should correctly update aggregated reward", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(10));
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(20), { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(20), { from: USER2 });

      await defiCore.borrowFor(daiKey, borrowAmount.times(10), USER1, { from: USER1 });
      const startBlock = toBN(await getCurrentBlockNumber());

      let newSupplyCumulativeSum = getNewCumulativeSum(wei("0.2"), liquidityAmount.times(10), 0, toBN(3));
      let totalPool = borrowAmount.times(10);

      await checkBorrowUserDistributionInfo(daiKey, USER1, toBN(0), toBN(0));
      await checkLiquidityPoolInfo(daiKey, newSupplyCumulativeSum, toBN(0), startBlock);

      await mine(blocksDelta);

      let rewardsPerBlock = await getRewardsPerBlock(daiKey, daiPool);

      await defiCore.borrowFor(daiKey, borrowAmount.times(5), USER1, { from: USER1 });

      let currentBlock = toBN(await getCurrentBlockNumber());
      newSupplyCumulativeSum = getNewCumulativeSum(
        toBN(rewardsPerBlock[0]),
        liquidityAmount.times(10),
        newSupplyCumulativeSum,
        blocksDelta.plus(1)
      );
      let newBorrowCumulativeSum = getNewCumulativeSum(toBN(rewardsPerBlock[1]), totalPool, 0, blocksDelta.plus(1));
      let aggregatedReward = getUserAggregatedReward(newBorrowCumulativeSum, 0, borrowAmount.times(10), 0);

      await checkBorrowUserDistributionInfo(daiKey, USER1, newBorrowCumulativeSum, aggregatedReward);
      await checkLiquidityPoolInfo(daiKey, newSupplyCumulativeSum, newBorrowCumulativeSum, currentBlock);

      totalPool = borrowAmount.times(15);

      await mine(blocksDelta);

      rewardsPerBlock = await getRewardsPerBlock(daiKey, daiPool);
      let prevAP = newBorrowCumulativeSum;

      await defiCore.repayBorrow(daiKey, borrowAmount.times(2), false, { from: USER1 });

      currentBlock = toBN(await getCurrentBlockNumber());
      newSupplyCumulativeSum = getNewCumulativeSum(
        toBN(rewardsPerBlock[0]),
        liquidityAmount.times(10),
        newSupplyCumulativeSum,
        blocksDelta.plus(1)
      );
      newBorrowCumulativeSum = getNewCumulativeSum(
        toBN(rewardsPerBlock[1]),
        totalPool,
        newBorrowCumulativeSum,
        blocksDelta.plus(1)
      );
      aggregatedReward = getUserAggregatedReward(
        newBorrowCumulativeSum,
        prevAP,
        borrowAmount.times(15),
        aggregatedReward
      );

      await checkBorrowUserDistributionInfo(daiKey, USER1, newBorrowCumulativeSum, aggregatedReward);
      await checkLiquidityPoolInfo(daiKey, newSupplyCumulativeSum, newBorrowCumulativeSum, currentBlock);

      totalPool = borrowAmount.times(13);

      await mine(blocksDelta);

      rewardsPerBlock = await getRewardsPerBlock(daiKey, daiPool);
      prevAP = newBorrowCumulativeSum;

      await defiCore.borrowFor(daiKey, borrowAmount.times(4), USER1, { from: USER1 });

      currentBlock = toBN(await getCurrentBlockNumber());
      newSupplyCumulativeSum = getNewCumulativeSum(
        toBN(rewardsPerBlock[0]),
        liquidityAmount.times(10),
        newSupplyCumulativeSum,
        blocksDelta.plus(1)
      );
      newBorrowCumulativeSum = getNewCumulativeSum(
        toBN(rewardsPerBlock[1]),
        totalPool,
        newBorrowCumulativeSum,
        blocksDelta.plus(1)
      );
      aggregatedReward = getUserAggregatedReward(
        newBorrowCumulativeSum,
        prevAP,
        borrowAmount.times(13),
        aggregatedReward
      );

      await checkBorrowUserDistributionInfo(daiKey, USER1, newBorrowCumulativeSum, aggregatedReward);
      await checkLiquidityPoolInfo(daiKey, newSupplyCumulativeSum, newBorrowCumulativeSum, currentBlock);
    });

    it("should get exception if not eligible contract call this function", async () => {
      const reason = "RewardsDistribution: Caller not an eligible contract.";

      await truffleAssert.reverts(rewardsDistribution.updateCumulativeSums(USER1, daiPool.address), reason);
    });
  });

  describe("getAPY", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    beforeEach("setup", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey, wEthKey], [wei(2), oneToken]);

      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(10), { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(10), { from: USER2 });

      await assetParameters.setupDistributionsMinimums(daiKey, [minBorrowDistributionPart, minBorrowDistributionPart]);
    });

    it("should return correct APY if the user has no deposits and borrows", async () => {
      const result = await rewardsDistribution.getAPY(daiKey);

      assert.equal(toBN(result[0]).toString(), 0);
      assert.equal(toBN(result[1]).toString(), 0);
    });

    it("should return correct APY if the user has a deposit", async () => {
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [toBN("559127800000000")]);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      const result = await rewardsDistribution.getAPY(daiKey);

      assert.closeTo(
        toBN(result[0]).toNumber(),
        getPrecision().times(10).toNumber(),
        getPrecision().idiv(10).toNumber()
      );
    });

    it("should return correct APY for multiple users", async () => {
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [toBN("0")]);

      await defiCore.addLiquidity(daiKey, liquidityAmount.times(4), { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(6), { from: USER2 });

      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [toBN("11182555210000000")]);

      let result = await rewardsDistribution.getAPY(daiKey);

      assert.closeTo(
        toBN(result[0]).toNumber(),
        getPrecision().times(20).toNumber(),
        getPrecision().idiv(10).toNumber()
      );

      result = await rewardsDistribution.getAPY(daiKey);

      assert.closeTo(
        toBN(result[0]).toNumber(),
        getPrecision().times(20).toNumber(),
        getPrecision().idiv(10).toNumber()
      );
    });

    it("should resturn correct APY for borrow", async () => {
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [toBN("0")]);

      await defiCore.addLiquidity(daiKey, liquidityAmount.times(10));
      await defiCore.borrowFor(daiKey, borrowAmount.times(10), USER1, { from: USER1 });

      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [toBN("559127800000000")]);

      let result = await rewardsDistribution.getAPY(daiKey);

      assert.closeTo(
        toBN(result[0]).toNumber(),
        getPrecision().times(5).toNumber(),
        getPrecision().idiv(10).toNumber()
      );
      assert.closeTo(
        toBN(result[1]).toNumber(),
        getPrecision().times(10).toNumber(),
        getPrecision().idiv(10).toNumber()
      );
    });

    it("should return corect APY for native pool", async () => {
      await rewardsDistribution.setupRewardsPerBlockBatch([stableKey], [wei("0.00000559128")]);

      await defiCore.addLiquidity(daiKey, liquidityAmount.times(10));
      await defiCore.borrowFor(stableKey, liquidityAmount, OWNER);

      const result = await rewardsDistribution.getAPY(stableKey);

      assert.equal(result[0].toString(), 0);
      assert.closeTo(toBN(result[1]).toNumber(), getPercentage100().toNumber(), getPrecision().idiv(10).toNumber());
    });
  });

  describe("setupRewardsPerBlockBatch", () => {
    const liquidityAmount = wei(100);
    const keys = [daiKey, wEthKey];
    const rewardsPerBlock = [oneToken, wei(5)];

    it("should correct update rewards per block first time", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);

      await rewardsDistribution.setupRewardsPerBlockBatch(keys, rewardsPerBlock);

      assert.equal(
        toBN((await rewardsDistribution.liquidityPoolsInfo(keys[0])).rewardPerBlock).toString(),
        toBN(rewardsPerBlock[0]).toString()
      );
      assert.equal(
        toBN((await rewardsDistribution.liquidityPoolsInfo(keys[1])).rewardPerBlock).toString(),
        toBN(rewardsPerBlock[1]).toString()
      );
    });

    it("should correct update rewards per block", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey, wEthKey], [wei(2), oneToken]);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      await mine(499);

      await rewardsDistribution.setupRewardsPerBlockBatch(keys, rewardsPerBlock);

      assert.equal(
        toBN((await rewardsDistribution.liquidityPoolsInfo(keys[0])).rewardPerBlock).toString(),
        toBN(rewardsPerBlock[0]).toString()
      );
      assert.equal(
        toBN((await rewardsDistribution.liquidityPoolsInfo(keys[1])).rewardPerBlock).toString(),
        toBN(rewardsPerBlock[1]).toString()
      );

      assert.equal(
        toBN(await rewardsDistribution.getUserReward(daiKey, USER1, daiPool.address)).toString(),
        wei("100.2").toString()
      );
      assert.equal(
        toBN(await rewardsDistribution.getUserReward(wEthKey, USER1, await getLiquidityPoolAddr(wEthKey))).toString(),
        wei(50).toString()
      );
    });

    it("should correct work with zero reward per block", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey, wEthKey], [wei(2), oneToken]);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await mine(499);

      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [0]);

      const daiLiquidityPool = await getLiquidityPoolAddr(daiKey);
      const currentReward = toBN(await rewardsDistribution.getUserReward(daiKey, USER1, daiLiquidityPool));

      await mine(199);

      assert.equal(
        currentReward.toString(),
        toBN(await rewardsDistribution.getUserReward(daiKey, USER1, daiLiquidityPool)).toString()
      );

      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [oneToken]);

      assert.equal(
        currentReward.toString(),
        toBN(await rewardsDistribution.getUserReward(daiKey, USER1, daiLiquidityPool)).toString()
      );
    });

    it("should get exception if try to set rewards per block with nonexisting rewards token", async () => {
      const reason = "RewardsDistributionL Unable to setup rewards per block.";

      await truffleAssert.reverts(rewardsDistribution.setupRewardsPerBlockBatch(keys, rewardsPerBlock), reason);
    });

    it("should get exception if arrays are transmitted have different length", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);

      keys.push(rewardsTokenKey);

      const reason = "RewardsDistribution: Length mismatch.";
      await truffleAssert.reverts(rewardsDistribution.setupRewardsPerBlockBatch(keys, rewardsPerBlock), reason);
    });

    it("should get exception if not system onwer try to call this function", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);

      const reason = "RewardsDistribution: Only system owner can call this function.";

      await truffleAssert.reverts(
        rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [oneToken], { from: USER1 }),
        reason
      );
    });
  });

  describe("getUserReward", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    beforeEach("setup", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey, wEthKey], [wei(2), oneToken]);
    });

    it("should return zero if the user has no rewards", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal(toBN(await rewardsDistribution.getUserReward(daiKey, USER1, daiPool.address)).toString(), 0);
    });

    it("should return correct reward for one user", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await mine(499);

      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      await mine(250);

      const expectedReward = wei(600);
      assert.equal(
        toBN(await rewardsDistribution.getUserReward(daiKey, USER1, daiPool.address)).toString(),
        expectedReward.toString()
      );
    });

    it("should return correct rewards for several users", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(3), { from: USER2 });

      await mine(449);

      await defiCore.borrowFor(daiKey, borrowAmount.times(4), USER2, { from: USER2 });

      let expectedUser1Reward = wei("22.7");
      let expectedUser2Reward = wei("67.5");

      assert.equal(
        toBN(await rewardsDistribution.getUserReward(daiKey, USER1, daiPool.address)).toString(),
        expectedUser1Reward.toString()
      );
      assert.equal(
        toBN(await rewardsDistribution.getUserReward(daiKey, USER2, daiPool.address)).toString(),
        expectedUser2Reward.toString()
      );

      await mine(499);

      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      expectedUser1Reward = wei("147.7");
      expectedUser2Reward = wei("942.5");

      assert.equal(
        toBN(await rewardsDistribution.getUserReward(daiKey, USER1, daiPool.address)).toString(),
        expectedUser1Reward.toString()
      );
      assert.equal(
        toBN(await rewardsDistribution.getUserReward(daiKey, USER2, daiPool.address)).toString(),
        expectedUser2Reward.toString()
      );

      await mine(320);

      expectedUser1Reward = wei("294.9");
      expectedUser2Reward = wei("1435.3");

      assert.equal(
        toBN(await rewardsDistribution.getUserReward(daiKey, USER1, daiPool.address)).toString(),
        expectedUser1Reward.toString()
      );
      assert.equal(
        toBN(await rewardsDistribution.getUserReward(daiKey, USER2, daiPool.address)).toString(),
        expectedUser2Reward.toString()
      );
    });

    it("should return correct rewards if reward per block is zero", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(3), { from: USER2 });

      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });
      await defiCore.borrowFor(daiKey, borrowAmount.times(2), USER2, { from: USER2 });

      await mine(499);

      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [0]);

      assert.equal(toBN((await rewardsDistribution.liquidityPoolsInfo(daiKey)).rewardPerBlock).toString(), 0);

      await mine(500);

      const expectedUser1Reward = wei("301.95");
      const expectedUser2Reward = wei("700.45");
      assert.equal(
        toBN(await rewardsDistribution.getUserReward(daiKey, USER1, daiPool.address)).toString(),
        expectedUser1Reward.toString()
      );
      assert.equal(
        toBN(await rewardsDistribution.getUserReward(daiKey, USER2, daiPool.address)).toString(),
        expectedUser2Reward.toString()
      );
    });
  });

  describe("zero rewards token checks", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);
    const totalRewardPerBlock = wei(2);
    const blocksDelta = toBN(9);

    it("updateCumulativeSums", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await checkSupplyUserDistributionInfo(daiKey, USER1, 0, 0);
      await checkLiquidityPoolInfo(daiKey, toBN(0), toBN(0), toBN(0));

      await mine(blocksDelta);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await checkSupplyUserDistributionInfo(daiKey, USER1, 0, 0);
      await checkLiquidityPoolInfo(daiKey, toBN(0), toBN(0), toBN(0));
    });

    it("getAPY", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await mine(blocksDelta);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await mine(blocksDelta);

      await defiCore.borrowFor(daiKey, borrowAmount, USER1, { from: USER1 });

      const apys = await rewardsDistribution.getAPY(daiKey);

      assert.equal(apys[0], 0);
      assert.equal(apys[1], 0);
    });

    it("getUserReward", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await mine(blocksDelta);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal(await rewardsDistribution.getUserReward(daiKey, USER1, daiPool.address), 0);
    });
  });
});
