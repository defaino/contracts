// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

interface IPRT {
    struct PRTParams {
        PositionParams supplyParams;
        PositionParams borrowParams;
    }

    struct PositionParams {
        uint256 minAmountInUSD;
        uint256 minTimeAfter;
    }

    function prtInitialize(
        string calldata name_,
        string calldata symbol_,
        PRTParams calldata prtParams_
    ) external;

    function updatePRTParams(PRTParams calldata prtParams_) external;

    function mintPRT() external;

    function burn(uint256 tokenId_) external;

    function getPRTParams() external returns (PRTParams memory);

    function hasValidPRT(address owner_) external view returns (bool);
}
