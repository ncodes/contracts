// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "./StructsLib.sol";
import "../common/Structs.sol";
import "../common/MathLib.sol";
import "../market/MarketAuxLib.sol";
import "../common/StrippedInterfaces.sol";
import "../assetregistry/interfaces/IAssetRegistry.sol";

library AuxLib {
    using MarketAuxLib for Structs.Asset;

    /// @dev Checks if an address of a token can share in fees
    function isShareable(StructsLib.State2 storage state2, address addr) external view returns (bool) {
        return state2.assetReg.get(addr).sharable;
    }

    /// Checks if an address is a verified token
    function isVerified(StructsLib.State2 storage state2, address addr) external view returns (bool) {
        return state2.assetReg.get(addr).verified;
    }

    /// @dev Checks if an address is marked as a stable token
    function isStable(StructsLib.State2 storage state2, address addr) external view returns (bool) {
        return state2.assetReg.get(addr).stable;
    }

    /// @dev Checks if both addresses are stables
    function isStable(IAssetRegistry assetReg, Structs.Market memory m) external view returns (bool) {
        return assetReg.get(m.base.addr).stable && assetReg.get(m.quote.addr).stable;
    }

    /// @dev Checks if at order at index id exist
    /// @param id The order ID or index.
    function hasOrder(StructsLib.State storage state, uint256 id) public view returns (bool) {
        return id < state.orders.length && state.orders[id].marketId != address(0);
    }

    /// @dev Checks whether addr can create a dispute.
    /// Reverts if order is unknown.
    /// Returns false if market has a market manager
    /// Returns false if order has been released.
    /// Returns false if addr is not a provider or a taker.
    /// Returns false if order has not be marked as `paid` and time to pay has not been reached.
    /// Returns false if order dispute creation time is in the future
    /// @param state State object
    /// @param id The order ID.
    /// @param addr The address to check if permitted to create dispute.
    function canCreateDispute(
        StructsLib.State storage state,
        StructsLib.State2 storage state2,
        uint256 id,
        address addr
    ) public view returns (bool) {
        require(hasOrder(state, id), "OC: UNKNOWN_ORDER");
        Structs.Order memory o = state.orders[id];
        if (state2.marketCore.getMarket(o.marketId).manager != address(0)) return false;
        if (o.provider != addr && o.taker != addr) return false;
        if (o.released || o.cancelled || !o.paid) return false;
        if (o.disputeFrom > block.timestamp) return false;
        return true;
    }

    function isPerm(Structs.Market memory market) public pure returns (bool) {
        return market.perms.put || market.perms.swap;
    }

    /// @dev Checks whether a liquidity is empty
    function isLiquidityEmpty(Structs.Liquidity memory liq) public pure returns (bool) {
        return liq.amount == 0 && liq.ids.length == 0;
    }

    /// @dev Check whether a liquidity exists
    function isLiquidityExist(
        StructsLib.State storage state,
        address mid,
        address provider,
        uint256 lid
    ) public view returns (bool) {
        return state.liquidity[mid][provider].length > lid;
    }

    /// @dev Checks whether a liquidity exists and is non-zero (not empty)
    function hasNonZeroLiquidity(
        StructsLib.State storage state,
        address mid,
        address provider,
        uint256 lid
    ) public view returns (bool) {
        if (!isLiquidityExist(state, mid, provider, lid)) return false;
        Structs.Liquidity memory liq = state.liquidity[mid][provider][lid];
        return !isLiquidityEmpty(liq);
    }

    /// @dev Checks if an uint256 array has unique values
    function isUnique(uint256[] memory arr) public pure returns (bool) {
        if (arr.length == 0) return true;
        for (uint256 i = 0; i < arr.length - 1; i++) {
            for (uint256 j = i + 1; j < arr.length; j++) {
                if (arr[i] == arr[j]) return false;
            }
        }
        return true;
    }

    /// @dev Checks whether arr length is not more than 16
    function isMaxLen16(uint256[] memory arr) public pure returns (bool) {
        return arr.length <= 16;
    }

    /// @dev Checks whether addr is zero
    function isZero(address addr) public pure returns (bool) {
        return addr == address(0);
    }

    /// @dev Return _default if _target is zero, otherwise _target is returned
    function setOrDef(address _target, address _default) public pure returns (address) {
        return (_target != address(0)) ? _target : _default;
    }

    /// @dev Get fee to be charged from the given asset
    /// @return feeBp Fee basis point
    /// @return fixedFee Fee basis point
    /// @return curRate Fee basis point
    function getFeeInfo(
        IAssetRegistry assetReg,
        Structs.Asset memory asset,
        uint256 defaultBp
    )
        public
        view
        returns (
            uint256 feeBp,
            uint256 fixedFee,
            uint256 curRate
        )
    {
        Info memory inf = assetReg.get(asset.addr);
        if (inf.feeBp == 0) inf.feeBp = defaultBp;
        return (inf.feeBp, inf.feeFixed, inf.curRate);
    }

    /// @dev Check if addr owns a native NFT
    function hasNativeNFT(address nft, address addr) public view returns (bool) {
        return nft != address(0) && IERC721Strip(nft).balanceOf(addr) > 0;
    }

    function checkFungibleSwapParams(
        StructsLib.SwapSlot memory sp,
        Structs.Market memory mkt,
        Structs.Liquidity storage liq
    ) public view {
        require(mkt.quote.isNFT() || sp.amount > 0, "OC: AMOUNT_REQ");
        require(!mkt.quote.isNFT() || sp.amount == 0, "OC: AMOUNT_NREQ");
        require((sp.offerId > 0 && mkt.perms.allowZeroOfferPrice) || mkt.quote.isNFT() || sp.maxPrice > 0, "OC: MAX_PRICE_REQ");
        require(!mkt.quote.isNFT() || sp.maxPrice == 0, "OC: MAX_PRICE_NREQ");
        require(!mkt.quote.isNFT() || sp.ids.length > 0, "OC: IDS_REQ");
        require(mkt.quote.isNFT() || sp.ids.length == 0, "OC: IDS_NREQ");
        require(isMaxLen16(sp.ids), "OC: IDS_HSIZE");
        require(isUnique(sp.ids), "OC: IDS_NUNIQ");
        require(!liq.paused, "OC: LIQ_PAUSED");
        require(sp.amount <= liq.amount, "OC: LOW_LIQ");
        require(sp.offerId > 0 || sp.amount >= liq.minSwap, "OC: AMOUNT_BELOW_MIN_SWAP");
        require(sp.offerId > 0 || liq.maxSwap == 0 || sp.amount <= liq.maxSwap, "OC: AMOUNT_ABOVE_MAX_SWAP");
        require(sp.offerId > 0 || sp.maxPrice == 0 || sp.maxPrice >= liq.price, "OC: MAX_PRICE_TOO_LOW");
    }

    function checkNonFungibleSwapParams(
        StructsLib.SwapSlot memory sp,
        Structs.Market memory mkt,
        Structs.Liquidity storage liq
    ) public view {
        require(sp.amount == 0, "OC: AMOUNT_NREQ");
        require(!liq.paused, "OC: LIQ_PAUSED");
        require((sp.offerId > 0 && mkt.perms.allowZeroOfferPrice) || mkt.quote.isNFT() || sp.maxPrice > 0, "OC: MAX_PRICE_REQ");
        require(!mkt.quote.isNFT() || sp.maxPrice == 0, "OC: MAX_PRICE_NREQ");
        require(sp.offerId > 0 || sp.maxPrice == 0 || sp.maxPrice >= liq.price, "OC: MAX_PRICE_TOO_LOW");
        require(mkt.quote.isNFT() || sp.ids.length == 0, "OC: IDS_NREQ");
        require((sp.offerId > 0 && mkt.perms.allowZeroOfferPrice) || !mkt.quote.isNFT() || sp.ids.length > 0, "OC: IDS_REQ");
    }
}
