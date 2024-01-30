// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.17;

import "../interfaces/IBasicPool.sol";
import "../interfaces/tokens/IStablePermitToken.sol";

import "../abstract/AbstractPool.sol";
import "../common/Globals.sol";

contract StablePool is IStablePool, AbstractPool {
    function stablePoolInitialize(
        address assetAddr_,
        bytes32 assetKey_
    ) external override initializer {
        _abstractPoolInitialize(assetAddr_, assetKey_);
    }

    function getAnnualBorrowRate()
        public
        view
        override(IBasicPool, AbstractPool)
        returns (uint256)
    {
        return _assetParameters.getAnnualBorrowRate(assetKey);
    }

    function _borrowAssetTokens(uint256 amountToBorrow_, address recipient_) internal override {
        IStablePermitToken(assetAddr).mint(recipient_, _convertToUnderlyingAsset(amountToBorrow_));
    }

    function _repayAssetTokens(uint256 repayAmount_, address payerAddr_) internal override {
        IStablePermitToken(assetAddr).burn(payerAddr_, _convertToUnderlyingAsset(repayAmount_));
    }
}
