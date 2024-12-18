// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../common/MathLib.sol";
import "../common/Structs.sol";
import "../mediator/interfaces/IMediatorManager.sol";
import "../market/interfaces/IMarketCore.sol";
import "../token/interfaces/IERC20.sol";
import "../common/Ownable.sol";
import "../market/MarketAuxLib.sol";
import "../minerregisty/interfaces/IMinerRegistry.sol";
import "hardhat/console.sol";

struct Dispute {
    uint256 commitEndAt;
    uint256 predictEndAt;
    uint256 evidenceEndAt;
    uint256 nRelease;
    uint256 nCancel;
    uint256 undrafted;
    uint256[] ticketIndexes;
    address marketId;
    address creator;
    address defendant;
    address[] ticketOwners;
    bool executed;
    bool wantRelease;
    // Indicates the dispute was not resolved through voting.
    // Instead it means the order was already released when the dispute was executed.
    bool abandoned;
}

struct UndraftSlot {
    bool voted;
    bool votedWin;
    address ticketOwner;
    uint256 ticketIdx;
    Prediction pred;
    bytes1 winningVote;
}

struct Prediction {
    bool revealed;
    bytes32 committed;
    bytes1 vote;
}

/// @title Dispute Manager
/// @dev DisputeManager is responsible for managing disputes.
contract DisputeManager is Ownable {
    IERC20 public token;
    IMarketCore public marketCore;
    ICore public core;
    IMediatorManager public mediatorMgr;
    IMinerRegistry public minerReg;

    /// @notice Mapping of disputes by their order Id.
    mapping(uint256 => Dispute[]) public disputes;

    /// @notice Mapping of disputes predictions by order Id.
    /// orderId => disputeId => draftee address => ticket index => prediction
    mapping(uint256 => mapping(uint256 => mapping(address => mapping(uint256 => Prediction)))) public predictions;

    /// @notice Mapping of commits hash seen by the contract.
    mapping(bytes32 => bool) public seenCommits;

    /// @notice Mapping of prediction reward balance by address.
    mapping(address => uint256) public rewards;

    /// @notice The duration within which mediators are supposed to submit predictions.
    uint256 public predictDur;

    /// @notice The duration within which evidences should be submitted
    uint256 public evidenceDur;

    event DisputeCreated(uint256 orderId, address creator, uint256 index, bool wantRelease);
    event DraftedMediator(address marketId, uint256 poolId, uint256 orderId, uint256 ticketId, address mediator, address drafter);
    event Committed(address marketId, uint256 orderId, uint256 disputeId, address committer, uint256 ticketIdx, bytes32 hash);
    event Revealed(address marketId, uint256 orderId, uint256 disputeId, address revealer, uint256 ticketIdx, bytes1 vote);
    event WithdrawnReward(address claimer, uint256 amount);
    event Drafted(address marketId, address owner, uint256 ticketId, uint256 orderID, uint256 disputeID, address drafter);
    event Undrafted(address owner, uint256 ticketId, bool slashed, address undrafter);
    event DecisionExecuted(address marketId, uint256 orderId, uint256 disputeId, address executor, bool abandoned, bytes1 winningVote);
    event UpdatedMarketCore(address addr);
    event UpdatedCore(address addr);
    event UpdatedMediatorManager(address addr);
    event UpdatedPredictDur(uint256 val);
    event WithdrawnBalance(address dest, uint256 amt);
    event UpdatedEvidenceDur(uint256 val);
    event UpdatedMinerRegistry(address addr);

    /// @notice Initialize the contract.
    /// @param _token The address of the token contract
    /// @param _marketCore The address of the market core contract
    /// @param _core The address of the core contract
    /// @param _medMgrAddr The address of the mediator manager contract
    /// @param _predictDur The duration within which mediators are supposed to submit predictions
    /// @param _evidenceDur The duration within which evidences should be submitted
    constructor(address _token, address _marketCore, address _core, address _medMgrAddr, uint256 _predictDur, uint256 _evidenceDur) {
        token = IERC20(_token);
        marketCore = IMarketCore(_marketCore);
        core = ICore(_core);
        mediatorMgr = IMediatorManager(_medMgrAddr);
        predictDur = _predictDur;
        evidenceDur = _evidenceDur;
    }

    modifier onlyMiner() {
        require(minerReg.isMiner(msg.sender), "DM: NOT_MINER");
        _;
    }

    /// @notice Set MarketCore contract address
    /// @param addr The address of the market core contract.
    function setMarketCore(address addr) external onlyOwner {
        marketCore = IMarketCore(addr);
        emit UpdatedMarketCore(addr);
    }

    /// @notice Set MinerRegistry contract address
    /// @param addr The address of the miner registry contract.
    function setMinerRegistry(address addr) external onlyOwner {
        minerReg = IMinerRegistry(addr);
        emit UpdatedMinerRegistry(addr);
    }

    /// @notice Set Core contract address
    /// @param addr The address of the core contract.
    function setCore(address addr) external onlyOwner {
        core = ICore(addr);
        emit UpdatedCore(addr);
    }

    /// @notice Set mediator manager
    /// @param addr The contract address of the mediator manager.
    function setMediatorManager(address addr) external onlyOwner {
        mediatorMgr = IMediatorManager(addr);
        emit UpdatedMediatorManager(addr);
    }

    /// @notice Set the prediction duration.
    /// @param val The new value
    function setPredictDur(uint256 val) external onlyOwner {
        predictDur = val;
        emit UpdatedPredictDur(val);
    }

    /// @notice Set the evidence duration.
    /// @param val The new value
    function setEvidenceDur(uint256 val) external onlyOwner {
        evidenceDur = val;
        emit UpdatedEvidenceDur(val);
    }

    /// @notice Return _default if _target is zero, otherwise _target is returned
    /// @param _target The target value
    /// @param _default The default or fallback value
    function setOrDef(uint256 _target, uint256 _default) internal pure returns (uint256) {
        return (_target != 0) ? _target : _default;
    }

    /// @notice Create a dispute.
    /// @param orderId The order Id
    /// @param wantRelease Whether a release outcome is preferred
    function createDispute(uint256 orderId, bool wantRelease) external {
        require(core.canCreateDispute(orderId, msg.sender), "DM: NOT_ALLOWED");

        // If there is an existing dispute, allow new dispute
        // only if the previous dispute has stalled.
        Dispute[] storage orderDisputes = disputes[orderId];
        if (orderDisputes.length > 0) {
            Dispute memory last = orderDisputes[orderDisputes.length - 1];
            require(last.predictEndAt > 0 && last.predictEndAt < block.timestamp, "DM: PREV_ACTIVE");
            require(getWinningVote(last) == 0, "DM: PREV_RESOLVED");
        }

        // Create the dispute and mark the order as disputed
        Structs.Order memory order = core.getOrder(orderId);
        Structs.Market memory market = marketCore.getMarket(order.marketId);
        require(mediatorMgr.isApprovedMarket(market.poolId, order.marketId), "DM: MKT_NOT_APPROVED");
        Dispute memory disp;
        disp.marketId = order.marketId;
        disp.creator = msg.sender;
        disp.defendant = (msg.sender == order.provider) ? order.taker : order.provider;
        disp.wantRelease = wantRelease;
        orderDisputes.push(disp);

        // If first round, mark as 'disputed' and increment liquidity dispute count
        if ((orderDisputes.length - 1) == 0) {
            core.markAsDisputed(orderId);
            core.updateOpenDisputesCount(order.marketId, order.provider, order.lid, true);
        }

        emit DisputeCreated(orderId, msg.sender, orderDisputes.length - 1, wantRelease);
    }

    /// @notice Get a dispute
    /// @param orderId The order Ids
    /// @param dispIdx The dispute index
    function getDispute(uint256 orderId, uint256 dispIdx) external view returns (Dispute memory) {
        return disputes[orderId][dispIdx];
    }

    /// @notice Get the number of disputes for an order
    /// @param orderId The order Id
    function countDisputes(uint256 orderId) external view returns (uint256) {
        return disputes[orderId].length;
    }

    /// @notice Draft a mediator to an order's dispute
    /// @param orderId The order Id
    function draftMediator(uint256 orderId) external onlyMiner {
        require(disputes[orderId].length > 0, "DM: NO_DISPUTE");
        Dispute storage dispute = disputes[orderId][disputes[orderId].length - 1];

        // Ensure dispute has not been executed/abandoned
        require(!dispute.abandoned && !dispute.executed, "DM: ALREADY_EXECUTED");

        // Ensure order has not been released
        Structs.Order memory order = core.getOrder(orderId);
        require(!order.released, "DM: ORDER_RELEASED");

        // Determine the number of mediators needed
        Structs.Market memory market = marketCore.getMarket(dispute.marketId);
        Structs.TicketPool memory pool = mediatorMgr.getTicketPool(market.poolId);
        require(dispute.ticketOwners.length < pool.numDraftees, "DM: MAX_DRAFTED");

        // Draft a mediator and add the mediator to the dispute.
        Structs.Ticket memory ticket = mediatorMgr.draft(dispute.marketId, orderId, disputes[orderId].length - 1);
        dispute.ticketOwners.push(ticket.owner);
        dispute.ticketIndexes.push(ticket.idx);

        // If sender is last draftee, set phases time.
        if (dispute.ticketOwners.length == pool.numDraftees) {
            dispute.evidenceEndAt = block.timestamp + setOrDef(pool.evidenceDur, evidenceDur);
            dispute.commitEndAt = dispute.evidenceEndAt + (setOrDef(pool.predictDur, predictDur) / 2);
            dispute.predictEndAt = dispute.evidenceEndAt + setOrDef(pool.predictDur, predictDur);
        }

        minerReg.addReward(MinerOperation.Draft, msg.sender);

        emit DraftedMediator(dispute.marketId, market.poolId, orderId, ticket.idx, ticket.owner, msg.sender);
    }

    /// @notice Check if the sender is one of the drafted tickets owners.
    /// If yes, it is allowed to vote
    /// @param dispute The target dispute object.
    /// @param ticketIdx The ticket index to check with
    function isDraftee(Dispute memory dispute, uint256 ticketIdx) internal view returns (bool) {
        uint256 len = dispute.ticketOwners.length;
        for (uint256 i = 0; i < len; i++) {
            if (dispute.ticketOwners[i] == msg.sender && dispute.ticketIndexes[i] == ticketIdx) return true;
        }
        return false;
    }

    /// @notice Commit a dispute prediction.
    /// @param _orderId The order Id.
    /// @param _ticketIdx The ticket index to commit with
    /// @param _hash The mediator's hashed prediction.
    function commitVote(uint256 _orderId, uint256 _ticketIdx, bytes32 _hash) external {
        require(!core.getOrder(_orderId).released, "DM: ORDER_RELEASED");
        require(!seenCommits[_hash], "DM: COMMIT_SEEN");
        uint256 lstDispIdx = disputes[_orderId].length - 1;
        Dispute memory dispute = disputes[_orderId][lstDispIdx];

        require(isDraftee(dispute, _ticketIdx), "DM: NOT_DRAFTED");
        require(predictions[_orderId][lstDispIdx][msg.sender][_ticketIdx].committed == 0, "DM: PREV_COMMITTED");
        require(dispute.evidenceEndAt > 0 && block.timestamp > dispute.evidenceEndAt, "DM: NOT_READY");
        require(dispute.commitEndAt > block.timestamp, "DM: COMMIT_OVER");

        predictions[_orderId][lstDispIdx][msg.sender][_ticketIdx] = Prediction(false, _hash, 0);
        seenCommits[_hash] = true;

        emit Committed(dispute.marketId, _orderId, lstDispIdx, msg.sender, _ticketIdx, _hash);
    }

    /// @notice Reveal a committed prediction
    /// @param _orderId The order Id.
    /// @param _ticketIdx The ticket index to reveal with
    /// @param _vote The plain _vote that was hashed in the commit phase.
    /// @param _hash The hash of the plain _vote.
    function revealVote(uint256 _orderId, uint256 _ticketIdx, string memory _vote, bytes32 _hash) external {
        require(!core.getOrder(_orderId).released, "DM: ORDER_RELEASED");

        uint256 lstDispIdx = disputes[_orderId].length - 1;
        Prediction storage prediction = predictions[_orderId][lstDispIdx][msg.sender][_ticketIdx];
        require(prediction.committed != 0, "DM: NO_COMMIT");
        require(!prediction.revealed, "DM: ALREADY_REVEALED");

        Dispute storage dispute = disputes[_orderId][lstDispIdx];
        require(block.timestamp > dispute.commitEndAt, "DM: NOT_READY");
        require(block.timestamp < dispute.predictEndAt, "DM: REVEAL_OVER");
        require(keccak256(abi.encodePacked(_vote, msg.sender)) == _hash, "DM: HASH_MISMATCH");
        require(_hash == prediction.committed, "DM: COMMIT_HASH_MISMATCH");

        bytes1 choice = bytes(_vote)[0];
        if (choice == "0") {
            dispute.nCancel++;
        } else if (choice == "1") {
            dispute.nRelease++;
        } else {
            revert("DM: INVALID_CHOICE");
        }

        prediction.revealed = true;
        prediction.vote = choice;

        emit Revealed(dispute.marketId, _orderId, lstDispIdx, msg.sender, _ticketIdx, choice);
    }

    /// @notice Get winning vote
    /// @param dispute The target dispute.
    function getWinningVote(Dispute memory dispute) internal pure returns (bytes1) {
        uint256 majority = MathLib.ceilDiv(51 * dispute.ticketOwners.length, 100);
        if (dispute.nRelease >= majority) return bytes1("1");
        if (dispute.nCancel >= majority) return bytes1("0");
        return 0;
    }

    /// @notice Execute the decision of a dispute
    /// @param orderId The order Id
    /// @param dispIdx The dispute index
    function executeDecision(uint256 orderId, uint256 dispIdx) external onlyMiner {
        require(dispIdx + 1 <= disputes[orderId].length, "DM: NO_DISPUTE");

        // Dispute must not have been executed
        Dispute storage dispute = disputes[orderId][dispIdx];
        require(!dispute.executed && !dispute.abandoned, "DM: ALREADY_EXECUTED");

        // Allow if order has been released or the dispute has passed prediction time
        Structs.Order memory order = core.getOrder(orderId);
        require(order.released || (dispute.predictEndAt > 0 && block.timestamp > dispute.predictEndAt), "DM: NOT_READY");

        // Mark as executed or abandoned. Abandoned when order is released.
        dispute.abandoned = order.released;
        dispute.executed = !dispute.abandoned;

        // Execute dispute decision
        bytes1 winningVote = (!dispute.abandoned) ? getWinningVote(dispute) : bytes1(0);
        if (winningVote == bytes1("1")) {
            core.releaseOrderByDispute(orderId);
        } else if (winningVote == bytes1("0")) {
            core.cancelOrderByDispute(orderId);
        }

        // Only decrement provider's liquidity dispute count
        // if this dispute was not redisputed and the vote was conclusive
        bool redisputed = disputes[orderId].length > dispIdx + 1;
        if (dispute.abandoned || (!redisputed && winningVote != 0))
            core.updateOpenDisputesCount(order.marketId, order.provider, order.lid, false);

        minerReg.addReward(MinerOperation.Execute, msg.sender);

        emit DecisionExecuted(dispute.marketId, orderId, dispIdx, msg.sender, dispute.abandoned, winningVote);
    }

    /// @notice Undraft a mediator from a dispute
    /// @param orderId The order Id
    /// @param dispIdx The dispute index
    function undraftMediator(uint256 orderId, uint256 dispIdx) external onlyMiner {
        require(dispIdx + 1 <= disputes[orderId].length, "DM: NO_DISPUTE");

        // Ensure dispute has been executed or abandoned
        Dispute storage dispute = disputes[orderId][dispIdx];
        require(dispute.executed || dispute.abandoned, "DM: NOT_EXECUTED");

        // Ensure not all mediators have been undrafted
        require(dispute.undrafted < dispute.ticketOwners.length, "DM: ALL_UNDRAFTED");

        // Pick a mediator ticket to undraft
        UndraftSlot memory slot;
        slot.ticketOwner = dispute.ticketOwners[dispute.undrafted];
        slot.ticketIdx = dispute.ticketIndexes[dispute.undrafted];

        // Get the winning vote if dispute was not abandoned.
        slot.winningVote = (!dispute.abandoned) ? getWinningVote(dispute) : bytes1(0);

        // Determine if the ticket won or lost.
        // - If the dispute was abandoned, we assume the ticket voted and won to prevent slashing.
        // - If there is no winning vote and a ticket voted, we assume the ticket voted and won to prevent slashing.
        slot.pred = predictions[orderId][dispIdx][slot.ticketOwner][slot.ticketIdx];
        slot.voted = (dispute.abandoned) ? true : slot.pred.vote != 0;
        slot.votedWin = (dispute.abandoned) ? true : slot.voted && ((slot.winningVote == 0) ? true : slot.pred.vote == slot.winningVote);
        mediatorMgr.undraft(slot.ticketOwner, slot.ticketIdx, slot.voted, slot.votedWin);

        Structs.Market memory market = marketCore.getMarket(dispute.marketId);
        Structs.TicketPool memory pool = mediatorMgr.getTicketPool(market.poolId);

        // If dispute was abandoned or redisputed, grant drafting reward to mediator
        if (dispute.abandoned || slot.winningVote == 0) {
            rewards[slot.ticketOwner] += pool.draftReward / (1 + dispIdx);
        }

        // If dispute was not abandoned, dispute did not stall and ticket voted and won, then grant win reward to mediator
        if (!dispute.abandoned && slot.winningVote != 0 && slot.votedWin) {
            rewards[slot.ticketOwner] += pool.winReward / (1 + dispIdx);
        }

        dispute.undrafted++;

        minerReg.addReward(MinerOperation.Undraft, msg.sender);
    }

    /// @notice Get reward balance
    /// @param addr The target account address
    function rewardBalanceOf(address addr) public view returns (uint256) {
        return rewards[addr];
    }

    /// @notice Withdraw reward.
    function withdrawReward() external {
        require(rewards[msg.sender] > 0, "DM: ZERO_BAL");
        uint256 amt = rewards[msg.sender];
        rewards[msg.sender] = 0;
        token.transfer(msg.sender, amt);
        emit WithdrawnReward(msg.sender, amt);
    }

    /// @notice Withdraw all token balance from the contract
    /// @param dest The destination address
    function withdrawBalance(address dest) external onlyOwner {
        uint256 amt = token.balanceOf(address(this));
        token.transfer(dest, amt);
        emit WithdrawnBalance(dest, amt);
    }
}

interface ICore {
    function canCreateDispute(uint256 id, address addr) external view returns (bool);

    function markAsDisputed(uint256 id) external;

    function getOrder(uint256 id) external view returns (Structs.Order memory);

    function releaseOrderByDispute(uint256 id) external;

    function cancelOrderByDispute(uint256 id) external;

    function updateOpenDisputesCount(address marketId, address provider, uint256 lid, bool incr) external;
}
