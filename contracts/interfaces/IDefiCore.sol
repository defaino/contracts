// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

interface IDefiCore {
    struct RewardsDistributionInfo {
        address assetAddr;
        uint256 distributionReward;
        uint256 distributionRewardInUSD;
        uint256 userBalance;
        uint256 userBalanceInUSD;
    }

    struct LiquidationInfo {
        bytes32[] borrowAssetKeys;
        bytes32[] supplyAssetKeys;
        uint256 totalBorrowedAmount;
    }

    struct UserLiquidationInfo {
        uint256 borrowAssetPrice;
        uint256 receiveAssetPrice;
        uint256 bonusReceiveAssetPrice;
        uint256 borrowedAmount;
        uint256 supplyAmount;
        uint256 maxQuantity;
    }

    event LiquidateBorrow(bytes32 _paramKey, address _userAddr, uint256 _amount);
    event LiquidatorPay(bytes32 _paramKey, address _liquidatorAddr, uint256 _amount);

    function disabledCollateralAssets(address _userAddr, bytes32 _assetKey)
        external
        view
        returns (bool);

    function isCollateralAssetEnabled(address _userAddr, bytes32 _assetKey)
        external
        view
        returns (bool);

    function getMaxToSupply(address _userAddr, bytes32 _assetKey) external view returns (uint256);

    function getMaxToWithdraw(address _userAddr, bytes32 _assetKey)
        external
        view
        returns (uint256);

    function getMaxToBorrow(address _userAddr, bytes32 _assetKey) external view returns (uint256);

    function getMaxToRepay(address _userAddr, bytes32 _assetKey) external view returns (uint256);

    function getUserLiquidityAmount(address _userAddr, bytes32 _assetKey)
        external
        view
        returns (uint256 _userLiquidityAmount);

    function getUserBorrowedAmount(address _userAddr, bytes32 _assetKey)
        external
        view
        returns (uint256 _userBorrowedAmount);

    function getTotalSupplyBalanceInUSD(address _userAddr)
        external
        view
        returns (uint256 _totalSupplyBalance);

    function getTotalBorrowBalanceInUSD(address _userAddr)
        external
        view
        returns (uint256 _totalBorrowBalance);

    function getCurrentBorrowLimitInUSD(address _userAddr)
        external
        view
        returns (uint256 _currentBorrowLimit);

    function getNewBorrowLimitInUSD(
        address _userAddr,
        bytes32 _assetKey,
        uint256 _tokensAmount,
        bool _isAdding
    ) external view returns (uint256);

    function getAvailableLiquidity(address _userAddr) external view returns (uint256, uint256);

    function enableCollateral(bytes32 _assetKey) external returns (uint256);

    function disableCollateral(bytes32 _assetKey) external returns (uint256);

    function addLiquidity(bytes32 _assetKey, uint256 _liquidityAmount) external;

    function withdrawLiquidity(
        bytes32 _assetKey,
        uint256 _liquidityAmount,
        bool _isMaxWithdraw
    ) external;

    function repayBorrow(
        bytes32 _assetKey,
        uint256 _repayAmount,
        bool _isMaxRepay
    ) external;
}
