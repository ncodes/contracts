// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../../core/StructsLib.sol";

interface IMarketManager {
    /// @notice Called before a swap is executed
    /// @param params The swap parameters
    function beforeSwap(StructsLib.SwapQuoteForBaseParams memory params) external;

    /// @notice Called after a swap is executed
    /// @param params The swap parameters
    /// @param orderId The ID of the order that was created (if swap is interactive). When order ID is 0,
    /// it means the swap is not interactive.
    function afterSwap(StructsLib.SwapQuoteForBaseParams memory params, uint256 orderId) external;

    /// @notice Called when a swap is cancelled
    /// @param orderId The ID of the order that was cancelled
    function onCancel(uint256 orderId) external;

    /// @notice Called when a swap order is paid
    /// @param orderId The ID of the order that was paid
    function onPaid(uint256 orderId) external;

    /// @notice Called when a swap order is released
    /// @param orderId The ID of the order that was released
    function onRelease(uint256 orderId) external;

    /// @notice Called when a swap order is disputed
    /// @param orderId The ID of the order that was disputed
    function onDispute(uint256 orderId) external;
}
