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

library LiquidityLib {
    using SafeERC20 for IERC20;
    using MarketAuxLib for Structs.Asset;
    using MarketAuxLib for Structs.Market;
    using AuxLib for uint256[];
    using AuxLib for Structs.Market;
    using AuxLib for Structs.Liquidity;
    using AuxLib for address;

    event UpdatedPrice(address indexed marketId, address indexed provider, address indexed manager, uint256 lid, uint256 price);
    event TogglePause(address indexed marketId, address indexed provider, uint256 lid, bool paused);
    event UpdatedLiquidityManager(address indexed marketId, address indexed provider, address indexed manager, address oldManager);
    event UpdatedLiquiditySwapBadges(address marketId, address provider, uint256 lid, string[2][] badges);

    /// @dev Returns matching want IDs.
    /// @param ids The IDs to search
    /// @param wantOrIds The IDs to match at least one of
    /// If wantOrIds is not empty, at least one entry must be included in ids.
    /// @param wantAndIds The IDs to match all of
    /// If wantAndIds and wantOrIds are empty, return entries in ids.
    /// If wantAndIds is not empty, all entries must be included in ids.
    /// @return matchIds The matching IDs
    function findMatchInWantIds(
        uint256[] memory ids,
        mapping(uint256 => bool) storage intIdx,
        uint256[] memory wantOrIds,
        uint256[] memory wantAndIds
    ) public returns (uint256[] memory) {
        if (wantOrIds.length == 0 && wantAndIds.length == 0) return ids;

        uint256[] memory matchIds = new uint256[](ids.length);
        mapping(uint256 => bool) storage matchIdx = intIdx;
        uint256 idx;

        uint256 andFound;
        for (uint256 i = 0; i < wantAndIds.length; i++) {
            for (uint256 j = 0; j < ids.length; j++) {
                if (wantAndIds[i] == ids[j] && !matchIdx[ids[j]]) {
                    matchIds[idx] = ids[j];
                    matchIdx[ids[j]] = true;
                    idx++;
                    andFound++;
                }
            }
        }

        if (andFound != wantAndIds.length) return new uint256[](0);

        bool orFound = wantOrIds.length == 0;
        for (uint256 i = 0; i < wantOrIds.length; i++) {
            for (uint256 j = 0; j < ids.length; j++) {
                if (wantOrIds[i] == ids[j]) {
                    if (!matchIdx[ids[j]]) matchIds[idx] = ids[j];
                    orFound = true;
                    break;
                }
            }
            if (orFound) break;
        }

        return (orFound) ? matchIds : new uint256[](0);
    }

    /// @dev Update the count of open disputes for a liquidity
    /// @param state State object
    /// @param marketId The market ID
    /// @param provider The address of the liquidity provider
    /// @param lid The liquidity ID
    /// @param incr True to increment, false to decrement
    function updateOpenDisputesCount(StructsLib.State storage state, address marketId, address provider, uint256 lid, bool incr) external {
        Structs.Liquidity storage liq = state.liquidity[marketId][provider][lid];
        if (incr) liq.openDisputes++;
        else liq.openDisputes--;
    }

    /// @dev Set an address as the liquidity manager for a market
    /// @param marketId The market ID
    /// @param manager The address of the manager
    function setLiquidityManager(StructsLib.State storage state, address marketId, address manager) external {
        address old = state.liqManagers[msg.sender][marketId];
        state.liqManagers[msg.sender][marketId] = manager;
        emit UpdatedLiquidityManager(marketId, msg.sender, manager, old);
    }

    /// @dev Allows liquidity manager to update a provider's liquidity
    /// @param state State object
    /// @param state2 State object
    /// @param owner The address of the liquidity owner
    /// @param lid The liquidity ID
    /// @param price The new price for the liquidity
    function updateLiquidityPrice(
        StructsLib.State storage state,
        StructsLib.State2 storage state2,
        address marketId,
        address owner,
        uint256 lid,
        uint256 price
    ) external {
        require(state.liqManagers[owner][marketId] == msg.sender, "OC: NOT_MANAGER");
        Structs.Liquidity storage liq = state.liquidity[marketId][owner][lid];
        require(price > 0, "OC: PRICE_REQ");
        Structs.Market memory market = state2.marketCore.getMarket(marketId);
        require(MarketAuxLib.isFungible(market.quote), "OC: PRICE_NREQ");
        liq.price = price;
        emit UpdatedPrice(marketId, owner, msg.sender, lid, price);
    }

    /// @dev Toggle liquidity pause state
    /// @param state The State object
    /// @param mid The market ID
    /// @param lid The liquidity ID
    function togglePause(StructsLib.State storage state, address mid, uint256 lid) external {
        require(AuxLib.hasNonZeroLiquidity(state, mid, msg.sender, lid), "OC: ZERO_LIQ");
        state.liquidity[mid][msg.sender][lid].paused = !state.liquidity[mid][msg.sender][lid].paused;
        emit TogglePause(mid, msg.sender, lid, state.liquidity[mid][msg.sender][lid].paused);
    }

    /// @dev Set swap badges for a liquidity
    /// @param state The State object
    /// @param state2 The State2 object
    /// @param mid The market ID
    /// @param lid The liquidity ID
    /// @param badges The badges to set
    function setSwapBadgeForLiquidity(
        StructsLib.State storage state,
        StructsLib.State2 storage state2,
        address mid,
        uint256 lid,
        string[2][] memory badges
    ) external {
        require(AuxLib.hasNonZeroLiquidity(state, mid, msg.sender, lid), "OC: ZERO_LIQ");
        require(badges.length <= 8, "OC: TOO_MANY_BADGES");
        state2.reqSwapBadges[mid][msg.sender][lid] = badges;
        emit UpdatedLiquiditySwapBadges(mid, msg.sender, lid, badges);
    }
}
