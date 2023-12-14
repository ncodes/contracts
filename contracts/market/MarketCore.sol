// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../common/Writable.sol";
import "../common/Structs.sol";
import "./MarketAuxLib.sol";
import "../badge/interfaces/IBadge.sol";

/// MarketCore manages market state
contract MarketCore is Writable {
    /// @notice Contains all known markets.
    mapping(address => Structs.Market) public markets;

    /// @notice An index of addresses allowed to provide base liquidity.
    /// Maps a market => trader address => bool.
    mapping(address => mapping(address => bool)) public putAllowList;

    /// @notice An index of addresses allowed to swap in permissioned markets.
    /// Maps a market => trader address => bool.
    mapping(address => mapping(address => bool)) public swapAllowList;

    /// @notice Market-level badges required of liquidity providers
    mapping(address => string[2][]) public reqPutBadges;

    /// @notice Market-level badges required of swappers.
    mapping(address => string[2][]) public reqSwapBadges;

    // renounced market mapping (marketId => bool)
    mapping(address => bool) public renouncedMarkets;

    /// @notice Time to wait before dispute can be started
    uint256 public defaultDisputeDelayDur;

    /// @notice The badge contract address
    IBadge public badge;

    event NewMarket(
        address indexed id,
        address owner,
        address base,
        address quote,
        Structs.AssetType baseType,
        Structs.AssetType quoteType,
        bool permPut,
        bool permSwap,
        uint256 commission,
        uint256 mediatePoolId
    );
    event AllowedPut(address indexed id, address indexed addr);
    event RevokedPut(address indexed id, address indexed addr);
    event AllowedSwap(address indexed id, address indexed addr);
    event RevokedSwap(address indexed id, address indexed addr);
    event UpdatedCommission(address indexed id, uint256 val);
    event OfferOnlyEnabled(address indexed id);
    event TransferredOwnership(address indexed id, address oldOwner, address newOwner);
    event EnabledZeroOfferPrice(address indexed id);
    event UpdatedMarketBadges(address indexed id, string[2][], string[2][]);
    event UpdatedBadgeAddr(address addr);
    event UpdatedDefaultDisputeDelayDur(uint256 val);
    event UpdatedDisputeDurations(address indexed id, uint256 disputeDelayDur, uint256 evidenceDur, uint256 predictDur);
    event UpdatedMarketManager(address indexed id, address mgr);
    event RenouncedMarket(address id, address owner);

    /// @notice Modifier to ensure a market exist
    /// @param id The market ID
    modifier marketMustExist(address id) {
        require(markets[id].createdAt > 0, "MC: UNKNOWN_MARKET");
        _;
    }

    /// @notice Modifier to check if sender created a market.
    /// @param id The market ID
    modifier isMarketCreator(address id) {
        require(markets[id].creator == msg.sender, "MC: NOT_CREATOR");
        _;
    }

    /// @notice Modifier to check if a market has been renounced.
    /// @param id The market ID
    modifier isNotRenounced(address id) {
        require(!renouncedMarkets[id], "MC: MARKET_RENOUNCED");
        _;
    }

    /// @notice Initialize contract
    /// @param _defaultDisputeDelayDur The default time to wait before a dispute can be started in a market.
    constructor(uint256 _defaultDisputeDelayDur) {
        defaultDisputeDelayDur = _defaultDisputeDelayDur;
    }

    /// @notice Set the badge contract address
    function setBadgeMgr(address addr) public onlyOwner {
        badge = IBadge(addr);
        emit UpdatedBadgeAddr(addr);
    }

    /// @notice Change default dispute delay time
    function setDefaultDisputeDelayDuration(uint256 val) external onlyOwner {
        defaultDisputeDelayDur = val;
        emit UpdatedDefaultDisputeDelayDur(val);
    }

    /// @notice Update market counters
    function setCounters(
        address id,
        bool numOrders,
        bool numDisputes,
        bool numLiquidity,
        uint256 value
    ) external onlyWriter {
        if (numOrders) markets[id].numOrders = value;
        if (numDisputes) markets[id].numDisputes = value;
        if (numLiquidity) markets[id].numLiquidity = value;
    }

    /// @notice Get a market by ID
    /// @param id The ID of the market
    function getMarket(address id) external view marketMustExist(id) returns (Structs.Market memory) {
        return markets[id];
    }

    /// @notice Create a new market for swapping two asset types.
    /// @param base The base asset.
    /// @param quote The quote asset.
    /// @param baseType Indicates the type of the base asset.
    /// @param quoteType Indicates the type of the quote asset.
    /// @param permPut Indicates whether the market requires permission to provide base liquidity.
    /// @param permSwap Indicates whether the market requires permission to swap.
    /// @param commission Commission to deduct from market swaps (basis point)
    /// @param mediatePoolId The ID of the mediate pool that will mediate any dispute.
    function createMarket(
        address base,
        address quote,
        Structs.AssetType baseType,
        Structs.AssetType quoteType,
        bool permPut,
        bool permSwap,
        uint256 commission,
        uint256 mediatePoolId
    ) external {
        require(base != address(0), "MC: ZERO_BASE");
        require(quote != address(0), "MC: ZERO_QUOTE");
        address id = address(ripemd160(abi.encodePacked(msg.sender, base, quote, baseType, quoteType)));
        require(markets[id].createdAt == 0, "MC: MARKET_EXIST");
        Structs.Asset memory baseAsset = Structs.Asset(base, baseType);
        Structs.Asset memory quoteAsset = Structs.Asset(quote, quoteType);
        markets[id].creator = msg.sender;
        markets[id].base = baseAsset;
        markets[id].quote = quoteAsset;
        markets[id].createdAt = block.timestamp;
        markets[id].commission = commission;
        markets[id].perms.put = permPut;
        markets[id].perms.swap = permSwap;
        markets[id].dur.disputeDelayDur = defaultDisputeDelayDur;
        markets[id].poolId = mediatePoolId;
        emit NewMarket(id, msg.sender, baseAsset.addr, quoteAsset.addr, baseType, quoteType, permPut, permSwap, commission, mediatePoolId);
    }

    /// @notice Transfer ownership of market to another address
    function transferOwnership(address id, address newOwner) external marketMustExist(id) isMarketCreator(id) isNotRenounced(id) {
        emit TransferredOwnership(id, msg.sender, newOwner);
        markets[id].creator = newOwner;
    }

    /// @notice Renounce ownership of market
    function renounceOwnership(address id) external marketMustExist(id) isMarketCreator(id) isNotRenounced(id) {
        renouncedMarkets[id] = true;
        emit RenouncedMarket(id, msg.sender);
    }

    /// @notice Enable offer-only mode a market
    /// @param id The market ID.
    function markAsOfferOnly(address id) external marketMustExist(id) isMarketCreator(id) isNotRenounced(id) {
        markets[id].perms.offerOnly = true;
        emit OfferOnlyEnabled(id);
    }

    /// @notice Set dispute durations for a market
    /// @param id The market ID.
    /// @param disputeDelayDur The time to wait before a dispute can be started.
    /// @param evidenceDur The duration for evidence collection.
    /// @param predictDur The duration for voting (includes committing and revealing).
    function setDisputeDurations(
        address id,
        uint256 disputeDelayDur,
        uint256 evidenceDur,
        uint256 predictDur
    ) external marketMustExist(id) isMarketCreator(id) isNotRenounced(id) {
        markets[id].dur.disputeDelayDur = disputeDelayDur;
        markets[id].dur.evidenceDur = evidenceDur;
        markets[id].dur.predictDur = predictDur;
        emit UpdatedDisputeDurations(id, disputeDelayDur, evidenceDur, predictDur);
    }

    /// @notice Updated market manager
    /// @param id The market ID
    /// @param mgr The new market manager address
    function setManager(address id, address mgr) external marketMustExist(id) isMarketCreator(id) isNotRenounced(id) {
        markets[id].manager = mgr;
        emit UpdatedMarketManager(id, mgr);
    }

    /// @notice Enable zero price mode market
    /// @param id The market ID.
    function allowZeroOfferPrice(address id) external marketMustExist(id) isMarketCreator(id) isNotRenounced(id) {
        markets[id].perms.allowZeroOfferPrice = true;
        emit EnabledZeroOfferPrice(id);
    }

    /// @notice Permit an address to provide base asset liquidity in a market.
    /// @param id The market ID.
    /// @param addr The address to be added.
    function permitPut(address id, address addr) external marketMustExist(id) isMarketCreator(id) isNotRenounced(id) {
        require(markets[id].perms.put, "MC: PERM_OFF");
        putAllowList[id][addr] = true;
        emit AllowedPut(id, addr);
    }

    /// @notice Revoke permission to provide base asset liquidity on market.
    /// @param id The market ID.
    /// @param addr The address to be revoked.
    function revokePut(address id, address addr) external marketMustExist(id) isMarketCreator(id) isNotRenounced(id) {
        require(putAllowList[id][addr], "MC: NOT_ALLOWED");
        delete putAllowList[id][addr];
        emit RevokedPut(id, addr);
    }

    /// @notice Permit an address to swap in a market.
    /// @param id The market ID.
    /// @param addr The address to be added.
    function permitSwap(address id, address addr) external marketMustExist(id) isMarketCreator(id) isNotRenounced(id) {
        require(markets[id].perms.swap, "MC: PERM_OFF");
        swapAllowList[id][addr] = true;
        emit AllowedSwap(id, addr);
    }

    /// @notice Revoke permission to swap on market.
    /// @param id The market ID.
    /// @param addr The address to be revoked.
    function revokeSwap(address id, address addr) external marketMustExist(id) isMarketCreator(id) isNotRenounced(id) {
        require(swapAllowList[id][addr], "MC: NOT_ALLOWED");
        delete swapAllowList[id][addr];
        emit RevokedSwap(id, addr);
    }

    /// @notice Set badges for a market
    /// @param id The market ID
    /// @param put A list of required badges for liquidity providers
    /// @param swap A list of required badges for swappers
    function setRequiredBadges(
        address id,
        string[2][] memory put,
        string[2][] memory swap
    ) external marketMustExist(id) isMarketCreator(id) isNotRenounced(id) {
        require(put.length <= 8, "MC: PUT_TOO_MANY");
        require(swap.length <= 8, "MC: SWAP_TOO_MANY");
        reqPutBadges[id] = put;
        reqSwapBadges[id] = swap;
        emit UpdatedMarketBadges(id, put, swap);
    }

    /// @notice Set the permission property of a market.
    /// @param id The target market ID.
    /// @param val The new permission value
    function setCommission(address id, uint256 val) external marketMustExist(id) isMarketCreator(id) isNotRenounced(id) {
        require(val <= 10000, "MC: INVALID");
        markets[id].commission = val;
        emit UpdatedCommission(id, val);
    }

    /// @dev Get required badges of a market
    /// @param id The market ID
    /// @return PUT badges
    /// @return SWAP badges
    function getReqBadges(address id) external view returns (string[2][] memory, string[2][] memory) {
        return (reqPutBadges[id], reqSwapBadges[id]);
    }

    /// @notice Checks whether a market with the given ID exists.
    /// @param id - The ID of the market.
    /// @return true or false
    function hasMarket(address id) public view returns (bool) {
        return markets[id].createdAt > 0;
    }

    /// @notice Update a market
    function setMarket(address id, Structs.Market memory upd) external onlyWriter {
        markets[id] = upd;
    }

    /// @notice Checks if sender is permitted to put liquidity on the market.
    /// @param id The market ID
    /// @param sender The sender's address.
    function isPutPermitted(address id, address sender) external view returns (bool) {
        Structs.Market memory market = markets[id];
        require(!market.perms.put || market.creator == sender || putAllowList[id][sender], "MC: NO_PUT_PERM");
        return true;
    }

    /// @notice Check if sender is permitted to perform swap on the market
    /// @param id The market ID
    /// @param sender The sender's address.
    function isSwapPermitted(address id, address sender) external view returns (bool) {
        Structs.Market memory market = markets[id];
        require(!market.perms.swap || market.creator == sender || swapAllowList[id][sender], "MC: NO_SWAP_PERM");
        return true;
    }
}
