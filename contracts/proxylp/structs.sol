// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

library ProxyLPStructs {
    struct CrossLiquidityParams {
        /// @dev The market ID
        address marketId;
        /// @dev The price of the liquidity
        uint256 price;
        /// @dev Indicate whether to use the price from the price registry
        bool usePriceFromRegistry;
        /// @dev The price scale in basis points (applied to the price from the price registry)
        int256 priceScaleBps;
    }

    struct CrossLiquidity {
        address owner;
        address marketId;
        uint256 lid;
        bool isLiqSet;
        uint256 price;
        bool usePriceFromRegistry;
        int256 priceScaleBps;
    }

    struct OwnedLiq {
        uint256 lid;
        bool isSet;
    }

    struct UpdateFungibleLiquidityParams {
        /// @dev The market ID
        address marketId;
        /// @dev The cross market ID
        CrossLiquidityParams crossLiquidity;
        /// @dev The liquidity target.
        /// When set, only the target can swap the liquidity.
        address target;
        /// @dev The liquidity ID
        uint256 lid;
        /// @dev The amount of liquidity to add
        uint256 amount;
        /// @dev The price of the liquidity
        uint256 price;
        /// @dev The time to pay for the liquidity
        uint256 timeToPay;
        /// @dev The time when the liquidity will expire
        uint256 expireAt;
        /// @dev List of token IDs where at least one token must match.
        /// Required when quote is non-fungible.
        uint256[] wantOrIds;
        /// @dev List of tokens IDs where all tokens must match.
        /// Required when quote is non-fungible.
        uint256[] wantAndIds;
        /// @dev The price scale in basis points (applied to the price from the price registry)
        int256 priceScaleBps;
        /// @dev Indicate whether the liquidity should be deducted
        bool deduct;
        /// @dev Indicate whether to pause the liquidity
        bool pause;
        /// @dev Indicate whether to use the price from the price registry
        bool usePriceFromRegistry;
    }
}
