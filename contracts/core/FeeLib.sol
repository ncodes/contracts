// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../common/Structs.sol";
import "../common/SigLib.sol";
import "./AuxLib.sol";
import "./StructsLib.sol";
import "../assetregistry/interfaces/IAssetRegistry.sol";
import "../market/MarketAuxLib.sol";
import "../feepurse/interfaces/IFeePurse.sol";

struct FeeInfo {
    uint256 cost;
    uint256 feeBp;
    uint256 amtToCharge;
    uint256 mktCreatorFee;
    uint256 protoFee;
    uint256 totalFees;
    uint256 remaining;
    uint256 protoFeeRate;
    uint256 mktCreatorFeeRate;
    uint256 mktFeeBp;
}

struct ComputeFeeParams {
    Structs.Market mkt;
    Structs.Liquidity liq;
    IAssetRegistry assetReg;
    IFeePurse feePurse;
    uint256 synthSwapFeeBp;
    uint256 instantNFTSwapFeeBp;
    uint256 instantSwapFeeBp;
    uint256 stableSwapFeeBp;
    uint256 nftDiscountBp;
    uint256 lid;
    uint256 amount;
    uint256 price;
    address nft;
    address provider;
    address taker;
}

library FeeLib {
    using MarketAuxLib for Structs.Asset;
    using MarketAuxLib for Structs.Market;

    // @notice Compute fee for all swap types.
    function computeFee(ComputeFeeParams memory p) public view returns (FeeInfo memory) {
        FeeInfo memory feeInfo;

        // ERC20/ERC20 fee calculation.
        if (p.mkt.base.isERC20() && p.mkt.quote.isERC20()) {
            (feeInfo.feeBp, , ) = AuxLib.getFeeInfo(p.assetReg, p.mkt.base, p.instantSwapFeeBp);
            feeInfo.feeBp = AuxLib.isStable(p.assetReg, p.mkt) ? p.stableSwapFeeBp : feeInfo.feeBp;
            feeInfo.mktFeeBp = p.mkt.commission;

            // If sender has NFT, apply NFT fee discount
            uint256 denom = 10000;
            if (p.nft != address(0) && AuxLib.hasNativeNFT(p.nft, p.taker)) {
                feeInfo.feeBp = feeInfo.feeBp * 10**2 - ((p.nftDiscountBp * feeInfo.feeBp * 10**2) / denom);
                feeInfo.mktFeeBp = feeInfo.mktFeeBp * 10**2 - ((p.nftDiscountBp * feeInfo.mktFeeBp * 10**2) / denom);
                denom = 1000000;
            }

            // Calculate fees
            feeInfo.mktCreatorFee = (p.amount * feeInfo.mktFeeBp) / denom;
            feeInfo.protoFee = (p.amount * feeInfo.feeBp) / denom;
            feeInfo.totalFees = feeInfo.mktCreatorFee + feeInfo.protoFee;
            return feeInfo;
        }

        // ERC20/SYNTH & SYNTH/ERC20 fee calculation.
        if (p.mkt.isFungible() && p.mkt.hasERC20()) {
            Structs.Asset memory asset = p.mkt.base.isOnchain() ? p.mkt.base : p.mkt.quote;
            feeInfo.cost = (p.amount * p.price) / ((p.mkt.quote.isSynth()) ? 10**18 : 10**IERC20(p.mkt.quote.addr).decimals());
            feeInfo.mktFeeBp = p.mkt.commission;
            (feeInfo.feeBp, , ) = AuxLib.getFeeInfo(p.assetReg, asset, p.synthSwapFeeBp);

            // If taker's asset is synthetic (off-chain) and has the native NFT, apply discount.
            // If provider's asset is synthetic (off-chain) and has the native NFT, apply discount.
            uint256 denom = 10000;
            if (AuxLib.hasNativeNFT(p.nft, (p.mkt.quote.isSynth()) ? p.taker : p.provider)) {
                feeInfo.mktFeeBp = feeInfo.mktFeeBp * 10**2 - ((p.nftDiscountBp * feeInfo.mktFeeBp * 10**2) / denom);
                feeInfo.feeBp = feeInfo.feeBp * 10**2 - ((p.nftDiscountBp * feeInfo.feeBp * 10**2) / denom);
                denom = 1000000;
            }

            // Determine which amount is subject to fee deduction.
            // When the base asset is ERC20, charge fee from order amount.
            // Otherwise charge fee from order cost.
            feeInfo.amtToCharge = (p.mkt.base.isSynth()) ? feeInfo.cost : p.amount;

            // Calculate fees
            feeInfo.mktCreatorFee = (feeInfo.amtToCharge * feeInfo.mktFeeBp) / denom;
            feeInfo.protoFee = (feeInfo.amtToCharge * feeInfo.feeBp) / denom;
            feeInfo.totalFees = feeInfo.mktCreatorFee + feeInfo.protoFee;
            return feeInfo;
        }

        // ERC20/NFT fee calculation.
        if (p.mkt.base.isERC20() && p.mkt.quote.isNFT()) {
            (feeInfo.feeBp, , ) = AuxLib.getFeeInfo(p.assetReg, p.mkt.base, p.instantNFTSwapFeeBp);
            feeInfo.mktFeeBp = p.mkt.commission;

            // If sender has NFT, apply NFT fee discount
            uint256 denom = 10000;
            if (p.nft != address(0) && AuxLib.hasNativeNFT(p.nft, p.taker)) {
                feeInfo.feeBp = feeInfo.feeBp * 10**2 - ((p.nftDiscountBp * feeInfo.feeBp * 10**2) / denom);
                feeInfo.mktFeeBp = feeInfo.mktFeeBp * 10**2 - ((p.nftDiscountBp * feeInfo.mktFeeBp * 10**2) / denom);
                denom = 1000000;
            }

            // Calculate fees
            feeInfo.mktCreatorFee = (p.liq.amount * feeInfo.mktFeeBp) / denom;
            feeInfo.protoFee = (p.liq.amount * feeInfo.feeBp) / denom;
            feeInfo.totalFees = feeInfo.mktCreatorFee + feeInfo.protoFee;
        }

        // SYNTH/SYNTH & SYNTH/NFT fee calculation
        if (p.mkt.base.isSynth() && (p.mkt.quote.isSynth() || p.mkt.quote.isNFT())) {
            feeInfo.remaining = p.liq.amount;
            feeInfo.protoFeeRate = p.liq.protoFeeRate;
            feeInfo.mktCreatorFeeRate = p.liq.mktCreatorFeeRate;

            // Calculate fees
            feeInfo.protoFee = (feeInfo.protoFeeRate * p.amount) / 10**18;
            feeInfo.mktCreatorFee = (feeInfo.mktCreatorFeeRate * p.amount) / 10**18;
            feeInfo.totalFees = feeInfo.mktCreatorFee + feeInfo.protoFee;
            return feeInfo;
        }

        // NFT/ERC20 fee calculation
        if (p.mkt.base.isNFT() && p.mkt.quote.isERC20()) {
            (feeInfo.feeBp, , ) = AuxLib.getFeeInfo(p.assetReg, p.mkt.base, p.instantNFTSwapFeeBp);
            feeInfo.mktFeeBp = p.mkt.commission;

            // If provider has NFT, apply NFT fee discount
            uint256 denom = 10000;
            if (p.nft != address(0) && AuxLib.hasNativeNFT(p.nft, p.provider)) {
                feeInfo.feeBp = feeInfo.feeBp * 10**2 - ((p.nftDiscountBp * feeInfo.feeBp * 10**2) / denom);
                feeInfo.mktFeeBp = feeInfo.mktFeeBp * 10**2 - ((p.nftDiscountBp * feeInfo.mktFeeBp * 10**2) / denom);
                denom = 1000000;
            }

            // Calculate fees owed.
            feeInfo.mktCreatorFee = (p.price * feeInfo.mktFeeBp) / denom;
            feeInfo.protoFee = (p.price * feeInfo.feeBp) / denom;
            feeInfo.totalFees = feeInfo.mktCreatorFee + feeInfo.protoFee;
            return feeInfo;
        }

        // NFT/SYNTH fee calculation
        if (p.mkt.base.isNFT() && p.mkt.quote.isSynth()) {
            feeInfo.protoFee = p.feePurse.getLocked(p.liq.protoFeePurseId);
            feeInfo.mktCreatorFee = p.feePurse.getLocked(p.liq.mktCreatorFeePurseId);
            feeInfo.totalFees = feeInfo.mktCreatorFee + feeInfo.protoFee;
            return feeInfo;
        }

        // NFT/NFT fee calculation
        if (p.mkt.base.isNFT() && p.mkt.quote.isNFT()) {
            feeInfo.protoFee = p.feePurse.getLocked(p.liq.protoFeePurseId);
            feeInfo.mktCreatorFee = p.feePurse.getLocked(p.liq.mktCreatorFeePurseId);
            feeInfo.totalFees = feeInfo.mktCreatorFee + feeInfo.protoFee;
            return feeInfo;
        }

        return feeInfo;
    }
}
