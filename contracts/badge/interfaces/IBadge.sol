// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../../common/Structs.sol";

interface IBadge {
    function hasBadge(address addr, string memory badge, string memory path) external view returns (bool);
}
