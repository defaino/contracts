const { toBytes, compareKeys, deepCompareKeys } = require("./helpers/bytesCompareLibrary");
const { getInterestRateLibraryAddr } = require("./helpers/coverage-helper");
const { toBN, accounts, getPrecision, getPercentage100, wei } = require("../scripts/utils/utils");
const { ZERO_ADDR } = require("../scripts/utils/constants");

const { setNextBlockTime, setTime, mine, getCurrentBlockTime } = require("./helpers/block-helper");
const truffleAssert = require("truffle-assertions");
const Reverter = require("./helpers/reverter");
const { web3 } = require("hardhat");
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
const StablePool = artifacts.require("StablePool");
const PriceManager = artifacts.require("PriceManager");
const InterestRateLibrary = artifacts.require("InterestRateLibrary");
const Prt = artifacts.require("PRT");
const WETH = artifacts.require("WETH");
const StablePermitToken = artifacts.require("StablePermitTokenMock");

const MockERC20 = artifacts.require("MockERC20");
const ChainlinkOracleMock = artifacts.require("ChainlinkOracleMock");

MockERC20.numberFormat = "BigNumber";
DefiCore.numberFormat = "BigNumber";
LiquidityPool.numberFormat = "BigNumber";
UserInfoRegistry.numberFormat = "BigNumber";
WETH.numberFormat = "BigNumber";

describe("PRT", () => {
  const reverter = new Reverter();

  let OWNER;
  let USER1;
  let USER2;

  let registry;
  let defiCore;
  let assetParameters;
  let systemParameters;
  let userInfoRegistry;
  let systemPoolsRegistry;
  let rewardsDistribution;
  let prt;

  let nativePool;
  let daiPool;

  const tokens = [];

  let daiChainlinkOracle;
  let wEthChainlinkOracle;

  let rewardsToken;
  let nativeToken;

  const oneToken = wei(1);
  const tokensAmount = wei(1000000000);
  const colRatio = getPercentage100().times("1.25");
  const reserveFactor = getPrecision().times("15");

  const annualBorrowRate = getPrecision().times(3);
  const firstSlope = getPrecision().times(4);
  const secondSlope = getPercentage100();
  const utilizationBreakingPoint = getPrecision().times(80);
  const maxUR = getPrecision().times(95);
  const liquidationDiscount = getPrecision().times(8);
  const liquidationBoundary = getPrecision().times(50);

  const priceDecimals = wei(1, 8);
  const chainlinkPriceDecimals = toBN(8);

  const minSupplyDistributionPart = getPrecision().times(10);
  const minBorrowDistributionPart = getPrecision().times(10);

  const zeroKey = toBytes("");
  const daiKey = toBytes("DAI");
  const wEthKey = toBytes("WETH");
  const usdtKey = toBytes("USDT");
  const rewardsTokenKey = toBytes("RTK");
  const nativeTokenKey = toBytes("BNB");
  const stableKey = toBytes("ST");

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

  async function createLiquidityPool(assetKey, asset, symbol, isCollateral, isRewardsPool) {
    const chainlinkOracle = await ChainlinkOracleMock.new(wei(100, chainlinkPriceDecimals), chainlinkPriceDecimals);

    await systemPoolsRegistry.addLiquidityPool(
      asset.address,
      assetKey,
      chainlinkOracle.address,
      symbol,
      isCollateral,
      isCollateral
    );

    if (!isRewardsPool && assetKey != nativeTokenKey) {
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

  function convertToUSD(amountToConvert, price = toBN(100)) {
    return amountToConvert.times(price).times(priceDecimals).idiv(oneToken);
  }

  function convertFromUSD(amountToConvert, price = toBN(100)) {
    return amountToConvert.times(oneToken).idiv(priceDecimals.times(price));
  }

  function convertToBorrowLimit(amountToConvert, convertColRatio = colRatio, isConvertToUSD = true) {
    if (isConvertToUSD) {
      return convertToUSD(amountToConvert.times(getPercentage100()).idiv(convertColRatio));
    }

    return amountToConvert.times(getPercentage100()).idiv(convertColRatio);
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
    userInfoRegistry = await UserInfoRegistry.at(await registry.getUserInfoRegistryContract());
    systemPoolsRegistry = await SystemPoolsRegistry.at(await registry.getSystemPoolsRegistryContract());
    rewardsDistribution = await RewardsDistribution.at(await registry.getRewardsDistributionContract());
    systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());
    prt = await Prt.at(await registry.getPRTContract());

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
    await deployTokens(["DAI", "WETH", "USDT"]);
    tokens.push(nativeToken);

    await defiCore.defiCoreInitialize();
    await systemPoolsRegistry.systemPoolsRegistryInitialize(_liquidityPoolImpl.address, nativeTokenKey, zeroKey);
    await prt.prtInitialize("Platform Reputation Token", "PRT", [
      [1000000000000, 100],
      [300000000000, 100],
    ]);

    await systemPoolsRegistry.addPoolsBeacon(1, _stablePoolImpl.address);
    await systemParameters.setupStablePoolsAvailability(true);

    await createLiquidityPool(rewardsTokenKey, tokens[0], await rewardsToken.symbol(), true, true);
    await createStablePool(stableKey, stableToken.address);

    daiChainlinkOracle = await createLiquidityPool(daiKey, tokens[1], "DAI", true, false);
    wEthChainlinkOracle = await createLiquidityPool(wEthKey, tokens[2], "WETH", true, false);
    usdtChainlinkOracle = await createLiquidityPool(usdtKey, tokens[3], "USDT", true, false);

    await createLiquidityPool(nativeTokenKey, tokens[4], "BNB", true, false);

    usdtPool = await LiquidityPool.at(await getLiquidityPoolAddr(usdtKey));
    nativePool = await LiquidityPool.at(await getLiquidityPoolAddr(nativeTokenKey));
    daiPool = await LiquidityPool.at(await getLiquidityPoolAddr(daiKey));

    await systemParameters.setupLiquidationBoundary(liquidationBoundary);
    await systemParameters.setRewardsTokenAddress(ZERO_ADDR);

    // await rewardsDistribution.setupRewardsPerBlockBatch(
    //   [daiKey, wEthKey, usdtKey, rewardsTokenKey, nativeTokenKey],
    //   [wei(2), oneToken, wei(5), oneToken, oneToken]
    // );

    await rewardsToken.mintArbitrary(defiCore.address, tokensAmount);
    await nativeToken.approve(nativePool.address, tokensAmount);

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("mintPRT", () => {
    it("should revert if the deposit criteria hasn't been met (no deposit at all)", async () => {
      const liquidityAmount = wei(10000);
      const amountToBorrow = wei(3000);
      let price = wei(1, 7);
      await daiChainlinkOracle.setPrice(price);
      await defiCore.addLiquidity(daiKey, liquidityAmount, { from: USER1 });

      let reason = "PRT: No eligible action found";
      await truffleAssert.reverts(prt.mintPRT({ from: USER1 }), reason);
    });

    it("should revert if the deposit criteria hasn't been met in terms of the deposit amount in USD", async () => {
      const liquidityAmount = wei(10000);
      const amountToBorrow = wei(3000);
      let price = wei(1, 7);

      await daiChainlinkOracle.setPrice(price);
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(10), { from: USER1 });

      price = wei(1, 2);
      await daiChainlinkOracle.setPrice(price);
      await mine(100);

      let reason = "PRT: The user USD amount is lower than the minimum required";
      await truffleAssert.reverts(prt.mintPRT({ from: USER1 }), reason);
    });

    it("should revert if the borrow criteria hasn't been met (no borrow at all))", async () => {
      const liquidityAmount = wei(10000);
      const amountToBorrow = wei(3000);
      let price = wei(1, 7);

      await daiChainlinkOracle.setPrice(price);
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(10), { from: USER1 });
      await mine(100);

      await usdtChainlinkOracle.setPrice(price);
      await usdtPool.updateCompoundRate(false);

      await defiCore.addLiquidity(usdtKey, amountToBorrow.times(20), { from: USER2 });
      await defiCore.borrowFor(usdtKey, amountToBorrow.times(1), USER1, { from: USER1 });

      let reason = "PRT: No eligible action found";
      await truffleAssert.reverts(prt.mintPRT({ from: USER1 }), reason);
    });

    it("should revert if the borrow criteria hasn't been met in terms of the borrow amount in USD", async () => {
      const liquidityAmount = wei(10000);
      const amountToBorrow = wei(3000);
      let price = wei(1, 7);

      await daiChainlinkOracle.setPrice(price);
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(10), { from: USER1 });

      await usdtChainlinkOracle.setPrice(price);
      await usdtPool.updateCompoundRate(false);

      await defiCore.addLiquidity(usdtKey, amountToBorrow.times(20), { from: USER2 });
      await defiCore.borrowFor(usdtKey, amountToBorrow.times(11), USER1, { from: USER1 });

      price = wei(1, 2);
      await usdtChainlinkOracle.setPrice(price);
      await mine(100);

      let reason = "PRT: The user USD amount is lower than the minimum required";
      await truffleAssert.reverts(prt.mintPRT({ from: USER1 }), reason);
    });

    it("should revert if the repay criteria hasn't been met", async () => {
      const liquidityAmount = wei(10000);
      const amountToBorrow = wei(3000);
      let price = wei(1, 7);

      await daiChainlinkOracle.setPrice(price);
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(10), { from: USER1 });

      await usdtChainlinkOracle.setPrice(price);
      await usdtPool.updateCompoundRate(false);

      await defiCore.addLiquidity(usdtKey, amountToBorrow.times(20), { from: USER2 });
      await defiCore.borrowFor(usdtKey, amountToBorrow.times(10), USER1, { from: USER1 });
      await mine(100);

      let reason = "PRT: can't mint PRT since the user hasn't ever used the repay function";
      await truffleAssert.reverts(prt.mintPRT({ from: USER1 }), reason);
    });

    it("should revert if not enouth time has passed since the criteria fullfilled", async () => {
      const liquidityAmount = wei(10000);
      const amountToBorrow = wei(3000);
      let price = wei(1, 7);

      await daiChainlinkOracle.setPrice(price);
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(10), { from: USER1 });

      await usdtChainlinkOracle.setPrice(price);
      await usdtPool.updateCompoundRate(false);

      await defiCore.addLiquidity(usdtKey, amountToBorrow.times(20), { from: USER2 });
      await defiCore.borrowFor(usdtKey, amountToBorrow.times(10), USER1, { from: USER1 });
      await mine(10);

      let reason = "PRT: Not enough time since the eligible action";
      await truffleAssert.reverts(prt.mintPRT({ from: USER1 }), reason);
    });
    it("should revert if there was a liquidation", async () => {
      const liquidityAmount = wei(10000);
      const amountToBorrow = wei(3000);
      let price = wei(1, 7);

      await daiChainlinkOracle.setPrice(price);
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(200), { from: USER1 });

      await usdtChainlinkOracle.setPrice(price);
      await usdtPool.updateCompoundRate(false);

      await defiCore.addLiquidity(usdtKey, amountToBorrow.times(300), { from: USER2 });
      await defiCore.borrowFor(usdtKey, amountToBorrow.times(20), USER1, { from: USER1 });

      let amountToRepayBorrow = amountToBorrow;

      await defiCore.repayBorrow(usdtKey, amountToRepayBorrow, false, { from: USER1 });

      price = wei(1, 8);
      liquidateAmount = await userInfoRegistry.getMaxLiquidationQuantity(USER1, daiKey, usdtKey);
      await usdtChainlinkOracle.setPrice(price.times(priceDecimals));

      await defiCore.liquidation(USER1, daiKey, usdtKey, liquidateAmount, { from: USER2 });
      await mine(100);

      let reason = "PRT: can't mint PRT because the user has been liquidated";
      await truffleAssert.reverts(prt.mintPRT({ from: USER1 }), reason);
    });

    it("should successfully mint if user hasn't minted the PRT yet and fullfilled the requrements", async () => {
      const liquidityAmount = wei(10000);
      const amountToBorrow = wei(3000);
      let price = wei(1, 7);

      await daiChainlinkOracle.setPrice(price);
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(10), { from: USER1 });

      await usdtChainlinkOracle.setPrice(price);
      await usdtPool.updateCompoundRate(false);

      await defiCore.addLiquidity(usdtKey, amountToBorrow.times(20), { from: USER2 });
      await defiCore.borrowFor(usdtKey, amountToBorrow.times(11), USER1, { from: USER1 });

      let amountToRepayBorrow = amountToBorrow;

      await defiCore.repayBorrow(usdtKey, amountToRepayBorrow, false, { from: USER1 });
      await mine(100);
      await truffleAssert.passes(prt.mintPRT({ from: USER1 }));
    });
    it("should should revert if the PRT has already been minted by the user", async () => {
      const liquidityAmount = wei(10000);
      const amountToBorrow = wei(3000);
      let price = wei(1, 7);

      await daiChainlinkOracle.setPrice(price);
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(10), { from: USER1 });

      await usdtChainlinkOracle.setPrice(price);
      await usdtPool.updateCompoundRate(false);

      await defiCore.addLiquidity(usdtKey, amountToBorrow.times(20), { from: USER2 });
      await defiCore.borrowFor(usdtKey, amountToBorrow.times(11), USER1, { from: USER1 });

      let amountToRepayBorrow = amountToBorrow;

      await defiCore.repayBorrow(usdtKey, amountToRepayBorrow, false, { from: USER1 });
      await mine(100);
      await truffleAssert.passes(prt.mintPRT({ from: USER1 }));

      let reason = "PRT: user has already minted a PRT token";
      await truffleAssert.reverts(prt.mintPRT({ from: USER1 }), reason);
    });
  });

  describe("transfer()", () => {
    it("should revert if user tries to transfer the PRT to another account", async () => {
      const liquidityAmount = wei(10000);
      const amountToBorrow = wei(3000);
      let price = wei(1, 7);

      await daiChainlinkOracle.setPrice(price);
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(10), { from: USER1 });

      await usdtChainlinkOracle.setPrice(price);
      await usdtPool.updateCompoundRate(false);

      await defiCore.addLiquidity(usdtKey, amountToBorrow.times(20), { from: USER2 });
      await defiCore.borrowFor(usdtKey, amountToBorrow.times(11), USER1, { from: USER1 });

      let amountToRepayBorrow = amountToBorrow;

      await defiCore.repayBorrow(usdtKey, amountToRepayBorrow, false, { from: USER1 });
      await mine(100);

      await prt.mintPRT({ from: USER1 });
      let reason = "PRT: PRT token is non-transferrable";
      await truffleAssert.reverts(prt.transferFrom(USER1, USER2, 0, { from: USER1 }), reason);
    });
  });

  describe("burn()", () => {
    it("should revert if user tries to burn the PRT of the other user", async () => {
      const liquidityAmount = wei(10000);
      const amountToBorrow = wei(3000);
      let price = wei(1, 7);

      await daiChainlinkOracle.setPrice(price);
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(10), { from: USER1 });

      await usdtChainlinkOracle.setPrice(price);
      await usdtPool.updateCompoundRate(false);

      await defiCore.addLiquidity(usdtKey, amountToBorrow.times(20), { from: USER2 });
      await defiCore.borrowFor(usdtKey, amountToBorrow.times(11), USER1, { from: USER1 });

      let amountToRepayBorrow = amountToBorrow;

      await defiCore.repayBorrow(usdtKey, amountToRepayBorrow, false, { from: USER1 });
      await mine(100);

      await prt.mintPRT({ from: USER1 });
      let reason = "PRT: the caller isn't an owner of the token with a such id";
      await truffleAssert.reverts(prt.burn(0, { from: USER2 }), reason);
      assert.equal((await prt.balanceOf(USER1)).toString(), 1);
    });
    it("should pass if the user tries to burn his PRT", async () => {
      const liquidityAmount = wei(10000);
      const amountToBorrow = wei(3000);
      let price = wei(1, 7);

      await daiChainlinkOracle.setPrice(price);
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(10), { from: USER1 });

      await usdtChainlinkOracle.setPrice(price);
      await usdtPool.updateCompoundRate(false);

      await defiCore.addLiquidity(usdtKey, amountToBorrow.times(20), { from: USER2 });
      await defiCore.borrowFor(usdtKey, amountToBorrow.times(11), USER1, { from: USER1 });

      let amountToRepayBorrow = amountToBorrow;

      await defiCore.repayBorrow(usdtKey, amountToRepayBorrow, false, { from: USER1 });
      await mine(100);

      await prt.mintPRT({ from: USER1 });
      assert.equal((await prt.balanceOf(USER1)).toString(), 1);
      await truffleAssert.passes(prt.burn(0, { from: USER1 }));
      assert.equal((await prt.balanceOf(USER1)).toString(), 0);
    });
  });

  describe("getPRTParams()", () => {
    it("should return correct values", async () => {
      let prtParams = await prt.getPRTParams();
      assert.equal(toBN(prtParams[0].minAmountInUSD).toString(), 1000000000000);
      assert.equal(toBN(prtParams[0].minTimeAfter).toString(), 100);
      assert.equal(toBN(prtParams[1].minAmountInUSD).toString(), 300000000000);
      assert.equal(toBN(prtParams[1].minTimeAfter).toString(), 100);
    });
  });

  describe("updatePRTRarams()", () => {
    it("should revert if not the system owner tries to update the PRT params", async () => {
      let reason = "PRT: Only system owner can call this function";
      await truffleAssert.reverts(
        prt.updatePRTParams(
          [
            [1000000000000, 100],
            [300000000000, 100],
          ],
          { from: USER1 }
        ),
        reason
      );
    });
    it("should pass if the system owner tries to update the PRT params", async () => {
      await truffleAssert.passes(
        prt.updatePRTParams([
          [3000000000000, 100],
          [300000000000, 100],
        ])
      );

      let prtParams = await prt.getPRTParams();
      assert.equal(toBN(prtParams[0].minAmountInUSD).toString(), 3000000000000);
    });
  });

  describe("hasValidPRT()", () => {
    it("should return true if a user has minted a PRT and was not liquidated", async () => {
      const liquidityAmount = wei(10000);
      const amountToBorrow = wei(3000);
      let price = wei(1, 7);

      await daiChainlinkOracle.setPrice(price);
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(10), { from: USER1 });

      await usdtChainlinkOracle.setPrice(price);
      await usdtPool.updateCompoundRate(false);

      await defiCore.addLiquidity(usdtKey, amountToBorrow.times(20), { from: USER2 });
      await defiCore.borrowFor(usdtKey, amountToBorrow.times(11), USER1, { from: USER1 });

      let amountToRepayBorrow = amountToBorrow;

      await defiCore.repayBorrow(usdtKey, amountToRepayBorrow, false, { from: USER1 });
      await mine(100);
      await prt.mintPRT({ from: USER1 });

      assert.isTrue(await prt.hasValidPRT(USER1));
    });
    it("should return false if user has minted a PRT and then was liquidated", async () => {
      const liquidityAmount = wei(10000);
      const amountToBorrow = wei(3000);
      let price = wei(1, 7);

      await daiChainlinkOracle.setPrice(price);
      await defiCore.addLiquidity(daiKey, liquidityAmount.times(200), { from: USER1 });

      await usdtChainlinkOracle.setPrice(price);
      await usdtPool.updateCompoundRate(false);

      await defiCore.addLiquidity(usdtKey, amountToBorrow.times(300), { from: USER2 });
      await defiCore.borrowFor(usdtKey, amountToBorrow.times(20), USER1, { from: USER1 });

      let amountToRepayBorrow = amountToBorrow;

      await defiCore.repayBorrow(usdtKey, amountToRepayBorrow, false, { from: USER1 });

      await mine(100);

      await truffleAssert.passes(prt.mintPRT({ from: USER1 }));
      assert.isTrue(await prt.hasValidPRT(USER1));

      price = wei(1, 8);
      liquidateAmount = await userInfoRegistry.getMaxLiquidationQuantity(USER1, daiKey, usdtKey);
      await usdtChainlinkOracle.setPrice(price.times(priceDecimals));

      await defiCore.liquidation(USER1, daiKey, usdtKey, liquidateAmount, { from: USER2 });
      assert.isFalse(await prt.hasValidPRT(USER1));
    });
  });
});
