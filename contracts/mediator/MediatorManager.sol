// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../token/interfaces/IERC20.sol";
import "../randomness/interfaces/IRandomness.sol";
import "../vendor/@openzeppelin/contracts/access/Ownable.sol";
import "../common/MathLib.sol";
import "../common/Structs.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../market/interfaces/IMarketCore.sol";

/// @title Mediator Manager
/// @notice MediatorManager is responsible for mediating disputed orders.
contract MediatorManager is Ownable, ReentrancyGuard {
    address public token;
    IRandomness public randomness;
    IMarketCore public marketCore;
    address public disputeManager;

    /// @notice The initial price of a ticket
    uint256 public baseTicketPrice = 10;

    /// @notice Number of seconds in a window
    uint256 public windowDur = 86400;

    /// @notice Number of tickets per window
    uint256 public ticketsPerWindow = 256;

    /// @notice Total number of ticket supply
    uint256 public ticketSupply = 60000;

    /// @notice Total number of tickets sold
    uint256 public ticketSold;

    /// @notice The base point used for (in|de)creasing ticket supply and price between windows
    uint256 public priceSupplyDeltaBP = 1000;

    /// @notice The number of consecutive inactive windows before ticket price reset
    uint256 public minInactiveWindowBeforeReset = 7;

    /// @notice The base point used to determine a sold out window
    uint256 public soldOutBP = 10000;

    /// @notice The maximum number of times a ticket can be paused
    uint256 public maxPause = 3;

    // The supported mediator pools
    mapping(uint256 => Structs.TicketPool) public pools;

    /// @notice Mapping of tickets owned by addresses
    mapping(address => Structs.Ticket[]) public tickets;

    /// @notice Tickets assigned to a pool
    mapping(uint256 => Structs.PoolTicket[]) public poolTickets;

    /// @notice Mapping of pool to their owners
    mapping(uint256 => address) public poolOwners;

    /// @notice Mapping of pool to their approvals
    mapping(uint256 => mapping(address => bool)) public poolApprovals;

    /// @notice Mapping of pool to their market approvals
    mapping(uint256 => mapping(address => bool)) public poolMarketApprovals;

    /// @notice Track purchase windows
    Structs.PurchaseWindow[] public windows;

    /// @notice The number of seconds to lock bonds after cancellation.
    uint256 public ticketCancelDur;

    /// @notice The number of seconds required for a mediator to be considered mature.
    uint256 public ticketMatureDur;

    /// @notice The duration a new ticket is expected to join a market or become expired
    uint256 public ticketExpireDur;

    /// @notice The duration a ticket can remain paused for
    uint256 public ticketPauseDur;

    event TicketPurchased(address owner, uint256 id, uint256 poolId, uint256 amount, uint256 matureAt, uint256 joinBy);
    event TicketCancelled(address owner, uint256 id);
    event TicketDrained(address owner, uint256 id, uint256 amount);
    event JoinedPool(address owner, uint256 poolId, uint256 ticketId);
    event Drafted(address marketId, address owner, uint256 ticketId, uint256 orderID, uint256 disputeID, address drafter);
    event Undrafted(address owner, uint256 ticketId, bool slashed, address undrafter);
    event TicketSlashed(address owner, uint256 ticketId, uint256 amount, bool voted, bool winSide);
    event TicketSlashedByOwner(address owner, uint256 ticketId, uint256 amount);
    event UpdatedRandomnessProvider(address val);
    event UpdatedDisputeManager(address val);
    event UpdatedMarketCore(address val);
    event TicketBlocked(address owner, uint256 id, bool blocked);
    event TicketPaused(address ticketOwner, uint256 ticketId, bool paused, uint256 pauseDur);
    event PoolMediatorApproval(uint256 poolId, address addr, bool approved);
    event PoolMarketApproval(uint256 poolId, address addr, bool approved);
    event UpdatedTicketDurations(uint256 ticketCancelDur, uint256 ticketMatureDur, uint256 ticketExpireDur, uint256 ticketPauseDur);
    event UpdatedTicketPool(
        uint256 poolId,
        uint256 reqBond,
        uint256 draftReward,
        uint256 winReward,
        uint256 noVoteSlashBP,
        uint256 loseVoteSlashBP,
        uint256 numDraftees,
        uint256 evidenceDur,
        uint256 predictDur,
        bool approvedMediatorOnly,
        bool approvedMarketOnly
    );
    event UpdatedTicketParams(
        uint256 baseTicketPrice,
        uint256 windowDur,
        uint256 ticketsPerWindow,
        uint256 baseTicketSupply,
        uint256 priceSupplyDeltaBP,
        uint256 minInactiveWindowBeforeReset,
        uint256 soldOutBP
    );
    event UpdatedMaxPause(uint256 maxPause);

    /// @notice Modifier to sender is the dispute manager
    modifier isDisputeMgr() {
        require(msg.sender == disputeManager, "MM: NOT_DISPUTE_MGR");
        _;
    }

    /// @notice Initialize the contract.
    /// @param _token The address of the native token.
    /// @param _marketCore The address of the market core contract.
    /// @param _randAddr The randomness contract address.
    /// @param _ticketCancelDur Seconds it takes to cancel a ticket.
    /// @param _ticketMatureDur Seconds it takes for a ticket to mature.
    /// @param _ticketPauseDur Seconds a ticket can remain paused for
    constructor(
        address _token,
        address _marketCore,
        address _randAddr,
        uint256 _ticketCancelDur,
        uint256 _ticketMatureDur,
        uint256 _ticketExpireDur,
        uint256 _ticketPauseDur
    ) {
        token = _token;
        marketCore = IMarketCore(_marketCore);
        randomness = IRandomness(_randAddr);
        ticketCancelDur = _ticketCancelDur;
        ticketMatureDur = _ticketMatureDur;
        ticketExpireDur = _ticketExpireDur;
        ticketPauseDur = _ticketPauseDur;
    }

    /// @notice Update or add a new ticket pool
    /// @param poolId The pool id
    /// @param reqBond The required bond
    /// @param draftReward The reward to disburse to drafted ticket
    /// @param winReward The reward to disburse to winning ticket
    /// @param noVoteSlashBP The slash percentage for no vote
    /// @param loseVoteSlashBP The slash percentage for losing vote
    /// @param numDraftees The number of draftees to select from the pool per dispute
    /// @param evidenceDur The duration for evidence submission
    /// @param predictDur The duration for prediction submission
    /// @param approvedMediatorOnly Indicates whether only approved mediators can join the pool
    /// @param approvedMarketOnly Indicates whether only approved markets can join the pool
    function updateTicketPool(
        uint256 poolId,
        uint256 reqBond,
        uint256 draftReward,
        uint256 winReward,
        uint256 noVoteSlashBP,
        uint256 loseVoteSlashBP,
        uint256 numDraftees,
        uint256 evidenceDur,
        uint256 predictDur,
        bool approvedMediatorOnly,
        bool approvedMarketOnly
    ) external {
        address _owner = poolOwners[poolId];
        require(_owner == msg.sender || _owner == address(0), "MM: NOT_OWNER");

        pools[poolId] = Structs.TicketPool(
            true,
            approvedMediatorOnly,
            approvedMarketOnly,
            reqBond,
            draftReward,
            winReward,
            noVoteSlashBP,
            loseVoteSlashBP,
            numDraftees,
            evidenceDur,
            predictDur
        );

        poolOwners[poolId] = msg.sender;

        emit UpdatedTicketPool(
            poolId,
            reqBond,
            draftReward,
            winReward,
            noVoteSlashBP,
            loseVoteSlashBP,
            numDraftees,
            evidenceDur,
            predictDur,
            approvedMediatorOnly,
            approvedMarketOnly
        );
    }

    /// @notice Update the maximum number of times a ticket can be paused
    /// @param _maxPause The maximum number of times a ticket can be paused
    function setMaxPause(uint256 _maxPause) external onlyOwner {
        maxPause = _maxPause;
        emit UpdatedMaxPause(_maxPause);
    }

    /// @notice Approve or disapprove an address to a pool
    /// @param poolId The pool id
    /// @param addr The address to approve
    function toggleApproveMediator(uint256 poolId, address addr) external {
        require(poolOwners[poolId] == msg.sender, "MM: NOT_OWNER");
        require(pools[poolId].approvedMediatorOnly, "MM: NOT_APPROVE_ONLY");
        poolApprovals[poolId][addr] = !poolApprovals[poolId][addr];
        emit PoolMediatorApproval(poolId, addr, poolApprovals[poolId][addr]);
    }

    /// @notice Check if an address is approved to mediate in a pool
    /// @param poolId The pool id
    /// @param addr The address to check
    function isApprovedMediator(uint256 poolId, address addr) public view returns (bool) {
        return (pools[poolId].exists && !pools[poolId].approvedMediatorOnly) || poolApprovals[poolId][addr];
    }

    /// @notice Approve or disapprove a market to a pool
    /// @param poolId The pool id
    /// @param marketAddr The market address to approve
    function toggleApproveMarket(uint256 poolId, address marketAddr) external {
        require(poolOwners[poolId] == msg.sender, "MM: NOT_OWNER");
        require(pools[poolId].approvedMarketOnly, "MM: NOT_APPROVE_ONLY");
        poolMarketApprovals[poolId][marketAddr] = !poolMarketApprovals[poolId][marketAddr];
        emit PoolMarketApproval(poolId, marketAddr, poolMarketApprovals[poolId][marketAddr]);
    }

    /// @notice Check if a market is approved to join a pool
    /// @param poolId The pool id
    /// @param marketAddr The market address to check
    function isApprovedMarket(uint256 poolId, address marketAddr) public view returns (bool) {
        return (pools[poolId].exists && !pools[poolId].approvedMarketOnly) || poolMarketApprovals[poolId][marketAddr];
    }

    /// @notice Set address of randomness provider
    /// @param provider The address of the randomness provider
    function setRandomnessProvider(address provider) external onlyOwner {
        randomness = IRandomness(provider);
        emit UpdatedRandomnessProvider(provider);
    }

    /// @notice Set various ticket durations
    /// @param _ticketCancelDur The duration to cancel a ticket
    /// @param _ticketMatureDur The duration for a ticket to mature
    /// @param _ticketExpireDur The duration for a ticket to expire
    /// @param _ticketPauseDur The duration for a ticket to remain paused
    function setTicketDurations(
        uint256 _ticketCancelDur,
        uint256 _ticketMatureDur,
        uint256 _ticketExpireDur,
        uint256 _ticketPauseDur
    ) external onlyOwner {
        ticketCancelDur = _ticketCancelDur;
        ticketMatureDur = _ticketMatureDur;
        ticketExpireDur = _ticketExpireDur;
        ticketPauseDur = _ticketPauseDur;
        emit UpdatedTicketDurations(_ticketCancelDur, _ticketMatureDur, _ticketExpireDur, _ticketPauseDur);
    }

    /// @notice Set ticket parameters
    /// @param _baseTicketPrice The base ticket price
    /// @param _windowDur The window duration for ticket purchase
    /// @param _ticketsPerWindow The number of tickets per window
    /// @param _baseTicketSupply The base ticket supply
    /// @param _priceSupplyDeltaBP The base point used for (in|de)creasing ticket supply and price between windows
    /// @param _minInactiveWindowBeforeReset The number of consecutive inactive windows before ticket price reset
    /// @param _soldOutBP The base point used to determine a sold out window
    function setTicketMarketParams(
        uint256 _baseTicketPrice,
        uint256 _windowDur,
        uint256 _ticketsPerWindow,
        uint256 _baseTicketSupply,
        uint256 _priceSupplyDeltaBP,
        uint256 _minInactiveWindowBeforeReset,
        uint256 _soldOutBP
    ) external onlyOwner {
        baseTicketPrice = _baseTicketPrice;
        windowDur = _windowDur;
        ticketsPerWindow = _ticketsPerWindow;
        ticketSupply = _baseTicketSupply;
        priceSupplyDeltaBP = _priceSupplyDeltaBP;
        minInactiveWindowBeforeReset = _minInactiveWindowBeforeReset;
        soldOutBP = _soldOutBP;
        emit UpdatedTicketParams(
            _baseTicketPrice,
            _windowDur,
            _ticketsPerWindow,
            _baseTicketSupply,
            _priceSupplyDeltaBP,
            _minInactiveWindowBeforeReset,
            _soldOutBP
        );
    }

    /// @notice Set the dispute manager
    /// @param _disputeManager The dispute manager address
    function setDisputeManager(address _disputeManager) external onlyOwner {
        disputeManager = _disputeManager;
        emit UpdatedDisputeManager(_disputeManager);
    }

    /// @notice Set the market core
    /// @param _marketCore The market core address
    function setMarketCore(address _marketCore) external onlyOwner {
        marketCore = IMarketCore(_marketCore);
        emit UpdatedMarketCore(_marketCore);
    }

    // @notice Check if a pool exists
    // @param poolId The pool id
    function poolExists(uint256 poolId) public view returns (bool) {
        return pools[poolId].exists;
    }

    // @notice Get pool
    // @param poolId The pool id
    function getTicketPool(uint256 poolId) public view returns (Structs.TicketPool memory) {
        return pools[poolId];
    }

    /// @notice Get number of windows created
    function numWindows() public view returns (uint256) {
        return windows.length;
    }

    /// @notice Get a ticket owned by the given owner address
    /// @param ticketOwner The ticketOwner address
    /// @param id The ticket ID
    function getTicket(address ticketOwner, uint256 id) public view returns (Structs.Ticket memory) {
        require(ticketExist(ticketOwner, id), "MM: UNKNOWN_TICKET");
        return tickets[ticketOwner][id];
    }

    /// @notice Determine if a window was sold out
    /// @param win The window to check
    function isSoldOut(Structs.PurchaseWindow memory win) internal view returns (bool) {
        return win.numPurchases >= ((win.supply * soldOutBP) / 10000);
    }

    /// @notice Make the next window
    /// If current window was sold out, increase supply and price of next window by priceSupplyDeltaBP.
    /// If current window was not sold out, decrease supply and price of next window by priceSupplyDeltaBP.
    /// EXPECT: To be called after the initial window.
    function makeNextPurchaseWindow() internal view returns (Structs.PurchaseWindow memory) {
        Structs.PurchaseWindow memory prevWin = windows[windows.length - 1];
        bool soldOut = isSoldOut(prevWin);
        uint256 supply = soldOut
            ? prevWin.supply + ((prevWin.supply * priceSupplyDeltaBP) / 10000)
            : prevWin.supply - ((prevWin.supply * priceSupplyDeltaBP) / 10000);
        uint256 price = soldOut
            ? prevWin.price + ((prevWin.price * priceSupplyDeltaBP) / 10000)
            : prevWin.price - ((prevWin.price * priceSupplyDeltaBP) / 10000);
        return
            Structs.PurchaseWindow(
                block.timestamp + windowDur,
                1,
                MathLib.max(supply, ticketsPerWindow),
                MathLib.max(price, baseTicketPrice)
            );
    }

    /// @notice Get the current ticket price
    /// When no window, return base price.
    /// When there is an existing window and it as not ended, return the window's price.
    /// When the existing window has ended, return the base price if n windows have passed unrecorded, else
    /// compute the next window and return its price.
    function getTicketPrice() public view returns (uint256) {
        if (windows.length == 0) return baseTicketPrice;
        Structs.PurchaseWindow memory curWin = windows[windows.length - 1];
        bool ended = curWin.endTime < block.timestamp;
        if (windows.length >= 1 && !ended) return curWin.price;
        if (ended && (block.timestamp - curWin.endTime) / windowDur >= minInactiveWindowBeforeReset) return baseTicketPrice;
        return makeNextPurchaseWindow().price;
    }

    /// @notice Check if a ticket exists
    /// @param ticketOwner The owner address
    /// @param id The ticket ID
    function ticketExist(address ticketOwner, uint256 id) internal view returns (bool) {
        return tickets[ticketOwner].length >= id + 1 && tickets[ticketOwner][id].bond > 0;
    }

    /// @notice Purchase mediator ticket
    /// @param poolId The pool ID to purchase ticket for
    function purchaseTicket(uint256 poolId) external nonReentrant {
        require(ticketSold < ticketSupply, "MM: SOLD_OUT");
        require(poolExists(poolId), "MM: UNKNOWN_POOL");

        // Create new purchase window if none exist.
        // If one exist but has expired, create a new purchase window.
        // Otherwise, update existing window.
        if (windows.length == 0) {
            windows.push(Structs.PurchaseWindow(block.timestamp + windowDur, 1, ticketsPerWindow, baseTicketPrice));
        } else {
            Structs.PurchaseWindow storage curWin = windows[windows.length - 1];
            if (curWin.endTime <= block.timestamp) windows.push(makeNextPurchaseWindow());
            else curWin.numPurchases++;
        }

        // Create new ticket
        uint256 matureAt = block.timestamp + ticketMatureDur;
        uint256 joinBy = matureAt + ticketExpireDur;
        address sdr = msg.sender;
        Structs.TicketPool memory pool = pools[poolId];
        uint256 totalBond = getTicketPrice() + pool.reqBond;
        Structs.Ticket memory ticket;
        ticket.owner = sdr;
        ticket.idx = tickets[sdr].length;
        ticket.poolId = poolId;
        ticket.bond = totalBond;
        ticket.matureAt = matureAt;
        ticket.joinBy = joinBy;
        tickets[sdr].push(ticket);
        ticketSold++;

        // Transfer bond to this contract
        IERC20(token).transferFrom(sdr, address(this), totalBond);

        emit TicketPurchased(sdr, tickets[sdr].length - 1, poolId, totalBond, matureAt, joinBy);
    }

    /// @notice Join a mature ticket to its assigned pool
    /// @param ticketId The ticket ID
    function join(uint256 ticketId) external {
        address sender = msg.sender;
        require(ticketExist(sender, ticketId), "MM: UNKNOWN_TICKET");

        // Make sure ticket has not joined its assigned pool and bond is sufficient
        Structs.Ticket storage ticket = tickets[sender][ticketId];
        require(isApprovedMediator(ticket.poolId, sender), "MM: NOT_APPROVED");
        require(!ticket.status.joined, "MM: ALREADY_JOINED");
        require(ticket.bond >= pools[ticket.poolId].reqBond, "MM: LOW_BOND");

        // Make sure ticket is not blocked, expired, cancelled or immature
        require(!ticket.status.blocked, "MM: BLOCKED");
        require(ticket.matureAt <= block.timestamp, "MM: NOT_MATURE");
        require(ticket.joinBy > block.timestamp, "MM: EXPIRED");
        require(ticket.cancelAt == 0, "MM: CANCELLED");

        // Lock ticket to pool
        ticket.status.joined = true;
        ticket.joinBy = 0;
        ticket.poolIdx = int256(poolTickets[ticket.poolId].length);
        poolTickets[ticket.poolId].push(Structs.PoolTicket(ticket.owner, ticket.idx));

        emit JoinedPool(sender, ticket.poolId, ticketId);
    }

    /// @notice Force a ticket to enter `cancelling` state.
    /// Ticket must be mature and not drafted and not blocked.
    /// @param id The ticket ID
    function cancelTicket(uint256 id) external {
        require(ticketExist(msg.sender, id), "MM: UNKNOWN_TICKET");
        Structs.Ticket storage t = tickets[msg.sender][id];
        require(!t.status.blocked, "MM: BLOCKED");
        require(t.cancelAt == 0, "MM: CANCELLING");
        require(t.matureAt <= block.timestamp, "MM: NOT_MATURE");
        require(!t.status.drafted, "MM: IS_DRAFTED");

        if (t.status.joined) {
            t.status.joined = false;
            removeTicketFromPool(t);
        }

        t.cancelAt = block.timestamp + ticketCancelDur;
        emit TicketCancelled(msg.sender, id);
    }

    /// @notice Drain the bond from a cancelled and unblocked ticket
    /// @param id The ticket ID
    function drainTicket(uint256 id) external nonReentrant {
        require(ticketExist(msg.sender, id), "MM: UNKNOWN_TICKET");
        Structs.Ticket storage t = tickets[msg.sender][id];
        require(!t.status.blocked, "MM: BLOCKED");
        require(t.cancelAt > 0 && t.cancelAt <= block.timestamp, "MM: NOT_CANCELLED");

        uint256 bond = t.bond;
        t.bond = 0;
        t.status.joined = false;
        ticketSold--;
        IERC20(token).transfer(msg.sender, bond);
        emit TicketDrained(msg.sender, id, bond);
    }

    /// @notice Remove the ticket from its current pool.
    /// @param ticket The target ticket
    function removeTicketFromPool(Structs.Ticket storage ticket) internal {
        if (ticket.poolIdx == -1) return;
        Structs.PoolTicket memory last = poolTickets[ticket.poolId][poolTickets[ticket.poolId].length - 1];
        poolTickets[ticket.poolId][uint256(ticket.poolIdx)] = last;
        poolTickets[ticket.poolId].pop();
        Structs.Ticket storage lastTicket = tickets[last.owner][last.idx];
        lastTicket.poolIdx = ticket.poolIdx;
        ticket.poolIdx = -1;
    }

    /// @notice Draft a ticket from the market's ticket list.
    /// @param marketId The market ID of the market to draft from.'
    /// @param orderID The order ID
    /// @param disputeID The dispute ID
    function draft(address marketId, uint256 orderID, uint256 disputeID) external isDisputeMgr returns (Structs.Ticket memory) {
        Structs.Market memory mkt = marketCore.getMarket(marketId);

        // Make sure market selected pool has tickets
        Structs.PoolTicket[] storage _poolTickets = poolTickets[mkt.poolId];
        require(_poolTickets.length > 0, "MM: NO_TICKETS");

        // Randomly select a ticket
        uint256 randIdx = randomness.randomN(_poolTickets.length);
        Structs.PoolTicket storage ticket = _poolTickets[randIdx];
        Structs.Ticket storage t = tickets[ticket.owner][ticket.idx];
        t.status.drafted = true;
        emit Drafted(marketId, t.owner, ticket.idx, orderID, disputeID, tx.origin);

        // Remove the ticket from the pool so subsequent draft
        // calls do not attempt to re-draft same ticket.
        removeTicketFromPool(t);

        return t;
    }

    /// @notice Undraft a ticket
    /// @param ticketOwner The ticket owner.
    /// @param ticketId The ticket ID.
    /// @param voted Indicates whether the mediator voted during the draft.
    /// @param winSide Indicated whether the mediator was on the winning side if they voted.
    function undraft(address ticketOwner, uint256 ticketId, bool voted, bool winSide) external isDisputeMgr returns (uint256) {
        // Mark ticket as undrafted
        Structs.Ticket storage t = tickets[ticketOwner][ticketId];
        t.status.drafted = false;
        uint256 slashAmt;

        // If ticket did not vote, slash its bond
        // If ticket voted and was not on the winning side, slash its bond.
        Structs.TicketPool memory pool = pools[t.poolId];
        if (!voted) slashAmt = (t.bond * pool.noVoteSlashBP) / 10000;
        if (voted && !winSide) slashAmt = (t.bond * pool.loseVoteSlashBP) / 10000;

        emit Undrafted(t.owner, t.idx, slashAmt > 0, tx.origin);

        // If ticket was slashed, calculate, deduct and burn slash amount.
        if (slashAmt > 0) {
            slashAmt = t.bond < slashAmt ? t.bond : slashAmt;
            t.bond -= slashAmt;
            emit TicketSlashed(t.owner, t.idx, slashAmt, voted, winSide);
            t.status.joined = false;
            t.cancelAt = block.timestamp;
            t.status.paused = false;
            t.status.slashed = true;
            IERC20(token).burn(slashAmt);
            return slashAmt;
        }

        // Ticket must be added back in the pool:
        // - If it was not blocked
        // - If it is still approved to join the pool
        // - If it is not paused
        if (!t.status.blocked && isApprovedMediator(t.poolId, t.owner) && !t.status.paused) {
            t.poolIdx = int256(poolTickets[t.poolId].length);
            poolTickets[t.poolId].push(Structs.PoolTicket(t.owner, t.idx));
        } else {
            t.status.joined = false;
            t.cancelAt = block.timestamp;
        }

        return slashAmt;
    }

    /// @notice Slash a ticket
    /// The ticket must be joined to a pool or have been slashed.
    /// The ticket must not have been drafted.
    /// @param ticketOwner The ticket owner address
    /// @param ticketId The ticket ID
    /// @param amount The amount to slash by
    function slash(address ticketOwner, uint256 ticketId, uint256 amount) external onlyOwner {
        require(ticketExist(ticketOwner, ticketId), "MM: UNKNOWN_TICKET");
        Structs.Ticket storage t = tickets[ticketOwner][ticketId];
        require(t.status.joined || t.status.slashed, "MM: NOT_READY");
        require(!t.status.drafted, "MM: IS_DRAFTED");

        // Deduct the bond from the ticket
        if (t.bond < amount) amount = t.bond;
        t.bond -= amount;

        // If ticket is joined, remove it from the pool, mark it as cancelled and unblock it
        if (t.status.joined) removeTicketFromPool(t);
        t.status.joined = false;
        t.cancelAt = block.timestamp;
        t.status.blocked = false;
        t.status.slashed = true;

        // Burn the deducted amount
        IERC20(token).burn(amount);

        emit TicketSlashedByOwner(ticketOwner, ticketId, amount);
    }

    /// @notice Block or unblock a ticket.
    /// Useful for when an offending ticket is currently awaiting governance action to slash it.
    /// Blocked ticket cannot join a pool, cannot be cancelled or drained, will not be added back to
    /// the pool when undrafted.
    function toggleBlock(address ticketOwner, uint256 ticketId) external onlyOwner {
        require(ticketExist(ticketOwner, ticketId), "MM: UNKNOWN_TICKET");
        tickets[ticketOwner][ticketId].status.blocked = !tickets[ticketOwner][ticketId].status.blocked;
        emit TicketBlocked(ticketOwner, ticketId, tickets[ticketOwner][ticketId].status.blocked);
    }

    /// @notice Pause or unpause a ticket. Pausing is like cancelling a ticket but with the ability to
    /// unpause it. A paused ticket cannot join a pool and will not be added back to the pool when undrafted.
    /// @param ticketId The ticket ID
    function togglePause(uint256 ticketId) external {
        require(ticketExist(msg.sender, ticketId), "MM: UNKNOWN_TICKET");
        Structs.Ticket storage t = tickets[msg.sender][ticketId];
        require(!t.status.blocked, "MM: BLOCKED");
        require(t.matureAt <= block.timestamp, "MM: NOT_MATURE");
        require(t.cancelAt == 0 || t.cancelAt > block.timestamp, "MM: CANCELLED");

        t.status.paused = !t.status.paused;

        if (t.status.paused) {
            require(t.numPaused < maxPause, "MM: MAX_PAUSE_REACHED");
            removeTicketFromPool(t);
            t.cancelAt = block.timestamp + ticketPauseDur;
            t.numPaused++;
        } else {
            t.cancelAt = 0;

            // Add ticket back to pool if it is not currently drafted.
            // If it is drafted, it will be added back to the pool when undrafted.
            if (!t.status.drafted) {
                t.poolIdx = int256(poolTickets[t.poolId].length);
                poolTickets[t.poolId].push(Structs.PoolTicket(t.owner, t.idx));
            }
        }

        emit TicketPaused(msg.sender, ticketId, t.status.paused, ticketPauseDur);
    }
}
