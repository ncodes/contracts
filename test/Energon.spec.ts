import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {BigNumber} from "ethers";
import {ethers} from "hardhat";
import {ENERGON} from "../typechain-types";
import {toBN} from "../utils/utils";

describe("NFT", function () {
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let accts: SignerWithAddress[];
    let e: ENERGON;
    let tokenDec: BigNumber;

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[2];

        let supply = toBN("1000000000000000000000000");
        let ENERGON = await ethers.getContractFactory("ENERGON");
        e = (await ENERGON.deploy("ENERGON", "ENR", supply, 18)) as ENERGON;
        tokenDec = toBN(10).pow(18);
    });

    describe(".setAllocator", () => {
        it("should revert with reason=NOT_OWNER when sender is not owner", async () => {
            await expect(e.connect(user2).setAllocator(user2.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully set address", async () => {
            await expect(e.setAllocator(user2.address)).not.to.be.reverted;
            expect(await e.allocator()).to.eql(user2.address);
        });
    });

    describe(".disableAllocation", () => {
        it("should revert with reason=NOT_OWNER when sender is not owner", async () => {
            await expect(e.connect(user2).disableAllocation()).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully set address", async () => {
            expect(await e.allocDisabled()).to.be.false;
            await expect(e.disableAllocation()).not.to.be.reverted;
            expect(await e.allocDisabled()).to.be.true;
        });
    });

    describe(".addMinters", () => {
        it("should revert with reason=NOT_OWNER when sender is not owner", async () => {
            await expect(e.connect(user2).addMinters([accts[0].address])).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully add address as minter", async () => {
            await expect(e.addMinters([accts[1].address])).not.to.be.reverted;
            expect(await e.minters(accts[1].address)).to.eql(toBN(1));
        });
    });

    describe(".removeMinter", () => {
        it("should revert with reason=NOT_OWNER when sender is not owner", async () => {
            await expect(e.connect(user2).removeMinter(accts[0].address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully remove minter", async () => {
            await expect(e.addMinters([accts[1].address, accts[2].address])).not.to.be.reverted;
            expect(await e.minters(accts[1].address)).to.eql(toBN(1));
            expect(await e.minters(accts[2].address)).to.eql(toBN(1));
            await expect(e.removeMinter(accts[1].address)).not.to.be.reverted;
            expect(await e.minters(accts[1].address)).to.eql(toBN(0));
            expect(await e.minters(accts[2].address)).to.eql(toBN(1));
            await expect(e.removeMinter(accts[2].address)).not.to.be.reverted;
            expect(await e.minters(accts[2].address)).to.eql(toBN(0));
        });
    });

    describe(".disableRecipientBlock", () => {
        it("should revert with reason=NOT_OWNER when sender is not owner", async () => {
            await expect(e.connect(user2).disableRecipientBlock()).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully disable recipient block", async () => {
            expect(await e.recipientsBlocked()).to.be.true;
            await expect(e.disableRecipientBlock()).not.to.be.reverted;
            expect(await e.recipientsBlocked()).to.be.false;
        });
    });

    describe(".addRecipient", () => {
        it("should revert with reason=NOT_OWNER when sender is not owner", async () => {
            await expect(e.connect(user2).addRecipient(accts[1].address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should add address as recipient", async () => {
            await expect(e.addRecipient(accts[1].address)).not.to.be.reverted;
            expect(await e.recipientsAllowlist(accts[1].address)).to.eql(toBN(1));
            expect(await e.recipientsAllowlist(accts[0].address)).to.eql(toBN(0));
        });
    });

    describe(".mint", () => {
        it("should revert with reason=NOT_MINTER when sender is not minter", async () => {
            await expect(e.connect(user2).mint(accts[1].address, 100)).to.be.revertedWith("ENERGON: NOT_MINTER");
        });

        it("should successfully mint if address is minter", async () => {
            await expect(e.addMinters([user2.address])).not.to.be.reverted;
            await expect(e.connect(user2).mint(accts[1].address, 100)).not.to.be.reverted;
            expect(await e.balanceOf(accts[1].address)).to.eql(toBN(100));
        });
    });

    describe(".claim", () => {
        it("should revert with reason='DISABLED' when allocation is disabled", async () => {
            await expect(e.disableAllocation()).not.to.be.reverted;
            await expect(e.claim(100, Buffer.alloc(1), 1)).to.be.revertedWith("ENERGON: DISABLED");
        });

        it("should revert with reason=BAD_SIG when signature is invalid", async () => {
            await expect(e.claim(100, Buffer.alloc(65), 1)).to.be.revertedWith("ENERGON: BAD_SIG");
        });

        it("should successfully mint when signature is valid", async () => {
            await e.setAllocator(deployer.address);
            const sigNonce = 0;
            const amt = 100;
            const msgHash = ethers.utils.keccak256(ethers.utils.solidityPack(["address", "uint256", "uint8"], [user2.address, amt, sigNonce]));
            const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
            const signedMsg = await deployer.signMessage(msgHashBytes);
            await expect(e.connect(user2).claim(amt, signedMsg, 0)).not.to.be.reverted;
            expect(await e.balanceOf(user2.address)).to.eql(toBN(amt));
        });

        it("should revert with reason=BAD_SIG when claimer is not the beneficiary", async () => {
            await e.setAllocator(deployer.address);
            const sigNonce = 0;
            const amt = 100;
            const msgHash = ethers.utils.keccak256(ethers.utils.solidityPack(["address", "uint256", "uint8"], [user2.address, amt, sigNonce]));
            const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
            const signedMsg = await deployer.signMessage(msgHashBytes);
            await expect(e.connect(accts[1]).claim(amt, signedMsg, 0)).to.be.revertedWith("ENERGON: BAD_SIG");
        });

        it("should revert with reason=BAD_SIG when signature nonce has been used before", async () => {
            await e.setAllocator(deployer.address);
            const sigNonce = 0;
            const amt = 100;
            const msgHash = ethers.utils.keccak256(ethers.utils.solidityPack(["address", "uint256", "uint8"], [user2.address, amt, sigNonce]));
            const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
            const signedMsg = await deployer.signMessage(msgHashBytes);
            await expect(e.connect(user2).claim(amt, signedMsg, 0)).not.to.be.reverted;
            await expect(e.connect(user2).claim(amt, signedMsg, 0)).to.be.revertedWith("ENERGON: SIG_NONCE_USED");
        });
    });

    describe(".transfer", () => {
        it("should revert with reason='NO_PERMIT' when recipient block is enabled and recipient is not allowed", async () => {
            expect(await e.recipientsBlocked()).to.be.true;
            await expect(e.transfer(user2.address, 100)).to.be.revertedWith("ENERGON: NO_PERMIT");
        });

        it("should not revert when recipient block is enabled and recipient is allowed", async () => {
            expect(await e.recipientsBlocked()).to.be.true;
            await expect(e.addRecipient(user2.address)).not.to.be.reverted;
            await expect(e.transfer(user2.address, 100)).not.to.be.reverted;
            expect(await e.balanceOf(user2.address)).to.eql(toBN(100));
        });

        it("should not revert when recipient block is disabled", async () => {
            await expect(e.disableRecipientBlock()).not.to.be.reverted;
            expect(await e.recipientsBlocked()).to.be.false;
            await expect(e.transfer(user2.address, 100)).not.to.be.reverted;
            expect(await e.balanceOf(user2.address)).to.eql(toBN(100));
        });
    });

    describe(".transferFrom", () => {
        it("should revert with reason='NO_PERMIT' when recipient block is enabled and recipient is not allowed", async () => {
            expect(await e.recipientsBlocked()).to.be.true;
            await expect(e.transferFrom(deployer.address, user2.address, 100)).to.be.revertedWith("ENERGON: NO_PERMIT");
        });

        it("should not revert when recipient block is enabled and recipient is allowed", async () => {
            expect(await e.recipientsBlocked()).to.be.true;
            await expect(e.addRecipient(user2.address)).not.to.be.reverted;
            await expect(e.approve(accts[1].address, 100)).not.to.be.reverted;
            await expect(e.connect(accts[1]).transferFrom(deployer.address, user2.address, 100)).not.to.be.reverted;
            expect(await e.balanceOf(user2.address)).to.eql(toBN(100));
        });

        it("should not revert when recipient block is disabled", async () => {
            await expect(e.disableRecipientBlock()).not.to.be.reverted;
            expect(await e.recipientsBlocked()).to.be.false;
            await expect(e.approve(accts[1].address, 100)).not.to.be.reverted;
            await expect(e.connect(accts[1]).transferFrom(deployer.address, user2.address, 100)).not.to.be.reverted;
            expect(await e.balanceOf(user2.address)).to.eql(toBN(100));
        });
    });
});
