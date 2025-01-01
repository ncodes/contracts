// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../StructsLib.sol";

interface IProviderHook {
    function beforeSwap(StructsLib.SwapQuoteForBaseParams memory params) external;
    function afterSwap(StructsLib.SwapQuoteForBaseParams memory params, StructsLib.SwapResult memory swapResult) external;
    function onRelease(StructsLib.SwapResult memory swapResult) external;
    function onCancel(uint256 orderId) external;
    function onPaid(uint256 orderId) external;
}
