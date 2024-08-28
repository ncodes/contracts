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
import "./LiqAuxLib.sol";

library FungibleLiquidityLib {
    using SafeERC20 for IERC20;
    using MarketAuxLib for Structs.Asset;
    using MarketAuxLib for Structs.Market;
    using AuxLib for uint256[];
    using AuxLib for Structs.Market;
    using AuxLib for Structs.Liquidity;
    using AuxLib for address;

    event UpdatedFungibleLiquidity(
        address indexed provider,
        address indexed marketId,
        address target,
        bool deduct,
        bool paused,
        uint256 liq,
        uint256 amount,
        uint256 price,
        uint256[] wantOrIds,
        uint256[] wantAndIds,
        uint256 timeToPay
    );

    /// @dev Create or update fungible liquidity.
    /// Covers ERC20/ERC20, ERC20/SYNTH, ERC20/NFT, ERC20/NATIVE,
    /// SYNTH/ERC20, SYNTH/SYNTH, SYNTH/NFT,
    /// NATIVE/ERC20, NATIVE/SYNTH, NATIVE/NFT, NATIVE/NATIVE
    /// @param s1 Storage struct.
    /// @param s2 Storage struct 2.
    /// @param slot The parameters needed to create or update liquidity.
    function updateFungibleLiquidity(
        StructsLib.State storage s1,
        StructsLib.State2 storage s2,
        StructsLib.UpdateLiquiditySlot memory slot
    ) external {
        require(slot.deduct || s2.marketCore.isPutPermitted(slot.marketId, msg.sender));
        Structs.Market memory mkt = s2.marketCore.getMarket(slot.marketId);
        require(mkt.base.isFungible(), "OC: UNEXP_BASE");
        require(!mkt.isInstantMarket() || slot.timeToPay == 0, "OC: TTP_NREQ");
        require(slot.timeToPay == 0 || slot.timeToPay >= s1.minTimeToPay, "OC: LOW_TTP");
        require(mkt.quote.isNFT() || slot.price > 0, "OC: PRICE_REQ");
        require(!mkt.quote.isNFT() || slot.price == 0, "OC: PRICE_NREQ");
        require(mkt.quote.isNFT() || (slot.wantOrIds.length == 0 && slot.wantAndIds.length == 0), "OC: WANT_IDS_NREQ");
        require(slot.wantOrIds.isUnique() && slot.wantAndIds.isUnique(), "OC: WANT_IDS_NUNIQ");
        require(slot.wantOrIds.isMaxLen16() && slot.wantAndIds.isMaxLen16(), "OC: WANT_IDS_HSIZE");

        // Check if the sender has the required market PUT badges.
        LiqAuxLib.checkMarketPutBadges(s2, slot.marketId);

        // Get the liquidity. If the liquidity does not exist, create a new one
        Structs.Liquidity storage liq;
        if (AuxLib.isLiquidityExist(s1, slot.marketId, msg.sender, slot.lid)) {
            liq = s1.liquidity[slot.marketId][msg.sender][slot.lid];
        } else {
            uint256[] memory zero = new uint256[](0);
            s1.liquidity[slot.marketId][msg.sender].push(
                Structs.Liquidity(zero, 0, 0, 0, 0, 0, 0, 0, 0, 0, zero, zero, false, slot.target)
            );
            slot.lid = s1.liquidity[slot.marketId][msg.sender].length - 1;
            liq = s1.liquidity[slot.marketId][msg.sender][slot.lid];
        }

        // For new liquidity, ensure amount is provided.
        require(!liq.isLiquidityEmpty() || slot.amount > 0, "OC: AMOUNT_REQ");

        // Handle increment
        // - Increment listing pool balance if BASE asset is verified and market is not permissioned
        // - Transfer BASE if it is an ERC20
        // - If market does not involve an ERC20, lock fee in FeePurse
        if (!slot.deduct && slot.amount > 0) {
            liq.amount += slot.amount;
            mkt.numLiquidity += slot.amount;

            if (mkt.base.isERC20()) {
                IERC20(mkt.base.addr).safeTransferFrom(msg.sender, address(this), slot.amount);
            }

            if (mkt.base.isNative()) {
                require(msg.value == slot.amount, "OC: INV_DEPOSIT");
            }

            if (!mkt.hasERC20OrNative()) {
                LiqAuxLib.lockFeeForProtocol(s1, s2, mkt, liq, slot.amount);
                LiqAuxLib.lockFeeForMarketCreator(s2, mkt, liq, slot.amount);
            }
        }

        // Handle decrement
        // - There must be sufficient liquidity
        // - When both base and quote side are synthetic and liquidity is has been fully removed, transfer fee back to sender
        // - Decrement listing pool balance if BASE is verified and market is not permissioned
        // - Transfer BASE back to sender if it is an ERC20
        // - If market does not involve an ERC20, release and unlock fee in FeePurse
        if (slot.deduct && slot.amount > 0) {
            require(liq.amount >= slot.amount, "OC: LOW_LIQ");
            liq.amount -= slot.amount;
            mkt.numLiquidity -= slot.amount;

            if (mkt.base.isERC20()) {
                IERC20(mkt.base.addr).safeTransfer(msg.sender, slot.amount);
            }

            if (mkt.base.isNative()) {
                payable(msg.sender).transfer(slot.amount);
            }

            if (!mkt.hasERC20OrNative()) {
                LiqAuxLib.unlockFeeForProtocol(s2, mkt, liq);
                LiqAuxLib.unlockFeeForMarketCreator(s2, mkt, liq);
            }
        }

        liq.timeToPay = slot.timeToPay;
        liq.price = slot.price;
        liq.wantAndIds = slot.wantAndIds;
        liq.wantOrIds = slot.wantOrIds;
        liq.target = slot.target;
        liq.paused = slot.pause;
        s2.marketCore.setCounters(slot.marketId, false, false, true, mkt.numLiquidity);

        emit UpdatedFungibleLiquidity(
            msg.sender,
            slot.marketId,
            slot.target,
            slot.deduct,
            slot.pause,
            slot.lid,
            slot.amount,
            slot.price,
            slot.wantOrIds,
            slot.wantAndIds,
            slot.timeToPay
        );
    }
}
