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
import "./FeeLib.sol";

library SwapNonFungibleLib {
    using SafeERC20 for IERC20;
    using MarketAuxLib for Structs.Asset;
    using AuxLib for address;

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

    /// @dev Swap quote asset for a non-fungible base asset.
    /// Covers NFT/ERC20, NFT/NATIVE, NFT/SYNTH, NFT/NFT
    /// @param s1 Storage state.
    /// @param s2 Storage state 2.
    /// @param sp The parameters needed to swap.
    /// @param market The market object for the market being swapped on.
    function swap(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        StructsLib.SwapSlot memory sp,
        Structs.Market memory market
    ) public {
        require(AuxLib.hasNonZeroLiquidity(s1, sp.addrs.marketId, sp.addrs.provider, sp.lid), "OC: ZERO_LIQ");
        Structs.Liquidity storage liq = s1.liquidity[sp.addrs.marketId][sp.addrs.provider][sp.lid];
        require(liq.target.isZero() || liq.target == msg.sender, "OC: NOT_TARGET");
        AuxLib.checkNonFungibleSwapParams(sp, market, liq);
        require(sp.operator == 0 || s2.operatorMgr.isOperator(sp.operator), "OC: UNKNOWN_OPERATOR");

        // If quote asset is ERC20 or NATIVE
        if (market.quote.isERC20() || market.quote.isNative()) {
            return swapERC20OrNativeForNFT(s1, s2, sp, market, liq);
        }

        // If quote asset is NFT
        if (market.quote.isNFT()) {
            return swapNFTForNFT(s1, s2, sp, market, liq);
        }

        // Create a swap order (NFT/SYNTH)
        OrderLib.createOrder(s1, s2, sp, market, liq);
    }

    struct BoolSlot {
        bool sharable;
        bool isOperator;
    }

    /// @dev Handle NFT/NFT swap (Instant)
    /// @param s1 Storage state.
    /// @param s2 Storage state 2.
    /// @param sp The parameters needed to swap.
    /// @param mkt The market object for the market being swapped on.
    /// @param liq The liquidity object.
    function swapNFTForNFT(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        StructsLib.SwapSlot memory sp,
        Structs.Market memory mkt,
        Structs.Liquidity storage liq
    ) public {
        address sdr = msg.sender;

        // Find the IDs that match the wants request
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

        // Unlock fee from fee purse
        s2.feePurse.unlock(sp.addrs.provider, liq.protoFeePurseId);
        s2.feePurse.unlock(sp.addrs.provider, liq.mktCreatorFeePurseId);
        liq.protoFeePurseId = 0;
        liq.mktCreatorFeePurseId = 0;

        // Transfer fee to market creator
        s2.feePurse.transferFrom(sp.addrs.provider, mkt.creator, feeInfo.mktCreatorFee);

        uint256 totalFeeBps = s1.feeBPs[0] + s1.feeBPs[1] + s1.feeBPs[2];

        BoolSlot memory bools = BoolSlot(AuxLib.isShareable(s2, mkt.base.addr), s2.operatorMgr.isOperator(sp.operator));

        // Disburse fee to sharable pool if asset is sharable
        if (bools.sharable) {
            s2.feePurse.transferFrom(sp.addrs.provider, address(this), (feeInfo.protoFee * s1.feeBPs[1]) / 10000);
            totalFeeBps -= s1.feeBPs[1];
        }

        // Disburse fee to operator if operator is set
        if (bools.isOperator) {
            address opAddr = s2.operatorMgr.getOperator(sp.operator);
            s2.feePurse.transferFrom(sp.addrs.provider, opAddr, (feeInfo.protoFee * s1.feeBPs[2]) / 10000);
            totalFeeBps -= s1.feeBPs[2];
        }

        // Disburse fee to inventor
        s2.feePurse.transferFrom(sp.addrs.provider, s1.inventor, (feeInfo.protoFee * totalFeeBps) / 10000);

        // Transfer quote asset to liquidity provider
        for (uint256 i = 0; i < matchIds.length; i++) {
            if (matchIds[i] == 0) continue;
            if (mkt.quote.isERC721()) IERC721Strip(mkt.quote.addr).transferFrom(sdr, sp.addrs.provider, matchIds[i]);
            else IERC1155Strip(mkt.quote.addr).safeTransferFrom(sdr, sp.addrs.provider, matchIds[i], 1, "");
        }

        // Transfer the base asset to recipient
        for (uint256 i = 0; i < liq.ids.length; i++)
            if (mkt.base.isERC721()) IERC721Strip(mkt.base.addr).transferFrom(address(this), sp.addrs.recipient.setOrDef(sdr), liq.ids[i]);
            else IERC1155Strip(mkt.base.addr).safeTransferFrom(address(this), sp.addrs.recipient.setOrDef(sdr), liq.ids[i], 1, "");

        s2.marketCore.setCounters(sp.addrs.marketId, false, false, true, mkt.numLiquidity - liq.ids.length);

        emit Swap(
            sp.addrs.marketId,
            sp.addrs.provider,
            msg.sender,
            sp.addrs.recipient,
            address(0),
            [0, sp.lid, sp.amount, 0, sp.offerId, sp.operator],
            false,
            liq.ids,
            matchIds
        );

        delete liq.ids;
    }

    /// @dev Handle NFT/ERC20, NFT/NATIVE swap (Instant)
    /// @param s1 Storage state.
    /// @param s2 Storage state 2.
    /// @param sp The parameters needed to swap.
    /// @param mkt The market object for the market being swapped on.
    /// @param liq The liquidity object.
    function swapERC20OrNativeForNFT(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        StructsLib.SwapSlot memory sp,
        Structs.Market memory mkt,
        Structs.Liquidity storage liq
    ) public {
        uint256 price = (sp.offerId > 0) ? sp.maxPrice : liq.price;

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

        // Dispurse fee to market creator
        s1.feeBalance[mkt.creator][mkt.quote.addr] += feeInfo.mktCreatorFee;

        BoolSlot memory bools = BoolSlot(AuxLib.isShareable(s2, mkt.quote.addr), s2.operatorMgr.isOperator(sp.operator));

        uint256 totalFeeBps = s1.feeBPs[0] + s1.feeBPs[1] + s1.feeBPs[2];

        // Disburse fee to sharable pool if asset is sharable
        if (bools.sharable) {
            s1.shareablesBalance[mkt.quote.addr] += (feeInfo.protoFee * s1.feeBPs[1]) / 10000;
            totalFeeBps -= s1.feeBPs[1];
        }

        // Disburse fee to operator if operator is set
        if (bools.isOperator) {
            s1.operatorsBalance[s2.operatorMgr.getOperator(sp.operator)][mkt.quote.addr] += (feeInfo.protoFee * s1.feeBPs[2]) / 10000;
            totalFeeBps -= s1.feeBPs[2];
        }

        // Disburse fee to inventor
        s1.inventorBalance[mkt.quote.addr] += (feeInfo.protoFee * totalFeeBps) / 10000;

        // Transfer quote asset to contract and to the liquidity provider
        if (mkt.quote.isERC20()) {
            IERC20(mkt.quote.addr).safeTransferFrom(msg.sender, address(this), price);
            IERC20(mkt.quote.addr).safeTransfer(sp.addrs.provider, price - feeInfo.totalFees);
        } else if (mkt.quote.isNative()) {
            require(msg.value >= price, "OC: LOW_DEPOSIT");
            payable(sp.addrs.provider).transfer(price - feeInfo.totalFees);
        }

        // Transfer base assets to recipient
        for (uint256 i = 0; i < liq.ids.length; i++)
            if (mkt.base.isERC721())
                IERC721Strip(mkt.base.addr).transferFrom(address(this), sp.addrs.recipient.setOrDef(msg.sender), liq.ids[i]);
            else IERC1155Strip(mkt.base.addr).safeTransferFrom(address(this), sp.addrs.recipient.setOrDef(msg.sender), liq.ids[i], 1, "");

        // When quote is native, transfer excess quote deposit back to sender
        if (mkt.quote.isNative() && msg.value > price) {
            payable(msg.sender).transfer(msg.value - price);
        }

        s2.marketCore.setCounters(sp.addrs.marketId, false, false, true, mkt.numLiquidity - liq.ids.length);

        emit Swap(
            sp.addrs.marketId,
            sp.addrs.provider,
            msg.sender,
            sp.addrs.recipient,
            address(0),
            [0, sp.lid, sp.amount, price, sp.offerId, sp.operator],
            false,
            liq.ids,
            new uint256[](0)
        );

        delete liq.ids;
    }
}
