// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IPRT.sol";
import "../interfaces/IDefiCore.sol";

contract PRTReentrancy is IERC721Receiver {
    IPRT private _prt;
    IDefiCore private _defiCore;
    uint256 private _mintNum;
    address private _minter;

    constructor(address prt_, uint256 mintNum_, address minter_, address defiCore_) {
        _prt = IPRT(prt_);
        _mintNum = mintNum_;
        _minter = minter_;
        _defiCore = IDefiCore(defiCore_);
    }

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external override returns (bytes4) {
        for (uint256 i = 0; i < _mintNum; ++i) {
            _prt.mintPRT();
        }
        return this.onERC721Received.selector;
    }

    function borrowFor(bytes32 assetKey_, uint256 borrowAmount_, address recipientAddr_) external {
        _defiCore.borrowFor(assetKey_, borrowAmount_, recipientAddr_);
    }

    function addLiquidity(bytes32 assetKey_, uint256 liquidityAmount_) external payable {
        _defiCore.addLiquidity(assetKey_, liquidityAmount_);
    }

    function repayBorrow(
        bytes32 assetKey_,
        uint256 repayAmount_,
        bool isMaxRepay_
    ) external payable {
        _defiCore.repayBorrow(assetKey_, repayAmount_, isMaxRepay_);
    }

    function approve(address token_, address spender_, uint256 amount_) external {
        IERC20(token_).approve(spender_, amount_);
    }

    function mintPRT() external {
        _prt.mintPRT();
    }
}
