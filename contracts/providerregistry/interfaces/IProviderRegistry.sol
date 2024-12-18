// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IProviderRegistry {
    function register(address addr) external;
    function get(uint256 id) external view returns (address);
    function getByAddr(address addr) external view returns (uint256);
}
