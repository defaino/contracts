// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

interface IAssetsRegistry {
    struct SupplyAssetInfo {
        address assetAddr;
        uint256 supplyAPY;
        uint256 distributionSupplyAPY;
        uint256 userSupplyBalanceInUSD;
        uint256 userSupplyBalance;
        MaxSupplyValues maxSupplyValues;
        bool isPossibleToBeCollateral;
        bool isCollateralEnabled;
    }

    struct BorrowAssetInfo {
        address assetAddr;
        uint256 borrowAPY;
        uint256 distributionBorrowAPY;
        uint256 userBorrowBalanceInUSD;
        uint256 userBorrowBalance;
        MaxBorrowValues maxBorrowValues;
        uint256 borrowPercentage;
    }

    struct IntegrationBorrowAssetInfo {
        BorrowAssetInfo borrowAssetInfo;
        VaultInfo[] vaultsInfo;
    }

    struct AssetInfo {
        address assetAddr;
        uint256 apy;
        uint256 distributionAPY;
        uint256 userBalanceInUSD;
        uint256 userBalance;
        uint256 poolCapacity;
        uint256 maxValue;
        bool isPossibleToBeCollateral;
        bool isCollateralEnabled;
    }

    struct MaxSupplyValues {
        uint256 maxToSupply;
        uint256 maxToWithdraw;
    }

    struct MaxBorrowValues {
        uint256 maxToBorrow;
        uint256 maxToRepay;
    }

    struct VaultInfo {
        address vaultTokenAddr;
        uint256 depositedAmount;
        uint256 currentReward;
    }

    function getUserSupplyAssets(address _userAddr)
        external
        view
        returns (bytes32[] memory _userSupplyAssets);

    function getUserIntegrationSupplyAssets(address _userAddr)
        external
        view
        returns (bytes32[] memory _userIntegrationSupplyAssets);

    function getUserBorrowAssets(address _userAddr)
        external
        view
        returns (bytes32[] memory _userBorrowAssets);

    function getUserIntegrationBorrowAssets(address _userAddr)
        external
        view
        returns (bytes32[] memory _userIntegrationBorrowAssets);

    function getSupplyAssets(address _userAddr)
        external
        view
        returns (bytes32[] memory _availableAssets, bytes32[] memory _userSupplyAssets);

    function getIntegrationSupplyAssets(address _userAddr)
        external
        view
        returns (bytes32[] memory _availableAssets, bytes32[] memory _userSupplyAssets);

    function getBorrowAssets(address _userAddr)
        external
        view
        returns (bytes32[] memory _availableAssets, bytes32[] memory _userBorrowAssets);

    function getIntegrationBorrowAssets(address _userAddr)
        external
        view
        returns (bytes32[] memory _availableAssets, bytes32[] memory _userBorrowAssets);

    function getSupplyAssetsInfo(bytes32[] memory _assetsKeys, address _userAddr)
        external
        view
        returns (SupplyAssetInfo[] memory _resultArr);

    function getBorrowAssetsInfo(bytes32[] memory _assetsKeys, address _userAddr)
        external
        view
        returns (BorrowAssetInfo[] memory _resultArr);

    function getAssetsInfo(
        bytes32[] memory _assetsKeys,
        address _userAddr,
        bool _isSupply
    ) external view returns (AssetInfo[] memory _resultArr);

    function updateAssetsAfterTransfer(
        bytes32 _assetKey,
        address _from,
        address _to,
        uint256 _amount
    ) external;

    function updateUserAssets(
        address _userAddr,
        bytes32 _assetKey,
        bool _isSuply
    ) external;
}
