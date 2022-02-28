# New DeFi

### Setup

- To configure the system, you need to run the command - `yarn install`

### Helpful information

- Before running tests, you need to run a private network in a separate terminal - `npm run private-network`
- To run tests without migrations - `npm run test`
- To run tests with migrations - `npm run test-all`
- To fix the coding style - `npm run lint-fix`
- To run fork tests:
    1. Run - `npm run private-network-fork <node-endpoint>`
    1. Run - `npm run test-fork`

### Deploy information

- Create file **.env** and fill it according to the template from file **.env.example**
- For deploying to a private network - `npm run deploy dev`
- For deploying to a public network - setup deploy-helper.js file and run `npm run deploy <network-name>` (need script in the package.json file)
- To verify contracts implementations - `truffle run verify <list-of-contracts> --network <network-name>`, if it gives an error or cannot find a contract, then you need to use `<contract-name>@<contract-address>` for each contract
- To verify proxy contracts:
    1. You need to copy the constructor interface from TransparentUpgradeableProxy.json and use site https://abi.hashex.org/ to get the bytecode of the constructor arguments
    1. After that we use the command `truffle verify TransparentUpgradeableProxy@<proxy-address> --forceConstructorArgs string:<constructor-arguments-bytecode> --network <network-name>`
- To verify Liquidity Pools:
    1. You need to copy the constructor interface from LiquidityPool.json and use site https://abi.hashex.org/ to get the bytecode of the constructor arguments
    1. After that we use the command `truffle run verify LiquidityPool@<contract-address> --forceConstructorArgs string:<constructor-arguments-bytecode> --network <network-name>`