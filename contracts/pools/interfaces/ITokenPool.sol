// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.13;

interface ITokenPool {
    function stake(uint256 amount) external;

    function withdraw(uint256 _amount) external;

    function balanceOf(address account) external view returns (uint256);

    function getFeePool() external view returns (address);

    function withdrawReward(uint256 _amount) external;

    function earned(address account) external view returns (uint256);
}
