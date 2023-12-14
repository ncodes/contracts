import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {ethers} from "hardhat";
import {LPPool, TOKEN} from "../typechain-types";
import {advanceBlockTime, toBN} from "../utils/utils";

describe("LPPool", function () {
    let lpr: LPPool;
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let accts: SignerWithAddress[];
    let rewardToken: TOKEN;
    let lpToken: TOKEN;
    let tokenDec: BigNumber;

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[2];
        user3 = accts[2];

        let supply = toBN("500000000000000000000000000");
        let TOKEN = await ethers.getContractFactory("TOKEN");
        lpToken = (await TOKEN.deploy("LP_TOKEN", "LP_TOKEN", supply, 18)) as TOKEN;
        rewardToken = (await TOKEN.deploy("REWARD_TOKEN", "REWARD_TOKEN", supply, 18)) as TOKEN;
        tokenDec = toBN(10).pow(18);

        let factory = await ethers.getContractFactory("LPPool");
        lpr = (await factory.deploy(lpToken.address, rewardToken.address)) as LPPool;
    });

    describe(".setPoolToken", () => {
        it("should revert with reason= when sender is not owner", async () => {
            await expect(lpr.connect(user2).setPoolToken(lpToken.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully update pool token", async () => {
            await expect(lpr.setPoolToken(user2.address)).not.to.be.reverted;
            expect(await lpr.poolToken()).to.be.eql(user2.address);
        });
    });

    describe(".lock", () => {
        it("should successfully lock tokens", async () => {
            const supply = await lpToken.totalSupply();
            await lpToken.approve(lpr.address, supply);
            await lpr.lock();
            expect(await lpr.totalSupply()).to.eql(supply);
            expect(await lpr.balanceOf(deployer.address)).to.eql(supply);
            expect(await lpToken.balanceOf(deployer.address)).to.eql(toBN(0));
        });

        it("should revert when paused", async () => {
            await lpr.pause();
            const supply = await lpToken.totalSupply();
            await lpToken.approve(lpr.address, supply);
            await expect(lpr.lock()).to.be.revertedWith("Pausable: paused");
        });
    });

    describe(".unlock", () => {
        it("should successfully unlock tokens", async () => {
            const supply = await lpToken.totalSupply();
            await lpToken.approve(lpr.address, supply);
            await lpr.lock();
            expect(await lpr.totalSupply()).to.eql(supply);
            expect(await lpr.balanceOf(deployer.address)).to.eql(supply);
            expect(await lpToken.balanceOf(deployer.address)).to.eql(toBN(0));

            await lpr.unlock();
            expect(await lpToken.balanceOf(deployer.address)).to.eql(supply);
        });
    });

    describe(".rewardPerToken & earned", () => {
        it("should return zero when no token is locked", async () => {
            expect(await lpr.rewardPerToken()).to.eql(toBN(0));
        });

        it("should return zero if contract was not notified of reward deposit", async () => {
            await lpToken.approve(lpr.address, await lpToken.totalSupply());
            await lpr.lock();
            expect(await lpr.rewardPerToken()).to.eql(toBN(0));
        });

        it("should return correct reward per token after 1 day", async () => {
            await lpToken.approve(lpr.address, await lpToken.totalSupply());
            await lpr.lock();

            await rewardToken.transfer(lpr.address, tokenDec.mul(1000000));
            await lpr.notifyRewardDeposit(tokenDec.mul(1000000), 86400);

            // set chain time 1 day in the future
            await advanceBlockTime(86400);
            expect((await lpr.rewardPerToken()).eq("1999999999999999")).to.be.true;
            expect((await lpr.earned(deployer.address)).div(tokenDec)).to.be.eql(toBN("999999"));
        });

        it("should return correct reward per token after 2 days", async () => {
            await lpToken.approve(lpr.address, await lpToken.totalSupply());
            await lpr.lock();

            await rewardToken.transfer(lpr.address, tokenDec.mul(1000000));
            await lpr.notifyRewardDeposit(tokenDec.mul(1000000), 86400);

            // set chain time 1 day in the future
            await advanceBlockTime(86400 * 2);
            expect((await lpr.rewardPerToken()).eq("1999999999999999")).to.be.true;
            expect((await lpr.earned(deployer.address)).div(tokenDec)).to.be.eql(toBN("999999"));
        });
    });

    describe(".withdrawReward", () => {
        it("should revert with reason=LPP: INSUFFICIENT_BALANCE when sender has insufficient reward balance", async () => {
            await expect(lpr.withdrawReward(100)).to.be.revertedWith("LPP: INSUFFICIENT_BALANCE");
        });

        it("should withdraw some reward", async () => {
            await lpToken.approve(lpr.address, await lpToken.totalSupply());
            await lpr.lock();

            await rewardToken.transfer(lpr.address, tokenDec.mul(1000000));
            await lpr.notifyRewardDeposit(tokenDec.mul(1000000), 86400);

            // set chain time 1 day in the future
            await advanceBlockTime(86400);

            let curBal = await rewardToken.balanceOf(deployer.address);

            await expect(lpr.withdrawReward(tokenDec.mul(500000))).not.to.be.reverted;
            expect(await rewardToken.balanceOf(deployer.address)).to.eql(curBal.add(tokenDec.mul(500000)));
        });
    });

    describe(".recoverERC20", () => {
        it("should revert with reason=INVALID_TOKEN_ADDRESS when asset is the lp token", async () => {
            await lpToken.approve(lpr.address, await lpToken.totalSupply());
            await lpr.lock();
            await expect(lpr.recoverERC20(lpToken.address, 1)).to.be.revertedWith("LPP: INVALID_TOKEN_ADDRESS");
        });

        it("should withdraw successfully", async () => {
            const bal = await rewardToken.balanceOf(deployer.address);
            await rewardToken.transfer(lpr.address, tokenDec.mul(1000));

            const bal2 = await rewardToken.balanceOf(deployer.address);
            expect(bal.eq(bal2)).to.be.false;

            await lpr.recoverERC20(rewardToken.address, tokenDec.mul(1000));
            const bal3 = await rewardToken.balanceOf(deployer.address);
            expect(bal.eq(bal3)).to.be.true;
        });
    });

    describe(".notifyRewardDeposit", () => {
        it("should revert when amount is zero", async () => {
            await expect(lpr.notifyRewardDeposit(0, 1)).to.be.revertedWith("LPP: AMOUNT_REQ");
        });

        it("should set rate correctly when called for the first time", async () => {
            await lpToken.approve(lpr.address, await lpToken.totalSupply());
            await lpr.lock();
            const supply = await rewardToken.totalSupply();
            await rewardToken.transfer(lpr.address, supply);
            const nowTs = await advanceBlockTime(1);
            await expect(lpr.notifyRewardDeposit(supply, 86400)).not.to.be.reverted;
            expect(await lpr.rewardRate()).to.eql(supply.div(86400));
            expect(await lpr.lastUpdateTime()).to.eql(toBN(nowTs + 1));
            expect(await lpr.periodFinish()).to.eql(toBN(nowTs + 1 + 86400));
            expect(await lpr.rewardsDuration()).to.eql(toBN(86400));
        });

        it("should reset reward rate correctly when called again and before periodFinish has passed", async () => {
            await lpToken.approve(lpr.address, await lpToken.totalSupply());
            await lpr.lock();
            const supply = await rewardToken.totalSupply();
            await rewardToken.transfer(lpr.address, supply.div(2));
            await advanceBlockTime(1);
            await expect(lpr.notifyRewardDeposit(supply.div(2), 86400)).not.to.be.reverted;

            const oldRewardRate = await lpr.rewardRate();
            await advanceBlockTime(43200);

            const dur = 86400;
            await rewardToken.transfer(lpr.address, supply.div(2));
            await expect(lpr.notifyRewardDeposit(supply.div(2), dur)).not.to.be.reverted;
            expect(oldRewardRate.eq(await lpr.rewardRate())).to.be.false;
        });
    });
});
