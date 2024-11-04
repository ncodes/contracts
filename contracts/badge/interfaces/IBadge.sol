// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.13;

import "../../common/Structs.sol";

interface IBadge {
    function hasBadge(address addr, string memory badge, string memory path) external view returns (bool);
}
