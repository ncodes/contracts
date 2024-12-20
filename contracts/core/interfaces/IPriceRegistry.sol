// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IPriceRegistry {
    function getBasePrice(address, address, int256) external view returns (uint256);
}
