import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {TOKEN, TimelockWallet} from "../../typechain-types";
import {advanceBlockTime, toBN} from "../../utils/utils";

describe("TimelockWallet", function () {
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let accts: SignerWithAddress[];
    let timelockWallet: TimelockWallet;
    let startTimeDur = 3600;
    let amount = 100;
    let vestingDur = 100;
    let token: TOKEN;

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[1];
        user3 = accts[2];

        let supply = toBN("500000000000000000000000000");
        let TOKEN = await ethers.getContractFactory("MINTABLE_TOKEN");
        token = (await TOKEN.deploy("REWARD_TOKEN", "REWARD_TOKEN", supply, 18)) as TOKEN;

        let factory = await ethers.getContractFactory("TimelockWallet");
        const now = await advanceBlockTime(1);
        const startTime = now + startTimeDur;
        timelockWallet = (await factory.deploy(user2.address, startTime, vestingDur)) as TimelockWallet;
    });

    describe(".vestedAmount", () => {
        context("when the wallet is not funded", () => {
            it("should return zero", async () => {
                const now = await advanceBlockTime(1);
                expect(await timelockWallet["vestedAmount(uint64)"](now)).to.equal(0);
            });
        });

        context("when the wallet is funded but start time has not reached", () => {
            it("should return the correct amount", async () => {
                await deployer.sendTransaction({to: timelockWallet.address, value: amount});
                const now = await advanceBlockTime(1);
                expect(await timelockWallet["vestedAmount(uint64)"](now)).to.equal(0);
            });
        });

        context("when the wallet is funded but start time has reached", () => {
            it("should vest amount > 0", async () => {
                await deployer.sendTransaction({to: timelockWallet.address, value: amount});
                const now = await advanceBlockTime(startTimeDur);
                expect((await timelockWallet["vestedAmount(uint64)"](now)).toNumber()).greaterThan(0);
                expect(await timelockWallet["released()"]()).to.eq(0);
            });
        });

        context("when the wallet is funded but vesting duration has elapsed", () => {
            it("should vest all amount", async () => {
                await deployer.sendTransaction({to: timelockWallet.address, value: amount});
                const now = await advanceBlockTime((await timelockWallet.start()).add(vestingDur + 1).toNumber());
                expect((await timelockWallet["vestedAmount(uint64)"](now)).toNumber()).eq(amount);
                expect(await timelockWallet["released()"]()).to.eq(0);
                expect(await timelockWallet["releasable()"]()).to.eq(amount);
            });
        });
    });

    describe("release", () => {
        it("should release correctly to beneficiary", async () => {
            await deployer.sendTransaction({to: timelockWallet.address, value: amount});
            const now = await advanceBlockTime((await timelockWallet.start()).add(vestingDur + 1).toNumber());
            expect((await timelockWallet["vestedAmount(uint64)"](now)).toNumber()).eq(amount);
            expect(await timelockWallet["released()"]()).to.eq(0);
            expect(await timelockWallet["releasable()"]()).to.eq(amount);

            const user2Bal = await user2.getBalance();
            await timelockWallet.connect(user3)["release()"]();

            expect(await timelockWallet["released()"]()).to.eq(amount);
            expect(await timelockWallet["releasable()"]()).to.eq(0);
            expect(await user2.getBalance()).to.eq(user2Bal.add(amount));
        });
    });

    describe("release (with token)", () => {
        it("should release correctly to beneficiary", async () => {
            await token.transfer(timelockWallet.address, amount);

            const now = await advanceBlockTime((await timelockWallet.start()).add(vestingDur + 1).toNumber());
            expect((await timelockWallet["vestedAmount(address,uint64)"](token.address, now)).toNumber()).eq(amount);
            expect(await timelockWallet["released(address)"](token.address)).to.eq(0);
            expect(await timelockWallet["releasable(address)"](token.address)).to.eq(amount);

            const user2Bal = await token.balanceOf(user2.address);
            await timelockWallet.connect(user3)["release(address)"](token.address);

            expect(await timelockWallet["released(address)"](token.address)).to.eq(amount);
            expect(await timelockWallet["releasable(address)"](token.address)).to.eq(0);
            expect(await token.balanceOf(user2.address)).to.eq(user2Bal.add(amount));
        });
    });
});
