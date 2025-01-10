// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../common/Writable.sol";

/// @dev AssetRegistry stores useful information about assets
contract ProviderRegistry is Writable {
    uint256 public nextId = 1;
    mapping(uint256 => address) public providers;
    mapping(address => uint256) public providerIdx;

    event ProviderRegistered(address indexed provider, uint256 idx);

    /// @dev Register an address as a provider
    /// @param addr The address to be added.
    function register(address addr) external onlyWriter {
        if (providerIdx[addr] > 0) return;
        providers[nextId] = addr;
        providerIdx[addr] = nextId;
        nextId++;
        emit ProviderRegistered(addr, nextId - 1);
    }

    /// @dev Get a provider by ID
    /// @param id The ID of the provider
    function get(uint256 id) external view returns (address) {
        return providers[id];
    }

    /// @dev Get a provider by address
    /// @param addr The address of the provider
    function getByAddr(address addr) external view returns (uint256) {
        return providerIdx[addr];
    }
}
