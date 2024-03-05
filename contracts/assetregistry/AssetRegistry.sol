// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../common/Ownable.sol";

struct Info {
    // The asset exchange rate to P2P (e.g 1 ASSET -> P2P)
    uint256 curRate;
    // The basis point fee to charged by protocol on the asset
    uint256 feeBp;
    // The fixed fee rate charged by the protocol (denominated in P2P)
    uint256 feeFixed;
    // Indicates whether the asset is verified
    bool verified;
    // Indicates whether the asset is a stablecoin
    bool stable;
    // Indicates whether fee earned on the asset are sharable
    bool sharable;
}

/// @dev AssetRegistry stores useful information about assets
contract AssetRegistry is Ownable {
    mapping(address => Info) public assets;

    event AssetRegistryUpdated(address addr, uint256 curRate, uint256 feeBp, uint256 feeFixed, bool verified, bool stable, bool sharable);

    function set(
        address addr,
        uint256 curRate,
        uint256 feeBp,
        uint256 feeFixed,
        bool verified,
        bool stable,
        bool sharable
    ) external onlyOwner {
        assets[addr] = Info(curRate, feeBp, feeFixed, verified, stable, sharable);
        emit AssetRegistryUpdated(addr, curRate, feeBp, feeFixed, verified, stable, sharable);
    }

    function setRate(address addr, uint256 rate) external onlyOwner {
        assets[addr].curRate = rate;
        emit AssetRegistryUpdated(
            addr,
            assets[addr].curRate,
            assets[addr].feeBp,
            assets[addr].feeFixed,
            assets[addr].verified,
            assets[addr].stable,
            assets[addr].sharable
        );
    }

    function setFee(address addr, uint256 feeBp, uint256 feeFixed) external onlyOwner {
        assets[addr].feeBp = feeBp;
        assets[addr].feeFixed = feeFixed;
        emit AssetRegistryUpdated(
            addr,
            assets[addr].curRate,
            assets[addr].feeBp,
            assets[addr].feeFixed,
            assets[addr].verified,
            assets[addr].stable,
            assets[addr].sharable
        );
    }

    function setVerified(address addr, bool verified) external onlyOwner {
        assets[addr].verified = verified;
        emit AssetRegistryUpdated(
            addr,
            assets[addr].curRate,
            assets[addr].feeBp,
            assets[addr].feeFixed,
            assets[addr].verified,
            assets[addr].stable,
            assets[addr].sharable
        );
    }

    function setSharable(address addr, bool sharable) external onlyOwner {
        assets[addr].sharable = sharable;
        emit AssetRegistryUpdated(
            addr,
            assets[addr].curRate,
            assets[addr].feeBp,
            assets[addr].feeFixed,
            assets[addr].verified,
            assets[addr].stable,
            assets[addr].sharable
        );
    }

    function setStable(address addr, bool stable) external onlyOwner {
        assets[addr].stable = stable;
        emit AssetRegistryUpdated(
            addr,
            assets[addr].curRate,
            assets[addr].feeBp,
            assets[addr].feeFixed,
            assets[addr].verified,
            assets[addr].stable,
            assets[addr].sharable
        );
    }

    function get(address addr) external view returns (Info memory) {
        return assets[addr];
    }

    function getRate(address addr) external view returns (uint256) {
        return assets[addr].curRate;
    }

    /// @dev Convert value to another currency using the assets currency rate
    function toCur(address addr, uint256 value) external view returns (uint256) {
        return assets[addr].curRate * value;
    }
}
