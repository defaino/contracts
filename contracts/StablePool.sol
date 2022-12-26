// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "./interfaces/IBasicPool.sol";
import "./interfaces/tokens/IStablePermitToken.sol";

import "./abstract/AbstractPool.sol";
import "./common/Globals.sol";

contract StablePool is IStablePool, AbstractPool {
    function stablePoolInitialize(
        address _assetAddr,
        bytes32 _assetKey
    ) external override initializer {
        _abstractPoolInitialize(_assetAddr, _assetKey);
    }

    function getAnnualBorrowRate()
        public
        view
        override(IBasicPool, AbstractPool)
        returns (uint256)
    {
        return assetParameters.getAnnualBorrowRate(assetKey);
    }

    function _borrowAssetTokens(uint256 _amountToBorrow, address _recipient) internal override {
        IStablePermitToken(assetAddr).mint(_recipient, _convertToUnderlyingAsset(_amountToBorrow));
    }

    function _repayAssetTokens(uint256 _repayAmount, address _payerAddr) internal override {
        IStablePermitToken(assetAddr).burn(_payerAddr, _convertToUnderlyingAsset(_repayAmount));
    }
}
