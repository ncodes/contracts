// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IRandomness {
    /// @dev Get a random number.
    function random() external view returns (uint256);

    /// @dev Get random number between 0 and n (n is non-inclusive).
    function randomN(uint256 n) external view returns (uint256);
}
