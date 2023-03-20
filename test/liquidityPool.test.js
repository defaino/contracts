const { setNextBlockTime, mine, getCurrentBlockNumber } = require("./helpers/block-helper");
const { toBytes, deepCompareKeys } = require("./helpers/bytesCompareLibrary");
const { getInterestRateLibraryAddr } = require("./helpers/coverage-helper");
const { toBN, accounts, getPrecision, getPercentage100, wei } = require("../scripts/utils/utils");
const { utils } = require("ethers");
const { ZERO_ADDR } = require("../scripts/utils/constants");

const truffleAssert = require("truffle-assertions");
const Reverter = require("./helpers/reverter");
const { web3, network, artifacts } = require("hardhat");
const { assert } = require("chai");

const Registry = artifacts.require("Registry");
const DefiCore = artifacts.require("DefiCore");
const SystemParameters = artifacts.require("SystemParameters");
const AssetParameters = artifacts.require("AssetParameters");
const RewardsDistribution = artifacts.require("RewardsDistributionMock");
const UserInfoRegistry = artifacts.require("UserInfoRegistry");
const SystemPoolsRegistry = artifacts.require("SystemPoolsRegistry");
const SystemPoolsFactory = artifacts.require("SystemPoolsFactory");
const LiquidityPool = artifacts.require("LiquidityPool");
const LiquidityPoolMock = artifacts.require("LiquidityPoolMock");
const AbstractPool = artifacts.require("AbstractPool");
const PriceManager = artifacts.require("PriceManager");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const WETH = artifacts.require("WETH");
const Prt = artifacts.require("PRT");
const RoleManager = artifacts.require("RoleManager");

const MockERC20 = artifacts.require("MockERC20");
const ChainlinkOracleMock = artifacts.require("ChainlinkOracleMock");
const IntegrationMock = artifacts.require("IntegrationMock");

MockERC20.numberFormat = "BigNumber";
DefiCore.numberFormat = "BigNumber";
LiquidityPool.numberFormat = "BigNumber";

describe("LiquidityPool", () => {
  const reverter = new Reverter();

  let OWNER;
  let USER1;
  let USER2;

  let registry;
  let assetParameters;
  let systemParameters;
  let defiCore;
  let rewardsDistribution;
  let userInfoRegistry;
  let systemPoolsRegistry;
  let prt;
  let roleManager;

  let nativePool;
  let liquidityPool;
  let batPool;

  let rewardsToken;
  let nativeToken;

  let tokenChainlinkOracle;

  const standardColRatio = getPercentage100().times("1.25");
  const oneToken = toBN(10).pow(18);
  const tokensAmount = wei(5000);
  const reserveFactor = getPrecision().times("15");
  const liquidationDiscount = getPrecision().times(8);
  const liquidationBoundary = getPrecision().times(50);
  const minCurrencyAmount = wei(0.1);

  const firstSlope = getPrecision().times(4);
  const secondSlope = getPercentage100();
  const utilizationBreakingPoint = getPrecision().times(80);
  const maxUR = getPrecision().times(95);

  const priceDecimals = toBN(10).pow(8);
  const chainlinkPriceDecimals = toBN(8);

  const minSupplyDistributionPart = getPrecision().times(15);
  const minBorrowDistributionPart = getPrecision().times(10);

  let tokens = [];

  const zeroKey = toBytes("");
  const tokenKey = toBytes("Token");
  const batKey = toBytes("BAT");
  const rewardsTokenKey = toBytes("RTK");
  const nativeTokenKey = toBytes("BNB");

  async function getLiquidityPoolAddr(assetKey) {
    return (await systemPoolsRegistry.poolsInfo(assetKey))[0];
  }

  function getNormalizedAmount(
    normalizedAmount,
    additionalAmount,
    currentRate,
    isAdding,
    amountWithoutInterest = oneToken
  ) {
    if (isAdding || toBN(amountWithoutInterest).toNumber() != 0) {
      const normalizedAdditionalAmount = additionalAmount.times(getPercentage100()).idiv(currentRate);

      return isAdding
        ? normalizedAmount.plus(normalizedAdditionalAmount)
        : normalizedAmount.minus(normalizedAdditionalAmount);
    }

    return 0;
  }

  function exchangeRate(liquidityAmount, totalSupply, normBorrowedAmount, aggreagatedBorrowedAmount, currentRate) {
    if (totalSupply.eq(0)) {
      return getPercentage100();
    }

    const absoluteBorrowAmount = normBorrowedAmount.times(currentRate).idiv(getPercentage100());
    const borrowInterest = absoluteBorrowAmount
      .minus(aggreagatedBorrowedAmount)
      .times(getPercentage100().minus(reserveFactor))
      .idiv(getPercentage100());

    return borrowInterest
      .plus(liquidityAmount)
      .plus(aggreagatedBorrowedAmount)
      .times(getPercentage100())
      .idiv(totalSupply);
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

  async function createLiquidityPool(assetKey, asset, symbol, isCollateral, price = 100) {
    const chainlinkOracle = await ChainlinkOracleMock.new(wei(price, chainlinkPriceDecimals), chainlinkPriceDecimals);

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
      [standardColRatio, standardColRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);

    return chainlinkOracle;
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
      [standardColRatio, standardColRatio, reserveFactor, liquidationDiscount, maxUR],
      [0, firstSlope, secondSlope, utilizationBreakingPoint],
      [minSupplyDistributionPart, minBorrowDistributionPart],
    ]);
  }

  before("setup", async () => {
    OWNER = await accounts(0);
    USER1 = await accounts(1);
    USER2 = await accounts(2);
    NOTHING = await accounts(9);

    rewardsToken = await MockERC20.new("MockRTK", "RTK");
    nativeToken = await WETH.new();

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
    const _roleManager = await RoleManager.new();

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
    await registry.addProxyContract(await registry.ROLE_MANAGER_NAME(), _roleManager.address);

    await registry.addContract(await registry.INTEREST_RATE_LIBRARY_NAME(), interestRateLibrary.address);

    defiCore = await DefiCore.at(await registry.getDefiCoreContract());
    assetParameters = await AssetParameters.at(await registry.getAssetParametersContract());
    userInfoRegistry = await UserInfoRegistry.at(await registry.getUserInfoRegistryContract());
    systemPoolsRegistry = await SystemPoolsRegistry.at(await registry.getSystemPoolsRegistryContract());
    rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());
    systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());
    roleManager = await RoleManager.at(await registry.getRoleManagerContract());

    await registry.injectDependencies(await registry.DEFI_CORE_NAME());
    await registry.injectDependencies(await registry.SYSTEM_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.ASSET_PARAMETERS_NAME());
    await registry.injectDependencies(await registry.REWARDS_DISTRIBUTION_NAME());
    await registry.injectDependencies(await registry.USER_INFO_REGISTRY_NAME());
    await registry.injectDependencies(await registry.SYSTEM_POOLS_REGISTRY_NAME());
    await registry.injectDependencies(await registry.SYSTEM_POOLS_FACTORY_NAME());
    await registry.injectDependencies(await registry.PRICE_MANAGER_NAME());
    await registry.injectDependencies(await registry.PRT_NAME());

    tokens.push(rewardsToken);
    await deployTokens(["DAI", "BAT"]);
    tokens.push(nativeToken);

    await defiCore.defiCoreInitialize();
    await roleManager.roleManagerInitialize([], []);
    await systemPoolsRegistry.systemPoolsRegistryInitialize(_liquidityPoolImpl.address, nativeTokenKey, zeroKey);

    await deployRewardsPool(rewardsToken.address, await rewardsToken.symbol());

    tokenChainlinkOracle = await createLiquidityPool(tokenKey, tokens[1], "DAI", true);
    await createLiquidityPool(batKey, tokens[2], "BAT", true);
    await createLiquidityPool(nativeTokenKey, tokens[3], "BNB", true, 10);

    nativePool = await LiquidityPool.at(await getLiquidityPoolAddr(nativeTokenKey));
    liquidityPool = await LiquidityPool.at(await getLiquidityPoolAddr(tokenKey));
    batPool = await LiquidityPool.at(await getLiquidityPoolAddr(batKey));

    await systemParameters.setupLiquidationBoundary(liquidationBoundary);
    await systemParameters.setupMinCurrencyAmount(minCurrencyAmount);
    await systemParameters.setRewardsTokenAddress(ZERO_ADDR);

    await rewardsToken.mintArbitrary(defiCore.address, tokensAmount);

    await nativeToken.approve(nativePool.address, tokensAmount);
    await nativeToken.approve(nativePool.address, tokensAmount, { from: USER2 });

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("nativeToken depositTo()/withdraw()", () => {
    it("should get an exeption if try to deposit/withdraw zero amount, withdrawTo a smart-contract not supporting direct transfers", async () => {
      let reason = "WETH: Zero deposit amount.";
      await truffleAssert.reverts(nativeToken.deposit({ value: 0 }), reason);

      reason = "WETH: Zero withdraw amount.";
      await truffleAssert.reverts(nativeToken.withdraw(0), reason);

      await nativeToken.deposit({ value: 1 });

      reason = "WETH: Failed to transfer AAA.";
      await truffleAssert.reverts(nativeToken.withdrawTo(registry.address, 1), reason);
    });

    it("should correctly mint WETH when user directly transfers native currency", async () => {
      await web3.eth.sendTransaction({
        to: nativeToken.address,
        from: USER1,
        gas: wei(1, 7),
        value: 1000,
      });

      assert.equal(await nativeToken.balanceOf(USER1), 1000);
    });
  });

  describe("_abstractPoolInitialize()", () => {
    it("should get an exeption if called after initializing", async () => {
      const someKey = toBytes("SOME_KEY");
      let liquidityPoolMock;
      const chainlinkOracle = await ChainlinkOracleMock.new(wei(100, chainlinkPriceDecimals), chainlinkPriceDecimals);
      liquidityPoolMock = await LiquidityPoolMock.new(registry.address, chainlinkOracle.address, someKey, "MOCK");
      let reason = "Initializable: contract is not initializing";
      await truffleAssert.reverts(
        liquidityPoolMock.abstractPoolInitialize(nativeToken.address, nativeTokenKey),
        reason
      );
    });
  });

  describe("approveToBorrow()", () => {
    it("should get an exeption if called directly not from deficore", async () => {
      let reason = "AbstractPool: Caller not a DefiCore.";
      await truffleAssert.reverts(nativePool.approveToBorrow(USER1, 0, USER2, 0), reason);
    });
  });

  describe("delegateBorrow()", () => {
    it("should get an exeption if called directly not from deficore", async () => {
      let reason = "AbstractPool: Caller not a DefiCore.";
      await truffleAssert.reverts(nativePool.delegateBorrow(USER1, USER2, 0), reason);
    });
  });

  describe("repayBorrowFor()", () => {
    it("should get an exeption if called directly not from deficore", async () => {
      let reason = "AbstractPool: Caller not a DefiCore.";
      await truffleAssert.reverts(nativePool.repayBorrowFor(USER1, USER2, 0, false), reason);
    });
  });

  describe("setDependencies", () => {
    it("should revert if not called by injector", async () => {
      let reason = "Dependant: Not an injector";
      await truffleAssert.reverts(nativePool.setDependencies(registry.address, { from: USER2 }), reason);
      await truffleAssert.reverts(liquidityPool.setDependencies(registry.address, { from: USER2 }), reason);
    });
  });

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

      assert.isTrue(currentRate.gt(getPercentage100()));

      await setNextBlockTime(neededTime.plus(1000).toNumber());

      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });

      assert.equal(toBN(await liquidityPool.getCurrentRate()).toString(), currentRate.toString());
    });
  });

  describe("liquidityPoolInitialize", () => {
    it("should revert if called after the initializing", async () => {
      const reason = "Initializable: contract is already initialized";
      await truffleAssert.reverts(liquidityPool.liquidityPoolInitialize(tokens[1].address, tokenKey, "DAI"), reason);
    });
  });

  describe("addLiquidity", () => {
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

      assert.isTrue((await liquidityPool.exchangeRate()).gt(getPercentage100()));

      const expectedBalance = liquidityAmount.times(getPercentage100()).idiv(await liquidityPool.exchangeRate());
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER2 });

      assert.equal((await liquidityPool.balanceOf(USER2)).toString(), expectedBalance.toString());
    });

    it("should correctly add liquidity to current block", async () => {
      await setNextBlockTime(neededTime.toNumber());

      const testBlock = await getCurrentBlockNumber();
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });

      let result = await liquidityPool.lastLiquidity(USER1);

      assert.equal(result[0].toString(), liquidityAmount.toString());
      assert.equal(result[1].toString(), testBlock + 1);

      await mine(500);

      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });

      result = await liquidityPool.lastLiquidity(USER1);

      assert.equal(result[0].toString(), liquidityAmount.toString());
      assert.equal(result[1].toString(), testBlock + 500 + 2);
    });

    it("should correctly add liquidity several times in one block", async () => {
      const user1PrivateKey = "0x7d79a02f88fd37c07afc54ab97ea4ac90ef90f676f618bcc91158a9416a831a9";

      const nonce = await web3.eth.getTransactionCount(USER1, "latest"); // nonce starts counting from 0

      const data = defiCore.contract.methods.addLiquidity(tokenKey, liquidityAmount).encodeABI();

      let transaction = {
        to: defiCore.address,
        gas: 3000000,
        nonce: nonce,
        data: data,
      };

      let signedTx = await web3.eth.accounts.signTransaction(transaction, user1PrivateKey);

      await network.provider.send("evm_setAutomine", [false]);

      web3.eth.sendSignedTransaction(signedTx.rawTransaction);

      transaction = {
        to: defiCore.address,
        gas: 3000000,
        nonce: nonce + 1,
        data: data,
      };

      signedTx = await web3.eth.accounts.signTransaction(transaction, user1PrivateKey);

      web3.eth.sendSignedTransaction(signedTx.rawTransaction);

      await mine(1);

      await network.provider.send("evm_setAutomine", [true]);

      const testBlock = await getCurrentBlockNumber();

      let result = await liquidityPool.lastLiquidity(USER1);

      assert.equal(result[0].toString(), liquidityAmount.times(2).toString());
      assert.equal(result[1].toString(), testBlock);
    });

    it("should correctly add liquidity to native pool without tokens", async () => {
      assert.equal((await nativeToken.balanceOf(USER2)).toString(), 0);

      const balanceBefore = toBN(await web3.eth.getBalance(USER2));

      await defiCore.addLiquidity(nativeTokenKey, liquidityAmount, { from: USER2, value: liquidityAmount.times(1.5) });

      const balanceAfter = toBN(await web3.eth.getBalance(USER2));

      assert.closeTo(
        balanceBefore.minus(balanceAfter).toNumber(),
        liquidityAmount.toNumber(),
        oneToken.idiv(100).toNumber()
      );
      assert.equal(
        (await defiCore.getUserLiquidityAmount(USER2, nativeTokenKey)).toString(),
        liquidityAmount.toString()
      );
    });

    it("should correctly add liquidity to native pool without currency", async () => {
      await nativeToken.deposit({ from: USER2, value: liquidityAmount });

      assert.equal((await nativeToken.balanceOf(USER2)).toString(), liquidityAmount.toString());

      await defiCore.addLiquidity(nativeTokenKey, liquidityAmount.idiv(2), { from: USER2 });

      assert.equal((await nativeToken.balanceOf(USER2)).toString(), liquidityAmount.idiv(2).toString());
      assert.equal(
        (await defiCore.getUserLiquidityAmount(USER2, nativeTokenKey)).toString(),
        liquidityAmount.idiv(2).toString()
      );
    });

    it("should correctly add liquidity to native pool with currency and tokens", async () => {
      await nativeToken.deposit({ from: USER2, value: liquidityAmount });

      const balanceBefore = toBN(await web3.eth.getBalance(USER2));

      await defiCore.addLiquidity(nativeTokenKey, liquidityAmount.times(1.5), { from: USER2, value: liquidityAmount });

      const balanceAfter = toBN(await web3.eth.getBalance(USER2));

      assert.equal((await nativeToken.balanceOf(USER2)).toString(), 0);
      assert.equal((await nativeToken.balanceOf(nativePool.address)).toString(), liquidityAmount.times(1.5).toString());
      assert.closeTo(
        balanceBefore.minus(balanceAfter).toNumber(),
        liquidityAmount.idiv(2).toNumber(),
        oneToken.idiv(100).toNumber()
      );
      assert.equal(
        (await defiCore.getUserLiquidityAmount(USER2, nativeTokenKey)).toString(),
        liquidityAmount.times(1.5).toString()
      );
      assert.equal(
        toBN(await web3.eth.getBalance(nativeToken.address)).toString(),
        liquidityAmount.times(1.5).toString()
      );
    });

    it("should get exception if failed to transfer extra currency", async () => {
      const integrationContract = await IntegrationMock.new();

      const reason = "LiquidityPool: Failed to return extra currency.";

      await truffleAssert.reverts(
        integrationContract.addLiquidity(defiCore.address, nativeTokenKey, liquidityAmount, {
          value: liquidityAmount.times(1.5),
        }),
        reason
      );
    });

    it("should get exception if user have enough tokens", async () => {
      const reason = "LiquidityPool: There are enough tokens to deposit the entire amount.";

      await nativeToken.deposit({ from: USER2, value: liquidityAmount });

      await truffleAssert.reverts(
        defiCore.addLiquidity(nativeTokenKey, liquidityAmount.idiv(2), { from: USER2, value: liquidityAmount }),
        reason
      );
    });

    it("should get exception if the user does not have enough tokens", async () => {
      const reason = "LiquidityPool: Not enough tokens on account.";
      await truffleAssert.reverts(defiCore.addLiquidity(tokenKey, tokensAmount.plus(100), { from: USER1 }), reason);
    });

    it("should get exception if currency amount less than needed", async () => {
      const reason = "LiquidityPool: Wrong native currency amount.";

      await truffleAssert.reverts(
        defiCore.addLiquidity(nativeTokenKey, liquidityAmount, { from: USER2, value: liquidityAmount.minus(1) }),
        reason
      );
    });

    it("should get exception if try to pass currency to nonnative pool", async () => {
      const reason = "LiquidityPool: Unable to add currency to a nonnative pool.";

      await truffleAssert.reverts(
        defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER2, value: liquidityAmount }),
        reason
      );
    });

    it("should get exception if a pool called directly, not via the defiCore contract", async () => {
      const reason = "AbstractPool: Caller not a DefiCore.";
      await truffleAssert.reverts(liquidityPool.addLiquidity(USER2, liquidityAmount), reason);
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
    let compoundRate = getPercentage100();

    beforeEach("setup", async () => {
      const chainlinkOracle = await ChainlinkOracleMock.new(wei(100, chainlinkPriceDecimals), chainlinkPriceDecimals);
      liquidityPoolMock = await LiquidityPoolMock.new(registry.address, chainlinkOracle.address, someKey, "MOCK");
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
      compoundRate = getPercentage100().times("1.2");

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
      compoundRate = getPercentage100().times("1.5");

      const result = toBN(
        await liquidityPoolMock.getNormalizedAmount(0, normalizedAmount, additionalAmount, compoundRate, false)
      );
      assert.equal(result.toString(), 0);
    });

    it("should return correct values if CR != 0 and normalized amount equal to zero", async () => {
      normalizedAmount = toBN(0);
      additionalAmount = wei(150);
      compoundRate = getPercentage100().times("1.5");

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
      await defiCore.addLiquidity(nativeTokenKey, liquidityAmount, { from: USER2, value: liquidityAmount });
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

      assert.isTrue(toBN(await liquidityPool.exchangeRate()).gt(getPercentage100()));

      const expectedBurnAmount = toBN(amountToWithdraw)
        .times(getPercentage100())
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

      const somePool = await LiquidityPool.at(await getLiquidityPoolAddr(someKey));

      await setNextBlockTime(neededTime.toNumber());
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(someKey, liquidityAmount, { from: USER2 });

      const borrowAmount = wei(90);
      await defiCore.borrowFor(someKey, borrowAmount, USER1, { from: USER1 });

      assert.equal(toBN(await somePool.getBorrowPercentage()).toString(), getPrecision().times(90).toString());

      await setNextBlockTime(withdrawTime.toNumber());
      const reason = "LiquidityPool: Utilization ratio after withdraw cannot be greater than the maximum.";
      await truffleAssert.reverts(defiCore.withdrawLiquidity(someKey, wei(8), false, { from: USER2 }), reason);
    });

    it("should correctly withdraw currency from native pool", async () => {
      assert.equal((await nativePool.balanceOf(USER2)).toString(), liquidityAmount.toString());

      const balanceBefore = toBN(await web3.eth.getBalance(USER2));

      await defiCore.withdrawLiquidity(nativeTokenKey, amountToWithdraw, false, { from: USER2 });

      const balanceAfter = toBN(await web3.eth.getBalance(USER2));

      assert.equal((await nativePool.balanceOf(USER2)).toString(), liquidityAmount.minus(amountToWithdraw).toString());
      assert.equal(
        (await nativeToken.balanceOf(nativePool.address)).toString(),
        liquidityAmount.minus(amountToWithdraw).toString()
      );
      assert.closeTo(
        balanceAfter.minus(balanceBefore).toNumber(),
        amountToWithdraw.toNumber(),
        oneToken.idiv(100).toNumber()
      );
    });

    it("should get exception if not enough available liquidity on the contract", async () => {
      const newTokens = await getTokens(["TMP_TOK"]);
      const tmpTokenKey = toBytes("TMP_TOK");
      await createLiquidityPool(tmpTokenKey, newTokens[0], "TMP_TOK", true);

      await assetParameters.setupDistributionsMinimums(tmpTokenKey, [
        minSupplyDistributionPart,
        minBorrowDistributionPart,
      ]);

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
      await defiCore.updateCollateral(tokenKey, true, { from: USER1 });

      await setNextBlockTime(withdrawTime.toNumber());
      const reason = "LiquidityPool: Not enough lpTokens to withdraw liquidity.";
      await truffleAssert.reverts(
        defiCore.withdrawLiquidity(tokenKey, liquidityAmount.plus(100), false, { from: USER1 }),
        reason
      );
    });

    it("should get exception if a pool called directly, not via the defiCore contract", async () => {
      const reason = "AbstractPool: Caller not a DefiCore.";

      await setNextBlockTime(withdrawTime.toNumber());

      await truffleAssert.reverts(
        liquidityPool.withdrawLiquidity(USER1, amountToWithdraw, false, { from: USER1 }),
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

    it("should return PERCENTAGE_100 if total supply = 0", async () => {
      assert.equal(toBN(await liquidityPool.exchangeRate()).toString(), getPercentage100().toString());
    });

    it("should return correct exchange rate if borrowed amount = 0", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });

      assert.equal(
        toBN(await liquidityPool.exchangeRate()).toString(),
        exchangeRate(liquidityAmount, liquidityAmount, toBN(0), toBN(0), getPercentage100()).toString()
      );
    });

    it("should return correct exchange rate if current rate greater than getPercentage100()", async () => {
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

  describe("borrowFor", () => {
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
      await defiCore.addLiquidity(nativeTokenKey, liquidityAmount, { from: USER2, value: liquidityAmount });

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

      assert.equal(toBN(await liquidityPool.getBorrowPercentage()).toString(), getPrecision().times(95).toString());
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

    it("should correctly borrow native currency", async () => {
      const balanceBefore = toBN(await web3.eth.getBalance(USER2));

      await defiCore.borrowFor(nativeTokenKey, amountToBorrow, USER2, { from: USER2 });

      const balanceAfter = toBN(await web3.eth.getBalance(USER2));

      assert.equal(
        (await nativeToken.balanceOf(nativePool.address)).toString(),
        liquidityAmount.minus(amountToBorrow).toString()
      );
      assert.closeTo(
        balanceAfter.minus(balanceBefore).toNumber(),
        amountToBorrow.toNumber(),
        oneToken.idiv(100).toNumber()
      );
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

    it("should get exception if try to call this function directly", async () => {
      const reason = "AbstractPool: Caller not a DefiCore.";

      await truffleAssert.reverts(liquidityPool.borrowFor(USER1, USER1, amountToBorrow), reason);
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
      await defiCore.addLiquidity(nativeTokenKey, liquidityAmount.times(2), { value: liquidityAmount.times(2) });

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

      const expectedReserveFunds = repayAmount.times(reserveFactor).idiv(getPercentage100());

      assert.equal((await liquidityPool.totalReserves()).toString(), expectedReserveFunds.toString());
    });

    it("should correctly repay borrow without tokens", async () => {
      await defiCore.borrowFor(nativeTokenKey, amountToBorrow, USER2, { from: USER2 });

      const balanceBefore = toBN(await web3.eth.getBalance(USER2));

      await defiCore.repayBorrow(nativeTokenKey, amountToRepay, false, {
        from: USER2,
        value: amountToRepay.times(1.5),
      });

      const balanceAfter = toBN(await web3.eth.getBalance(USER2));

      assert.closeTo(
        balanceBefore.minus(balanceAfter).toNumber(),
        amountToRepay.toNumber(),
        oneToken.idiv(100).toNumber()
      );
      assert.closeTo(
        (await defiCore.getUserBorrowedAmount(USER2, nativeTokenKey)).toNumber(),
        amountToBorrow.minus(amountToRepay).toNumber(),
        oneToken.idiv(10000).toNumber()
      );
    });

    it("should correctly repay borrow without currency", async () => {
      await nativeToken.deposit({ from: USER2, value: amountToRepay });
      await defiCore.borrowFor(nativeTokenKey, amountToBorrow, USER2, { from: USER2 });

      const balanceBefore = toBN(await web3.eth.getBalance(USER2));

      await defiCore.repayBorrow(nativeTokenKey, amountToRepay, false, { from: USER2 });

      const balanceAfter = toBN(await web3.eth.getBalance(USER2));

      assert.equal((await nativeToken.balanceOf(USER2)).toString(), 0);
      assert.closeTo(balanceBefore.minus(balanceAfter).toNumber(), 0, oneToken.idiv(100).toNumber());
      assert.closeTo(
        (await defiCore.getUserBorrowedAmount(USER2, nativeTokenKey)).toNumber(),
        amountToBorrow.minus(amountToRepay).toNumber(),
        oneToken.idiv(10000).toNumber()
      );
    });

    it("should correctly repay borrow with currency and tokens", async () => {
      await nativeToken.deposit({ from: USER2, value: amountToRepay });
      await defiCore.borrowFor(nativeTokenKey, amountToBorrow, USER2, { from: USER2 });

      const balanceBefore = toBN(await web3.eth.getBalance(USER2));

      await defiCore.repayBorrow(nativeTokenKey, amountToRepay.times(1.5), false, {
        from: USER2,
        value: amountToRepay,
      });

      const balanceAfter = toBN(await web3.eth.getBalance(USER2));

      assert.equal((await nativeToken.balanceOf(USER2)).toString(), 0);
      assert.closeTo(
        balanceBefore.minus(balanceAfter).toNumber(),
        amountToRepay.idiv(2).toNumber(),
        oneToken.idiv(100).toNumber()
      );
      assert.closeTo(
        (await defiCore.getUserBorrowedAmount(USER2, nativeTokenKey)).toNumber(),
        amountToBorrow.minus(amountToRepay.times(1.5)).toNumber(),
        oneToken.idiv(10000).toNumber()
      );
    });

    it("should correctly repay max debt with tokens and currency (1)", async () => {
      await nativeToken.deposit({ from: USER1, value: amountToBorrow.idiv(2) });

      await defiCore.borrowFor(nativeTokenKey, amountToBorrow, USER1, { from: USER1 });

      await nativeToken.approve(nativePool.address, tokensAmount, { from: USER1 });

      const value = (await defiCore.getMaxToRepay(USER1, nativeTokenKey)).minus(amountToBorrow.idiv(2));

      await defiCore.repayBorrow(nativeTokenKey, 0, true, {
        from: USER1,
        value: value.plus(wei(1, 12)),
      });

      assert.equal((await defiCore.getMaxToRepay(USER1, nativeTokenKey)).toString(), 0);
      assert.equal((await nativeToken.balanceOf(USER1)).toString(), 0);
    });

    it("should correctly repay max debt with tokens and currency (2)", async () => {
      await defiCore.borrowFor(nativeTokenKey, amountToBorrow, USER1, { from: USER1 });

      await nativeToken.approve(nativePool.address, tokensAmount, { from: USER1 });

      await defiCore.repayBorrow(nativeTokenKey, 0, true, {
        from: USER1,
        value: amountToBorrow.times(1.1),
      });

      assert.equal((await defiCore.getMaxToRepay(USER1, nativeTokenKey)).toString(), 0);
      assert.equal((await nativeToken.balanceOf(USER1)).toString(), 0);
    });

    it("should correctly repay max debt with tokens and currency (3)", async () => {
      await nativeToken.deposit({ from: USER1, value: amountToBorrow.idiv(2) });
      await defiCore.borrowFor(nativeTokenKey, amountToBorrow.times(2), USER1, { from: USER1 });

      const currentBalance = toBN(await web3.eth.getBalance(USER1));
      const expectedBalance = wei(50);

      await web3.eth.sendTransaction({
        to: USER2,
        from: USER1,
        gas: wei(1, 7),
        value: currentBalance.minus(expectedBalance),
      });

      assert.closeTo(
        toBN(await web3.eth.getBalance(USER1)).toNumber(),
        expectedBalance.toNumber(),
        wei(0.001).toNumber()
      );

      await nativeToken.approve(nativePool.address, tokensAmount, { from: USER1 });

      const value = (await defiCore.getMaxToRepay(USER1, nativeTokenKey)).minus(amountToBorrow.idiv(2));
      const gasLimit = toBN(7000000);

      const txReceipt = await defiCore.repayBorrow(nativeTokenKey, 0, true, {
        from: USER1,
        value: value,
        gas: gasLimit,
      });

      assert.equal((await defiCore.getMaxToRepay(USER1, nativeTokenKey)).toString(), 0);
      assert.equal((await nativeToken.balanceOf(USER1)).toString(), 0);
      assert.equal(
        toBN(await web3.eth.getBalance(USER1)).toString(),
        minCurrencyAmount.minus(toBN(txReceipt.receipt.gasUsed).times(txReceipt.receipt.effectiveGasPrice)).toString()
      );
      assert.closeTo(
        (await defiCore.getUserBorrowedAmount(USER1, nativeTokenKey)).toNumber(),
        amountToBorrow.times(2).minus(value.plus(amountToRepay)).toNumber(),
        wei(0.00001).toNumber()
      );
    });

    it("should correctly repay max debt with tokens and currency (4)", async () => {
      await nativeToken.deposit({ from: USER1, value: amountToBorrow.idiv(2) });
      await defiCore.borrowFor(nativeTokenKey, amountToBorrow, USER1, { from: USER1 });

      await nativeToken.approve(nativePool.address, tokensAmount, { from: USER1 });

      const currentBalance = toBN(await web3.eth.getBalance(USER1));
      const value = wei(10);

      await defiCore.repayBorrow(nativeTokenKey, 0, true, {
        from: USER1,
        value: value,
      });

      assert.equal((await nativeToken.balanceOf(USER1)).toString(), 0);
      assert.closeTo(
        toBN(await web3.eth.getBalance(USER1)).toNumber(),
        currentBalance.minus(value).toNumber(),
        wei(0.01).toNumber()
      );
      assert.closeTo(
        (await defiCore.getUserBorrowedAmount(USER1, nativeTokenKey)).toNumber(),
        amountToBorrow.minus(value.plus(amountToRepay)).toNumber(),
        wei(0.00001).toNumber()
      );
    });

    it("should get exception if the user did not borrow", async () => {
      const someAmount = toBN(1000);
      await defiCore.repayBorrow(tokenKey, someAmount, false, { from: USER1 });

      assert.equal((await liquidityPool.borrowInfos(USER1)).normalizedAmount.toString(), 0);

      const reason = "AbstractPool: Repay amount cannot be a zero.";
      await truffleAssert.reverts(defiCore.repayBorrow(tokenKey, 0, true, { from: USER3 }), reason);
    });

    it("should get exception if user does not have tokens on his balance", async () => {
      await liquidityPool.transfer(USER3, liquidityAmount, { from: USER1 });

      assert.equal((await defiCore.getUserLiquidityAmount(USER3, tokenKey)).toString(), liquidityAmount.toString());

      await defiCore.borrowFor(tokenKey, amountToBorrow, USER3, { from: USER3 });

      assert.equal((await tokens[1].balanceOf(USER3)).toString(), amountToBorrow.toString());

      await tokens[1].transfer(USER1, amountToBorrow, { from: USER3 });

      assert.equal((await tokens[1].balanceOf(USER3)).toString(), 0);

      const reason = "AbstractPool: Repay amount cannot be a zero.";
      await truffleAssert.reverts(defiCore.repayBorrow(tokenKey, 0, true, { from: USER3 }), reason);
    });
  });

  describe("beforeTokenTransfer tests", () => {
    const liquidityAmount = wei(100);
    const amountToBorrow = wei(50);

    let amountToTransfer = wei(90);

    it("should correctly transfer tokens when an asset is disabled as a collateral", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.updateCollateral(tokenKey, true, { from: USER1 });

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

      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch(
        [rewardsTokenKey, tokenKey, wEthKey],
        [wei(2), oneToken, wei(2)]
      );

      const newDaiPrice = toBN(10).times(priceDecimals);
      const newWEthPrice = toBN(120).times(priceDecimals);

      await tokenChainlinkOracle.setPrice(newDaiPrice);
      await wEthChainlinkOracle.setPrice(newWEthPrice);

      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(wEthKey, liquidityAmount, { from: USER1 });

      let expectedTotalSupply = toBN(13000).times(priceDecimals);
      let expectedAvailableLiquidity = expectedTotalSupply.times(getPercentage100()).idiv(standardColRatio);

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

      const wEthPool = await LiquidityPool.at(await getLiquidityPoolAddr(wEthKey));
      await wEthPool.transfer(USER2, await wEthPool.balanceOf(USER1), { from: USER1 });

      expectedTotalSupply = toBN(1000).times(priceDecimals);
      expectedAvailableLiquidity = expectedTotalSupply
        .times(getPercentage100())
        .idiv(standardColRatio)
        .minus(expectedTotalBorrow);

      assert.equal(toBN(await defiCore.getTotalSupplyBalanceInUSD(USER1)).toString(), expectedTotalSupply.toString());
      assert.equal(
        toBN((await defiCore.getAvailableLiquidity(USER1))[0]).toString(),
        expectedAvailableLiquidity.toString()
      );
    });

    it("should correctly update cumulative sums for sender and recipient", async () => {
      await systemParameters.setRewardsTokenAddress(rewardsToken.address);
      await systemPoolsRegistry.updateRewardsAssetKey(rewardsTokenKey);
      await rewardsDistribution.setupRewardsPerBlockBatch([rewardsTokenKey, tokenKey], [wei(2), oneToken]);

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

    it("should correctly move last liquidity to the recipient", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });

      const user1PrivateKey = "0x7d79a02f88fd37c07afc54ab97ea4ac90ef90f676f618bcc91158a9416a831a9";
      const user2PrivateKey = "0x3b3da990511ac5bd539db5fbad1647d1181e15a401dfa648ee525cf3473489a4";

      const nonceUser1 = await web3.eth.getTransactionCount(USER1, "latest");
      const nonceUser2 = await web3.eth.getTransactionCount(USER2, "latest");

      let data = defiCore.contract.methods.addLiquidity(tokenKey, liquidityAmount).encodeABI();

      let transaction = {
        to: defiCore.address,
        gas: 1000000,
        nonce: nonceUser1,
        data: data,
      };

      let signedTx = await web3.eth.accounts.signTransaction(transaction, user1PrivateKey);

      await network.provider.send("evm_setAutomine", [false]);

      web3.eth.sendSignedTransaction(signedTx.rawTransaction);

      transaction = {
        to: defiCore.address,
        gas: 1000000,
        nonce: nonceUser2,
        data: data,
      };

      signedTx = await web3.eth.accounts.signTransaction(transaction, user2PrivateKey);
      web3.eth.sendSignedTransaction(signedTx.rawTransaction);

      const transferAmount = wei(150);

      data = liquidityPool.contract.methods.transfer(USER2, transferAmount).encodeABI();

      transaction = {
        from: USER1,
        to: liquidityPool.address,
        gas: 1000000,
        nonce: nonceUser1 + 1,
        data: data,
      };

      signedTx = await web3.eth.accounts.signTransaction(transaction, user1PrivateKey);

      web3.eth.sendSignedTransaction(signedTx.rawTransaction);

      await mine(1);

      await network.provider.send("evm_setAutomine", [true]);

      const testBlock = await getCurrentBlockNumber();

      assert.equal(
        toBN(await defiCore.getUserLiquidityAmount(USER1, tokenKey)).toString(),
        liquidityAmount.times(2).minus(transferAmount).toString()
      );
      assert.equal(
        toBN(await defiCore.getUserLiquidityAmount(USER2, tokenKey)).toString(),
        liquidityAmount.plus(transferAmount).toString()
      );

      let result = await liquidityPool.lastLiquidity(USER1);

      assert.equal(result[0].toString(), liquidityAmount.idiv(2).toString());
      assert.equal(result[1].toString(), testBlock);

      result = await liquidityPool.lastLiquidity(USER2);

      assert.equal(result[0].toString(), liquidityAmount.times(1.5).toString());
      assert.equal(result[1].toString(), testBlock);
    });

    it("should not move last liquidity if sender have enough lp tokens", async () => {
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER2 });

      const user1PrivateKey = "0x7d79a02f88fd37c07afc54ab97ea4ac90ef90f676f618bcc91158a9416a831a9";

      const nonceUser1 = await web3.eth.getTransactionCount(USER1, "latest");

      let data = defiCore.contract.methods.addLiquidity(tokenKey, liquidityAmount).encodeABI();

      let transaction = {
        to: defiCore.address,
        gas: 1000000,
        nonce: nonceUser1,
        data: data,
      };

      let signedTx = await web3.eth.accounts.signTransaction(transaction, user1PrivateKey);

      await network.provider.send("evm_setAutomine", [false]);

      web3.eth.sendSignedTransaction(signedTx.rawTransaction);

      const transferAmount = wei(80);

      data = liquidityPool.contract.methods.transfer(USER2, transferAmount).encodeABI();

      transaction = {
        from: USER1,
        to: liquidityPool.address,
        gas: 1000000,
        nonce: nonceUser1 + 1,
        data: data,
      };

      signedTx = await web3.eth.accounts.signTransaction(transaction, user1PrivateKey);

      web3.eth.sendSignedTransaction(signedTx.rawTransaction);

      await mine(1);

      await network.provider.send("evm_setAutomine", [true]);

      const testBlock = await getCurrentBlockNumber();

      assert.equal(
        toBN(await defiCore.getUserLiquidityAmount(USER1, tokenKey)).toString(),
        liquidityAmount.times(2).minus(transferAmount).toString()
      );
      assert.equal(
        toBN(await defiCore.getUserLiquidityAmount(USER2, tokenKey)).toString(),
        liquidityAmount.plus(transferAmount).toString()
      );

      let result = await liquidityPool.lastLiquidity(USER1);

      assert.equal(result[0].toString(), liquidityAmount.toString());
      assert.equal(result[1].toString(), testBlock);

      result = await liquidityPool.lastLiquidity(USER2);

      assert.equal(result[0].toString(), liquidityAmount.toString());
      assert.equal(result[1].toString(), testBlock - 1);
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

      const expectedPercentage = amountToBorrow.times(getPercentage100()).div(liquidityAmount);

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

      assert.equal(toBN(await liquidityPool.getBorrowPercentage()).toString(), getPrecision().times(44).toString());

      const expectedPercentage = getPrecision().times(2.2);

      assert.equal(toBN(await liquidityPool.getAnnualBorrowRate()).toString(), expectedPercentage.toString());
    });

    it("should return correct annual borrow rate when UR greater than breaking point", async () => {
      amountToBorrow = wei(89.66);

      await defiCore.addLiquidity(someKey, liquidityAmount, { from: USER1 });
      await defiCore.addLiquidity(tokenKey, liquidityAmount, { from: USER1 });
      await defiCore.borrowFor(tokenKey, amountToBorrow, USER1, { from: USER1 });

      assert.equal(toBN(await liquidityPool.getBorrowPercentage()).toString(), getPrecision().times(89.66).toString());

      const expectedPercentage = getPrecision().times(50.368);

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

      assert.equal(toBN(await liquidityPool.getAnnualBorrowRate()).toString(), getPrecision().times(28).toString());

      const expectedAPY = getPrecision().times("20.23");

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

      await systemPoolsRegistry.withdrawReservedFunds(RECIPIENT, tokenKey, 0, true);

      assert.equal(toBN(await tokens[1].balanceOf(RECIPIENT)).toString(), totalReserves.toString());
      assert.equal(toBN(await liquidityPool.totalReserves()).toString(), 0);
    });

    it("should correctly withdraw part of all funds", async () => {
      const totalReserves = toBN(await liquidityPool.totalReserves());

      await systemPoolsRegistry.withdrawReservedFunds(RECIPIENT, tokenKey, totalReserves.idiv(2), false);

      assert.equal(toBN(await tokens[1].balanceOf(RECIPIENT)).toString(), totalReserves.idiv(2).toString());
      assert.closeTo(toBN(await liquidityPool.totalReserves()).toNumber(), totalReserves.idiv(2).toNumber(), 5);
    });

    it("should get exception if not enough reserved funds", async () => {
      const totalReserves = toBN(await liquidityPool.totalReserves());

      const reason = "LiquidityPool: Not enough reserved funds.";

      await truffleAssert.reverts(
        systemPoolsRegistry.withdrawReservedFunds(RECIPIENT, tokenKey, totalReserves.plus(1), false),
        reason
      );
    });

    it("should get exception if called not by an SYSTEM_POOLS_RESERVE_FUNDS_MANAGER or ROLE_MANAGER_ADMIN", async () => {
      const SYSTEM_POOLS_RESERVE_FUNDS_MANAGER_ROLE = utils.keccak256(
        utils.toUtf8Bytes("SYSTEM_POOLS_RESERVE_FUNDS_MANAGER")
      );
      const reason = `RoleManager: account is missing role ${SYSTEM_POOLS_RESERVE_FUNDS_MANAGER_ROLE}`;

      await truffleAssert.reverts(
        systemPoolsRegistry.withdrawReservedFunds(RECIPIENT, tokenKey, 0, true, { from: USER1 }),
        reason
      );
    });

    it("should get exception if called directly and not form systemPoolsregistry", async () => {
      const reason = "AbstractPool: Caller not a SystemPoolsRegistry.";

      await truffleAssert.reverts(nativePool.withdrawReservedFunds(RECIPIENT, 0, true, { from: USER1 }), reason);
    });

    it("should get exception if try to withdraw non-existent asset", async () => {
      const reason = "SystemPoolsRegistry: Pool doesn't exist.";

      const tokenKey1 = toBytes("Token1");

      await truffleAssert.reverts(systemPoolsRegistry.withdrawReservedFunds(RECIPIENT, tokenKey1, 0, true), reason);
    });

    it("should get exception if try to withdraw zero amount", async () => {
      const reason = "SystemPoolsRegistry: Amount to withdraw must be greater than zero.";

      await truffleAssert.reverts(systemPoolsRegistry.withdrawReservedFunds(RECIPIENT, tokenKey, 0, false), reason);
    });
  });

  describe("withdrawAllReservedFunds", () => {
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

      await systemPoolsRegistry.withdrawAllReservedFunds(RECIPIENT, 0, 2);

      assert.equal(toBN(await tokens[1].balanceOf(RECIPIENT)).toString(), totalReserves.toString());
      assert.equal(toBN(await liquidityPool.totalReserves()).toString(), 0);
    });

    it("should get exception if called not by an SYSTEM_POOLS_RESERVE_FUNDS_MANAGER or ROLE_MANAGER_ADMIN", async () => {
      const SYSTEM_POOLS_RESERVE_FUNDS_MANAGER_ROLE = utils.keccak256(
        utils.toUtf8Bytes("SYSTEM_POOLS_RESERVE_FUNDS_MANAGER")
      );
      const reason = `RoleManager: account is missing role ${SYSTEM_POOLS_RESERVE_FUNDS_MANAGER_ROLE}`;

      await truffleAssert.reverts(
        systemPoolsRegistry.withdrawAllReservedFunds(RECIPIENT, 0, 2, { from: USER2 }),
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
      await tokens[2].approveArbitraryBatch(batPool.address, [USER3], [tokensAmount]);

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
      await createLiquidityPool(aaveKey, tokens[4], "AAVE", true);

      await defiCore.addLiquidity(aaveKey, liquidityAmount.times(3));

      await defiCore.borrowFor(batKey, amountToBorrow.idiv(2), USER2, { from: USER2 });
      await defiCore.borrowFor(aaveKey, amountToBorrow.idiv(2), USER2, { from: USER2 });

      await tokenChainlinkOracle.setPrice(toBN(85).times(toBN(10).pow(chainlinkPriceDecimals)));

      await liquidityPool.updateCompoundRate(false);

      await tokens[2].mintArbitrary(USER3, tokensAmount);
      await tokens[2].approveArbitraryBatch(batPool.address, [USER3], [tokensAmount]);

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

    it("should correctly repay debt in native pool", async () => {
      const amountToLiquidate = wei(20);

      await tokens[1].mintArbitrary(USER3, tokensAmount);
      await tokens[1].approveArbitraryBatch(liquidityPool.address, [USER3], [tokensAmount]);

      await defiCore.addLiquidity(tokenKey, liquidityAmount.idiv(10), { from: USER3 });
      await defiCore.addLiquidity(nativeTokenKey, liquidityAmount, { from: USER2, value: liquidityAmount });

      await defiCore.borrowFor(nativeTokenKey, amountToBorrow, USER3, { from: USER3 });

      const newPrice = toBN(75);
      await tokenChainlinkOracle.setPrice(wei(newPrice, chainlinkPriceDecimals));

      await nativeToken.deposit({ from: USER2, value: amountToLiquidate });

      const balanceBefore = toBN(await web3.eth.getBalance(USER2));

      await defiCore.liquidation(USER3, tokenKey, nativeTokenKey, amountToLiquidate.times(1.5), {
        from: USER2,
        value: amountToLiquidate,
      });

      const balanceAfter = toBN(await web3.eth.getBalance(USER2));

      assert.equal((await nativeToken.balanceOf(USER2)).toString(), 0);
      assert.closeTo(
        balanceBefore.minus(balanceAfter).toNumber(),
        amountToLiquidate.idiv(2).toNumber(),
        oneToken.idiv(10).toNumber()
      );
      assert.closeTo(
        (await defiCore.getUserBorrowedAmount(USER3, nativeTokenKey)).toNumber(),
        amountToBorrow.minus(amountToLiquidate.times(1.5)).toNumber(),
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
      somePool = await LiquidityPool.at(await getLiquidityPoolAddr(someKey));

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

    it("should correctly repay debt in native pool", async () => {
      await defiCore.addLiquidity(nativeTokenKey, liquidityAmount, { from: OWNER, value: liquidityAmount });
      await defiCore.borrowFor(tokenKey, borrowAmount.idiv(7), OWNER, { from: OWNER });

      const newPrice = toBN(115);
      await tokenChainlinkOracle.setPrice(wei(newPrice, chainlinkPriceDecimals));

      const balanceBefore = toBN(await web3.eth.getBalance(USER2));

      await defiCore.liquidation(OWNER, nativeTokenKey, tokenKey, wei(3), { from: USER2 });

      const balanceAfter = toBN(await web3.eth.getBalance(USER2));
      const expectedReceiveAmount = wei(37.5);

      assert.closeTo(
        balanceAfter.minus(balanceBefore).toNumber(),
        expectedReceiveAmount.toNumber(),
        oneToken.idiv(10).toNumber()
      );
      assert.closeTo(
        (await defiCore.getUserLiquidityAmount(OWNER, nativeTokenKey)).toNumber(),
        liquidityAmount.minus(expectedReceiveAmount).toNumber(),
        oneToken.idiv(1000).toNumber()
      );
    });

    it("should get exception if a pool called directly, not via the defiCore contract", async () => {
      const reason = "AbstractPool: Caller not a DefiCore.";
      const price = toBN(86);

      await tokenChainlinkOracle.setPrice(price.times(priceDecimals));

      await truffleAssert.reverts(liquidityPool.liquidate(USER1, USER2, liquidityAmount), reason);
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
