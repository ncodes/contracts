// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../common/Structs.sol";
import "../market/interfaces/IMarketCore.sol";
import "../common/SafeERC20.sol";
import "./AuxLib.sol";
import "./StructsLib.sol";
import "../market/MarketAuxLib.sol";
import "./OrderLib.sol";
import {IERC1155Strip} from "../common/StrippedInterfaces.sol";
import "./LiquidityLib.sol";
import "./FeeLib.sol";
import "hardhat/console.sol";

library SwapFungibleLib {
    using SafeERC20 for IERC20;
    using AuxLib for uint256[];
    using AuxLib for address;
    using MarketAuxLib for Structs.Asset;

    event Swap(
        address indexed mid,
        address indexed provider,
        address indexed swapper,
        address recipient,
        address releaser,
        uint256[6] numTypeInfo,
        bool byDispute,
        uint256[] idsFromProvider,
        uint256[] idsFromTaker
    );

    /// @dev Swap quote asset for a fungible base asset.
    /// Covers:
    /// ERC20/ERC20, ERC20/SYNTH, ERC20/NATIVE, ERC20/NFT, SYNTH/ERC20,
    /// SYNTH/NATIVE, SYNTH/SYNTH, SYNTH/NFT,
    /// NATIVE/ERC20, NATIVE/SYNTH, NATIVE/NATIVE, NATIVE/NFT
    /// @param state Storage state.
    /// @param state2 Storage state 2.
    /// @param sp The parameters needed to swap.
    /// @param mkt The market object for the market being swapped on.
    function swap(
        StructsLib.State storage state,
        StructsLib.State2 storage state2,
        StructsLib.SwapSlot memory sp,
        Structs.Market memory mkt
    ) public {
        require(AuxLib.hasNonZeroLiquidity(state, sp.addrs.marketId, sp.addrs.provider, sp.lid), "OC: ZERO_LIQ");
        Structs.Liquidity storage liq = state.liquidity[sp.addrs.marketId][sp.addrs.provider][sp.lid];
        require(liq.target.isZero() || liq.target == msg.sender, "OC: NOT_TARGET");
        AuxLib.checkFungibleSwapParams(sp, mkt, liq);
        require(sp.operator == 0 || state2.operatorMgr.isOperator(sp.operator), "OC: UNKNOWN_OPERATOR");

        // Handle ERC20/ERC20, ERC20/NATIVE, NATIVE/ERC20, NATIVE/NATIVE
        if (
            (mkt.base.isERC20() && (mkt.quote.isERC20() || mkt.quote.isNative())) ||
            (mkt.base.isNative() && (mkt.quote.isERC20() || mkt.quote.isNative()))
        ) {
            return swapERC20OrNativeForERC20OrNative(state, state2, sp, mkt, liq);
        }

        // Handle ERC20/NFT, NATIVE/NFT
        if ((mkt.base.isERC20() || mkt.base.isNative()) && mkt.quote.isNFT()) {
            return swapNFTForERC20OrNative(state, state2, sp, mkt, liq);
        }

        // Create order for ERC20/SYNTH, SYNTH/ERC20, SYNTH/SYNTH, SYNTH/NFT, NATIVE/SYNTH, SYNTH/NATIVE
        OrderLib.createOrder(state, state2, sp, mkt, liq);
    }

    struct BoolSlot {
        bool sharable;
        bool isOperator;
    }

    /// @dev Handle ERC20/ERC20, ERC20/NATIVE, NATIVE/NATIVE, NATIVE/ERC20 swap (Instant Swap)
    /// @param s1 Storage state.
    /// @param s2 Storage state 2.
    /// @param sp The parameters needed to swap.
    /// @param mkt The market object for the market being swapped on.
    /// @param liq The liquidity object for the liquidity being swapped on.
    function swapERC20OrNativeForERC20OrNative(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        StructsLib.SwapSlot memory sp,
        Structs.Market memory mkt,
        Structs.Liquidity storage liq
    ) public {
        // If swap was initiated via an offer, use price from offer instead of liquidity
        uint256 price = (sp.offerId > 0) ? sp.maxPrice : liq.price;

        // Compute cost of swapping for base. Ensure swapper's quote balance is sufficient.
        uint256 cost = (sp.amount * price) / 10 ** ((mkt.base.isERC20()) ? IERC20(mkt.base.addr).decimals() : 18);
        require(!mkt.quote.isERC20() || IERC20(mkt.quote.addr).balanceOf(msg.sender) >= cost, "OC: LOW_QUOTE_BAL");
        require(!mkt.quote.isNative() || msg.value >= cost, "OC: LOW_QUOTE_BAL");

        // Compute fee
        FeeInfo memory feeInfo = FeeLib.computeFee(
            ComputeFeeParams(
                mkt,
                liq,
                s2.assetReg,
                s2.feePurse,
                s1.ints.synthSwapFeeBp,
                s1.ints.instantNFTSwapFeeBp,
                s1.ints.instantSwapFeeBp,
                s1.ints.stableSwapFeeBp,
                sp.lid,
                sp.amount,
                price,
                sp.addrs.provider,
                msg.sender
            )
        );

        uint256 totalFeeBps = s1.feeBPs[0] + s1.feeBPs[1] + s1.feeBPs[2];

        // Disburse fee to market creator
        s1.feeBalance[mkt.creator][mkt.base.addr] += feeInfo.mktCreatorFee;

        BoolSlot memory bools = BoolSlot(AuxLib.isShareable(s2, mkt.base.addr), s2.operatorMgr.isOperator(sp.operator));

        // Disburse fee to sharable pool if asset is sharable
        if (bools.sharable) {
            s1.shareablesBalance[mkt.base.addr] += (feeInfo.protoFee * s1.feeBPs[1]) / 10000;
            totalFeeBps -= s1.feeBPs[1];
        }

        // Disburse fee to operator if operator is set
        if (bools.isOperator) {
            s1.operatorsBalance[s2.operatorMgr.getOperator(sp.operator)][mkt.base.addr] += (feeInfo.protoFee * s1.feeBPs[2]) / 10000;
            totalFeeBps -= s1.feeBPs[2];
        }

        // Disburse fee to inventor
        s1.inventorBalance[mkt.base.addr] += (feeInfo.protoFee * totalFeeBps) / 10000;

        // Update liquidity
        liq.amount -= sp.amount;
        s2.marketCore.setCounters(sp.addrs.marketId, false, false, true, mkt.numLiquidity - sp.amount);

        // Transfer quote asset (swap cost) from swapper to liquidity provider.
        if (mkt.quote.isERC20()) {
            IERC20(mkt.quote.addr).safeTransferFrom(msg.sender, sp.addrs.provider, cost);
        } else if (mkt.quote.isNative()) {
            payable(sp.addrs.provider).transfer(cost);
        }

        // Transfer base asset (swap amount) to recipient
        if (mkt.base.isERC20()) {
            IERC20(mkt.base.addr).safeTransfer(sp.addrs.recipient.setOrDef(msg.sender), sp.amount - feeInfo.totalFees);
        } else if (mkt.base.isNative()) {
            payable(sp.addrs.recipient.setOrDef(msg.sender)).transfer(sp.amount - feeInfo.totalFees);
        }

        // When quote is native, transfer excess quote deposit back to sender
        if (mkt.quote.isNative() && msg.value > cost) {
            payable(msg.sender).transfer(msg.value - cost);
        }

        emit Swap(
            sp.addrs.marketId,
            sp.addrs.provider,
            msg.sender,
            sp.addrs.recipient,
            address(0),
            [0, sp.lid, sp.amount, price, sp.offerId, sp.operator],
            false,
            new uint256[](0),
            new uint256[](0)
        );
    }

    /// @dev Handle ERC20/NFT, NATIVE/NFT swap (Instant Swap)
    /// @param s1 Storage state.
    /// @param s2 Storage state 2.
    /// @param sp The parameters needed to swap.
    /// @param mkt The market object for the market being swapped on.
    /// @param liq The liquidity object for the liquidity being swapped on.
    function swapNFTForERC20OrNative(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        StructsLib.SwapSlot memory sp,
        Structs.Market memory mkt,
        Structs.Liquidity storage liq
    ) public {
        // Find the IDs that match the wants request.
        // If swap was initiated via offer, use offer supplied ids.
        uint256[] memory matchIds = (sp.offerId > 0)
            ? sp.ids
            : LiquidityLib.findMatchInWantIds(sp.ids, s2.intIdx, liq.wantOrIds, liq.wantAndIds);
        require(matchIds.length > 0, "OC: NO_ID_MATCH");

        // Compute fee
        FeeInfo memory feeInfo = FeeLib.computeFee(
            ComputeFeeParams(
                mkt,
                liq,
                s2.assetReg,
                s2.feePurse,
                s1.ints.synthSwapFeeBp,
                s1.ints.instantNFTSwapFeeBp,
                s1.ints.instantSwapFeeBp,
                s1.ints.stableSwapFeeBp,
                sp.lid,
                sp.amount,
                0,
                sp.addrs.provider,
                msg.sender
            )
        );

        uint256 totalFeeBps = s1.feeBPs[0] + s1.feeBPs[1] + s1.feeBPs[2];

        // Disburse fee to market creator
        s1.feeBalance[mkt.creator][mkt.base.addr] += feeInfo.mktCreatorFee;

        BoolSlot memory bools = BoolSlot(AuxLib.isShareable(s2, mkt.base.addr), s2.operatorMgr.isOperator(sp.operator));

        // Disburse fee to sharable pool if asset is sharable
        if (bools.sharable) {
            s1.shareablesBalance[mkt.base.addr] += (feeInfo.protoFee * s1.feeBPs[1]) / 10000;
            totalFeeBps -= s1.feeBPs[1];
        }

        // Disburse fee to operator if operator is set
        if (bools.isOperator) {
            s1.operatorsBalance[s2.operatorMgr.getOperator(sp.operator)][mkt.base.addr] += (feeInfo.protoFee * s1.feeBPs[2]) / 10000;
            totalFeeBps -= s1.feeBPs[2];
        }

        // Disburse fee to inventor
        s1.inventorBalance[mkt.base.addr] += (feeInfo.protoFee * totalFeeBps) / 10000;

        // Transfer base asset to recipient
        if (mkt.base.isERC20()) {
            IERC20(mkt.base.addr).safeTransfer(sp.addrs.recipient.setOrDef(msg.sender), liq.amount - feeInfo.totalFees);
        } else if (mkt.base.isNative()) {
            payable(sp.addrs.recipient.setOrDef(msg.sender)).transfer(liq.amount - feeInfo.totalFees);
        }

        // Transfer quote asset to liquidity provider
        for (uint256 i = 0; i < matchIds.length; i++) {
            if (matchIds[i] == 0) continue;
            if (mkt.quote.isERC721()) IERC721Strip(mkt.quote.addr).transferFrom(msg.sender, sp.addrs.provider, matchIds[i]);
            else IERC1155Strip(mkt.quote.addr).safeTransferFrom(msg.sender, sp.addrs.provider, matchIds[i], 1, "");
        }

        // Update liquidity
        s2.marketCore.setCounters(sp.addrs.marketId, false, false, true, mkt.numLiquidity - liq.amount);
        liq.amount = 0;

        emit Swap(
            sp.addrs.marketId,
            sp.addrs.provider,
            msg.sender,
            sp.addrs.recipient,
            address(0),
            [0, sp.lid, sp.amount, liq.price, sp.offerId, sp.operator],
            false,
            new uint256[](0),
            matchIds
        );
    }
}
