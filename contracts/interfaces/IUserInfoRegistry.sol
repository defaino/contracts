// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

interface IUserInfoRegistry {
    struct BasePoolInfo {
        bytes32 assetKey;
        address assetAddr;
        uint256 utilizationRatio;
        bool isAvailableAsCollateral;
    }

    struct UserMainInfo {
        uint256 totalSupplyBalanceInUSD;
        uint256 totalBorrowBalanceInUSD;
        uint256 borrowLimitInUSD;
        uint256 borrowLimitUsed;
    }

    struct RewardsDistributionInfo {
        address assetAddr;
        uint256 distributionReward;
        uint256 distributionRewardInUSD;
        uint256 userBalance;
        uint256 userBalanceInUSD;
    }

    struct UserSupplyPoolInfo {
        BasePoolInfo basePoolInfo;
        uint256 marketSize;
        uint256 marketSizeInUSD;
        uint256 userDeposit;
        uint256 userDepositInUSD;
        uint256 supplyAPY;
    }

    struct UserBorrowPoolInfo {
        BasePoolInfo basePoolInfo;
        uint256 availableToBorrow;
        uint256 availableToBorrowInUSD;
        uint256 userBorrowAmount;
        uint256 userBorrowAmountInUSD;
        uint256 borrowAPY;
    }

    struct UserPoolInfo {
        uint256 userWalletBalance;
        uint256 userWalletBalanceInUSD;
        uint256 userSupplyBalance;
        uint256 userSupplyBalanceInUSD;
        uint256 userBorrowBalance;
        uint256 userBorrowBalanceInUSD;
        bool isCollateralEnabled;
    }

    struct UserMaxValues {
        uint256 maxToSupply;
        uint256 maxToWithdraw;
        uint256 maxToBorrow;
        uint256 maxToRepay;
    }

    struct UserLiquidationInfo {
        bytes32[] borrowAssetKeys;
        bytes32[] supplyAssetKeys;
        uint256 totalBorrowedAmount;
    }

    struct UserLiquidationData {
        uint256 borrowAssetPrice;
        uint256 receiveAssetPrice;
        uint256 bonusReceiveAssetPrice;
        uint256 borrowedAmount;
        uint256 supplyAmount;
        uint256 maxQuantity;
    }

    function updateAssetsAfterTransfer(
        bytes32 _assetKey,
        address _from,
        address _to,
        uint256 _amount
    ) external;

    function updateUserSupplyAssets(address _userAddr, bytes32 _assetKey) external;

    function updateUserBorrowAssets(address _userAddr, bytes32 _assetKey) external;

    function getUserSupplyAssets(address _userAddr) external view returns (bytes32[] memory);

    function getUserBorrowAssets(address _userAddr) external view returns (bytes32[] memory);

    function getUserMainInfo(address _userAddr) external view returns (UserMainInfo memory);

    function getUserDistributionRewards(address _userAddr)
        external
        view
        returns (RewardsDistributionInfo memory);

    function getUserSupplyPoolsInfo(address _userAddr, bytes32[] calldata _assetKeys)
        external
        view
        returns (UserSupplyPoolInfo[] memory _supplyPoolsInfo);

    function getUserBorrowPoolsInfo(address _userAddr, bytes32[] calldata _assetKeys)
        external
        view
        returns (UserBorrowPoolInfo[] memory _borrowPoolsInfo);

    function getUserPoolInfo(address _userAddr, bytes32 _assetKey)
        external
        view
        returns (UserPoolInfo memory);

    function getUserMaxValues(address _userAddr, bytes32 _assetKey)
        external
        view
        returns (UserMaxValues memory);

    function getUsersLiquidiationInfo(address[] calldata _accounts)
        external
        view
        returns (UserLiquidationInfo[] memory _resultArr);

    function getUserLiquidationData(
        address _userAddr,
        bytes32 _borrowAssetKey,
        bytes32 _receiveAssetKey
    ) external view returns (UserLiquidationData memory);

    function getMaxLiquidationQuantity(
        address _userAddr,
        bytes32 _supplyAssetKey,
        bytes32 _borrowAssetKey
    ) external view returns (uint256 _maxQuantityInUSD);
}
