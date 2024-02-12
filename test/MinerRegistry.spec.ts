import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {TOKEN} from "../typechain-types";
import {advanceBlockTime, toBN} from "../utils/utils";
import {MinerRegistry} from "./../typechain-types/MinerRegistry";

describe("MinerRegistry", function () {
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let accts: SignerWithAddress[];
    let token: TOKEN;
    let minerReg: MinerRegistry;
    const minerBond = toBN("1000");
    const matureDuration = 100;
    const cancelDuration = 100;

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[2];
        user3 = accts[3];

        let supply = toBN("1000000000000000000000000");
        let TOKEN = await ethers.getContractFactory("TOKEN");
        token = (await TOKEN.deploy("FEE_TOKEN", "FEE_TOKEN", supply, 18)) as TOKEN;

        let factory = await ethers.getContractFactory("MinerRegistry");
        minerReg = (await factory.deploy(token.address, minerBond, matureDuration, cancelDuration)) as MinerRegistry;
    });

    describe(".updateMinerBond", () => {
        it("should revert if not called by owner", async () => {
            await expect(minerReg.connect(user2).updateMinerBond(toBN("1000"))).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should update miner bond", async () => {
            await expect(minerReg.updateMinerBond(toBN("2000")))
                .to.emit(minerReg, "UpdatedMinerBond")
                .withArgs(toBN("2000"));
            expect(await minerReg.minerBond()).to.equal(toBN("2000"));
        });
    });

    describe(".setDurations", () => {
        it("should revert if not called by owner", async () => {
            await expect(minerReg.connect(user2).setDurations(100, 100)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should set durations", async () => {
            await expect(minerReg.setDurations(200, 200)).to.emit(minerReg, "UpdatedDurations").withArgs(200, 200);
            expect(await minerReg.matureDuration()).to.equal(200);
            expect(await minerReg.cancelDuration()).to.equal(200);
        });
    });

    describe(".register", () => {
        it("should revert if sender does not have enough balance to cover bond", async () => {
            await expect(minerReg.connect(user2).register()).to.be.revertedWith("ERC20: insufficient allowance");
        });

        it("should succeed if sender has enough balance to cover bond", async () => {
            await token.approve(minerReg.address, minerBond);
            await expect(minerReg.register()).to.emit(minerReg, "Registered").withArgs(deployer.address, minerBond);
        });

        it("should revert is sender is already registered", async () => {
            await token.approve(minerReg.address, minerBond);
            await expect(minerReg.register()).to.emit(minerReg, "Registered").withArgs(deployer.address, minerBond);
            await expect(minerReg.register()).to.be.revertedWith("MR: IS_REGISTERED");
        });
    });

    describe(".cancel", () => {
        it("should revert if sender is not registered", async () => {
            await expect(minerReg.cancel()).to.be.revertedWith("MR: NOT_REGISTERED");
        });

        it("should revert if sender is not mature", async () => {
            await token.approve(minerReg.address, minerBond);
            await minerReg.register();
            await expect(minerReg.cancel()).to.be.revertedWith("MR: NOT_MATURE");
        });

        it("should succeed if sender is mature", async () => {
            await token.approve(minerReg.address, minerBond);
            await minerReg.register();
            await advanceBlockTime(matureDuration + 1);
            await expect(minerReg.cancel()).to.emit(minerReg, "Cancelled").withArgs(deployer.address, cancelDuration);
        });

        it("should revert if sender is already cancelled", async () => {
            await token.approve(minerReg.address, minerBond);
            await minerReg.register();
            await advanceBlockTime(matureDuration + 1);
            await minerReg.cancel();
            await expect(minerReg.cancel()).to.be.revertedWith("MR: IS_CANCELLED");
        });
    });

    describe(".isMiner", () => {
        it("should return false if sender is not registered", async () => {
            expect(await minerReg.isMiner(deployer.address)).to.be.false;
        });

        it("should return false if sender is registered but not mature", async () => {
            await token.approve(minerReg.address, minerBond);
            await minerReg.register();
            expect(await minerReg.isMiner(deployer.address)).to.be.false;
        });

        it("should return false if sender is registered and mature but cancelled", async () => {
            await token.approve(minerReg.address, minerBond);
            await minerReg.register();
            await advanceBlockTime(matureDuration + 1);
            await minerReg.cancel();
            expect(await minerReg.isMiner(deployer.address)).to.be.false;
        });

        it("should return true if sender is registered and mature and not cancelled", async () => {
            await token.approve(minerReg.address, minerBond);
            await minerReg.register();
            await advanceBlockTime(matureDuration + 1);
            expect(await minerReg.isMiner(deployer.address)).to.be.true;
        });
    });

    describe(".drain", () => {
        it("should revert if caller is not registered", async () => {
            await expect(minerReg.drain()).to.be.revertedWith("MR: NOT_REGISTERED");
        });

        it("should revert if sender is not cancelled", async () => {
            await token.approve(minerReg.address, minerBond);
            await minerReg.register();
            await expect(minerReg.drain()).to.be.revertedWith("MR: NOT_CANCELLED");
        });

        it("should revert if sender is cancelled but cancel duration has not passed", async () => {
            await token.approve(minerReg.address, minerBond);
            await minerReg.register();
            await advanceBlockTime(matureDuration + 1);
            await minerReg.cancel();
            await expect(minerReg.drain()).to.be.revertedWith("MR: NOT_CANCELLED");
        });

        it("should succeed if sender is cancelled and cancel duration has passed and return the bond to the sender", async () => {
            await token.approve(minerReg.address, minerBond);
            await minerReg.register();
            await advanceBlockTime(matureDuration + 1);
            await minerReg.cancel();
            await advanceBlockTime(cancelDuration + 1);
            let bal = await token.balanceOf(deployer.address);
            await expect(minerReg.drain()).to.emit(minerReg, "Drained").withArgs(deployer.address, minerBond);
            expect(await token.balanceOf(deployer.address)).to.equal(bal.add(minerBond));
            expect(await minerReg.isMiner(deployer.address)).to.be.false;

            // should be able to register again
            await token.approve(minerReg.address, minerBond);
            await expect(minerReg.register()).to.emit(minerReg, "Registered");
            await advanceBlockTime(matureDuration + 1);
            expect(await minerReg.isMiner(deployer.address)).to.be.true;
        });

        // should revert if sender is blocked
        it("should revert if sender is blocked", async () => {
            await token.approve(minerReg.address, minerBond);
            await minerReg.register();
            await advanceBlockTime(matureDuration + 1);
            await minerReg.cancel();
            await advanceBlockTime(cancelDuration + 1);
            await minerReg.toggleBlock(deployer.address);
            await expect(minerReg.drain()).to.be.revertedWith("MR: BLOCKED");
        });
    });

    describe(".addReward", () => {
        it("should revert if sender is not a writer", async () => {
            await expect(minerReg.addReward(user2.address, toBN("1000"))).to.be.revertedWith("W: NOT_WRITER");
        });

        it("should add reward to a sender", async () => {
            await minerReg.updateWriter(deployer.address, true);
            await minerReg.addReward(deployer.address, toBN("1000"));
            expect(await minerReg.rewardBalanceOf(deployer.address)).to.equal(toBN("1000"));

            await minerReg.addReward(deployer.address, toBN("1000"));
            expect(await minerReg.rewardBalanceOf(deployer.address)).to.equal(toBN("2000"));
        });

        it("should not add reward when sender is blocked", async () => {
            await token.approve(minerReg.address, minerBond);
            await minerReg.register();

            await minerReg.updateWriter(deployer.address, true);
            await minerReg.addReward(deployer.address, toBN("1000"));
            expect(await minerReg.rewardBalanceOf(deployer.address)).to.equal(toBN("1000"));

            await minerReg.toggleBlock(deployer.address);
            await minerReg.addReward(deployer.address, toBN("1000"));
            expect(await minerReg.rewardBalanceOf(deployer.address)).to.equal(toBN("1000"));

            await minerReg.toggleBlock(deployer.address);
            await minerReg.addReward(deployer.address, toBN("1000"));
            expect(await minerReg.rewardBalanceOf(deployer.address)).to.equal(toBN("2000"));
        });
    });

    describe(".withdrawReward", () => {
        it("should perform no op when sender has no reward", async () => {
            await token.transfer(minerReg.address, toBN("1000"));
            await expect(minerReg.withdrawReward()).not.to.reverted;
            expect(await token.balanceOf(minerReg.address)).to.eq("1000");
        });

        it("should withdraw reward", async () => {
            await minerReg.updateWriter(deployer.address, true);
            await minerReg.addReward(deployer.address, toBN("1000"));
            await token.transfer(minerReg.address, toBN("1000"));
            const curBal = await token.balanceOf(deployer.address);

            await expect(minerReg.withdrawReward()).not.to.reverted;
            expect(await token.balanceOf(minerReg.address)).to.eq("0");

            expect(await token.balanceOf(deployer.address)).to.eq(curBal.add("1000"));
            expect(await minerReg.rewardBalanceOf(deployer.address)).to.eq("0");
            expect(await token.balanceOf(minerReg.address)).to.eq("0");
        });
    });

    describe(".withdrawBalance", () => {
        it("should revert if sender is not owner", async () => {
            await expect(minerReg.connect(user2).withdrawBalance(user2.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        // should withdraw tokens sent to contract
        it("should withdraw tokens sent to contract", async () => {
            await token.transfer(minerReg.address, toBN("1000"));
            const curBal = await token.balanceOf(deployer.address);
            await expect(minerReg.withdrawBalance(deployer.address)).not.to.reverted;
            expect(await token.balanceOf(deployer.address)).to.eq(curBal.add("1000"));
            expect(await token.balanceOf(minerReg.address)).to.eq("0");
        });
    });

    describe(".toggleBlock", () => {
        it("should revert if sender is not owner", async () => {
            await expect(minerReg.connect(user2).toggleBlock(user2.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should revert if sender is not a miner", async () => {
            await expect(minerReg.toggleBlock(user2.address)).to.be.revertedWith("MR: NOT_REGISTERED");
        });

        it("should toggle blocked state", async () => {
            await token.approve(minerReg.address, minerBond);
            await minerReg.register();
            await advanceBlockTime(matureDuration + 1);
            expect(await minerReg.isMiner(deployer.address)).to.be.true;

            await minerReg.toggleBlock(deployer.address);
            expect((await minerReg.miners(deployer.address)).blocked).to.be.true;
            expect(await minerReg.isMiner(deployer.address)).to.be.false;

            await minerReg.toggleBlock(deployer.address);
            expect((await minerReg.miners(deployer.address)).blocked).to.be.false;
            expect(await minerReg.isMiner(deployer.address)).to.be.true;
        });
    });

    describe(".slash", () => {
        it("should revert if sender is not owner", async () => {
            await expect(minerReg.connect(user2).slash(user2.address, toBN("1000"))).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should revert if the target is not a miner", async () => {
            await expect(minerReg.slash(user2.address, toBN("1000"))).to.be.revertedWith("MR: NOT_REGISTERED");
        });

        it("should slash a miner", async () => {
            await token.approve(minerReg.address, minerBond);
            await minerReg.register();

            await expect(minerReg.slash(deployer.address, toBN("2000")))
                .to.emit(minerReg, "Slashed")
                .withArgs(deployer.address, minerBond);

            expect(await token.balanceOf(minerReg.address)).to.equal(toBN("0"));
            expect(await minerReg.isMiner(deployer.address)).to.be.false;
            expect((await minerReg.miners(deployer.address)).bond.isZero()).to.be.true;
        });

        // Unblock the miner if blocked
        it("should unblock the miner if blocked", async () => {
            await token.approve(minerReg.address, minerBond);
            await minerReg.register();
            await minerReg.toggleBlock(deployer.address);

            await expect(minerReg.slash(deployer.address, toBN("2000")))
                .to.emit(minerReg, "Slashed")
                .withArgs(deployer.address, minerBond);

            expect(await token.balanceOf(minerReg.address)).to.equal(toBN("0"));
            expect(await minerReg.isMiner(deployer.address)).to.be.false;
            expect((await minerReg.miners(deployer.address)).bond.isZero()).to.be.true;
            expect((await minerReg.miners(deployer.address)).blocked).to.be.false;
        });
    });
});
