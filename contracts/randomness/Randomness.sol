// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/ConfirmedOwner.sol";
import "../common/Writable.sol";

struct RequestStatus {
    bool fulfilled;
    bool exists;
    uint256[] randomWords;
}

/// @dev The contract produces a random number
contract Randomness is VRFConsumerBaseV2, ConfirmedOwner {
    address[] public sources;
    mapping(uint256 => RequestStatus) public requests;
    VRFCoordinatorV2Interface public coordinator;
    uint64 public subId;
    uint256[] public requestIds;
    uint256 public lastRequestId;
    bytes32 public keyHash;
    uint32 public callbackGasLimit = 100000;
    uint16 public requestConfirmations = 3;
    uint32 public numWords = 1;
    uint256 public requestInterval = 86400;
    uint256 public lastRequestAt;

    event RequestSent(uint256 requestId, uint32 numWords);
    event RequestFulfilled(uint256 requestId, uint256[] randomWords);
    event UpdatedRequestInterval(uint256 val);

    constructor(bytes32 _keyHash, address _coordinator, uint64 _subId) VRFConsumerBaseV2(_coordinator) ConfirmedOwner(msg.sender) {
        keyHash = _keyHash;
        coordinator = VRFCoordinatorV2Interface(_coordinator);
        subId = _subId;
    }

    function setRequestInterval(uint256 val) external onlyOwner {
        requestInterval = val;
        emit UpdatedRequestInterval(val);
    }

    function _requestRandomWords() internal returns (uint256 requestId) {
        requestId = coordinator.requestRandomWords(keyHash, subId, requestConfirmations, callbackGasLimit, numWords);
        requests[requestId] = RequestStatus({randomWords: new uint256[](0), exists: true, fulfilled: false});
        requestIds.push(requestId);
        lastRequestId = requestId;
        lastRequestAt = block.timestamp;
        emit RequestSent(requestId, numWords);
        return requestId;
    }

    /// @notice Request random words
    function requestRandomWords() public onlyOwner {
        _requestRandomWords();
    }

    /// @dev The function called when the VRF coordinator has fulfilled a randomness request
    /// @param _requestId The ID of the request fulfilled by the oracle
    /// @param _randomWords The random words produced by the oracle
    function fulfillRandomWords(uint256 _requestId, uint256[] memory _randomWords) internal override {
        require(requests[_requestId].exists, "RAND: request not found");
        requests[_requestId].fulfilled = true;
        requests[_requestId].randomWords = _randomWords;
        emit RequestFulfilled(_requestId, _randomWords);
    }

    /// @dev Get the status of a request
    /// @param _requestId The ID of the request
    function getRequestStatus(uint256 _requestId) external view returns (bool fulfilled, uint256[] memory randomWords) {
        require(requests[_requestId].exists, "RAND: request not found");
        RequestStatus memory request = requests[_requestId];
        return (request.fulfilled, request.randomWords);
    }

    /// @dev Get a fallback random number.
    function fallbackNum() internal view returns (uint256) {
        return uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), block.timestamp)));
    }

    /// @dev Get a random number.
    function random() external returns (uint256) {
        if (requestIds.length == 0) {
            _requestRandomWords();
            return fallbackNum();
        }

        if (requests[lastRequestId].exists && !requests[lastRequestId].fulfilled) {
            if (requestIds.length == 1) return fallbackNum();
            if (!requests[requestIds.length - 2].fulfilled) return fallbackNum();
            return requests[requestIds.length - 2].randomWords[0];
        }

        if (block.timestamp - lastRequestAt >= requestInterval) {
            _requestRandomWords();
        }

        return requests[lastRequestId].randomWords[0];
    }

    /// @dev Get random number between 0 and n (n is non-inclusive).
    /// @param n The upper bound of the random number.
    function randomN(uint256 n) external returns (uint256) {
        return this.random() % n;
    }
}
