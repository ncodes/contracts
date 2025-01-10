// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import "../vendor/@openzeppelin/contracts/access/Ownable.sol";

contract Writable is Ownable {
    /// @dev Addresses with write permission;
    mapping(address => bool) public writers;

    /// @dev Checks whether the caller has write access
    modifier onlyWriter() {
        require(writers[msg.sender], "W: NOT_WRITER");
        _;
    }

    event WriterUpdated(address addr, bool added);

    /// @dev Add or remove a writer
    /// @param addr The address to add or remove
    /// @param add Whether to add or remove the address
    function updateWriter(address addr, bool add) external onlyOwner {
        emit WriterUpdated(addr, add);
        if (!add) return delete writers[addr];
        writers[addr] = true;
    }
}
