// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../common/Structs.sol";
import "../market/interfaces/IMarketCore.sol";
import "../common/SafeERC20.sol";
import "./AuxLib.sol";
import "./StructsLib.sol";
import "../market/MarketAuxLib.sol";
import "../common/StrippedInterfaces.sol";
import "./OrderLib.sol";
import "./OrderReleaseLib.sol";
import "./SwapFungibleLib.sol";
import "./SwapNonFungibleLib.sol";

library SwapLib {
    using MarketAuxLib for Structs.Asset;

    /// @dev Swap quote asset for the base asset.
    /// @param state The State object
    /// @param state2 The State2 object
    /// @param sp The swap parameters
    function swapQuoteForBase(StructsLib.State storage state, StructsLib.State2 storage state2, StructsLib.SwapSlot memory sp) public {
        require(state2.marketCore.isSwapPermitted(sp.addrs.marketId, msg.sender));
        Structs.Market memory market = state2.marketCore.getMarket(sp.addrs.marketId);
        require(!market.perms.offerOnly, "OC: OFFER_ONLY");
        checkMarketSwapBadges(state2, sp.addrs.marketId);
        checkProviderSwapBadges(state2, sp.addrs.marketId, sp.lid, sp.addrs.provider);
        if (market.base.isFungible()) SwapFungibleLib.swap(state, state2, sp, market);
        else SwapNonFungibleLib.swap(state, state2, sp, market);
    }

    /// @dev Create order for ERC20/SYNTH, SYNTH/ERC20, SYNTH/SYNTH & SYNTH/NFT
    /// @param state The State object
    /// @param state2 The State2 object
    /// @param sp The swap parameters
    /// @param market The market object
    /// @param liq The liquidity object
    function createOrder(
        StructsLib.State storage state,
        StructsLib.State2 storage state2,
        StructsLib.SwapSlot memory sp,
        Structs.Market memory market,
        Structs.Liquidity storage liq
    ) public {
        OrderLib.createOrder(state, state2, sp, market, liq);
    }

    /// @dev Release ERC20 asset.
    /// @param state The State object
    /// @param state2 The State2 object
    /// @param oid The order ID.
    /// @param byDispute Indicates that the method is called by the dispute manager.
    function releaseOrder(StructsLib.State storage state, StructsLib.State2 storage state2, uint256 oid, bool byDispute) public {
        OrderReleaseLib.releaseOrder(state, state2, oid, byDispute, false);
    }

    /// @notice Release an order using a market manager's signature
    /// @param state The State object
    /// @param state2 The State2 object
    /// @param oid The order ID
    /// @param expireAt The expire time of the signature
    /// @param signature The signature created by the manager
    function releaseOrderByManagerSig(
        StructsLib.State storage state,
        StructsLib.State2 storage state2,
        uint256 oid,
        uint256 expireAt,
        bytes calldata signature
    ) public {
        OrderReleaseLib.releaseOrderByManagerSig(state, state2, oid, expireAt, signature);
    }

    /// @dev Cancel an inactive order. An inactive order is one where:
    /// The order has not been marked as paid, released or disputed
    /// and has reached its cancel time.
    /// @param state State object
    /// @param marketCore The MarketCore contract address
    /// @param id is the unique order ID
    /// @param byDispute Indicates that the method is called by the dispute manager.
    function cancelOrder(StructsLib.State storage state, IMarketCore marketCore, uint256 id, bool byDispute) public {
        OrderLib.cancelOrder(state, marketCore, id, byDispute, false);
    }

    /// @notice Cancel an order using a market manager's signature
    /// @param state The State object
    /// @param state2 The State2 object
    /// @param oid The order ID
    /// @param expireAt The expire time of the signature
    /// @param signature The signature created by the manager
    function cancelOrderByManagerSig(
        StructsLib.State storage state,
        StructsLib.State2 storage state2,
        uint256 oid,
        uint256 expireAt,
        bytes calldata signature
    ) external {
        OrderLib.cancelOrderByManagerSig(state, state2, oid, expireAt, signature);
    }

    /// @dev Mark a swap order as paid.
    /// Order must be have been released or cancelled.
    /// When the base asset is ERC20, the sender must be the taker.
    /// When the base asset is synthetic,the sender must be the provider.
    /// @param state State object
    /// @param marketCore The MarketCore contract address
    /// @param id The order ID.
    function markOrderAsPaid(StructsLib.State storage state, IMarketCore marketCore, uint256 id) public {
        OrderLib.markOrderAsPaid(state, marketCore, id);
    }

    /// @dev Marks an order as `disputed`
    /// @param state State object
    /// @param marketCore The MarketCore contract address
    /// @param id The order ID or index.
    function markAsDisputed(StructsLib.State storage state, IMarketCore marketCore, uint256 id) public {
        OrderLib.markAsDisputed(state, marketCore, id);
    }

    /// @dev Check if sender has the required swap badges set by the market creator
    function checkMarketSwapBadges(StructsLib.State2 storage s2, address marketId) internal view {
        (, string[2][] memory reqSwapBadges) = s2.marketCore.getReqBadges(marketId);
        if (reqSwapBadges.length > 0) {
            uint256 len = reqSwapBadges.length;
            for (uint256 i = 0; i < len; i++) {
                require(s2.badge.hasBadge(msg.sender, reqSwapBadges[i][0], reqSwapBadges[i][1]), "OC: MKT_BADGE_REQ");
            }
        }
    }

    /// @dev Check if sender has the required swap badges set by the liquidity provider
    /// @param s2 A state object
    /// @param marketId The market ID
    /// @param lid The liquidity ID
    /// @param provider The provider address
    function checkProviderSwapBadges(StructsLib.State2 storage s2, address marketId, uint256 lid, address provider) internal view {
        string[2][] memory reqSwapBadges = s2.reqSwapBadges[marketId][provider][lid];
        if (reqSwapBadges.length > 0) {
            uint256 len = reqSwapBadges.length;
            for (uint256 i = 0; i < len; i++) {
                require(s2.badge.hasBadge(msg.sender, reqSwapBadges[i][0], reqSwapBadges[i][1]), "OC: LP_BADGE_REQ");
            }
        }
    }
}
