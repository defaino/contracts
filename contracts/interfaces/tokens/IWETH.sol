// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";

interface IWETH is IERC20Metadata, IERC20Permit {
    function deposit() external payable;

    function depositTo(address _recipient) external payable;

    function withdraw(uint256 _amount) external;

    function withdrawTo(address _recipient, uint256 _amount) external;
}
