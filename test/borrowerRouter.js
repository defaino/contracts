const Registry = artifacts.require("Registry");
const SystemParameters = artifacts.require("SystemParameters");
const BorrowerRouter = artifacts.require("BorrowerRouterMock");
const LiquidityPoolRegistry = artifacts.require("LiquidityPoolRegistryMock");

const MockERC20 = artifacts.require("MockERC20");
const YearnVaultMock = artifacts.require("YearnVaultMock");
const VaultRegistryMock = artifacts.require("VaultRegistryMock");
const CurvePoolMock = artifacts.require("CurvePoolMock");
const CurveZapMock = artifacts.require("CurveZapMock");
const CurveRegistryMock = artifacts.require("CurveRegistryMock");

const Reverter = require("./helpers/reverter");
const { assert } = require("chai");

const { toBN, oneToken, getOnePercent } = require("../scripts/globals");

const truffleAssert = require("truffle-assertions");

contract("borrowerRouter", async (accounts) => {
  const reverter = new Reverter(web3);

  const ADDRESS_NULL = "0x0000000000000000000000000000000000000000";

  const OWNER = accounts[0];
  const USER1 = accounts[1];
  const USER2 = accounts[2];
  const LIQUIDITY_POOL = accounts[7];
  const INTEGRATION_CORE = accounts[8];
  const NOTHING = accounts[9];

  let registry;
  let borrowerRouter;
  let borrowerRouter2;

  let basePool;
  let baseToken;

  let curveRegistry;
  let vaultRegistry;
  let depositContract;

  const numberOfBaseCoins = 3;
  const baseCoins = [];
  const lpTokens = [];

  const tokensAmount = oneToken(18).times(10000);
  const decimal = getOnePercent().times(100);

  let amountToDeposit = oneToken(18).times(100);

  let underlyingCoins1;

  function convertToLP(number, exchangeRate) {
    return number.times(decimal).idiv(exchangeRate);
  }

  function convertFromLP(number, exchangeRate) {
    return number.times(exchangeRate).idiv(decimal);
  }

  async function saveCoins(array, numberOfCoins) {
    for (let i = 0; i < numberOfCoins; i++) {
      array.push((await MockERC20.new("Test Coin" + i, "TC" + i)).address);
    }
  }

  async function mintAndApprove(spender, coins) {
    for (let i = 0; i < coins.length; i++) {
      const token = await MockERC20.at(coins[i]);

      await token.mintArbitraryBatch([OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);
      await token.approveArbitraryBacth(spender, [OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);
    }
  }

  async function deployMetaPool() {
    const currentUnderlyingCoins = [];
    const currentCoins = [];

    const metaToken = await MockERC20.new("Test Meta", "TM");
    lpTokens.push(metaToken.address);

    await saveCoins(currentCoins, 1);
    currentCoins.push(baseToken.address);

    currentUnderlyingCoins.push(currentCoins[0]);
    for (let i = 0; i < numberOfBaseCoins; i++) {
      currentUnderlyingCoins.push(baseCoins[i]);
    }

    const metaPool = await CurvePoolMock.new(true, metaToken.address, currentCoins, currentUnderlyingCoins);

    await curveRegistry.addPool(metaPool.address, metaToken.address);

    await mintAndApprove(depositContract.address, currentUnderlyingCoins);

    return currentUnderlyingCoins;
  }

  async function deployVaults(tokensAddr) {
    for (const tokenAddr of tokensAddr) {
      const newVault = await YearnVaultMock.new("Test Vault", "TV", tokenAddr);

      await vaultRegistry.addVault(tokenAddr, newVault.address);
    }
  }

  function checkDepositEvent(txReceipt, assetAddr, vaultTokenAddr, assetAmount, vaultTokenAmount) {
    assert.equal(txReceipt.receipt.logs[0].event, "AssetDeposited");
    assert.equal(txReceipt.receipt.logs[0].args._assetAddr, assetAddr);
    assert.equal(txReceipt.receipt.logs[0].args._vaultTokenAddr, vaultTokenAddr);
    assert.equal(toBN(txReceipt.receipt.logs[0].args._assetAmount).toString(), assetAmount.toString());
    assert.equal(toBN(txReceipt.receipt.logs[0].args._vaultTokenAmount).toString(), vaultTokenAmount.toString());
  }

  function checkWithdrawEvents(txReceipt, assetAddr, vaultTokenAddr, assetAmountReceived, userInterest) {
    let withdrawLogIndex = 0;

    if (txReceipt.receipt.logs.length == 2) {
      withdrawLogIndex = 1;

      assert.equal(txReceipt.receipt.logs[0].event, "InterestPaid");
      assert.equal(txReceipt.receipt.logs[0].args._recipientAddr, USER1);
      assert.equal(txReceipt.receipt.logs[0].args._assetAddr, assetAddr);
      assert.equal(toBN(txReceipt.receipt.logs[0].args._rewardAmount).toString(), userInterest.toString());
    }

    assert.equal(txReceipt.receipt.logs[withdrawLogIndex].event, "AssetWithdrawn");
    assert.equal(txReceipt.receipt.logs[withdrawLogIndex].args._assetAddr, assetAddr);
    assert.equal(txReceipt.receipt.logs[withdrawLogIndex].args._vaultTokenAddr, vaultTokenAddr);
    assert.equal(
      toBN(txReceipt.receipt.logs[withdrawLogIndex].args._assetAmountReceived).toString(),
      assetAmountReceived.toString()
    );
  }

  async function checkDeposit(assetAddr, lpTokenAddr, expectedLPAmount, expectedTotalLPAmount) {
    const txReceipt = await borrowerRouter.deposit(assetAddr, lpTokenAddr, { from: INTEGRATION_CORE });

    assert.equal(
      toBN(await borrowerRouter.depositOfAssetInToken(lpTokenAddr, assetAddr)).toString(),
      expectedLPAmount.toString()
    );

    const vaultDepositInfo = await borrowerRouter.vaultsDepoitInfo(lpTokenAddr);

    const vault = await YearnVaultMock.at(await vaultRegistry.latestVault(lpTokenAddr));

    assert.equal(toBN(vaultDepositInfo.amountInVaultToken).toString(), expectedTotalLPAmount.toString());
    assert.equal(vaultDepositInfo.vaultAddr, vault.address);

    const token = await MockERC20.at(lpTokenAddr);

    assert.equal(toBN(await vault.balanceOf(borrowerRouter.address)).toString(), expectedTotalLPAmount.toString());
    assert.equal(toBN(await token.balanceOf(borrowerRouter.address)).toString(), 0);
    assert.equal(toBN(await token.balanceOf(vault.address)).toString(), expectedTotalLPAmount.toString());

    checkDepositEvent(txReceipt, assetAddr, lpTokenAddr, amountToDeposit, expectedLPAmount);
  }

  before("setup", async () => {
    registry = await Registry.new();
    borrowerRouter = await BorrowerRouter.new();
    borrowerRouter2 = await BorrowerRouter.new();

    const _liquidityPoolRegistry = await LiquidityPoolRegistry.new();
    const _systemParameters = await SystemParameters.new();

    await registry.addProxyContract(await registry.SYSTEM_PARAMETERS_NAME(), _systemParameters.address);
    await registry.addProxyContract(await registry.LIQUIDITY_POOL_REGISTRY_NAME(), _liquidityPoolRegistry.address);

    await registry.addContract(await registry.INTEGRATION_CORE_NAME(), INTEGRATION_CORE);

    const liquidityPoolRegistry = await LiquidityPoolRegistry.at(await registry.getLiquidityPoolRegistryContract());
    const systemParameters = await SystemParameters.at(await registry.getSystemParametersContract());

    await systemParameters.systemParametersInitialize();
    await liquidityPoolRegistry.liquidityPoolRegistryInitialize();
    await borrowerRouter.borrowerRouterInitialize(registry.address, USER1);
    await borrowerRouter2.borrowerRouterInitialize(registry.address, OWNER);

    curveRegistry = await CurveRegistryMock.new();
    vaultRegistry = await VaultRegistryMock.new();

    baseToken = await MockERC20.new("Test 3Crv", "T3Crv");

    lpTokens.push(baseToken.address);

    await saveCoins(baseCoins, numberOfBaseCoins);

    basePool = await CurvePoolMock.new(false, baseToken.address, baseCoins, baseCoins);
    await curveRegistry.addPool(basePool.address, baseToken.address);

    depositContract = await CurveZapMock.new(basePool.address, baseToken.address);

    await mintAndApprove(depositContract.address, baseCoins);

    await systemParameters.setupCurveRegistry(curveRegistry.address);
    await systemParameters.setupYEarnRegistry(vaultRegistry.address);
    await systemParameters.setupCurveZap(depositContract.address);

    underlyingCoins1 = await deployMetaPool();
    await deployMetaPool();
    await deployMetaPool();

    await deployVaults(baseCoins);
    await deployVaults(lpTokens);

    await liquidityPoolRegistry.setExistingLiquidityPool(LIQUIDITY_POOL);

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("deposit", async () => {
    let tokenAddr;

    beforeEach("setup", async () => {
      tokenAddr = baseCoins[1];

      await (await MockERC20.at(tokenAddr)).transfer(borrowerRouter.address, amountToDeposit, { from: OWNER });
    });

    it("should correctly deposit direct to yearn vault", async () => {
      await checkDeposit(tokenAddr, tokenAddr, amountToDeposit, amountToDeposit);
    });

    it("should correctly deposit direct to yearn vault", async () => {
      const newExchangeRate = getOnePercent().times(105);

      const vault = await YearnVaultMock.at(await vaultRegistry.latestVault(tokenAddr));
      await vault.setExchangeRate(newExchangeRate);

      const txReceipt = await borrowerRouter.deposit(tokenAddr, tokenAddr, { from: INTEGRATION_CORE });

      assert.equal(
        toBN(await borrowerRouter.depositOfAssetInToken(tokenAddr, tokenAddr)).toString(),
        amountToDeposit.toString()
      );

      const vaultDepositInfo = await borrowerRouter.vaultsDepoitInfo(tokenAddr);

      assert.equal(toBN(vaultDepositInfo.amountInVaultToken).toString(), amountToDeposit.toString());
      assert.equal(vaultDepositInfo.vaultAddr, vault.address);

      const token = await MockERC20.at(tokenAddr);

      const expectedSharesAmount = amountToDeposit.times(decimal).idiv(newExchangeRate);

      assert.equal(toBN(await vault.balanceOf(borrowerRouter.address)).toString(), expectedSharesAmount.toString());
      assert.equal(toBN(await token.balanceOf(borrowerRouter.address)).toString(), 0);
      assert.equal(toBN(await token.balanceOf(vault.address)).toString(), amountToDeposit.toString());

      checkDepositEvent(txReceipt, tokenAddr, tokenAddr, amountToDeposit, amountToDeposit);
    });

    it("should correctly deposit base lp tokens", async () => {
      const newExchangeRate = getOnePercent().times(105);
      await basePool.setExchangeRate(newExchangeRate);

      const expectedLPAmount = amountToDeposit.times(decimal).idiv(newExchangeRate);

      await checkDeposit(tokenAddr, baseToken.address, expectedLPAmount, expectedLPAmount);
    });

    it("should correctly deposit meta lp tokens", async () => {
      const newExchangeRate = getOnePercent().times(105);

      const metaPoolLPAddr = lpTokens[1];
      const metaPool = await CurvePoolMock.at(await curveRegistry.get_pool_from_lp_token(metaPoolLPAddr));

      await basePool.setExchangeRate(newExchangeRate);
      await metaPool.setExchangeRate(newExchangeRate);

      const expectedLPAmount = convertToLP(convertToLP(amountToDeposit, newExchangeRate), newExchangeRate);

      await checkDeposit(tokenAddr, metaPoolLPAddr, expectedLPAmount, expectedLPAmount);
    });

    it("should correctly deposit several tokens to one vault", async () => {
      const newExchangeRate = getOnePercent().times(105);

      const metaPoolLPAddr = lpTokens[1];
      const metaPool = await CurvePoolMock.at(await curveRegistry.get_pool_from_lp_token(metaPoolLPAddr));

      await basePool.setExchangeRate(newExchangeRate);
      await metaPool.setExchangeRate(newExchangeRate);

      const expectedLPAmount = convertToLP(convertToLP(amountToDeposit, newExchangeRate), newExchangeRate);

      await checkDeposit(tokenAddr, metaPoolLPAddr, expectedLPAmount, expectedLPAmount);

      const token2Addr = baseCoins[0];

      await (await MockERC20.at(token2Addr)).transfer(borrowerRouter.address, amountToDeposit, { from: OWNER });

      await checkDeposit(token2Addr, metaPoolLPAddr, expectedLPAmount, expectedLPAmount.times(2));
    });

    it("should get exception if vault with passed vault token addr not found", async () => {
      const reason = "BorrowerRouter: Incorrect vault token address.";

      await vaultRegistry.clearVaults(tokenAddr);

      await truffleAssert.reverts(borrowerRouter.deposit(tokenAddr, tokenAddr, { from: INTEGRATION_CORE }), reason);
    });

    it("should get exception if pool not found", async () => {
      const reason = "BorrowerRouter: Incorrect token address.";

      await truffleAssert.reverts(borrowerRouter.deposit(tokenAddr, NOTHING, { from: INTEGRATION_CORE }), reason);
    });

    it("should get exception if meta pool is unsupported", async () => {
      const reason = "BorrowerRouter: Unsupported meta pool.";

      const metaPoolLPAddr = lpTokens[1];
      const metaPool = await CurvePoolMock.at(await curveRegistry.get_pool_from_lp_token(metaPoolLPAddr));

      await metaPool.setBasePool(NOTHING);

      await truffleAssert.reverts(
        borrowerRouter.deposit(tokenAddr, metaPoolLPAddr, { from: INTEGRATION_CORE }),
        reason
      );
    });

    it("should get exception if number of coins greater than three", async () => {
      const reason = "BorrowerRouter: Incorrect number of coins in the pool.";

      const newNumbersOfBaseCoins = 4;
      const newBaseCoins = [];
      const baseToken2 = await MockERC20.new("Test 3Crv", "T3Crv");

      await saveCoins(newBaseCoins, newNumbersOfBaseCoins);

      const newBasePool = await CurvePoolMock.new(false, baseToken2.address, newBaseCoins, newBaseCoins);
      await curveRegistry.addPool(newBasePool.address, baseToken2.address);

      await truffleAssert.reverts(
        borrowerRouter.deposit(newBaseCoins[1], baseToken2.address, { from: INTEGRATION_CORE }),
        reason
      );
    });
  });

  describe("withdraw directly from yearn", async () => {
    let amountToWithdraw = oneToken(18).times(50);
    let tokenAddr;

    beforeEach("setup", async () => {
      tokenAddr = baseCoins[1];

      await (await MockERC20.at(tokenAddr)).transfer(borrowerRouter.address, amountToDeposit, { from: OWNER });
    });

    it("should correctly withdraw part of assets", async () => {
      await checkDeposit(tokenAddr, tokenAddr, amountToDeposit, amountToDeposit);

      const token = await MockERC20.at(tokenAddr);
      const vault = await YearnVaultMock.at(await vaultRegistry.latestVault(tokenAddr));

      const txReceipt = await borrowerRouter.withdraw(tokenAddr, tokenAddr, amountToWithdraw, false, {
        from: LIQUIDITY_POOL,
      });

      const expectedRemainder = amountToDeposit.minus(amountToWithdraw);

      assert.equal(
        toBN(await borrowerRouter.depositOfAssetInToken(tokenAddr, tokenAddr)).toString(),
        expectedRemainder.toString()
      );

      const vaultDepositInfo = await borrowerRouter.vaultsDepoitInfo(tokenAddr);

      assert.equal(toBN(vaultDepositInfo.amountInVaultToken).toString(), expectedRemainder.toString());
      assert.equal(vaultDepositInfo.vaultAddr, vault.address);

      assert.equal(toBN(await vault.balanceOf(borrowerRouter.address)).toString(), expectedRemainder.toString());
      assert.equal(toBN(await token.balanceOf(borrowerRouter.address)).toString(), 0);
      assert.equal(toBN(await token.balanceOf(vault.address)).toString(), expectedRemainder.toString());
      assert.equal(toBN(await token.balanceOf(LIQUIDITY_POOL)).toString(), amountToWithdraw.toString());

      checkWithdrawEvents(txReceipt, tokenAddr, tokenAddr, amountToWithdraw, 0);
    });

    it("should correctly withdraw all amount", async () => {
      await checkDeposit(tokenAddr, tokenAddr, amountToDeposit, amountToDeposit);

      const token = await MockERC20.at(tokenAddr);
      const vault = await YearnVaultMock.at(await vaultRegistry.latestVault(tokenAddr));

      amountToWithdraw = oneToken(18).times(110);
      const newExchangeRate = getOnePercent().times(105);

      await token.approveArbitraryBacth(vault.address, [OWNER], [tokensAmount]);
      await vault.methods["deposit(uint256)"](amountToDeposit, { from: OWNER });

      const totalVaultAmount = amountToDeposit.times(2);

      await vault.setExchangeRate(newExchangeRate);

      const txReceipt = await borrowerRouter.withdraw(tokenAddr, tokenAddr, amountToWithdraw, true, {
        from: LIQUIDITY_POOL,
      });

      const expectedReceivedAmount = amountToDeposit.times(newExchangeRate).idiv(decimal);

      assert.equal(toBN(await borrowerRouter.depositOfAssetInToken(tokenAddr, tokenAddr)).toString(), 0);

      const vaultDepositInfo = await borrowerRouter.vaultsDepoitInfo(tokenAddr);

      assert.equal(toBN(vaultDepositInfo.amountInVaultToken).toString(), 0);
      assert.equal(vaultDepositInfo.vaultAddr, ADDRESS_NULL);

      assert.equal(toBN(await vault.balanceOf(borrowerRouter.address)).toString(), 0);
      assert.equal(toBN(await token.balanceOf(borrowerRouter.address)).toString(), 0);
      assert.equal(
        toBN(await token.balanceOf(vault.address)).toString(),
        totalVaultAmount.minus(expectedReceivedAmount).toString()
      );
      assert.equal(toBN(await token.balanceOf(LIQUIDITY_POOL)).toString(), expectedReceivedAmount.toString());

      checkWithdrawEvents(txReceipt, tokenAddr, tokenAddr, expectedReceivedAmount, 0);
    });

    it("should correctly withdraw all amount and send interest for user", async () => {
      await checkDeposit(tokenAddr, tokenAddr, amountToDeposit, amountToDeposit);

      amountToWithdraw = amountToDeposit;
      const newExchangeRate = getOnePercent().times(105);

      const token = await MockERC20.at(tokenAddr);
      const vault = await YearnVaultMock.at(await vaultRegistry.latestVault(tokenAddr));

      await vault.setExchangeRate(newExchangeRate);

      await token.approveArbitraryBacth(vault.address, [OWNER], [tokensAmount]);
      await vault.methods["deposit(uint256)"](amountToDeposit, { from: OWNER });

      const totalVaultAmount = amountToDeposit.times(2);

      const userBalanceBeforeWithdraw = toBN(await token.balanceOf(USER1));

      const txReceipt = await borrowerRouter.withdraw(tokenAddr, tokenAddr, amountToWithdraw, true, {
        from: LIQUIDITY_POOL,
      });

      const userBalanceAfterWithdraw = toBN(await token.balanceOf(USER1));

      const expectedReceivedAmount = amountToDeposit.times(newExchangeRate).idiv(decimal);
      const expectedUserInterest = expectedReceivedAmount.minus(amountToWithdraw);

      assert.equal(userBalanceAfterWithdraw.minus(userBalanceBeforeWithdraw).toString(), expectedUserInterest);

      assert.equal(toBN(await borrowerRouter.depositOfAssetInToken(tokenAddr, tokenAddr)).toString(), 0);

      const vaultDepositInfo = await borrowerRouter.vaultsDepoitInfo(tokenAddr);

      assert.equal(toBN(vaultDepositInfo.amountInVaultToken).toString(), 0);
      assert.equal(vaultDepositInfo.vaultAddr, ADDRESS_NULL);

      assert.equal(toBN(await vault.balanceOf(borrowerRouter.address)).toString(), 0);
      assert.equal(toBN(await token.balanceOf(borrowerRouter.address)).toString(), 0);
      assert.equal(
        toBN(await token.balanceOf(vault.address)).toString(),
        totalVaultAmount.minus(expectedReceivedAmount).toString()
      );
      assert.equal(toBN(await token.balanceOf(LIQUIDITY_POOL)).toString(), amountToWithdraw.toString());

      checkWithdrawEvents(txReceipt, tokenAddr, tokenAddr, amountToWithdraw, expectedUserInterest);
    });

    it("should withdraw all and send to user account", async () => {
      await checkDeposit(tokenAddr, tokenAddr, amountToDeposit, amountToDeposit);

      const token = await MockERC20.at(tokenAddr);
      const currentBalance = toBN(await token.balanceOf(USER1));

      const txReceipt = await borrowerRouter.withdraw(tokenAddr, tokenAddr, 0, true, {
        from: LIQUIDITY_POOL,
      });

      assert.equal(
        toBN(await token.balanceOf(USER1))
          .minus(currentBalance)
          .toString(),
        amountToDeposit.toString()
      );

      assert.equal(txReceipt.receipt.logs[0].event, "InterestPaid");
      assert.equal(txReceipt.receipt.logs[0].args._recipientAddr, USER1);
      assert.equal(txReceipt.receipt.logs[0].args._assetAddr, tokenAddr);
      assert.equal(toBN(txReceipt.receipt.logs[0].args._rewardAmount).toString(), amountToDeposit.toString());
    });

    it("should get exception if nothing to withdraw", async () => {
      const reason = "BorrowerRouter: Nothing to withdraw.";

      await truffleAssert.reverts(
        borrowerRouter.withdraw(tokenAddr, tokenAddr, amountToWithdraw, true, { from: LIQUIDITY_POOL }),
        reason
      );
    });
  });

  describe("withdraw from meta pools", async () => {
    let amountToWithdraw = oneToken(18).times(50);
    let tokenAddr;

    beforeEach("setup", async () => {
      tokenAddr = baseCoins[1];

      await (await MockERC20.at(tokenAddr)).transfer(borrowerRouter.address, amountToDeposit, { from: OWNER });
      await (await MockERC20.at(tokenAddr)).transfer(borrowerRouter2.address, amountToDeposit, { from: OWNER });
    });

    it("should correctly withdraw part of amount", async () => {
      const newBasePoolExchangeRate = getOnePercent().times(110);
      const newVaultExchangeRate = getOnePercent().times(105);

      const metaPoolLPAddr = lpTokens[1];

      await checkDeposit(tokenAddr, metaPoolLPAddr, amountToDeposit, amountToDeposit);

      const token = await MockERC20.at(tokenAddr);
      const metaToken = await MockERC20.at(metaPoolLPAddr);
      const vault = await YearnVaultMock.at(await vaultRegistry.latestVault(metaPoolLPAddr));

      await basePool.setExchangeRate(newBasePoolExchangeRate);
      await vault.setExchangeRate(newVaultExchangeRate);

      const txReceipt = await borrowerRouter.withdraw(tokenAddr, metaPoolLPAddr, amountToWithdraw, false, {
        from: LIQUIDITY_POOL,
      });

      const expectedLPAmountToWithdraw = convertToLP(amountToWithdraw, newBasePoolExchangeRate);
      const expectedRemainder = amountToDeposit.minus(expectedLPAmountToWithdraw);

      assert.equal(
        toBN(await borrowerRouter.depositOfAssetInToken(metaPoolLPAddr, tokenAddr)).toString(),
        expectedRemainder.toString()
      );

      const vaultDepositInfo = await borrowerRouter.vaultsDepoitInfo(metaPoolLPAddr);

      assert.equal(toBN(vaultDepositInfo.amountInVaultToken).toString(), expectedRemainder.toString());
      assert.equal(vaultDepositInfo.vaultAddr, vault.address);

      const expectedRouterBalance = amountToDeposit.minus(
        convertToLP(expectedLPAmountToWithdraw, newVaultExchangeRate)
      );

      assert.equal(toBN(await vault.balanceOf(borrowerRouter.address)).toString(), expectedRouterBalance.toString());
      assert.equal(toBN(await metaToken.balanceOf(borrowerRouter.address)).toString(), 0);
      assert.closeTo(toBN(await metaToken.balanceOf(vault.address)).toNumber(), expectedRemainder.toNumber(), 10);

      assert.closeTo(toBN(await token.balanceOf(LIQUIDITY_POOL)).toNumber(), amountToWithdraw.toNumber(), 10);

      checkWithdrawEvents(txReceipt, tokenAddr, metaPoolLPAddr, toBN(await token.balanceOf(LIQUIDITY_POOL)), 0);
    });

    it("should correctly withdraw all asset", async () => {
      const newBasePoolExchangeRate = getOnePercent().times(110);
      const newVaultExchangeRate = getOnePercent().times(105);

      const metaPoolLPAddr = lpTokens[1];

      await checkDeposit(tokenAddr, metaPoolLPAddr, amountToDeposit, amountToDeposit);
      await borrowerRouter2.deposit(tokenAddr, metaPoolLPAddr, { from: INTEGRATION_CORE });

      const token = await MockERC20.at(tokenAddr);
      const metaToken = await MockERC20.at(metaPoolLPAddr);
      const vault = await YearnVaultMock.at(await vaultRegistry.latestVault(metaPoolLPAddr));

      await basePool.setExchangeRate(newBasePoolExchangeRate);
      await vault.setExchangeRate(newVaultExchangeRate);

      amountToWithdraw = oneToken(18).times(120);

      const totalVaultAmount = amountToDeposit.times(2);

      const txReceipt = await borrowerRouter.withdraw(tokenAddr, metaPoolLPAddr, amountToWithdraw, true, {
        from: LIQUIDITY_POOL,
      });

      assert.equal(toBN(await borrowerRouter.depositOfAssetInToken(metaPoolLPAddr, tokenAddr)).toString(), 0);

      const vaultDepositInfo = await borrowerRouter.vaultsDepoitInfo(metaPoolLPAddr);

      assert.equal(toBN(vaultDepositInfo.amountInVaultToken).toString(), 0);
      assert.equal(vaultDepositInfo.vaultAddr, ADDRESS_NULL);

      const vaultTokensToWithdraw = convertFromLP(amountToDeposit, newVaultExchangeRate);
      const expectedReceivedAmount = convertFromLP(vaultTokensToWithdraw, newBasePoolExchangeRate);

      assert.equal(toBN(await vault.balanceOf(borrowerRouter.address)).toString(), 0);
      assert.equal(toBN(await metaToken.balanceOf(borrowerRouter.address)).toString(), 0);
      assert.equal(
        toBN(await metaToken.balanceOf(vault.address)).toString(),
        totalVaultAmount.minus(vaultTokensToWithdraw).toString()
      );
      assert.equal(toBN(await token.balanceOf(LIQUIDITY_POOL)).toString(), expectedReceivedAmount.toString());

      checkWithdrawEvents(txReceipt, tokenAddr, metaPoolLPAddr, expectedReceivedAmount, 0);
    });

    it("should correctly withdraw max assets", async () => {
      const token2Addr = underlyingCoins1[0];
      const newVaultExchangeRate = getOnePercent().times(110);

      await (await MockERC20.at(token2Addr)).transfer(borrowerRouter.address, amountToDeposit, { from: OWNER });

      const metaPoolLPAddr = lpTokens[1];

      await checkDeposit(tokenAddr, metaPoolLPAddr, amountToDeposit, amountToDeposit);
      await checkDeposit(token2Addr, metaPoolLPAddr, amountToDeposit, amountToDeposit.times(2));
      await borrowerRouter2.deposit(tokenAddr, metaPoolLPAddr, { from: INTEGRATION_CORE });

      const token = await MockERC20.at(tokenAddr);
      const metaToken = await MockERC20.at(metaPoolLPAddr);
      const vault = await YearnVaultMock.at(await vaultRegistry.latestVault(metaPoolLPAddr));

      await vault.setExchangeRate(newVaultExchangeRate);

      const currentInterest = oneToken(18).times(20);

      assert.equal(
        toBN(await borrowerRouter.getCurrentInterest(metaPoolLPAddr)).toString(),
        currentInterest.toString()
      );

      amountToWithdraw = oneToken(18).times(125);

      const txReceipt = await borrowerRouter.withdraw(tokenAddr, metaPoolLPAddr, amountToWithdraw, true, {
        from: LIQUIDITY_POOL,
      });

      assert.equal(toBN(await borrowerRouter.depositOfAssetInToken(metaPoolLPAddr, tokenAddr)).toString(), 0);

      const vaultDepositInfo = await borrowerRouter.vaultsDepoitInfo(metaPoolLPAddr);

      assert.equal(toBN(vaultDepositInfo.amountInVaultToken).toString(), amountToDeposit.toString());
      assert.equal(vaultDepositInfo.vaultAddr, vault.address);

      const totalVaultAmount = amountToDeposit.times(3);
      const withdrawAmountInVaultToken = amountToDeposit.plus(currentInterest);

      const expectedRouterBalance = amountToDeposit
        .times(2)
        .minus(convertToLP(withdrawAmountInVaultToken, newVaultExchangeRate));

      assert.equal(toBN(await vault.balanceOf(borrowerRouter.address)).toString(), expectedRouterBalance);
      assert.equal(toBN(await metaToken.balanceOf(borrowerRouter.address)).toString(), 0);

      assert.closeTo(
        toBN(await metaToken.balanceOf(vault.address)).toNumber(),
        totalVaultAmount.minus(withdrawAmountInVaultToken).toNumber(),
        10
      );
      assert.closeTo(toBN(await token.balanceOf(LIQUIDITY_POOL)).toNumber(), withdrawAmountInVaultToken.toNumber(), 10);

      checkWithdrawEvents(txReceipt, tokenAddr, metaPoolLPAddr, toBN(await token.balanceOf(LIQUIDITY_POOL)), 0);
    });
  });

  describe("withdraw from base pool", async () => {
    let amountToWithdraw = oneToken(18).times(50);
    let tokenAddr;

    beforeEach("setup", async () => {
      tokenAddr = baseCoins[1];

      await (await MockERC20.at(tokenAddr)).transfer(borrowerRouter.address, amountToDeposit, { from: OWNER });
      await (await MockERC20.at(tokenAddr)).transfer(borrowerRouter2.address, amountToDeposit, { from: OWNER });
    });

    it("should correctly withdraw part of amount", async () => {
      const newBasePoolExchangeRate = getOnePercent().times(110);
      const newVaultExchangeRate = getOnePercent().times(105);

      await checkDeposit(tokenAddr, baseToken.address, amountToDeposit, amountToDeposit);

      const token = await MockERC20.at(tokenAddr);
      const vault = await YearnVaultMock.at(await vaultRegistry.latestVault(baseToken.address));

      await basePool.setExchangeRate(newBasePoolExchangeRate);
      await vault.setExchangeRate(newVaultExchangeRate);

      const txReceipt = await borrowerRouter.withdraw(tokenAddr, baseToken.address, amountToWithdraw, false, {
        from: LIQUIDITY_POOL,
      });

      const expectedLPAmountToWithdraw = convertToLP(amountToWithdraw, newBasePoolExchangeRate);
      const expectedRemainder = amountToDeposit.minus(expectedLPAmountToWithdraw);

      assert.equal(
        toBN(await borrowerRouter.depositOfAssetInToken(baseToken.address, tokenAddr)).toString(),
        expectedRemainder.toString()
      );

      const vaultDepositInfo = await borrowerRouter.vaultsDepoitInfo(baseToken.address);

      assert.equal(toBN(vaultDepositInfo.amountInVaultToken).toString(), expectedRemainder.toString());
      assert.equal(vaultDepositInfo.vaultAddr, vault.address);

      const expectedRouterBalance = amountToDeposit.minus(
        convertToLP(expectedLPAmountToWithdraw, newVaultExchangeRate)
      );

      assert.equal(toBN(await vault.balanceOf(borrowerRouter.address)).toString(), expectedRouterBalance.toString());
      assert.equal(toBN(await baseToken.balanceOf(borrowerRouter.address)).toString(), 0);
      assert.closeTo(toBN(await baseToken.balanceOf(vault.address)).toNumber(), expectedRemainder.toNumber(), 10);

      assert.closeTo(toBN(await token.balanceOf(LIQUIDITY_POOL)).toNumber(), amountToWithdraw.toNumber(), 10);

      checkWithdrawEvents(txReceipt, tokenAddr, baseToken.address, toBN(await token.balanceOf(LIQUIDITY_POOL)), 0);
    });

    it("should correctly withdraw all asset", async () => {
      const newBasePoolExchangeRate = getOnePercent().times(110);
      const newVaultExchangeRate = getOnePercent().times(105);

      await checkDeposit(tokenAddr, baseToken.address, amountToDeposit, amountToDeposit);
      await borrowerRouter2.deposit(tokenAddr, baseToken.address, { from: INTEGRATION_CORE });

      const token = await MockERC20.at(tokenAddr);
      const vault = await YearnVaultMock.at(await vaultRegistry.latestVault(baseToken.address));

      await basePool.setExchangeRate(newBasePoolExchangeRate);
      await vault.setExchangeRate(newVaultExchangeRate);

      amountToWithdraw = oneToken(18).times(120);

      const totalVaultAmount = amountToDeposit.times(2);

      const txReceipt = await borrowerRouter.withdraw(tokenAddr, baseToken.address, amountToWithdraw, true, {
        from: LIQUIDITY_POOL,
      });

      assert.equal(toBN(await borrowerRouter.depositOfAssetInToken(baseToken.address, tokenAddr)).toString(), 0);

      const vaultDepositInfo = await borrowerRouter.vaultsDepoitInfo(baseToken.address);

      assert.equal(toBN(vaultDepositInfo.amountInVaultToken).toString(), 0);
      assert.equal(vaultDepositInfo.vaultAddr, ADDRESS_NULL);

      const vaultTokensToWithdraw = convertFromLP(amountToDeposit, newVaultExchangeRate);
      const expectedReceivedAmount = convertFromLP(vaultTokensToWithdraw, newBasePoolExchangeRate);

      assert.equal(toBN(await vault.balanceOf(borrowerRouter.address)).toString(), 0);
      assert.equal(toBN(await baseToken.balanceOf(borrowerRouter.address)).toString(), 0);
      assert.equal(
        toBN(await baseToken.balanceOf(vault.address)).toString(),
        totalVaultAmount.minus(vaultTokensToWithdraw).toString()
      );
      assert.equal(toBN(await token.balanceOf(LIQUIDITY_POOL)).toString(), expectedReceivedAmount.toString());

      checkWithdrawEvents(txReceipt, tokenAddr, baseToken.address, expectedReceivedAmount, 0);
    });

    it("should correctly withdraw max assets", async () => {
      const token2Addr = baseCoins[0];
      const newVaultExchangeRate = getOnePercent().times(110);

      await (await MockERC20.at(token2Addr)).transfer(borrowerRouter.address, amountToDeposit, { from: OWNER });

      await checkDeposit(tokenAddr, baseToken.address, amountToDeposit, amountToDeposit);
      await checkDeposit(token2Addr, baseToken.address, amountToDeposit, amountToDeposit.times(2));
      await borrowerRouter2.deposit(tokenAddr, baseToken.address, { from: INTEGRATION_CORE });

      const token = await MockERC20.at(tokenAddr);
      const vault = await YearnVaultMock.at(await vaultRegistry.latestVault(baseToken.address));

      await vault.setExchangeRate(newVaultExchangeRate);

      const currentInterest = oneToken(18).times(20);

      assert.equal(
        toBN(await borrowerRouter.getCurrentInterest(baseToken.address)).toString(),
        currentInterest.toString()
      );

      amountToWithdraw = oneToken(18).times(125);

      const txReceipt = await borrowerRouter.withdraw(tokenAddr, baseToken.address, amountToWithdraw, true, {
        from: LIQUIDITY_POOL,
      });

      assert.equal(toBN(await borrowerRouter.depositOfAssetInToken(baseToken.address, tokenAddr)).toString(), 0);

      const vaultDepositInfo = await borrowerRouter.vaultsDepoitInfo(baseToken.address);

      assert.equal(toBN(vaultDepositInfo.amountInVaultToken).toString(), amountToDeposit.toString());
      assert.equal(vaultDepositInfo.vaultAddr, vault.address);

      const totalVaultAmount = amountToDeposit.times(3);
      const withdrawAmountInVaultToken = amountToDeposit.plus(currentInterest);

      const expectedRouterBalance = amountToDeposit
        .times(2)
        .minus(convertToLP(withdrawAmountInVaultToken, newVaultExchangeRate));

      assert.equal(toBN(await vault.balanceOf(borrowerRouter.address)).toString(), expectedRouterBalance);
      assert.equal(toBN(await baseToken.balanceOf(borrowerRouter.address)).toString(), 0);

      assert.closeTo(
        toBN(await baseToken.balanceOf(vault.address)).toNumber(),
        totalVaultAmount.minus(withdrawAmountInVaultToken).toNumber(),
        10
      );
      assert.closeTo(toBN(await token.balanceOf(LIQUIDITY_POOL)).toNumber(), withdrawAmountInVaultToken.toNumber(), 10);

      checkWithdrawEvents(txReceipt, tokenAddr, baseToken.address, toBN(await token.balanceOf(LIQUIDITY_POOL)), 0);
    });
  });

  describe("getCurrentInterest", async () => {
    let tokenAddr;

    beforeEach("setup", async () => {
      tokenAddr = baseCoins[1];
    });

    it("should return correct current interest", async () => {
      await (await MockERC20.at(tokenAddr)).transfer(borrowerRouter.address, amountToDeposit, { from: OWNER });
      await borrowerRouter.deposit(tokenAddr, tokenAddr, { from: INTEGRATION_CORE });

      let expectedInterestAmount = 0;
      assert.equal(
        toBN(await borrowerRouter.getCurrentInterest(tokenAddr)).toString(),
        expectedInterestAmount.toString()
      );

      const newExchangeRate = getOnePercent().times(105);

      const vault = await YearnVaultMock.at(await vaultRegistry.latestVault(tokenAddr));
      await vault.setExchangeRate(newExchangeRate);

      expectedInterestAmount = amountToDeposit.times(newExchangeRate).idiv(decimal).minus(amountToDeposit);
      assert.equal(
        toBN(await borrowerRouter.getCurrentInterest(tokenAddr)).toString(),
        expectedInterestAmount.toString()
      );
    });

    it("should return correct interest for vault with 6 decimals", async () => {
      const vault = await YearnVaultMock.at(await vaultRegistry.latestVault(tokenAddr));

      await vault.setDecimals(6);

      amountToDeposit = oneToken(6).times(100);

      await (await MockERC20.at(tokenAddr)).transfer(borrowerRouter.address, amountToDeposit, { from: OWNER });
      await borrowerRouter.deposit(tokenAddr, tokenAddr, { from: INTEGRATION_CORE });

      let expectedInterestAmount = 0;
      assert.equal(
        toBN(await borrowerRouter.getCurrentInterest(tokenAddr)).toString(),
        expectedInterestAmount.toString()
      );

      const newExchangeRate = getOnePercent().times(105);

      await vault.setExchangeRate(newExchangeRate);

      expectedInterestAmount = amountToDeposit.times(newExchangeRate).idiv(decimal).minus(amountToDeposit);
      assert.equal(
        toBN(await borrowerRouter.getCurrentInterest(tokenAddr)).toString(),
        expectedInterestAmount.toString()
      );
    });
  });

  describe("getUserDepositedAmountInAsset", async () => {
    let tokenAddr;

    beforeEach("setup", async () => {
      tokenAddr = baseCoins[1];
    });

    it("should return correct user deposited amount", async () => {
      await (await MockERC20.at(tokenAddr)).transfer(borrowerRouter.address, amountToDeposit, { from: OWNER });
      await borrowerRouter.deposit(tokenAddr, baseToken.address, { from: INTEGRATION_CORE });

      const newExchangeRate = getOnePercent().times(105);

      await basePool.setExchangeRate(newExchangeRate);

      const expectedAmount = amountToDeposit.times(newExchangeRate).idiv(decimal);

      assert.equal(
        toBN(await borrowerRouter.getUserDepositedAmountInAsset(tokenAddr, baseToken.address)).toString(),
        expectedAmount.toString()
      );
    });
  });

  describe("getUserRewardInAsset", async () => {
    let tokenAddr;

    beforeEach("setup", async () => {
      tokenAddr = baseCoins[1];
    });

    it("should return correct user reward in asset", async () => {
      await (await MockERC20.at(tokenAddr)).transfer(borrowerRouter.address, amountToDeposit, { from: OWNER });
      await borrowerRouter.deposit(tokenAddr, baseToken.address, { from: INTEGRATION_CORE });

      let expectedRewardAmount = 0;
      assert.equal(
        toBN(await borrowerRouter.getUserRewardInAsset(tokenAddr, baseToken.address)).toString(),
        expectedRewardAmount.toString()
      );

      const newExchangeRate = getOnePercent().times(105);
      const vault = await YearnVaultMock.at(await vaultRegistry.latestVault(baseToken.address));

      await vault.setExchangeRate(newExchangeRate);
      await basePool.setExchangeRate(newExchangeRate);

      expectedInterestAmount = amountToDeposit.times(newExchangeRate).idiv(decimal).minus(amountToDeposit);
      expectedRewardAmount = expectedInterestAmount.times(newExchangeRate).idiv(decimal);

      assert.equal(
        toBN(await borrowerRouter.getUserRewardInAsset(tokenAddr, baseToken.address)).toString(),
        expectedRewardAmount.toString()
      );
    });
  });

  describe("getPoolInfo", async () => {
    let tokenAddr;

    beforeEach("setup", async () => {
      tokenAddr = baseCoins[1];
    });

    it("should return correct pool info", async () => {
      let result = await borrowerRouter.getPoolInfo(curveRegistry.address, basePool.address, tokenAddr, false);

      assert.equal(toBN(result[0]).toString(), 3);
      assert.equal(toBN(result[1]).toString(), 1);

      const metaPoolLPAddr = lpTokens[1];
      const metaPool = await CurvePoolMock.at(await curveRegistry.get_pool_from_lp_token(metaPoolLPAddr));

      result = await borrowerRouter.getPoolInfo(curveRegistry.address, metaPool.address, baseCoins[2], true);

      assert.equal(toBN(result[0]).toString(), 4);
      assert.equal(toBN(result[1]).toString(), 3);
    });

    it("should get exception if pool is meta and invalid number of tokens", async () => {
      const reason = "BorrowerRouter: Invalid number of coins in the pool.";

      const metaPoolLPAddr = lpTokens[1];
      const metaPool = await CurvePoolMock.at(await curveRegistry.get_pool_from_lp_token(metaPoolLPAddr));

      await curveRegistry.setNumberOfCoins(metaPool.address, 3, false);

      await truffleAssert.reverts(
        borrowerRouter.getPoolInfo(curveRegistry.address, metaPool.address, tokenAddr, true),
        reason
      );
    });

    it("should get exception if pool is base and invalid number of tokens", async () => {
      const reason = "BorrowerRouter: Incorrect base pool address.";

      await curveRegistry.setNumberOfCoins(basePool.address, 2, false);

      await truffleAssert.reverts(
        borrowerRouter.getPoolInfo(curveRegistry.address, basePool.address, tokenAddr, false),
        reason
      );
    });

    it("should get exception if asset addr not found", async () => {
      const reason = "BorrowerRouter: Incorrect coins list.";

      await truffleAssert.reverts(
        borrowerRouter.getPoolInfo(curveRegistry.address, basePool.address, NOTHING, false),
        reason
      );
    });
  });
});
