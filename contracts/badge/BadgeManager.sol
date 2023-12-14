// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../common/Ownable.sol";
import "./BadgeLib.sol";

struct GrantInfo {
    uint256 grantedAt;
    uint256 expireAt;
}

contract BadgeManager is Ownable {
    mapping(address => string) public issuerBadge;
    mapping(string => address) public badgeIssuer;
    mapping(string => mapping(string => string)) public badgeMetadata;
    mapping(string => string[]) public badgeMetadataKeys;
    mapping(string => mapping(address => bool)) public badgeCoIssuers;
    mapping(string => mapping(string => address)) public badgePaths;
    mapping(bytes32 => mapping(string => string)) public pathMetadata;
    mapping(bytes32 => string[]) public pathMetadataKeys;
    mapping(bytes32 => GrantInfo) public granted;
    mapping(bytes32 => mapping(string => string)) public granteeMetadata;
    mapping(bytes32 => string[]) public granteeMetadataKeys;
    mapping(address => bool) public usedSig;

    event GrantedBadge(string badge, string path, address grantee, string[] metadataKeys, string[] metadataValues, uint256 expireAt);
    event RevokedBadge(string badge, string path, address grantee);
    event AddedIssuer(address indexed issuer, string badge, string[] metadataKeys, string[] metadataValues);
    event ReplacedIssuer(address indexed oldIssuer, address indexed newIssuer, string badge);
    event PathRegistered(address indexed issuer, string badge, string path, string[] metadataKeys, string[] metadataValues);
    event AddedCoIssuer(address indexed issuer, address indexed coIssuer, string badge);
    event RemovedCoIssuer(address indexed issuer, address indexed coIssuer, string badge);
    event BadgeMetaUpdated(address indexed issuer, string badge, string path, string key, string value);
    event GranteeBadgeMetaUpdated(address indexed issuer, address indexed grantee, string badge, string path, string key, string value);
    event BadgeOwnershipTransferred(string badge, string path, address indexed oldOwner, address indexed newOwner);

    modifier onlyIssuer(string memory badge) {
        require(badgeIssuer[badge] == msg.sender, "BADGE: NOT_ISSUER");
        _;
    }

    modifier onlyIssuerAndCoIssuer(string memory badge) {
        require(badgeIssuer[badge] == msg.sender || badgeCoIssuers[badge][msg.sender], "BADGE: NOT_ISSUER");
        _;
    }

    /// @notice Register an issuer
    /// @param issuer The address of the issuer
    /// @param badge The badge controlled by the issuer
    /// @param metadataKeys List of metadata keys
    /// @param metadataValues The metadata value for corresponding index in metadataKeys.
    function registerIssuer(
        address issuer,
        string memory badge,
        string[] memory metadataKeys,
        string[] memory metadataValues
    ) public onlyOwner {
        require(keccak256(bytes(badge)) != keccak256(bytes("")), "BADGE: MKT_BADGE_REQ");
        require(keccak256(bytes(issuerBadge[issuer])) == keccak256(bytes("")), "BADGE: ALREADY_ISSUER");
        require(metadataKeys.length == metadataValues.length, "BADGE: DIFF_META_SIZE");
        require(badgeIssuer[badge] == address(0), "BADGE: BADGE_TAKEN");
        issuerBadge[issuer] = badge;
        badgeIssuer[badge] = issuer;

        for (uint256 i = 0; i < metadataKeys.length; i++) {
            badgeMetadata[badge][metadataKeys[i]] = metadataValues[i];
            badgeMetadataKeys[badge].push(metadataKeys[i]);
        }

        emit AddedIssuer(issuer, badge, metadataKeys, metadataValues);
    }

    /// @notice Replace an issuer of a badge
    /// @param badge The name of the badge
    /// @param newIssuer The address of the new issuer
    function replaceIssuer(string memory badge, address newIssuer) public onlyOwner {
        require(badgeIssuer[badge] != address(0), "BADGE: NOT_ISSUED");
        address oldIssuer = badgeIssuer[badge];
        delete issuerBadge[oldIssuer];
        issuerBadge[newIssuer] = badge;
        badgeIssuer[badge] = newIssuer;
        emit ReplacedIssuer(oldIssuer, newIssuer, badge);
    }

    /// @notice Add an address as a co-issuer of a badge
    /// @param badge The name of the badge
    /// @param coIssuer The address of the co-issuer
    function registerCoIssuer(string memory badge, address coIssuer) public onlyIssuer(badge) {
        badgeCoIssuers[badge][coIssuer] = true;
        emit AddedCoIssuer(msg.sender, coIssuer, badge);
    }

    /// @notice Remove an address as a co-issuer of a badge
    /// @param badge The name of the badge
    /// @param coIssuer The address of the co-issuer
    function removeCoIssuer(string memory badge, address coIssuer) public onlyIssuer(badge) {
        delete badgeCoIssuers[badge][coIssuer];
        emit RemovedCoIssuer(msg.sender, coIssuer, badge);
    }

    /// @notice Register a path for a given badge
    /// @param badge The name of the badge
    /// @param path The badge path
    /// @param metadataKeys List of metadata keys
    /// @param metadataValues The metadata value for corresponding index in metadataKeys.
    function registerPath(
        string memory badge,
        string memory path,
        string[] memory metadataKeys,
        string[] memory metadataValues
    ) public onlyIssuerAndCoIssuer(badge) {
        require(metadataKeys.length == metadataValues.length, "BADGE: DIFF_META_SIZE");
        require(badgePaths[badge][path] == address(0), "BADGE: PATH_EXIST");
        badgePaths[badge][path] = msg.sender;

        for (uint256 i = 0; i < metadataKeys.length; i++) {
            pathMetadata[getPathId(badge, path)][metadataKeys[i]] = metadataValues[i];
            pathMetadataKeys[getPathId(badge, path)].push(metadataKeys[i]);
        }

        emit PathRegistered(msg.sender, badge, path, metadataKeys, metadataValues);
    }

    /// @notice Add metadata to a badge or path
    /// @param badge The name of the badge
    /// @param path The badge path
    /// @param key The metadata key
    /// @param value The metadata value
    function upsertMeta(
        string memory badge,
        string memory path,
        string memory key,
        string memory value
    ) public {
        if (keccak256(bytes(path)) == keccak256(bytes(""))) {
            require(badgeIssuer[badge] == msg.sender, "BADGE: NOT_ISSUER");
            bool exist = keccak256(bytes(badgeMetadata[badge][key])) != keccak256(bytes(""));
            badgeMetadata[badge][key] = value;
            if (!exist) badgeMetadataKeys[badge].push(key);
        } else {
            require(badgeIssuer[badge] == msg.sender || badgePaths[badge][path] == msg.sender, "BADGE: NOT_ISSUER");
            bool exist = keccak256(bytes(pathMetadata[getPathId(badge, path)][key])) != keccak256(bytes(""));
            pathMetadata[getPathId(badge, path)][key] = value;
            if (!exist) pathMetadataKeys[getPathId(badge, path)].push(key);
        }
        emit BadgeMetaUpdated(msg.sender, badge, path, key, value);
    }

    /// @notice Get unique path ID
    /// @param badge The name of the badge
    /// @param path The badge path
    function getPathId(string memory badge, string memory path) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(badge, path));
    }

    /// @notice Get grant ID
    /// @param badge The name of the badge
    /// @param path The badge path
    /// @param addr The receiving address
    function getGrantId(
        string memory badge,
        string memory path,
        address addr
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(badge, path, addr));
    }

    /// @notice Get the value of a badge's metadata key
    /// @param badge The name of the badge
    /// @param path The badge path
    /// @param key The metadata key
    function getMetaValue(
        string memory badge,
        string memory path,
        string memory key
    ) public view returns (string memory) {
        if (keccak256(bytes(path)) == keccak256(bytes(""))) {
            return badgeMetadata[badge][key];
        } else {
            return pathMetadata[getPathId(badge, path)][key];
        }
    }

    /// @notice Get all keys of a badge's metadata
    /// @param badge The name of the badge
    /// @param path The badge path
    function getMetaKeys(string memory badge, string memory path) public view returns (string[] memory) {
        if (keccak256(bytes(path)) == keccak256(bytes(""))) {
            return badgeMetadataKeys[badge];
        } else {
            return pathMetadataKeys[getPathId(badge, path)];
        }
    }

    /// @notice Transfer ownership of a badge or path to another address
    function transferBadgeOwnership(
        string memory badge,
        string memory path,
        address newOwner
    ) public {
        if (keccak256(bytes(path)) == keccak256(bytes(""))) {
            require(badgeIssuer[badge] == msg.sender, "BADGE: NOT_ISSUER");
            delete issuerBadge[msg.sender];
            delete badgeIssuer[badge];
            issuerBadge[newOwner] = badge;
            badgeIssuer[badge] = newOwner;
        } else {
            require(badgePaths[badge][path] == msg.sender, "BADGE: NOT_ISSUER");
            badgePaths[badge][path] = newOwner;
        }
        emit BadgeOwnershipTransferred(badge, path, msg.sender, newOwner);
    }

    function _grantBadge(
        string memory badge,
        string memory path,
        address addr,
        string[] memory metadataKeys,
        string[] memory metadataValues,
        uint256 expireAt
    ) internal {
        require(metadataKeys.length == metadataValues.length, "BADGE: DIFF_META_SIZE");
        require(expireAt == 0 || expireAt > block.timestamp, "BADGE: BAD_EXP_TIME");

        bytes32 id = getGrantId(badge, path, addr);
        granted[id] = GrantInfo(block.timestamp, expireAt);

        for (uint256 i = 0; i < metadataKeys.length; i++) {
            granteeMetadata[id][metadataKeys[i]] = metadataValues[i];
            granteeMetadataKeys[id].push(metadataKeys[i]);
        }

        emit GrantedBadge(badge, path, addr, metadataKeys, metadataValues, expireAt);
    }

    /// @notice Assign a badge or path to an address
    /// @param badge The name of the badge
    /// @param path The path of the badge
    /// @param addr The target address
    /// @param expireAt The time when the badge will expire (0 = no expiry)
    /// @param metadataKeys List of metadata keys
    /// @param metadataValues The metadata value for corresponding index in metadataKey.
    function grantBadge(
        string memory badge,
        string memory path,
        address addr,
        uint256 expireAt,
        string[] memory metadataKeys,
        string[] memory metadataValues
    ) public {
        if (keccak256(bytes(path)) == keccak256(bytes(""))) require(badgeIssuer[badge] == msg.sender, "BADGE: NOT_ISSUER");
        else require(badgePaths[badge][path] == msg.sender, "BADGE: NOT_ISSUER");
        _grantBadge(badge, path, addr, metadataKeys, metadataValues, expireAt);
    }

    /// @notice Given an issuer's signature, assign a badge or path to an address.
    /// @param badge The name of the badge
    /// @param path The path of the badge
    /// @param addr The target address
    /// @param expireAt The time when the badge will expire (0 = no expiry)
    /// @param metaKeys List of metadata keys
    /// @param metaValues The metadata value for corresponding index in metadataKey.
    /// @param sigExpireAt The time when the signature will expire
    /// @param sig The signature
    function grantBadgeBySig(
        string memory badge,
        string memory path,
        address addr,
        uint256 expireAt,
        string[] memory metaKeys,
        string[] memory metaValues,
        uint256 sigExpireAt,
        bytes calldata sig
    ) public {
        address issuer = (keccak256(bytes(path)) == keccak256(bytes(""))) ? badgeIssuer[badge] : badgePaths[badge][path];
        require(sigExpireAt > block.timestamp, "BADGE: EXPIRED_SIG");
        require(!usedSig[address(ripemd160(sig))], "BADGE: BAD_SIG");
        require(BadgeLib.verifyGrantSig(issuer, badge, path, addr, expireAt, metaKeys, metaValues, sigExpireAt, sig), "BADGE: BAD_SIG");
        usedSig[address(ripemd160(sig))] = true;
        _grantBadge(badge, path, addr, metaKeys, metaValues, expireAt);
    }

    /// @notice Get the metadata value for an address
    /// @param badge The badge name
    /// @param path The badge path (optional)
    /// @param addr The target address
    /// @param key The metadata key
    function getGranteeMetaValue(
        string memory badge,
        string memory path,
        address addr,
        string memory key
    ) public view returns (string memory) {
        bytes32 id = getGrantId(badge, path, addr);
        return granteeMetadata[id][key];
    }

    /// @notice Get the metadata keys for a grantee
    /// @param badge The badge name
    /// @param path The badge path (optional)
    /// @param addr The target address of grantee
    function getGranteeMetaKeys(
        string memory badge,
        string memory path,
        address addr
    ) public view returns (string[] memory) {
        bytes32 id = getGrantId(badge, path, addr);
        return granteeMetadataKeys[id];
    }

    function _revokeBadge(
        string memory badge,
        string memory path,
        address addr
    ) internal {
        bytes32 id = getGrantId(badge, path, addr);
        require(granted[id].grantedAt > 0, "BADGE: NOT_ISSUED");
        delete granted[id];
        for (uint256 i = 0; i < granteeMetadataKeys[id].length; i++) {
            delete granteeMetadata[id][granteeMetadataKeys[id][i]];
        }
        delete granteeMetadataKeys[id];
        emit RevokedBadge(badge, path, addr);
    }

    /// @notice Assign a badge or path to an address
    /// @param badge The name of the badge
    /// @param path The path of the badge
    /// @param addr The target address
    function revokeBadge(
        string memory badge,
        string memory path,
        address addr
    ) public {
        if (keccak256(bytes(path)) == keccak256(bytes(""))) require(badgeIssuer[badge] == msg.sender, "BADGE: NOT_ISSUER");
        else require(badgePaths[badge][path] == msg.sender, "BADGE: NOT_ISSUER");
        _revokeBadge(badge, path, addr);
    }

    /// @notice Given a signature, assign a badge or path to an address
    function revokeBadgeBySig(
        string memory badge,
        string memory path,
        address addr,
        uint256 expireAt,
        bytes calldata sig
    ) public {
        address issuer = (keccak256(bytes(path)) == keccak256(bytes(""))) ? badgeIssuer[badge] : badgePaths[badge][path];
        require(expireAt > block.timestamp, "BADGE: EXPIRED_SIG");
        require(!usedSig[address(ripemd160(sig))], "BADGE: BAD_SIG");
        require(BadgeLib.verifyRevokeSig(issuer, badge, path, addr, expireAt, sig), "BADGE: BAD_SIG");
        usedSig[address(ripemd160(sig))] = true;
        _revokeBadge(badge, path, addr);
    }

    function _upsertGranteeMeta(
        string memory badge,
        string memory path,
        address addr,
        string memory key,
        string memory value
    ) internal {
        bytes32 id = getGrantId(badge, path, addr);
        bool exist = keccak256(bytes(granteeMetadata[id][key])) != keccak256(bytes(""));
        granteeMetadata[id][key] = value;
        if (!exist) granteeMetadataKeys[id].push(key);
        emit GranteeBadgeMetaUpdated(msg.sender, addr, badge, path, key, value);
    }

    /// @notice Add metadata to an grantee's badge or path
    /// @param badge The name of the badge
    /// @param path The badge path
    /// @param addr The target grantee address
    /// @param key The metadata key
    /// @param value The metadata value
    function upsertGranteeMeta(
        string memory badge,
        string memory path,
        address addr,
        string memory key,
        string memory value
    ) public {
        if (keccak256(bytes(path)) == keccak256(bytes(""))) require(badgeIssuer[badge] == msg.sender, "BADGE: NOT_ISSUER");
        else require(badgePaths[badge][path] == msg.sender, "BADGE: NOT_ISSUER");
        _upsertGranteeMeta(badge, path, addr, key, value);
    }

    /// @notice Add metadata to an grantee's badge or path
    function upsertGranteeMetaBySig(
        string memory badge,
        string memory path,
        address addr,
        string memory key,
        string memory value,
        uint256 expireAt,
        bytes calldata sig
    ) public {
        address issuer = (keccak256(bytes(path)) == keccak256(bytes(""))) ? badgeIssuer[badge] : badgePaths[badge][path];
        require(expireAt > block.timestamp, "BADGE: EXPIRED_SIG");
        require(!usedSig[address(ripemd160(sig))], "BADGE: BAD_SIG");
        require(BadgeLib.verifyUpsertMetaSig(issuer, badge, path, addr, key, value, expireAt, sig), "BADGE: BAD_SIG");
        usedSig[address(ripemd160(sig))] = true;
        _upsertGranteeMeta(badge, path, addr, key, value);
    }

    /// @notice Check if an address has a given badge
    function hasBadge(
        address addr,
        string memory badge,
        string memory path
    ) public view returns (bool) {
        GrantInfo memory info = granted[getGrantId(badge, path, addr)];
        if (info.grantedAt == 0 || (info.expireAt > 0 && info.expireAt <= block.timestamp)) return false;
        return true;
    }
}
