// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

interface ICurveRegistry {
    function get_n_coins(address _poolAddr) external view returns (uint256[2] calldata);

    function get_coins(address _poolAddr) external view returns (address[8] calldata);

    function get_underlying_coins(address _poolAddr) external view returns (address[8] calldata);

    function get_pool_from_lp_token(address _lpTokenAddr) external view returns (address);

    function is_meta(address) external view returns (bool);
}
