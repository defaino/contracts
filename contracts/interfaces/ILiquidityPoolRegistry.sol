// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "./IAssetParameters.sol";

interface ILiquidityPoolRegistry {
    event PoolAdded(bytes32 _assetKey, address _assetAddr, address _poolAddr);

    struct BaseInfo {
        bytes32 assetKey;
        address assetAddr;
        uint256 supplyAPY;
        uint256 borrowAPY;
        uint256 utilizationRatio;
        bool isAvailableAsCollateral;
    }

    struct LiquidityPoolInfo {
        BaseInfo baseInfo;
        uint256 marketSize;
        uint256 marketSizeInUSD;
        uint256 totalBorrowBalance;
        uint256 totalBorrowBalanceInUSD;
    }

    struct DetailedLiquidityPoolInfo {
        LiquidityPoolInfo poolInfo;
        IAssetParameters.LiquidityPoolParams liquidityPoolParams;
        uint256 availableLiquidity;
        uint256 availableLiquidityInUSD;
        uint256 totalReserve;
        uint256 totalReserveInUSD;
        uint256 distrSupplyAPY;
        uint256 distrBorrowAPY;
    }

    function getLiquidityPoolsBeacon() external view returns (address);

    function getSupportedAssetsCount() external view returns (uint256);

    function getAllSupportedAssets() external view returns (bytes32[] memory _resultArr);

    function getAllLiquidityPools() external view returns (address[] memory _resultArr);

    function getSupportedAssets(uint256 _offset, uint256 _limit)
        external
        view
        returns (bytes32[] memory _resultArr);

    function getLiquidityPools(uint256 _offset, uint256 _limit)
        external
        view
        returns (address[] memory _resultArr);

    /**
     * @notice Returns the address of the liquidity pool by the asset key
     * @param _assetKey Asset key obtained by converting the asset character to bytes
     * @return address of the liquidity pool
     */
    function liquidityPools(bytes32 _assetKey) external view returns (address);

    /**
     * @notice Indicates whether the address is a liquidity pool
     * @param _poolAddr Address of the liquidity pool
     * @return true if the passed address is a liquidity pool, false otherwise
     */
    function existingLiquidityPools(address _poolAddr) external view returns (bool);

    function onlyExistingPool(bytes32 _assetKey) external view returns (bool);

    /**
     * @notice Returns the address of the liquidity pool for the governance token
     * @return liquidity pool address for the governance token
     */
    function getGovernanceLiquidityPool() external view returns (address);

    function getTotalMarketsSize() external view returns (uint256 _totalMarketSize);

    function getLiquidityPoolsInfo(bytes32[] calldata _assetKeys)
        external
        view
        returns (LiquidityPoolInfo[] memory _poolsInfo);

    function getDetailedLiquidityPoolInfo(bytes32 _assetKey)
        external
        view
        returns (DetailedLiquidityPoolInfo memory);
}
