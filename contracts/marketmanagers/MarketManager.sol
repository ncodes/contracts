// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../common/Ownable.sol";
import "./interfaces/IMarketManager.sol";
import "../core/StructsLib.sol";
import "../market/MarketAuxLib.sol";
import "../common/Structs.sol";
import "hardhat/console.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "../payrouter/interfaces/IPayRouter.sol";

struct RequestInfo {
    bool exists;
    uint256 requestId;
    uint256 orderId;
}

contract MarketManager is Ownable, IMarketManager, ERC165 {
    using MarketAuxLib for Structs.Market;

    ICore public core;
    IPayRouter public payRouter;
    mapping(uint256 => RequestInfo) public requestInfo;
    mapping(address => bool) public delegates;

    constructor(address _core, address _payRouter) {
        core = ICore(_core);
        payRouter = IPayRouter(_payRouter);
        delegates[msg.sender] = true;
    }

    event UpdatedDelegate(address delegate, bool isDelegate);
    event CoreUpdated(address core);
    event PayRouterUpdated(address payRouter);
    event TransferredRequestBond(address sender, uint256 requestId, uint256 routeId, uint256 amount, address to);
    event TransferredRequestSource(address sender, uint256 requestId, uint256 amount, address to);

    modifier onlyCore() {
        require(msg.sender == address(core), "MM: NOT_CORE");
        _;
    }

    modifier onlyDelegate() {
        require(delegates[msg.sender], "MM: NOT_DELEGATE");
        _;
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IMarketManager).interfaceId || super.supportsInterface(interfaceId);
    }

    /// @notice Set the core
    /// @param _core The core address
    function setCore(address _core) external onlyOwner {
        core = ICore(_core);
        emit CoreUpdated(_core);
    }

    /// @notice Set the pay router
    /// @param _payRouter The pay router address
    function setPayRouter(address _payRouter) external onlyOwner {
        payRouter = IPayRouter(_payRouter);
        emit PayRouterUpdated(_payRouter);
    }

    /// @notice Add a delegate
    /// @param delegate The delegate address
    function addDelegate(address delegate) external onlyOwner {
        delegates[delegate] = true;
        emit UpdatedDelegate(delegate, true);
    }

    /// @notice Remove a delegate
    /// @param delegate The delegate address
    function removeDelegate(address delegate) external onlyOwner {
        delegates[delegate] = false;
        emit UpdatedDelegate(delegate, false);
    }

    /// @notice Before swap hook
    /// @param params The swap params
    function beforeSwap(StructsLib.SwapQuoteForBaseParams memory params) external override onlyCore {}

    /// @notice After swap hook
    /// @param params The swap params
    /// @param orderId The order ID
    function afterSwap(StructsLib.SwapQuoteForBaseParams memory params, uint256 orderId) external override onlyCore {
        Structs.Market memory market = core.getMarket(params.marketId);
        if (market.isInstantMarket()) return;

        // Get the routeIds and bonds from params
        (uint256[] memory routeIds, uint256[] memory bonds) = abi.decode(params.marketMgrData, (uint256[], uint256[]));

        // Create PayRouter request
        payRouter.createRequest(routeIds, bonds, 0);
        uint256 requestId = payRouter.numRequests() - 1;

        requestInfo[orderId - 1] = RequestInfo(true, requestId, orderId - 1);
    }

    /// @notice On cancel hook
    /// @param orderId The order ID
    function onCancel(uint256 orderId) external override onlyCore {
        if (!requestInfo[orderId].exists) return;
        payRouter.cancelRequest(requestInfo[orderId].requestId);
    }

    /// @notice On paid hook
    /// @param orderId The order ID
    function onPaid(uint256 orderId) external override onlyCore {
        if (!requestInfo[orderId].exists) return;
        payRouter.markOrgSourceAsPaid(requestInfo[orderId].requestId);
    }

    /// @notice On release hook
    /// @param orderId The order ID
    function onRelease(uint256 orderId) external override onlyCore {
        if (!requestInfo[orderId].exists) return;
        payRouter.closeRequest(requestInfo[orderId].requestId);
    }

    /// @notice Set the requester fee bp
    /// @param feeBp The fee bp
    function setRequesterFeeBp(uint256 feeBp) external onlyOwner {
        payRouter.setRequesterFeeBp(feeBp);
    }

    /// @notice Set the requester value lock duration
    /// @param duration The duration in seconds
    function setRequesterValueLockDuration(uint256 duration) external onlyOwner {
        payRouter.setRequesterValueLockDuration(duration);
    }

    /// @notice Transfer request bond
    /// @param requestId The request ID
    /// @param routeId The route ID
    /// @param amount The amount
    /// @param to The address to transfer to
    function transferRequestBond(uint256 requestId, uint256 routeId, uint256 amount, address to) external onlyDelegate {
        payRouter.transferRequestBond(requestId, routeId, amount, to);
        emit TransferredRequestBond(msg.sender, requestId, routeId, amount, to);
    }

    /// @notice Transfer source token
    /// @param requestId The request ID
    /// @param amount The amount
    /// @param to The address to transfer to
    function transferRequestSource(uint256 requestId, uint256 amount, address to) external onlyDelegate {
        payRouter.transferRequestSource(requestId, amount, to);
        emit TransferredRequestSource(msg.sender, requestId, amount, to);
    }

    /// @notice Withdraw requester fee
    /// @param beneficiary The beneficiary address
    function withdrawRequesterFee(address beneficiary) external onlyOwner {
        payRouter.withdrawRequesterFee(beneficiary);
    }
}

interface ICore {
    function getMarket(address id) external view returns (Structs.Market memory);
}
