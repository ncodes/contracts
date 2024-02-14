import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {MockContract} from "ethereum-waffle";
import {BigNumber} from "ethers";
import {getAddress} from "ethers/lib/utils";
import {ethers, waffle} from "hardhat";
import {it} from "mocha";
import {BadgeManager, Core, MarketCore, MediatorManager, TOKEN} from "../typechain-types";
import {advanceBlockTime, makeMarketID, toBN} from "../utils/utils";
import {initCoreTestSuite} from "./helpers/helpers";
const {deployMockContract} = waffle;

describe("MediatorManager", function () {
    let c: MediatorManager;
    let core: Core;
    let mc: MarketCore;
    let randomness: MockContract;
    let sender: SignerWithAddress,
        deployer: SignerWithAddress,
        provider: SignerWithAddress,
        marketCreator: SignerWithAddress,
        mediator: SignerWithAddress,
        mediator2: SignerWithAddress,
        marketCreator2: SignerWithAddress;
    let accts: SignerWithAddress[];
    let token: TOKEN;
    let badgeMgr: BadgeManager;
    let baseAddr: string;
    let quoteAddr: string;
    let baseAsset: TOKEN;
    let quoteAsset: TOKEN;
    let baseDec: BigNumber;
    let quoteDec: BigNumber;
    let mid: string;
    let mid2: string;
    let ticketCancelDur = 86400 * 7;
    let ticketMatureDur = 86400;
    let ticketExpireDur = 86400 * 2;
    let bondAmt = 100000;
    const baseTicketPrice = 10;
    let noVoteSlashBP = 1000;
    let loseVoteSlashBP = 2000;
    let draftReward = 10;
    let winReward = 100;
    let numDraftees = 3;
    let supply = toBN("1000000000000000000000000");
    let evidenceDur = 86400;
    let predictDur = 86400;

    beforeEach(async () => {
        const vars = await initCoreTestSuite();
        accts = await ethers.getSigners();
        badgeMgr = vars.badgeMgr;
        sender = accts[0];
        deployer = accts[0];
        marketCreator = accts[0];
        marketCreator2 = accts[1];
        provider = accts[2];
        mediator = accts[3];
        mediator2 = accts[4];

        let TOKEN = await ethers.getContractFactory("TOKEN");
        token = (await TOKEN.deploy("TEST_TOKEN", "TEST_TOKEN", supply, 18)) as TOKEN;

        mc = vars.mc;
        core = vars.core;

        const Randomness = require("../artifacts/contracts/randomness/Randomness.sol/Randomness.json");
        randomness = await deployMockContract(deployer, Randomness.abi);
        await randomness.mock.randomN.returns(0);

        let factory3 = await ethers.getContractFactory("MediatorManager");
        c = (await factory3.deploy(token.address, mc.address, randomness.address, ticketCancelDur, ticketMatureDur, ticketExpireDur)) as MediatorManager;

        await c.setTicketMarketParams(10, 86400, 256, 60000, 10, 7, 10000);

        baseAsset = (await TOKEN.deploy("BASE_TOKEN", "BASE_TOKEN", supply, 18)) as TOKEN;
        baseAddr = baseAsset.address;
        quoteAsset = (await TOKEN.deploy("QUOTE_TOKEN", "QUOTE_TOKEN", supply, 18)) as TOKEN;
        quoteAddr = quoteAsset.address;
        baseDec = BigNumber.from(10).pow(await baseAsset.decimals());
        quoteDec = BigNumber.from(10).pow(await quoteAsset.decimals());

        mid = makeMarketID(marketCreator.address, baseAddr, quoteAddr, 1, 0);
        mid2 = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);
        await c.updateTicketPool(0, bondAmt, draftReward, winReward, noVoteSlashBP, loseVoteSlashBP, numDraftees, evidenceDur, predictDur);
    });

    describe(".updateTicketPool", () => {
        it("should revert when bond is zero", async () => {
            await expect(c.updateTicketPool(1, 0, 1, 1, 1, 1, 1, 1, 2)).to.be.revertedWith("MM: INVALID_REQ_BOND");
        });

        it("should revert when pool exist", async () => {
            expect(await c.poolExists(1)).to.be.false;
            await expect(c.updateTicketPool(1, 1, 1, 1, 1, 1, 1, 1, 2)).not.be.reverted;
            expect(await c.poolExists(1)).to.be.true;
            const pool = await c.pools(1);
            expect(pool.reqBond).to.eq(1);
            expect(pool.draftReward).to.eq(1);
            expect(pool.winReward).to.eq(1);
            expect(pool.noVoteSlashBP).to.eq(1);
            expect(pool.loseVoteSlashBP).to.eq(1);
        });
    });

    describe(".setRandomnessProvider", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not deployer", async () => {
            await expect(c.connect(mediator).setRandomnessProvider(accts[1].address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should set new value", async () => {
            await expect(c.setRandomnessProvider(accts[1].address)).not.to.be.reverted;
            expect(await c.randomness()).to.eql(accts[1].address);
        });
    });

    describe(".setTicketCancelDuration", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not deployer", async () => {
            await expect(c.connect(mediator).setTicketCancelDuration(123)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should set new value", async () => {
            await c.setTicketCancelDuration(123);
            expect((await c.ticketCancelDur()).toNumber()).to.eql(123);
        });
    });

    describe(".setTicketMatureDuration", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not deployer", async () => {
            await expect(c.connect(mediator).setTicketMatureDuration(123)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should set new value", async () => {
            await c.setTicketMatureDuration(123);
            expect((await c.ticketMatureDur()).toNumber()).to.eql(123);
        });
    });

    describe(".setTicketExpireDuration", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not deployer", async () => {
            await expect(c.connect(mediator).setTicketExpireDuration(123)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should set new value", async () => {
            await c.setTicketExpireDuration(123);
            expect((await c.ticketExpireDur()).toNumber()).to.eql(123);
        });
    });

    describe(".setMarketCore", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not deployer", async () => {
            await expect(c.connect(mediator).setMarketCore(accts[6].address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should set new value", async () => {
            await c.setMarketCore(accts[6].address);
            expect(await c.marketCore()).to.eql(accts[6].address);
        });
    });

    describe(".setDisputeManager", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not deployer", async () => {
            await expect(c.connect(mediator).setDisputeManager(accts[6].address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should set new value", async () => {
            await c.setDisputeManager(accts[6].address);
            expect(await c.disputeManager()).to.eql(accts[6].address);
        });
    });

    describe(".purchaseTicket", () => {
        beforeEach(async () => {
            await c.setTicketMarketParams(baseTicketPrice, 86400, 2, 1, 1000, 2, 10000);
        });

        it("should revert when pool does not exist", async () => {
            await expect(c.purchaseTicket(1)).to.be.revertedWith("MM: UNKNOWN_POOL");
        });

        it("should emit TicketPurchased on success", async () => {
            const totalBond = bondAmt + 10;
            await token.approve(c.address, totalBond);
            const timestamp = await advanceBlockTime(1);
            const matureAt = timestamp + ticketMatureDur + 1;
            const joinBy = matureAt + ticketExpireDur;
            await expect(c.purchaseTicket(0)).to.emit(c, "TicketPurchased").withArgs(sender.address, toBN(0), toBN(0), totalBond, matureAt, joinBy);

            const ticket = await c.tickets(deployer.address, 0);
            expect(ticket.bond).to.be.eq(totalBond);
            expect(ticket.matureAt).to.eq(matureAt);

            // balance of sender should be reduced
            expect(await token.balanceOf(deployer.address)).to.eql(supply.sub(totalBond));

            // contract balance should be correct
            expect(await token.balanceOf(c.address)).to.eq(totalBond);

            // Current window number of purchase should be updated
            const curWin = await c.windows(0);
            expect(curWin.numPurchases.toNumber()).to.eql(1);

            // Increase ticket sold
            expect(await c.ticketSold()).to.be.eql(toBN(1));
        });

        it("should revert with msg=SOLD_OUT when all total supply have been purchased", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await expect(c.purchaseTicket(0)).not.to.be.reverted;
            await expect(c.purchaseTicket(0)).to.be.revertedWith("MM: SOLD_OUT");
        });

        it("should revert with msg='ERC20: insufficient allowance' when approved amount is lower than ticket price + pool bond", async () => {
            await token.approve(c.address, 0);
            await expect(c.purchaseTicket(0)).to.be.revertedWith("ERC20: insufficient allowance");
        });
    });

    describe(".getTicketPrice", () => {
        const priceSupplyDelta = 1000;

        beforeEach(async () => {
            await c.setTicketMarketParams(baseTicketPrice, 86400, 2, 3, priceSupplyDelta, 2, 10000);
        });

        describe("when no window exist", () => {
            it("should return base ticket price", async () => {
                expect(await c.numWindows()).to.be.eql(toBN(0));
                expect(await c.getTicketPrice()).to.be.eql(toBN(baseTicketPrice));
            });
        });

        describe("when only one window exist and it has not ended", () => {
            beforeEach(async () => {
                await token.approve(c.address, baseTicketPrice + bondAmt);
                await expect(c.purchaseTicket(0)).not.to.be.reverted;
                expect(await c.numWindows()).to.be.eql(toBN(1));
            });

            it("should return the correct ticket price", async () => {
                const now = await advanceBlockTime(1);
                expect(await c.getTicketPrice()).to.be.eql(toBN(baseTicketPrice));
                expect((await c.windows(0)).endTime.gt(now)).to.be.true;
            });
        });

        describe("when only one window exist and it has ended but was not sold out", () => {
            beforeEach(async () => {
                await token.approve(c.address, baseTicketPrice + bondAmt);
                await expect(c.purchaseTicket(0)).not.to.be.reverted;
                expect(await c.numWindows()).to.be.eql(toBN(1));

                await advanceBlockTime(86401);
                const now = await advanceBlockTime(1);
                expect((await c.windows(0)).endTime.lte(now)).to.be.true;
            });

            it("should return the base ticket price", async () => {
                expect(await c.getTicketPrice()).to.be.eql(toBN(baseTicketPrice));
            });
        });

        describe("when only one ended window exist and it was sold out", () => {
            beforeEach(async () => {
                await token.approve(c.address, (baseTicketPrice + bondAmt) * 2);
                await expect(c.purchaseTicket(0)).not.to.be.reverted;
                await expect(c.purchaseTicket(0)).not.to.be.reverted;
                expect(await c.numWindows()).to.be.eql(toBN(1));

                await advanceBlockTime(86401);
                const now = await advanceBlockTime(1);
                expect((await c.windows(0)).endTime.lte(now)).to.be.true;
            });

            it("should increase ticket price by $priceSupplyDeltaBP", async () => {
                expect(await c.getTicketPrice()).to.be.eq(baseTicketPrice + (baseTicketPrice * priceSupplyDelta) / 10000);
            });
        });

        describe("when a previous ended window exist and no other window was created within $minInactiveWindowBeforeReset windows", () => {
            beforeEach(async () => {
                await token.approve(c.address, (baseTicketPrice + bondAmt) * 2);
                await expect(c.purchaseTicket(0)).not.to.be.reverted;
                await expect(c.purchaseTicket(0)).not.to.be.reverted;
                expect(await c.numWindows()).to.be.eql(toBN(1));

                await advanceBlockTime(86401 * 3);
                const now = await advanceBlockTime(1);
                expect((await c.windows(0)).endTime.lte(now)).to.be.true;
            });

            it("should return base ticket price", async () => {
                expect(await c.getTicketPrice()).to.be.eql(toBN(baseTicketPrice));
            });
        });

        describe("when only two windows exist and the recent one has not ended", () => {
            beforeEach(async () => {
                await token.approve(c.address, (baseTicketPrice + bondAmt) * 2);
                await expect(c.purchaseTicket(0)).not.to.be.reverted;
                await advanceBlockTime(86401);
                await expect(c.purchaseTicket(0)).not.to.be.reverted;
                expect(await c.numWindows()).to.be.eql(toBN(2));

                const now = await advanceBlockTime(1);
                expect((await c.windows(1)).endTime.gt(now)).to.be.true;
            });

            it("should return price of recent window", async () => {
                expect(await c.getTicketPrice()).to.be.eql((await c.windows(1)).price);
            });
        });

        describe("when only three windows exist, window#1 was sold out, window#2 price was increased but not sold out", () => {
            beforeEach(async () => {
                // window 1
                await token.approve(c.address, await token.totalSupply());
                await expect(c.purchaseTicket(0)).not.to.be.reverted;
                await expect(c.purchaseTicket(0)).not.to.be.reverted;
                await advanceBlockTime(86401);

                // window 2
                await expect(c.purchaseTicket(0)).not.to.be.reverted;
                expect(await c.numWindows()).to.be.eql(toBN(2));
                await advanceBlockTime(86401);
            });

            it("should decrease the previous window (window#2) price by $priceSupplyDeltaBP", async () => {
                expect(await c.getTicketPrice()).to.be.eql(toBN(10));
            });
        });
    });

    describe(".join", () => {
        it("should revert when ticket is unknown", async () => {
            await expect(c.join(1)).to.be.revertedWith("MM: UNKNOWN_TICKET");
        });

        it("should revert when ticket has been blocked", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.purchaseTicket(0);
            await c.toggleBlock(deployer.address, 0);
            await expect(c.join(0)).to.be.revertedWith("MM: BLOCKED");
        });

        it("should revert when ticket is not mature", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.purchaseTicket(0);
            await expect(c.join(0)).to.be.revertedWith("MM: NOT_MATURE");
        });

        it("should revert when ticket is expired", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.purchaseTicket(0);
            await advanceBlockTime(ticketMatureDur + ticketExpireDur);
            await expect(c.join(0)).to.be.revertedWith("MM: EXPIRED");
        });

        it("should revert when ticket is cancelled", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.purchaseTicket(0);
            await advanceBlockTime(ticketMatureDur);
            await c.cancelTicket(0);
            await expect(c.join(0)).to.be.revertedWith("MM: CANCELLED");
        });

        it("should join the market", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.purchaseTicket(0);
            await advanceBlockTime(ticketMatureDur);
            await expect(c.join(0)).to.be.emit(c, "JoinedPool").withArgs(deployer.address, 0, 0);
        });

        it("should revert when ticket is already joined", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.purchaseTicket(0);
            await advanceBlockTime(ticketMatureDur);
            await c.join(0);
            await expect(c.join(0)).to.be.revertedWith("MM: ALREADY_JOINED");
        });

        it("should revert when ticket's bond is lower the pool's required bond", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.purchaseTicket(0);
            await advanceBlockTime(ticketMatureDur);
            await c.updateTicketPool(0, baseTicketPrice + bondAmt + 1, 1, 1, 1, 1, 1, 1, 1);
            await expect(c.join(0)).to.be.revertedWith("MM: LOW_BOND");
        });
    });

    describe(".cancelTicket", () => {
        it("should revert with reason=UNKNOWN_TICKET when ticket is unknown", async () => {
            await expect(c.cancelTicket(1)).to.be.revertedWith("MM: UNKNOWN_TICKET");
        });

        it("should revert when ticket has been blocked", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.purchaseTicket(0);
            await c.toggleBlock(deployer.address, 0);
            await expect(c.cancelTicket(0)).to.be.revertedWith("MM: BLOCKED");
        });

        it("should revert with reason=NOT_MATURE when ticket is unknown", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.purchaseTicket(0);
            await expect(c.cancelTicket(0)).to.be.revertedWith("MM: NOT_MATURE");
        });

        it("should set cancel time on success", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.purchaseTicket(0);
            await advanceBlockTime(ticketMatureDur);
            await expect(c.cancelTicket(0)).not.to.be.reverted;
            const ticket = await c.tickets(deployer.address, 0);
            expect(ticket.cancelAt.isZero()).to.be.false;
        });

        it("should revert with reason=CANCELLING when ticket cancel time has already been set", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.purchaseTicket(0);
            await advanceBlockTime(ticketMatureDur);
            await expect(c.cancelTicket(0)).not.to.be.reverted;
            const ticket = await c.tickets(deployer.address, 0);
            expect(ticket.cancelAt.isZero()).to.be.false;
            await expect(c.cancelTicket(0)).to.be.revertedWith("MM: CANCELLING");
        });

        describe("with two tickets", () => {
            it("should revert with reason=UNKNOWN_TICKET when ticket index does not exist", async () => {
                await token.approve(c.address, (baseTicketPrice + bondAmt) * 2);
                await c.purchaseTicket(0);
                await c.purchaseTicket(0);
                await advanceBlockTime(ticketMatureDur);
                await expect(c.cancelTicket(0)).not.to.be.reverted;
                await expect(c.cancelTicket(1)).not.to.be.reverted;
                await expect(c.cancelTicket(2)).to.be.revertedWith("MM: UNKNOWN_TICKET");
            });
        });

        describe("when ticket already joined a pool", function () {
            it("should remove ticket from ticket pool and set joined=false", async () => {
                await token.approve(c.address, baseTicketPrice + bondAmt);
                await c.purchaseTicket(0);
                await advanceBlockTime(ticketMatureDur);
                await c.join(0);
                let ticket = await c.tickets(deployer.address, 0);
                expect(ticket.joined).to.be.true;
                await expect(c.poolTickets(0, 0)).not.to.be.reverted;

                await c.cancelTicket(0);
                await expect(c.poolTickets(0, 0)).to.be.reverted;
                ticket = await c.tickets(deployer.address, 0);
                expect(ticket.joined).to.be.false;
            });
        });

        describe("when ticket is mature but has not joined its pool", function () {
            it("should set cancelAt and joined=false", async () => {
                await token.approve(c.address, baseTicketPrice + bondAmt);
                await c.purchaseTicket(0);
                await advanceBlockTime(ticketMatureDur);
                let ticket = await c.tickets(deployer.address, 0);
                expect(ticket.joined).to.be.false;
                await expect(c.poolTickets(0, 0)).to.be.reverted;

                await c.cancelTicket(0);
                ticket = await c.tickets(deployer.address, 0);
                expect(ticket.joined).to.be.false;
                expect(ticket.cancelAt.isZero()).to.be.false;
            });
        });

        describe("when ticket has been drafted", () => {
            beforeEach(async () => {
                await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
                await c.setDisputeManager(deployer.address);
            });

            it("should revert with msg='MM: IS_DRAFTED'", async () => {
                await token.approve(c.address, baseTicketPrice + bondAmt);
                await c.purchaseTicket(0);
                await advanceBlockTime(ticketMatureDur);
                await c.join(0);
                let ticket = await c.tickets(deployer.address, 0);
                expect(ticket.joined).to.be.true;
                await expect(c.poolTickets(0, 0)).not.to.be.reverted;

                // Draft
                await randomness.mock.randomN.returns(0);
                await expect(c.draft(mid, 0, 0)).to.emit(c, "Drafted");
                ticket = await c.tickets(deployer.address, 0);
                expect(ticket.drafted).to.be.true;

                await expect(c.cancelTicket(0)).to.be.revertedWith("MM: IS_DRAFTED");
            });
        });
    });

    describe(".drainTicket", () => {
        it("should revert with reason=UNKNOWN_TICKET when ticket is unknown", async () => {
            await expect(c.drainTicket(1)).to.be.revertedWith("MM: UNKNOWN_TICKET");
        });

        it("should revert when ticket has been blocked", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.purchaseTicket(0);
            await c.toggleBlock(deployer.address, 0);
            await expect(c.drainTicket(0)).to.be.revertedWith("MM: BLOCKED");
        });

        it("should revert with reason=NOT_CANCELLED when ticket has not entered cancel state", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.purchaseTicket(0);
            await expect(c.drainTicket(0)).to.be.revertedWith("MM: NOT_CANCELLED");
        });

        it("should revert with reason=NOT_CANCELLED when ticket has not reacted cancel time", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.purchaseTicket(0);
            await advanceBlockTime(ticketMatureDur);
            await expect(c.cancelTicket(0)).not.to.be.reverted;
            await expect(c.drainTicket(0)).to.be.revertedWith("MM: NOT_CANCELLED");
        });

        describe("on success", () => {
            let bal: BigNumber;
            beforeEach(async () => {
                bal = await token.balanceOf(deployer.address);

                await token.approve(c.address, baseTicketPrice + bondAmt);
                await c.purchaseTicket(0);
                await advanceBlockTime(ticketMatureDur);
                expect(await c.ticketSold()).to.be.eql(toBN(1));

                const curBal = await token.balanceOf(deployer.address);
                expect(curBal.eq(bal.sub(baseTicketPrice + bondAmt))).to.be.true;

                await expect(c.cancelTicket(0)).not.to.be.reverted;
                await advanceBlockTime(ticketCancelDur);
                await expect(c.drainTicket(0))
                    .to.emit(c, "TicketDrained")
                    .withArgs(deployer.address, toBN(0), toBN(baseTicketPrice + bondAmt));
            });

            it("should successfully set drain ticket bond to zero when cancel time is reached", async () => {
                const t = await c.tickets(deployer.address, 0);
                expect(t.bond.isZero()).to.be.true;
            });

            it("should return bond amount to ticket owner", async () => {
                const curBal = await token.balanceOf(deployer.address);
                expect(curBal.eq(bal)).to.be.true;
            });

            it("should decrease ticket sold", async () => {
                expect(await c.ticketSold()).to.be.eql(toBN(0));
            });
        });

        describe("with two tickets", () => {
            it("should revert with reason=UNKNOWN_TICKET when ticket index does not exist", async () => {
                await token.approve(c.address, (baseTicketPrice + bondAmt) * 2);
                await c.purchaseTicket(0);
                await c.purchaseTicket(0);
                await advanceBlockTime(ticketMatureDur);
                await expect(c.cancelTicket(0)).not.to.be.reverted;
                await expect(c.cancelTicket(1)).not.to.be.reverted;
                await advanceBlockTime(ticketCancelDur + 1);
                await expect(c.drainTicket(0)).not.to.be.reverted;
                await expect(c.drainTicket(1)).not.to.be.reverted;
                await expect(c.drainTicket(2)).to.be.revertedWith("MM: UNKNOWN_TICKET");
            });
        });
    });

    describe(".draft", () => {
        context("market mediation is not permissioned", () => {
            beforeEach(async () => {
                await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
                await token.approve(c.address, baseTicketPrice + bondAmt);
                await token.transfer(mediator.address, baseTicketPrice + bondAmt);
                await token.connect(mediator).approve(c.address, baseTicketPrice + bondAmt);
                await c.setDisputeManager(deployer.address);
            });

            it("should revert with reason=NOT_DISPUTE_MGR when sender is not the dispute manager", async () => {
                await expect(c.connect(provider).draft(mid, 0, 0)).to.be.revertedWith("MM: NOT_DISPUTE_MGR");
            });

            it("should revert with reason=NO_TICKETS when no ticket has joined the market's pool", async () => {
                await expect(c.draft(mid, 0, 0)).to.be.revertedWith("MM: NO_TICKETS");
            });

            describe("when pool has tickets", () => {
                beforeEach(async () => {
                    await c.purchaseTicket(0);
                    await c.connect(mediator).purchaseTicket(0);
                    await advanceBlockTime(ticketMatureDur);
                    await expect(c.join(0)).not.to.be.reverted;
                    await expect(c.connect(mediator).join(0)).not.to.be.reverted;
                    await expect(c.poolTickets(0, 0)).not.be.reverted;
                    await expect(c.poolTickets(0, 1)).not.be.reverted;
                });

                it("should mark selected ticket as `drafted`", async () => {
                    await randomness.mock.randomN.returns(1);
                    await expect(c.draft(mid, 0, 0))
                        .to.emit(c, "Drafted")
                        .withArgs(getAddress(mid), mediator.address, toBN(0), toBN(0), toBN(0), deployer.address);
                    const ticket2 = await c.tickets(mediator.address, 0);
                    expect(ticket2.drafted).to.be.true;

                    // draft again
                    await randomness.mock.randomN.returns(0);
                    await expect(c.draft(mid, 0, 0))
                        .to.emit(c, "Drafted")
                        .withArgs(getAddress(mid), deployer.address, toBN(0), toBN(0), toBN(0), deployer.address);
                    const ticket1 = await c.tickets(deployer.address, 0);
                    expect(ticket1.drafted).to.be.true;

                    // should remove ticket from pool ticket list
                    await expect(c.poolTickets(0, 0)).to.be.reverted;
                    await expect(c.poolTickets(0, 1)).to.be.reverted;
                });
            });
        });
    });

    describe(".undraft", () => {
        beforeEach(async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.setDisputeManager(deployer.address);
        });

        it("should revert with reason=NOT_DISPUTE_MGR when sender is not the dispute manager", async () => {
            await expect(c.connect(provider).undraft(deployer.address, 0, false, false)).to.be.revertedWith("MM: NOT_DISPUTE_MGR");
        });

        describe("when mediator voted for the winning side", () => {
            beforeEach(async () => {
                await c.purchaseTicket(0);
                await advanceBlockTime(ticketMatureDur);
                await expect(c.join(0)).not.to.be.reverted;
                await expect(c.draft(mid, 0, 0)).not.to.be.reverted;
                await expect(c.undraft(deployer.address, 0, true, true))
                    .to.emit(c, "Undrafted")
                    .withArgs(deployer.address, 0, false, deployer.address);
            });

            it("should be un-drafted", async () => {
                const ticket = await c.tickets(deployer.address, 0);
                expect(ticket.drafted).to.be.false;
            });

            it("should be added back to the pool", async () => {
                const ticket = await c.tickets(deployer.address, 0);
                const poolTicket = await c.poolTickets(0, ticket.poolIdx);
                expect(poolTicket.owner).to.eql(deployer.address);
                expect(poolTicket.idx).to.eql(ticket.idx);
            });
        });

        describe("when mediator voted for the winning side but mediator ticket is blocked", () => {
            beforeEach(async () => {
                await c.purchaseTicket(0);
                await advanceBlockTime(ticketMatureDur);
                await expect(c.join(0)).not.to.be.reverted;
                await expect(c.draft(mid, 0, 0)).not.to.be.reverted;
                await c.toggleBlock(deployer.address, 0);
                await expect(c.undraft(deployer.address, 0, true, true))
                    .to.emit(c, "Undrafted")
                    .withArgs(deployer.address, 0, false, deployer.address);
            });

            it("should be un-drafted", async () => {
                const ticket = await c.tickets(deployer.address, 0);
                expect(ticket.drafted).to.be.false;
            });

            it("should not be added back to the pool", async () => {
                const ticket = await c.tickets(deployer.address, 0);
                await expect(c.poolTickets(0, ticket.poolIdx)).to.be.reverted;
                expect(ticket.poolIdx).to.eq(0);
                expect(ticket.joined).to.be.false;
                expect(ticket.cancelAt.isZero()).to.be.false;
            });
        });

        describe("when mediator did not vote", () => {
            const totalBond = baseTicketPrice + bondAmt;
            const expectedSlashAmt = (totalBond * noVoteSlashBP) / 10000;
            let timeUndraft: number;
            beforeEach(async () => {
                await c.purchaseTicket(0);
                await advanceBlockTime(ticketMatureDur);
                await expect(c.join(0)).not.to.be.reverted;
                await expect(c.draft(mid, 0, 0)).not.to.be.reverted;
                timeUndraft = await advanceBlockTime(1);
                await expect(c.undraft(deployer.address, 0, false, false))
                    .to.emit(c, "TicketSlashed")
                    .withArgs(deployer.address, toBN(0), expectedSlashAmt, false, false);
            });

            it("should be un-drafted", async () => {
                const ticket = await c.tickets(deployer.address, 0);
                expect(ticket.drafted).to.be.false;
            });

            it("should slash ticket bond", async () => {
                const ticket = await c.tickets(deployer.address, 0);
                expect(ticket.bond.eq(totalBond - expectedSlashAmt)).to.be.true;
            });

            it("should cancel ticket without delay", async () => {
                const ticket = await c.tickets(deployer.address, 0);
                let now = await advanceBlockTime(1);
                expect(ticket.cancelAt.eq(now - 1)).to.be.true;
                expect(ticket.joined).to.be.false;
                expect(ticket.poolIdx).to.eq(0);
                expect(ticket.joinBy.isZero()).to.be.true;
            });

            // should not be able to join the pool again
            it("should not be able to join the pool again since bond is low", async () => {
                await expect(c.join(0)).to.be.revertedWith("MM: LOW_BOND");
            });

            it("should not be able to join the pool since ticket was immediately canceled", async () => {
                await c.updateTicketPool(0, 1, draftReward, winReward, noVoteSlashBP, loseVoteSlashBP, numDraftees, evidenceDur, predictDur);
                await expect(c.join(0)).to.be.revertedWith("MM: EXPIRED");
            });

            it("should be able to drain ticket bond", async () => {
                let ticket = await c.tickets(deployer.address, 0);
                expect(ticket.bond.isZero()).to.be.false;
                await expect(c.drainTicket(0)).not.to.be.reverted;
                ticket = await c.tickets(deployer.address, 0);
                expect(ticket.bond.isZero()).to.be.true;
            });

            it("should burn bond from contract balance", async () => {
                expect(await token.balanceOf(c.address)).to.eql(toBN(totalBond - expectedSlashAmt));
            });

            it("should not be added back to the pool", async () => {
                const ticket = await c.tickets(deployer.address, 0);
                await expect(c.poolTickets(ticket.poolId, ticket.poolIdx)).to.be.reverted;
            });
        });

        describe("when mediator lost the vote", () => {
            const totalBond = baseTicketPrice + bondAmt;
            const expectedSlashAmt = (totalBond * loseVoteSlashBP) / 10000;
            let timeUndraft: number;
            beforeEach(async () => {
                await c.purchaseTicket(0);
                await advanceBlockTime(ticketMatureDur);
                await expect(c.join(0)).not.to.be.reverted;
                await expect(c.draft(mid, 0, 0)).not.to.be.reverted;
                timeUndraft = await advanceBlockTime(1);
                await expect(c.undraft(deployer.address, 0, true, false))
                    .to.emit(c, "TicketSlashed")
                    .withArgs(deployer.address, toBN(0), expectedSlashAmt, true, false);
            });

            it("should be un-drafted", async () => {
                const ticket = await c.tickets(deployer.address, 0);
                expect(ticket.drafted).to.be.false;
            });

            it("should slash ticket bond", async () => {
                const ticket = await c.tickets(deployer.address, 0);
                expect(ticket.bond.eq(totalBond - expectedSlashAmt)).to.be.true;
            });

            it("should cancel ticket without delay", async () => {
                const ticket = await c.tickets(deployer.address, 0);
                let now = await advanceBlockTime(1);
                expect(ticket.cancelAt.eq(now - 1)).to.be.true;
                expect(ticket.joined).to.be.false;
                expect(ticket.poolIdx).to.eq(0);
                expect(ticket.joinBy.isZero()).to.be.true;
            });

            // should not be able to join the pool again
            it("should not be able to join the pool again since bond is low", async () => {
                await expect(c.join(0)).to.be.revertedWith("MM: LOW_BOND");
            });

            it("should not be able to join the pool since ticket was made to immediately expire", async () => {
                await c.updateTicketPool(0, 1, draftReward, winReward, noVoteSlashBP, loseVoteSlashBP, numDraftees, evidenceDur, predictDur);
                await expect(c.join(0)).to.be.revertedWith("MM: EXPIRED");
            });

            it("should be able to drain ticket bond", async () => {
                let ticket = await c.tickets(deployer.address, 0);
                expect(ticket.bond.isZero()).to.be.false;
                await expect(c.drainTicket(0)).not.to.be.reverted;
                ticket = await c.tickets(deployer.address, 0);
                expect(ticket.bond.isZero()).to.be.true;
            });

            it("should burn bond from contract balance", async () => {
                expect(await token.balanceOf(c.address)).to.eql(toBN(totalBond - expectedSlashAmt));
            });

            it("should not be added back to the pool", async () => {
                const ticket = await c.tickets(deployer.address, 0);
                await expect(c.poolTickets(ticket.poolId, ticket.poolIdx)).to.be.reverted;
            });
        });
    });

    describe(".slash", () => {
        beforeEach(async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.setDisputeManager(deployer.address);
        });

        it("should revert with reason='OWNABLE: NOT_OWNER' when caller is not ticket owner", async () => {
            await expect(c.connect(provider).slash(provider.address, 0, 1)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should revert with reason='MM: UNKNOWN_TICKET' when ticket is unknown", async () => {
            await expect(c.slash(deployer.address, 0, 1)).to.be.revertedWith("MM: UNKNOWN_TICKET");
        });

        it("should revert with reason='MM: NOT_READY' when ticket has not joined a pool or is slashed", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.purchaseTicket(0);
            await expect(c.slash(deployer.address, 0, 1)).to.be.revertedWith("MM: NOT_READY");
        });

        it("should revert with reason='MM: IS_DRAFTED' when ticket has not joined a pool", async () => {
            await token.approve(c.address, baseTicketPrice + bondAmt);
            await c.purchaseTicket(0);
            await advanceBlockTime(ticketMatureDur);
            await expect(c.join(0)).not.to.be.reverted;
            await expect(c.draft(mid, 0, 0)).not.to.be.reverted;
            await expect(c.slash(deployer.address, 0, 1)).to.be.revertedWith("MM: IS_DRAFTED");
        });

        it("should successfully slash ticket and update ticket correctly", async () => {
            const totalBond = baseTicketPrice + bondAmt;
            await token.approve(c.address, totalBond);
            await c.purchaseTicket(0);
            await advanceBlockTime(ticketMatureDur);
            await expect(c.join(0)).not.to.be.reverted;

            const curBal = await token.balanceOf(c.address);

            await expect(c.slash(deployer.address, 0, 10))
                .to.emit(c, "TicketSlashedByOwner")
                .withArgs(deployer.address, toBN(0), toBN(10));

            const ticket = await c.tickets(deployer.address, 0);
            expect(ticket.bond.eq(totalBond - 10)).to.be.true;
            expect(ticket.joined).to.be.false;
            expect(ticket.poolIdx).to.eq(0);
            expect(ticket.cancelAt.isZero()).to.be.false;
            expect(ticket.blocked).to.be.false;
            await expect(c.poolTickets(0, ticket.poolIdx)).to.be.reverted;

            expect(await token.balanceOf(c.address)).to.eq(curBal.sub(10));
        });

        it("when ticket is already slashed, should successfully slash ticket and update ticket correctly", async () => {
            const totalBond = baseTicketPrice + bondAmt;
            await token.approve(c.address, totalBond);
            await c.purchaseTicket(0);
            await advanceBlockTime(ticketMatureDur);
            await expect(c.join(0)).not.to.be.reverted;

            // slash ticket
            await expect(c.draft(mid, 0, 0)).not.to.be.reverted;
            await expect(c.undraft(deployer.address, 0, false, false)).to.emit(c, "TicketSlashed");
            let ticket = await c.tickets(deployer.address, 0);
            expect(ticket.slashed).to.be.true;
            const ticketBondAfterSlash = ticket.bond;
            await expect(c.poolTickets(0, ticket.poolIdx)).to.be.reverted;

            const curBal = await token.balanceOf(c.address);

            await expect(c.slash(deployer.address, 0, 10))
                .to.emit(c, "TicketSlashedByOwner")
                .withArgs(deployer.address, toBN(0), toBN(10));

            ticket = await c.tickets(deployer.address, 0);
            expect(ticket.slashed).to.be.true;
            expect(ticket.bond.eq(ticketBondAfterSlash.sub(10))).to.be.true;
            expect(ticket.joined).to.be.false;
            expect(ticket.poolIdx).to.eq(0);
            expect(ticket.cancelAt.isZero()).to.be.false;
            expect(ticket.blocked).to.be.false;
            await expect(c.poolTickets(0, ticket.poolIdx)).to.be.reverted;

            expect(await token.balanceOf(c.address)).to.eq(curBal.sub(10));
        });

        it("when ticket is blocked, should successfully slash ticket and update ticket correctly", async () => {
            const totalBond = baseTicketPrice + bondAmt;
            await token.approve(c.address, totalBond);
            await c.purchaseTicket(0);
            await advanceBlockTime(ticketMatureDur);
            await expect(c.join(0)).not.to.be.reverted;

            await c.toggleBlock(deployer.address, 0);

            await expect(c.slash(deployer.address, 0, 10)).to.emit(c, "TicketSlashedByOwner");

            const ticket = await c.tickets(deployer.address, 0);
            expect(ticket.slashed).to.be.true;
            expect(ticket.bond.eq(totalBond - 10)).to.be.true;
            expect(ticket.joined).to.be.false;
            expect(ticket.poolIdx).to.eq(0);
            expect(ticket.cancelAt.isZero()).to.be.false;
            expect(ticket.blocked).to.be.false;
            await expect(c.poolTickets(0, ticket.poolIdx)).to.be.reverted;
        });
    });

    describe("toggleBlock", () => {
        it("should revert with reason=NOT_OWNER when caller is not owner", async () => {
            await expect(c.connect(provider).toggleBlock(deployer.address, 0)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should revert with reason=UNKNOWN_TICKET when ticket is unknown", async () => {
            await expect(c.toggleBlock(deployer.address, 0)).to.be.revertedWith("MM: UNKNOWN_TICKET");
        });

        it("should successfully block and unblock ticket", async () => {
            const totalBond = baseTicketPrice + bondAmt;
            await token.approve(c.address, totalBond);
            await c.purchaseTicket(0);
            await advanceBlockTime(ticketMatureDur);
            await expect(c.join(0)).not.to.be.reverted;

            // block ticket
            await expect(c.toggleBlock(deployer.address, 0)).to.emit(c, "TicketBlocked").withArgs(deployer.address, 0, true);
            let ticket = await c.tickets(deployer.address, 0);
            expect(ticket.blocked).to.be.true;

            // unblock ticket
            await expect(c.toggleBlock(deployer.address, 0)).to.emit(c, "TicketBlocked").withArgs(deployer.address, 0, false);
            ticket = await c.tickets(deployer.address, 0);
            expect(ticket.blocked).to.be.false;
        });
    });
});
