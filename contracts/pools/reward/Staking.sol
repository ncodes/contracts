// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../../token/interfaces/IERC20.sol";
import "../../common/Writable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../../common/MathLib.sol";

contract Staking is Pausable, ReentrancyGuard, Writable {
    IERC20 public rewardsToken;
    address public core;

    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public rewardsDuration = 60 days;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    bool public enableWithdrawal;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    uint256 _totalSupply;
    mapping(address => uint256) _balances;

    event RewardWithdrawn(address indexed user, uint256 reward);
    event Recovered(address token, uint256 amount);
    event RewardAdded(uint256 reward);
    event Added(address indexed sender, uint256 amount);
    event Removed(address indexed sender, uint256 amount);
    event UpdatedWithdrawalAccess(bool enabled);

    /// @notice Update the sender's reward
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    /// @notice Check if withdrawal is enabled
    modifier canWithdraw() {
        require(enableWithdrawal, "RP: WITHDRAWAL_DISABLED");
        _;
    }

    /// @notice Pause the contract
    function pause() external whenNotPaused onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract
    function unpause() external whenPaused onlyOwner {
        _unpause();
    }

    /// @notice Toggle on and off withdrawal access.
    function toggleWithdrawalAccess() external onlyOwner {
        enableWithdrawal = !enableWithdrawal;
        emit UpdatedWithdrawalAccess(enableWithdrawal);
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return MathLib.min(block.timestamp, periodFinish);
    }

    /// @notice Get the reward per token
    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + (((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / _totalSupply);
    }

    /// @notice Get the amount earned by an account
    /// @param account The address of the account
    function earned(address account) public view returns (uint256) {
        return ((_balances[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18) + rewards[account];
    }

    /// @notice Get reward available for the reward duration.
    function getRewardForDuration() external view returns (uint256) {
        return rewardRate * rewardsDuration;
    }

    /// @notice Withdraw the sender's reward
    /// @param _amount The amount to withdraw
    function withdrawReward(uint256 _amount) external nonReentrant canWithdraw updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        require(reward >= _amount, "RP: INSUFFICIENT_BALANCE");
        rewards[msg.sender] = reward - _amount;
        rewardsToken.transfer(msg.sender, _amount);
        emit RewardWithdrawn(msg.sender, _amount);
    }

    /// @notice Recover ERC20 tokens mistakenly sent (excluding LP tokens).
    /// @param tokenAddress The address of the token to recover.
    /// @param tokenAmount The amount of tokens to recover.
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external nonReentrant onlyOwner {
        IERC20(tokenAddress).transfer(owner(), tokenAmount);
        emit Recovered(tokenAddress, tokenAmount);
    }

    /// @notice Notify the contract of a transfer of reward tokens.
    /// @param _rewardAmount The amount of reward deposited.
    /// @param _rewardsDuration The duration the reward is expected to last for.
    function notifyRewardDeposit(uint256 _rewardAmount, uint256 _rewardsDuration) external onlyOwner updateReward(address(0)) {
        require(_rewardAmount > 0, "RP: AMOUNT_REQ");
        if (_rewardsDuration > 0) rewardsDuration = _rewardsDuration;

        if (block.timestamp >= periodFinish) {
            rewardRate = _rewardAmount / _rewardsDuration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (_rewardAmount + leftover) / _rewardsDuration;
        }

        // Ensure the provided reward amount is not more than the balance in the contract.
        // This keeps the reward rate in the right range, preventing overflows due to
        // very high values of rewardRate in the earned and rewardsPerToken functions;
        // Reward + leftover must be less than 2^256 / 10^18 to avoid overflow.
        uint256 balance = rewardsToken.balanceOf(address(this));
        require(rewardRate <= balance / rewardsDuration, "RP: REWARD_TOO_HIGH");

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + _rewardsDuration;
        emit RewardAdded(_rewardAmount);
    }

    /// @notice Return total deposited balances
    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }
}
