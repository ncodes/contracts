import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {StandardMerkleTree} from "@openzeppelin/merkle-tree";
import {expect} from "chai";
import {BigNumber, ContractTransaction} from "ethers";
import {ethers} from "hardhat";
import {FreeToken} from "../../typechain-types";
import {powOf, toBN} from "../../utils/utils";

const airdropTreeValues = [
    ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", 0, "5000000000000000000"],
    ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", 1, "2500000000000000000"],
];

export function generateTree(values: any[]) {
    return StandardMerkleTree.of(values, ["address", "uint", "uint256"]);
}

describe.only("FreeToken", function () {
    let deployer: SignerWithAddress;
    let user: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let accts: SignerWithAddress[];
    let freeToken: FreeToken;
    let tree: StandardMerkleTree<any>;
    let deployerBal = toBN("0");
    let supply = powOf(500_000_000_000);
    let devSupply = powOf(50_000_000_000);
    let bondingCurveAlloc = powOf(50_000_000_000);

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user = accts[1];
        user2 = accts[2];
        user3 = accts[3];

        tree = generateTree(airdropTreeValues);

        let factory = await ethers.getContractFactory("FreeToken");
        freeToken = (await factory.deploy(
            "FreeToken",
            "FT",
            supply,
            18,
            tree.root,
            devSupply,
            bondingCurveAlloc,
            0,
        )) as FreeToken;
        await freeToken.transfer(freeToken.address, supply);

        deployerBal = await freeToken.balanceOf(deployer.address);
    });

    describe(".claim", () => {
        beforeEach(async () => {
            await freeToken.toggleAllowClaim();
        });

        it("should revert with='CLAIM_NOT_ALLOWED' when claim is not allowed", async () => {
            await freeToken.toggleAllowClaim();
            await expect(
                freeToken.claim(tree.getProof(airdropTreeValues[0]), deployer.address, 0, 1000),
            ).to.be.revertedWith("CLAIM_NOT_ALLOWED");
        });

        it("should revert with='SENDER_MUST_BE_ADDR' when sender isn't the beneficiary", async () => {
            const proof = tree.getProof(airdropTreeValues[0]);
            await expect(freeToken.claim(proof, user2.address, 0, 1000)).to.be.revertedWith("SENDER_MUST_BE_ADDR");
        });

        it("should revert with='Invalid proof' when proof is invalid", async () => {
            const proof = tree.getProof(airdropTreeValues[0]);
            await expect(freeToken.claim(proof, deployer.address, 0, 1000)).to.be.revertedWith("Invalid proof");
        });

        it("should be successful when proof is valid", async () => {
            const proof = tree.getProof(airdropTreeValues[0]);

            await expect(freeToken.claim(proof, deployer.address, 0, "5000000000000000000"))
                .to.emit(freeToken, "Claimed")
                .withArgs(deployer.address, 0, "5000000000000000000");

            expect(await freeToken.claims(deployer.address)).to.eq("5000000000000000000");
            expect(await freeToken.balanceOf(freeToken.address)).to.eq(supply);
            expect(await freeToken.balanceOf(deployer.address)).to.eq(deployerBal);
            expect(await freeToken.claimedBalance()).to.eq("5000000000000000000");
        });

        it("should revert with='CLAIM_USED' if proof/claim was re-used", async () => {
            let proof = tree.getProof(airdropTreeValues[0]);

            await expect(freeToken.claim(proof, deployer.address, 0, "5000000000000000000")).to.emit(
                freeToken,
                "Claimed",
            );

            proof = tree.getProof(airdropTreeValues[1]);
            await expect(freeToken.claim(proof, deployer.address, 1, "2500000000000000000")).to.emit(
                freeToken,
                "Claimed",
            );

            await expect(freeToken.claim(proof, deployer.address, 1, "2500000000000000000")).to.be.revertedWith(
                "CLAIM_USED",
            );
        });
    });

    describe(".claimMulti", () => {
        beforeEach(async () => {
            await freeToken.toggleAllowClaim();
        });

        it("should successfully claim multiple rewards", async () => {
            let proof0 = tree.getProof(airdropTreeValues[0]);
            let proof1 = tree.getProof(airdropTreeValues[1]);
            await expect(
                freeToken.claimMulti(
                    [proof0, proof1],
                    deployer.address,
                    [0, 1],
                    ["5000000000000000000", "2500000000000000000"],
                ),
            )
                .to.emit(freeToken, "Claimed")
                .withArgs(deployer.address, 0, "5000000000000000000")
                .to.emit(freeToken, "Claimed")
                .withArgs(deployer.address, 1, "2500000000000000000");

            expect(await freeToken.claims(deployer.address)).to.eq("7500000000000000000");
        });
    });

    describe(".withdrawClaim", () => {
        beforeEach(async () => {
            await freeToken.toggleAllowClaim();
            await freeToken.toggleAllowWithdraw();
        });

        it("should revert with 'WITHDRAW_NOT_ALLOWED' when withdraw is not allowed", async () => {
            await freeToken.toggleAllowWithdraw();
            await expect(freeToken.withdrawClaim()).to.be.revertedWith("WITHDRAW_NOT_ALLOWED");
        });

        it("should successfully withdraw claim", async () => {
            await freeToken.claim(tree.getProof(airdropTreeValues[0]), deployer.address, 0, "5000000000000000000");
            await expect(freeToken.withdrawClaim())
                .to.emit(freeToken, "ClaimWithdrawn")
                .withArgs(deployer.address, "5000000000000000000");

            expect(await freeToken.claims(deployer.address)).to.eq("0");
            expect(await freeToken.balanceOf(deployer.address)).to.eq(deployerBal.add("5000000000000000000"));
        });
    });

    describe(".withdrawToken", () => {
        it("should revert with 'NOT_OWNER' when caller isn't the owner", async () => {
            await expect(freeToken.connect(user3).withdrawToken(user2.address)).to.be.revertedWith("NOT_OWNER");
        });

        it("should withdraw all reward token", async () => {
            expect(await freeToken.balanceOf(freeToken.address)).to.eq(supply);

            await expect(freeToken.withdrawToken(user2.address))
                .to.emit(freeToken, "WithdrawnToken")
                .withArgs(user2.address, supply);

            expect(await freeToken.balanceOf(freeToken.address)).to.eq("0");
            expect(await freeToken.balanceOf(user2.address)).to.eq(supply);
        });
    });

    describe(".buyPrice & .sellPrice", () => {
        it("should return the correct price", async () => {
            const supply = powOf(50_000_000_000);
            const buyPrice = await freeToken.buyPrice(supply);
            expect(buyPrice).to.eq("40000000000");

            let sellPrice = await freeToken.sellPrice(supply, powOf(10_000_000_000));
            expect(sellPrice).to.eq("25600000000");
            expect(buyPrice).to.gt(sellPrice);

            sellPrice = await freeToken.sellPrice(supply, supply);
            expect(sellPrice).to.eq("1000000000000000000");
        });
    });

    describe(".buy", () => {
        beforeEach(async () => {
            await freeToken.toggleAllowTrade();
        });

        it("should revert with 'TRADE_NOT_ALLOWED' when trade is not allowed", async () => {
            await freeToken.toggleAllowTrade();
            await expect(freeToken.buy({value: powOf(0.000000001)})).to.be.revertedWith("TRADE_NOT_ALLOWED");
        });

        it("should revert with 'INVALID_AMOUNT' when amount is 0", async () => {
            await expect(freeToken.buy({value: 0})).to.be.revertedWith("INVALID_AMOUNT");
        });

        it("should successfully buy tokens", async () => {
            await expect(freeToken.connect(user2).buy({value: powOf(0.000000001)}))
                .to.emit(freeToken, "Buy")
                .withArgs(user2.address, powOf(0.000000001), "25000000000000000", 0);
            expect(await freeToken.balanceOf(user2.address)).to.eq("25000000000000000");
            expect(await freeToken.bondingCurveEthBal()).to.eq("1000000000");
            expect(await freeToken.bondingCurveAlloc()).to.eq(bondingCurveAlloc.sub("25000000000000000"));
        });

        it("should revert with 'INSUFFICIENT_ALLOC' when bonding curve allocation is insufficient", async () => {
            await expect(freeToken.connect(user2).buy({value: powOf(2000)})).not.to.be.reverted;
            await expect(freeToken.buy({value: powOf(0.000000001)})).to.be.revertedWith("INSUFFICIENT_ALLOC");
        });

        describe("with dev fee set", () => {
            beforeEach(async () => {
                await freeToken.setDevFeeBp(1000);
            });

            it("should successfully buy tokens and deduct dev fee", async () => {
                await expect(freeToken.connect(user2).buy({value: powOf(100)}))
                    .to.emit(freeToken, "Buy")
                    .withArgs(user2.address, powOf(100), "2250000000000000000000000000", powOf(10));
                expect(await freeToken.devFeeEthBal()).to.eq(powOf(10));
            });
        });
    });

    describe(".sell", () => {
        beforeEach(async () => {
            await freeToken.toggleAllowTrade();
        });

        it("should revert with 'TRADE_NOT_ALLOWED' when trade is not allowed", async () => {
            await freeToken.toggleAllowTrade();
            await expect(freeToken.connect(user2).sell(1)).to.be.revertedWith("TRADE_NOT_ALLOWED");
        });

        it("should revert with 'INVALID_AMOUNT' when amount is 0", async () => {
            await expect(freeToken.connect(user2).sell(0)).to.be.revertedWith("INVALID_AMOUNT");
        });

        it("should revert when sender has insufficient token to sell", async () => {
            await expect(freeToken.connect(user2).sell(1)).to.be.revertedWith("ERC20: insufficient allowance");
        });

        it("should successfully sell tokens", async () => {
            await expect(freeToken.connect(user2).buy({value: powOf(1)})).not.to.be.reverted;
            expect(await freeToken.balanceOf(user2.address)).to.eq("25000000000000000000000000");

            let tx: ContractTransaction;
            let amountToSell = "25000000000000000000000000";
            await freeToken.connect(user2).approve(freeToken.address, amountToSell);

            let user2Bal = await user2.getBalance();

            tx = await freeToken.connect(user2).sell(amountToSell);
            expect(tx).to.emit(freeToken, "Sell").withArgs(user2.address, amountToSell, "1000000000000000000", 0);

            expect(await freeToken.bondingCurveEthBal()).to.lt(powOf(1));
            expect(await freeToken.bondingCurveAlloc()).to.eq(bondingCurveAlloc);

            const gasFee = (await tx.wait()).gasUsed.mul(tx.gasPrice as BigNumber);
            expect(await freeToken.balanceOf(user2.address)).to.eq(0);
            expect(await user2.getBalance()).to.eq(user2Bal.add("1000000000000000000").sub(gasFee));
        });

        describe("with dev fee set", () => {
            beforeEach(async () => {});

            it("should sell tokens and deduct dev fee", async () => {
                await expect(freeToken.connect(user2).buy({value: powOf(1)}))
                    .to.emit(freeToken, "Buy")
                    .withArgs(user2.address, "1000000000000000000", "25000000000000000000000000", 0);
                expect(await freeToken.devFeeEthBal()).to.eq(powOf(0));

                let amountToSell = "25000000000000000000000000";
                await freeToken.connect(user2).approve(freeToken.address, amountToSell);
                await freeToken.setDevFeeBp(1000);
                await expect(freeToken.connect(user2).sell(amountToSell))
                    .to.emit(freeToken, "Sell")
                    .withArgs(user2.address, amountToSell, "900000000000000000", "100000000000000000");

                expect(await freeToken.devFeeEthBal()).to.eq(powOf(0.1));
            });
        });
    });

    describe(".buy through receive", () => {
        beforeEach(async () => {
            await freeToken.toggleAllowTrade();
        });

        it("should revert with 'TRADE_NOT_ALLOWED' when trade is not allowed", async () => {
            await freeToken.toggleAllowTrade();
            await expect(
                deployer.sendTransaction({to: freeToken.address, value: powOf(0.000000001)}),
            ).to.be.revertedWith("TRADE_NOT_ALLOWED");
        });

        it("should revert with 'INVALID_AMOUNT' when amount is 0", async () => {
            await expect(deployer.sendTransaction({to: freeToken.address, value: 0})).to.be.revertedWith(
                "INVALID_AMOUNT",
            );
        });

        it("should successfully buy tokens", async () => {
            await expect(user2.sendTransaction({to: freeToken.address, value: powOf(0.000000001)}))
                .to.emit(freeToken, "Buy")
                .withArgs(user2.address, powOf(0.000000001), "25000000000000000", 0);

            expect(await freeToken.balanceOf(user2.address)).to.eq("25000000000000000");
            expect(await freeToken.bondingCurveEthBal()).to.eq("1000000000");
            expect(await freeToken.bondingCurveAlloc()).to.eq(bondingCurveAlloc.sub("25000000000000000"));
        });

        it("should revert with 'INSUFFICIENT_ALLOC' when bonding curve allocation is insufficient", async () => {
            await expect(user2.sendTransaction({to: freeToken.address, value: powOf(2000)})).not.to.be.reverted;
            await expect(user2.sendTransaction({to: freeToken.address, value: powOf(0.000000001)})).to.be.revertedWith(
                "INSUFFICIENT_ALLOC",
            );
        });
    });

    describe(".withdrawEth", () => {
        it("should revert with 'NOT_OWNER' when caller isn't the owner", async () => {
            await expect(freeToken.connect(user3).withdrawEth(user2.address)).to.be.revertedWith("NOT_OWNER");
        });

        it("should successfully withdraw all ETH", async () => {
            await freeToken.toggleAllowTrade();
            await expect(freeToken.connect(user2).buy({value: powOf(1)})).not.to.be.reverted;

            const user2Bal = await user2.getBalance();

            await expect(freeToken.withdrawEth(user2.address))
                .to.emit(freeToken, "WithdrawnEth")
                .withArgs(user2.address, powOf(1));

            expect(await ethers.provider.getBalance(freeToken.address)).to.eq(0);
            expect(await user2.getBalance()).to.eq(user2Bal.add(powOf(1)));
        });
    });

    describe(".withdrawDevFee", () => {
        it("should revert with 'NOT_OWNER' when caller isn't the owner", async () => {
            await expect(freeToken.connect(user3).withdrawDevFee(user2.address)).to.be.revertedWith("NOT_OWNER");
        });

        it("should successfully withdraw dev fee", async () => {
            await freeToken.toggleAllowTrade();
            await freeToken.setDevFeeBp(1000);

            await expect(freeToken.connect(user2).buy({value: powOf(100)}))
                .to.emit(freeToken, "Buy")
                .withArgs(user2.address, powOf(100), "2250000000000000000000000000", powOf(10));
            expect(await freeToken.devFeeEthBal()).to.eq(powOf(10));

            const user3Bal = await user3.getBalance();

            await expect(freeToken.withdrawDevFee(user3.address))
                .to.emit(freeToken, "WithdrawnDevFee")
                .withArgs(user3.address, powOf(10));

            expect(await freeToken.devFeeEthBal()).to.eq(0);

            expect(await user3.getBalance()).to.eq(user3Bal.add(powOf(10)));
        });
    });

    describe("buying should reset claim", () => {
        it("should be successful allow proof reuse after minimum buy", async () => {
            await freeToken.toggleAllowClaim();
            await freeToken.toggleAllowTrade();

            const proof = tree.getProof(airdropTreeValues[0]);
            const amount = toBN("5000000000000000000");
            await expect(freeToken.claim(proof, deployer.address, 0, amount)).not.to.be.reverted;
            expect(await freeToken.claims(deployer.address)).to.eq(amount);

            // should not allow re-use of claim
            await expect(freeToken.claim(proof, deployer.address, 0, amount)).to.be.revertedWith("CLAIM_USED");

            // Buying below the minimum buy for reset should not reset the claim
            await freeToken.setMinBuyForReset(powOf(1));
            await expect(freeToken.buy({value: powOf(0.1)})).not.to.be.reverted;
            await expect(freeToken.claim(proof, deployer.address, 0, amount)).to.be.revertedWith("CLAIM_USED");

            // Buying equal or greater than the minimum buy for reset should reset the claim
            await expect(freeToken.buy({value: powOf(1)})).not.to.be.reverted;
            await expect(freeToken.claim(proof, deployer.address, 0, amount)).not.to.be.reverted;
            expect(await freeToken.claims(deployer.address)).to.eq(amount.mul(2));
        });
    });
});
