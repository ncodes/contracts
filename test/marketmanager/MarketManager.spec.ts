import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {BigNumber, BigNumberish, utils} from "ethers";
import {ethers} from "hardhat";
import {Core, MarketCore, MarketManager, MediatorManager, PayRouter, TOKEN} from "../../typechain-types";
import {AddressZero, advanceBlockTime, AssetType, makeMarketID, SourceType, toBN, toDec} from "../../utils/utils";
import {initCoreTestSuite} from "../helpers/helpers";
const {getContractFactory} = ethers;
const {expect} = require("chai");

describe("MarketManager", function () {
    let baseAddr: string;
    let quoteAddr: string;
    let deployer: SignerWithAddress;
    let cAddr: string;
    let core: Core;
    let mc: MarketCore;
    let mktMgr: MarketManager;
    let payRouter: PayRouter;
    let token: TOKEN;
    let baseAsset: TOKEN;
    let quoteAsset: TOKEN;
    let mid: string;
    let tokenDec: BigNumber;
    let baseDec: BigNumber;
    let quoteDec: BigNumber;
    let medMgr: MediatorManager;
    let amountOfBase: BigNumber;
    let pricePerBase: BigNumber;
    const abi = utils.defaultAbiCoder;
    let marketCreator: SignerWithAddress, provider: SignerWithAddress, swapper: SignerWithAddress, marketCreator2: SignerWithAddress, inventor: SignerWithAddress;

    beforeEach(async () => {
        const vars = await initCoreTestSuite();
        deployer = vars.deployer;
        baseAddr = vars.baseAddr;
        quoteAddr = vars.quoteAddr;
        core = vars.core;
        cAddr = vars.cAddr;
        mc = vars.mc;
        medMgr = vars.mediatorMgr;
        token = vars.token;
        baseAsset = vars.baseAsset;
        quoteAsset = vars.quoteAsset;
        mid = vars.mid;
        tokenDec = vars.tokenDec;
        baseDec = vars.baseDec;
        quoteDec = vars.quoteDec;
        amountOfBase = vars.amountOfBase;
        pricePerBase = vars.pricePerBase;
        marketCreator = vars.marketCreator;
        provider = vars.provider;
        swapper = vars.swapper;
        marketCreator2 = vars.marketCreator2;
        inventor = vars.inventor;

        let factory = await getContractFactory("PayRouter");
        payRouter = (await factory.deploy(token.address)) as PayRouter;

        await medMgr.updateTicketPool(0, 0, 1, 1, 1, 1, 1, 1, 1, false, false);
        factory = await getContractFactory("MarketManager", {libraries: {MarketAuxLib: vars.libs.MarketAuxLib.address}});
        mktMgr = (await factory.deploy(core.address, payRouter.address)) as MarketManager;

        expect(await mktMgr.delegates(deployer.address)).to.be.true;
    });

    async function createMarket(creator: SignerWithAddress = deployer, mktMgr: string, base: string, quote: string, baseType: number, quoteType: number, permPut: boolean, permSwap: boolean, commission: BigNumberish, mediatorPoolId: BigNumberish) {
        const mid = makeMarketID(creator.address, base, quote, baseType, quoteType);
        await mc.connect(creator).createMarketWithManager(base, quote, baseType, quoteType, permPut, permSwap, commission, mediatorPoolId, mktMgr);
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
            expireAt: 0,
            pause: false,
            wantOrIds: [],
            wantAndIds: [],
            deduct: false,
        });
    }

    beforeEach(async () => {
        mid = await createMarket(deployer, mktMgr.address, baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0, 0);
        await payRouter.createOrg("AcmeBank");
        await payRouter.createOrg("ECorpBank");

        await payRouter.createRoute({
            source: SourceType.Org,
            sourceOrgId: 1,
            sourceToken: AddressZero,
            owner: AddressZero,
            destOrgId: 2,
            bond: 0,
            requesters: [mktMgr.address],
        });

        await payRouter.createRoute({
            source: SourceType.Org,
            sourceOrgId: 2,
            sourceToken: AddressZero,
            owner: AddressZero,
            destOrgId: 2,
            bond: 0,
            requesters: [mktMgr.address],
        });
    });

    describe(".addDelegate", () => {
        it("should add a delegate", async () => {
            expect(await mktMgr.delegates(swapper.address)).to.be.false;
            await expect(mktMgr.addDelegate(swapper.address)).to.emit(mktMgr, "UpdatedDelegate").withArgs(swapper.address, true);
            expect(await mktMgr.delegates(swapper.address)).to.be.true;
        });

        it("should revert if the caller is not the owner", async () => {
            await expect(mktMgr.connect(swapper).addDelegate(swapper.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });
    });

    describe(".removeDelegate", () => {
        it("should remove a delegate", async () => {
            expect(await mktMgr.delegates(swapper.address)).to.be.false;
            await expect(mktMgr.addDelegate(swapper.address)).to.emit(mktMgr, "UpdatedDelegate").withArgs(swapper.address, true);
            expect(await mktMgr.delegates(swapper.address)).to.be.true;
            await expect(mktMgr.removeDelegate(swapper.address)).to.emit(mktMgr, "UpdatedDelegate").withArgs(swapper.address, false);
            expect(await mktMgr.delegates(swapper.address)).to.be.false;
        });

        it("should revert if the caller is not the owner", async () => {
            await expect(mktMgr.connect(swapper).removeDelegate(swapper.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });
    });

    describe(".beforeSwap", () => {
        it("should revert if the caller is not the core", async () => {
            await mktMgr.setCore(AddressZero);

            await provideLiquidity(provider, amountOfBase, pricePerBase);

            const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
            const swapCost = swapAmt.mul(pricePerBase).div(baseDec);
            await quoteAsset.transfer(swapper.address, swapCost);
            await quoteAsset.connect(swapper).approve(cAddr, swapCost);

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
                    marketMgrData: abi.encode(
                        ["uint256[]", "uint256[]"],
                        [
                            [0, 1],
                            [0, 0],
                        ],
                    ),
                }),
            ).to.be.revertedWith("MM: NOT_CORE");
        });
    });

    describe(".afterSwap", () => {
        it("should create a request after a swap order is created", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);

            const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
            const swapCost = swapAmt.mul(pricePerBase).div(baseDec);
            await quoteAsset.transfer(swapper.address, swapCost);
            await quoteAsset.connect(swapper).approve(cAddr, swapCost);

            const params = {
                marketId: mid,
                provider: provider.address,
                recipient: AddressZero,
                lid: 0,
                amount: swapAmt,
                maxPrice: pricePerBase,
                ids: [],
                expireAt: 0,
                operator: 0,
                marketMgrData: abi.encode(
                    ["uint256[]", "uint256[]"],
                    [
                        [0, 1],
                        [0, 0],
                    ],
                ),
            };

            await mktMgr.setCore(AddressZero);
            await expect(core.connect(swapper).swapQuoteForBase(params)).to.be.revertedWith("MM: NOT_CORE");

            await mktMgr.setCore(core.address);
            await expect(core.connect(swapper).swapQuoteForBase(params)).not.to.be.reverted;

            const order = await core.getOrder(0);
            expect(order.amount).to.eq(swapAmt);

            const reqInfo = await mktMgr.requestInfo(0);
            expect(reqInfo.exists).to.be.true;
            expect(reqInfo.requestId).to.eq(0);
            expect(reqInfo.orderId).to.eq(0);
        });
    });

    describe(".onCancel", () => {
        it("should cancel the request", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
            const swapCost = swapAmt.mul(pricePerBase).div(baseDec);
            await quoteAsset.transfer(swapper.address, swapCost);
            await quoteAsset.connect(swapper).approve(cAddr, swapCost);

            const params = {
                marketId: mid,
                provider: provider.address,
                recipient: AddressZero,
                lid: 0,
                amount: swapAmt,
                maxPrice: pricePerBase,
                ids: [],
                expireAt: 0,
                operator: 0,
                marketMgrData: abi.encode(
                    ["uint256[]", "uint256[]"],
                    [
                        [0, 1],
                        [0, 0],
                    ],
                ),
            };

            await mktMgr.setCore(AddressZero);
            await expect(core.connect(swapper).swapQuoteForBase(params)).to.be.revertedWith("MM: NOT_CORE");

            await mktMgr.setCore(core.address);
            await expect(core.connect(swapper).swapQuoteForBase(params)).not.to.be.reverted;

            await advanceBlockTime(3600);
            await expect(core.connect(swapper).cancelOrder(0)).not.to.be.reverted;

            const reqInfo = await mktMgr.requestInfo(0);
            expect(reqInfo.exists).to.be.true;
            const req = await payRouter.getRequest(reqInfo.requestId);
            expect(req.cancelled).to.be.true;
            expect(req.closed).to.be.true;
        });
    });

    describe(".onPaid", () => {
        it("should mark the request source as paid", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
            const swapCost = swapAmt.mul(pricePerBase).div(baseDec);
            await quoteAsset.transfer(swapper.address, swapCost);
            await quoteAsset.connect(swapper).approve(cAddr, swapCost);

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
                    marketMgrData: abi.encode(
                        ["uint256[]", "uint256[]"],
                        [
                            [0, 1],
                            [0, 0],
                        ],
                    ),
                }),
            ).not.to.be.reverted;

            await mktMgr.setCore(AddressZero);
            await expect(core.connect(swapper).markOrderAsPaid(0)).to.be.revertedWith("MM: NOT_CORE");

            await mktMgr.setCore(core.address);
            await expect(core.connect(swapper).markOrderAsPaid(0)).not.to.be.reverted;

            const reqInfo = await mktMgr.requestInfo(0);
            expect(reqInfo.exists).to.be.true;
            const req = await payRouter.getRequest(reqInfo.requestId);
            expect(req.orgSrcPaid).to.be.true;
        });
    });

    describe(".onRelease", () => {
        it("should close the request", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);
            const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
            const swapCost = swapAmt.mul(pricePerBase).div(baseDec);
            await quoteAsset.transfer(swapper.address, swapCost);
            await quoteAsset.connect(swapper).approve(cAddr, swapCost);

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
                    marketMgrData: abi.encode(
                        ["uint256[]", "uint256[]"],
                        [
                            [0, 1],
                            [0, 0],
                        ],
                    ),
                }),
            ).not.to.be.reverted;

            await expect(core.connect(swapper).markOrderAsPaid(0)).not.to.be.reverted;
            await expect(core.connect(provider).releaseOrder(0)).not.to.be.reverted;

            const reqInfo = await mktMgr.requestInfo(0);
            expect(reqInfo.exists).to.be.true;
            const req = await payRouter.getRequest(reqInfo.requestId);
            expect(req.orgSrcPaid).to.be.true;
            expect(req.closed).to.be.true;
            expect(req.cancelled).to.be.false;
        });
    });
});
