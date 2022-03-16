// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "./IAssetParameters.sol";

/**
 * This contract is needed to add new pools, store and retrieve information about already created pools
 */
interface ILiquidityPoolRegistry {
    /// @notice This structure contains basic information about the pool
    /// @param assetKey key of the pool for which the information was obtained
    /// @param assetAddr address of the pool underlying asset
    /// @param supplyAPY annual supply rate in the current pool
    /// @param borrowAPY annual borrow rate in the current pool
    /// @param utilizationRatio the current percentage of how much of the pool was borrowed for liquidity
    /// @param isAvailableAsCollateral can an asset even be a collateral
    struct BaseInfo {
        bytes32 assetKey;
        address assetAddr;
        uint256 supplyAPY;
        uint256 borrowAPY;
        uint256 utilizationRatio;
        bool isAvailableAsCollateral;
    }

    /// @notice This structure contains main information about the pool
    /// @param baseInfo element type BaseInfo structure
    /// @param marketSize the total number of pool tokens that all users have deposited
    /// @param marketSizeInUSD the equivalent of marketSize param in dollars
    /// @param totalBorrowBalance the total number of tokens that have been borrowed in the current pool
    /// @param totalBorrowBalanceInUSD the equivalent of totalBorrowBalance param in dollars
    struct LiquidityPoolInfo {
        BaseInfo baseInfo;
        uint256 marketSize;
        uint256 marketSizeInUSD;
        uint256 totalBorrowBalance;
        uint256 totalBorrowBalanceInUSD;
    }

    /// @notice This structure contains detailed information about the pool
    /// @param poolInfo element type LiquidityPoolInfo structure
    /// @param mainPoolParams element type IAssetParameters.MainPoolParams structure
    /// @param availableLiquidity available liquidity for borrowing
    /// @param availableLiquidityInUSD the equivalent of availableLiquidity param in dollars
    /// @param totalReserve total amount of reserves in the current pool
    /// @param totalReserveInUSD the equivalent of totalReserve param in dollars
    /// @param distrSupplyAPY annual distribution rate for users who deposited in the current pool
    /// @param distrBorrowAPYannual distribution rate for users who took credit in the current pool
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
    /// @param _assetKey new pool identification key
    /// @param _assetAddr the pool underlying asset address
    /// @param _poolAddr the added pool address
    event PoolAdded(bytes32 _assetKey, address _assetAddr, address _poolAddr);

    /// @notice The function is needed to add new pools
    /// @dev Only contract owner can call this function
    /// @param _assetAddr address of the underlying pool asset
    /// @param _assetKey pool key of the added pool
    /// @param _mainOracle the address of the main oracle for the passed asset
    /// @param _backupOracle the address of the backup oracle for the passed asset
    /// @param _tokenSymbol symbol of the underlying pool asset
    /// @param _isCollateral is it possible for the new pool to be a collateral
    function addLiquidityPool(
        address _assetAddr,
        bytes32 _assetKey,
        address _mainOracle,
        address _backupOracle,
        string calldata _tokenSymbol,
        bool _isCollateral
    ) external;

    /// @notice Withdraws a certain amount of reserve funds from a certain pool to a certain recipient
    /// @dev Only contract owner can call this function
    /// @param _recipientAddr the address of the user to whom the withdrawal will be sent
    /// @param _assetKey key of the required pool
    /// @param _amountToWithdraw amount for withdrawal of reserve funds
    /// @param _isAllFunds flag to withdraw all reserve funds
    function withdrawReservedFunds(
        address _recipientAddr,
        bytes32 _assetKey,
        uint256 _amountToWithdraw,
        bool _isAllFunds
    ) external;

    /// @notice Withdrawal of all reserve funds from pools with pagination
    /// @dev Only contract owner can call this function
    /// @param _recipientAddr the address of the user to whom the withdrawal will be sent
    /// @param _offset offset for pagination
    /// @param _limit maximum number of elements for pagination
    function withdrawAllReservedFunds(
        address _recipientAddr,
        uint256 _offset,
        uint256 _limit
    ) external;

    /// @notice The function is needed to update the implementation of the pools
    /// @dev Only contract owner can call this function
    /// @param _newLiquidityPoolImpl address of the new liquidity pool implementation
    function upgradeLiquidityPoolsImpl(address _newLiquidityPoolImpl) external;

    /// @notice The function inject dependencies to existing liquidity pools
    /// @dev Only contract owner can call this function
    function injectDependenciesToExistingLiquidityPools() external;

    /// @notice The function inject dependencies with pagination
    /// @dev Only contract owner can call this function
    function injectDependencies(uint256 _offset, uint256 _limit) external;

    /// @notice Returns the address of the liquidity pool by the pool key
    /// @param _assetKey asset key obtained by converting the underlying asset symbol to bytes
    /// @return address of the liquidity pool
    function liquidityPools(bytes32 _assetKey) external view returns (address);

    /// @notice Indicates whether the address is a liquidity pool
    /// @param _poolAddr address of the liquidity pool to check
    /// @return true if the passed address is a liquidity pool, false otherwise
    function existingLiquidityPools(address _poolAddr) external view returns (bool);

    /// @notice A system function that returns the address of liquidity pool beacon
    /// @return a liquidity pool beacon address
    function getLiquidityPoolsBeacon() external view returns (address);

    /// @notice Function to check if the pool exists by the passed pool key
    /// @param _assetKey pool identification key
    /// @return true if the liquidity pool for the passed key exists, false otherwise
    function onlyExistingPool(bytes32 _assetKey) external view returns (bool);

    /// @notice Returns the number of supported assets
    /// @return supported assets count
    function getSupportedAssetsCount() external view returns (uint256);

    /// @notice Returns an array of keys of all created pools
    /// @return _resultArr an array of pool keys
    function getAllSupportedAssets() external view returns (bytes32[] memory _resultArr);

    /// @notice Returns an array of addresses of all created pools
    /// @return _resultArr an array of pool addresses
    function getAllLiquidityPools() external view returns (address[] memory _resultArr);

    /// @notice Returns keys of created pools with pagination
    /// @param _offset offset for pagination
    /// @param _limit maximum number of elements for pagination
    /// @return _resultArr an array of pool keys
    function getSupportedAssets(uint256 _offset, uint256 _limit)
        external
        view
        returns (bytes32[] memory _resultArr);

    /// @notice Returns addresses of created pools with pagination
    /// @param _offset offset for pagination
    /// @param _limit maximum number of elements for pagination
    /// @return _resultArr an array of pool addresses
    function getLiquidityPools(uint256 _offset, uint256 _limit)
        external
        view
        returns (address[] memory _resultArr);

    /// @notice Returns the address of the liquidity pool for the governance token
    /// @return liquidity pool address for the governance token
    function getGovernanceLiquidityPool() external view returns (address);

    /// @notice The function returns the total amount of deposits to all pools
    /// @return _totalMarketSize total amount of deposits in dollars
    function getTotalMarketsSize() external view returns (uint256 _totalMarketSize);

    /// @notice A function that returns an array of structures with pool information
    /// @param _assetKeys an array of pool keys for which you want to get information
    /// @return _poolsInfo an array of LiquidityPoolInfo structures
    function getLiquidityPoolsInfo(bytes32[] calldata _assetKeys)
        external
        view
        returns (LiquidityPoolInfo[] memory _poolsInfo);

    /// @notice A function that returns a structure with detailed pool information
    /// @param _assetKey pool key for which you want to get information
    /// @return a DetailedLiquidityPoolInfo structure
    function getDetailedLiquidityPoolInfo(bytes32 _assetKey)
        external
        view
        returns (DetailedLiquidityPoolInfo memory);
}
