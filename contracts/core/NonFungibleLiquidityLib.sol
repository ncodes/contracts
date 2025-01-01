// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

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
import "./LiqAuxLib.sol";

library NonFungibleLiquidityLib {
    using MarketAuxLib for Structs.Asset;
    using MarketAuxLib for Structs.Market;
    using AuxLib for uint256[];
    using AuxLib for Structs.Market;
    using AuxLib for Structs.Liquidity;
    using AuxLib for address;

    event UpdatedNonFungibleLiquidity(
        address indexed provider,
        address indexed marketId,
        address target,
        bool deduct,
        bool paused,
        bool usePriceFromRegistry,
        uint256 lid,
        uint256[] ids,
        uint256 price,
        uint256[] wantOrIds,
        uint256[] wantAndIds,
        uint256 timeToPay,
        int256 priceScaleBps
    );

    /// @dev Create or update non-fungible liquidity.
    /// Covers NFT/ERC20, NFT/SYNTH, NFT/NFT
    /// @param s1 Storage struct.
    /// @param s2 Storage struct 2.
    /// @param slot The parameters needed to create or update liquidity.
    function updateNonFungibleLiquidity(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        StructsLib.UpdateLiquiditySlot memory slot
    ) external returns (uint256) {
        require(slot.deduct || s2.marketCore.isPutPermitted(slot.marketId, msg.sender));
        Structs.Market memory mkt = s2.marketCore.getMarket(slot.marketId);
        require(mkt.base.isNFT(), "OC: UNEXP_BASE");
        require(!mkt.isInstantMarket() || slot.timeToPay == 0, "OC: TTP_NREQ");
        require(slot.timeToPay == 0 || slot.timeToPay >= s1.minTimeToPay, "OC: LOW_TTP");
        require(mkt.quote.isFungible() || slot.price == 0, "OC: PRICE_NREQ");
        require(mkt.quote.isFungible() || !slot.usePriceFromRegistry, "OC: USE_PRICE_FROM_REG_NREQ");
        require(!mkt.quote.isFungible() || slot.usePriceFromRegistry || slot.price > 0, "OC: PRICE_REQ");
        require(!mkt.quote.isFungible() || (slot.wantOrIds.length == 0 && slot.wantAndIds.length == 0), "OC: WANT_IDS_NREQ");
        require(slot.wantOrIds.isUnique() && slot.wantAndIds.isUnique(), "OC: WANT_IDS_NUNIQ");
        require(slot.wantOrIds.isMaxLen16() && slot.wantAndIds.isMaxLen16(), "OC: WANT_IDS_HSIZE");
        require(slot.ids.isMaxLen16(), "OC: IDS_HSIZE");
        require(slot.ids.isUnique(), "OC: IDS_NUNIQ");

        // Check if the sender has the required market PUT badges.
        LiqAuxLib.checkMarketPutBadges(s2, slot.marketId);

        // Load price from registry if requested
        if (slot.usePriceFromRegistry) {
            slot.price = s2.priceReg.getBasePrice(mkt.base.addr, mkt.quote.addr, slot.priceScaleBps);
        }

        // Get the liquidity. If the liquidity does not exist, create a new one
        Structs.Liquidity storage liq;
        if (AuxLib.isLiquidityExist(s1, slot.marketId, msg.sender, slot.lid)) {
            liq = s1.liquidity[slot.marketId][msg.sender][slot.lid];
        } else {
            uint256[] memory zero = new uint256[](0);
            s1.liquidity[slot.marketId][msg.sender].push(
                Structs.Liquidity(
                    zero,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    zero,
                    zero,
                    slot.priceScaleBps,
                    false,
                    slot.usePriceFromRegistry,
                    slot.target
                )
            );
            slot.lid = s1.liquidity[slot.marketId][msg.sender].length - 1;
            liq = s1.liquidity[slot.marketId][msg.sender][slot.lid];
        }

        // For new liquidity, ensure ids is not empty
        require(!liq.isLiquidityEmpty() || slot.ids.length > 0, "OC: REQ_IDS");

        // Handle increment
        // - Transfer the base asset into the contract
        // - Increment listing pool balance if BASE asset is verified and market is not permissioned
        if (!slot.deduct) {
            uint256 numIds = slot.ids.length;
            mkt.numLiquidity += numIds;

            for (uint256 i = 0; i < numIds; i++) {
                liq.ids.push(slot.ids[i]);
                if (mkt.base.isERC721()) {
                    IERC721(mkt.base.addr).transferFrom(msg.sender, address(this), slot.ids[i]);
                } else {
                    IERC1155(mkt.base.addr).safeTransferFrom(msg.sender, address(this), slot.ids[i], 1, "");
                }
            }

            if (!mkt.hasERC20OrNative()) {
                LiqAuxLib.lockFeeForProtocol(s1, s2, mkt, liq, numIds);
                LiqAuxLib.lockFeeForMarketCreator(s2, mkt, liq, numIds);
            }
        }

        // Handle decrement
        // - Remove indexes provided in slot.ids
        // - Transfer asset back to owner
        // - Decrement listing pool balance if BASE is verified and market is not permissioned
        if (slot.deduct && slot.ids.length > 0) {
            uint256 popped = 0;
            for (uint256 i = 0; i < slot.ids.length; i++) {
                if (slot.ids[i] - popped >= liq.ids.length) continue;
                uint256 id = liq.ids[slot.ids[i] - popped];
                liq.ids[slot.ids[i] - popped] = liq.ids[liq.ids.length - 1];
                liq.ids.pop();
                popped++;
                if (mkt.base.isERC721()) {
                    IERC721(mkt.base.addr).transferFrom(address(this), msg.sender, id);
                } else {
                    IERC1155(mkt.base.addr).safeTransferFrom(address(this), msg.sender, id, 1, "");
                }
            }
            if (!mkt.hasERC20OrNative()) {
                LiqAuxLib.unlockFeeForProtocol(s2, mkt, liq);
                LiqAuxLib.unlockFeeForMarketCreator(s2, mkt, liq);
            }
            mkt.numLiquidity -= popped;
        }

        liq.timeToPay = slot.timeToPay;
        liq.price = slot.price;
        liq.wantAndIds = slot.wantAndIds;
        liq.wantOrIds = slot.wantOrIds;
        liq.target = slot.target;
        liq.paused = slot.pause;
        liq.usePriceFromRegistry = slot.usePriceFromRegistry;
        liq.priceScaleBps = slot.priceScaleBps;
        s2.marketCore.setCounters(slot.marketId, false, false, true, mkt.numLiquidity);

        emit UpdatedNonFungibleLiquidity(
            msg.sender,
            slot.marketId,
            slot.target,
            slot.deduct,
            slot.pause,
            slot.usePriceFromRegistry,
            slot.lid,
            slot.ids,
            slot.price,
            slot.wantOrIds,
            slot.wantAndIds,
            slot.timeToPay,
            slot.priceScaleBps
        );

        return slot.lid;
    }
}
