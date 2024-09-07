// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../market/interfaces/IMarketManager.sol";
import "../core/StructsLib.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

// base market manager that does nothing
contract MarketManagerBase is IMarketManager, ERC165 {
    bool public beforeSwapCalled;
    bool public afterSwapCalled;
    bool public onCancelCalled;
    bool public onPaidCalled;
    bool public onReleaseCalled;
    bool public onDisputeCalled;

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IMarketManager).interfaceId || super.supportsInterface(interfaceId);
    }

    function beforeSwap(StructsLib.SwapQuoteForBaseParams memory) external virtual {
        beforeSwapCalled = true;
    }

    function afterSwap(StructsLib.SwapQuoteForBaseParams memory, uint256) external virtual {
        afterSwapCalled = true;
    }

    function onCancel(uint256) external virtual {
        onCancelCalled = true;
    }

    function onPaid(uint256) external virtual {
        onPaidCalled = true;
    }

    function onRelease(uint256) external virtual {
        onReleaseCalled = true;
    }

    function onDispute(uint256) external virtual {
        onDisputeCalled = true;
    }
}

contract MarketManager is IMarketManager, ERC165, MarketManagerBase {
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
