// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../common/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/finance/VestingWallet.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract AirdropClaimer is Ownable {
    address public rewardToken;
    address public nft;
    uint256 public contributionAmount = 0;
    uint256 public dexDropLockTime = 0;
    bytes32 public root;
    bytes32 public nftRewardRoot;
    bool public allowContribution = true;
    mapping(bytes32 => bool) public usedProofs;
    mapping(address => address) public vestingWallets;
    mapping(address => uint256) public unclaimedTgeAllocations;
    mapping(address => uint256) public unclaimedTgeAllocClaimTime;

    /// @notice Constructor
    /// @param _root The merkle root
    /// @param _nftRewardRoot The NFT reward merkle root
    /// @param _rewardToken The reward token address
    /// @param _nft The NFT contract address
    constructor(bytes32 _root, bytes32 _nftRewardRoot, address _rewardToken, address _nft) {
        root = _root;
        rewardToken = _rewardToken;
        nft = _nft;
        nftRewardRoot = _nftRewardRoot;
    }

    event UpdatedRewardToken(address rewardToken);
    event UpdatedRoot(bytes32 root);
    event UpdatedAllowContribution(bool allowDonation);
    event UpdatedContributionAmount(uint contributionAmount);
    event ClaimedTgeAlloc(address addr, uint256 amount);
    event RewardClaim(
        address beneficiary,
        address vestingWallet,
        uint claimId,
        uint256 allocation,
        uint256 tgeAlloc,
        uint256 vestingAlloc,
        uint256 vestingStartTimestamp,
        uint256 vestingDurSec
    );
    event NftRewardClaim(
        address beneficiary,
        address vestingWallet,
        uint256 tokenId,
        uint256 allocation,
        uint256 tgeAlloc,
        uint256 vestingAlloc,
        uint256 vestingStartTimestamp,
        uint256 vestingDurSec
    );
    event UpdatedDexDropLockTime(uint256 dexDropLockTime);
    event WithdrawnETH(address beneficiary, uint256 amount);
    event WithdrawnRewardToken(address beneficiary, uint256 amount);
    event UpdatedNft(address nft);
    event UpdatedNftRewardRoot(bytes32 nftRewardRoot);

    /// @notice Set the reward token address
    /// @param _rewardToken The reward token address
    function setRewardToken(address _rewardToken) public onlyOwner {
        rewardToken = _rewardToken;
        emit UpdatedRewardToken(_rewardToken);
    }

    /// @notice Set the NFT address
    /// @param _nft The NFT address
    function setNft(address _nft) public onlyOwner {
        nft = _nft;
        emit UpdatedNft(_nft);
    }

    /// @notice Set the main reward root
    /// @param _root The main reward root
    function setRoot(bytes32 _root) public onlyOwner {
        root = _root;
        emit UpdatedRoot(_root);
    }

    /// @notice Set the NFT reward root
    /// @param _nftRewardRoot The NFT reward root
    function setNftRewardRoot(bytes32 _nftRewardRoot) public onlyOwner {
        nftRewardRoot = _nftRewardRoot;
        emit UpdatedNftRewardRoot(_nftRewardRoot);
    }

    /// @notice Enable or disable contribution
    function setAllowContribution(bool _allowContribution) public onlyOwner {
        allowContribution = _allowContribution;
        emit UpdatedAllowContribution(_allowContribution);
    }

    /// @notice Set the contribution amount
    function setContributionAmount(uint _contributionAmount) public onlyOwner {
        contributionAmount = _contributionAmount;
        emit UpdatedContributionAmount(_contributionAmount);
    }

    /// @notice Set the DEX drop lock time
    function setDexDropLockTime(uint256 _dexDropLockTime) public onlyOwner {
        dexDropLockTime = _dexDropLockTime;
        emit UpdatedDexDropLockTime(_dexDropLockTime);
    }

    function buildVestingWalletId(address addr, uint claimId) public pure returns (address) {
        return address(uint160(uint(keccak256(abi.encode(addr, claimId)))));
    }

    /// @notice Verify and claim reward
    /// @param proof The merkle proof
    /// @param addr The address to claim the reward
    /// @param claimId The claim ID
    /// @param allocation The allocation to claim
    /// @param tgeAllocBp The TGE allocation basis points
    /// @param vestingDurSec The vesting duration in seconds
    function _claimReward(
        bytes32[] memory proof,
        address addr,
        uint claimId,
        uint256 allocation,
        uint tgeAllocBp,
        uint64 startTimestamp,
        uint64 vestingDurSec
    ) internal {
        require(addr == msg.sender, "SENDER_MUST_BE_ADDR");

        // verify the merkle proof
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(addr, claimId, allocation, tgeAllocBp, vestingDurSec))));
        require(MerkleProof.verify(proof, root, leaf), "Invalid proof");

        // check if the proof is used
        bytes32 proofHash = keccak256(abi.encodePacked(proof));
        require(!usedProofs[proofHash], "PROOF_USED");
        usedProofs[proofHash] = true;

        // Create the vesting wallet
        address vestingWalletId = buildVestingWalletId(addr, claimId);
        address vestingWallet = vestingWallets[vestingWalletId];
        if (vestingWallet == address(0)) {
            vestingWallet = address(new VestingWallet(addr, startTimestamp, vestingDurSec));
            vestingWallets[vestingWalletId] = vestingWallet;
        }

        // Transfer TGE allocation to the beneficiary
        uint256 tgeAlloc = (allocation * tgeAllocBp) / 10000;
        if (claimId != 1) {
            ERC20(rewardToken).transfer(addr, tgeAlloc);
        }

        // Transfer the rest to the vesting wallet
        ERC20(rewardToken).transfer(address(vestingWallet), allocation - tgeAlloc);

        emit RewardClaim(addr, vestingWallet, claimId, allocation, tgeAlloc, allocation - tgeAlloc, startTimestamp, vestingDurSec);
    }

    /// @notice Verify and claim trialnet reward
    /// @param proof The merkle proof
    /// @param addr The address to claim the reward
    /// @param claimId The claim ID
    /// @param allocation The allocation to claim
    /// @param tgeAllocBp The TGE allocation basis points
    /// @param vestingDurSec The vesting duration in seconds
    function claimReward(
        bytes32[] memory proof,
        address addr,
        uint claimId,
        uint256 allocation,
        uint tgeAllocBp,
        uint256 vestingDurSec
    ) public {
        require(claimId == 0, "INVALID_CLAIM_ID");
        _claimReward(proof, addr, claimId, allocation, tgeAllocBp, uint64(block.timestamp), uint64(vestingDurSec));
    }

    /// @notice Verify and claim pre-sale reward
    /// @param proof The merkle proof
    /// @param addr The address to claim the reward
    /// @param claimId The claim ID
    /// @param allocation The allocation to claim
    /// @param tgeAllocBp The TGE allocation basis points
    /// @param vestingDurSec The vesting duration in seconds
    function claimPresale(
        bytes32[] memory proof,
        address addr,
        uint claimId,
        uint256 allocation,
        uint tgeAllocBp,
        uint256 vestingDurSec
    ) public {
        require(claimId == 2, "INVALID_CLAIM_ID");
        _claimReward(proof, addr, claimId, allocation, tgeAllocBp, uint64(block.timestamp), uint64(vestingDurSec));
    }

    /// @notice Verify and claim the DEX drop reward
    /// @param proof The merkle proof
    /// @param addr The address to claim the reward
    /// @param claimId The claim ID
    /// @param allocation The allocation to claim
    /// @param tgeAllocBp The TGE allocation basis points
    /// @param vestingDurSec The vesting duration in seconds
    function claimDexDropReward(
        bytes32[] memory proof,
        address addr,
        uint claimId,
        uint256 allocation,
        uint tgeAllocBp,
        uint256 vestingDurSec
    ) public payable {
        require(claimId == 1, "INVALID_CLAIM_ID");

        uint64 startTime = uint64(block.timestamp + dexDropLockTime);
        uint256 tgeAlloc = (allocation * tgeAllocBp) / 10000;

        if (allowContribution && msg.value >= contributionAmount) {
            startTime = uint64(block.timestamp);
        }

        _claimReward(proof, addr, claimId, allocation, tgeAllocBp, startTime, uint64(vestingDurSec));

        if (allowContribution && msg.value >= contributionAmount) {
            ERC20(rewardToken).transfer(addr, tgeAlloc);
        } else {
            unclaimedTgeAllocations[addr] += tgeAlloc;
            unclaimedTgeAllocClaimTime[addr] = startTime;
        }
    }

    /// @notice Claim NFT reward
    /// @param proof The merkle proof
    /// @param tokenId The NFT token ID
    /// @param allocation The allocation to claim
    /// @param tgeAllocBp The TGE allocation basis points
    /// @param vestingDurSec The vesting duration in seconds
    function claimNFTReward(bytes32[] memory proof, uint256 tokenId, uint256 allocation, uint tgeAllocBp, uint256 vestingDurSec) public {
        require(IERC721(nft).ownerOf(tokenId) == msg.sender, "NOT_NFT_OWNER");

        // verify the merkle proof
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(tokenId, allocation, tgeAllocBp, vestingDurSec))));
        require(MerkleProof.verify(proof, nftRewardRoot, leaf), "Invalid proof");

        // check if the proof is used
        bytes32 proofHash = keccak256(abi.encodePacked(proof));
        require(!usedProofs[proofHash], "PROOF_USED");
        usedProofs[proofHash] = true;

        // Create the vesting wallet
        address vestWalletId = buildVestingWalletId(msg.sender, 3);
        address vestingWallet = vestingWallets[vestWalletId];
        if (vestingWallet == address(0)) {
            vestingWallet = address(new VestingWallet(msg.sender, uint64(block.timestamp), uint64(vestingDurSec)));
            vestingWallets[vestWalletId] = vestingWallet;
        }

        // Transfer TGE allocation to the beneficiary
        uint256 tgeAlloc = (allocation * tgeAllocBp) / 10000;
        ERC20(rewardToken).transfer(msg.sender, tgeAlloc);

        // Transfer the rest to the vesting wallet
        ERC20(rewardToken).transfer(address(vestingWallet), allocation - tgeAlloc);

        emit NftRewardClaim(
            msg.sender,
            vestingWallet,
            tokenId,
            allocation,
            tgeAlloc,
            allocation - tgeAlloc,
            block.timestamp,
            vestingDurSec
        );
    }

    /// @notice Claim unclaimed TGE allocation
    /// @param addr The address to claim the TGE allocation
    function claimTgeAlloc(address addr) public {
        require(unclaimedTgeAllocations[addr] > 0, "NO_UNCLAIMED_TGE_ALLOC");
        require(block.timestamp >= unclaimedTgeAllocClaimTime[addr], "TGE_ALLOC_LOCKED");

        ERC20(rewardToken).transfer(addr, unclaimedTgeAllocations[addr]);

        emit ClaimedTgeAlloc(addr, unclaimedTgeAllocations[addr]);

        unclaimedTgeAllocations[addr] = 0;
    }

    /// @notice Withdraw ETH from the contract
    /// @param beneficiary The beneficiary address
    function withdrawETH(address beneficiary) public onlyOwner {
        uint256 amount = address(this).balance;
        payable(beneficiary).transfer(amount);
        emit WithdrawnETH(beneficiary, amount);
    }

    /// @notice Withdraw all reward tokens from the contract
    /// @param beneficiary The beneficiary address
    function withdrawRewardToken(address beneficiary) public onlyOwner {
        uint256 amount = ERC20(rewardToken).balanceOf(address(this));
        ERC20(rewardToken).transfer(beneficiary, amount);
        emit WithdrawnRewardToken(beneficiary, amount);
    }
}
