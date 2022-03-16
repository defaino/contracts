const { setNextBlockTime, mine, getCurrentBlockNumber } = require("./helpers/hardhatTimeTraveller");
const { toBytes, deepCompareKeys } = require("./helpers/bytesCompareLibrary");
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

MockERC20.numberFormat = "BigNumber";
DefiCore.numberFormat = "BigNumber";
LiquidityPool.numberFormat = "BigNumber";

describe("LiquidityPool", () => {
  const reverter = new Reverter();

  const ADDRESS_NULL = "0x0000000000000000000000000000000000000000";

  let OWNER;
  let USER1;
  let USER2;
  let NOTHING;

  let registry;
  let assetParameters;
  let liquidityPool;
  let defiCore;
  let rewardsDistribution;
  let userInfoRegistry;
  let priceManager;
  let liquidityPoolRegistry;

  let tokenChainlinkOracle;

  const standardColRatio = getDecimal().times("1.25");
  const oneToken = toBN(10).pow(18);
  const tokensAmount = wei(100000);
  const reserveFactor = getOnePercent().times("15");
  const liquidationDiscount = getOnePercent().times(8);
  const liquidationBoundary = getOnePercent().times(50);

  const firstSlope = getOnePercent().times(4);
  const secondSlope = getDecimal();
  const utilizationBreakingPoint = getOnePercent().times(80);
  const maxUR = getOnePercent().times(95);

  const priceDecimals = toBN(10).pow(8);
  const chainlinkPriceDecimals = toBN(8);

  const minSupplyDistributionPart = getOnePercent().times(15);
  const minBorrowDistributionPart = getOnePercent().times(10);

  let tokens = [];

  const tokenKey = toBytes("Token");
  const batKey = toBytes("BAT");
  const governanceTokenKey = toBytes("GTK");

  function getNormalizedAmount(
    normalizedAmount,
    additionalAmount,
    currentRate,
    isAdding,
    amountWithoutInterest = oneToken
  ) {
    if (isAdding || toBN(amountWithoutInterest).toNumber() != 0) {
      const normalizedAdditionalAmount = additionalAmount.times(getDecimal()).idiv(currentRate);

      return isAdding
        ? normalizedAmount.plus(normalizedAdditionalAmount)
        : normalizedAmount.minus(normalizedAdditionalAmount);
    }

    return 0;
  }

  function exchangeRate(liquidityAmount, totalSupply, normBorrowedAmount, aggreagatedBorrowedAmount, currentRate) {
    if (totalSupply.eq(0)) {
      return getDecimal();
    }

    const absoluteBorrowAmount = normBorrowedAmount.times(currentRate).idiv(getDecimal());
    const borrowInterest = absoluteBorrowAmount
      .minus(aggreagatedBorrowedAmount)
      .times(getDecimal().minus(reserveFactor))
      .idiv(getDecimal());

    return borrowInterest.plus(liquidityAmount).plus(aggreagatedBorrowedAmount).times(getDecimal()).idiv(totalSupply);
  }

  async function deployTokens(symbols) {
    for (let i = 0; i < symbols.length; i++) {
      const token = await MockERC20.new("Mock" + symbols[i], symbols[i]);
      await token.mintArbitraryBatch([OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);

      tokens.push(token);
    }
  }

  async function getTokens(symbols) {
    const neededTokens = [];

    for (let i = 0; i < symbols.length; i++) {
      const token = await MockERC20.new("Mock" + symbols[i], symbols[i]);
      await token.mintArbitraryBatch([OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);

      neededTokens.push(token);
    }

    return neededTokens;
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
      [standardColRatio, reserveFactor, liquidationDiscount, maxUR],
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
      [standardColRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);

    await priceManager.setPrice(governanceTokenKey, 10);
  }

  before("setup", async () => {
    OWNER = await accounts(0);
    USER1 = await accounts(1);
    USER2 = await accounts(2);
    NOTHING = await accounts(9);

    const governanceToken = await GovernanceToken.new(OWNER);
    const interestRateLibrary = await InterestRateLibrary.new(
      getInterestRateLibraryData("deploy/data/InterestRatesExactData.txt")
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

    await deployTokens([await governanceToken.symbol(), "DAI", "BAT"]);

    await systemParameters.systemParametersInitialize();
    await assetParameters.assetParametersInitialize();
    await rewardsDistribution.rewardsDistributionInitialize();
    await liquidityPoolRegistry.liquidityPoolRegistryInitialize(_liquidityPoolImpl.address);
    await priceManager.priceManagerInitialize(tokenKey, tokens[1].address);

    await interestRateLibrary.addNewRates(
      110, // Start percentage
      getInterestRateLibraryData("deploy/data/InterestRatesData.txt")
    );

    await deployGovernancePool(governanceToken.address, await governanceToken.symbol());

    tokenChainlinkOracle = await createLiquidityPool(tokenKey, tokens[1], "DAI", true);
    await createLiquidityPool(batKey, tokens[2], "BAT", true);

    liquidityPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(tokenKey));
    batPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(batKey));

    await rewardsDistribution.setupRewardsPerBlockBatch([governanceTokenKey, tokenKey], [wei(2), oneToken]);

    await systemParameters.setupLiquidationBoundary(liquidationBoundary);

    await governanceToken.transfer(defiCore.address, tokensAmount.times(10));

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("updateCompoundRate", () => {
    const neededTime = toBN(10000000);
    const liquidityAmount = wei(100);
    const borrowAmount = wei(55);

    before("setup", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });

      await defiCore.borrowFor(tokenKey, borrowAmount, USER1, { from: USER1 });
    });

    it("shouldn't update compound rate if enough time hasn't passed", async () => {
      await setNextBlockTime(neededTime.toNumber());

      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });

      const currentRate = await liquidityPool.getCurrentRate();

      assert.isTrue(currentRate.gt(getDecimal()));

      await setNextBlockTime(neededTime.plus(1000).toNumber());

      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });

      assert.equal(toBN(await liquidityPool.getCurrentRate()).toString(), currentRate.toString());
    });
  });

  describe("addLiqudity", () => {
    const liquidityAmount = wei(100);
    const amountToBorrow = wei(50);
    const neededTime = toBN(100000);

    it("should correctly add liquidity to the pool", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER2 });

      assert.equal(toBN(await liquidityPool.balanceOf(USER1)).toString(), liquidityAmount.toString());

      assert.equal(toBN(await tokens[1].balanceOf(USER1)).toString(), tokensAmount.minus(liquidityAmount).toString());
      assert.equal(
        toBN(await tokens[1].balanceOf(liquidityPool.address)).toString(),
        liquidityAmount.times(2).toString()
      );

      assert.equal(
        toBN(await liquidityPool.getAggregatedLiquidityAmount()).toString(),
        liquidityAmount.times(2).toString()
      );
    });

    it("should correctly mint tokens according to exchange rate", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });

      assert.equal((await liquidityPool.balanceOf(USER1)).toString(), liquidityAmount.toString());
      assert.equal((await tokens[1].balanceOf(USER1)).toString(), tokensAmount.minus(liquidityAmount).toString());

      await defiCore.borrowFor(tokenKey, amountToBorrow, USER1, { from: USER1 });

      await setNextBlockTime(neededTime.toNumber());
      await liquidityPool.updateCompoundRate(false);

      assert.isTrue((await liquidityPool.exchangeRate()).gt(getDecimal()));

      const expectedBalance = liquidityAmount.times(getDecimal()).idiv(await liquidityPool.exchangeRate());
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER2 });

      assert.equal((await liquidityPool.balanceOf(USER2)).toString(), expectedBalance.toString());
    });

    it("should get exception if the user does not have enough tokens", async () => {
      const reason = "LiquidityPool: Not enough tokens on account.";
      await truffleAssert.reverts(defiCore.addLiquidity(tokenKey, tokensAmount.plus(100), { from: USER1 }), reason);
    });

    it("should correctly add liquidity to current block", async () => {
      await setNextBlockTime(neededTime.toNumber());

      const testBlock = await getCurrentBlockNumber();
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });

      assert.equal((await liquidityPool.lastLiquidity(USER1, testBlock + 1)).toString(), liquidityAmount.toString());

      await mine(500);

      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });

      assert.equal(
        (await liquidityPool.lastLiquidity(USER1, testBlock + 500 + 2)).toString(),
        liquidityAmount.toString()
      );
    });
  });

  describe("getAmountInUSD", () => {
    const price = toBN(134);
    let amount = wei(120);

    beforeEach("setup", async () => {
      await tokenChainlinkOracle.setPrice(price.times(priceDecimals));
    });

    it("should return correct amount with default decimals and amount > 0", async () => {
      assert.equal(
        toBN(await liquidityPool.getAmountInUSD(amount)).toString(),
        amount.times(price).times(priceDecimals).idiv(oneToken).toString()
      );
    });

    it("should return correct amount with default decimals and amount = 0", async () => {
      assert.equal(await liquidityPool.getAmountInUSD(0), 0);
    });

    it("should return correct amount with 8 decimals and amount > 0", async () => {
      const decimals = 8;
      await tokens[1].setDecimals(decimals);

      assert.equal(await tokens[1].decimals(), decimals);

      assert.equal(
        toBN(await liquidityPool.getAmountInUSD(amount)).toString(),
        amount.times(price).times(priceDecimals).idiv(oneToken).toString()
      );
    });
  });

  describe("getNormalizedAmount", () => {
    const someKey = toBytes("SOME_KEY");
    let liquidityPoolMock;
    let normalizedAmount = wei(100);
    let additionalAmount = wei(50);
    let compoundRate = getDecimal();

    beforeEach("setup", async () => {
      liquidityPoolMock = await LiquidityPoolMock.new(registry.address, NOTHING, someKey, "MOCK");

      await priceManager.setPrice(someKey, 100);
    });

    it("should return correct values if CR = 0", async () => {
      let result = toBN(
        await liquidityPoolMock.getNormalizedAmount(0, normalizedAmount, additionalAmount, compoundRate, true)
      );

      assert.equal(result.toString(), normalizedAmount.plus(additionalAmount).toString());

      result = toBN(
        await liquidityPoolMock.getNormalizedAmount(oneToken, normalizedAmount, additionalAmount, compoundRate, false)
      );

      assert.equal(result.toString(), normalizedAmount.minus(additionalAmount).toString());
    });

    it("should return correct values if CR != 0", async () => {
      compoundRate = getDecimal().times("1.2");

      let result = toBN(
        await liquidityPoolMock.getNormalizedAmount(0, normalizedAmount, additionalAmount, compoundRate, true)
      );
      let expectedAmount = getNormalizedAmount(normalizedAmount, additionalAmount, compoundRate, true);

      assert.equal(result.toString(), expectedAmount.toString());

      result = toBN(
        await liquidityPoolMock.getNormalizedAmount(oneToken, normalizedAmount, additionalAmount, compoundRate, false)
      );

      expectedAmount = getNormalizedAmount(normalizedAmount, additionalAmount, compoundRate, false);

      assert.equal(result.toString(), expectedAmount.toString());
    });

    it("should return correct values if CR != 0 and additional amount equal to absolute amount", async () => {
      normalizedAmount = wei(100);
      additionalAmount = wei(150);
      compoundRate = getDecimal().times("1.5");

      const result = toBN(
        await liquidityPoolMock.getNormalizedAmount(0, normalizedAmount, additionalAmount, compoundRate, false)
      );
      assert.equal(result.toString(), 0);
    });

    it("should return correct values if CR != 0 and normalized amount equal to zero", async () => {
      normalizedAmount = toBN(0);
      additionalAmount = wei(150);
      compoundRate = getDecimal().times("1.5");

      const result = toBN(
        await liquidityPoolMock.getNormalizedAmount(0, normalizedAmount, additionalAmount, compoundRate, true)
      );
      assert.equal(result.toString(), wei(100).toString());
    });
  });

  describe("withdrawLiquidity", () => {
    const liquidityAmount = wei(100);
    const amountToWithdraw = wei(50);
    const amountToBorrow = wei(25);
    const neededTime = toBN(100000);
    const withdrawTime = neededTime.times(2);

    beforeEach("setup", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER2 });

      assert.equal(
        toBN(await tokens[1].balanceOf(liquidityPool.address)).toString(),
        liquidityAmount.times(2).toString()
      );
      assert.equal(
        toBN(await liquidityPool.getAggregatedLiquidityAmount()).toString(),
        liquidityAmount.times(2).toString()
      );
    });

    it("should correctly withdraw liquidity from the pool", async () => {
      await setNextBlockTime(withdrawTime.toNumber());
      await defiCore.withdrawLiquidity(tokenKey, amountToWithdraw, false, { from: USER1 });

      assert.equal(
        (await liquidityPool.balanceOf(USER1)).toString(),
        liquidityAmount.minus(amountToWithdraw).toString()
      );

      assert.equal(
        (await tokens[1].balanceOf(USER1)).toString(),
        tokensAmount.minus(liquidityAmount).plus(amountToWithdraw).toString()
      );
      assert.equal(
        (await tokens[1].balanceOf(liquidityPool.address)).toString(),
        liquidityAmount.times(2).minus(amountToWithdraw).toString()
      );

      assert.equal(
        (await liquidityPool.getAggregatedLiquidityAmount()).toString(),
        liquidityAmount.times(2).minus(amountToWithdraw).toString()
      );
    });

    it("should correctly burn tokens according to exchange rate", async () => {
      const newTokens = await getTokens(["SOME_KEY"]);
      const someKey = toBytes("SOME_KEY");
      await createLiquidityPool(someKey, newTokens[0], "SOME_KEY", true);

      await defiCore.addLiquidity(someKey, liquidityAmount, { from: OWNER });

      await defiCore.borrowFor(tokenKey, amountToBorrow, OWNER, { from: OWNER });

      await setNextBlockTime(neededTime.toNumber());
      await liquidityPool.updateCompoundRate(false);

      assert.isTrue(toBN(await liquidityPool.exchangeRate()).gt(getDecimal()));

      const expectedBurnAmount = toBN(amountToWithdraw)
        .times(getDecimal())
        .idiv(await liquidityPool.exchangeRate());

      await defiCore.withdrawLiquidity(tokenKey, amountToWithdraw, false, { from: USER1 });

      assert.equal(
        (await liquidityPool.balanceOf(USER1)).toString(),
        liquidityAmount.minus(expectedBurnAmount).toString()
      );
      assert.equal(
        (await tokens[1].balanceOf(USER1)).toString(),
        tokensAmount.minus(liquidityAmount).plus(amountToWithdraw).toString()
      );
    });

    it("should get exception if the user tries to withdraw the last free money from the contract", async () => {
      const newTokens = await getTokens(["SOME_KEY"]);
      const someKey = toBytes("SOME_KEY");
      await createLiquidityPool(someKey, newTokens[0], "SOME_KEY", true);

      const somePool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(someKey));

      await setNextBlockTime(neededTime.toNumber());
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(someKey, liquidityAmount, { from: USER2 });

      const borrowAmount = wei(90);
      await defiCore.borrowFor(someKey, borrowAmount, USER1, { from: USER1 });

      assert.equal(toBN(await somePool.getBorrowPercentage()).toString(), getOnePercent().times(90).toString());

      await setNextBlockTime(withdrawTime.toNumber());
      const reason = "LiquidityPool: Utilization ratio after withdraw cannot be greater than the maximum.";
      await truffleAssert.reverts(defiCore.withdrawLiquidity(someKey, wei(8), false, { from: USER2 }), reason);
    });

    it("should get exception if not enough available liquidity on the contract", async () => {
      const newTokens = await getTokens(["TMP_TOK"]);
      const tmpTokenKey = toBytes("TMP_TOK");
      await createLiquidityPool(tmpTokenKey, newTokens[0], "TMP_TOK", true);

      await assetParameters.setupDistributionsMinimums(tmpTokenKey, [
        minSupplyDistributionPart,
        minBorrowDistributionPart,
      ]);
      await priceManager.setPrice(tmpTokenKey, 100);

      await setNextBlockTime(neededTime.toNumber());

      await defiCore.addLiquidity(tmpTokenKey, liquidityAmount.times(5), { from: USER1 });

      const reason = "LiquidityPool: Not enough liquidity available on the contract.";

      await setNextBlockTime(withdrawTime.toNumber());
      await truffleAssert.reverts(
        defiCore.withdrawLiquidity(tokenKey, liquidityAmount.times(3), false, { from: USER1 }),
        reason
      );
    });

    it("should get exception if the user does not have enough liquidity", async () => {
      await setNextBlockTime(neededTime.toNumber());
      await defiCore.disableCollateral(tokenKey, { from: USER1 });

      await setNextBlockTime(withdrawTime.toNumber());
      const reason = "LiquidityPool: Not enough lpTokens to withdraw liquidity.";
      await truffleAssert.reverts(
        defiCore.withdrawLiquidity(tokenKey, liquidityAmount.plus(100), false, { from: USER1 }),
        reason
      );
    });
  });

  describe("exchangeRate", () => {
    const liquidityAmount = wei(200);
    const amountToBorrow = wei(50);
    const startTime = toBN(100000);

    beforeEach("setup", async () => {
      await setNextBlockTime(startTime.toNumber());

      await liquidityPool.updateCompoundRate(false);
    });

    it("should return DECIMAL if total supply = 0", async () => {
      assert.equal(toBN(await liquidityPool.exchangeRate()).toString(), getDecimal().toString());
    });

    it("should return correct exchange rate if borrowed amount = 0", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });

      assert.equal(
        toBN(await liquidityPool.exchangeRate()).toString(),
        exchangeRate(liquidityAmount, liquidityAmount, toBN(0), toBN(0), getDecimal()).toString()
      );
    });

    it("should return correct exchange rate if current rate greater than getDecimal()", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER2 });

      await defiCore.borrowFor(tokenKey, amountToBorrow, USER1, { from: USER1 });

      await setNextBlockTime(startTime.times(100).toNumber());
      await liquidityPool.updateCompoundRate(false);

      const totalSupply = await liquidityPool.totalSupply();
      const getAggregatedLiquidityAmount = await liquidityPool.getAggregatedLiquidityAmount();
      const aggregatedNormalizedAmount = await liquidityPool.aggregatedNormalizedBorrowedAmount();
      const aggreagatedBorrowedAmount = await liquidityPool.aggregatedBorrowedAmount();
      const currentRate = await liquidityPool.getCurrentRate();

      assert.equal(
        (await liquidityPool.exchangeRate()).toString(),
        exchangeRate(
          getAggregatedLiquidityAmount,
          totalSupply,
          aggregatedNormalizedAmount,
          aggreagatedBorrowedAmount,
          currentRate
        ).toString()
      );
    });

    it("should return correct exchange rate if total reserves greater than zero", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER2 });

      await defiCore.borrowFor(tokenKey, amountToBorrow, USER1, { from: USER1 });

      await setNextBlockTime(startTime.times(100).toNumber());
      await liquidityPool.updateCompoundRate(false);

      assert.equal(
        (await defiCore.getUserLiquidityAmount(USER1, tokenKey)).toString(),
        (await defiCore.getUserLiquidityAmount(USER2, tokenKey)).toString()
      );

      await defiCore.repayBorrow(tokenKey, amountToBorrow.times(2), true, { from: USER1 });

      const expectedContractBalance = (await defiCore.getUserLiquidityAmount(USER1, tokenKey))
        .plus(await defiCore.getUserLiquidityAmount(USER2, tokenKey))
        .plus(await liquidityPool.totalReserves());
      assert.closeTo(
        (await tokens[1].balanceOf(liquidityPool.address)).toNumber(),
        expectedContractBalance.toNumber(),
        10
      );
    });
  });

  describe("borrow", () => {
    const liquidityAmount = wei(200);
    const amountToBorrow = wei(50);
    const startTime = toBN(100000);
    const someKey = toBytes("SOME_KEY");

    beforeEach("setup", async () => {
      await setNextBlockTime(startTime.toNumber());

      const newTokens = await getTokens(["SOME_KEY"]);
      await createLiquidityPool(someKey, newTokens[0], "SOME_KEY", true);

      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER2 });
      await defiCore.addLiquidity(someKey, liquidityAmount.times(6), { from: USER2 });

      assert.equal((await tokens[1].balanceOf(liquidityPool.address)).toString(), liquidityAmount.times(2).toString());
      assert.equal(
        (await liquidityPool.getAggregatedLiquidityAmount()).toString(),
        liquidityAmount.times(2).toString()
      );

      await liquidityPool.updateCompoundRate(false);
    });

    it("should not fail", async () => {
      await defiCore.borrowFor(tokenKey, liquidityAmount, USER2, { from: USER2 });

      await setNextBlockTime(startTime.times(100).toNumber());

      await defiCore.borrowFor(tokenKey, liquidityAmount.times(0.9), USER2, { from: USER2 });

      assert.equal(toBN(await liquidityPool.getBorrowPercentage()).toString(), getOnePercent().times(95).toString());
    });

    it("should correctly borrow tokens if normalizedAmount equal to zero", async () => {
      await defiCore.borrowFor(tokenKey, amountToBorrow, USER1, { from: USER1 });

      assert.equal(
        (await tokens[1].balanceOf(USER1)).toString(),
        tokensAmount.minus(liquidityAmount).plus(amountToBorrow).toString()
      );
      assert.equal(
        (await liquidityPool.getAggregatedLiquidityAmount()).toString(),
        liquidityAmount.times(2).minus(amountToBorrow).toString()
      );

      const currentRate = await liquidityPool.getCurrentRate();
      const expectedNormalizedAmount = getNormalizedAmount(toBN(0), amountToBorrow, currentRate, true);

      assert.equal((await liquidityPool.borrowInfos(USER1)).borrowAmount.toString(), amountToBorrow.toString());
      assert.equal(
        (await liquidityPool.borrowInfos(USER1)).normalizedAmount.toString(),
        expectedNormalizedAmount.toString()
      );
      assert.equal((await liquidityPool.aggregatedBorrowedAmount()).toString(), amountToBorrow.toString());
      assert.equal(
        (await liquidityPool.aggregatedNormalizedBorrowedAmount()).toString(),
        expectedNormalizedAmount.toString()
      );
    });

    it("should correctly borrow tokens if normalizedAmount not equal to zero", async () => {
      await defiCore.borrowFor(tokenKey, amountToBorrow, USER1, { from: USER1 });

      let currentRate = await liquidityPool.getCurrentRate();
      let expectedNormalizedAmount = getNormalizedAmount(toBN(0), amountToBorrow, currentRate, true);

      await setNextBlockTime(startTime.times(100).toNumber());

      await defiCore.borrowFor(tokenKey, amountToBorrow.times(2), USER1, { from: USER1 });

      const totalBorrowedAmount = amountToBorrow.times(3);
      assert.equal(
        (await tokens[1].balanceOf(USER1)).toString(),
        tokensAmount.minus(liquidityAmount).plus(totalBorrowedAmount).toString()
      );
      assert.equal(
        (await liquidityPool.getAggregatedLiquidityAmount()).toString(),
        liquidityAmount.times(2).minus(totalBorrowedAmount).toString()
      );

      currentRate = await liquidityPool.getCurrentRate();
      expectedNormalizedAmount = getNormalizedAmount(
        expectedNormalizedAmount,
        amountToBorrow.times(2),
        currentRate,
        true
      );

      assert.equal((await liquidityPool.borrowInfos(USER1)).borrowAmount.toString(), totalBorrowedAmount.toString());
      assert.equal(
        (await liquidityPool.borrowInfos(USER1)).normalizedAmount.toString(),
        expectedNormalizedAmount.toString()
      );
      assert.equal(
        (await liquidityPool.aggregatedNormalizedBorrowedAmount()).toString(),
        expectedNormalizedAmount.toString()
      );
      assert.equal((await liquidityPool.aggregatedBorrowedAmount()).toString(), totalBorrowedAmount.toString());
    });

    it("should correctly update aggregated normalized borrowed amount", async () => {
      await defiCore.borrowFor(tokenKey, amountToBorrow, USER1, { from: USER1 });

      let currentRate = toBN(await liquidityPool.getCurrentRate());
      let expectedAggregatedNormalizedAmount = getNormalizedAmount(toBN(0), amountToBorrow, currentRate, true);

      assert.equal(
        toBN(await liquidityPool.aggregatedNormalizedBorrowedAmount()).toString(),
        expectedAggregatedNormalizedAmount.toString()
      );

      await setNextBlockTime(startTime.times(10).toNumber());
      await defiCore.borrowFor(tokenKey, amountToBorrow.times(2), USER2, { from: USER2 });

      currentRate = await liquidityPool.getCurrentRate();
      expectedAggregatedNormalizedAmount = getNormalizedAmount(
        expectedAggregatedNormalizedAmount,
        amountToBorrow.times(2),
        currentRate,
        true
      );

      assert.equal(
        (await liquidityPool.aggregatedNormalizedBorrowedAmount()).toString(),
        expectedAggregatedNormalizedAmount.toString()
      );

      await setNextBlockTime(startTime.times(1000).toNumber());
      await defiCore.borrowFor(tokenKey, amountToBorrow.times(3), USER2, { from: USER2 });

      currentRate = await liquidityPool.getCurrentRate();
      expectedAggregatedNormalizedAmount = getNormalizedAmount(
        expectedAggregatedNormalizedAmount,
        amountToBorrow.times(3),
        currentRate,
        true
      );

      assert.equal(
        (await liquidityPool.aggregatedNormalizedBorrowedAmount()).toString(),
        expectedAggregatedNormalizedAmount.toString()
      );

      const totalBorrowedAmount = amountToBorrow.times(6);
      assert.equal(
        (await liquidityPool.getAggregatedLiquidityAmount()).toString(),
        liquidityAmount.times(2).minus(totalBorrowedAmount).toString()
      );

      assert.equal((await liquidityPool.aggregatedBorrowedAmount()).toString(), totalBorrowedAmount.toString());
    });

    it("should get exception if the user tries to borrow an amount above the limit", async () => {
      await defiCore.addLiquidity(someKey, liquidityAmount.times(2), { from: USER1 });
      await defiCore.borrowFor(tokenKey, amountToBorrow.times(7), USER1, { from: USER1 });

      const reason = "LiquidityPool: Utilization ratio after borrow cannot be greater than the maximum.";
      await truffleAssert.reverts(
        defiCore.borrowFor(tokenKey, amountToBorrow.minus(10000), USER2, { from: USER2 }),
        reason
      );
    });

    it("should get exception if available amount to borrow less than borrow amount", async () => {
      await defiCore.addLiquidity(someKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(tokenKey, amountToBorrow.times(3), USER2, { from: USER2 });

      const reason = "LiquidityPool: Not enough available to borrow amount.";
      await truffleAssert.reverts(
        defiCore.borrowFor(tokenKey, amountToBorrow.times(6), USER1, { from: USER1 }),
        reason
      );
    });
  });

  describe("repayBorrow", () => {
    const liquidityAmount = wei(100);
    const amountToBorrow = wei(50);
    const amountToRepay = wei(25);
    const startTime = toBN(100000);
    let USER3;

    beforeEach("setup", async () => {
      USER3 = await accounts(4);

      await setNextBlockTime(startTime.toNumber());

      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER2 });

      assert.equal((await tokens[1].balanceOf(liquidityPool.address)).toString(), liquidityAmount.times(2).toString());
      assert.equal(
        (await liquidityPool.getAggregatedLiquidityAmount()).toString(),
        liquidityAmount.times(2).toString()
      );

      await tokens[1].approve(liquidityPool.address, liquidityAmount, { from: USER3 });
      await liquidityPool.updateCompoundRate(false);
    });

    it("should correctly repay the entire borrow", async () => {
      await defiCore.borrowFor(tokenKey, amountToBorrow, USER1, { from: USER1 });

      await setNextBlockTime(startTime.times(100).toNumber());

      await liquidityPool.updateCompoundRate(false);
      await defiCore.repayBorrow(tokenKey, 0, true, { from: USER1 });

      assert.equal(toBN((await liquidityPool.borrowInfos(USER1)).borrowAmount).toString(), 0);
      assert.equal(toBN((await liquidityPool.borrowInfos(USER1)).normalizedAmount).toString(), 0);
      assert.equal(toBN(await liquidityPool.aggregatedBorrowedAmount()).toString(), 0);
      assert.equal(toBN(await liquidityPool.aggregatedNormalizedBorrowedAmount()).toString(), 0);
    });

    it("should correctly repay part of the borrow", async () => {
      await defiCore.borrowFor(tokenKey, amountToBorrow, USER1, { from: USER1 });

      let currentRate = await liquidityPool.getCurrentRate();
      let expectedNormalizedAmount = getNormalizedAmount(toBN(0), amountToBorrow, currentRate, true);

      await setNextBlockTime(startTime.times(100).toNumber());

      await liquidityPool.updateCompoundRate(false);

      const userBorrowedAmount = await defiCore.getUserBorrowedAmount(USER1, tokenKey);

      await defiCore.repayBorrow(tokenKey, amountToRepay, false, { from: USER1 });

      currentRate = await liquidityPool.getCurrentRate();
      expectedNormalizedAmount = getNormalizedAmount(expectedNormalizedAmount, amountToRepay, currentRate, false);

      assert.closeTo(
        (await liquidityPool.borrowInfos(USER1)).borrowAmount.toNumber(),
        userBorrowedAmount.minus(amountToRepay).toNumber(),
        oneToken.idiv(1000).toNumber()
      );
      assert.equal(
        (await liquidityPool.borrowInfos(USER1)).normalizedAmount.toString(),
        expectedNormalizedAmount.toString()
      );
      assert.equal(
        (await liquidityPool.aggregatedNormalizedBorrowedAmount()).toString(),
        expectedNormalizedAmount.toString()
      );
    });

    it("should correctly repay amount less than current interest", async () => {
      await defiCore.borrowFor(tokenKey, amountToBorrow, USER1, { from: USER1 });

      let currentRate = await liquidityPool.getCurrentRate();
      let expectedNormalizedAmount = getNormalizedAmount(toBN(0), amountToBorrow, currentRate, true);

      await setNextBlockTime(startTime.times(10000).toNumber());

      await liquidityPool.updateCompoundRate(false);

      const currentInterest = (await defiCore.getUserBorrowedAmount(USER1, tokenKey)).minus(amountToBorrow);

      const repayAmount = currentInterest.minus(100000);
      await defiCore.repayBorrow(tokenKey, repayAmount, false, { from: USER1 });

      currentRate = await liquidityPool.getCurrentRate();
      expectedNormalizedAmount = getNormalizedAmount(expectedNormalizedAmount, repayAmount, currentRate, false);

      assert.equal((await liquidityPool.borrowInfos(USER1)).borrowAmount.toString(), amountToBorrow.toString());
      assert.equal(
        (await liquidityPool.borrowInfos(USER1)).normalizedAmount.toString(),
        expectedNormalizedAmount.toString()
      );
      assert.equal(
        (await liquidityPool.aggregatedNormalizedBorrowedAmount()).toString(),
        expectedNormalizedAmount.toString()
      );

      const expectedReserveFunds = currentInterest.times(reserveFactor).idiv(getDecimal());

      assert.closeTo(
        (await liquidityPool.totalReserves()).toNumber(),
        expectedReserveFunds.toNumber(),
        oneToken.idiv(1000).toNumber()
      );
    });

    it("should get exception if the user did not borrow", async () => {
      const someAmount = toBN(1000);
      await defiCore.repayBorrow(tokenKey, someAmount, false, { from: USER1 });

      assert.equal((await liquidityPool.borrowInfos(USER1)).normalizedAmount.toString(), 0);

      const reason = "LiquidityPool: Repay amount cannot be a zero.";
      await truffleAssert.reverts(defiCore.repayBorrow(tokenKey, 0, true, { from: USER3 }), reason);
    });

    it("should get exception if user does not have tokens on his balance", async () => {
      await liquidityPool.transfer(USER3, liquidityAmount, { from: USER1 });

      assert.equal((await defiCore.getUserLiquidityAmount(USER3, tokenKey)).toString(), liquidityAmount.toString());

      await defiCore.borrowFor(tokenKey, amountToBorrow, USER3, { from: USER3 });

      assert.equal((await tokens[1].balanceOf(USER3)).toString(), amountToBorrow.toString());

      await tokens[1].transfer(USER1, amountToBorrow, { from: USER3 });

      assert.equal((await tokens[1].balanceOf(USER3)).toString(), 0);

      const reason = "LiquidityPool: Repay amount cannot be a zero.";
      await truffleAssert.reverts(defiCore.repayBorrow(tokenKey, 0, true, { from: USER3 }), reason);
    });
  });

  describe("beforeTokenTransfer tests", () => {
    const liquidityAmount = wei(100);
    const amountToBorrow = wei(50);

    let amountToTransfer = wei(90);

    it("should correctly transfer tokens when an asset is disabled as a collateral", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.disableCollateral(tokenKey, { from: USER1 });

      await liquidityPool.transfer(USER2, amountToTransfer, { from: USER1 });

      assert.equal(
        toBN(await defiCore.getUserLiquidityAmount(USER1, tokenKey)).toString(),
        liquidityAmount.minus(amountToTransfer).toString()
      );
      assert.equal(
        toBN(await defiCore.getUserLiquidityAmount(USER2, tokenKey)).toString(),
        amountToTransfer.toString()
      );

      assert.isTrue(deepCompareKeys([tokenKey], await userInfoRegistry.getUserSupplyAssets(USER2)));
    });

    it("should correctly transfer tokens when an asset is enabled as a collateral", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(tokenKey, amountToBorrow, USER1, { from: USER1 });

      amountToTransfer = wei(30);
      await liquidityPool.transfer(USER2, amountToTransfer, { from: USER1 });

      assert.equal(
        toBN(await defiCore.getUserLiquidityAmount(USER1, tokenKey)).toString(),
        liquidityAmount.minus(amountToTransfer).toString()
      );
      assert.equal(
        toBN(await defiCore.getUserLiquidityAmount(USER2, tokenKey)).toString(),
        amountToTransfer.toString()
      );

      const expectedLiquidity = toBN(await defiCore.getCurrentBorrowLimitInUSD(USER1)).minus(
        await defiCore.getTotalBorrowBalanceInUSD(USER1)
      );
      assert.equal(toBN((await defiCore.getAvailableLiquidity(USER1))[0]).toString(), expectedLiquidity.toString());
    });

    it("should not fail", async () => {
      const wEthKey = toBytes("WETH");
      const wEthToken = (await getTokens("WETH"))[0];
      const wEthChainlinkOracle = await createLiquidityPool(wEthKey, wEthToken, "WETH", true);
      await rewardsDistribution.setupRewardsPerBlockBatch([wEthKey], [wei(2)]);

      const newDaiPrice = toBN(10).times(priceDecimals);
      const newWEthPrice = toBN(120).times(priceDecimals);

      await tokenChainlinkOracle.setPrice(newDaiPrice);
      await wEthChainlinkOracle.setPrice(newWEthPrice);

      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      let expectedTotalSupply = toBN(13000).times(priceDecimals);
      let expectedAvailableLiquidity = expectedTotalSupply.times(getDecimal()).idiv(standardColRatio);

      assert.equal(toBN(await defiCore.getTotalSupplyBalanceInUSD(USER1)).toString(), expectedTotalSupply.toString());
      assert.equal(
        toBN((await defiCore.getAvailableLiquidity(USER1))[0]).toString(),
        expectedAvailableLiquidity.toString()
      );

      await defiCore.borrowFor(tokenKey, liquidityAmount.idiv(2), USER1, { from: USER1 });

      let expectedTotalBorrow = toBN(500).times(priceDecimals);
      expectedAvailableLiquidity = expectedAvailableLiquidity.minus(expectedTotalBorrow);

      assert.equal(toBN(await defiCore.getTotalBorrowBalanceInUSD(USER1)).toString(), expectedTotalBorrow.toString());
      assert.equal(
        toBN((await defiCore.getAvailableLiquidity(USER1))[0]).toString(),
        expectedAvailableLiquidity.toString()
      );

      const wEthPool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(wEthKey));
      await wEthPool.transfer(USER2, await wEthPool.balanceOf(USER1), { from: USER1 });

      expectedTotalSupply = toBN(1000).times(priceDecimals);
      expectedAvailableLiquidity = expectedTotalSupply
        .times(getDecimal())
        .idiv(standardColRatio)
        .minus(expectedTotalBorrow);

      assert.equal(toBN(await defiCore.getTotalSupplyBalanceInUSD(USER1)).toString(), expectedTotalSupply.toString());
      assert.equal(
        toBN((await defiCore.getAvailableLiquidity(USER1))[0]).toString(),
        expectedAvailableLiquidity.toString()
      );
    });

    it("should correctly update cumulative sums for sender and recipient", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });

      await mine(499);

      await liquidityPool.transfer(USER2, liquidityAmount.idiv(2), { from: USER1 });

      await mine(500);

      assert.equal(
        toBN(await rewardsDistribution.getUserReward(tokenKey, USER1, liquidityPool.address)).toString(),
        wei(112.5).toString()
      );
      assert.equal(
        toBN(await rewardsDistribution.getUserReward(tokenKey, USER2, liquidityPool.address)).toString(),
        wei(37.5).toString()
      );
    });

    it("should get exception if not enough available liquidity to transfer", async () => {
      amountToTransfer = wei(80);

      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(tokenKey, amountToBorrow, USER1, { from: USER1 });

      const reason = "LiquidityPool: Borrow limit used after transfer greater than 100%.";
      await truffleAssert.reverts(liquidityPool.transfer(USER2, amountToTransfer, { from: USER1 }), reason);
    });

    it("should correctly update assets if user transfer all tokens", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await liquidityPool.transfer(USER2, liquidityAmount, { from: USER1 });

      assert.isTrue(deepCompareKeys([], await userInfoRegistry.getUserSupplyAssets(USER1)));
      assert.isTrue(deepCompareKeys([tokenKey], await userInfoRegistry.getUserSupplyAssets(USER2)));
    });
  });

  describe("getBorrowPercentage", () => {
    const liquidityAmount = wei(100);
    const amountToBorrow = wei(40);

    it("should return correct borrow pecentage", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(tokenKey, amountToBorrow, USER1, { from: USER1 });

      assert.equal(
        toBN(await liquidityPool.getAggregatedLiquidityAmount()).toString(),
        liquidityAmount.minus(amountToBorrow).toString()
      );

      const expectedPercentage = amountToBorrow.times(getDecimal()).div(liquidityAmount);

      assert.equal(toBN(await liquidityPool.getBorrowPercentage()).toString(), expectedPercentage.toString());
    });

    it("should return zero borrow pecentage if borrow amount equal to zero", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });

      assert.equal(await liquidityPool.getBorrowPercentage(), 0);
    });

    it("should return zero borrow pecentage if borrow amount and liquidity amount equal to zero", async () => {
      assert.equal(await liquidityPool.getBorrowPercentage(), 0);
    });
  });

  describe("getAnnualBorrowRate", () => {
    const liquidityAmount = wei(100);
    const someKey = toBytes("SOME_KEY");

    let amountToBorrow = wei(44);

    beforeEach("setup", async () => {
      const newTokens = await getTokens(["SOME_KEY"]);
      await createLiquidityPool(someKey, newTokens[0], "SOME_KEY", true);
    });

    it("should return correct annual borrow rate when UR less than breaking point", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(tokenKey, amountToBorrow, USER1, { from: USER1 });

      assert.equal(toBN(await liquidityPool.getBorrowPercentage()).toString(), getOnePercent().times(44).toString());

      const expectedPercentage = getOnePercent().times(2.2);

      assert.equal(toBN(await liquidityPool.getAnnualBorrowRate()).toString(), expectedPercentage.toString());
    });

    it("should return correct annual borrow rate when UR greater than breaking point", async () => {
      amountToBorrow = wei(89.66);

      await defiCore.addLiquidity(someKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(tokenKey, amountToBorrow, USER1, { from: USER1 });

      assert.equal(toBN(await liquidityPool.getBorrowPercentage()).toString(), getOnePercent().times(89.66).toString());

      const expectedPercentage = getOnePercent().times(50.368);

      assert.equal(toBN(await liquidityPool.getAnnualBorrowRate()).toString(), expectedPercentage.toString());
    });
  });

  describe("getAPY", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(85);
    const someKey = toBytes("SOME_KEY");

    beforeEach("setup", async () => {
      const newTokens = await getTokens(["SOME_KEY"]);
      await createLiquidityPool(someKey, newTokens[0], "SOME_KEY", true);
    });

    it("should return correct APY", async () => {
      await defiCore.addLiquidity(someKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(tokenKey, borrowAmount, USER1, { from: USER1 });

      assert.equal(toBN(await liquidityPool.getAnnualBorrowRate()).toString(), getOnePercent().times(28).toString());

      const expectedAPY = getOnePercent().times("20.23");

      assert.equal(toBN(await liquidityPool.getAPY()).toString(), expectedAPY.toString());
    });

    it("should return correct APY if the total supply = 0", async () => {
      assert.equal(toBN(await liquidityPool.getAPY()).toString(), 0);
    });

    it("should return correct APY if the annual borrow rate = 0", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });

      assert.equal(toBN(await liquidityPool.getAPY()).toString(), 0);
    });
  });

  describe("withdrawReservedFunds", () => {
    const liquidityAmount = wei(1000);
    const borrowAmount = wei(850);
    const someKey = toBytes("SOME_KEY");
    const startTime = toBN(100000);
    let RECIPIENT;

    beforeEach("setup", async () => {
      RECIPIENT = await accounts(5);

      await setNextBlockTime(startTime.toNumber());

      const newTokens = await getTokens(["SOME_KEY"]);
      await createLiquidityPool(someKey, newTokens[0], "SOME_KEY", true);

      await defiCore.addLiquidity(someKey, liquidityAmount.times(2), { from: USER1 });
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER2 });

      await defiCore.borrowFor(tokenKey, borrowAmount, USER1, { from: USER1 });

      await setNextBlockTime(startTime.times(1000).toNumber());
      await liquidityPool.updateCompoundRate(false);

      await tokens[1].mintArbitrary(USER1, liquidityAmount.times(2), { from: USER1 });
      await defiCore.repayBorrow(tokenKey, 0, true, { from: USER1 });
    });

    it("should correctly withdraw all funds", async () => {
      const totalReserves = toBN(await liquidityPool.totalReserves());

      await liquidityPoolRegistry.withdrawReservedFunds(RECIPIENT, tokenKey, 0, true);

      assert.equal(toBN(await tokens[1].balanceOf(RECIPIENT)).toString(), totalReserves.toString());
      assert.equal(toBN(await liquidityPool.totalReserves()).toString(), 0);
    });

    it("should correctly withdraw part of all funds", async () => {
      const totalReserves = toBN(await liquidityPool.totalReserves());

      await liquidityPoolRegistry.withdrawReservedFunds(RECIPIENT, tokenKey, totalReserves.idiv(2), false);

      assert.equal(toBN(await tokens[1].balanceOf(RECIPIENT)).toString(), totalReserves.idiv(2).toString());
      assert.closeTo(toBN(await liquidityPool.totalReserves()).toNumber(), totalReserves.idiv(2).toNumber(), 5);
    });

    it("should get exception if not enough reserved funds", async () => {
      const totalReserves = toBN(await liquidityPool.totalReserves());

      const reason = "LiquidityPool: Not enough reserved funds.";

      await truffleAssert.reverts(
        liquidityPoolRegistry.withdrawReservedFunds(RECIPIENT, tokenKey, totalReserves.plus(1), false),
        reason
      );
    });
  });

  describe("liquidationBorrow", () => {
    const liquidityAmount = wei(100);
    const amountToBorrow = wei(70);
    const startTime = toBN(100000);
    let USER3;

    beforeEach("setup", async () => {
      USER3 = await accounts(4);

      await setNextBlockTime(startTime.toNumber());

      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER2 });
      await defiCore.addLiquidity(batKey, liquidityAmount.times(3));

      assert.equal(
        toBN(await tokens[1].balanceOf(liquidityPool.address)).toString(),
        liquidityAmount.times(2).toString()
      );
      assert.equal(
        toBN(await liquidityPool.getAggregatedLiquidityAmount()).toString(),
        liquidityAmount.times(2).toString()
      );

      await tokens[1].approve(liquidityPool.address, liquidityAmount, { from: USER3 });
      await liquidityPool.updateCompoundRate(false);
    });

    it("should correctly liquidate the user borrow", async () => {
      await defiCore.borrowFor(batKey, amountToBorrow, USER2, { from: USER2 });
      await tokenChainlinkOracle.setPrice(toBN(85).times(toBN(10).pow(chainlinkPriceDecimals)));

      await liquidityPool.updateCompoundRate(false);

      await tokens[2].mintArbitrary(USER3, tokensAmount);
      await tokens[2].approveArbitraryBacth(batPool.address, [USER3], [tokensAmount]);

      await defiCore.liquidation(USER2, tokenKey, batKey, amountToBorrow.idiv(2), { from: USER3 });

      assert.closeTo(
        toBN((await batPool.borrowInfos(USER2)).borrowAmount).toNumber(),
        amountToBorrow.idiv(2).toNumber(),
        oneToken.idiv(1000).toNumber()
      );

      const expectedReceiveAmount = toBN("44757033248081841431");
      assert.equal(toBN(await tokens[1].balanceOf(USER3)).toString(), expectedReceiveAmount.toString());
    });

    it("should correctly liquidate the entire borrow", async () => {
      await deployTokens("AAVE");

      const aaveKey = toBytes("AAVE");
      await createLiquidityPool(aaveKey, tokens[3], "AAVE", true);

      await defiCore.addLiquidity(aaveKey, liquidityAmount.times(3));

      await defiCore.borrowFor(batKey, amountToBorrow.idiv(2), USER2, { from: USER2 });
      await defiCore.borrowFor(aaveKey, amountToBorrow.idiv(2), USER2, { from: USER2 });

      await tokenChainlinkOracle.setPrice(toBN(85).times(toBN(10).pow(chainlinkPriceDecimals)));

      await liquidityPool.updateCompoundRate(false);

      await tokens[2].mintArbitrary(USER3, tokensAmount);
      await tokens[2].approveArbitraryBacth(batPool.address, [USER3], [tokensAmount]);

      await defiCore.liquidation(USER2, tokenKey, batKey, amountToBorrow.idiv(2), { from: USER3 });

      assert.closeTo(
        toBN((await batPool.borrowInfos(USER2)).borrowAmount).toNumber(),
        0,
        oneToken.idiv(1000).toNumber()
      );
      assert.closeTo(
        toBN((await batPool.borrowInfos(USER2)).normalizedAmount).toNumber(),
        0,
        oneToken.idiv(1000).toNumber()
      );
    });
  });

  describe("liquidate", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);
    const amountToLiquidate = wei(20);

    let someKey;
    let somePool;
    let someChainlinkOracle;

    beforeEach("setup", async () => {
      const newTokens = await getTokens(["SOME_KEY"]);
      someKey = toBytes("SOME_KEY");
      someChainlinkOracle = await createLiquidityPool(someKey, newTokens[0], "SOME_KEY", true);

      await someChainlinkOracle.setPrice(priceDecimals.times(140));
      somePool = await LiquidityPool.at(await liquidityPoolRegistry.liquidityPools(someKey));

      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER2 });
      await defiCore.addLiquidity(someKey, liquidityAmount, { from: USER2 });

      assert.equal(
        toBN(await tokens[1].balanceOf(liquidityPool.address)).toString(),
        liquidityAmount.times(2).toString()
      );

      await defiCore.borrowFor(someKey, borrowAmount, USER1, { from: USER1 });

      assert.equal(
        toBN(await liquidityPool.getAggregatedLiquidityAmount()).toString(),
        liquidityAmount.times(2).toString()
      );
      assert.equal(
        toBN(await somePool.getAggregatedLiquidityAmount()).toString(),
        liquidityAmount.minus(borrowAmount).toString()
      );
    });

    it("should correctly liquidate liquidity from the pool", async () => {
      const price = toBN(86);

      await tokenChainlinkOracle.setPrice(price.times(priceDecimals));
      await priceManager.setPrice(tokenKey, price);

      await defiCore.liquidation(USER1, tokenKey, someKey, amountToLiquidate, { from: USER2 });

      assert.equal(
        toBN(await liquidityPool.balanceOf(USER1)).toString(),
        liquidityAmount.minus(amountToLiquidate.times(140).idiv(price).idiv("0.92")).toString()
      );

      assert.equal(
        toBN(await tokens[1].balanceOf(USER2)).toString(),
        tokensAmount.minus(liquidityAmount).plus(amountToLiquidate.times(140).idiv(price).idiv("0.92")).toString()
      );
      assert.equal(
        toBN(await tokens[1].balanceOf(liquidityPool.address)).toString(),
        liquidityAmount.times(2).minus(amountToLiquidate.times(140).idiv(price).idiv("0.92")).toString()
      );

      assert.equal(
        toBN(await liquidityPool.getAggregatedLiquidityAmount()).toString(),
        liquidityAmount.times(2).minus(amountToLiquidate.times(140).idiv(price).idiv("0.92")).toString()
      );
    });
  });

  describe("getAvailableToBorrowLiquidity", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);
    const neededTime = toBN(1000000);

    it("should return correct value if BA = 0", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });

      assert.equal((await liquidityPool.getAvailableToBorrowLiquidity()).toString(), wei(95).toString());
    });

    it("should return correct value if BA > 0", async () => {
      await defiCore.updateCompoundRate(tokenKey, false);
      await defiCore.addLiquidity(tokenKey, liquidityAmount.times(11), { from: USER1 });
      await defiCore.borrowFor(tokenKey, borrowAmount.times(5), USER1, { from: USER1 });

      await setNextBlockTime(neededTime.times(100).toNumber());

      await defiCore.borrowFor(tokenKey, borrowAmount.times(5), USER1, { from: USER1 });

      const aggregatedBorrowedAmount = await liquidityPool.aggregatedBorrowedAmount();

      const expectedValue = aggregatedBorrowedAmount
        .plus(await liquidityPool.getAggregatedLiquidityAmount())
        .times(95)
        .idiv(100)
        .minus(aggregatedBorrowedAmount);
      assert.equal((await liquidityPool.getAvailableToBorrowLiquidity()).toString(), expectedValue.toString());
    });
  });

  describe("getTotalLiquidity", () => {
    const liquidityAmount = wei(100);
    const borrowAmount = wei(50);

    it("should return zero if there were no deposits", async () => {
      assert.equal(toBN(await liquidityPool.getTotalLiquidity()).toString(), 0);
    });

    it("should return correct value", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER2 });

      await defiCore.borrowFor(tokenKey, borrowAmount, USER2, { from: USER2 });

      assert.equal(toBN(await liquidityPool.getTotalLiquidity()).toString(), liquidityAmount.times(2).toString());
    });

    it("should return correct value after repay", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER2 });

      await defiCore.borrowFor(tokenKey, borrowAmount, USER2, { from: USER2 });
      await defiCore.borrowFor(tokenKey, borrowAmount.idiv(2), USER1, { from: USER1 });

      await setNextBlockTime(1000000);

      await liquidityPool.updateCompoundRate(false);

      const totalLiquidity = toBN(await liquidityPool.getTotalLiquidity());

      await defiCore.repayBorrow(tokenKey, 0, true, { from: USER2 });
      await defiCore.repayBorrow(tokenKey, 0, true, { from: USER1 });

      assert.closeTo(
        totalLiquidity.toNumber(),
        toBN(await tokens[1].balanceOf(liquidityPool.address))
          .minus(await liquidityPool.totalReserves())
          .toNumber(),
        oneToken.idiv(100).toNumber()
      );
    });
  });
});
