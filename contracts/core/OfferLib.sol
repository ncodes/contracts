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

    struct CheckOfferAddresses {
        address marketId;
        address provider;
        address recipient;
    }

    struct CheckOfferIntSlots {
        uint256 lid;
        uint256 amount;
        uint256 price;
        uint256 deadline;
        uint256 offerId;
        uint256 operator;
    }

    struct CheckOfferSlot {
        CheckOfferAddresses addrs;
        uint256[] ids;
        CheckOfferIntSlots ints;
    }

    /// @dev Check offer parameters
    /// @param s1 Storage struct.
    /// @param s2 Storage struct 2.
    /// @param slot The parameters needed to check the offer.
    function checkOffer(StructsLib.State storage s1, StructsLib.State2 storage s2, CheckOfferSlot memory slot) public view {
        require(AuxLib.hasNonZeroLiquidity(s1, slot.addrs.marketId, slot.addrs.provider, slot.ints.lid), "OC: ZERO_LIQ");
        require(slot.ints.deadline > block.timestamp, "OC: PAST_DEADLINE");
        Structs.Liquidity storage liq = s1.liquidity[slot.addrs.marketId][slot.addrs.provider][slot.ints.lid];
        Structs.Market memory mkt = s2.marketCore.getMarket(slot.addrs.marketId);
        StructsLib.SwapSlotAddresses memory addrs = StructsLib.SwapSlotAddresses(
            slot.addrs.marketId,
            slot.addrs.provider,
            slot.addrs.recipient
        );
        StructsLib.SwapSlot memory ss = StructsLib.SwapSlot(
            slot.ints.lid,
            slot.ints.amount,
            slot.ints.price,
            slot.ids,
            slot.ints.offerId,
            slot.ints.operator,
            addrs
        );

        if (mkt.base.isFungible()) AuxLib.checkFungibleSwapParams(ss, mkt, liq);
        else AuxLib.checkNonFungibleSwapParams(ss, mkt, liq);

        // Ensure sender has enough quote token to make offer
        if (mkt.quote.isERC20()) {
            uint256 cost = (slot.ints.amount * slot.ints.price) / 10 ** IERC20(mkt.quote.addr).decimals();
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

    struct CreateOfferAddressParams {
        address marketId;
        address provider;
        address recipient;
    }

    struct CreateOfferIntParams {
        uint256 lid;
        uint256 amount;
        uint256 price;
        uint256 expireDur;
        uint256 operator;
    }

    /// @dev Create an offer
    /// @param s1 Storage struct.
    /// @param s2 Storage struct 2.
    function createOffer(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        CreateOfferAddressParams memory offerAddrs,
        CreateOfferIntParams memory offerInts,
        uint256[] memory ids
    ) public returns (uint256) {
        CheckOfferAddresses memory addrs = CheckOfferAddresses(offerAddrs.marketId, offerAddrs.provider, offerAddrs.recipient);
        CheckOfferIntSlots memory ints = CheckOfferIntSlots(
            offerInts.lid,
            offerInts.amount,
            offerInts.price,
            block.timestamp + offerInts.expireDur,
            s2.offers.length + 1,
            offerInts.operator
        );
        CheckOfferSlot memory slot = CheckOfferSlot(addrs, ids, ints);
        checkOffer(s1, s2, slot);

        s2.offers.push(
            Structs.Offer(
                msg.sender,
                offerAddrs.marketId,
                offerAddrs.provider,
                offerAddrs.recipient,
                offerInts.lid,
                offerInts.amount,
                offerInts.price,
                ids,
                0,
                block.timestamp + offerInts.expireDur,
                0,
                offerInts.operator,
                false,
                false,
                false
            )
        );

        emit NewOffer(
            offerAddrs.marketId,
            offerAddrs.provider,
            offerInts.lid,
            msg.sender,
            s2.offers.length,
            offerInts.amount,
            offerInts.price,
            ids,
            offerInts.expireDur
        );

        return s2.offers.length;
    }

    /// @dev Update an offer
    /// @param s1 Storage struct.
    /// @param s2 Storage struct 2.
    /// @param offerId The offer ID
    /// @param amount The amount of liquidity to offer
    /// @param price The price of the liquidity
    /// @param ids The IDs of the NFTs to offer if quote is NFT
    /// @param expireDur The duration of the offer
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
                CheckOfferAddresses(offer.marketId, offer.provider, offer.recipient),
                ids,
                CheckOfferIntSlots(offer.lid, amount, price, deadline, offerId + 1, offer.operator)
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
    /// @param s2 Storage struct 2.
    /// @param offerId The offer ID
    /// @param delay The delay before the offer can be executed
    function acceptOffer(StructsLib.State2 storage s2, uint256 offerId, uint256 delay) public {
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
    /// @param s2 Storage struct 2.
    /// @param offerId The offer ID
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
    /// @param s2 Storage struct 2.
    /// @param offerId The offer ID
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
    /// @param s1 Storage struct.
    /// @param s2 Storage struct 2.
    /// @param offerId The offer ID
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
