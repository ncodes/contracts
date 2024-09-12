// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

interface IPayRouter {
    enum SourceType {
        Token,
        Native,
        Org
    }

    struct Route {
        address owner;
        SourceType source;
        address sourceToken;
        uint256 sourceOrgId;
        uint256 destOrgId;
        uint256 bond;
        address[] requesters;
    }

    struct Org {
        address creator;
        string name;
    }

    struct Request {
        address creator;
        address sourceToken;
        uint256[] routeIds;
        uint256[] bonds;
        uint256 sourceAmt;
        uint256 sourceAmtLeft;
        uint256 requesterFeeBp;
        uint256 protocolFeeBp;
        uint256 valueLockDuration;
        uint256 valueUnlockAt;
        uint256 numRoutersPaid;
        bool[] paid;
        bool closed;
        bool cancelled;
        bool orgSrcPaid;
    }

    function numOrgs() external view returns (uint256);
    function numRoutes() external view returns (uint256);
    function numRequests() external view returns (uint256);
    function protocolFeeBalance() external view returns (uint256);
    function bondToken() external view returns (address);
    function protocolFeeBp() external view returns (uint256);
    function routes(uint256) external view returns (Route memory);
    function orgs(uint256) external view returns (Org memory);
    function approvedRouteRequesters(uint256, address) external view returns (bool);
    function requests(uint256) external view returns (Request memory);
    function requestersFeeBp(address) external view returns (uint256);
    function requestersBalance(address) external view returns (uint256);
    function requesterValueLockDuration(address) external view returns (uint256);

    function setProtocolFeeBp(uint256 _protocolFeeBp) external;
    function setRequesterFeeBp(uint256 feeBp) external;
    function setRequesterValueLockDuration(uint256 duration) external;
    function setBondToken(address _bondToken) external;
    function createOrg(string calldata name) external;
    function createRoute(Route memory route) external;
    function approveRequester(uint256 routeId, address requester) external;
    function unapproveRequester(uint256 routeId, address requester) external;
    function isRequesterApproved(uint256 routeId, address requester) external view returns (bool);
    function getRequest(uint256 requestId) external view returns (Request memory);
    function depositBond(uint256 routeId, uint256 amount) external;
    function withdrawBond(uint256 routeId, uint256 amount) external;
    function createRequest(uint256[] calldata _routeIds, uint256[] calldata _bonds, uint256 _sourceAmt) external payable;
    function markOrgSourceAsPaid(uint256 requestId) external;
    function markRequestAsPaid(uint256 requestId) external;
    function closeRequest(uint256 requestId) external;
    function cancelRequest(uint256 requestId) external;
    function transferRequestBond(uint256 requestId, uint256 routeId, uint256 amount, address to) external;
    function transferRequestSource(uint256 requestId, uint256 amount, address to) external;
    function feeBalanceOf(address requester) external view returns (uint256);
    function withdrawRequesterFee(address beneficiary) external;
    function withdrawProtocolFee(address beneficiary) external;
}
