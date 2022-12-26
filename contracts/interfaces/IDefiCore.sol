// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

/**
 * The central contract of the protocol, through which the main interaction goes.
 * Through this contract, liquidity is deposited, withdrawn, borrowed, repaid, claim distribution rewards, liquidated, and much more
 */
interface IDefiCore {
    /// @notice This event is emitted when a user update collateral value for specific pool
    /// @param _userAddr address of the user who updated the collateral value
    /// @param _assetKey key of the pool where the collateral value was updated
    /// @param _newValue a new collateral value
    event CollateralUpdated(address indexed _userAddr, bytes32 indexed _assetKey, bool _newValue);

    /// @notice This event is emitted when a user deposits liquidity into the pool
    /// @param _userAddr address of the user who deposited the liquidity
    /// @param _assetKey key of the pool where the liquidity was deposited
    /// @param _liquidityAmount number of tokens that were deposited
    event LiquidityAdded(
        address indexed _userAddr,
        bytes32 indexed _assetKey,
        uint256 _liquidityAmount
    );

    /// @notice This event is emitted when a user withdraws liquidity from the pool
    /// @param _userAddr address of the user who withdrawn the liquidity
    /// @param _assetKey key of the pool where the liquidity was withdrawn
    /// @param _liquidityAmount number of tokens that were withdrawn
    event LiquidityWithdrawn(
        address indexed _userAddr,
        bytes32 indexed _assetKey,
        uint256 _liquidityAmount
    );

    /// @notice This event is emitted when a user takes tokens on credit
    /// @param _borrower address of the user on whom the borrow is taken
    /// @param _recipient the address of the user to which the taken tokens will be sent
    /// @param _assetKey the key of the pool, the tokens of which will be taken on credit
    /// @param _borrowedAmount number of tokens to be taken on credit
    event Borrowed(
        address indexed _borrower,
        address _recipient,
        bytes32 indexed _assetKey,
        uint256 _borrowedAmount
    );

    /// @notice This event is emitted during the repayment of credit by the user
    /// @param _userAddr address of the user whose credit will be repaid
    /// @param _assetKey key of the pool in which the loan will be repaid
    /// @param _repaidAmount the amount of tokens for which the loan will be repaid
    event BorrowRepaid(
        address indexed _userAddr,
        bytes32 indexed _assetKey,
        uint256 _repaidAmount
    );

    /// @notice This event is emitted during the approve for delegated credit
    /// @param _userAddr address of the user who approved delegated borrow
    /// @param _assetKey the key of the pool in which the approve will be made
    /// @param _delegateeAddr address who is allowed to borrow the passed amount
    /// @param _newAmount the amount for which the approval is made
    event DelegateBorrowApproved(
        address indexed _userAddr,
        bytes32 indexed _assetKey,
        address _delegateeAddr,
        uint256 _newAmount
    );

    /// @notice This event is emitted when the user receives their distribution rewards
    /// @param _userAddr address of the user who receives distribution rewards
    /// @param _rewardAmount the amount of rewards the user will receive
    event DistributionRewardWithdrawn(address indexed _userAddr, uint256 _rewardAmount);

    /// @notice Function for pausing all user interactions with the system
    /// @dev Only contract owner can call this function
    function pause() external;

    /// @notice Function for unpausing all user interactions with the system
    /// @dev Only contract owner can call this function
    function unpause() external;

    /// @notice With this function you can change the value of the disabled of the asset as a collateral
    /// @param _assetKey pool key to update the value
    /// @param _isDisabled a flag that shows whether the asset will be disabled as a collateral
    function updateCollateral(bytes32 _assetKey, bool _isDisabled) external;

    /// @notice Function to update the compound rate with or without interval by pool key
    /// @param _assetKey key of the pool for which the compound rate will be updated
    /// @param _withInterval flag that shows whether to update the rate with or without interval
    /// @return new pool compound rate
    function updateCompoundRate(bytes32 _assetKey, bool _withInterval) external returns (uint256);

    /// @notice Function for adding liquidity by the user to a certain pool
    /// @dev The function takes the amount with 18 decimals
    /// @param _assetKey key of the pool to which the liquidity will be added
    /// @param _liquidityAmount amount of tokens to add liquidity
    function addLiquidity(bytes32 _assetKey, uint256 _liquidityAmount) external payable;

    /// @notice Function for withdrawal of liquidity by the user from a certain pool
    /// @dev The function takes the amount with 18 decimals
    /// @param _assetKey key of the pool from which the liquidity will be withdrawn
    /// @param _liquidityAmount the amount of tokens to withdraw liquidity
    /// @param _isMaxWithdraw the flag that shows whether to withdraw the maximum available amount or not
    function withdrawLiquidity(
        bytes32 _assetKey,
        uint256 _liquidityAmount,
        bool _isMaxWithdraw
    ) external;

    /// @notice The function is needed to allow addresses to borrow against your address for the desired amount
    /// @dev The function takes the amount with 18 decimals
    /// @param _assetKey the key of the pool in which the approve will be made
    /// @param _approveAmount the amount for which the approval is made
    /// @param _delegateeAddr address who is allowed to borrow the passed amount
    /// @param _currentAllowance allowance before function execution
    function approveToDelegateBorrow(
        bytes32 _assetKey,
        uint256 _approveAmount,
        address _delegateeAddr,
        uint256 _currentAllowance
    ) external;

    /// @notice Function for taking credit tokens by the user in the desired pool
    /// @dev The function takes the amount with 18 decimals
    /// @param _assetKey the key of the pool, the tokens of which will be taken on credit
    /// @param _borrowAmount the amount of tokens to be borrowed
    /// @param _recipientAddr token recipient address
    function borrowFor(bytes32 _assetKey, uint256 _borrowAmount, address _recipientAddr) external;

    /// @notice Function for taking credit for the address that allowed you to do this
    /// @dev The function takes the amount with 18 decimals
    /// @param _assetKey the key of the pool, the tokens of which will be taken on credit
    /// @param _borrowAmount the amount of tokens to be borrowed
    /// @param _borrowerAddr address to which the borrow will be taken
    function delegateBorrow(
        bytes32 _assetKey,
        uint256 _borrowAmount,
        address _borrowerAddr
    ) external;

    /// @notice Function for repayment of credit by the user in the desired pool
    /// @dev The function takes the amount with 18 decimals
    /// @param _assetKey key of the pool in which the debt will be repaid
    /// @param _repayAmount the amount of tokens for which the borrow will be repaid
    /// @param _isMaxRepay a flag that shows whether or not to repay the debt by the maximum possible amount
    function repayBorrow(
        bytes32 _assetKey,
        uint256 _repayAmount,
        bool _isMaxRepay
    ) external payable;

    /// @notice Function for repayment of the desired user's credit
    /// @dev The function takes the amount with 18 decimals
    /// @param _assetKey key of the pool in which the debt will be repaid
    /// @param _repayAmount the amount of tokens for which the borrow will be repaid
    /// @param _recipientAddr the address of the user whose credit will be repaid
    /// @param _isMaxRepay a flag that shows whether or not to repay the debt by the maximum possible amount
    function delegateRepayBorrow(
        bytes32 _assetKey,
        uint256 _repayAmount,
        address _recipientAddr,
        bool _isMaxRepay
    ) external payable;

    /// @notice Function for liquidation users who must protocols funds
    /// @dev The function takes the amount with 18 decimals
    /// @param _userAddr address of the user to be liquidated
    /// @param _supplyAssetKey the pool key, which is the user's collateral
    /// @param _borrowAssetKey key of the pool where the user took the credit
    /// @param _liquidationAmount the amount of tokens that will go to pay off the debt of the liquidated user
    function liquidation(
        address _userAddr,
        bytes32 _supplyAssetKey,
        bytes32 _borrowAssetKey,
        uint256 _liquidationAmount
    ) external payable;

    /// @notice Function for getting the distribution reward from a specific pools or from the all pools
    /// @param _assetKeys an array of the keys of the pools from which the reward will be received
    /// @param _isAllPools the flag that shows whether all pools should be claimed
    /// @return _totalReward the amount of the total reward received
    function claimDistributionRewards(
        bytes32[] memory _assetKeys,
        bool _isAllPools
    ) external returns (uint256 _totalReward);

    /// @notice Function for getting information about the user's assets that are disabled as collateral
    /// @param _userAddr the address of the user for whom the information will be obtained
    /// @param _assetKey the key of the pool for which you want to get information
    /// @return true, if the asset disabled as collateral, false otherwise
    function disabledCollateralAssets(
        address _userAddr,
        bytes32 _assetKey
    ) external view returns (bool);

    /// @notice Function to get the total amount of the user's deposit in dollars to all pools
    /// @param _userAddr address of the user for whom you want to get information
    /// @return _totalSupplyBalance total amount of the user's deposit in dollars
    function getTotalSupplyBalanceInUSD(
        address _userAddr
    ) external view returns (uint256 _totalSupplyBalance);

    /// @notice Function for obtaining the amount that the user can maximally take on borrow
    /// @param _userAddr address of the user for whom you want to get information
    /// @param _assetKey the pool key for which the information is obtained
    /// @return the amount of tokens that a user can maximal take on borrow
    function getMaxToBorrow(address _userAddr, bytes32 _assetKey) external view returns (uint256);

    /// @notice Function to get the amount by which the user can maximally repay the borrow
    /// @param _userAddr address of the user for whom you want to get information
    /// @param _assetKey the pool key for which the information is obtained
    /// @return the amount of tokens by which the user can repay the debt at most
    function getMaxToRepay(address _userAddr, bytes32 _assetKey) external view returns (uint256);

    /// @notice Function for obtaining the amount that the user can maximally deposit
    /// @param _userAddr address of the user for whom you want to get information
    /// @param _assetKey the pool key for which the information is obtained
    /// @return the number of tokens a user can deposit at most
    function getMaxToSupply(address _userAddr, bytes32 _assetKey) external view returns (uint256);

    /// @notice Function to get the maximum amount that the user can withdraw from the pool
    /// @param _userAddr address of the user for whom you want to get information
    /// @param _assetKey the pool key for which the information is obtained
    /// @return the number of tokens that the user can withdraw from the pool at most
    function getMaxToWithdraw(
        address _userAddr,
        bytes32 _assetKey
    ) external view returns (uint256);

    /// @notice Function to check if an asset is enabled as a collateral for a particular user
    /// @param _userAddr address of the user for whom you want to get information
    /// @param _assetKey the pool key for which the information is obtained
    /// @return true, if passed asset enabled as collateral, false otherwise
    function isCollateralAssetEnabled(
        address _userAddr,
        bytes32 _assetKey
    ) external view returns (bool);

    /// @notice Function to get the deposit amount with interest for the desired user in the passed pool
    /// @param _userAddr address of the user for whom you want to get information
    /// @param _assetKey the pool key for which the information is obtained
    /// @return _userLiquidityAmount deposit amount with interest
    function getUserLiquidityAmount(
        address _userAddr,
        bytes32 _assetKey
    ) external view returns (uint256 _userLiquidityAmount);

    /// @notice Function to get the borrow amount with interest for the desired user in the passed pool
    /// @param _userAddr address of the user for whom you want to get information
    /// @param _assetKey the pool key for which the information is obtained
    /// @return _userBorrowedAmount borrow amount with interest
    function getUserBorrowedAmount(
        address _userAddr,
        bytes32 _assetKey
    ) external view returns (uint256 _userBorrowedAmount);

    /// @notice Function to get the total amount of the user's borrows in dollars to all pools
    /// @param _userAddr address of the user for whom you want to get information
    /// @return _totalBorrowBalance total amount of the user's borrows in dollars
    function getTotalBorrowBalanceInUSD(
        address _userAddr
    ) external view returns (uint256 _totalBorrowBalance);

    /// @notice Function for obtaining the current amount for which the user can take credit at most
    /// @param _userAddr address of the user for whom you want to get information
    /// @return _currentBorrowLimit a current user borrow limit in dollars
    function getCurrentBorrowLimitInUSD(
        address _userAddr
    ) external view returns (uint256 _currentBorrowLimit);

    /// @notice Function for obtaining a new amount for which the user can take the maximum credit
    /// @dev The function takes the amount with 18 decimals
    /// @param _userAddr address of the user for whom you want to get information
    /// @param _assetKey key of the pool for which the new deposit amount will be applied
    /// @param _tokensAmount the number of tokens by which the calculation will be changed borrow limit
    /// @param _isAdding true, if the amount of tokens will be added, false otherwise
    /// @return a new user borrow limit in dollars
    function getNewBorrowLimitInUSD(
        address _userAddr,
        bytes32 _assetKey,
        uint256 _tokensAmount,
        bool _isAdding
    ) external view returns (uint256);

    /// @notice Function for obtaining available liquidity of the user and his debt
    /// @param _userAddr address of the user for whom you want to get information
    /// @return first parameter is available user liquidity is dollarse, second is a user debt
    function getAvailableLiquidity(address _userAddr) external view returns (uint256, uint256);
}
