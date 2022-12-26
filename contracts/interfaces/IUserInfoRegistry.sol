// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

/**
 * This is a contract that can be used to obtain information for a specific user.
 * Available information: the keys of the assets that the user has deposited and borrowed;
 * information about the user's rewards, the user's basic information, detailed information about deposits and credits
 */
interface IUserInfoRegistry {
    /// @notice The main pool parameters
    /// @param assetKey the key of the current pool. Can be thought of as a pool identifier
    /// @param assetAddr the address of the pool underlying asset
    struct MainPoolInfo {
        bytes32 assetKey;
        address assetAddr;
    }

    /// @notice The base pool parameters
    /// @param mainInfo element type MainPoolInfo structure
    /// @param utilizationRatio the current percentage of how much of the pool was borrowed for liquidity
    /// @param isCollateralEnabled shows whether the current asset is enabled as a collateral for a particular user
    struct BasePoolInfo {
        MainPoolInfo mainInfo;
        uint256 utilizationRatio;
        bool isCollateralEnabled;
    }

    /// @notice Main user information
    /// @param userCurrencyBalance total amount of the user's native currency balance
    /// @param totalSupplyBalanceInUSD total amount of the user's deposit for all assets in dollars
    /// @param totalBorrowBalanceInUSD total amount of user credits for all assets in dollars
    /// @param borrowLimitInUSD the total amount in dollars for which the user can take credit
    /// @param borrowLimitUsed current percentage of available collateral use
    struct UserMainInfo {
        uint256 userCurrencyBalance;
        uint256 totalSupplyBalanceInUSD;
        uint256 totalBorrowBalanceInUSD;
        uint256 borrowLimitInUSD;
        uint256 borrowLimitUsed;
    }

    /// @notice Structure, which contains information about user rewards for credits and deposits
    /// @param assetAddr the address of the token that is given out as a reward
    /// @param distributionReward the number of tokens the user can currently receive
    /// @param distributionRewardInUSD the equivalent of distributionReward param in dollars
    /// @param userBalance current balance of the user in tokens, which are issued as a reward
    /// @param distributionRewardInUSD the equivalent of userBalance param in dollars
    struct RewardsDistributionInfo {
        address assetAddr;
        uint256 distributionReward;
        uint256 distributionRewardInUSD;
        uint256 userBalance;
        uint256 userBalanceInUSD;
    }

    /// @notice Structure, which contains information about the pool, in which the user has made a deposit
    /// @param basePoolInfo element type BasePoolInfo structure
    /// @param marketSize the total number of pool tokens that all users have deposited
    /// @param marketSizeInUSD the equivalent of marketSize param in dollars
    /// @param userDeposit the number of tokens that the user has deposited
    /// @param userDepositInUSD the equivalent of userDeposit param in dollars
    /// @param supplyAPY annual interest rate on the deposit in the current pool
    /// @param distrSupplyAPY annual distribution rate for users who deposited in the current pool
    struct UserSupplyPoolInfo {
        BasePoolInfo basePoolInfo;
        uint256 marketSize;
        uint256 marketSizeInUSD;
        uint256 userDeposit;
        uint256 userDepositInUSD;
        uint256 supplyAPY;
        uint256 distrSupplyAPY;
    }

    /// @notice Structure, which contains information about the pool, in which the user has made a borrow
    /// @param basePoolInfo element type BasePoolInfo structure
    /// @param availableToBorrow available amount of tokens in the pool for borrows
    /// @param availableToBorrowInUSD the equivalent of availableToBorrow param in dollars
    /// @param userBorrowAmount the number of tokens that the user has borrowed in this pool
    /// @param userBorrowAmountInUSD the equivalent of userBorrowAmount param in dollars
    /// @param borrowAPY the annual interest rate on the loan, which is received by users who have taken a loan in the current pool
    /// @param distrBorrowAPY annual distribution rate for users who took credit in the current pool
    struct UserBorrowPoolInfo {
        BasePoolInfo basePoolInfo;
        uint256 availableToBorrow;
        uint256 availableToBorrowInUSD;
        uint256 userBorrowAmount;
        uint256 userBorrowAmountInUSD;
        uint256 borrowAPY;
        uint256 distrBorrowAPY;
    }

    /// @notice A structure that contains information about the user's credit and deposit in the current pool
    /// @param userWalletBalance current user balance in pool underlying tokens (token balance + currency balance, if native pool)
    /// @param userWalletBalanceInUSD the equivalent of userWalletBalance param in dollars
    /// @param userSupplyBalance the number of tokens that the user has deposited
    /// @param userSupplyBalanceInUSD the equivalent of userSupplyBalance param in dollars
    /// @param userBorrowBalance the number of tokens that the user has borrowed in this pool
    /// @param userBorrowBalanceInUSD the equivalent of userBorrowBalance param in dollars
    /// @param isCollateralEnabled shows whether the current asset is enabled as a collateral for a particular user
    struct UserPoolInfo {
        uint256 userWalletBalance;
        uint256 userWalletBalanceInUSD;
        uint256 userSupplyBalance;
        uint256 userSupplyBalanceInUSD;
        uint256 userBorrowBalance;
        uint256 userBorrowBalanceInUSD;
        bool isCollateralEnabled;
    }

    /// @notice Structure, which contains the maximum values of deposit/withdrawal, borrow/repay for a particular user
    /// @param maxToSupply maximum possible value for the deposit into the current pool
    /// @param maxToWithdraw maximum possible value to withdraw from the current pool
    /// @param maxToBorrow the maximum possible value for taking credit in the current pool
    /// @param maxToRepay the maximum possible value for the repayment of the loan in the current pool
    struct UserMaxValues {
        uint256 maxToSupply;
        uint256 maxToWithdraw;
        uint256 maxToBorrow;
        uint256 maxToRepay;
    }

    /// @notice A structure that contains general information about the user for liquidation
    /// @param borrowAssetKeys an array of keys from the pools where the user took credit
    /// @param supplyAssetKeys array of keys from pools where user deposited
    /// @param totalBorrowedAmount total amount of user credits for all assets in dollars
    struct UserLiquidationInfo {
        address userAddr;
        MainPoolInfo[] borrowPoolsInfo;
        MainPoolInfo[] sypplyPoolsInfo;
        uint256 totalBorrowedAmount;
    }

    /// @notice Structure, which contains detailed information on liquidation
    /// @param borrowAssetPrice the price of the token that the user took on credit
    /// @param receiveAssetPrice the price of the token that the liquidator will receive
    /// @param bonusReceiveAssetPrice discounted token price that the liquidator will receive
    /// @param borrowedAmount number of tokens, which the user took on credit
    /// @param supplyAmount the number of tokens that the user has deposited
    /// @param maxQuantity the maximum amount by which a liquidator can repay a user's debt
    struct UserLiquidationData {
        uint256 borrowAssetPrice;
        uint256 receiveAssetPrice;
        uint256 bonusReceiveAssetPrice;
        uint256 borrowedAmount;
        uint256 supplyAmount;
        uint256 maxQuantity;
    }

    /// @notice A system function that is needed to update users' assets after LP token transfers
    /// @dev Only LiquidityPools contracts can call this function
    /// @param _assetKey the key of the specific liquidity pool
    /// @param _from the address of the user who sends the tokens
    /// @param _to the address of the user to whom the tokens are sent
    /// @param _amount number of LP tokens that are transferred
    function updateAssetsAfterTransfer(
        bytes32 _assetKey,
        address _from,
        address _to,
        uint256 _amount
    ) external;

    /// @notice System function, which is needed to update the list of keys of pools of the user, in which he put a deposit
    /// @dev Only DefiCore contracts can call this function
    /// @param _userAddr the address of the user for whom the pool key list will be updated
    /// @param _assetKey the key of the specific liquidity pool
    function updateUserSupplyAssets(address _userAddr, bytes32 _assetKey) external;

    /// @notice System function required to update the list of keys of pools the user has taken credit from
    /// @dev Only DefiCore contracts can call this function
    /// @param _userAddr the address of the user for whom the pool key list will be updated
    /// @param _assetKey the key of the specific liquidity pool
    function updateUserBorrowAssets(address _userAddr, bytes32 _assetKey) external;

    /// @notice The function that returns for a particular user a list of keys from pools where he has deposited
    /// @param _userAddr user address
    /// @return an array of keys of pools, in which the user has made a deposit
    function getUserSupplyAssets(address _userAddr) external view returns (bytes32[] memory);

    /// @notice A function that returns, for a specific user, a list of keys from the pools where he took credit
    /// @param _userAddr user address
    /// @return an array of keys of pools, in which the user took credit
    function getUserBorrowAssets(address _userAddr) external view returns (bytes32[] memory);

    /// @notice A function that returns a structure with main user parameters
    /// @param _userAddr user address
    /// @return an UserMainInfo structure
    function getUserMainInfo(address _userAddr) external view returns (UserMainInfo memory);

    /// @notice A function that returns a structure with information about user awards
    /// @param _userAddr user address
    /// @return a RewardsDistributionInfo structure
    function getUserDistributionRewards(
        address _userAddr
    ) external view returns (RewardsDistributionInfo memory);

    /// @notice The function that returns an array of structures with information about the pool where the user has made a deposit
    /// @param _userAddr user address
    /// @return _supplyPoolsInfo an array of UserSupplyPoolInfo structures
    function getUserSupplyPoolsInfo(
        address _userAddr,
        bytes32[] calldata _assetKeys
    ) external view returns (UserSupplyPoolInfo[] memory _supplyPoolsInfo);

    /// @notice A function that returns an array of structures with information about the pool where the user took credit
    /// @param _userAddr user address
    /// @param _assetKeys an array of pool keys for which you want to get information
    /// @return _borrowPoolsInfo an array of UserBorrowPoolInfo structures
    function getUserBorrowPoolsInfo(
        address _userAddr,
        bytes32[] calldata _assetKeys
    ) external view returns (UserBorrowPoolInfo[] memory _borrowPoolsInfo);

    /// @notice The function that returns information about the deposit and credit of the user in the pool
    /// @param _userAddr user address
    /// @param _assetKey pool key for which you want to get information
    /// @return an UserPoolInfo structure
    function getUserPoolInfo(
        address _userAddr,
        bytes32 _assetKey
    ) external view returns (UserPoolInfo memory);

    /// @notice A function that returns information about the maximum values for the user
    /// @param _userAddr user address
    /// @param _assetKey pool key for which you want to get information
    /// @return an UserMaxValues structure
    function getUserMaxValues(
        address _userAddr,
        bytes32 _assetKey
    ) external view returns (UserMaxValues memory);

    /// @notice A function that returns general information for the liquidation of a specific user
    /// @param _accounts accounts for which you need to get information
    /// @return _resultArr an array of UserLiquidationInfo structures
    function getUsersLiquidiationInfo(
        address[] calldata _accounts
    ) external view returns (UserLiquidationInfo[] memory _resultArr);

    /// @notice Function for getting detailed liquidation information for a particular user
    /// @param _userAddr user address
    /// @param _borrowAssetKey key of the pool where the user took the credit
    /// @param _receiveAssetKey the key of the pool in which the user has deposited
    /// @return an UserLiquidationData structure
    function getUserLiquidationData(
        address _userAddr,
        bytes32 _borrowAssetKey,
        bytes32 _receiveAssetKey
    ) external view returns (UserLiquidationData memory);

    /// @notice Function for obtaining the maximum possible amount for liquidation
    /// @param _userAddr user address
    /// @param _supplyAssetKey the key of the pool in which the user has deposited
    /// @param _borrowAssetKey key of the pool where the user took the credit
    /// @return _maxQuantityInUSD maximum amount for liquidation in dollars
    function getMaxLiquidationQuantity(
        address _userAddr,
        bytes32 _supplyAssetKey,
        bytes32 _borrowAssetKey
    ) external view returns (uint256 _maxQuantityInUSD);
}
