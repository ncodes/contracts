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

    /// @notice Update an account's reward
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

    /// @notice Initialize the fee rewards contract.
    /// @param _tokenPool The token pool contract address
    /// @param _notifier The notifier contract
    constructor(address _tokenPool, address _notifier) {
        tokenPool = _tokenPool;
        notifier = _notifier;
    }

    /// @notice Set reward duration
    /// @param dur New reward duration
    function setRewardDuration(uint256 dur) external onlyOwner {
        rewardsDuration = dur;
        emit UpdatedRewardDuration(dur);
    }

    /// @notice Set the NFT contract address
    /// @param addr The new NFT contract address
    function setNFT(address addr) external onlyOwner {
        nft = addr;
        emit UpdatedNFT(addr);
    }

    /// @notice Set the token pool contract address
    /// @param addr The new token pool contract address
    function setTokenPool(address addr) external onlyOwner {
        tokenPool = addr;
        emit UpdatedTokenPool(addr);
    }

    /// @notice Set the notifier contract address
    /// @param addr The new notifier contract address
    function setNotifier(address addr) external onlyOwner {
        notifier = addr;
        emit UpdatedNotifier(addr);
    }

    /// @notice Set badge manager
    /// @param addr The new badge manager address
    function setBadgeMgrManager(address addr) public onlyOwner {
        badge = IBadge(addr);
        emit UpdatedBadgeManager(addr);
    }

    /// @notice Set required badges
    /// @param badges The badges required to stake
    function setRequiredBadges(string[2][] memory badges) public onlyOwner {
        requiredBadges = badges;
        emit UpdatedReqBadges(badges);
    }

    /// @notice Check if an address is allowed to stake
    /// @param addr The address to check
    function canStake(address addr) public view returns (bool) {
        if (requiredBadges.length == 0) return true;
        for (uint256 i = 0; i < requiredBadges.length; i++) {
            if (!badge.hasBadge(addr, requiredBadges[i][0], requiredBadges[i][1])) return false;
        }
        return true;
    }

    /// @dev Update reward for an account
    /// @param account The account to update
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

    /// @notice Calculate how much reward per staked token
    /// @param feeToken The fee token address
    function rewardPerToken(address feeToken) public view returns (uint256) {
        if (_totalSupply == 0) return rewardPerTokenStored[feeToken];
        return
            rewardPerTokenStored[feeToken] +
            (((lastTimeRewardApplicable(feeToken) - lastUpdateTime[feeToken]) * rewardRates[feeToken] * 1e18) / _totalSupply);
    }

    /// @notice Calculate the reward earned by an account
    /// @param account The address of the account
    /// @param feeToken The fee token address
    function earned(address account, address feeToken) public view returns (uint256) {
        return
            ((_balances[account] * (rewardPerToken(feeToken) - userRewardPerTokenPaid[feeToken][account])) / 1e18) +
            rewards[feeToken][account];
    }

    /// @notice Calculate the reward earned by an NFT token
    /// @param tokenId The ID of the NFT token
    /// @param feeToken The fee token address
    function nftEarned(uint256 tokenId, address feeToken) public view returns (uint256) {
        return
            ((_balances[getAddressOfNFT(tokenId)] *
                (rewardPerToken(feeToken) - userRewardPerTokenPaid[feeToken][getAddressOfNFT(tokenId)])) / 1e18) +
            rewards[feeToken][getAddressOfNFT(tokenId)];
    }

    /// @notice Get reward available for the reward duration.
    /// @param feeToken The fee token address
    function getRewardForDuration(address feeToken) external view returns (uint256) {
        return rewardRates[feeToken] * rewardsDuration;
    }

    /// @notice Get the address of an NFT token
    /// @param tokenId The ID of the NFT token
    function getAddressOfNFT(uint256 tokenId) public pure returns (address) {
        return address(ripemd160(abi.encodePacked(tokenId)));
    }

    /// @notice Stake an NFT
    /// @param _tokenId The ID of the NFT token
    /// @param _amount The amount to stake
    function stakeNFT(uint256 _tokenId, uint256 _amount) external nonReentrant onlyNFT updateReward(address(0)) {
        require(canStake(IERC721(nft).ownerOf(_tokenId)), "FR: NOT_PERMITTED");
        address tokenAddr = getAddressOfNFT(_tokenId);
        _totalSupply += _amount;
        _balances[tokenAddr] += _amount;
        emit StakedNFT(_tokenId, tokenAddr, _amount);
    }

    /// @notice Called when an account increased their stake on the staking contract
    /// @param account The address of the account
    /// @param _amount The additional amount to stake
    function notifyStake(address account, uint256 _amount) external nonReentrant updateReward(msg.sender) onlyTokenPool {
        if (!canStake(account)) return;
        _totalSupply += _amount;
        _balances[account] += _amount;
    }

    /// @notice Called when an account decreased their stake on the staking contract
    /// @param account The address of the account
    /// @param _amount The amount to withdraw
    function notifyWithdraw(address account, uint256 _amount) external nonReentrant updateReward(msg.sender) onlyTokenPool {
        _totalSupply -= _amount;
        _balances[account] -= _amount;
    }

    /// @notice Withdraw reward
    /// @param feeToken The fee token address
    /// @param _amount The amount to withdraw
    function withdrawReward(address feeToken, uint256 _amount) external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[feeToken][msg.sender];
        require(reward >= _amount, "FR: INSUFFICIENT_BALANCE");
        rewards[feeToken][msg.sender] = reward - _amount;
        IERC20(feeToken).transfer(msg.sender, _amount);
        emit RewardWithdrawn(feeToken, msg.sender, _amount);
    }

    /// @notice Withdraw reward belonging to a given NFT token
    /// @param tokenId The ID of the NFT token
    /// @param feeToken The fee token address
    /// @param _amount The amount to withdraw
    function withdrawNFTReward(uint256 tokenId, address feeToken, uint256 _amount) external nonReentrant {
        address _owner = IERC721(nft).ownerOf(tokenId);
        require(_owner == msg.sender, "FR: NOT_OWNER");
        address nftAddr = getAddressOfNFT(tokenId);
        _updateReward(nftAddr);
        uint256 reward = rewards[feeToken][nftAddr];
        require(reward >= _amount, "FR: INSUFFICIENT_BALANCE");
        rewards[feeToken][nftAddr] = reward - _amount;
        IERC20(feeToken).transfer(_owner, _amount);
        emit RewardNFTWithdrawn(tokenId, feeToken, _owner, _amount);
    }

    /// @notice Notify the contract of fee token transfer
    /// @param feeToken The fee token address
    /// @param amount The amount of fee token transferred
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

    /// @notice Recover ERC20 tokens mistakenly sent (excluding fee tokens).
    /// @param tokenAddress The address of the token to recover.
    /// @param tokenAmount The amount of tokens to recover.
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external nonReentrant onlyOwner {
        require(periodFinish[tokenAddress] == 0, "FR: INVALID_TOKEN_ADDRESS");
        IERC20(tokenAddress).transfer(owner(), tokenAmount);
        emit Recovered(tokenAddress, tokenAmount);
    }

    /// @notice Return total staked
    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    /// @notice Return amount staked by an account
    /// @param account The address of the account
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /// @notice Return amount staked by an NFT token
    /// @param tokenId The ID of the NFT token
    function nftBalanceOf(uint256 tokenId) external view returns (uint256) {
        return _balances[getAddressOfNFT(tokenId)];
    }

    /// @notice Return balance of a token
    /// @param token The address of the token
    function tokenBalanceOf(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
