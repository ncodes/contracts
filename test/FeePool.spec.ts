import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {BadgeManager, FeePool, MINTABLE_TOKEN, TokenPool, WETH9} from "../typechain-types";
import {advanceBlockTime, toBN} from "../utils/utils";

describe("FeePool", function () {
    let tokenPool: TokenPool;
    let feePool: FeePool;
    let weth: WETH9;
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let notifier: SignerWithAddress;
    let accts: SignerWithAddress[];
    let stakingToken: MINTABLE_TOKEN;
    let rewardToken: MINTABLE_TOKEN;
    let feeToken: MINTABLE_TOKEN;
    let feeToken2: MINTABLE_TOKEN;
    let badgeMgr: BadgeManager;
    let tokenDec = toBN(10).pow(18);
    let nowTs: number;

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[2];
        notifier = accts[3];

        let wethFac = await ethers.getContractFactory("WETH9");
        weth = (await wethFac.deploy()) as WETH9;

        let supply = toBN("500000000000000000000000000");
        let tokenFac = await ethers.getContractFactory("MINTABLE_TOKEN");
        stakingToken = (await tokenFac.deploy("STAKE_TOKEN", "STAKE_TOKEN", supply, 18)) as MINTABLE_TOKEN;
        rewardToken = (await tokenFac.deploy("REWARD_TOKEN", "REWARD_TOKEN", supply, 18)) as MINTABLE_TOKEN;
        feeToken = (await tokenFac.deploy("FEE_TOKEN", "FEE_TOKEN", supply, 18)) as MINTABLE_TOKEN;
        feeToken2 = (await tokenFac.deploy("FEE_TOKEN_B", "FEE_TOKEN_B", supply, 18)) as MINTABLE_TOKEN;
        tokenDec = toBN(10).pow(18);

        let tokenPoolFac = await ethers.getContractFactory("TokenPool");
        tokenPool = (await tokenPoolFac.deploy(stakingToken.address, rewardToken.address)) as TokenPool;

        let feePoolFac = await ethers.getContractFactory("FeePool");
        feePool = (await feePoolFac.deploy(tokenPool.address, notifier.address, weth.address)) as FeePool;
        await tokenPool.setFeePool(feePool.address);
        await feePool.setRewardDuration(86400); // 1 day

        let supply2 = toBN("1000000000000000000000000");
        let energonFac = await ethers.getContractFactory("ENERGON");

        let badgeFac = await ethers.getContractFactory("BadgeManager");
        badgeMgr = (await badgeFac.deploy()) as BadgeManager;
        await tokenPool.setBadgeMgrManager(badgeMgr.address);
        await feePool.setBadgeMgrManager(badgeMgr.address);
    });

    describe(".setTokenPool", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(feePool.connect(user2).setTokenPool(user2.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully set address", async () => {
            await expect(feePool.setTokenPool(user2.address)).not.to.be.reverted;
            expect(await feePool.tokenPool()).to.eql(user2.address);
        });
    });

    describe(".setNotifier", () => {
        it("should", async () => {
            it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
                await expect(feePool.connect(user2).setNotifier(user2.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
            });

            it("should successfully set address", async () => {
                await expect(feePool.setNotifier(user2.address)).not.to.be.reverted;
                expect(await feePool.notifier()).to.eql(user2.address);
            });
        });
    });

    describe(".rewardPerToken & earned", () => {
        it("should return zero when staking contract has zero supply", async () => {
            expect(await tokenPool.totalSupply()).to.eql(toBN(0));
            expect(await feePool.rewardPerToken(feeToken.address)).to.eql(toBN(0));
        });

        context("when one user deposited into the staking pool contract", () => {
            beforeEach(async () => {
                const dur = 60 * 86400;

                // Add reward
                const totalReward = tokenDec.mul(1000);
                await rewardToken.transfer(tokenPool.address, totalReward);
                await tokenPool.notifyRewardAmount(totalReward, dur);

                // Stake
                await stakingToken.approve(tokenPool.address, tokenDec.mul(1000));
                await tokenPool.stake(1000);

                // expect fee reward contract to be notified of user's stake
                expect((await feePool.totalSupply()).eq(1000)).to.be.true;
                expect((await feePool.balanceOf(deployer.address)).eq(1000)).to.be.true;
            });

            it("should return zero when no token fee was transferred to the fee pool", async () => {
                expect(await feePool.rewardPerToken(feeToken.address)).to.eql(toBN(0));
                expect(await feePool.earned(deployer.address, feeToken.address)).to.eql(toBN(0));
            });

            context("when fee pool received a token transfer", () => {
                beforeEach(async () => {
                    const feeAmt = tokenDec.mul(1000000);
                    await feeToken.transfer(feePool.address, feeAmt);
                    await feePool.connect(notifier).notifyFeeDeposit(feeToken.address, feeAmt);
                });

                it("should return correct amount after 1 day", async () => {
                    await advanceBlockTime(86400);
                    expect((await feePool.earned(deployer.address, feeToken.address)).div(tokenDec).eq(999999)).to.be.true;
                });

                it("should return correct amount after 2 day", async () => {
                    await advanceBlockTime(86400 * 2);
                    expect((await feePool.earned(deployer.address, feeToken.address)).div(tokenDec).eq(999999)).to.be.true;
                });

                it("should return correct amount when new fee deposit is added", async () => {
                    await advanceBlockTime(86400);
                    expect((await feePool.earned(deployer.address, feeToken.address)).div(tokenDec).eq(999999)).to.be.true;

                    // new deposit
                    const feeAmt = tokenDec.mul(1000000);
                    await feeToken.transfer(feePool.address, feeAmt);
                    await feePool.connect(notifier).notifyFeeDeposit(feeToken.address, feeAmt);

                    // after 1 day, verify earning
                    await advanceBlockTime(86400);
                    expect((await feePool.earned(deployer.address, feeToken.address)).div(tokenDec).eq(1999999)).to.be.true;
                });
            });
        });

        context("fee pool requires badges", () => {
            it("should not update stake in fee pool if sender does not have required badges", async () => {
                await expect(badgeMgr.registerIssuer(deployer.address, "badge", [], [])).not.to.be.reverted;
                await expect(badgeMgr.registerPath("badge", "path", [], [])).not.to.be.reverted;
                await feePool.setRequiredBadges([["badge", "path"]]);

                const dur = 60 * 86400;
                const totalReward = tokenDec.mul(1000);
                await rewardToken.transfer(tokenPool.address, totalReward);
                await tokenPool.notifyRewardAmount(totalReward, dur);

                await stakingToken.approve(tokenPool.address, tokenDec.mul(1000));
                await expect(tokenPool.stake(1000)).not.to.be.reverted;

                expect((await feePool.totalSupply()).eq(0)).to.be.true;
                expect((await feePool.balanceOf(deployer.address)).eq(0)).to.be.true;
            });

            it("should update stake in fee pool if sender has required badges", async () => {
                await expect(badgeMgr.registerIssuer(deployer.address, "badge", [], [])).not.to.be.reverted;
                await expect(badgeMgr.registerPath("badge", "path", [], [])).not.to.be.reverted;
                await feePool.setRequiredBadges([["badge", "path"]]);

                const dur = 60 * 86400;
                const totalReward = tokenDec.mul(1000);
                await rewardToken.transfer(tokenPool.address, totalReward);
                await tokenPool.notifyRewardAmount(totalReward, dur);

                await badgeMgr.grantBadge("badge", "path", deployer.address, 0, [], []);

                await stakingToken.approve(tokenPool.address, tokenDec.mul(1000));
                await expect(tokenPool.stake(1000)).not.to.be.reverted;

                expect((await feePool.totalSupply()).eq(1000)).to.be.true;
                expect((await feePool.balanceOf(deployer.address)).eq(1000)).to.be.true;
            });
        });

        context("when two users deposited into staking contract at (almost) same time", () => {
            beforeEach(async () => {
                const dur = 60 * 86400;

                // Add reward
                const totalReward = tokenDec.mul(1000);
                await rewardToken.transfer(tokenPool.address, totalReward);
                await tokenPool.notifyRewardAmount(totalReward, dur);

                // Stake
                await stakingToken.transfer(user2.address, tokenDec.mul(1000));
                await stakingToken.approve(tokenPool.address, tokenDec.mul(1000));
                await stakingToken.connect(user2).approve(tokenPool.address, tokenDec.mul(1000));
                await tokenPool.stake(1000);
                await tokenPool.connect(user2).stake(1000);

                // expect fee reward contract to be notified of user's stake
                expect((await feePool.totalSupply()).eq(2000)).to.be.true;
                expect((await feePool.balanceOf(deployer.address)).eq(1000)).to.be.true;
            });

            context("when contract is notified of fee transfer", () => {
                beforeEach(async () => {
                    const feeAmt = tokenDec.mul(1000000);
                    await feeToken.transfer(feePool.address, feeAmt);
                    await feePool.connect(notifier).notifyFeeDeposit(feeToken.address, feeAmt);
                });

                it("should return correct amount after 1 day", async () => {
                    nowTs = await advanceBlockTime(86400);
                    expect((await feePool.rewardPerToken(feeToken.address)).div(tokenDec).div(tokenDec).eq(499)).to.be.true;
                    expect((await feePool.connect(user2).rewardPerToken(feeToken.address)).div(tokenDec).div(tokenDec).eq(499)).to.be.true;
                    expect((await feePool.earned(deployer.address, feeToken.address)).div(tokenDec).eq(499999)).to.be.true;
                    expect((await feePool.earned(user2.address, feeToken.address)).div(tokenDec).eq(499999)).to.be.true;
                });
            });
        });
    });

    describe(".notifyFeeDeposit", () => {
        it("should revert with msg= when zero amount was provided", async () => {
            await expect(feePool.connect(notifier).notifyFeeDeposit(feeToken.address, 0)).to.be.revertedWith("FR: AMOUNT_REQ");
        });

        it("should revert with msg=REWARD_TOO_HIGH when amount is greater than actual token balance", async () => {
            const feeAmt = tokenDec.mul(1000000);
            await expect(feePool.connect(notifier).notifyFeeDeposit(feeToken.address, feeAmt)).to.be.revertedWith("FR: REWARD_TOO_HIGH");
        });

        it("should update state correctly when token period has not been set", async () => {
            const feeAmt = tokenDec.mul(1000000);
            await feeToken.transfer(feePool.address, feeAmt);
            const nowTs = await advanceBlockTime(1);
            await expect(feePool.connect(notifier).notifyFeeDeposit(feeToken.address, feeAmt)).not.to.be.reverted;
            expect((await feePool.rewardRates(feeToken.address)).div(tokenDec).eq(11)).to.be.true;
            expect((await feePool.periodFinish(feeToken.address)).toNumber()).to.eql(nowTs + 86400 + 1);
        });

        it("should re-calculate reward rate when period has not ended", async () => {
            let feeAmt = tokenDec.mul(1000000);
            await feeToken.transfer(feePool.address, feeAmt);
            await expect(feePool.connect(notifier).notifyFeeDeposit(feeToken.address, feeAmt)).not.to.be.reverted;

            feeAmt = tokenDec.mul(1000000);
            await feeToken.transfer(feePool.address, feeAmt);
            nowTs = await advanceBlockTime(3600 * 12); // advance 12 hours
            await expect(feePool.connect(notifier).notifyFeeDeposit(feeToken.address, feeAmt)).not.to.be.reverted;
            expect((await feePool.rewardRates(feeToken.address)).div(tokenDec).eq(17)).to.be.true;
            expect((await feePool.periodFinish(feeToken.address)).toNumber()).to.greaterThanOrEqual(nowTs + 86400);
        });
    });

    describe(".withdrawReward", () => {
        let nowTs: number;

        beforeEach(async () => {
            const dur = 86400;

            // Add reward token
            const totalReward = tokenDec.mul(1000);
            await rewardToken.transfer(tokenPool.address, totalReward);
            await tokenPool.notifyRewardAmount(totalReward, dur);

            // Stake
            await stakingToken.approve(tokenPool.address, tokenDec.mul(1000));
            await tokenPool.stake(1000);

            const feeAmt = tokenDec.mul(1000000);
            await feeToken.transfer(feePool.address, feeAmt);
            await expect(feePool.connect(notifier).notifyFeeDeposit(feeToken.address, feeAmt)).not.to.be.reverted;

            // expect fee reward contract to be notified of user's stake
            expect((await feePool.totalSupply()).eq(1000)).to.be.true;
            expect((await feePool.balanceOf(deployer.address)).eq(1000)).to.be.true;
        });

        it("should successfully withdraw full reward", async () => {
            nowTs = await advanceBlockTime(86400);
            let earned = await feePool.earned(deployer.address, feeToken.address);
            const beforeBal = await feeToken.balanceOf(deployer.address);
            await feePool.withdrawReward(feeToken.address, earned);
            expect((await feeToken.balanceOf(deployer.address)).eq(beforeBal.add(earned))).to.be.true;
            earned = await feePool.earned(deployer.address, feeToken.address);
            expect(earned.isZero()).to.be.true;
        });

        it("should successfully withdraw part of the reward", async () => {
            nowTs = await advanceBlockTime(86400);
            let earned = await feePool.earned(deployer.address, feeToken.address);
            const beforeBal = await feeToken.balanceOf(deployer.address);
            await feePool.withdrawReward(feeToken.address, earned.div(2));
            expect((await feeToken.balanceOf(deployer.address)).eq(beforeBal.add(earned.div(2)))).to.be.true;
            const earned2 = await feePool.earned(deployer.address, feeToken.address);
            expect(earned2.eq(earned.div(2))).to.be.true;
        });
    });

    describe(".recoverERC20", () => {
        beforeEach(async () => {
            const dur = 86400;

            // Add reward token
            const totalReward = tokenDec.mul(1000);
            await rewardToken.transfer(tokenPool.address, totalReward);
            await tokenPool.notifyRewardAmount(totalReward, dur);

            // Stake
            await stakingToken.approve(tokenPool.address, tokenDec.mul(1000));
            await tokenPool.stake(1000);

            const feeAmt = tokenDec.mul(1000000);
            await feeToken.transfer(feePool.address, feeAmt);
            await expect(feePool.connect(notifier).notifyFeeDeposit(feeToken.address, feeAmt)).not.to.be.reverted;

            // expect fee reward contract to be notified of user's stake
            expect((await feePool.totalSupply()).eq(1000)).to.be.true;
            expect((await feePool.balanceOf(deployer.address)).eq(1000)).to.be.true;
        });

        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(feePool.connect(user2).recoverERC20(feeToken.address, 1000)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should revert with reason=FR: INVALID_TOKEN_ADDRESS when token address is one of the fee tokens", async () => {
            await expect(feePool.recoverERC20(feeToken.address, 1000)).to.be.revertedWith("FR: INVALID_TOKEN_ADDRESS");
        });

        it("should successfully recover token", async () => {
            await feeToken2.transfer(feePool.address, 1000);
            await expect(feePool.recoverERC20(feeToken2.address, 1000)).not.to.be.reverted;
        });
    });
});
