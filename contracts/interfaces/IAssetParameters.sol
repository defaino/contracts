// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

/**
 * This is a contract for storage and convenient retrieval of asset parameters
 */
interface IAssetParameters {
    /// @notice This structure contains the main parameters of the pool
    /// @param collateralizationRatio percentage that shows how much collateral will be added from the deposit
    /// @param collateralizationRatioWithPRT same as collateralizationRatio but for the user with PRT
    /// @param reserveFactor the percentage of the platform's earnings that will be deducted from the interest on the borrows
    /// @param liquidationDiscount percentage of the discount that the liquidator will receive on the collateral
    /// @param maxUtilizationRatio maximum possible utilization ratio
    struct MainPoolParams {
        uint256 collateralizationRatio;
        uint256 collateralizationRatioWithPRT;
        uint256 reserveFactor;
        uint256 liquidationDiscount;
        uint256 maxUtilizationRatio;
    }

    /// @notice This structure contains the pool parameters for the borrow percentage curve
    /// @param basePercentage annual rate on the borrow, if utilization ratio is equal to 0%
    /// @param firstSlope annual rate on the borrow, if utilization ratio is equal to utilizationBreakingPoint
    /// @param secondSlope annual rate on the borrow, if utilization ratio is equal to 100%
    /// @param utilizationBreakingPoint percentage at which the graph breaks
    struct InterestRateParams {
        uint256 basePercentage;
        uint256 firstSlope;
        uint256 secondSlope;
        uint256 utilizationBreakingPoint;
    }

    /// @notice This structure contains the pool parameters that are needed to calculate the distribution
    /// @param minSupplyDistrPart percentage, which indicates the minimum part of the reward distribution for users who deposited
    /// @param minBorrowDistrPart percentage, which indicates the minimum part of the reward distribution for users who borrowed
    struct DistributionMinimums {
        uint256 minSupplyDistrPart;
        uint256 minBorrowDistrPart;
    }

    /// @notice This structure contains all the parameters of the pool
    /// @param mainParams element type MainPoolParams structure
    /// @param interestRateParams element type InterestRateParams structure
    /// @param distrMinimums element type DistributionMinimums structure
    struct AllPoolParams {
        MainPoolParams mainParams;
        InterestRateParams interestRateParams;
        DistributionMinimums distrMinimums;
    }

    /// @notice This event is emitted when the pool's main parameters are set
    /// @param assetKey the key of the pool for which the parameters are set
    /// @param colRatio percentage that shows how much collateral will be added from the deposit
    /// @param reserveFactor the percentage of the platform's earnings that will be deducted from the interest on the borrows
    /// @param liquidationDiscount percentage of the discount that the liquidator will receive on the collateral
    /// @param maxUR maximum possible utilization ratio
    event MainParamsUpdated(
        bytes32 assetKey,
        uint256 colRatio,
        uint256 reserveFactor,
        uint256 liquidationDiscount,
        uint256 maxUR
    );

    /// @notice This event is emitted when the pool's interest rate parameters are set
    /// @param assetKey the key of the pool for which the parameters are set
    /// @param basePercentage annual rate on the borrow, if utilization ratio is equal to 0%
    /// @param firstSlope annual rate on the borrow, if utilization ratio is equal to utilizationBreakingPoint
    /// @param secondSlope annual rate on the borrow, if utilization ratio is equal to 100%
    /// @param utilizationBreakingPoint percentage at which the graph breaks
    event InterestRateParamsUpdated(
        bytes32 assetKey,
        uint256 basePercentage,
        uint256 firstSlope,
        uint256 secondSlope,
        uint256 utilizationBreakingPoint
    );

    /// @notice This event is emitted when the pool's distribution minimums are set
    /// @param assetKey the key of the pool for which the parameters are set
    /// @param supplyDistrPart percentage, which indicates the minimum part of the reward distribution for users who deposited
    /// @param borrowDistrPart percentage, which indicates the minimum part of the reward distribution for users who borrowed
    event DistributionMinimumsUpdated(
        bytes32 assetKey,
        uint256 supplyDistrPart,
        uint256 borrowDistrPart
    );

    event AnnualBorrowRateUpdated(bytes32 assetKey, uint256 newAnnualBorrowRate);

    /// @notice This event is emitted when the pool freeze parameter is set
    /// @param assetKey the key of the pool for which the parameter is set
    /// @param newValue new value of the pool freeze parameter
    event FreezeParamUpdated(bytes32 assetKey, bool newValue);

    /// @notice This event is emitted when the pool collateral parameter is set
    /// @param assetKey the key of the pool for which the parameter is set
    /// @param isCollateral new value of the pool collateral parameter
    event CollateralParamUpdated(bytes32 assetKey, bool isCollateral);

    /// @notice System function needed to set parameters during pool creation
    /// @dev Only SystemPoolsRegistry contract can call this function
    /// @param assetKey_ the key of the pool for which the parameters are set
    /// @param isCollateral_ a flag that indicates whether a pool can even be a collateral
    /// @param isCollateralWithPRT_ a flag that indicates whether a pool can even be a collateral for a user with PRT
    function setPoolInitParams(
        bytes32 assetKey_,
        bool isCollateral_,
        bool isCollateralWithPRT_
    ) external;

    /// @notice Function for setting the annual borrow rate of the stable pool
    /// @dev Only contract owner can call this function. Only for stable pools
    /// @param assetKey_ pool key for which parameters will be set
    /// @param newAnnualBorrowRate_ new annual borrow rate parameter
    function setupAnnualBorrowRate(bytes32 assetKey_, uint256 newAnnualBorrowRate_) external;

    /// @notice Function for setting the main parameters of the pool
    /// @dev Only contract owner can call this function
    /// @param assetKey_ pool key for which parameters will be set
    /// @param mainParams_ structure with the main parameters of the pool
    function setupMainParameters(bytes32 assetKey_, MainPoolParams calldata mainParams_) external;

    /// @notice Function for setting the interest rate parameters of the pool
    /// @dev Only contract owner can call this function
    /// @param assetKey_ pool key for which parameters will be set
    /// @param interestParams_ structure with the interest rate parameters of the pool
    function setupInterestRateModel(
        bytes32 assetKey_,
        InterestRateParams calldata interestParams_
    ) external;

    /// @notice Function for setting the distribution minimums of the pool
    /// @dev Only contract owner can call this function
    /// @param assetKey_ pool key for which parameters will be set
    /// @param distrMinimums_ structure with the distribution minimums of the pool
    function setupDistributionsMinimums(
        bytes32 assetKey_,
        DistributionMinimums calldata distrMinimums_
    ) external;

    /// @notice Function for setting all pool parameters
    /// @dev Only contract owner can call this function
    /// @param assetKey_ pool key for which parameters will be set
    /// @param poolParams_ structure with all pool parameters
    function setupAllParameters(bytes32 assetKey_, AllPoolParams calldata poolParams_) external;

    /// @notice Function for freezing the pool
    /// @dev Only contract owner can call this function
    /// @param assetKey_ pool key to be frozen
    function freeze(bytes32 assetKey_) external;

    /// @notice Function to enable the pool as a collateral
    /// @dev Only contract owner can call this function
    /// @param assetKey_ the pool key to be enabled as a collateral
    /// @param forPRT_ whether to enable the asset as a collateral for the users with PRT
    function enableCollateral(bytes32 assetKey_, bool forPRT_) external;

    /// @notice Function for getting information about whether the pool is frozen
    /// @param assetKey_ the key of the pool for which you want to get information
    /// @return true if the liquidity pool is frozen, false otherwise
    function isPoolFrozen(bytes32 assetKey_) external view returns (bool);

    /// @notice Function for getting information about whether a pool can be a collateral
    /// @param assetKey_ the key of the pool for which you want to get information
    /// @param withPRT_ a flag that indicates whether to check the collateral availability in case user has PRT minted
    /// @return true, if the pool is available as a collateral, false otherwise
    function isAvailableAsCollateral(
        bytes32 assetKey_,
        bool withPRT_
    ) external view returns (bool);

    /// @notice Function for getting annual borrow rate
    /// @param assetKey_ the key of the pool for which you want to get information
    /// @return an annual borrow rate
    function getAnnualBorrowRate(bytes32 assetKey_) external view returns (uint256);

    /// @notice Function for getting the main parameters of the pool
    /// @param assetKey_ the key of the pool for which you want to get information
    /// @return a structure with the main parameters of the pool
    function getMainPoolParams(bytes32 assetKey_) external view returns (MainPoolParams memory);

    /// @notice Function for getting the interest rate parameters of the pool
    /// @param assetKey_ the key of the pool for which you want to get information
    /// @return a structure with the interest rate parameters of the pool
    function getInterestRateParams(
        bytes32 assetKey_
    ) external view returns (InterestRateParams memory);

    /// @notice Function for getting the distribution minimums of the pool
    /// @param assetKey_ the key of the pool for which you want to get information
    /// @return a structure with the distribution minimums of the pool
    function getDistributionMinimums(
        bytes32 assetKey_
    ) external view returns (DistributionMinimums memory);

    /// @notice Function to get the collateralization ratio for the desired pool
    /// @param assetKey_ the key of the pool for which you want to get information
    /// @param withPRT_ a flag that indicates whether to check the collateralization ratio in case user has PRT minted
    /// @return current collateralization ratio value
    function getColRatio(bytes32 assetKey_, bool withPRT_) external view returns (uint256);

    /// @notice Function to get the reserve factor for the desired pool
    /// @param assetKey_ the key of the pool for which you want to get information
    /// @return current reserve factor value
    function getReserveFactor(bytes32 assetKey_) external view returns (uint256);

    /// @notice Function to get the liquidation discount for the desired pool
    /// @param assetKey_ the key of the pool for which you want to get information
    /// @return current liquidation discount value
    function getLiquidationDiscount(bytes32 assetKey_) external view returns (uint256);

    /// @notice Function to get the max utilization ratio for the desired pool
    /// @param assetKey_ the key of the pool for which you want to get information
    /// @return maximum possible utilization ratio value
    function getMaxUtilizationRatio(bytes32 assetKey_) external view returns (uint256);
}
