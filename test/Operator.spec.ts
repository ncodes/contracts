import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {Operator, TOKEN} from "../typechain-types";
import {AddressZero} from "../utils/utils";
import {initCoreTestSuite} from "./helpers/helpers";

describe("Operator", function () {
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let accts: SignerWithAddress[];
    let bond = 100;
    let op: Operator;
    let token: TOKEN;

    beforeEach(async () => {
        const vars = await initCoreTestSuite();
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[1];
        user3 = accts[2];
        token = vars.token;

        let factory = await ethers.getContractFactory("Operator");
        op = (await factory.deploy(token.address, bond)) as Operator;
    });

    describe(".setBond", () => {
        it("should revert with msg= when sender is not owner", async () => {
            await expect(op.connect(user2).setBond(1)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should update correctly", async () => {
            await expect(op.setBond(1)).emit(op, "UpdatedBond").withArgs(1);
            expect(await op.bond()).to.eq(1);
        });
    });

    describe(".setBondToken", () => {
        it("should revert with msg= when sender is not owner", async () => {
            await expect(op.connect(user2).setBondToken(user2.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should update correctly", async () => {
            await expect(op.setBondToken(user2.address)).emit(op, "UpdatedBondToken").withArgs(user2.address);
            expect(await op.bondToken()).to.eq(user2.address);
        });
    });

    describe(".register", () => {
        it("should revert when sender has insufficient allowance/balance to pay the bond", async () => {
            await expect(op.connect(user2).register()).to.be.revertedWith("ERC20: insufficient allowance");
        });

        it("should register sender as operator if sender has sufficient bond", async () => {
            await token.transfer(user2.address, bond);
            await token.connect(user2).approve(op.address, bond);
            await expect(op.connect(user2).register()).emit(op, "AddedOperator").withArgs(user2.address, 1, bond);
            const operator = await op.operators(user2.address);
            expect(operator.id).to.eq(1);
            expect(operator.exists).to.be.true;
            expect(operator.bond).to.eq(bond);
            expect(await op.operatorById(1)).to.eq(user2.address);
            expect(await token.balanceOf(op.address)).to.eq(bond);
        });

        it("should revert when sender is already an operator", async () => {
            await token.transfer(user2.address, bond);
            await token.connect(user2).approve(op.address, bond);
            await expect(op.connect(user2).register()).not.be.reverted;
            await expect(op.connect(user2).register()).be.revertedWith("OP: OPERATOR_EXISTS");
        });
    });

    describe(".unregister", () => {
        it("should revert when sender is not an operator", async () => {
            await expect(op.connect(user2).unregister()).to.be.revertedWith("OP: OPERATOR_NEXISTS");
        });

        it("should successfully unregister operator", async () => {
            await token.transfer(user2.address, bond);
            await token.connect(user2).approve(op.address, bond);
            await expect(op.connect(user2).register()).not.be.reverted;
            await expect(op.connect(user2).unregister()).emit(op, "RemovedOperator").withArgs(user2.address, 1);
            const operator = await op.operators(user2.address);
            expect(operator.id).to.eq(0);
            expect(operator.exists).to.be.false;
            expect(operator.bond).to.eq(0);
            expect(await op.operatorById(1)).to.eq(AddressZero);
            expect(await token.balanceOf(op.address)).to.eq(0);
            expect(await token.balanceOf(user2.address)).to.eq(bond);
        });
    });

    describe(".isOperator", () => {
        it("should behave correctly", async () => {
            await token.transfer(user2.address, bond);
            await token.connect(user2).approve(op.address, bond);
            await expect(op.connect(user2).register()).not.be.reverted;
            expect(await op["isOperator(address)"](user2.address)).to.be.true;
            expect(await op["isOperator(uint256)"](1)).to.be.true;

            await expect(op.connect(user2).unregister()).not.to.be.reverted;
            expect(await op["isOperator(address)"](user2.address)).to.be.false;
            expect(await op["isOperator(uint256)"](1)).to.be.false;
        });
    });

    describe(".getOperator & .getId", () => {
        it("should behave correctly", async () => {
            await token.transfer(user2.address, bond);
            await token.connect(user2).approve(op.address, bond);
            await expect(op.connect(user2).register()).not.be.reverted;
            expect(await op.getOperator(1)).to.eq(user2.address);
            expect(await op.getId(user2.address)).to.eq(1);

            await expect(op.connect(user2).unregister()).not.to.be.reverted;
            expect(await op.getOperator(1)).to.eq(AddressZero);
            expect(await op.getId(user2.address)).to.eq(0);
        });
    });
});
