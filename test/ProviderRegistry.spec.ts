import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {ProviderRegistry} from "../typechain-types";
import {AddressZero} from "../utils/utils";

describe("ProviderRegistry", function () {
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let accts: SignerWithAddress[];
    let provReg: ProviderRegistry;

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[1];
        user3 = accts[2];

        let factory = await ethers.getContractFactory("ProviderRegistry");
        provReg = (await factory.deploy()) as ProviderRegistry;

        await provReg.updateWriter(deployer.address, true);
    });

    describe(".register", () => {
        it("should revert if sender is not a writer", async () => {
            await expect(provReg.connect(user2).register(user2.address)).to.be.revertedWith("W: NOT_WRITER");
        });

        it("should register successfully", async () => {
            await provReg.register(user2.address);
            expect(await provReg.providerIdx(user2.address)).to.eq(1);
            expect(await provReg.providers(1)).to.eq(user2.address);
            expect(await provReg.nextId()).to.eq(2);

            // re-register should not change anything
            await provReg.register(user2.address);
            expect(await provReg.providerIdx(user2.address)).to.eq(1);
            expect(await provReg.providers(1)).to.eq(user2.address);
            expect(await provReg.nextId()).to.eq(2);

            await provReg.register(user3.address);
            expect(await provReg.providerIdx(user3.address)).to.eq(2);
            expect(await provReg.providers(2)).to.eq(user3.address);
            expect(await provReg.nextId()).to.eq(3);
        });
    });

    describe(".getByAddr", () => {
        it("should return zero if address was not registered", async () => {
            expect(await provReg.getByAddr(user2.address)).to.eq(0);
        });

        it("should return correct ID", async () => {
            await provReg.register(user2.address);
            expect(await provReg.getByAddr(user2.address)).to.eq(1);
        });
    });

    describe(".get", () => {
        it("should return zero if ID was not registered", async () => {
            expect(await provReg.get(1)).to.eq(AddressZero);
        });

        it("should return correct address", async () => {
            await provReg.register(user2.address);
            expect(await provReg.get(1)).to.eq(user2.address);
        });
    });
});
