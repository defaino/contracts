const CurvePoolMock = artifacts.require("CurvePoolMock");
const MockERC20 = artifacts.require("MockERC20");

const Reverter = require("../helpers/reverter");

const { toBN, oneToken, getOnePercent } = require("../../scripts/globals");

const truffleAssert = require("truffle-assertions");
const { assert } = require("chai");

contract("CurvePoolMock", async (accounts) => {
  const reverter = new Reverter(web3);

  const OWNER = accounts[0];
  const USER1 = accounts[1];
  const USER2 = accounts[2];

  let curvePool;
  let lpToken;

  const numberOfCoins = 3;
  const isMeta = false;

  const coins = [];

  const tokensAmount = oneToken(18).times(10000);
  const decimal = getOnePercent().times(100);

  async function saveCoins(numberOfCoins) {
    for (let i = 0; i < numberOfCoins; i++) {
      coins.push((await MockERC20.new("Test Coin" + i, "TC" + i)).address);
    }
  }

  async function deployCoins(numberOfCoins) {
    const array = [];

    for (let i = 0; i < numberOfCoins; i++) {
      array.push((await MockERC20.new("Test Coin" + i, "TC" + i)).address);
    }

    return array;
  }

  async function mintAndApprove(coins) {
    for (let i = 0; i < coins.length; i++) {
      const token = await MockERC20.at(coins[i]);

      await token.mintArbitraryBatch([OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);
      await token.approveArbitraryBacth(
        curvePool.address,
        [OWNER, USER1, USER2],
        [tokensAmount, tokensAmount, tokensAmount]
      );
    }
  }

  async function addLiquidity(amounts, minAmount, user) {
    return await curvePool.methods[`add_liquidity(uint256[${amounts.length}],uint256)`](amounts, minAmount, {
      from: user,
    });
  }

  async function calcTokenAmount(amounts) {
    return await curvePool.methods[`calc_token_amount(uint256[${amounts.length}],bool)`](amounts, true);
  }

  before("setup", async () => {
    lpToken = await MockERC20.new("Test Curve LP", "TCLP");
    await saveCoins(numberOfCoins);

    curvePool = await CurvePoolMock.new(isMeta, lpToken.address, coins, coins);

    await mintAndApprove(coins);

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("creation", async () => {
    it("should set data correctly", async () => {
      assert.equal(await curvePool.lpToken(), lpToken.address);
      assert.equal(await curvePool.isMeta(), isMeta);
      assert.equal(toBN(await curvePool.numberOfCoins()).toString(), numberOfCoins);
      assert.equal(toBN(await curvePool.numberOfUnderlyingCoins()).toString(), numberOfCoins);

      for (let i = 0; i < numberOfCoins; i++) {
        assert.equal(await curvePool.coins(i), coins[i]);
        assert.equal(await curvePool.underlyingCoins(i), coins[i]);
      }
    });
  });

  describe("setters", async () => {
    it("should correct set new data", async () => {
      await curvePool.setIsMeta(false);
      assert.equal(await curvePool.isMeta(), isMeta);

      await curvePool.setBasePool(lpToken.address);
      assert.equal(await curvePool.base_pool(), lpToken.address);

      const newCoins = await deployCoins(2);
      await curvePool.setCoins(0, newCoins);
      await curvePool.setUnderlyingCoins(0, newCoins);

      for (let i = 0; i < 2; i++) {
        assert.equal(await curvePool.coins(i), newCoins[i]);
        assert.equal(await curvePool.underlyingCoins(i), newCoins[i]);
      }

      await curvePool.setNumberOfCoins(2);
      assert.equal(await curvePool.numberOfCoins(), 2);

      await curvePool.setNumberOfUnderlyingCoins(2);
      assert.equal(await curvePool.numberOfUnderlyingCoins(), 2);
    });
  });

  describe("add liquidity", async () => {
    const liquidityAmount = oneToken(18).times(100);

    it("should correctly add liquidity", async () => {
      assert.equal(toBN(await lpToken.balanceOf(USER1)).toString(), 0);

      await addLiquidity([0, liquidityAmount, 0], liquidityAmount, USER1);

      assert.equal(toBN(await lpToken.balanceOf(USER1)).toString(), liquidityAmount.toString());
      assert.equal(toBN(await lpToken.totalSupply()).toString(), liquidityAmount.toString());
    });

    it("should correctly add liquidity with exchange rate > 1", async () => {
      const newExchangeRate = getOnePercent().times(105);

      await curvePool.setExchangeRate(newExchangeRate);

      const expectedLpTokenAmount = liquidityAmount.times(decimal).idiv(newExchangeRate);

      await addLiquidity([0, liquidityAmount, 0], expectedLpTokenAmount, USER1);

      assert.equal(toBN(await lpToken.balanceOf(USER1)).toString(), expectedLpTokenAmount.toString());
      assert.equal(toBN(await lpToken.totalSupply()).toString(), expectedLpTokenAmount.toString());
    });

    it("should correctly add liquidity several assets", async () => {
      await (await MockERC20.at(coins[1])).setDecimals(6);

      const newExchangeRate = getOnePercent().times(105);
      const newLiquidityAmount = oneToken(6).times(50);

      await curvePool.setExchangeRate(newExchangeRate);

      const expectedLpTokenAmount = liquidityAmount.times(1.5).times(decimal).idiv(newExchangeRate);

      await addLiquidity([liquidityAmount, newLiquidityAmount, 0], 0, USER1);

      assert.equal(toBN(await lpToken.balanceOf(USER1)).toString(), expectedLpTokenAmount.toString());
    });

    it("should get exception if amount to mint less than minimum amount", async () => {
      const newExchangeRate = getOnePercent().times(105);

      await curvePool.setExchangeRate(newExchangeRate);

      const reason = "CurvePoolMock: Amount to mint less than the minimal amount to mint.";

      await truffleAssert.reverts(addLiquidity([0, liquidityAmount, 0], liquidityAmount, USER1), reason);
    });

    it("should get exception if incorrect amounts length", async () => {
      const reason = "CurvePoolMock: Incorrect amounts length.";

      await truffleAssert.reverts(addLiquidity([0, 0], 0, USER1), reason);

      await curvePool.setNumberOfCoins(2);
      await truffleAssert.reverts(addLiquidity([0, 0, 0], 0, USER1), reason);
    });
  });

  describe("remove_liquidity_one_coin", async () => {
    const liquidityAmount = oneToken(18).times(100);
    const amountToWithdraw = oneToken(18).times(1.5);

    beforeEach("setup", async () => {
      await addLiquidity(
        [liquidityAmount.times(10), liquidityAmount.times(10), liquidityAmount.times(10)],
        liquidityAmount.times(30),
        OWNER
      );
      await addLiquidity([liquidityAmount, liquidityAmount, 0], liquidityAmount.times(2), USER1);
    });

    it("should correctly withdraw tokens", async () => {
      const newExchangeRate = getOnePercent().times(105);

      await curvePool.setExchangeRate(newExchangeRate);

      const expectedReceivedAmount = amountToWithdraw.times(newExchangeRate).idiv(decimal);

      const token = await MockERC20.at(coins[1]);
      const userBalanceBeforeRemove = toBN(await token.balanceOf(USER1));

      await curvePool.remove_liquidity_one_coin(amountToWithdraw, 1, expectedReceivedAmount, { from: USER1 });

      const userBalanceAfterRemove = toBN(await token.balanceOf(USER1));

      assert.equal(userBalanceAfterRemove.minus(userBalanceBeforeRemove).toString(), expectedReceivedAmount.toString());
    });

    it("should correctly withdraw tokens with 6 decimals", async () => {
      const newLiquidityAmount = oneToken(6).times(50);
      const newExchangeRate = getOnePercent().times(105);

      await (await MockERC20.at(coins[1])).setDecimals(6);

      await addLiquidity([liquidityAmount, newLiquidityAmount, 0], liquidityAmount.times(1.5), USER1);

      const expectedReceivedAmount = amountToWithdraw.times(newExchangeRate).idiv(decimal).idiv(toBN(10).pow(12));

      await curvePool.setExchangeRate(newExchangeRate);

      const token = await MockERC20.at(coins[1]);
      const userBalanceBeforeRemove = toBN(await token.balanceOf(USER1));

      await curvePool.remove_liquidity_one_coin(amountToWithdraw, 1, expectedReceivedAmount, { from: USER1 });

      const userBalanceAfterRemove = toBN(await token.balanceOf(USER1));

      assert.equal(userBalanceAfterRemove.minus(userBalanceBeforeRemove).toString(), expectedReceivedAmount.toString());
    });

    it("should get exception if user balance less than amount to withdraw", async () => {
      const newAmountToWithdraw = liquidityAmount.times(3);
      const reason = "CurvePoolMock: Not enough LP tokens on account.";

      await truffleAssert.reverts(
        curvePool.remove_liquidity_one_coin(newAmountToWithdraw, 1, 0, { from: USER1 }),
        reason
      );
    });

    it("should get exception if token index greater than coins number", async () => {
      const reason = "CurvePoolMock: Token index out of bounds.";

      await truffleAssert.reverts(curvePool.remove_liquidity_one_coin(amountToWithdraw, 3, 0, { from: USER1 }), reason);
    });

    it("should get exception if received amount less than minimum amount", async () => {
      const reason = "CurvePoolMock: Received amount less than the minimal amount.";

      await truffleAssert.reverts(
        curvePool.remove_liquidity_one_coin(amountToWithdraw, 1, liquidityAmount.times(2), { from: USER1 }),
        reason
      );
    });
  });

  describe("calc_token_amount and calc_withdraw_one_coin", async () => {
    const liquidityAmount = oneToken(18).times(100);

    it("should correctly calculate lp amount", async () => {
      let excpectedAmount = liquidityAmount.times(2);
      assert.equal(
        toBN(await calcTokenAmount([liquidityAmount, liquidityAmount, 0])).toString(),
        excpectedAmount.toString()
      );

      excpectedAmount = 0;
      assert.equal(toBN(await calcTokenAmount([0, 0, 0])).toString(), excpectedAmount.toString());

      const newExchangeRate = getOnePercent().times(105);
      const newLiquidityAmount = oneToken(6).times(350);

      await (await MockERC20.at(coins[1])).setDecimals(6);
      await curvePool.setExchangeRate(newExchangeRate);
      await curvePool.setNumberOfCoins(2);

      excpectedAmount = liquidityAmount.times(4.5).times(decimal).idiv(newExchangeRate);
      assert.equal(
        toBN(await calcTokenAmount([liquidityAmount, newLiquidityAmount])).toString(),
        excpectedAmount.toString()
      );
    });

    it("should return correct amount", async () => {
      const newExchangeRate = getOnePercent().times(105);
      const amountToWithdraw = oneToken(18).times(200);

      await (await MockERC20.at(coins[1])).setDecimals(8);

      await curvePool.setExchangeRate(newExchangeRate);

      const expectedReceivedAmount = amountToWithdraw.times(newExchangeRate).idiv(decimal).idiv(toBN(10).pow(10));
      assert.equal(
        toBN(await curvePool.calc_withdraw_one_coin(amountToWithdraw, 1)).toString(),
        expectedReceivedAmount.toString()
      );
    });

    it("should get exception if token index greater than coins number", async () => {
      const amountToWithdraw = liquidityAmount.times(1.5);
      const reason = "CurvePoolMock: Token index out of bounds.";

      await truffleAssert.reverts(curvePool.calc_withdraw_one_coin(amountToWithdraw, 3), reason);
    });
  });
});
