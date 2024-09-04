import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {ethers} from "hardhat";
import {PayRouter, TOKEN} from "../typechain-types";
import {AddressZero, toBN} from "../utils/utils";

enum SourceType {
    Token,
    Native,
    Org,
}

describe.only("PayRouter", function () {
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

    describe(".approveRequester", () => {
        it("should revert with reason=UNKNOWN_ROUTE when route does not exist", async () => {
            await expect(payRouter.connect(user2).approveRequester(1, user2.address)).to.be.revertedWith("PAYROUTER: UNKNOWN_ROUTE");
        });

        it("should revert with reason=NOT_ROUTE_OWNER when sender is not the owner of the route", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Org,
                sourceToken: AddressZero,
                sourceOrgId: 1,
                destOrgId: 1,
                feeBp: 0,
                bond: 0,
            });
            await expect(payRouter.connect(user2).approveRequester(0, user2.address)).to.be.revertedWith("PAYROUTER: NOT_ROUTE_OWNER");
        });

        it("should successfully approve a requester", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Org,
                sourceToken: AddressZero,
                sourceOrgId: 1,
                destOrgId: 1,
                feeBp: 0,
                bond: 0,
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
                feeBp: 0,
                bond: 0,
            });
        }

        it("should revert with reason=UNKNOWN_ROUTE when route does not exist", async () => {
            await expect(payRouter.connect(user2).unapproveRequester(1, user2.address)).to.be.revertedWith("PAYROUTER: UNKNOWN_ROUTE");
        });

        it("should revert with reason=NOT_ROUTE_OWNER when sender is not the owner of the route", async () => {
            await createRoute();
            await expect(payRouter.connect(user2).unapproveRequester(0, user2.address)).to.be.revertedWith("PAYROUTER: NOT_ROUTE_OWNER");
        });

        it("should revert with reason=NOT_APPROVED when requester was not previously approved", async () => {
            await createRoute();
            await expect(payRouter.unapproveRequester(0, user2.address)).to.be.revertedWith("PAYROUTER: NOT_APPROVED");
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
    });

    describe(".createRoute", () => {
        it("should revert when source is not token, native or org", async () => {
            await expect(
                payRouter.createRoute({
                    owner: AddressZero,
                    source: 4,
                    sourceToken: AddressZero,
                    sourceOrgId: 0,
                    destOrgId: 0,
                    feeBp: 0,
                    bond: 0,
                }),
            ).to.be.revertedWith("function was called with incorrect parameters");
        });

        it("should revert when source is token and source token is zero", async () => {
            await expect(
                payRouter.createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: AddressZero,
                    sourceOrgId: 0,
                    destOrgId: 0,
                    feeBp: 0,
                    bond: 0,
                }),
            ).to.be.revertedWith("PAYROUTER: SRC_TOKEN_ZERO");
        });

        it("should revert when source is Token and source token is zero", async () => {
            await expect(
                payRouter.createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: AddressZero,
                    sourceOrgId: 0,
                    destOrgId: 0,
                    feeBp: 0,
                    bond: 0,
                }),
            ).to.be.revertedWith("PAYROUTER: SRC_TOKEN_ZERO");
        });

        it("should revert when source is Org and source org ID is zero", async () => {
            await expect(
                payRouter.createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 0,
                    destOrgId: 0,
                    feeBp: 0,
                    bond: 0,
                }),
            ).to.be.revertedWith("PAYROUTER: SRC_ORG_ZERO");
        });

        it("should revert when source is Org and source org ID is unknown", async () => {
            await expect(
                payRouter.createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 1,
                    destOrgId: 0,
                    feeBp: 0,
                    bond: 0,
                }),
            ).to.be.revertedWith("PAYROUTER: SRC_ORG_UNKNOWN");
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
                    feeBp: 0,
                    bond: 0,
                }),
            ).to.be.revertedWith("PAYROUTER: DEST_ORG_UNKNOWN");
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
                    feeBp: 0,
                    bond: 0,
                }),
            ).to.be.revertedWith("PAYROUTER: DST_ORG_ZERO");
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
                    feeBp: 0,
                    bond: 0,
                }),
            ).not.to.be.revertedWith("PAYROUTER: DST_ORG_ZERO");
        });

        it("should revert when fee basis point is too high", async () => {
            await payRouter.createOrg("org1");
            await expect(
                payRouter.createRoute({
                    owner: AddressZero,
                    source: SourceType.Org,
                    sourceToken: AddressZero,
                    sourceOrgId: 1,
                    destOrgId: 1,
                    feeBp: 10001,
                    bond: 0,
                }),
            ).to.be.revertedWith("PAYROUTER: FEE_BP_TOO_HIGH");
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
                    feeBp: 10,
                    bond: 0,
                }),
            )
                .to.emit(payRouter, "RouteCreated")
                .withArgs(0, deployer.address, SourceType.Org, AddressZero, 1, 1, 10, 0);
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
                        feeBp: 10,
                        bond: 100,
                    }),
                )
                    .to.emit(payRouter, "RouteCreated")
                    .withArgs(0, deployer.address, SourceType.Org, AddressZero, 1, 1, 10, 100);
            });
        });
    });

    describe(".depositBond", () => {
        it("should revert when route is unknown", async () => {
            await expect(payRouter.connect(user2).depositBond(0, 1)).to.be.revertedWith("PAYROUTER: UNKNOWN_ROUTE");
        });

        it("should revert when sender is not owner of route", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                feeBp: 0,
                bond: 0,
            });
            await expect(payRouter.connect(user2).depositBond(0, 1)).to.be.revertedWith("PAYROUTER: NOT_ROUTE_OWNER");
        });

        it("should revert when bond token balance is insufficient", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                feeBp: 0,
                bond: 0,
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
                feeBp: 0,
                bond: 0,
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
            await expect(payRouter.connect(user2).withdrawBond(0, 1)).to.be.revertedWith("PAYROUTER: UNKNOWN_ROUTE");
        });

        it("should revert with reason=NOT_ROUTE_OWNER when sender is not route owner", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                feeBp: 0,
                bond: 0,
            });
            await expect(payRouter.connect(user2).withdrawBond(0, 1)).to.be.revertedWith("PAYROUTER: NOT_ROUTE_OWNER");
        });

        it("should revert with reason=INSUFFICIENT_BALANCE when bond token balance is insufficient", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                feeBp: 0,
                bond: 0,
            });
            await expect(payRouter.withdrawBond(0, 1)).to.be.revertedWith("PAYROUTER: INSUFFICIENT_BALANCE");
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
                feeBp: 0,
                bond: 1,
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
        it("should revert with msg='MISMATCHED_IDS_BONDS' when routeIds and bonds length are not the same", async () => {
            await expect(payRouter.createRequest([1, 2], [100], 100)).to.be.revertedWith("PAYROUTER: MISMATCHED_IDS_BONDS");
            await expect(payRouter.createRequest([1], [100, 200], 100)).to.be.revertedWith("PAYROUTER: MISMATCHED_IDS_BONDS");
        });

        it("should revert with msg='UNKNOWN_ROUTE' when route does not exist", async () => {
            await expect(payRouter.createRequest([1], [100], 100)).to.be.revertedWith("PAYROUTER: UNKNOWN_ROUTE");
        });

        it("should revert with msg='X' when when sender is not an approved requester", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                feeBp: 0,
                bond: 0,
            });
            await expect(payRouter.connect(user2).createRequest([0], [1], 1)).to.be.revertedWith("PAYROUTER: NOT_APPROVED_REQUESTER");
        });

        it("should revert with msg='INSUFFICIENT_BOND_BALANCE' when bond balance is insufficient", async () => {
            await payRouter.createOrg("org1");
            await payRouter.createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                feeBp: 0,
                bond: 0,
            });
            await payRouter.approveRequester(0, user2.address);
            await expect(payRouter.connect(user2).createRequest([0], [1], 1)).to.be.revertedWith("PAYROUTER: INSUFFICIENT_BOND_BALANCE");
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
                    feeBp: 0,
                    bond: 0,
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
                    feeBp: 0,
                    bond: 0,
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
                expect(req.srcTokenAmt).to.eq(1);
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
                    feeBp: 0,
                    bond: 0,
                });

                await bondToken.transfer(user2.address, 1);
                await bondToken.connect(user2).approve(payRouter.address, 1);
                await payRouter.connect(user2).depositBond(0, 1);
                expect((await payRouter.routes(0)).bond).to.eq(1);

                await payRouter.connect(user2).approveRequester(0, user2.address);

                await expect(payRouter.connect(user2).createRequest([0], [1], 1)).to.be.revertedWith("PAYROUTER: INSUFFICIENT_MSG_VALUE");
                await expect(payRouter.connect(user2).createRequest([0], [1], 1, {value: 2})).to.be.revertedWith("PAYROUTER: INSUFFICIENT_MSG_VALUE");
            });

            it("should successfully create request", async () => {
                await payRouter.createOrg("org1");
                await payRouter.connect(user2).createRoute({
                    owner: AddressZero,
                    source: SourceType.Native,
                    sourceToken: AddressZero,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    feeBp: 0,
                    bond: 0,
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
                expect(req.srcTokenAmt).to.eq(1);
            });
        });
    });

    // test: markRequestAsPaid
    describe("markRequestAsPaid", () => {
        it("should revert with msg='UNKNOWN_REQUEST' when routeIds and bonds length are not the same", async () => {
            await expect(payRouter.markRequestAsPaid(0)).to.be.revertedWith("PAYROUTER: UNKNOWN_REQUEST");
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
                    feeBp: 0,
                    bond: 0,
                });

                await payRouter.connect(user3).createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: bondToken.address,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    feeBp: 0,
                    bond: 0,
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

                expect((await payRouter.routes(0)).bond).to.eq(0);
                expect((await payRouter.routes(1)).bond).to.eq(0);
            });
        });
    });

    // test: closeRequest
    describe("closeRequest", () => {
        it("should revert with msg='UNKNOWN_REQUEST' when routeIds and bonds length are not the same", async () => {
            await expect(payRouter.closeRequest(0)).to.be.revertedWith("PAYROUTER: UNKNOWN_REQUEST");
        });

        it("should revert with msg='NOT_CREATOR' when sender is not the creator of the request", async () => {
            await payRouter.createOrg("org1");
            await payRouter.connect(user2).createRoute({
                owner: AddressZero,
                source: SourceType.Token,
                sourceToken: bondToken.address,
                sourceOrgId: 0,
                destOrgId: 1,
                feeBp: 0,
                bond: 0,
            });

            await payRouter.connect(user2).approveRequester(0, user2.address);

            await expect(payRouter.connect(user2).createRequest([0], [0], 0)).not.to.be.reverted;

            await expect(payRouter.closeRequest(0)).to.be.revertedWith("PAYROUTER: NOT_CREATOR");
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
                feeBp: 0,
                bond: 1,
            });

            await payRouter.connect(user2).approveRequester(0, user2.address);

            await expect(payRouter.connect(user2).createRequest([0], [1], 1)).not.to.be.reverted;

            await expect(payRouter.connect(user2).closeRequest(0)).not.to.be.reverted;

            const route = await payRouter.routes(0);
            expect(route.bond).to.eq(0);

            const req = await payRouter.getRequest(0);
            expect(req.closed).to.be.true;
            expect(req.bonds).to.have.length(1);
            expect(req.bonds[0]).to.eq(1);
            expect(req.sourceReturned).to.be.false;
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
                    feeBp: 0,
                    bond: 1,
                });

                await bondToken.transfer(user3.address, 1);
                await bondToken.connect(user3).approve(payRouter.address, 1);

                await payRouter.connect(user3).createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: bondToken.address,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    feeBp: 0,
                    bond: 1,
                });

                await payRouter.connect(user2).approveRequester(0, user2.address);
                await payRouter.connect(user3).approveRequester(1, user2.address);

                await expect(payRouter.connect(user2).createRequest([0, 1], [1, 1], 1)).not.to.be.reverted;

                await expect(payRouter.connect(user2).markRequestAsPaid(0)).not.to.be.reverted;
                await expect(payRouter.connect(user3).markRequestAsPaid(0)).not.to.be.reverted;

                await expect(payRouter.connect(user2).closeRequest(0)).to.emit(payRouter, "BondReturned").withArgs(user2.address, 0, 1).to.emit(payRouter, "BondReturned").withArgs(user3.address, 1, 1).to.emit(payRouter, "SourceAmountReturned").withArgs(user2.address, 0, 1);

                const route = await payRouter.routes(0);
                expect(route.bond).to.eq(1);

                const req = await payRouter.getRequest(0);
                expect(req.closed).to.be.true;
                expect(req.bonds).to.have.length(2);
                expect(req.bonds[0]).to.eq(0);
                expect(req.bonds[1]).to.eq(0);
                expect(req.sourceReturned).to.be.true;
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
                        feeBp: 0,
                        bond: 1,
                    });

                    await bondToken.transfer(user3.address, 1);
                    await bondToken.connect(user3).approve(payRouter.address, 1);

                    await payRouter.connect(user3).createRoute({
                        owner: AddressZero,
                        source: SourceType.Org,
                        sourceToken: bondToken.address,
                        sourceOrgId: 1,
                        destOrgId: 1,
                        feeBp: 0,
                        bond: 1,
                    });

                    await payRouter.connect(user2).approveRequester(0, user2.address);
                    await payRouter.connect(user3).approveRequester(1, user2.address);

                    await expect(payRouter.connect(user2).createRequest([0, 1], [1, 1], 1, {value: 1})).not.to.be.reverted;

                    await expect(payRouter.connect(user2).markRequestAsPaid(0)).not.to.be.reverted;
                    await expect(payRouter.connect(user3).markRequestAsPaid(0)).not.to.be.reverted;

                    const user2Bal = await user2.getBalance();
                    const tx = await payRouter.connect(user2).closeRequest(0);
                    await expect(tx).to.emit(payRouter, "BondReturned").withArgs(user2.address, 0, 1).to.emit(payRouter, "BondReturned").withArgs(user3.address, 1, 1).to.emit(payRouter, "SourceAmountReturned").withArgs(user2.address, 0, 1);

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
                    expect(req.sourceReturned).to.be.true;
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
                    feeBp: 0,
                    bond: 1,
                });

                await bondToken.transfer(user3.address, 1);
                await bondToken.connect(user3).approve(payRouter.address, 1);

                await payRouter.connect(user3).createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: bondToken.address,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    feeBp: 0,
                    bond: 1,
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
                expect(req.sourceReturned).to.be.true;
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
                    feeBp: 0,
                    bond: 1,
                });

                await bondToken.transfer(user3.address, 1);
                await bondToken.connect(user3).approve(payRouter.address, 1);

                await payRouter.connect(user3).createRoute({
                    owner: AddressZero,
                    source: SourceType.Token,
                    sourceToken: bondToken.address,
                    sourceOrgId: 0,
                    destOrgId: 1,
                    feeBp: 0,
                    bond: 1,
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
                expect(req.sourceReturned).to.be.false;
                expect(req.paid).to.have.length(2);
                expect(req.paid[0]).to.have.false;
                expect(req.paid[1]).to.have.true;

                expect(await bondToken.balanceOf(user2.address)).to.eq(0);
                expect(await bondToken.balanceOf(user3.address)).to.eq(0);
            });
        });
    });
});
