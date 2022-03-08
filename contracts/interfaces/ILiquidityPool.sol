// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

interface ILiquidityPool {
    struct BorrowInfo {
        uint256 borrowAmount;
        uint256 normalizedAmount;
    }

    struct RepayBorrowVars {
        uint256 repayAmount;
        uint256 currentAbsoluteAmount;
        uint256 normalizedAmount;
        uint256 currentRate;
        address userAddr;
    }

    function liquidityPoolInitialize(
        address _assetAddr,
        bytes32 _assetKey,
        string memory _tokenSymbol
    ) external;

    function assetAddr() external view returns (address);

    function assetKey() external view returns (bytes32);

    function lastLiquidity(address _userAddr, uint256 _blockNumber)
        external
        view
        returns (uint256);

    function borrowInfos(address _userAddr)
        external
        view
        returns (uint256 _borrowAmount, uint256 _normalizedAmount);

    function aggregatedBorrowedAmount() external view returns (uint256);

    function totalReserves() external view returns (uint256);

    function getTotalLiquidity() external view returns (uint256);

    function getTotalBorrowedAmount() external view returns (uint256);

    function getAggregatedLiquidityAmount() external view returns (uint256);

    function getBorrowPercentage() external view returns (uint256);

    function getAvailableToBorrowLiquidity() external view returns (uint256);

    function getAnnualBorrowRate() external view returns (uint256 _annualBorrowRate);

    function getAPY() external view returns (uint256);

    function convertAssetToNTokens(uint256 _assetAmount) external view returns (uint256);

    function convertNTokensToAsset(uint256 _nTokensAmount) external view returns (uint256);

    function exchangeRate() external view returns (uint256);

    function getAmountInUSD(uint256 _assetAmount) external view returns (uint256);

    function getAmountFromUSD(uint256 _usdAmount) external view returns (uint256);

    function getAssetPrice() external view returns (uint256);

    function getUnderlyingDecimals() external view returns (uint8);

    function getCurrentRate() external view returns (uint256);

    function getNewCompoundRate() external view returns (uint256);

    function updateCompoundRate() external returns (uint256);

    function updateRateWithInterval() external returns (uint256);

    function addLiquidity(address _userAddr, uint256 _liquidityAmount) external;

    function withdrawLiquidity(
        address _userAddr,
        uint256 _liquidityAmount,
        bool _isMaxWithdraw
    ) external;

    function approveToBorrow(
        address _userAddr,
        uint256 _borrowAmount,
        address _borrowalAddr,
        uint256 _expectedAllowance
    ) external;

    function borrowFor(
        address _userAddr,
        address _delegator,
        uint256 _amountToBorrow
    ) external;

    function repayBorrowFor(
        address _userAddr,
        address _closureAddr,
        uint256 _repayAmount,
        bool _isMaxRepay
    ) external returns (uint256);

    function delegateBorrow(
        address _userAddr,
        address _delegator,
        uint256 _amountToBorrow
    ) external;

    function liquidate(
        address _userAddr,
        address _liquidatorAddr,
        uint256 _liquidityAmount
    ) external;

    function withdrawReservedFunds(
        address _recipientAddr,
        uint256 _amountToWithdraw,
        bool _isAllFunds
    ) external;
}
