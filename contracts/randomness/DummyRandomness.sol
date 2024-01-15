// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

/// @dev The contract produces a random number
contract DummyRandomness {
    uint256 public randomNumber;

    /// @dev Set a fake random number.
    /// @param _randomNumber The random number to set.
    function setRandomNumber(uint256 _randomNumber) public {
        randomNumber = _randomNumber;
    }

    /// @dev Get a random number.
    function random() external view returns (uint256) {
        return randomNumber;
    }

    /// @dev Get random number between 0 and n (n is non-inclusive).
    /// @param n The upper bound of the random number.
    function randomN(uint256 n) external view returns (uint256) {
        return this.random() % n;
    }
}
