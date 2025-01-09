import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {AssetRegistry} from "../typechain-types";

describe("AssetRegistry", function () {
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let accts: SignerWithAddress[];
    let assetReg: AssetRegistry;

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[1];
        user3 = accts[2];

        let factory = await ethers.getContractFactory("AssetRegistry");
        assetReg = (await factory.deploy()) as AssetRegistry;
    });

    describe(".get, .getRate, .toCur, .set", () => {
        it("should return empty info if asset was not registered", async () => {
            const info = await assetReg.get(user2.address);
            expect(info.curRate).to.eq(0);
            expect(info.feeBp).to.eq(0);
            expect(info.feeFixed).to.eq(0);
            expect(info.verified).to.eq(false);
            expect(info.stable).to.eq(false);
            expect(info.sharable).to.eq(false);

            expect(await assetReg.getRate(user2.address)).to.eq(0);
            expect(await assetReg.toCur(user2.address, 100)).to.eq(0);
        });

        it("should return empty info if asset was not registered", async () => {
            await assetReg.set(user2.address, 100, 101, 102, true, true, true);

            const info = await assetReg.get(user2.address);
            expect(info.curRate).to.eq(100);
            expect(info.feeBp).to.eq(101);
            expect(info.feeFixed).to.eq(102);
            expect(info.verified).to.eq(true);
            expect(info.stable).to.eq(true);
            expect(info.sharable).to.eq(true);

            expect(await assetReg.getRate(user2.address)).to.eq(100);
            expect(await assetReg.toCur(user2.address, 100)).to.eq(10000);
        });
    });

    describe(".setRate", () => {
        it("should revert if not owner", async () => {
            await expect(assetReg.connect(user2).setRate(user2.address, 100)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should set correcnt", async () => {
            const info = await assetReg.get(user2.address);
            expect(info.curRate).to.eq(0);
            await assetReg.setRate(user2.address, 100);
            expect(await assetReg.getRate(user2.address)).to.eq(100);
        });
    });

    describe(".setFee", () => {
        it("should revert if not owner", async () => {
            await expect(assetReg.connect(user2).setRate(user2.address, 100)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should set correct value", async () => {
            const info = await assetReg.get(user2.address);
            expect(info.feeBp).to.eq(0);
            expect(info.feeFixed).to.eq(0);
            await assetReg.setFee(user2.address, 100, 101);
            const info2 = await assetReg.get(user2.address);
            expect(info2.feeBp).to.eq(100);
            expect(info2.feeFixed).to.eq(101);
        });
    });

    describe(".setVerified", () => {
        it("should revert if not owner", async () => {
            await expect(assetReg.connect(user2).setRate(user2.address, 100)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should set correct value", async () => {
            const info = await assetReg.get(user2.address);
            expect(info.verified).to.eq(false);

            await assetReg.setVerified(user2.address, true);
            const info2 = await assetReg.get(user2.address);
            expect(info2.verified).to.eq(true);
        });
    });

    describe(".setSharable", () => {
        it("should revert if not owner", async () => {
            await expect(assetReg.connect(user2).setSharable(user2.address, true)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should set correct value", async () => {
            const info = await assetReg.get(user2.address);
            expect(info.sharable).to.eq(false);

            await assetReg.setSharable(user2.address, true);
            const info2 = await assetReg.get(user2.address);
            expect(info2.sharable).to.eq(true);
        });
    });

    
    describe(".setStable", () => {
        it("should revert if not owner", async () => {
            await expect(assetReg.connect(user2).setStable(user2.address, true)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should set correct value", async () => {
            const info = await assetReg.get(user2.address);
            expect(info.stable).to.eq(false);

            await assetReg.setStable(user2.address, true);
            const info2 = await assetReg.get(user2.address);
            expect(info2.stable).to.eq(true);
        });
    });
});
