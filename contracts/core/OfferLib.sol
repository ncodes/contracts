// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../common/Structs.sol";
import "../core/AuxLib.sol";
import "../core/SwapFungibleLib.sol";
import "../core/SwapNonFungibleLib.sol";
import "../core/StructsLib.sol";
import "../market/MarketAuxLib.sol";
import "../token/interfaces/IERC20.sol";
import "../common/StrippedInterfaces.sol";

library OfferLib {
    using MarketAuxLib for Structs.Asset;
    using AuxLib for uint256[];

    event NewOffer(
        address marketId,
        address indexed provider,
        uint256 lid,
        address indexed offerer,
        uint256 offerId,
        uint256 amount,
        uint256 price,
        uint256[] ids,
        uint256 expireDuration
    );
    event OfferUpdated(
        uint256 indexed offerId,
        address indexed offerer,
        uint256 amount,
        uint256 price,
        uint256[] ids,
        uint256 expireDuration
    );
    event OfferAccepted(uint256 indexed offerId, address indexed acceptor, uint256 execDelayDur);
    event OfferUnaccepted(uint256 indexed offerId, address indexed unacceptor);
    event OfferCancelled(uint256 indexed offerId, address indexed canceller);
    event OfferExecuted(uint256 indexed offerId, address indexed executor);

    struct CheckOfferSlot {
        address marketId;
        address provider;
        address recipient;
        uint256 lid;
        uint256 amount;
        uint256 price;
        uint256[] ids;
        uint256 deadline;
        uint256 offerId;
        uint256 operator;
    }

    function checkOffer(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        CheckOfferSlot memory slot
    ) internal view {
        require(AuxLib.hasNonZeroLiquidity(s1, slot.marketId, slot.provider, slot.lid), "OC: ZERO_LIQ");
        require(slot.deadline > block.timestamp, "OC: PAST_DEADLINE");
        Structs.Liquidity storage liq = s1.liquidity[slot.marketId][slot.provider][slot.lid];
        Structs.Market memory mkt = s2.marketCore.getMarket(slot.marketId);
        StructsLib.SwapSlotAddresses memory addrs = StructsLib.SwapSlotAddresses(slot.marketId, slot.provider, slot.recipient);
        StructsLib.SwapSlot memory ss = StructsLib.SwapSlot(
            slot.lid,
            slot.amount,
            slot.price,
            slot.ids,
            slot.offerId,
            slot.operator,
            addrs
        );

        if (mkt.base.isFungible()) AuxLib.checkFungibleSwapParams(ss, mkt, liq);
        else AuxLib.checkNonFungibleSwapParams(ss, mkt, liq);

        // Ensure sender has enough quote token to make offer
        if (mkt.quote.isERC20()) {
            uint256 cost = (slot.amount * slot.price) / 10**IERC20(mkt.quote.addr).decimals();
            require(IERC20(mkt.quote.addr).balanceOf(msg.sender) >= cost, "OC: LOW_BAL");
        }

        // Ensure sender owns offered NFT
        if (mkt.quote.isNFT()) {
            uint256 n = slot.ids.length;
            for (uint256 i = 0; i < n; i++) {
                if (mkt.quote.isERC721()) require(IERC721Strip(mkt.quote.addr).ownerOf(slot.ids[i]) == msg.sender, "OC: NOT_TOK_OWNER");
                else require(IERC1155Strip(mkt.quote.addr).balanceOf(msg.sender, slot.ids[i]) > 0, "OC: NOT_TOK_OWNER");
            }
        }
    }

    /// @dev Create an offer
    function createOffer(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        address marketId,
        address provider,
        address recipient,
        uint256 lid,
        uint256 amount,
        uint256 price,
        uint256[] memory ids,
        uint256 expireDur,
        uint256 operator
    ) public returns (uint256) {
        checkOffer(
            s1,
            s2,
            CheckOfferSlot(
                marketId,
                provider,
                recipient,
                lid,
                amount,
                price,
                ids,
                block.timestamp + expireDur,
                s2.offers.length + 1,
                operator
            )
        );

        s2.offers.push(
            Structs.Offer(
                msg.sender,
                marketId,
                provider,
                recipient,
                lid,
                amount,
                price,
                ids,
                0,
                block.timestamp + expireDur,
                0,
                operator,
                false,
                false,
                false
            )
        );

        emit NewOffer(marketId, provider, lid, msg.sender, s2.offers.length, amount, price, ids, expireDur);

        return s2.offers.length;
    }

    /// @dev Update an offer
    function updateOffer(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        uint256 offerId,
        uint256 amount,
        uint256 price,
        uint256[] memory ids,
        uint256 expireDur
    ) public {
        require(offerId < s2.offers.length, "OC: UNKNOWN_OFFER");
        Structs.Offer storage offer = s2.offers[offerId];
        require(offer.creator == msg.sender, "OC: NOT_CREATOR");
        require(offer.deadline > block.timestamp, "OC: OFFER_EXPIRED");
        require(!offer.cancelled, "OC: OFFER_CANCELLED");
        require(!offer.executed, "OC: OFFER_EXECUTED");
        uint256 deadline = (expireDur == 0) ? offer.deadline : block.timestamp + expireDur;
        checkOffer(
            s1,
            s2,
            CheckOfferSlot(
                offer.marketId,
                offer.provider,
                offer.recipient,
                offer.lid,
                amount,
                price,
                ids,
                deadline,
                offerId + 1,
                offer.operator
            )
        );
        offer.amount = amount;
        offer.price = price;
        offer.ids = ids;
        offer.deadline = deadline;
        offer.accepted = false;
        emit OfferUpdated(offerId, msg.sender, amount, price, ids, expireDur);
    }

    /// @dev Accept an offer
    function acceptOffer(
        StructsLib.State2 storage s2,
        uint256 offerId,
        uint256 delay
    ) public {
        require(offerId < s2.offers.length, "OC: UNKNOWN_OFFER");
        Structs.Offer storage offer = s2.offers[offerId];
        require(offer.provider == msg.sender, "OC: NOT_PROVIDER");
        require(offer.deadline > block.timestamp, "OC: OFFER_EXPIRED");
        require(!offer.cancelled, "OC: OFFER_CANCELLED");
        require(!offer.executed, "OC: OFFER_EXECUTED");
        require(!offer.accepted, "OC: ALREADY_ACCEPTED");
        offer.accepted = true;
        offer.execAt = block.timestamp + delay;
        emit OfferAccepted(offerId, msg.sender, delay);
    }

    /// @dev Unaccept an offer
    function unacceptOffer(StructsLib.State2 storage s2, uint256 offerId) public {
        require(offerId < s2.offers.length, "OC: UNKNOWN_OFFER");
        Structs.Offer storage offer = s2.offers[offerId];
        require(offer.provider == msg.sender, "OC: NOT_PROVIDER");
        require(offer.accepted, "OC: NOT_ACCEPTED");
        require(!offer.executed, "OC: OFFER_EXECUTED");
        offer.accepted = false;
        offer.execAt = 0;
        emit OfferUnaccepted(offerId, msg.sender);
    }

    /// @dev Cancel an offer
    function cancelOffer(StructsLib.State2 storage s2, uint256 offerId) public {
        require(offerId < s2.offers.length, "OC: UNKNOWN_OFFER");
        Structs.Offer storage offer = s2.offers[offerId];
        require(offer.creator == msg.sender, "OC: NOT_CREATOR");
        require(offer.deadline > block.timestamp, "OC: OFFER_EXPIRED");
        require(!offer.executed, "OC: OFFER_EXECUTED");
        require(!offer.cancelled, "OC: ALREADY_CANCELLED");
        offer.cancelled = true;
        emit OfferCancelled(offerId, msg.sender);
    }

    /// @dev Execute an offer
    function executeOffer(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        uint256 offerId
    ) public returns (Structs.Offer storage) {
        require(offerId < s2.offers.length, "OC: UNKNOWN_OFFER");
        Structs.Offer storage offer = s2.offers[offerId];
        require(offer.creator == msg.sender, "OC: NOT_CREATOR");
        require(offer.accepted, "OC: NOT_ACCEPTED");
        require(!offer.executed, "OC: ALREADY_EXECUTED");
        require(offer.execAt <= block.timestamp, "OC: DELAY_ACTIVE");
        offer.executed = true;

        Structs.Market memory mkt = s2.marketCore.getMarket(offer.marketId);
        StructsLib.SwapSlotAddresses memory addrs = StructsLib.SwapSlotAddresses(offer.marketId, offer.provider, offer.recipient);
        StructsLib.SwapSlot memory sp = StructsLib.SwapSlot(
            offer.lid,
            offer.amount,
            offer.price,
            offer.ids,
            offerId + 1,
            offer.operator,
            addrs
        );

        emit OfferExecuted(offerId, msg.sender);

        if (mkt.base.isFungible()) SwapFungibleLib.swap(s1, s2, sp, mkt);
        else SwapNonFungibleLib.swap(s1, s2, sp, mkt);

        return offer;
    }
}
