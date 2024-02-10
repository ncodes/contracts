// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

library Structs {
    enum AssetType {
        SYNTH,
        ERC20,
        ERC721,
        ERC1155
    }

    struct Asset {
        address addr;
        AssetType assetType;
    }

    struct MarketDur {
        // Time to wait before a dispute can be started
        uint256 disputeDelayDur;
        // The duration for evidence collection
        uint256 evidenceDur;
        // The duration for voting (includes committing and revealing)
        uint256 predictDur;
    }

    // Market represents a pair of assets where one
    // asset (base) is swapped for the other (synthetic).
    struct Market {
        // The timestamp when it was created.
        uint256 createdAt;
        // The number of orders created.
        uint256 numOrders;
        // The number of disputes created.
        uint256 numDisputes;
        // The number of liquidity
        uint256 numLiquidity;
        // The percentage or fee rate to charge as commission for each trade.
        // Example:
        // - For non-synthetic pairs: 1.55% should be represented as 155 (1.55 * 100).
        // - For synthetic/nft pairs: 1 wei per 1 unit of liquidity
        uint256 commission;
        // The id of the pool that that should mediate for this market
        uint256 poolId;
        // Duration params
        MarketDur dur;
        // The creator of the market.
        address creator;
        // The market manager
        address manager;
        // The base asset of the market.
        // This can be any ERC20 token.
        Asset base;
        // The quote asset of the market.
        // This can be any ERC20 token.
        Asset quote;
        // Market permissions
        MarketPerms perms;
    }

    struct MarketPerms {
        // Indicate whether the market is permissioned for base liquidity provisioning.
        // When set to true, only specific addresses will be
        // allowed to add base liquidity.
        bool put;
        // Indicate whether the market is permissioned for swaps.
        // When set to true, only specific addresses will be allowed to add base liquidity.
        bool swap;
        // Indicates whether the market can receive only offers.
        bool offerOnly;
        // Indicates whether to allow zero price
        bool allowZeroOfferPrice;
    }

    /// @dev Liquidity represents an amount of an asset
    struct Liquidity {
        // The ids of assets (for ERC721 and ERC1155 asset types)
        uint256[] ids;
        // The amount of asset (for ERC20 and SYNTH asset types)
        uint256 amount;
        // The price to sell 1 unit of liquidity for the quote asset.
        uint256 price;
        // The minimum amount that can be swapped.
        uint256 minSwap;
        /// The maximum amount that can be swapped.
        uint256 maxSwap;
        // The number of seconds payment is expected to be made before grace period
        uint256 timeToPay;
        // The number of open orders
        uint256 openOrders;
        // The number of open disputes
        uint256 openDisputes;
        // Purse ID of locked fee for protocol
        uint256 protoFeePurseId;
        // Purse ID of locked fee for market creator
        uint256 mktCreatorFeePurseId;
        // Fee rate for protocol fee
        uint256 protoFeeRate;
        // Fee rate for market creator fee
        uint256 mktCreatorFeeRate;
        // At least one of the ID must match
        uint256[] wantOrIds;
        // All IDs must match
        uint256[] wantAndIds;
        // Indicates whether new trades can be created
        bool paused;
        // Indicate the address that is permitted to take the liquidity.
        // Used when the liquidity provider wants to limit who can take the liquidity.
        address target;
    }

    /// @dev Order represents an on-going swap order.
    struct Order {
        // The ID of the market where the order belongs to.
        address marketId;
        // The address of the liquidity provider
        address provider;
        // The address of the liquidity taker
        address taker;
        // The recipient of the ordered asset (optional)
        address recipient;
        // The releaser or canceller
        address finalizer;
        // The liquidity ID
        uint256 lid;
        // The swap amount.
        uint256 amount;
        // The swap price.
        uint256 price;
        // The start time.
        uint256 createdAt;
        // The time before which payment is expected.
        uint256 payDeadline;
        // The time an un-paid order can be cancelled by both parties.
        uint256 cancelAt;
        // The time when a dispute can be started.
        uint256 disputeFrom;
        // The ID of the offer that executed the swap
        uint256 offerId;
        // The interface operator
        uint256 operator;
        // Taker token IDs locked in order. Filled when quote is NFT
        uint256[] takerIds;
        // Provider token IDs locked in order. Filled when base is NFT
        uint256[] providerIds;
        // Indicates whether the off-chain asset has been transferred or paid.
        bool paid;
        // Indicates whether the locked asset has been released.
        bool released;
        // Indicates whether the order is disputed.
        bool disputed;
        // Indicates whether the order has been cancelled
        bool cancelled;
    }

    struct Offer {
        // creator of the offer
        address creator;
        // marketId is the unique ID of the market.
        address marketId;
        // provider is the address of the base asset liquidity provider.
        address provider;
        // the actual recipient
        address recipient;
        // liquidity ID
        uint256 lid;
        // amount is the quantity of the base asset.
        // Applies when quote asset is fungible.
        uint256 amount;
        // price is the price to pay for the offer amount.
        // Applies when base and quote asset are fungible.
        uint256 price;
        // ids is a list of token ids to be offered.
        // Applies when quote is non-fungible.
        uint256[] ids;
        // The liquidity associated to the offer.
        uint256 liq;
        // deadline is the time the offer expires
        uint256 deadline;
        // The time when the offer can be executed
        uint256 execAt;
        // The ID of the interface operator
        uint256 operator;
        // Indicate whether the offer has been accepted
        bool accepted;
        // Indicate whether the offer has been cancelled
        bool cancelled;
        // Indicate whether the offer has been executed
        bool executed;
    }

    struct Mediator {
        address addr;
        uint256 bond;
        uint256 bondReleaseAt;
        uint256 matureAt;
    }

    struct Ticket {
        address owner;
        uint256 idx;
        uint256 poolId;
        uint256 bond;
        uint256 matureAt;
        uint256 poolIdx;
        uint256 cancelAt;
        uint256 joinBy;
        bool drafted;
        bool joined;
        bool blocked;
        bool slashed;
    }

    struct TicketPool {
        uint256 reqBond;
        uint256 draftReward;
        uint256 winReward;
        uint256 noVoteSlashBP;
        uint256 loseVoteSlashBP;
        uint256 numDraftees;
    }

    struct DelegateTicket {
        address owner;
        uint256 id;
    }

    struct PoolTicket {
        address owner;
        uint256 idx;
    }

    struct PurchaseWindow {
        uint256 endTime;
        uint256 numPurchases;
        uint256 supply;
        uint256 price;
    }
}
