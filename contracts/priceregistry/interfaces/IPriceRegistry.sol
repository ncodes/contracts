// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IPriceRegistry {
    function prices(address) external view returns (uint256);
    function oracles(address) external view returns (bool);
    function lastAssetUpdateTime(address) external view returns (uint256);
    function lastPriceUpdateAt() external view returns (uint256);
    function priceStaleDuration() external view returns (uint256);
    function maxBatchSize() external view returns (uint256);
    function addOracle(address) external;
    function removeOracle(address) external;
    function updatePrice(address, uint256) external;
    function setPriceStaleDuration(uint256) external;
    function setMaxBatchSize(uint256) external;
    function updatePriceMulti(address[] calldata, uint256[] calldata) external;
    function getBasePrice(address, address, int256) external view returns (uint256);
}
