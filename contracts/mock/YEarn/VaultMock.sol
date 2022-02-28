// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../../interfaces/YEarn/IVault.sol";

import "../../common/Globals.sol";

import "../MockERC20.sol";

/**
 * @notice The interface from yearn protocol repository
 * https://github.com/yearn/yearn-protocol/blob/develop/interfaces/yearn/IVault.sol
 */

contract YearnVaultMock is IYearnVault, ERC20 {
    address public override token;

    uint256 public exchangeRate;
    uint8 private tokenDecimals;

    constructor(
        string memory _name,
        string memory _symbol,
        address _tokenAddr
    ) ERC20(_name, _symbol) {
        token = _tokenAddr;
        tokenDecimals = ERC20(_tokenAddr).decimals();

        exchangeRate = DECIMAL;
    }

    function setDecimals(uint8 _newDecimals) external {
        tokenDecimals = _newDecimals;
        MockERC20(token).setDecimals(_newDecimals);
    }

    function setToken(address _newTokenAddr) external {
        token = _newTokenAddr;
    }

    function setExchangeRate(uint256 _newExchangeRate) external {
        exchangeRate = _newExchangeRate;
    }

    function deposit() external override returns (uint256) {
        return deposit(ERC20(token).balanceOf(msg.sender), msg.sender);
    }

    function deposit(uint256 amount) external override returns (uint256) {
        return deposit(amount, msg.sender);
    }

    function deposit(uint256 amount, address recipient) public override returns (uint256) {
        uint256 _amountToMint = _convertToLP(amount);
        _mint(recipient, _amountToMint);

        ERC20(token).transferFrom(msg.sender, address(this), amount);

        return _amountToMint;
    }

    // NOTE: Vyper produces multiple signatures for a given function with "default" args
    function withdraw() external override returns (uint256) {
        return withdraw(balanceOf(msg.sender), msg.sender);
    }

    function withdraw(uint256 maxShares) external override returns (uint256) {
        return withdraw(maxShares, msg.sender);
    }

    function withdraw(uint256 maxShares, address recipient) public override returns (uint256) {
        uint256 _amountToTransfer = _convertFromLP(maxShares);
        _burn(msg.sender, maxShares);

        ERC20(token).transfer(recipient, _amountToTransfer);

        return _amountToTransfer;
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }

    function pricePerShare() external view override returns (uint256) {
        return _convertFromLP(10**tokenDecimals);
    }

    function _convertToLP(uint256 _amountToConvert) internal view returns (uint256) {
        return (_amountToConvert * DECIMAL) / exchangeRate;
    }

    function _convertFromLP(uint256 _amountToConvert) internal view returns (uint256) {
        return (_amountToConvert * exchangeRate) / DECIMAL;
    }
}
