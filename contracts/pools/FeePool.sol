// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../token/interfaces/IERC20.sol";
import "../common/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../common/MathLib.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "../badge/interfaces/IBadge.sol";

contract FeePool is Ownable, ReentrancyGuard {
    address public tokenPool;
    address public notifier;
    address public nft;
    IBadge public badge;

    uint256 public rewardsDuration = 30 days;
    mapping(address => uint256) public rewardRates;
    address[] public tokens;
    mapping(address => uint256) public periodFinish;
    mapping(address => uint256) public lastUpdateTime;
    mapping(address => uint256) public rewardPerTokenStored;
    mapping(address => mapping(address => uint256)) public userRewardPerTokenPaid;
    mapping(address => mapping(address => uint256)) public rewards;
    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;
    string[2][] public requiredBadges;

    event StakedNFT(uint256 tokenId, address nftAddress, uint256 amount);
    event RewardWithdrawn(address indexed token, address indexed user, uint256 reward);
    event RewardNFTWithdrawn(uint256 tokenId, address indexed token, address indexed user, uint256 reward);
    event Recovered(address indexed token, uint256 amount);
    event RewardAdded(address indexed token, uint256 reward);
    event UpdatedRewardDuration(uint256 dur);
    event UpdatedNFT(address addr);
    event UpdatedTokenPool(address addr);
    event UpdatedNotifier(address addr);
    event UpdatedBadgeManager(address addr);
    event UpdatedReqBadges(string[2][] badges);

    /// @dev Update an account's reward
    modifier updateReward(address account) {
        _updateReward(account);
        _;
    }

    modifier onlyTokenPool() {
        require(msg.sender == tokenPool, "FR: NOT_TOKEN_POOL");
        _;
    }

    modifier onlyNotifier() {
        require(msg.sender == notifier, "FR: NOT_NOTIFIER");
        _;
    }

    modifier onlyNFT() {
        require(msg.sender == nft, "FR: NOT_NFT");
        _;
    }

    /// @dev Initialize the fee rewards contract.
    /// @param _tokenPool The token pool contract address
    /// @param _notifier The notifier contract
    constructor(address _tokenPool, address _notifier) {
        tokenPool = _tokenPool;
        notifier = _notifier;
    }

    /// @dev Set reward duration
    function setRewardDuration(uint256 dur) external onlyOwner {
        rewardsDuration = dur;
        emit UpdatedRewardDuration(dur);
    }

    /// @dev Set the NFT contract address
    function setNFT(address addr) external onlyOwner {
        nft = addr;
        emit UpdatedNFT(addr);
    }

    function setTokenPool(address addr) external onlyOwner {
        tokenPool = addr;
        emit UpdatedTokenPool(addr);
    }

    function setNotifier(address addr) external onlyOwner {
        notifier = addr;
        emit UpdatedNotifier(addr);
    }

    /// @notice Set badge manager
    function setBadgeMgrManager(address addr) public onlyOwner {
        badge = IBadge(addr);
        emit UpdatedBadgeManager(addr);
    }

    /// @notice Set required badges
    function setRequiredBadges(string[2][] memory badges) public onlyOwner {
        requiredBadges = badges;
        emit UpdatedReqBadges(badges);
    }

    /// @notice Check if an address is allowed to stake
    function canStake(address addr) public view returns (bool) {
        if (requiredBadges.length == 0) return true;
        for (uint256 i = 0; i < requiredBadges.length; i++) {
            if (!badge.hasBadge(addr, requiredBadges[i][0], requiredBadges[i][1])) return false;
        }
        return true;
    }

    function _updateReward(address account) internal {
        for (uint256 i = 0; i < tokens.length; i++) {
            rewardPerTokenStored[tokens[i]] = rewardPerToken(tokens[i]);
            lastUpdateTime[tokens[i]] = lastTimeRewardApplicable(tokens[i]);
            if (account != address(0)) {
                rewards[tokens[i]][account] = earned(account, tokens[i]);
                userRewardPerTokenPaid[tokens[i]][account] = rewardPerTokenStored[tokens[i]];
            }
        }
    }

    function lastTimeRewardApplicable(address feeToken) public view returns (uint256) {
        return MathLib.min(block.timestamp, periodFinish[feeToken]);
    }

    /// @dev Calculate how much reward per staked token
    function rewardPerToken(address feeToken) public view returns (uint256) {
        if (_totalSupply == 0) return rewardPerTokenStored[feeToken];
        return
            rewardPerTokenStored[feeToken] +
            (((lastTimeRewardApplicable(feeToken) - lastUpdateTime[feeToken]) * rewardRates[feeToken] * 1e18) / _totalSupply);
    }

    /// @dev Calculate the reward earned by an account
    function earned(address account, address feeToken) public view returns (uint256) {
        return
            ((_balances[account] * (rewardPerToken(feeToken) - userRewardPerTokenPaid[feeToken][account])) / 1e18) +
            rewards[feeToken][account];
    }

    /// @dev Calculate the reward earned by an NFT token
    function nftEarned(uint256 tokenId, address feeToken) public view returns (uint256) {
        return
            ((_balances[getAddressOfNFT(tokenId)] *
                (rewardPerToken(feeToken) - userRewardPerTokenPaid[feeToken][getAddressOfNFT(tokenId)])) / 1e18) +
            rewards[feeToken][getAddressOfNFT(tokenId)];
    }

    /// @dev Get reward available for the reward duration.
    function getRewardForDuration(address feeToken) external view returns (uint256) {
        return rewardRates[feeToken] * rewardsDuration;
    }

    function getAddressOfNFT(uint256 tokenId) public pure returns (address) {
        return address(ripemd160(abi.encodePacked(tokenId)));
    }

    /// @notice Stake an NFT
    function stakeNFT(uint256 _tokenId, uint256 _amount) external nonReentrant onlyNFT updateReward(address(0)) {
        require(canStake(IERC721(nft).ownerOf(_tokenId)), "FR: NOT_PERMITTED");
        address tokenAddr = getAddressOfNFT(_tokenId);
        _totalSupply += _amount;
        _balances[tokenAddr] += _amount;
        emit StakedNFT(_tokenId, tokenAddr, _amount);
    }

    /// @dev Called when an account increased their stake on the staking contract
    function notifyStake(address account, uint256 _amount) external nonReentrant updateReward(msg.sender) onlyTokenPool {
        if (!canStake(account)) return;
        _totalSupply += _amount;
        _balances[account] += _amount;
    }

    /// @dev Called when an account decreased their stake on the staking contract
    function notifyWithdraw(address account, uint256 _amount) external nonReentrant updateReward(msg.sender) onlyTokenPool {
        _totalSupply -= _amount;
        _balances[account] -= _amount;
    }

    /// @dev Withdraw reward
    function withdrawReward(address feeToken, uint256 _amount) external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[feeToken][msg.sender];
        require(reward >= _amount, "FR: INSUFFICIENT_BALANCE");
        rewards[feeToken][msg.sender] = reward - _amount;
        IERC20(feeToken).transfer(msg.sender, _amount);
        emit RewardWithdrawn(feeToken, msg.sender, _amount);
    }

    /// @dev Withdraw reward belonging to a given NFT token
    function withdrawNFTReward(
        uint256 tokenId,
        address feeToken,
        uint256 _amount
    ) external nonReentrant {
        address owner = IERC721(nft).ownerOf(tokenId);
        require(owner == msg.sender, "FR: NOT_OWNER");
        address nftAddr = getAddressOfNFT(tokenId);
        _updateReward(nftAddr);
        uint256 reward = rewards[feeToken][nftAddr];
        require(reward >= _amount, "FR: INSUFFICIENT_BALANCE");
        rewards[feeToken][nftAddr] = reward - _amount;
        IERC20(feeToken).transfer(owner, _amount);
        emit RewardNFTWithdrawn(tokenId, feeToken, owner, _amount);
    }

    /// @dev Notify the contract of fee token transfer
    function notifyFeeDeposit(address feeToken, uint256 amount) external onlyNotifier updateReward(address(0)) {
        require(amount > 0, "FR: AMOUNT_REQ");

        if (block.timestamp >= periodFinish[feeToken]) {
            rewardRates[feeToken] = amount / rewardsDuration;
        } else {
            uint256 remaining = periodFinish[feeToken] - block.timestamp;
            uint256 leftover = remaining * rewardRates[feeToken];
            rewardRates[feeToken] = (amount + leftover) / rewardsDuration;
        }

        if (periodFinish[feeToken] == 0) tokens.push(feeToken);

        // Ensure the provided reward amount is not more than the balance in the contract.
        // This keeps the reward rate in the right range, preventing overflows due to
        // very high values of rewardRate in the earned and rewardsPerToken functions;
        // Reward + leftover must be less than 2^256 / 10^18 to avoid overflow.
        uint256 balance = IERC20(feeToken).balanceOf(address(this));
        require(rewardRates[feeToken] <= balance / rewardsDuration, "FR: REWARD_TOO_HIGH");

        periodFinish[feeToken] = block.timestamp + rewardsDuration;
        lastUpdateTime[feeToken] = block.timestamp;
        emit RewardAdded(feeToken, amount);
    }

    /// @dev Recover ERC20 tokens mistakenly sent (excluding fee tokens).
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external nonReentrant onlyOwner {
        require(periodFinish[tokenAddress] == 0, "FR: INVALID_TOKEN_ADDRESS");
        IERC20(tokenAddress).transfer(owner(), tokenAmount);
        emit Recovered(tokenAddress, tokenAmount);
    }

    /// @dev Return total staked
    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    /// @dev Return amount staked by an account
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /// @dev Return amount staked by an NFT token
    function nftBalanceOf(uint256 tokenId) external view returns (uint256) {
        return _balances[getAddressOfNFT(tokenId)];
    }

    /// @dev Return balance of a token
    function tokenBalanceOf(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
