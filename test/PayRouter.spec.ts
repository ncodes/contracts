import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {ethers} from "hardhat";
import {PayRouter, TOKEN} from "../typechain-types";
import {AddressZero, advanceBlockTime, powOf, SourceType, toBN} from "../utils/utils";

describe("PayRouter", function () {
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let user4: SignerWithAddress;
    let accts: SignerWithAddress[];
    let payRouter: PayRouter;
    let bondToken: TOKEN;

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[1];
        user3 = accts[2];
        user4 = accts[3];

        let supply = toBN("1000000000000000000000000");
        let TOKEN = await ethers.getContractFactory("TOKEN");
        bondToken = (await TOKEN.deploy("BOND", "BOND", supply, 18)) as TOKEN;

        let factory = await ethers.getContractFactory("PayRouter");
        payRouter = (await factory.deploy(bondToken.address)) as PayRouter;
    });

    describe(".setBondToken", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(payRouter.connect(user2).setBondToken(user2.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully set bond token", async () => {
            await expect(payRouter.setBondToken(user2.address)).not.to.be.reverted;
            expect(await payRouter.bondToken()).to.eql(user2.address);
        });
    });

    describe(".setProtocolFeeBp", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(payRouter.connect(user2).setProtocolFeeBp(1000)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should revert with reason=PR: TOO_HIGH when fee basis point is too high", async () => {
            await expect(payRouter.setProtocolFeeBp(10001)).to.be.revertedWith("PR: TOO_HIGH");
        });

        it("should successfully set protocol fee basis point", async () => {
            await expect(payRouter.setProtocolFeeBp(1000)).not.to.be.reverted;
            expect(await payRouter.protocolFeeBp()).to.eq(1000);
        });
    });

    describe(".setRequesterFeeBp", () => {
        it("should revert with reason=PR: TOO_HIGH when fee basis point is too high", async () => {
            await expect(payRouter.setRequesterFeeBp(10001)).to.be.revertedWith("PR: TOO_HIGH");
        });

        it("should successfully set requester fee basis point", async () => {
            await expect(payRouter.setRequesterFeeBp(1000)).not.to.be.reverted;
            expect(await payRouter.requestersFeeBp(deployer.address)).to.eq(1000);
        });
    });

    describe(".approveRequester", () => {
        it("should revert with reason=UNKNOWN_ROUTE when route does not exist", async () => {
            await expect(payRouter.connect(user2).approveRequester(1, user2.address)).to.be.revertedWith("PR: UNKNOWN_ROUTE");
        });

        it("should revert with reason=NOT_ROUTE_OWNER when sender is not the owner of the route", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Org,
                sourceToken: AddressZero,
                sourceOrgId: 1,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });
            await expect(payRouter.connect(user2).approveRequester(0, user2.address)).to.be.revertedWith("PR: NOT_ROUTE_OWNER");
        });

        it("should successfully approve a requester", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Org,
                sourceToken: AddressZero,
                sourceOrgId: 1,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });
            await expect(payRouter.approveRequester(0, user2.address)).to.emit(payRouter, "ApprovedRequester").withArgs(0, user2.address);
            expect(await payRouter.isRequesterApproved(0, user2.address)).to.be.true;
        });
    });

    describe(".unapproveRequester", () => {
        async function createRoute() {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Org,
                sourceToken: AddressZero,
                sourceOrgId: 1,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });
        }

        it("should revert with reason=UNKNOWN_ROUTE when route does not exist", async () => {
            await expect(payRouter.connect(user2).unapproveRequester(1, user2.address)).to.be.revertedWith("PR: UNKNOWN_ROUTE");
        });

        it("should revert with reason=NOT_ROUTE_OWNER when sender is not the owner of the route", async () => {
            await createRoute();
            await expect(payRouter.connect(user2).unapproveRequester(0, user2.address)).to.be.revertedWith("PR: NOT_ROUTE_OWNER");
        });

        it("should revert with reason=NOT_APPROVED when requester was not previously approved", async () => {
            await createRoute();
            await expect(payRouter.unapproveRequester(0, user2.address)).to.be.revertedWith("PR: NOT_APPROVED");
        });

        it("should successfully unapprove a requester", async () => {
            await createRoute();
            await payRouter.approveRequester(0, user2.address);
            await expect(payRouter.unapproveRequester(0, user2.address)).to.emit(payRouter, "UnapprovedRequester").withArgs(0, user2.address);
            expect(await payRouter.isRequesterApproved(0, user2.address)).to.be.false;
        });
    });

    describe(".createOrg", () => {
        it("should create successfully", async () => {
            await expect(payRouter.createOrg("org1")).to.emit(payRouter, "OrgCreated").withArgs(deployer.address, "org1", 1);
            expect(await payRouter.numOrgs()).to.eq(1);
            const org = await payRouter.orgs(1);
            expect(org.creator).to.eq(deployer.address);
            expect(org.name).to.eq("org1");
        });

        it("should revert with reason=ORG_EXISTS when org already exists", async () => {
            await payRouter.createOrg("org1");
            expect(await payRouter.userHasOrg(deployer.address, "org1")).to.be.true;

            await expect(payRouter.createOrg("org1")).to.be.revertedWith("PR: ORG_EXISTS");

            // should allow another account create same org name
            expect(await payRouter.userHasOrg(user2.address, "org1")).to.be.false;
            await expect(payRouter.connect(user2).createOrg("org1")).to.emit(payRouter, "OrgCreated").withArgs(user2.address, "org1", 2);
            expect(await payRouter.userHasOrg(user2.address, "org1")).to.be.true;
        });
    });

    describe(".createRoute", () => {
        it("should revert when source is token and source token is zero", async () => {
            await expect(
                payRouter.createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: AddressZero,
                    sourceOrgId: 0,
                    destOrgId: 0,
                    bond: 0,
                    requesters: [],
                }),
            ).to.be.revertedWith("PR: SRC_TOKEN_ZERO");
        });

        it("should revert when source is Token and source token is zero", async () => {
            await expect(
                payRouter.createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: AddressZero,
                    sourceOrgId: 0,
                    destOrgId: 0,
                    bond: 0,
                    requesters: [],
                }),
            ).to.be.revertedWith("PR: SRC_TOKEN_ZERO");
        });

        it("should revert when source is Org and source org ID is zero", async () => {
            await expect(
                payRouter.createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 0,
                    destOrgId: 0,
                    bond: 0,
                    requesters: [],
                }),
            ).to.be.revertedWith("PR: SRC_ORG_ZERO");
        });

        it("should revert when source is Org and source org ID is unknown", async () => {
            await expect(
                payRouter.createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 1,
                    destOrgId: 0,
                    bond: 0,
                    requesters: [],
                }),
            ).to.be.revertedWith("PR: SRC_ORG_UNKNOWN");
        });

        it("should revert destination org ID is unknown", async () => {
            await payRouter.createOrg("org1");
            await expect(
                payRouter.createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 1,
                    destOrgId: 2,
                    bond: 0,
                    requesters: [],
                }),
            ).to.be.revertedWith("PR: DEST_ORG_UNKNOWN");
        });

        it("should revert when destination Org ID is zero", async () => {
            await payRouter.createOrg("org1");
            await expect(
                payRouter.createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 1,
                    destOrgId: 0,
                    bond: 0,
                    requesters: [],
                }),
            ).to.be.revertedWith("PR: DST_ORG_ZERO");
        });

        it("should revert when source is Org ID is zero", async () => {
            await payRouter.createOrg("org1");
            await expect(
                payRouter.createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 1,
                    destOrgId: 1,
                    bond: 0,
                    requesters: [],
                }),
            ).not.to.be.revertedWith("PR: DST_ORG_ZERO");
        });

        it("should successfully create route", async () => {
            await payRouter.createOrg("org1");
            await expect(
                payRouter.createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 1,
                    destOrgId: 1,
                    bond: 0,
                    requesters: [],
                }),
            )
                .to.emit(payRouter, "RouteCreated")
                .withArgs(0, deployer.address, SourceType.Org, AddressZero, 1, 1, 0);
        });

        it("should successfully create route with requesters", async () => {
            await payRouter.createOrg("org1");
            await expect(
                payRouter.createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 1,
                    destOrgId: 1,
                    bond: 0,
                    requesters: [user2.address, user3.address],
                }),
            )
                .to.emit(payRouter, "RouteCreated")
                .withArgs(0, deployer.address, SourceType.Org, AddressZero, 1, 1, 0)
                .emit(payRouter, "ApprovedRequester")
                .withArgs(0, user2.address)
                .emit(payRouter, "ApprovedRequester")
                .withArgs(0, user3.address);

            expect(await payRouter.approvedRouteRequesters(0, user2.address)).to.be.true;
            expect(await payRouter.approvedRouteRequesters(0, user3.address)).to.be.true;
        });

        describe("bond > 0", () => {
            it("should successfully create route", async () => {
                await payRouter.createOrg("org1");

                await bondToken.approve(payRouter.address, 100);

                await expect(
                    payRouter.createRoute({
                        owner: AddressZero,
                        source: SourceType.Org,
                        sourceToken: AddressZero,
                        sourceOrgId: 1,
                        destOrgId: 1,
                        bond: 100,
                        requesters: [],
                    }),
                )
                    .to.emit(payRouter, "RouteCreated")
                    .withArgs(0, deployer.address, SourceType.Org, AddressZero, 1, 1, 100);
            });
        });
    });

    describe(".depositBond", () => {
        it("should revert when route is unknown", async () => {
            await expect(payRouter.connect(user2).depositBond(0, 1)).to.be.revertedWith("PR: UNKNOWN_ROUTE");
        });

        it("should revert when sender is not owner of route", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });
            await expect(payRouter.connect(user2).depositBond(0, 1)).to.be.revertedWith("PR: NOT_ROUTE_OWNER");
        });

        it("should revert when bond token balance is insufficient", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });
            await expect(payRouter.depositBond(0, 1)).to.be.revertedWith("ERC20: insufficient allowance");
        });

        it("should successfully deposit bond token", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });

            await bondToken.approve(payRouter.address, 2);
            await expect(payRouter.depositBond(0, 1)).to.emit(payRouter, "DepositedBond").withArgs(deployer.address, 0, 1);
            let route = await payRouter.routes(0);
            expect(route.bond).to.eq(1);

            await expect(payRouter.depositBond(0, 1)).not.to.be.reverted;
            route = await payRouter.routes(0);
            expect(route.bond).to.eq(2);
        });
    });

    describe(".withdrawBond", () => {
        it("should revert with reason=UNKNOWN_ROUTE when route is unknown", async () => {
            await expect(payRouter.connect(user2).withdrawBond(0, 1)).to.be.revertedWith("PR: UNKNOWN_ROUTE");
        });

        it("should revert with reason=NOT_ROUTE_OWNER when sender is not route owner", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });
            await expect(payRouter.connect(user2).withdrawBond(0, 1)).to.be.revertedWith("PR: NOT_ROUTE_OWNER");
        });

        it("should revert with reason=INSUFFICIENT_BALANCE when bond token balance is insufficient", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });
            await expect(payRouter.withdrawBond(0, 1)).to.be.revertedWith("PR: INSUFFICIENT_BALANCE");
        });

        it("should successfully withdraw bond", async () => {
            await payRouter.createOrg("org1");

            await bondToken.approve(payRouter.address, 1);

            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: 1,
                requesters: [],
            });

            await bondToken.approve(payRouter.address, 2);
            await payRouter.depositBond(0, 2);
            expect((await payRouter.routes(0)).bond).to.eq(3);

            await expect(payRouter.withdrawBond(0, 1)).to.emit(payRouter, "WithdrawnBond").withArgs(deployer.address, 0, 1);
            expect((await payRouter.routes(0)).bond).to.eq(2);

            await expect(payRouter.withdrawBond(0, 1)).not.to.be.reverted;
            expect((await payRouter.routes(0)).bond).to.eq(1);
        });
    });

    // test: createRequest
    describe("createRequest", () => {
        it("should revert with msg='PR: NO_ROUTES' when route is empty", async () => {
            await expect(payRouter.createRequest([], [], 100)).to.be.revertedWith("PR: NO_ROUTES");
        });

        it("should revert with msg='MISMATCHED_IDS_BONDS' when routeIds and bonds length are not the same", async () => {
            await expect(payRouter.createRequest([1, 2], [100], 100)).to.be.revertedWith("PR: MISMATCHED_IDS_BONDS");
            await expect(payRouter.createRequest([1], [100, 200], 100)).to.be.revertedWith("PR: MISMATCHED_IDS_BONDS");
        });

        it("should revert with msg='UNKNOWN_ROUTE' when route does not exist", async () => {
            await expect(payRouter.createRequest([1], [100], 100)).to.be.revertedWith("PR: UNKNOWN_ROUTE");
        });

        it("should revert with msg='X' when when sender is not an approved requester", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });
            await expect(payRouter.connect(user2).createRequest([0], [1], 1)).to.be.revertedWith("PR: NOT_APPROVED_REQUESTER");
        });

        it("should revert with msg='SRC_NOT_ORG' when source org of routes preceding first route is not ORG", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createOrg("org2");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 2,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });
            await payRouter.approveRequester(0, user2.address);
            await payRouter.approveRequester(1, user2.address);
            await expect(payRouter.connect(user2).createRequest([0, 1], [0, 0], 0)).to.be.revertedWith("PR: SRC_NOT_ORG");
        });

        it("should revert with msg='BAD_ORG_LINK' when destination org ID of previous route is not equal to source org ID of next route", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createOrg("org2");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Org,
                sourceToken: AddressZero,
                sourceOrgId: 2,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });
            await payRouter.approveRequester(0, user2.address);
            await payRouter.approveRequester(1, user2.address);
            await expect(payRouter.connect(user2).createRequest([0, 1], [0, 0], 0)).to.be.revertedWith("PR: BAD_ORG_LINK");
        });

        it("should revert with msg='INSUFFICIENT_BOND_BALANCE' when bond balance is insufficient", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });
            await payRouter.approveRequester(0, user2.address);
            await expect(payRouter.connect(user2).createRequest([0], [1], 1)).to.be.revertedWith("PR: INSUFFICIENT_BOND_BALANCE");
        });

        describe("source type = Token", () => {
            it("should revert when unable to transfer route amount due to insufficient allowance", async () => {
                await payRouter.createOrg("org1");
                await payRouter.connect(user2).createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: bondToken.address,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    bond: 0,
                    requesters: [],
                });
                await bondToken.transfer(user2.address, 1);
                await bondToken.connect(user2).approve(payRouter.address, 1);
                await payRouter.connect(user2).depositBond(0, 1);
                expect((await payRouter.routes(0)).bond).to.eq(1);

                await payRouter.connect(user2).approveRequester(0, user2.address);

                await expect(payRouter.connect(user2).createRequest([0], [1], 1)).to.be.revertedWith("ERC20: insufficient allowance");
            });

            it("should successfully create request", async () => {
                await payRouter.createOrg("org1");
                await payRouter.connect(user2).createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: bondToken.address,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    bond: 0,
                    requesters: [],
                });

                await bondToken.transfer(user2.address, 2);
                await bondToken.connect(user2).approve(payRouter.address, 1);
                await payRouter.connect(user2).depositBond(0, 1);
                expect((await payRouter.routes(0)).bond).to.eq(1);

                await bondToken.connect(user2).approve(payRouter.address, 1);

                await payRouter.connect(user2).approveRequester(0, user2.address);

                await expect(payRouter.connect(user2).createRequest([0], [1], 1))
                    .to.emit(payRouter, "RequestCreated")
                    .withArgs(user2.address, 0, [0], [1], 1);

                const req = await payRouter.getRequest(0);
                expect(req.routeIds).to.have.length(1);
                expect(req.routeIds[0]).to.eq(0);
                expect(req.bonds).to.have.length(1);
                expect(req.bonds[0]).to.eq(1);
                expect(req.sourceAmt).to.eq(1);
                expect(req.sourceAmtLeft).to.eq(1);
            });
        });

        describe("source type = Native", () => {
            it("should revert when insufficient or too much transaction value is sent", async () => {
                await payRouter.createOrg("org1");
                await payRouter.connect(user2).createRoute({
                    owner: AddressZero,
                    source: SourceType.Native,
                    sourceToken: AddressZero,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    bond: 0,
                    requesters: [],
                });

                await bondToken.transfer(user2.address, 1);
                await bondToken.connect(user2).approve(payRouter.address, 1);
                await payRouter.connect(user2).depositBond(0, 1);
                expect((await payRouter.routes(0)).bond).to.eq(1);

                await payRouter.connect(user2).approveRequester(0, user2.address);

                await expect(payRouter.connect(user2).createRequest([0], [1], 1)).to.be.revertedWith("PR: INSUFFICIENT_DEPOSIT");
                await expect(payRouter.connect(user2).createRequest([0], [1], 1, {value: 2})).to.be.revertedWith("PR: INSUFFICIENT_DEPOSIT");
            });

            it("should successfully create request", async () => {
                await payRouter.createOrg("org1");
                await payRouter.connect(user2).createRoute({
                    owner: AddressZero,
                    source: SourceType.Native,
                    sourceToken: AddressZero,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    bond: 0,
                    requesters: [],
                });

                await bondToken.transfer(user2.address, 1);
                await bondToken.connect(user2).approve(payRouter.address, 1);
                await payRouter.connect(user2).depositBond(0, 1);
                expect((await payRouter.routes(0)).bond).to.eq(1);

                await payRouter.connect(user2).approveRequester(0, user2.address);

                await expect(payRouter.connect(user2).createRequest([0], [1], 1, {value: 1}))
                    .to.emit(payRouter, "RequestCreated")
                    .withArgs(user2.address, 0, [0], [1], 1);

                const req = await payRouter.getRequest(0);
                expect(req.routeIds).to.have.length(1);
                expect(req.routeIds[0]).to.eq(0);
                expect(req.bonds).to.have.length(1);
                expect(req.bonds[0]).to.eq(1);
                expect(req.sourceAmt).to.eq(1);
                expect(req.sourceAmtLeft).to.eq(1);
            });
        });
    });

    // test: markRequestAsPaid
    describe("markRequestAsPaid", () => {
        it("should revert with msg='UNKNOWN_REQUEST' when routeIds and bonds length are not the same", async () => {
            await expect(payRouter.markRequestAsPaid(0)).to.be.revertedWith("PR: UNKNOWN_REQUEST");
        });

        describe("request is not closed", () => {
            it("should successfully mark a request as paid", async () => {
                await payRouter.createOrg("org1");

                await payRouter.connect(user2).createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: bondToken.address,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    bond: 0,
                    requesters: [],
                });

                await payRouter.connect(user3).createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 1,
                    destOrgId: 1,
                    bond: 0,
                    requesters: [],
                });

                await bondToken.transfer(user2.address, 2);
                await bondToken.transfer(user3.address, 2);

                await bondToken.connect(user2).approve(payRouter.address, 1);
                await payRouter.connect(user2).depositBond(0, 1);
                await bondToken.connect(user3).approve(payRouter.address, 1);
                await payRouter.connect(user3).depositBond(1, 1);

                expect((await payRouter.routes(0)).bond).to.eq(1);
                expect((await payRouter.routes(1)).bond).to.eq(1);

                await bondToken.connect(user2).approve(payRouter.address, 1);
                await bondToken.connect(user3).approve(payRouter.address, 1);

                await payRouter.connect(user2).approveRequester(0, user2.address);
                await payRouter.connect(user3).approveRequester(1, user2.address);

                await expect(payRouter.connect(user2).createRequest([0, 1], [1, 1], 1, {value: 1}))
                    .to.emit(payRouter, "RequestCreated")
                    .withArgs(user2.address, 0, [0, 1], [1, 1], 1);

                await expect(payRouter.connect(user2).markRequestAsPaid(0)).not.to.be.reverted;
                await expect(payRouter.connect(user3).markRequestAsPaid(0)).not.to.be.reverted;

                // re-call
                await expect(payRouter.connect(user2).markRequestAsPaid(0)).not.to.be.reverted;
                await expect(payRouter.connect(user3).markRequestAsPaid(0)).not.to.be.reverted; //

                const req = await payRouter.getRequest(0);
                expect(req.paid).to.have.length(2);
                expect(req.paid[0]).to.be.true;
                expect(req.paid[1]).to.be.true;
                expect(req.closed).to.be.false;
                expect(req.numRoutersPaid).to.eq(2);

                expect((await payRouter.routes(0)).bond).to.eq(0);
                expect((await payRouter.routes(1)).bond).to.eq(0);
            });
        });

        describe("request is closed", () => {
            it("should return bond and source amount (to first router)'", async () => {
                await payRouter.createOrg("org1");

                await payRouter.connect(user2).createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: bondToken.address,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    bond: 0,
                    requesters: [],
                });

                await payRouter.connect(user3).createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 1,
                    destOrgId: 1,
                    bond: 0,
                    requesters: [],
                });

                await bondToken.transfer(user2.address, 2);
                await bondToken.transfer(user3.address, 2);

                await bondToken.connect(user2).approve(payRouter.address, 1);
                await payRouter.connect(user2).depositBond(0, 1);
                await bondToken.connect(user3).approve(payRouter.address, 1);
                await payRouter.connect(user3).depositBond(1, 1);

                expect((await payRouter.routes(0)).bond).to.eq(1);
                expect((await payRouter.routes(1)).bond).to.eq(1);

                await bondToken.connect(user2).approve(payRouter.address, 1);
                await bondToken.connect(user3).approve(payRouter.address, 1);

                await payRouter.connect(user2).approveRequester(0, user2.address);
                await payRouter.connect(user3).approveRequester(1, user2.address);

                await expect(payRouter.connect(user2).createRequest([0, 1], [1, 1], 1, {value: 1}))
                    .to.emit(payRouter, "RequestCreated")
                    .withArgs(user2.address, 0, [0, 1], [1, 1], 1);

                let route = await payRouter.routes(0);
                expect(route.bond).to.eq(0);
                let route2 = await payRouter.routes(1);
                expect(route2.bond).to.eq(0);

                await expect(payRouter.connect(user2).closeRequest(0)).not.to.be.reverted;

                // bond should still not have been returned
                route = await payRouter.routes(0);
                expect(route.bond).to.eq(0);
                route2 = await payRouter.routes(1);
                expect(route2.bond).to.eq(0);

                await expect(payRouter.connect(user2).markRequestAsPaid(0)).not.to.be.reverted;
                await expect(payRouter.connect(user3).markRequestAsPaid(0)).not.to.be.reverted;

                // bond should have been returned
                route = await payRouter.routes(0);
                expect(route.bond).to.eq(1);
                route2 = await payRouter.routes(1);
                expect(route2.bond).to.eq(1);

                const req = await payRouter.getRequest(0);
                expect(req.closed).to.be.true;
                expect(req.bonds).to.have.length(2);
                expect(req.bonds[0]).to.eq(0);
                expect(req.bonds[1]).to.eq(0);
                expect(req.sourceAmtLeft).to.eq(0);
                expect(req.paid).to.have.length(2);
                expect(req.paid[0]).to.be.true;
                expect(req.paid[1]).to.be.true;
            });
        });

        describe("protocol fee and requester fee are non-zero", () => {
            it("should deduct protocol fee and requester fee from the bond returned", async () => {
                await payRouter.setProtocolFeeBp(100);
                await payRouter.connect(user2).setRequesterFeeBp(100);

                await payRouter.createOrg("org1");
                await payRouter.connect(user2).createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: bondToken.address,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    bond: 0,
                    requesters: [],
                });

                await payRouter.connect(user3).createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 1,
                    destOrgId: 1,
                    bond: 0,
                    requesters: [],
                });

                await bondToken.transfer(user2.address, powOf(2, 18));
                await bondToken.transfer(user3.address, powOf(2, 18));

                await bondToken.connect(user2).approve(payRouter.address, powOf(2, 18));
                await payRouter.connect(user2).depositBond(0, powOf(1, 18));
                await bondToken.connect(user3).approve(payRouter.address, powOf(1, 18));
                await payRouter.connect(user3).depositBond(1, powOf(1, 18));

                expect((await payRouter.routes(0)).bond).to.eq(powOf(1, 18));
                expect((await payRouter.routes(1)).bond).to.eq(powOf(1, 18));

                await bondToken.connect(user2).approve(payRouter.address, powOf(1, 18));
                await bondToken.connect(user3).approve(payRouter.address, powOf(1, 18));

                await payRouter.connect(user2).approveRequester(0, user2.address);
                await payRouter.connect(user3).approveRequester(1, user2.address);

                await expect(payRouter.connect(user2).createRequest([0, 1], [powOf(1, 18), powOf(1, 18)], powOf(1, 18)))
                    .to.emit(payRouter, "RequestCreated")
                    .withArgs(user2.address, 0, [0, 1], [powOf(1, 18), powOf(1, 18)], powOf(1, 18));

                const req = await payRouter.getRequest(0);
                expect(req.requesterFeeBp).to.eq(100);
                expect(req.protocolFeeBp).to.eq(100);

                let route = await payRouter.routes(0);
                expect(route.bond).to.eq(0);
                let route2 = await payRouter.routes(1);
                expect(route2.bond).to.eq(0);

                await expect(payRouter.connect(user2).closeRequest(0)).not.to.be.reverted;

                // bond should still not have been returned
                route = await payRouter.routes(0);
                expect(route.bond).to.eq(0);
                route2 = await payRouter.routes(1);
                expect(route2.bond).to.eq(0);

                await expect(payRouter.connect(user2).markRequestAsPaid(0)).to.emit(payRouter, "BondReturned").withArgs(user2.address, 0, "980000000000000000").to.emit(payRouter, "SourceReturned").withArgs(user2.address, 0, powOf(1, 18));
                await expect(payRouter.connect(user3).markRequestAsPaid(0)).to.emit(payRouter, "BondReturned").withArgs(user3.address, 1, "980000000000000000");

                // bond (minus fees) should have been returned
                route = await payRouter.routes(0);
                expect(route.bond).to.eq("980000000000000000");
                route2 = await payRouter.routes(1);
                expect(route2.bond).to.eq("980000000000000000");

                expect(await payRouter.requestersBalance(user2.address)).to.eq("20000000000000000");
                expect(await payRouter.feeBalanceOf(user2.address)).to.eq("20000000000000000");
                expect(await payRouter.protocolFeeBalance()).to.eq("20000000000000000");
            });
        });
    });

    // test: closeRequest
    describe(".closeRequest", () => {
        it("should revert with msg='UNKNOWN_REQUEST' when routeIds and bonds length are not the same", async () => {
            await expect(payRouter.closeRequest(0)).to.be.revertedWith("PR: UNKNOWN_REQUEST");
        });

        it("should revert with msg='NOT_CREATOR' when sender is not the creator of the request", async () => {
            await payRouter.createOrg("org1");
            await payRouter.connect(user2).createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });

            await payRouter.connect(user2).approveRequester(0, user2.address);

            await expect(payRouter.connect(user2).createRequest([0], [0], 0)).not.to.be.reverted;

            await expect(payRouter.closeRequest(0)).to.be.revertedWith("PR: NOT_CREATOR");
        });

        it("should do nothing when router has not marked request as 'paid'", async () => {
            await payRouter.createOrg("org1");

            await bondToken.transfer(user2.address, 2);
            await bondToken.connect(user2).approve(payRouter.address, 2);

            await payRouter.connect(user2).createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: 1,
                requesters: [],
            });

            await payRouter.connect(user2).approveRequester(0, user2.address);

            await expect(payRouter.connect(user2).createRequest([0], [1], 1)).not.to.be.reverted;

            await expect(payRouter.connect(user2).closeRequest(0)).to.emit(payRouter, "RequestClosed").withArgs(0);

            const route = await payRouter.routes(0);
            expect(route.bond).to.eq(0);

            const req = await payRouter.getRequest(0);
            expect(req.closed).to.be.true;
            expect(req.bonds).to.have.length(1);
            expect(req.bonds[0]).to.eq(1);
            expect(req.sourceAmtLeft).to.eq(1);
            expect(req.paid).to.have.length(1);
            expect(req.paid[0]).to.have.false;

            expect(await bondToken.balanceOf(user2.address)).to.eq(0);
        });

        describe("router=0 marked 'paid', router=1 marked 'paid'", () => {
            it("should return bond and source amount (to first router) when router has marked request as 'paid'", async () => {
                await payRouter.createOrg("org1");

                await bondToken.transfer(user2.address, 2);
                await bondToken.connect(user2).approve(payRouter.address, 2);

                await payRouter.connect(user2).createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: bondToken.address,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    bond: 1,
                    requesters: [],
                });

                await bondToken.transfer(user3.address, 1);
                await bondToken.connect(user3).approve(payRouter.address, 1);

                await payRouter.connect(user3).createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 1,
                    destOrgId: 1,
                    bond: 1,
                    requesters: [],
                });

                await payRouter.connect(user2).approveRequester(0, user2.address);
                await payRouter.connect(user3).approveRequester(1, user2.address);

                await expect(payRouter.connect(user2).createRequest([0, 1], [1, 1], 1)).not.to.be.reverted;

                await expect(payRouter.connect(user2).markRequestAsPaid(0)).not.to.be.reverted;
                await expect(payRouter.connect(user3).markRequestAsPaid(0)).not.to.be.reverted;

                await expect(payRouter.connect(user2).closeRequest(0)).to.emit(payRouter, "BondReturned").withArgs(user2.address, 0, 1).to.emit(payRouter, "BondReturned").withArgs(user3.address, 1, 1).to.emit(payRouter, "SourceReturned").withArgs(user2.address, 0, 1);

                const route = await payRouter.routes(0);
                expect(route.bond).to.eq(1);

                const req = await payRouter.getRequest(0);
                expect(req.closed).to.be.true;
                expect(req.bonds).to.have.length(2);
                expect(req.bonds[0]).to.eq(0);
                expect(req.bonds[1]).to.eq(0);
                expect(req.sourceAmtLeft).to.eq(0);
                expect(req.paid).to.have.length(2);
                expect(req.paid[0]).to.have.true;
                expect(req.paid[1]).to.have.true;

                expect(await bondToken.balanceOf(user2.address)).to.eq(1);
                expect(await bondToken.balanceOf(user3.address)).to.eq(0);
            });

            describe("source is NATIVE", () => {
                it("should return bond and source amount (to first router) when router has marked request as 'paid'", async () => {
                    await payRouter.createOrg("org1");

                    await bondToken.transfer(user2.address, 2);
                    await bondToken.connect(user2).approve(payRouter.address, 2);

                    await payRouter.connect(user2).createRoute({
                        owner: AddressZero,
                        source: SourceType.Native,
                        sourceToken: bondToken.address,
                        sourceOrgId: 0,
                        destOrgId: 1,
                        bond: 1,
                        requesters: [],
                    });

                    await bondToken.transfer(user3.address, 1);
                    await bondToken.connect(user3).approve(payRouter.address, 1);

                    await payRouter.connect(user3).createRoute({
                        owner: AddressZero,
                        source: SourceType.Org,
                        sourceToken: AddressZero,
                        sourceOrgId: 1,
                        destOrgId: 1,
                        bond: 1,
                        requesters: [],
                    });

                    await payRouter.connect(user2).approveRequester(0, user2.address);
                    await payRouter.connect(user3).approveRequester(1, user2.address);

                    await expect(payRouter.connect(user2).createRequest([0, 1], [1, 1], 1, {value: 1})).not.to.be.reverted;

                    await expect(payRouter.connect(user2).markRequestAsPaid(0)).not.to.be.reverted;
                    await expect(payRouter.connect(user3).markRequestAsPaid(0)).not.to.be.reverted;

                    const user2Bal = await user2.getBalance();
                    const tx = await payRouter.connect(user2).closeRequest(0);
                    await expect(tx).to.emit(payRouter, "BondReturned").withArgs(user2.address, 0, 1).to.emit(payRouter, "BondReturned").withArgs(user3.address, 1, 1).to.emit(payRouter, "SourceReturned").withArgs(user2.address, 0, 1);

                    const txReceipt = await tx.wait();
                    const gasUsed = txReceipt.gasUsed.toNumber();
                    const gasFee = toBN(gasUsed).mul(tx.gasPrice as BigNumber);

                    expect((await payRouter.routes(0)).bond).to.eq(1);
                    expect((await payRouter.routes(1)).bond).to.eq(1);

                    const req = await payRouter.getRequest(0);
                    expect(req.closed).to.be.true;
                    expect(req.bonds).to.have.length(2);
                    expect(req.bonds[0]).to.eq(0);
                    expect(req.bonds[1]).to.eq(0);
                    expect(req.sourceAmtLeft).to.eq(0);
                    expect(req.paid).to.have.length(2);
                    expect(req.paid[0]).to.have.true;
                    expect(req.paid[1]).to.have.true;

                    expect(await user2.getBalance()).to.eq(user2Bal.add(1).sub(gasFee));
                    expect(await bondToken.balanceOf(user3.address)).to.eq(0);
                });
            });
        });

        describe("router=0 marked 'paid', router=1 not marked 'paid'", () => {
            it("should return bond and source amount to router=0, skip router=1", async () => {
                await payRouter.createOrg("org1");

                await bondToken.transfer(user2.address, 2);
                await bondToken.connect(user2).approve(payRouter.address, 2);

                await payRouter.connect(user2).createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: bondToken.address,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    bond: 1,
                    requesters: [],
                });

                await bondToken.transfer(user3.address, 1);
                await bondToken.connect(user3).approve(payRouter.address, 1);

                await payRouter.connect(user3).createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 1,
                    destOrgId: 1,
                    bond: 1,
                    requesters: [],
                });

                await payRouter.connect(user2).approveRequester(0, user2.address);
                await payRouter.connect(user3).approveRequester(1, user2.address);

                await expect(payRouter.connect(user2).createRequest([0, 1], [1, 1], 1)).not.to.be.reverted;

                await expect(payRouter.connect(user2).markRequestAsPaid(0)).not.to.be.reverted;

                await expect(payRouter.connect(user2).closeRequest(0)).not.to.be.reverted;

                const route = await payRouter.routes(0);
                expect(route.bond).to.eq(1);

                const req = await payRouter.getRequest(0);
                expect(req.closed).to.be.true;
                expect(req.bonds).to.have.length(2);
                expect(req.bonds[0]).to.eq(0);
                expect(req.bonds[1]).to.eq(1);
                expect(req.sourceAmtLeft).to.eq(0);
                expect(req.paid).to.have.length(2);
                expect(req.paid[0]).to.have.true;
                expect(req.paid[1]).to.have.false;

                expect(await bondToken.balanceOf(user2.address)).to.eq(1);
                expect(await bondToken.balanceOf(user3.address)).to.eq(0);
            });
        });

        describe("router=0 not marked 'paid', router=1 marked 'paid'", () => {
            it("should return bond and source amount to router=0, skip router=1", async () => {
                await payRouter.createOrg("org1");

                await bondToken.transfer(user2.address, 2);
                await bondToken.connect(user2).approve(payRouter.address, 2);

                await payRouter.connect(user2).createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: bondToken.address,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    bond: 1,
                    requesters: [],
                });

                await bondToken.transfer(user3.address, 1);
                await bondToken.connect(user3).approve(payRouter.address, 1);

                await payRouter.connect(user3).createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 1,
                    destOrgId: 1,
                    bond: 1,
                    requesters: [],
                });

                await payRouter.connect(user2).approveRequester(0, user2.address);
                await payRouter.connect(user3).approveRequester(1, user2.address);

                await expect(payRouter.connect(user2).createRequest([0, 1], [1, 1], 1)).not.to.be.reverted;

                await expect(payRouter.connect(user3).markRequestAsPaid(0)).not.to.be.reverted;

                await expect(payRouter.connect(user2).closeRequest(0)).to.emit(payRouter, "BondReturned").withArgs(user3.address, 1, 1);

                // re-call. It should not emit BondReturned since it was already done by last call
                await expect(payRouter.connect(user2).closeRequest(0)).not.to.emit(payRouter, "BondReturned").withArgs(user3.address, 1, 1);

                expect((await payRouter.routes(0)).bond).to.eq(0);
                expect((await payRouter.routes(1)).bond).to.eq(1);

                const req = await payRouter.getRequest(0);
                expect(req.closed).to.be.true;
                expect(req.bonds).to.have.length(2);
                expect(req.bonds[0]).to.eq(1);
                expect(req.bonds[1]).to.eq(0);
                expect(req.sourceAmtLeft).to.eq(1);
                expect(req.paid).to.have.length(2);
                expect(req.paid[0]).to.have.false;
                expect(req.paid[1]).to.have.true;

                expect(await bondToken.balanceOf(user2.address)).to.eq(0);
                expect(await bondToken.balanceOf(user3.address)).to.eq(0);
            });
        });

        describe("request and protocol fees are non-zero", () => {
            it("should return bond and source amount (to first router) when router has marked request as 'paid'", async () => {
                await payRouter.setProtocolFeeBp(100);
                await payRouter.connect(user2).setRequesterFeeBp(100);

                await payRouter.createOrg("org1");
                await bondToken.transfer(user2.address, powOf(2, 18));
                await bondToken.connect(user2).approve(payRouter.address, powOf(2, 18));

                await payRouter.connect(user2).createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: bondToken.address,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    bond: powOf(1, 18),
                    requesters: [],
                });

                await bondToken.transfer(user3.address, powOf(1, 18));
                await bondToken.connect(user3).approve(payRouter.address, powOf(1, 18));

                await payRouter.connect(user3).createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 1,
                    destOrgId: 1,
                    bond: powOf(1, 18),
                    requesters: [],
                });

                await payRouter.connect(user2).approveRequester(0, user2.address);
                await payRouter.connect(user3).approveRequester(1, user2.address);

                await expect(payRouter.connect(user2).createRequest([0, 1], [powOf(1, 18), powOf(1, 18)], powOf(1, 18))).not.to.be.reverted;

                await expect(payRouter.connect(user2).markRequestAsPaid(0)).not.to.be.reverted;
                await expect(payRouter.connect(user3).markRequestAsPaid(0)).not.to.be.reverted;

                await expect(payRouter.connect(user2).closeRequest(0))
                    .to.emit(payRouter, "BondReturned")
                    .withArgs(user2.address, 0, "980000000000000000")
                    .to.emit(payRouter, "BondReturned")
                    .withArgs(user3.address, 1, "980000000000000000")
                    .to.emit(payRouter, "SourceReturned")
                    .withArgs(user2.address, 0, powOf(1, 18));

                // bond (minus fees) should have been returned
                const route = await payRouter.routes(0);
                expect(route.bond).to.eq("980000000000000000");
                const route2 = await payRouter.routes(1);
                expect(route2.bond).to.eq("980000000000000000");

                expect(await payRouter.requestersBalance(user2.address)).to.eq("20000000000000000");
                expect(await payRouter.protocolFeeBalance()).to.eq("20000000000000000");
            });
        });

        describe("request set a value unlock duration", () => {
            it("should not return bond and source amount until value unlock duration is over", async () => {
                await payRouter.createOrg("org1");
                await bondToken.transfer(user2.address, powOf(2, 18));
                await bondToken.connect(user2).approve(payRouter.address, powOf(2, 18));

                await payRouter.connect(user2).createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: bondToken.address,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    bond: powOf(1, 18),
                    requesters: [],
                });

                await bondToken.transfer(user3.address, powOf(1, 18));
                await bondToken.connect(user3).approve(payRouter.address, powOf(1, 18));

                await payRouter.connect(user3).createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 1,
                    destOrgId: 1,
                    bond: powOf(1, 18),
                    requesters: [],
                });

                await payRouter.connect(user2).approveRequester(0, user2.address);
                await payRouter.connect(user3).approveRequester(1, user2.address);

                await payRouter.connect(user2).setRequesterValueLockDuration(100);
                await expect(payRouter.connect(user2).createRequest([0, 1], [powOf(1, 18), powOf(1, 18)], powOf(1, 18))).not.to.be.reverted;

                await expect(payRouter.connect(user2).markRequestAsPaid(0)).not.to.be.reverted;
                await expect(payRouter.connect(user3).markRequestAsPaid(0)).not.to.be.reverted;

                await expect(payRouter.connect(user2).closeRequest(0)).not.to.emit(payRouter, "BondReturned").not.to.emit(payRouter, "SourceReturned");

                let route = await payRouter.routes(0);
                expect(route.bond).to.eq(0);
                let route2 = await payRouter.routes(1);
                expect(route2.bond).to.eq(0);

                await advanceBlockTime(100);
                await expect(payRouter.connect(user2).markRequestAsPaid(0)).not.to.be.reverted;
                await expect(payRouter.connect(user3).markRequestAsPaid(0)).not.to.be.reverted;

                route = await payRouter.routes(0);
                expect(route.bond).to.eq(powOf(1, 18));
                route2 = await payRouter.routes(1);
                expect(route2.bond).to.eq(powOf(1, 18));
            });
        });
    });

    describe("withdrawRequesterFee", () => {
        beforeEach(async () => {
            await payRouter.setProtocolFeeBp(100);
            await payRouter.connect(user2).setRequesterFeeBp(100);

            await payRouter.createOrg("org1");
            await bondToken.transfer(user2.address, powOf(2, 18));
            await bondToken.connect(user2).approve(payRouter.address, powOf(2, 18));

            await payRouter.connect(user2).createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: powOf(1, 18),
                requesters: [],
            });

            await bondToken.transfer(user3.address, powOf(1, 18));
            await bondToken.connect(user3).approve(payRouter.address, powOf(1, 18));

            await payRouter.connect(user3).createRoute({
                owner: AddressZero,
                source: SourceType.Org,
                sourceToken: AddressZero,
                sourceOrgId: 1,
                destOrgId: 1,
                bond: powOf(1, 18),
                requesters: [],
            });

            await payRouter.connect(user2).approveRequester(0, user2.address);
            await payRouter.connect(user3).approveRequester(1, user2.address);

            await expect(payRouter.connect(user2).createRequest([0, 1], [powOf(1, 18), powOf(1, 18)], powOf(1, 18))).not.to.be.reverted;

            await expect(payRouter.connect(user2).markRequestAsPaid(0)).not.to.be.reverted;
            await expect(payRouter.connect(user3).markRequestAsPaid(0)).not.to.be.reverted;

            await expect(payRouter.connect(user2).closeRequest(0)).not.to.be.reverted;

            expect(await payRouter.requestersBalance(user2.address)).to.eq("20000000000000000");
            expect(await payRouter.protocolFeeBalance()).to.eq("20000000000000000");
        });

        it("should withdraw to requester's beneficiary", async () => {
            await payRouter.connect(user2).withdrawRequesterFee(user4.address);
            expect(await payRouter.requestersBalance(user2.address)).to.eq(0);
            expect(await bondToken.balanceOf(user4.address)).to.eq("20000000000000000");
        });

        it("should withdraw to requester if beneficiary is zero address", async () => {
            const curBal = await bondToken.balanceOf(user2.address);
            await payRouter.connect(user2).withdrawRequesterFee(AddressZero);
            expect(await payRouter.requestersBalance(user2.address)).to.eq(0);
            expect(await bondToken.balanceOf(user2.address)).to.eq(curBal.add("20000000000000000"));
        });
    });

    describe("withdrawProtocolFee", () => {
        beforeEach(async () => {
            await payRouter.setProtocolFeeBp(100);
            await payRouter.connect(user2).setRequesterFeeBp(100);

            await payRouter.createOrg("org1");
            await bondToken.transfer(user2.address, powOf(2, 18));
            await bondToken.connect(user2).approve(payRouter.address, powOf(2, 18));

            await payRouter.connect(user2).createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: powOf(1, 18),
                requesters: [],
            });

            await bondToken.transfer(user3.address, powOf(1, 18));
            await bondToken.connect(user3).approve(payRouter.address, powOf(1, 18));

            await payRouter.connect(user3).createRoute({
                owner: AddressZero,
                source: SourceType.Org,
                sourceToken: AddressZero,
                sourceOrgId: 1,
                destOrgId: 1,
                bond: powOf(1, 18),
                requesters: [],
            });

            await payRouter.connect(user2).approveRequester(0, user2.address);
            await payRouter.connect(user3).approveRequester(1, user2.address);

            await expect(payRouter.connect(user2).createRequest([0, 1], [powOf(1, 18), powOf(1, 18)], powOf(1, 18))).not.to.be.reverted;

            await expect(payRouter.connect(user2).markRequestAsPaid(0)).not.to.be.reverted;
            await expect(payRouter.connect(user3).markRequestAsPaid(0)).not.to.be.reverted;

            await expect(payRouter.connect(user2).closeRequest(0)).not.to.be.reverted;

            expect(await payRouter.requestersBalance(user2.address)).to.eq("20000000000000000");
            expect(await payRouter.protocolFeeBalance()).to.eq("20000000000000000");
        });

        it("should revert if caller is not owner", async () => {
            await expect(payRouter.connect(user2).withdrawProtocolFee(user4.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should withdraw to protocol owner's beneficiary", async () => {
            await payRouter.withdrawProtocolFee(user4.address);
            expect(await payRouter.protocolFeeBalance()).to.eq(0);
            expect(await bondToken.balanceOf(user4.address)).to.eq("20000000000000000");
        });

        it("should withdraw to protocol owner if beneficiary is zero address", async () => {
            const curBal = await bondToken.balanceOf(deployer.address);
            await payRouter.withdrawProtocolFee(AddressZero);
            expect(await payRouter.protocolFeeBalance()).to.eq(0);
            expect(await bondToken.balanceOf(deployer.address)).to.eq(curBal.add("20000000000000000"));
        });
    });

    describe("cancelRequest", () => {
        beforeEach(async () => {
            await payRouter.connect(user2).setRequesterFeeBp(100);
            await payRouter.setProtocolFeeBp(100);

            await payRouter.createOrg("org1");

            await bondToken.transfer(user2.address, powOf(2, 18));
            await bondToken.connect(user2).approve(payRouter.address, powOf(2, 18));
            await payRouter.connect(user2).createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: powOf(1, 18),
                requesters: [],
            });

            await bondToken.transfer(user3.address, powOf(1, 18));
            await bondToken.connect(user3).approve(payRouter.address, powOf(1, 18));
            await payRouter.connect(user3).createRoute({
                owner: AddressZero,
                source: SourceType.Org,
                sourceToken: AddressZero,
                sourceOrgId: 1,
                destOrgId: 1,
                bond: powOf(1, 18),
                requesters: [],
            });

            await payRouter.connect(user2).approveRequester(0, user2.address);
            await payRouter.connect(user3).approveRequester(1, user2.address);

            await expect(payRouter.connect(user2).createRequest([0, 1], [powOf(1, 18), powOf(1, 18)], powOf(1, 18))).not.to.be.reverted;
        });

        // revert if request is unknown
        it("should revert if request is unknown", async () => {
            await expect(payRouter.connect(user2).cancelRequest(1)).to.be.revertedWith("PR: UNKNOWN_REQUEST");
        });

        it("should revert if sender is not request creator", async () => {
            await expect(payRouter.connect(user3).cancelRequest(0)).to.be.revertedWith("PR: NOT_CREATOR");
        });

        it("should cancel request; return bonds to route owners; return source amount to request creator; not deduct fees", async () => {
            const user2Bal = await bondToken.balanceOf(user2.address);

            await expect(payRouter.connect(user2).cancelRequest(0)).to.emit(payRouter, "RequestCancelled").withArgs(0);

            const req = await payRouter.getRequest(0);
            expect(req.closed).to.be.true;
            expect(req.cancelled).to.be.true;
            expect(req.bonds).to.have.length(2);
            expect(req.bonds[0]).to.eq(0);
            expect(req.bonds[1]).to.eq(0);
            expect(req.sourceAmtLeft).to.eq(0);
            expect(req.paid).to.have.length(2);
            expect(req.paid[0]).to.have.false;
            expect(req.paid[1]).to.have.false;

            const route = await payRouter.routes(0);
            expect(route.bond).to.eq(powOf(1, 18));
            const route2 = await payRouter.routes(1);
            expect(route2.bond).to.eq(powOf(1, 18));

            expect(await bondToken.balanceOf(user2.address)).to.eq(user2Bal.add(powOf(1, 18)));
        });

        it("should revert if request is already cancelled", async () => {
            await expect(payRouter.connect(user2).cancelRequest(0)).not.to.be.reverted;
            await expect(payRouter.connect(user2).cancelRequest(0)).to.be.revertedWith("PR: ALREADY_CANCELLED");
        });

        it("should revert if request is already closed", async () => {
            await expect(payRouter.connect(user2).closeRequest(0)).not.to.be.reverted;
            await expect(payRouter.connect(user2).cancelRequest(0)).to.be.revertedWith("PR: ALREADY_CLOSED");
        });

        it("should revert with ORG_SOURCE_PAID when request is org sourced and org source is paid", async () => {
            await payRouter.connect(user2).createRoute({
                owner: AddressZero,
                source: SourceType.Org,
                sourceToken: AddressZero,
                sourceOrgId: 1,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });
            await payRouter.connect(user2).approveRequester(2, user2.address);
            await expect(payRouter.connect(user2).createRequest([2], [0], 0)).not.to.be.reverted;
            await expect(payRouter.connect(user2).markOrgSourceAsPaid(1)).not.to.be.reverted;
            await expect(payRouter.connect(user2).cancelRequest(1)).to.be.revertedWith("PR: ORG_SOURCE_PAID");
        });

        it("should revert if request has been marked as paid by a routers", async () => {
            await payRouter.connect(user3).markRequestAsPaid(0);
            await expect(payRouter.connect(user2).cancelRequest(0)).to.be.revertedWith("PR: ROUTER_PAID");
        });
    });

    describe("markOrgSourceAsPaid", () => {
        beforeEach(async () => {
            await payRouter.createOrg("org1");
            await payRouter.connect(user2).createRoute({
                owner: AddressZero,
                source: SourceType.Org,
                sourceToken: AddressZero,
                sourceOrgId: 1,
                destOrgId: 1,
                bond: 0,
                requesters: [],
            });
        });

        it("should revert if request is unknown", async () => {
            await expect(payRouter.connect(user2).markOrgSourceAsPaid(1)).to.be.revertedWith("PR: UNKNOWN_REQUEST");
        });

        it("should revert if sender is not request creator", async () => {
            await payRouter.connect(user2).approveRequester(0, user2.address);
            await expect(payRouter.connect(user2).createRequest([0], [0], 0)).not.to.be.reverted;
            await expect(payRouter.connect(user3).markOrgSourceAsPaid(0)).to.be.revertedWith("PR: NOT_CREATOR");
        });

        it("should mark request as paid", async () => {
            await payRouter.connect(user2).approveRequester(0, user2.address);
            await expect(payRouter.connect(user2).createRequest([0], [0], 0)).not.to.be.reverted;
            await expect(payRouter.connect(user2).markOrgSourceAsPaid(0)).to.emit(payRouter, "OrgSourcePaid").withArgs(0);
            const req = await payRouter.getRequest(0);
            expect(req.orgSrcPaid).to.be.true;
        });
    });

    describe(".transferRequestBond", () => {
        beforeEach(async () => {
            await payRouter.connect(user2).setRequesterFeeBp(100);
            await payRouter.setProtocolFeeBp(100);

            await payRouter.createOrg("org1");

            await bondToken.transfer(user2.address, powOf(2, 18));
            await bondToken.connect(user2).approve(payRouter.address, powOf(2, 18));
            await payRouter.connect(user2).createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: powOf(1, 18),
                requesters: [],
            });

            await bondToken.transfer(user3.address, powOf(1, 18));
            await bondToken.connect(user3).approve(payRouter.address, powOf(1, 18));
            await payRouter.connect(user3).createRoute({
                owner: AddressZero,
                source: SourceType.Org,
                sourceToken: AddressZero,
                sourceOrgId: 1,
                destOrgId: 1,
                bond: powOf(1, 18),
                requesters: [],
            });

            await payRouter.connect(user2).approveRequester(0, user2.address);
            await payRouter.connect(user3).approveRequester(1, user2.address);

            await expect(payRouter.connect(user2).createRequest([0, 1], [powOf(1, 18), powOf(1, 18)], powOf(1, 18))).not.to.be.reverted;
        });

        it("should revert if request is unknown", async () => {
            await expect(payRouter.connect(user2).transferRequestBond(1, 0, 0, user2.address)).to.be.revertedWith("PR: UNKNOWN_REQUEST");
        });

        it("should revert if request is not created by sender", async () => {
            await expect(payRouter.transferRequestBond(0, 0, 0, user2.address)).to.be.revertedWith("PR: NOT_CREATOR");
        });

        it("should revert if route is unknown", async () => {
            await expect(payRouter.connect(user2).transferRequestBond(0, 2, 0, user2.address)).to.be.revertedWith("PR: UNKNOWN_ROUTE");
        });

        it("should revert if amount is greater than bond balance", async () => {
            await expect(payRouter.connect(user2).transferRequestBond(0, 0, powOf(2, 18), user2.address)).to.be.revertedWith("PR: INSUF_BALANCE");
            await expect(payRouter.connect(user2).transferRequestBond(0, 1, powOf(2, 18), user2.address)).to.be.revertedWith("PR: INSUF_BALANCE");
        });

        it("should transfer all bond to specific address", async () => {
            await expect(payRouter.connect(user2).transferRequestBond(0, 0, powOf(1, 18), user3.address))
                .to.emit(payRouter, "BondTransferred")
                .withArgs(0, 0, powOf(1, 18), user3.address);
            const req = await payRouter.getRequest(0);
            expect(req.bonds[0]).to.eq(0);
            expect(req.bonds[1]).to.eq(powOf(1, 18));
            expect(await bondToken.balanceOf(user3.address)).to.eq(powOf(1, 18));
        });

        it("should transfer some bond to specific address", async () => {
            await expect(payRouter.connect(user2).transferRequestBond(0, 0, powOf(0.5, 18), user3.address))
                .to.emit(payRouter, "BondTransferred")
                .withArgs(0, 0, powOf(0.5, 18), user3.address);
            const req = await payRouter.getRequest(0);
            expect(req.bonds[0]).to.eq(powOf(0.5, 18));
            expect(req.bonds[1]).to.eq(powOf(1, 18));
            expect(await bondToken.balanceOf(user3.address)).to.eq(powOf(0.5, 18));

            //  Return bond to route owner. Expected bond is 0.49 (after fees)
            await payRouter.connect(user2).markRequestAsPaid(0);
            await payRouter.connect(user2).closeRequest(0);
            const route = await payRouter.routes(0);
            expect(route.bond).to.eq(powOf(0.49, 18));
        });
    });

    describe("transferRequestSource", () => {
        beforeEach(async () => {
            await payRouter.connect(user2).setRequesterFeeBp(100);
            await payRouter.setProtocolFeeBp(100);

            await payRouter.createOrg("org1");

            await bondToken.transfer(user2.address, powOf(2, 18));
            await bondToken.connect(user2).approve(payRouter.address, powOf(2, 18));
            await payRouter.connect(user2).createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                bond: powOf(1, 18),
                requesters: [],
            });

            await bondToken.transfer(user3.address, powOf(1, 18));
            await bondToken.connect(user3).approve(payRouter.address, powOf(1, 18));
            await payRouter.connect(user3).createRoute({
                owner: AddressZero,
                source: SourceType.Org,
                sourceToken: AddressZero,
                sourceOrgId: 1,
                destOrgId: 1,
                bond: powOf(1, 18),
                requesters: [],
            });

            await payRouter.connect(user2).approveRequester(0, user2.address);
            await payRouter.connect(user3).approveRequester(1, user2.address);

            await expect(payRouter.connect(user2).createRequest([0, 1], [powOf(1, 18), powOf(1, 18)], powOf(1, 18))).not.to.be.reverted;
        });

        it("should revert if request is unknown", async () => {
            await expect(payRouter.connect(user2).transferRequestSource(1, 0, user2.address)).to.be.revertedWith("PR: UNKNOWN_REQUEST");
        });

        it("should revert if request is not created by sender", async () => {
            await expect(payRouter.transferRequestSource(0, 0, user2.address)).to.be.revertedWith("PR: NOT_CREATOR");
        });

        it("should revert if amount is greater than source token balance", async () => {
            await expect(payRouter.connect(user2).transferRequestSource(0, powOf(2, 18), user2.address)).to.be.revertedWith("PR: INSUF_BALANCE");
        });

        it("should transfer all source token to specific address", async () => {
            await expect(payRouter.connect(user2).transferRequestSource(0, powOf(1, 18), user3.address))
                .to.emit(payRouter, "SourceTransferred")
                .withArgs(0, powOf(1, 18), user3.address);
            const req = await payRouter.getRequest(0);
            expect(req.sourceAmtLeft).to.eq(0);
            expect(await bondToken.balanceOf(user3.address)).to.eq(powOf(1, 18));
        });

        it("should transfer some source token to specific address", async () => {
            await expect(payRouter.connect(user2).transferRequestSource(0, powOf(0.5, 18), user3.address))
                .to.emit(payRouter, "SourceTransferred")
                .withArgs(0, powOf(0.5, 18), user3.address);
            const req = await payRouter.getRequest(0);
            expect(req.sourceAmtLeft).to.eq(powOf(0.5, 18));
            expect(await bondToken.balanceOf(user3.address)).to.eq(powOf(0.5, 18));

            const curBalUser2 = await bondToken.balanceOf(user2.address);

            //  Return remaining source token to route owner. Expected source token to return is 1
            await payRouter.connect(user2).markRequestAsPaid(0);
            await expect(payRouter.connect(user2).closeRequest(0)).to.emit(payRouter, "SourceReturned").withArgs(user2.address, 0, powOf(1, 18));
            const route = await payRouter.routes(0);
            expect(route.source).to.eq(0);
            expect(await bondToken.balanceOf(user2.address)).to.eq(curBalUser2.add(powOf(1, 18)));
        });
    });
});
