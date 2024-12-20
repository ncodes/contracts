import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {BigNumber, BigNumberish} from "ethers";
import {getAddress} from "ethers/lib/utils";
import {ethers} from "hardhat";
import {Core, ERC1155T, ERC721T, MarketCore, MediatorManager, TOKEN} from "../../typechain-types";
import {AddressZero, AssetType, advanceBlockTime, makeMarketID, now, pow10, powOf, toBN, toDec} from "../../utils/utils";
import {initCoreTestSuite} from "../helpers/helpers";
const getContractFactory = ethers.getContractFactory;

describe("Core - Offer", function () {
    let baseAddr: string;
    let quoteAddr: string;
    let core: Core;
    let medMgr: MediatorManager;
    let mc: MarketCore;
    let testERC721: ERC721T;
    let testERC1155: ERC1155T;
    let deployer: SignerWithAddress;
    let user5: SignerWithAddress;
    let cAddr: string;
    let baseAsset: TOKEN;
    let quoteAsset: TOKEN;
    let mid: string;
    let baseDec: BigNumber;
    let quoteDec: BigNumber;
    let amountOfBase: BigNumber;
    let pricePerBase: BigNumber;
    let deadline = 0;

    let marketCreator: SignerWithAddress, provider: SignerWithAddress, swapper: SignerWithAddress, marketCreator2: SignerWithAddress, inventor: SignerWithAddress;

    beforeEach(async () => {
        const vars = await initCoreTestSuite();
        baseAddr = vars.baseAddr;
        quoteAddr = vars.quoteAddr;
        core = vars.core;
        mc = vars.mc;
        testERC721 = vars.testERC721;
        testERC1155 = vars.testERC1155;
        medMgr = vars.mediatorMgr;
        deployer = vars.deployer;
        user5 = vars.user5;
        cAddr = vars.cAddr;
        baseAsset = vars.baseAsset;
        quoteAsset = vars.quoteAsset;
        mid = vars.mid;
        baseDec = vars.baseDec;
        quoteDec = vars.quoteDec;
        amountOfBase = vars.amountOfBase;
        pricePerBase = vars.pricePerBase;
        deployer = vars.deployer;
        marketCreator = vars.marketCreator;
        provider = vars.provider;
        swapper = vars.swapper;
        marketCreator2 = vars.marketCreator2;
        inventor = vars.inventor;
        user5 = vars.user5;

        deadline = now() + 100;

        await medMgr.updateTicketPool(0, vars.ticketBondAmt, 10, 10, 100, 100, 1, 0, 0, false, false);
    });

    async function createMarket(creator: SignerWithAddress = deployer, base: string, quote: string, baseType: number, quoteType: number, permPut: boolean, permSwap: boolean, commission: BigNumberish, mediatorPoolId: BigNumberish) {
        const mid = makeMarketID(creator.address, base, quote, baseType, quoteType);
        await mc.connect(creator).createMarket(base, quote, baseType, quoteType, permPut, permSwap, commission, mediatorPoolId);
        return Promise.resolve(mid);
    }

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
            usePriceFromRegistry: false,
            priceScaleBps: 0,
            expireAt: 0,
            pause: false,
            wantOrIds: [],
            wantAndIds: [],
            deduct: false,
        });
    }

    describe(".createOffer", () => {
        it("should revert with msg=ZERO_LIQ when liquidity does not exist", async () => {
            mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: 0,
                    price: 0,
                    ids: [],
                    deadline: 0,
                    operator: 0,
                }),
            ).to.be.revertedWith("OC: ZERO_LIQ");
        });

        it("should revert with msg=ZERO_LIQ when liquidity does not exist", async () => {
            mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: 0,
                    price: 0,
                    ids: [],
                    deadline: 0,
                    operator: 0,
                }),
            ).to.be.revertedWith("OC: ZERO_LIQ");
        });

        it("should revert with msg=PAST_DEADLINE when deadline is has passed", async () => {
            mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: 0,
                    operator: 0,
                }),
            ).to.be.revertedWith("OC: PAST_DEADLINE");
        });

        context("base = ERC20/SYNTH/NATIVE and quote = ERC20/SYNTH/NATIVE", () => {
            function test() {
                let params: any = {};
                beforeEach(async () => {
                    params = {marketId: mid, target: AddressZero, lid: 0, amount: 100, price: 100, timeToPay: 0, expireAt: 0, pause: false, usePriceFromRegistry: false, priceScaleBps: 0, wantOrIds: [], wantAndIds: [], deduct: false};
                });

                it("should revert with msg=AMOUNT_REQ when amount was not provided", async () => {
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 0,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: AMOUNT_REQ");
                });

                it("should revert with msg=MAX_PRICE_REQ when price was not provided", async () => {
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 1,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: MAX_PRICE_REQ");
                });

                it("should not revert with msg=MAX_PRICE_REQ when market allowed zero price", async () => {
                    mid = await createMarket(deployer, baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0, 0);
                    await mc.allowZeroOfferPrice(mid);
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 1,
                            price: 0,
                            ids: [],
                            deadline: 0,
                            operator: 0,
                        }),
                    ).not.to.be.revertedWith("OC: MAX_PRICE_REQ");
                });

                it("should revert with msg=LOW_LIQ when amount is more than liquidity", async () => {
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: amountOfBase.add(1),
                            price: 1,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: LOW_LIQ");
                });

                it("should not revert with msg=MAX_PRICE_TOO_LOW when price is greater than the liquidity's price", async () => {
                    await baseAsset.approve(cAddr, "100");
                    await expect(core.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: deployer.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 10,
                            price: 101,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).not.to.be.revertedWith("OC: MAX_PRICE_TOO_LOW");
                });

                it("should not revert with msg=MAX_PRICE_TOO_LOW when price is zero", async () => {
                    await baseAsset.approve(cAddr, "100");
                    await expect(core.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: deployer.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 10,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).not.to.be.revertedWith("OC: MAX_PRICE_TOO_LOW");
                });

                it("should successfully create offer", async () => {
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: amountOfBase,
                            price: 1,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    )
                        .to.emit(core, "NewOffer")
                        .withArgs(getAddress(mid), provider.address, 0, deployer.address, 1, amountOfBase, 1, [], deadline);
                });
            }

            context("base = ERC20 and quote = ERC20", () => {
                beforeEach(async () => {
                    deadline = (await advanceBlockTime(1)) + 20;
                    mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                });

                test();

                context("sender has insufficient quote balance", () => {
                    it("should revert with msg=LOW_BAL", async () => {
                        await provideLiquidity(provider, amountOfBase, pricePerBase);
                        await expect(
                            core.connect(swapper).createOffer({
                                marketId: mid,
                                provider: provider.address,
                                recipient: AddressZero,
                                lid: 0,
                                amount: amountOfBase,
                                price: 1,
                                ids: [],
                                deadline: deadline,
                                operator: 0,
                            }),
                        ).to.be.revertedWith("OC: LOW_BAL");
                    });
                });
            });

            context("base = ERC20 and quote = SYNTH", () => {
                beforeEach(async () => {
                    deadline = (await advanceBlockTime(1)) + 20;
                    mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0, 0);
                });

                test();
            });

            context("base = ERC20 and quote = NATIVE", () => {
                beforeEach(async () => {
                    deadline = (await advanceBlockTime(1)) + 20;
                    mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.NATIVE, false, false, 0, 0);
                });

                it("should revert with msg=AMOUNT_REQ when amount was not provided", async () => {
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 0,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: AMOUNT_REQ");
                });

                it("should revert with msg=MAX_PRICE_REQ when price was not provided", async () => {
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: amountOfBase,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: MAX_PRICE_REQ");
                });

                it("should revert with msg=LOW_BAL when sender has insufficient balance for offer cost", async () => {
                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                    const emptyWallet = ethers.Wallet.createRandom().connect(ethers.provider);
                    await provider.sendTransaction({to: emptyWallet.address, value: powOf(1, 18)});
                    await expect(
                        core.connect(emptyWallet).createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            price: pricePerBase,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: LOW_BAL");
                });

                it("should be successful with enough balance to cover cost", async () => {
                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            price: pricePerBase,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).not.to.be.reverted;
                });
            });

            context("base = NATIVE and quote = NATIVE", () => {
                let params;

                beforeEach(async () => {
                    deadline = (await advanceBlockTime(1)) + 20;
                    mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.NATIVE, false, false, 0, 0);
                    params = {
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        amount: amountOfBase,
                        price: pricePerBase,
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                    };
                    await core.connect(provider).updateFungibleLiquidity(params, {value: amountOfBase});
                });

                it("should revert with msg=AMOUNT_REQ when amount was not provided", async () => {
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 0,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: AMOUNT_REQ");
                });

                it("should revert with msg=MAX_PRICE_REQ when price was not provided", async () => {
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: amountOfBase,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: MAX_PRICE_REQ");
                });

                it("should revert with msg=LOW_BAL when sender has insufficient balance for offer cost", async () => {
                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    const emptyWallet = ethers.Wallet.createRandom().connect(ethers.provider);
                    await provider.sendTransaction({to: emptyWallet.address, value: powOf(1, 18)});
                    await expect(
                        core.connect(emptyWallet).createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            price: pricePerBase,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: LOW_BAL");
                });

                it("should be successful with enough balance to cover cost", async () => {
                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            price: pricePerBase,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).not.to.be.reverted;
                });
            });

            context("base = NATIVE and quote = ERC20", () => {
                let params;

                beforeEach(async () => {
                    deadline = (await advanceBlockTime(1)) + 20;
                    mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
                    params = {
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        amount: amountOfBase,
                        price: pricePerBase,
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                    };
                    await core.connect(provider).updateFungibleLiquidity(params, {value: amountOfBase});
                });

                it("should revert with msg=AMOUNT_REQ when amount was not provided", async () => {
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 0,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: AMOUNT_REQ");
                });

                it("should revert with msg=MAX_PRICE_REQ when price was not provided", async () => {
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: amountOfBase,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: MAX_PRICE_REQ");
                });

                it("should revert with msg=LOW_BAL when sender has insufficient balance for offer cost", async () => {
                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    await expect(
                        core.connect(user5).createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            price: pricePerBase,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: LOW_BAL");
                });

                it("should be successful with enough balance to cover cost", async () => {
                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            price: pricePerBase,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).not.to.be.reverted;
                });
            });

            context("base = NATIVE and quote = SYNTH", () => {
                let params;

                beforeEach(async () => {
                    deadline = (await advanceBlockTime(1)) + 20;
                    mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.SYNTH, false, false, 0, 0);
                    params = {
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        amount: amountOfBase,
                        price: pricePerBase,
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                    };
                    await core.connect(provider).updateFungibleLiquidity(params, {value: amountOfBase});
                });

                it("should revert with msg=AMOUNT_REQ when amount was not provided", async () => {
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 0,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: AMOUNT_REQ");
                });

                it("should revert with msg=MAX_PRICE_REQ when price was not provided", async () => {
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: amountOfBase,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: MAX_PRICE_REQ");
                });

                it("should not revert with msg=LOW_BAL since quote is a SYNTH", async () => {
                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    await expect(
                        core.connect(user5).createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            price: pricePerBase,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).not.to.be.reverted;
                });
            });

            context("base = SYNTH and quote = ERC20", () => {
                beforeEach(async () => {
                    deadline = (await advanceBlockTime(1)) + 20;
                    mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.ERC20, false, false, 0, 0);
                });

                test();
            });

            context("base = SYNTH and quote = SYNTH", () => {
                beforeEach(async () => {
                    deadline = (await advanceBlockTime(1)) + 20;
                    await core.setProtoFee(0, 0, 0, 0, 0, 0);
                    mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.SYNTH, false, false, 0, 0);
                });
                test();
            });

            context("base = SYNTH and quote = NATIVE", () => {
                beforeEach(async () => {
                    deadline = (await advanceBlockTime(1)) + 20;
                    mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.NATIVE, false, false, 0, 0);
                });

                it("should revert with msg=AMOUNT_REQ when amount was not provided", async () => {
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 0,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: AMOUNT_REQ");
                });

                it("should revert with msg=MAX_PRICE_REQ when price was not provided", async () => {
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: amountOfBase,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: MAX_PRICE_REQ");
                });

                it("should revert with msg=LOW_BAL when sender has insufficient balance for offer cost", async () => {
                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                    const emptyWallet = ethers.Wallet.createRandom().connect(ethers.provider);
                    await provider.sendTransaction({to: emptyWallet.address, value: powOf(1, 18)});
                    await expect(
                        core.connect(emptyWallet).createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            price: pricePerBase,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: LOW_BAL");
                });

                it("should be successful with enough balance to cover cost", async () => {
                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            price: pricePerBase,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).not.to.be.reverted;
                });
            });

            context("quote asset has non-standard decimals", () => {
                beforeEach(async () => {
                    let tokenFactory = await getContractFactory("TOKEN");
                    quoteAsset = (await tokenFactory.deploy("USDT", "USDT", "1000000000000", 6)) as TOKEN;
                    quoteAddr = quoteAsset.address;
                    quoteDec = toBN(10).pow(await quoteAsset.decimals());
                    amountOfBase = baseDec.mul(100);
                    pricePerBase = quoteDec.mul(10);

                    mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                });

                it("should revert with LOW_BAL when sender does not have sufficient balance for cost", async () => {
                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                    await expect(
                        core.connect(user5).createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            price: pricePerBase,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.revertedWith("OC: LOW_BAL");
                });

                it("should successfully create offer", async () => {
                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    await provideLiquidity(provider, amountOfBase, pricePerBase);
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: provider.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            price: pricePerBase,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    )
                        .to.emit(core, "NewOffer")
                        .withArgs(getAddress(mid), provider.address, 0, deployer.address, 1, swapAmt, pricePerBase, [], deadline);
                });
            });
        });

        context("base = NATIVE and quote = NFT (ERC721)", () => {
            let wantOrIds: BigNumber[] = [];
            let fungibleLiquidityParams: any;

            beforeEach(async () => {
                mid = await createMarket(marketCreator2, baseAddr, testERC721.address, AssetType.NATIVE, AssetType.ERC721, false, false, 0, 0);
                await testERC721.mint();
                wantOrIds = [toBN(1)];
                fungibleLiquidityParams = {
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
                    usePriceFromRegistry: false,
                    priceScaleBps: 0,
                };
            });

            it("should revert with msg=AMOUNT_NREQ when amount was provided", async () => {
                await core.connect(provider).updateFungibleLiquidity(fungibleLiquidityParams, {value: amountOfBase});
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 100,
                        price: 0,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("OC: AMOUNT_NREQ");
            });

            it("should revert with msg=IDS_REQ when IDs were not provided", async () => {
                await core.connect(provider).updateFungibleLiquidity(fungibleLiquidityParams, {value: amountOfBase});
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("OC: IDS_REQ");
            });

            it("should revert with msg='NOT_TOK_OWNER' when token is not owned by swapper", async () => {
                await core.connect(provider).updateFungibleLiquidity(fungibleLiquidityParams, {value: amountOfBase});
                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: [toBN(1)],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("OC: NOT_TOK_OWNER");
            });

            it("should revert with msg='ERC721: invalid token ID' when token does not exist", async () => {
                await core.connect(provider).updateFungibleLiquidity(fungibleLiquidityParams, {value: amountOfBase});
                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: [toBN(2)],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("ERC721: invalid token ID");
            });

            it("should create offer successfully", async () => {
                await core.connect(provider).updateFungibleLiquidity(fungibleLiquidityParams, {value: amountOfBase});
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: [...wantOrIds],
                        deadline: deadline,
                        operator: 0,
                    }),
                )
                    .to.emit(core, "NewOffer")
                    .withArgs(getAddress(mid), provider.address, 0, deployer.address, 1, toBN(0), toBN(0), [...wantOrIds], deadline);
            });
        });

        context("base = ERC20 and quote = NFT (ERC721)", () => {
            let wantOrIds: BigNumber[] = [];
            let fungibleLiquidityParams: any;

            beforeEach(async () => {
                mid = await createMarket(marketCreator2, baseAddr, testERC721.address, AssetType.ERC20, AssetType.ERC721, false, false, 0, 0);
                await testERC721.mint();
                wantOrIds = [toBN(1)];
                fungibleLiquidityParams = {
                    marketId: mid,
                    target: AddressZero,
                    lid: 0,
                    amount: 100,
                    price: 0,
                    timeToPay: 0,
                    expireAt: 0,
                    pause: false,
                    wantOrIds: wantOrIds,
                    wantAndIds: [],
                    deduct: false,
                    usePriceFromRegistry: false,
                    priceScaleBps: 0,
                };
            });

            it("should revert with msg=AMOUNT_NREQ when amount was provided", async () => {
                await baseAsset.approve(cAddr, "200");
                await expect(core.updateFungibleLiquidity(fungibleLiquidityParams)).to.emit(core, "UpdatedFungibleLiquidity");
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 100,
                        price: 0,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("OC: AMOUNT_NREQ");
            });

            it("should revert with msg='NOT_TOK_OWNER' when token is not owned by swapper", async () => {
                await baseAsset.approve(cAddr, "200");
                await expect(core.updateFungibleLiquidity(fungibleLiquidityParams)).to.emit(core, "UpdatedFungibleLiquidity");
                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: [toBN(1)],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("OC: NOT_TOK_OWNER");
            });

            it("should revert with msg='ERC721: invalid token ID' when token does not exist", async () => {
                await baseAsset.approve(cAddr, "200");
                await expect(core.updateFungibleLiquidity(fungibleLiquidityParams)).to.emit(core, "UpdatedFungibleLiquidity");
                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: [toBN(2)],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("ERC721: invalid token ID");
            });

            it("should create offer successfully", async () => {
                await baseAsset.approve(cAddr, "200");
                await expect(core.updateFungibleLiquidity(fungibleLiquidityParams)).to.emit(core, "UpdatedFungibleLiquidity");
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: [...wantOrIds],
                        deadline: deadline,
                        operator: 0,
                    }),
                )
                    .to.emit(core, "NewOffer")
                    .withArgs(getAddress(mid), deployer.address, 0, deployer.address, 1, toBN(0), toBN(0), [...wantOrIds], deadline);
            });
        });

        context("base = ERC20 and quote = NFT (ERC1155)", () => {
            let wantOrIds: BigNumber[] = [];

            beforeEach(async () => {
                mid = await createMarket(marketCreator2, baseAddr, testERC1155.address, AssetType.ERC20, AssetType.ERC1155, false, false, 0, 0);
                await testERC1155.mint(1);
                wantOrIds = [toBN(1)];
            });

            it("should revert with msg='NOT_TOK_OWNER' when token is not owned by swapper", async () => {
                await baseAsset.approve(cAddr, "200");
                await expect(core.updateFungibleLiquidity({marketId: mid, target: AddressZero, lid: 0, amount: 100, price: 0, timeToPay: 0, expireAt: 0, pause: false, usePriceFromRegistry: false, priceScaleBps: 0, wantOrIds: wantOrIds, wantAndIds: [], deduct: false})).to.emit(
                    core,
                    "UpdatedFungibleLiquidity",
                );
                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: [toBN(1)],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("OC: NOT_TOK_OWNER");
            });

            it("should revert with msg='OC: NOT_TOK_OWNER' when token does not exist", async () => {
                await baseAsset.approve(cAddr, "200");
                await expect(core.updateFungibleLiquidity({marketId: mid, target: AddressZero, lid: 0, amount: 100, price: 0, timeToPay: 0, expireAt: 0, pause: false, usePriceFromRegistry: false, priceScaleBps: 0, wantOrIds: wantOrIds, wantAndIds: [], deduct: false})).to.emit(
                    core,
                    "UpdatedFungibleLiquidity",
                );
                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: [toBN(2)],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("OC: NOT_TOK_OWNER");
            });

            it("should create offer successfully", async () => {
                await baseAsset.approve(cAddr, "200");
                await expect(core.updateFungibleLiquidity({marketId: mid, target: AddressZero, lid: 0, amount: 100, price: 0, timeToPay: 0, expireAt: 0, pause: false, usePriceFromRegistry: false, priceScaleBps: 0, wantOrIds: wantOrIds, wantAndIds: [], deduct: false})).to.emit(
                    core,
                    "UpdatedFungibleLiquidity",
                );
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: [...wantOrIds],
                        deadline: deadline,
                        operator: 0,
                    }),
                )
                    .to.emit(core, "NewOffer")
                    .withArgs(getAddress(mid), deployer.address, 0, deployer.address, 1, toBN(0), toBN(0), [...wantOrIds], deadline);
            });
        });

        context("base = SYNTH and quote = NFT", () => {
            let wantOrIds: BigNumber[] = [];
            let updateParams: any;

            beforeEach(async () => {
                await core.setProtoFee(0, 0, 0, 0, 0, 0);
                mid = await createMarket(marketCreator2, baseAddr, testERC721.address, AssetType.SYNTH, AssetType.ERC721, false, false, 0, 0);
                await testERC721.mint();
                wantOrIds = [toBN(1)];

                updateParams = {
                    marketId: mid,
                    target: AddressZero,
                    lid: 0,
                    amount: 100,
                    price: 0,
                    timeToPay: 0,
                    expireAt: 0,
                    pause: false,
                    wantOrIds: wantOrIds,
                    wantAndIds: [],
                    deduct: false,
                    usePriceFromRegistry: false,
                    priceScaleBps: 0,
                };
            });

            it("should revert with msg=AMOUNT_NREQ when amount was provided", async () => {
                await expect(core.updateFungibleLiquidity(updateParams)).to.emit(core, "UpdatedFungibleLiquidity");
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 100,
                        price: 0,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("OC: AMOUNT_NREQ");
            });

            it("should revert with msg='NOT_TOK_OWNER' when token is not owned by swapper", async () => {
                await expect(core.updateFungibleLiquidity(updateParams)).to.emit(core, "UpdatedFungibleLiquidity");
                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: [toBN(1)],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("OC: NOT_TOK_OWNER");
            });

            it("should revert with msg='ERC721: invalid token ID' when token does not exist", async () => {
                await expect(core.updateFungibleLiquidity(updateParams)).to.emit(core, "UpdatedFungibleLiquidity");
                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: [toBN(2)],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("ERC721: invalid token ID");
            });

            it("should create offer successfully", async () => {
                await expect(core.updateFungibleLiquidity(updateParams)).to.emit(core, "UpdatedFungibleLiquidity");
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: [...wantOrIds],
                        deadline: deadline,
                        operator: 0,
                    }),
                )
                    .to.emit(core, "NewOffer")
                    .withArgs(getAddress(mid), deployer.address, 0, deployer.address, 1, toBN(0), toBN(0), [...wantOrIds], deadline);
            });
        });

        context("base = NFT and quote = ERC20/SYNTH", () => {
            let ids: BigNumber[] = [];

            function test() {
                it("should revert with msg=AMOUNT_NREQ when amount was provided", async () => {
                    await expect(
                        core.updateNonFungibleLiquidity({
                            marketId: mid,
                            target: AddressZero,
                            lid: 0,
                            price: 100,
                            timeToPay: 0,
                            expireAt: 0,
                            usePriceFromRegistry: false,
                            priceScaleBps: 0,
                            pause: false,
                            ids,
                            wantOrIds: [],
                            wantAndIds: [],
                            deduct: false,
                        }),
                    ).to.emit(core, "UpdatedNonFungibleLiquidity");
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: deployer.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 100,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: AMOUNT_NREQ");
                });

                it("should revert with msg=MAX_PRICE_REQ when amount was not provided", async () => {
                    await expect(
                        core.updateNonFungibleLiquidity({
                            marketId: mid,
                            target: AddressZero,
                            lid: 0,
                            price: 100,
                            timeToPay: 0,
                            expireAt: 0,
                            usePriceFromRegistry: false,
                            priceScaleBps: 0,
                            pause: false,
                            ids,
                            wantOrIds: [],
                            wantAndIds: [],
                            deduct: false,
                        }),
                    ).to.emit(core, "UpdatedNonFungibleLiquidity");
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: deployer.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 0,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: MAX_PRICE_REQ");
                });

                it("should not revert with msg=MAX_PRICE_REQ when amount was not provided and market allow zero price offer", async () => {
                    await mc.connect(marketCreator2).allowZeroOfferPrice(mid);
                    await expect(
                        core.updateNonFungibleLiquidity({
                            marketId: mid,
                            target: AddressZero,
                            lid: 0,
                            price: 100,
                            timeToPay: 0,
                            expireAt: 0,
                            usePriceFromRegistry: false,
                            priceScaleBps: 0,
                            pause: false,
                            ids,
                            wantOrIds: [],
                            wantAndIds: [],
                            deduct: false,
                        }),
                    ).to.emit(core, "UpdatedNonFungibleLiquidity");
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: deployer.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 0,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).not.to.be.revertedWith("OC: MAX_PRICE_REQ");
                });

                it("should not revert with msg=MAX_PRICE_TOO_LOW when amount was not provided and market allow zero price offer", async () => {
                    await mc.connect(marketCreator2).allowZeroOfferPrice(mid);
                    await expect(
                        core.updateNonFungibleLiquidity({
                            marketId: mid,
                            target: AddressZero,
                            lid: 0,
                            price: 100,
                            timeToPay: 0,
                            expireAt: 0,
                            usePriceFromRegistry: false,
                            priceScaleBps: 0,
                            pause: false,
                            ids,
                            wantOrIds: [],
                            wantAndIds: [],
                            deduct: false,
                        }),
                    ).to.emit(core, "UpdatedNonFungibleLiquidity");
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: deployer.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 0,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).not.to.be.revertedWith("OC: MAX_PRICE_TOO_LOW");
                });

                it("should successfully create offer", async () => {
                    await mc.connect(marketCreator2).allowZeroOfferPrice(mid);
                    await expect(
                        core.updateNonFungibleLiquidity({
                            marketId: mid,
                            target: AddressZero,
                            lid: 0,
                            price: 100,
                            timeToPay: 0,
                            expireAt: 0,
                            usePriceFromRegistry: false,
                            priceScaleBps: 0,
                            pause: false,
                            ids,
                            wantOrIds: [],
                            wantAndIds: [],
                            deduct: false,
                        }),
                    ).to.emit(core, "UpdatedNonFungibleLiquidity");
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: deployer.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 0,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.emit(core, "NewOffer");
                });
            }

            context("base = NFT and quote = ERC20", () => {
                beforeEach(async () => {
                    await core.setProtoFee(0, 0, 0, 0, 0, 0);
                    mid = await createMarket(marketCreator2, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC20, false, false, 0, 0);
                    await testERC721.mint();
                    await testERC721.setApprovalForAll(core.address, true);
                    ids = [toBN(1)];
                });

                test();
            });

            context("base = NFT and quote = SYNTH", () => {
                beforeEach(async () => {
                    await core.setProtoFee(0, 0, 0, 0, 0, 0);
                    mid = await createMarket(marketCreator2, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, 0, 0);
                    await testERC721.mint();
                    await testERC721.setApprovalForAll(core.address, true);
                    ids = [toBN(1)];
                });
                test();
            });

            context("base = NFT and quote = NATIVE", () => {
                beforeEach(async () => {
                    deadline = (await advanceBlockTime(1)) + 20;
                    await core.setProtoFee(0, 0, 0, 0, 0, 0);
                    await testERC721.mint();
                    await testERC721.setApprovalForAll(core.address, true);
                    ids = [toBN(1)];
                    baseAddr = testERC721.address;
                    mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC721, AssetType.NATIVE, false, false, 0, 0);
                });

                it("should revert with msg=AMOUNT_NREQ when amount was provided", async () => {
                    await expect(
                        core.updateNonFungibleLiquidity({
                            marketId: mid,
                            target: AddressZero,
                            lid: 0,
                            price: 100,
                            timeToPay: 0,
                            expireAt: 0,
                            usePriceFromRegistry: false,
                            priceScaleBps: 0,
                            ids,
                            wantOrIds: [],
                            wantAndIds: [],
                            deduct: false,
                            pause: false,
                        }),
                    ).to.emit(core, "UpdatedNonFungibleLiquidity");
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: deployer.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 100,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: AMOUNT_NREQ");
                });

                it("should revert with msg=MAX_PRICE_REQ when price was not provided", async () => {
                    await expect(
                        core.updateNonFungibleLiquidity({
                            marketId: mid,
                            target: AddressZero,
                            lid: 0,
                            price: 100,
                            timeToPay: 0,
                            expireAt: 0,
                            usePriceFromRegistry: false,
                            priceScaleBps: 0,
                            ids,
                            wantOrIds: [],
                            wantAndIds: [],
                            deduct: false,
                            pause: false,
                        }),
                    ).to.emit(core, "UpdatedNonFungibleLiquidity");
                    await expect(
                        core.createOffer({
                            marketId: mid,
                            provider: deployer.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 0,
                            price: 0,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: MAX_PRICE_REQ");
                });

                it("should revert with msg=LOW_BAL when sender has insufficient balance to cover price", async () => {
                    await expect(
                        core.updateNonFungibleLiquidity({
                            marketId: mid,
                            target: AddressZero,
                            lid: 0,
                            price: 100,
                            timeToPay: 0,
                            expireAt: 0,
                            usePriceFromRegistry: false,
                            priceScaleBps: 0,
                            ids,
                            wantOrIds: [],
                            wantAndIds: [],
                            deduct: false,
                            pause: false,
                        }),
                    ).to.emit(core, "UpdatedNonFungibleLiquidity");
                    const price = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    const emptyWallet = ethers.Wallet.createRandom().connect(ethers.provider);
                    await provider.sendTransaction({to: emptyWallet.address, value: powOf(1, 18)});
                    await expect(
                        core.connect(emptyWallet).createOffer({
                            marketId: mid,
                            provider: deployer.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 0,
                            price: price,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).to.be.revertedWith("OC: LOW_BAL");
                });

                it("should revert with msg=LOW_BAL when sender has insufficient balance to cover price", async () => {
                    await expect(
                        core.updateNonFungibleLiquidity({
                            marketId: mid,
                            target: AddressZero,
                            lid: 0,
                            price: 100,
                            timeToPay: 0,
                            expireAt: 0,
                            usePriceFromRegistry: false,
                            priceScaleBps: 0,
                            ids,
                            wantOrIds: [],
                            wantAndIds: [],
                            deduct: false,
                            pause: false,
                        }),
                    ).to.emit(core, "UpdatedNonFungibleLiquidity");
                    const price = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    await expect(
                        core.connect(swapper).createOffer({
                            marketId: mid,
                            provider: deployer.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: 0,
                            price: price,
                            ids: [],
                            deadline: deadline,
                            operator: 0,
                        }),
                    ).not.to.be.reverted;
                });
            });
        });

        context("base = NFT and quote = NFT", () => {
            let ids: BigNumber[] = [];
            let wantIds: BigNumber[] = [];

            beforeEach(async () => {
                await core.setProtoFee(0, 0, 0, 0, 0, 0);
                mid = await createMarket(marketCreator2, testERC721.address, testERC721.address, AssetType.ERC721, AssetType.ERC721, false, false, 0, 0);
                await testERC721.mint();
                await testERC721.mint();
                await testERC721.setApprovalForAll(core.address, true);
                ids = [toBN(1)];
                wantIds = [toBN(2)];
            });

            it("should revert with msg=AMOUNT_NREQ when amount was provided", async () => {
                await expect(
                    core.updateNonFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        price: 0,
                        timeToPay: 0,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                        expireAt: 0,
                        ids: ids,
                        wantOrIds: [1],
                        wantAndIds: [],
                        deduct: false,
                        pause: false,
                    }),
                ).to.emit(core, "UpdatedNonFungibleLiquidity");
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 100,
                        price: 0,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("OC: AMOUNT_NREQ");
            });

            it("should revert with msg=MAX_PRICE_NREQ when price was provided", async () => {
                await expect(
                    core.updateNonFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        price: 0,
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                        ids: ids,
                        wantOrIds: [2],
                        wantAndIds: [],
                        deduct: false,
                    }),
                ).to.emit(core, "UpdatedNonFungibleLiquidity");
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 1,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("OC: MAX_PRICE_NREQ");
            });

            it("should revert with msg=IDS_REQ when token IDs was provided and market does not allow zero offer amount", async () => {
                await expect(
                    core.updateNonFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        price: 0,
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                        ids: ids,
                        wantOrIds: [2],
                        wantAndIds: [],
                        deduct: false,
                    }),
                ).to.emit(core, "UpdatedNonFungibleLiquidity");
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("OC: IDS_REQ");
            });

            it("should revert with msg='ERC721: invalid token ID' when token does not exist", async () => {
                await mc.connect(marketCreator2).allowZeroOfferPrice(mid);
                await expect(
                    core.updateNonFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        price: 0,
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                        ids: ids,
                        wantOrIds: [3],
                        wantAndIds: [],
                        deduct: false,
                    }),
                ).to.emit(core, "UpdatedNonFungibleLiquidity");
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: [3],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("ERC721: invalid token ID");
            });

            it("should revert with msg='NOT_TOK_OWNER' when sender is not the owner of token", async () => {
                await mc.connect(marketCreator2).allowZeroOfferPrice(mid);
                await expect(
                    core.updateNonFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        price: 0,
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                        ids: ids,
                        wantOrIds: [2],
                        wantAndIds: [],
                        deduct: false,
                    }),
                ).to.emit(core, "UpdatedNonFungibleLiquidity");
                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: [2],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.be.revertedWith("OC: NOT_TOK_OWNER");
            });

            it("should successfully create offer", async () => {
                await mc.connect(marketCreator2).allowZeroOfferPrice(mid);
                await expect(
                    core.updateNonFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        price: 0,
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                        ids: ids,
                        wantOrIds: wantIds,
                        wantAndIds: [],
                        deduct: false,
                    }),
                ).to.emit(core, "UpdatedNonFungibleLiquidity");
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: deployer.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: wantIds,
                        deadline: deadline,
                        operator: 0,
                    }),
                ).to.emit(core, "NewOffer");
            });
        });
    });

    describe(".updateOffer", () => {
        beforeEach(async () => {
            deadline = 20;
            mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
        });

        it("should revert with msg=UNKNOWN_OFFER when offer was not found", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(core.updateOffer(0, 0, 0, [], 0)).to.be.revertedWith("OC: UNKNOWN_OFFER");
        });

        it("should revert with msg=NOT_CREATOR when offer was not created by the sender", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await expect(core.connect(swapper).updateOffer(0, 0, 0, [], 0)).to.be.revertedWith("OC: NOT_CREATOR");
        });

        it("should revert with msg=OFFER_EXPIRED when offer deadline has passed", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await advanceBlockTime(100);
            await expect(core.updateOffer(0, 0, 0, [], 0)).to.be.revertedWith("OC: OFFER_EXPIRED");
        });

        it("should revert with msg=AMOUNT_REQ when amount is zero (validation check)", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await expect(core.updateOffer(0, 0, 0, [], deadline)).to.be.revertedWith("OC: AMOUNT_REQ");
        });

        it("should successfully update offer", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            const price = 2;
            const now = await advanceBlockTime(1);
            await expect(core.updateOffer(0, 1, price, [], deadline))
                .to.emit(core, "OfferUpdated")
                .withArgs(0, deployer.address, 1, price, [], deadline);
            const offer = await core.getOffer(0);
            expect(offer.price).to.eq(price);
            expect(offer.deadline).to.eq(now + deadline + 1);
            expect(offer.accepted).to.be.false;
        });

        context("with deadline=0", () => {
            it("should leave deadline unchanged", async () => {
                await provideLiquidity(provider, amountOfBase, pricePerBase);
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: amountOfBase,
                        price: 1,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).not.to.be.reverted;
                const price = 2;
                const now = await advanceBlockTime(1);
                const offer = await core.getOffer(0);
                await expect(core.updateOffer(0, 1, price, [], 0))
                    .to.emit(core, "OfferUpdated")
                    .withArgs(0, deployer.address, 1, price, [], 0);
                const offerNew = await core.getOffer(0);
                expect(offerNew.deadline).to.eq(offer.deadline);
            });
        });

        context("when offer was already accepted", () => {
            beforeEach(async () => {
                await provideLiquidity(provider, amountOfBase, pricePerBase);
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: amountOfBase,
                        price: 1,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).not.to.be.reverted;
                await expect(core.connect(provider).acceptOffer(0, 0)).emit(core, "OfferAccepted");
                const offer = await core.getOffer(0);
                expect(offer.accepted).to.be.true;
            });

            it("should reset accept status to false", async () => {
                await expect(core.updateOffer(0, 1, 2, [], deadline)).not.to.be.reverted;
                const offer = await core.getOffer(0);
                expect(offer.accepted).to.be.false;
            });
        });
    });

    describe(".acceptOffer", function () {
        beforeEach(async () => {
            deadline = 20;
            mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
        });

        it("should revert with msg=UNKNOWN_OFFER when offer was not found", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(core.acceptOffer(0, 0)).to.be.revertedWith("OC: UNKNOWN_OFFER");
        });

        it("should revert with msg=NOT_PROVIDER when sender is not the liquidity provider", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await expect(core.acceptOffer(0, 0)).to.be.revertedWith("OC: NOT_PROVIDER");
        });

        it("should revert with msg=OFFER_EXPIRED when offer deadline has passed", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await advanceBlockTime(100);
            await expect(core.connect(provider).acceptOffer(0, 0)).to.be.revertedWith("OC: OFFER_EXPIRED");
        });

        it("should successfully accept offer", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await expect(core.connect(provider).acceptOffer(0, 0)).emit(core, "OfferAccepted");
            const offer = await core.getOffer(0);
            expect(offer.accepted).to.be.true;
        });

        context("with a delay", () => {
            it("should successfully accept offer", async () => {
                await provideLiquidity(provider, amountOfBase, pricePerBase);
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: amountOfBase,
                        price: 1,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).not.to.be.reverted;
                const now = await advanceBlockTime(1);
                const delay = 100;
                await expect(core.connect(provider).acceptOffer(0, delay)).emit(core, "OfferAccepted");
                const offer = await core.getOffer(0);
                expect(offer.accepted).to.be.true;
                expect(offer.execAt).to.eq(now + delay + 1);
            });
        });

        it("should revert with msg=ALREADY_ACCEPTED when offer was already accepted", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await expect(core.connect(provider).acceptOffer(0, 0)).emit(core, "OfferAccepted");
            await expect(core.connect(provider).acceptOffer(0, 0)).to.be.revertedWith("OC: ALREADY_ACCEPTED");
        });
    });

    describe(".cancelOffer", function () {
        beforeEach(async () => {
            deadline = 20;
            mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
        });

        it("should revert with msg=UNKNOWN_OFFER when offer was not found", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(core.cancelOffer(0)).to.be.revertedWith("OC: UNKNOWN_OFFER");
        });

        it("should revert with msg=NOT_CREATOR when sender is not the offer creator", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await expect(core.connect(provider).cancelOffer(0)).to.be.revertedWith("OC: NOT_CREATOR");
        });

        it("should revert with msg=OFFER_EXPIRED when offer deadline has passed", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await advanceBlockTime(100);
            await expect(core.cancelOffer(0)).to.be.revertedWith("OC: OFFER_EXPIRED");
        });

        it("should successfully accept offer", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await expect(core.cancelOffer(0)).emit(core, "OfferCancelled");
            const offer = await core.getOffer(0);
            expect(offer.cancelled).to.be.true;
        });

        it("should revert with msg=ALREADY_CANCELLED when offer was already cancelled", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await expect(core.cancelOffer(0)).emit(core, "OfferCancelled");
            await expect(core.cancelOffer(0)).to.be.revertedWith("OC: ALREADY_CANCELLED");
        });
    });

    describe(".executeOrder", () => {
        beforeEach(async () => {
            deadline = (await advanceBlockTime(1)) + 20;
            await core.setProtoFee(0, 0, 0, 0, 0, 0);
        });

        it("should revert with msg=EXPIRED_TX when transaction has expired", async () => {
            mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(core.executeOffer(0, 1)).to.be.revertedWith("OC: EXPIRED_TX");
        });

        it("should revert with msg=UNKNOWN_OFFER when offer was not found", async () => {
            mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            const now = await advanceBlockTime(1);
            await expect(core.executeOffer(0, now + 10)).to.be.revertedWith("OC: UNKNOWN_OFFER");
        });

        it("should revert with msg=NOT_CREATOR when sender is not the offer creator", async () => {
            mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await expect(core.connect(provider).executeOffer(0, 0)).to.be.revertedWith("OC: NOT_CREATOR");
        });

        it("should revert with msg=NOT_ACCEPTED when offer has not been accepted", async () => {
            mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await expect(core.executeOffer(0, 0)).to.be.revertedWith("OC: NOT_ACCEPTED");
        });

        context("base = ERC20 and quote = ERC20", () => {
            beforeEach(async () => {
                mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            });

            it("should revert with msg=DELAY_ACTIVE when offer has a delay", async () => {
                const offerPrice = toBN(1);
                const offerAmt = amountOfBase;

                await provideLiquidity(provider, amountOfBase, pricePerBase);
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: offerAmt,
                        price: offerPrice,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).not.to.be.reverted;
                await core.connect(provider).acceptOffer(0, 100);

                const cost = offerAmt.mul(offerPrice).div(pow10(18));
                await quoteAsset.approve(core.address, cost);
                await expect(core.executeOffer(0, 0)).to.be.revertedWith("OC: DELAY_ACTIVE");
            });

            it("should successfully execute offer", async () => {
                const offerPrice = toBN(1);
                const offerAmt = amountOfBase;

                await provideLiquidity(provider, amountOfBase, pricePerBase);
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: offerAmt,
                        price: offerPrice,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).not.to.be.reverted;
                await core.connect(provider).acceptOffer(0, 0);

                const cost = offerAmt.mul(offerPrice).div(pow10(18));
                await quoteAsset.approve(core.address, cost);
                const oldOffererQuoteBal = await quoteAsset.balanceOf(deployer.address);
                const oldOffererBaseBal = await baseAsset.balanceOf(deployer.address);

                await expect(core.executeOffer(0, 0)).emit(core, "OfferExecuted").emit(core, "Swap");

                const newOffererQuoteBal = await quoteAsset.balanceOf(deployer.address);
                expect(oldOffererQuoteBal).to.eql(newOffererQuoteBal.add(cost));
                const newOffererBaseBal = await baseAsset.balanceOf(deployer.address);
                expect(newOffererBaseBal).to.eql(oldOffererBaseBal.add(offerAmt));
            });

            it("should successfully execute offer when offer price is zero", async () => {
                const offerPrice = toBN(0);
                const offerAmt = amountOfBase;

                await mc.connect(marketCreator2).allowZeroOfferPrice(mid);
                await provideLiquidity(provider, amountOfBase, pricePerBase);
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: offerAmt,
                        price: offerPrice,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).not.to.be.reverted;
                await core.connect(provider).acceptOffer(0, 0);

                const cost = offerAmt.mul(offerPrice).div(pow10(18));
                await quoteAsset.approve(core.address, cost);
                const oldOffererQuoteBal = await quoteAsset.balanceOf(deployer.address);
                const oldOffererBaseBal = await baseAsset.balanceOf(deployer.address);

                await expect(core.executeOffer(0, 0)).emit(core, "OfferExecuted");

                const newOffererQuoteBal = await quoteAsset.balanceOf(deployer.address);
                expect(oldOffererQuoteBal).to.eql(newOffererQuoteBal.add(cost));
                const newOffererBaseBal = await baseAsset.balanceOf(deployer.address);
                expect(newOffererBaseBal).to.eql(oldOffererBaseBal.add(offerAmt));
            });
        });

        context("base = ERC20 and quote = SYNTH", () => {
            beforeEach(async () => {
                mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0, 0);
            });

            it("should successfully execute offer", async () => {
                const offerPrice = toBN(1);
                const offerAmt = amountOfBase;
                await provideLiquidity(provider, amountOfBase, pricePerBase);
                await expect(
                    core.createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: offerAmt,
                        price: offerPrice,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).not.to.be.reverted;
                await core.connect(provider).acceptOffer(0, 0);
                await expect(core.executeOffer(0, 0)).emit(core, "OfferExecuted").emit(core, "SwapOrder");
            });
        });

        context("base = ERC20 and quote = ERC721", () => {
            beforeEach(async () => {
                mid = await createMarket(marketCreator2, baseAddr, testERC721.address, AssetType.ERC20, AssetType.ERC721, false, false, 0, 0);
                await baseAsset.transfer(provider.address, amountOfBase);
                await baseAsset.connect(provider).approve(core.address, amountOfBase);
            });

            it("should successfully execute offer", async () => {
                await testERC721.connect(swapper).mint();
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
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                        wantOrIds: wantOrIds,
                        wantAndIds: [],
                        deduct: false,
                    }),
                ).not.to.be.reverted;

                const ids = [2];
                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: ids,
                        deadline: deadline,
                        operator: 0,
                    }),
                ).not.to.be.reverted;
                await core.connect(provider).acceptOffer(0, 0);
                await expect(core.connect(swapper).executeOffer(0, 0)).emit(core, "OfferExecuted").emit(core, "Swap");

                expect(await testERC721.ownerOf(2)).to.eql(provider.address);
                expect(await baseAsset.balanceOf(swapper.address)).to.eql(amountOfBase);
            });
        });

        context("base = ERC20 and quote = ERC1155", () => {
            beforeEach(async () => {
                mid = await createMarket(marketCreator2, baseAddr, testERC1155.address, AssetType.ERC20, AssetType.ERC1155, false, false, 0, 0);
                await baseAsset.transfer(provider.address, amountOfBase);
                await baseAsset.connect(provider).approve(core.address, amountOfBase);
            });

            it("should successfully execute offer", async () => {
                await testERC1155.connect(swapper).mint(1);
                await testERC1155.connect(swapper).mint(2);
                await testERC1155.connect(swapper).setApprovalForAll(core.address, true);

                const wantOrIds = [1];
                await expect(core.connect(provider).updateFungibleLiquidity({marketId: mid, target: AddressZero, lid: 0, amount: amountOfBase, price: 0, timeToPay: 0, expireAt: 0, pause: false, usePriceFromRegistry: false, priceScaleBps: 0, wantOrIds: wantOrIds, wantAndIds: [], deduct: false})).not
                    .to.be.reverted;

                const ids = [2];
                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: ids,
                        deadline: deadline,
                        operator: 0,
                    }),
                ).not.to.be.reverted;
                await core.connect(provider).acceptOffer(0, 0);
                await expect(core.connect(swapper).executeOffer(0, 0)).emit(core, "OfferExecuted").emit(core, "Swap");

                expect(await testERC1155.balanceOf(provider.address, 2)).to.eq(1);
                expect(await baseAsset.balanceOf(swapper.address)).to.eql(amountOfBase);
            });
        });

        context("base = SYNTH and quote = ERC20", () => {
            beforeEach(async () => {
                mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.ERC20, false, false, 0, 0);
            });

            it("should successfully execute offer", async () => {
                await core.connect(provider).updateFungibleLiquidity({
                    marketId: mid,
                    target: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: pricePerBase,
                    timeToPay: 0,
                    expireAt: 0,
                    pause: false,
                    usePriceFromRegistry: false,
                    priceScaleBps: 0,
                    wantOrIds: [],
                    wantAndIds: [],
                    deduct: false,
                });

                const swapAmt = toBN(5).mul(quoteDec);
                const swapCost = swapAmt.div(quoteDec).mul(pricePerBase); // amount the swapper will pay in QUOTE (=50 QUOTE)

                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: swapAmt,
                        price: pricePerBase,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).not.to.be.reverted;
                await core.connect(provider).acceptOffer(0, 0);
                await expect(core.connect(swapper).executeOffer(0, 0)).emit(core, "OfferExecuted").emit(core, "SwapOrder");

                expect(await quoteAsset.balanceOf(swapper.address)).to.eq(0);
            });
        });

        context("base = SYNTH and quote = SYNTH", () => {
            beforeEach(async () => {
                mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.SYNTH, false, false, 0, 0);
            });

            it("should successfully execute offer", async () => {
                await core.connect(provider).updateFungibleLiquidity({
                    marketId: mid,
                    target: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: pricePerBase,
                    timeToPay: 0,
                    expireAt: 0,
                    pause: false,
                    usePriceFromRegistry: false,
                    priceScaleBps: 0,
                    wantOrIds: [],
                    wantAndIds: [],
                    deduct: false,
                });
                const swapAmt = toBN(5).mul(quoteDec);
                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: swapAmt,
                        price: pricePerBase,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).not.to.be.reverted;
                await core.connect(provider).acceptOffer(0, 0);
                await expect(core.connect(swapper).executeOffer(0, 0)).emit(core, "OfferExecuted").emit(core, "SwapOrder");
            });
        });

        context("base = SYNTH and quote = ERC721", () => {
            beforeEach(async () => {
                mid = await createMarket(marketCreator2, baseAddr, testERC721.address, AssetType.SYNTH, AssetType.ERC721, false, false, 0, 0);
            });

            it("should successfully execute offer", async () => {
                await testERC721.connect(swapper).mint();
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
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                        wantOrIds: wantOrIds,
                        wantAndIds: [],
                        deduct: false,
                    }),
                ).not.to.be.reverted;

                const ids = [2];
                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: ids,
                        deadline: deadline,
                        operator: 0,
                    }),
                ).not.to.be.reverted;
                await core.connect(provider).acceptOffer(0, 0);
                await expect(core.connect(swapper).executeOffer(0, 0)).emit(core, "OfferExecuted").emit(core, "SwapOrder");

                expect(await testERC721.ownerOf(2)).to.eql(core.address);
            });
        });

        context("base = ERC721 and quote = ERC20", () => {
            beforeEach(async () => {
                mid = await createMarket(marketCreator2, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC20, false, false, 0, 0);
                await quoteAsset.transfer(swapper.address, pricePerBase);
                await quoteAsset.connect(swapper).approve(core.address, pricePerBase);
                await testERC721.connect(provider).mint();
                await testERC721.connect(provider).mint();
                await testERC721.connect(provider).setApprovalForAll(core.address, true);
            });

            it("should successfully execute offer", async () => {
                const ids = [toBN(1), toBN(2)];
                await expect(
                    core.connect(provider).updateNonFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        price: pricePerBase,
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                        ids: ids,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                    }),
                ).not.to.be.reverted;

                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 1,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).not.to.be.reverted;
                await core.connect(provider).acceptOffer(0, 0);
                await expect(core.connect(swapper).executeOffer(0, 0)).emit(core, "OfferExecuted").emit(core, "Swap");

                expect(await quoteAsset.balanceOf(provider.address)).to.eq(1);
            });
        });

        context("base = ERC721 and quote = SYNTH", () => {
            beforeEach(async () => {
                mid = await createMarket(marketCreator2, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, 0, 0);
                await testERC721.connect(provider).mint();
                await testERC721.connect(provider).mint();
                await testERC721.connect(provider).setApprovalForAll(core.address, true);
            });

            it("should successfully execute offer", async () => {
                const ids = [toBN(1), toBN(2)];
                await expect(
                    core.connect(provider).updateNonFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        price: pricePerBase,
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                        ids: ids,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 1,
                        ids: [],
                        deadline: deadline,
                        operator: 0,
                    }),
                ).not.to.be.reverted;
                await core.connect(provider).acceptOffer(0, 0);
                await expect(core.connect(swapper).executeOffer(0, 0)).emit(core, "OfferExecuted").emit(core, "SwapOrder");
            });
        });

        context("base = ERC721 and quote = ERC721", () => {
            beforeEach(async () => {
                mid = await createMarket(marketCreator2, testERC721.address, testERC721.address, AssetType.ERC721, AssetType.ERC721, false, false, 0, 0);
                await testERC721.connect(provider).mint();
                await testERC721.connect(provider).mint();
                await testERC721.connect(swapper).mint();
                await testERC721.connect(swapper).mint();
                await testERC721.connect(provider).setApprovalForAll(core.address, true);
                await testERC721.connect(swapper).setApprovalForAll(core.address, true);
            });

            it("should successfully execute offer", async () => {
                const ids = [toBN(1), toBN(2)];
                const wantAndIds = [toBN(3), toBN(4)];
                await expect(
                    core.connect(provider).updateNonFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        price: 0,
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                        ids: ids,
                        wantOrIds: [],
                        wantAndIds: wantAndIds,
                        deduct: false,
                    }),
                ).not.to.be.reverted;

                const offeredIds = [toBN(3)];
                await expect(
                    core.connect(swapper).createOffer({
                        marketId: mid,
                        provider: provider.address,
                        recipient: AddressZero,
                        lid: 0,
                        amount: 0,
                        price: 0,
                        ids: offeredIds,
                        deadline: deadline,
                        operator: 0,
                    }),
                ).not.to.be.reverted;
                await core.connect(provider).acceptOffer(0, 0);
                await expect(core.connect(swapper).executeOffer(0, 0)).emit(core, "OfferExecuted").emit(core, "Swap");

                expect(await testERC721.ownerOf(1)).to.eql(swapper.address);
                expect(await testERC721.ownerOf(2)).to.eql(swapper.address);
                expect(await testERC721.ownerOf(3)).to.eql(provider.address);
            });
        });
    });

    describe(".unacceptOffer", function () {
        beforeEach(async () => {
            mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            deadline = (await advanceBlockTime(1)) + 20;
            await core.setProtoFee(0, 0, 0, 0, 0, 0);
        });

        it("should revert with msg=UNKNOWN_OFFER when offer was not found", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(core.unacceptOffer(0)).to.be.revertedWith("OC: UNKNOWN_OFFER");
        });

        it("should revert with msg=NOT_PROVIDER when sender is not the liquidity provider", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await expect(core.unacceptOffer(0)).to.be.revertedWith("OC: NOT_PROVIDER");
        });

        it("should revert with msg=NOT_ACCEPTED when offer has not been accepted", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await expect(core.connect(provider).unacceptOffer(0)).to.be.revertedWith("OC: NOT_ACCEPTED");
        });

        it("should successfully unaccept offer", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: amountOfBase,
                    price: 1,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await core.connect(provider).acceptOffer(0, 0);
            await expect(core.connect(provider).unacceptOffer(0)).emit(core, "OfferUnaccepted");
            const offer = await core.getOffer(0);
            expect(offer.accepted).to.be.false;
            expect(offer.execAt).to.eq(0);
        });

        it("should revert with msg=OFFER_EXECUTED when offer has already been executed", async () => {
            const offerPrice = toBN(1);
            const offerAmt = amountOfBase;

            await provideLiquidity(provider, amountOfBase, pricePerBase);
            await expect(
                core.createOffer({
                    marketId: mid,
                    provider: provider.address,
                    recipient: AddressZero,
                    lid: 0,
                    amount: offerAmt,
                    price: offerPrice,
                    ids: [],
                    deadline: deadline,
                    operator: 0,
                }),
            ).not.to.be.reverted;
            await core.connect(provider).acceptOffer(0, 0);

            const cost = offerAmt.mul(offerPrice).div(pow10(18));
            await quoteAsset.approve(core.address, cost);

            await expect(core.executeOffer(0, 0)).emit(core, "OfferExecuted").emit(core, "Swap");

            await expect(core.connect(provider).unacceptOffer(0)).to.revertedWith("OC: OFFER_EXECUTED");
        });
    });
});
