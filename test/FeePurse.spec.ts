import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {FeePurse, TOKEN} from "../typechain-types";
import {toBN} from "../utils/utils";
import {constants} from "ethers";

describe("FeePurse", function () {
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let accts: SignerWithAddress[];
    let feeToken: TOKEN;
    let feePurse: FeePurse;

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[2];
        user3 = accts[3];

        let supply = toBN("1000000000000000000000000");
        let TOKEN = await ethers.getContractFactory("TOKEN");
        feeToken = (await TOKEN.deploy("FEE_TOKEN", "FEE_TOKEN", supply, 18)) as TOKEN;

        let factory = await ethers.getContractFactory("FeePurse");
        feePurse = (await factory.deploy(feeToken.address)) as FeePurse;
    });

    describe(".deposit & .balanceOf", () => {
        it("should revert when sender did not approve sufficient amount", async () => {
            await expect(feePurse.connect(user2).deposit(1)).to.be.revertedWith("ERC20: insufficient allowance");
        });

        it("should revert when sender has insufficient balance", async () => {
            await feeToken.connect(user2).approve(feePurse.address, 1);
            await expect(feePurse.connect(user2).deposit(1)).to.be.revertedWith("'ERC20: transfer amount exceeds balance");
        });

        it("should successfully deposit amount", async () => {
            await feeToken.approve(feePurse.address, 3);
            await expect(feePurse.deposit(1)).to.emit(feePurse, "FeeDeposited").withArgs(deployer.address, 1);
            expect(await feePurse.balanceOf(deployer.address)).to.eq(1);
            await expect(feePurse.deposit(2)).not.to.be.reverted;
            expect(await feePurse.balanceOf(deployer.address)).to.eq(3);
        });
    });

    describe(".lock", () => {
        beforeEach(async () => {
            await feeToken.approve(feePurse.address, 3);
            await expect(feePurse.deposit(3)).not.to.be.reverted;
            await feePurse.updateWriter(deployer.address, true);
        });

        it("should revert with error when sender is not a writer", async () => {
            await feePurse.updateWriter(deployer.address, false);
            await expect(feePurse.lock(deployer.address, 1)).to.be.revertedWith("W: NOT_WRITER");
        });

        it("should revert with error when address has insufficient balance", async () => {
            await expect(feePurse.lock(user2.address, 1)).to.be.revertedWith("FP: LOW_BAL");
        });

        it("should successfully lock amount", async () => {
            await expect(feePurse.lock(deployer.address, 1)).to.be.emit(feePurse, "LockedDeposit").withArgs(1, deployer.address, 1);
            expect(await feePurse.locked(0)).to.eq(1);
            expect(await feePurse.balanceOf(deployer.address)).to.eq(2);
        });
    });

    describe(".unlock", () => {
        beforeEach(async () => {
            await feeToken.approve(feePurse.address, 3);
            await expect(feePurse.deposit(3)).not.to.be.reverted;
            await feePurse.updateWriter(deployer.address, true);
        });

        it("should revert with error when sender is not a writer", async () => {
            await feePurse.updateWriter(deployer.address, false);
            await expect(feePurse.unlock(deployer.address, 1)).to.be.revertedWith("W: NOT_WRITER");
        });

        it("should revert with error when ID is unknown", async () => {
            await expect(feePurse.unlock(user2.address, 1)).to.be.revertedWith("FP: UNK_ID");
        });

        it("should successfully unlock locked balance", async () => {
            await expect(feePurse.lock(deployer.address, 1)).to.be.emit(feePurse, "LockedDeposit").withArgs(1, deployer.address, 1);
            expect(await feePurse.locked(0)).to.eq(1);
            expect(await feePurse.balanceOf(deployer.address)).to.eq(2);

            await expect(feePurse.unlock(deployer.address, 1)).to.emit(feePurse, "UnlockedDeposit").withArgs(1, deployer.address, 1);
            expect(await feePurse.locked(0)).to.eq(0);
            expect(await feePurse.balanceOf(deployer.address)).to.eq(3);
        });
    });

    describe(".transferFrom", () => {
        beforeEach(async () => {
            await feeToken.approve(feePurse.address, 3);
            await expect(feePurse.deposit(3)).not.to.be.reverted;
            await feePurse.updateWriter(deployer.address, true);
        });

        it("should revert with error when sender is not a writer", async () => {
            await feePurse.updateWriter(deployer.address, false);
            await expect(feePurse.transferFrom(user2.address, user2.address, 10)).to.be.revertedWith("W: NOT_WRITER");
        });

        it("should successfully add balance", async () => {
            await expect(feePurse.transferFrom(deployer.address, user2.address, 3)).not.to.be.reverted;
            expect(await feePurse.balanceOf(deployer.address)).to.eq(0);
            expect(await feePurse.balanceOf(user2.address)).to.eq(3);
        });
    });

    describe(".withdraw", function () {
        beforeEach(async () => {
            await feeToken.approve(feePurse.address, 3);
            await expect(feePurse.deposit(3)).not.to.be.reverted;
            await feePurse.updateWriter(deployer.address, true);
        });

        it("should revert with error when sender has insufficient balance", async () => {
            await expect(feePurse.connect(user2).withdraw(1, user2.address)).to.be.revertedWith("FP: LOW_BAL");
        });

        it("should successfully withdraw to sender if address is zero", async () => {
            const oldBal = await feeToken.balanceOf(deployer.address);
            await expect(feePurse.lock(deployer.address, 1)).not.to.be.reverted;
            expect(await feePurse.balanceOf(deployer.address)).to.eq(2);
            await expect(feePurse.withdraw(1, constants.AddressZero)).to.emit(feePurse, "Withdrawn").withArgs(deployer.address, deployer.address, 1);
            expect(await feePurse.balanceOf(deployer.address)).to.eq(1);
            expect(await feeToken.balanceOf(deployer.address)).to.eql(oldBal.add(1));
        });

        it("should successfully withdraw to another address", async () => {
            await expect(feePurse.lock(deployer.address, 1)).not.to.be.reverted;
            expect(await feePurse.balanceOf(deployer.address)).to.eq(2);
            await expect(feePurse.withdraw(1, user2.address)).to.emit(feePurse, "Withdrawn").withArgs(deployer.address, user2.address, 1);
            expect(await feePurse.balanceOf(deployer.address)).to.eq(1);
            expect(await feeToken.balanceOf(user2.address)).to.eq(1);
        });
    });

    describe(".withdrawFrom", function () {
        beforeEach(async () => {
            await feeToken.approve(feePurse.address, 3);
            await expect(feePurse.deposit(3)).not.to.be.reverted;
            await feePurse.updateWriter(user3.address, true);
        });

        it("should revert with error when sender is not a writer", async () => {
            await expect(feePurse.connect(user2).withdrawFrom(1, user2.address, user3.address)).to.be.revertedWith("W: NOT_WRITER");
        });

        it("should revert with error when sender has insufficient balance", async () => {
            await expect(feePurse.connect(user3).withdrawFrom(1, user2.address, user3.address)).to.be.revertedWith("FP: LOW_BAL");
        });

        it("should successfully withdraw to address", async () => {
            await expect(feePurse.connect(user3).lock(deployer.address, 1)).not.to.be.reverted;
            expect(await feePurse.balanceOf(deployer.address)).to.eq(2);
            await expect(feePurse.connect(user3).withdrawFrom(1, deployer.address, user3.address)).to.emit(feePurse, "Withdrawn").withArgs(deployer.address, user3.address, 1);
            expect(await feePurse.balanceOf(deployer.address)).to.eq(1);
            expect(await feeToken.balanceOf(user3.address)).to.eq(1);
        });
    });
});
