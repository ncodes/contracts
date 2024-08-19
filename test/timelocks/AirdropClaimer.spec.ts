import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {StandardMerkleTree} from "@openzeppelin/merkle-tree";
import {expect} from "chai";
import {randomBytes} from "crypto";
import {utils} from "ethers";
import {ethers} from "hardhat";
import {AirdropClaimer, NFT, TOKEN, WrappedVestingWallet} from "../../typechain-types";
import {AddressZero, advanceBlockTime, toBN} from "../../utils/utils";

const trialnetAirdropTreeValues = [
    ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", 0, "5000000000000000000", 5000, 86400],
    ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", 0, "2500000000000000000", 10000, 86400],
    ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", 0, "2500000000000000000", 0, 86400],
    ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8", 0, "2500000000000000000", 10000, 86400],
    ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8", 0, "2500000000000000000", 0, 86400],
];

const nftAllocTreeValues = [[1, "5000000000000000000", 5000, 86400]];

export function generateTrialnetTree(values: any[]) {
    return StandardMerkleTree.of(values, ["address", "uint", "uint256", "uint256", "uint256"]);
}

export function generateNftAllocTree(values: any[]) {
    return StandardMerkleTree.of(values, ["uint256", "uint256", "uint256", "uint256"]);
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
    let nftTree: StandardMerkleTree<any>;
    let supply = "";
    let deployerBal = toBN("0");
    const baseURI = "ipfs://abc/";
    let nft: NFT;

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
        airdropClaimer = (await factory.deploy(
            Buffer.alloc(32),
            Buffer.alloc(32),
            token.address,
            AddressZero,
        )) as AirdropClaimer;

        await token.transfer(airdropClaimer.address, "100000000000000000000");

        tree = generateTrialnetTree(trialnetAirdropTreeValues);
        nftTree = generateNftAllocTree(nftAllocTreeValues);

        let nftFac = await ethers.getContractFactory("NFT");
        nft = (await nftFac.deploy(
            "NFT",
            "NFT",
            baseURI,
            1000,
            0,
            AddressZero,
            deployer.address,
            AddressZero,
            AddressZero,
        )) as NFT;
        await nft.setAllocator(deployer.address);
        await nft.toggleAllowMint();
        await nft.setCost(0);
        await airdropClaimer.setNft(nft.address);

        await airdropClaimer.setRoot(tree.root);
        await airdropClaimer.setNftRewardRoot(nftTree.root);

        deployerBal = await token.balanceOf(deployer.address);
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
                await expect(airdropClaimer.connect(user).setRewardToken(user2.address)).to.be.revertedWith(
                    "OWNABLE: NOT_OWNER",
                );
            });
        });
    });

    describe(".setRoot", () => {
        context("when the caller is the deployer", () => {
            it("should set the reward token", async () => {
                const root = randomBytes(32);
                await airdropClaimer.setRoot(root);
                expect(await airdropClaimer.root()).to.equal(utils.hexlify(root));
            });
        });

        context("when the caller is not the deployer", () => {
            it("should revert", async () => {
                await expect(airdropClaimer.connect(user).setRoot(randomBytes(32))).to.be.revertedWith(
                    "OWNABLE: NOT_OWNER",
                );
            });
        });
    });

    describe(".claimReward", () => {
        it("should revert with='SENDER_MUST_BE_ADDR' when sender isn't the beneficiary", async () => {
            const proof = tree.getProof(trialnetAirdropTreeValues[0]);
            await expect(airdropClaimer.claimReward(proof, user2.address, 0, 1000, 0, 86400)).to.be.revertedWith(
                "SENDER_MUST_BE_ADDR",
            );
        });

        it("should revert with='Invalid proof' when proof is invalid", async () => {
            const proof = tree.getProof(trialnetAirdropTreeValues[0]);
            await expect(airdropClaimer.claimReward(proof, deployer.address, 0, 1000, 0, 86400)).to.be.revertedWith(
                "Invalid proof",
            );
        });

        it("should revert with 'INVALID_CLAIM_ID' when claim ID is invalid", async () => {
            const proof = tree.getProof(trialnetAirdropTreeValues[0]);
            await expect(
                airdropClaimer.claimReward(proof, deployer.address, 1, "5000000000000000000", 5000, 86400),
            ).to.be.revertedWith("INVALID_CLAIM_ID");
        });

        it("should be successful when proof is valid", async () => {
            const proof = tree.getProof(trialnetAirdropTreeValues[0]);

            const now = await advanceBlockTime(1);
            const vestingWalletId = await airdropClaimer.buildVestingWalletId(deployer.address, 0);
            await expect(airdropClaimer.claimReward(proof, deployer.address, 0, "5000000000000000000", 5000, 86400))
                .to.emit(airdropClaimer, "RewardClaim")
                .withArgs(
                    deployer.address,
                    await airdropClaimer.vestingWallets(vestingWalletId),
                    0,
                    "5000000000000000000",
                    "2500000000000000000",
                    "2500000000000000000",
                    now + 1,
                    86400,
                );

            expect(await token.balanceOf(airdropClaimer.address)).to.equal("95000000000000000000");
            expect(await token.balanceOf(await airdropClaimer.vestingWallets(vestingWalletId))).to.equal(
                "2500000000000000000",
            );
            expect(await token.balanceOf(deployer.address)).to.eq(deployerBal.add("2500000000000000000"));

            const factory = await ethers.getContractFactory("WrappedVestingWallet");
            const vestingW = factory.attach(
                await airdropClaimer.vestingWallets(vestingWalletId),
            ) as WrappedVestingWallet;
            expect(await vestingW.beneficiary()).to.equal(deployer.address);
            expect(await vestingW["releasable(address)"](token.address)).to.equal("0");
            await advanceBlockTime(86400);
            expect(await vestingW["releasable(address)"](token.address)).to.equal("2500000000000000000");
        });

        it("should revert with='PROOF_USED' if proof was re-used", async () => {
            const proof = tree.getProof(trialnetAirdropTreeValues[0]);

            await expect(
                airdropClaimer.claimReward(proof, deployer.address, 0, "5000000000000000000", 5000, 86400),
            ).to.emit(airdropClaimer, "RewardClaim");

            await expect(
                airdropClaimer.claimReward(proof, deployer.address, 0, "5000000000000000000", 5000, 86400),
            ).to.be.revertedWith("PROOF_USED");
        });

        it("should be successful claim with multiple valid proofs", async () => {
            const factory = await ethers.getContractFactory("WrappedVestingWallet");

            let proof = tree.getProof(trialnetAirdropTreeValues[0]);
            await expect(
                airdropClaimer.claimReward(proof, deployer.address, 0, "5000000000000000000", 5000, 86400),
            ).to.emit(airdropClaimer, "RewardClaim");
            const vestingWalletId = await airdropClaimer.buildVestingWalletId(deployer.address, 0);
            const vestingW = factory.attach(
                await airdropClaimer.vestingWallets(vestingWalletId),
            ) as WrappedVestingWallet;
            expect(await vestingW.beneficiary()).to.equal(deployer.address);
            expect(await vestingW["releasable(address)"](token.address)).to.equal("0");

            proof = tree.getProof(trialnetAirdropTreeValues[1]);
            await expect(
                airdropClaimer.claimReward(proof, deployer.address, 0, "2500000000000000000", 10000, 86400),
            ).to.emit(airdropClaimer, "RewardClaim");
            expect(await vestingW.beneficiary()).to.equal(deployer.address);
            expect((await vestingW["releasable(address)"](token.address)).gt(0)).to.be.true;

            expect(await token.balanceOf(airdropClaimer.address)).to.eq("92500000000000000000");
            expect(await token.balanceOf(await airdropClaimer.vestingWallets(vestingWalletId))).to.equal(
                "2500000000000000000",
            );
            expect(await token.balanceOf(deployer.address)).to.eq(deployerBal.add("5000000000000000000"));

            await advanceBlockTime(86400);
            expect(await vestingW["releasable(address)"](token.address)).to.equal("2500000000000000000");
        });

        it("should be successful claim proof with no tgeAlloc=0", async () => {
            const factory = await ethers.getContractFactory("WrappedVestingWallet");

            await advanceBlockTime(1);
            const proof = tree.getProof(trialnetAirdropTreeValues[2]);
            await expect(
                airdropClaimer.claimReward(proof, deployer.address, 0, "2500000000000000000", 0, 86400),
            ).to.emit(airdropClaimer, "RewardClaim");
            const vestingWalletId = await airdropClaimer.buildVestingWalletId(deployer.address, 0);
            const vestingW = factory.attach(
                await airdropClaimer.vestingWallets(vestingWalletId),
            ) as WrappedVestingWallet;
            expect(await vestingW["releasable(address)"](token.address)).to.equal("0");

            expect(await token.balanceOf(airdropClaimer.address)).to.eq("97500000000000000000");
            expect(await token.balanceOf(await airdropClaimer.vestingWallets(vestingWalletId))).to.equal(
                "2500000000000000000",
            );
            expect(await token.balanceOf(deployer.address)).to.eq(deployerBal);

            await advanceBlockTime(86400);
            expect(await vestingW["releasable(address)"](token.address)).to.equal("2500000000000000000");
        });
    });

    describe(".claimNFTReward", () => {
        it("should revert if token is unknown", async () => {
            const proof = nftTree.getProof(nftAllocTreeValues[0]);
            await expect(
                airdropClaimer.claimNFTReward(proof, 1, "5000000000000000000", 5000, 86400),
            ).to.be.revertedWith("ERC721: invalid token ID");
        });

        it("should revert if token is not owned by sender", async () => {
            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
            const proof = nftTree.getProof(nftAllocTreeValues[0]);
            await expect(
                airdropClaimer.connect(user2).claimNFTReward(proof, 1, "5000000000000000000", 5000, 86400),
            ).to.be.revertedWith("NOT_NFT_OWNER");
        });

        it("should revert if proof is invalid", async () => {
            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
            const proof = nftTree.getProof(nftAllocTreeValues[0]);
            await expect(
                airdropClaimer.claimNFTReward(proof, 1, "5000000000000000000", 1000, 86400),
            ).to.be.revertedWith("Invalid proof");
        });

        it("should successfully claim reward", async () => {
            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
            const proof = nftTree.getProof(nftAllocTreeValues[0]);

            const curBal = await token.balanceOf(deployer.address);
            await expect(airdropClaimer.claimNFTReward(proof, 1, "5000000000000000000", 5000, 86400)).not.to.be
                .reverted;
            expect(await token.balanceOf(deployer.address)).to.eq(curBal.add("2500000000000000000"));
            expect(await token.balanceOf(airdropClaimer.address)).to.eq("95000000000000000000");

            const vestingWalletId = await airdropClaimer.buildVestingWalletId(deployer.address, 3);
            expect(await token.balanceOf(await airdropClaimer.vestingWallets(vestingWalletId))).to.eq(
                "2500000000000000000",
            );
        });

        it("should revert if proof has been used", async () => {
            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
            const proof = nftTree.getProof(nftAllocTreeValues[0]);
            await expect(airdropClaimer.claimNFTReward(proof, 1, "5000000000000000000", 5000, 86400)).not.to.be
                .reverted;
            await expect(
                airdropClaimer.claimNFTReward(proof, 1, "5000000000000000000", 5000, 86400),
            ).to.be.revertedWith("PROOF_USED");
        });
    });

    describe(".withdrawRewardToken", () => {
        it("should revert with 'NOT_OWNER' when caller isn't the owner", async () => {
            await expect(airdropClaimer.connect(user3).withdrawRewardToken(user2.address)).to.be.revertedWith(
                "NOT_OWNER",
            );
        });

        it("should withdraw all reward token", async () => {
            expect(await token.balanceOf(airdropClaimer.address)).to.eq("100000000000000000000");

            await expect(airdropClaimer.withdrawRewardToken(user2.address))
                .to.emit(airdropClaimer, "WithdrawnRewardToken")
                .withArgs(user2.address, "100000000000000000000");

            expect(await token.balanceOf(airdropClaimer.address)).to.eq("0");
            expect(await token.balanceOf(user2.address)).to.eq("100000000000000000000");
        });
    });
});
