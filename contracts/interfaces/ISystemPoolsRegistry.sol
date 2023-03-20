// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "./IAssetParameters.sol";

/**
 * This contract is needed to add new pools, store and retrieve information about already created pools
 */
interface ISystemPoolsRegistry {
    /// @notice Enumeration with the types of pools that are available in the system
    /// @param LIQUIDITY_POOL a liquidity pool type
    /// @param STABLE_POOL a stable pool type
    enum PoolType {
        LIQUIDITY_POOL,
        STABLE_POOL
    }

    /// @notice This structure contains system information about the pool
    /// @param poolAddr an address of the pool
    /// @param poolType stored pool type
    struct PoolInfo {
        address poolAddr;
        PoolType poolType;
    }

    /// @notice This structure contains system information a certain type of pool
    /// @param poolBeaconAddr beacon contract address for a certain type of pools
    /// @param supportedAssetKeys storage of keys, which are supported by a certain type of pools
    struct PoolTypeInfo {
        address poolBeaconAddr;
        EnumerableSet.Bytes32Set supportedAssetKeys;
    }

    /// @notice This structure contains basic information about the pool
    /// @param assetKey key of the pool for which the information was obtained
    /// @param assetAddr address of the pool underlying asset
    /// @param borrowAPY annual borrow rate in the current
    /// @param distrBorrowAPY annual distribution rate for users who took credit in the current pool
    /// @param totalBorrowBalance the total number of tokens that have been borrowed in the current pool
    /// @param totalBorrowBalanceInUSD the equivalent of totalBorrowBalance param in dollars
    struct BasePoolInfo {
        bytes32 assetKey;
        address assetAddr;
        uint256 borrowAPY;
        uint256 distrBorrowAPY;
        uint256 totalBorrowBalance;
        uint256 totalBorrowBalanceInUSD;
    }

    /// @notice This structure contains main information about the liquidity pool
    /// @param baseInfo element type BasePoolInfo structure
    /// @param supplyAPY annual supply rate in the current pool
    /// @param distrSupplyAPY annual distribution rate for users who deposited in the current pool
    /// @param marketSize the total number of pool tokens that all users have deposited
    /// @param marketSizeInUSD the equivalent of marketSize param in dollars
    /// @param utilizationRatio the current percentage of how much of the pool was borrowed for liquidity
    /// @param isAvailableAsCollateral can an asset even be a collateral
    struct LiquidityPoolInfo {
        BasePoolInfo baseInfo;
        uint256 supplyAPY;
        uint256 distrSupplyAPY;
        uint256 marketSize;
        uint256 marketSizeInUSD;
        uint256 utilizationRatio;
        bool isAvailableAsCollateral;
    }

    /// @notice This structure contains main information about the liquidity pool
    /// @param baseInfo element type BasePoolInfo structure
    struct StablePoolInfo {
        BasePoolInfo baseInfo;
    }

    /// @notice This structure contains detailed information about the pool
    /// @param poolInfo element type LiquidityPoolInfo structure
    /// @param mainPoolParams element type IAssetParameters.MainPoolParams structure
    /// @param availableLiquidity available liquidity for borrowing
    /// @param availableLiquidityInUSD the equivalent of availableLiquidity param in dollars
    /// @param totalReserve total amount of reserves in the current pool
    /// @param totalReserveInUSD the equivalent of totalReserve param in dollars
    /// @param distrSupplyAPY annual distribution rate for users who deposited in the current pool
    /// @param distrBorrowAPY annual distribution rate for users who took credit in the current pool
    struct DetailedLiquidityPoolInfo {
        LiquidityPoolInfo poolInfo;
        IAssetParameters.MainPoolParams mainPoolParams;
        uint256 availableLiquidity;
        uint256 availableLiquidityInUSD;
        uint256 totalReserve;
        uint256 totalReserveInUSD;
        uint256 distrSupplyAPY;
        uint256 distrBorrowAPY;
    }

    /// @notice This event is emitted when a new pool is added
    /// @param assetKey new pool identification key
    /// @param assetAddr the pool underlying asset address
    /// @param poolAddr the added pool address
    /// @param poolType the type of the added pool
    event PoolAdded(bytes32 assetKey, address assetAddr, address poolAddr, PoolType poolType);

    /// @notice Function to add a beacon contract for the desired type of pools
    /// @dev Only SYSTEM_POOLS_MANAGER can call this function
    /// @param poolType_ the type of pool for which the beacon contract will be added
    /// @param poolImpl_ the implementation address for the desired pool type
    function addPoolsBeacon(PoolType poolType_, address poolImpl_) external;

    /// @notice The function is needed to add new liquidity pools
    /// @dev Only SYSTEM_POOLS_MANAGER call this function
    /// @param assetAddr_ address of the underlying liquidity pool asset
    /// @param assetKey_ pool key of the added liquidity pool
    /// @param chainlinkOracle_ the address of the chainlink oracle for the passed asset
    /// @param tokenSymbol_ symbol of the underlying liquidity pool asset
    /// @param isCollateral_ is it possible for the new liquidity pool to be a collateral
    /// @param isCollateralWithPRT_ is it possible for the new liquidity pool to be a collateral for a user with PRT
    function addLiquidityPool(
        address assetAddr_,
        bytes32 assetKey_,
        address chainlinkOracle_,
        string calldata tokenSymbol_,
        bool isCollateral_,
        bool isCollateralWithPRT_
    ) external;

    /// @notice The function is needed to add new stable pools
    /// @dev Only SYSTEM_POOLS_MANAGER can call this function
    /// @param assetAddr_ address of the underlying stable pool asset
    /// @param assetKey_ pool key of the added stable pool
    /// @param chainlinkOracle_ the address of the chainlink oracle for the passed asset
    function addStablePool(
        address assetAddr_,
        bytes32 assetKey_,
        address chainlinkOracle_
    ) external;

    /// @notice Withdraws a certain amount of reserve funds from a certain pool to a certain recipient
    /// @dev Only SYSTEM_POOLS_RESERVE_FUNDS_MANAGER can call this function
    /// @param recipientAddr_ the address of the user to whom the withdrawal will be sent
    /// @param assetKey_ key of the required pool
    /// @param amountToWithdraw_ amount for withdrawal of reserve funds
    /// @param isAllFunds_ flag to withdraw all reserve funds
    function withdrawReservedFunds(
        address recipientAddr_,
        bytes32 assetKey_,
        uint256 amountToWithdraw_,
        bool isAllFunds_
    ) external;

    /// @notice Withdrawal of all reserve funds from pools with pagination
    /// @dev Only SYSTEM_POOLS_RESERVE_FUNDS_MANAGER can call this function
    /// @param recipientAddr_ the address of the user to whom the withdrawal will be sent
    /// @param offset_ offset for pagination
    /// @param limit_ maximum number of elements for pagination
    function withdrawAllReservedFunds(
        address recipientAddr_,
        uint256 offset_,
        uint256 limit_
    ) external;

    /// @notice The function is needed to update the reward asset
    /// @dev Only SYSTEM_POOLS_MANAGER can call this function
    /// @param newRewardsAssetKey_ key of the new rewards asset
    function updateRewardsAssetKey(bytes32 newRewardsAssetKey_) external;

    /// @notice The function is needed to update the implementation of the pools
    /// @dev Only SYSTEM_POOLS_MANAGER can call this function
    /// @param poolType_ needed pool type from PoolType enum
    /// @param newPoolsImpl_ address of the new pools implementation
    function upgradePoolsImpl(PoolType poolType_, address newPoolsImpl_) external;

    /// @notice The function inject dependencies to existing liquidity pools
    /// @dev Only SYSTEM_POOLS_MANAGER can call this function
    function injectDependenciesToExistingPools() external;

    /// @notice The function inject dependencies with pagination
    /// @dev Only SYSTEM_POOLS_MANAGER can call this function
    function injectDependencies(uint256 offset_, uint256 limit_) external;

    /// @notice The function returns the native asset key
    /// @return a native asset key
    function nativeAssetKey() external view returns (bytes32);

    /// @notice The function returns the asset key, which will be credited as a reward for distribution
    /// @return a rewards asset key
    function rewardsAssetKey() external view returns (bytes32);

    /// @notice The function returns system information for the desired pool
    /// @param assetKey_ pool key for which you want to get information
    /// @return poolAddr_ an address of the pool
    /// @return poolType_ a pool type
    function poolsInfo(
        bytes32 assetKey_
    ) external view returns (address poolAddr_, PoolType poolType_);

    /// @notice Indicates whether the address is a liquidity pool
    /// @param poolAddr_ address of the liquidity pool to check
    /// @return true if the passed address is a liquidity pool, false otherwise
    function existingLiquidityPools(address poolAddr_) external view returns (bool);

    /// @notice A function that returns an array of structures with liquidity pool information
    /// @param assetKeys_ an array of pool keys for which you want to get information
    /// @param withPRT_ whether to get the information for the user with PRT
    /// @return poolsInfo_ an array of LiquidityPoolInfo structures
    function getLiquidityPoolsInfo(
        bytes32[] calldata assetKeys_,
        bool withPRT_
    ) external view returns (LiquidityPoolInfo[] memory poolsInfo_);

    /// @notice A function that returns an array of structures with stable pool information
    /// @param assetKeys_ an array of pool keys for which you want to get information
    /// @return poolsInfo_ an array of StablePoolInfo structures
    function getStablePoolsInfo(
        bytes32[] calldata assetKeys_
    ) external view returns (StablePoolInfo[] memory poolsInfo_);

    /// @notice A function that returns a structure with detailed pool information
    /// @param assetKey_ pool key for which you want to get information
    /// @param withPRT_ whether to get the information for the user with PRT
    /// @return a DetailedLiquidityPoolInfo structure
    function getDetailedLiquidityPoolInfo(
        bytes32 assetKey_,
        bool withPRT_
    ) external view returns (DetailedLiquidityPoolInfo memory);

    /// @notice Returns the address of the liquidity pool for the rewards token
    /// @return liquidity pool address for the rewards token
    function getRewardsLiquidityPool() external view returns (address);

    /// @notice A system function that returns the address of liquidity pool beacon
    /// @param poolType_ needed pool type from PoolType enum
    /// @return a required pool beacon address
    function getPoolsBeacon(PoolType poolType_) external view returns (address);

    /// @notice A function that returns the address of liquidity pools implementation
    /// @param poolType_ needed pool type from PoolType enum
    /// @return a required pools implementation address
    function getPoolsImpl(PoolType poolType_) external view returns (address);

    /// @notice Function to check if the pool exists by the passed pool key
    /// @param assetKey_ pool identification key
    /// @return true if the liquidity pool for the passed key exists, false otherwise
    function onlyExistingPool(bytes32 assetKey_) external view returns (bool);

    /// @notice The function returns the number of all supported assets in the system
    /// @return an all supported assets count
    function getAllSupportedAssetKeysCount() external view returns (uint256);

    /// @notice The function returns the number of all supported assets in the system by types
    /// @param poolType_ type of pools, the number of which you want to get
    /// @return an all supported assets count for passed pool type
    function getSupportedAssetKeysCountByType(PoolType poolType_) external view returns (uint256);

    /// @notice The function returns the keys of all the system pools
    /// @return an array of all system pool keys
    function getAllSupportedAssetKeys() external view returns (bytes32[] memory);

    /// @notice The function returns the keys of all pools by type
    /// @param poolType_ the type of pool, the keys for which you want to get
    /// @return an array of all pool keys by passed type
    function getAllSupportedAssetKeysByType(
        PoolType poolType_
    ) external view returns (bytes32[] memory);

    /// @notice The function returns keys of created pools with pagination
    /// @param offset_ offset for pagination
    /// @param limit_ maximum number of elements for pagination
    /// @return an array of pool keys
    function getSupportedAssetKeys(
        uint256 offset_,
        uint256 limit_
    ) external view returns (bytes32[] memory);

    /// @notice The function returns keys of created pools with pagination by pool type
    /// @param poolType_ the type of pool, the keys for which you want to get
    /// @param offset_ offset for pagination
    /// @param limit_ maximum number of elements for pagination
    /// @return an array of pool keys by passed type
    function getSupportedAssetKeysByType(
        PoolType poolType_,
        uint256 offset_,
        uint256 limit_
    ) external view returns (bytes32[] memory);

    /// @notice Returns an array of addresses of all created pools
    /// @return an array of all pool addresses
    function getAllPools() external view returns (address[] memory);

    /// @notice The function returns an array of all pools of the desired type
    /// @param poolType_ the pool type for which you want to get an array of all pool addresses
    /// @return an array of all pool addresses by passed type
    function getAllPoolsByType(PoolType poolType_) external view returns (address[] memory);

    /// @notice Returns addresses of created pools with pagination
    /// @param offset_ offset for pagination
    /// @param limit_ maximum number of elements for pagination
    /// @return an array of pool addresses
    function getPools(uint256 offset_, uint256 limit_) external view returns (address[] memory);

    /// @notice Returns addresses of created pools with pagination by type
    /// @param poolType_ the pool type for which you want to get an array of pool addresses
    /// @param offset_ offset for pagination
    /// @param limit_ maximum number of elements for pagination
    /// @return an array of pool addresses by passed type
    function getPoolsByType(
        PoolType poolType_,
        uint256 offset_,
        uint256 limit_
    ) external view returns (address[] memory);
}
