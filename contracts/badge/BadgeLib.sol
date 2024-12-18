// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "../common/SigLib.sol";

library BadgeLib {
    function verifyGrantSig(
        address signer,
        string memory badge,
        string memory path,
        address addr,
        uint256 expireAt,
        string[] memory metadataKeys,
        string[] memory metadataValues,
        uint256 sigExpireAt,
        bytes memory signature
    ) internal view returns (bool) {
        if (address(0) == signer) return false;
        bytes32 messageHash = keccak256(abi.encode(block.chainid, badge, path, addr, expireAt, metadataKeys, metadataValues, sigExpireAt));
        bytes32 ethSignedMessageHash = SigLib.getSignedMessageHash(messageHash);
        return SigLib.recoverSigner(ethSignedMessageHash, signature) == signer;
    }

    function verifyRevokeSig(
        address signer,
        string memory badge,
        string memory path,
        address addr,
        uint256 expireAt,
        bytes memory signature
    ) internal view returns (bool) {
        if (address(0) == signer) return false;
        bytes32 messageHash = keccak256(abi.encode(block.chainid, badge, path, addr, expireAt));
        bytes32 ethSignedMessageHash = SigLib.getSignedMessageHash(messageHash);
        return SigLib.recoverSigner(ethSignedMessageHash, signature) == signer;
    }

    function verifyUpsertMetaSig(
        address signer,
        string memory badge,
        string memory path,
        address addr,
        string memory key,
        string memory value,
        uint256 expireAt,
        bytes memory signature
    ) internal view returns (bool) {
        if (address(0) == signer) return false;
        bytes32 messageHash = keccak256(abi.encode(block.chainid, badge, path, addr, key, value, expireAt));
        bytes32 ethSignedMessageHash = SigLib.getSignedMessageHash(messageHash);
        return SigLib.recoverSigner(ethSignedMessageHash, signature) == signer;
    }
}
