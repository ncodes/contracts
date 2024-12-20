// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../common/Ownable.sol";

/// @dev PriceRegistry stores the price of assets
contract PriceRegistry is Ownable {
    mapping(address => uint256) public prices;
    mapping(address => bool) public oracles;
    mapping(address => uint256) public lastAssetUpdateTime;
    uint256 public lastPriceUpdateAt; // last time a price was updated
    uint256 public priceStaleDuration = 3600; // duration after which a price is considered stale
    uint256 public constant MAX_PRICE = type(uint128).max; // Reasonable upper limit
    uint256 public constant MIN_PRICE = 1; // Prevent zero prices
    uint16 public constant MAX_PRICE_CHANGE_BPS = 3000; // 30% max change
    uint256 public constant MIN_INTERVAL_BETWEEN_UPDATES = 30; // 30 seconds minimum between updates
    uint256 public maxBatchSize = 100; // Prevent gas DOS

    event OracleAdded(address oracle);
    event OracleRemoved(address oracle);
    event PriceUpdated(address asset, uint256 price);
    event UpdatedPriceStaleDuration(uint256 priceStaleDuration);
    event UpdatedMaxBatchSize(uint256 maxBatchSize);

    modifier onlyOracle() {
        require(oracles[msg.sender], "PR: NOT_ORACLE");
        _;
    }

    /// @dev Set the price stale duration
    /// @dev This function is only callable by the owner
    /// @dev The price stale duration is the duration after which a price is considered stale.
    /// @param _priceStaleDuration The new price stale duration in seconds
    function setPriceStaleDuration(uint256 _priceStaleDuration) external onlyOwner {
        priceStaleDuration = _priceStaleDuration;
        emit UpdatedPriceStaleDuration(_priceStaleDuration);
    }

    /// @dev Set the maximum batch size for price updates
    /// @param _maxBatchSize The new maximum batch size
    function setMaxBatchSize(uint256 _maxBatchSize) external onlyOwner {
        require(_maxBatchSize > 0, "PR: MAX_BATCH_SIZE_TOO_LOW");
        maxBatchSize = _maxBatchSize;
        emit UpdatedMaxBatchSize(_maxBatchSize);
    }

    /// @dev Add an oracle to the price registry
    /// @param oracle The address of the oracle
    function addOracle(address oracle) external onlyOwner {
        require(oracle != address(0), "PR: ZERO_ADDRESS");
        oracles[oracle] = true;
        emit OracleAdded(oracle);
    }

    /// @dev Remove an oracle from the price registry
    /// @param oracle The address of the oracle
    function removeOracle(address oracle) external onlyOwner {
        require(oracle != address(0), "PR: ZERO_ADDRESS");
        oracles[oracle] = false;
        emit OracleRemoved(oracle);
    }

    /// @dev Update the price of an asset with safety checks
    /// @param asset The address of the asset
    /// @param price The new price of the asset
    function updatePrice(address asset, uint256 price) public onlyOracle {
        require(asset != address(0), "PR: ZERO_ADDRESS");
        require(price >= MIN_PRICE, "PR: PRICE_TOO_LOW");
        require(price <= MAX_PRICE, "PR: PRICE_TOO_HIGH");

        // Prevent price update spam
        require(block.timestamp >= lastAssetUpdateTime[asset] + MIN_INTERVAL_BETWEEN_UPDATES, "PR: UPDATE_TOO_FREQUENT");

        // Get existing price
        uint256 oldPrice = prices[asset];

        // If there's an existing price, check for suspicious price movements
        if (oldPrice > 0) {
            uint256 maxChange = (oldPrice * MAX_PRICE_CHANGE_BPS) / 10000;
            uint256 minAllowedPrice = oldPrice > maxChange ? oldPrice - maxChange : 0;
            uint256 maxAllowedPrice = oldPrice + maxChange;
            require(price >= minAllowedPrice && price <= maxAllowedPrice, "PR: PRICE_CHANGE_TOO_LARGE");
        }

        prices[asset] = price;
        lastPriceUpdateAt = block.timestamp;
        lastAssetUpdateTime[asset] = block.timestamp;

        emit PriceUpdated(asset, price);
    }

    /// @dev Update multiple prices with the same safety checks
    /// @param _assets Array of asset addresses
    /// @param _prices Array of corresponding prices
    function updatePriceMulti(address[] calldata _assets, uint256[] calldata _prices) external onlyOracle {
        require(_assets.length == _prices.length, "PR: LENGTH_MISMATCH");
        require(_assets.length <= maxBatchSize, "PR: BATCH_TOO_LARGE");

        for (uint256 i = 0; i < _assets.length; i++) {
            updatePrice(_assets[i], _prices[i]);
        }
    }

    /// @dev Get the price of a base asset in terms of a quote asset, adjusted by a scaling factor
    /// @param base The address of the base asset
    /// @param quote The address of the quote asset
    /// @param scalingBps The price scaling factor in basis points (-10000 = -100%, 10000 = +100% increase)
    /// @return The adjusted price of the base asset in terms of the quote asset
    function getBasePrice(address base, address quote, int256 scalingBps) public view returns (uint256) {
        require(prices[base] > 0, "PR: BASE_PRICE_ZERO");
        require(prices[quote] > 0, "PR: QUOTE_PRICE_ZERO");
        require(scalingBps >= -10000, "PR: INV_SCALING_BPS");
        require(block.timestamp - lastPriceUpdateAt <= priceStaleDuration, "PR: STALE_PRICE");

        uint256 basePrice = (prices[base] * 10 ** 18) / prices[quote];

        if (scalingBps >= 0) {
            return basePrice + ((basePrice * uint256(scalingBps)) / 10000);
        } else {
            return basePrice - ((basePrice * uint256(-scalingBps)) / 10000);
        }
    }
}
