// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.13;

enum MinerOperation {
    Draft,
    Undraft,
    Execute,
    Cancel
}

interface IMinerRegistry {
    function isMiner(address _address) external view returns (bool);
    function addReward(MinerOperation op, address miner) external;
}
