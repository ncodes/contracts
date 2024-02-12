// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

struct Info {
    uint256 curRate;
    uint256 feeBp;
    uint256 feeFixed;
    uint256 amountPerRewardPoint;
    bool verified;
    bool stable;
    bool sharable;
}

interface IAssetRegistry {
    function set(address addr, uint256 curRate, uint256 feeBp, uint256 feeFixed, bool verified, bool stable, bool sharable) external;

    function setRate(address addr, uint256 rate) external;

    function setFee(uint256 feeBp, uint256 feeFixed) external;

    function get(address addr) external view returns (Info memory);

    function setVerified(address addr, bool verified) external;

    function setSharable(address addr, bool sharable) external;

    function getRate(address addr) external view returns (uint256);

    function setStable(address addr, bool stable) external;

    function toCur(address addr, uint256 value) external returns (uint256);
}
