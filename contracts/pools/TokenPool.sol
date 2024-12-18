// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../token/interfaces/IERC20.sol";
import "../common/Ownable.sol";
import "./interfaces/IFeePool.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../common/MathLib.sol";
import "../badge/interfaces/IBadge.sol";

struct VestStake {
    uint256 amount;
    uint256 cliffEndAt;
    uint256 vestedAt;
    uint256 withdrawn;
}

contract TokenPool is Ownable, Pausable, ReentrancyGuard {
    IERC20 public rewardsToken;
    IERC20 public stakingToken;
    IFeePool public feePool;
    IBadge public badge;

    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public rewardsDuration = 60 days;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;
    string[2][] public requiredBadges;

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event VestStaked(address indexed user, uint256 amount);
    event StakeWithdrawn(address indexed user, uint256 amount);
    event RewardWithdrawn(address indexed user, uint256 reward);
    event Recovered(address token, uint256 amount);
    event UpdatedFeePool(address addr);
    event UpdatedBadgeManager(address addr);
    event UpdatedReqBadges(string[2][] badges);

    /// @notice Update an account's reward
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    /// @notice Initialize the contract
    /// @param _stakingToken The staking token.
    /// @param _rewardsToken The reward token.
    constructor(address _stakingToken, address _rewardsToken) {
        stakingToken = IERC20(_stakingToken);
        rewardsToken = IERC20(_rewardsToken);
    }

    /// @notice Set the fee rewarder contract
    /// @param addr The fee rewarder contract address.
    function setFeePool(address addr) external onlyOwner {
        feePool = IFeePool(addr);
        emit UpdatedFeePool(addr);
    }

    /// @notice Get the fee pool contract
    function getFeePool() external view returns (address) {
        return address(feePool);
    }

    /// @notice Set badge manager
    /// @param addr The badge manager contract address.
    function setBadgeMgrManager(address addr) public onlyOwner {
        badge = IBadge(addr);
        emit UpdatedBadgeManager(addr);
    }

    /// @notice Set required badges
    /// @param badges The required badges.
    function setRequiredBadges(string[2][] memory badges) public onlyOwner {
        requiredBadges = badges;
        emit UpdatedReqBadges(badges);
    }

    /// @notice Pause the contract
    function pause() external whenNotPaused onlyOwner {
        _pause();
    }

    /// @notice Pause the contract
    function unpause() external whenPaused onlyOwner {
        _unpause();
    }

    /// @notice Check if an address is allowed to stake
    /// @param addr The address to check.
    function canStake(address addr) public view returns (bool) {
        if (requiredBadges.length == 0) return true;
        for (uint256 i = 0; i < requiredBadges.length; i++) {
            if (!badge.hasBadge(addr, requiredBadges[i][0], requiredBadges[i][1])) return false;
        }
        return true;
    }

    /// @notice Calculate how much reward per staked token
    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + (((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / _totalSupply);
    }

    /// @notice calculate the reward earned by an account
    /// @param account The address of the account.
    function earned(address account) public view returns (uint256) {
        return ((balanceOf(account) * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18) + rewards[account];
    }

    /// @notice Get reward available for the reward duration.
    function getRewardForDuration() external view returns (uint256) {
        return rewardRate * rewardsDuration;
    }

    /// @notice Add stake to the contract
    /// @param _amount The amount to add to the contract.
    /// @param _account The account that will transfer the stake.
    /// @param _owner The account that will be the beneficiary of the stake and its reward.
    function _stake(uint256 _amount, address _account, address _owner) internal {
        require(_amount > 0, "AMOUNT_REQ");
        require(canStake(_owner), "NOT_PERMITTED");
        _totalSupply += _amount;
        _balances[_owner] += _amount;
        stakingToken.transferFrom(_account, address(this), _amount);

        if (address(feePool) != address(0)) {
            feePool.notifyStake(_owner, _amount);
        }
    }

    /// @notice Add stake to the contract
    /// @param _amount The amount to add to the contract.
    function stake(uint256 _amount) external nonReentrant whenNotPaused updateReward(msg.sender) {
        _stake(_amount, msg.sender, msg.sender);
        emit Staked(msg.sender, _amount);
    }

    /// @notice Withdraw stake from the contract
    /// @param _amount The amount to withdraw from the contract.
    function _withdraw(uint256 _amount) internal {
        _totalSupply -= _amount;
        _balances[msg.sender] -= _amount;
        stakingToken.transfer(msg.sender, _amount);

        if (address(feePool) != address(0)) {
            feePool.notifyWithdraw(msg.sender, _amount);
        }
    }

    /// @notice Withdraw the stake from the contract
    /// @param _amount The amount to withdraw from the contract.
    function withdraw(uint256 _amount) public nonReentrant updateReward(msg.sender) {
        _withdraw(_amount);
        emit StakeWithdrawn(msg.sender, _amount);
    }

    /// @notice Withdraw earned rewards
    /// @param _amount The amount to withdraw.
    function withdrawReward(uint256 _amount) public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        require(reward >= _amount, "INSUFFICIENT_BALANCE");
        rewards[msg.sender] = reward - _amount;
        rewardsToken.transfer(msg.sender, _amount);
        emit RewardWithdrawn(msg.sender, _amount);
    }

    /// @notice Return total staked
    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    /// @notice Return amount staked by an account
    /// @param account The address of the account.
    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return MathLib.min(block.timestamp, periodFinish);
    }

    /// @notice Withdraw all stake and reward
    function exit() external {
        withdraw(_balances[msg.sender]);
        withdrawReward(rewards[msg.sender]);
    }

    /// @notice Recover ERC20 tokens mistakenly sent (excluding the staking token).
    /// @param tokenAddress The address of the token to recover.
    /// @param tokenAmount The amount to recover.
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external nonReentrant onlyOwner {
        require(tokenAddress != address(stakingToken), "TP: INVALID_TOKEN_ADDRESS");
        IERC20(tokenAddress).transfer(owner(), tokenAmount);
        emit Recovered(tokenAddress, tokenAmount);
    }

    /// @notice Notify the contract of a transfer of reward tokens.
    /// @param _reward The amount of reward transferred.
    /// @param _rewardsDuration The duration of the reward period.
    function notifyRewardAmount(uint256 _reward, uint256 _rewardsDuration) external onlyOwner updateReward(address(0)) {
        require(_reward > 0, "AMOUNT_REQ");
        if (_rewardsDuration > 0) rewardsDuration = _rewardsDuration;

        if (block.timestamp >= periodFinish) {
            rewardRate = _reward / rewardsDuration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = _reward + leftover / rewardsDuration;
        }

        // Ensure the provided reward amount is not more than the balance in the contract.
        // This keeps the reward rate in the right range, preventing overflows due to
        // very high values of rewardRate in the earned and rewardsPerToken functions;
        // Reward + leftover must be less than 2^256 / 10^18 to avoid overflow.
        uint256 balance = rewardsToken.balanceOf(address(this));
        require(rewardRate <= balance / rewardsDuration, "TP: REWARD_TOO_HIGH");

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;
        emit RewardAdded(_reward);
    }
}
