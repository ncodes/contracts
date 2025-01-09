import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {AssetRegistry} from "../typechain-types";

describe("AssetRegistry - Ownable", async () => {
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let accts: SignerWithAddress[];
    let assetReg: AssetRegistry;

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[1];
        user3 = accts[2];

        let factory = await ethers.getContractFactory("AssetRegistry");
        assetReg = (await factory.deploy()) as AssetRegistry;
    });

    describe("transferOwnership", () => {

        it("should revert if not called by owner", async () => {
            await expect(
                assetReg.connect(user2).transferOwnership(user3.address)
            ).to.be.revertedWith("OWNABLE: NOT_OWNER")
        });

        it("should revert if transferring ownership to zero address", async () => {
            await expect(
                assetReg.connect(deployer).transferOwnership(ethers.constants.AddressZero)
            ).to.be.revertedWith("INVALID_ADDRESS")
        });

        
    });


})