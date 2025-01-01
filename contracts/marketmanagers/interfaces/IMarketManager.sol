// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../../core/StructsLib.sol";

interface IMarketManager {
    /// @notice Called before a swap is executed
    /// @param params The swap parameters
    function beforeSwap(StructsLib.SwapQuoteForBaseParams memory params) external;

    /// @notice Called after a swap is executed
    /// @param params The swap parameters
    /// @param swapResult The swap result. If swap is interactive, swap result will
    /// contain partial swap result including order type and ID.
    function afterSwap(StructsLib.SwapQuoteForBaseParams memory params, StructsLib.SwapResult memory swapResult) external;

    /// @notice Called when a swap is cancelled
    /// @param orderId The ID of the order that was cancelled
    function onCancel(uint256 orderId) external;

    /// @notice Called when a swap order is paid
    /// @param orderId The ID of the order that was paid
    function onPaid(uint256 orderId) external;

    /// @notice Called when a swap order is released
    /// @param result The swap result
    function onRelease(StructsLib.SwapResult memory result) external;
}
