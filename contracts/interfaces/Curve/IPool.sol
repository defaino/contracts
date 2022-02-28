// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

interface IBasePool {
    function coins(int128 arg0) external view returns (address);

    function add_liquidity(uint256[2] calldata _amounts, uint256 min_mint_amount)
        external
        returns (uint256);

    function add_liquidity(uint256[3] calldata _amounts, uint256 min_mint_amount)
        external
        returns (uint256);

    function remove_liquidity_one_coin(
        uint256 _token_mount,
        int128 i,
        uint256 _min_amount
    ) external returns (uint256);

    function calc_token_amount(uint256[2] calldata _amounts, bool _is_deposit)
        external
        view
        returns (uint256);

    function calc_token_amount(uint256[3] calldata _amounts, bool _is_deposit)
        external
        view
        returns (uint256);

    function calc_withdraw_one_coin(uint256 _burn_amount, int128 i)
        external
        view
        returns (uint256);
}

interface IMetaPool is IBasePool {
    function base_pool() external view returns (address);
}
