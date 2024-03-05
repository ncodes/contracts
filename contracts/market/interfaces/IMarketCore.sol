// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../../common/Ownable.sol";
import "../../common/Structs.sol";

interface IMarketCore {
    function setInventor(address val) external;

    function createMarket(
        address base,
        address quote,
        bool isBaseLocal,
        bool isQuoteLocal,
        bool permPut,
        bool permSwap,
        bool permMediate,
        uint256 commission,
        uint256 mediatorBond,
        uint256 numMediators
    ) external;

    function getNativeAssetAddr() external view returns (address);

    function getMarket(address id) external view returns (Structs.Market memory);

    function permitPut(address id, address addr) external;

    function revokePut(address id, address addr) external;

    function permitSwap(address id, address addr) external;

    function revokeSwap(address id, address addr) external;

    function hasMarket(address id) external view returns (bool);

    function setCounters(address id, bool numOrders, bool numDisputes, bool numLiquidity, uint256 value) external;

    function setCommission(address id, uint256 val) external;

    function setLiquidityManager(address marketId, address manager) external;

    function getLiquidityManager(address marketId, address provider, uint256 lid) external view returns (address);

    function isPutPermitted(address id, address sender) external view returns (bool);

    function isSwapPermitted(address id, address sender) external view returns (bool);

    function getReqBadges(address id) external view returns (string[2][] memory, string[2][] memory);
}
