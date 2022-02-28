const AssetParameters = artifacts.require("AssetParameters");
const SystemParameters = artifacts.require("SystemParameters");
const Registry = artifacts.require("Registry");
const LiquidityPool = artifacts.require("LiquidityPool");
const LiquidityPoolFactory = artifacts.require("LiquidityPoolFactory");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const MockERC20 = artifacts.require("MockERC20");
const DefiCore = artifacts.require("DefiCore");
const RewardsDistribution = artifacts.require("RewardsDistributionMock");
const GovernanceToken = artifacts.require("GovernanceToken");
const PriceManager = artifacts.require("PriceManagerMock");
const ChainlinkOracleMock = artifacts.require("ChainlinkOracleMock");
const AssetsRegistry = artifacts.require("AssetsRegistry");
const LiquidityPoolAdmin = artifacts.require("LiquidityPoolAdmin");
const LiquidityPoolRegistry = artifacts.require("LiquidityPoolRegistry");

const IntegrationCore = artifacts.require("IntegrationCore");
const BorrowerRouter = artifacts.require("BorrowerRouterMock");
const BorrowerRouterRegistry = artifacts.require("BorrowerRouterRegistry");
const BorrowerRouterFactory = artifacts.require("BorrowerRouterFactory");

const { advanceBlockAtTime } = require("./helpers/ganacheTimeTraveler");
const { toBytes, fromBytes, deepCompareKeys, compareKeys } = require("./helpers/bytesCompareLibrary");
const Reverter = require("./helpers/reverter");
const { assert } = require("chai");

const setCurrentTime = advanceBlockAtTime;

const truffleAssert = require("truffle-assertions");

const { getInterestRateLibraryData } = require("../migrations/helpers/deployHelper");
const { toBN } = require("../scripts/globals");

contract("LiquidityPoolRegistry", async (accounts) => {
  const reverter = new Reverter(web3);

  const ADDRESS_NULL = "0x0000000000000000000000000000000000000000";

  const OWNER = accounts[0];
  const SOMEBODY = accounts[1];
  const USER1 = accounts[2];
  const USER2 = accounts[3];
  const NOTHING = accounts[8];
  const TEST_ASSET = accounts[9];

  const onePercent = toBN(10).pow(25);
  const decimal = onePercent.times(100);
  const colRatio = decimal.times("1.25");
  const oneToken = toBN(10).pow(18);
  const tokensAmount = oneToken.times(100000);
  const reserveFactor = onePercent.times("15");
  const priceDecimals = toBN(10).pow(8);
  const price = toBN(100);

  const firstSlope = onePercent.times(4);
  const secondSlope = decimal;
  const utilizationBreakingPoint = onePercent.times(80);
  const maxUR = onePercent.times(95);

  const liquidationDiscount = onePercent.times(8);

  const minSupplyDistributionPart = onePercent.times(15);
  const minBorrowDistributionPart = onePercent.times(10);

  let assetParameters;
  let defiCore;
  let registry;
  let rewardsDistribution;
  let priceManager;
  let liquidityPoolRegistry;

  const governanceTokenKey = toBytes("NDG");
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

    await assetParameters.setupInterestRateModel(assetKey, 0, firstSlope, secondSlope, utilizationBreakingPoint);
    await assetParameters.setupMaxUtilizationRatio(assetKey, maxUR);

    await assetParameters.setupDistributionsMinimums(assetKey, minSupplyDistributionPart, minBorrowDistributionPart);

    await assetParameters.setupLiquidationDiscount(assetKey, liquidationDiscount);

    await assetParameters.setupColRatio(assetKey, colRatio);
    await assetParameters.setupReserveFactor(assetKey, reserveFactor);

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

    await assetParameters.setupInterestRateModel(
      governanceTokenKey,
      0,
      firstSlope,
      secondSlope,
      utilizationBreakingPoint
    );
    await assetParameters.setupMaxUtilizationRatio(governanceTokenKey, maxUR);
    await assetParameters.setupDistributionsMinimums(
      governanceTokenKey,
      minSupplyDistributionPart,
      minBorrowDistributionPart
    );

    await assetParameters.setupColRatio(governanceTokenKey, colRatio);
    await assetParameters.setupReserveFactor(governanceTokenKey, reserveFactor);

    await priceManager.setPrice(governanceTokenKey, 10);

    await rewardsDistribution.setupRewardsPerBlockBatch([governanceTokenKey], [oneToken.times(2)]);
  }

  before("setup", async () => {
    const interestRateLibrary = await InterestRateLibrary.new(
      getInterestRateLibraryData("scripts/InterestRatesExactData.txt"),
      getInterestRateLibraryData("scripts/InterestRatesData.txt")
    );
    const governanceToken = await GovernanceToken.new(OWNER);

    registry = await Registry.new();
    const _defiCore = await DefiCore.new();
    const _systemParameters = await SystemParameters.new();
    const _assetParameters = await AssetParameters.new();
    const _liquidityPoolFactory = await LiquidityPoolFactory.new();
    const _rewardsDistribution = await RewardsDistribution.new();
    const _assetsRegistry = await AssetsRegistry.new();
    const _priceManager = await PriceManager.new();
    const _liquidityPoolAdmin = await LiquidityPoolAdmin.new();
    const _liquidityPoolImpl = await LiquidityPool.new();
    const _liquidityPoolRegistry = await LiquidityPoolRegistry.new();

    const _integrationCore = await IntegrationCore.new();
    const _borrowerRouterImpl = await BorrowerRouter.new();
    const _borrowerRouterFactory = await BorrowerRouterFactory.new();
    const _borrowerRouterRegistry = await BorrowerRouterRegistry.new();

    const daiToken = (await getTokens("DAI"))[0];

    await registry.addProxyContract(await registry.DEFI_CORE_NAME(), _defiCore.address);
    await registry.addProxyContract(await registry.ASSET_PARAMETERS_NAME(), _assetParameters.address);
    await registry.addProxyContract(await registry.SYSTEM_PARAMETERS_NAME(), _systemParameters.address);
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_FACTORY_NAME(), _liquidityPoolFactory.address);
    await registry.addProxyContract(await registry.REWARDS_DISTRIBUTION_NAME(), _rewardsDistribution.address);
    await registry.addProxyContract(await registry.PRICE_MANAGER_NAME(), _priceManager.address);
    await registry.addProxyContract(await registry.ASSETS_REGISTRY_NAME(), _assetsRegistry.address);
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_ADMIN_NAME(), _liquidityPoolAdmin.address);
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_REGISTRY_NAME(), _liquidityPoolRegistry.address);

    await registry.addProxyContract(await registry.INTEGRATION_CORE_NAME(), _integrationCore.address);
    await registry.addProxyContract(await registry.BORROWER_ROUTER_FACTORY_NAME(), _borrowerRouterFactory.address);
    await registry.addProxyContract(await registry.BORROWER_ROUTER_REGISTRY_NAME(), _borrowerRouterRegistry.address);

    await registry.addContract(await registry.INTEREST_RATE_LIBRARY_NAME(), interestRateLibrary.address);
    await registry.addContract(await registry.GOVERNANCE_TOKEN_NAME(), governanceToken.address);

    defiCore = await DefiCore.at(await registry.getDefiCoreContract());
    assetParameters = await AssetParameters.at(await registry.getAssetParametersContract());
    rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());
    priceManager = await PriceManager.at(await registry.getPriceManagerContract());
    liquidityPoolRegistry = await LiquidityPoolRegistry.at(await registry.getLiquidityPoolRegistryContract());

    const systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());
    const liquidityPoolAdmin = await LiquidityPoolAdmin.at(await registry.getLiquidityPoolAdminContract());
    const borrowerRouterRegistry = await BorrowerRouterRegistry.at(await registry.getBorrowerRouterRegistryContract());

    await registry.injectDependencies(await registry.DEFI_CORE_NAME());
    await registry.injectDependencies(await registry.ASSET_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_FACTORY_NAME());
    await registry.injectDependencies(await registry.REWARDS_DISTRIBUTION_NAME());
    await registry.injectDependencies(await registry.ASSETS_REGISTRY_NAME());
    await registry.injectDependencies(await registry.PRICE_MANAGER_NAME());
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_ADMIN_NAME());
    await registry.injectDependencies(await registry.LIQUIDITY_POOL_REGISTRY_NAME());
    await registry.injectDependencies(await registry.INTEGRATION_CORE_NAME());
    await registry.injectDependencies(await registry.BORROWER_ROUTER_FACTORY_NAME());
    await registry.injectDependencies(await registry.BORROWER_ROUTER_REGISTRY_NAME());

    await systemParameters.systemParametersInitialize();
    await liquidityPoolRegistry.liquidityPoolRegistryInitialize();
    await assetParameters.assetParametersInitialize();
    await rewardsDistribution.rewardsDistributionInitialize();
    await priceManager.priceManagerInitialize(daiKey, daiToken.address);
    await liquidityPoolAdmin.liquidityPoolAdminInitialize(_liquidityPoolImpl.address);
    await borrowerRouterRegistry.borrowerRouterRegistryInitialize(_borrowerRouterImpl.address);

    await deployGovernancePool(governanceToken.address, await governanceToken.symbol());

    await governanceToken.transfer(defiCore.address, tokensAmount.times(10));

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("getAllSupportedAssets", async () => {
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

  describe("getAllLiquidityPools", async () => {
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

  describe("getAllowForIntegrationAssets", async () => {
    beforeEach("setup", async () => {
      await assetParameters.setupAllowForIntegration(governanceTokenKey, true);
    });

    it("should return zero allow for integration assets", async () => {
      const result = await liquidityPoolRegistry.getAllowForIntegrationAssets();

      assert.equal(toBN(result[1]).toString(), 1);
      assert.isTrue(deepCompareKeys(result[0], [governanceTokenKey]));
    });

    it("should return correct allow for integration assets", async () => {
      const assetKey1 = toBytes("DAI");
      const assetKey2 = toBytes("WETH");
      const assetKey3 = toBytes("USDT");
      const assetKey4 = toBytes("USDC");

      let expectedList = [governanceTokenKey, assetKey1, assetKey2, assetKey3, assetKey4];

      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, assetKey1, NOTHING, NOTHING, "DAI", false);
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, assetKey2, NOTHING, NOTHING, "WETH", false);
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, assetKey3, NOTHING, NOTHING, "USDT", false);
      await liquidityPoolRegistry.addLiquidityPool(TEST_ASSET, assetKey4, NOTHING, NOTHING, "USDC", false);

      await assetParameters.setupAllowForIntegration(assetKey1, true);
      await assetParameters.setupAllowForIntegration(assetKey2, true);
      await assetParameters.setupAllowForIntegration(assetKey3, true);
      await assetParameters.setupAllowForIntegration(assetKey4, true);

      let result = await liquidityPoolRegistry.getAllowForIntegrationAssets();

      assert.equal(toBN(result[1]).toString(), 5);
      assert.isTrue(deepCompareKeys(result[0], expectedList));

      await assetParameters.setupAllowForIntegration(assetKey2, false);
      await assetParameters.setupAllowForIntegration(assetKey3, false);

      expectedList = [governanceTokenKey, assetKey1, assetKey4];

      result = await liquidityPoolRegistry.getAllowForIntegrationAssets();

      assert.equal(toBN(result[1]).toString(), 3);

      for (let i = 0; i < result[1]; i++) {
        assert.isTrue(compareKeys(result[0][i], expectedList[i]));
      }
    });
  });

  describe("addLiquidityPool", async () => {
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

  describe("withdrawAllReservedFunds/withdrawReservedFunds", async () => {
    const firstKey = toBytes("FIRST_KEY");
    const secondKey = toBytes("SECOND_KEY");
    const thirdKey = toBytes("THIRD_KEY");
    const symbols = ["FIRST", "SECOND", "THIRD"];
    const keys = [firstKey, secondKey, thirdKey];
    const RECIPIENT = accounts[4];

    const tokens = [];
    const liquidityPools = [];
    const reservedAmounts = [];

    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(60);
    const startTime = toBN(10000);

    beforeEach("setup", async () => {
      for (let i = 0; i < keys.length; i++) {
        await setCurrentTime(startTime);
        tokens.push(await createLiquidityPool(keys[i], symbols[i], true));

        const currentLiquidityPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(keys[i]));
        liquidityPools.push(currentLiquidityPool);

        await defiCore.addLiquidity(keys[i], liquidityAmount.times(i + 1), { from: USER1 });
        await defiCore.borrow(keys[i], borrowAmount.times(i + 1), { from: USER1 });

        await setCurrentTime(startTime.times(1000));
        await currentLiquidityPool.updateCompoundRate();

        await defiCore.repayBorrow(keys[i], borrowAmount.times(i + 3), true, { from: USER1 });

        reservedAmounts.push(toBN(await currentLiquidityPool.totalReserves()));
      }
    });

    it("should correctly withdraw all funds from all liquidity pools", async () => {
      await liquidityPoolRegistry.withdrawAllReservedFunds(RECIPIENT, 0, 10);

      for (let i = 0; i < keys.length; i++) {
        assert.equal(reservedAmounts[i].toString(), toBN(await tokens[i].balanceOf(RECIPIENT)).toString());
      }
    });

    it("should correctly withdraw reserved funds from specific liquidity pool", async () => {
      const amountToWithdraw = reservedAmounts[1].idiv(2);

      await liquidityPoolRegistry.withdrawReservedFunds(RECIPIENT, keys[1], amountToWithdraw, false);

      assert.equal(amountToWithdraw.toString(), toBN(await tokens[1].balanceOf(RECIPIENT)).toString());
    });

    it("should get exception if the asset doesn't exist", async () => {
      const reason = "LiquidityPoolRegistry: Pool doesn't exist.";

      await truffleAssert.reverts(
        liquidityPoolRegistry.withdrawReservedFunds(RECIPIENT, toBytes("SOME_KEY"), 1000, false),
        reason
      );
    });
  });

  describe("getLiquidityPoolsInfo", async () => {
    const firstKey = toBytes("FIRST_KEY");
    const secondKey = toBytes("SECOND_KEY");
    const thirdKey = toBytes("THIRD_KEY");
    const symbols = ["FIRST", "SECOND", "THIRD"];
    const keys = [firstKey, secondKey, thirdKey];

    const tokens = [];
    const liquidityPools = [];

    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(60);
    const startTime = toBN(10000);

    beforeEach("setup", async () => {
      for (let i = 0; i < keys.length; i++) {
        await setCurrentTime(startTime);
        tokens.push(await createLiquidityPool(keys[i], symbols[i], true));

        const currentLiquidityPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(keys[i]));
        liquidityPools.push(currentLiquidityPool);

        await defiCore.addLiquidity(keys[i], liquidityAmount.times(i + 1), { from: USER1 });
        await defiCore.borrow(keys[i], borrowAmount.times(i + 1), { from: USER1 });
      }
    });

    it("should return correct data", async () => {
      const liquidityPoolsInfo = await liquidityPoolRegistry.getLiquidityPoolsInfo(0, 10);

      for (let i = 1; i < liquidityPoolsInfo.length; i++) {
        const currentInfo = liquidityPoolsInfo[i];

        assert.isTrue(compareKeys(currentInfo.assetKey, keys[i - 1]));

        assert.equal(currentInfo.assetAddr, tokens[i - 1].address);

        const totalPoolLiquidity = liquidityAmount.times(i);
        assert.equal(toBN(currentInfo.marketSize).toString(), totalPoolLiquidity.toString());
        assert.equal(
          toBN(currentInfo.marketSizeInUsd).toString(),
          toBN(await liquidityPools[i - 1].getAmountInUSD(totalPoolLiquidity)).toString()
        );

        const totalBorrowedAmount = borrowAmount.times(i);
        assert.equal(toBN(currentInfo.totalBorrowBalance).toString(), totalBorrowedAmount.toString());
        assert.equal(
          toBN(currentInfo.totalBorrowBalanceInUsd).toString(),
          toBN(await liquidityPools[i - 1].getAmountInUSD(totalBorrowedAmount)).toString()
        );

        const expectedSupplyAPY = onePercent.times(1.53);
        const expectedBorrowAPY = onePercent.times(3);

        assert.equal(toBN(currentInfo.apyInfo.supplyAPY).toString(), expectedSupplyAPY.toString());
        assert.equal(toBN(currentInfo.apyInfo.borrowAPY).toString(), expectedBorrowAPY.toString());
      }
    });
  });

  describe("getDetailedLiquidityPoolInfo", async () => {
    const symbols = ["FIRST", "SECOND", "THIRD"];
    const keys = [toBytes("FIRST_KEY"), toBytes("SECOND_KEY"), toBytes("THIRD_KEY")];

    const liquidityAmount = oneToken.times(100);
    const borrowAmount = oneToken.times(60);
    const pricePerToken = price.times(priceDecimals);

    beforeEach("setup", async () => {
      for (let i = 0; i < keys.length; i++) {
        await createLiquidityPool(keys[i], symbols[i], true);

        await defiCore.addLiquidity(keys[i], liquidityAmount.times(i + 1), { from: USER1 });
        await defiCore.borrow(keys[i], borrowAmount.times(i + 1), { from: USER1 });
      }
    });

    it("should return correct detailed info", async () => {
      for (let i = 0; i < keys.length; i++) {
        const detailedInfo = await liquidityPoolRegistry.getDetailedLiquidityPoolInfo(keys[i]);

        const totalBorrowedAmount = borrowAmount.times(i + 1);
        const availableLiquidity = liquidityAmount
          .times(i + 1)
          .times(maxUR)
          .idiv(decimal)
          .minus(totalBorrowedAmount)
          .idiv(oneToken)
          .times(pricePerToken);

        assert.equal(
          toBN(detailedInfo.totalBorrowed).toString(),
          totalBorrowedAmount.idiv(oneToken).times(pricePerToken).toString()
        );

        assert.equal(toBN(detailedInfo.availableLiquidity).toString(), availableLiquidity.toString());
        assert.equal(toBN(detailedInfo.utilizationRatio).toString(), onePercent.times(60).toString());

        assert.equal(toBN(detailedInfo.liquidityPoolParams.collateralizationRatio).toString(), colRatio.toString());
        assert.equal(toBN(detailedInfo.liquidityPoolParams.reserveFactor).toString(), reserveFactor.toString());
        assert.equal(
          toBN(detailedInfo.liquidityPoolParams.liquidationDiscount).toString(),
          liquidationDiscount.toString()
        );
        assert.equal(toBN(detailedInfo.liquidityPoolParams.maxUtilizationRatio).toString(), maxUR.toString());
        assert.equal(detailedInfo.liquidityPoolParams.isAvailableAsCollateral, true);

        const expectedSupplyAPY = onePercent.times(1.53);
        const expectedBorrowAPY = onePercent.times(3);

        assert.equal(toBN(detailedInfo.apyInfo.supplyAPY).toString(), expectedSupplyAPY.toString());
        assert.equal(toBN(detailedInfo.apyInfo.borrowAPY).toString(), expectedBorrowAPY.toString());
      }
    });
  });

  describe("getTotalMarketsSize", async () => {
    const liquidityAmount = oneToken.times(100);

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
