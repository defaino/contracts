// SPDX-License-Identifier: LGPL-3.0-or-later
pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private _decimals = 18;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mintArbitrary(address _to, uint256 _amount) public {
        _mint(_to, _amount);
    }

    function setDecimals(uint8 _newDecimals) external {
        _decimals = _newDecimals;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mintArbitraryBatch(address[] memory _to, uint256[] memory _amounts) public {
        require(_to.length == _amounts.length, "MockERC20: Arrays must be the same length.");

        for (uint256 i = 0; i < _to.length; i++) {
            _mint(_to[i], _amounts[i]);
        }
    }

    function approveArbitraryBacth(
        address spender,
        address[] memory _owners,
        uint256[] memory _amounts
    ) public {
        require(_owners.length == _amounts.length, "MockERC20: Arrays must be the same length.");

        for (uint256 i = 0; i < _owners.length; i++) {
            _approve(_owners[i], spender, _amounts[i]);
        }
    }

    function burn(address _account, uint256 _amount) external {
        _burn(_account, _amount);
    }
}
