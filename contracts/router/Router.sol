// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../common/Ownable.sol";
import "../core/interfaces/ICore.sol";
import "../providerregistry/interfaces/IProviderRegistry.sol";
import "../common/Structs.sol";
import "../token/interfaces/IERC20.sol";
import "hardhat/console.sol";
import "../core/StructsLib.sol";

struct Liquidity {
    uint256 provider;
    uint256 lid;
    uint256 amount;
    uint256 maxPrice;
}

struct Route {
    Liquidity[] liqs;
    address market;
}

struct RouteParams {
    uint256 deadline;
    uint256 operator;
    Route[] routes;
    address target;
}

contract Router is Ownable {
    ICore public core;
    IProviderRegistry public provReg;

    event UpdatedCore(address addr);
    event UpdatedProvReg(address addr);
    event Routed(address sender, address target, uint256 operator, uint routeCount);

    /// @notice Router contract is responsible for routing swaps to markets and liquidities providers
    /// @param _core The address of the core contract
    constructor(address _core, address _provReg) {
        core = ICore(_core);
        provReg = IProviderRegistry(_provReg);
    }

    /// @notice Set the core contract address
    /// @param _core The address of the core contract
    function setCore(address _core) public onlyOwner {
        core = ICore(_core);
        emit UpdatedCore(_core);
    }

    /// @notice Set the provider registry contract address
    /// @param _provReg The address of the provider registry contract
    function setProviderRegistry(address _provReg) public onlyOwner {
        provReg = IProviderRegistry(_provReg);
        emit UpdatedProvReg(_provReg);
    }

    /// @dev Check if an asset is a native asset.
    /// @param asset The asset object
    /// @return True if the asset is a native asset
    function isNative(Structs.Asset memory asset) public pure returns (bool) {
        return (asset.assetType == Structs.AssetType.NATIVE);
    }

    /// @dev Check if an asset is an ERC20 asset.
    /// @param asset The asset object
    /// @return True if the asset is an ERC20 asset
    function isERC20(Structs.Asset memory asset) public pure returns (bool) {
        return (asset.assetType == Structs.AssetType.ERC20);
    }

    function setOr(address _target, address _default) internal pure returns (address) {
        return (_target != address(0)) ? _target : _default;
    }

    // is expired modifier
    modifier notExpired(uint256 expireAt) {
        require(expireAt == 0 || expireAt > block.timestamp, "ROUTER: EXPIRED_TX");
        _;
    }

    function route(RouteParams calldata routeParams) public payable notExpired(routeParams.deadline) {
        require(routeParams.routes.length > 0, "ROUTER: NO_ROUTES");

        Structs.Market memory mkt;
        uint256[] memory startBaseBals = new uint256[](routeParams.routes.length);
        uint256[] memory endBaseBals = new uint256[](routeParams.routes.length);
        Structs.Asset[] memory baseAddrs = new Structs.Asset[](routeParams.routes.length);

        for (uint256 i = 0; i < routeParams.routes.length; i++) {
            Route memory r = routeParams.routes[i];
            mkt = core.getMarket(r.market);
            require((isERC20(mkt.base) || isNative(mkt.base)) && (isERC20(mkt.quote) || isNative(mkt.quote)), "ROUTER: INV_PAIR");
            require(r.liqs.length > 0, "ROUTER: NO_LIQ");
            baseAddrs[i] = mkt.base;

            startBaseBals[i] = isERC20(mkt.base) ? IERC20(mkt.base.addr).balanceOf(address(this)) : address(this).balance;

            // Approve core to spend total supply of quote asset
            if (isERC20(mkt.quote)) {
                IERC20(mkt.quote.addr).approve(address(core), IERC20(mkt.quote.addr).totalSupply());
            }

            uint256 spentAmt = 0;
            uint256 returnedAmt = 0;
            for (uint256 j = 0; j < r.liqs.length; j++) {
                Liquidity memory liq = r.liqs[j];
                address provider = provReg.get(liq.provider);
                require(provider != address(0), "ROUTER: UNKNOWN_PROVIDER");

                uint decimals = isERC20(mkt.quote) ? IERC20(mkt.quote.addr).decimals() : 18;
                uint256 quoteAmt = (liq.amount * liq.maxPrice) / 10 ** decimals;

                // Transfer quote asset to router for only the first route.
                // For subsequent routes, the base balance from the previous route is used.
                // We must ensure that the final base balance from the previous route is
                // sufficient for the current route.
                if (i == 0) {
                    if (isERC20(mkt.quote)) {
                        IERC20(mkt.quote.addr).transferFrom(msg.sender, address(this), quoteAmt);
                    } else {
                        require(msg.value - spentAmt >= quoteAmt, "ROUTER: INSUFFICIENT_BALANCE");
                        spentAmt += quoteAmt;
                    }
                } else {
                    spentAmt += quoteAmt;
                    require(endBaseBals[i - 1] >= spentAmt, "ROUTER: INSUFFICIENT_BALANCE");
                }

                if (isERC20(mkt.quote)) {
                    uint256 operator = routeParams.operator;
                    core.swapQuoteForBase(
                        StructsLib.SwapQuoteForBaseParams({
                            marketId: r.market,
                            provider: provider,
                            recipient: address(0),
                            lid: liq.lid,
                            amount: liq.amount,
                            maxPrice: liq.maxPrice,
                            ids: new uint256[](0),
                            expireAt: 0,
                            operator: operator,
                            marketMgrData: ""
                        })
                    );
                } else {
                    uint256 operator = routeParams.operator;
                    uint256 expectedAfterBal = address(this).balance - quoteAmt;
                    core.swapQuoteForBase{value: quoteAmt}(
                        StructsLib.SwapQuoteForBaseParams({
                            marketId: r.market,
                            provider: provider,
                            recipient: address(0),
                            lid: liq.lid,
                            amount: liq.amount,
                            maxPrice: liq.maxPrice,
                            ids: new uint256[](0),
                            expireAt: 0,
                            operator: operator,
                            marketMgrData: ""
                        })
                    );
                    returnedAmt += address(this).balance - expectedAfterBal;
                }
            }

            endBaseBals[i] = (isERC20(mkt.base)) ? IERC20(mkt.base.addr).balanceOf(address(this)) : address(this).balance;

            // Transfer left over base from previous route to the sender
            if (i > 0) {
                uint leftOver = endBaseBals[i - 1] - spentAmt;
                if (leftOver > 0) {
                    if (isERC20(baseAddrs[i - 1])) {
                        IERC20(baseAddrs[i - 1].addr).transfer(msg.sender, leftOver);
                    } else {
                        payable(msg.sender).transfer(leftOver);
                    }
                }
            }

            // Transfer left over quote to the sender
            if (isERC20(mkt.quote)) {
                uint quoteBal = IERC20(mkt.quote.addr).balanceOf(address(this));
                IERC20(mkt.quote.addr).transfer(msg.sender, quoteBal);
            }

            // Transfer returned quote to the sender
            if (returnedAmt > 0) {
                payable(msg.sender).transfer(returnedAmt);
            }
        }

        // Transfer final base balances to the beneficiary
        uint256 outputBaseBal = endBaseBals[routeParams.routes.length - 1];
        if (isERC20(mkt.base)) {
            IERC20(mkt.base.addr).transfer(setOr(routeParams.target, msg.sender), outputBaseBal);
        } else {
            payable(setOr(routeParams.target, msg.sender)).transfer(address(this).balance);
        }

        emit Routed(msg.sender, setOr(routeParams.target, address(0)), routeParams.operator, routeParams.routes.length);
    }

    receive() external payable {}
}
