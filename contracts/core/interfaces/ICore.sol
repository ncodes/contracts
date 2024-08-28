// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../../common/Structs.sol";

interface ICore {
    function canCreateDispute(uint256 id, address addr) external view returns (bool);

    function markAsDisputed(uint256 id) external;

    function getOrder(uint256 id) external view returns (Structs.Order memory);

    function releaseOrderByDispute(uint256 id) external;

    function cancelOrderByDispute(uint256 id) external;

    function updateOpenDisputesCount(address marketId, address provider, uint256 lid, bool incr) external;

    function getMarket(address id) external view returns (Structs.Market memory);

    function swapQuoteForBase(
        address marketId,
        address provider,
        address recipient,
        uint256 lid,
        uint256 amount,
        uint256 maxPrice,
        uint256[] memory ids,
        uint256 txDeadline,
        uint256 operator
    ) external payable;
}
