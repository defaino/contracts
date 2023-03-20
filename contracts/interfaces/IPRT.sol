// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

/**
 * This is a Platform Reputation Token (PRT) contract. The token grants special conditions for its owner: wider range of collateral assets, higher collateralization ratios.
 * In order to mint a token user must meet the requirements on minimum supply and borrow amount together with the minimum time period that must pass after the actions mentioned previously.
 * The aforementioned requirements are stored in a contract field.
 * It is possible to mint and burn a PRT through this contract
 */
interface IPRT {
    /// @notice The structure that defines the following requirements: the minimum user's deposit/borrow amount in USD and the minimum time that should pass before the user with the requirements fullfilled may mint a Platform Reputation Token
    /// @param minAmountInUSD the minimum USD value of user deposit/borrow eligible for minting a PRT
    /// @param minTimeAfter minimum time in seconds that should pass after aforementioned action for the user to be eligible to mint a PRT
    struct PositionParams {
        uint256 minAmountInUSD;
        uint256 minTimeAfter;
    }

    /// @notice The structure that defines the eligiblility requirements for the user's deposit/borrow
    /// @param supplyParams element type PositionParams structure
    /// @param borrowParams element type PositionParams structure
    struct PRTParams {
        PositionParams supplyParams;
        PositionParams borrowParams;
    }

    /// @notice A system function that is needed to update the requirements for PRT
    /// @dev Only the PRT_PARAM_UPDATER can call this function
    /// @param prtParams_ element type PRTParams structure with the new requirements
    function updatePRTParams(PRTParams calldata prtParams_) external;

    /// @notice Function for minting the PRT by the user
    function mintPRT() external;

    /// @notice Function for burning the PRT by the user
    /// @param tokenId_ an ID of the token that should be burned
    function burn(uint256 tokenId_) external;

    /// @notice Function to get the requirements for PRT minting
    /// @return a PRTParams structure
    function getPRTParams() external returns (PRTParams memory);

    /// @notice Function to check whether a user has a valid PRT
    /// @dev If user has already minted a PRT, but then has been liquidated, the function returns false
    /// @return whether the user has a PRT that is still valid
    function hasValidPRT(address owner_) external view returns (bool);
}
