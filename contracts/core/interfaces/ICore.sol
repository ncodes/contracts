// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../../common/Structs.sol";

interface ICore {
    function canCreateDispute(uint256 id, address addr) external view returns (bool);

    function markAsDisputed(uint256 id) external;

    function getOrder(uint256 id) external view returns (Structs.Order memory);

    function releaseOrderByDispute(uint256 id) external;

    function cancelOrderByDispute(uint256 id) external;

    function isVerified(address addr) external view returns (bool);

    function updateOpenDisputesCount(address marketId, address provider, uint256 lid, bool incr) external;
}
