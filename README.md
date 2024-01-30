[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=square)](https://github.com/prettier/prettier)

# DeFaino contracts

## Setup project and helpful scripts

- Initially, all packages and dependencies must be installed - `npm run install`
- To compile contracts - `npm run compile`
- To run unit tests - `npm run test`
- To run solidity-coverage -  `npm run coverage`
- To lint code in repository - `npm run lint-fix`

## Deploy system
Before deploying the system, create an **.env** file following the example (**.env.example**) given in the repository

The contents of the **.env.example**:

```bash
# A private key for the account from which all transactions will be sent (uploading, script execution, etc.)
PRIVATE_KEY = "YOUR PRIVATE KEY"

# Project ID on Infura to make it into the right RPC
INFURA_KEY = "INFURA PROJECT ID"

# API key, which is needed to verify contracts on Etherscan
ETHERSCAN_KEY = "ETHERSCAN API KEY"

# API key, which is needed to verify contracts on Bscscan
BSCSCAN_KEY = "BSCSCAN API KEY"
```

The next step is to create the **config.json** file in the **./deploy/data** folder from the **config.example.json** file.

Example of the config file:
```json
{
  "nativeAssetSymbol": "WETH",
  "rewardsAssetSymbol": "",
  "rewardsAssetToken": "",
  "isStablePoolsAvailable": true,
  "systemParameters": {
    "liquidationBoundary": "50",
    "minCurrencyAmount": "0.01"
  },
  "prtData": {
    "name": "Platform Reputation Token",
    "symbol": "PRT",
    "prtParams": {
      "supplyParams": {
        "minAmountInUSD": "1000000000000",
        "minTimeAfter": "100"
      },
      "borrowParams": {
        "minAmountInUSD": "300000000000",
        "minTimeAfter": "100"
      }
    }
  },
  "liquidityPoolsData": [
    {
      "symbol": "WETH",
      "assetAddr": "0xe1c3bcb66611866060Cd2D4fb2bbA973e62f7789",
      "priceFeedAddr": "0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e",
      "isAvailableAsCollateral": true,
      "isAvailableAsCollateralWithPrt": true,
      "rewardPerBlock": "0",
      "allPoolParams": {
        "mainParams": {
          "collateralizationRatio": "125",
          "collateralizationRatioWithPRT": "125",
          "reserveFactor": "33",
          "liquidationDiscount": "7",
          "maxUtilizationRatio": "97"
        },
        "interestRateParams": {
          "basePercentage": "0",
          "firstSlope": "5",
          "secondSlope": "100",
          "utilizationBreakingPoint": "70"
        },
        "distrMinimums": {
          "minSupplyDistrPart": "10",
          "minBorrowDistrPart": "10"
        }
      }
    },
    {
      "symbol": "DAI",
      "assetAddr": "0x3203De8408DC9ecC150d52327e53B14d236A6d27",
      "priceFeedAddr": "0x132d3C0B1D2cEa0BC552588063bdBb210FDeecfA",
      "isAvailableAsCollateral": true,
      "isAvailableAsCollateralWithPrt": true,
      "rewardPerBlock": "0",
      "allPoolParams": {
        "mainParams": {
          "collateralizationRatio": "125",
          "collateralizationRatioWithPRT": "125",
          "reserveFactor": "33",
          "liquidationDiscount": "7",
          "maxUtilizationRatio": "97"
        },
        "interestRateParams": {
          "basePercentage": "0",
          "firstSlope": "5",
          "secondSlope": "100",
          "utilizationBreakingPoint": "80"
        },
        "distrMinimums": {
          "minSupplyDistrPart": "10",
          "minBorrowDistrPart": "10"
        }
      }
    }
  ],
  "stablePoolsData": [
    {
      "symbol": "TST",
      "assetAddr": "0xe1c3bcb66611866060Cd2D4fb2bbA973e62f7789",
      "priceFeedAddr": "0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e",
      "rewardPerBlock": "0",
      "annualBorrowRate": "2",
      "mainParams": {
        "collateralizationRatio": "115",
        "collateralizationRatioWithPRT": "115",
        "reserveFactor": "10",
        "liquidationDiscount": "7",
        "maxUtilizationRatio": "95"
      }
    }
  ]
}
```


Next, you need to perform the deploy itself to the desired network using the command - `npm run deploy-<network-name>`
