// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "../../interfaces/Curve/ICurveRegistry.sol";

import "./Pool.sol";

/**
 * @notice Implicit implementation of Registry interface of Curve contracts
 */

contract CurveRegistryMock is ICurveRegistry {
    uint256 public constant MAX_NUMBER_OF_COINS = 8;

    struct PoolInfo {
        uint256 numberOfCoins;
        uint256 numberOfUnderlyingCoins;
        address[MAX_NUMBER_OF_COINS] coins;
        address[MAX_NUMBER_OF_COINS] underlyingCoins;
    }

    mapping(address => address) public override get_pool_from_lp_token;
    mapping(address => PoolInfo) public poolsInfo;

    function addPool(address _poolAddr, address _lpAddr) external {
        get_pool_from_lp_token[_lpAddr] = _poolAddr;

        PoolInfo storage _poolInfo = poolsInfo[_poolAddr];
        CurvePoolMock _pool = CurvePoolMock(_poolAddr);

        uint256 _numberOfCoins = _pool.numberOfCoins();
        uint256 _numberOfUnderlyingCoins = _pool.numberOfUnderlyingCoins();

        _poolInfo.numberOfCoins = _numberOfCoins;
        _poolInfo.numberOfUnderlyingCoins = _numberOfUnderlyingCoins;

        for (uint256 i = 0; i < _numberOfCoins; i++) {
            _poolInfo.coins[i] = _pool.coins(int128(int256(i)));
        }

        for (uint256 i = 0; i < _numberOfUnderlyingCoins; i++) {
            _poolInfo.underlyingCoins[i] = _pool.underlyingCoins(int128(int256(i)));
        }
    }

    function setNumberOfCoins(
        address _poolAddr,
        uint256 _newCoinsNumber,
        bool _isUnderlying
    ) external {
        PoolInfo storage _poolInfo = poolsInfo[_poolAddr];

        if (_isUnderlying) {
            _poolInfo.numberOfUnderlyingCoins = _newCoinsNumber;
        } else {
            _poolInfo.numberOfCoins = _newCoinsNumber;
        }
    }

    function is_meta(address _pool) external view override returns (bool) {
        return CurvePoolMock(_pool).isMeta();
    }

    function get_n_coins(address _poolAddr) external view override returns (uint256[2] memory) {
        return [poolsInfo[_poolAddr].numberOfCoins, poolsInfo[_poolAddr].numberOfUnderlyingCoins];
    }

    function get_coins(address _poolAddr)
        external
        view
        override
        returns (address[MAX_NUMBER_OF_COINS] memory)
    {
        return poolsInfo[_poolAddr].coins;
    }

    function get_underlying_coins(address _poolAddr)
        external
        view
        override
        returns (address[MAX_NUMBER_OF_COINS] memory)
    {
        return poolsInfo[_poolAddr].underlyingCoins;
    }
}
