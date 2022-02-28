const CurvePoolMock = artifacts.require("CurvePoolMock");
const MockERC20 = artifacts.require("MockERC20");
const CurveZapMock = artifacts.require("CurveZapMock");

const Reverter = require("../helpers/reverter");

const { toBN, oneToken, getOnePercent } = require("../../scripts/globals");

const { assert } = require("chai");

contract("CurveZapMock", async (accounts) => {
  const reverter = new Reverter(web3);

  const OWNER = accounts[0];
  const USER1 = accounts[1];
  const USER2 = accounts[2];

  let basePool;
  let metaPool;
  let depositContract;

  const numberOfBaseCoins = 3;

  const underlyingCoins = [];
  const baseCoins = [];
  const coins = [];

  const tokensAmount = oneToken().times(10000);
  const decimal = getOnePercent().times(100);

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

  before("setup", async () => {
    baseToken = await MockERC20.new("Test 3Crv", "T3Crv");
    metaToken = await MockERC20.new("Test Meta", "TM");

    await saveCoins(baseCoins, numberOfBaseCoins);

    basePool = await CurvePoolMock.new(false, baseToken.address, baseCoins, baseCoins);

    depositContract = await CurveZapMock.new(basePool.address, baseToken.address);

    await saveCoins(coins, 1);
    coins.push(baseToken.address);

    underlyingCoins.push(coins[0]);
    for (let i = 0; i < numberOfBaseCoins; i++) {
      underlyingCoins.push(baseCoins[i]);
    }

    metaPool = await CurvePoolMock.new(true, metaToken.address, coins, underlyingCoins);

    await mintAndApprove(depositContract.address, underlyingCoins);

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("add_liquidity", async () => {
    const liquidityAmount = oneToken().times(100);

    it("should correctly add liquidity with not base token", async () => {
      const newExchangeRate = getOnePercent().times(105);
      await metaPool.setExchangeRate(newExchangeRate);

      const expectedLPAmount = liquidityAmount.times(decimal).idiv(newExchangeRate);

      assert.equal(toBN(await metaToken.balanceOf(USER1)).toString(), 0);

      await depositContract.add_liquidity(metaPool.address, [liquidityAmount, 0, 0, 0], 0, { from: USER1 });

      assert.equal(toBN(await metaToken.balanceOf(USER1)).toString(), expectedLPAmount.toString());
    });

    it("should correctly add liquidity with base token", async () => {
      const newExchangeRate = getOnePercent().times(105);
      await metaPool.setExchangeRate(newExchangeRate);

      const expectedLPAmount = liquidityAmount.times(decimal).idiv(newExchangeRate);

      assert.equal(toBN(await metaToken.balanceOf(USER1)).toString(), 0);

      await depositContract.add_liquidity(metaPool.address, [0, 0, liquidityAmount, 0], 0, { from: USER1 });

      assert.equal(toBN(await metaToken.balanceOf(USER1)).toString(), expectedLPAmount.toString());
    });

    it("should correctly add liquidity with several assets", async () => {
      const newMetaPoolExchangeRate = getOnePercent().times(110);
      const newBasePoolExchangeRate = getOnePercent().times(105);

      await basePool.setExchangeRate(newBasePoolExchangeRate);
      await metaPool.setExchangeRate(newMetaPoolExchangeRate);

      await (await MockERC20.at(underlyingCoins[2])).setDecimals(6);

      const newLiquidityAmount = oneToken(6).times(50);

      const baseTokensAmount = liquidityAmount.times(2.5).times(decimal).idiv(newBasePoolExchangeRate);
      const expectedLPAmount = liquidityAmount.plus(baseTokensAmount).times(decimal).idiv(newMetaPoolExchangeRate);

      assert.equal(toBN(await metaToken.balanceOf(USER1)).toString(), 0);

      await depositContract.add_liquidity(
        metaPool.address,
        [liquidityAmount, 0, newLiquidityAmount, liquidityAmount.times(2)],
        0,
        { from: USER1 }
      );

      assert.equal(toBN(await metaToken.balanceOf(USER1)).toString(), expectedLPAmount.toString());
    });
  });

  describe("remove_liquidity_one_coin", async () => {
    const liquidityAmount = oneToken().times(100);
    const amountToWithdraw = oneToken().times(1.5);

    beforeEach("setup", async () => {
      await depositContract.add_liquidity(
        metaPool.address,
        [liquidityAmount.times(10), liquidityAmount.times(10), liquidityAmount.times(10), liquidityAmount.times(10)],
        0,
        { from: OWNER }
      );

      await depositContract.add_liquidity(metaPool.address, [liquidityAmount, 0, 0, liquidityAmount], 0, {
        from: USER1,
      });

      await metaToken.approveArbitraryBacth(depositContract.address, [USER1], [tokensAmount]);
    });

    it("should correctly remove liquidity with non base asset", async () => {
      const newMetaPoolExchangeRate = getOnePercent().times(110);

      await metaPool.setExchangeRate(newMetaPoolExchangeRate);

      const expectedReceivedAmount = amountToWithdraw.times(newMetaPoolExchangeRate).idiv(decimal);

      const token = await MockERC20.at(underlyingCoins[0]);
      const userBalanceBeforeRemove = toBN(await token.balanceOf(USER1));

      await depositContract.remove_liquidity_one_coin(metaPool.address, amountToWithdraw, 0, expectedReceivedAmount, {
        from: USER1,
      });

      const userBalanceAfterRemove = toBN(await token.balanceOf(USER1));

      assert.equal(userBalanceAfterRemove.minus(userBalanceBeforeRemove).toString(), expectedReceivedAmount.toString());
    });

    it("should correctly remove liquidity with base asset", async () => {
      const newAmountToWithdraw = toBN(await metaToken.balanceOf(USER1));

      const newMetaPoolExchangeRate = getOnePercent().times(110);
      const newBasePoolExchangeRate = getOnePercent().times(105);

      await metaPool.setExchangeRate(newMetaPoolExchangeRate);
      await basePool.setExchangeRate(newBasePoolExchangeRate);

      const token = await MockERC20.at(underlyingCoins[3]);
      const userBalanceBeforeRemove = toBN(await token.balanceOf(USER1));

      const expectedBaseAmount = newAmountToWithdraw.times(newMetaPoolExchangeRate).idiv(decimal);
      const expectedReceivedAmount = expectedBaseAmount.times(newBasePoolExchangeRate).idiv(decimal);

      await depositContract.remove_liquidity_one_coin(
        metaPool.address,
        newAmountToWithdraw,
        3,
        expectedReceivedAmount,
        { from: USER1 }
      );

      const userBalanceAfterRemove = toBN(await token.balanceOf(USER1));

      assert.equal(userBalanceAfterRemove.minus(userBalanceBeforeRemove).toString(), expectedReceivedAmount.toString());
      assert.equal(toBN(await metaToken.balanceOf(USER1)).toString(), 0);
    });
  });

  describe("calc_withdraw_one_coin", async () => {
    const liquidityAmount = oneToken().times(100);

    it("should return correct amount if index is non base token", async () => {
      const newMetaPoolExchangeRate = getOnePercent().times(110);

      await metaPool.setExchangeRate(newMetaPoolExchangeRate);

      const expectedAmount = liquidityAmount.times(newMetaPoolExchangeRate).idiv(decimal);

      assert.equal(
        toBN(await depositContract.calc_withdraw_one_coin(metaPool.address, liquidityAmount, 0)).toString(),
        expectedAmount.toString()
      );
    });

    it("should return coorect amount for base token", async () => {
      const newMetaPoolExchangeRate = getOnePercent().times(110);
      const newBasePoolExchangeRate = getOnePercent().times(105);

      await metaPool.setExchangeRate(newMetaPoolExchangeRate);
      await basePool.setExchangeRate(newBasePoolExchangeRate);

      const expectedBaseAmount = liquidityAmount.times(newMetaPoolExchangeRate).idiv(decimal);
      const expectedAmount = expectedBaseAmount.times(newBasePoolExchangeRate).idiv(decimal);

      assert.equal(
        toBN(await depositContract.calc_withdraw_one_coin(metaPool.address, liquidityAmount, 2)).toString(),
        expectedAmount.toString()
      );
    });
  });

  describe("calc_token_amount", async () => {
    const liquidityAmount = oneToken().times(100);

    it("should correctly calculate lp amount", async () => {
      let expectedAmount = liquidityAmount.times(4);
      assert.equal(
        toBN(
          await depositContract.calc_token_amount(
            metaPool.address,
            [liquidityAmount, liquidityAmount.times(3), 0, 0],
            false
          )
        ).toString(),
        expectedAmount.toString()
      );

      expectedAmount = 0;
      assert.equal(
        toBN(await depositContract.calc_token_amount(metaPool.address, [0, 0, 0, 0], false)).toString(),
        expectedAmount.toString()
      );

      const newMetaPoolExchangeRate = getOnePercent().times(110);
      const newBasePoolExchangeRate = getOnePercent().times(105);

      await metaPool.setExchangeRate(newMetaPoolExchangeRate);
      await basePool.setExchangeRate(newBasePoolExchangeRate);

      const newLiquidityAmount = oneToken(6).times(350);

      await (await MockERC20.at(underlyingCoins[2])).setDecimals(6);

      const baseTokensAmount = liquidityAmount.times(4.5).times(decimal).idiv(newBasePoolExchangeRate);
      expectedAmount = baseTokensAmount.times(decimal).idiv(newMetaPoolExchangeRate);

      assert.equal(
        toBN(
          await depositContract.calc_token_amount(metaPool.address, [0, liquidityAmount, newLiquidityAmount, 0], false)
        ).toString(),
        expectedAmount.toString()
      );
    });
  });
});
