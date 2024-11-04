// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.13;

import "../common/Ownable.sol";
import "../common/Writable.sol";
import "../token/interfaces/IERC20.sol";

struct Miner {
    bool exists;
    uint256 bond;
    uint256 matureAt;
    uint256 cancelAt;
    bool blocked;
}

enum MinerOperation {
    Draft,
    Undraft,
    Execute,
    Cancel
}

/// @title MinerRegistry
/// @notice The MinerRegistry contract is a registry of miners that are permitted to execute protocol tasks.
contract MinerRegistry is Ownable, Writable {
    mapping(address => Miner) public miners;
    mapping(address => uint256) public rewards;
    mapping(MinerOperation => uint256) public opRewards;
    address public token;
    uint256 public minerBond;
    uint256 public matureDuration;
    uint256 public cancelDuration;

    /// @notice Construct a new MinerRegistry contract
    /// @param _token The address of the token contract
    /// @param _minerBond The initial miner bond amount
    constructor(address _token, uint256 _minerBond, uint256 _matureDuration, uint256 _cancelDuration) {
        minerBond = _minerBond;
        token = _token;
        matureDuration = _matureDuration;
        cancelDuration = _cancelDuration;
    }

    event UpdatedMinerBond(uint256 bond);
    event UpdatedDurations(uint256 matureDuration, uint256 cancelDuration);
    event Registered(address indexed miner, uint256 bond);
    event Cancelled(address indexed miner, uint256 cancelDuration);
    event Drained(address indexed miner, uint256 amount);
    event AddedReward(address indexed miner, MinerOperation op, uint256 amount);
    event RewardWithdrawn(address indexed miner, uint256 amount);
    event WithdrawnBalance(uint256 amount);
    event Blocked(address indexed miner, bool blocked);
    event Slashed(address indexed miner, uint256 amount);
    event UpdatedOpReward(MinerOperation op, uint256 amount);
    event UpdatedOpsReward(MinerOperation[] ops, uint256[] amounts);

    /// @notice Update the miner rewards for an operation
    /// @param op The operation to update
    /// @param amount The new reward amount
    function updateOpReward(MinerOperation op, uint256 amount) external onlyOwner {
        opRewards[op] = amount;
        emit UpdatedOpReward(op, amount);
    }

    /// @notice Update the miner rewards for multiple operations
    /// @param ops The operations to update
    /// @param amounts The new reward amounts per operation
    function updateOpsReward(MinerOperation[] memory ops, uint256[] memory amounts) external onlyOwner {
        require(ops.length == amounts.length, "MR: INVALID_LENGTH");
        for (uint256 i = 0; i < ops.length; i++) {
            opRewards[ops[i]] = amounts[i];
        }
        emit UpdatedOpsReward(ops, amounts);
    }

    /// @notice Update the miner bond
    /// @param _minerBond The new miner bond amount
    function updateMinerBond(uint256 _minerBond) external onlyOwner {
        minerBond = _minerBond;
        emit UpdatedMinerBond(_minerBond);
    }

    /// @notice Set the durations for miner maturity and cancellation
    /// @param _matureDuration The duration for miner maturity
    /// @param _cancelDuration The duration for miner cancellation
    function setDurations(uint256 _matureDuration, uint256 _cancelDuration) external onlyOwner {
        matureDuration = _matureDuration;
        cancelDuration = _cancelDuration;
        emit UpdatedDurations(_matureDuration, _cancelDuration);
    }

    /// @notice Check if an address is a miner
    /// @param addr The address to check
    function isMiner(address addr) external view returns (bool) {
        return
            miners[addr].exists &&
            miners[addr].bond >= minerBond &&
            miners[addr].matureAt < block.timestamp &&
            miners[addr].cancelAt == 0 &&
            !miners[addr].blocked;
    }

    /// @notice Register a new miner
    function register() external {
        require(!miners[msg.sender].exists, "MR: IS_REGISTERED");
        require(IERC20(token).transferFrom(msg.sender, address(this), minerBond), "Transfer failed");
        miners[msg.sender] = Miner(true, minerBond, 0, 0, false);
        miners[msg.sender].matureAt = block.timestamp + matureDuration;
        emit Registered(msg.sender, minerBond);
    }

    /// @notice Cancel a miner registration
    function cancel() external {
        require(miners[msg.sender].exists, "MR: NOT_REGISTERED");
        require(miners[msg.sender].matureAt < block.timestamp, "MR: NOT_MATURE");
        require(miners[msg.sender].cancelAt == 0, "MR: IS_CANCELLED");
        miners[msg.sender].cancelAt = block.timestamp + cancelDuration;
        emit Cancelled(msg.sender, cancelDuration);
    }

    /// @notice Drain the bond of a miner that has been cancelled
    function drain() external {
        require(miners[msg.sender].exists, "MR: NOT_REGISTERED");
        require(!miners[msg.sender].blocked, "MR: BLOCKED");
        require(miners[msg.sender].cancelAt > 0 && miners[msg.sender].cancelAt < block.timestamp, "MR: NOT_CANCELLED");
        uint256 amount = miners[msg.sender].bond;
        miners[msg.sender].exists = false;
        miners[msg.sender].bond = 0;
        miners[msg.sender].matureAt = 0;
        miners[msg.sender].cancelAt = 0;
        require(IERC20(token).transfer(msg.sender, amount), "Transfer failed");
        emit Drained(msg.sender, amount);
    }

    /// @notice Add rewards to a miner
    /// CONTRACT: Expect writer to call isMiner before calling this function
    /// CONTRACT: Blocked miner will not receive rewards
    /// @param op The operation to add rewards for
    /// @param miner The address to add rewards to
    function addReward(MinerOperation op, address miner) external onlyWriter {
        if (miners[miner].blocked) return;
        rewards[miner] += opRewards[op];
        emit AddedReward(miner, op, opRewards[op]);
    }

    /// @notice Get an address reward balance
    /// @param miner The address to check
    function rewardBalanceOf(address miner) external view returns (uint256) {
        return rewards[miner];
    }

    /// @notice Withdraw rewards
    function withdrawReward() external {
        uint256 amount = rewards[msg.sender];
        rewards[msg.sender] = 0;
        require(IERC20(token).transfer(msg.sender, amount), "Transfer failed");
        emit RewardWithdrawn(msg.sender, amount);
    }

    /// @notice Drain the contract of all reward token
    /// @param dest The address to send the balance to
    function withdrawBalance(address dest) external onlyOwner {
        uint256 amount = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transfer(dest, amount), "Transfer failed");
        emit WithdrawnBalance(amount);
    }

    /// @notice Block or unblock a miner
    /// @param miner The address to block
    function toggleBlock(address miner) external onlyOwner {
        require(miners[miner].exists, "MR: NOT_REGISTERED");
        miners[miner].blocked = !miners[miner].blocked;
        emit Blocked(miner, miners[miner].blocked);
    }

    /// @notice Slash a miner's bond.
    /// Unblocks the miner if blocked.
    /// @param miner The address to slash
    /// @param amount The amount to slash
    function slash(address miner, uint256 amount) external onlyOwner {
        require(miners[miner].exists, "MR: NOT_REGISTERED");
        amount = amount > miners[miner].bond ? miners[miner].bond : amount;
        miners[miner].bond -= amount;
        miners[miner].blocked = false;
        IERC20(token).burn(amount);
        emit Slashed(miner, amount);
    }
}
