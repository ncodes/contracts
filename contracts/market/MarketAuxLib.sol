// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../common/Structs.sol";

library MarketAuxLib {
    
/// @dev Check if an asset is a native asset.
    /// @param asset The asset object
    /// @return True if the asset is a native asset
    function isNative(Structs.Asset memory asset) public pure returns (bool) {
        return (asset.assetType == Structs.AssetType.NATIVE);
    }
    
    /// @dev Check if an asset is a synthetic asset.
    /// @param asset The asset object
    /// @return True if the asset is a synthetic asset
    function isSynth(Structs.Asset memory asset) public pure returns (bool) {
        return (asset.assetType == Structs.AssetType.SYNTH);
    }

    /// @dev Check if an asset is an ERC20 asset.
    /// @param asset The asset object
    /// @return True if the asset is an ERC20 asset
    function isERC20(Structs.Asset memory asset) public pure returns (bool) {
        return (asset.assetType == Structs.AssetType.ERC20);
    }

    /// @dev Check if an asset is an ERC721 asset.
    /// @param asset The asset object
    /// @return True if the asset is an ERC721 asset
    function isERC721(Structs.Asset memory asset) public pure returns (bool) {
        return (asset.assetType == Structs.AssetType.ERC721);
    }

    /// @dev Check if an asset is an ERC1155 asset.
    /// @param asset The asset object
    /// @return True if the asset is an ERC1155 asset
    function isERC1155(Structs.Asset memory asset) public pure returns (bool) {
        return (asset.assetType == Structs.AssetType.ERC1155);
    }

    /// @dev Check if an asset is either an ERC721 or ERC1155 asset.
    /// @param asset The asset object
    /// @return True if the asset is one of the two
    function isNFT(Structs.Asset memory asset) public pure returns (bool) {
        return isERC721(asset) || isERC1155(asset);
    }

    /// @dev Check if an asset is either an ERC20, synthetic, or native asset.
    /// @param asset The asset object
    /// @return True if the asset is one of the two
    function isFungible(Structs.Asset memory asset) public pure returns (bool) {
        return isSynth(asset) || isERC20(asset) || isNative(asset);
    }

    /// @dev Check if a market includes an ERC20, synthetic or native asset on the base or quote side.
    /// @param mkt The market object
    /// @return True if the market includes an ERC20 or synthetic asset
    function isFungible(Structs.Market memory mkt) public pure returns (bool) {
        return (isERC20(mkt.base) || isSynth(mkt.base) || isNative(mkt.base)) && (isERC20(mkt.quote) || isSynth(mkt.quote) || isNative(mkt.quote));
    }
    
    /// @dev Check if a market is an instant market (both assets are on-chain).
    /// @param mkt The market object
    /// @return True if the market is an instant market
    function isInstantMarket(Structs.Market memory mkt) public pure returns (bool) {
        return ((isERC20(mkt.base) && isERC20(mkt.quote)) ||
            (isERC20(mkt.base) && isNFT(mkt.quote)) ||
            (isERC20(mkt.base) && isNative(mkt.quote)) ||
            
            (isNFT(mkt.base) && isERC20(mkt.quote)) ||
            (isNFT(mkt.base) && isNFT(mkt.quote))) || 
            (isNFT(mkt.base) && isNative(mkt.quote)) ||
            
            (isNative(mkt.base) && isNative(mkt.quote)) ||
            (isNative(mkt.base) && isERC20(mkt.quote)) ||
            (isNative(mkt.base) && isNFT(mkt.quote));
    }

    /// @dev Check if a market includes an ERC20 or native asset on the base or quote side.
    /// @param mkt The market object
    /// @return True if the market includes an ERC20 asset
    function hasERC20OrNative(Structs.Market memory mkt) public pure returns (bool) {
        return isERC20(mkt.base) || isERC20(mkt.quote) || isNative(mkt.base) || isNative(mkt.quote);
    }


    /// @dev Check if an asset exist on-chain
    /// @param asset The asset object
    /// @return True if the asset exist on-chain
    function isOnchain(Structs.Asset memory asset) public pure returns (bool) {
        return isERC20(asset) || isNFT(asset) || isNative(asset);
    }

    /// @dev Determine the payer of the swap order.
    /// @param mkt The market object
    /// @param o The order object
    function getPayer(Structs.Market memory mkt, Structs.Order storage o) public view returns (address) {
        address payer;
        if (isOnchain(mkt.base) && isSynth(mkt.quote)) {
            payer = o.taker;
        } else if (isSynth(mkt.base) && isSynth(mkt.quote)) {
            payer = o.taker;
        } else if (isSynth(mkt.base) && isOnchain(mkt.quote)) {
            payer = o.provider;
        }
        return payer;
    }
}
