import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {BigNumber, ContractTransaction} from "ethers";
import {ethers} from "hardhat";
import {BondCurveDistro, TOKEN} from "../typechain-types";
import {AddressZero, powOf, toBN} from "../utils/utils";
const {getContractFactory} = ethers;

describe("BondCurveDistro", function () {
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let accts: SignerWithAddress[];
    let contract: BondCurveDistro;
    let rewardToken: TOKEN;
    let chainId = 31337;
    let deployerBal = toBN("0");
    let supply = powOf(10_000_000_000);
    let devSupply = powOf(4_400_000_000);
    let bondingCurveAlloc = powOf(1_000_000_000);
    let airdropAlloc = powOf(4_000_000_000);

    async function getClaimSig(
        signer: SignerWithAddress,
        beneficiary: SignerWithAddress,
        amount: string,
        claimId: string | number,
        nonce: string | number,
    ) {
        const msgHash = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                ["uint", "address", "uint256", "uint", "uint"],
                [chainId, beneficiary.address, amount, claimId, nonce],
            ),
        );
        const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
        return signer.signMessage(msgHashBytes);
    }

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[2];
        user3 = accts[3];

        let TOKEN = await getContractFactory("TOKEN");
        rewardToken = (await TOKEN.deploy("TEST", "TEST", supply, 18)) as TOKEN;

        let factory = await ethers.getContractFactory("BondCurveDistro");
        contract = (await factory.deploy(
            rewardToken.address,
            airdropAlloc,
            devSupply,
            bondingCurveAlloc,
            0,
        )) as BondCurveDistro;

        await rewardToken.transfer(contract.address, supply);
        await contract.toggleAllowBuyTransfer();
        await contract.setClaimSigner(deployer.address);

        deployerBal = await rewardToken.balanceOf(deployer.address);
    });

    describe(".reInit", () => {
        it("should revert with 'NOT_OWNER' when caller isn't the owner", async () => {
            await expect(
                contract.connect(user2).reInit(rewardToken.address, 1, devSupply, bondingCurveAlloc, 0, 16000000),
            ).to.be.revertedWith("NOT_OWNER");
        });

        it("should be successful when caller is the owner", async () => {
            await expect(contract.reInit(rewardToken.address, 1, 2, 3, 4, 5))
                .to.emit(contract, "ReInitialized")
                .withArgs(rewardToken.address, 1, 2, 3, 4, 5);
            expect(await contract.rewardToken()).to.eq(rewardToken.address);
            expect(await contract.airdropAlloc()).to.eq(1);
            expect(await contract.devAlloc()).to.eq(2);
            expect(await contract.bondingCurveAlloc()).to.eq(3);
            expect(await contract.devFeeBp()).to.eq(4);
            expect(await contract.k()).to.eq(5);
        });
    });

    describe(".claim", () => {
        beforeEach(async () => {
            await contract.toggleAllowClaim();
        });

        it("should revert with='CLAIM_NOT_ALLOWED' when claim is not allowed", async () => {
            await contract.toggleAllowClaim();
            await expect(contract.claim(1000, 0, 0, Buffer.alloc(0))).to.be.revertedWith("CLAIM_NOT_ALLOWED");
        });

        it("should revert with='INVALID_SIGNATURE' when signature is invalid", async () => {
            await expect(contract.claim(1000, 0, 0, Buffer.alloc(65))).to.be.revertedWith("INVALID_SIG");
        });

        it("should be successful when proof is valid", async () => {
            const signedMsg = await getClaimSig(deployer, deployer, "5000000000000000000", 0, 0);

            await expect(contract.claim("5000000000000000000", 0, 0, signedMsg))
                .to.emit(contract, "Claimed")
                .withArgs(deployer.address, 0, 0, "5000000000000000000");

            expect(await contract.claims(deployer.address)).to.eq("5000000000000000000");
            expect(await rewardToken.balanceOf(contract.address)).to.eq(supply);
            expect(await rewardToken.balanceOf(deployer.address)).to.eq(deployerBal);
            expect(await contract.claimedBalance()).to.eq("5000000000000000000");
        });

        it("should revert with='NONCE_USED' if signature was re-used", async () => {
            const signedMsg = await getClaimSig(deployer, deployer, "5000000000000000000", 0, 0);

            await expect(contract.claim("5000000000000000000", 0, 0, signedMsg)).not.to.be.reverted;

            await expect(contract.claim("5000000000000000000", 0, 0, signedMsg)).to.be.revertedWith("NONCE_USED");
        });

        it("should revert with='CLAIM_ALLOC_EXCEEDED' when claim allocation exceeds airdrop allocation", async () => {
            await contract.reInit(rewardToken.address, 1, devSupply, bondingCurveAlloc, 0, 16000000);
            const signedMsg = await getClaimSig(deployer, deployer, "5000000000000000000", 0, 0);
            await expect(contract.claim("5000000000000000000", 0, 0, signedMsg)).to.be.revertedWith(
                "CLAIM_ALLOC_EXCEEDED",
            );
        });
    });

    describe(".claimMulti", () => {
        beforeEach(async () => {
            await contract.toggleAllowClaim();
        });

        it("should successfully claim multiple rewards", async () => {
            const signedMsg = await getClaimSig(deployer, deployer, "5000000000000000000", 0, 0);
            const signedMsg2 = await getClaimSig(deployer, deployer, "2500000000000000000", 0, 1);

            await expect(
                contract.claimMulti(
                    [signedMsg, signedMsg2],
                    [0, 0],
                    [0, 1],
                    ["5000000000000000000", "2500000000000000000"],
                ),
            )
                .to.emit(contract, "Claimed")
                .withArgs(deployer.address, 0, 0, "5000000000000000000")
                .to.emit(contract, "Claimed")
                .withArgs(deployer.address, 0, 1, "2500000000000000000");

            expect(await contract.claims(deployer.address)).to.eq("7500000000000000000");
        });
    });

    describe(".withdrawClaim", () => {
        beforeEach(async () => {
            await contract.toggleAllowClaim();
            await contract.toggleAllowWithdraw();
        });

        it("should revert with 'WITHDRAW_NOT_ALLOWED' when withdraw is not allowed", async () => {
            await contract.toggleAllowWithdraw();
            await expect(contract.withdrawClaim()).to.be.revertedWith("WITHDRAW_NOT_ALLOWED");
        });

        it("should successfully withdraw claim", async () => {
            const signedMsg = await getClaimSig(deployer, deployer, "5000000000000000000", 0, 0);
            await contract.claim("5000000000000000000", 0, 0, signedMsg);

            await expect(contract.withdrawClaim())
                .to.emit(contract, "ClaimWithdrawn")
                .withArgs(deployer.address, "5000000000000000000");

            expect(await contract.claims(deployer.address)).to.eq("0");
            expect(await rewardToken.balanceOf(deployer.address)).to.eq(deployerBal.add("5000000000000000000"));
        });
    });

    describe(".withdrawToken", () => {
        it("should revert with 'NOT_OWNER' when caller isn't the owner", async () => {
            await expect(contract.connect(user3).withdrawToken(user2.address)).to.be.revertedWith("NOT_OWNER");
        });

        it("should revert with 'INVALID_BENEFICIARY' when beneficiary is 0", async () => {
            await expect(contract.withdrawToken(AddressZero)).to.be.revertedWith("INVALID_BENEFICIARY");
        });

        it("should withdraw all reward token", async () => {
            expect(await rewardToken.balanceOf(contract.address)).to.eq(supply);

            await expect(contract.withdrawToken(user2.address))
                .to.emit(contract, "WithdrawnToken")
                .withArgs(user2.address, supply);

            expect(await rewardToken.balanceOf(contract.address)).to.eq("0");
            expect(await rewardToken.balanceOf(user2.address)).to.eq(supply);
        });
    });

    describe(".buyPrice & .sellPrice", () => {
        it("should return the correct price", async () => {
            const supply = powOf(50_000_000_000);
            const buyPrice = await contract.buyPrice(supply);
            expect(buyPrice).to.eq("200000000000000");

            let sellPrice = await contract.sellPrice(supply, powOf(10_000_000_000));
            expect(sellPrice).to.eq("128000000000000");
            expect(buyPrice).to.gt(sellPrice);

            sellPrice = await contract.sellPrice(supply, supply);
            expect(sellPrice).to.eq("1000000000000000000");
        });
    });

    describe(".buy", () => {
        beforeEach(async () => {
            await contract.toggleAllowTrade();
        });

        it("should revert with 'TRADE_NOT_ALLOWED' when trade is not allowed", async () => {
            await contract.toggleAllowTrade();
            await expect(contract.buy(0, {value: powOf(0.000000001)})).to.be.revertedWith("TRADE_NOT_ALLOWED");
        });

        it("should revert with 'INVALID_AMOUNT' when amount is 0", async () => {
            await expect(contract.buy(0, {value: 0})).to.be.revertedWith("INVALID_AMOUNT");
        });

        it("should revert with 'PRICE_TOO_HIGH' when price is too high", async () => {
            const price = await contract.buyPrice(await contract.circulatingSupply());
            await expect(contract.buy(price.sub(1), {value: powOf(0.000000001)})).to.be.revertedWith("PRICE_TOO_HIGH");
        });

        it("should successfully buy tokens", async () => {
            const price = await contract.buyPrice(await contract.circulatingSupply());
            await expect(contract.connect(user2).buy(price, {value: powOf(0.000000001)}))
                .to.emit(contract, "Buy")
                .withArgs(user2.address, powOf(0.000000001), "645661157024793", 0);
            expect(await rewardToken.balanceOf(user2.address)).to.eq("645661157024793");
            expect(await contract.bondingCurveEthBal()).to.eq("1000000000");
            expect(await contract.bondingCurveAlloc()).to.eq(bondingCurveAlloc.sub("645661157024793"));
        });

        it("should revert with 'INSUFFICIENT_ALLOC' when bonding curve allocation is insufficient", async () => {
            let price = await contract.buyPrice(await contract.circulatingSupply());
            await expect(contract.connect(user2).buy(price, {value: powOf(1548)})).not.to.be.reverted;
            price = await contract.buyPrice(await contract.circulatingSupply());
            await expect(contract.buy(price, {value: powOf(2)})).to.be.revertedWith("INSUFFICIENT_ALLOC");
        });

        describe("with dev fee set", () => {
            beforeEach(async () => {
                await contract.setDevFeeBp(1000);
            });

            it("should successfully buy tokens and deduct dev fee", async () => {
                const price = await contract.buyPrice(await contract.circulatingSupply());
                await expect(contract.connect(user2).buy(price, {value: powOf(100)}))
                    .to.emit(contract, "Buy")
                    .withArgs(user2.address, powOf(100), "58109504132231404958677685", powOf(10));
                expect(await contract.devFeeEthBal()).to.eq(powOf(10));
            });
        });

        describe("buy transfer is disabled", () => {
            beforeEach(async () => {
                await contract.toggleAllowBuyTransfer();
            });

            it("should successfully buy tokens but not transfer sold amount to sender", async () => {
                const price = await contract.buyPrice(await contract.circulatingSupply());
                await expect(contract.connect(user2).buy(price, {value: powOf(0.000000001)}))
                    .to.emit(contract, "Buy")
                    .withArgs(user2.address, powOf(0.000000001), "645661157024793", 0);
                expect(await rewardToken.balanceOf(user2.address)).to.eq("0");
                expect(await contract.claims(user2.address)).to.eq("645661157024793");
                expect(await contract.bondingCurveEthBal()).to.eq("1000000000");
                expect(await contract.bondingCurveAlloc()).to.eq(bondingCurveAlloc.sub("645661157024793"));

                await contract.toggleAllowWithdraw();
                await contract.connect(user2).withdrawClaim();
                expect(await contract.claims(user2.address)).to.eq("0");
                expect(await rewardToken.balanceOf(user2.address)).to.eq("645661157024793");
            });
        });
    });

    describe(".sell", () => {
        beforeEach(async () => {
            await contract.toggleAllowTrade();
            await contract.toggleAllowSell();
        });

        it("should revert with 'TRADE_NOT_ALLOWED' when trade is not allowed", async () => {
            await contract.toggleAllowTrade();
            await expect(contract.connect(user2).sell(1, 0)).to.be.revertedWith("TRADE_NOT_ALLOWED");
        });

        it("should revert with 'SELL_NOT_ALLOWED' when sell is not allowed", async () => {
            await contract.toggleAllowSell();
            await expect(contract.connect(user2).sell(1, 0)).to.be.revertedWith("SELL_NOT_ALLOWED");
        });

        it("should revert with 'INVALID_AMOUNT' when amount is 0", async () => {
            await expect(contract.connect(user2).sell(0, 0)).to.be.revertedWith("INVALID_AMOUNT");
        });

        it("should revert when sender has insufficient token to sell", async () => {
            await expect(contract.connect(user2).sell(1, 0)).to.be.revertedWith("ERC20: insufficient allowance");
        });

        it("should revert with 'PRICE_TOO_LOW' when price is too low", async () => {
            const price = await contract.sellPrice(await contract.circulatingSupply(), 1);
            await expect(contract.connect(user2).sell(1, price.add(1))).to.be.revertedWith("PRICE_TOO_LOW");
        });

        it("should successfully sell tokens", async () => {
            let price = await contract.buyPrice(await contract.circulatingSupply());
            await expect(contract.connect(user2).buy(price, {value: powOf(1)})).not.to.be.reverted;
            expect(await rewardToken.balanceOf(user2.address)).to.eq("645661157024793388429752");

            let tx: ContractTransaction;
            let amountToSell = "645661157024793388429752";
            await rewardToken.connect(user2).approve(contract.address, amountToSell);

            let user2Bal = await user2.getBalance();

            price = await contract.sellPrice(await contract.circulatingSupply(), amountToSell);
            tx = await contract.connect(user2).sell(amountToSell, price);
            expect(tx).to.emit(contract, "Sell").withArgs(user2.address, amountToSell, "999999999999999999", 0);

            expect(await contract.bondingCurveEthBal()).to.lt(powOf(1));
            expect(await contract.bondingCurveAlloc()).to.eq(bondingCurveAlloc);

            const gasFee = (await tx.wait()).gasUsed.mul(tx.gasPrice as BigNumber);
            expect(await rewardToken.balanceOf(user2.address)).to.eq(0);
            expect(await user2.getBalance()).to.eq(user2Bal.add("999999999999999999").sub(gasFee));
        });

        describe("with dev fee set", () => {
            beforeEach(async () => {});

            it("should sell tokens and deduct dev fee", async () => {
                let price = await contract.buyPrice(await contract.circulatingSupply());
                await expect(contract.connect(user2).buy(price, {value: powOf(1)}))
                    .to.emit(contract, "Buy")
                    .withArgs(user2.address, "1000000000000000000", "645661157024793388429752", 0);
                expect(await contract.devFeeEthBal()).to.eq(powOf(0));

                let amountToSell = "645661157024793388429752";
                await rewardToken.connect(user2).approve(contract.address, amountToSell);
                await contract.setDevFeeBp(1000);
                price = await contract.sellPrice(await contract.circulatingSupply(), amountToSell);
                await expect(contract.connect(user2).sell(amountToSell, price))
                    .to.emit(contract, "Sell")
                    .withArgs(user2.address, amountToSell, "900000000000000000", "99999999999999999");

                expect(await contract.devFeeEthBal()).to.eq("99999999999999999");
            });
        });
    });

    describe(".buy through receive", () => {
        beforeEach(async () => {
            await contract.toggleAllowTrade();
        });

        it("should revert with 'TRADE_NOT_ALLOWED' when trade is not allowed", async () => {
            await contract.toggleAllowTrade();
            await expect(
                deployer.sendTransaction({to: contract.address, value: powOf(0.000000001)}),
            ).to.be.revertedWith("TRADE_NOT_ALLOWED");
        });

        it("should revert with 'INVALID_AMOUNT' when amount is 0", async () => {
            await expect(deployer.sendTransaction({to: contract.address, value: 0})).to.be.revertedWith(
                "INVALID_AMOUNT",
            );
        });

        it("should successfully buy tokens", async () => {
            await expect(user2.sendTransaction({to: contract.address, value: powOf(0.000000001)}))
                .to.emit(contract, "Buy")
                .withArgs(user2.address, powOf(0.000000001), "645661157024793", 0);

            expect(await rewardToken.balanceOf(user2.address)).to.eq("645661157024793");
            expect(await contract.bondingCurveEthBal()).to.eq("1000000000");
            expect(await contract.bondingCurveAlloc()).to.eq(bondingCurveAlloc.sub("645661157024793"));
        });

        it("should revert with 'INSUFFICIENT_ALLOC' when bonding curve allocation is insufficient", async () => {
            await expect(user2.sendTransaction({to: contract.address, value: powOf(1548)})).not.to.be.reverted;
            await expect(user2.sendTransaction({to: contract.address, value: powOf(2)})).to.be.revertedWith(
                "INSUFFICIENT_ALLOC",
            );
        });
    });

    describe(".withdrawEth", () => {
        it("should revert with 'NOT_OWNER' when caller isn't the owner", async () => {
            await expect(contract.connect(user3).withdrawEth(user2.address)).to.be.revertedWith("NOT_OWNER");
        });

        it("should revert with 'INVALID_BENEFICIARY' when beneficiary is 0", async () => {
            await expect(contract.withdrawEth(AddressZero)).to.be.revertedWith("INVALID_BENEFICIARY");
        });

        it("should successfully withdraw all ETH", async () => {
            const price = await contract.buyPrice(await contract.circulatingSupply());
            await contract.toggleAllowTrade();
            await expect(contract.connect(user2).buy(price, {value: powOf(1)})).not.to.be.reverted;

            const user2Bal = await user2.getBalance();

            await expect(contract.withdrawEth(user2.address))
                .to.emit(contract, "WithdrawnEth")
                .withArgs(user2.address, powOf(1));

            expect(await ethers.provider.getBalance(contract.address)).to.eq(0);
            expect(await user2.getBalance()).to.eq(user2Bal.add(powOf(1)));
        });
    });

    describe(".withdrawDevFee", () => {
        it("should revert with 'NOT_OWNER' when caller isn't the owner", async () => {
            await expect(contract.connect(user3).withdrawDevFee(user2.address)).to.be.revertedWith("NOT_OWNER");
        });

        it("should revert with 'INVALID_BENEFICIARY' when beneficiary is 0", async () => {
            await expect(contract.withdrawDevFee(AddressZero)).to.be.revertedWith("INVALID_BENEFICIARY");
        });

        it("should successfully withdraw dev fee", async () => {
            await contract.toggleAllowTrade();
            await contract.setDevFeeBp(1000);

            const price = await contract.buyPrice(await contract.circulatingSupply());
            await expect(contract.connect(user2).buy(price, {value: powOf(100)}))
                .to.emit(contract, "Buy")
                .withArgs(user2.address, powOf(100), "58109504132231404958677685", powOf(10));
            expect(await contract.devFeeEthBal()).to.eq(powOf(10));

            const user3Bal = await user3.getBalance();

            await expect(contract.withdrawDevFee(user3.address))
                .to.emit(contract, "WithdrawnDevFee")
                .withArgs(user3.address, powOf(10));

            expect(await contract.devFeeEthBal()).to.eq(0);

            expect(await user3.getBalance()).to.eq(user3Bal.add(powOf(10)));
        });
    });
});
