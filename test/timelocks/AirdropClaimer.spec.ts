import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {AirdropClaimer, TOKEN, TimelockWallet, VestingWallet} from "../../typechain-types";
import {advanceBlockTime, powOf, toBN, toDec} from "../../utils/utils";
import {randomBytes} from "crypto";
import {utils} from "ethers";
import {StandardMerkleTree} from "@openzeppelin/merkle-tree";

const values = [
    ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", 0, "5000000000000000000", 5000, 86400],
    ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", 0, "2500000000000000000", 10000, 86400],
    ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", 0, "2500000000000000000", 0, 86400],
    ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8", 0, "2500000000000000000", 10000, 86400],
    ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8", 0, "2500000000000000000", 0, 86400],
    ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", 1, "2500000000000000000", 5000, 86400],
    ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", 2, "5000000000000000000", 5000, 86400],
];

export function generateTree(values: any[]) {
    return StandardMerkleTree.of(values, ["address", "uint", "uint256", "uint256", "uint256"]);
}

describe("AirdropClaimer", function () {
    let deployer: SignerWithAddress;
    let user: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let accts: SignerWithAddress[];
    let airdropClaimer: AirdropClaimer;
    let token: TOKEN;
    let tree: StandardMerkleTree<any>;
    let supply = "";
    let deployerBal = toBN("0");

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user = accts[1];
        user2 = accts[2];
        user3 = accts[3];

        let TOKEN = await ethers.getContractFactory("MINTABLE_TOKEN");
        supply = "1000000000000000000000000";
        token = (await TOKEN.deploy("REWARD_TOKEN", "REWARD_TOKEN", supply, 18)) as TOKEN;

        let factory = await ethers.getContractFactory("AirdropClaimer");
        airdropClaimer = (await factory.deploy(token.address, Buffer.alloc(32))) as AirdropClaimer;

        await token.transfer(airdropClaimer.address, "100000000000000000000");
        deployerBal = await token.balanceOf(deployer.address);

        tree = generateTree(values);
    });

    describe(".setRewardToken", () => {
        context("when the caller is the deployer", () => {
            it("should set the reward token", async () => {
                await airdropClaimer.setRewardToken(user.address);
                expect(await airdropClaimer.rewardToken()).to.equal(user.address);
            });
        });

        context("when the caller is not the deployer", () => {
            it("should revert", async () => {
                await expect(airdropClaimer.connect(user).setRewardToken(user2.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
            });
        });
    });

    describe(".setTrialnetRoot", () => {
        context("when the caller is the deployer", () => {
            it("should set the reward token", async () => {
                const root = randomBytes(32);
                await airdropClaimer.setTrialnetRoot(root);
                expect(await airdropClaimer.root()).to.equal(utils.hexlify(root));
            });
        });

        context("when the caller is not the deployer", () => {
            it("should revert", async () => {
                await expect(airdropClaimer.connect(user).setTrialnetRoot(randomBytes(32))).to.be.revertedWith("OWNABLE: NOT_OWNER");
            });
        });
    });

    describe(".claimReward", () => {
        it("should revert with='SENDER_MUST_BE_ADDR' when sender isn't the beneficiary", async () => {
            await airdropClaimer.setTrialnetRoot(tree.root);
            const proof = tree.getProof(values[0]);
            await expect(airdropClaimer.claimReward(proof, user2.address, 0, 1000, 0, 86400)).to.be.revertedWith("SENDER_MUST_BE_ADDR");
        });

        it("should revert with='Invalid proof' when proof is invalid", async () => {
            await airdropClaimer.setTrialnetRoot(tree.root);
            const proof = tree.getProof(values[0]);
            await expect(airdropClaimer.claimReward(proof, deployer.address, 0, 1000, 0, 86400)).to.be.revertedWith("Invalid proof");
        });

        it("should revert with 'INVALID_CLAIM_ID' when claim ID is invalid", async () => {
            await airdropClaimer.setTrialnetRoot(tree.root);
            const proof = tree.getProof(values[0]);
            await expect(airdropClaimer.claimReward(proof, deployer.address, 1, "5000000000000000000", 5000, 86400)).to.be.revertedWith("INVALID_CLAIM_ID");
        });

        it("should be successful when proof is valid", async () => {
            await airdropClaimer.setTrialnetRoot(tree.root);
            const proof = tree.getProof(values[0]);

            const now = await advanceBlockTime(1);
            const vestingWalletId = await airdropClaimer.buildVestingWalletId(deployer.address, 0);
            await expect(airdropClaimer.claimReward(proof, deployer.address, 0, "5000000000000000000", 5000, 86400))
                .to.emit(airdropClaimer, "RewardClaim")
                .withArgs(deployer.address, await airdropClaimer.vestingWallets(vestingWalletId), 0, "5000000000000000000", "2500000000000000000", "2500000000000000000", now + 1, 86400);

            expect(await token.balanceOf(airdropClaimer.address)).to.equal("95000000000000000000");
            expect(await token.balanceOf(await airdropClaimer.vestingWallets(vestingWalletId))).to.equal("2500000000000000000");
            expect(await token.balanceOf(deployer.address)).to.eq(deployerBal.add("2500000000000000000"));

            const factory = await ethers.getContractFactory("VestingWallet");
            const vestingW = factory.attach(await airdropClaimer.vestingWallets(vestingWalletId)) as VestingWallet;
            expect(await vestingW.beneficiary()).to.equal(deployer.address);
            expect(await vestingW["releasable(address)"](token.address)).to.equal("0");
            await advanceBlockTime(86400);
            expect(await vestingW["releasable(address)"](token.address)).to.equal("2500000000000000000");
        });

        it("should revert with='PROOF_USED' if proof was re-used", async () => {
            await airdropClaimer.setTrialnetRoot(tree.root);
            const proof = tree.getProof(values[0]);

            await expect(airdropClaimer.claimReward(proof, deployer.address, 0, "5000000000000000000", 5000, 86400)).to.emit(airdropClaimer, "RewardClaim");

            await expect(airdropClaimer.claimReward(proof, deployer.address, 0, "5000000000000000000", 5000, 86400)).to.be.revertedWith("PROOF_USED");
        });

        it("should be successful claim with multiple valid proofs", async () => {
            const factory = await ethers.getContractFactory("VestingWallet");
            await airdropClaimer.setTrialnetRoot(tree.root);

            let proof = tree.getProof(values[0]);
            await expect(airdropClaimer.claimReward(proof, deployer.address, 0, "5000000000000000000", 5000, 86400)).to.emit(airdropClaimer, "RewardClaim");
            const vestingWalletId = await airdropClaimer.buildVestingWalletId(deployer.address, 0);
            const vestingW = factory.attach(await airdropClaimer.vestingWallets(vestingWalletId)) as VestingWallet;
            expect(await vestingW.beneficiary()).to.equal(deployer.address);
            expect(await vestingW["releasable(address)"](token.address)).to.equal("0");

            proof = tree.getProof(values[1]);
            await expect(airdropClaimer.claimReward(proof, deployer.address, 0, "2500000000000000000", 10000, 86400)).to.emit(airdropClaimer, "RewardClaim");
            expect(await vestingW.beneficiary()).to.equal(deployer.address);
            expect((await vestingW["releasable(address)"](token.address)).gt(0)).to.be.true;

            expect(await token.balanceOf(airdropClaimer.address)).to.eq("92500000000000000000");
            expect(await token.balanceOf(await airdropClaimer.vestingWallets(vestingWalletId))).to.equal("2500000000000000000");
            expect(await token.balanceOf(deployer.address)).to.eq(deployerBal.add("5000000000000000000"));

            await advanceBlockTime(86400);
            expect(await vestingW["releasable(address)"](token.address)).to.equal("2500000000000000000");
        });

        it("should be successful claim proof with no tgeAlloc=0", async () => {
            const factory = await ethers.getContractFactory("VestingWallet");
            await airdropClaimer.setTrialnetRoot(tree.root);

            await advanceBlockTime(1);
            const proof = tree.getProof(values[2]);
            await expect(airdropClaimer.claimReward(proof, deployer.address, 0, "2500000000000000000", 0, 86400)).to.emit(airdropClaimer, "RewardClaim");
            const vestingWalletId = await airdropClaimer.buildVestingWalletId(deployer.address, 0);
            const vestingW = factory.attach(await airdropClaimer.vestingWallets(vestingWalletId)) as VestingWallet;
            expect(await vestingW["releasable(address)"](token.address)).to.equal("0");

            expect(await token.balanceOf(airdropClaimer.address)).to.eq("97500000000000000000");
            expect(await token.balanceOf(await airdropClaimer.vestingWallets(vestingWalletId))).to.equal("2500000000000000000");
            expect(await token.balanceOf(deployer.address)).to.eq(deployerBal);

            await advanceBlockTime(86400);
            expect(await vestingW["releasable(address)"](token.address)).to.equal("2500000000000000000");
        });
    });

    describe(".claimPresale", () => {
        it("should revert with='SENDER_MUST_BE_ADDR' when sender isn't the beneficiary", async () => {
            await airdropClaimer.setTrialnetRoot(tree.root);
            const proof = tree.getProof(values[0]);
            await expect(airdropClaimer.claimPresale(proof, user2.address, 2, 1000, 0, 86400)).to.be.revertedWith("SENDER_MUST_BE_ADDR");
        });

        it("should revert with='Invalid proof' when proof is invalid", async () => {
            await airdropClaimer.setTrialnetRoot(tree.root);
            const proof = tree.getProof(values[0]);
            await expect(airdropClaimer.claimPresale(proof, deployer.address, 2, 1000, 0, 86400)).to.be.revertedWith("Invalid proof");
        });

        it("should revert with 'INVALID_CLAIM_ID' when claim ID is invalid", async () => {
            await airdropClaimer.setTrialnetRoot(tree.root);
            const proof = tree.getProof(values[0]);
            await expect(airdropClaimer.claimPresale(proof, deployer.address, 3, "5000000000000000000", 5000, 86400)).to.be.revertedWith("INVALID_CLAIM_ID");
        });

        it("should be successful when proof is valid", async () => {
            await airdropClaimer.setTrialnetRoot(tree.root);
            const proof = tree.getProof(values[6]);

            const now = await advanceBlockTime(1);
            const vestingWalletId = await airdropClaimer.buildVestingWalletId(deployer.address, 2);
            await expect(airdropClaimer.claimPresale(proof, deployer.address, 2, "5000000000000000000", 5000, 86400))
                .to.emit(airdropClaimer, "RewardClaim")
                .withArgs(deployer.address, await airdropClaimer.vestingWallets(vestingWalletId), 2, "5000000000000000000", "2500000000000000000", "2500000000000000000", now + 1, 86400);

            expect(await token.balanceOf(airdropClaimer.address)).to.equal("95000000000000000000");
            expect(await token.balanceOf(await airdropClaimer.vestingWallets(vestingWalletId))).to.equal("2500000000000000000");
            expect(await token.balanceOf(deployer.address)).to.eq(deployerBal.add("2500000000000000000"));

            const factory = await ethers.getContractFactory("VestingWallet");
            const vestingW = factory.attach(await airdropClaimer.vestingWallets(vestingWalletId)) as VestingWallet;
            expect(await vestingW.beneficiary()).to.equal(deployer.address);
            expect(await vestingW["releasable(address)"](token.address)).to.equal("0");
            await advanceBlockTime(86400);
            expect(await vestingW["releasable(address)"](token.address)).to.equal("2500000000000000000");
        });
    });

    describe(".claimDexDropReward", () => {
        it("should revert with 'INVALID_CLAIM_ID' when claim ID is invalid", async () => {
            await airdropClaimer.setTrialnetRoot(tree.root);
            const proof = tree.getProof(values[0]);
            await expect(airdropClaimer.claimDexDropReward(proof, deployer.address, 3, "5000000000000000000", 5000, 86400)).to.be.revertedWith("INVALID_CLAIM_ID");
        });

        describe("when donation is enabled and dex drop time is set", () => {
            const lockTime = 86400;
            const donation = "1000000000000000000";

            beforeEach(async () => {
                await airdropClaimer.setDexDropLockTime(lockTime);
                await airdropClaimer.setAllowContribution(true);
                await airdropClaimer.setContributionAmount(donation);
            });

            it("should extend vesting start time by dex drop lock time when donation was not paid", async () => {
                await airdropClaimer.setTrialnetRoot(tree.root);
                const proof = tree.getProof(values[5]);
                const now = await advanceBlockTime(1);
                await expect(airdropClaimer.claimDexDropReward(proof, deployer.address, 1, "2500000000000000000", 5000, 86400))
                    .to.be.emit(airdropClaimer, "RewardClaim")
                    .withArgs(
                        deployer.address,
                        await airdropClaimer.vestingWallets(await airdropClaimer.buildVestingWalletId(deployer.address, 1)),
                        1,
                        "2500000000000000000",
                        "1250000000000000000",
                        "1250000000000000000",
                        now + lockTime + 1,
                        86400,
                    );

                expect(await airdropClaimer.unclaimedTgeAllocations(deployer.address)).to.equal("1250000000000000000");
                expect(await airdropClaimer.unclaimedTgeAllocClaimTime(deployer.address)).to.equal(now + lockTime + 1);

                const vestingWalletId = await airdropClaimer.buildVestingWalletId(deployer.address, 1);
                expect(await token.balanceOf(airdropClaimer.address)).to.eq("98750000000000000000");
                expect(await token.balanceOf(await airdropClaimer.vestingWallets(vestingWalletId))).to.equal("1250000000000000000");
                expect(await token.balanceOf(deployer.address)).to.eq(deployerBal);

                // withdraw tge allocation
                await expect(airdropClaimer.claimTgeAlloc(user2.address)).to.be.revertedWith("NO_UNCLAIMED_TGE_ALLOC");
                await expect(airdropClaimer.claimTgeAlloc(deployer.address)).to.be.revertedWith("TGE_ALLOC_LOCKED");

                await advanceBlockTime(lockTime + 1);
                await expect(airdropClaimer.claimTgeAlloc(deployer.address)).to.emit(airdropClaimer, "ClaimedTgeAlloc").withArgs(deployer.address, "1250000000000000000");
            });

            it("should extend vesting immediately and release Tge allocation when donation was paid", async () => {
                await airdropClaimer.setTrialnetRoot(tree.root);
                const proof = tree.getProof(values[5]);
                const now = await advanceBlockTime(1);
                await expect(airdropClaimer.claimDexDropReward(proof, deployer.address, 1, "2500000000000000000", 5000, 86400, {value: donation}))
                    .to.be.emit(airdropClaimer, "RewardClaim")
                    .withArgs(
                        deployer.address,
                        await airdropClaimer.vestingWallets(await airdropClaimer.buildVestingWalletId(deployer.address, 1)),
                        1,
                        "2500000000000000000",
                        "1250000000000000000",
                        "1250000000000000000",
                        now + 1,
                        86400,
                    );

                expect(await airdropClaimer.unclaimedTgeAllocations(deployer.address)).to.equal("0");
                expect(await airdropClaimer.unclaimedTgeAllocClaimTime(deployer.address)).to.equal(0);

                const vestingWalletId = await airdropClaimer.buildVestingWalletId(deployer.address, 1);
                expect(await token.balanceOf(airdropClaimer.address)).to.eq("97500000000000000000");
                expect(await token.balanceOf(await airdropClaimer.vestingWallets(vestingWalletId))).to.equal("1250000000000000000");
                expect(await token.balanceOf(deployer.address)).to.eq(deployerBal.add("1250000000000000000"));
            });
        });

        describe("when donation is not enabled", () => {
            const lockTime = 86400;

            beforeEach(async () => {
                await airdropClaimer.setDexDropLockTime(lockTime);
                await airdropClaimer.setAllowContribution(false);
            });

            it("should extend vesting start time by dex drop lock time", async () => {
                await airdropClaimer.setTrialnetRoot(tree.root);
                const proof = tree.getProof(values[5]);
                const now = await advanceBlockTime(1);
                await expect(airdropClaimer.claimDexDropReward(proof, deployer.address, 1, "2500000000000000000", 5000, 86400))
                    .to.be.emit(airdropClaimer, "RewardClaim")
                    .withArgs(
                        deployer.address,
                        await airdropClaimer.vestingWallets(await airdropClaimer.buildVestingWalletId(deployer.address, 1)),
                        1,
                        "2500000000000000000",
                        "1250000000000000000",
                        "1250000000000000000",
                        now + lockTime + 1,
                        86400,
                    );

                expect(await airdropClaimer.unclaimedTgeAllocations(deployer.address)).to.equal("1250000000000000000");
                expect(await airdropClaimer.unclaimedTgeAllocClaimTime(deployer.address)).to.equal(now + lockTime + 1);

                const vestingWalletId = await airdropClaimer.buildVestingWalletId(deployer.address, 1);
                expect(await token.balanceOf(airdropClaimer.address)).to.eq("98750000000000000000");
                expect(await token.balanceOf(await airdropClaimer.vestingWallets(vestingWalletId))).to.equal("1250000000000000000");
                expect(await token.balanceOf(deployer.address)).to.eq(deployerBal);

                // withdraw tge allocation
                await expect(airdropClaimer.claimTgeAlloc(user2.address)).to.be.revertedWith("NO_UNCLAIMED_TGE_ALLOC");
                await expect(airdropClaimer.claimTgeAlloc(deployer.address)).to.be.revertedWith("TGE_ALLOC_LOCKED");

                await advanceBlockTime(lockTime + 1);
                await expect(airdropClaimer.claimTgeAlloc(deployer.address)).to.emit(airdropClaimer, "ClaimedTgeAlloc").withArgs(deployer.address, "1250000000000000000");
            });
        });
    });

    describe(".withdrawETH", () => {
        const lockTime = 86400;
        const donation = "1000000000000000000";

        beforeEach(async () => {
            await airdropClaimer.setDexDropLockTime(lockTime);
            await airdropClaimer.setAllowContribution(true);
            await airdropClaimer.setContributionAmount(donation);
        });

        it("should revert with 'NOT_OWNER' when caller isn't the owner", async () => {
            await expect(airdropClaimer.connect(user3).withdrawETH(user2.address)).to.be.revertedWith("NOT_OWNER");
        });

        it("should withdraw donated ETH", async () => {
            await airdropClaimer.setTrialnetRoot(tree.root);
            const proof = tree.getProof(values[5]);
            const now = await advanceBlockTime(1);
            await expect(airdropClaimer.claimDexDropReward(proof, deployer.address, 1, "2500000000000000000", 5000, 86400, {value: donation}))
                .to.be.emit(airdropClaimer, "RewardClaim")
                .withArgs(
                    deployer.address,
                    await airdropClaimer.vestingWallets(await airdropClaimer.buildVestingWalletId(deployer.address, 1)),
                    1,
                    "2500000000000000000",
                    "1250000000000000000",
                    "1250000000000000000",
                    now + 1,
                    86400,
                );

            expect(await ethers.provider.getBalance(airdropClaimer.address)).to.eq("1000000000000000000");

            await expect(airdropClaimer.withdrawETH(user2.address)).to.emit(airdropClaimer, "WithdrawnETH").withArgs(user2.address, "1000000000000000000");

            expect(await ethers.provider.getBalance(user2.address)).to.eq("10001000000000000000000");
        });
    });

    describe(".withdrawRewardToken", () => {
        it("should revert with 'NOT_OWNER' when caller isn't the owner", async () => {
            await expect(airdropClaimer.connect(user3).withdrawRewardToken(user2.address)).to.be.revertedWith("NOT_OWNER");
        });

        it("should withdraw all reward token", async () => {
            expect(await token.balanceOf(airdropClaimer.address)).to.eq("100000000000000000000");

            await expect(airdropClaimer.withdrawRewardToken(user2.address)).to.emit(airdropClaimer, "WithdrawnRewardToken").withArgs(user2.address, "100000000000000000000");

            expect(await token.balanceOf(airdropClaimer.address)).to.eq("0");
            expect(await token.balanceOf(user2.address)).to.eq("100000000000000000000");
        });
    });
});
