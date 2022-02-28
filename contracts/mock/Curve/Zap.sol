// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../../interfaces/Curve/IZap.sol";
import "../../interfaces/Curve/ICurveRegistry.sol";

import "./Pool.sol";

/**
 * @notice Implicit implementation of ZAP interface of Curve contracts
 */

contract CurveZapMock is ICurveZap {
    uint256 public constant N_COINS = 2;
    uint256 public constant MAX_COIN = N_COINS - 1;
    uint256 public constant BASE_N_COINS = 3;
    uint256 public constant N_ALL_COINS = N_COINS + BASE_N_COINS - 1;

    address public basePoolAddr;
    address public baseLPToken;

    constructor(address _baseAddr, address _baseLPToken) {
        basePoolAddr = _baseAddr;
        baseLPToken = _baseLPToken;

        ERC20(_baseLPToken).approve(_baseAddr, type(uint256).max);
    }

    function setBaseAddr(address _newBaseAddr, address _newBaseLPToken) external {
        basePoolAddr = _newBaseAddr;
        baseLPToken = _newBaseLPToken;

        ERC20(_newBaseLPToken).approve(_newBaseAddr, type(uint256).max);
    }

    function add_liquidity(
        address _poolAddr,
        uint256[N_ALL_COINS] calldata _amounts,
        uint256 _min_mint_amount
    ) external override returns (uint256) {
        CurvePoolMock _pool = CurvePoolMock(_poolAddr);
        CurvePoolMock _3pool = CurvePoolMock(basePoolAddr);

        uint256[BASE_N_COINS] memory _3poolArray = [_amounts[1], _amounts[2], _amounts[3]];

        for (uint256 i = 1; i < _amounts.length; i++) {
            if (_amounts[i] > 0) {
                address _token = _3pool.coins(_toInt128(i - 1));
                uint256 _amount = _amounts[i];
                IERC20(_token).transferFrom(msg.sender, address(this), _amount);
                IERC20(_token).approve(address(_3pool), _amount);
            }
        }

        uint256 _3poolTokens = _3pool.add_liquidity(_3poolArray, 0);

        if (_amounts[0] > 0) {
            IERC20(_pool.coins(0)).transferFrom(msg.sender, address(this), _amounts[0]);
        }

        uint256[N_COINS] memory _array = [_amounts[0], _3poolTokens];

        IERC20(_pool.coins(0)).approve(address(_pool), _amounts[0]);
        IERC20(_pool.coins(1)).approve(address(_pool), _3poolTokens);

        uint256 _receivedLPAmount = _pool.add_liquidity(_array, _min_mint_amount);
        IERC20(_pool.lpToken()).transfer(msg.sender, _receivedLPAmount);

        return _receivedLPAmount;
    }

    function remove_liquidity_one_coin(
        address _poolAddr,
        uint256 _burn_amount,
        int128 i,
        uint256 _min_amount
    ) external override returns (uint256) {
        CurvePoolMock _pool = CurvePoolMock(_poolAddr);
        CurvePoolMock _3pool = CurvePoolMock(basePoolAddr);

        ERC20 _lpToken = ERC20(_pool.lpToken());

        _lpToken.transferFrom(msg.sender, address(this), _burn_amount);

        if (_lpToken.allowance(address(this), _poolAddr) == 0) {
            _lpToken.approve(_poolAddr, type(uint256).max);
        }

        uint256 _receivedAmount;

        if (i == 0) {
            _receivedAmount = _pool.remove_liquidity_one_coin(_burn_amount, i, _min_amount);
            ERC20(_pool.coins(i)).transfer(msg.sender, _receivedAmount);
        } else {
            _receivedAmount = _pool.remove_liquidity_one_coin(
                _burn_amount,
                _toInt128(MAX_COIN),
                0
            );
            _3pool.remove_liquidity_one_coin(
                _receivedAmount,
                i - _toInt128(MAX_COIN),
                _min_amount
            );

            ERC20 _coin = ERC20(_3pool.coins(i - _toInt128(MAX_COIN)));
            _receivedAmount = _coin.balanceOf(address(this));
            _coin.transfer(msg.sender, _receivedAmount);
        }

        return _receivedAmount;
    }

    function calc_withdraw_one_coin(
        address _poolAddr,
        uint256 _token_amount,
        int128 i
    ) external view override returns (uint256) {
        CurvePoolMock _pool = CurvePoolMock(_poolAddr);

        int128 _maxCoin = _toInt128(MAX_COIN);

        if (i < _maxCoin) {
            return _pool.calc_withdraw_one_coin(_token_amount, i);
        } else {
            uint256 _baseTokensAmount = _pool.calc_withdraw_one_coin(_token_amount, _maxCoin);
            return
                CurvePoolMock(basePoolAddr).calc_withdraw_one_coin(
                    _baseTokensAmount,
                    i - _maxCoin
                );
        }
    }

    function calc_token_amount(
        address _poolAddr,
        uint256[N_ALL_COINS] calldata _amounts,
        bool _is_deposit
    ) external view override returns (uint256) {
        CurvePoolMock _pool = CurvePoolMock(_poolAddr);
        CurvePoolMock _3pool = CurvePoolMock(basePoolAddr);

        uint256[N_COINS] memory _metaAmounts;
        uint256[BASE_N_COINS] memory _baseAmounts;

        _metaAmounts[0] = _amounts[0];
        for (uint256 i = 0; i < BASE_N_COINS; i++) {
            _baseAmounts[i] = _amounts[i + MAX_COIN];
        }

        _metaAmounts[MAX_COIN] = _3pool.calc_token_amount(_baseAmounts, _is_deposit);

        return _pool.calc_token_amount(_metaAmounts, _is_deposit);
    }

    function _toInt128(uint256 _number) internal pure returns (int128) {
        return int128(int256(_number));
    }
}
