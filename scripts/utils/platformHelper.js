const { ethers, config } = require("hardhat");
const { wei } = require("./utils");

class PlatformHelper {
  async init(networkName, registryAddr, nativeAmount, signersCount) {
    this.provider = new ethers.providers.JsonRpcProvider(config.networks[networkName].url);

    this.registry = await ethers.getContractAt("Registry", registryAddr);
    this.defiCore = await ethers.getContractAt("DefiCore", await this.registry.getDefiCoreContract());
    this.systemPoolsRegistry = await ethers.getContractAt(
      "SystemPoolsRegistry",
      await this.registry.getSystemPoolsRegistryContract()
    );
    this.priceManager = await ethers.getContractAt("PriceManager", await this.registry.getPriceManagerContract());

    this.signers = [];
    this.signersPublicKeys = [];

    console.log("GENERATING SIGNERS...");

    const defSigner = await ethers.getSigner();

    for (let i = 0; i < signersCount; i++) {
      const currentSigner = new ethers.Wallet(new ethers.Wallet.createRandom(), this.provider);
      const currentPublicKey = await currentSigner.getAddress();

      this.signers.push(currentSigner);
      this.signersPublicKeys.push(currentPublicKey);

      console.log(`\nGenerated USER${i} private key - ${currentSigner.privateKey}`);
      console.log(`Generated USER${i} public key - ${currentPublicKey}`);

      console.log(`Sending ${nativeAmount} ETH to ${currentPublicKey}...`);

      const tx = await defSigner.sendTransaction({
        to: currentPublicKey,
        value: wei(nativeAmount).toFixed(),
      });

      await tx.wait();
    }
  }

  async depositAssets(signer, depositAssets, depositAmounts) {
    const signerPublicKey = await signer.getAddress();

    for (let i = 0; i < depositAssets.length; i++) {
      const currentSymbol = depositAssets[i];
      const currentKey = ethers.utils.formatBytes32String(currentSymbol);
      const currentPoolAddr = (await this.systemPoolsRegistry.poolsInfo(currentKey)).poolAddr;

      const currentLiquidityPool = await ethers.getContractAt("LiquidityPool", currentPoolAddr);
      const currentToken = await ethers.getContractAt("MockERC20", await currentLiquidityPool.assetAddr());

      const mintAmount = wei(depositAmounts[i], await currentToken.decimals());

      console.log(`\nMinting ${mintAmount.toFixed()} (wei) ${currentSymbol} for ${signerPublicKey}`);
      let tx = await currentToken.connect(signer).mintArbitrary(signerPublicKey, mintAmount.toFixed());

      await tx.wait();

      console.log(
        `Aproving ${mintAmount.toFixed()} amount (wei) from ${signerPublicKey} to ${currentSymbol} pool address (${currentPoolAddr})`
      );
      tx = await currentToken.connect(signer).approve(currentPoolAddr, mintAmount.toFixed());

      await tx.wait();

      console.log(`Adding liquidity to the ${currentSymbol} pool`);
      tx = await this.defiCore.connect(signer).addLiquidity(currentKey, wei(depositAmounts[i]).toFixed());

      await tx.wait();
    }

    console.log(
      `\nTotalBorrowLimitInUSD of the ${signerPublicKey} - ${await this.defiCore.getCurrentBorrowLimitInUSD(
        signerPublicKey
      )}`
    );
  }

  async borrowAssets(signer, borrowAssets, borrowAmounts) {
    const signerPublicKey = await signer.getAddress();

    for (let i = 0; i < borrowAssets.length; i++) {
      const currentSymbol = borrowAssets[i];
      const currentKey = ethers.utils.formatBytes32String(currentSymbol);

      const borrowAmount = wei(borrowAmounts[i]).toFixed();

      console.log(`\nBorrowing liquidity from the ${currentSymbol} pool`);
      const tx = await this.defiCore.connect(signer).borrowFor(currentKey, borrowAmount, signerPublicKey);

      await tx.wait();

      console.log(
        `TotalBorrowBalance of the ${signerPublicKey} - ${await this.defiCore.getTotalBorrowBalanceInUSD(
          signerPublicKey
        )}`
      );
    }
  }

  async updatePrices(assets, newPrices, priceDecimals = 8) {
    for (let i = 0; i < assets.length; i++) {
      const currentSymbol = assets[i];
      const currentKey = ethers.utils.formatBytes32String(currentSymbol);

      const newPrice = wei(newPrices[i], priceDecimals).toFixed();

      const priceFeed = await ethers.getContractAt(
        "ChainlinkOracleMock",
        (
          await this.priceManager.priceFeeds(currentKey)
        ).chainlinkOracle
      );

      console.log(`\nSetting ${newPrice} (wei) price for ${currentSymbol} price feed...`);
      let tx = await priceFeed.setPrice(newPrice);

      await tx.wait();

      if ((await priceFeed.decimals()) != priceDecimals) {
        console.log(`Setting ${priceDecimals} decimals for ${currentSymbol} price feed...`);
        tx = await priceFeed.setDecimals(priceDecimals);

        await tx.wait();
      }
    }
  }

  async printUserMainInfo(userPublicKey) {
    const result = await this.defiCore.getAvailableLiquidity(userPublicKey);

    console.log(`\nMain info for ${userPublicKey}:`);
    console.log(`\tTotalSupplyBalanceInUSD - ${await this.defiCore.getTotalSupplyBalanceInUSD(userPublicKey)}`);
    console.log(`\tTotalBorrowBalanceInUSD - ${await this.defiCore.getTotalBorrowBalanceInUSD(userPublicKey)}`);
    console.log(`\tBorrowLimitInUSD - ${await this.defiCore.getCurrentBorrowLimitInUSD(userPublicKey)}`);
    console.log(`\tAvailable liquidity - ${result[0]}, debt - ${result[1]}`);
  }
}

module.exports = {
  PlatformHelper,
};
