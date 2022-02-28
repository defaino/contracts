const YearnVaultMock = artifacts.require("YearnVaultMock");
const MockERC20 = artifacts.require("MockERC20");

const Reverter = require("../helpers/reverter");

const { toBN, oneToken, getOnePercent } = require("../../scripts/globals");

const truffleAssert = require("truffle-assertions");
const { assert } = require("chai");

contract("YearnVaultMock", async (accounts) => {
  const reverter = new Reverter(web3);

  const OWNER = accounts[0];
  const USER1 = accounts[1];
  const USER2 = accounts[2];

  let vault;
  let token;

  const tokensAmount = oneToken(18).times(10000);
  const decimal = getOnePercent().times(100);

  const depositMethods = ["deposit()", "deposit(uint256)", "deposit(uint256,address)"];
  const withdrawMethods = ["withdraw()", "withdraw(uint256)", "withdraw(uint256,address)"];

  async function mintAndApprove(coins) {
    for (let i = 0; i < coins.length; i++) {
      const token = await MockERC20.at(coins[i]);

      await token.mintArbitraryBatch([OWNER, USER1, USER2], [tokensAmount, tokensAmount, tokensAmount]);
      await token.approveArbitraryBacth(
        vault.address,
        [OWNER, USER1, USER2],
        [tokensAmount, tokensAmount, tokensAmount]
      );
    }
  }

  async function deposit(methodIndex, amount, sender, recipient) {
    switch (methodIndex) {
      case 0:
        return await vault.methods[depositMethods[0]]({ from: sender });

      case 1:
        return await vault.methods[depositMethods[1]](amount, { from: sender });

      case 2:
        return await vault.methods[depositMethods[2]](amount, recipient, { from: sender });
    }
  }

  async function withdraw(methodIndex, amount, sender, recipient) {
    switch (methodIndex) {
      case 0:
        return await vault.methods[withdrawMethods[0]]({ from: sender });

      case 1:
        return await vault.methods[withdrawMethods[1]](amount, { from: sender });

      case 2:
        return await vault.methods[withdrawMethods[2]](amount, recipient, { from: sender });
    }
  }

  before("setup", async () => {
    token = await MockERC20.new("Test Vault Token", "TVT");
    vault = await YearnVaultMock.new("Test Vault", "TV", token.address);

    await mintAndApprove([token.address]);

    await reverter.snapshot();
  });

  afterEach("revert", reverter.revert);

  describe("deposit", async () => {
    let depositAmount = oneToken(18).times(100);

    it("should correctly deposit all tokens", async () => {
      assert.equal(toBN(await vault.balanceOf(USER1)).toString(), 0);

      await deposit(0, 0, USER1, USER1);

      assert.equal(toBN(await token.balanceOf(vault.address)).toString(), tokensAmount.toString());
      assert.equal(toBN(await vault.balanceOf(USER1)).toString(), tokensAmount.toString());

      const newExchangeRate = getOnePercent().times(105);
      await vault.setExchangeRate(newExchangeRate);

      await deposit(0, 0, USER2, USER2);

      const expectedSharesAmount = tokensAmount.times(decimal).idiv(newExchangeRate);

      assert.equal(toBN(await token.balanceOf(vault.address)).toString(), tokensAmount.times(2).toString());
      assert.equal(toBN(await vault.balanceOf(USER2)).toString(), expectedSharesAmount.toString());
    });

    it("should correctly deposit tokens", async () => {
      depositAmount = oneToken(6).times(100);

      await vault.setDecimals(6);

      await deposit(1, depositAmount, USER1, USER1);

      assert.equal(toBN(await token.balanceOf(vault.address)).toString(), depositAmount.toString());
      assert.equal(toBN(await vault.balanceOf(USER1)).toString(), depositAmount.toString());

      const newExchangeRate = getOnePercent().times(105);
      await vault.setExchangeRate(newExchangeRate);

      await deposit(1, depositAmount, USER2, USER2);

      const expectedSharesAmount = depositAmount.times(decimal).idiv(newExchangeRate);

      assert.equal(toBN(await token.balanceOf(vault.address)).toString(), depositAmount.times(2).toString());
      assert.equal(toBN(await vault.balanceOf(USER2)).toString(), expectedSharesAmount.toString());
    });

    it("should correctly deposit tokens for recipient", async () => {
      const newExchangeRate = getOnePercent().times(105);
      await vault.setExchangeRate(newExchangeRate);

      await deposit(2, depositAmount, USER1, USER2);

      const expectedSharesAmount = depositAmount.times(decimal).idiv(newExchangeRate);

      assert.equal(toBN(await token.balanceOf(vault.address)).toString(), depositAmount.toString());
      assert.equal(toBN(await token.balanceOf(USER1)).toString(), tokensAmount.minus(depositAmount).toString());
      assert.equal(toBN(await vault.balanceOf(USER1)).toString(), 0);
      assert.equal(toBN(await vault.balanceOf(USER2)).toString(), expectedSharesAmount.toString());
    });
  });

  describe("withdraw", async () => {
    const newExchangeRate = getOnePercent().times(105);
    let depositAmount = oneToken(18).times(100);
    let withdrawAmount = oneToken(18).times(60);

    beforeEach("setup", async () => {
      await deposit(0, depositAmount, OWNER, OWNER);
      await deposit(1, depositAmount, USER1, USER1);
    });

    it("should correctly withdraw all", async () => {
      await vault.setExchangeRate(newExchangeRate);

      const balanceBeforeWithdraw = toBN(await token.balanceOf(USER1));

      await withdraw(0, withdrawAmount, USER1, USER1);

      const balanceAfterWithdraw = toBN(await token.balanceOf(USER1));

      const expectedReceivedAmount = depositAmount.times(newExchangeRate).idiv(decimal);

      assert.equal(
        toBN(await token.balanceOf(vault.address)).toString(),
        tokensAmount.plus(depositAmount).minus(expectedReceivedAmount).toString()
      );
      assert.equal(balanceAfterWithdraw.minus(balanceBeforeWithdraw).toString(), expectedReceivedAmount.toString());
    });

    it("should correctly withdraw part of deposit", async () => {
      await vault.setExchangeRate(newExchangeRate);

      const balanceBeforeWithdraw = toBN(await token.balanceOf(USER1));

      await withdraw(1, withdrawAmount, USER1, USER1);

      const balanceAfterWithdraw = toBN(await token.balanceOf(USER1));

      const expectedReceivedAmount = withdrawAmount.times(newExchangeRate).idiv(decimal);

      assert.equal(
        toBN(await token.balanceOf(vault.address)).toString(),
        tokensAmount.plus(depositAmount).minus(expectedReceivedAmount)
      );
      assert.equal(balanceAfterWithdraw.minus(balanceBeforeWithdraw).toString(), expectedReceivedAmount.toString());
    });

    it("should correctly withdraw part of deposit for specific recipient", async () => {
      await vault.setExchangeRate(newExchangeRate);

      const balanceBeforeWithdraw = toBN(await token.balanceOf(USER2));

      await withdraw(2, withdrawAmount, USER1, USER2);

      const balanceAfterWithdraw = toBN(await token.balanceOf(USER2));

      const expectedReceivedAmount = withdrawAmount.times(newExchangeRate).idiv(decimal);

      assert.equal(
        toBN(await token.balanceOf(vault.address)).toString(),
        tokensAmount.plus(depositAmount).minus(expectedReceivedAmount)
      );
      assert.equal(balanceAfterWithdraw.minus(balanceBeforeWithdraw).toString(), expectedReceivedAmount.toString());
    });
  });

  describe("pricePerShare", async () => {
    const newExchangeRate = getOnePercent().times(105);

    it("should return correct pricePerShare", async () => {
      await vault.setExchangeRate(newExchangeRate);

      assert.equal(
        toBN(await vault.pricePerShare()).toString(),
        oneToken(18).times(newExchangeRate).idiv(decimal).toString()
      );

      await vault.setDecimals(6);

      assert.equal(
        toBN(await vault.pricePerShare()).toString(),
        oneToken(6).times(newExchangeRate).idiv(decimal).toString()
      );
    });
  });
});
