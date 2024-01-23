// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private _decimals = 18;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mintArbitrary(address to_, uint256 amount_) public {
        _mint(to_, amount_);
    }

    function setDecimals(uint8 newDecimals_) external {
        _decimals = newDecimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mintArbitraryBatch(address[] memory to_, uint256[] memory amounts_) public {
        require(to_.length == amounts_.length, "MockERC20: Arrays must be the same length.");

        for (uint256 i = 0; i < to_.length; i++) {
            _mint(to_[i], amounts_[i]);
        }
    }

    function approveArbitraryBatch(
        address spender,
        address[] memory owners_,
        uint256[] memory amounts_
    ) public {
        require(owners_.length == amounts_.length, "MockERC20: Arrays must be the same length.");

        for (uint256 i = 0; i < owners_.length; i++) {
            _approve(owners_[i], spender, amounts_[i]);
        }
    }

    function burn(address account_, uint256 amount_) external {
        _burn(account_, amount_);
    }
}
