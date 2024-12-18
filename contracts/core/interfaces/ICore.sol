// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../../common/Structs.sol";
import "../../core/StructsLib.sol";

interface ICore {
    function canCreateDispute(uint256 id, address addr) external view returns (bool);

    function markAsDisputed(uint256 id) external;

    function getOrder(uint256 id) external view returns (Structs.Order memory);

    function releaseOrderByDispute(uint256 id) external;

    function cancelOrderByDispute(uint256 id) external;

    function updateOpenDisputesCount(address marketId, address provider, uint256 lid, bool incr) external;

    function getMarket(address id) external view returns (Structs.Market memory);

    function swapQuoteForBase(StructsLib.SwapQuoteForBaseParams memory params) external payable;
}
