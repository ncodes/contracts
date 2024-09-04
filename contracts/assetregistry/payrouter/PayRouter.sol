// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../../common/Ownable.sol";
import "../../token/interfaces/IERC20.sol";
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
    uint feeBp;
    uint256 bond;
}

struct Org {
    address creator;
    string name;
}

struct Request {
    address creator;
    uint256[] routeIds;
    uint256[] bonds;
    uint256 srcTokenAmt;
    uint256 sourceAmt;
    bool[] paid;
    bool closed;
    bool sourceReturned;
}

contract PayRouter is Ownable {
    uint256 public numOrgs;
    uint256 public numRoutes;
    uint256 public numRequests;
    address public bondToken;
    mapping(uint256 => Route) public routes;
    mapping(uint256 => Org) public orgs;
    mapping(uint256 => mapping(address => bool)) public approvedRouteRequesters;
    mapping(uint256 => Request) requests;

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
        uint256 feeBp,
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
    event SourceAmountReturned(address indexed router, uint256 routeId, uint256 amount);

    modifier onlyRouteOwner(uint256 routeId) {
        require(routes[routeId].owner != address(0), "PAYROUTER: UNKNOWN_ROUTE");
        require(routes[routeId].owner == msg.sender, "PAYROUTER: NOT_ROUTE_OWNER");
        _;
    }

    /// @notice Set the bond token address
    /// @dev Only owner can call
    /// @param _bondToken The bond token address
    function setBondToken(address _bondToken) external onlyOwner {
        bondToken = _bondToken;
        emit UpdatedBondToken(_bondToken);
    }

    /// @notice Approve a requester to use a route
    /// @dev Only the owner of the route can approve a requester
    /// @param routeId The route ID
    /// @param requester The requester address
    function approveRequester(uint256 routeId, address requester) external onlyRouteOwner(routeId) {
        approvedRouteRequesters[routeId][requester] = true;
        emit ApprovedRequester(routeId, requester);
    }

    /// @notice Unapprove a requester to use a route
    /// @dev Only the owner of the route can unapprove a requester
    /// @param routeId The route ID
    /// @param requester The requester address
    function unapproveRequester(uint256 routeId, address requester) external onlyRouteOwner(routeId) {
        require(approvedRouteRequesters[routeId][requester], "PAYROUTER: NOT_APPROVED");
        approvedRouteRequesters[routeId][requester] = false;
        emit UnapprovedRequester(routeId, requester);
    }

    /// @notice Check if a requester is approved to use a route
    /// @param routeId The route ID
    /// @param requester The requester address
    function isRequesterApproved(uint256 routeId, address requester) public view returns (bool) {
        return approvedRouteRequesters[routeId][requester];
    }

    /// @notice Create an organization
    /// @param name The name of the organization
    function createOrg(string calldata name) external {
        require(orgs[numOrgs].creator == address(0), "PAYROUTER: ORG_EXISTS");
        numOrgs++;
        orgs[numOrgs] = Org(msg.sender, name);
        emit OrgCreated(msg.sender, name, numOrgs);
    }

    /// @notice Create a route
    /// @param route The route object
    function createRoute(Route memory route) external {
        SourceType src = route.source;
        require(src != SourceType.Token || route.sourceToken != address(0), "PAYROUTER: SRC_TOKEN_ZERO");
        require(src != SourceType.Org || route.sourceOrgId > 0, "PAYROUTER: SRC_ORG_ZERO");
        require(src != SourceType.Org || route.sourceOrgId <= numOrgs, "PAYROUTER: SRC_ORG_UNKNOWN");
        require(route.destOrgId <= numOrgs, "PAYROUTER: DEST_ORG_UNKNOWN");
        require(route.feeBp <= 10000, "PAYROUTER: FEE_BP_TOO_HIGH");
        require(route.destOrgId > 0, "PAYROUTER: DST_ORG_ZERO");
        require(route.destOrgId <= numOrgs, "PAYROUTER: DST_ORG_UNKNOWN");

        IERC20(bondToken).transferFrom(msg.sender, address(this), route.bond);

        route.owner = msg.sender;
        routes[numRoutes] = route;
        emit RouteCreated(numRoutes, msg.sender, src, route.sourceToken, route.sourceOrgId, route.destOrgId, route.feeBp, route.bond);
        numRoutes++;
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
        require(route.bond >= amount, "PAYROUTER: INSUFFICIENT_BALANCE");
        route.bond -= amount;
        IERC20(bondToken).transfer(msg.sender, amount);
        emit WithdrawnBond(msg.sender, routeId, amount);
    }

    /// @notice Create a request
    /// @param _routeIds The route IDs
    /// @param _bonds The bond amounts
    /// @param _sourceAmt The amount of source token to transfer into the router
    function createRequest(uint256[] calldata _routeIds, uint256[] calldata _bonds, uint256 _sourceAmt) external payable {
        require(_routeIds.length == _bonds.length, "PAYROUTER: MISMATCHED_IDS_BONDS");

        for (uint256 i = 0; i < _routeIds.length; i++) {
            Route storage route = routes[_routeIds[i]];
            require(route.owner != address(0), "PAYROUTER: UNKNOWN_ROUTE");
            require(isRequesterApproved(i, msg.sender), "PAYROUTER: NOT_APPROVED_REQUESTER");

            // Deduct bond from route owner
            require(route.bond >= _bonds[i], "PAYROUTER: INSUFFICIENT_BOND_BALANCE");
            route.bond -= _bonds[i];

            // Transfer source token into router
            if (i == 0 && route.source == SourceType.Token) {
                requests[numRequests].srcTokenAmt = _sourceAmt;
                IERC20(route.sourceToken).transferFrom(msg.sender, address(this), _sourceAmt);
            } else if (i == 0 && route.source == SourceType.Native) {
                requests[numRequests].srcTokenAmt = _sourceAmt;
                require(msg.value == _sourceAmt, "PAYROUTER: INSUFFICIENT_MSG_VALUE");
            }
        }

        requests[numRequests].creator = msg.sender;
        requests[numRequests].sourceAmt = _sourceAmt;
        requests[numRequests].routeIds = _routeIds;
        requests[numRequests].bonds = _bonds;
        requests[numRequests].paid = new bool[](_routeIds.length);
        emit RequestCreated(msg.sender, numRequests, _routeIds, _bonds, _sourceAmt);
        numRequests++;
    }

    /// @notice Mark a request as paid. Returns the bond and source amount
    /// to the router if the request has been closed. If the request is not closed,
    /// the sender's route will only be marked as paid. The function can be callled
    /// multiple times for the same request.
    /// @param requestId The request ID
    function markRequestAsPaid(uint256 requestId) external {
        require(requests[requestId].routeIds.length > 0, "PAYROUTER: UNKNOWN_REQUEST");
        Request storage req = requests[requestId];

        for (uint256 i = 0; i < req.routeIds.length; i++) {
            // Get the route. Skip current iteration if the route is not owned by the sender
            Route memory route = routes[req.routeIds[i]];
            if (route.owner != msg.sender) continue;

            // Mark the request as paid for the route
            if (!req.paid[i]) {
                req.paid[i] = true;
                emit RequestPaid(msg.sender, requestId, req.routeIds[i], req.bonds[i]);
            }

            // If request is not closed, we can't return the bond and source token
            if (!req.closed) break;

            // Return bond to the route owner
            uint256 bond = req.bonds[i];
            if (bond > 0) {
                route.bond += bond;
                req.bonds[i] = 0;
                emit BondReturned(route.owner, req.routeIds[i], bond);
            }

            // Send the source token to the first router
            if (i == 0 && !req.sourceReturned) {
                req.sourceReturned = true;
                emit SourceAmountReturned(route.owner, req.routeIds[i], req.sourceAmt);
                if (route.source == SourceType.Token) {
                    IERC20(route.sourceToken).transfer(route.owner, req.sourceAmt);
                } else if (route.source == SourceType.Native) {
                    payable(route.owner).transfer(req.sourceAmt);
                }
            }

            break;
        }
    }

    /// @notice Close a request. Returns bond and source amount to route owners
    /// who have marked the request as paid. This function can be called multiple times.
    /// @param requestId The request ID
    function closeRequest(uint256 requestId) external {
        Request storage req = requests[requestId];
        require(req.routeIds.length > 0, "PAYROUTER: UNKNOWN_REQUEST");
        require(req.creator == msg.sender, "PAYROUTER: NOT_CREATOR");

        for (uint256 i = 0; i < req.routeIds.length; i++) {
            if (!req.paid[i]) continue;
            
            Route storage route = routes[req.routeIds[i]];

            if (req.bonds[i] > 0) {
                route.bond += req.bonds[i];
                emit BondReturned(route.owner, req.routeIds[i], req.bonds[i]);
                req.bonds[i] = 0;
            }

            // Send the source token to the first router
            if (i == 0 && !req.sourceReturned) {
                req.sourceReturned = true;
                emit SourceAmountReturned(route.owner, req.routeIds[i], req.sourceAmt);
                if (route.source == SourceType.Token) {
                    IERC20(route.sourceToken).transfer(route.owner, req.sourceAmt);
                } else if (route.source == SourceType.Native) {
                    payable(route.owner).transfer(req.sourceAmt);
                }
            }
        }

        req.closed = true;
    }
}
