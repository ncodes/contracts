// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../common/SafeERC20.sol";
import "../token/interfaces/IERC20.sol";
import "../common/Writable.sol";

/// @notice FeePurse stores NATIVE tokens to be used to pay fees
contract FeePurse is Writable {
    using SafeERC20 for IERC20;

    address public feeToken;
    mapping(address => uint256) public balances;
    uint256[] public locked;

    event FeeDeposited(address indexed sender, uint256 amt);
    event LockedDeposit(uint256 id, address indexed owner, uint256 amt);
    event UnlockedDeposit(uint256 id, address indexed owner, uint256 amt);
    event AddBalance(address indexed from, address indexed to, uint256 amt);
    event Withdrawn(address indexed owner, address indexed to, uint256 amt);

    /// @notice Initialize the contract
    /// @param _feeToken the
    constructor(address _feeToken) {
        feeToken = _feeToken;
    }

    /// @notice Return balance for an address
    function balanceOf(address owner) external view returns (uint256) {
        return balances[owner];
    }

    /// @notice Get locked balance of an ID
    function getLocked(uint256 id) external view returns (uint256) {
        if (id == 0) return 0;
        return locked[id - 1];
    }

    /// @notice Get fee token
    function getFeeToken() public view returns (address) {
        return feeToken;
    }

    /// @notice Deposit fee token
    /// @param amt Amount to deposit
    function deposit(uint256 amt) external {
        balances[msg.sender] += amt;
        IERC20(feeToken).safeTransferFrom(msg.sender, address(this), amt);
        emit FeeDeposited(msg.sender, amt);
    }

    /// @notice Lock some balance as deposit
    /// @param owner Owner of the balance
    /// @param amt Amount to lock
    /// @return id ID of the locked deposit
    function lock(address owner, uint256 amt) external onlyWriter returns (uint256) {
        require(balances[owner] >= amt, "FP: LOW_BAL");
        balances[owner] -= amt;
        uint256 id = locked.length + 1;
        locked.push(amt);
        emit LockedDeposit(id, owner, amt);
        return id;
    }

    /// @notice Unlock balance belonging to owner
    /// @param owner Owner of the balance
    /// @param id ID of the locked deposit
    function unlock(address owner, uint256 id) external onlyWriter {
        if (id == 0) return;
        require(locked.length > id - 1, "FP: UNK_ID");
        uint256 amt = locked[id - 1];
        locked[id - 1] = 0;
        balances[owner] += amt;
        emit UnlockedDeposit(id, owner, amt);
    }

    /// @notice Transfer an amount from an account to another account.
    /// @param from The account to transfer from
    /// @param to The account to transfer to
    /// @param amt The amount to transfer
    function transferFrom(address from, address to, uint256 amt) external onlyWriter {
        balances[from] -= amt;
        balances[to] += amt;
        emit AddBalance(from, to, amt);
    }

    /// @notice Withdraw deposit
    /// @param amt Amount to withdraw
    /// @param to Address to withdraw to
    function withdraw(uint256 amt, address to) external {
        require(balances[msg.sender] >= amt, "FP: LOW_BAL");
        to = (to == address(0)) ? msg.sender : to;
        balances[msg.sender] -= amt;
        IERC20(feeToken).safeTransfer(to, amt);
        emit Withdrawn(msg.sender, to, amt);
    }

    /// @notice Withdraw deposit from an account
    /// @param amt Amount to withdraw
    /// @param from Address to withdraw from
    /// @param to Address to withdraw to
    function withdrawFrom(uint256 amt, address from, address to) external onlyWriter {
        require(balances[from] >= amt, "FP: LOW_BAL");
        balances[from] -= amt;
        IERC20(feeToken).safeTransfer(to, amt);
        emit Withdrawn(from, to, amt);
    }
}
