// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../core/interfaces/ICore.sol";
import "./structs.sol";
import "../common/SafeERC20.sol";
import "../market/MarketAuxLib.sol";
import "hardhat/console.sol";
import "../core/interfaces/IProviderHook.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/// @title ProxyLP
/// @notice A contract that allows a user to manage fungible liquidity pairs while providing
/// the user with the ability to cross-provide assets received after a swap to another market.
/// The aim is to allows users sell asset in one market and re-sell the received asset in another market.
/// The contract only supports market pairs where both the base and quote assets are onchain.
contract ProxyLP is Ownable, ERC165 {
    using SafeERC20 for IERC20;
    using MarketAuxLib for Structs.Market;
    using MarketAuxLib for Structs.Asset;

    ICore public core;
    /// @dev Maps market ID to liquidity ID to owner address.
    /// @dev This is used to check if a caller is permitted to manage a liquidity.
    mapping(address => mapping(uint256 => address)) public liqOwners;

    /// @dev Maps market ID to owner address to liquidity IDs.
    /// @dev This used to keep track of liquidity owned by this contract in a market on behalf of an owner.
    mapping(address => mapping(address => ProxyLPStructs.OwnedLiq)) public liqOwned;

    /// @dev Maps market ID to liquidity ID to cross liquidity.
    /// @dev This is used to keep track of cross liquidity in a market.
    mapping(address => mapping(uint256 => ProxyLPStructs.CrossLiquidity)) public crossLiqs;

    /// @notice Constructor
    /// @param _core The core contract address
    constructor(address _core) {
        core = ICore(_core);
    }

    event CoreUpdated(address indexed oldCore, address indexed newCore);
    event UpdatedFungibleLiquidity(address marketId, uint256 lid, address owner, uint256);

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IProviderHook).interfaceId || super.supportsInterface(interfaceId);
    }

    /// @notice Update the core contract address
    /// @param _core The new core contract address
    function updateCore(address _core) external onlyOwner {
        require(_core != address(0), "PC: ZERO_ADDRESS");
        emit CoreUpdated(address(core), _core);
        core = ICore(_core);
    }

    /// @notice Update the liquidity for a fungible market
    /// @param params The parameters for the liquidity update
    function updateFungibleLiquidity(ProxyLPStructs.UpdateFungibleLiquidityParams memory params) public payable {
        Structs.Market memory mkt = core.getMarket(params.marketId);
        require(mkt.base.isOnchain() && mkt.quote.isOnchain(), "PLP: PAIR_NOT_ONCHAIN");

        if (params.crossLiquidity.marketId != address(0)) {
            require(params.marketId != params.crossLiquidity.marketId, "PLP: SAME_MARKET");
            require(mkt.quote.addr == core.getMarket(params.crossLiquidity.marketId).base.addr, "PLP: CROSS_MKT_ASSET_MISMATCH");
            require(mkt.quote.assetType == core.getMarket(params.crossLiquidity.marketId).base.assetType, "PLP: CROSS_MKT_ASSET_MISMATCH");
        }

        Structs.Liquidity memory liq;
        if (core.hasLiquidity(params.marketId, address(this), params.lid)) {
            liq = core.getLiquidity(params.marketId, address(this), params.lid);
        }

        address owner = liqOwners[params.marketId][params.lid];
        require(owner == msg.sender || owner == address(0), "PLP: NOT_LIQ_OWNER");

        if (!params.deduct && params.amount > 0) {
            if (mkt.base.isERC20()) {
                IERC20(mkt.base.addr).safeTransferFrom(msg.sender, address(this), params.amount);
                IERC20(mkt.base.addr).approve(address(core), params.amount);
            } else if (mkt.base.isNative()) {
                require(msg.value == params.amount, "PLP: AMT_DEPOSIT_MISMATCH");
            }
        }

        uint256 lid = _handleFungibleLiquidityUpdate(params);

        // Withdraw any deducted liquidity
        if (params.deduct && params.amount > 0) {
            if (mkt.base.isERC20()) IERC20(mkt.base.addr).safeTransfer(msg.sender, params.amount);
            if (mkt.base.isNative()) payable(msg.sender).transfer(params.amount);
        }

        // Handle cross liquidity update
        ProxyLPStructs.CrossLiquidity storage cl = crossLiqs[params.marketId][lid];
        if (cl.marketId == address(0)) {
            cl.marketId = params.crossLiquidity.marketId;
            cl.owner = msg.sender;
            cl.price = params.crossLiquidity.price;
            cl.usePriceFromRegistry = params.crossLiquidity.usePriceFromRegistry;
            cl.priceScaleBps = params.crossLiquidity.priceScaleBps;
        }
        // If changing cross liquidity, withdraw old liquidity back to owner.
        // Add liquidity to the new market. Don't create a new liquidity in the new market if this contract
        // already has liquidity recorded before.
        // If the cross liquidity market is to be set to 0, withdraw the liquidity and send back to owner.
        else if (cl.marketId != params.crossLiquidity.marketId) {
            Structs.Liquidity memory oldCxLiq = core.getLiquidity(cl.marketId, address(this), cl.lid);
            if (oldCxLiq.amount > 0) {
                // Deduct liquidity from the old cross liquidity
                core.updateFungibleLiquidity(
                    StructsLib.UpdateFungibleLiquidityParams(
                        cl.marketId,
                        oldCxLiq.target,
                        cl.lid,
                        oldCxLiq.amount,
                        oldCxLiq.price,
                        oldCxLiq.timeToPay,
                        0,
                        oldCxLiq.wantOrIds,
                        oldCxLiq.wantAndIds,
                        oldCxLiq.priceScaleBps,
                        true,
                        oldCxLiq.paused,
                        oldCxLiq.usePriceFromRegistry
                    )
                );

                // Transfer deducted liquidity to the new cross liquidity
                // only if the new cross liquidity market is not address(0)
                if (params.crossLiquidity.marketId != address(0)) {
                    uint256 newLid = type(uint256).max;
                    ProxyLPStructs.OwnedLiq memory ownedLiq = liqOwned[params.crossLiquidity.marketId][cl.owner];
                    if (ownedLiq.isSet) newLid = ownedLiq.lid;

                    Structs.Market memory crossLiqMkt = core.getMarket(params.crossLiquidity.marketId);
                    if (crossLiqMkt.base.isERC20()) {
                        IERC20(crossLiqMkt.base.addr).approve(address(core), oldCxLiq.amount);
                    }

                    newLid = _handleFungibleLiquidityUpdate(
                        ProxyLPStructs.UpdateFungibleLiquidityParams(
                            params.crossLiquidity.marketId,
                            params.crossLiquidity,
                            address(0),
                            newLid,
                            oldCxLiq.amount,
                            params.crossLiquidity.price,
                            0,
                            0,
                            new uint256[](0),
                            new uint256[](0),
                            params.crossLiquidity.priceScaleBps,
                            false,
                            false,
                            params.crossLiquidity.usePriceFromRegistry
                        )
                    );

                    cl.marketId = params.crossLiquidity.marketId;
                    cl.lid = newLid;
                    cl.isLiqSet = true;
                    liqOwners[cl.marketId][newLid] = cl.owner;
                    liqOwned[cl.marketId][cl.owner] = ProxyLPStructs.OwnedLiq(newLid, true);

                    // Only create a reverse cross liquidity if the new/updated liquidity's market quote matches the
                    // initial liquidity's market base asset
                    crossLiqs[cl.marketId][newLid].owner = cl.owner;
                    if (crossLiqMkt.quote.addr == mkt.base.addr && crossLiqMkt.quote.assetType == mkt.base.assetType) {
                        crossLiqs[cl.marketId][newLid].marketId = params.marketId;
                        crossLiqs[cl.marketId][newLid].lid = params.lid;
                        crossLiqs[cl.marketId][newLid].isLiqSet = true;
                    }
                } else {
                    // Transfer the deducted liquidity back to the owner
                    Structs.Market memory crossLiqMkt = core.getMarket(cl.marketId);
                    if (crossLiqMkt.base.isERC20()) IERC20(crossLiqMkt.base.addr).safeTransfer(cl.owner, oldCxLiq.amount);
                    if (crossLiqMkt.base.isNative()) payable(cl.owner).transfer(oldCxLiq.amount);
                }
            }

            cl.marketId = params.crossLiquidity.marketId;
            if (cl.marketId != address(0)) {
                cl.price = params.crossLiquidity.price;
                cl.usePriceFromRegistry = params.crossLiquidity.usePriceFromRegistry;
                cl.priceScaleBps = params.crossLiquidity.priceScaleBps;
            }
        }
    }

    /// @notice Handles the deposit of assets and updates fungible liquidity
    /// @param params The liquidity update parameters
    /// @return lid The liquidity ID
    function _handleFungibleLiquidityUpdate(ProxyLPStructs.UpdateFungibleLiquidityParams memory params) private returns (uint256 lid) {
        Structs.Market memory mkt = core.getMarket(params.marketId);
        uint256 value = !params.deduct && mkt.base.isNative() ? params.amount : 0;

        lid = core.updateFungibleLiquidity{value: value}(
            StructsLib.UpdateFungibleLiquidityParams(
                params.marketId,
                params.target,
                params.lid,
                params.amount,
                params.price,
                params.timeToPay,
                params.expireAt,
                params.wantOrIds,
                params.wantAndIds,
                params.priceScaleBps,
                params.deduct,
                params.pause,
                params.usePriceFromRegistry
            )
        );

        liqOwners[params.marketId][lid] = msg.sender;
        liqOwned[params.marketId][msg.sender] = ProxyLPStructs.OwnedLiq(lid, true);

        emit UpdatedFungibleLiquidity(params.marketId, lid, msg.sender, params.amount);
    }

    function beforeSwap(StructsLib.SwapQuoteForBaseParams memory params) external {
        // TODO: Implement
    }

    /// @notice Called when an interactive swap is started on an instant swap is completed on a liquidity managed by this contract.
    /// @param params The parameters for the swap
    /// @param swapResult The swap result
    function afterSwap(StructsLib.SwapQuoteForBaseParams memory params, StructsLib.SwapResult memory swapResult) public {
        if (!swapResult.instant || swapResult.quoteReceived <= 0) return;

        Structs.Market memory mkt = core.getMarket(params.marketId);

        // Find the cross liquidity. If cross liquidity does not have a market,
        // transfer the swapped quote amount received to the cross liquidity owner.
        ProxyLPStructs.CrossLiquidity storage cl = crossLiqs[params.marketId][params.lid];
        if (cl.marketId == address(0)) {
            if (mkt.quote.isERC20()) IERC20(mkt.quote.addr).safeTransfer(cl.owner, swapResult.quoteReceived);
            if (mkt.quote.isNative()) payable(cl.owner).transfer(swapResult.quoteReceived);
            return;
        }

        // If quote side is ERC20, approve the quote amount received for transfer to the cross liquidity
        if (mkt.quote.isERC20()) {
            IERC20(mkt.quote.addr).approve(address(core), swapResult.quoteReceived);
        }

        // If the cross liquidity object has a liquidity ID set, get the liquidity.
        Structs.Liquidity memory crossLiq;
        if (cl.isLiqSet) {
            crossLiq = core.getLiquidity(cl.marketId, address(this), cl.lid);
        }

        // Create the liquidity for the cross liquidity or update
        uint256 lid = core.updateFungibleLiquidity{value: mkt.quote.isNative() ? swapResult.quoteReceived : 0}(
            StructsLib.UpdateFungibleLiquidityParams(
                cl.marketId,
                (!cl.isLiqSet) ? address(0) : crossLiq.target,
                params.lid,
                swapResult.quoteReceived,
                (!cl.isLiqSet) ? cl.price : crossLiq.price,
                (!cl.isLiqSet) ? 0 : crossLiq.timeToPay,
                0,
                (!cl.isLiqSet) ? new uint256[](0) : crossLiq.wantOrIds,
                (!cl.isLiqSet) ? new uint256[](0) : crossLiq.wantAndIds,
                (!cl.isLiqSet) ? cl.priceScaleBps : crossLiq.priceScaleBps,
                false,
                (!cl.isLiqSet) ? false : crossLiq.paused,
                (!cl.isLiqSet) ? cl.usePriceFromRegistry : crossLiq.usePriceFromRegistry
            )
        );

        // For new cross liquidity, set the liquidity information, set the owner and create a
        // reverse cross liquidity targetting the swap liquidity.
        if (!cl.isLiqSet) {
            cl.isLiqSet = true;
            cl.lid = lid;
            liqOwners[cl.marketId][lid] = cl.owner;
            liqOwned[cl.marketId][cl.owner] = ProxyLPStructs.OwnedLiq(lid, true);
            crossLiqs[cl.marketId][lid] = ProxyLPStructs.CrossLiquidity(cl.owner, params.marketId, params.lid, true, 0, false, 0);
        }
    }

    function onRelease(StructsLib.SwapResult memory swapResult) external {}
    function onCancel(uint256 orderId) external {}
    function onPaid(uint256 orderId) external {}
    receive() external payable {}
}
