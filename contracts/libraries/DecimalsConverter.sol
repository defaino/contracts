// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.3;

/**
 * The intention of this library is to be able to easily convert
 * one amount of tokens with N decimal places to another amount with M decimal places
 */
library DecimalsConverter {
    /// @notice Function for converting a number with one decimals to another
    /// @param amount amount to be converted
    /// @param baseDecimals current number decimals
    /// @param destinationDecimals destination number decimals
    /// @return the resulting number after conversion
    function convert(
        uint256 amount,
        uint256 baseDecimals,
        uint256 destinationDecimals
    ) internal pure returns (uint256) {
        if (baseDecimals > destinationDecimals) {
            amount = amount / (10**(baseDecimals - destinationDecimals));
        } else if (baseDecimals < destinationDecimals) {
            amount = amount * (10**(destinationDecimals - baseDecimals));
        }

        return amount;
    }

    /// @notice Function to convert a number to 18 decimals
    /// @param amount amount to be converted
    /// @param baseDecimals current number decimals
    /// @return the resulting number after conversion
    function convertTo18(uint256 amount, uint256 baseDecimals) internal pure returns (uint256) {
        return convert(amount, baseDecimals, 18);
    }

    /// @notice Function to convert a number from 18 decimals
    /// @param amount amount to be converted
    /// @param destinationDecimals destination number decimals
    /// @return the resulting number after conversion
    function convertFrom18(uint256 amount, uint256 destinationDecimals)
        internal
        pure
        returns (uint256)
    {
        return convert(amount, 18, destinationDecimals);
    }
}
