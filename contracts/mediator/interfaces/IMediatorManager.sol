// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../../common/Structs.sol";

interface IMediatorManager {
    function getTicket(address owner, uint256 id) external view returns (Structs.Ticket memory);

    function isApprovedMarket(uint256 poolId, address marketAddr) external view returns (bool);

    function poolExists(uint256 poolId) external view returns (bool);

    function purchaseTicket(uint256 poolId) external;

    function cancelTicket(uint256 id) external;

    function drainTicket(uint256 id) external;

    function join(uint256 ticketId) external;

    function draft(address marketId, uint256 orderId, uint256 disputeId) external returns (Structs.Ticket memory);

    function undraft(address ticketOwner, uint256 ticketId, bool voted, bool winSide) external returns (uint256);

    function getTicketPool(uint256 poolId) external returns (Structs.TicketPool memory);

    function updateTicketPool(
        uint256 poolId,
        uint256 reqBond,
        uint256 draftReward,
        uint256 winReward,
        uint256 noVoteSlashBP,
        uint256 loseVoteSlashBP,
        uint256 numDraftees,
        uint256 evidenceDur,
        uint256 predictDur
    ) external;
}
