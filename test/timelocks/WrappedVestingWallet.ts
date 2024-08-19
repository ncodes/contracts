import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {TOKEN, WrappedVestingWallet} from "../../typechain-types";
import {advanceBlockTime, toBN} from "../../utils/utils";

describe("WrappedVestingWallet", function () {
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let accts: SignerWithAddress[];
    let wvw: WrappedVestingWallet;
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

        let factory = await ethers.getContractFactory("WrappedVestingWallet");
        const now = await advanceBlockTime(1);
        const startTime = now + startTimeDur;
        wvw = (await factory.deploy(user2.address, startTime, vestingDur)) as WrappedVestingWallet;
    });

    describe(".vestedAmount", () => {
        context("when the wallet is not funded", () => {
            it("should return zero", async () => {
                const now = await advanceBlockTime(1);
                expect(await wvw["vestedAmount(uint64)"](now)).to.equal(0);
            });
        });

        context("when the wallet is funded but start time has not reached", () => {
            it("should return the correct amount", async () => {
                await deployer.sendTransaction({to: wvw.address, value: amount});
                const now = await advanceBlockTime(1);
                expect(await wvw["vestedAmount(uint64)"](now)).to.equal(0);
            });
        });

        context("when the wallet is funded but start time has reached", () => {
            it("should vest amount > 0", async () => {
                await deployer.sendTransaction({to: wvw.address, value: amount});
                const now = await advanceBlockTime(startTimeDur);
                expect((await wvw["vestedAmount(uint64)"](now)).toNumber()).greaterThan(0);
                expect(await wvw["released()"]()).to.eq(0);
            });
        });

        context("when the wallet is funded but vesting duration has elapsed", () => {
            it("should vest all amount", async () => {
                await deployer.sendTransaction({to: wvw.address, value: amount});
                const now = await advanceBlockTime((await wvw.start()).add(vestingDur + 1).toNumber());
                expect((await wvw["vestedAmount(uint64)"](now)).toNumber()).eq(amount);
                expect(await wvw["released()"]()).to.eq(0);
                expect(await wvw["releasable()"]()).to.eq(amount);
            });
        });
    });

    describe("release", () => {
        it("should release correctly to beneficiary", async () => {
            await deployer.sendTransaction({to: wvw.address, value: amount});
            const now = await advanceBlockTime((await wvw.start()).add(vestingDur + 1).toNumber());
            expect((await wvw["vestedAmount(uint64)"](now)).toNumber()).eq(amount);
            expect(await wvw["released()"]()).to.eq(0);
            expect(await wvw["releasable()"]()).to.eq(amount);

            const user2Bal = await user2.getBalance();
            await wvw.connect(user3)["release()"]();

            expect(await wvw["released()"]()).to.eq(amount);
            expect(await wvw["releasable()"]()).to.eq(0);
            expect(await user2.getBalance()).to.eq(user2Bal.add(amount));
        });
    });

    describe("release (with token)", () => {
        it("should release correctly to beneficiary", async () => {
            await token.transfer(wvw.address, amount);

            const now = await advanceBlockTime((await wvw.start()).add(vestingDur + 1).toNumber());
            expect((await wvw["vestedAmount(address,uint64)"](token.address, now)).toNumber()).eq(amount);
            expect(await wvw["released(address)"](token.address)).to.eq(0);
            expect(await wvw["releasable(address)"](token.address)).to.eq(amount);

            const user2Bal = await token.balanceOf(user2.address);
            await wvw.connect(user3)["release(address)"](token.address);

            expect(await wvw["released(address)"](token.address)).to.eq(amount);
            expect(await wvw["releasable(address)"](token.address)).to.eq(0);
            expect(await token.balanceOf(user2.address)).to.eq(user2Bal.add(amount));
        });
    });
});
