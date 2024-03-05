import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {ethers} from "hardhat";
import {BadgeManager, ENERGON, FeePool, MINTABLE_TOKEN, NFT, TokenPool} from "../typechain-types";
import {advanceBlockTime, toBN} from "../utils/utils";

describe("FeePool", function () {
    let tokenPool: TokenPool;
    let feePool: FeePool;
    let nft: NFT;
    let energon: ENERGON;
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
    const maxSupply = 3;
    const traitsAllocs = [100, 200, 300];
    const baseURI = "ipfs://abc/";

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[2];
        notifier = accts[3];

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
        feePool = (await feePoolFac.deploy(tokenPool.address, notifier.address)) as FeePool;
        await tokenPool.setFeePool(feePool.address);
        await feePool.setRewardDuration(86400); // 1 day

        let supply2 = toBN("1000000000000000000000000");
        let energonFac = await ethers.getContractFactory("ENERGON");
        energon = (await energonFac.deploy("ENERGON", "ENR", supply2, 18)) as ENERGON;

        let nftFac = await ethers.getContractFactory("NFT");
        nft = (await nftFac.deploy("NFT", "NFT", baseURI, maxSupply, 0, feePool.address, deployer.address, energon.address, rewardToken.address)) as NFT;
        await nft.setAllocator(deployer.address);
        await nft.toggleAllowMint();
        await nft.toggleAllowAlloc();
        await nft.setCost(1);
        await feePool.setNFT(nft.address);

        let badgeFac = await ethers.getContractFactory("BadgeManager");
        badgeMgr = (await badgeFac.deploy()) as BadgeManager;
        await tokenPool.setBadgeMgrManager(badgeMgr.address);
        await feePool.setBadgeMgrManager(badgeMgr.address);
    });

    describe(".setNFT", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(feePool.connect(user2).setNFT(user2.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully set address", async () => {
            await expect(feePool.setNFT(user2.address)).not.to.be.reverted;
            expect(await feePool.nft()).to.eql(user2.address);
        });
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

    describe(".nftEarned", () => {
        let tokenId: BigNumber;
        let tokenId2: BigNumber;
        const expectedAmount = 10;

        context("with one nft staked only", () => {
            beforeEach(async () => {
                // Mint NFT
                await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                const userTokens = await nft.tokensOfOwner(deployer.address);
                expect(userTokens).to.eql([toBN(1)]);
                tokenId = userTokens[0];

                // Allocate and Stake NFT
                await energon.addMinters([nft.address]);
                await rewardToken.addMinters([nft.address]);
                const msgHash = ethers.utils.keccak256(ethers.utils.solidityPack(["address", "uint256", "uint256"], [deployer.address, tokenId, expectedAmount]));
                const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                const signedMsg = await deployer.signMessage(msgHashBytes);
                await nft.setAllocator(deployer.address);
                await expect(nft.allocate(tokenId, expectedAmount, signedMsg, {value: 300}))
                    .to.emit(nft, "Allocated")
                    .withArgs(deployer.address, tokenId, expectedAmount);

                // Add some token balance to the fee pool
                const feeAmt = tokenDec.mul(1000000);
                await feeToken.transfer(feePool.address, feeAmt);
                await feePool.connect(notifier).notifyFeeDeposit(feeToken.address, feeAmt);
            });

            it("should return correct amount after 1 day", async () => {
                nowTs = await advanceBlockTime(86400);
                expect((await feePool.nftEarned(tokenId, feeToken.address)).div(tokenDec).eq(999999)).to.be.true;
            });
        });

        context("with two nft staked only", () => {
            beforeEach(async () => {
                // Mint NFT (user 1)
                await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                const userTokens = await nft.tokensOfOwner(deployer.address);
                expect(userTokens).to.eql([toBN(1)]);
                tokenId = userTokens[0];

                // Mint NFT (user 2)
                await nft.allowAddr(user2.address, 1, true);
                await expect(nft.connect(user2).mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                const userTokens2 = await nft.tokensOfOwner(user2.address);
                expect(userTokens2).to.eql([toBN(2)]);
                tokenId2 = userTokens2[0];

                // Allocate and Stake NFT (1)
                await energon.addMinters([nft.address]);
                await rewardToken.addMinters([nft.address]);
                let msgHash = ethers.utils.keccak256(ethers.utils.solidityPack(["address", "uint256", "uint256"], [deployer.address, tokenId, expectedAmount]));
                let msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                let signedMsg = await deployer.signMessage(msgHashBytes);
                await nft.setAllocator(deployer.address);
                await expect(nft.allocate(tokenId, expectedAmount, signedMsg, {value: 300}))
                    .to.emit(nft, "Allocated")
                    .withArgs(deployer.address, tokenId, expectedAmount);

                // Allocate and Stake NFT (2)
                msgHash = ethers.utils.keccak256(ethers.utils.solidityPack(["address", "uint256", "uint256"], [user2.address, tokenId2, expectedAmount]));
                msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                signedMsg = await deployer.signMessage(msgHashBytes);
                await nft.setAllocator(deployer.address);
                await expect(nft.connect(user2).allocate(tokenId2, expectedAmount, signedMsg, {value: 300}))
                    .to.emit(nft, "Allocated")
                    .withArgs(user2.address, tokenId2, expectedAmount);

                // Add some token balance to the fee pool
                const feeAmt = tokenDec.mul(1000000);
                await feeToken.transfer(feePool.address, feeAmt);
                await feePool.connect(notifier).notifyFeeDeposit(feeToken.address, feeAmt);
            });

            it("should return correct amount after 1 day", async () => {
                nowTs = await advanceBlockTime(86400);
                expect((await feePool.nftEarned(tokenId, feeToken.address)).div(tokenDec).eq(499999)).to.be.true;
                expect((await feePool.nftEarned(tokenId2, feeToken.address)).div(tokenDec).eq(499999)).to.be.true;
            });
        });

        context("with two nft staked and one regular token stake only", () => {
            beforeEach(async () => {
                const traits = [0, 1];
                let expectedAmount = traitsAllocs[traits[0]] + traitsAllocs[traits[1]];

                // Stake User Token
                await stakingToken.approve(tokenPool.address, expectedAmount);
                await tokenPool.stake(expectedAmount);
                expect((await feePool.totalSupply()).eq(expectedAmount)).to.be.true;

                // Mint NFT (user 1)
                await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                const userTokens = await nft.tokensOfOwner(deployer.address);
                expect(userTokens).to.eql([toBN(1)]);
                tokenId = userTokens[0];

                // Mint NFT (user 2)
                await nft.allowAddr(user2.address, 1, true);
                await expect(nft.connect(user2).mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                const userTokens2 = await nft.tokensOfOwner(user2.address);
                expect(userTokens2).to.eql([toBN(2)]);
                tokenId2 = userTokens2[0];

                // Allocate and Stake NFT (1)
                await energon.addMinters([nft.address]);
                await rewardToken.addMinters([nft.address]);
                let msgHash = ethers.utils.keccak256(ethers.utils.solidityPack(["address", "uint256", "uint256"], [deployer.address, tokenId, expectedAmount]));
                let msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                let signedMsg = await deployer.signMessage(msgHashBytes);
                await nft.setAllocator(deployer.address);
                await expect(nft.allocate(tokenId, expectedAmount, signedMsg, {value: 300}))
                    .to.emit(nft, "Allocated")
                    .withArgs(deployer.address, tokenId, expectedAmount);
                expect((await feePool.totalSupply()).eq(toBN(expectedAmount).add(expectedAmount))).to.be.true;

                // Allocate and Stake NFT (2)
                msgHash = ethers.utils.keccak256(ethers.utils.solidityPack(["address", "uint256", "uint256"], [user2.address, tokenId2, expectedAmount]));
                msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                signedMsg = await deployer.signMessage(msgHashBytes);
                await nft.setAllocator(deployer.address);
                await expect(nft.connect(user2).allocate(tokenId2, expectedAmount, signedMsg, {value: 300}))
                    .to.emit(nft, "Allocated")
                    .withArgs(user2.address, tokenId2, expectedAmount);
                expect((await feePool.totalSupply()).eq(toBN(expectedAmount).add(expectedAmount).add(expectedAmount))).to.be.true;

                // Add some token balance to the fee pool
                const feeAmt = tokenDec.mul(1000000);
                await feeToken.transfer(feePool.address, feeAmt);
                await feePool.connect(notifier).notifyFeeDeposit(feeToken.address, feeAmt);
            });

            it("should return correct amount after 1 day", async () => {
                nowTs = await advanceBlockTime(86400);
                expect((await feePool.earned(deployer.address, feeToken.address)).div(tokenDec).eq(333333)).to.be.true;
                expect((await feePool.nftEarned(tokenId, feeToken.address)).div(tokenDec).eq(333333)).to.be.true;
                expect((await feePool.nftEarned(tokenId2, feeToken.address)).div(tokenDec).eq(333333)).to.be.true;
            });
        });

        context("fee pool requires badges", () => {
            it("should revert if sender does not have required badges", async () => {
                await expect(badgeMgr.registerIssuer(deployer.address, "badge", [], [])).not.to.be.reverted;
                await expect(badgeMgr.registerPath("badge", "path", [], [])).not.to.be.reverted;
                await feePool.setRequiredBadges([["badge", "path"]]);

                await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                const userTokens = await nft.tokensOfOwner(deployer.address);
                expect(userTokens).to.eql([toBN(1)]);
                tokenId = userTokens[0];

                await energon.addMinters([nft.address]);
                await rewardToken.addMinters([nft.address]);
                let msgHash = ethers.utils.keccak256(ethers.utils.solidityPack(["address", "uint256", "uint256"], [deployer.address, tokenId, expectedAmount]));
                let msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                let signedMsg = await deployer.signMessage(msgHashBytes);
                await nft.setAllocator(deployer.address);
                await expect(nft.allocate(tokenId, expectedAmount, signedMsg, {value: 300})).to.be.revertedWith("FR: NOT_PERMITTED");
            });

            it("should revert if sender does not have required badges", async () => {
                await expect(badgeMgr.registerIssuer(deployer.address, "badge", [], [])).not.to.be.reverted;
                await expect(badgeMgr.registerPath("badge", "path", [], [])).not.to.be.reverted;
                await feePool.setRequiredBadges([["badge", "path"]]);

                await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                const userTokens = await nft.tokensOfOwner(deployer.address);
                expect(userTokens).to.eql([toBN(1)]);
                tokenId = userTokens[0];

                await badgeMgr.grantBadge("badge", "path", deployer.address, 0, [], []);

                await energon.addMinters([nft.address]);
                await rewardToken.addMinters([nft.address]);
                let msgHash = ethers.utils.keccak256(ethers.utils.solidityPack(["address", "uint256", "uint256"], [deployer.address, tokenId, expectedAmount]));
                let msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                let signedMsg = await deployer.signMessage(msgHashBytes);
                await nft.setAllocator(deployer.address);
                await expect(nft.allocate(tokenId, expectedAmount, signedMsg, {value: 300})).not.to.be.reverted;
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

    describe(".withdrawNFTReward", () => {
        let tokenId: BigNumber;
        let expectedAmount = 10;

        beforeEach(async () => {
            // Mint NFT
            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
            const userTokens = await nft.tokensOfOwner(deployer.address);
            expect(userTokens).to.eql([toBN(1)]);
            tokenId = userTokens[0];

            // Allocate and Stake NFT
            await energon.addMinters([nft.address]);
            await rewardToken.addMinters([nft.address]);
            let msgHash = ethers.utils.keccak256(ethers.utils.solidityPack(["address", "uint256", "uint256"], [deployer.address, tokenId, expectedAmount]));
            let msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
            let signedMsg = await deployer.signMessage(msgHashBytes);
            await nft.setAllocator(deployer.address);
            await expect(nft.allocate(tokenId, expectedAmount, signedMsg, {value: 300}))
                .to.emit(nft, "Allocated")
                .withArgs(deployer.address, tokenId, expectedAmount);
            expect(await feePool.nftBalanceOf(tokenId)).to.eql(toBN(expectedAmount));

            // Add some token balance to the fee pool
            const feeAmt = tokenDec.mul(1000000);
            await feeToken.transfer(feePool.address, feeAmt);
            await feePool.connect(notifier).notifyFeeDeposit(feeToken.address, feeAmt);
        });

        it("should revert with msg=NOT_OWNER when sender is not the NFT owner", async () => {
            await expect(feePool.connect(user2).withdrawNFTReward(tokenId, feeToken.address, tokenDec.mul(100000))).to.revertedWith("FR: NOT_OWNER");
        });

        it("should revert with msg=INSUFFICIENT_BALANCE when NFT has earned less than the requested amount", async () => {
            await expect(feePool.withdrawNFTReward(tokenId, feeToken.address, tokenDec.mul(100000))).to.revertedWith("FR: INSUFFICIENT_BALANCE");
        });

        it("should withdraw correctly", async () => {
            nowTs = await advanceBlockTime(86400);
            expect((await feePool.nftEarned(tokenId, feeToken.address)).div(tokenDec).eq(999999)).to.be.true;

            // withdraw some
            let before = await feeToken.balanceOf(deployer.address);
            await expect(feePool.withdrawNFTReward(tokenId, feeToken.address, tokenDec.mul(100000)))
                .to.emit(feePool, "RewardNFTWithdrawn")
                .withArgs(tokenId, feeToken.address, deployer.address, tokenDec.mul(100000));
            expect((await feePool.nftEarned(tokenId, feeToken.address)).div(tokenDec).eq(899999)).to.be.true;
            expect(await feeToken.balanceOf(deployer.address)).to.eql(before.add(tokenDec.mul(100000)));

            // withdraw the rest
            before = await feeToken.balanceOf(deployer.address);
            await feePool.withdrawNFTReward(tokenId, feeToken.address, tokenDec.mul(899999));
            expect((await feePool.nftEarned(tokenId, feeToken.address)).div(tokenDec).eq(0)).to.be.true;
            expect(await feeToken.balanceOf(deployer.address)).to.eql(before.add(tokenDec.mul(899999)));
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
