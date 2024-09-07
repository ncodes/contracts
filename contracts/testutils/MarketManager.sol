// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../market/interfaces/IMarketManager.sol";
import "../core/StructsLib.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

// base market manager that does nothing
contract MarketManagerBase is IMarketManager, ERC165 {
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IMarketManager).interfaceId || super.supportsInterface(interfaceId);
    }

    function beforeSwap(StructsLib.SwapQuoteForBaseParams memory) external virtual {}

    function afterSwap(StructsLib.SwapQuoteForBaseParams memory, uint256) external virtual {}

    function onCancel(uint256) external virtual {}

    function onPaid(uint256) external virtual {}

    function onRelease(uint256) external virtual {}

    function onDispute(uint256) external virtual {}
}

contract MarketManager is IMarketManager, ERC165, MarketManagerBase {
    bool public beforeSwapCalled;
    bool public afterSwapCalled;
    uint256 public orderId;
    StructsLib.SwapQuoteForBaseParams public params;

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165, MarketManagerBase) returns (bool) {
        return interfaceId == type(IMarketManager).interfaceId || super.supportsInterface(interfaceId);
    }

    function beforeSwap(StructsLib.SwapQuoteForBaseParams memory _params) external override(IMarketManager, MarketManagerBase) {
        beforeSwapCalled = true;
        params = _params;
    }

    function afterSwap(
        StructsLib.SwapQuoteForBaseParams memory _params,
        uint256 _orderId
    ) external override(IMarketManager, MarketManagerBase) {
        params = _params;
        orderId = _orderId;
        afterSwapCalled = true;
    }
}

// market manager that reverts from beforeSwap
contract MarketManagerRevertsFromBeforeSwap is IMarketManager, ERC165, MarketManagerBase {
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165, MarketManagerBase) returns (bool) {
        return interfaceId == type(IMarketManager).interfaceId || super.supportsInterface(interfaceId);
    }

    function beforeSwap(StructsLib.SwapQuoteForBaseParams memory) external pure override(IMarketManager, MarketManagerBase) {
        revert("MKT: BEFORE_REVERTED");
    }
}

// market manager that reverts from afterSwap
contract MarketManagerRevertsFromAfterSwap is IMarketManager, ERC165, MarketManagerBase {
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165, MarketManagerBase) returns (bool) {
        return interfaceId == type(IMarketManager).interfaceId || super.supportsInterface(interfaceId);
    }

    function afterSwap(StructsLib.SwapQuoteForBaseParams memory, uint256) external pure override(IMarketManager, MarketManagerBase) {
        revert("MKT: AFTER_REVERTED");
    }
}

// market manager that did not implement the interface
contract MarketManagerDidNotImplMktMgrIface {
    bool public beforeSwapCalled;
    bool public afterSwapCalled;

    function beforeSwap(StructsLib.SwapQuoteForBaseParams memory, address) external pure {}

    function afterSwap(StructsLib.SwapQuoteForBaseParams memory, uint256, address) external pure {}
}
