// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../common/Ownable.sol";
import "../token/interfaces/IERC20.sol";
import "hardhat/console.sol";

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

contract PayRouter is Ownable {
    uint256 public numOrgs;
    uint256 public numRoutes;
    uint256 public numRequests;
    uint256 public protocolFeeBalance;
    address public bondToken;
    uint256 public protocolFeeBp;
    mapping(uint256 => Route) public routes;
    mapping(uint256 => Org) public orgs;
    mapping(uint256 => mapping(address => bool)) public approvedRouteRequesters;
    mapping(uint256 => Request) public requests;
    mapping(address => uint256) public requestersFeeBp;
    mapping(address => uint256) public requestersBalance;
    mapping(address => uint256) public requesterValueLockDuration;

    /// @notice PayRouter is a contract that allows users to create and manage payment routes.
    /// @param _bondToken The address of the token used to pay router bond.
    constructor(address _bondToken) {
        bondToken = _bondToken;
    }

    event OrgCreated(address creator, string name, uint256 orgId);
    event RouteCreated(
        uint256 routeId,
        address owner,
        SourceType source,
        address sourceToken,
        uint256 sourceOrgId,
        uint256 destOrgId,
        uint256 bond
    );
    event UpdatedBondToken(address bondToken);
    event DepositedBond(address indexed depositor, uint256 routeId, uint256 amount);
    event WithdrawnBond(address indexed withdrawer, uint256 routeId, uint256 amount);
    event ApprovedRequester(uint256 routeId, address requester);
    event UnapprovedRequester(uint256 routeId, address requester);
    event RequestCreated(address creator, uint256 requestId, uint256[] routeIds, uint256[] bonds, uint256 sourceAmt);
    event RequestPaid(address router, uint256 requestId, uint256 routeId, uint256 bond);
    event BondReturned(address router, uint256 routeId, uint256 bond);
    event SourceReturned(address indexed router, uint256 routeId, uint256 amount);
    event UpdatedRequesterFeeBp(address requester, uint256 feeBp);
    event UpdatedProtocolFeeBp(uint256 protocolFeeBp);
    event RequesterFeeWithdrawn(address requester, address beneficiary, uint256 amount);
    event ProtocolFeeWithdrawn(address beneficiary, uint256 amount);
    event UpdatedValueLockDuration(address requester, uint256 duration);
    event OrgSourcePaid(uint256 requestId);
    event RequestCancelled(uint256 requestId);
    event RequestClosed(uint256 requestId);
    event BondTransferred(uint256 requestId, uint256 routeId, uint256 amount, address to);
    event SourceTransferred(uint256 requestId, uint256 amount, address to);

    modifier onlyRouteOwner(uint256 routeId) {
        require(routes[routeId].owner != address(0), "PR: UNKNOWN_ROUTE");
        require(routes[routeId].owner == msg.sender, "PR: NOT_ROUTE_OWNER");
        _;
    }

    modifier onlyRequestCreator(uint256 requestId) {
        require(requests[requestId].routeIds.length > 0, "PR: UNKNOWN_REQUEST");
        require(requests[requestId].creator == msg.sender, "PR: NOT_CREATOR");
        _;
    }

    /// @notice Set the protocol fee basis point
    /// @dev Only owner can call
    /// @param _protocolFeeBp The protocol fee basis point
    function setProtocolFeeBp(uint256 _protocolFeeBp) external onlyOwner {
        require(_protocolFeeBp <= 10000, "PR: TOO_HIGH");
        protocolFeeBp = _protocolFeeBp;
        emit UpdatedProtocolFeeBp(protocolFeeBp);
    }

    /// @notice Set the requester fee basis point
    /// @param feeBp The fee bp
    function setRequesterFeeBp(uint256 feeBp) external {
        require(feeBp <= 10000, "PR: TOO_HIGH");
        requestersFeeBp[msg.sender] = feeBp;
        emit UpdatedRequesterFeeBp(msg.sender, feeBp);
    }

    /// @notice Set the requester value lock duration
    /// @param duration The duration in seconds
    function setRequesterValueLockDuration(uint256 duration) external {
        requesterValueLockDuration[msg.sender] = duration;
        emit UpdatedValueLockDuration(msg.sender, duration);
    }

    /// @notice Set the bond token address
    /// @dev Only owner can call
    /// @param _bondToken The bond token address
    function setBondToken(address _bondToken) external onlyOwner {
        bondToken = _bondToken;
        emit UpdatedBondToken(_bondToken);
    }

    /// @notice Create an organization
    /// @param name The name of the organization
    function createOrg(string calldata name) external {
        numOrgs++;
        orgs[numOrgs] = Org(msg.sender, name);
        emit OrgCreated(msg.sender, name, numOrgs);
    }

    /// @notice Create a route
    /// @param route The route object
    function createRoute(Route memory route) external {
        SourceType src = route.source;
        require(src != SourceType.Token || route.sourceToken != address(0), "PR: SRC_TOKEN_ZERO");
        require(src != SourceType.Org || route.sourceOrgId > 0, "PR: SRC_ORG_ZERO");
        require(src != SourceType.Org || route.sourceOrgId <= numOrgs, "PR: SRC_ORG_UNKNOWN");
        require(route.destOrgId <= numOrgs, "PR: DEST_ORG_UNKNOWN");
        require(route.destOrgId > 0, "PR: DST_ORG_ZERO");
        require(route.destOrgId <= numOrgs, "PR: DST_ORG_UNKNOWN");

        IERC20(bondToken).transferFrom(msg.sender, address(this), route.bond);

        route.owner = msg.sender;
        routes[numRoutes] = route;
        emit RouteCreated(numRoutes, msg.sender, src, route.sourceToken, route.sourceOrgId, route.destOrgId, route.bond);

        for (uint256 i = 0; i < route.requesters.length; i++) {
            approveRequester(numRoutes, route.requesters[i]);
        }

        route.requesters = new address[](0);

        numRoutes++;
    }

    /// @notice Approve a requester to use a route
    /// @dev Only the owner of the route can approve a requester
    /// @param routeId The route ID
    /// @param requester The requester address
    function approveRequester(uint256 routeId, address requester) public onlyRouteOwner(routeId) {
        approvedRouteRequesters[routeId][requester] = true;
        emit ApprovedRequester(routeId, requester);
    }

    /// @notice Unapprove a requester to use a route
    /// @dev Only the owner of the route can unapprove a requester
    /// @param routeId The route ID
    /// @param requester The requester address
    function unapproveRequester(uint256 routeId, address requester) external onlyRouteOwner(routeId) {
        require(approvedRouteRequesters[routeId][requester], "PR: NOT_APPROVED");
        approvedRouteRequesters[routeId][requester] = false;
        emit UnapprovedRequester(routeId, requester);
    }

    /// @notice Check if a requester is approved to use a route
    /// @param routeId The route ID
    /// @param requester The requester address
    function isRequesterApproved(uint256 routeId, address requester) public view returns (bool) {
        return approvedRouteRequesters[routeId][requester];
    }

    /// @notice Get a request
    /// @param requestId The request ID
    function getRequest(uint256 requestId) external view returns (Request memory) {
        return requests[requestId];
    }

    /// @notice Deposit bond to a route
    /// @param routeId The route ID
    /// @param amount The amount of bond token to deposit
    function depositBond(uint256 routeId, uint256 amount) external onlyRouteOwner(routeId) {
        Route storage route = routes[routeId];
        route.bond += amount;
        IERC20(bondToken).transferFrom(msg.sender, address(this), amount);
        emit DepositedBond(msg.sender, routeId, amount);
    }

    /// @notice Withdraw bond from a route
    /// @param amount The amount of bond token to withdraw
    function withdrawBond(uint256 routeId, uint256 amount) external onlyRouteOwner(routeId) {
        Route storage route = routes[routeId];
        require(route.bond >= amount, "PR: INSUFFICIENT_BALANCE");
        route.bond -= amount;
        IERC20(bondToken).transfer(msg.sender, amount);
        emit WithdrawnBond(msg.sender, routeId, amount);
    }

    /// @notice Create a request
    /// @param _routeIds The route IDs
    /// @param _bonds The bond amounts
    /// @param _sourceAmt The amount of source token to transfer into the router
    function createRequest(uint256[] calldata _routeIds, uint256[] calldata _bonds, uint256 _sourceAmt) external payable {
        require(_routeIds.length > 0, "PR: NO_ROUTES");
        require(_routeIds.length == _bonds.length, "PR: MISMATCHED_IDS_BONDS");

        for (uint256 i = 0; i < _routeIds.length; i++) {
            Route storage route = routes[_routeIds[i]];
            require(route.owner != address(0), "PR: UNKNOWN_ROUTE");
            require(isRequesterApproved(i, msg.sender), "PR: NOT_APPROVED_REQUESTER");

            // Deduct bond from route owner
            require(route.bond >= _bonds[i], "PR: INSUFFICIENT_BOND_BALANCE");
            route.bond -= _bonds[i];

            // Transfer source token into router
            if (i == 0 && route.source == SourceType.Token) {
                IERC20(route.sourceToken).transferFrom(msg.sender, address(this), _sourceAmt);
            } else if (i == 0 && route.source == SourceType.Native) {
                require(msg.value == _sourceAmt, "PR: INSUFFICIENT_MSG_VALUE");
            }
        }

        requests[numRequests].creator = msg.sender;
        requests[numRequests].sourceAmt = _sourceAmt;
        requests[numRequests].sourceAmtLeft = _sourceAmt;
        requests[numRequests].routeIds = _routeIds;
        requests[numRequests].sourceToken = routes[_routeIds[0]].sourceToken;
        requests[numRequests].bonds = _bonds;
        requests[numRequests].paid = new bool[](_routeIds.length);
        requests[numRequests].requesterFeeBp = requestersFeeBp[msg.sender];
        requests[numRequests].protocolFeeBp = protocolFeeBp;
        requests[numRequests].valueLockDuration = requesterValueLockDuration[msg.sender];
        emit RequestCreated(msg.sender, numRequests, _routeIds, _bonds, _sourceAmt);
        numRequests++;
    }

    /// @notice Mark source token as paid
    /// @param requestId The request ID
    function markOrgSourceAsPaid(uint256 requestId) external onlyRequestCreator(requestId) {
        require(routes[requests[requestId].routeIds[0]].source == SourceType.Org, "PR: NOT_ORG_SOURCE");
        requests[requestId].orgSrcPaid = true;
        emit OrgSourcePaid(requestId);
    }

    function returnBondAndSource(Request storage req, uint256 i) internal {
        if (block.timestamp < req.valueUnlockAt) return;

        Route storage route = routes[req.routeIds[i]];

        // Return bond to the route owner. Subtract requester and protocol fees from the bond.
        uint256 bond = req.bonds[i];
        if (bond > 0) {
            uint256 requesterFee = (req.cancelled) ? 0 : (bond * req.requesterFeeBp) / 10000;
            uint256 protocolFee = (req.cancelled) ? 0 : (bond * req.protocolFeeBp) / 10000;
            requestersBalance[req.creator] += requesterFee;
            protocolFeeBalance += protocolFee;
            bond = bond - requesterFee - protocolFee;
            route.bond += bond;
            req.bonds[i] = 0;
            emit BondReturned(route.owner, req.routeIds[i], bond);
        }

        // Send the source token to the first router if the request is not cancelled.
        // If the request is cancelled, the source token will be returned to the request creator.
        if (i == 0 && req.sourceAmtLeft > 0) {
            req.sourceAmtLeft = 0;
            address receiver = req.cancelled ? req.creator : route.owner;
            emit SourceReturned(receiver, req.routeIds[i], req.sourceAmt);
            if (route.source == SourceType.Token) {
                IERC20(route.sourceToken).transfer(receiver, req.sourceAmt);
            } else if (route.source == SourceType.Native) {
                payable(receiver).transfer(req.sourceAmt);
            }
        }
    }

    /// @notice Mark a request as paid. Returns the bond and source amount
    /// to the router if the request has been closed. If the request is not closed,
    /// the sender's route will only be marked as paid. The function can be callled
    /// multiple times for the same request.
    /// @param requestId The request ID
    function markRequestAsPaid(uint256 requestId) external {
        require(requests[requestId].routeIds.length > 0, "PR: UNKNOWN_REQUEST");
        Request storage req = requests[requestId];

        for (uint256 i = 0; i < req.routeIds.length; i++) {
            // Get the route. Skip current iteration if the route is not owned by the sender
            Route storage route = routes[req.routeIds[i]];
            if (route.owner != msg.sender) continue;

            // Mark the request as paid for the route
            if (!req.paid[i]) {
                req.paid[i] = true;
                req.numRoutersPaid++;
                emit RequestPaid(msg.sender, requestId, req.routeIds[i], req.bonds[i]);
            }

            // If request is not closed, we can't return the bond and source token
            if (!req.closed) break;

            returnBondAndSource(req, i);

            break;
        }
    }

    /// @notice Close a request. Returns bond and source amount to route owners
    /// who have marked the request as paid. This function can be called multiple times.
    /// @param requestId The request ID
    function closeRequest(uint256 requestId) external onlyRequestCreator(requestId) {
        Request storage req = requests[requestId];

        if (!req.closed) {
            req.valueUnlockAt = block.timestamp + req.valueLockDuration;
        }

        for (uint256 i = 0; i < req.routeIds.length; i++) {
            if (!req.paid[i]) continue;
            returnBondAndSource(req, i);
        }

        req.closed = true;

        emit RequestClosed(requestId);
    }

    /// @notice Cancel a request. Cancelling a request will return the bond and source amount.
    /// The bonds are returned to the route's owner and the source token is returned to the request creator
    /// instead of the first route owner. Will revert if the request is already closed, cancelled, if the
    /// source value has already been paid to the first route owner, or if the request has been marked as paid by a routers.
    /// @param requestId The request ID
    function cancelRequest(uint256 requestId) external onlyRequestCreator(requestId) {
        Request storage req = requests[requestId];
        require(!req.cancelled, "PR: ALREADY_CANCELLED");
        require(!req.closed, "PR: ALREADY_CLOSED");
        require(!req.orgSrcPaid, "PR: ORG_SOURCE_PAID");
        require(req.numRoutersPaid == 0, "PR: ROUTER_PAID");

        req.cancelled = true;

        for (uint256 i = 0; i < req.routeIds.length; i++) {
            returnBondAndSource(req, i);
        }

        req.closed = true;

        emit RequestCancelled(requestId);
    }

    /// @notice Transfer bond from a request to a specific address
    /// @param requestId The request ID
    /// @param routeId The route ID
    /// @param to The address to transfer the bond to
    /// @dev Only the request creator can call this function
    function transferRequestBond(uint256 requestId, uint256 routeId, uint256 amount, address to) external onlyRequestCreator(requestId) {
        Request storage req = requests[requestId];
        require(req.routeIds.length > routeId, "PR: UNKNOWN_ROUTE");
        require(req.bonds[routeId] >= amount, "PR: INSUF_BALANCE");

        uint256 bond = req.bonds[routeId];
        req.bonds[routeId] = bond - amount;
        IERC20(bondToken).transfer(to, amount);

        emit BondTransferred(requestId, routeId, amount, to);
    }

    /// @notice Transfer source token from a request to a specific address
    /// @param requestId The request ID
    /// @param amount The amount of source token to transfer
    /// @param to The address to transfer the source token to
    /// @dev Only the request creator can call this function
    function transferSourceToken(uint256 requestId, uint256 amount, address to) external onlyRequestCreator(requestId) {
        Request storage req = requests[requestId];
        require(req.sourceAmtLeft >= amount, "PR: INSUF_BALANCE");

        uint256 sourceAmtLeft = req.sourceAmtLeft;
        req.sourceAmtLeft = sourceAmtLeft - amount;
        IERC20(req.sourceToken).transfer(to, amount);

        emit SourceTransferred(requestId, amount, to);
    }

    /// @notice Get the fee balance of a requester
    /// @param requester The requester address
    function feeBalanceOf(address requester) external view returns (uint256) {
        return requestersBalance[requester];
    }

    /// @notice Withdraw all requester fee
    /// @param beneficiary The beneficiary address. If zero, the caller will be used
    function withdrawRequesterFee(address beneficiary) external {
        if (beneficiary == address(0)) beneficiary = msg.sender;
        uint256 balance = requestersBalance[msg.sender];
        requestersBalance[msg.sender] = 0;
        IERC20(bondToken).transfer(beneficiary, balance);
        emit RequesterFeeWithdrawn(msg.sender, beneficiary, balance);
    }

    /// @notice Withdraw all protocol fee
    /// @param beneficiary The beneficiary address. If zero, the caller will be used
    function withdrawProtocolFee(address beneficiary) external onlyOwner {
        if (beneficiary == address(0)) beneficiary = msg.sender;
        uint256 balance = protocolFeeBalance;
        protocolFeeBalance = 0;
        IERC20(bondToken).transfer(beneficiary, balance);
        emit ProtocolFeeWithdrawn(beneficiary, balance);
    }
}
