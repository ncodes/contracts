import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {ethers, waffle} from "hardhat";
import {Randomness} from "../typechain-types";
import {MockContract} from "ethereum-waffle";
const {deployMockContract} = waffle;

describe("Randomness", function () {
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let accts: SignerWithAddress[];
    let rand: Randomness;
    let coordinator: MockContract;
    const keyHash = Buffer.alloc(32);
    const subId = 1;

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[2];

        const VRFCoordinator = require("../artifacts/@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol/VRFCoordinatorV2Interface.json");
        coordinator = await deployMockContract(deployer, VRFCoordinator.abi);

        let Randomness = await ethers.getContractFactory("Randomness");
        rand = await Randomness.deploy(keyHash, coordinator.address, subId);
    });

    describe(".setRequestInterval ", function () {
        it("should revert when sender is not owner", async () => {
            await expect(rand.connect(user2).setRequestInterval(10)).to.be.revertedWith("Only callable by owner");
        });

        it("should update successfully", async () => {
            await expect(rand.setRequestInterval(10)).not.to.be.reverted;
            expect(await rand.requestInterval()).to.eq(10);
        });
    });

    describe(".requestRandomWords", () => {
        it("should revert if sender ris not owner", async () => {
            await expect(rand.connect(user2).requestRandomWords()).to.be.revertedWith("Only callable by owner");
        });

        it("should successfully create unfulfilled request", async () => {
            const expectedReqId = 1;
            await coordinator.mock.requestRandomWords.returns(expectedReqId);
            await expect(rand.requestRandomWords()).emit(rand, "RequestSent").withArgs(expectedReqId, 1);
            expect((await rand.requests(expectedReqId)).exists).to.be.true;
            expect((await rand.requests(expectedReqId)).fulfilled).to.be.false;
            expect(await rand.requestIds(0)).to.eq(expectedReqId);
            expect(await rand.lastRequestId()).to.eq(expectedReqId);
            expect(await rand.lastRequestAt()).not.to.eq(0);
        });
    });
});
