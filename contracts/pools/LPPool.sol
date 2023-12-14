// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../token/interfaces/IERC20.sol";
import "../common/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../common/MathLib.sol";

contract LPPool is Ownable, Pausable, ReentrancyGuard {
    IERC20 public rewardsToken;
    IERC20 public poolToken;

    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public rewardsDuration = 60 days;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    event RewardWithdrawn(address indexed user, uint256 reward);
    event Recovered(address token, uint256 amount);
    event RewardAdded(uint256 reward);
    event Locked(address indexed sender, uint256 amount);
    event Unlocked(address indexed sender, uint256 amount);

    /// @dev Update the sender's reward
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    constructor(address _poolToken, address _rewardsToken) {
        poolToken = IERC20(_poolToken);
        rewardsToken = IERC20(_rewardsToken);
    }

    /// @dev Set pool token
    function setPoolToken(address addr) external onlyOwner {
        poolToken = IERC20(addr);
    }

    /// @dev Pause the contract
    function pause() external whenNotPaused onlyOwner {
        _pause();
    }

    /// @dev Unpause the contract
    function unpause() external whenPaused onlyOwner {
        _unpause();
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return MathLib.min(block.timestamp, periodFinish);
    }

    /// @dev Get the reward per token
    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + (((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / _totalSupply);
    }

    /// @dev Get the amount earned by the sender
    function earned(address account) public view returns (uint256) {
        return ((_balances[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18) + rewards[account];
    }

    /// @dev Get reward available for the reward duration.
    function getRewardForDuration() external view returns (uint256) {
        return rewardRate * rewardsDuration;
    }

    /// @dev Lock sender's pool liquidity tokens
    function lock() external nonReentrant whenNotPaused updateReward(msg.sender) {
        uint256 amount = poolToken.balanceOf(msg.sender);
        _totalSupply += amount;
        _balances[msg.sender] += amount;
        poolToken.transferFrom(msg.sender, address(this), amount);
        emit Locked(msg.sender, amount);
    }

    /// @dev Unlock sender's liquidity tokens.
    function unlock() external nonReentrant updateReward(msg.sender) {
        uint256 amount = _balances[msg.sender];
        _totalSupply -= amount;
        _balances[msg.sender] -= amount;
        poolToken.transfer(msg.sender, amount);
        emit Unlocked(msg.sender, amount);
    }

    /// @dev Withdraw the sender's reward
    function withdrawReward(uint256 _amount) external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        require(reward >= _amount, "LPP: INSUFFICIENT_BALANCE");
        rewards[msg.sender] = reward - _amount;
        rewardsToken.transfer(msg.sender, _amount);
        emit RewardWithdrawn(msg.sender, _amount);
    }

    /// @dev Recover ERC20 tokens mistakenly sent (excluding LP tokens).
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external nonReentrant onlyOwner {
        require(address(poolToken) != tokenAddress, "LPP: INVALID_TOKEN_ADDRESS");
        IERC20(tokenAddress).transfer(owner(), tokenAmount);
        emit Recovered(tokenAddress, tokenAmount);
    }

    /// @dev Notify the contract of a transfer of reward tokens.
    /// @param _rewardAmount The amount of reward deposited.
    /// @param _rewardsDuration The duration the reward is expected to last for.
    function notifyRewardDeposit(uint256 _rewardAmount, uint256 _rewardsDuration) external onlyOwner updateReward(address(0)) {
        require(_rewardAmount > 0, "LPP: AMOUNT_REQ");
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
        require(rewardRate <= balance / rewardsDuration, "LPP: REWARD_TOO_HIGH");

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + _rewardsDuration;
        emit RewardAdded(_rewardAmount);
    }

    /// @dev Return total locked token
    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    /// @dev Return amount locked by an account
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }
}
