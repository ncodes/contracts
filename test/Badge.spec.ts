import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {BadgeManager} from "../typechain-types";
import {advanceBlockTime, toBN} from "../utils/utils";

describe("Badge", function () {
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let accts: SignerWithAddress[];
    let badgeMgr: BadgeManager;
    let testBadge = "cod_player";
    let testPath = "path";
    const chainId = 31337;

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[1];
        user3 = accts[2];

        let factory = await ethers.getContractFactory("BadgeManager");
        badgeMgr = (await factory.deploy()) as BadgeManager;
    });

    describe(".registerIssuer", () => {
        it("should revert with msg=NOT_OWNER if sender is not contract owner", async () => {
            await expect(badgeMgr.connect(user2).registerIssuer(user2.address, testBadge, [], [])).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should revert with msg=MKT_BADGE_REQ when badge is empty", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, "", [], [])).to.be.revertedWith("BADGE: MKT_BADGE_REQ");
        });

        it("should successfully create issuer", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
            expect(await badgeMgr.issuerBadge(user2.address)).to.eql(testBadge);
        });

        it("should revert with msg=ALREADY_ISSUER if address is already an issuer", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
            expect(await badgeMgr.issuerBadge(user2.address)).to.eql(testBadge);
            await expect(badgeMgr.registerIssuer(user2.address, "another_badge", [], [])).to.be.revertedWith("BADGE: ALREADY_ISSUER");
        });

        it("should revert with msg=DIFF_META_SIZE when meta key and value size don't match", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1"])).to.be.revertedWith("BADGE: DIFF_META_SIZE");
        });

        it("should successfully create issuer with metadata", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            expect(await badgeMgr.issuerBadge(user2.address)).to.eql(testBadge);
            expect(await badgeMgr.getMetaValue(testBadge, "", "k1")).to.eql("v1");
            expect(await badgeMgr.getMetaValue(testBadge, "", "k2")).to.eql("v2");
            expect(await badgeMgr.getMetaKeys(testBadge, "")).to.eql(["k1", "k2"]);
        });

        it("should revert with msg=BADGE_TAKEN when badge is already registered", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.registerIssuer(user3.address, testBadge, [], [])).to.be.revertedWith("BADGE: BADGE_TAKEN");
        });
    });

    describe(".replaceIssuer", () => {
        it("should revert with msg=NOT_OWNER if sender is not contract owner", async () => {
            await expect(badgeMgr.connect(user2).replaceIssuer(testBadge, user2.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should revert with msg=NOT_ISSUED if badge was not yet issued", async () => {
            await expect(badgeMgr.replaceIssuer(testBadge, user2.address)).to.be.revertedWith("BADGE: NOT_ISSUED");
        });

        it("should replace issuer", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
            expect(await badgeMgr.badgeIssuer(testBadge)).to.eql(user2.address);
            await expect(badgeMgr.replaceIssuer(testBadge, user3.address)).emit(badgeMgr, "ReplacedIssuer").withArgs(user2.address, user3.address, testBadge);
        });
    });

    describe(".registerCoIssuer", () => {
        it("should revert with msg=NOT_ISSUER if sender is not the badge issuer", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.registerCoIssuer(testBadge, user3.address)).to.be.revertedWith("BADGE: NOT_ISSUER");
        });

        it("should successfully register co-issuer", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).emit(badgeMgr, "AddedCoIssuer").withArgs(user2.address, user3.address, testBadge);
        });
    });

    describe(".removeCoIssuer", () => {
        it("should revert with msg=NOT_ISSUER if sender is not the badge issuer", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.removeCoIssuer(testBadge, user3.address)).to.be.revertedWith("BADGE: NOT_ISSUER");
        });

        it("should successfully remove co-issuer", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
            expect(await badgeMgr.badgeCoIssuers(testBadge, user3.address)).to.be.true;
            await expect(badgeMgr.connect(user2).removeCoIssuer(testBadge, user3.address)).emit(badgeMgr, "RemovedCoIssuer").withArgs(user2.address, user3.address, testBadge);
            expect(await badgeMgr.badgeCoIssuers(testBadge, user3.address)).to.be.false;
        });
    });

    describe(".registerPath", () => {
        it("should revert with msg=NOT_ISSUER if badge does not exist", async () => {
            await expect(badgeMgr.registerPath(testBadge, testPath, [], [])).to.be.revertedWith("BADGE: NOT_ISSUER");
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.registerPath(testBadge, testPath, [], [])).to.be.revertedWith("BADGE: NOT_ISSUER");
        });

        it("should revert with msg=NOT_ISSUER if sender is not the badge issuer or co-issuer", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.registerPath(testBadge, testPath, [], [])).to.be.revertedWith("BADGE: NOT_ISSUER");
        });

        it("should revert with msg=DIFF_META_SIZE when metadata key and value do not have same length", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
            await expect(badgeMgr.connect(user3).registerPath(testBadge, testPath, ["k1"], ["v1", "v2"])).to.be.revertedWith("BADGE: DIFF_META_SIZE");
        });

        it("should revert with msg=PATH_EXIST when path already exist", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
            await expect(badgeMgr.connect(user3).registerPath(testBadge, testPath, [], [])).not.to.be.reverted;
            await expect(badgeMgr.connect(user3).registerPath(testBadge, testPath, [], [])).to.be.revertedWith("BADGE: PATH_EXIST");
        });

        it("should successfully create path when sender is the badge issuer", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).registerPath(testBadge, testPath, [], [])).not.to.be.reverted;
            expect(await badgeMgr.badgePaths(testBadge, testPath)).to.eql(user2.address);
        });

        it("should successfully create path when sender is a badge co-issuer", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
            await expect(badgeMgr.connect(user3).registerPath(testBadge, testPath, [], [])).not.to.be.reverted;
            expect(await badgeMgr.badgePaths(testBadge, testPath)).to.eql(user3.address);
        });

        it("should successfully create path and save path metadata", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).registerPath(testBadge, testPath, ["k1"], ["v1"])).not.to.be.reverted;
            expect(await badgeMgr.pathMetadata(await badgeMgr.getPathId(testBadge, testPath), "k1")).to.eql("v1");
        });
    });

    describe(".transferBadgeOwnership", function () {
        it("should revert with msg=NOT_ISSUER when sender is not owner of the badge", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user3).transferBadgeOwnership(testBadge, "", user3.address)).to.be.revertedWith("BADGE: NOT_ISSUER");
        });

        it("should revert with msg=NOT_ISSUER when sender is not owner of the badge path", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
            await expect(badgeMgr.connect(user3).registerPath(testBadge, testPath, ["k1"], ["v1"])).not.to.be.reverted;
            await expect(badgeMgr.connect(user2).transferBadgeOwnership(testBadge, testPath, user3.address)).to.be.revertedWith("BADGE: NOT_ISSUER");
        });

        it("should successfully transfer ownership of badge", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).transferBadgeOwnership(testBadge, "", user3.address))
                .emit(badgeMgr, "BadgeOwnershipTransferred")
                .withArgs(testBadge, "", user2.address, user3.address);
            expect(await badgeMgr.issuerBadge(user3.address)).to.eql(testBadge);
            expect(await badgeMgr.badgeIssuer(testBadge)).to.eql(user3.address);
        });

        it("should successfully transfer ownership of badge path", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
            await expect(badgeMgr.connect(user3).registerPath(testBadge, testPath, ["k1"], ["v1"])).not.to.be.reverted;
            await expect(badgeMgr.connect(user3).transferBadgeOwnership(testBadge, testPath, deployer.address))
                .emit(badgeMgr, "BadgeOwnershipTransferred")
                .withArgs(testBadge, testPath, user3.address, deployer.address);
            expect(await badgeMgr.badgePaths(testBadge, testPath)).to.eql(deployer.address);
        });
    });

    describe(".upsertMeta", () => {
        context("add meta to a badge", () => {
            it("should revert with msg=NOT_ISSUER if sender is not the issuer", async () => {
                await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
                await expect(badgeMgr.upsertMeta(testBadge, "", "k3", "v3")).to.be.revertedWith("BADGE: NOT_ISSUER");
            });

            it("should revert with msg=NOT_ISSUER if sender is badge co-issuer", async () => {
                await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
                await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
                await expect(badgeMgr.connect(user3).upsertMeta(testBadge, "", "k3", "v3")).to.be.revertedWith("BADGE: NOT_ISSUER");
            });

            it("should successfully add metadata to badge when sender is the issuer", async () => {
                await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
                await expect(badgeMgr.connect(user2).upsertMeta(testBadge, "", "k3", "v3"))
                    .emit(badgeMgr, "BadgeMetaUpdated")
                    .withArgs(user2.address, testBadge, "", "k3", "v3");
                expect(await badgeMgr.getMetaKeys(testBadge, "")).to.eql(["k1", "k2", "k3"]);
            });

            it("should successfully overwrite badge metadata when key already exists", async () => {
                await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
                await expect(badgeMgr.connect(user2).upsertMeta(testBadge, "", "k1", "vv1"))
                    .emit(badgeMgr, "BadgeMetaUpdated")
                    .withArgs(user2.address, testBadge, "", "k1", "vv1");
                expect(await badgeMgr.getMetaKeys(testBadge, "")).to.eql(["k1", "k2"]);
                expect(await badgeMgr.getMetaValue(testBadge, "", "k1")).to.eql("vv1");
            });
        });

        context("add meta to a badge path as the co-issuer", () => {
            it("should revert with msg=NOT_ISSUER if path does not exist", async () => {
                await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
                await expect(badgeMgr.upsertMeta(testBadge, testPath, "k3", "v3")).to.be.revertedWith("BADGE: NOT_ISSUER");
            });

            it("should revert with msg=NOT_ISSUER if sender is not the path issuer", async () => {
                await expect(badgeMgr.registerIssuer(user2.address, testBadge, [], [])).emit(badgeMgr, "AddedIssuer");
                await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
                await expect(badgeMgr.connect(user3).registerPath(testBadge, testPath, [], [])).not.to.be.reverted;
                await expect(badgeMgr.upsertMeta(testBadge, testPath, "k3", "v3")).to.be.revertedWith("BADGE: NOT_ISSUER");
            });

            it("should successfully add metadata when sender is the path issuer", async () => {
                await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
                await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
                await expect(badgeMgr.connect(user3).registerPath(testBadge, testPath, [], [])).not.to.be.reverted;
                await expect(badgeMgr.connect(user3).upsertMeta(testBadge, testPath, "k3", "v3"))
                    .emit(badgeMgr, "BadgeMetaUpdated")
                    .withArgs(user3.address, testBadge, testPath, "k3", "v3");
                expect(await badgeMgr.getMetaKeys(testBadge, "")).to.eql(["k1", "k2"]);
                expect(await badgeMgr.getMetaKeys(testBadge, testPath)).to.eql(["k3"]);
            });

            it("should successfully add metadata when sender the path's badge issuer", async () => {
                await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
                await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
                await expect(badgeMgr.connect(user3).registerPath(testBadge, testPath, [], [])).not.to.be.reverted;
                await expect(badgeMgr.connect(user2).upsertMeta(testBadge, testPath, "k3", "v3"))
                    .emit(badgeMgr, "BadgeMetaUpdated")
                    .withArgs(user2.address, testBadge, testPath, "k3", "v3");
                expect(await badgeMgr.getMetaKeys(testBadge, "")).to.eql(["k1", "k2"]);
                expect(await badgeMgr.getMetaKeys(testBadge, testPath)).to.eql(["k3"]);
            });

            it("should successfully overwrite badge metadata when key already exists", async () => {
                await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
                await expect(badgeMgr.connect(user2).upsertMeta(testBadge, "", "k1", "vv1"))
                    .emit(badgeMgr, "BadgeMetaUpdated")
                    .withArgs(user2.address, testBadge, "", "k1", "vv1");
                expect(await badgeMgr.getMetaKeys(testBadge, "")).to.eql(["k1", "k2"]);
                expect(await badgeMgr.getMetaValue(testBadge, "", "k1")).to.eql("vv1");
            });

            it("should successfully overwrite badge path metadata when key already exists", async () => {
                await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
                await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
                await expect(badgeMgr.connect(user3).registerPath(testBadge, testPath, ["k1", "k2"], ["v1", "v2"])).not.to.be.reverted;

                await expect(badgeMgr.connect(user3).upsertMeta(testBadge, testPath, "k1", "vv1"))
                    .emit(badgeMgr, "BadgeMetaUpdated")
                    .withArgs(user3.address, testBadge, testPath, "k1", "vv1");
                expect(await badgeMgr.getMetaKeys(testBadge, testPath)).to.eql(["k1", "k2"]);
                expect(await badgeMgr.getMetaValue(testBadge, testPath, "k1")).to.eql("vv1");
            });
        });
    });

    describe(".grantBadge", function () {
        it("should revert with msg=NOT_ISSUER when sender is not the issuer of the badge", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.grantBadge(testBadge, testPath, user3.address, 0, [], [])).to.be.revertedWith("BADGE: NOT_ISSUER");
        });

        it("should revert with msg=NOT_ISSUER when sender is not the issuer of the badge path", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).registerPath(testBadge, testPath, ["k1", "k2"], ["v1", "v2"])).not.to.be.reverted;
            await expect(badgeMgr.grantBadge(testBadge, testPath, user3.address, 0, [], [])).to.be.revertedWith("BADGE: NOT_ISSUER");
        });

        it("should revert with msg=DIFF_META_SIZE when meta key and value size are different", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).grantBadge(testBadge, "", user3.address, 0, ["k1"], [])).to.be.revertedWith("BADGE: DIFF_META_SIZE");
        });

        it("should successfully grant badge", async () => {
            const metaKeys = ["k1", "k2"];
            const metaValues = ["v1", "v2"];
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, metaKeys, metaValues)).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).grantBadge(testBadge, "", user3.address, 0, ["k1"], ["v1"])).to.emit(badgeMgr, "GrantedBadge");

            expect(await badgeMgr.hasBadge(user3.address, testBadge, "")).to.be.true;
            expect(await badgeMgr.getGranteeMetaValue(testBadge, "", user3.address, "k1")).to.eql("v1");
            expect(await badgeMgr.getGranteeMetaKeys(testBadge, "", user3.address)).to.eql(["k1"]);

            const id = await badgeMgr.getGrantId(testBadge, "", user3.address);
            expect((await badgeMgr.granted(id)).grantedAt.gt(0)).to.be.true;
            expect(await badgeMgr.granteeMetadata(id, "k1")).to.eql("v1");
        });

        it("should successfully grant badge path", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
            await expect(badgeMgr.connect(user3).registerPath(testBadge, testPath, ["k1", "k2"], ["v1", "v2"])).not.to.be.reverted;

            await expect(badgeMgr.connect(user3).grantBadge(testBadge, testPath, deployer.address, 0, ["k1"], ["v1"])).to.emit(badgeMgr, "GrantedBadge");

            expect(await badgeMgr.hasBadge(deployer.address, testBadge, testPath)).to.be.true;
            expect(await badgeMgr.getGranteeMetaValue(testBadge, testPath, deployer.address, "k1")).to.eql("v1");
            expect(await badgeMgr.getGranteeMetaKeys(testBadge, testPath, deployer.address)).to.eql(["k1"]);

            const id = await badgeMgr.getGrantId(testBadge, testPath, deployer.address);
            expect((await badgeMgr.granted(id)).grantedAt.gt(0)).to.be.true;
            expect(await badgeMgr.granteeMetadata(id, "k1")).to.eql("v1");
            expect(await badgeMgr.granteeMetadataKeys(id, 0)).to.eql("k1");
        });

        context("when expiry time is set", () => {
            it("should revert with msg=BAD_EXP_TIME when time is in the past", async () => {
                await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
                await expect(badgeMgr.connect(user2).grantBadge(testBadge, "", user3.address, 1, [], [])).to.be.revertedWith("BADGE: BAD_EXP_TIME");
            });

            it("should successfully grant badge", async () => {
                const now = await advanceBlockTime(1);
                const expireAt = now + 10;

                await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
                await expect(badgeMgr.connect(user2).grantBadge(testBadge, "", user3.address, expireAt, ["k1"], ["v1"])).to.emit(badgeMgr, "GrantedBadge");

                expect(await badgeMgr.hasBadge(user3.address, testBadge, "")).to.be.true;

                // advance time to expiry time
                await advanceBlockTime(10);
                expect(await badgeMgr.hasBadge(user3.address, testBadge, "")).to.be.false;
            });
        });
    });

    describe(".grantBadgeBySig", function () {
        beforeEach(async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
        });

        it("should revert with msg=EXPIRED_SIG when signature expiry time is in the past", async () => {
            const now = await advanceBlockTime(1);
            await expect(badgeMgr.grantBadgeBySig(testBadge, testPath, user3.address, 0, [], [], now, Buffer.alloc(0))).to.be.revertedWith("BADGE: EXPIRED_SIG");
        });

        it("should revert with msg=BAD_SIG when signature is invalid", async () => {
            const expireAt = (await advanceBlockTime(1)) + 2;
            const sig = Buffer.alloc(2);
            await expect(badgeMgr.grantBadgeBySig(testBadge, testPath, user3.address, 0, [], [], expireAt, sig)).to.be.revertedWith("BADGE: BAD_SIG");
        });

        it("should successfully grant a badge", async () => {
            const metaKeys = ["k1", "k2"];
            const metaValues = ["v1", "v2"];
            let sigExpireAt = (await advanceBlockTime(1)) + 2;
            let badgeExpireAt = 0;

            const msgHash = ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(
                    ["uint", "string", "string", "address", "uint256", "string[]", "string[]", "uint256"],
                    [chainId, testBadge, "", user3.address, badgeExpireAt, metaKeys, metaValues, toBN(sigExpireAt)],
                ),
            );
            const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
            const signedMsg = await user2.signMessage(msgHashBytes);
            await expect(badgeMgr.grantBadgeBySig(testBadge, "", user3.address, badgeExpireAt, metaKeys, metaValues, sigExpireAt, signedMsg)).emit(badgeMgr, "GrantedBadge");
            expect(await badgeMgr.hasBadge(user3.address, testBadge, "")).to.be.true;

            // revert when signature is reused
            sigExpireAt = (await advanceBlockTime(1)) + 2;
            await expect(badgeMgr.grantBadgeBySig(testBadge, "", user3.address, badgeExpireAt, metaKeys, metaValues, sigExpireAt, signedMsg)).to.be.revertedWith("BADGE: BAD_SIG");
        });

        context("with path", () => {
            it("should successfully grant a badge path", async () => {
                await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
                await expect(badgeMgr.connect(user3).registerPath(testBadge, testPath, ["k1", "k2"], ["v1", "v2"])).not.to.be.reverted;

                const metaKeys = ["k1", "k2"];
                const metaValues = ["v1", "v2"];
                let sigExpireAt = (await advanceBlockTime(1)) + 2;
                let badgeExpireAt = 0;
                const msgHash = ethers.utils.keccak256(
                    ethers.utils.defaultAbiCoder.encode(
                        ["uint", "string", "string", "address", "uint256", "string[]", "string[]", "uint256"],
                        [chainId, testBadge, testPath, user3.address, badgeExpireAt, metaKeys, metaValues, toBN(sigExpireAt)],
                    ),
                );
                const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                const signedMsg = await user3.signMessage(msgHashBytes);
                await expect(badgeMgr.grantBadgeBySig(testBadge, testPath, user3.address, badgeExpireAt, metaKeys, metaValues, sigExpireAt, signedMsg)).emit(badgeMgr, "GrantedBadge");
                expect(await badgeMgr.hasBadge(user3.address, testBadge, testPath)).to.be.true;

                // revert when signature is reused
                sigExpireAt = (await advanceBlockTime(1)) + 2;
                await expect(badgeMgr.grantBadgeBySig(testBadge, testPath, user3.address, badgeExpireAt, metaKeys, metaValues, sigExpireAt, signedMsg)).to.be.revertedWith("BADGE: BAD_SIG");
            });
        });
    });

    describe(".revokeBadge", function () {
        it("should revert with msg=NOT_ISSUER when sender is not the issuer of the badge", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.revokeBadge(testBadge, testPath, user3.address)).to.be.revertedWith("BADGE: NOT_ISSUER");
        });

        it("should revert with msg=NOT_ISSUER when sender is not the issuer of the badge path", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).registerPath(testBadge, testPath, ["k1", "k2"], ["v1", "v2"])).not.to.be.reverted;
            await expect(badgeMgr.revokeBadge(testBadge, testPath, user3.address)).to.be.revertedWith("BADGE: NOT_ISSUER");
        });

        it("should successfully revoke badge", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).grantBadge(testBadge, "", user3.address, 0, ["k1"], ["v1"])).not.to.be.reverted;
            await expect(badgeMgr.connect(user2).revokeBadge(testBadge, "", user3.address))
                .emit(badgeMgr, "RevokedBadge")
                .withArgs(testBadge, "", user3.address);

            expect(await badgeMgr.hasBadge(user3.address, testBadge, "")).to.be.false;
            expect(await badgeMgr.getGranteeMetaValue(testBadge, "", user3.address, "k1")).to.eql("");
            expect(await badgeMgr.getGranteeMetaKeys(testBadge, "", user3.address)).to.eql([]);

            const id = await badgeMgr.getGrantId(testBadge, "", user3.address);
            expect((await badgeMgr.granted(id)).grantedAt.gt(0)).to.be.false;
            expect(await badgeMgr.granteeMetadata(id, "k1")).to.eql("");
        });

        it("should successfully revoke badge path", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
            await expect(badgeMgr.connect(user3).registerPath(testBadge, testPath, ["k1", "k2"], ["v1", "v2"])).not.to.be.reverted;

            await expect(badgeMgr.connect(user3).grantBadge(testBadge, testPath, deployer.address, 0, ["k1"], ["v1"])).not.to.be.reverted;
            await expect(badgeMgr.connect(user3).revokeBadge(testBadge, testPath, deployer.address))
                .emit(badgeMgr, "RevokedBadge")
                .withArgs(testBadge, testPath, deployer.address);
            expect(await badgeMgr.getGranteeMetaKeys(testBadge, testPath, deployer.address)).to.eql([]);

            expect(await badgeMgr.hasBadge(deployer.address, testBadge, testPath)).to.be.false;
            expect(await badgeMgr.getGranteeMetaValue(testBadge, testPath, deployer.address, "k1")).to.eql("");

            const id = await badgeMgr.getGrantId(testBadge, testPath, user3.address);
            expect((await badgeMgr.granted(id)).grantedAt.gt(0)).to.be.false;
            expect(await badgeMgr.granteeMetadata(id, "k1")).to.eql("");
        });
    });

    describe(".revokeBySig", function () {
        beforeEach(async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
        });

        it("should revert with msg=EXPIRED_SIG when signature expiry time is in the past", async () => {
            const now = await advanceBlockTime(1);
            await expect(badgeMgr.revokeBadgeBySig(testBadge, testPath, user3.address, now, Buffer.alloc(0))).to.be.revertedWith("BADGE: EXPIRED_SIG");
        });

        it("should revert with msg=BAD_SIG when signature is invalid", async () => {
            const expireAt = (await advanceBlockTime(1)) + 2;
            const sig = Buffer.alloc(2);
            await expect(badgeMgr.revokeBadgeBySig(testBadge, testPath, user3.address, expireAt, sig)).to.be.revertedWith("BADGE: BAD_SIG");
        });

        it("should successfully revoke badge", async () => {
            await expect(badgeMgr.connect(user2).grantBadge(testBadge, "", user3.address, 0, ["k1"], ["v1"])).not.to.be.reverted;

            let expireAt = (await advanceBlockTime(1)) + 2;
            const msgHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["uint", "string", "string", "address", "uint256"], [chainId, testBadge, "", user3.address, toBN(expireAt)]));
            const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
            const signedMsg = await user2.signMessage(msgHashBytes);
            await expect(badgeMgr.revokeBadgeBySig(testBadge, "", user3.address, expireAt, signedMsg)).emit(badgeMgr, "RevokedBadge");

            expect(await badgeMgr.hasBadge(user3.address, testBadge, "")).to.be.false;

            // revert when reusing signature
            expireAt = (await advanceBlockTime(1)) + 2;
            await expect(badgeMgr.revokeBadgeBySig(testBadge, "", user3.address, expireAt, signedMsg)).to.be.revertedWith("BADGE: BAD_SIG");
        });

        context("with path", () => {
            it("should successfully revoke badge path", async () => {
                await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
                await expect(badgeMgr.connect(user3).registerPath(testBadge, testPath, ["k1", "k2"], ["v1", "v2"])).not.to.be.reverted;

                await expect(badgeMgr.connect(user3).grantBadge(testBadge, testPath, user3.address, 0, ["k1"], ["v1"])).not.to.be.reverted;

                let expireAt = (await advanceBlockTime(1)) + 2;
                const msgHash = ethers.utils.keccak256(
                    ethers.utils.defaultAbiCoder.encode(["uint", "string", "string", "address", "uint256"], [chainId, testBadge, testPath, user3.address, toBN(expireAt)]),
                );
                const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                const signedMsg = await user3.signMessage(msgHashBytes);
                await expect(badgeMgr.revokeBadgeBySig(testBadge, testPath, user3.address, expireAt, signedMsg)).emit(badgeMgr, "RevokedBadge");

                expect(await badgeMgr.hasBadge(user3.address, testBadge, testPath)).to.be.false;
            });
        });
    });

    describe(".upsertGranteeMeta", function () {
        it("should revert with msg=NOT_ISSUER when sender is not the issuer of the badge", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.upsertGranteeMeta(testBadge, testPath, user3.address, "k1", "v1")).to.be.revertedWith("BADGE: NOT_ISSUER");
        });

        it("should revert with msg=NOT_ISSUER when sender is not the issuer of the badge path", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).registerPath(testBadge, testPath, ["k1", "k2"], ["v1", "v2"])).not.to.be.reverted;
            await expect(badgeMgr.upsertGranteeMeta(testBadge, testPath, user3.address, "k1", "v1")).to.be.revertedWith("BADGE: NOT_ISSUER");
        });

        it("should successfully update grant badge metadata", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).grantBadge(testBadge, "", user3.address, 0, ["k1"], ["v1"])).not.to.be.reverted;
            await expect(badgeMgr.connect(user2).upsertGranteeMeta(testBadge, "", user3.address, "k1", "x1"))
                .emit(badgeMgr, "GranteeBadgeMetaUpdated")
                .withArgs(user2.address, user3.address, testBadge, "", "k1", "x1");
            const id = await badgeMgr.getGrantId(testBadge, "", user3.address);
            expect(await badgeMgr.granteeMetadata(id, "k1")).to.eql("x1");
        });

        it("should successfully update badge path metadata", async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
            await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
            await expect(badgeMgr.connect(user3).registerPath(testBadge, testPath, ["k1", "k2"], ["v1", "v2"])).not.to.be.reverted;

            await expect(badgeMgr.connect(user3).grantBadge(testBadge, testPath, deployer.address, 0, ["k1"], ["v1"])).not.to.be.reverted;
            await expect(badgeMgr.connect(user3).upsertGranteeMeta(testBadge, testPath, deployer.address, "k1", "x1"))
                .emit(badgeMgr, "GranteeBadgeMetaUpdated")
                .withArgs(user3.address, deployer.address, testBadge, testPath, "k1", "x1");

            const id = await badgeMgr.getGrantId(testBadge, testPath, deployer.address);
            expect(await badgeMgr.granteeMetadata(id, "k1")).to.eql("x1");
        });
    });

    describe(".upsertGranteeMetaBySig", function () {
        beforeEach(async () => {
            await expect(badgeMgr.registerIssuer(user2.address, testBadge, ["k1", "k2"], ["v1", "v2"])).emit(badgeMgr, "AddedIssuer");
        });

        it("should revert with msg=EXPIRED_SIG when signature expiry time is in the past", async () => {
            const now = await advanceBlockTime(1);
            await expect(badgeMgr.upsertGranteeMetaBySig(testBadge, testPath, user3.address, "k1", "v1", now, Buffer.alloc(0))).to.be.revertedWith("BADGE: EXPIRED_SIG");
        });

        it("should revert with msg=BAD_SIG when signature is invalid", async () => {
            const expireAt = (await advanceBlockTime(1)) + 2;
            const sig = Buffer.alloc(2);
            await expect(badgeMgr.upsertGranteeMetaBySig(testBadge, testPath, user3.address, "k1", "v1", expireAt, sig)).to.be.revertedWith("BADGE: BAD_SIG");
        });

        it("should successfully update grantee badge metadata", async () => {
            await expect(badgeMgr.connect(user2).grantBadge(testBadge, "", user3.address, 0, ["k1"], ["v1"])).not.to.be.reverted;

            let expireAt = (await advanceBlockTime(1)) + 2;
            const msgHash = ethers.utils.keccak256(
                ethers.utils.defaultAbiCoder.encode(["uint", "string", "string", "address", "string", "string", "uint256"], [chainId, testBadge, "", user2.address, "k1", "x1", toBN(expireAt)]),
            );
            const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
            const signedMsg = await user2.signMessage(msgHashBytes);
            await expect(badgeMgr.upsertGranteeMetaBySig(testBadge, "", user2.address, "k1", "x1", expireAt, signedMsg)).emit(badgeMgr, "GranteeBadgeMetaUpdated");

            const id = await badgeMgr.getGrantId(testBadge, "", user2.address);
            expect(await badgeMgr.granteeMetadata(id, "k1")).to.eql("x1");
        });

        context("with path", () => {
            it("should successfully update metadata for grantee badge path", async () => {
                await expect(badgeMgr.connect(user2).registerCoIssuer(testBadge, user3.address)).not.to.be.reverted;
                await expect(badgeMgr.connect(user3).registerPath(testBadge, testPath, ["k1", "k2"], ["v1", "v2"])).not.to.be.reverted;
                await expect(badgeMgr.connect(user3).grantBadge(testBadge, testPath, user3.address, 0, ["k1"], ["v1"])).not.to.be.reverted;

                let expireAt = (await advanceBlockTime(1)) + 2;
                const msgHash = ethers.utils.keccak256(
                    ethers.utils.defaultAbiCoder.encode(
                        ["uint", "string", "string", "address", "string", "string", "uint256"],
                        [chainId, testBadge, testPath, user3.address, "k1", "x1", toBN(expireAt)],
                    ),
                );
                const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                const signedMsg = await user3.signMessage(msgHashBytes);
                await expect(badgeMgr.upsertGranteeMetaBySig(testBadge, testPath, user3.address, "k1", "x1", expireAt, signedMsg)).emit(badgeMgr, "GranteeBadgeMetaUpdated");

                const id = await badgeMgr.getGrantId(testBadge, testPath, user3.address);
                expect(await badgeMgr.granteeMetadata(id, "k1")).to.eql("x1");
            });
        });
    });
});
