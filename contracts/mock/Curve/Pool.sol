// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../../interfaces/Curve/IPool.sol";

import "../../common/Globals.sol";
import "../../libraries/DecimalsConverter.sol";

import "../MockERC20.sol";

/**
 * @notice Implicit implementation of pool interface of Curve contracts
 */

contract CurvePoolMock is IMetaPool {
    using DecimalsConverter for uint256;

    address public lpToken;
    address public override base_pool;
    bool public isMeta;

    uint256 public numberOfCoins;
    uint256 public numberOfUnderlyingCoins;

    uint256 public exchangeRate = DECIMAL;

    mapping(int128 => address) public override coins;
    mapping(int128 => address) public underlyingCoins;

    constructor(
        bool _isMeta,
        address _lpTokenAddr,
        address[] memory _coins,
        address[] memory _underlyingCoins
    ) {
        isMeta = _isMeta;
        lpToken = _lpTokenAddr;

        uint256 _numberOfCoins = _coins.length;
        uint256 _numberOfUnderlyingCoins = _underlyingCoins.length;

        numberOfCoins = _numberOfCoins;
        numberOfUnderlyingCoins = _numberOfUnderlyingCoins;

        setCoins(0, _coins);
        setUnderlyingCoins(0, _underlyingCoins);
    }

    function setIsMeta(bool _newValue) external {
        isMeta = _newValue;
    }

    function setBasePool(address _newBasePool) external {
        base_pool = _newBasePool;
    }

    function setCoins(uint256 _startIndex, address[] memory _tokens) public {
        for (uint256 i = 0; i < _tokens.length; i++) {
            coins[_toInt128(_startIndex + i)] = _tokens[i];
        }
    }

    function setUnderlyingCoins(uint256 _startIndex, address[] memory _tokens) public {
        for (uint256 i = 0; i < _tokens.length; i++) {
            underlyingCoins[_toInt128(_startIndex + i)] = _tokens[i];
        }
    }

    function setExchangeRate(uint256 _newRate) external {
        exchangeRate = _newRate;
    }

    function setNumberOfCoins(uint256 _newNumberOfCoins) external {
        numberOfCoins = _newNumberOfCoins;
    }

    function setNumberOfUnderlyingCoins(uint256 _newNumberOfUnderlyingCoins) external {
        numberOfUnderlyingCoins = _newNumberOfUnderlyingCoins;
    }

    function add_liquidity(uint256[2] calldata _amounts, uint256 min_mint_amount)
        external
        override
        returns (uint256)
    {
        require(numberOfCoins == 2, "CurvePoolMock: Incorrect amounts length.");

        uint256[] memory _amountsArr = new uint256[](_amounts.length);

        for (uint256 i = 0; i < _amounts.length; i++) {
            _amountsArr[i] = _amounts[i];
        }

        return _addLiquidity(_amountsArr, min_mint_amount);
    }

    function add_liquidity(uint256[3] calldata _amounts, uint256 min_mint_amount)
        external
        override
        returns (uint256)
    {
        require(numberOfCoins == 3, "CurvePoolMock: Incorrect amounts length.");

        uint256[] memory _amountsArr = new uint256[](_amounts.length);

        for (uint256 i = 0; i < _amounts.length; i++) {
            _amountsArr[i] = _amounts[i];
        }

        return _addLiquidity(_amountsArr, min_mint_amount);
    }

    function remove_liquidity_one_coin(
        uint256 _token_mount,
        int128 i,
        uint256 _min_amount
    ) external override returns (uint256) {
        uint256 _currentBalance = ERC20(lpToken).balanceOf(msg.sender);

        require(
            _currentBalance >= _token_mount,
            "CurvePoolMock: Not enough LP tokens on account."
        );
        require(i < _toInt128(numberOfCoins), "CurvePoolMock: Token index out of bounds.");

        ERC20 _token = ERC20(coins[i]);

        uint256 _amountToTransferInUnderlying = _convertFromLP(_token_mount).convertFrom18(
            _token.decimals()
        );

        require(
            _amountToTransferInUnderlying >= _min_amount,
            "CurvePoolMock: Received amount less than the minimal amount."
        );

        _token.transfer(msg.sender, _amountToTransferInUnderlying);

        MockERC20(lpToken).burn(msg.sender, _token_mount);

        return _amountToTransferInUnderlying;
    }

    function calc_token_amount(uint256[2] calldata _amounts, bool _is_deposit)
        external
        view
        override
        returns (uint256)
    {
        _is_deposit;

        require(numberOfCoins == 2, "CurvePoolMock: Incorrect amounts length.");

        uint256[] memory _amountsArr = new uint256[](_amounts.length);

        for (uint256 i = 0; i < _amounts.length; i++) {
            _amountsArr[i] = _amounts[i];
        }

        return _calcTokenAmount(_amountsArr);
    }

    function calc_token_amount(uint256[3] calldata _amounts, bool _is_deposit)
        external
        view
        override
        returns (uint256)
    {
        _is_deposit;

        require(numberOfCoins == 3, "CurvePoolMock: Incorrect amounts length.");

        uint256[] memory _amountsArr = new uint256[](_amounts.length);

        for (uint256 i = 0; i < _amounts.length; i++) {
            _amountsArr[i] = _amounts[i];
        }

        return _calcTokenAmount(_amountsArr);
    }

    function calc_withdraw_one_coin(uint256 _burn_amount, int128 i)
        external
        view
        override
        returns (uint256)
    {
        require(i < _toInt128(numberOfCoins), "CurvePoolMock: Token index out of bounds.");

        return _convertFromLP(_burn_amount).convertFrom18(ERC20(coins[i]).decimals());
    }

    function _calcTokenAmount(uint256[] memory _amounts) internal view returns (uint256) {
        uint256 _totalAmount;

        for (uint256 i = 0; i < _amounts.length; i++) {
            if (_amounts[i] > 0) {
                _totalAmount += _convertTo18(coins[_toInt128(i)], _amounts[i]);
            }
        }

        return _convertToLP(_totalAmount);
    }

    function _addLiquidity(uint256[] memory _amounts, uint256 _minMintAmount)
        internal
        returns (uint256)
    {
        uint256 _totalAmount;

        for (uint256 i = 0; i < _amounts.length; i++) {
            if (_amounts[i] > 0) {
                address _tokenAddr = coins[_toInt128(i)];

                _totalAmount += _convertTo18(_tokenAddr, _amounts[i]);

                ERC20(_tokenAddr).transferFrom(msg.sender, address(this), _amounts[i]);
            }
        }

        uint256 _amountToMint = _convertToLP(_totalAmount);
        address _lpTokenAddr = lpToken;

        require(
            _amountToMint >= _convertTo18(_lpTokenAddr, _minMintAmount),
            "CurvePoolMock: Amount to mint less than the minimal amount to mint."
        );

        uint256 _amountInLPToMint = _amountToMint.convertFrom18(ERC20(_lpTokenAddr).decimals());

        MockERC20(_lpTokenAddr).mintArbitrary(msg.sender, _amountInLPToMint);

        return _amountInLPToMint;
    }

    function _convertToLP(uint256 _amountToConvert) internal view returns (uint256) {
        return (_amountToConvert * DECIMAL) / exchangeRate;
    }

    function _convertFromLP(uint256 _amountToConvert) internal view returns (uint256) {
        return (_amountToConvert * exchangeRate) / DECIMAL;
    }

    function _convertTo18(address _tokenAddr, uint256 _amountToConvert)
        internal
        view
        returns (uint256)
    {
        return _amountToConvert.convertTo18(ERC20(_tokenAddr).decimals());
    }

    function _toInt128(uint256 _number) internal pure returns (int128) {
        return int128(int256(_number));
    }
}
