// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../vendor/@openzeppelin/contracts/access/Ownable.sol";
import "../common/Structs.sol";
import "./StructsLib.sol";
import "../market/interfaces/IMarketCore.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "../pools/interfaces/IFeePool.sol";
import "./WithdrawLib.sol";
import "./AuxLib.sol";
import "./FeeLib.sol";
import "./LiquidityLib.sol";
import "./OfferLib.sol";
import "./SwapLib.sol";
import "../assetregistry/interfaces/IAssetRegistry.sol";
import "../token/interfaces/IERC20.sol";
import "./FungibleLiquidityLib.sol";
import "./NonFungibleLiquidityLib.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import "../marketmanagers/interfaces/IMarketManager.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/IPriceRegistry.sol";
import "./interfaces/IProviderHook.sol";

/// Core manages market orders
contract Core is Ownable, ERC1155Holder {
    StructsLib.State public state;
    StructsLib.State2 public state2;

    event Swap(
        address indexed mid,
        address indexed provider,
        address indexed swapper,
        address recipient,
        address releaser,
        uint256[6] numTypeInfo,
        bool byDispute,
        uint256[] idsFromProvider,
        uint256[] idsFromTaker
    );
    event SwapOrder(
        address indexed mid,
        address indexed provider,
        address indexed swapper,
        address recipient,
        uint256[7] numTypeInfo,
        uint256[] idsFromProvider,
        uint256[] idsFromTaker
    );
    event SwapOrderPaid(uint256 indexed orderID, address payer, uint256 disputeDelayDur);
    event OrderCancelled(uint256 indexed orderID, address indexed canceller, bool indexed byDispute);
    event ProtocolFeeUpdated(
        uint256 instantSwapFeeBp,
        uint256 synthSwapFeeBp,
        uint256 stableSwapFeeBp,
        uint256 fixedSynthSwapFee,
        uint256 fixedNFTSwapFee,
        uint256 instantNFTSwapFeeBp
    );
    event ProtocolFeeSplitUpdated(uint256 inventor, uint256 shared, uint256 operator);
    event TransferInventorBalance(address owner, address token, uint256 amount);
    event TransferOperatorBalance(address owner, address token, uint256 amount);
    event UpdatedFungibleLiquidity(
        address indexed provider,
        address indexed marketId,
        address target,
        bool deduct,
        bool paused,
        bool usePriceFromRegistry,
        uint256 liq,
        uint256 amount,
        uint256 price,
        uint256[] wantOrIds,
        uint256[] wantAndIds,
        uint256 timeToPay,
        int256 priceScaleBps
    );
    event UpdatedNonFungibleLiquidity(
        address indexed provider,
        address indexed marketId,
        address target,
        bool deduct,
        bool paused,
        bool usePriceFromRegistry,
        uint256 lid,
        uint256[] ids,
        uint256 price,
        uint256[] wantOrIds,
        uint256[] wantAndIds,
        uint256 timeToPay,
        int256 priceScaleBps
    );
    event UpdatedPrice(address indexed marketId, address indexed provider, address indexed manager, uint256 lid, uint256 price);
    event TogglePause(address indexed marketId, address indexed provider, uint256 lid, bool paused);
    event UpdatedLiquidityManager(address indexed marketId, address indexed provider, address indexed manager, address oldManager);
    event NewOffer(
        address marketId,
        address indexed provider,
        uint256 lid,
        address indexed offerer,
        uint256 offerId,
        uint256 amount,
        uint256 price,
        uint256[] ids,
        uint256 expireDuration
    );
    event OfferUpdated(
        uint256 indexed offerId,
        address indexed offerer,
        uint256 amount,
        uint256 price,
        uint256[] ids,
        uint256 execDelayDur
    );
    event OfferAccepted(uint256 indexed offerId, address indexed acceptor, uint256 executeAt);
    event OfferCancelled(uint256 indexed offerId, address indexed canceller);
    event OfferExecuted(uint256 indexed offerId, address indexed executor);
    event OfferUnaccepted(uint256 indexed offerId, address indexed unacceptor);
    event UpdatedLiquiditySwapBadges(address market, address provider, uint256 liq, string[2][] badges);
    event UpdatedFeePurse(address addr);
    event UpdatedBadge(address addr);
    event UpdatedMarketCore(address addr);
    event UpdatedFeePool(address addr);
    event UpdatedInventor(address addr);
    event UpdatedFeePoolConfig(uint256 interval);
    event UpdatedAssetRegistry(address addr);
    event UpdatedProviderRegistry(address addr);
    event UpdatedMinTimeToPay(uint256 val);
    event UpdatedOrderGraceDur(uint256 val);
    event UpdatedMaxOpenOrders(uint256 val);
    event UpdatedMaxOpenDisputes(uint256 val);
    event UpdatedDisputeManager(address addr);
    event UpdatedOperator(address addr);
    event UpdatedMinerRegistry(address addr);
    event TransferredToFeePool(address indexed token, uint256 amount);
    event UpdatedPriceRegistry(address addr);
    /// @dev Modifier to ensure a market exist
    /// @param id The market ID
    modifier marketMustExist(address id) {
        require(IMarketCore(state2.marketCore).getMarket(id).createdAt > 0, "OC: UNKNOWN_MARKET");
        _;
    }

    /// @dev Modifier to sender is deployer
    modifier onlyDisputeManager() {
        require(msg.sender == state2.disputeManager, "OC: NOT_DISPUTE_MGR");
        _;
    }

    /// @dev Modifier to ensure an expiry time has not elapsed.
    /// If expireAt = 0, it means not expired.
    /// @param expireAt The expiry time
    modifier notExpired(uint256 expireAt) {
        require(expireAt == 0 || expireAt > block.timestamp, "OC: EXPIRED_TX");
        _;
    }
    /**
     * @dev Throws if called by any account other than the inventor.
     */
    modifier onlyInventor() {
        require(state.inventor == msg.sender, "OC: NOT_INVENTOR");
        _;
    }

    /// @notice Constructor
    /// @param _marketCore The address of the market core contract
    /// @param _token The address of the native token contract
    /// @param _minTimeToPay The minimum time off-chain payers have to make payment
    /// @param _orderGraceDur The grace period after which an order can be cancelled off-chain payment is not made
    /// @param _maxOpenOrders The maximum number of open orders allowed per liquidity provider
    /// @param _maxOpenDisputes The maximum number of open disputes allowed per liquidity provider
    constructor(
        address _marketCore,
        address _token,
        uint256 _minTimeToPay,
        uint256 _orderGraceDur,
        uint256 _maxOpenOrders,
        uint256 _maxOpenDisputes
    ) {
        state.minTimeToPay = _minTimeToPay;
        state.orderGraceDur = _orderGraceDur;
        state.ints.maxOpenOrders = _maxOpenOrders;
        state.ints.maxOpenDisputes = _maxOpenDisputes;
        state.feePoolTxInterval = 12 hours;
        state.inventor = msg.sender;
        state.feeBPs[0] = 5000;
        state.feeBPs[1] = 5000;
        state.feeBPs[2] = 0;
        state2.token = IERC20(_token);
        state2.marketCore = IMarketCore(_marketCore);
    }

    /// @notice Set asset registry
    /// @param addr The address of the asset registry contract
    function setAssetRegistry(address addr) external onlyOwner {
        state2.assetReg = IAssetRegistry(addr);
        emit UpdatedAssetRegistry(addr);
    }

    /// @notice Set price registry
    /// @param addr The address of the price registry contract
    function setPriceRegistry(address addr) external onlyOwner {
        state2.priceReg = IPriceRegistry(addr);
        emit UpdatedPriceRegistry(addr);
    }

    /// @notice Set provider registry
    /// @param addr The address of the provider registry contract
    function setProviderRegistry(address addr) external onlyOwner {
        state2.provReg = IProviderRegistry(addr);
        emit UpdatedProviderRegistry(addr);
    }

    /// @notice Set default time to pay
    /// @param val The new value
    function setMinTimeToPay(uint256 val) external onlyOwner {
        state.minTimeToPay = val;
        emit UpdatedMinTimeToPay(val);
    }

    /// @notice Set order grace period duration
    /// @param val The new value
    function setOrderGraceDur(uint256 val) external onlyOwner {
        state.orderGraceDur = val;
        emit UpdatedOrderGraceDur(val);
    }

    /// @notice Set max open orders
    /// @param val The new value
    function setMaxOpenOrders(uint256 val) external onlyOwner {
        state.ints.maxOpenOrders = val;
        emit UpdatedMaxOpenOrders(val);
    }

    /// @notice Set max open disputes
    /// @param val The new value
    function setMaxOpenDisputes(uint256 val) external onlyOwner {
        state.ints.maxOpenDisputes = val;
        emit UpdatedMaxOpenDisputes(val);
    }

    /// @notice Updated the dispute manager contract
    /// @param addr The new address
    function setDisputeManager(address addr) external onlyOwner {
        state2.disputeManager = addr;
        emit UpdatedDisputeManager(addr);
    }

    /// @notice Updated the Operator contract
    /// @param addr The new address
    function setOperator(address addr) external onlyOwner {
        state2.operatorMgr = IOperator(addr);
        emit UpdatedOperator(addr);
    }

    /// @notice Updated the MinerRegistry contract
    /// @param addr The new address
    function setMinerRegistry(address addr) external onlyOwner {
        state2.minerReg = IMinerRegistry(addr);
        emit UpdatedMinerRegistry(addr);
    }

    /// @notice Updated the FeePurse contract
    /// @param val The new address
    function setFeePurse(address val) external onlyOwner {
        state2.feePurse = IFeePurse(val);
        emit UpdatedFeePurse(val);
    }

    /// @notice Updated the Badge contract
    /// @param val The new address
    function setBadgeMgr(address val) external onlyOwner {
        state2.badge = IBadge(val);
        emit UpdatedBadge(val);
    }

    /// @notice Set market core address
    /// @param addr The new address
    function setMarketCore(address addr) external onlyOwner {
        state2.marketCore = IMarketCore(addr);
        emit UpdatedMarketCore(addr);
    }

    /// @notice Set fee rewarder contract address
    /// @param addr The new address
    function setFeePool(address addr) external onlyOwner {
        state2.feePool = IFeePool(addr);
        emit UpdatedFeePool(addr);
    }

    /// @notice Updated the protocol inventor
    /// @param addr The new address
    function setInventor(address addr) external onlyInventor {
        state.inventor = addr;
        emit UpdatedInventor(addr);
    }

    /// @notice Set the reward per fee sharer transfer
    /// @param interval The call interval
    function configureFeePool(uint256 interval) external onlyOwner {
        state.feePoolTxInterval = interval;
        emit UpdatedFeePoolConfig(interval);
    }

    /// @notice Set protocol fee split
    /// @param inventorBP The base point for inventor
    /// @param sharedBP The base point for shared with holders
    /// @param operatorBP The base point for operators
    function setProtoFeeSplit(uint256 inventorBP, uint256 sharedBP, uint256 operatorBP) public onlyOwner {
        require(inventorBP >= 3000, "OC: INV_BP_TOO_LOW");
        require(inventorBP + sharedBP + operatorBP == 10000, "OC: UNBALANCED");
        state.feeBPs[0] = inventorBP;
        state.feeBPs[1] = sharedBP;
        state.feeBPs[2] = operatorBP;
        emit ProtocolFeeSplitUpdated(inventorBP, sharedBP, operatorBP);
    }

    /// @notice Get protocol fee basis points
    function getFeeBPs() public view returns (uint256[3] memory) {
        return state.feeBPs;
    }

    /// Checks if an address is a verified token
    /// @param addr The address to check
    function isVerified(address addr) public view returns (bool) {
        return AuxLib.isVerified(state2, addr);
    }

    /// @notice Updated the protocol fee
    /// @param _instantSwapFeeBp Fee for ERC20/ERC20 swap
    /// @param _synthSwapFeeBp Fee for ERC20/SYNTH swap
    /// @param _stableSwapFeeBp Fee for ERC20(stablecoin)/ERC20(stablecoin)
    /// @param _fixedSynthSwapFee Fee for SYNTH/SYNTH swap (in NATIVE_TOKEN)
    /// @param _fixedNFTSwapFee Fee for NFT/NFT swap (in NATIVE_TOKEN)
    /// @param _instantNFTSwapFeeBp Fee for NFT/ERC20 swap
    function setProtoFee(
        uint256 _instantSwapFeeBp,
        uint256 _synthSwapFeeBp,
        uint256 _stableSwapFeeBp,
        uint256 _fixedSynthSwapFee,
        uint256 _fixedNFTSwapFee,
        uint256 _instantNFTSwapFeeBp
    ) public {
        state.ints.instantSwapFeeBp = _instantSwapFeeBp;
        state.ints.synthSwapFeeBp = _synthSwapFeeBp;
        state.ints.stableSwapFeeBp = _stableSwapFeeBp;
        state.ints.instantNFTSwapFeeBp = _instantNFTSwapFeeBp;
        state.ints.fixedSynthSwapFee = _fixedSynthSwapFee;
        state.ints.fixedNFTSwapFee = _fixedNFTSwapFee;
        emit ProtocolFeeUpdated(
            _instantSwapFeeBp,
            _synthSwapFeeBp,
            _stableSwapFeeBp,
            _fixedSynthSwapFee,
            _fixedNFTSwapFee,
            _instantNFTSwapFeeBp
        );
    }

    /// @notice Returns the balance of fees earned by an address.
    /// @param _owner The owner address
    /// @param _asset The asset whose balance is returned
    function feeBalanceOf(address _owner, address _asset) external view returns (uint256) {
        return state.feeBalance[_owner][_asset];
    }

    /// @notice Returns the balance of fees earned by the protocol
    /// @param asset The target asset
    function inventorBalanceOf(address asset) external view returns (uint256) {
        return state.inventorBalance[asset];
    }

    /// @notice Returns the sharable fee balance of an asset
    /// @param asset The target asset
    function shareablesBalanceOf(address asset) external view returns (uint256) {
        return state.shareablesBalance[asset];
    }

    /// @notice Returns the operator balance fee balance of an asset
    /// @param asset The target asset
    function operatorBalanceOf(address operator, address asset) external view returns (uint256) {
        return state.operatorsBalance[operator][asset];
    }

    /// @notice Withdraw fees earned by sender
    /// @param asset The address of the asset the fee is denominated in.
    function withdrawFeeBalance(address asset) external {
        uint256 bal = state.feeBalance[msg.sender][asset];
        state.feeBalance[msg.sender][asset] = 0;
        IERC20(asset).transfer(msg.sender, bal);
    }

    /// @notice Swap quote asset for base asset.
    /// @param params The swap parameters
    function swapQuoteForBase(
        StructsLib.SwapQuoteForBaseParams memory params
    ) external payable notExpired(params.expireAt) marketMustExist(params.marketId) {
        StructsLib.SwapSlotAddresses memory addrs = StructsLib.SwapSlotAddresses(params.marketId, params.provider, params.recipient);
        StructsLib.SwapSlot memory slot = StructsLib.SwapSlot(
            params.lid,
            params.amount,
            params.maxPrice,
            params.ids,
            0,
            params.operator,
            addrs
        );

        Structs.Market memory mkt = state2.marketCore.getMarket(params.marketId);
        if (Address.isContract(mkt.manager) && ERC165Checker.supportsInterface(mkt.manager, type(IMarketManager).interfaceId)) {
            IMarketManager(mkt.manager).beforeSwap(params);
        }

        if (Address.isContract(params.provider) && ERC165Checker.supportsInterface(params.provider, type(IProviderHook).interfaceId)) {
            IProviderHook(params.provider).beforeSwap(params);
        }

        StructsLib.SwapResult memory swapResult = SwapLib.swapQuoteForBase(state, state2, slot);

        if (Address.isContract(mkt.manager) && ERC165Checker.supportsInterface(mkt.manager, type(IMarketManager).interfaceId)) {
            IMarketManager(mkt.manager).afterSwap(params, swapResult);
        }

        if (Address.isContract(params.provider) && ERC165Checker.supportsInterface(params.provider, type(IProviderHook).interfaceId)) {
            IProviderHook(params.provider).afterSwap(params, swapResult);
        }
    }

    /// @notice Compute swap fee
    /// @param mid The market ID
    /// @param provider The address of the base asset liquidity provider.
    /// @param lid The liquidity ID
    /// @param taker The address of the recipient
    /// @param orderAmt The quantity of base asset to be swapped.
    /// @param orderPrice The maximum price to pay for amount.
    function computeSwapFee(
        address mid,
        address provider,
        uint256 lid,
        address taker,
        uint256 orderAmt,
        uint256 orderPrice
    ) public view returns (uint256, uint256, uint256, uint256) {
        Structs.Market memory mkt = state2.marketCore.getMarket(mid);
        Structs.Liquidity memory liq = state.liquidity[mid][provider][lid];
        FeeInfo memory info = FeeLib.computeFee(
            ComputeFeeParams(
                mkt,
                liq,
                state2.assetReg,
                state2.feePurse,
                state.ints.synthSwapFeeBp,
                state.ints.instantNFTSwapFeeBp,
                state.ints.instantSwapFeeBp,
                state.ints.stableSwapFeeBp,
                lid,
                orderAmt,
                orderPrice,
                provider,
                taker
            )
        );
        return (info.protoFee, info.mktCreatorFee, info.feeBp, info.mktFeeBp);
    }

    /// @notice Mark a swap order as paid.
    /// Order must be have been released or cancelled.
    /// When the base asset is ERC20, the sender must be the taker.
    /// When the base asset is synthetic,the sender must be the provider.
    /// @param id The order ID.
    function markOrderAsPaid(uint256 id) external {
        require(hasOrder(id), "OC: UNKNOWN_ORDER");
        Structs.Market memory mkt = state2.marketCore.getMarket(state.orders[id].marketId);
        SwapLib.markOrderAsPaid(state, state2.marketCore, id, mkt.manager == msg.sender);
    }

    /// @notice Release an order
    /// @param id The order ID
    function releaseOrder(uint256 id) external {
        require(hasOrder(id), "OC: UNKNOWN_ORDER");
        SwapLib.releaseOrder(state, state2, owner(), id, false);
    }

    /// @notice Cancel an order
    /// @param id The order ID
    function cancelOrder(uint256 id) external {
        require(hasOrder(id), "OC: UNKNOWN_ORDER");
        SwapLib.cancelOrder(state, state2, owner(), id, false);
    }

    /// @notice Allow the dispute manager to release an order.
    /// @param id The order ID.
    function releaseOrderByDispute(uint256 id) external onlyDisputeManager {
        SwapLib.releaseOrder(state, state2, owner(), id, true);
    }

    /// @notice Allow the dispute manager to cancel an order.
    /// @param id The order ID.
    function cancelOrderByDispute(uint256 id) external onlyDisputeManager {
        SwapLib.cancelOrder(state, state2, owner(), id, true);
    }

    /// @notice Checks if at order at index id exist
    /// @param id The order ID or index.
    function hasOrder(uint256 id) public view returns (bool) {
        return AuxLib.hasOrder(state, id);
    }

    /// @notice Checks whether addr can create a dispute.
    /// It will revert if order is unknown.
    /// It will return false if order has been released.
    /// It will return false if addr is not a provider or a taker.
    /// It will return false if order has not be marked as `paid` and time to pay has not been reached.
    /// @param id The order ID.
    /// @param addr The address to check if permitted to create dispute.
    function canCreateDispute(uint256 id, address addr) external view returns (bool) {
        return AuxLib.canCreateDispute(state, state2, id, addr);
    }

    /// @notice Marks an order as `disputed`
    /// @param id The order ID or index.
    function markAsDisputed(uint256 id) external onlyDisputeManager {
        SwapLib.markAsDisputed(state, state2.marketCore, id);
    }

    /// @notice Get an order by ID
    /// @param id The order ID
    function getOrder(uint256 id) external view returns (Structs.Order memory) {
        require(hasOrder(id), "OC: UNKNOWN_ORDER");
        return state.orders[id];
    }

    /// @notice Get an offer by ID
    /// @param id The offer ID
    function getOffer(uint256 id) external view returns (Structs.Offer memory) {
        require(id < state2.offers.length, "OC: UNKNOWN_OFFER");
        return state2.offers[id];
    }

    /// @notice Get a market by ID
    /// @param id The market ID
    function getMarket(address id) external view marketMustExist(id) returns (Structs.Market memory) {
        return state2.marketCore.getMarket(id);
    }

    /// @notice Transfer fees earned on shareable assets to the fee reward contract
    /// @param _token The address of a shareable token
    function transferToFeePool(address _token) external {
        WithdrawLib.transferToFeePool(state, state2, _token);
    }

    /// @notice Withdraw fees accrued for the protocol inventor
    /// @param asset The address of the asset the fee is denominated in.
    function withdrawInventorBalance(address asset) external onlyInventor {
        WithdrawLib.withdrawInventorBalance(state, state2, asset);
    }

    /// @notice Withdraw fee earned by an operator for a given asset
    /// @param _token The address of a shareable token
    function withdrawOperatorBalance(address _token) external {
        WithdrawLib.withdrawOperatorBalance(state, state2, _token);
    }

    /// @notice Return liquidity object of an address in a market
    /// @param _mid The market ID
    /// @param _owner The address of the owner of the liquidity
    /// @param _lid The liquidity ID
    function getLiquidity(address _mid, address _owner, uint256 _lid) external view returns (Structs.Liquidity memory) {
        return state.liquidity[_mid][_owner][_lid];
    }

    /// @notice Return liquidity of an address in a market
    /// @param _mid The market ID
    /// @param _owner The address of the owner of the liquidity
    /// @param _lid The liquidity ID
    function hasLiquidity(address _mid, address _owner, uint256 _lid) external view returns (bool) {
        return AuxLib.isLiquidityExist(state, _mid, _owner, _lid);
    }

    /// @notice Count the number of liquidity owned by an address in a market
    /// @param _mid The market ID
    /// @param _owner The address of the owner of the liquidity
    function countLiquidity(address _mid, address _owner) external view returns (uint256) {
        return state.liquidity[_mid][_owner].length;
    }

    /// @notice Allow an address to manage sender's liquidity
    /// @param marketId The market ID
    /// @param manager The address of the manager
    function setLiquidityManager(address marketId, address manager) external {
        LiquidityLib.setLiquidityManager(state, marketId, manager);
    }

    /// @notice Get the liquidity manager address of a liquidity provider
    /// @param marketId The market ID
    /// @param provider The liquidity provider address
    function getLiquidityManager(address marketId, address provider) external view returns (address) {
        return state.liqManagers[provider][marketId];
    }

    /// notice Update fungible market (ERC20, SYNTH) liquidity
    /// @param params The liquidity parameters
    function updateFungibleLiquidity(
        StructsLib.UpdateFungibleLiquidityParams memory params
    ) external payable notExpired(params.expireAt) marketMustExist(params.marketId) returns (uint256) {
        StructsLib.UpdateLiquiditySlot memory slot = StructsLib.UpdateLiquiditySlot(
            params.marketId,
            params.lid,
            params.deduct,
            params.pause,
            params.usePriceFromRegistry,
            params.amount,
            new uint256[](0),
            params.wantOrIds,
            params.wantAndIds,
            params.price,
            params.timeToPay,
            params.priceScaleBps,
            params.target
        );
        uint256 lid = FungibleLiquidityLib.updateFungibleLiquidity(state, state2, slot);
        state2.provReg.register(msg.sender);
        return lid;
    }

    /// @notice Update non-fungible market (ERC721, ERC1155) liquidity
    /// @param params The liquidity parameters
    function updateNonFungibleLiquidity(
        StructsLib.UpdateNonFungibleLiquidityParams memory params
    ) external notExpired(params.expireAt) marketMustExist(params.marketId) returns (uint256) {
        StructsLib.UpdateLiquiditySlot memory slot = StructsLib.UpdateLiquiditySlot(
            params.marketId,
            params.lid,
            params.deduct,
            params.pause,
            params.usePriceFromRegistry,
            0,
            params.ids,
            params.wantOrIds,
            params.wantAndIds,
            params.price,
            params.timeToPay,
            params.priceScaleBps,
            params.target
        );
        uint256 lid = NonFungibleLiquidityLib.updateNonFungibleLiquidity(state, state2, slot);
        state2.provReg.register(msg.sender);
        return lid;
    }

    /// @notice Set required swap badges
    /// @param marketId The market ID
    /// @param lid The liquidity ID
    /// @param badgeIds The badge IDs
    function setSwapBadgeForLiquidity(address marketId, uint256 lid, string[2][] memory badgeIds) external {
        LiquidityLib.setSwapBadgeForLiquidity(state, state2, marketId, lid, badgeIds);
    }

    /// @notice Get required swap badges of an address
    /// @param marketId The market ID
    /// @param lid The liquidity ID
    /// @param addr The address
    function getReqSwapBadges(address marketId, uint256 lid, address addr) external view returns (string[2][] memory) {
        return state2.reqSwapBadges[marketId][addr][lid];
    }

    /// @notice Increment open dispute count of a provider's liquidity
    /// @param marketId The market ID
    /// @param provider The provider address
    /// @param lid The liquidity ID
    /// @param incr If true, count is incremented, else decremented
    function updateOpenDisputesCount(address marketId, address provider, uint256 lid, bool incr) public onlyDisputeManager {
        LiquidityLib.updateOpenDisputesCount(state, marketId, provider, lid, incr);
    }

    /// @notice Allows liquidity manager to update a provider's liquidity
    /// @param _marketId The market ID
    /// @param _owner The owner of the liquidity
    /// @param _lid The liquidity ID
    /// @param _price The new _price of the liquidity
    /// @param _expireAt The transaction is reverted if current time >= _expireAt
    function updateLiquidityPrice(
        address _marketId,
        address _owner,
        uint256 _lid,
        uint256 _price,
        uint256 _expireAt
    ) external notExpired(_expireAt) marketMustExist(_marketId) {
        LiquidityLib.updateLiquidityPrice(state, state2, _marketId, _owner, _lid, _price);
    }

    /// @notice Create an offer
    /// @param params The offer parameters
    function createOffer(StructsLib.CreateOfferParams memory params) public {
        OfferLib.CreateOfferAddressParams memory offerAddrs = OfferLib.CreateOfferAddressParams(
            params.marketId,
            params.provider,
            params.recipient
        );
        OfferLib.CreateOfferIntParams memory offerInts = OfferLib.CreateOfferIntParams(
            params.lid,
            params.amount,
            params.price,
            params.deadline,
            params.operator
        );
        OfferLib.createOffer(state, state2, offerAddrs, offerInts, params.ids);
    }

    /// @notice Create an offer
    /// @param offerId The offer ID
    /// @param amount The offer amount
    /// @param price The offer price
    /// @param ids The IDs of non-fungible assets
    /// @param deadline The time when the offer expires.
    function updateOffer(uint256 offerId, uint256 amount, uint256 price, uint256[] memory ids, uint256 deadline) public {
        OfferLib.updateOffer(state, state2, offerId, amount, price, ids, deadline);
    }

    /// @notice Accept an offer
    /// @param offerId The offer ID
    /// @param delay The number of seconds that must pass before offer can be executed
    function acceptOffer(uint256 offerId, uint256 delay) public {
        OfferLib.acceptOffer(state2, offerId, delay);
    }

    /// @notice Unaccept an offer
    /// @param offerId The offer ID
    function unacceptOffer(uint256 offerId) public {
        OfferLib.unacceptOffer(state2, offerId);
    }

    /// @notice Cancel an offer
    /// @param offerId The offer ID
    function cancelOffer(uint256 offerId) public {
        OfferLib.cancelOffer(state2, offerId);
    }

    /// @notice Execute an offer
    /// @param offerId The offer ID
    /// @param txDeadline The transaction is reverted if current time >= expireAt
    function executeOffer(uint256 offerId, uint256 txDeadline) public notExpired(txDeadline) {
        OfferLib.executeOffer(state, state2, offerId);
    }

    /// @notice Toggle liquidity pause state
    /// @param marketId The market ID
    /// @param lid The liquidity ID
    /// @param expireAt The transaction is reverted if current time >= expireAt
    function togglePause(address marketId, uint256 lid, uint256 expireAt) public notExpired(expireAt) {
        LiquidityLib.togglePause(state, marketId, lid);
    }
}
