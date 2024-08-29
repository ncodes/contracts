// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../common/Structs.sol";
import "../market/interfaces/IMarketCore.sol";
import "../common/SafeERC20.sol";
import "../token/interfaces/IERC721.sol";
import "../token/interfaces/IERC1155.sol";
import "../common/StrippedInterfaces.sol";
import "../common/MathLib.sol";
import "./AuxLib.sol";
import "../market/MarketAuxLib.sol";
import "./StructsLib.sol";
import "../assetregistry/interfaces/IAssetRegistry.sol";
import "../feepurse/interfaces/IFeePurse.sol";

library LiqAuxLib {
    using MarketAuxLib for Structs.Asset;
    using MarketAuxLib for Structs.Market;

    /// @dev Calculate and lock liquidity fee for protocol in non-ERC20 market
    /// @param s1 A state object
    /// @param s2 A state object
    /// @param mkt The market object
    /// @param liq The liquidity object
    /// @param amount The amount of liquidity to lock fee for
    function lockFeeForProtocol(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        Structs.Market memory mkt,
        Structs.Liquidity storage liq,
        uint256 amount
    ) internal {
        (, uint256 fixedFee, ) = AuxLib.getFeeInfo(s2.assetReg, mkt.base, 0);
        uint256 fixedFeeInternal = mkt.base.isSynth() ? s1.ints.fixedSynthSwapFee : s1.ints.fixedNFTSwapFee;
        uint256 fee = amount * ((fixedFee > 0) ? fixedFee : fixedFeeInternal);
        fee = mkt.base.isSynth() ? fee / 10 ** 18 : fee;

        if (fee > 0) {
            uint256 prevLockedFee = s2.feePurse.getLocked(liq.protoFeePurseId);
            if (prevLockedFee > 0) s2.feePurse.unlock(msg.sender, liq.protoFeePurseId);
            liq.protoFeePurseId = s2.feePurse.lock(msg.sender, prevLockedFee + fee);
        }

        // Update fee rate of liquidity
        uint256 curLiqAmt = mkt.base.isSynth() ? liq.amount : liq.ids.length;
        uint256 curLocked = s2.feePurse.getLocked(liq.protoFeePurseId);
        liq.protoFeeRate = (mkt.base.isSynth() ? (curLocked * 10 ** 18) : curLocked) / curLiqAmt;
    }

    /// @dev Calculate and unlock liquidity fee for protocol in a non-ERC20 market
    /// @param s2 A state object
    /// @param mkt The market object
    /// @param liq The liquidity object
    function unlockFeeForProtocol(StructsLib.State2 storage s2, Structs.Market memory mkt, Structs.Liquidity storage liq) internal {
        uint256 remaining = mkt.base.isSynth() ? liq.amount : liq.ids.length;

        if (remaining == 0) {
            s2.feePurse.unlock(msg.sender, liq.protoFeePurseId);
            liq.protoFeeRate = 0;
            liq.protoFeePurseId = 0;
            return;
        }

        s2.feePurse.unlock(msg.sender, liq.protoFeePurseId);
        uint256 newAmtToLck = liq.protoFeeRate * remaining;
        newAmtToLck = mkt.base.isSynth() ? newAmtToLck / 10 ** 18 : newAmtToLck;
        liq.protoFeePurseId = (newAmtToLck > 0) ? s2.feePurse.lock(msg.sender, newAmtToLck) : 0;

        // Update fee rate of liquidity
        uint256 curLocked = s2.feePurse.getLocked(liq.protoFeePurseId);
        liq.protoFeeRate = (mkt.base.isSynth() ? (curLocked * 10 ** 18) : curLocked) / remaining;
    }

    /// @dev Calculate and lock liquidity fee for market creator in non-ERC20 market
    /// @param s2 A state object
    /// @param mkt The market object
    /// @param liq The liquidity object
    /// @param amount The amount of liquidity to lock fee for
    function lockFeeForMarketCreator(
        StructsLib.State2 storage s2,
        Structs.Market memory mkt,
        Structs.Liquidity storage liq,
        uint256 amount
    ) internal {
        uint256 fee = amount * mkt.commission;
        fee = mkt.base.isSynth() ? fee / 10 ** 18 : fee;

        if (fee > 0) {
            uint256 prevLockedFee = s2.feePurse.getLocked(liq.mktCreatorFeePurseId);
            if (prevLockedFee > 0) s2.feePurse.unlock(msg.sender, liq.mktCreatorFeePurseId);
            liq.mktCreatorFeePurseId = s2.feePurse.lock(msg.sender, prevLockedFee + fee);
        }

        // Update fee rate of liquidity
        uint256 curLiqAmt = mkt.base.isSynth() ? liq.amount : liq.ids.length;
        uint256 curLocked = s2.feePurse.getLocked(liq.mktCreatorFeePurseId);
        liq.mktCreatorFeeRate = (mkt.base.isSynth() ? (curLocked * 10 ** 18) : curLocked) / curLiqAmt;
    }

    /// @dev Calculate and unlock liquidity fee for market creator in a non-ERC20 market
    /// @param s2 A state object
    /// @param mkt The market object
    /// @param liq The liquidity object
    function unlockFeeForMarketCreator(StructsLib.State2 storage s2, Structs.Market memory mkt, Structs.Liquidity storage liq) internal {
        uint256 remaining = mkt.base.isSynth() ? liq.amount : liq.ids.length;

        if (remaining == 0) {
            s2.feePurse.unlock(msg.sender, liq.mktCreatorFeePurseId);
            liq.mktCreatorFeeRate = 0;
            liq.mktCreatorFeePurseId = 0;
            return;
        }

        s2.feePurse.unlock(msg.sender, liq.mktCreatorFeePurseId);
        uint256 newAmtToLck = liq.mktCreatorFeeRate * remaining;
        newAmtToLck = mkt.base.isSynth() ? newAmtToLck / 10 ** 18 : newAmtToLck;
        liq.mktCreatorFeePurseId = (newAmtToLck > 0) ? s2.feePurse.lock(msg.sender, newAmtToLck) : 0;

        // Update fee rate of liquidity
        uint256 curLocked = s2.feePurse.getLocked(liq.mktCreatorFeePurseId);
        liq.mktCreatorFeeRate = (mkt.base.isSynth() ? (curLocked * 10 ** 18) : curLocked) / remaining;
    }

    /// @dev Check if sender has the required badges for the market's liquidity providers
    /// @param s2 A state object
    /// @param marketId The market ID
    function checkMarketPutBadges(StructsLib.State2 storage s2, address marketId) internal view {
        (string[2][] memory reqPutBadges, ) = s2.marketCore.getReqBadges(marketId);
        if (reqPutBadges.length > 0) {
            uint256 len = reqPutBadges.length;
            for (uint256 i = 0; i < len; i++) {
                require(s2.badge.hasBadge(msg.sender, reqPutBadges[i][0], reqPutBadges[i][1]), "OC: MKT_BADGE_REQ");
            }
        }
    }
}
