// add a contract to the file
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/finance/VestingWallet.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../common/SigLib.sol";
import "../vendor/@openzeppelin/contracts/access/Ownable.sol";

contract MultiBeneficiaryTimelockWallet is Ownable {
    uint64 public startTimestamp;
    uint64 public durationSeconds;
    uint public tgeAllocPct;
    mapping(address => address) public timelockWallets;
    address public allocator;
    address public token;

    /// @notice Constructor
    /// @param _token The token address
    /// @param _allocator The allocator address
    /// @param _tgeAllocPct The TGE allocation percentage
    /// @param _startTimestamp The start timestamp
    constructor(address _token, address _allocator, uint _tgeAllocPct, uint64 _startTimestamp, uint64 _durationSeconds) {
        token = _token;
        allocator = _allocator;
        tgeAllocPct = _tgeAllocPct;
        startTimestamp = _startTimestamp;
        durationSeconds = _durationSeconds;
    }

    event UpdatedAllocator(address allocator);
    event UpdatedToken(address token);
    event Claimed(address beneficiary, uint256 allocation, uint256 tgeAlloc, uint256 timeLockAlloc, address vestingWallet);

    /// @notice Set the allocator address
    /// @param _allocator The allocator address
    function setAllocator(address _allocator) public onlyOwner {
        allocator = _allocator;
        emit UpdatedAllocator(_allocator);
    }

    /// @notice Set the token address
    /// @param _token The token address
    function setToken(address _token) public onlyOwner {
        token = _token;
        emit UpdatedToken(_token);
    }

    /// @notice Claim allocation released at TGE
    /// @param beneficiary The beneficiary of the allocation
    /// @param allocation The allocation to transfer to the timelock wallet
    /// @param signature The signature authorizing the claim. Signed by the allocator.
    function claim(address beneficiary, uint256 allocation, bytes calldata signature) public {
        require(timelockWallets[beneficiary] == address(0), "TGE_ALLOC_CLAIMED");
        require(verifyClaimSig(allocator, beneficiary, allocation, signature), "INVALID_SIGNATURE");

        // Create the timelock wallet
        address vestingWallet = address(new VestingWallet(beneficiary, startTimestamp, durationSeconds));
        timelockWallets[beneficiary] = vestingWallet;

        // Compute the TGE percentage allocation
        uint256 tgeAlloc = (allocation * tgeAllocPct) / 10_000;

        // Compute the time lock allocation
        uint timeLockAlloc = allocation - tgeAlloc;

        // Transfer TGE allocation to the beneficiary
        ERC20(token).transfer(beneficiary, tgeAlloc);

        // Transfer the time lock allocation to the timelock wallet
        ERC20(token).transfer(timelockWallets[beneficiary], timeLockAlloc);

        emit Claimed(beneficiary, allocation, tgeAlloc, timeLockAlloc, vestingWallet);
    }

    function verifyClaimSig(address signer, address beneficiary, uint256 allocation, bytes memory sig) internal view returns (bool) {
        bytes32 messageHash = keccak256(abi.encode(block.chainid, beneficiary, allocation));
        bytes32 ethSignedMessageHash = SigLib.getSignedMessageHash(messageHash);
        return SigLib.recoverSigner(ethSignedMessageHash, sig) == signer;
    }
}
