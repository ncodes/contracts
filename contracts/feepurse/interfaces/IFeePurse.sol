// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

interface IFeePurse {
    function balanceOf(address owner) external view returns (uint256);

    function lock(address owner, uint256 amt) external returns (uint256);

    function unlock(address owner, uint256 id) external;

    function transferFrom(address from, address to, uint256 amt) external;

    function getLocked(uint256 id) external view returns (uint256);

    function withdraw(uint256 amt, address to) external;

    function withdrawFrom(uint256 amt, address from, address to) external;

    function getFeeToken() external view returns (address);
}
