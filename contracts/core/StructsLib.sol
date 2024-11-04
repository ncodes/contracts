// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.13;

import "../common/Structs.sol";
import "../assetregistry/interfaces/IAssetRegistry.sol";
import "../token/interfaces/IERC20.sol";
import "../market/interfaces/IMarketCore.sol";
import "../pools/interfaces/IFeePool.sol";
import "../feepurse/interfaces/IFeePurse.sol";
import "../badge/interfaces/IBadge.sol";
import "../operator/interfaces/IOperator.sol";
import "../minerregisty/interfaces/IMinerRegistry.sol";

library StructsLib {
    struct UserRewardLog {
        uint256 phase;
        uint256 period;
    }

    struct IntSlotState {
        // Protocol fee for erc20 -> erc20 swap
        uint256 instantSwapFeeBp;
        // Protocol fee for erc20 -> synthetic swap
        uint256 synthSwapFeeBp;
        // Protocol fee for stable coin assets
        uint256 stableSwapFeeBp;
        // Fee paid in NFT/ERC20 swap
        uint256 instantNFTSwapFeeBp;
        // Fee paid when adding liquidity to a non-ERC20 market with a synthetic base
        uint256 fixedSynthSwapFee;
        // Fee paid when adding liquidity to a non-ERC20 market with an NFT base
        uint256 fixedNFTSwapFee;
        // Maximum open orders a liquidity provider can have open
        uint256 maxOpenOrders;
        // Maximum open disputes a liquidity provider can have open
        uint256 maxOpenDisputes;
    }

    struct State {
        IntSlotState ints;
        // protocol fee split base points
        // 0: inventor, 1: shared, 2: operator
        uint256[3] feeBPs;
        // The minimum number of seconds synthetic payments must be made within.
        uint256 minTimeToPay;
        // The number of seconds after order pay deadline allowed to pass before
        // an order can be cancelled.
        uint256 orderGraceDur;
        // The number of orders created.
        uint256 numOrders;
        // Number of seconds between
        uint256 feePoolTxInterval;
        // The protocol inventor.
        address inventor;
        // The AMM swap router address
        address ammSwapRouter;
        // The list of orders.
        Structs.Order[] orders;
        // Temporary list of reward log to be skipped
        UserRewardLog[] skipped;
        // Mapping of address to fees received from assets
        // user => asset => balance
        mapping(address => mapping(address => uint256)) feeBalance;
        // Index of sharable assets and their balance
        mapping(address => uint256) shareablesBalance;
        // Mapping of protocol fee balance
        // asset => balance
        mapping(address => uint256) inventorBalance;
        // Store protocol fee earned by operators
        // operator => asset => balance
        mapping(address => mapping(address => uint256)) operatorsBalance;
        // Index of address and the amount of liquidity provided to markets.
        mapping(address => mapping(address => Structs.Liquidity[])) liquidity;
        // Maps managers of liquidity
        // Maps liquidity owner => market => manager Address
        mapping(address => mapping(address => address)) liqManagers;
        // Maps address to the amount of reward earned
        mapping(address => uint256) rewards;
        // Maps asset address to the timestamp of their last success transfer to FeePool
        mapping(address => uint256) lastFeePoolTransfer;
    }

    struct UintSlotState2 {
        // Base point representing NFT fee discount
        uint256 nftDiscountBp;
        // The fee tier of ETH pool on the native AMM DEX
        uint256 ammEthPoolFee;
    }

    struct State2 {
        UintSlotState2 ints;
        // Dispute manager contract address
        address disputeManager;
        // NFT contract address
        address nft;
        // ETH ERC20 token on native AMM
        address ammEth;
        // Registry for asset information
        IAssetRegistry assetReg;
        // App token contract
        IERC20 token;
        // Market core contract
        IMarketCore marketCore;
        // Fee pool contract
        IFeePool feePool;
        // FeePurse contract
        IFeePurse feePurse;
        // Badge contract
        IBadge badge;
        // Operator manager contract
        IOperator operatorMgr;
        // Miner registry contract
        IMinerRegistry minerReg;
        // List of offers
        Structs.Offer[] offers;
        // Liquidity-level badges required of swappers.
        // market => provider => liquidity ID => [badgeID ... badgeID
        mapping(address => mapping(address => mapping(uint256 => string[2][]))) reqSwapBadges;
        // AMM pools where an asset can be swapped
        // input address => output (address, pool fee)
        mapping(address => AmmSwapPoolInfo) ammSwapPool;
        // Used to initialize an uint256 mapping.
        mapping(uint256 => bool) intIdx;
    }

    struct AmmSwapPoolInfo {
        address outAddr;
        uint256 poolFee;
    }

    struct SwapSlotAddresses {
        // marketId is the unique ID of the market.
        address marketId;
        // provider is the address of the base asset liquidity provider.
        address provider;
        // the recipient of the output asset
        address recipient;
    }

    struct SwapSlot {
        // liquidity ID
        uint256 lid;
        // amount is the quantity of base asset to be swapped.
        // Applies when quote asset is fungible
        uint256 amount;
        // maxPrice is the maximum price to pay for amount.
        // Applies when quote asset is fungible
        uint256 maxPrice;
        // ids is a list of non-fungible asset ids to be swapped for the base liquidity
        uint256[] ids;
        // Indicate that a swap was initiated by an offer with the given ID
        uint256 offerId;
        // The ID of the interface operator
        uint256 operator;
        // Slot for variables with address type
        SwapSlotAddresses addrs;
    }

    struct UpdateLiquiditySlot {
        address marketId;
        uint256 lid;
        bool deduct;
        bool pause;
        uint256 amount;
        uint256[] ids;
        uint256[] wantOrIds;
        uint256[] wantAndIds;
        uint256 price;
        uint256 minSwap;
        uint256 maxSwap;
        uint256 timeToPay;
        address target;
    }
}
