import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {ethers} from "hardhat";
import {BadgeManager, FeePool, TOKEN, TokenPool, WETH9} from "../typechain-types";
import {advanceBlockTime, toBN} from "../utils/utils";

describe("TokenPool", function () {
    let tokenPool: TokenPool;
    let feePool: FeePool;
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let accts: SignerWithAddress[];
    let stakingToken: TOKEN;
    let rewardToken: TOKEN;
    let tokenDec: BigNumber;
    let badgeMgr: BadgeManager;
    let weth: WETH9;

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[2];
        user3 = accts[3];

        let supply = toBN("500000000000000000000000000");
        let TOKEN = await ethers.getContractFactory("TOKEN");
        stakingToken = (await TOKEN.deploy("STAKE_TOKEN", "STAKE_TOKEN", supply, 18)) as TOKEN;
        rewardToken = (await TOKEN.deploy("REWARD_TOKEN", "REWARD_TOKEN", supply, 18)) as TOKEN;
        tokenDec = toBN(10).pow(18);

        let wethFac = await ethers.getContractFactory("WETH9");
        weth = (await wethFac.deploy()) as WETH9;

        let tokenPoolFac = await ethers.getContractFactory("TokenPool");
        tokenPool = (await tokenPoolFac.deploy(stakingToken.address, rewardToken.address)) as TokenPool;

        let feePoolFac = await ethers.getContractFactory("FeePool");
        feePool = (await feePoolFac.deploy(tokenPool.address, accts[4].address, weth.address)) as FeePool;
        await tokenPool.setFeePool(feePool.address);

        let badgeFac = await ethers.getContractFactory("BadgeManager");
        badgeMgr = (await badgeFac.deploy()) as BadgeManager;
        await tokenPool.setBadgeMgrManager(badgeMgr.address);
    });

    describe(".setFeePool", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(tokenPool.connect(user2).setFeePool(user2.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully set address", async () => {
            await expect(tokenPool.setFeePool(user2.address)).not.to.be.reverted;
            expect(await tokenPool.feePool()).to.eql(user2.address);
        });
    });

    describe(".stake", () => {
        beforeEach(async () => {
            await stakingToken.transfer(user2.address, tokenDec.mul(1000));
            await stakingToken.connect(user2).approve(tokenPool.address, tokenDec.mul(1000));
        });

        it("should revert with msg=AMOUNT_REQ when 0 amount is passed", async () => {
            await expect(tokenPool.connect(user2).stake(0)).to.be.revertedWith("AMOUNT_REQ");
        });

        it("should add stake successfully", async () => {
            await expect(tokenPool.connect(user2).stake(1000)).not.to.be.reverted;
            expect(await tokenPool.balanceOf(user2.address)).to.eql(toBN(1000));
        });

        context("when required badges are set", () => {
            it("should revert if sender does not have required badges", async () => {
                await expect(badgeMgr.registerIssuer(deployer.address, "badge", [], [])).not.to.be.reverted;
                await expect(badgeMgr.registerPath("badge", "path", [], [])).not.to.be.reverted;
                await tokenPool.setRequiredBadges([["badge", "path"]]);
                await expect(tokenPool.connect(user2).stake(1000)).to.be.revertedWith("NOT_PERMITTED");
            });

            it("should not revert if sender has required badges", async () => {
                await tokenPool.setRequiredBadges([["badge", "path"]]);
                await expect(badgeMgr.registerIssuer(deployer.address, "badge", [], [])).not.to.be.reverted;
                await expect(badgeMgr.registerPath("badge", "path", [], [])).not.to.be.reverted;
                await badgeMgr.grantBadge("badge", "path", deployer.address, 0, [], []);
                await stakingToken.approve(tokenPool.address, 1000);
                await expect(tokenPool.stake(1000)).not.to.be.reverted;
            });
        });
    });

    describe(".rewardPerToken", () => {
        it("should return zero when no reward rate has been set", async () => {
            const res = await tokenPool.rewardPerToken();
            expect(res.eq(0)).to.be.true;
        });

        it("should return correct reward per token", async () => {
            const dur = 60 * 86400;

            const totalReward = tokenDec.mul(1000);
            await rewardToken.transfer(tokenPool.address, totalReward);
            await tokenPool.notifyRewardAmount(totalReward, dur);

            // stake some tokens
            const userStake = tokenDec.mul(1000);
            await stakingToken.approve(tokenPool.address, userStake);
            await tokenPool.stake(userStake);

            await advanceBlockTime(1);
            const rewardPerToken = await tokenPool.rewardPerToken();

            // Verify that it is correct
            const rewardAllToken = rewardPerToken.mul(userStake);
            const expectedRewardAtPeriodEnd = (await tokenPool.rewardsDuration()).mul(rewardAllToken);
            expect(expectedRewardAtPeriodEnd.div(tokenDec).eq("999999999995328000000")).to.be.true;

            // Expect correct earned amount at the end of the reward duration
            await advanceBlockTime(dur);
            expect(await tokenPool.earned(deployer.address)).to.eql(toBN("999999614197529648000"));
        });
    });

    describe("when two accounts stake same amount at (almost) same time", () => {
        let nowTs;

        beforeEach(async () => {
            const dur = 60 * 86400;
            const totalReward = tokenDec.mul(1000);
            await rewardToken.transfer(tokenPool.address, totalReward);
            await tokenPool.notifyRewardAmount(totalReward, dur);
            await stakingToken.approve(tokenPool.address, tokenDec.mul(1000));
            await stakingToken.transfer(user2.address, tokenDec.mul(1000));
            await stakingToken.connect(user2).approve(tokenPool.address, tokenDec.mul(1000));

            // user 1: stake
            await tokenPool.stake(tokenDec.mul(1000));

            // user 2: stake
            await tokenPool.connect(user2).stake(tokenDec.mul(1000));
        });

        specify("that both accounts have (almost) the same rewards", async () => {
            nowTs = await advanceBlockTime(60 * 86400); // move 60 days into the future
            const user1Earning = await tokenPool.earned(deployer.address);
            const user2Earning = await tokenPool.earned(user2.address);
            expect(user1Earning.div(user2Earning).eq(1)).to.be.true;
        });
    });

    describe(".withdrawReward", () => {
        beforeEach(async () => {
            const dur = 60 * 86400;
            const totalReward = tokenDec.mul(1000);
            await rewardToken.transfer(tokenPool.address, totalReward);
            await tokenPool.notifyRewardAmount(totalReward, dur);

            // stake some tokens
            const userStake = tokenDec.mul(1000);
            await stakingToken.approve(tokenPool.address, userStake);
            await tokenPool.stake(userStake);

            await advanceBlockTime(dur);
        });

        it("should revert with reason=INSUFFICIENT_BALANCE when user has insufficient reward balance", async () => {
            await expect(tokenPool.connect(user2).withdrawReward(tokenDec.mul(2))).to.be.revertedWith("INSUFFICIENT_BALANCE");
        });

        it("should successfully withdraw reward", async () => {
            const beforeBal = await rewardToken.balanceOf(deployer.address);
            const earned = await tokenPool.earned(deployer.address);
            await tokenPool.withdrawReward(earned);
            expect(await rewardToken.balanceOf(deployer.address)).to.eql(beforeBal.add(earned));
        });
    });

    describe(".exit", () => {
        let userStake: BigNumber;

        beforeEach(async () => {
            const dur = 60 * 86400;

            const totalReward = tokenDec.mul(1000);
            await rewardToken.transfer(tokenPool.address, totalReward);
            await tokenPool.notifyRewardAmount(totalReward, dur);

            // stake some tokens
            userStake = tokenDec.mul(1000);
            await stakingToken.approve(tokenPool.address, userStake);
            await tokenPool.stake(userStake);

            await advanceBlockTime(dur);
        });

        it("should successfully both stake and reward earned", async () => {
            const rewardBal = await rewardToken.balanceOf(deployer.address);
            const stakeBal = await stakingToken.balanceOf(deployer.address);
            const earned = await tokenPool.earned(deployer.address);
            await tokenPool.exit();
            expect(await rewardToken.balanceOf(deployer.address)).to.eql(rewardBal.add(earned));
            expect(await stakingToken.balanceOf(deployer.address)).to.eql(stakeBal.add(userStake));
        });
    });

    describe(".recoverERC20", () => {
        it("should revert with reason=INVALID_TOKEN_ADDRESS when asset is the staking asset", async () => {
            await stakingToken.approve(tokenPool.address, tokenDec.mul(1000));
            await tokenPool.stake(1000);
            await expect(tokenPool.recoverERC20(stakingToken.address, 1)).to.be.revertedWith("TP: INVALID_TOKEN_ADDRESS");
        });

        it("should withdraw successfully", async () => {
            const bal = await rewardToken.balanceOf(deployer.address);
            await rewardToken.transfer(tokenPool.address, tokenDec.mul(1000));
            const bal2 = await rewardToken.balanceOf(deployer.address);
            expect(bal.eq(bal2)).to.be.false;
            await tokenPool.recoverERC20(rewardToken.address, tokenDec.mul(1000));
            const bal3 = await rewardToken.balanceOf(deployer.address);
            expect(bal.eq(bal3)).to.be.true;
        });
    });

    describe(".pause & .unpause", () => {
        it("should not allow staking when paused", async () => {
            await stakingToken.approve(tokenPool.address, tokenDec.mul(1000));
            await tokenPool.pause();
            await expect(tokenPool.stake(1000)).to.be.revertedWith("Pausable: paused");
        });

        it("should allow staking when unpaused", async () => {
            await stakingToken.approve(tokenPool.address, tokenDec.mul(1000));
            await tokenPool.pause();
            await expect(tokenPool.stake(1000)).to.be.revertedWith("Pausable: paused");
            await tokenPool.unpause();
            await expect(tokenPool.stake(1000)).not.to.be.reverted;
        });

        it("should revert when trying to unpause when not paused", async () => {
            await expect(tokenPool.unpause()).to.be.revertedWith("Pausable: not paused");
        });

        it("should revert when trying to pause when already paused", async () => {
            await tokenPool.pause();
            await expect(tokenPool.pause()).to.be.revertedWith("Pausable: paused");
        });
    });

    describe(".withdraw", () => {
        it("should successfully withdraw stake", async () => {
            const userStake = tokenDec.mul(1000);
            await stakingToken.transfer(user2.address, userStake);
            await stakingToken.connect(user2).approve(tokenPool.address, userStake);

            // stake 1000
            await tokenPool.connect(user2).stake(tokenDec.mul(1000));

            // withdraw 100
            await expect(tokenPool.connect(user2).withdraw(100)).not.to.be.reverted;
            expect((await stakingToken.balanceOf(user2.address)).eq(100)).to.be.true;
            expect((await tokenPool.balanceOf(user2.address)).eq(tokenDec.mul(1000).sub(100))).to.be.true;
        });
    });
});
