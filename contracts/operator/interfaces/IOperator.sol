// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.13;

interface IOperator {
    function isOperator(uint256 id) external returns (bool);

    function getOperator(uint256 id) external returns (address);
}
