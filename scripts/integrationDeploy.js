const MockERC20 = artifacts.require("MockERC20");
const YearnVaultMock = artifacts.require("YearnVaultMock");
const VaultRegistryMock = artifacts.require("VaultRegistryMock");
const CurvePoolMock = artifacts.require("CurvePoolMock");
const CurveZapMock = artifacts.require("CurveZapMock");
const CurveRegistryMock = artifacts.require("CurveRegistryMock");

const { getSymbols, getBaseCoinsAddresses, getTokensAddresses } = require("../migrations/helpers/deployHelper");
const { logAddress } = require("../migrations/helpers/logger");

async function deployMetaPool(metaSymbol, coinSymbol, baseTokenAddr, baseCoins, curveRegistry) {
  const currentUnderlyingCoins = [];
  const currentCoins = [];

  const metaToken = await MockERC20.new("Test Meta " + metaSymbol, "TM" + metaSymbol);

  currentCoins.push((await MockERC20.new("Test Coin " + coinSymbol, "TC" + coinSymbol)).address);
  currentCoins.push(baseTokenAddr);

  currentUnderlyingCoins.push(currentCoins[0]);
  for (let i = 0; i < 3; i++) {
    currentUnderlyingCoins.push(baseCoins[i]);
  }

  const metaPool = await CurvePoolMock.new(true, metaToken.address, currentCoins, currentUnderlyingCoins);

  await curveRegistry.addPool(metaPool.address, metaToken.address);

  return metaToken.address;
}

module.exports = async function (callback) {
  const symbols = getSymbols();
  const tokensAddresses = getTokensAddresses();

  const finalSymbols = [];
  const finalVaultTokens = [];

  const baseCoins = getBaseCoinsAddresses();

  const curveRegistry = await CurveRegistryMock.new();
  const vaultRegistry = await VaultRegistryMock.new();

  const baseToken = await MockERC20.new("Test 3Crv", "T3Crv");

  finalVaultTokens.push(baseToken.address);
  finalSymbols.push("3Crv");

  const basePool = await CurvePoolMock.new(false, baseToken.address, baseCoins, baseCoins);

  await curveRegistry.addPool(basePool.address, baseToken.address);

  const depositContract = await CurveZapMock.new(basePool.address, baseToken.address);

  logAddress("CurveRegistry", curveRegistry.address);
  logAddress("CurveZap", depositContract.address);
  logAddress("YEarnRegistry", vaultRegistry.address);

  for (let i = 1; i < tokensAddresses.length; i++) {
    finalVaultTokens.push(tokensAddresses[i]);
    finalSymbols.push(symbols[i]);
  }

  const metaPoolSymbols = ["CurveUST", "CurveTUSD", "CurveBUSD"];
  const metaCoinsSymbols = ["UST", "TUSD", "BUSD"];

  for (let i = 0; i < metaPoolSymbols.length; i++) {
    const metaTokenAddr = await deployMetaPool(
      metaPoolSymbols[i],
      metaCoinsSymbols[i],
      baseToken.address,
      baseCoins,
      curveRegistry
    );

    finalVaultTokens.push(metaTokenAddr);
    finalSymbols.push(metaPoolSymbols[i]);
  }

  for (let i = 0; i < finalVaultTokens.length; i++) {
    const newVault = await YearnVaultMock.new(
      "Test Vault " + finalSymbols[i],
      "TV" + finalSymbols[i],
      finalVaultTokens[i]
    );

    await vaultRegistry.addVault(finalVaultTokens[i], newVault.address);
    console.log(
      `Vault ${finalSymbols[i]} added. Vault token addr - ${finalVaultTokens[i]}. Vault addr - ${newVault.address}`
    );
  }

  callback();
};
