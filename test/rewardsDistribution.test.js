const {
  setNextBlockTime,
  setTime,
  mine,
  getCurrentBlockTime,
  getCurrentBlockNumber,
} = require("./helpers/hardhatTimeTraveller");
const { toBytes, compareKeys, deepCompareKeys } = require("./helpers/bytesCompareLibrary");
const { getInterestRateLibraryData } = require("../migrations/helpers/deployHelper");
const { toBN, accounts, getOnePercent, getDecimal, wei } = require("../scripts/utils");

const Reverter = require("./helpers/reverter");
const truffleAssert = require("truffle-assertions");

const Registry = artifacts.require("Registry");
const DefiCore = artifacts.require("DefiCore");
const SystemParameters = artifacts.require("SystemParameters");
const AssetParameters = artifacts.require("AssetParameters");
const RewardsDistribution = artifacts.require("RewardsDistributionMock");
const UserInfoRegistry = artifacts.require("UserInfoRegistry");
const LiquidityPoolRegistry = artifacts.require("LiquidityPoolRegistry");
const LiquidityPoolFactory = artifacts.require("LiquidityPoolFactory");
const LiquidityPool = artifacts.require("LiquidityPool");
const PriceManager = artifacts.require("PriceManagerMock");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const GovernanceToken = artifacts.require("GovernanceToken");

const MockERC20 = artifacts.require("MockERC20");
const ChainlinkOracleMock = artifacts.require("ChainlinkOracleMock");

LiquidityPool.numberFormat = "BigNumber";
RewardsDistribution.numberFormat = "BigNumber";

describe("RewardsDistribution", () => {
  const reverter = new Reverter();

  const ADDRESS_NULL = "0x0000000000000000000000000000000000000000";

  let OWNER;
  let USER1;
  let USER2;
  let NOTHING;

  let registry;
  let defiCore;
  let assetParameters;
  let rewardsDistribution;
  let priceManager;
  let liquidityPoolRegistry;

  let daiPool;

  const oneToken = toBN(10).pow(18);
  const tokensAmount = wei(1000000);
  const colRatio = getDecimal().times("1.25");
  const reserveFactor = getOnePercent().times("15");
  const liquidationDiscount = getOnePercent().times(8);

  const firstSlope = getOnePercent().times(4);
  const secondSlope = getDecimal();
  const utilizationBreakingPoint = getOnePercent().times(80);
  const maxUR = getOnePercent().times(95);

  const chainlinkPriceDecimals = toBN(8);

  const minSupplyDistributionPart = getOnePercent().times(10);
  const minBorrowDistributionPart = getOnePercent().times(10);

  const daiKey = toBytes("DAI");
  const wEthKey = toBytes("WETH");
  const governanceTokenKey = toBytes("GTK");

  const tokens = [];

  async function deployTokens(symbols) {
    for (let i = 0; i < symbols.length; i++) {
      const token = await MockERC20.new("Mock" + symbols[i], symbols[i]);
      await token.mintArbitraryBatch([OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);

      tokens.push(token);
    }
  }

  async function createLiquidityPool(assetKey, asset, symbol, isCollateral) {
    const chainlinkOracle = await ChainlinkOracleMock.new(wei(100, chainlinkPriceDecimals), chainlinkPriceDecimals);

    await liquidityPoolRegistry.addLiquidityPool(
      asset.address,
      assetKey,
      chainlinkOracle.address,
      NOTHING,
      symbol,
      isCollateral
    );

    await asset.approveArbitraryBacth(
      await liquidityPoolRegistry.liquidityPools(assetKey),
      [OWNER, USER1, USER2],
      [tokensAmount, tokensAmount, tokensAmount]
    );

    await assetParameters.setupAllParameters(assetKey, [
      [colRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);

    await priceManager.setPrice(assetKey, 100);

    return chainlinkOracle;
  }

  async function deployGovernancePool(governanceTokenAddr, symbol) {
    await liquidityPoolRegistry.addLiquidityPool(
      governanceTokenAddr,
      governanceTokenKey,
      ADDRESS_NULL,
      NOTHING,
      symbol,
      true
    );

    await assetParameters.setupAllParameters(governanceTokenKey, [
      [colRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);

    await priceManager.setPrice(governanceTokenKey, 10);
  }

  function getNewCumulativeSum(rewardPerBlock, totalPool, prevAP, blocksDelta) {
    return rewardPerBlock.times(getDecimal()).idiv(totalPool).times(blocksDelta).plus(prevAP);
  }

  function getUserAggregatedReward(newAP, prevAP, userLiquidityAmount, prevReward) {
    return userLiquidityAmount.times(newAP.minus(prevAP)).idiv(getDecimal()).plus(prevReward);
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
      getOnePercent().idiv(1000).toNumber()
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
      getOnePercent().idiv(1000).toNumber()
    );
    assert.closeTo(
      (await rewardsDistribution.liquidityPoolsInfo(assetKey)).borrowCumulativeSum.toNumber(),
      expectedBorrowCumulativeSum.toNumber(),
      getOnePercent().idiv(1000).toNumber()
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

    const governanceToken = await GovernanceToken.new(OWNER);
    const interestRateLibrary = await InterestRateLibrary.new(
      getInterestRateLibraryData("scripts/InterestRatesExactData.txt"),
      getInterestRateLibraryData("scripts/InterestRatesData.txt")
    );

    registry = await Registry.new();
    const _defiCore = await DefiCore.new();
    const _systemParameters = await SystemParameters.new();
    const _assetParameters = await AssetParameters.new();
    const _rewardsDistribution = await RewardsDistribution.new();
    const _userInfoRegistry = await UserInfoRegistry.new();
    const _liquidityPoolRegistry = await LiquidityPoolRegistry.new();
    const _liquidityPoolFactory = await LiquidityPoolFactory.new();
    const _liquidityPoolImpl = await LiquidityPool.new();
    const _priceManager = await PriceManager.new();

    await registry.addProxyContract(await registry.DEFI_CORE_NAME(), _defiCore.address);
    await registry.addProxyContract(await registry.SYSTEM_PARAMETERS_NAME(), _systemParameters.address);
    await registry.addProxyContract(await registry.ASSET_PARAMETERS_NAME(), _assetParameters.address);
    await registry.addProxyContract(await registry.REWARDS_DISTRIBUTION_NAME(), _rewardsDistribution.address);
    await registry.addProxyContract(await registry.USER_INFO_REGISTRY_NAME(), _userInfoRegistry.address);
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_REGISTRY_NAME(), _liquidityPoolRegistry.address);
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_FACTORY_NAME(), _liquidityPoolFactory.address);
    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), _priceManager.address);

    await registry.addContract(await registry.INTEREST_RATE_LIBRARY_NAME(), interestRateLibrary.address);
    await registry.addContract(await registry.GOVERNANCE_TOKEN_NAME(), governanceToken.address);

    defiCore = await DefiCore.at(await registry.getDefiCoreContract());
    assetParameters = await AssetParameters.at(await registry.getAssetParametersContract());
    userInfoRegistry = await UserInfoRegistry.at(await registry.getUserInfoRegistryContract());
    liquidityPoolRegistry = await LiquidityPoolRegistry.at(await registry.getLiquidityPoolRegistryContract());
    rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());
    priceManager = await PriceManager.at(await registry.getPriceManagerContract());

    const systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());

    await registry.injectDependencies(await registry.DEFI_CORE_NAME());
    await registry.injectDependencies(await registry.ASSET_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.REWARDS_DISTRIBUTION_NAME());
    await registry.injectDependencies(await registry.USER_INFO_REGISTRY_NAME());
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_REGISTRY_NAME());
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_FACTORY_NAME());
    await registry.injectDependencies(await registry.PRICE_MANAGER_NAME());

    await deployTokens([await governanceToken.symbol(), "DAI", "WETH"]);

    await systemParameters.systemParametersInitialize();
    await assetParameters.assetParametersInitialize();
    await rewardsDistribution.rewardsDistributionInitialize();
    await liquidityPoolRegistry.liquidityPoolRegistryInitialize(_liquidityPoolImpl.address);
    await priceManager.priceManagerInitialize(daiKey, tokens[1].address);

    await deployGovernancePool(governanceToken.address, await governanceToken.symbol());

    await createLiquidityPool(daiKey, tokens[1], "DAI", true);
    await createLiquidityPool(wEthKey, tokens[2], "WETH", true);

    daiPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(daiKey));

    await rewardsDistribution.setupRewardsPerBlockBatch(
      [daiKey, wEthKey, governanceTokenKey],
      [wei(2), oneToken, wei(3)]
    );

    await governanceToken.transfer(defiCore.address, tokensAmount.times(10));

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("getRewardsPerBlock", () => {
    const rewardPerBlock = wei(4);

    beforeEach("setup", async () => {
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [rewardPerBlock]);
    });

    it("should return correct rewards per block if current UR = 0", async () => {
      const result = await rewardsDistribution.getRewardsPerBlock(daiKey, 0);

      const expectedSupplyReward = rewardPerBlock.times(minSupplyDistributionPart).div(getDecimal());
      const expectedBorrowReward = rewardPerBlock.minus(expectedSupplyReward);

      assert.equal(result[0].toString(), expectedSupplyReward.toString());
      assert.equal(result[1].toString(), expectedBorrowReward.toString());
    });

    it("should return correct rewards per block if current UR = 100", async () => {
      const result = await rewardsDistribution.getRewardsPerBlock(daiKey, getDecimal());

      const expectedBorrowReward = rewardPerBlock.times(minBorrowDistributionPart).div(getDecimal());
      const expectedSupplyReward = rewardPerBlock.minus(expectedBorrowReward);

      assert.equal(result[0].toString(), expectedSupplyReward.toString());
      assert.equal(result[1].toString(), expectedBorrowReward.toString());
    });

    it("should return correct rewards per block if current UR = 50", async () => {
      const currentUR = getOnePercent().times(50);
      const result = await rewardsDistribution.getRewardsPerBlock(daiKey, currentUR);

      const supplyPart = currentUR
        .times(getDecimal().minus(minBorrowDistributionPart).minus(minSupplyDistributionPart))
        .div(getDecimal())
        .plus(minSupplyDistributionPart);

      const expectedSupplyReward = rewardPerBlock.times(supplyPart).div(getDecimal());
      const expectedBorrowReward = rewardPerBlock.minus(expectedSupplyReward);

      assert.equal(result[0].toString(), expectedSupplyReward.toString());
      assert.equal(result[1].toString(), expectedBorrowReward.toString());
    });

    it("should return correct rewards per block if total reward per block = 0", async () => {
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [0]);

      const currentUR = getOnePercent().times(50);
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

      let expectedCumulativeSum = rewardsPerBlock.times(getDecimal()).idiv(totalPool).times(blocksDelta);
      let actualCumulativeSum = await rewardsDistribution.getNewCumulativeSum(
        rewardsPerBlock,
        totalPool,
        prevAP,
        blocksDelta
      );

      assert.equal(actualCumulativeSum.toString(), expectedCumulativeSum.toString());

      prevAP = actualCumulativeSum;

      totalPool = wei(800);

      expectedCumulativeSum = rewardsPerBlock.times(getDecimal()).idiv(totalPool).times(blocksDelta).plus(prevAP);
      actualCumulativeSum = await rewardsDistribution.getNewCumulativeSum(
        rewardsPerBlock,
        totalPool,
        prevAP,
        blocksDelta
      );

      assert.equal(actualCumulativeSum.toString(), expectedCumulativeSum.toString());
    });
  });

  describe("updateCumulativeSum", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);
    const totalRewardPerBlock = wei(2);
    const supplyRewardsPerBlock = totalRewardPerBlock.times(minSupplyDistributionPart).div(getDecimal());
    const blocksDelta = toBN(9);

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

      assert.equal(newCumulativeSum.toString(), getOnePercent().times(3).toString());

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

      await defiCore.borrow(daiKey, borrowAmount.times(10), { from: USER1 });
      const startBlock = toBN(await getCurrentBlockNumber());

      let newSupplyCumulativeSum = getNewCumulativeSum(wei("0.2"), liquidityAmount.times(10), 0, toBN(3));

      let totalPool = borrowAmount.times(10);

      await checkBorrowUserDistributionInfo(daiKey, USER1, toBN(0), toBN(0));
      await checkLiquidityPoolInfo(daiKey, newSupplyCumulativeSum, toBN(0), startBlock);

      await mine(blocksDelta);

      let rewardsPerBlock = await getRewardsPerBlock(daiKey, daiPool);

      await defiCore.borrow(daiKey, borrowAmount.times(5), { from: USER2 });

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

      await defiCore.borrow(daiKey, borrowAmount.times(10), { from: USER1 });
      const startBlock = toBN(await getCurrentBlockNumber());

      let newSupplyCumulativeSum = getNewCumulativeSum(wei("0.2"), liquidityAmount.times(10), 0, toBN(3));
      let totalPool = borrowAmount.times(10);

      await checkBorrowUserDistributionInfo(daiKey, USER1, toBN(0), toBN(0));
      await checkLiquidityPoolInfo(daiKey, newSupplyCumulativeSum, toBN(0), startBlock);

      await mine(blocksDelta);

      let rewardsPerBlock = await getRewardsPerBlock(daiKey, daiPool);

      await defiCore.borrow(daiKey, borrowAmount.times(5), { from: USER1 });

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

      await defiCore.borrow(daiKey, borrowAmount.times(4), { from: USER1 });

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
  });

  describe("getAPY", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(10), { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount.times(10), { from: USER2 });

      await assetParameters.setupDistributionsMinimums(daiKey, [minBorrowDistributionPart, minBorrowDistributionPart]);
    });

    it("should return correct APY if the user has no deposits and borrows", async () => {
      const result = await rewardsDistribution.getAPY(daiPool.address);

      assert.equal(toBN(result[0]).toString(), 0);
      assert.equal(toBN(result[1]).toString(), 0);
    });

    it("should return correct APY if the user has a deposit", async () => {
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [toBN("424763700000000")]);

      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      const result = await rewardsDistribution.getAPY(daiPool.address);

      assert.closeTo(
        toBN(result[0]).toNumber(),
        getOnePercent().times(10).toNumber(),
        getOnePercent().idiv(10).toNumber()
      );
    });

    it("should return correct APY for multiple users", async () => {
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [toBN("0")]);

      await defiCore.addLiquidity(daiKey, liquidityAmount.times(4), { from: USER1 });
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(6), { from: USER2 });

      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [toBN("8495274500000000")]);

      let result = await rewardsDistribution.getAPY(daiPool.address);

      assert.closeTo(
        toBN(result[0]).toNumber(),
        getOnePercent().times(20).toNumber(),
        getOnePercent().idiv(10).toNumber()
      );

      result = await rewardsDistribution.getAPY(daiPool.address);

      assert.closeTo(
        toBN(result[0]).toNumber(),
        getOnePercent().times(20).toNumber(),
        getOnePercent().idiv(10).toNumber()
      );
    });

    it("should resturn correct APY for borrow", async () => {
      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [toBN("0")]);

      await defiCore.addLiquidity(daiKey, liquidityAmount.times(10));
      await defiCore.borrow(daiKey, borrowAmount.times(10), { from: USER1 });

      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [toBN("424763700000000")]);

      let result = await rewardsDistribution.getAPY(daiPool.address);

      assert.closeTo(
        toBN(result[0]).toNumber(),
        getOnePercent().times(5).toNumber(),
        getOnePercent().idiv(10).toNumber()
      );
      assert.closeTo(
        toBN(result[1]).toNumber(),
        getOnePercent().times(10).toNumber(),
        getOnePercent().idiv(10).toNumber()
      );
    });
  });

  describe("setupRewardsPerBlockBatch", () => {
    const liquidityAmount = wei(100);
    const keys = [daiKey, wEthKey];
    const rewardsPerBlock = [oneToken, wei(5)];

    it("should correct update rewards per block first time", async () => {
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
        toBN(
          await rewardsDistribution.getUserReward(wEthKey, USER1, await liquidityPoolRegistry.liquidityPools(wEthKey))
        ).toString(),
        wei(50).toString()
      );
    });

    it("should correct work with zero reward per block", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await mine(499);

      await rewardsDistribution.setupRewardsPerBlockBatch([daiKey], [0]);

      const daiLiquidityPool = await liquidityPoolRegistry.liquidityPools(daiKey);
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

    it("should get exception if arrays are transmitted have different length", async () => {
      keys.push(governanceTokenKey);

      const reason = "RewardsDistribution: Length mismatch.";
      await truffleAssert.reverts(rewardsDistribution.setupRewardsPerBlockBatch(keys, rewardsPerBlock), reason);
    });
  });

  describe("getUserReward", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    it("should return zero if the user has no rewards", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      assert.equal(toBN(await rewardsDistribution.getUserReward(daiKey, USER1, daiPool.address)).toString(), 0);
    });

    it("should return correct reward for one user", async () => {
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      await mine(499);

      await defiCore.borrow(daiKey, borrowAmount, { from: USER1 });

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

      await defiCore.borrow(daiKey, borrowAmount.times(4), { from: USER2 });

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

      await defiCore.borrow(daiKey, borrowAmount, { from: USER1 });

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

      await defiCore.borrow(daiKey, borrowAmount, { from: USER1 });
      await defiCore.borrow(daiKey, borrowAmount.times(2), { from: USER2 });

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
});
