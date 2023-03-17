const { PlatformHelper } = require("./utils/platformHelper");

async function main() {
  const networkName = "localhost";
  const registryAddr = "0x705CE6C7C51615BBa1a5C4e4E1912BC6Cc82e7fa";
  const nativeAmount = "1";
  const signersCount = 4;

  const platformHelper = new PlatformHelper();

  await platformHelper.init(networkName, registryAddr, nativeAmount, signersCount);

  console.log("\nFILL POOLS...");

  await platformHelper.depositAssets(platformHelper.signers[0], ["USDC", "DAI"], ["100000", "100000"]);

  console.log("\nFISRT SIGNER DEPOSITS/BORROWS...");

  const user1DepositAssets = ["WBTC"];
  const user1DepositAmounts = ["1"];

  await platformHelper.depositAssets(platformHelper.signers[1], user1DepositAssets, user1DepositAmounts);

  const user1BorrowAssets = ["USDC"];
  const user1BorrowAmounts = ["16000"];

  await platformHelper.borrowAssets(platformHelper.signers[1], user1BorrowAssets, user1BorrowAmounts);

  console.log("\nSECOND SIGNER DEPOSITS/BORROWS...");

  const user2DepositAssets = ["WBTC", "DAI"];
  const user2DepositAmounts = ["1", "1000"];

  await platformHelper.depositAssets(platformHelper.signers[2], user2DepositAssets, user2DepositAmounts);

  const user2BorrowAssets = ["USDC"];
  const user2BorrowAmounts = ["17000"];

  await platformHelper.borrowAssets(platformHelper.signers[2], user2BorrowAssets, user2BorrowAmounts);

  console.log("\nTHIRD SIGNER DEPOSITS/BORROWS...");

  const user3DepositAssets = ["WBTC", "RTK"];
  const user3DepositAmounts = ["1", "500"];

  await platformHelper.depositAssets(platformHelper.signers[3], user3DepositAssets, user3DepositAmounts);

  const user3BorrowAssets = ["USDC", "DAI"];
  const user3BorrowAmounts = ["10000", "6500"];

  await platformHelper.borrowAssets(platformHelper.signers[3], user3BorrowAssets, user3BorrowAmounts);

  console.log("\nUPDATE PRICES");

  await platformHelper.updatePrices(["WBTC"], ["23000"]);

  console.log("\nNEW USERS STATS");

  for (let i = 1; i < signersCount; i++) {
    await platformHelper.printUserMainInfo(platformHelper.signersPublicKeys[i]);
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
