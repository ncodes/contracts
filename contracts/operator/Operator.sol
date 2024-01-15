// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../common/Ownable.sol";
import "../token/interfaces/IERC20.sol";

struct OperatorInfo {
    bool exists;
    uint256 bond;
    uint256 id;
    uint256 checkpoint;
}

contract Operator is Ownable {
    uint256 public bond;
    uint256 lastNewOperatorId;
    uint256 public checkpoint;
    mapping(address => OperatorInfo) public operators;
    mapping(uint256 => address) public operatorById;
    IERC20 public bondToken;

    event AddedOperator(address indexed operator, uint256 id, uint256 bond);
    event RemovedOperator(address indexed operator, uint256 id);
    event UpdatedBond(uint256 bond);
    event UpdatedBondToken(address addr);

    constructor(address _token, uint256 _bond) {
        bondToken = IERC20(_token);
        bond = _bond;
    }

    /// @notice Update operator bond amount
    /// @param val New bond amount
    function setBond(uint256 val) public onlyOwner {
        bond = val;
        checkpoint++;
        emit UpdatedBond(val);
    }

    /// @notice Update operator bond token
    /// @param addr New bond token address
    function setBondToken(address addr) public onlyOwner {
        bondToken = IERC20(addr);
        emit UpdatedBondToken(addr);
    }

    /// @notice Register as an operator
    function register() public {
        require(!operators[msg.sender].exists, "OP: OPERATOR_EXISTS");
        lastNewOperatorId++;
        operators[msg.sender] = OperatorInfo(true, bond, lastNewOperatorId, checkpoint);
        operatorById[lastNewOperatorId] = msg.sender;
        bondToken.transferFrom(msg.sender, address(this), bond);
        emit AddedOperator(msg.sender, lastNewOperatorId, bond);
    }

    /// @notice Unregister as an operator. The bond is returned.
    function unregister() public {
        require(operators[msg.sender].exists, "OP: OPERATOR_NEXISTS");
        uint256 opBond = operators[msg.sender].bond;
        delete operatorById[operators[msg.sender].id];
        emit RemovedOperator(msg.sender, operators[msg.sender].id);
        delete operators[msg.sender];
        bondToken.transfer(msg.sender, opBond);
    }

    /// @notice Check if an address belongs to an active operator
    /// @param addr The address of the operator
    function isOperator(address addr) public view returns (bool) {
        return operators[addr].exists && operators[addr].checkpoint == checkpoint;
    }

    /// @notice Check if an operation ID belongs to an active operator
    /// @param id The ID of the operator
    function isOperator(uint256 id) public view returns (bool) {
        return operators[operatorById[id]].exists && operators[operatorById[id]].checkpoint == checkpoint;
    }

    /// @notice Get an operator's address by ID
    /// @param id The ID of the operator
    function getOperator(uint256 id) public view returns (address) {
        return operatorById[id];
    }

    /// @notice Get an operator's ID by address
    /// @param addr The address of the operator
    function getId(address addr) public view returns (uint256) {
        return operators[addr].id;
    }
}
