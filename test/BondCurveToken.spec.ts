import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {StandardMerkleTree} from "@openzeppelin/merkle-tree";
import {expect} from "chai";
import {BigNumber, ContractTransaction} from "ethers";
import {ethers} from "hardhat";
import {BondCurveToken} from "../typechain-types";
import {powOf, toBN} from "../utils/utils";

const airdropTreeValues = [
    ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", 0, "5000000000000000000"],
    ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", 1, "2500000000000000000"],
];

export function generateTree(values: any[]) {
    return StandardMerkleTree.of(values, ["address", "uint", "uint256"]);
}

describe.only("BondCurveToken", function () {
    let deployer: SignerWithAddress;
    let user: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let accts: SignerWithAddress[];
    let token: BondCurveToken;
    let tree: StandardMerkleTree<any>;
    let deployerBal = toBN("0");
    let supply = powOf(10_000_000_000);
    let devSupply = powOf(4_000_000_000);
    let bondingCurveAlloc = powOf(1_780_000_000);
    let airdropAlloc = powOf(4_220_000_000);

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user = accts[1];
        user2 = accts[2];
        user3 = accts[3];

        tree = generateTree(airdropTreeValues);

        let factory = await ethers.getContractFactory("BondCurveToken");
        token = (await factory.deploy(
            "BondCurveToken",
            "FT",
            supply,
            18,
            tree.root,
            airdropAlloc,
            devSupply,
            bondingCurveAlloc,
            0,
        )) as BondCurveToken;
        await token.transfer(token.address, supply);

        await token.toggleAllowBuyTransfer();

        deployerBal = await token.balanceOf(deployer.address);
    });

    describe(".reInit", () => {
        it("should revert with 'NOT_OWNER' when caller isn't the owner", async () => {
            await expect(
                token.connect(user2).reInit(tree.root, 1, devSupply, bondingCurveAlloc, 0, 16000000),
            ).to.be.revertedWith("NOT_OWNER");
        });

        it("should be successful when caller is the owner", async () => {
            const testRoot = "0x1000000000000000000000000000000000000000000000000000000000000000";
            await expect(token.reInit(testRoot, 1, 2, 3, 4, 5))
                .to.emit(token, "ReInitialized")
                .withArgs(testRoot, 1, 2, 3, 4, 5);
            expect(await token.root()).to.eq(testRoot);
            expect(await token.airdropAlloc()).to.eq(1);
            expect(await token.devAlloc()).to.eq(2);
            expect(await token.bondingCurveAlloc()).to.eq(3);
            expect(await token.devFeeBp()).to.eq(4);
            expect(await token.k()).to.eq(5);
        });
    });

    describe(".claim", () => {
        beforeEach(async () => {
            await token.toggleAllowClaim();
        });

        it("should revert with='CLAIM_NOT_ALLOWED' when claim is not allowed", async () => {
            await token.toggleAllowClaim();
            await expect(
                token.claim(tree.getProof(airdropTreeValues[0]), deployer.address, 0, 1000),
            ).to.be.revertedWith("CLAIM_NOT_ALLOWED");
        });

        it("should revert with='SENDER_MUST_BE_ADDR' when sender isn't the beneficiary", async () => {
            const proof = tree.getProof(airdropTreeValues[0]);
            await expect(token.claim(proof, user2.address, 0, 1000)).to.be.revertedWith("SENDER_MUST_BE_ADDR");
        });

        it("should revert with='Invalid proof' when proof is invalid", async () => {
            const proof = tree.getProof(airdropTreeValues[0]);
            await expect(token.claim(proof, deployer.address, 0, 1000)).to.be.revertedWith("Invalid proof");
        });

        it("should be successful when proof is valid", async () => {
            const proof = tree.getProof(airdropTreeValues[0]);

            await expect(token.claim(proof, deployer.address, 0, "5000000000000000000"))
                .to.emit(token, "Claimed")
                .withArgs(deployer.address, 0, "5000000000000000000");

            expect(await token.claims(deployer.address)).to.eq("5000000000000000000");
            expect(await token.balanceOf(token.address)).to.eq(supply);
            expect(await token.balanceOf(deployer.address)).to.eq(deployerBal);
            expect(await token.claimedBalance()).to.eq("5000000000000000000");
        });

        it("should revert with='CLAIM_USED' if proof/claim was re-used", async () => {
            let proof = tree.getProof(airdropTreeValues[0]);

            await expect(token.claim(proof, deployer.address, 0, "5000000000000000000")).to.emit(token, "Claimed");

            proof = tree.getProof(airdropTreeValues[1]);
            await expect(token.claim(proof, deployer.address, 1, "2500000000000000000")).to.emit(token, "Claimed");

            await expect(token.claim(proof, deployer.address, 1, "2500000000000000000")).to.be.revertedWith(
                "CLAIM_USED",
            );
        });

        it("should revert with='CLAIM_ALLOC_EXCEEDED' when claim allocation exceeds airdrop allocation", async () => {
            await token.reInit(tree.root, 1, devSupply, bondingCurveAlloc, 0, 16000000);
            let proof = tree.getProof(airdropTreeValues[0]);
            await expect(token.claim(proof, deployer.address, 0, "5000000000000000000")).to.be.revertedWith(
                "CLAIM_ALLOC_EXCEEDED",
            );
        });
    });

    describe(".claimMulti", () => {
        beforeEach(async () => {
            await token.toggleAllowClaim();
        });

        it("should successfully claim multiple rewards", async () => {
            let proof0 = tree.getProof(airdropTreeValues[0]);
            let proof1 = tree.getProof(airdropTreeValues[1]);
            await expect(
                token.claimMulti(
                    [proof0, proof1],
                    deployer.address,
                    [0, 1],
                    ["5000000000000000000", "2500000000000000000"],
                ),
            )
                .to.emit(token, "Claimed")
                .withArgs(deployer.address, 0, "5000000000000000000")
                .to.emit(token, "Claimed")
                .withArgs(deployer.address, 1, "2500000000000000000");

            expect(await token.claims(deployer.address)).to.eq("7500000000000000000");
        });
    });

    describe(".withdrawClaim", () => {
        beforeEach(async () => {
            await token.toggleAllowClaim();
            await token.toggleAllowWithdraw();
        });

        it("should revert with 'WITHDRAW_NOT_ALLOWED' when withdraw is not allowed", async () => {
            await token.toggleAllowWithdraw();
            await expect(token.withdrawClaim()).to.be.revertedWith("WITHDRAW_NOT_ALLOWED");
        });

        it("should successfully withdraw claim", async () => {
            await token.claim(tree.getProof(airdropTreeValues[0]), deployer.address, 0, "5000000000000000000");
            await expect(token.withdrawClaim())
                .to.emit(token, "ClaimWithdrawn")
                .withArgs(deployer.address, "5000000000000000000");

            expect(await token.claims(deployer.address)).to.eq("0");
            expect(await token.balanceOf(deployer.address)).to.eq(deployerBal.add("5000000000000000000"));
        });
    });

    describe(".withdrawToken", () => {
        it("should revert with 'NOT_OWNER' when caller isn't the owner", async () => {
            await expect(token.connect(user3).withdrawToken(user2.address)).to.be.revertedWith("NOT_OWNER");
        });

        it("should withdraw all reward token", async () => {
            expect(await token.balanceOf(token.address)).to.eq(supply);

            await expect(token.withdrawToken(user2.address))
                .to.emit(token, "WithdrawnToken")
                .withArgs(user2.address, supply);

            expect(await token.balanceOf(token.address)).to.eq("0");
            expect(await token.balanceOf(user2.address)).to.eq(supply);
        });
    });

    describe(".buyPrice & .sellPrice", () => {
        it("should return the correct price", async () => {
            const supply = powOf(50_000_000_000);
            const buyPrice = await token.buyPrice(supply);
            expect(buyPrice).to.eq("318325000000000");

            let sellPrice = await token.sellPrice(supply, powOf(10_000_000_000));
            expect(sellPrice).to.eq("203728000000000");
            expect(buyPrice).to.gt(sellPrice);

            sellPrice = await token.sellPrice(supply, supply);
            expect(sellPrice).to.eq("1000000000000000000");
        });
    });

    describe(".buy", () => {
        beforeEach(async () => {
            await token.toggleAllowTrade();
        });

        it("should revert with 'TRADE_NOT_ALLOWED' when trade is not allowed", async () => {
            await token.toggleAllowTrade();
            await expect(token.buy(0, {value: powOf(0.000000001)})).to.be.revertedWith("TRADE_NOT_ALLOWED");
        });

        it("should revert with 'INVALID_AMOUNT' when amount is 0", async () => {
            await expect(token.buy(0, {value: 0})).to.be.revertedWith("INVALID_AMOUNT");
        });

        it("should revert with 'PRICE_TOO_HIGH' when price is too high", async () => {
            const price = await token.buyPrice(await token.circulatingSupply());
            await expect(token.buy(price.sub(1), {value: powOf(0.000000001)})).to.be.revertedWith("PRICE_TOO_HIGH");
        });

        it("should successfully buy tokens", async () => {
            const price = await token.buyPrice(await token.circulatingSupply());
            await expect(token.connect(user2).buy(price, {value: powOf(0.000000001)}))
                .to.emit(token, "Buy")
                .withArgs(user2.address, powOf(0.000000001), "490850545825806", 0);
            expect(await token.balanceOf(user2.address)).to.eq("490850545825806");
            expect(await token.bondingCurveEthBal()).to.eq("1000000000");
            expect(await token.bondingCurveAlloc()).to.eq(bondingCurveAlloc.sub("490850545825806"));
        });

        it("should revert with 'INSUFFICIENT_ALLOC' when bonding curve allocation is insufficient", async () => {
            let price = await token.buyPrice(await token.circulatingSupply());
            await expect(token.connect(user2).buy(price, {value: powOf(3626)})).not.to.be.reverted;
            price = await token.buyPrice(await token.circulatingSupply());
            await expect(token.buy(price, {value: powOf(2)})).to.be.revertedWith("INSUFFICIENT_ALLOC");
        });

        describe("with dev fee set", () => {
            beforeEach(async () => {
                await token.setDevFeeBp(1000);
            });

            it("should successfully buy tokens and deduct dev fee", async () => {
                const price = await token.buyPrice(await token.circulatingSupply());
                await expect(token.connect(user2).buy(price, {value: powOf(100)}))
                    .to.emit(token, "Buy")
                    .withArgs(user2.address, powOf(100), "44176549124322626246760386", powOf(10));
                expect(await token.devFeeEthBal()).to.eq(powOf(10));
            });
        });

        describe("buy transfer is disabled", () => {
            beforeEach(async () => {
                await token.toggleAllowBuyTransfer();
            });

            it("should successfully buy tokens but not transfer sold amount to sender", async () => {
                const price = await token.buyPrice(await token.circulatingSupply());
                await expect(token.connect(user2).buy(price, {value: powOf(0.000000001)}))
                    .to.emit(token, "Buy")
                    .withArgs(user2.address, powOf(0.000000001), "490850545825806", 0);
                expect(await token.balanceOf(user2.address)).to.eq("0");
                expect(await token.claims(user2.address)).to.eq("490850545825806");
                expect(await token.bondingCurveEthBal()).to.eq("1000000000");
                expect(await token.bondingCurveAlloc()).to.eq(bondingCurveAlloc.sub("490850545825806"));

                await token.toggleAllowWithdraw();
                await token.connect(user2).withdrawClaim();
                expect(await token.claims(user2.address)).to.eq("0");
                expect(await token.balanceOf(user2.address)).to.eq("490850545825806");
            });
        });
    });

    describe(".sell", () => {
        beforeEach(async () => {
            await token.toggleAllowTrade();
            await token.toggleAllowSell();
        });

        it("should revert with 'TRADE_NOT_ALLOWED' when trade is not allowed", async () => {
            await token.toggleAllowTrade();
            await expect(token.connect(user2).sell(1, 0)).to.be.revertedWith("TRADE_NOT_ALLOWED");
        });

        it("should revert with 'SELL_NOT_ALLOWED' when sell is not allowed", async () => {
            await token.toggleAllowSell();
            await expect(token.connect(user2).sell(1, 0)).to.be.revertedWith("SELL_NOT_ALLOWED");
        });

        it("should revert with 'INVALID_AMOUNT' when amount is 0", async () => {
            await expect(token.connect(user2).sell(0, 0)).to.be.revertedWith("INVALID_AMOUNT");
        });

        it("should revert when sender has insufficient token to sell", async () => {
            await expect(token.connect(user2).sell(1, 0)).to.be.revertedWith("ERC20: insufficient allowance");
        });

        it("should revert with 'PRICE_TOO_LOW' when price is too low", async () => {
            const price = await token.sellPrice(await token.circulatingSupply(), 1);
            await expect(token.connect(user2).sell(1, price.add(1))).to.be.revertedWith("PRICE_TOO_LOW");
        });

        it("should successfully sell tokens", async () => {
            let price = await token.buyPrice(await token.circulatingSupply());
            await expect(token.connect(user2).buy(price, {value: powOf(1)})).not.to.be.reverted;
            expect(await token.balanceOf(user2.address)).to.eq("490850545825806958297337");

            let tx: ContractTransaction;
            let amountToSell = "490850545825806958297337";
            await token.connect(user2).approve(token.address, amountToSell);

            let user2Bal = await user2.getBalance();

            price = await token.sellPrice(await token.circulatingSupply(), amountToSell);
            tx = await token.connect(user2).sell(amountToSell, price);
            expect(tx).to.emit(token, "Sell").withArgs(user2.address, amountToSell, "999999999999999999", 0);

            expect(await token.bondingCurveEthBal()).to.lt(powOf(1));
            expect(await token.bondingCurveAlloc()).to.eq(bondingCurveAlloc);

            const gasFee = (await tx.wait()).gasUsed.mul(tx.gasPrice as BigNumber);
            expect(await token.balanceOf(user2.address)).to.eq(0);
            expect(await user2.getBalance()).to.eq(user2Bal.add("999999999999999999").sub(gasFee));
        });

        describe("with dev fee set", () => {
            beforeEach(async () => {});

            it("should sell tokens and deduct dev fee", async () => {
                let price = await token.buyPrice(await token.circulatingSupply());
                await expect(token.connect(user2).buy(price, {value: powOf(1)}))
                    .to.emit(token, "Buy")
                    .withArgs(user2.address, "1000000000000000000", "490850545825806958297337", 0);
                expect(await token.devFeeEthBal()).to.eq(powOf(0));

                let amountToSell = "490850545825806958297337";
                await token.connect(user2).approve(token.address, amountToSell);
                await token.setDevFeeBp(1000);
                price = await token.sellPrice(await token.circulatingSupply(), amountToSell);
                await expect(token.connect(user2).sell(amountToSell, price))
                    .to.emit(token, "Sell")
                    .withArgs(user2.address, amountToSell, "900000000000000000", "99999999999999999");

                expect(await token.devFeeEthBal()).to.eq("99999999999999999");
            });
        });
    });

    describe(".buy through receive", () => {
        beforeEach(async () => {
            await token.toggleAllowTrade();
        });

        it("should revert with 'TRADE_NOT_ALLOWED' when trade is not allowed", async () => {
            await token.toggleAllowTrade();
            await expect(deployer.sendTransaction({to: token.address, value: powOf(0.000000001)})).to.be.revertedWith(
                "TRADE_NOT_ALLOWED",
            );
        });

        it("should revert with 'INVALID_AMOUNT' when amount is 0", async () => {
            await expect(deployer.sendTransaction({to: token.address, value: 0})).to.be.revertedWith("INVALID_AMOUNT");
        });

        it("should successfully buy tokens", async () => {
            await expect(user2.sendTransaction({to: token.address, value: powOf(0.000000001)}))
                .to.emit(token, "Buy")
                .withArgs(user2.address, powOf(0.000000001), "490850545825806", 0);

            expect(await token.balanceOf(user2.address)).to.eq("490850545825806");
            expect(await token.bondingCurveEthBal()).to.eq("1000000000");
            expect(await token.bondingCurveAlloc()).to.eq(bondingCurveAlloc.sub("490850545825806"));
        });

        it("should revert with 'INSUFFICIENT_ALLOC' when bonding curve allocation is insufficient", async () => {
            await expect(user2.sendTransaction({to: token.address, value: powOf(3626)})).not.to.be.reverted;
            await expect(user2.sendTransaction({to: token.address, value: powOf(2)})).to.be.revertedWith(
                "INSUFFICIENT_ALLOC",
            );
        });
    });

    describe(".withdrawEth", () => {
        it("should revert with 'NOT_OWNER' when caller isn't the owner", async () => {
            await expect(token.connect(user3).withdrawEth(user2.address)).to.be.revertedWith("NOT_OWNER");
        });

        it("should successfully withdraw all ETH", async () => {
            const price = await token.buyPrice(await token.circulatingSupply());
            await token.toggleAllowTrade();
            await expect(token.connect(user2).buy(price, {value: powOf(1)})).not.to.be.reverted;

            const user2Bal = await user2.getBalance();

            await expect(token.withdrawEth(user2.address))
                .to.emit(token, "WithdrawnEth")
                .withArgs(user2.address, powOf(1));

            expect(await ethers.provider.getBalance(token.address)).to.eq(0);
            expect(await user2.getBalance()).to.eq(user2Bal.add(powOf(1)));
        });
    });

    describe(".withdrawDevFee", () => {
        it("should revert with 'NOT_OWNER' when caller isn't the owner", async () => {
            await expect(token.connect(user3).withdrawDevFee(user2.address)).to.be.revertedWith("NOT_OWNER");
        });

        it("should successfully withdraw dev fee", async () => {
            await token.toggleAllowTrade();
            await token.setDevFeeBp(1000);

            const price = await token.buyPrice(await token.circulatingSupply());
            await expect(token.connect(user2).buy(price, {value: powOf(100)}))
                .to.emit(token, "Buy")
                .withArgs(user2.address, powOf(100), "44176549124322626246760386", powOf(10));
            expect(await token.devFeeEthBal()).to.eq(powOf(10));

            const user3Bal = await user3.getBalance();

            await expect(token.withdrawDevFee(user3.address))
                .to.emit(token, "WithdrawnDevFee")
                .withArgs(user3.address, powOf(10));

            expect(await token.devFeeEthBal()).to.eq(0);

            expect(await user3.getBalance()).to.eq(user3Bal.add(powOf(10)));
        });
    });

    describe("buying should reset claim", () => {
        it("should be successful allow proof reuse after minimum buy", async () => {
            await token.toggleAllowClaim();
            await token.toggleAllowTrade();

            const proof = tree.getProof(airdropTreeValues[0]);
            const amount = toBN("5000000000000000000");
            await expect(token.claim(proof, deployer.address, 0, amount)).not.to.be.reverted;
            expect(await token.claims(deployer.address)).to.eq(amount);

            // should not allow re-use of claim
            await expect(token.claim(proof, deployer.address, 0, amount)).to.be.revertedWith("CLAIM_USED");

            // Buying below the minimum buy for reset should not reset the claim
            await token.setMinBuyForReset(powOf(1));
            let price = await token.buyPrice(await token.circulatingSupply());
            await expect(token.buy(price, {value: powOf(0.1)})).not.to.be.reverted;
            await expect(token.claim(proof, deployer.address, 0, amount)).to.be.revertedWith("CLAIM_USED");

            // Buying equal or greater than the minimum buy for reset should reset the claim
            price = await token.buyPrice(await token.circulatingSupply());
            await expect(token.buy(price, {value: powOf(1)})).not.to.be.reverted;
            await expect(token.claim(proof, deployer.address, 0, amount)).not.to.be.reverted;
            expect(await token.claims(deployer.address)).to.eq(amount.mul(2));
        });
    });
});
