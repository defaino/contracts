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

    function depositTo(address _recipient) external payable override {
        _depositTo(_recipient);
    }

    function withdraw(uint256 _amount) external override {
        _withdrawTo(msg.sender, _amount);
    }

    function withdrawTo(address _recipient, uint256 _amount) external override {
        _withdrawTo(_recipient, _amount);
    }

    function _depositTo(address _recipient) internal {
        require(msg.value != 0, "WETH: Zero deposit amount.");

        _mint(_recipient, msg.value);
    }

    function _withdrawTo(address _recipient, uint256 _amount) internal {
        require(_amount != 0, "WETH: Zero withdraw amount.");

        _burn(msg.sender, _amount);

        (bool _success, ) = _recipient.call{value: _amount}("");
        require(_success, "WETH: Failed to transfer AAA.");
    }
}
