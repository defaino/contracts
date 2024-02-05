[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=square)](https://github.com/prettier/prettier)

# DeFaino contracts

This package contains the basic contracts and interfaces of the [DeFaino](https://github.com/defaino/contracts) lending protocol. These contracts will help you make your own DeFaino-based implementation or integrate with existing systems 

## Overview

### Installation

```console
$ npm install @defaino/contracts
```

The latest stable version is always in the `master` branch.

## Usage

This package will assist you in writing contracts that should integrate with a DeFaino-based lending protocol

Once the [npm package](https://www.npmjs.com/package/@defaino/contracts) is installed, one can use the contracts just like that:

```solidity
pragma solidity ^0.8.17;

import {IPriceManager} from "@defaino/contracts/interfaces/IPriceManager.sol";

contract MyPriceManager is IPriceManager {
    . . .
}
```

## License

The package is released under the GPL-3.0 License.
