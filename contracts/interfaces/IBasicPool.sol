// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

/**
 * This is the basic abstract loan pool.
 * Needed to inherit from it all the custom pools of the system
 */
interface IBasicPool {
    /// @notice A structure that contains information about user borrows
    /// @param borrowAmount absolute amount of borrow in tokens
    /// @param normalizedAmount normalized user borrow amount
    struct BorrowInfo {
        uint256 borrowAmount;
        uint256 normalizedAmount;
    }

    /// @notice System structure, which is needed to avoid stack overflow and stores the information to repay the borrow
    /// @param repayAmount amount in tokens for repayment
    /// @param currentAbsoluteAmount user debt with interest
    /// @param normalizedAmount normalized user borrow amount
    /// @param currentRate current pool compound rate
    /// @param userAddr address of the user who will repay the debt
    struct RepayBorrowVars {
        uint256 repayAmount;
        uint256 currentAbsoluteAmount;
        uint256 normalizedAmount;
        uint256 currentRate;
        address userAddr;
    }

    /// @notice The function is needed to allow addresses to borrow against your address for the desired amount
    /// @dev Only DefiCore contract can call this function. The function takes the amount with 18 decimals
    /// @param userAddr_ address of the user who makes the approval
    /// @param approveAmount_ the amount for which the approval is made
    /// @param delegateeAddr_ address who is allowed to borrow the passed amount
    /// @param currentAllowance_ allowance before function execution
    function approveToBorrow(
        address userAddr_,
        uint256 approveAmount_,
        address delegateeAddr_,
        uint256 currentAllowance_
    ) external;

    /// @notice The function that allows you to take a borrow and send borrowed tokens to the desired address
    /// @dev Only DefiCore contract can call this function. The function takes the amount with 18 decimals
    /// @param userAddr_ address of the user to whom the credit will be taken
    /// @param recipient_ the address that will receive the borrowed tokens
    /// @param amountToBorrow_ amount to borrow in tokens
    function borrowFor(address userAddr_, address recipient_, uint256 amountToBorrow_) external;

    /// @notice A function by which you can take credit for the address that gave you permission to do so
    /// @dev Only DefiCore contract can call this function. The function takes the amount with 18 decimals
    /// @param userAddr_ address of the user to whom the credit will be taken
    /// @param delegator_ the address that will receive the borrowed tokens
    /// @param amountToBorrow_ amount to borrow in tokens
    function delegateBorrow(
        address userAddr_,
        address delegator_,
        uint256 amountToBorrow_
    ) external;

    /// @notice Function for repayment of a specific user's debt
    /// @dev Only DefiCore contract can call this function. The function takes the amount with 18 decimals
    /// @param userAddr_ address of the user from whom the funds will be deducted to repay the debt
    /// @param closureAddr_ address of the user to whom the debt will be repaid
    /// @param repayAmount_ the amount to repay the debt
    /// @param isMaxRepay_ a flag that shows whether or not to repay the debt by the maximum possible amount
    /// @return repayment amount
    function repayBorrowFor(
        address userAddr_,
        address closureAddr_,
        uint256 repayAmount_,
        bool isMaxRepay_
    ) external payable returns (uint256);

    /// @notice Function for withdrawal of reserve funds from the pool
    /// @dev Only SystemPoolsRegistry contract can call this function. The function takes the amount with 18 decimals
    /// @param recipientAddr_ the address of the user who will receive the reserve tokens
    /// @param amountToWithdraw_ number of reserve funds for withdrawal
    /// @param isAllFunds_ flag that shows whether to withdraw all reserve funds or not
    function withdrawReservedFunds(
        address recipientAddr_,
        uint256 amountToWithdraw_,
        bool isAllFunds_
    ) external returns (uint256);

    /// @notice Function to update the compound rate with or without interval
    /// @param withInterval_ flag that shows whether to update the rate with or without interval
    /// @return new compound rate
    function updateCompoundRate(bool withInterval_) external returns (uint256);

    /// @notice Function to get the underlying asset address
    /// @return an address of the underlying asset
    function assetAddr() external view returns (address);

    /// @notice Function to get a pool key
    /// @return a pool key
    function assetKey() external view returns (bytes32);

    /// @notice Function to get the pool total number of tokens borrowed without interest
    /// @return total borrowed amount without interest
    function aggregatedBorrowedAmount() external view returns (uint256);

    /// @notice Function to get the total amount of reserve funds
    /// @return total reserve funds
    function totalReserves() external view returns (uint256);

    /// @notice Function to get information about the user's borrow
    /// @param userAddr_ address of the user for whom you want to get information
    /// @return borrowAmount_ absolute amount of borrow in tokens
    /// @return normalizedAmount_ normalized user borrow amount
    function borrowInfos(
        address userAddr_
    ) external view returns (uint256 borrowAmount_, uint256 normalizedAmount_);

    /// @notice Function to get the total borrowed amount with interest
    /// @return total borrowed amount with interest
    function getTotalBorrowedAmount() external view returns (uint256);

    /// @notice Function to convert the amount in tokens to the amount in dollars
    /// @param assetAmount_ amount in asset tokens
    /// @return an amount in dollars
    function getAmountInUSD(uint256 assetAmount_) external view returns (uint256);

    /// @notice Function to convert the amount in dollars to the amount in tokens
    /// @param usdAmount_ amount in dollars
    /// @return an amount in asset tokens
    function getAmountFromUSD(uint256 usdAmount_) external view returns (uint256);

    /// @notice Function to get the price of an underlying asset
    /// @return an underlying asset price
    function getAssetPrice() external view returns (uint256);

    /// @notice Function to get the underlying token decimals
    /// @return an underlying token decimals
    function getUnderlyingDecimals() external view returns (uint8);

    /// @notice Function to get the last updated compound rate
    /// @return a last updated compound rate
    function getCurrentRate() external view returns (uint256);

    /// @notice Function to get the current compound rate
    /// @return a current compound rate
    function getNewCompoundRate() external view returns (uint256);

    /// @notice Function to get the current annual interest rate on the borrow
    /// @return a current annual interest rate on the borrow
    function getAnnualBorrowRate() external view returns (uint256);
}

/**
 * Pool contract only for loans with a fixed annual rate
 */
interface IStablePool is IBasicPool {
    /// @notice Function to initialize a new stable pool
    /// @param assetAddr_ address of the underlying pool asset
    /// @param assetKey_ pool key of the current liquidity pool
    function stablePoolInitialize(address assetAddr_, bytes32 assetKey_) external;
}

/**
 * This is the central contract of the protocol, which is the pool for liquidity.
 * All interaction takes place through the DefiCore contract
 */
interface ILiquidityPool is IBasicPool {
    /// @notice A structure that contains information about user last added liquidity
    /// @param liquidity a total amount of the last liquidity
    /// @param blockNumber block number at the time of the last liquidity entry
    struct UserLastLiquidity {
        uint256 liquidity;
        uint256 blockNumber;
    }

    /// @notice The function that is needed to initialize the pool after it is created
    /// @dev This function can call only once
    /// @param assetAddr_ address of the underlying pool asset
    /// @param assetKey_ pool key of the current liquidity pool
    /// @param tokenSymbol_ symbol of the underlying pool asset
    function liquidityPoolInitialize(
        address assetAddr_,
        bytes32 assetKey_,
        string memory tokenSymbol_
    ) external;

    /// @notice Function for adding liquidity to the pool
    /// @dev Only DefiCore contract can call this function. The function takes the amount with 18 decimals
    /// @param userAddr_ address of the user to whom the liquidity will be added
    /// @param liquidityAmount_ amount of liquidity to add
    function addLiquidity(address userAddr_, uint256 liquidityAmount_) external payable;

    /// @notice Function for withdraw liquidity from the passed address
    /// @dev Only DefiCore contract can call this function. The function takes the amount with 18 decimals
    /// @param userAddr_ address of the user from which the liquidity will be withdrawn
    /// @param liquidityAmount_ amount of liquidity to withdraw
    /// @param isMaxWithdraw_ the flag that shows whether to withdraw the maximum available amount or not
    function withdrawLiquidity(
        address userAddr_,
        uint256 liquidityAmount_,
        bool isMaxWithdraw_
    ) external;

    /// @notice Function for writing off the collateral from the address of the person being liquidated during liquidation
    /// @dev Only DefiCore contract can call this function. The function takes the amount with 18 decimals
    /// @param userAddr_ address of the user from whom the collateral will be debited
    /// @param liquidatorAddr_ address of the liquidator to whom the tokens will be sent
    /// @param liquidityAmount_ number of tokens to send
    function liquidate(
        address userAddr_,
        address liquidatorAddr_,
        uint256 liquidityAmount_
    ) external;

    /// @notice Function for getting the liquidity entered by the user in a certain block
    /// @param userAddr_ address of the user for whom you want to get information
    /// @return liquidity amount
    function lastLiquidity(address userAddr_) external view returns (uint256, uint256);

    /// @notice Function to get the annual rate on the deposit
    /// @return annual deposit interest rate
    function getAPY() external view returns (uint256);

    /// @notice Function to get the total liquidity in the pool with interest
    /// @return total liquidity in the pool with interest
    function getTotalLiquidity() external view returns (uint256);

    /// @notice Function to get the current amount of liquidity in the pool without reserve funds
    /// @return aggregated liquidity amount without reserve funds
    function getAggregatedLiquidityAmount() external view returns (uint256);

    /// @notice Function to get the current percentage of how many tokens were borrowed
    /// @return an borrow percentage (utilization ratio)
    function getBorrowPercentage() external view returns (uint256);

    /// @notice Function for obtaining available liquidity for credit
    /// @return an available to borrow liquidity
    function getAvailableToBorrowLiquidity() external view returns (uint256);

    /// @notice Function to convert from the amount in the asset to the amount in lp tokens
    /// @param assetAmount_ amount in asset tokens
    /// @return an amount in lp tokens
    function convertAssetToLPTokens(uint256 assetAmount_) external view returns (uint256);

    /// @notice Function to convert from the amount amount in lp tokens to the amount in the asset
    /// @param lpTokensAmount_ amount in lp tokens
    /// @return an amount in asset tokens
    function convertLPTokensToAsset(uint256 lpTokensAmount_) external view returns (uint256);

    /// @notice Function to get the exchange rate between asset tokens and lp tokens
    /// @return current exchange rate
    function exchangeRate() external view returns (uint256);

    /// @notice Function for getting the last liquidity by current block
    /// @param userAddr_ address of the user for whom you want to get information
    /// @return a last liquidity amount (if current block number != last block number returns zero)
    function getCurrentLastLiquidity(address userAddr_) external view returns (uint256);
}
