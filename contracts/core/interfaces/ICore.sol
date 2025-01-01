// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../../common/Structs.sol";
import "../../core/StructsLib.sol";

interface ICore {
    function canCreateDispute(uint256 id, address addr) external view returns (bool);

    function markAsDisputed(uint256 id) external;

    function getOrder(uint256 id) external view returns (Structs.Order memory);

    function getLiquidity(address marketId, address provider, uint256 lid) external view returns (Structs.Liquidity memory);

    function hasLiquidity(address marketId, address provider, uint256 lid) external view returns (bool);

    function releaseOrderByDispute(uint256 id) external;

    function cancelOrderByDispute(uint256 id) external;

    function updateOpenDisputesCount(address marketId, address provider, uint256 lid, bool incr) external;

    function getMarket(address id) external view returns (Structs.Market memory);

    function swapQuoteForBase(StructsLib.SwapQuoteForBaseParams memory params) external payable;

    function updateFungibleLiquidity(StructsLib.UpdateFungibleLiquidityParams memory params) external payable returns (uint256);

    function updateNonFungibleLiquidity(StructsLib.UpdateNonFungibleLiquidityParams memory params) external returns (uint256);
}
