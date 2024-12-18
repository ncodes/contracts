// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../common/Structs.sol";
import "../market/interfaces/IMarketCore.sol";
import "../common/SafeERC20.sol";
import "../common/SigLib.sol";
import "./AuxLib.sol";
import "./StructsLib.sol";
import "../market/MarketAuxLib.sol";
import "./LiquidityLib.sol";
import "hardhat/console.sol";
import {IERC721Strip, IERC1155Strip} from "../common/StrippedInterfaces.sol";

library OrderLib {
    using MarketAuxLib for Structs.Asset;
    using MarketAuxLib for Structs.Market;
    using AuxLib for address;

    event SwapOrder(
        address indexed mid,
        address indexed provider,
        address indexed swapper,
        address recipient,
        uint256[7] numTypeInfo,
        uint256[] idsFromProvider,
        uint256[] idsFromTaker
    );
    event OrderCancelled(uint256 indexed orderID, address indexed canceller, bool indexed byDispute);
    event SwapOrderPaid(uint256 indexed orderID, address payer, uint256 disputeDelayDur);

    /// @notice Create order for ERC20/SYNTH, SYNTH/ERC20, SYNTH/SYNTH, SYNTH/NFT, NFT/SYNTH, NATIVE/SYNTH, SYNTH/NATIVE
    /// @param s1 The State object
    /// @param s2 The State2 object
    /// @param sp The swap parameters
    /// @param mkt The market object
    /// @param liq The liquidity object
    function createOrder(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        StructsLib.SwapSlot memory sp,
        Structs.Market memory mkt,
        Structs.Liquidity storage liq
    ) public {
        // Ensure number of open orders and disputes are below limit
        require(liq.openOrders < s1.ints.maxOpenOrders, "OC: MAX_OPEN_ORDERS");
        require(liq.openDisputes < s1.ints.maxOpenDisputes, "OC: MAX_OPEN_DISPUTES");

        Structs.Order memory o;
        o.offerId = sp.offerId;
        o.amount = sp.amount;
        o.price = (sp.offerId > 0) ? sp.maxPrice : liq.price;

        // When quote is NFT, transfer NFTs into contract
        if (mkt.quote.isNFT()) {
            // Find the IDs that match the wants request.
            // If swap was initiated via offer, use offer supplied ids.
            o.takerIds = (sp.offerId > 0) ? sp.ids : LiquidityLib.findMatchInWantIds(sp.ids, s2.intIdx, liq.wantOrIds, liq.wantAndIds);
            require(o.takerIds.length > 0, "OC: NO_ID_MATCH");
            for (uint256 i = 0; i < o.takerIds.length; i++) {
                if (o.takerIds[i] == 0) continue;
                if (mkt.quote.isERC721()) IERC721Strip(mkt.quote.addr).transferFrom(msg.sender, address(this), o.takerIds[i]);
                else IERC1155Strip(mkt.quote.addr).safeTransferFrom(msg.sender, address(this), o.takerIds[i], 1, "");
            }
        }

        // When quote is ERC20, transfer quote into contract.
        // When quote is native, make sure the deposit sent is enough.
        // If the deposit is more than the cost, send back the excess.
        if (mkt.quote.isERC20()) {
            uint256 cost = (sp.amount * o.price) / 10 ** 18;
            IERC20(mkt.quote.addr).transferFrom(msg.sender, address(this), cost);
        } else if (mkt.quote.isNative()) {
            uint256 cost = (sp.amount * o.price) / 10 ** 18;
            require(msg.value >= cost, "OC: LOW_DEPOSIT");
            if (msg.value > cost) {
                payable(msg.sender).transfer(msg.value - cost);
            }
        }

        // Update liquidity
        uint256 deduction;
        if (mkt.base.isNFT()) {
            o.providerIds = liq.ids;
            deduction = liq.ids.length;
            delete liq.ids;
        } else if (mkt.quote.isNFT()) {
            o.amount = liq.amount;
            deduction = o.amount;
            liq.amount = 0;
        } else if (sp.amount > 0) {
            liq.amount -= sp.amount;
            deduction = sp.amount;
        }

        // Create an order.
        uint256 timeToPay = (liq.timeToPay > 0) ? liq.timeToPay : s1.minTimeToPay;
        o.marketId = sp.addrs.marketId;
        o.provider = sp.addrs.provider;
        o.operator = sp.operator;
        o.lid = sp.lid;
        o.taker = msg.sender;
        o.recipient = sp.addrs.recipient;
        o.createdAt = block.timestamp;
        o.payDeadline = block.timestamp + timeToPay;
        o.cancelAt = block.timestamp + timeToPay + s1.orderGraceDur;
        s1.orders.push(o);
        s1.numOrders++;
        liq.openOrders += 1;
        s2.marketCore.setCounters(sp.addrs.marketId, true, false, false, mkt.numOrders + 1);
        s2.marketCore.setCounters(sp.addrs.marketId, false, false, true, mkt.numLiquidity - deduction);

        emit SwapOrder(
            sp.addrs.marketId,
            sp.addrs.provider,
            msg.sender,
            sp.addrs.recipient,
            [s1.numOrders - 1, sp.lid, sp.amount, o.price, sp.offerId, sp.operator, timeToPay + s1.orderGraceDur],
            o.providerIds,
            o.takerIds
        );
    }

    /// @notice Cancel an inactive order. An inactive order is one where:
    /// The order has not been marked as paid, released or disputed
    /// and has reached its cancel time.
    /// @param s1 State object
    /// @param s2 State2 object
    /// @param owner The contract owner
    /// @param id is the unique order ID
    /// @param byDispute Indicates that the method is called by the dispute manager contract.
    /// @param byManager Indicates that the method is called by the market manager.
    function cancelOrder(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        address owner,
        uint256 id,
        bool byDispute,
        bool byManager
    ) public {
        Structs.Order storage o = s1.orders[id];
        Structs.Market memory mkt = s2.marketCore.getMarket(o.marketId);
        require(
            byDispute ||
                byManager ||
                o.provider == msg.sender ||
                o.taker == msg.sender ||
                mkt.manager == msg.sender ||
                s2.minerReg.isMiner(msg.sender) ||
                owner == msg.sender,
            "OC: NOT_AUTHORIZED"
        );
        require(byDispute || (!o.paid && !o.released && !o.disputed && !o.cancelled), "OC: NOT_INACTIVE");
        require(byDispute || o.cancelAt <= block.timestamp, "OC: NOT_CANCEL_TIME");

        Structs.Liquidity storage liq = s1.liquidity[o.marketId][o.provider][o.lid];

        // Handle ERC20/SYNTH, SYNTH/ERC20, SYNTH/NATIVE, NATIVE/SYNTH
        if (mkt.isFungible() && mkt.hasERC20OrNative()) {
            liq.amount += o.amount;
            s2.marketCore.setCounters(o.marketId, false, false, true, mkt.numLiquidity + o.amount);

            if (mkt.quote.isERC20()) {
                uint256 cost = (o.amount * o.price) / 10 ** 18;
                IERC20(mkt.quote.addr).transfer(o.taker, cost);
            }

            if (mkt.quote.isNative()) {
                uint256 cost = (o.amount * o.price) / 10 ** 18;
                payable(o.taker).transfer(cost);
            }
        }

        // Handle SYNTH/SYNTH
        if (mkt.base.isSynth() && mkt.quote.isSynth()) {
            liq.amount += o.amount;
            s2.marketCore.setCounters(o.marketId, false, false, true, mkt.numLiquidity + o.amount);
        }

        // Handle SYNTH/NFT
        if (mkt.base.isSynth() && mkt.quote.isNFT()) {
            liq.amount += o.amount;
            s2.marketCore.setCounters(o.marketId, false, false, true, mkt.numLiquidity + o.amount);
            for (uint256 i = 0; i < o.takerIds.length; i++) {
                if (mkt.quote.isERC721()) IERC721Strip(mkt.quote.addr).transferFrom(address(this), o.taker, o.takerIds[i]);
                else IERC1155Strip(mkt.quote.addr).safeTransferFrom(address(this), o.taker, o.takerIds[i], 1, "");
            }
        }

        // Handle NFT/SYNTH
        if (mkt.base.isNFT() && mkt.quote.isSynth()) {
            liq.ids = o.providerIds;
            s2.marketCore.setCounters(o.marketId, false, false, true, mkt.numLiquidity + liq.ids.length);
        }

        liq.openOrders -= 1;
        o.cancelled = true;
        o.finalizer = msg.sender;

        if (s2.minerReg.isMiner(msg.sender)) {
            s2.minerReg.addReward(MinerOperation.Cancel, msg.sender);
        }

        emit OrderCancelled(id, msg.sender, byDispute);
    }

    /// @notice Mark a swap order as paid.
    /// Order must be have been released or cancelled.
    /// When the base asset is ERC20, the sender must be the taker.
    /// When the base asset is synthetic,the sender must be the provider.
    /// @param s1 State object
    /// @param marketCore The MarketCore contract address
    /// @param id The order ID.
    /// @param byManager Indicates that the method is called by the market manager
    function markOrderAsPaid(StructsLib.State storage s1, IMarketCore marketCore, uint256 id, bool byManager) public {
        require(AuxLib.hasOrder(s1, id), "OC: UNKNOWN_ORDER");
        Structs.Order storage o = s1.orders[id];
        require(!o.released && !o.cancelled && !o.paid, "OC: NOT_ACTIVE");
        Structs.Market memory market = marketCore.getMarket(o.marketId);
        require(byManager || msg.sender == MarketAuxLib.getPayer(market, o), "OC: NOT_PAYER");
        o.paid = true;
        o.disputeFrom = block.timestamp + market.dur.disputeDelayDur;
        emit SwapOrderPaid(id, byManager ? market.manager : msg.sender, market.dur.disputeDelayDur);
    }

    /// @notice Marks an order as `disputed`
    /// @param s1 State object
    /// @param marketCore The MarketCore contract address
    /// @param id The order ID or index.
    function markAsDisputed(StructsLib.State storage s1, IMarketCore marketCore, uint256 id) public {
        Structs.Order storage o = s1.orders[id];
        o.disputed = true;
        Structs.Market memory m = marketCore.getMarket(o.marketId);
        m.numDisputes++;
        marketCore.setCounters(o.marketId, false, true, false, m.numDisputes);
    }

    /// @notice Verify a market manager's signature
    /// @param signer The market manager's address
    /// @param id The order ID
    /// @param action Indicates the manager action (0: paid, 1: release, 2: cancel)
    /// @param expireAt Indicates the timestamp when the signature is to expire.
    /// @param signature The signature created by the manager
    function verifyMarketManagerSig(
        address signer,
        uint256 id,
        uint action,
        uint256 expireAt,
        bytes memory signature
    ) internal view returns (bool) {
        if (address(0) == signer) return false;
        bytes32 messageHash = keccak256(abi.encode(block.chainid, id, action, expireAt));
        bytes32 ethSignedMessageHash = SigLib.getSignedMessageHash(messageHash);
        return SigLib.recoverSigner(ethSignedMessageHash, signature) == signer;
    }
}
