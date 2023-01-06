// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";

interface IWETH is IERC20Metadata, IERC20Permit {
    function deposit() external payable;

    function depositTo(address recipient_) external payable;

    function withdraw(uint256 amount_) external;

    function withdrawTo(address recipient_, uint256 amount_) external;
}
