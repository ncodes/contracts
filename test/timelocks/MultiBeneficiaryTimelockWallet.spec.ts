import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {MultiBeneficiaryTimelockWallet, TOKEN, TimelockWallet} from "../../typechain-types";
import {advanceBlockTime, powOf, toBN, toDec} from "../../utils/utils";

describe("MultiBeneficiaryTimelockWallet", function () {
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let allocator: SignerWithAddress;
    let accts: SignerWithAddress[];
    let multiTL: MultiBeneficiaryTimelockWallet;
    let startTimeDur = 3600;
    let amount = 100;
    let vestingDur = 100;
    let token: TOKEN;
    const chainId = 31337;
    let tgeAllocPct = 10; // 10%

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[1];
        user3 = accts[2];
        allocator = accts[3];

        let supply = toBN("500000000000000000000000000");
        let TOKEN = await ethers.getContractFactory("MINTABLE_TOKEN");
        token = (await TOKEN.deploy("REWARD_TOKEN", "REWARD_TOKEN", supply, 18)) as TOKEN;

        let factory = await ethers.getContractFactory("MultiBeneficiaryTimelockWallet");
        const now = await advanceBlockTime(1);
        const startTime = now + startTimeDur;
        multiTL = (await factory.deploy(token.address, allocator.address, tgeAllocPct * 100, startTime, vestingDur)) as MultiBeneficiaryTimelockWallet;
    });

    describe(".setAllocator", () => {
        context("when the caller is the deployer", () => {
            it("should set the allocator", async () => {
                await multiTL.setAllocator(user2.address);
                expect(await multiTL.allocator()).to.equal(user2.address);
            });
        });

        context("when the caller is not the deployer", () => {
            it("should revert", async () => {
                await expect(multiTL.connect(user2).setAllocator(user3.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
            });
        });
    });

    describe(".setToken", () => {
        context("when the caller is the deployer", () => {
            it("should set the token", async () => {
                await multiTL.setToken(user2.address);
                expect(await multiTL.token()).to.equal(user2.address);
            });
        });

        context("when the caller is not the deployer", () => {
            it("should revert", async () => {
                await expect(multiTL.connect(user2).setToken(user3.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
            });
        });
    });

    describe(".claim", () => {
        it("should revert if signature is invalid", async () => {
            await expect(multiTL.claim(user2.address, 100, Buffer.alloc(65))).to.be.revertedWith("INVALID_SIGNATURE");
        });

        it("should revert if contract contains insufficient token to be claimed", async () => {
            const alloc = powOf(1000, 18);
            const msgHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["uint", "address", "uint256"], [chainId, user2.address, alloc]));
            const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
            const signedMsg = await allocator.signMessage(msgHashBytes);
            await expect(multiTL.claim(user2.address, alloc, signedMsg)).to.be.revertedWith("ERC20: transfer amount exceeds balance");
        });

        it("should claim successfully when signature is valid and enough claimable token exist in the contract", async () => {
            const alloc = toDec(powOf(1000, 18));
            const msgHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["uint", "address", "uint256"], [chainId, user2.address, alloc.toFixed()]));
            const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
            const signedMsg = await allocator.signMessage(msgHashBytes);

            const beneficiaryBal = await token.balanceOf(user2.address);

            await token.transfer(multiTL.address, alloc.toFixed());
            await expect(multiTL.claim(user2.address, alloc.toFixed(), signedMsg)).not.to.be.reverted;

            // ensure the correct tge allocation was transferred to beneficiary
            const tgeAlloc = alloc.mul(tgeAllocPct / 100);
            expect(await token.balanceOf(user2.address)).to.equal(beneficiaryBal.add(tgeAlloc.toFixed()));

            // ensure timelock wallet was created for the beneficiary
            const timelockWallet = await multiTL.timelockWallets(user2.address);
            expect(timelockWallet).not.to.equal(ethers.constants.AddressZero);

            // ensure the correct amount was transferred to the timelock wallet
            const expectedAmount = alloc.sub(tgeAlloc);
            expect(await token.balanceOf(timelockWallet)).to.equal(expectedAmount.toFixed());

            // the contract should have no more token
            expect(await token.balanceOf(multiTL.address)).to.equal(0);

            // check the released amount in the timelock
            const timelockWalletIns = (await ethers.getContractAt("TimelockWallet", timelockWallet)) as TimelockWallet;
            await advanceBlockTime((await timelockWalletIns.start()).add(vestingDur + 1).toNumber());
            expect(await timelockWalletIns["releasable(address)"](token.address)).to.eq(expectedAmount.toFixed());

            // It should fail if claim is attempted again
            await expect(multiTL.claim(user2.address, alloc.toFixed(), signedMsg)).to.be.revertedWith("TGE_ALLOC_CLAIMED");

            // release timelock wallet
            const user2Bal = await token.balanceOf(user2.address);
            await timelockWalletIns["release(address)"](token.address);
            expect(await token.balanceOf(user2.address)).to.equal(user2Bal.add(expectedAmount.toFixed()));
            expect(await token.balanceOf(user2.address)).to.equal(alloc.toFixed());
        });
    });
});
