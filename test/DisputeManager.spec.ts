import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {randomBytes} from "crypto";
import {MockContract} from "ethereum-waffle";
import {BigNumber, BigNumberish} from "ethers";
import {getAddress, hexlify} from "ethers/lib/utils";
import {ethers, waffle} from "hardhat";
import {AssetRegistry, Core, DisputeManager, MarketCore, MediatorManager, TOKEN} from "../typechain-types";
import {AddressZero, advanceBlockTime, makeMarketID, toBN} from "../utils/utils";
import {MinerRegistry} from "./../typechain-types/MinerRegistry";
import {getCoreLibraries, initCoreTestSuite, makeLibs} from "./helpers/helpers";
const {deployMockContract} = waffle;

describe("DisputeManager", function () {
    let baseAddr: string;
    let quoteAddr: string;
    let core: Core;
    let mc: MarketCore;
    let dm: DisputeManager;
    let minerReg: MinerRegistry;
    let medMgr: MediatorManager;
    let assetReg: AssetRegistry;
    let deployer: SignerWithAddress;
    let accts: SignerWithAddress[];
    let baseAsset: TOKEN;
    let randomness: MockContract;
    let quoteAsset: TOKEN;
    let token: TOKEN;
    let mid: string;
    let baseDec: BigNumber;
    let quoteDec: BigNumber;
    let marketCreator: SignerWithAddress, provider: SignerWithAddress, swapper: SignerWithAddress, inventor: SignerWithAddress, user5: SignerWithAddress, user6: SignerWithAddress, user7: SignerWithAddress;
    let supply: BigNumberish;
    let ticketCancelDur = 0;
    let ticketMatureDur = 0;
    let ticketExpireDur = 0;
    let ticketPauseDur = 0;
    let predictDur = 86400;
    let evidenceDur = 86400;
    let bondAmt = 100000;
    let windowDur = 86400;
    let noVoteSlashBP = 1000;
    let loseVoteSlashBP = 2000;
    let draftReward = 10;
    let winReward = 100;
    const baseTicketPrice = 10;
    let minerBond = 0;
    let minerDraftReward = 0;
    let minerUndraftReward = 0;
    let minerExecuteReward = 0;
    let minerMatureDur = 0;

    beforeEach(async () => {
        const vars = await initCoreTestSuite();
        accts = await ethers.getSigners();
        deployer = accts[0];
        marketCreator = accts[0];
        provider = accts[1];
        swapper = accts[2];
        inventor = accts[3];
        user5 = accts[5];
        user6 = accts[6];
        user7 = accts[7];
        supply = vars.supply;
        mc = vars.mc;
        token = vars.token;
        minerReg = vars.minerReg;
        minerBond = vars.minerBond;
        minerDraftReward = vars.minerDraftReward;
        minerUndraftReward = vars.minerUndraftReward;
        minerExecuteReward = vars.minerExecuteReward;
        minerMatureDur = vars.minerMatureDur;
        ticketCancelDur = vars.ticketCancelDur;
        ticketMatureDur = vars.ticketMatureDur;
        ticketExpireDur = vars.ticketExpireDur;
        ticketPauseDur = vars.ticketPauseDur;

        const libs = await makeLibs();
        let factory: any = await ethers.getContractFactory("Core", {
            libraries: getCoreLibraries(libs),
        });
        core = await factory.deploy(mc.address, token.address, 1800, 1800, 1, 3);
        await core.setOperator(vars.operator.address);

        factory = await ethers.getContractFactory("AssetRegistry");
        assetReg = await factory.deploy();
        await core.setAssetRegistry(assetReg.address);
        await core.setProviderRegistry(vars.provReg.address);

        const Randomness = require("../artifacts/contracts/randomness/Randomness.sol/Randomness.json");
        randomness = await deployMockContract(deployer, Randomness.abi);
        await randomness.mock.randomN.returns(0);

        factory = await ethers.getContractFactory("MediatorManager");
        medMgr = await factory.deploy(token.address, mc.address, randomness.address, ticketCancelDur, ticketMatureDur, ticketExpireDur, ticketPauseDur);
        await medMgr.setTicketMarketParams(10, windowDur, 256, 60000, 1000, 7, 10000);

        factory = await ethers.getContractFactory("DisputeManager");
        dm = await factory.deploy(token.address, mc.address, core.address, medMgr.address, predictDur, evidenceDur);

        await vars.provReg.updateWriter(core.address, true);
        await minerReg.updateWriter(dm.address, true);
        await dm.setMinerRegistry(minerReg.address);
        await dm.setMediatorManager(medMgr.address);
        await token.approve(minerReg.address, minerBond);
        await minerReg.register();
        await token.transfer(user6.address, minerBond);
        await token.connect(user6).approve(minerReg.address, minerBond);
        await minerReg.connect(user6).register();
        await token.transfer(user7.address, minerBond);
        await token.connect(user7).approve(minerReg.address, minerBond);
        await minerReg.connect(user7).register();
        await advanceBlockTime(minerMatureDur);

        await core.setMinerRegistry(minerReg.address);
        await core.setInventor(inventor.address);
        await mc.updateWriter(core.address, true);
        await mc.setMediatorManager(medMgr.address);

        factory = await ethers.getContractFactory("TOKEN");
        baseAsset = await factory.deploy("BASE_TOKEN", "BASE_TOKEN", supply, 18);
        baseAddr = baseAsset.address;
        quoteAsset = await factory.deploy("QUOTE_TOKEN", "QUOTE_TOKEN", supply, 18);
        quoteAddr = quoteAsset.address;
        baseDec = BigNumber.from(10).pow(await baseAsset.decimals());
        quoteDec = BigNumber.from(10).pow(await quoteAsset.decimals());
        ticketMatureDur = (await medMgr.ticketMatureDur()).toNumber();

        mid = makeMarketID(marketCreator.address, baseAddr, quoteAddr, 1, 0);

        await medMgr.updateTicketPool(0, bondAmt, draftReward, winReward, noVoteSlashBP, loseVoteSlashBP, 1, 0, 0, false, false);
    });

    async function provideLiquidity(provider: SignerWithAddress, provLiqBal: BigNumber, basePrice: BigNumber, timeToPay = 0) {
        await baseAsset.transfer(provider.address, provLiqBal);
        await baseAsset.connect(provider).approve(core.address, provLiqBal);
        await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [provLiqBal, basePrice], [], [], [timeToPay, 0, 0]);
    }

    function createOrder_BaseOn_QuoteOff(mid: string) {
        return new Promise<BigNumber>(async (resolve) => {
            let provLiqBal = baseDec.mul(100);
            let basePrice = quoteDec.mul(10);
            await provideLiquidity(provider, provLiqBal, basePrice);
            const swapAmt = BigNumber.from(5).mul(baseDec);
            const tx = await core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, basePrice, [], 0, 0);
            const res = await tx.wait();
            return resolve(res.events?.at(0)?.args?.numTypeInfo[0]);
        });
    }

    async function join(user: SignerWithAddress, ticketId = 0) {
        await token.transfer(user.address, baseTicketPrice + bondAmt);
        await token.connect(user).approve(medMgr.address, baseTicketPrice + bondAmt);
        if (ticketId !== undefined) await medMgr.connect(user).purchaseTicket(0);
        await advanceBlockTime(ticketMatureDur);
        await expect(medMgr.connect(user).join(ticketId)).not.to.be.reverted;
        return;
    }

    describe(".setPredictDur", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(dm.connect(swapper).setPredictDur(123)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully update value", async () => {
            await expect(dm.setPredictDur(123)).not.to.be.reverted;
            expect((await dm.predictDur()).eq(123)).to.be.true;
        });
    });

    describe(".setMarketCore", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(dm.connect(swapper).setMarketCore(swapper.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully update value", async () => {
            await expect(dm.setMarketCore(swapper.address)).not.to.be.reverted;
            expect(await dm.marketCore()).to.eql(swapper.address);
        });
    });

    describe(".setMediatorManager", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(dm.connect(swapper).setMediatorManager(swapper.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully update value", async () => {
            await expect(dm.setMediatorManager(swapper.address)).not.to.be.reverted;
            expect(await dm.mediatorMgr()).to.eql(swapper.address);
        });
    });

    describe(".createDispute", () => {
        let orderID: BigNumber;

        beforeEach(async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            mid = makeMarketID(marketCreator.address, baseAddr, quoteAddr, 1, 0);
            await core.setDisputeManager(dm.address);
            await medMgr.setDisputeManager(dm.address);
        });

        it("should revert with reason='UNKNOWN_ORDER' when order does not exist", async () => {
            await expect(dm.createDispute(0, false)).to.be.revertedWith("UNKNOWN_ORDER");
        });

        it("should revert with reason='NOT_ALLOWED' when order is already released (other reasons)", async () => {
            const orderID = await createOrder_BaseOn_QuoteOff(mid);
            await core.connect(swapper).markOrderAsPaid(orderID);
            await core.connect(provider).releaseOrder(orderID);
            await expect(dm.createDispute(orderID, false)).to.be.revertedWith("DM: NOT_ALLOWED");
        });

        context("on success", () => {
            beforeEach(async () => {
                orderID = await createOrder_BaseOn_QuoteOff(mid);
                await core.connect(swapper).markOrderAsPaid(orderID);
                await expect(dm.connect(swapper).createDispute(orderID, false)).to.emit(dm, "DisputeCreated").withArgs(orderID, swapper.address, BigNumber.from(0), false);
                expect(await dm.countDisputes(orderID)).to.eq(1);
            });

            it("should update new dispute state correctly", async () => {
                const order = await core.getOrder(orderID);
                expect(order.disputed).to.be.true;

                const dispute = await dm.getDispute(orderID, 0);
                expect(dispute.marketId).to.eql(getAddress(mid));
                expect(dispute.creator).to.eq(swapper.address);
                expect(dispute.defendant).to.eq(provider.address);
                expect(dispute.wantRelease).to.be.false;

                const liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.openDisputes.eq(1)).to.be.true;
            });
        });

        it("should revert with reason='PREV_ACTIVE' when previous dispute has not passed prediction period", async () => {
            const orderID = await createOrder_BaseOn_QuoteOff(mid);
            await core.connect(swapper).markOrderAsPaid(orderID);
            await expect(dm.connect(swapper).createDispute(orderID, false)).to.emit(dm, "DisputeCreated").withArgs(orderID, swapper.address, BigNumber.from(0), false);
            await expect(dm.connect(swapper).createDispute(orderID, false)).to.be.revertedWith("DM: PREV_ACTIVE");
        });

        describe("previous dispute was not conclusive (stalled)", () => {
            it("should create a new dispute round", async () => {
                // create mature ticket
                await medMgr.setTicketMarketParams(baseTicketPrice, 86400, 2, 2, 1000, 2, 10000);
                await token.approve(medMgr.address, (baseTicketPrice + bondAmt) * 2);
                await medMgr.purchaseTicket(0);
                await advanceBlockTime(ticketMatureDur);
                await medMgr.join(0);

                // create first dispute round and draft ticket
                const orderID = await createOrder_BaseOn_QuoteOff(mid);
                await core.connect(swapper).markOrderAsPaid(orderID);
                await expect(dm.connect(swapper).createDispute(orderID, false)).to.emit(dm, "DisputeCreated");
                await dm.draftMediator(orderID);

                // advance time to end of prediction period
                await advanceBlockTime(evidenceDur + predictDur);

                // should create new dispute round
                await expect(dm.connect(swapper).createDispute(orderID, false)).to.emit(dm, "DisputeCreated");
                await expect(dm.getDispute(orderID, 0)).not.to.be.reverted;
                await expect(dm.getDispute(orderID, 1)).not.to.be.reverted;
            });
        });

        describe("previous dispute was already voted on decisively (released or cancelled)", () => {
            it("should revert on new dispute creation", async () => {
                await medMgr.setTicketMarketParams(baseTicketPrice, 86400, 2, 2, 1000, 2, 10000);

                orderID = await createOrder_BaseOn_QuoteOff(mid);
                await core.connect(swapper).markOrderAsPaid(orderID);
                await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
                await join(user5);
                await expect(dm.draftMediator(orderID)).not.to.be.reverted;

                const vote = "1vote";
                const hash = ethers.utils.solidityKeccak256(["string", "address"], [vote, user5.address]);
                await advanceBlockTime(evidenceDur);
                await dm.connect(user5).commitVote(orderID, 0, hash);
                await advanceBlockTime(predictDur / 2);
                await expect(dm.connect(user5).revealVote(orderID, 0, vote, hash)).not.to.be.reverted;
                await advanceBlockTime(predictDur / 2);

                await expect(dm.connect(swapper).createDispute(orderID, false)).to.be.revertedWith("DM: PREV_RESOLVED");
            });
        });

        describe("market is not approved for mediator pool", () => {
            it("should revert", async () => {
                // make pool require market approval
                await medMgr.updateTicketPool(0, bondAmt, draftReward, winReward, noVoteSlashBP, loseVoteSlashBP, 0, 0, 0, false, true);
                orderID = await createOrder_BaseOn_QuoteOff(mid);
                await core.connect(swapper).markOrderAsPaid(orderID);
                await expect(dm.connect(swapper).createDispute(orderID, false)).to.be.revertedWith("DM: MKT_NOT_APPROVED");
            });
        });
    });

    describe(".draftMediator", () => {
        let orderID: BigNumber;
        beforeEach(async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            mid = makeMarketID(marketCreator.address, baseAddr, quoteAddr, 1, 0);
            await core.setDisputeManager(dm.address);
            await medMgr.setDisputeManager(dm.address);
        });

        it("should revert when caller is not a miner", async () => {
            orderID = await createOrder_BaseOn_QuoteOff(mid);
            await expect(dm.connect(user5).draftMediator(orderID)).to.be.revertedWith("DM: NOT_MINER");
        });

        it("should revert when order has no dispute", async () => {
            orderID = await createOrder_BaseOn_QuoteOff(mid);
            await expect(dm.draftMediator(orderID)).to.be.revertedWith("DM: NO_DISPUTE");
        });

        it("should revert when order has been released", async () => {
            orderID = await createOrder_BaseOn_QuoteOff(mid);
            await core.connect(swapper).markOrderAsPaid(orderID);
            await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
            await core.connect(provider).releaseOrder(orderID);
            await expect(dm.draftMediator(orderID)).to.be.revertedWith("DM: ORDER_RELEASED");
        });

        it("should revert when maximum number of draftees was reached", async () => {
            await medMgr.updateTicketPool(0, bondAmt, draftReward, winReward, noVoteSlashBP, loseVoteSlashBP, 0, 0, 0, false, false);
            orderID = await createOrder_BaseOn_QuoteOff(mid);
            await core.connect(swapper).markOrderAsPaid(orderID);
            await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
            await expect(dm.draftMediator(orderID)).to.be.revertedWith("DM: MAX_DRAFTED");
        });

        describe("number of mediators = 2", () => {
            it("should update state correctly", async () => {
                const numMediators = 2;
                await medMgr.updateTicketPool(0, bondAmt, draftReward, winReward, noVoteSlashBP, loseVoteSlashBP, numMediators, 0, 0, false, false);
                await medMgr.setTicketMarketParams(baseTicketPrice, 86400, 2, 2, 1000, 2, 10000);
                await token.approve(medMgr.address, (baseTicketPrice + bondAmt) * 2);
                await medMgr.purchaseTicket(0);
                await medMgr.purchaseTicket(0);
                await advanceBlockTime(ticketMatureDur);
                await medMgr.join(0);
                await medMgr.join(1);

                orderID = await createOrder_BaseOn_QuoteOff(mid);
                await core.connect(swapper).markOrderAsPaid(orderID);
                await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;

                // shouldn't set phases timestamp after draft 1
                await expect(dm.draftMediator(orderID)).to.emit(dm, "DraftedMediator").withArgs(getAddress(mid), 0, 0, 0, deployer.address, deployer.address);
                let dispute = await dm.getDispute(orderID, 0);
                expect(dispute.evidenceEndAt).to.eq(0);
                expect(dispute.commitEndAt).to.eq(0);
                expect(dispute.predictEndAt).to.eq(0);

                // Should add miner reward to the miner
                expect(await minerReg.rewardBalanceOf(deployer.address)).to.eq(minerDraftReward);

                // should set phases timestamp after draft 2
                const now = await advanceBlockTime(1);
                await expect(dm.draftMediator(orderID)).to.emit(dm, "DraftedMediator").withArgs(getAddress(mid), 0, 0, 1, deployer.address, deployer.address);
                dispute = await dm.getDispute(orderID, 0);
                const evidenceEndAt = now + evidenceDur + 1;
                expect(dispute.evidenceEndAt).to.eq(evidenceEndAt);
                expect(dispute.commitEndAt).to.eq(evidenceEndAt + predictDur / 2);
                expect(dispute.predictEndAt).to.eq(evidenceEndAt + predictDur);

                expect(await minerReg.rewardBalanceOf(deployer.address)).to.eq(minerDraftReward + minerDraftReward);
            });
        });

        context("when there is an existing dispute", () => {
            it("should revert when dispute has been executed", async () => {
                await medMgr.setTicketMarketParams(baseTicketPrice, 86400, 2, 2, 1000, 2, 10000);

                orderID = await createOrder_BaseOn_QuoteOff(mid);
                await core.connect(swapper).markOrderAsPaid(orderID);
                await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
                await join(user5);
                await expect(dm.draftMediator(orderID)).not.to.be.reverted;

                const vote = "1vote";
                const hash = ethers.utils.solidityKeccak256(["string", "address"], [vote, user5.address]);
                await advanceBlockTime(evidenceDur);
                await dm.connect(user5).commitVote(orderID, 0, hash);
                await advanceBlockTime(predictDur / 2);
                await expect(dm.connect(user5).revealVote(orderID, 0, vote, hash)).not.to.be.reverted;
                await advanceBlockTime(predictDur / 2);
                await expect(dm.executeDecision(orderID, 0)).not.to.be.reverted;

                await expect(dm.draftMediator(orderID)).to.be.revertedWith("DM: ALREADY_EXECUTED");
            });

            it("should revert when dispute has been abandoned", async () => {
                await medMgr.setTicketMarketParams(baseTicketPrice, 86400, 2, 2, 1000, 2, 10000);

                orderID = await createOrder_BaseOn_QuoteOff(mid);
                await core.connect(swapper).markOrderAsPaid(orderID);
                await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
                await join(user5);
                await expect(dm.draftMediator(orderID)).not.to.be.reverted;

                await advanceBlockTime(evidenceDur + predictDur);
                await core.connect(provider).releaseOrder(orderID);
                await expect(dm.executeDecision(orderID, 0)).not.to.be.reverted;
                expect((await dm.getDispute(orderID, 0)).abandoned).to.be.true;

                await expect(dm.draftMediator(orderID)).to.be.revertedWith("DM: ALREADY_EXECUTED");
            });
        });
    });

    describe(".commitVote", () => {
        let orderID: BigNumber;
        beforeEach(async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await core.setDisputeManager(dm.address);
            await medMgr.setDisputeManager(dm.address);

            // create dispute
            orderID = await createOrder_BaseOn_QuoteOff(mid);
            await core.connect(swapper).markOrderAsPaid(orderID);
            await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
            const order = await core.getOrder(orderID);
            expect(order.disputed).to.be.true;
        });

        it("should revert if order has been released before commit", async () => {
            let commitHash = randomBytes(32);

            // join as mediator
            await medMgr.setTicketMarketParams(baseTicketPrice, 86400, 3, 3, 1000, 2, 10000);
            await token.approve(medMgr.address, baseTicketPrice + bondAmt);
            await medMgr.purchaseTicket(0);
            await advanceBlockTime(ticketMatureDur);
            await expect(medMgr.join(0)).not.to.be.reverted;

            // commit
            await expect(dm.draftMediator(orderID)).not.to.be.reverted;
            await core.connect(provider).releaseOrder(orderID);
            await advanceBlockTime(evidenceDur);
            await expect(dm.commitVote(orderID, 0, commitHash)).to.be.revertedWith("DM: ORDER_RELEASED");
        });

        context("with numMediators = 3", () => {
            beforeEach(async () => {
                // join 2 mediators
                const numMediators = 3;
                await medMgr.updateTicketPool(0, bondAmt, draftReward, winReward, noVoteSlashBP, loseVoteSlashBP, numMediators, 0, 0, false, false);
                await medMgr.setTicketMarketParams(baseTicketPrice, 86400, 3, 3, 1000, 2, 10000);
                await token.approve(medMgr.address, baseTicketPrice + bondAmt);
                await token.transfer(user5.address, baseTicketPrice + bondAmt);
                await token.connect(user5).approve(medMgr.address, baseTicketPrice + bondAmt);
                await medMgr.connect(user5).purchaseTicket(0);
                await medMgr.purchaseTicket(0);
                await advanceBlockTime(ticketMatureDur);
                await expect(medMgr.join(0)).not.to.be.reverted;
                await expect(medMgr.connect(user5).join(0)).not.to.be.reverted;
                await randomness.mock.randomN.returns(0);
            });

            it("should revert with reason=NOT_DRAFTED when sender was not drafted to the dispute", async () => {
                await expect(dm.connect(swapper).commitVote(orderID, 0, randomBytes(32))).to.be.revertedWith("DM: NOT_DRAFTED");
            });

            it("should revert with reason=NOT_READY when dispute is not yet in commit phase (not completely drafted into)", async () => {
                await expect(dm.draftMediator(orderID)).not.to.be.reverted;
                await expect(dm.commitVote(orderID, 0, randomBytes(32))).to.be.revertedWith("DM: NOT_READY");
            });
        });

        context("with numMediators = 1", () => {
            beforeEach(async () => {
                // join as mediator
                await medMgr.setTicketMarketParams(baseTicketPrice, 86400, 3, 3, 1000, 2, 10000);
                await token.approve(medMgr.address, baseTicketPrice + bondAmt);
                await medMgr.purchaseTicket(0);
                await advanceBlockTime(ticketMatureDur);
                await expect(medMgr.join(0)).not.to.be.reverted;
            });

            it("should revert with reason=COMMIT_OVER when dispute commit phase is over", async () => {
                await expect(dm.draftMediator(orderID)).not.to.be.reverted;
                await advanceBlockTime(evidenceDur + predictDur / 2);
                await expect(dm.commitVote(orderID, 0, randomBytes(32))).to.be.revertedWith("DM: COMMIT_OVER");
            });

            it("should revert with reason=PREV_COMMITTED when sender has previously committed", async () => {
                await expect(dm.draftMediator(orderID)).not.to.be.reverted;

                // commit should succeed
                await advanceBlockTime(evidenceDur);
                const hash = randomBytes(32);
                await expect(dm.commitVote(orderID, 0, hash))
                    .to.emit(dm, "Committed")
                    .withArgs(getAddress(mid), orderID, toBN(0), deployer.address, toBN(0), hexlify(hash));
                const prediction = await dm.predictions(orderID, 0, deployer.address, 0);
                expect(prediction.committed).to.eql(hexlify(hash));
                expect(prediction.revealed).to.be.false;

                // fail since already committed
                await expect(dm.commitVote(orderID, 0, randomBytes(32))).to.be.revertedWith("DM: PREV_COMMITTED");
            });
        });

        context("using same commit hash in a different commit", () => {
            let commitHash = randomBytes(32);
            beforeEach(async () => {
                // join as mediator
                await medMgr.setTicketMarketParams(baseTicketPrice, 86400, 3, 3, 1000, 2, 10000);
                await token.approve(medMgr.address, baseTicketPrice + bondAmt);
                await medMgr.purchaseTicket(0);
                await advanceBlockTime(ticketMatureDur);
                await expect(medMgr.join(0)).not.to.be.reverted;

                // commit
                await expect(dm.draftMediator(orderID)).not.to.be.reverted;
                await advanceBlockTime(evidenceDur);
                await dm.commitVote(orderID, 0, commitHash);
            });

            it("should revert with reason=COMMIT_SEEN when dispute commit hash has been seen before", async () => {
                await expect(dm.commitVote(orderID, 0, commitHash)).to.be.revertedWith("DM: COMMIT_SEEN");
            });
        });
    });

    describe(".revealVote", () => {
        let orderID: BigNumber;

        beforeEach(async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false,  0, 0); // prettier-ignore
            await core.setDisputeManager(dm.address);
            await medMgr.setDisputeManager(dm.address);

            // create dispute
            orderID = await createOrder_BaseOn_QuoteOff(mid);
            await core.connect(swapper).markOrderAsPaid(orderID);
            await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
            const order = await core.getOrder(orderID);
            expect(order.disputed).to.be.true;

            // join as mediator
            await medMgr.setTicketMarketParams(baseTicketPrice, 86400, 3, 3, 1000, 2, 10000);
            await token.approve(medMgr.address, baseTicketPrice + bondAmt);
            await medMgr.purchaseTicket(0);
            await advanceBlockTime(ticketMatureDur);
            await expect(medMgr.join(0)).not.to.be.reverted;

            // draft
            await expect(dm.draftMediator(orderID)).not.to.be.reverted;
            await advanceBlockTime(evidenceDur);
        });

        it("should revert with reason=ORDER_RELEASED when order was released before reveal", async () => {
            await core.connect(provider).releaseOrder(orderID);
            await expect(dm.revealVote(orderID, 0, "vote", randomBytes(32))).to.be.revertedWith("DM: ORDER_RELEASED");
        });

        it("should revert with reason=NO_COMMIT when sender has not committed to the current dispute", async () => {
            await expect(dm.revealVote(orderID, 0, "vote", randomBytes(32))).to.be.revertedWith("DM: NO_COMMIT");
        });

        it("should revert with reason=NOT_READY when its not time for reveal", async () => {
            await dm.commitVote(orderID, 0, randomBytes(32));
            await expect(dm.revealVote(orderID, 0, "vote", randomBytes(32))).to.be.revertedWith("DM: NOT_READY");
        });

        it("should revert with reason=REVEAL_OVER when reveal period as elapsed", async () => {
            await dm.commitVote(orderID, 0, randomBytes(32));
            await advanceBlockTime(evidenceDur + predictDur);
            await expect(dm.revealVote(orderID, 0, "vote", randomBytes(32))).to.be.revertedWith("DM: REVEAL_OVER");
        });

        it("should revert with reason=HASH_MISMATCH when hash argument did not match the expected hash for vote", async () => {
            await dm.commitVote(orderID, 0, randomBytes(32));
            await advanceBlockTime(predictDur / 2);
            await expect(dm.revealVote(orderID, 0, "vote", randomBytes(32))).to.be.revertedWith("DM: HASH_MISMATCH");
        });

        it("should revert with reason=COMMIT_HASH_MISMATCH when hash argument did not match committed hash", async () => {
            await dm.commitVote(orderID, 0, randomBytes(32));
            await advanceBlockTime(predictDur / 2);
            const vote = "vote";
            await expect(dm.revealVote(orderID, 0, vote, ethers.utils.solidityKeccak256(["string", "address"], [vote, deployer.address]))).to.be.revertedWith("DM: COMMIT_HASH_MISMATCH");
        });

        it("should revert with reason=INVALID_CHOICE when choice is invalid", async () => {
            const vote = "5vote";
            const hash = ethers.utils.solidityKeccak256(["string", "address"], [vote, deployer.address]);
            await dm.commitVote(orderID, 0, hash);
            await advanceBlockTime(predictDur / 2);
            await expect(dm.revealVote(orderID, 0, vote, hash)).to.be.revertedWith("DM: INVALID_CHOICE");
        });

        it("should increment dispute nCancel when vote=0", async () => {
            const vote = "0vote";
            const hash = ethers.utils.solidityKeccak256(["string", "address"], [vote, deployer.address]);
            await dm.commitVote(orderID, 0, hash);
            await advanceBlockTime(predictDur / 2);
            await expect(dm.revealVote(orderID, 0, vote, hash))
                .to.emit(dm, "Revealed")
                .withArgs(getAddress(mid), orderID, toBN(0), deployer.address, toBN(0), hexlify(Buffer.from(vote).slice(0, 1)));
            let dispute = await dm.getDispute(orderID, 0);
            expect(dispute.nCancel.eq(1)).to.be.true;
            let prediction = await dm.predictions(orderID, 0, deployer.address, 0);
            expect(prediction.vote).to.eql(hexlify(Buffer.from(vote).slice(0, 1)));
        });

        it("should increment dispute nRelease when vote=0", async () => {
            const vote = "1vote";
            const hash = ethers.utils.solidityKeccak256(["string", "address"], [vote, deployer.address]);
            await dm.commitVote(orderID, 0, hash);
            await advanceBlockTime(predictDur / 2);
            await expect(dm.revealVote(orderID, 0, vote, hash))
                .to.emit(dm, "Revealed")
                .withArgs(getAddress(mid), orderID, toBN(0), deployer.address, toBN(0), hexlify(Buffer.from(vote).slice(0, 1)));
            let dispute = await dm.getDispute(orderID, 0);
            expect(dispute.nRelease.eq(1)).to.be.true;
            let prediction = await dm.predictions(orderID, 0, deployer.address, 0);
            expect(prediction.vote).to.eql(hexlify(Buffer.from(vote).slice(0, 1)));
        });

        it("should revert with reason=ALREADY_REVEALED when sender has revealed their vote", async () => {
            const vote = "1vote";
            const hash = ethers.utils.solidityKeccak256(["string", "address"], [vote, deployer.address]);
            await dm.commitVote(orderID, 0, hash);
            await advanceBlockTime(predictDur / 2);
            await expect(dm.revealVote(orderID, 0, vote, hash)).not.to.be.reverted;
            let prediction = await dm.predictions(orderID, 0, deployer.address, 0);
            expect(prediction.revealed).to.be.true;
            expect(prediction.vote).to.eql(hexlify(Buffer.from(vote).slice(0, 1)));
            await expect(dm.revealVote(orderID, 0, vote, hash)).to.be.revertedWith("DM: ALREADY_REVEALED");
        });
    });

    describe(".executeDecision", () => {
        let orderID: BigNumber;

        beforeEach(async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await core.setDisputeManager(dm.address);
            await medMgr.setDisputeManager(dm.address);
            orderID = await createOrder_BaseOn_QuoteOff(mid);
        });

        it("should revert with reason=NOT_MINER when sender is not a miner", async () => {
            await expect(dm.connect(user5).executeDecision(orderID, 0)).to.be.revertedWith("DM: NOT_MINER");
        });

        describe("when no matching dispute with index exists", () => {
            it("should revert with reason=NO_DISPUTE when order has no dispute", async () => {
                await expect(dm.executeDecision(orderID, 0)).to.be.revertedWith("DM: NO_DISPUTE");
            });
        });

        context("when matching dispute with index exist", () => {
            beforeEach(async () => {
                await medMgr.setTicketMarketParams(baseTicketPrice, 86400, 3, 3, 1000, 2, 10000);

                await core.connect(swapper).markOrderAsPaid(orderID);
                await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
            });

            context("when dispute is not ready to be executed", () => {
                it("should revert", async () => {
                    await join(user5);
                    await expect(dm.draftMediator(orderID)).not.to.be.reverted;
                    await expect(dm.executeDecision(orderID, 0)).to.be.revertedWith("DM: NOT_READY");
                });
            });

            describe("when winning vote is 'release'", () => {
                beforeEach(async () => {
                    await join(user5);
                    await expect(dm.draftMediator(orderID)).not.to.be.reverted;
                    const vote = "1vote";
                    const hash = ethers.utils.solidityKeccak256(["string", "address"], [vote, user5.address]);
                    await advanceBlockTime(evidenceDur);
                    await dm.connect(user5).commitVote(orderID, 0, hash);
                    await advanceBlockTime(predictDur / 2);
                    await expect(dm.connect(user5).revealVote(orderID, 0, vote, hash)).not.to.be.reverted;
                    await advanceBlockTime(predictDur / 2);
                });

                it("should call release function on the order core", async () => {
                    let liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.openDisputes).to.eq(1);

                    await expect(dm.executeDecision(orderID, 0)).not.to.be.reverted;
                    expect((await core.getOrder(orderID)).released).to.be.true;
                    expect((await core.getOrder(orderID)).cancelled).to.be.false;

                    const dispute = await dm.getDispute(orderID, 0);
                    expect(dispute.executed).to.be.true;

                    liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.openDisputes).to.eq(0);

                    // Miner should be rewarded
                    expect(await minerReg.rewardBalanceOf(deployer.address)).to.eq(minerDraftReward + minerExecuteReward);
                });

                context("when dispute was already executed", () => {
                    it("should revert", async () => {
                        await expect(dm.connect(user6).executeDecision(orderID, 0)).not.to.be.reverted;
                        await expect(dm.connect(user6).executeDecision(orderID, 0)).to.be.revertedWith("DM: ALREADY_EXECUTED");
                    });
                });
            });

            describe("when winning vote is 'cancel'", () => {
                beforeEach(async () => {
                    await join(user5);
                    await expect(dm.draftMediator(orderID)).not.to.be.reverted;
                    const vote = "0vote";
                    const hash = ethers.utils.solidityKeccak256(["string", "address"], [vote, user5.address]);
                    await advanceBlockTime(evidenceDur);
                    await dm.connect(user5).commitVote(orderID, 0, hash);
                    await advanceBlockTime(predictDur / 2);
                    await expect(dm.connect(user5).revealVote(orderID, 0, vote, hash)).not.to.be.reverted;
                    await advanceBlockTime(predictDur / 2);
                });

                it("should call cancel function on the order core", async () => {
                    let liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.openDisputes).to.eq(1);

                    await expect(dm.executeDecision(orderID, 0)).not.to.be.reverted;
                    expect((await core.getOrder(orderID)).released).to.be.false;
                    expect((await core.getOrder(orderID)).cancelled).to.be.true;

                    const dispute = await dm.getDispute(orderID, 0);
                    expect(dispute.executed).to.be.true;

                    liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.openDisputes).to.eq(0);
                });
            });

            describe("when no winning vote (inconclusive/stalled)", () => {
                beforeEach(async () => {
                    await join(user5);
                    await expect(dm.draftMediator(orderID)).not.to.be.reverted;
                    await advanceBlockTime(evidenceDur + predictDur);
                });

                it("should not finalize dispute, not decrement liquidity dispute count", async () => {
                    let liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.openDisputes).to.eq(1);

                    await expect(dm.executeDecision(orderID, 0)).not.to.be.reverted;
                    expect((await core.getOrder(orderID)).released).to.be.false;
                    expect((await core.getOrder(orderID)).cancelled).to.be.false;

                    const dispute = await dm.getDispute(orderID, 0);
                    expect(dispute.abandoned).to.be.false;
                    expect(dispute.executed).to.be.true;

                    liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.openDisputes).to.eq(1);
                });
            });

            describe("when order was released before execution", () => {
                beforeEach(async () => {
                    await join(user5);
                    await expect(dm.draftMediator(orderID)).not.to.be.reverted;
                    const vote = "0vote";
                    const hash = ethers.utils.solidityKeccak256(["string", "address"], [vote, user5.address]);
                    await advanceBlockTime(evidenceDur);
                    await dm.connect(user5).commitVote(orderID, 0, hash);
                    await advanceBlockTime(predictDur / 2);
                    await expect(dm.connect(user5).revealVote(orderID, 0, vote, hash)).not.to.be.reverted;
                    await advanceBlockTime(predictDur / 2);
                    await core.connect(provider).releaseOrder(orderID);
                });

                it("should not call release or cancel function", async () => {
                    let liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.openDisputes).to.eq(1);

                    expect((await core.getOrder(orderID)).released).to.be.true;
                    await expect(dm.executeDecision(orderID, 0)).not.to.be.reverted;
                    expect((await core.getOrder(orderID)).released).to.be.true;
                    expect((await core.getOrder(orderID)).cancelled).to.be.false;

                    const dispute = await dm.getDispute(orderID, 0);
                    expect(dispute.executed).to.be.false;
                    expect(dispute.abandoned).to.be.true;

                    liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.openDisputes).to.eq(0);
                });
            });
        });

        context("when there are two disputes", () => {
            beforeEach(async () => {
                await medMgr.setTicketMarketParams(baseTicketPrice, 86400, 3, 3, 1000, 2, 10000);

                await core.connect(swapper).markOrderAsPaid(orderID);
                await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
                await join(user5);
                await join(user6);
                await expect(dm.draftMediator(orderID)).not.to.be.reverted;
                await advanceBlockTime(evidenceDur + predictDur);
                await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
                await expect(dm.draftMediator(orderID)).not.to.be.reverted;
                await advanceBlockTime(evidenceDur + predictDur);
            });

            context("execute dispute 0 (vote is inconclusive/stalled)", () => {
                it("should not decrement liquidity dispute count", async () => {
                    let liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.openDisputes).to.eq(1);

                    await expect(dm.executeDecision(orderID, 0)).not.to.be.reverted;
                    expect((await core.getOrder(orderID)).released).to.be.false;
                    expect((await core.getOrder(orderID)).cancelled).to.be.false;

                    const dispute = await dm.getDispute(orderID, 0);
                    expect(dispute.executed).to.be.true;
                    expect(dispute.abandoned).to.be.false;

                    liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.openDisputes).to.eq(1);
                });
            });

            context("execute dispute 1 (vote is inconclusive/stalled)", () => {
                it("should not decrement liquidity dispute count", async () => {
                    let liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.openDisputes).to.eq(1);

                    await expect(dm.executeDecision(orderID, 1)).not.to.be.reverted;
                    expect((await core.getOrder(orderID)).released).to.be.false;
                    expect((await core.getOrder(orderID)).cancelled).to.be.false;

                    const dispute = await dm.getDispute(orderID, 1);
                    expect(dispute.executed).to.be.true;
                    expect(dispute.abandoned).to.be.false;

                    liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.openDisputes).to.eq(1);
                });
            });
        });
    });

    describe(".undraftMediator", () => {
        let orderID: BigNumber;

        beforeEach(async () => {
            const numMediators = 2;
            await medMgr.updateTicketPool(0, bondAmt, draftReward, winReward, noVoteSlashBP, loseVoteSlashBP, numMediators, 0, 0, false, false);
            await medMgr.setTicketMarketParams(baseTicketPrice, 86400, 3, 3, 1000, 2, 10000);

            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await core.setDisputeManager(dm.address);
            await medMgr.setDisputeManager(dm.address);
            orderID = await createOrder_BaseOn_QuoteOff(mid);

            await core.connect(swapper).markOrderAsPaid(orderID);
            await join(user5);
            await join(user6);
            await advanceBlockTime(ticketMatureDur);
        });

        it("should revert with reason=NOT_MINER when sender is not a miner", async () => {
            await expect(dm.connect(user5).undraftMediator(orderID, 0)).to.be.revertedWith("DM: NOT_MINER");
        });

        it("should revert with reason=NO_DISPUTE when order has no dispute", async () => {
            await expect(dm.undraftMediator(orderID, 0)).to.be.revertedWith("DM: NO_DISPUTE");
        });

        it("should revert when dispute has not been executed", async () => {
            await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
            await expect(dm.undraftMediator(orderID, 0)).to.be.revertedWith("DM: NOT_EXECUTED");
        });

        context("when dispute result is inconclusive/stalled", () => {
            it("should undraft ticket and award draft reward", async () => {
                let deployerMinerReward = 0;
                let user7MinerReward = 0;

                await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
                await dm.draftMediator(orderID);
                await dm.draftMediator(orderID);
                deployerMinerReward += minerDraftReward + minerDraftReward;

                await advanceBlockTime(evidenceDur + predictDur);
                await expect(dm.executeDecision(orderID, 0)).not.to.be.reverted;
                const dispute = await dm.getDispute(orderID, 0);
                expect(dispute.executed).to.be.true;
                deployerMinerReward += minerExecuteReward;

                await expect(dm.connect(user7).undraftMediator(orderID, 0)).to.emit(medMgr, "Undrafted").withArgs(user5.address, 0, true, user7.address);
                await expect(dm.undraftMediator(orderID, 0)).not.to.be.reverted;
                expect(await dm.rewardBalanceOf(user5.address)).to.eq(draftReward);
                expect(await dm.rewardBalanceOf(user6.address)).to.eq(draftReward);
                deployerMinerReward += minerUndraftReward;
                user7MinerReward += minerUndraftReward;

                // it should revert if no ticket left to undraft
                await expect(dm.undraftMediator(orderID, 0)).to.be.revertedWith("DM: ALL_UNDRAFTED");

                // Verify miners rewards
                expect(await minerReg.rewardBalanceOf(deployer.address)).to.eq(deployerMinerReward);
                expect(await minerReg.rewardBalanceOf(user7.address)).to.eq(user7MinerReward);
            });
        });

        context("when dispute result is abandoned (order was released)", () => {
            it("should undraft ticket and award draft reward", async () => {
                await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
                await dm.draftMediator(orderID);
                await dm.draftMediator(orderID);
                await core.connect(provider).releaseOrder(orderID);

                await advanceBlockTime(evidenceDur + predictDur);
                await expect(dm.executeDecision(orderID, 0)).not.to.be.reverted;
                const dispute = await dm.getDispute(orderID, 0);
                expect(dispute.abandoned).to.be.true;
                expect(dispute.executed).to.be.false;

                await expect(dm.undraftMediator(orderID, 0)).not.to.be.reverted;
                await expect(dm.undraftMediator(orderID, 0)).not.to.be.reverted;
                expect(await dm.rewardBalanceOf(user5.address)).to.eq(draftReward);
                expect(await dm.rewardBalanceOf(user6.address)).to.eq(draftReward);
            });
        });

        context("when ticket owner voted the win side", () => {
            it("should undraft ticket and award win reward", async () => {
                await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
                await dm.draftMediator(orderID);
                await dm.draftMediator(orderID);
                await advanceBlockTime(evidenceDur);

                // vote
                const vote = "1vote";
                const hash = ethers.utils.solidityKeccak256(["string", "address"], [vote, user5.address]);
                await dm.connect(user5).commitVote(orderID, 0, hash);
                const hash2 = ethers.utils.solidityKeccak256(["string", "address"], [vote, user6.address]);
                await dm.connect(user6).commitVote(orderID, 0, hash2);

                // Reveal
                await advanceBlockTime(predictDur / 2);
                await expect(dm.connect(user5).revealVote(orderID, 0, vote, hash)).not.to.be.reverted;
                await expect(dm.connect(user6).revealVote(orderID, 0, vote, hash2)).not.to.be.reverted;
                await advanceBlockTime(predictDur / 2);

                await expect(dm.executeDecision(orderID, 0)).not.to.be.reverted;
                const dispute = await dm.getDispute(orderID, 0);
                expect(dispute.abandoned).to.be.false;
                expect(dispute.executed).to.be.true;

                await expect(dm.undraftMediator(orderID, 0)).not.to.be.reverted;
                await expect(dm.undraftMediator(orderID, 0)).not.to.be.reverted;
                expect(await dm.rewardBalanceOf(user5.address)).to.eq(winReward);
                expect(await dm.rewardBalanceOf(user6.address)).to.eq(winReward);
            });
        });

        context("when ticket owner voted the lose side", () => {
            it("should not award any reward to the ticket", async () => {
                const numMediators = 3;
                await medMgr.updateTicketPool(0, bondAmt, draftReward, winReward, noVoteSlashBP, loseVoteSlashBP, numMediators, 0, 0, false, false);
                await join(user7);
                await advanceBlockTime(ticketMatureDur);

                await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
                await dm.draftMediator(orderID);
                await dm.draftMediator(orderID);
                await dm.draftMediator(orderID);
                await advanceBlockTime(evidenceDur);

                // vote
                const vote = "1vote";
                const hash = ethers.utils.solidityKeccak256(["string", "address"], [vote, user5.address]);
                await dm.connect(user5).commitVote(orderID, 0, hash);
                const hash2 = ethers.utils.solidityKeccak256(["string", "address"], [vote, user6.address]);
                await dm.connect(user6).commitVote(orderID, 0, hash2);
                const vote2 = "0vote";
                const hash3 = ethers.utils.solidityKeccak256(["string", "address"], [vote2, user7.address]);
                await dm.connect(user7).commitVote(orderID, 0, hash3);

                // Reveal
                await advanceBlockTime(predictDur / 2);
                await expect(dm.connect(user5).revealVote(orderID, 0, vote, hash)).not.to.be.reverted;
                await expect(dm.connect(user6).revealVote(orderID, 0, vote, hash2)).not.to.be.reverted;
                await expect(dm.connect(user7).revealVote(orderID, 0, vote2, hash3)).not.to.be.reverted;
                await advanceBlockTime(predictDur / 2);

                await expect(dm.executeDecision(orderID, 0)).not.to.be.reverted;
                const dispute = await dm.getDispute(orderID, 0);
                expect(dispute.abandoned).to.be.false;
                expect(dispute.executed).to.be.true;

                await expect(dm.undraftMediator(orderID, 0)).not.to.be.reverted;
                await expect(dm.undraftMediator(orderID, 0)).not.to.be.reverted;
                await expect(dm.undraftMediator(orderID, 0)).not.to.be.reverted;

                expect(await dm.rewardBalanceOf(user5.address)).to.eq(winReward);
                expect(await dm.rewardBalanceOf(user6.address)).to.eq(winReward);
                expect(await dm.rewardBalanceOf(user7.address)).to.eq(0);
            });
        });

        context("when dispute is not the first of the order", () => {
            it("should half reward", async () => {
                await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
                await dm.draftMediator(orderID);
                await dm.draftMediator(orderID);
                await advanceBlockTime(evidenceDur);

                // vote
                let vote1 = "1vote";
                let hash = ethers.utils.solidityKeccak256(["string", "address"], [vote1, user5.address]);
                let vote2 = "0vote";
                await dm.connect(user5).commitVote(orderID, 0, hash);
                let hash2 = ethers.utils.solidityKeccak256(["string", "address"], [vote2, user6.address]);
                await dm.connect(user6).commitVote(orderID, 0, hash2);

                // Reveal
                await advanceBlockTime(predictDur / 2);
                await expect(dm.connect(user5).revealVote(orderID, 0, vote1, hash)).not.to.be.reverted;
                await expect(dm.connect(user6).revealVote(orderID, 0, vote2, hash2)).not.to.be.reverted;
                await advanceBlockTime(predictDur / 2);

                await expect(dm.executeDecision(orderID, 0)).not.to.be.reverted;
                let dispute = await dm.getDispute(orderID, 0);
                expect(dispute.abandoned).to.be.false;
                expect(dispute.executed).to.be.true;

                await expect(dm.undraftMediator(orderID, 0)).not.to.be.reverted;
                await expect(dm.undraftMediator(orderID, 0)).not.to.be.reverted;

                expect(await dm.rewardBalanceOf(user5.address)).to.eq(draftReward);
                expect(await dm.rewardBalanceOf(user6.address)).to.eq(draftReward);

                // Dispute 2
                await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
                await dm.draftMediator(orderID);
                await dm.draftMediator(orderID);
                await advanceBlockTime(evidenceDur);

                // Vote
                vote1 = "1vote_";
                hash = ethers.utils.solidityKeccak256(["string", "address"], [vote1, user5.address]);
                vote2 = "0vote_";
                await dm.connect(user5).commitVote(orderID, 0, hash);
                hash2 = ethers.utils.solidityKeccak256(["string", "address"], [vote2, user6.address]);
                await dm.connect(user6).commitVote(orderID, 0, hash2);

                // Reveal
                await advanceBlockTime(predictDur / 2);
                await expect(dm.connect(user5).revealVote(orderID, 0, vote1, hash)).not.to.be.reverted;
                await expect(dm.connect(user6).revealVote(orderID, 0, vote2, hash2)).not.to.be.reverted;
                await advanceBlockTime(predictDur / 2);

                await expect(dm.executeDecision(orderID, 1)).not.to.be.reverted;
                dispute = await dm.getDispute(orderID, 1);
                expect(dispute.abandoned).to.be.false;
                expect(dispute.executed).to.be.true;

                const curUser5Reward = await dm.rewardBalanceOf(user5.address);
                const curUser6Reward = await dm.rewardBalanceOf(user6.address);

                await expect(dm.undraftMediator(orderID, 1)).not.to.be.reverted;
                await expect(dm.undraftMediator(orderID, 1)).not.to.be.reverted;

                expect(await dm.rewardBalanceOf(user5.address)).to.eq(curUser5Reward.add(draftReward / 2));
                expect(await dm.rewardBalanceOf(user6.address)).to.eq(curUser6Reward.add(draftReward / 2));
            });
        });
    });

    describe(".withdrawReward", function () {
        let orderID: BigNumber;

        beforeEach(async () => {
            await medMgr.setTicketMarketParams(baseTicketPrice, 86400, 3, 3, 1000, 2, 10000);

            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await core.setDisputeManager(dm.address);
            await medMgr.setDisputeManager(dm.address);
            orderID = await createOrder_BaseOn_QuoteOff(mid);

            await core.connect(swapper).markOrderAsPaid(orderID);
            await join(user5);
            await advanceBlockTime(ticketMatureDur);
        });

        it("should revert if sender reward = 0", async () => {
            await expect(dm.withdrawReward()).to.be.revertedWith("ZERO_BAL");
        });

        it("should revert if mediator contract insufficient balance", async () => {
            await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
            await dm.draftMediator(orderID);

            await advanceBlockTime(evidenceDur + predictDur);
            await expect(dm.executeDecision(orderID, 0)).not.to.be.reverted;
            const dispute = await dm.getDispute(orderID, 0);
            expect(dispute.executed).to.be.true;

            await expect(dm.undraftMediator(orderID, 0)).not.to.be.reverted;
            expect(await dm.rewardBalanceOf(user5.address)).to.eq(draftReward);

            await expect(dm.connect(user5).withdrawReward()).to.be.revertedWith("ERC20: transfer amount exceeds balance");
        });

        it("should successfully withdraw", async () => {
            await expect(dm.connect(swapper).createDispute(orderID, false)).not.to.be.reverted;
            await dm.draftMediator(orderID);

            await advanceBlockTime(evidenceDur + predictDur);
            await expect(dm.executeDecision(orderID, 0)).not.to.be.reverted;
            const dispute = await dm.getDispute(orderID, 0);
            expect(dispute.executed).to.be.true;

            await expect(dm.undraftMediator(orderID, 0)).not.to.be.reverted;
            expect(await dm.rewardBalanceOf(user5.address)).to.eq(draftReward);

            await token.transfer(dm.address, draftReward);
            await expect(dm.connect(user5).withdrawReward()).not.to.be.reverted;
            expect(await token.balanceOf(user5.address)).to.eq(draftReward);
            expect(await dm.rewardBalanceOf(user5.address)).to.eq(0);
        });
    });
});
