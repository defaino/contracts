const HDWalletProvider = require("@truffle/hdwallet-provider");
require("dotenv").config(); // Store environment-specific variable from '.env' to process.env

module.exports = {
  networks: {
    development: {
      host: "127.0.0.1", // Localhost (default: none)
      port: 8545, // Standard Ethereum port (default: none)
      network_id: "*", // Any network (default: none)
      gasLimit: 10000000, // <-- Use this high gas value
      gasPrice: 50000000000,
      disableConfirmationListener: true,
    },

    coverage: {
      host: "localhost",
      network_id: "*",
      port: 8555, // <-- If you change this, also set the port option in .solcover.js.
      gas: 0xfffffffffff, // <-- Use this high gas value
      gasLimit: 0xfffffffffff, // <-- Use this high gas value
      gasPrice: 0x01, // <-- Use this low gas price
    },

    ropsten: {
      provider: () =>
        new HDWalletProvider([process.env.PRIVATE_KEY], `wss://ropsten.infura.io/ws/v3/${process.env.PROJECT_ID}`),
      network_id: 3,
      gas: 7000000,
      gasPrice: 30000000000, // 30 gwei
      skipDryRun: true,
    },

    rinkeby: {
      provider: () =>
        new HDWalletProvider([process.env.PRIVATE_KEY], `wss://rinkeby.infura.io/ws/v3/${process.env.PROJECT_ID}`),
      network_id: 4,
      gas: 7000000,
      gasPrice: 30000000000, // 30 gwei
      skipDryRun: true,
    },

    kovan: {
      provider: () =>
        new HDWalletProvider(process.env.MNENOMIC, `https://kovan.infura.io/v3/${process.env.PROJECT_ID}`, 0, 3),
      network_id: 42,
      // gas: 8000000,
      // gasLimit: 8000000, // <-- Use this high gas value
      gasPrice: 1000000000,
    },

    main: {
      provider: () =>
        new HDWalletProvider(process.env.PRIVATE_KEY, `https://mainnet.infura.io/v3/${process.env.PROJECT_ID}`),
      gas: 4000000,
      gasLimit: 4000000,
      gasPrice: 120000000000,
      network_id: 1,
    },
  },

  // Set default mocha options here, use special reporters etc.
  // mocha: {
  //   color: true,
  //   timeout: 5000000,
  //   reporter: 'eth-gas-reporter',
  //   reporterOptions: {
  //     showTimeSpent: true,
  //     noColors: false,
  //     currency: 'USD',
  //     coinmarketcap: 'd2bcdde7-26e5-4930-ba9d-165ddb85aa23',
  //   },
  // },

  compilers: {
    solc: {
      version: "0.8.3",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
      },
    },
  },

  plugins: ["truffle-plugin-verify"],

  api_keys: {
    etherscan: process.env.ETHERSCAN_KEY,
  },
};
