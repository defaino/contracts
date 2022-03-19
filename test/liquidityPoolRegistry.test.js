const { setNextBlockTime, getCurrentBlockTime } = require("./helpers/hardhatTimeTraveller");
const { toBytes, fromBytes, deepCompareKeys, compareKeys } = require("./helpers/bytesCompareLibrary");
const { getInterestRateLibraryData } = require("../deploy/helpers/deployHelper");
const { toBN, accounts, getOnePercent, getDecimal, wei } = require("../scripts/utils");

const truffleAssert = require("truffle-assertions");
const Reverter = require("./helpers/reverter");

const Registry = artifacts.require("Registry");
const DefiCore = artifacts.require("DefiCore");
const SystemParameters = artifacts.require("SystemParameters");
const AssetParameters = artifacts.require("AssetParameters");
const RewardsDistribution = artifacts.require("RewardsDistributionMock");
const UserInfoRegistry = artifacts.require("UserInfoRegistry");
const LiquidityPoolRegistry = artifacts.require("LiquidityPoolRegistry");
const LiquidityPoolFactory = artifacts.require("LiquidityPoolFactory");
const LiquidityPool = artifacts.require("LiquidityPool");
const LiquidityPoolMock = artifacts.require("LiquidityPoolMock");
const PriceManager = artifacts.require("PriceManagerMock");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const GovernanceToken = artifacts.require("GovernanceToken");

const MockERC20 = artifacts.require("MockERC20");
const ChainlinkOracleMock = artifacts.require("ChainlinkOracleMock");

LiquidityPool.numberFormat = "BigNumber";
LiquidityPoolRegistry.numberFormat = "BigNumber";

describe("LiquidityPoolRegistry", () => {
  const reverter = new Reverter();

  const ADDRESS_NULL = "0x0000000000000000000000000000000000000000";

  const colRatio = getDecimal().times("1.25");
  const oneToken = toBN(10).pow(18);
  const tokensAmount = wei(100000);
  const reserveFactor = getOnePercent().times("15");
  const priceDecimals = toBN(10).pow(8);
  const price = toBN(100);

  const firstSlope = getOnePercent().times(4);
  const secondSlope = getDecimal();
  const utilizationBreakingPoint = getOnePercent().times(80);
  const maxUR = getOnePercent().times(95);

  const liquidationDiscount = getOnePercent().times(8);

  const minSupplyDistributionPart = getOnePercent().times(15);
  const minBorrowDistributionPart = getOnePercent().times(10);

  let OWNER;
  let USER1;
  let USER2;
  let NOTHING;
  let TEST_ASSET;

  let assetParameters;
  let defiCore;
  let registry;
  let rewardsDistribution;
  let priceManager;
  let liquidityPoolRegistry;

  const governanceTokenKey = toBytes("GTK");
  const daiKey = toBytes("DAI");

  async function getTokens(symbols) {
    const neededTokens = [];

    for (let i = 0; i < symbols.length; i++) {
      const token = await MockERC20.new("Mock" + symbols[i], symbols[i]);
      await token.mintArbitraryBatch([OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);

      neededTokens.push(token);
    }

    return neededTokens;
  }

  async function createLiquidityPool(assetKey, symbol, isCollateral) {
    const token = await MockERC20.new("Mock" + symbol, symbol);
    await token.mintArbitraryBatch([OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);

    const chainlinkOracle = await ChainlinkOracleMock.new(price.times(priceDecimals), 8);

    await liquidityPoolRegistry.addLiquidityPool(
      token.address,
      assetKey,
      chainlinkOracle.address,
      NOTHING,
      symbol,
      isCollateral
    );

    await token.approveArbitraryBacth(
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

    return token;
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

    await rewardsDistribution.setupRewardsPerBlockBatch([governanceTokenKey], [oneToken.times(2)]);
  }

  before("setup", async () => {
    OWNER = await accounts(0);
    USER1 = await accounts(1);
    USER2 = await accounts(2);
    NOTHING = await accounts(8);
    TEST_ASSET = await accounts(9);

    const interestRateLibrary = await InterestRateLibrary.new(
      getInterestRateLibraryData("deploy/data/InterestRatesExactData.txt")
    );
    const governanceToken = await GovernanceToken.new(OWNER);

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

    const daiToken = (await getTokens("DAI"))[0];

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

    await systemParameters.systemParametersInitialize();
    await assetParameters.assetParametersInitialize();
    await rewardsDistribution.rewardsDistributionInitialize();
    await liquidityPoolRegistry.liquidityPoolRegistryInitialize(_liquidityPoolImpl.address);
    await priceManager.priceManagerInitialize(daiKey, daiToken.address);

    await interestRateLibrary.addNewRates(
      110, // Start percentage
      getInterestRateLibraryData("deploy/data/InterestRatesData.txt")
    );

    await deployGovernancePool(governanceToken.address, await governanceToken.symbol());

    await governanceToken.transfer(defiCore.address, tokensAmount.times(10));

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("addLiquidityPool", () => {
    const assetKeyRow = "DAI";
    const assetKeyBytes = toBytes(assetKeyRow);

    let chainlinkOracle;

    beforeEach("setup", async () => {
      chainlinkOracle = await ChainlinkOracleMock.new(10, 8);
    });

    it("should correctly add liquidity pool", async () => {
      const txReceipt = await liquidityPoolRegistry.addLiquidityPool(
        TEST_ASSET,
        assetKeyBytes,
        chainlinkOracle.address,
        NOTHING,
        assetKeyRow,
        true
      );

      assert.equal(txReceipt.receipt.logs.length, 2);

      assert.equal(txReceipt.receipt.logs[1].event, "PoolAdded");

      assert.equal(fromBytes(txReceipt.receipt.logs[1].args._assetKey), assetKeyRow);
      assert.equal(txReceipt.receipt.logs[1].args._poolAddr, await liquidityPoolRegistry.liquidityPools(assetKeyBytes));
    });

    it("should get exception if asset key is empty string", async () => {
      const reason = "LiquidityPoolRegistry: Unable to add an asset without a key.";

      await truffleAssert.reverts(
        liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, toBytes(""), NOTHING, NOTHING, assetKeyRow, false),
        reason
      );
    });

    it("should get exception if asset address is zero address", async () => {
      const reason = "LiquidityPoolRegistry: Unable to add an asset with a zero address.";

      await truffleAssert.reverts(
        liquidityPoolRegistry.addLiquidityPool(ADDRESS_NULL, assetKeyBytes, NOTHING, NOTHING, assetKeyRow, true),
        reason
      );
    });

    it("should get exception if try to add a pool to a key that already exists", async () => {
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, assetKeyBytes, NOTHING, NOTHING, assetKeyRow, false);

      const reason = "LiquidityPoolRegistry: Liquidity pool with such a key already exists.";

      await truffleAssert.reverts(
        liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, assetKeyBytes, NOTHING, NOTHING, assetKeyRow, false),
        reason
      );
    });
  });

  describe("withdrawAllReservedFunds/withdrawReservedFunds", () => {
    const firstKey = toBytes("FIRST_KEY");
    const secondKey = toBytes("SECOND_KEY");
    const thirdKey = toBytes("THIRD_KEY");
    const symbols = ["FIRST", "SECOND", "THIRD"];
    const keys = [firstKey, secondKey, thirdKey];

    const tokens = [];
    const liquidityPools = [];
    const reservedAmounts = [];

    const liquidityAmount = wei(100);
    const borrowAmount = wei(60);
    const startTime = toBN(10000);

    let RECIPIENT;

    beforeEach("setup", async () => {
      RECIPIENT = await accounts(4);

      for (let i = 0; i < keys.length; i++) {
        const currentTime = toBN(await getCurrentBlockTime());
        await setNextBlockTime(currentTime.plus(startTime).toNumber());
        tokens.push(await createLiquidityPool(keys[i], symbols[i], true));

        const currentLiquidityPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(keys[i]));
        liquidityPools.push(currentLiquidityPool);

        await defiCore.addLiquidity(keys[i], liquidityAmount.times(i + 1), { from: USER1 });
        await defiCore.borrowFor(keys[i], borrowAmount.times(i + 1), USER1, { from: USER1 });

        await setNextBlockTime(currentTime.plus(startTime.times(1000)).toNumber());
        await currentLiquidityPool.updateCompoundRate(false);

        await defiCore.repayBorrow(keys[i], borrowAmount.times(i + 3), true, { from: USER1 });

        reservedAmounts.push(await currentLiquidityPool.totalReserves());
      }
    });

    it("should correctly withdraw all funds from all liquidity pools", async () => {
      await liquidityPoolRegistry.withdrawAllReservedFunds(RECIPIENT, 0, 10);

      for (let i = 0; i < keys.length; i++) {
        assert.equal(reservedAmounts[i].toString(), (await tokens[i].balanceOf(RECIPIENT)).toString());
      }
    });

    it("should correctly withdraw reserved funds from specific liquidity pool", async () => {
      const amountToWithdraw = reservedAmounts[1].idiv(2);

      await liquidityPoolRegistry.withdrawReservedFunds(RECIPIENT, keys[1], amountToWithdraw, false);

      assert.equal(amountToWithdraw.toString(), (await tokens[1].balanceOf(RECIPIENT)).toString());
    });

    it("should get exception if the asset doesn't exist", async () => {
      const reason = "LiquidityPoolRegistry: Pool doesn't exist.";

      await truffleAssert.reverts(
        liquidityPoolRegistry.withdrawReservedFunds(RECIPIENT, toBytes("SOME_KEY"), 1000, false),
        reason
      );
    });
  });

  describe("upgradeLiquidityPools", () => {
    it("should correctly update liquidity pools", async () => {
      const daiKey = toBytes("DAI");

      await createLiquidityPool(daiKey, "DAI", true);
      const daiPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(daiKey));

      const newImplementation = await LiquidityPoolMock.new();

      await truffleAssert.reverts(
        (await LiquidityPoolMock.at(daiPool.address)).getNormalizedAmount(10, 10, 10, 50, true)
      );

      await liquidityPoolRegistry.upgradeLiquidityPoolsImpl(newImplementation.address);

      assert.equal(await liquidityPoolRegistry.getLiquidityPoolsImpl(), newImplementation.address);

      const newDaiPool = await LiquidityPoolMock.at(daiPool.address);
      await newDaiPool.getNormalizedAmount(10, 100, 100, 50, true);
    });
  });

  describe("getAllSupportedAssets", () => {
    it("should return zero supported assets", async () => {
      assert.isTrue(deepCompareKeys(await liquidityPoolRegistry.getAllSupportedAssets(), [governanceTokenKey]));
    });

    it("should return correct supported assets", async () => {
      const assetKey1 = toBytes("DAI");
      const assetKey2 = toBytes("WETH");
      const assetKey3 = toBytes("USDT");
      const assetKey4 = toBytes("USDC");

      const expectedList = [governanceTokenKey, assetKey1, assetKey2, assetKey3, assetKey4];

      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, assetKey1, NOTHING, NOTHING, "DAI", false);
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, assetKey2, NOTHING, NOTHING, "WETH", false);
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, assetKey3, NOTHING, NOTHING, "USDT", false);
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, assetKey4, NOTHING, NOTHING, "USDC", false);

      assert.isTrue(deepCompareKeys(await liquidityPoolRegistry.getAllSupportedAssets(), expectedList));
    });
  });

  describe("getAllLiquidityPools", () => {
    it("should return liquidity pool for governance token", async () => {
      assert.deepEqual(
        [await liquidityPoolRegistry.liquidityPools(governanceTokenKey)],
        await liquidityPoolRegistry.getAllLiquidityPools()
      );
    });

    it("should return correct liquidity pools", async () => {
      const assetKey1 = toBytes("DAI");
      const assetKey2 = toBytes("WETH");
      const assetKey3 = toBytes("USDT");
      const assetKey4 = toBytes("USDC");

      const expectedKeysList = [governanceTokenKey, assetKey1, assetKey2, assetKey3, assetKey4];
      const expectedList = [];

      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, assetKey1, NOTHING, NOTHING, "DAI", false);
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, assetKey2, NOTHING, NOTHING, "WETH", false);
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, assetKey3, NOTHING, NOTHING, "USDT", false);
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, assetKey4, NOTHING, NOTHING, "USDC", false);

      for (let i = 0; i < expectedKeysList.length; i++) {
        expectedList.push(await liquidityPoolRegistry.liquidityPools(expectedKeysList[i]));
      }

      assert.deepEqual(expectedList, await liquidityPoolRegistry.getAllLiquidityPools());
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

        const currentLiquidityPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(keys[i]));
        liquidityPools.push(currentLiquidityPool);

        await defiCore.addLiquidity(keys[i], liquidityAmount.times(i + 1), { from: USER1 });
        await defiCore.borrowFor(keys[i], borrowAmount.times(i + 1), USER1, { from: USER1 });
      }
    });

    it("should return correct data", async () => {
      const liquidityPoolsInfo = await liquidityPoolRegistry.getLiquidityPoolsInfo(keys);

      for (let i = 0; i < liquidityPoolsInfo.length; i++) {
        const currentInfo = liquidityPoolsInfo[i];

        assert.isTrue(compareKeys(currentInfo.baseInfo.assetKey, keys[i]));

        assert.equal(currentInfo.baseInfo.assetAddr, tokens[i].address);

        const totalPoolLiquidity = liquidityAmount.times(i + 1);
        assert.equal(currentInfo.marketSize.toString(), totalPoolLiquidity.toString());
        assert.equal(
          currentInfo.marketSizeInUSD.toString(),
          (await liquidityPools[i].getAmountInUSD(totalPoolLiquidity)).toString()
        );

        const totalBorrowedAmount = borrowAmount.times(i + 1);
        assert.equal(currentInfo.totalBorrowBalance.toString(), totalBorrowedAmount.toString());
        assert.equal(
          currentInfo.totalBorrowBalanceInUSD.toString(),
          (await liquidityPools[i].getAmountInUSD(totalBorrowedAmount)).toString()
        );

        const expectedSupplyAPY = getOnePercent().times(1.53);
        const expectedBorrowAPY = getOnePercent().times(3);

        assert.equal(currentInfo.baseInfo.supplyAPY.toString(), expectedSupplyAPY.toFixed());
        assert.equal(currentInfo.baseInfo.borrowAPY.toString(), expectedBorrowAPY.toFixed());
      }
    });
  });

  describe("getDetailedLiquidityPoolInfo", () => {
    const symbols = ["FIRST", "SECOND", "THIRD"];
    const keys = [toBytes("FIRST_KEY"), toBytes("SECOND_KEY"), toBytes("THIRD_KEY")];

    const liquidityAmount = wei(100);
    const borrowAmount = wei(60);
    const pricePerToken = price.times(priceDecimals);

    beforeEach("setup", async () => {
      for (let i = 0; i < keys.length; i++) {
        await createLiquidityPool(keys[i], symbols[i], true);

        await defiCore.addLiquidity(keys[i], liquidityAmount.times(i + 1), { from: USER1 });
        await defiCore.borrowFor(keys[i], borrowAmount.times(i + 1), USER1, { from: USER1 });
      }

      await rewardsDistribution.setupRewardsPerBlockBatch(keys, [wei(2), oneToken, wei(3)]);
    });

    it("should return correct detailed info", async () => {
      for (let i = 0; i < keys.length; i++) {
        const detailedInfo = await liquidityPoolRegistry.getDetailedLiquidityPoolInfo(keys[i]);

        const totalBorrowedAmount = borrowAmount.times(i + 1);
        const availableLiquidity = liquidityAmount
          .times(i + 1)
          .times(maxUR)
          .idiv(getDecimal())
          .minus(totalBorrowedAmount);

        assert.equal(detailedInfo.poolInfo.totalBorrowBalance.toString(), totalBorrowedAmount.toString());
        assert.equal(
          detailedInfo.poolInfo.totalBorrowBalanceInUSD.toString(),
          totalBorrowedAmount.idiv(oneToken).times(pricePerToken).toString()
        );

        assert.equal(detailedInfo.availableLiquidity.toString(), availableLiquidity.toString());
        assert.equal(
          detailedInfo.availableLiquidityInUSD.toString(),
          availableLiquidity.idiv(oneToken).times(pricePerToken).toString()
        );
        assert.equal(detailedInfo.poolInfo.baseInfo.utilizationRatio.toString(), getOnePercent().times(60).toFixed());
        assert.equal(detailedInfo.poolInfo.baseInfo.isAvailableAsCollateral, true);

        assert.equal(detailedInfo.mainPoolParams.collateralizationRatio.toString(), colRatio.toFixed());
        assert.equal(detailedInfo.mainPoolParams.reserveFactor.toString(), reserveFactor.toFixed());
        assert.equal(detailedInfo.mainPoolParams.liquidationDiscount.toString(), liquidationDiscount.toFixed());
        assert.equal(detailedInfo.mainPoolParams.maxUtilizationRatio.toString(), maxUR.toFixed());

        const expectedSupplyAPY = getOnePercent().times(1.53);
        const expectedBorrowAPY = getOnePercent().times(3);

        assert.equal(detailedInfo.poolInfo.baseInfo.supplyAPY.toString(), expectedSupplyAPY.toFixed());
        assert.equal(detailedInfo.poolInfo.baseInfo.borrowAPY.toString(), expectedBorrowAPY.toFixed());
      }
    });
  });

  describe("getTotalMarketsSize", () => {
    const liquidityAmount = wei(100);

    it("should return zero if there were no deposits in the system", async () => {
      assert.equal(toBN(await liquidityPoolRegistry.getTotalMarketsSize()).toString(), 0);
    });

    it("should return correct value", async () => {
      const firstKey = toBytes("FIRST_KEY");
      const secondKey = toBytes("SECOND_KEY");
      const thirdKey = toBytes("THIRD_KEY");
      const symbols = ["FIRST", "SECOND", "THIRD"];
      const keys = [firstKey, secondKey, thirdKey];

      const tokens = [];

      let totalSize = toBN(0);

      for (let i = 0; i < keys.length; i++) {
        tokens.push(await createLiquidityPool(keys[i], symbols[i], true));

        await defiCore.addLiquidity(keys[i], liquidityAmount.times(i + 1), { from: USER1 });
        totalSize = totalSize.plus(liquidityAmount.times(i + 1));
      }

      assert.equal(
        toBN(await liquidityPoolRegistry.getTotalMarketsSize()).toString(),
        totalSize.idiv(oneToken).times(price.times(priceDecimals)).toString()
      );
    });
  });
});
