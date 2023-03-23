// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

/**
 * The central contract of the protocol, through which the main interaction goes.
 * Through this contract, liquidity is deposited, withdrawn, borrowed, repaid, claim distribution rewards, liquidated, and much more
 */
interface IDefiCore {
    /// @notice This event is emitted when a user update collateral value for specific pool
    /// @param userAddr address of the user who updated the collateral value
    /// @param assetKey key of the pool where the collateral value was updated
    /// @param newValue a new collateral value
    event CollateralUpdated(address indexed userAddr, bytes32 indexed assetKey, bool newValue);

    event Liquidated(
        address userAddr_,
        bytes32 supplyAssetKey_,
        bytes32 borrowAssetKey_,
        uint256 liquidationAmount_
    );

    /// @notice This event is emitted when a user deposits liquidity into the pool
    /// @param userAddr address of the user who deposited the liquidity
    /// @param assetKey key of the pool where the liquidity was deposited
    /// @param liquidityAmount number of tokens that were deposited
    event LiquidityAdded(
        address indexed userAddr,
        bytes32 indexed assetKey,
        uint256 liquidityAmount
    );

    /// @notice This event is emitted when a user withdraws liquidity from the pool
    /// @param userAddr address of the user who withdrawn the liquidity
    /// @param assetKey key of the pool where the liquidity was withdrawn
    /// @param liquidityAmount number of tokens that were withdrawn
    event LiquidityWithdrawn(
        address indexed userAddr,
        bytes32 indexed assetKey,
        uint256 liquidityAmount
    );

    /// @notice This event is emitted when a user takes tokens on credit
    /// @param borrower address of the user on whom the borrow is taken
    /// @param recipient the address of the user to which the taken tokens will be sent
    /// @param assetKey the key of the pool, the tokens of which will be taken on credit
    /// @param borrowedAmount number of tokens to be taken on credit
    /// @param borrowedAmountInUSD the equivalent of borrowedAmount param in dollars
    event Borrowed(
        address indexed borrower,
        address recipient,
        bytes32 indexed assetKey,
        uint256 borrowedAmount,
        uint256 borrowedAmountInUSD
    );

    /// @notice This event is emitted during the repayment of credit by the user
    /// @param userAddr address of the user whose credit will be repaid
    /// @param assetKey key of the pool in which the loan will be repaid
    /// @param repaidAmount the amount of tokens for which the loan will be repaid
    /// @param repaidAmountInUSD the equivalent of repaidAmount param in dollars
    event BorrowRepaid(
        address indexed userAddr,
        bytes32 indexed assetKey,
        uint256 repaidAmount,
        uint256 repaidAmountInUSD
    );

    /// @notice This event is emitted during the approve for delegated credit
    /// @param userAddr address of the user who approved delegated borrow
    /// @param assetKey the key of the pool in which the approve will be made
    /// @param delegateeAddr address who is allowed to borrow the passed amount
    /// @param newAmount the amount for which the approval is made
    event DelegateBorrowApproved(
        address indexed userAddr,
        bytes32 indexed assetKey,
        address delegateeAddr,
        uint256 newAmount
    );

    /// @notice This event is emitted when the user receives their distribution rewards
    /// @param userAddr address of the user who receives distribution rewards
    /// @param rewardAmount the amount of rewards the user will receive
    event DistributionRewardWithdrawn(address indexed userAddr, uint256 rewardAmount);

    /// @notice Function for pausing all user interactions with the system
    /// @dev Only contract owner can call this function
    function pause() external;

    /// @notice Function for unpausing all user interactions with the system
    /// @dev Only contract owner can call this function
    function unpause() external;

    /// @notice With this function you can change the value of the disabled of the asset as a collateral
    /// @param assetKey_ pool key to update the value
    /// @param isDisabled_ a flag that shows whether the asset will be disabled as a collateral
    function updateCollateral(bytes32 assetKey_, bool isDisabled_) external;

    /// @notice Function to update the compound rate with or without interval by pool key
    /// @param assetKey_ key of the pool for which the compound rate will be updated
    /// @param withInterval_ flag that shows whether to update the rate with or without interval
    /// @return new pool compound rate
    function updateCompoundRate(bytes32 assetKey_, bool withInterval_) external returns (uint256);

    /// @notice Function for adding liquidity by the user to a certain pool
    /// @dev The function takes the amount with 18 decimals
    /// @param assetKey_ key of the pool to which the liquidity will be added
    /// @param liquidityAmount_ amount of tokens to add liquidity
    function addLiquidity(bytes32 assetKey_, uint256 liquidityAmount_) external payable;

    /// @notice Function for withdrawal of liquidity by the user from a certain pool
    /// @dev The function takes the amount with 18 decimals
    /// @param assetKey_ key of the pool from which the liquidity will be withdrawn
    /// @param liquidityAmount_ the amount of tokens to withdraw liquidity
    /// @param isMaxWithdraw_ the flag that shows whether to withdraw the maximum available amount or not
    function withdrawLiquidity(
        bytes32 assetKey_,
        uint256 liquidityAmount_,
        bool isMaxWithdraw_
    ) external;

    /// @notice The function is needed to allow addresses to borrow against your address for the desired amount
    /// @dev The function takes the amount with 18 decimals
    /// @param assetKey_ the key of the pool in which the approve will be made
    /// @param approveAmount_ the amount for which the approval is made
    /// @param delegateeAddr_ address who is allowed to borrow the passed amount
    /// @param currentAllowance_ allowance before function execution
    function approveToDelegateBorrow(
        bytes32 assetKey_,
        uint256 approveAmount_,
        address delegateeAddr_,
        uint256 currentAllowance_
    ) external;

    /// @notice Function for taking credit tokens by the user in the desired pool
    /// @dev The function takes the amount with 18 decimals
    /// @param assetKey_ the key of the pool, the tokens of which will be taken on credit
    /// @param borrowAmount_ the amount of tokens to be borrowed
    /// @param recipientAddr_ token recipient address
    function borrowFor(bytes32 assetKey_, uint256 borrowAmount_, address recipientAddr_) external;

    /// @notice Function for taking credit for the address that allowed you to do this
    /// @dev The function takes the amount with 18 decimals
    /// @param assetKey_ the key of the pool, the tokens of which will be taken on credit
    /// @param borrowAmount_ the amount of tokens to be borrowed
    /// @param borrowerAddr_ address to which the borrow will be taken
    function delegateBorrow(
        bytes32 assetKey_,
        uint256 borrowAmount_,
        address borrowerAddr_
    ) external;

    /// @notice Function for repayment of credit by the user in the desired pool
    /// @dev The function takes the amount with 18 decimals
    /// @param assetKey_ key of the pool in which the debt will be repaid
    /// @param repayAmount_ the amount of tokens for which the borrow will be repaid
    /// @param isMaxRepay_ a flag that shows whether or not to repay the debt by the maximum possible amount
    function repayBorrow(
        bytes32 assetKey_,
        uint256 repayAmount_,
        bool isMaxRepay_
    ) external payable;

    /// @notice Function for repayment of the desired user's credit
    /// @dev The function takes the amount with 18 decimals
    /// @param assetKey_ key of the pool in which the debt will be repaid
    /// @param repayAmount_ the amount of tokens for which the borrow will be repaid
    /// @param recipientAddr_ the address of the user whose credit will be repaid
    /// @param isMaxRepay_ a flag that shows whether or not to repay the debt by the maximum possible amount
    function delegateRepayBorrow(
        bytes32 assetKey_,
        uint256 repayAmount_,
        address recipientAddr_,
        bool isMaxRepay_
    ) external payable;

    /// @notice Function for liquidation users who must protocols funds
    /// @dev The function takes the amount with 18 decimals
    /// @param userAddr_ address of the user to be liquidated
    /// @param supplyAssetKey_ the pool key, which is the user's collateral
    /// @param borrowAssetKey_ key of the pool where the user took the credit
    /// @param liquidationAmount_ the amount of tokens that will go to pay off the debt of the liquidated user
    function liquidation(
        address userAddr_,
        bytes32 supplyAssetKey_,
        bytes32 borrowAssetKey_,
        uint256 liquidationAmount_
    ) external payable;

    /// @notice Function for getting the distribution reward from a specific pools or from the all pools
    /// @param assetKeys_ an array of the keys of the pools from which the reward will be received
    /// @param isAllPools_ the flag that shows whether all pools should be claimed
    /// @return totalReward_ the amount of the total reward received
    function claimDistributionRewards(
        bytes32[] memory assetKeys_,
        bool isAllPools_
    ) external returns (uint256 totalReward_);

    /// @notice Function for getting information about the user's assets that are disabled as collateral
    /// @param userAddr_ the address of the user for whom the information will be obtained
    /// @param assetKey_ the key of the pool for which you want to get information
    /// @return true, if the asset disabled as collateral, false otherwise
    function disabledCollateralAssets(
        address userAddr_,
        bytes32 assetKey_
    ) external view returns (bool);

    /// @notice Function to get the total amount of the user's deposit in dollars to all pools
    /// @param userAddr_ address of the user for whom you want to get information
    /// @return totalSupplyBalance_ total amount of the user's deposit in dollars
    function getTotalSupplyBalanceInUSD(
        address userAddr_
    ) external view returns (uint256 totalSupplyBalance_);

    /// @notice Function for obtaining the amount that the user can maximally take on borrow
    /// @param userAddr_ address of the user for whom you want to get information
    /// @param assetKey_ the pool key for which the information is obtained
    /// @return the amount of tokens that a user can maximal take on borrow
    function getMaxToBorrow(address userAddr_, bytes32 assetKey_) external view returns (uint256);

    /// @notice Function to get the amount by which the user can maximally repay the borrow
    /// @param userAddr_ address of the user for whom you want to get information
    /// @param assetKey_ the pool key for which the information is obtained
    /// @return the amount of tokens by which the user can repay the debt at most
    function getMaxToRepay(address userAddr_, bytes32 assetKey_) external view returns (uint256);

    /// @notice Function for obtaining the amount that the user can maximally deposit
    /// @param userAddr_ address of the user for whom you want to get information
    /// @param assetKey_ the pool key for which the information is obtained
    /// @return the number of tokens a user can deposit at most
    function getMaxToSupply(address userAddr_, bytes32 assetKey_) external view returns (uint256);

    /// @notice Function to get the maximum amount that the user can withdraw from the pool
    /// @param userAddr_ address of the user for whom you want to get information
    /// @param assetKey_ the pool key for which the information is obtained
    /// @return the number of tokens that the user can withdraw from the pool at most
    function getMaxToWithdraw(
        address userAddr_,
        bytes32 assetKey_
    ) external view returns (uint256);

    /// @notice Function to check if an asset is enabled as a collateral for a particular user
    /// @param userAddr_ address of the user for whom you want to get information
    /// @param assetKey_ the pool key for which the information is obtained
    /// @return true, if passed asset enabled as collateral, false otherwise
    function isCollateralAssetEnabled(
        address userAddr_,
        bytes32 assetKey_
    ) external view returns (bool);

    /// @notice Function to get the deposit amount with interest for the desired user in the passed pool
    /// @param userAddr_ address of the user for whom you want to get information
    /// @param assetKey_ the pool key for which the information is obtained
    /// @return userLiquidityAmount_ deposit amount with interest
    function getUserLiquidityAmount(
        address userAddr_,
        bytes32 assetKey_
    ) external view returns (uint256 userLiquidityAmount_);

    /// @notice Function to get the borrow amount with interest for the desired user in the passed pool
    /// @param userAddr_ address of the user for whom you want to get information
    /// @param assetKey_ the pool key for which the information is obtained
    /// @return userBorrowedAmount_ borrow amount with interest
    function getUserBorrowedAmount(
        address userAddr_,
        bytes32 assetKey_
    ) external view returns (uint256 userBorrowedAmount_);

    /// @notice Function to get the total amount of the user's borrows in dollars to all pools
    /// @param userAddr_ address of the user for whom you want to get information
    /// @return totalBorrowBalance_ total amount of the user's borrows in dollars
    function getTotalBorrowBalanceInUSD(
        address userAddr_
    ) external view returns (uint256 totalBorrowBalance_);

    /// @notice Function for obtaining the current amount for which the user can take credit at most
    /// @param userAddr_ address of the user for whom you want to get information
    /// @return currentBorrowLimit_ a current user borrow limit in dollars
    function getCurrentBorrowLimitInUSD(
        address userAddr_
    ) external view returns (uint256 currentBorrowLimit_);

    /// @notice Function for obtaining a new amount for which the user can take the maximum credit
    /// @dev The function takes the amount with 18 decimals
    /// @param userAddr_ address of the user for whom you want to get information
    /// @param assetKey_ key of the pool for which the new deposit amount will be applied
    /// @param tokensAmount_ the number of tokens by which the calculation will be changed borrow limit
    /// @param isAdding_ true, if the amount of tokens will be added, false otherwise
    /// @return a new user borrow limit in dollars
    function getNewBorrowLimitInUSD(
        address userAddr_,
        bytes32 assetKey_,
        uint256 tokensAmount_,
        bool isAdding_
    ) external view returns (uint256);

    /// @notice Function for obtaining available liquidity of the user and his debt
    /// @param userAddr_ address of the user for whom you want to get information
    /// @return first parameter is available user liquidity is dollarse, second is a user debt
    function getAvailableLiquidity(address userAddr_) external view returns (uint256, uint256);

    /// @notice Batch function for obtaining available liquidity of the users and they debts
    /// @param usersArr_ array with user addresses
    /// @return availableArr_ the array with users available liquidity
    /// @return debtsArr_ the array with users debts
    function getAvailableLiquidityBatch(
        address[] calldata usersArr_
    ) external view returns (uint256[] memory availableArr_, uint256[] memory debtsArr_);
}
