import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Buffer} from "buffer";
import {expect} from "chai";
import {BigNumber, BigNumberish} from "ethers";
import {getAddress} from "ethers/lib/utils";
import {ethers} from "hardhat";
import {AssetRegistry, Core, ERC1155T, ERC721T, FeePurse, MarketCore, MediatorManager, MinerRegistry, NFT, Operator, TestMarketManager, TOKEN} from "../../typechain-types";
import {AddressZero, advanceBlockTime, AssetType, makeMarketID, pow10str, toBN, toDec} from "../../utils/utils";
import {initCoreTestSuite} from "../helpers/helpers";

describe("Core - Order", function () {
    let baseAddr: string;
    let quoteAddr: string;
    let core: Core;
    let operator: Operator;
    let mc: MarketCore;
    let nft: NFT;
    let minerReg: MinerRegistry;
    let minerBond: number;
    let minerMatureDur: number;
    let testERC721: ERC721T;
    let testERC1155: ERC1155T;
    let assetReg: AssetRegistry;
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let user5: SignerWithAddress;
    let cAddr: string;
    let orderLifeTime: number;
    let token: TOKEN;
    let baseAsset: TOKEN;
    let quoteAsset: TOKEN;
    let mid: string;
    let tokenDec: BigNumber;
    let baseDec: BigNumber;
    let quoteDec: BigNumber;
    let amountOfBase: BigNumber;
    let pricePerBase: BigNumber;
    let fixedSynthSwapFee: BigNumberish;
    let synthSwapFee: BigNumberish;
    let fixedNFTSwapFee: BigNumberish;
    let feePurse: FeePurse;
    let disputeDelayDur: BigNumber;
    let medMgr: MediatorManager;
    const chainId = 31337;
    let minerCancelReward = 0;

    let marketCreator: SignerWithAddress, provider: SignerWithAddress, swapper: SignerWithAddress, marketCreator2: SignerWithAddress, inventor: SignerWithAddress;

    beforeEach(async () => {
        const vars = await initCoreTestSuite();
        baseAddr = vars.baseAddr;
        quoteAddr = vars.quoteAddr;
        core = vars.core;
        mc = vars.mc;
        nft = vars.nft;
        minerReg = vars.minerReg;
        minerBond = vars.minerBond;
        minerMatureDur = vars.minerMatureDur;
        testERC721 = vars.testERC721;
        testERC1155 = vars.testERC1155;
        disputeDelayDur = vars.defaultDisputeDelayDur;
        assetReg = vars.assetReg;
        deployer = vars.deployer;
        operator = vars.operator;
        user2 = vars.accts[2];
        user5 = vars.accts[5];
        cAddr = vars.cAddr;
        token = vars.token;
        baseAsset = vars.baseAsset;
        quoteAsset = vars.quoteAsset;
        mid = vars.mid;
        tokenDec = vars.tokenDec;
        baseDec = vars.baseDec;
        quoteDec = vars.quoteDec;
        amountOfBase = vars.amountOfBase;
        pricePerBase = vars.pricePerBase;
        fixedSynthSwapFee = vars.fixedSynthSwapFee;
        minerCancelReward = vars.minerCancelReward;
        deployer = vars.deployer;
        marketCreator = vars.marketCreator;
        provider = vars.provider;
        swapper = vars.swapper;
        marketCreator2 = vars.marketCreator2;
        inventor = vars.inventor;
        orderLifeTime = vars.orderLifeTime;
        feePurse = vars.feePurse;
        synthSwapFee = vars.synthSwapFee;
        fixedNFTSwapFee = vars.fixedNFTSwapFee;
        medMgr = vars.mediatorMgr;

        await medMgr.updateTicketPool(0, vars.ticketBondAmt, 10, 10, 100, 100, 1, 0, 0, false, false);
    });

    async function provideLiquidity(provider: SignerWithAddress, liquidityAmt: BigNumber, basePrice: BigNumber, timeToPay = 0) {
        await baseAsset.transfer(provider.address, liquidityAmt);
        await baseAsset.connect(provider).approve(cAddr, liquidityAmt);
        await core.connect(provider).updateFungibleLiquidity({
            marketId: mid,
            target: AddressZero,
            lid: 0,
            amount: liquidityAmt,
            price: basePrice,
            timeToPay: timeToPay,
            expireAt: 0,
            pause: false,
            wantOrIds: [],
            wantAndIds: [],
            deduct: false,
        });
    }

    async function createMarket(creator: SignerWithAddress = deployer, base: string, quote: string, baseType: number, quoteType: number, permPut: boolean, permSwap: boolean, commission: BigNumberish, mediatorPoolId: BigNumberish) {
        const mid = makeMarketID(creator.address, base, quote, baseType, quoteType);
        await mc.connect(creator).createMarket(base, quote, baseType, quoteType, permPut, permSwap, commission, mediatorPoolId);
        return Promise.resolve(mid);
    }

    function createOrder_BaseOn_QuoteOff(mid: string, amount = 5, price = pricePerBase, lid = 0, ids: BigNumberish[] = []) {
        return new Promise<BigNumber>(async (resolve, reject) => {
            try {
                await provideLiquidity(provider, amountOfBase, price);
                const swapAmt = toBN(amount).mul(baseDec);
                let mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(amountOfBase);
                const tx = await core.connect(swapper).swapQuoteForBase({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: lid,
                    amount: swapAmt,
                    maxPrice: price,
                    ids: ids,
                    expireAt: 0,
                    operator: 0,
                    marketMgrData: Buffer.from([]),
                });

                const res = await tx.wait();
                mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eq(amountOfBase.sub(swapAmt));
                return resolve(res.events?.at(0)?.args?.numTypeInfo[0]);
            } catch (e) {
                reject(e);
            }
        });
    }

    describe(".markOrderAsPaid", () => {
        const marketCom = 0.1 * 100; // convert to basis point
        let orderID: number;

        beforeEach(() => {
            mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);
        });

        context("base asset = ERC20 while quote = SYNTH", () => {
            beforeEach(async () => {
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 1, 0, false, false, marketCom, 0);
                await provideLiquidity(provider, amountOfBase, pricePerBase);

                // Swap amount = 5 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(5).mul(baseDec);

                // create swap order.
                await expect(
                    core.connect(swapper).swapQuoteForBase({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: swapAmt,
                        maxPrice: pricePerBase,
                        ids: [],
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    }),
                ).not.to.be.reverted;
                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);
                orderID = numOrders.toNumber() - 1;

                const mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(amountOfBase.sub(swapAmt));
            });

            it("should revert with msg='UNKNOWN_ORDER' when order is unknown", async () => {
                await expect(core.markOrderAsPaid(123)).to.be.revertedWith("UNKNOWN_ORDER");
            });

            it("should revert with msg='NOT_PAYER' when sender is not the expected off-chain asset payer", async () => {
                await expect(core.connect(marketCreator2).markOrderAsPaid(orderID)).to.be.revertedWith("NOT_PAYER");
            });

            it("should emit 'SwapOrderPaid' and update state correctly on success", async () => {
                await expect(core.connect(swapper).markOrderAsPaid(orderID)).to.emit(core, "SwapOrderPaid").withArgs(orderID, swapper.address, disputeDelayDur);
                const order = await core.getOrder(orderID);
                expect(order.paid).to.be.true;
            });

            it("should revert with 'NOT_ACTIVE' when order has already been marked as paid", async () => {
                await expect(core.connect(swapper).markOrderAsPaid(orderID)).not.to.be.reverted;
                await expect(core.connect(swapper).markOrderAsPaid(orderID)).to.be.revertedWith("NOT_ACTIVE");
            });
        });

        context("base asset = SYNTH while quote = ERC20", () => {
            beforeEach(async () => {
                baseAddr = ethers.Wallet.createRandom().address;
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 0, 1, false, false, marketCom, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 0, 1);

                await provideLiquidity(provider, amountOfBase, pricePerBase);

                // Swap amount = 5 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(5).mul(baseDec);
                const swapCost = swapAmt.div(baseDec).mul(pricePerBase); // amount the swapper will pay in QUOTE (=50 QUOTE)

                // Approve swap cost so the contract can lock it
                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                // create swap order.
                await expect(
                    core.connect(swapper).swapQuoteForBase({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: swapAmt,
                        maxPrice: pricePerBase,
                        ids: [],
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    }),
                ).not.to.be.reverted;
                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);
                orderID = numOrders.toNumber() - 1;
            });

            it("should emit 'SwapOrderPaid' and update state correctly on success", async () => {
                await expect(core.connect(provider).markOrderAsPaid(orderID)).to.emit(core, "SwapOrderPaid").withArgs(orderID, provider.address, disputeDelayDur);
                const order = await core.getOrder(orderID);
                expect(order.paid).to.be.true;
            });
        });

        context("base asset = SYNTH while quote = SYNTH", () => {
            beforeEach(async () => {
                mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.SYNTH, false, false, 0, 0);
                await core.setProtoFee(0, 0, 0, 0, 0, 0);
                await provideLiquidity(provider, amountOfBase, pricePerBase);
                const swapAmt = toBN(5).mul(baseDec);
                await expect(
                    core.connect(swapper).swapQuoteForBase({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: swapAmt,
                        maxPrice: pricePerBase,
                        ids: [],
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    }),
                ).not.to.be.reverted;
                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);
                orderID = numOrders.toNumber() - 1;
            });

            it("should emit 'SwapOrderPaid' and update state correctly on success", async () => {
                await expect(core.connect(swapper).markOrderAsPaid(orderID)).to.emit(core, "SwapOrderPaid").withArgs(orderID, swapper.address, disputeDelayDur);
                const order = await core.getOrder(orderID);
                expect(order.paid).to.be.true;
            });
        });

        context("base asset = SYNTH while quote = NFT", () => {
            beforeEach(async () => {
                const wantIds = [1];
                mid = await createMarket(undefined, baseAddr, testERC721.address, AssetType.SYNTH, AssetType.ERC721, false, false, marketCom, 0);
                await core.setProtoFee(0, 0, 0, 0, 0, 0);

                const ids = [1];
                await testERC721.connect(swapper).mint();
                await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                await expect(
                    core.connect(provider).updateFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        amount: 1,
                        price: 0,
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        wantOrIds: wantIds,
                        wantAndIds: [],
                        deduct: false,
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(swapper).swapQuoteForBase({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        maxPrice: 0,
                        ids: ids,
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    }),
                ).not.to.be.reverted;

                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);
                orderID = numOrders.toNumber() - 1;
            });

            it("should emit 'SwapOrderPaid' and update state correctly on success", async () => {
                await expect(core.connect(provider).markOrderAsPaid(orderID)).to.emit(core, "SwapOrderPaid").withArgs(orderID, provider.address, disputeDelayDur);
                const order = await core.getOrder(orderID);
                expect(order.paid).to.be.true;
            });
        });

        context("base asset = NFT while quote = SYNTH", () => {
            beforeEach(async () => {
                mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, 0, 0);
                await core.setProtoFee(0, 0, 0, 0, 0, 0);

                const ids = [1];
                await testERC721.connect(provider).mint();
                await testERC721.connect(provider).setApprovalForAll(core.address, true);

                await expect(
                    core.connect(provider).updateNonFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        price: 10,
                        timeToPay: 0,
                        expireAt: 0,
                        ids: ids,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                        pause: false,
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(swapper).swapQuoteForBase({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        maxPrice: 10,
                        ids: [],
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    }),
                ).not.to.be.reverted;

                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);
                orderID = numOrders.toNumber() - 1;
            });

            it("should emit 'SwapOrderPaid' and update state correctly on success", async () => {
                await expect(core.connect(swapper).markOrderAsPaid(orderID)).to.emit(core, "SwapOrderPaid");
                const order = await core.getOrder(orderID);
                expect(order.paid).to.be.true;
            });
        });

        context("order is cancelled or released", () => {
            beforeEach(async () => {
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);
            });

            it("should revert with reason=NOT_ACTIVE", async () => {
                let orderID = await createOrder_BaseOn_QuoteOff(mid);
                await advanceBlockTime(orderLifeTime);
                await expect(core.connect(swapper).cancelOrder(orderID)).not.to.reverted;
                await expect(core.connect(provider).markOrderAsPaid(orderID)).to.be.revertedWith("NOT_ACTIVE");
            });

            it("should revert with reason=NOT_ACTIVE", async () => {
                let orderID = await createOrder_BaseOn_QuoteOff(mid);
                await core.connect(swapper).markOrderAsPaid(orderID);
                await core.connect(provider).releaseOrder(orderID);
                await expect(core.connect(provider).markOrderAsPaid(orderID)).to.be.revertedWith("NOT_ACTIVE");
            });
        });

        context("when market set a dispute delay time", () => {
            const disputeDelayDur = 1000;
            beforeEach(async () => {
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 1, 0, false, false, marketCom, 0);
                await mc.connect(marketCreator2).setDisputeDelayDuration(mid, disputeDelayDur);
                await provideLiquidity(provider, amountOfBase, pricePerBase);
                const swapAmt = toBN(5).mul(baseDec);
                await expect(
                    core.connect(swapper).swapQuoteForBase({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: swapAmt,
                        maxPrice: pricePerBase,
                        ids: [],
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    }),
                ).not.to.be.reverted;
                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);
                orderID = numOrders.toNumber() - 1;
            });

            it("should emit 'SwapOrderPaid' and emit correct dispute delay time", async () => {
                const timestamp = await advanceBlockTime(3600);
                await expect(core.connect(swapper).markOrderAsPaid(orderID)).to.emit(core, "SwapOrderPaid");
                const order = await core.getOrder(orderID);
                expect(order.paid).to.be.true;
                expect(order.disputeFrom).to.eq(timestamp + disputeDelayDur + 1);
            });
        });

        context("market has a manager", () => {
            it("should mark order as paid", async () => {
                await mc.connect(marketCreator2).createMarketWithManager(baseAddr, quoteAddr, 1, 0, false, false, 0, 0, user5.address);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);
                let orderID = await createOrder_BaseOn_QuoteOff(mid);
                await expect(core.connect(user5).markOrderAsPaid(orderID)).not.to.be.reverted;
                const order = await core.getOrder(orderID);
                expect(order.paid).to.be.true;
            });
        });
    });

    describe(".releaseOrder", () => {
        let marketCom: BigNumberish = 0.1 * 100; // convert to 10 basis point
        let orderID: number;
        let swapAmt: BigNumber;
        let swapCost: BigNumber;
        let protoFee: BigNumber;
        let mktFee: BigNumber;

        context("base = ERC20 while quote = SYNTH", () => {
            beforeEach(async () => {
                marketCom = 0.1 * 100;
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, marketCom, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);
            });

            context("check release", () => {
                beforeEach(async () => {
                    await provideLiquidity(provider, amountOfBase, pricePerBase);

                    // Swap amount = 5 BASE (amount of BASE the swapper wants)
                    swapAmt = toBN(5).mul(baseDec);

                    // create swap order.
                    await expect(
                        core.connect(swapper).swapQuoteForBase({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 0,
                            marketMgrData: Buffer.from([]),
                        }),
                    ).not.to.be.reverted;
                    const numOrders = (await core.state()).numOrders;
                    expect(numOrders.toNumber()).to.eql(1);
                    orderID = numOrders.toNumber() - 1;

                    // Provider's liquidity  must reduce correctly
                    let liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.amount.eq(amountOfBase.sub(swapAmt))).to.be.true;

                    // Expect openOrders to be 1
                    expect(liq.openOrders.eq(1)).to.be.true;

                    const mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eql(amountOfBase.sub(swapAmt));
                });

                it("should revert with msg='UNKNOWN_ORDER' when order is unknown", async () => {
                    await expect(core.releaseOrder(123)).to.be.revertedWith("OC: UNKNOWN_ORDER");
                });

                it("should revert with msg=`ALREADY_FINALIZED` when order was released", async () => {
                    await advanceBlockTime(orderLifeTime);
                    await expect(core.connect(swapper).markOrderAsPaid(orderID)).not.to.be.reverted;
                    await expect(core.connect(provider).releaseOrder(orderID)).not.to.be.reverted;
                    await expect(core.connect(provider).releaseOrder(orderID)).to.be.revertedWith("OC: ALREADY_FINALIZED");
                });

                it("should revert with msg=`ALREADY_FINALIZED` when order was cancelled", async () => {
                    await advanceBlockTime(orderLifeTime);
                    await expect(core.connect(swapper).cancelOrder(orderID)).not.to.be.reverted;
                    await expect(core.connect(provider).releaseOrder(orderID)).to.be.revertedWith("OC: ALREADY_FINALIZED");
                });

                it("should revert with msg='NOT_RELEASER' when sender is not the expected on-chain asset owner", async () => {
                    await expect(core.connect(marketCreator2).releaseOrder(orderID)).to.be.revertedWith("NOT_RELEASER");
                });

                it("should revert with msg='ORDER_UNPAID' when order has not been marked as paid", async () => {
                    await expect(core.connect(provider).releaseOrder(orderID)).to.be.revertedWith("ORDER_UNPAID");
                });

                it("should emit 'Swap' on success", async () => {
                    await expect(core.connect(swapper).markOrderAsPaid(orderID)).not.to.be.reverted;
                    const protocolFee = swapAmt.mul((await core.state()).ints.synthSwapFeeBp).div(10000);
                    const marketCreatorFee = swapAmt.mul(marketCom).div(10000);
                    const totalFees = protocolFee.add(marketCreatorFee);
                    await expect(core.connect(provider).releaseOrder(orderID)).to.emit(core, "Swap").withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, provider.address, [1, 0, swapAmt, pricePerBase, 0, 0], false, [], []);

                    // Protocol fee should be correct
                    expect((await core.inventorBalanceOf(baseAddr)).eq(protocolFee)).to.be.true;

                    // Market creator should be correct
                    expect((await core.feeBalanceOf(marketCreator2.address, baseAddr)).eq(marketCreatorFee)).to.be.true;

                    // swapper base asset balance should be expected
                    expect((await baseAsset.balanceOf(swapper.address)).eq(swapAmt.sub(totalFees))).to.be.true;

                    // contract base asset balance should be expected
                    let liq = await core.getLiquidity(mid, provider.address, 0);
                    expect((await baseAsset.balanceOf(cAddr)).eq(liq.amount.add(totalFees))).to.be.true;

                    // Order must be marked as released
                    const order = await core.getOrder(0);
                    expect(order.released).to.be.true;
                    expect(order.finalizer).to.eql(provider.address);

                    // Expect openOrders to be 0
                    expect(liq.openOrders.eq(0)).to.be.true;
                });
            });

            context("operator fee is set", () => {
                it("should calculate correct operator fee balance when swap include operator ID", async () => {
                    await operator.setBond(0);
                    await operator.connect(user5).register();
                    await core.setProtoFeeSplit(5000, 0, 5000);

                    await provideLiquidity(provider, amountOfBase, pricePerBase);

                    swapAmt = toBN(5).mul(baseDec);
                    await expect(
                        core.connect(swapper).swapQuoteForBase({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 1,
                            marketMgrData: Buffer.from([]),
                        }),
                    ).not.to.be.reverted;
                    const numOrders = (await core.state()).numOrders;
                    expect(numOrders.toNumber()).to.eql(1);
                    orderID = numOrders.toNumber() - 1;

                    await expect(core.connect(swapper).markOrderAsPaid(orderID)).not.to.be.reverted;
                    const protocolFee = swapAmt.mul((await core.state()).ints.synthSwapFeeBp).div(10000);
                    const marketCreatorFee = swapAmt.mul(marketCom).div(10000);
                    const totalFees = protocolFee.add(marketCreatorFee);
                    await expect(core.connect(provider).releaseOrder(orderID)).to.emit(core, "Swap");

                    expect((await core.inventorBalanceOf(baseAddr)).eq(protocolFee.div(2))).to.be.true;
                    expect((await core.feeBalanceOf(marketCreator2.address, baseAddr)).eq(marketCreatorFee)).to.be.true;
                    expect((await core.operatorBalanceOf(user5.address, baseAddr)).eq(protocolFee.div(2))).to.be.true;
                    expect((await baseAsset.balanceOf(swapper.address)).eq(swapAmt.sub(totalFees))).to.be.true;

                    // Order must be marked as released
                    const order = await core.getOrder(0);
                    expect(order.released).to.be.true;
                });

                it("should award all protocol fee to inventor when swap does not include operator ID", async () => {
                    await core.setProtoFeeSplit(5000, 0, 5000);

                    await provideLiquidity(provider, amountOfBase, pricePerBase);

                    swapAmt = toBN(5).mul(baseDec);
                    await expect(
                        core.connect(swapper).swapQuoteForBase({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 0,
                            marketMgrData: Buffer.from([]),
                        }),
                    ).not.to.be.reverted;
                    const numOrders = (await core.state()).numOrders;
                    expect(numOrders.toNumber()).to.eql(1);
                    orderID = numOrders.toNumber() - 1;

                    await expect(core.connect(swapper).markOrderAsPaid(orderID)).not.to.be.reverted;
                    const protocolFee = swapAmt.mul((await core.state()).ints.synthSwapFeeBp).div(10000);
                    const marketCreatorFee = swapAmt.mul(marketCom).div(10000);
                    const totalFees = protocolFee.add(marketCreatorFee);
                    await expect(core.connect(provider).releaseOrder(orderID)).to.emit(core, "Swap");

                    expect((await core.inventorBalanceOf(baseAddr)).eq(protocolFee)).to.be.true;
                    expect((await core.feeBalanceOf(marketCreator2.address, baseAddr)).eq(marketCreatorFee)).to.be.true;
                    expect((await baseAsset.balanceOf(swapper.address)).eq(swapAmt.sub(totalFees))).to.be.true;

                    // Order must be marked as released
                    const order = await core.getOrder(0);
                    expect(order.released).to.be.true;
                });
            });

            context("swapper provided a recipient", () => {
                it("should swap to recipient", async () => {
                    await core.setProtoFee(0, 0, 0, 0, 0, 0);
                    await mc.connect(marketCreator2).setCommission(mid, 0);

                    // provide liquidity
                    await provideLiquidity(provider, amountOfBase, pricePerBase);

                    // create swap order.
                    swapAmt = toBN(5).mul(baseDec);
                    await expect(
                        core.connect(swapper).swapQuoteForBase({
                            marketId: mid,
                            provider: provider.address,
                            recipient: user5.address,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 0,
                            marketMgrData: Buffer.from([]),
                        }),
                    ).not.to.be.reverted;
                    const numOrders = (await core.state()).numOrders;
                    expect(numOrders.toNumber()).to.eql(1);
                    orderID = numOrders.toNumber() - 1;

                    // release order
                    await expect(core.connect(swapper).markOrderAsPaid(orderID)).not.to.be.reverted;
                    await expect(core.connect(provider).releaseOrder(orderID)).to.emit(core, "Swap");

                    expect(await baseAsset.balanceOf(user5.address)).to.eql(swapAmt);
                });
            });
        });

        context("base = SYNTH while quote = ERC20", () => {
            context("quote asset is sharable", () => {
                beforeEach(async () => {
                    await assetReg.setSharable(quoteAddr, true);
                });

                it("should compute correct fee", async () => {
                    mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.ERC20, false, false, marketCom, 0);
                    await provideLiquidity(provider, amountOfBase, pricePerBase);

                    let mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eql(amountOfBase);

                    // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                    swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                    // Approve swap cost so the contract can lock it
                    await quoteAsset.transfer(swapper.address, swapCost);
                    await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                    // create swap order.
                    await expect(
                        core.connect(swapper).swapQuoteForBase({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 0,
                            marketMgrData: Buffer.from([]),
                        }),
                    ).not.to.be.reverted;
                    const numOrders = (await core.state()).numOrders;
                    expect(numOrders.toNumber()).to.eql(1);
                    orderID = numOrders.toNumber() - 1;

                    await expect(core.connect(provider).markOrderAsPaid(orderID)).not.to.be.reverted;

                    await expect(core.connect(swapper).releaseOrder(orderID)).to.emit(core, "Swap").withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, swapper.address, [1, 0, swapAmt, pricePerBase, 0, 0], false, [], []);

                    // Calculate fee
                    const protoFee = toDec(swapCost).mul(toDec(synthSwapFee).div(100).div(100));
                    const mktCreatorFee = toDec(swapCost).mul(toDec(marketCom).div(100).div(100));
                    const totalFees = toBN(protoFee.add(mktCreatorFee));

                    // Protocol fee should be correctly split
                    const inventorSplitBp = toDec((await core.getFeeBPs())[0]);
                    const invBal = toDec(protoFee).mul(inventorSplitBp.div(100).div(100));
                    const sharingSplitBP = toDec((await core.getFeeBPs())[1]);
                    const sharableBal = toDec(protoFee).mul(sharingSplitBP.div(100).div(100));
                    expect(await core.inventorBalanceOf(quoteAddr)).to.eql(toBN(invBal));
                    expect(await core.shareablesBalanceOf(quoteAddr)).to.eql(toBN(sharableBal));

                    // Market creator should be correct
                    expect(await core.feeBalanceOf(deployer.address, quoteAddr)).to.eql(toBN(mktCreatorFee));

                    // provider quote asset balance should be expected
                    expect((await quoteAsset.balanceOf(provider.address)).eq(swapCost.sub(totalFees))).to.be.true;

                    // swapper quote asset balance should be expected
                    expect((await quoteAsset.balanceOf(swapper.address)).eq(toBN("0"))).to.be.true;

                    // contract quote asset balance should be expected
                    expect((await quoteAsset.balanceOf(cAddr)).eq(totalFees)).to.be.true;

                    mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eql(amountOfBase.sub(swapAmt));
                });
            });

            context("operator fee is set", () => {
                it("should calculate correct operator fee balance when swap include operator ID", async () => {
                    await operator.setBond(0);
                    await operator.connect(user5).register();
                    await core.setProtoFeeSplit(5000, 2500, 2500);
                    await assetReg.setSharable(quoteAddr, true);

                    mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.ERC20, false, false, marketCom, 0);
                    await provideLiquidity(provider, amountOfBase, pricePerBase);

                    let mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eql(amountOfBase);

                    // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                    swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                    // Approve swap cost so the contract can lock it
                    await quoteAsset.transfer(swapper.address, swapCost);
                    await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                    // create swap order.
                    await expect(
                        core.connect(swapper).swapQuoteForBase({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 1,
                            marketMgrData: Buffer.from([]),
                        }),
                    ).not.to.be.reverted;
                    const numOrders = (await core.state()).numOrders;
                    expect(numOrders.toNumber()).to.eql(1);
                    orderID = numOrders.toNumber() - 1;

                    await expect(core.connect(provider).markOrderAsPaid(orderID)).not.to.be.reverted;
                    await expect(core.connect(swapper).releaseOrder(orderID)).to.emit(core, "Swap");

                    // Calculate fee
                    const protoFee = toDec(swapCost).mul(toDec(synthSwapFee).div(100).div(100));

                    // Protocol fee should be correctly split
                    const inventorSplitBp = toDec((await core.getFeeBPs())[0]);
                    const invBal = toDec(protoFee).mul(inventorSplitBp.div(100).div(100));
                    const sharingSplitBP = toDec((await core.getFeeBPs())[1]);
                    const sharableBal = toDec(protoFee).mul(sharingSplitBP.div(100).div(100));
                    const operatorSplitBP = toDec((await core.getFeeBPs())[2]);
                    const operatorBal = toDec(protoFee).mul(operatorSplitBP.div(100).div(100));
                    expect(await core.inventorBalanceOf(quoteAddr)).to.eql(toBN(invBal));
                    expect(await core.shareablesBalanceOf(quoteAddr)).to.eql(toBN(sharableBal));
                    expect(await core.operatorBalanceOf(user5.address, quoteAddr)).to.eql(toBN(operatorBal));

                    // Withdraw the reward
                    await expect(core.connect(user5).withdrawOperatorBalance(quoteAddr)).not.to.be.reverted;
                    expect(await quoteAsset.balanceOf(user5.address)).to.eql(toBN(operatorBal));
                    expect(await core.operatorBalanceOf(user5.address, quoteAddr)).to.eq(0);
                });
            });
        });

        context("base = SYNTH while quote = NATIVE", () => {
            it("should successfully release", async () => {
                mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.NATIVE, false, false, marketCom, 0);
                await provideLiquidity(provider, amountOfBase, pricePerBase);

                // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                // create swap order.
                await expect(
                    core.connect(swapper).swapQuoteForBase(
                        {
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 0,
                            marketMgrData: Buffer.from([]),
                        },
                        {
                            value: swapCost,
                        },
                    ),
                ).not.to.be.reverted;
                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);
                orderID = numOrders.toNumber() - 1;

                await expect(core.connect(provider).markOrderAsPaid(orderID)).not.to.be.reverted;

                const prevProviderBal = await provider.getBalance();
                const prevSwapperBal = await swapper.getBalance();

                const tx = await core.connect(swapper).releaseOrder(orderID);
                await expect(tx).to.emit(core, "Swap").withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, swapper.address, [1, 0, swapAmt, pricePerBase, 0, 0], false, [], []);

                // calculate gas fee in eth
                const txReceipt = await tx.wait();
                const gasUsed = txReceipt.gasUsed.mul(tx.gasPrice as BigNumber);

                // Calculate fee
                const protoFee = toDec(swapCost).mul(toDec(synthSwapFee)).div(100).div(100);
                const mktCreatorFee = toDec(swapCost).mul(toDec(marketCom).div(100)).div(100);
                const totalFees = toBN(protoFee.add(mktCreatorFee));

                // Protocol fee should be correct
                expect((await core.inventorBalanceOf(quoteAddr)).eq(toBN(protoFee))).to.be.true;

                // Market creator should be correct
                expect(await core.feeBalanceOf(deployer.address, quoteAddr)).to.eql(toBN(mktCreatorFee));

                // provider quote asset balance should be expected
                expect(await core.provider.getBalance(provider.address)).to.eql(prevProviderBal.add(swapCost).sub(totalFees));

                // swapper quote asset balance should be expected
                expect(await core.provider.getBalance(swapper.address)).to.eql(prevSwapperBal.sub(gasUsed));

                // contract quote asset balance should be expected
                expect(await core.provider.getBalance(cAddr)).to.eql(totalFees);

                const mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(amountOfBase.sub(swapAmt));
            });

            it("should return excess quote deposit during order creation", async () => {
                mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.NATIVE, false, false, marketCom, 0);
                await provideLiquidity(provider, amountOfBase, pricePerBase);

                // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                const excess = toBN(100).mul(quoteDec);
                const swapperBalBefore = await swapper.getBalance();

                // create swap order.
                const tx = await core.connect(swapper).swapQuoteForBase(
                    {
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: swapAmt,
                        maxPrice: pricePerBase,
                        ids: [],
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    },
                    {value: swapCost.add(excess)},
                );
                await expect(tx.wait()).not.to.be.reverted;
                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);

                // get gas used
                const txReceipt = await tx.wait();
                const gasUsed = txReceipt.gasUsed.mul(tx.gasPrice as BigNumber);

                const swapperBalAfter = await swapper.getBalance();
                expect(swapperBalBefore.sub(swapCost).sub(gasUsed)).to.eq(swapperBalAfter);
            });
        });

        context("base = NATIVE while quote = SYNTH", () => {
            it("should successfully release", async () => {
                mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.SYNTH, false, false, marketCom, 0);
                await expect(
                    core.connect(provider).updateFungibleLiquidity(
                        {
                            marketId: mid,
                            target: AddressZero,
                            lid: 0,
                            amount: amountOfBase,
                            price: pricePerBase,
                            timeToPay: 0,
                            expireAt: 0,
                            pause: false,
                            wantOrIds: [],
                            wantAndIds: [],
                            deduct: false,
                        },
                        {value: amountOfBase},
                    ),
                ).not.to.be.reverted;

                // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                // create swap order.
                await expect(
                    core.connect(swapper).swapQuoteForBase({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: swapAmt,
                        maxPrice: pricePerBase,
                        ids: [],
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    }),
                ).not.to.be.reverted;
                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);
                orderID = numOrders.toNumber() - 1;

                await expect(core.connect(swapper).markOrderAsPaid(orderID)).not.to.be.reverted;

                const prevProviderBal = await provider.getBalance();
                const prevSwapperBal = await swapper.getBalance();

                const tx = await core.connect(provider).releaseOrder(orderID);
                await expect(tx).to.emit(core, "Swap").withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, provider.address, [1, 0, swapAmt, pricePerBase, 0, 0], false, [], []);

                // Calculate fee
                const protoFee = toDec(swapAmt).mul(toDec(synthSwapFee)).div(100).div(100);
                const mktCreatorFee = toDec(swapAmt).mul(toDec(marketCom).div(100)).div(100);
                const totalFees = toBN(protoFee.add(mktCreatorFee));

                // Protocol fee should be correct
                expect((await core.inventorBalanceOf(baseAddr)).eq(toBN(protoFee))).to.be.true;

                // Market creator should be correct
                expect(await core.feeBalanceOf(deployer.address, baseAddr)).to.eql(toBN(mktCreatorFee));

                // swapper base asset balance should be expected
                expect(await core.provider.getBalance(swapper.address)).to.eql(prevSwapperBal.add(swapAmt).sub(totalFees));

                // amount of liquidity left
                const liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.amount).to.eql(amountOfBase.sub(swapAmt));

                // contract quote asset balance should be expected
                expect(await core.provider.getBalance(cAddr)).to.eql(liq.amount.add(totalFees));

                const mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(amountOfBase.sub(swapAmt));
            });
        });

        context("base asset = SYNTH while quote = SYNTH", () => {
            it("should emit 'Swap' with expected arguments on success", async () => {
                marketCom = "100000000000000000"; // 0.1

                await core.setProtoFee(0, synthSwapFee, 0, fixedSynthSwapFee, 0, 0);
                mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.SYNTH, false, false, marketCom, 0);

                protoFee = toBN(fixedSynthSwapFee).mul(amountOfBase).div(pow10str(18));
                mktFee = toBN(marketCom).mul(amountOfBase).div(pow10str(18));

                await token.transfer(provider.address, protoFee.add(mktFee));
                await token.connect(provider).approve(feePurse.address, protoFee.add(mktFee));
                await feePurse.connect(provider).deposit(protoFee.add(mktFee));

                await provideLiquidity(provider, amountOfBase, pricePerBase);

                // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                // create swap order.
                await expect(
                    core.connect(swapper).swapQuoteForBase({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: swapAmt,
                        maxPrice: pricePerBase,
                        ids: [],
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    }),
                ).not.to.be.reverted;
                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);
                orderID = numOrders.toNumber() - 1;

                // Provider's liquidity must reduce correctly
                let liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.amount.eq(amountOfBase.sub(swapAmt))).to.be.true;

                const mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(amountOfBase.sub(swapAmt));

                await expect(core.connect(swapper).markOrderAsPaid(orderID)).not.to.be.reverted;

                const protoFeeRate = toDec(protoFee).div(toDec(amountOfBase));
                const protoOrderFee = protoFeeRate.mul(pow10str(18)).mul(toDec(swapAmt)).div(pow10str(18));
                const mktCreatorFeeRate = toDec(mktFee).div(toDec(amountOfBase));
                const mktCreatorOrderFee = mktCreatorFeeRate.mul(pow10str(18)).mul(toDec(swapAmt)).div(pow10str(18));

                await expect(core.connect(provider).releaseOrder(orderID)).to.emit(core, "Swap").withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, provider.address, [1, 0, swapAmt, pricePerBase, 0, 0], false, [], []);

                // All protocol fee should go to inventor
                expect(await feePurse.balanceOf(inventor.address)).to.eql(toBN(protoOrderFee));
                expect(await feePurse.balanceOf(core.address)).to.eq(0);

                // Fee purse should be updated for both protocol and market creator
                liq = await core.getLiquidity(mid, provider.address, 0);
                expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eql(protoFee.sub(toBN(protoOrderFee)));
                expect(await feePurse.getLocked(liq.mktCreatorFeePurseId)).to.eql(mktFee.sub(toBN(mktCreatorOrderFee)));

                // Order must be marked as released
                const order = await core.getOrder(0);
                expect(order.released).to.be.true;
            });

            context("operator fee is set", () => {
                it("should calculate correct operator fee balance when swap include operator ID", async () => {
                    await operator.setBond(0);
                    await operator.connect(user5).register();
                    await core.setProtoFeeSplit(5000, 0, 5000);

                    marketCom = "100000000000000000"; // 0.1
                    await core.setProtoFee(0, synthSwapFee, 0, fixedSynthSwapFee, 0, 0);
                    mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.SYNTH, false, false, marketCom, 0);

                    protoFee = toBN(fixedSynthSwapFee).mul(amountOfBase).div(pow10str(18));
                    mktFee = toBN(marketCom).mul(amountOfBase).div(pow10str(18));

                    await token.transfer(provider.address, protoFee.add(mktFee));
                    await token.connect(provider).approve(feePurse.address, protoFee.add(mktFee));
                    await feePurse.connect(provider).deposit(protoFee.add(mktFee));

                    await provideLiquidity(provider, amountOfBase, pricePerBase);

                    swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)
                    await expect(
                        core.connect(swapper).swapQuoteForBase({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 1,
                            marketMgrData: Buffer.from([]),
                        }),
                    ).not.to.be.reverted;
                    const numOrders = (await core.state()).numOrders;
                    expect(numOrders.toNumber()).to.eql(1);
                    orderID = numOrders.toNumber() - 1;

                    // Provider's liquidity must reduce correctly
                    let liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.amount.eq(amountOfBase.sub(swapAmt))).to.be.true;

                    await expect(core.connect(swapper).markOrderAsPaid(orderID)).not.to.be.reverted;

                    const protoFeeRate = toDec(protoFee).div(toDec(amountOfBase));
                    const protoOrderFee = protoFeeRate.mul(pow10str(18)).mul(toDec(swapAmt)).div(pow10str(18));
                    const mktCreatorFeeRate = toDec(mktFee).div(toDec(amountOfBase));
                    const mktCreatorOrderFee = mktCreatorFeeRate.mul(pow10str(18)).mul(toDec(swapAmt)).div(pow10str(18));

                    await expect(core.connect(provider).releaseOrder(orderID)).to.emit(core, "Swap");

                    // All protocol fee should go to inventor
                    expect(await feePurse.balanceOf(inventor.address)).to.eql(toBN(protoOrderFee).div(2));
                    expect(await feePurse.balanceOf(deployer.address)).to.eql(toBN(mktCreatorOrderFee));
                    expect(await feePurse.balanceOf(core.address)).to.eq(0);
                    expect(await feePurse.balanceOf(user5.address)).to.eq(toBN(protoOrderFee).div(2));
                });
            });
        });

        context("base asset = SYNTH while quote = NFT (ERC721)", () => {
            let ids: BigNumber[];
            it("should emit 'Swap' with expected arguments on success", async () => {
                marketCom = "100000000000000000"; // 0.1

                await core.setProtoFee(0, synthSwapFee, 0, fixedSynthSwapFee, 0, 0);
                mid = await createMarket(undefined, baseAddr, testERC721.address, AssetType.SYNTH, AssetType.ERC721, false, false, marketCom, 0);

                protoFee = toBN(fixedSynthSwapFee).mul(amountOfBase).div(pow10str(18));
                mktFee = toBN(marketCom).mul(amountOfBase).div(pow10str(18));
                await token.transfer(provider.address, protoFee.add(mktFee));
                await token.connect(provider).approve(feePurse.address, protoFee.add(mktFee));
                await feePurse.connect(provider).deposit(protoFee.add(mktFee));

                ids = [toBN(1)];
                await testERC721.connect(swapper).mint();
                await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                const wantOrIds = [1];
                await expect(
                    core.connect(provider).updateFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        amount: amountOfBase,
                        price: 0,
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        wantOrIds: wantOrIds,
                        wantAndIds: [],
                        deduct: false,
                    }),
                ).not.to.be.reverted;

                // create swap order.
                await expect(
                    core.connect(swapper).swapQuoteForBase({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        maxPrice: 0,
                        ids: ids,
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    }),
                ).not.to.be.reverted;
                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);
                orderID = numOrders.toNumber() - 1;
                let order = await core.getOrder(orderID);
                expect(order.takerIds).to.eql(ids);

                const mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eq(0);

                await expect(core.connect(provider).markOrderAsPaid(orderID)).not.to.be.reverted;

                const protoFeeRate = toDec(protoFee).div(toDec(amountOfBase));
                const protoOrderFee = protoFeeRate.mul(pow10str(18)).mul(toDec(amountOfBase)).div(pow10str(18));
                const mktCreatorFeeRate = toDec(mktFee).div(toDec(amountOfBase));
                const mktCreatorOrderFee = mktCreatorFeeRate.mul(pow10str(18)).mul(toDec(amountOfBase)).div(pow10str(18));

                await expect(core.connect(swapper).releaseOrder(orderID)).to.emit(core, "Swap").withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, swapper.address, [1, 0, amountOfBase, 0, 0, 0], false, [], ids);

                // All protocol fee should go to inventor
                expect(await feePurse.balanceOf(inventor.address)).to.eql(toBN(protoOrderFee));
                expect(await feePurse.balanceOf(core.address)).to.eq(0);

                // Fee purse should be updated for both protocol and market creator
                let liq = await core.getLiquidity(mid, provider.address, 0);
                expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eql(protoFee.sub(toBN(protoOrderFee)));
                expect(await feePurse.getLocked(liq.mktCreatorFeePurseId)).to.eql(mktFee.sub(toBN(mktCreatorOrderFee)));

                // Order must be marked as released
                order = await core.getOrder(0);
                expect(order.released).to.be.true;

                // Provider should now own the NFT
                expect(await testERC721.ownerOf(1)).to.be.eql(provider.address);
            });

            context("operator fee is set", () => {
                it("should calculate correct operator fee balance when swap include operator ID", async () => {
                    await operator.setBond(0);
                    await operator.connect(user5).register();
                    await core.setProtoFeeSplit(5000, 0, 5000);

                    marketCom = "100000000000000000"; // 0.1

                    await core.setProtoFee(0, synthSwapFee, 0, fixedSynthSwapFee, 0, 0);
                    mid = await createMarket(undefined, baseAddr, testERC721.address, AssetType.SYNTH, AssetType.ERC721, false, false, marketCom, 0);

                    protoFee = toBN(fixedSynthSwapFee).mul(amountOfBase).div(pow10str(18));
                    mktFee = toBN(marketCom).mul(amountOfBase).div(pow10str(18));
                    await token.transfer(provider.address, protoFee.add(mktFee));
                    await token.connect(provider).approve(feePurse.address, protoFee.add(mktFee));
                    await feePurse.connect(provider).deposit(protoFee.add(mktFee));

                    ids = [toBN(1)];
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                    const wantOrIds = [1];
                    await expect(
                        core.connect(provider).updateFungibleLiquidity({
                            marketId: mid,
                            target: AddressZero,
                            lid: 0,
                            amount: amountOfBase,
                            price: 0,
                            timeToPay: 0,
                            expireAt: 0,
                            pause: false,
                            wantOrIds: wantOrIds,
                            wantAndIds: [],
                            deduct: false,
                        }),
                    ).not.to.be.reverted;

                    // create swap order.
                    await expect(
                        core.connect(swapper).swapQuoteForBase({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 0,
                            maxPrice: 0,
                            ids: ids,
                            expireAt: 0,
                            operator: 1,
                            marketMgrData: Buffer.from([]),
                        }),
                    ).not.to.be.reverted;
                    const numOrders = (await core.state()).numOrders;
                    expect(numOrders.toNumber()).to.eql(1);
                    orderID = numOrders.toNumber() - 1;
                    let order = await core.getOrder(orderID);
                    expect(order.takerIds).to.eql(ids);

                    const mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(0);

                    await expect(core.connect(provider).markOrderAsPaid(orderID)).not.to.be.reverted;

                    const protoFeeRate = toDec(protoFee).div(toDec(amountOfBase));
                    const protoOrderFee = protoFeeRate.mul(pow10str(18)).mul(toDec(amountOfBase)).div(pow10str(18));
                    const mktCreatorFeeRate = toDec(mktFee).div(toDec(amountOfBase));
                    const mktCreatorOrderFee = mktCreatorFeeRate.mul(pow10str(18)).mul(toDec(amountOfBase)).div(pow10str(18));

                    await expect(core.connect(swapper).releaseOrder(orderID)).to.emit(core, "Swap");

                    // All protocol fee should go to inventor
                    expect(await feePurse.balanceOf(inventor.address)).to.eql(toBN(protoOrderFee).div(2));
                    expect(await feePurse.balanceOf(deployer.address)).to.eql(toBN(mktCreatorOrderFee));
                    expect(await feePurse.balanceOf(core.address)).to.eq(0);
                    expect(await feePurse.balanceOf(user5.address)).to.eql(toBN(protoOrderFee).div(2));
                });
            });
        });

        context("base asset = SYNTH while quote = NFT (ERC1155)", () => {
            let ids: BigNumber[];

            beforeEach(async () => {
                marketCom = "100000000000000000"; // 0.1

                await core.setProtoFee(0, synthSwapFee, 0, fixedSynthSwapFee, 0, 0);
                mid = await createMarket(undefined, baseAddr, testERC1155.address, AssetType.SYNTH, AssetType.ERC1155, false, false, marketCom, 0);

                protoFee = toBN(fixedSynthSwapFee).mul(amountOfBase).div(pow10str(18));
                mktFee = toBN(marketCom).mul(amountOfBase).div(pow10str(18));
                await token.transfer(provider.address, protoFee.add(mktFee));
                await token.connect(provider).approve(feePurse.address, protoFee.add(mktFee));
                await feePurse.connect(provider).deposit(protoFee.add(mktFee));

                ids = [toBN(1)];
                await testERC1155.connect(swapper).mint(1);
                await testERC1155.connect(swapper).setApprovalForAll(core.address, true);

                const wantOrIds = [1];
                await expect(
                    core.connect(provider).updateFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        amount: amountOfBase,
                        price: 0,
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        wantOrIds: wantOrIds,
                        wantAndIds: [],
                        deduct: false,
                    }),
                ).not.to.be.reverted;

                // create swap order.
                await expect(
                    core.connect(swapper).swapQuoteForBase({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        maxPrice: 0,
                        ids: ids,
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    }),
                ).not.to.be.reverted;
                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);
                orderID = numOrders.toNumber() - 1;
                const order = await core.getOrder(orderID);
                expect(order.takerIds).to.eql(ids);

                const mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eq(0);
            });

            it("should emit 'Swap' with expected arguments on success", async () => {
                await expect(core.connect(provider).markOrderAsPaid(orderID)).not.to.be.reverted;

                const protoFeeRate = toDec(protoFee).div(toDec(amountOfBase));
                const protoOrderFee = protoFeeRate.mul(pow10str(18)).mul(toDec(amountOfBase)).div(pow10str(18));
                const mktCreatorFeeRate = toDec(mktFee).div(toDec(amountOfBase));
                const mktCreatorOrderFee = mktCreatorFeeRate.mul(pow10str(18)).mul(toDec(amountOfBase)).div(pow10str(18));

                await expect(core.connect(swapper).releaseOrder(orderID)).to.emit(core, "Swap").withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, swapper.address, [1, 0, amountOfBase, 0, 0, 0], false, [], ids);

                // All protocol fee should go to inventor
                expect(await feePurse.balanceOf(inventor.address)).to.eql(toBN(protoOrderFee));
                expect(await feePurse.balanceOf(core.address)).to.eq(0);

                // Fee purse should be updated for both protocol and market creator
                let liq = await core.getLiquidity(mid, provider.address, 0);
                expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eql(protoFee.sub(toBN(protoOrderFee)));
                expect(await feePurse.getLocked(liq.mktCreatorFeePurseId)).to.eql(mktFee.sub(toBN(mktCreatorOrderFee)));

                // Order must be marked as released
                const order = await core.getOrder(0);
                expect(order.released).to.be.true;

                // Provider should now own the NFT
                expect(await testERC1155.balanceOf(provider.address, 1)).to.be.eq(1);
            });
        });

        context("base asset = NFT while quote = SYNTH", () => {
            let ids: BigNumber[];

            it("should emit 'Swap' with expected arguments on success", async () => {
                marketCom = "100000000000000000"; // 0.1

                await core.setProtoFee(0, synthSwapFee, 0, fixedSynthSwapFee, fixedNFTSwapFee, 0);
                mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, marketCom, 0);

                await testERC721.connect(provider).mint();
                await testERC721.connect(provider).mint();
                await testERC721.connect(provider).setApprovalForAll(core.address, true);

                ids = [toBN(1), toBN(2)];
                protoFee = toBN(fixedNFTSwapFee).mul(ids.length);
                mktFee = toBN(marketCom).mul(ids.length);
                await token.transfer(provider.address, protoFee.add(mktFee));
                await token.connect(provider).approve(feePurse.address, protoFee.add(mktFee));
                await feePurse.connect(provider).deposit(protoFee.add(mktFee));

                await expect(
                    core.connect(provider).updateNonFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        price: pricePerBase,
                        timeToPay: 0,
                        expireAt: 0,
                        ids: ids,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                        pause: false,
                    }),
                ).not.to.be.reverted;

                let mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eq(2);

                // create swap order.
                await expect(
                    core.connect(swapper).swapQuoteForBase({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        maxPrice: pricePerBase,
                        ids: [],
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    }),
                ).not.to.be.reverted;
                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);
                orderID = numOrders.toNumber() - 1;
                let order = await core.getOrder(orderID);
                expect(order.providerIds).to.eql(ids);

                mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eq(0);

                await expect(core.connect(swapper).markOrderAsPaid(orderID)).not.to.be.reverted;
                await expect(core.connect(provider).releaseOrder(orderID)).to.emit(core, "Swap").withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, provider.address, [1, 0, 0, pricePerBase, 0, 0], false, ids, []);

                // All protocol fee should go to inventor
                expect(await feePurse.balanceOf(inventor.address)).to.eql(toBN(protoFee));
                expect(await feePurse.balanceOf(core.address)).to.eq(0);

                // Fee purse should be updated for both protocol and market creator
                let liq = await core.getLiquidity(mid, provider.address, 0);
                expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eq(0);
                expect(await feePurse.getLocked(liq.mktCreatorFeePurseId)).to.eq(0);
                expect(liq.ids).to.be.empty;

                // Order must be marked as released
                order = await core.getOrder(0);
                expect(order.released).to.be.true;

                // Swapper should now own the NFTs
                expect(await testERC721.ownerOf(1)).to.be.eql(swapper.address);
                expect(await testERC721.ownerOf(2)).to.be.eql(swapper.address);
            });

            context("operator fee is set", () => {
                it("should calculate correct operator fee balance when swap include operator ID", async () => {
                    await operator.setBond(0);
                    await operator.connect(user5).register();
                    await core.setProtoFeeSplit(5000, 0, 5000);

                    marketCom = "100000000000000000"; // 0.1

                    await core.setProtoFee(0, synthSwapFee, 0, fixedSynthSwapFee, fixedNFTSwapFee, 0);
                    mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, marketCom, 0);

                    await testERC721.connect(provider).mint();
                    await testERC721.connect(provider).mint();
                    await testERC721.connect(provider).setApprovalForAll(core.address, true);

                    ids = [toBN(1), toBN(2)];
                    protoFee = toBN(fixedNFTSwapFee).mul(ids.length);
                    mktFee = toBN(marketCom).mul(ids.length);
                    await token.transfer(provider.address, protoFee.add(mktFee));
                    await token.connect(provider).approve(feePurse.address, protoFee.add(mktFee));
                    await feePurse.connect(provider).deposit(protoFee.add(mktFee));

                    await expect(
                        core.connect(provider).updateNonFungibleLiquidity({
                            marketId: mid,
                            target: AddressZero,
                            lid: 0,
                            price: pricePerBase,
                            timeToPay: 0,
                            expireAt: 0,
                            ids: ids,
                            wantOrIds: [],
                            wantAndIds: [],
                            deduct: false,
                            pause: false,
                        }),
                    ).not.to.be.reverted;

                    let mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(2);

                    // create swap order.
                    await expect(
                        core.connect(swapper).swapQuoteForBase({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 0,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 1,
                            marketMgrData: Buffer.from([]),
                        }),
                    ).not.to.be.reverted;
                    const numOrders = (await core.state()).numOrders;
                    expect(numOrders.toNumber()).to.eql(1);
                    orderID = numOrders.toNumber() - 1;
                    let order = await core.getOrder(orderID);
                    expect(order.providerIds).to.eql(ids);

                    mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(0);

                    await expect(core.connect(swapper).markOrderAsPaid(orderID)).not.to.be.reverted;
                    await expect(core.connect(provider).releaseOrder(orderID)).to.emit(core, "Swap");

                    // All protocol fee should go to inventor
                    expect(await feePurse.balanceOf(inventor.address)).to.eql(toBN(protoFee).div(2));
                    expect(await feePurse.balanceOf(user5.address)).to.eql(toBN(protoFee).div(2));
                    expect(await feePurse.balanceOf(core.address)).to.eq(0);
                });
            });

            context("swapper provided a recipient", () => {
                it("should swap to recipient", async () => {
                    await core.setProtoFee(0, 0, 0, 0, 0, 0);
                    mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, 0, 0);

                    await testERC721.connect(provider).mint();
                    await testERC721.connect(provider).setApprovalForAll(core.address, true);
                    ids = [toBN(1)];

                    await expect(
                        core.connect(provider).updateNonFungibleLiquidity({
                            marketId: mid,
                            target: AddressZero,
                            lid: 0,
                            price: pricePerBase,
                            timeToPay: 0,
                            expireAt: 0,
                            ids: ids,
                            wantOrIds: [],
                            wantAndIds: [],
                            deduct: false,
                            pause: false,
                        }),
                    ).not.to.be.reverted;

                    // create swap order.
                    await expect(
                        core.connect(swapper).swapQuoteForBase({
                            marketId: mid,
                            provider: provider.address,
                            recipient: user5.address,
                            lid: 0,
                            amount: 0,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 0,
                            marketMgrData: Buffer.from([]),
                        }),
                    ).not.to.be.reverted;
                    const numOrders = (await core.state()).numOrders;
                    expect(numOrders.toNumber()).to.eql(1);
                    orderID = numOrders.toNumber() - 1;

                    await expect(core.connect(swapper).markOrderAsPaid(orderID)).not.to.be.reverted;
                    await expect(core.connect(provider).releaseOrder(orderID)).to.emit(core, "Swap");

                    expect(await testERC721.ownerOf(1)).to.be.eql(user5.address);
                });
            });
        });

        context("sender is contract owner", () => {
            it("should successfully release order", async () => {
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);

                await core.setProtoFee(0, 0, 0, 0, 0, 0);
                await mc.connect(marketCreator2).setCommission(mid, 0);

                // provide liquidity
                await provideLiquidity(provider, amountOfBase, pricePerBase);

                // create swap order.
                swapAmt = toBN(5).mul(baseDec);
                await expect(
                    core.connect(swapper).swapQuoteForBase({
                        marketId: mid,
                        provider: provider.address,
                        recipient: user5.address,
                        lid: 0,
                        amount: swapAmt,
                        maxPrice: pricePerBase,
                        ids: [],
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    }),
                ).not.to.be.reverted;
                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);
                orderID = numOrders.toNumber() - 1;

                // release order
                await expect(core.connect(swapper).markOrderAsPaid(orderID)).not.to.be.reverted;
                await expect(core.connect(deployer).releaseOrder(orderID)).to.emit(core, "Swap");

                expect(await baseAsset.balanceOf(user5.address)).to.eql(swapAmt);
            });

            context("market has a market manager", () => {
                it("should successfully call release function in market manager", async () => {
                    let factory = await ethers.getContractFactory("TestMarketManager");
                    const testMarketManager = (await factory.deploy()) as TestMarketManager;

                    await mc.connect(marketCreator2).createMarketWithManager(baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0, 0, testMarketManager.address);
                    mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);

                    await core.setProtoFee(0, 0, 0, 0, 0, 0);
                    await mc.connect(marketCreator2).setCommission(mid, 0);

                    // provide liquidity
                    await provideLiquidity(provider, amountOfBase, pricePerBase);

                    // create swap order.
                    swapAmt = toBN(5).mul(baseDec);
                    await expect(
                        core.connect(swapper).swapQuoteForBase({
                            marketId: mid,
                            provider: provider.address,
                            recipient: user5.address,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 0,
                            marketMgrData: Buffer.from([]),
                        }),
                    ).not.to.be.reverted;
                    const numOrders = (await core.state()).numOrders;
                    expect(numOrders.toNumber()).to.eql(1);
                    orderID = numOrders.toNumber() - 1;

                    // release order
                    await expect(core.connect(swapper).markOrderAsPaid(orderID)).not.to.be.reverted;
                    await expect(core.connect(deployer).releaseOrder(orderID)).to.emit(core, "Swap");

                    expect(await baseAsset.balanceOf(user5.address)).to.eql(swapAmt);

                    expect(await testMarketManager.onReleaseCalled()).to.be.true;
                });
            });
        });

        context("market has a manager", () => {
            it("should release order", async () => {
                await mc.connect(marketCreator2).createMarketWithManager(baseAddr, quoteAddr, 1, 0, false, false, 0, 0, user5.address);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);
                let orderID = await createOrder_BaseOn_QuoteOff(mid);

                await expect(core.connect(user5).markOrderAsPaid(orderID)).not.to.be.reverted;
                let order = await core.getOrder(orderID);
                expect(order.paid).to.be.true;

                await expect(core.connect(user5).releaseOrder(orderID)).to.emit(core, "Swap");
                order = await core.getOrder(orderID);
                expect(order.released).to.be.true;
            });
        });
    });

    describe(".releaseOrderByDispute", () => {
        let orderID: BigNumber;
        beforeEach(async () => {
            await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0, 0);
            mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);
            orderID = await createOrder_BaseOn_QuoteOff(mid);
            await core.setDisputeManager(deployer.address);
        });

        it("should revert with reason=NOT_DISPUTE_MGR when sender is not the dispute manager", async () => {
            await expect(core.connect(provider).releaseOrderByDispute(orderID)).to.be.revertedWith("NOT_DISPUTE_MGR");
        });

        it("should mark `released` = true on success", async () => {
            await core.connect(swapper).markOrderAsPaid(orderID);
            await expect(core.releaseOrderByDispute(orderID))
                .to.emit(core, "Swap")
                .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, deployer.address, [1, 0, toBN(5).mul(baseDec), pricePerBase, 0, 0], true, [], []);
            const order = await core.getOrder(orderID);
            expect(order.released).to.be.true;
        });
    });

    describe(".cancelOrder", () => {
        beforeEach(async () => {
            await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);
        });

        it("should revert with reason= when order is unknown", async () => {
            await expect(core.cancelOrder(1)).to.be.revertedWith("UNKNOWN_ORDER");
        });

        it("should revert with reason=NOT_AUTHORIZED when sender is neither the provider or taker", async () => {
            const orderID = await createOrder_BaseOn_QuoteOff(mid);
            await expect(core.connect(marketCreator2).cancelOrder(orderID)).to.be.revertedWith("OC: NOT_AUTHORIZED");
        });

        context("when market manager is set", () => {
            it("should not revert with reason=NOT_AUTHORIZED when sender is market manager", async () => {
                await mc.connect(marketCreator).createMarketWithManager(baseAddr, quoteAddr, 1, 0, false, false, 0, 0, user2.address);
                mid = makeMarketID(marketCreator.address, baseAddr, quoteAddr, 1, 0);
                const orderID = await createOrder_BaseOn_QuoteOff(mid);
                await expect(core.connect(user2).cancelOrder(orderID)).not.to.be.revertedWith("OC: NOT_AUTHORIZED");
            });
        });

        it("should not revert with reason=NOT_AUTHORIZED when sender is a miner", async () => {
            await token.transfer(user2.address, minerBond);
            await token.connect(user2).approve(minerReg.address, minerBond);
            await minerReg.connect(user2).register();

            const orderID = await createOrder_BaseOn_QuoteOff(mid);
            await expect(core.connect(user2).cancelOrder(orderID)).not.to.be.revertedWith("OC: NOT_AUTHORIZED");
        });

        it("should revert with reason=NOT_INACTIVE when order has been marked paid", async () => {
            let orderID = await createOrder_BaseOn_QuoteOff(mid);
            await core.connect(swapper).markOrderAsPaid(orderID);
            await expect(core.connect(swapper).cancelOrder(orderID)).to.be.revertedWith("OC: NOT_INACTIVE");
        });

        it("should revert with reason=NOT_CANCEL_TIME when order cancel time has not been reached", async () => {
            let orderID = await createOrder_BaseOn_QuoteOff(mid);
            await expect(core.connect(swapper).cancelOrder(orderID)).to.be.revertedWith("OC: NOT_CANCEL_TIME");
        });

        context("order already cancelled", () => {
            it("should revert with reason=NOT_INACTIVE", async () => {
                let orderID = await createOrder_BaseOn_QuoteOff(mid);
                let order = await core.getOrder(0);

                let liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.amount.toString()).to.eql("95000000000000000000");
                expect(order.cancelled).to.be.false;

                await advanceBlockTime(orderLifeTime);
                await expect(core.connect(swapper).cancelOrder(orderID)).to.emit(core, "OrderCancelled").withArgs(0, swapper.address, false);
                await expect(core.connect(swapper).cancelOrder(orderID)).to.be.revertedWith("OC: NOT_INACTIVE");
            });
        });

        context("base = ERC20 while quote = SYNTH", () => {
            it("should not revert when cancellation succeeds", async () => {
                let orderID = await createOrder_BaseOn_QuoteOff(mid);

                let liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.amount.toString()).to.eql("95000000000000000000");

                let order = await core.getOrder(0);
                expect(order.cancelled).to.be.false;

                // Expect openOrders to be 1
                expect(liq.openOrders.eq(1)).to.be.true;

                await advanceBlockTime(orderLifeTime);
                await expect(core.connect(swapper).cancelOrder(orderID)).to.emit(core, "OrderCancelled").withArgs(0, swapper.address, false);

                liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.amount.toString()).to.eql("100000000000000000000");

                order = await core.getOrder(0);
                expect(order.cancelled).to.be.true;
                expect(order.finalizer).to.eql(swapper.address);

                // Expect openOrders to be 0
                expect(liq.openOrders.eq(0)).to.be.true;

                let mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(amountOfBase);
            });
        });

        context("base = SYNTH while quote = ERC20", () => {
            beforeEach(async () => {
                baseAddr = ethers.Wallet.createRandom().address;
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 0, 1, false, false, 0, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 0, 1);
            });

            it("should successfully cancel order", async () => {
                // Provide BASE liquidity
                const provLiq = toBN(10).mul(baseDec);
                const basePrice = toBN(1).mul(quoteDec);
                await core.connect(provider).updateFungibleLiquidity({
                    marketId: mid,
                    target: AddressZero,
                    lid: 0,
                    amount: provLiq,
                    price: basePrice,
                    timeToPay: 0,
                    expireAt: 0,
                    pause: false,
                    wantOrIds: [],
                    wantAndIds: [],
                    deduct: false,
                });

                let mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(provLiq);

                // Provide QUOTE asset to swapper and unlock it
                const swapAmt = toBN(10).mul(baseDec);
                const swapCost = basePrice.mul(10);
                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                // Create Order
                await core.connect(swapper).swapQuoteForBase({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: swapAmt,
                    maxPrice: basePrice,
                    ids: [],
                    expireAt: 0,
                    operator: 0,
                    marketMgrData: Buffer.from([]),
                });

                mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(provLiq.sub(swapAmt));

                // Expect swap amount to be deducted
                expect((await quoteAsset.balanceOf(swapper.address)).isZero()).to.be.true;

                // Cancel the order
                await advanceBlockTime(orderLifeTime);
                await expect(core.connect(swapper).cancelOrder(0)).to.emit(core, "OrderCancelled").withArgs(0, swapper.address, false);

                mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(provLiq);

                // Expect swap amount to be returned
                expect((await quoteAsset.balanceOf(swapper.address)).eq(swapAmt)).to.be.true;

                // Order should be cancelled
                let order = await core.getOrder(0);
                expect(order.cancelled).to.be.true;
                const liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.openOrders.eq(0)).to.be.true;
            });
        });

        context("base = SYNTH while quote = NATIVE", () => {
            beforeEach(async () => {
                baseAddr = ethers.Wallet.createRandom().address;
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.SYNTH, AssetType.NATIVE, false, false, 0, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.NATIVE);
            });

            it("should successfully cancel order", async () => {
                // Provide BASE liquidity
                const provLiq = toBN(10).mul(baseDec);
                const basePrice = toBN(1).mul(quoteDec);
                await core.connect(provider).updateFungibleLiquidity({
                    marketId: mid,
                    target: AddressZero,
                    lid: 0,
                    amount: provLiq,
                    price: basePrice,
                    timeToPay: 0,
                    expireAt: 0,
                    pause: false,
                    wantOrIds: [],
                    wantAndIds: [],
                    deduct: false,
                });

                let mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(provLiq);

                // Provide QUOTE asset to swapper and unlock it
                const swapAmt = toBN(10).mul(baseDec);
                const swapCost = basePrice.mul(10);

                // Create Order
                await core.connect(swapper).swapQuoteForBase(
                    {
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: swapAmt,
                        maxPrice: basePrice,
                        ids: [],
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    },
                    {
                        value: swapCost,
                    },
                );

                mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(provLiq.sub(swapAmt));

                // Expect swap amount to be deducted
                expect((await quoteAsset.balanceOf(swapper.address)).isZero()).to.be.true;

                const prevSwapperBal = await core.provider.getBalance(swapper.address);

                // // Cancel the order
                await advanceBlockTime(orderLifeTime);
                const tx = await core.connect(swapper).cancelOrder(0);
                await expect(tx).to.emit(core, "OrderCancelled").withArgs(0, swapper.address, false);

                // calculate gas used in eth
                const txReceipt = await tx.wait();
                const gasUsed = txReceipt.gasUsed.mul(tx.gasPrice as BigNumber);

                mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(provLiq);

                // Expect swap amount to be returned
                expect(await core.provider.getBalance(swapper.address)).to.eq(prevSwapperBal.add(swapCost).sub(gasUsed));

                // contract should have no balance
                expect(await core.provider.getBalance(core.address)).to.eq(0);

                // Order should be cancelled
                let order = await core.getOrder(0);
                expect(order.cancelled).to.be.true;
                const liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.openOrders.eq(0)).to.be.true;
            });
        });

        context("base = SYNTH while quote = SYNTH", () => {
            let orderID: number;
            let swapAmt: BigNumber;
            let swapCost: BigNumber;

            beforeEach(async () => {
                await core.setProtoFee(0, synthSwapFee, 0, 0, 0, 0);
                mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.SYNTH, false, false, 0, 0);
                await provideLiquidity(provider, amountOfBase, pricePerBase);

                let mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(amountOfBase);

                // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                // create swap order.
                await expect(
                    core.connect(swapper).swapQuoteForBase({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: swapAmt,
                        maxPrice: pricePerBase,
                        ids: [],
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    }),
                ).not.to.be.reverted;
                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);
                orderID = numOrders.toNumber() - 1;

                mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(amountOfBase.sub(swapAmt));
            });

            it("should emit 'OrderCancelled' with expected arguments on success", async () => {
                // Cancel the order
                await advanceBlockTime(orderLifeTime);
                await expect(core.connect(swapper).cancelOrder(orderID)).to.emit(core, "OrderCancelled").withArgs(0, swapper.address, false);

                // Order should be cancelled
                let order = await core.getOrder(orderID);
                expect(order.cancelled).to.be.true;

                // Liquidity should be returned
                const liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.openOrders.eq(0)).to.be.true;
                expect(liq.amount).to.eql(amountOfBase);

                let mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(amountOfBase);
            });
        });

        context("base = SYNTH while quote = NFT", () => {
            let orderID: number;

            beforeEach(async () => {
                await core.setProtoFee(0, synthSwapFee, 0, 0, 0, 0);
                mid = await createMarket(undefined, baseAddr, testERC721.address, AssetType.SYNTH, AssetType.ERC721, false, false, 0, 0);

                const ids = [toBN(1)];
                await testERC721.connect(swapper).mint();
                await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                const wantOrIds = [1];
                await expect(
                    core.connect(provider).updateFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        amount: amountOfBase,
                        price: 0,
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        wantOrIds: wantOrIds,
                        wantAndIds: [],
                        deduct: false,
                    }),
                ).not.to.be.reverted;

                let mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(amountOfBase);

                // create swap order.
                await expect(
                    core.connect(swapper).swapQuoteForBase({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        maxPrice: 0,
                        ids: ids,
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    }),
                ).not.to.be.reverted;
                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);
                orderID = numOrders.toNumber() - 1;
                const order = await core.getOrder(orderID);
                expect(order.takerIds).to.eql(ids);

                mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eq(0);
            });

            it("should emit 'OrderCancelled' with expected arguments on success", async () => {
                // Cancel the order
                await advanceBlockTime(orderLifeTime);
                await expect(core.connect(swapper).cancelOrder(orderID)).to.emit(core, "OrderCancelled").withArgs(0, swapper.address, false);

                // Order should be cancelled
                let order = await core.getOrder(orderID);
                expect(order.cancelled).to.be.true;

                // Liquidity should be returned
                const liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.openOrders.eq(0)).to.be.true;
                expect(liq.amount).to.eql(amountOfBase);

                // NFTs should be returned to swapper
                expect(await testERC721.ownerOf(1)).to.eql(swapper.address);

                let mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eql(amountOfBase);
            });
        });

        context("base = NFT while quote = SYNTH", () => {
            let ids: BigNumber[];
            let orderID: number;

            beforeEach(async () => {
                await core.setProtoFee(0, synthSwapFee, 0, fixedSynthSwapFee, 0, 0);
                mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, 0, 0);

                await testERC721.connect(provider).mint();
                await testERC721.connect(provider).mint();
                await testERC721.connect(provider).setApprovalForAll(core.address, true);

                ids = [toBN(1), toBN(2)];
                await expect(
                    core.connect(provider).updateNonFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        price: pricePerBase,
                        timeToPay: 0,
                        expireAt: 0,
                        ids: ids,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                        pause: false,
                    }),
                ).not.to.be.reverted;

                let mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eq(2);

                // create swap order.
                await expect(
                    core.connect(swapper).swapQuoteForBase({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        maxPrice: pricePerBase,
                        ids: [],
                        expireAt: 0,
                        operator: 0,
                        marketMgrData: Buffer.from([]),
                    }),
                ).not.to.be.reverted;
                const numOrders = (await core.state()).numOrders;
                expect(numOrders.toNumber()).to.eql(1);
                orderID = numOrders.toNumber() - 1;
                const order = await core.getOrder(orderID);
                expect(order.providerIds).to.eql(ids);

                mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eq(0);
            });

            it("should emit 'OrderCancelled' with expected arguments on success", async () => {
                // Cancel the order
                await advanceBlockTime(orderLifeTime);
                await expect(core.connect(swapper).cancelOrder(orderID)).to.emit(core, "OrderCancelled").withArgs(0, swapper.address, false);

                // Order should be cancelled
                let order = await core.getOrder(orderID);
                expect(order.cancelled).to.be.true;

                // Liquidity should be returned
                const liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.openOrders.eq(0)).to.be.true;
                expect(liq.ids).to.eql(ids);

                let mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eq(ids.length);
            });
        });

        it("should cancel successfully when sender is a miner and grant miner reward", async () => {
            const orderID = await createOrder_BaseOn_QuoteOff(mid);
            await advanceBlockTime(orderLifeTime);

            await token.transfer(user5.address, minerBond);
            await token.connect(user5).approve(minerReg.address, minerBond);
            await minerReg.connect(user5).register();
            await advanceBlockTime(minerMatureDur);

            await expect(core.connect(user5).cancelOrder(orderID)).to.emit(core, "OrderCancelled");

            expect(await minerReg.rewardBalanceOf(user5.address)).to.eq(minerCancelReward);
        });

        context("sender is contract owner", () => {
            it("should successfully cancel order", async () => {
                let orderID = await createOrder_BaseOn_QuoteOff(mid);
                let order = await core.getOrder(0);

                await advanceBlockTime(orderLifeTime);
                await expect(core.connect(deployer).cancelOrder(orderID)).to.emit(core, "OrderCancelled").withArgs(0, deployer.address, false);

                order = await core.getOrder(0);
                expect(order.cancelled).to.be.true;
            });
        });

        context("market has a manager", () => {
            it("should cancel order", async () => {
                await mc.connect(marketCreator).createMarketWithManager(baseAddr, quoteAddr, 1, 0, false, false, 0, 0, user5.address);
                mid = makeMarketID(marketCreator.address, baseAddr, quoteAddr, 1, 0);
                let orderID = await createOrder_BaseOn_QuoteOff(mid);

                await advanceBlockTime(orderLifeTime);
                await expect(core.connect(user5).cancelOrder(orderID)).not.to.be.reverted;

                let order = await core.getOrder(orderID);
                expect(order.cancelled).to.be.true;
            });
        });
    });

    describe(".hasOrder", () => {
        beforeEach(async () => {
            await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);
        });

        it("should return expected results", async () => {
            expect(await core.hasOrder(0)).to.be.false;
            expect(await core.hasOrder(1)).to.be.false;

            const orderID = await createOrder_BaseOn_QuoteOff(mid);

            expect(await core.hasOrder(orderID)).to.be.true;
            expect(await core.hasOrder(1)).to.be.false;
        });
    });

    describe(".getOrder", () => {
        beforeEach(async () => {
            await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);
        });

        it("should revert with reason= when order is unknown", async () => {
            await expect(core.getOrder(1)).to.be.revertedWith("UNKNOWN_ORDER");
        });

        it("should successfully return order", async () => {
            let orderID = await createOrder_BaseOn_QuoteOff(mid);
            expect((await core.getOrder(orderID)).marketId).to.eql(getAddress(mid));
        });
    });

    describe(".cancelOrderByDispute", () => {
        let orderID: BigNumber;
        beforeEach(async () => {
            await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);
            orderID = await createOrder_BaseOn_QuoteOff(mid);
            await core.setDisputeManager(deployer.address);
        });

        it("should revert with reason=NOT_DISPUTE_MGR when sender is not the dispute manager", async () => {
            await expect(core.connect(provider).cancelOrderByDispute(orderID)).to.be.revertedWith("OC: NOT_DISPUTE_MGR");
        });

        it("should mark `cancelled` = true on success", async () => {
            await expect(core.cancelOrderByDispute(orderID)).to.emit(core, "OrderCancelled").withArgs(orderID, deployer.address, true);
            const order = await core.getOrder(orderID);
            expect(order.cancelled).to.be.true;
        });
    });

    describe(".computeFee", () => {
        context("for ERC20/ERC20", () => {
            it("should compute correct fee", async () => {
                await core.setProtoFee(14, 0, 0, 0, 0, 0);
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 1000, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20);
                await provideLiquidity(provider, amountOfBase, pricePerBase);
                const swapAmt = toBN(5).mul(baseDec);
                const res = await core.computeSwapFee(mid, provider.address, 0, swapper.address, swapAmt, pricePerBase);
                expect(res[0]).to.eql(toBN("7000000000000000"));
                expect(res[1]).to.eql(toBN("500000000000000000"));
            });

            context("both assets are stables", () => {
                it("should compute correct fee", async () => {
                    await assetReg.setStable(baseAddr, true);
                    await assetReg.setStable(quoteAddr, true);
                    await core.setProtoFee(0, 0, 14, 0, 0, 0);
                    await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 1000, 0);
                    mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20);
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                    const swapAmt = toBN(5).mul(baseDec);
                    const res = await core.computeSwapFee(mid, provider.address, 0, swapper.address, swapAmt, pricePerBase);
                    expect(res[0]).to.eql(toBN("7000000000000000"));
                    expect(res[1]).to.eql(toBN("500000000000000000"));
                });
            });
        });

        context("for ERC20/NATIVE", () => {
            it("should compute correct fee", async () => {
                await core.setProtoFee(14, 0, 0, 0, 0, 0);
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.ERC20, AssetType.NATIVE, false, false, 1000, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, AssetType.ERC20, AssetType.NATIVE);
                await provideLiquidity(provider, amountOfBase, pricePerBase);
                const swapAmt = toBN(5).mul(baseDec);
                const res = await core.computeSwapFee(mid, provider.address, 0, swapper.address, swapAmt, pricePerBase);
                expect(res[0]).to.eql(toBN("7000000000000000"));
                expect(res[1]).to.eql(toBN("500000000000000000"));
            });
        });

        context("for ERC20/SYNTH ", () => {
            it("should compute correct fee", async () => {
                await core.setProtoFee(0, 14, 0, 0, 0, 0);
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 1000, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH);
                await provideLiquidity(provider, amountOfBase, pricePerBase);
                const swapAmt = toBN(5).mul(baseDec);
                const res = await core.computeSwapFee(mid, provider.address, 0, swapper.address, swapAmt, pricePerBase);
                expect(res[0]).to.eql(toBN("7000000000000000"));
                expect(res[1]).to.eql(toBN("500000000000000000"));
            });
        });

        context("for SYNTH/ERC20 ", () => {
            it("should compute correct fee", async () => {
                await core.setProtoFee(0, 14, 0, 0, 0, 0);
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.SYNTH, AssetType.ERC20, false, false, 1000, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.ERC20);
                await provideLiquidity(provider, amountOfBase, pricePerBase);
                const swapAmt = toBN(5).mul(baseDec);
                const res = await core.computeSwapFee(mid, provider.address, 0, swapper.address, swapAmt, pricePerBase);
                expect(res[0]).to.eql(toBN("70000000000000000"));
                expect(res[1]).to.eql(toBN("5000000000000000000"));
            });
        });

        context("for ERC20/NFT", () => {
            it("should compute correct fee", async () => {
                await core.setProtoFee(0, 0, 0, 0, 0, 14);
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC721, false, false, 1000, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC721);

                await baseAsset.transfer(provider.address, amountOfBase);
                await baseAsset.connect(provider).approve(core.address, amountOfBase);
                await core.connect(provider).updateFungibleLiquidity({
                    marketId: mid,
                    target: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 0,
                    timeToPay: 0,
                    expireAt: 0,
                    pause: false,
                    wantOrIds: [],
                    wantAndIds: [],
                    deduct: false,
                });

                const res = await core.computeSwapFee(mid, provider.address, 0, swapper.address, 0, 0);
                expect(res[0]).to.eql(toBN("140000000000000000"));
                expect(res[1]).to.eql(toBN("10000000000000000000"));
            });
        });

        context("for SYNTH/SYNTH", () => {
            it("should compute correct fee", async () => {
                const fixedSynthSwapFee = tokenDec.mul(1);
                const mktCom = fixedSynthSwapFee;

                await core.setProtoFee(0, 0, 0, fixedSynthSwapFee, 0, 0);
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.SYNTH, AssetType.SYNTH, false, false, mktCom, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.SYNTH);

                const fee = amountOfBase.mul(fixedSynthSwapFee.add(mktCom)).div(tokenDec);
                await token.transfer(provider.address, fee);
                await token.connect(provider).approve(feePurse.address, fee);
                await feePurse.connect(provider).deposit(fee);

                await core.connect(provider).updateFungibleLiquidity({
                    marketId: mid,
                    target: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: pricePerBase,
                    timeToPay: 0,
                    expireAt: 0,
                    pause: false,
                    wantOrIds: [],
                    wantAndIds: [],
                    deduct: false,
                });

                let res = await core.computeSwapFee(mid, provider.address, 0, swapper.address, amountOfBase, 0);
                expect(res[0]).to.eql(toBN("100000000000000000000"));
                expect(res[1]).to.eql(toBN("100000000000000000000"));

                res = await core.computeSwapFee(mid, provider.address, 0, swapper.address, tokenDec.mul(10), 0);
                expect(res[0]).to.eql(toBN("10000000000000000000"));
                expect(res[1]).to.eql(toBN("10000000000000000000"));
            });
        });

        context("for NFT/ERC20", () => {
            it("should compute correct fee", async () => {
                await core.setProtoFee(0, 0, 0, 0, 0, 14);
                await mc.connect(marketCreator2).createMarket(testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC20, false, false, 1000, 0);
                mid = makeMarketID(marketCreator2.address, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC20);

                await testERC721.connect(provider).mint();
                await testERC721.connect(provider).setApprovalForAll(core.address, true);
                const ids = [toBN(1)];
                const price = pricePerBase;
                await core.connect(provider).updateNonFungibleLiquidity({
                    marketId: mid,
                    target: AddressZero,
                    lid: 0,
                    price: price,
                    timeToPay: 0,
                    expireAt: 0,
                    ids: ids,
                    wantOrIds: [],
                    wantAndIds: [],
                    deduct: false,
                    pause: false,
                });

                const res = await core.computeSwapFee(mid, provider.address, 0, swapper.address, 0, price);
                expect(res[0]).to.eql(toBN("14000000000000000"));
                expect(res[1]).to.eql(toBN("1000000000000000000"));
            });
        });

        context("for NFT/SYNTH", () => {
            it("should compute correct fee", async () => {
                const fixedSynthSwapFee = tokenDec.mul(1);
                const mktCom = fixedSynthSwapFee;

                await core.setProtoFee(0, 0, 0, 0, fixedSynthSwapFee, 0);
                await mc.connect(marketCreator2).createMarket(testERC721.address, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, mktCom, 0);
                mid = makeMarketID(marketCreator2.address, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.SYNTH);

                const ids = [toBN(1), toBN(2)];
                const fee = toBN(ids.length).mul(fixedSynthSwapFee.add(mktCom));
                await token.transfer(provider.address, fee);
                await token.connect(provider).approve(feePurse.address, fee);
                await feePurse.connect(provider).deposit(fee);

                await testERC721.connect(provider).mint();
                await testERC721.connect(provider).mint();
                await testERC721.connect(provider).setApprovalForAll(core.address, true);
                const price = pricePerBase;
                await core.connect(provider).updateNonFungibleLiquidity({
                    marketId: mid,
                    target: AddressZero,
                    lid: 0,
                    price: price,
                    timeToPay: 0,
                    expireAt: 0,
                    ids: ids,
                    wantOrIds: [],
                    wantAndIds: [],
                    deduct: false,
                    pause: false,
                });

                const res = await core.computeSwapFee(mid, provider.address, 0, swapper.address, 0, price);
                expect(res[0]).to.eql(toBN("2000000000000000000"));
                expect(res[1]).to.eql(toBN("2000000000000000000"));
            });
        });

        context("for NFT/NFT", () => {
            it("should compute correct fee", async () => {
                const fixedSynthSwapFee = tokenDec.mul(1);
                const mktCom = fixedSynthSwapFee;

                await core.setProtoFee(0, 0, 0, 0, fixedSynthSwapFee, 0);
                await mc.connect(marketCreator2).createMarket(testERC721.address, testERC721.address, AssetType.ERC721, AssetType.ERC721, false, false, mktCom, 0);
                mid = makeMarketID(marketCreator2.address, testERC721.address, testERC721.address, AssetType.ERC721, AssetType.ERC721);

                const ids = [toBN(1), toBN(2)];
                const fee = toBN(ids.length).mul(fixedSynthSwapFee.add(mktCom));
                await token.transfer(provider.address, fee);
                await token.connect(provider).approve(feePurse.address, fee);
                await feePurse.connect(provider).deposit(fee);

                await testERC721.connect(provider).mint();
                await testERC721.connect(provider).mint();
                await testERC721.connect(provider).setApprovalForAll(core.address, true);
                await core.connect(provider).updateNonFungibleLiquidity({
                    marketId: mid,
                    target: AddressZero,
                    lid: 0,
                    price: 0,
                    timeToPay: 0,
                    expireAt: 0,
                    ids: ids,
                    wantOrIds: [],
                    wantAndIds: [],
                    deduct: false,
                    pause: false,
                });

                const res = await core.computeSwapFee(mid, provider.address, 0, swapper.address, 0, 0);
                expect(res[0]).to.eql(toBN("2000000000000000000"));
                expect(res[1]).to.eql(toBN("2000000000000000000"));
            });
        });
    });
});
