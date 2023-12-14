// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../common/Structs.sol";

library MarketAuxLib {
    function isSynth(Structs.Asset memory asset) public pure returns (bool) {
        return (asset.assetType == Structs.AssetType.SYNTH);
    }

    function isERC20(Structs.Asset memory asset) public pure returns (bool) {
        return (asset.assetType == Structs.AssetType.ERC20);
    }

    function isERC721(Structs.Asset memory asset) public pure returns (bool) {
        return (asset.assetType == Structs.AssetType.ERC721);
    }

    function isERC1155(Structs.Asset memory asset) public pure returns (bool) {
        return (asset.assetType == Structs.AssetType.ERC1155);
    }

    function isNFT(Structs.Asset memory asset) public pure returns (bool) {
        return isERC721(asset) || isERC1155(asset);
    }

    function isFungible(Structs.Asset memory asset) public pure returns (bool) {
        return isSynth(asset) || isERC20(asset);
    }

    function isInstantMarket(Structs.Market memory mkt) public pure returns (bool) {
        return ((isERC20(mkt.base) && isERC20(mkt.quote)) ||
            (isERC20(mkt.base) && isNFT(mkt.quote)) ||
            (isNFT(mkt.base) && isERC20(mkt.quote)) ||
            (isNFT(mkt.base) && isNFT(mkt.quote)));
    }

    function hasERC20(Structs.Market memory mkt) public pure returns (bool) {
        return isERC20(mkt.base) || isERC20(mkt.quote);
    }

    function isFungible(Structs.Market memory mkt) public pure returns (bool) {
        return (isERC20(mkt.base) || isSynth(mkt.base)) && (isERC20(mkt.quote) || isSynth(mkt.quote));
    }

    function isOnchain(Structs.Asset memory asset) public pure returns (bool) {
        return isERC20(asset) || isNFT(asset);
    }

    function getPayer(Structs.Market memory mkt, Structs.Order storage o) public view returns (address) {
        address payer;
        if (isERC20(mkt.base) && isSynth(mkt.quote)) {
            payer = o.taker;
        } else if (isSynth(mkt.base) && isSynth(mkt.quote)) {
            payer = o.taker;
        } else if (isSynth(mkt.base) && (isERC20(mkt.quote) || isNFT(mkt.quote))) {
            payer = o.provider;
        } else if (isNFT(mkt.base) && isSynth(mkt.quote)) {
            payer = o.taker;
        }
        return payer;
    }
}
