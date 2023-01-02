// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";

import "../interfaces/tokens/IWETH.sol";

contract WETH is IWETH, ERC20Permit {
    constructor() ERC20Permit("DL DeFi Core WETH") ERC20("DL DeFi Core WETH", "WETH") {}

    receive() external payable {
        _depositTo(msg.sender);
    }

    function deposit() external payable override {
        _depositTo(msg.sender);
    }

    function depositTo(address recipient_) external payable override {
        _depositTo(recipient_);
    }

    function withdraw(uint256 amount_) external override {
        _withdrawTo(msg.sender, amount_);
    }

    function withdrawTo(address recipient_, uint256 amount_) external override {
        _withdrawTo(recipient_, amount_);
    }

    function _depositTo(address recipient_) internal {
        require(msg.value != 0, "WETH: Zero deposit amount.");

        _mint(recipient_, msg.value);
    }

    function _withdrawTo(address recipient_, uint256 amount_) internal {
        require(amount_ != 0, "WETH: Zero withdraw amount.");

        _burn(msg.sender, amount_);

        (bool success_, ) = recipient_.call{value: amount_}("");
        require(success_, "WETH: Failed to transfer AAA.");
    }
}
