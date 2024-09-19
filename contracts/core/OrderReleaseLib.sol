// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../common/Structs.sol";
import "../market/interfaces/IMarketCore.sol";
import "../common/SafeERC20.sol";
import "../common/SigLib.sol";
import "./AuxLib.sol";
import "./StructsLib.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../market/MarketAuxLib.sol";
import "./LiquidityLib.sol";
import "./FeeLib.sol";
import {IERC721Strip, IERC1155Strip} from "../common/StrippedInterfaces.sol";

library OrderReleaseLib {
    using MarketAuxLib for Structs.Asset;
    using MarketAuxLib for Structs.Market;
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

    /// @notice Release asset.
    /// @param s1 The State object
    /// @param s2 The State2 object
    /// @param owner The owner of the contract
    /// @param oid The order ID.
    /// @param byDispute Indicates that the method is called by the dispute manager.
    /// @param byManager Indicates that the method is called by the market manager via a manager signature.
    function releaseOrder(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        address owner,
        uint256 oid,
        bool byDispute,
        bool byManager
    ) public {
        Structs.Order storage o = s1.orders[oid];
        require(!o.cancelled && !o.released, "OC: ALREADY_FINALIZED");
        Structs.Market memory mkt = s2.marketCore.getMarket(o.marketId);
        address releaser = (byDispute)
            ? msg.sender
            : (byManager)
                ? mkt.manager
                : (o.taker == MarketAuxLib.getPayer(mkt, o))
                    ? o.provider
                    : o.taker;
        require(byDispute || byManager || msg.sender == releaser || msg.sender == owner, "OC: NOT_RELEASER");
        require(o.paid, "OC: ORDER_UNPAID");

        Structs.Asset memory asset;

        // Handle ERC20/SYNTH, SYNTH/ERC20, SYNTH/NATIVE, NATIVE/SYNTH
        if (mkt.isFungible() && mkt.hasERC20OrNative()) {
            asset = releaseForFungibles(s1, s2, o, mkt);
        }

        // Handle SYNTH/SYNTH
        if (mkt.base.isSynth() && mkt.quote.isSynth()) {
            asset = releaseForSynthToSynthOrNFT(s1, s2, o, mkt);
        }

        // Handle SYNTH/NFT
        if (mkt.base.isSynth() && mkt.quote.isNFT()) {
            asset = releaseForSynthToNFT(s1, s2, o, mkt);
        }

        // Handle NFT/SYNTH
        if (mkt.base.isNFT() && mkt.quote.isSynth()) {
            asset = releaseForNFTToSynth(s1, s2, o, mkt);
        }

        // Mark as released.
        o.released = true;
        o.finalizer = releaser;

        // Decrement open order count
        s1.liquidity[o.marketId][o.provider][o.lid].openOrders -= 1;

        // Increment orderID since '0' indicates no order ID.
        emit Swap(
            o.marketId,
            o.provider,
            o.taker,
            o.recipient,
            releaser,
            [oid + 1, o.lid, o.amount, o.price, o.offerId, o.operator],
            byDispute,
            o.providerIds,
            o.takerIds
        );
    }

    /// @dev Release asset for SYNTH/NFT
    /// @param s1 The State object
    /// @param s2 The State2 object
    /// @param o The order object
    /// @param mkt The market object
    function releaseForSynthToNFT(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        Structs.Order storage o,
        Structs.Market memory mkt
    ) internal returns (Structs.Asset memory asset) {
        asset = releaseForSynthToSynthOrNFT(s1, s2, o, mkt);

        // Transfer locked NFT to provider
        for (uint256 i = 0; i < o.takerIds.length; i++) {
            if (mkt.quote.isERC721()) IERC721Strip(mkt.quote.addr).transferFrom(address(this), o.provider, o.takerIds[i]);
            else IERC1155Strip(mkt.quote.addr).safeTransferFrom(address(this), o.provider, o.takerIds[i], 1, "");
        }

        return asset;
    }

    struct BoolSlot {
        bool sharable;
        bool isOperator;
    }

    /// @dev Release asset for NFT/SYNTH
    /// @param s1 The State object
    /// @param s2 The State2 object
    /// @param o The order object
    /// @param mkt The market object
    function releaseForNFTToSynth(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        Structs.Order storage o,
        Structs.Market memory mkt
    ) internal returns (Structs.Asset memory asset) {
        Structs.Liquidity storage liq = s1.liquidity[o.marketId][o.provider][o.lid];

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
                o.lid,
                o.amount,
                o.price,
                o.provider,
                o.taker
            )
        );

        // Unlock fee from fee purse
        s2.feePurse.unlock(o.provider, liq.protoFeePurseId);
        s2.feePurse.unlock(o.provider, liq.mktCreatorFeePurseId);
        liq.protoFeePurseId = 0;
        liq.mktCreatorFeePurseId = 0;

        // Transfer market creator fee to market creator
        s2.feePurse.transferFrom(o.provider, mkt.creator, feeInfo.mktCreatorFee);

        uint256 totalFeeBps = s1.feeBPs[0] + s1.feeBPs[1] + s1.feeBPs[2];

        // Disburse fee to sharable pool  if asset is shareable
        BoolSlot memory bools = BoolSlot(AuxLib.isShareable(s2, mkt.base.addr), s2.operatorMgr.isOperator(o.operator));
        if (bools.sharable) {
            s2.feePurse.transferFrom(o.provider, address(this), (feeInfo.protoFee * s1.feeBPs[1]) / 10000);
            totalFeeBps -= s1.feeBPs[1];
        }

        // Disburse fee to operator if operator is set
        if (bools.isOperator) {
            address opAddr = s2.operatorMgr.getOperator(o.operator);
            s2.feePurse.transferFrom(o.provider, opAddr, (feeInfo.protoFee * s1.feeBPs[2]) / 10000);
            totalFeeBps -= s1.feeBPs[2];
        }

        // Disburse fee to inventor
        s2.feePurse.transferFrom(o.provider, s1.inventor, (feeInfo.protoFee * totalFeeBps) / 10000);

        // Transfer the base asset to recipient
        for (uint256 i = 0; i < o.providerIds.length; i++)
            if (mkt.base.isERC721())
                IERC721Strip(mkt.base.addr).transferFrom(address(this), o.recipient.setOrDef(o.taker), o.providerIds[i]);
            else IERC1155Strip(mkt.base.addr).safeTransferFrom(address(this), o.recipient.setOrDef(o.taker), o.providerIds[i], 1, "");

        return mkt.base;
    }

    struct IntSlot {
        uint256 remaining;
        uint256 protoFeeRate;
        uint256 mktCreatorFeeRate;
        uint256 protoFee;
        uint256 mktCreatorFee;
    }

    /// @dev Release asset for SYNTH/SYNTH & SYNTH/NFT
    /// @param s1 The State object
    /// @param s2 The State2 object
    /// @param o The order object
    /// @param mkt The market object
    function releaseForSynthToSynthOrNFT(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        Structs.Order memory o,
        Structs.Market memory mkt
    ) internal returns (Structs.Asset memory asset) {
        Structs.Liquidity storage liq = s1.liquidity[o.marketId][o.provider][o.lid];

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
                o.lid,
                o.amount,
                o.price,
                o.provider,
                o.taker
            )
        );

        // Unlock fee in purse
        s2.feePurse.unlock(o.provider, liq.protoFeePurseId);
        s2.feePurse.unlock(o.provider, liq.mktCreatorFeePurseId);

        // Transfer market creator order fee to market creator
        s2.feePurse.transferFrom(o.provider, mkt.creator, feeInfo.mktCreatorFee);

        uint256 totalFeeBps = s1.feeBPs[0] + s1.feeBPs[1] + s1.feeBPs[2];

        // Disburse fee to sharable pool  if asset is shareable
        BoolSlot memory bools = BoolSlot(AuxLib.isShareable(s2, asset.addr), s2.operatorMgr.isOperator(o.operator));
        if (bools.sharable) {
            s2.feePurse.transferFrom(o.provider, address(this), (feeInfo.protoFee * s1.feeBPs[1]) / 10000);
            totalFeeBps -= s1.feeBPs[1];
        }

        // Disburse fee to operator if operator is set
        if (bools.isOperator) {
            address opAddr = s2.operatorMgr.getOperator(o.operator);
            s2.feePurse.transferFrom(o.provider, opAddr, (feeInfo.protoFee * s1.feeBPs[2]) / 10000);
            totalFeeBps -= s1.feeBPs[2];
        }

        // Disburse fee to inventor
        s2.feePurse.transferFrom(o.provider, s1.inventor, (feeInfo.protoFee * totalFeeBps) / 10000);

        // Lock fee for the remaining liquidity
        liq.protoFeePurseId = s2.feePurse.lock(o.provider, (feeInfo.protoFeeRate * feeInfo.remaining) / 10 ** 18);
        liq.mktCreatorFeePurseId = s2.feePurse.lock(o.provider, (feeInfo.mktCreatorFeeRate * feeInfo.remaining) / 10 ** 18);

        return mkt.base;
    }

    function releaseForFungibles(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        Structs.Order storage o,
        Structs.Market memory mkt
    ) internal returns (Structs.Asset memory asset) {
        asset = mkt.base.isOnchain() ? mkt.base : mkt.quote;

        // Compute fee
        Structs.Liquidity memory liq = s1.liquidity[o.marketId][o.provider][o.lid];
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
                o.lid,
                o.amount,
                o.price,
                o.provider,
                o.taker
            )
        );

        uint256 totalFeeBps = s1.feeBPs[0] + s1.feeBPs[1] + s1.feeBPs[2];

        // Disburse fees to market creator
        s1.feeBalance[mkt.creator][asset.addr] += feeInfo.mktCreatorFee;

        // Disburse fee to sharable pool  if asset is shareable
        BoolSlot memory bools = BoolSlot(AuxLib.isShareable(s2, asset.addr), s2.operatorMgr.isOperator(o.operator));
        if (bools.sharable) {
            s1.shareablesBalance[asset.addr] += (feeInfo.protoFee * s1.feeBPs[1]) / 10000;
            totalFeeBps -= s1.feeBPs[1];
        }

        //  Disburse fee to operator if operator is set
        if (bools.isOperator) {
            s1.operatorsBalance[s2.operatorMgr.getOperator(o.operator)][asset.addr] += (feeInfo.protoFee * s1.feeBPs[2]) / 10000;
            totalFeeBps -= s1.feeBPs[2];
        }

        // Disburse fee to inventor
        s1.inventorBalance[asset.addr] += (feeInfo.protoFee * totalFeeBps) / 10000;

        // Transfer the order amount
        address receiver = (!mkt.base.isSynth()) ? o.taker : o.provider;
        if (asset.isERC20()) {
            IERC20(asset.addr).transfer(o.recipient.setOrDef(receiver), feeInfo.amtToCharge - feeInfo.totalFees);
        } else if (asset.isNative()) {
            payable(o.recipient.setOrDef(receiver)).transfer(feeInfo.amtToCharge - feeInfo.totalFees);
        }

        return asset;
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
