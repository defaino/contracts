// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "./interfaces/IBorrowerRouter.sol";
import "./interfaces/YEarn/IVault.sol";
import "./interfaces/YEarn/IVaultRegistry.sol";
import "./interfaces/Curve/ICurveRegistry.sol";
import "./interfaces/Curve/IPool.sol";
import "./interfaces/Curve/IZap.sol";
import "./interfaces/ISystemParameters.sol";
import "./interfaces/ILiquidityPoolRegistry.sol";

import "./libraries/DecimalsConverter.sol";

import "./Registry.sol";

contract BorrowerRouter is IBorrowerRouter, Initializable {
    using DecimalsConverter for uint256;

    uint256 private constant N_COINS_IN_META = 2;
    uint256 private constant N_UNDERLYING_COINS_IN_META = 4;

    uint256 private constant BASE_POOL_2 = 2;
    uint256 private constant BASE_POOL_3 = 3;

    address public constant POOL_3CRV = 0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7; // Ethereum mainnet 3Crv pool address

    Registry private registry;

    address public user;

    // Vault token address => asset address => deposited amount
    mapping(address => mapping(address => uint256)) public override depositOfAssetInToken;

    // Vault token address => vault deposit info
    mapping(address => VaultDepositInfo) public vaultsDepoitInfo;

    event AssetDeposited(
        address _assetAddr,
        address _vaultTokenAddr,
        uint256 _assetAmount,
        uint256 _vaultTokenAmount
    );
    event AssetWithdrawn(
        address _assetAddr,
        address _vaultTokenAddr,
        uint256 _assetAmountReceived
    );
    event InterestPaid(address _recipientAddr, address _assetAddr, uint256 _rewardAmount);

    modifier onlyIntegrationCore() {
        require(
            msg.sender == registry.getIntegrationCoreContract(),
            "BorrowerRouter: Caller not an IntegrationCore."
        );
        _;
    }

    modifier onlyLiquidityPools() {
        require(
            ILiquidityPoolRegistry(registry.getLiquidityPoolRegistryContract())
                .existingLiquidityPools(msg.sender),
            "BorrowerRouter: Caller not a LiquidityPool."
        );
        _;
    }

    function borrowerRouterInitialize(address _registryAddr, address _userAddr)
        external
        override
        initializer
    {
        registry = Registry(_registryAddr);
        user = _userAddr;
    }

    function getUserDepositedAmountInAsset(address _assetAddr, address _vaultTokenAddr)
        external
        view
        override
        returns (uint256)
    {
        return
            _convertToAssetTokens(
                _assetAddr,
                _vaultTokenAddr,
                depositOfAssetInToken[_vaultTokenAddr][_assetAddr]
            ).convertTo18(ERC20(_assetAddr).decimals());
    }

    function getUserRewardInAsset(address _assetAddr, address _vaultTokenAddr)
        external
        view
        override
        returns (uint256)
    {
        return
            _convertToAssetTokens(
                _assetAddr,
                _vaultTokenAddr,
                _getCurrentInterest(_vaultTokenAddr)
            ).convertTo18(ERC20(_assetAddr).decimals());
    }

    function increaseAllowance(address _tokenAddr) external override onlyIntegrationCore {
        _increaseAllowance(_tokenAddr, msg.sender);
    }

    function deposit(address _assetAddr, address _vaultTokenAddr)
        external
        override
        onlyIntegrationCore
    {
        uint256 _assetAmount = _getSelfBalance(_assetAddr);
        uint256 _vaultTokenAmount = _assetAmount;

        if (_assetAddr != _vaultTokenAddr) {
            /// @dev _crvDeposit function returns amount in vault token
            _vaultTokenAmount = _crvDeposit(_assetAddr, _vaultTokenAddr, _assetAmount);
        }

        depositOfAssetInToken[_vaultTokenAddr][_assetAddr] += _vaultTokenAmount;
        vaultsDepoitInfo[_vaultTokenAddr].amountInVaultToken += _vaultTokenAmount;

        _yEarnDeposit(_vaultTokenAddr);

        emit AssetDeposited(_assetAddr, _vaultTokenAddr, _assetAmount, _vaultTokenAmount);
    }

    function withdraw(
        address _assetAddr,
        address _vaultTokenAddr,
        uint256 _assetWithdrawAmount,
        bool _isMaxWithdraw
    ) external override onlyLiquidityPools returns (uint256) {
        require(
            depositOfAssetInToken[_vaultTokenAddr][_assetAddr] > 0,
            "BorrowerRouter: Nothing to withdraw."
        );

        uint256 _receivedAssetAmount;

        if (_assetAddr != _vaultTokenAddr) {
            _receivedAssetAmount = _crvWithdraw(
                _assetAddr,
                _vaultTokenAddr,
                _assetWithdrawAmount,
                _isMaxWithdraw
            );
        } else {
            _receivedAssetAmount = _yEarnWithdraw(
                _assetAddr,
                _vaultTokenAddr,
                _assetWithdrawAmount,
                _isMaxWithdraw
            );
        }

        if (_receivedAssetAmount > _assetWithdrawAmount) {
            address _userAddr = user;
            uint256 _rewardAmount = _receivedAssetAmount - _assetWithdrawAmount;

            ERC20(_assetAddr).transfer(_userAddr, _rewardAmount);

            emit InterestPaid(_userAddr, _assetAddr, _rewardAmount);

            if (_assetWithdrawAmount == 0) {
                return _receivedAssetAmount;
            }

            _receivedAssetAmount = _assetWithdrawAmount;
        }

        emit AssetWithdrawn(_assetAddr, _vaultTokenAddr, _receivedAssetAmount);

        ERC20(_assetAddr).transfer(msg.sender, _receivedAssetAmount);

        return _receivedAssetAmount;
    }

    function _yEarnDeposit(address _vaultTokenAddr) internal {
        address _currentVaultAddr = vaultsDepoitInfo[_vaultTokenAddr].vaultAddr;

        if (_currentVaultAddr == address(0)) {
            _currentVaultAddr = IVaultRegistry(
                ISystemParameters(registry.getSystemParametersContract()).getYEarnRegistryParam()
            ).latestVault(_vaultTokenAddr);

            require(
                _currentVaultAddr != address(0),
                "BorrowerRouter: Incorrect vault token address."
            );

            vaultsDepoitInfo[_vaultTokenAddr].vaultAddr = _currentVaultAddr;
        }

        _increaseAllowance(_vaultTokenAddr, _currentVaultAddr);

        IYearnVault(_currentVaultAddr).deposit();
    }

    function _crvDeposit(
        address _assetAddr,
        address _vaultTokenAddr,
        uint256 _assetAmount
    ) internal returns (uint256) {
        ICurveRegistry _crvRegistry = ICurveRegistry(
            ISystemParameters(registry.getSystemParametersContract()).getCurveRegistryParam()
        );

        (address _poolAddr, bool _isMeta) = _getCurvePool(_crvRegistry, _vaultTokenAddr);

        if (_isMeta) {
            return _crvMetaPoolDeposit(_crvRegistry, _assetAddr, _poolAddr, _assetAmount);
        } else {
            return _crvBasePoolDeposit(_crvRegistry, _assetAddr, _poolAddr, _assetAmount);
        }
    }

    function _crvMetaPoolDeposit(
        ICurveRegistry _crvRegistry,
        address _assetAddr,
        address _poolAddr,
        uint256 _amount
    ) internal returns (uint256) {
        require(
            IMetaPool(_poolAddr).base_pool() == POOL_3CRV,
            "BorrowerRouter: Unsupported meta pool."
        );

        (, uint256 _indexInPool) = _getPoolInfo(_crvRegistry, _poolAddr, _assetAddr, true);

        uint256[N_UNDERLYING_COINS_IN_META] memory _crvArray;
        _crvArray[_indexInPool] = _amount;

        ICurveZap _depositContract = ICurveZap(
            ISystemParameters(registry.getSystemParametersContract()).getCurveZapParam()
        );

        _increaseAllowance(_assetAddr, address(_depositContract));

        return _depositContract.add_liquidity(_poolAddr, _crvArray, 0);
    }

    function _crvBasePoolDeposit(
        ICurveRegistry _crvRegistry,
        address _assetAddr,
        address _poolAddr,
        uint256 _amount
    ) internal returns (uint256) {
        (uint256 _numberOfCoins, uint256 _indexInArray) = _getPoolInfo(
            _crvRegistry,
            _poolAddr,
            _assetAddr,
            false
        );

        require(
            _numberOfCoins == BASE_POOL_3 || _numberOfCoins == BASE_POOL_2,
            "BorrowerRouter: Incorrect number of coins in the pool."
        );

        _increaseAllowance(_assetAddr, _poolAddr);

        if (_numberOfCoins == BASE_POOL_2) {
            uint256[BASE_POOL_2] memory _amounts;
            _amounts[_indexInArray] = _amount;

            return IBasePool(_poolAddr).add_liquidity(_amounts, 0);
        } else {
            uint256[BASE_POOL_3] memory _amounts;
            _amounts[_indexInArray] = _amount;

            return IBasePool(_poolAddr).add_liquidity(_amounts, 0);
        }
    }

    function _yEarnWithdraw(
        address _assetAddr,
        address _vaultTokenAddr,
        uint256 _withdrawAmountInToken,
        bool _isMaxWithdraw
    ) internal returns (uint256) {
        uint256 _assetDepositAmountInToken = depositOfAssetInToken[_vaultTokenAddr][_assetAddr];
        uint256 _totalDepositInVault = vaultsDepoitInfo[_vaultTokenAddr].amountInVaultToken;

        uint256 _assetAmountToWithdraw = _assetDepositAmountInToken;
        bool _isFullWithdraw;

        if (!_isMaxWithdraw && _withdrawAmountInToken < _assetDepositAmountInToken) {
            _assetAmountToWithdraw = _withdrawAmountInToken;
        } else if (_totalDepositInVault == _assetDepositAmountInToken) {
            _isFullWithdraw = true;
        } else {
            _withdrawAmountInToken =
                _assetDepositAmountInToken +
                _getCurrentInterest(_vaultTokenAddr);
        }

        depositOfAssetInToken[_vaultTokenAddr][_assetAddr] =
            _assetDepositAmountInToken -
            _assetAmountToWithdraw;
        vaultsDepoitInfo[_vaultTokenAddr].amountInVaultToken =
            _totalDepositInVault -
            _assetAmountToWithdraw;

        IYearnVault _vault = IYearnVault(vaultsDepoitInfo[_vaultTokenAddr].vaultAddr);

        if (_isFullWithdraw) {
            delete vaultsDepoitInfo[_vaultTokenAddr].vaultAddr;

            return _vault.withdraw();
        } else {
            return
                _vault.withdraw(
                    (_withdrawAmountInToken * _getOneToken(address(_vault))) /
                        _vault.pricePerShare()
                );
        }
    }

    function _crvWithdraw(
        address _assetAddr,
        address _vaultTokenAddr,
        uint256 _assetWithdrawAmount,
        bool _isMaxWithdraw
    ) internal returns (uint256) {
        ICurveRegistry _crvRegistry = ICurveRegistry(
            ISystemParameters(registry.getSystemParametersContract()).getCurveRegistryParam()
        );

        (address _poolAddr, bool _isMeta) = _getCurvePool(_crvRegistry, _vaultTokenAddr);

        if (_isMeta) {
            _crvMetaPoolWithdraw(
                _crvRegistry,
                _vaultTokenAddr,
                _poolAddr,
                _assetAddr,
                _assetWithdrawAmount,
                _isMaxWithdraw
            );
        } else {
            _crvBasePoolWithdraw(
                _crvRegistry,
                _vaultTokenAddr,
                _poolAddr,
                _assetAddr,
                _assetWithdrawAmount,
                _isMaxWithdraw
            );
        }

        return _getSelfBalance(_assetAddr);
    }

    function _crvMetaPoolWithdraw(
        ICurveRegistry _crvRegistry,
        address _vaultTokenAddr,
        address _poolAddr,
        address _assetAddr,
        uint256 _assetWithdrawAmount,
        bool _isMaxWithdraw
    ) internal {
        require(
            IMetaPool(_poolAddr).base_pool() == POOL_3CRV,
            "BorrowerRouter: Unsupported meta pool."
        );

        ICurveZap _depositContract = ICurveZap(
            ISystemParameters(registry.getSystemParametersContract()).getCurveZapParam()
        );

        (, uint256 _indexInPool) = _getPoolInfo(_crvRegistry, _poolAddr, _assetAddr, true);

        uint256 _assetWithdrawAmountInToken;

        if (!_isMaxWithdraw) {
            uint256[N_UNDERLYING_COINS_IN_META] memory _crvArr;
            _crvArr[_indexInPool] = _assetWithdrawAmount;

            _assetWithdrawAmountInToken = _depositContract.calc_token_amount(
                _poolAddr,
                _crvArr,
                false
            );
        }

        uint256 _vaultTokenAmount = _yEarnWithdraw(
            _assetAddr,
            _vaultTokenAddr,
            _assetWithdrawAmountInToken,
            _isMaxWithdraw
        );

        _increaseAllowance(_vaultTokenAddr, address(_depositContract));

        _depositContract.remove_liquidity_one_coin(
            _poolAddr,
            _vaultTokenAmount,
            _toInt128(_indexInPool),
            0
        );
    }

    function _crvBasePoolWithdraw(
        ICurveRegistry _crvRegistry,
        address _vaultTokenAddr,
        address _poolAddr,
        address _assetAddr,
        uint256 _assetWithdrawAmount,
        bool _isMaxWithdraw
    ) internal {
        (uint256 _numberOfCoins, uint256 _indexInPool) = _getPoolInfo(
            _crvRegistry,
            _poolAddr,
            _assetAddr,
            false
        );

        _increaseAllowance(_vaultTokenAddr, _poolAddr);

        uint256 _withdrawAmountInVaultToken;

        if (!_isMaxWithdraw) {
            _withdrawAmountInVaultToken = _getWithdrawAmountInVaultToken(
                IBasePool(_poolAddr),
                _assetWithdrawAmount,
                _numberOfCoins,
                _indexInPool
            );
        }

        uint256 _vaultTokenAmount = _yEarnWithdraw(
            _assetAddr,
            _vaultTokenAddr,
            _withdrawAmountInVaultToken,
            _isMaxWithdraw
        );

        IBasePool(_poolAddr).remove_liquidity_one_coin(
            _vaultTokenAmount,
            int128(int256(_indexInPool)),
            0
        );
    }

    function _increaseAllowance(address _assetAddr, address _spender) internal {
        ERC20 _asset = ERC20(_assetAddr);

        if (_asset.allowance(address(this), _spender) == 0) {
            _asset.approve(_spender, type(uint256).max);
        }
    }

    function _convertToAssetTokens(
        address _assetAddr,
        address _vaultTokenAddr,
        uint256 _amountToConvert
    ) internal view returns (uint256) {
        if (_assetAddr == _vaultTokenAddr) {
            return _amountToConvert;
        }

        ICurveRegistry _crvRegistry = ICurveRegistry(
            ISystemParameters(registry.getSystemParametersContract()).getCurveRegistryParam()
        );

        (address _poolAddr, bool _isMeta) = _getCurvePool(_crvRegistry, _vaultTokenAddr);
        (, uint256 _indexInPool) = _getPoolInfo(_crvRegistry, _poolAddr, _assetAddr, _isMeta);

        if (_isMeta) {
            ICurveZap _depositContract = ICurveZap(
                ISystemParameters(registry.getSystemParametersContract()).getCurveZapParam()
            );

            return
                _depositContract.calc_withdraw_one_coin(
                    _poolAddr,
                    _amountToConvert,
                    _toInt128(_indexInPool)
                );
        } else {
            return
                IBasePool(_poolAddr).calc_withdraw_one_coin(
                    _amountToConvert,
                    _toInt128(_indexInPool)
                );
        }
    }

    function _getWithdrawAmountInVaultToken(
        IBasePool _basePool,
        uint256 _assetAmount,
        uint256 _numberOfCoins,
        uint256 _indexInPool
    ) internal view returns (uint256 _withdrawAmountInVaultToken) {
        if (_numberOfCoins == BASE_POOL_2) {
            uint256[BASE_POOL_2] memory _amounts;
            _amounts[_indexInPool] = _assetAmount;

            _withdrawAmountInVaultToken = _basePool.calc_token_amount(_amounts, false);
        } else {
            uint256[BASE_POOL_3] memory _amounts;
            _amounts[_indexInPool] = _assetAmount;

            _withdrawAmountInVaultToken = _basePool.calc_token_amount(_amounts, false);
        }
    }

    function _getPoolInfo(
        ICurveRegistry _crvRegistry,
        address _poolAddr,
        address _assetAddr,
        bool _isMeta
    ) internal view returns (uint256, uint256) {
        uint256[2] memory _numberOfCoinsAndUnderlying = _crvRegistry.get_n_coins(_poolAddr);
        uint256 _numberOfUnderlying = _numberOfCoinsAndUnderlying[1];

        if (_isMeta) {
            require(
                _numberOfCoinsAndUnderlying[0] == N_COINS_IN_META &&
                    _numberOfCoinsAndUnderlying[1] == N_UNDERLYING_COINS_IN_META,
                "BorrowerRouter: Invalid number of coins in the pool."
            );
        } else {
            require(
                _numberOfUnderlying == _numberOfCoinsAndUnderlying[0],
                "BorrowerRouter: Incorrect base pool address."
            );
        }

        address[8] memory _coinAddresses = _crvRegistry.get_underlying_coins(_poolAddr);

        for (uint256 i = 0; i < _numberOfUnderlying; i++) {
            if (_coinAddresses[i] == _assetAddr) {
                return (_numberOfUnderlying, i);
            }
        }

        revert("BorrowerRouter: Incorrect coins list.");
    }

    function _getCurrentInterest(address _vaultTokenAddr) internal view returns (uint256) {
        IYearnVault _vault = IYearnVault(vaultsDepoitInfo[_vaultTokenAddr].vaultAddr);

        uint256 _totalTokens = (_getSelfBalance(address(_vault)) * _vault.pricePerShare()) /
            _getOneToken(address(_vault));
        uint256 _depositedTokens = vaultsDepoitInfo[_vaultTokenAddr].amountInVaultToken;

        return _totalTokens <= _depositedTokens ? 0 : _totalTokens - _depositedTokens;
    }

    function _getCurvePool(ICurveRegistry _curveRegistry, address _vaultTokenAddr)
        internal
        view
        returns (address _poolAddr, bool _isMeta)
    {
        _poolAddr = _curveRegistry.get_pool_from_lp_token(_vaultTokenAddr);

        require(_poolAddr != address(0), "BorrowerRouter: Incorrect token address.");

        _isMeta = _curveRegistry.is_meta(_poolAddr);
    }

    function _getSelfBalance(address _tokenAddr) internal view returns (uint256) {
        return ERC20(_tokenAddr).balanceOf(address(this));
    }

    function _getOneToken(address _tokenAddr) internal view returns (uint256) {
        return 10**ERC20(_tokenAddr).decimals();
    }

    function _toInt128(uint256 _number) internal pure returns (int128) {
        return int128(int256(_number));
    }
}
