// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

interface IMinerRegistry {
    function isMiner(address _address) external view returns (bool);
    function addReward(address miner, uint256 amount) external;
}
