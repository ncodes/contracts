import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {BigNumber, BigNumberish} from "ethers";
import {getAddress} from "ethers/lib/utils";
import {ethers} from "hardhat";
import {Core, MarketCore, MediatorManager, ProxyLP, TOKEN} from "../typechain-types";
import {StructsLib} from "../typechain-types/Core";
import {ProxyLPStructs} from "../typechain-types/ProxyLP";
import {AddressZero, AssetType, makeMarketID, powOf, toBN, toDec} from "../utils/utils";
import {initCoreTestSuite, MakeCoreLibsResult} from "./helpers/helpers";

describe("ProxyLP", function () {
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let accts: SignerWithAddress[];
    let proxyLP: ProxyLP;
    let baseAddr: string;
    let quoteAddr: string;
    let baseAsset: TOKEN;
    let quoteAsset: TOKEN;
    let core: Core;
    let mc: MarketCore;
    let mid: string;
    let libs: MakeCoreLibsResult;
    let baseDec: BigNumber;
    let pricePerBase: BigNumber;
    let swapper: SignerWithAddress;
    let swapper2: SignerWithAddress;
    let lp: SignerWithAddress;
    let cAddr: string;
    let token: TOKEN;
    let mediatorMgr: MediatorManager;
    let marketCreator: SignerWithAddress;

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[1];
        lp = accts[3];

        const vars = await initCoreTestSuite();
        accts = vars.accts;
        baseAddr = vars.baseAddr;
        quoteAddr = vars.quoteAddr;
        baseAsset = vars.baseAsset;
        quoteAsset = vars.quoteAsset;
        core = vars.core;
        mc = vars.mc;
        libs = vars.libs;
        baseDec = vars.baseDec;
        pricePerBase = vars.pricePerBase;
        swapper = vars.swapper;
        swapper2 = accts[3];
        cAddr = vars.cAddr;
        mediatorMgr = vars.mediatorMgr;
        marketCreator = accts[4];

        let factory = await ethers.getContractFactory("ProxyLP", {libraries: {MarketAuxLib: libs.MarketAuxLib.address}});
        proxyLP = (await factory.deploy(core.address)) as ProxyLP;

        let TOKEN = await ethers.getContractFactory("TOKEN");
        token = (await TOKEN.deploy("TEST", "TEST", powOf(1000000), 18)) as TOKEN;

        await core.setProtoFee(0, 0, 0, 0, 0, 0);
        await mediatorMgr.updateTicketPool(0, 0, 1, 1, 1, 1, 1, 1, 1, false, false);
    });

    async function createMarket(creator: SignerWithAddress = deployer, base: string, quote: string, baseType: number, quoteType: number, permPut: boolean, permSwap: boolean, commission: BigNumberish, mediatorPoolId: BigNumberish) {
        const mid = makeMarketID(creator.address, base, quote, baseType, quoteType);
        await mc.connect(creator).createMarket(base, quote, baseType, quoteType, permPut, permSwap, commission, mediatorPoolId);
        return Promise.resolve(mid);
    }

    describe(".updateFungibleLiquidity", () => {
        let params: ProxyLPStructs.UpdateFungibleLiquidityParamsStruct;

        beforeEach(async () => {
            params = {
                marketId: mid,
                crossLiquidity: {
                    marketId: AddressZero,
                    price: 0,
                    usePriceFromRegistry: false,
                    priceScaleBps: 0,
                },
                target: AddressZero,
                lid: 0,
                amount: 100,
                price: 100,
                timeToPay: 0,
                expireAt: 0,
                pause: false,
                usePriceFromRegistry: false,
                priceScaleBps: 0,
                wantOrIds: [],
                wantAndIds: [],
                deduct: false,
            };
        });

        it("should revert with 'PAIR_NOT_ONCHAIN' if base or quote is not onchain", async () => {
            params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0, 0);
            await expect(proxyLP.updateFungibleLiquidity(params)).to.be.revertedWith("PLP: PAIR_NOT_ONCHAIN");

            params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.ERC20, false, false, 0, 0);
            await expect(proxyLP.updateFungibleLiquidity(params)).to.be.revertedWith("PLP: PAIR_NOT_ONCHAIN");
        });

        it("should add liquidity", async () => {
            await baseAsset.approve(proxyLP.address, "100");
            params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

            let liq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
            expect(liq.amount).to.equal(100);

            await baseAsset.approve(proxyLP.address, "100");
            await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");
            liq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
            expect(liq.amount).to.equal(200);

            expect(await proxyLP.liqOwners(params.marketId, 0)).to.equal(deployer.address);
            const liqOwned = await proxyLP.liqOwned(params.marketId, deployer.address);
            expect(liqOwned.isSet).to.equal(true);
            expect(liqOwned.lid).to.equal(0);
        });

        it("should revert if liquidity exists but sender is not the owner", async () => {
            await baseAsset.approve(proxyLP.address, "200");
            params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");
            let liq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
            expect(liq.amount).to.equal(100);
            await expect(proxyLP.connect(user2).updateFungibleLiquidity(params)).to.be.revertedWith("PLP: NOT_LIQ_OWNER");
        });

        it("should remove liquidity", async () => {
            const initialBal = await baseAsset.balanceOf(deployer.address);

            await baseAsset.approve(proxyLP.address, "200");
            params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");
            let liq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
            expect(liq.amount).to.equal(100);

            let curBal = await baseAsset.balanceOf(deployer.address);
            expect(curBal).to.equal(initialBal.sub(100));

            params.deduct = true;
            await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");
            liq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
            expect(liq.amount).to.equal(0);

            curBal = await baseAsset.balanceOf(deployer.address);
            expect(curBal).to.eq(initialBal);
        });

        it("should add native liquidity", async () => {
            params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
            await expect(proxyLP.updateFungibleLiquidity(params, {value: 100})).to.emit(core, "UpdatedFungibleLiquidity");
            const liq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
            expect(liq.amount).to.equal(100);
            const coreBal = await ethers.provider.getBalance(core.address);
            expect(coreBal).to.eq(100);
        });

        it("should revert if when adding native liquidity, amount is not equal to value", async () => {
            params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
            await expect(proxyLP.updateFungibleLiquidity(params, {value: 99})).to.be.revertedWith("PLP: AMT_DEPOSIT_MISMATCH");
        });

        it("should remove native liquidity", async () => {
            params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
            const initialBal = await deployer.getBalance();

            let tx = await proxyLP.updateFungibleLiquidity(params, {value: 100});
            await expect(tx).to.emit(core, "UpdatedFungibleLiquidity");
            let liq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
            expect(liq.amount).to.equal(100);

            let txReceipt = await tx.wait();
            let gasUsed = txReceipt.gasUsed.toNumber();
            let gasFee = toBN(gasUsed).mul(tx.gasPrice as BigNumber);

            let curBal = await deployer.getBalance();
            expect(curBal).to.equal(initialBal.sub(100).sub(gasFee));

            params.deduct = true;
            tx = await proxyLP.updateFungibleLiquidity(params);
            await expect(tx).to.emit(core, "UpdatedFungibleLiquidity");
            liq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
            expect(liq.amount).to.equal(0);

            txReceipt = await tx.wait();
            gasUsed = txReceipt.gasUsed.toNumber();
            gasFee = toBN(gasUsed).mul(tx.gasPrice as BigNumber);

            const curBal2 = await deployer.getBalance();
            expect(curBal2).to.eq(curBal.add(100).sub(gasFee));
        });
        describe("cross liquidity is set", () => {
            it("should revert with 'SAME_MARKET' if initial liquidity and cross liquidity base asset are the same", async () => {
                params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                params.crossLiquidity.marketId = params.marketId;
                await expect(proxyLP.updateFungibleLiquidity(params)).to.be.revertedWith("PLP: SAME_MARKET");
            });

            it("should revert with 'CROSS_MKT_ASSET_MISMATCH' if initial liquidity quote asset does not match cross liquidity base asset", async () => {
                params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                params.crossLiquidity.marketId = await createMarket(undefined, user2.address, baseAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                await baseAsset.approve(proxyLP.address, "100");
                await expect(proxyLP.updateFungibleLiquidity(params)).to.be.revertedWith("PLP: CROSS_MKT_ASSET_MISMATCH");
            });

            it("should revert with 'CROSS_MKT_ASSET_MISMATCH' if initial liquidity quote type does not match cross liquidity base type", async () => {
                params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, baseAddr, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
                await baseAsset.approve(proxyLP.address, "100");
                await expect(proxyLP.updateFungibleLiquidity(params)).to.be.revertedWith("PLP: CROSS_MKT_ASSET_MISMATCH");
            });

            context("ERC20/ERC20 <-> ERC20/ERC20 market", () => {
                it("should add liquidity and create partial cross liquidity record", async () => {
                    params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, baseAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                    params.crossLiquidity.price = 10;
                    params.crossLiquidity.usePriceFromRegistry = true;
                    params.crossLiquidity.priceScaleBps = 100;
                    await baseAsset.approve(proxyLP.address, "100");
                    params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                    await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                    let liq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                    expect(liq.amount).to.equal(100);

                    const crossLiq = await proxyLP.crossLiqs(params.marketId, params.lid);
                    expect(crossLiq[0]).to.equal(deployer.address);
                    expect(crossLiq[1]).to.equal(getAddress(params.crossLiquidity.marketId));
                    expect(crossLiq[2]).to.eq(0);
                    expect(crossLiq[3]).to.eq(false);
                    expect(crossLiq[4]).to.eq(10);
                    expect(crossLiq[5]).to.eq(true);
                    expect(crossLiq[6]).to.eq(100);
                });

                describe("create cross liquidity and complete swaps", () => {
                    let liqAmt: BigNumber;
                    let swapAmt: BigNumber;
                    let swapCost: BigNumber;
                    let swapParams: any;

                    beforeEach(async () => {
                        // Setup initial market and cross liquidity params
                        params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                        params.amount = powOf(100);
                        params.price = pricePerBase;
                        params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, baseAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                        params.crossLiquidity.price = powOf(1);

                        // Setup initial liquidity
                        liqAmt = powOf(100);
                        await baseAsset.approve(proxyLP.address, liqAmt);
                        await proxyLP.updateFungibleLiquidity(params);

                        // Setup swap amounts
                        swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                        swapCost = swapAmt.mul(pricePerBase).div(baseDec);

                        // Setup swap parameters
                        await quoteAsset.transfer(swapper.address, powOf(500));
                        await quoteAsset.connect(swapper).approve(cAddr, powOf(500));

                        swapParams = {
                            marketId: params.marketId,
                            provider: proxyLP.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 0,
                            marketMgrData: Buffer.from([]),
                        };
                    });

                    it("should create initial cross liquidity after first swap", async () => {
                        await expect(core.connect(swapper).swapQuoteForBase(swapParams)).to.emit(core, "Swap");

                        expect(await quoteAsset.balanceOf(proxyLP.address)).to.eq(0);

                        // Verify cross liquidity creation
                        let crossLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(crossLiq.amount).to.eq(swapCost);
                        expect(crossLiq.price).to.eq(params.crossLiquidity.price);

                        // Verify cross liquidity records
                        const crossLiqInfo = await proxyLP.crossLiqs(params.crossLiquidity.marketId, 0);
                        expect(crossLiqInfo[0]).to.eq(deployer.address);
                        expect(crossLiqInfo[1]).to.eq(getAddress(params.marketId));
                        expect(crossLiqInfo[2]).to.eq(0);
                        expect(crossLiqInfo[3]).to.eq(true);
                        expect(crossLiqInfo[4]).to.eq(0);
                        expect(crossLiqInfo[5]).to.eq(false);
                        expect(crossLiqInfo[6]).to.eq(0);

                        const initialCrossLiqInfo = await proxyLP.crossLiqs(params.marketId, 0);
                        expect(initialCrossLiqInfo[0]).to.eq(deployer.address);
                        expect(initialCrossLiqInfo[1]).to.eq(getAddress(params.crossLiquidity.marketId));
                        expect(initialCrossLiqInfo[2]).to.eq(0);
                        expect(initialCrossLiqInfo[3]).to.eq(true);
                        expect(initialCrossLiqInfo[4]).to.eq(params.crossLiquidity.price);
                        expect(initialCrossLiqInfo[5]).to.eq(params.crossLiquidity.usePriceFromRegistry);
                        expect(initialCrossLiqInfo[6]).to.eq(params.crossLiquidity.priceScaleBps);

                        // Verify ownership records
                        expect(await proxyLP.liqOwners(params.marketId, 0)).to.equal(deployer.address);
                        expect(await proxyLP.liqOwners(params.crossLiquidity.marketId, 0)).to.equal(deployer.address);
                        const liqOwned = await proxyLP.liqOwned(params.marketId, deployer.address);
                        expect(liqOwned.isSet).to.equal(true);
                        expect(liqOwned.lid).to.equal(0);
                        const liqOwned2 = await proxyLP.liqOwned(params.crossLiquidity.marketId, deployer.address);
                        expect(liqOwned2.isSet).to.equal(true);
                        expect(liqOwned2.lid).to.equal(0);
                    });

                    it("should update balances correctly after second swap on main liquidity", async () => {
                        // Execute first swap
                        await core.connect(swapper).swapQuoteForBase(swapParams);

                        // Execute second swap
                        await expect(core.connect(swapper).swapQuoteForBase(swapParams)).to.emit(core, "Swap");

                        expect(await quoteAsset.balanceOf(proxyLP.address)).to.eq(0);

                        // Verify updated balances
                        const crossLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(crossLiq.amount).to.eq(swapCost.mul(2));

                        const initialLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(initialLiq.amount).to.eq(liqAmt.sub(swapAmt.mul(2)));
                    });

                    it("should handle swaps on cross liquidity correctly", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams);
                        await core.connect(swapper).swapQuoteForBase(swapParams);

                        // Setup swap on cross liquidity
                        await baseAsset.transfer(swapper2.address, powOf(500));
                        await baseAsset.connect(swapper2).approve(cAddr, powOf(500));

                        const crossSwapAmt = powOf(5.65);
                        const crossSwapCost = crossSwapAmt.mul(params.crossLiquidity.price).div(baseDec);

                        const crossSwapParams = {
                            ...swapParams,
                            marketId: params.crossLiquidity.marketId,
                            amount: crossSwapAmt,
                            maxPrice: params.crossLiquidity.price,
                        };

                        // Record balances before swap
                        const crossLiqBefore = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);

                        // Execute swap on cross liquidity
                        await expect(core.connect(swapper2).swapQuoteForBase(crossSwapParams)).to.emit(core, "Swap");

                        // Verify main liquidity balance updated correctly
                        const initialLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(initialLiq.amount).to.eq(liqAmt.sub(swapAmt.mul(2)).add(crossSwapCost));

                        // Verify cross liquidity balance updated correctly
                        const crossLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(crossLiq.amount).to.eq(crossLiqBefore.amount.sub(crossSwapAmt));
                    });

                    it("should handle removing liquidity correctly", async () => {
                        // Setup: Execute swaps to create cross liquidity
                        await core.connect(swapper).swapQuoteForBase(swapParams);
                        await core.connect(swapper).swapQuoteForBase(swapParams);

                        // Setup cross swap
                        await baseAsset.transfer(swapper2.address, powOf(500));
                        await baseAsset.connect(swapper2).approve(cAddr, powOf(500));
                        const crossSwapAmt = powOf(5.65);
                        const crossSwapParams = {
                            ...swapParams,
                            marketId: params.crossLiquidity.marketId,
                            amount: crossSwapAmt,
                            maxPrice: params.crossLiquidity.price,
                        };
                        await core.connect(swapper2).swapQuoteForBase(crossSwapParams);

                        // Get current liquidity amounts
                        const initialLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        const crossLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        const lpBaseBal = await baseAsset.balanceOf(deployer.address);
                        const lpQuoteBal = await quoteAsset.balanceOf(deployer.address);

                        // Remove initial liquidity
                        params.deduct = true;
                        params.amount = initialLiq.amount;
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        // Verify initial liquidity removed
                        const initialLiqAfter = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(initialLiqAfter.amount).to.eq(0);
                        expect(await baseAsset.balanceOf(deployer.address)).to.eq(lpBaseBal.add(initialLiq.amount));

                        // Remove cross liquidity
                        const crossLiqInfo = await proxyLP.crossLiqs(params.crossLiquidity.marketId, 0);
                        params.marketId = params.crossLiquidity.marketId;
                        params.amount = crossLiq.amount;
                        params.crossLiquidity = {
                            marketId: crossLiqInfo.marketId,
                            price: crossLiqInfo.price,
                            usePriceFromRegistry: crossLiqInfo.usePriceFromRegistry,
                            priceScaleBps: crossLiqInfo.priceScaleBps,
                        };

                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        // Verify cross liquidity removed
                        const crossLiqAfter = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(crossLiqAfter.amount).to.eq(0);
                        expect(await quoteAsset.balanceOf(deployer.address)).to.eq(lpQuoteBal.add(crossLiq.amount));
                    });
                });

                describe("cross liquidity updates", () => {
                    let liqAmt: BigNumber;
                    let swapAmt: BigNumber;
                    let swapCost: BigNumber;
                    let swapParams: StructsLib.SwapQuoteForBaseParamsStruct;

                    beforeEach(async () => {
                        // Setup initial market and cross liquidity
                        params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                        params.amount = powOf(100);
                        params.price = pricePerBase;
                        params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, baseAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                        params.crossLiquidity.price = powOf(1);

                        // Setup initial liquidity
                        liqAmt = powOf(100);
                        await baseAsset.approve(proxyLP.address, liqAmt);
                        await proxyLP.updateFungibleLiquidity(params);

                        // Setup swap parameters
                        swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                        swapCost = swapAmt.mul(pricePerBase).div(baseDec);
                        await quoteAsset.transfer(swapper.address, powOf(500));
                        await quoteAsset.connect(swapper).approve(cAddr, powOf(500));

                        swapParams = {
                            marketId: params.marketId,
                            provider: proxyLP.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 0,
                            marketMgrData: Buffer.from([]),
                        };
                    });

                    it("should update cross liquidity to new market", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams);

                        const oldCrossLiqMkt = params.crossLiquidity.marketId;
                        params.crossLiquidity.marketId = await createMarket(marketCreator, quoteAddr, baseAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                        params.amount = 0;

                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        // Check old market liquidity is removed
                        const oldCxLiq = await core.getLiquidity(oldCrossLiqMkt, proxyLP.address, 0);
                        expect(oldCxLiq.amount).to.eq(0);

                        // Check new market liquidity is added
                        const newCxLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(newCxLiq.amount).to.eq(swapCost);

                        // Verify cross liquidity mappings
                        const initialCrossLiqInfo = await proxyLP.crossLiqs(params.marketId, 0);
                        expect(initialCrossLiqInfo.owner).to.eq(deployer.address);
                        expect(initialCrossLiqInfo.marketId).to.eq(getAddress(params.crossLiquidity.marketId));
                        expect(initialCrossLiqInfo.isLiqSet).to.eq(true);

                        let crossLiqInfo = await proxyLP.crossLiqs(params.crossLiquidity.marketId, 0);
                        expect(crossLiqInfo.owner).to.eq(deployer.address);
                        expect(crossLiqInfo.marketId).to.eq(getAddress(params.marketId));
                        expect(crossLiqInfo.isLiqSet).to.eq(true);

                        // Updating to a market with a quote asset different from the liquidity's market base asset
                        // should result in a reverse cross liquidity only setting the liquidity owner address
                        // and nothing else.
                        params.crossLiquidity.marketId = await createMarket(marketCreator, quoteAddr, token.address, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");
                        crossLiqInfo = await proxyLP.crossLiqs(params.crossLiquidity.marketId, 0);
                        expect(crossLiqInfo.owner).to.eq(deployer.address);
                        expect(crossLiqInfo.marketId).to.eq(AddressZero);
                        expect(crossLiqInfo.isLiqSet).to.eq(false);
                    });

                    it("should reuse existing liquidity in a market if available", async () => {
                        // Setup: Execute swap and update to new market first
                        await core.connect(swapper).swapQuoteForBase(swapParams);
                        const oldCrossLiqMkt = params.crossLiquidity.marketId;
                        params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, token.address, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                        params.amount = 0;
                        await proxyLP.updateFungibleLiquidity(params);

                        // Test reverting back
                        const prevCrossLiqMkt = params.crossLiquidity.marketId;
                        params.crossLiquidity.marketId = oldCrossLiqMkt;
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        const oldCxLiq = await core.getLiquidity(prevCrossLiqMkt, proxyLP.address, 0);
                        expect(oldCxLiq.amount).to.eq(0);

                        const newCxLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(newCxLiq.amount).to.eq(swapCost);

                        // Check the initial cross liquidity info. Existing liquidity should be used in previous initialCrossLiqInfo
                        const initialCrossLiqInfo = await proxyLP.crossLiqs(params.marketId, 0);
                        expect(initialCrossLiqInfo.lid).to.eq(0);
                    });

                    it("should handle new LP adding liquidity to market", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams);

                        const nextLid = await core.countLiquidity(params.marketId, proxyLP.address);
                        params.lid = nextLid;
                        params.amount = liqAmt;

                        await baseAsset.transfer(lp.address, liqAmt);
                        await baseAsset.connect(lp).approve(proxyLP.address, liqAmt);

                        await expect(proxyLP.connect(lp).updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        let crossLiqInfo = await proxyLP.crossLiqs(params.marketId, nextLid);
                        expect(crossLiqInfo.owner).to.eq(lp.address);
                        expect(crossLiqInfo.isLiqSet).to.eq(false);

                        // Execute swap on new LP's liquidity
                        swapParams.lid = nextLid.toNumber();
                        await expect(core.connect(swapper).swapQuoteForBase(swapParams)).to.emit(core, "Swap");

                        crossLiqInfo = await proxyLP.crossLiqs(params.marketId, nextLid);
                        expect(crossLiqInfo.isLiqSet).to.eq(true);
                        expect(crossLiqInfo.lid).to.eq(nextLid);
                    });

                    it("should return liquidity back to owner when cross liquidity market is set to zero", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams);

                        const liq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(liq.amount).to.eq(swapCost);

                        const swapperQuoteBal = await quoteAsset.balanceOf(deployer.address);

                        const oldCxLiqMkt = params.crossLiquidity.marketId;
                        params.amount = 0;
                        params.crossLiquidity.marketId = AddressZero;
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        const liq2 = await core.getLiquidity(oldCxLiqMkt, proxyLP.address, 0);
                        expect(liq2.amount).to.eq(0);

                        expect(await quoteAsset.balanceOf(deployer.address)).to.eq(swapperQuoteBal.add(swapCost));
                        expect(await quoteAsset.balanceOf(proxyLP.address)).to.eq(0);

                        const crossLiq = await proxyLP.crossLiqs(params.marketId, 0);
                        expect(crossLiq.marketId).to.eq(AddressZero);
                    });

                    it("should transfer quote recieved to liquidity owner when no cross liquidity [market] is found", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams);

                        params.amount = 0;
                        params.crossLiquidity.marketId = AddressZero;
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        const swapperQuoteBal = await quoteAsset.balanceOf(deployer.address);

                        await core.connect(swapper).swapQuoteForBase(swapParams);
                        expect(await quoteAsset.balanceOf(proxyLP.address)).to.eq(0);

                        expect(await quoteAsset.balanceOf(deployer.address)).to.eq(swapperQuoteBal.add(swapCost));
                    });
                });
            });

            context("ERC20/NATIVE <-> NATIVE/ERC20 market", () => {
                it("should add liquidity and create partial cross liquidity", async () => {
                    params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.NATIVE, false, false, 0, 0);
                    params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, baseAddr, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
                    params.crossLiquidity.price = 10;
                    params.crossLiquidity.usePriceFromRegistry = true;
                    params.crossLiquidity.priceScaleBps = 100;

                    await baseAsset.approve(proxyLP.address, "100");
                    await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                    let liq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                    expect(liq.amount).to.equal(100);

                    const crossLiq = await proxyLP.crossLiqs(params.marketId, params.lid);
                    expect(crossLiq.owner).to.equal(deployer.address);
                    expect(crossLiq.marketId).to.equal(getAddress(params.crossLiquidity.marketId));
                    expect(crossLiq.lid).to.eq(0);
                    expect(crossLiq.isLiqSet).to.eq(false);
                    expect(crossLiq.price).to.eq(10);
                    expect(crossLiq.usePriceFromRegistry).to.eq(true);
                    expect(crossLiq.priceScaleBps).to.eq(100);
                });

                describe("create cross liquidity and complete swaps", () => {
                    let liqAmt: BigNumber;
                    let swapAmt: BigNumber;
                    let swapCost: BigNumber;
                    let swapParams: any;

                    beforeEach(async () => {
                        // Setup initial market and cross liquidity params
                        params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.NATIVE, false, false, 0, 0);
                        params.amount = powOf(100);
                        params.price = pricePerBase;
                        params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, baseAddr, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
                        params.crossLiquidity.price = powOf(1);

                        // Setup initial liquidity
                        liqAmt = powOf(100);
                        await baseAsset.approve(proxyLP.address, liqAmt);
                        await proxyLP.updateFungibleLiquidity(params);

                        // Setup swap amounts
                        swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                        swapCost = swapAmt.mul(pricePerBase).div(baseDec);

                        swapParams = {
                            marketId: params.marketId,
                            provider: proxyLP.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 0,
                            marketMgrData: Buffer.from([]),
                        };
                    });

                    it("should create initial cross liquidity after first swap", async () => {
                        await expect(core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost})).to.emit(core, "Swap");

                        // Verify cross liquidity records
                        const crossLiqInfo = await proxyLP.crossLiqs(params.crossLiquidity.marketId, 0);
                        expect(crossLiqInfo[0]).to.eq(deployer.address);
                        expect(crossLiqInfo[1]).to.eq(getAddress(params.marketId));
                        expect(crossLiqInfo[2]).to.eq(0);
                        expect(crossLiqInfo[3]).to.eq(true);
                        expect(crossLiqInfo[4]).to.eq(0);
                        expect(crossLiqInfo[5]).to.eq(false);
                        expect(crossLiqInfo[6]).to.eq(0);

                        const initialCrossLiqInfo = await proxyLP.crossLiqs(params.marketId, 0);
                        expect(initialCrossLiqInfo[0]).to.eq(deployer.address);
                        expect(initialCrossLiqInfo[1]).to.eq(getAddress(params.crossLiquidity.marketId));
                        expect(initialCrossLiqInfo[2]).to.eq(0);
                        expect(initialCrossLiqInfo[3]).to.eq(true);
                        expect(initialCrossLiqInfo[4]).to.eq(params.crossLiquidity.price);
                        expect(initialCrossLiqInfo[5]).to.eq(params.crossLiquidity.usePriceFromRegistry);
                        expect(initialCrossLiqInfo[6]).to.eq(params.crossLiquidity.priceScaleBps);

                        // Verify ownership records
                        expect(await proxyLP.liqOwners(params.marketId, 0)).to.equal(deployer.address);
                        expect(await proxyLP.liqOwners(params.crossLiquidity.marketId, 0)).to.equal(deployer.address);
                        const liqOwned = await proxyLP.liqOwned(params.marketId, deployer.address);
                        expect(liqOwned.isSet).to.equal(true);
                        expect(liqOwned.lid).to.equal(0);
                        const liqOwned2 = await proxyLP.liqOwned(params.crossLiquidity.marketId, deployer.address);
                        expect(liqOwned2.isSet).to.equal(true);
                        expect(liqOwned2.lid).to.equal(0);

                        const initialLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(initialLiq.amount).to.eq(liqAmt.sub(swapAmt));

                        // Verify cross liquidity creation
                        let crossLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(crossLiq.amount).to.eq(swapCost);
                        expect(crossLiq.price).to.eq(params.crossLiquidity.price);

                        // No value should be left in the proxyLP contract
                        expect(await baseAsset.balanceOf(proxyLP.address)).to.eq(0);
                        expect(await ethers.provider.getBalance(proxyLP.address)).to.eq(0);
                    });

                    it("should handle swaps on cross liquidity correctly", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost});

                        // Setup swap on cross liquidity
                        await baseAsset.transfer(swapper2.address, powOf(500));
                        await baseAsset.connect(swapper2).approve(cAddr, powOf(500));

                        const crossSwapAmt = powOf(5.65);
                        const crossSwapCost = crossSwapAmt.mul(params.crossLiquidity.price).div(baseDec);

                        const crossSwapParams = {
                            ...swapParams,
                            marketId: params.crossLiquidity.marketId,
                            amount: crossSwapAmt,
                            maxPrice: params.crossLiquidity.price,
                        };

                        const crossLiqBefore = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        const swapperCrossLiqBaseBal = await swapper2.getBalance();

                        // Execute swap on cross liquidity
                        const tx = await core.connect(swapper2).swapQuoteForBase(crossSwapParams);
                        await expect(tx).to.emit(core, "Swap");

                        let txReceipt = await tx.wait();
                        let gasUsed = txReceipt.gasUsed.toNumber();
                        let gasFee = toBN(gasUsed).mul(tx.gasPrice as BigNumber);

                        // Verify main liquidity balance updated correctly
                        const initialLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(initialLiq.amount).to.eq(liqAmt.sub(swapAmt).add(crossSwapCost));

                        // Verify cross liquidity balance updated correctly
                        const crossLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(crossLiq.amount).to.eq(crossLiqBefore.amount.sub(crossSwapAmt));

                        // Verify swapper2 received correct amount of base
                        expect(await swapper2.getBalance()).to.eq(swapperCrossLiqBaseBal.add(crossSwapAmt).sub(gasFee));
                    });

                    it("should handle removing liquidity correctly", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost});

                        let initialLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(initialLiq.amount).to.eq(liqAmt.sub(swapAmt));

                        let lpBal = await baseAsset.balanceOf(deployer.address);

                        params.amount = initialLiq.amount;
                        params.deduct = true;
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        expect(await baseAsset.balanceOf(deployer.address)).to.be.eq(lpBal.add(initialLiq.amount));

                        initialLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(initialLiq.amount).to.be.eq(0);

                        let crossLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(crossLiq.amount).to.be.eq(swapCost);

                        lpBal = await deployer.getBalance();

                        params.amount = crossLiq.amount;
                        params.marketId = params.crossLiquidity.marketId;
                        params.crossLiquidity.marketId = AddressZero;
                        const tx = await proxyLP.updateFungibleLiquidity(params);
                        await expect(tx).to.emit(core, "UpdatedFungibleLiquidity");

                        const txReceipt = await tx.wait();
                        const gasUsed = txReceipt.gasUsed.toNumber();
                        const gasFee = toBN(gasUsed).mul(tx.gasPrice as BigNumber);

                        expect(await deployer.getBalance()).to.be.eq(lpBal.add(crossLiq.amount).sub(gasFee));

                        crossLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(crossLiq.amount).to.be.eq(0);
                    });
                });

                describe("cross liquidity updates", () => {
                    let liqAmt: BigNumber;
                    let swapAmt: BigNumber;
                    let swapCost: BigNumber;
                    let swapParams: StructsLib.SwapQuoteForBaseParamsStruct;

                    beforeEach(async () => {
                        // Setup initial market and cross liquidity
                        params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.NATIVE, false, false, 0, 0);
                        params.amount = powOf(100);
                        params.price = pricePerBase;
                        params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, baseAddr, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
                        params.crossLiquidity.price = powOf(1);

                        // Setup initial liquidity
                        liqAmt = powOf(100);
                        await baseAsset.approve(proxyLP.address, liqAmt);
                        await proxyLP.updateFungibleLiquidity(params);

                        // Setup swap parameters
                        swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                        swapCost = swapAmt.mul(pricePerBase).div(baseDec);

                        swapParams = {
                            marketId: params.marketId,
                            provider: proxyLP.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 0,
                            marketMgrData: Buffer.from([]),
                        };
                    });

                    it("should update cross liquidity to new market", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost});

                        const oldCrossLiqMkt = params.crossLiquidity.marketId;
                        params.crossLiquidity.marketId = await createMarket(marketCreator, quoteAddr, baseAddr, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
                        params.amount = 0;
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        // Check old market liquidity is removed
                        const oldCxLiq = await core.getLiquidity(oldCrossLiqMkt, proxyLP.address, 0);
                        expect(oldCxLiq.amount).to.eq(0);

                        // Check new market liquidity is added
                        const newCxLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(newCxLiq.amount).to.eq(swapCost);

                        // Verify cross liquidity mappings
                        const initialCrossLiqInfo = await proxyLP.crossLiqs(params.marketId, 0);
                        expect(initialCrossLiqInfo.owner).to.eq(deployer.address);
                        expect(initialCrossLiqInfo.marketId).to.eq(getAddress(params.crossLiquidity.marketId));
                        expect(initialCrossLiqInfo.isLiqSet).to.eq(true);

                        let crossLiqInfo = await proxyLP.crossLiqs(params.crossLiquidity.marketId, 0);
                        expect(crossLiqInfo.owner).to.eq(deployer.address);
                        expect(crossLiqInfo.marketId).to.eq(getAddress(params.marketId));
                        expect(crossLiqInfo.isLiqSet).to.eq(true);

                        // Updating to a market with a quote asset different from the liquidity's market base asset
                        // should result in a reverse cross liquidity only setting the liquidity owner address
                        // and nothing else.
                        params.crossLiquidity.marketId = await createMarket(marketCreator, quoteAddr, token.address, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");
                        crossLiqInfo = await proxyLP.crossLiqs(params.crossLiquidity.marketId, 0);
                        expect(crossLiqInfo.owner).to.eq(deployer.address);
                        expect(crossLiqInfo.marketId).to.eq(AddressZero);
                        expect(crossLiqInfo.isLiqSet).to.eq(false);
                    });

                    it("should reuse existing liquidity in a market if available", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost});
                        const oldCrossLiqMkt = params.crossLiquidity.marketId;
                        params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, token.address, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
                        params.amount = 0;
                        await proxyLP.updateFungibleLiquidity(params);

                        // Test reverting back
                        const prevCrossLiqMkt = params.crossLiquidity.marketId;
                        params.crossLiquidity.marketId = oldCrossLiqMkt;
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        const oldCxLiq = await core.getLiquidity(prevCrossLiqMkt, proxyLP.address, 0);
                        expect(oldCxLiq.amount).to.eq(0);

                        const newCxLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(newCxLiq.amount).to.eq(swapCost);

                        // Check the initial cross liquidity info. Existing liquidity should be used in previous initialCrossLiqInfo
                        const initialCrossLiqInfo = await proxyLP.crossLiqs(params.marketId, 0);
                        expect(initialCrossLiqInfo.lid).to.eq(0);
                    });

                    it("should handle new LP adding liquidity to market", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost});

                        const nextLid = await core.countLiquidity(params.marketId, proxyLP.address);
                        params.lid = nextLid;
                        params.amount = liqAmt;

                        await baseAsset.transfer(lp.address, liqAmt);
                        await baseAsset.connect(lp).approve(proxyLP.address, liqAmt);

                        await expect(proxyLP.connect(lp).updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        let crossLiqInfo = await proxyLP.crossLiqs(params.marketId, nextLid);
                        expect(crossLiqInfo.owner).to.eq(lp.address);
                        expect(crossLiqInfo.isLiqSet).to.eq(false);

                        // Execute swap on new LP's liquidity
                        swapParams.lid = nextLid.toNumber();
                        await expect(core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost})).to.emit(core, "Swap");

                        crossLiqInfo = await proxyLP.crossLiqs(params.marketId, nextLid);
                        expect(crossLiqInfo.isLiqSet).to.eq(true);
                        expect(crossLiqInfo.lid).to.eq(nextLid);
                    });

                    it("should return liquidity back to owner when cross liquidity market is set to zero", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost});

                        let liq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(liq.amount).to.eq(swapCost);

                        const lpBal = await deployer.getBalance();

                        const oldCxLiqMkt = params.crossLiquidity.marketId;
                        params.amount = 0;
                        params.crossLiquidity.marketId = AddressZero;
                        const tx = await proxyLP.updateFungibleLiquidity(params);
                        await expect(tx).to.emit(core, "UpdatedFungibleLiquidity");

                        const txReceipt = await tx.wait();
                        const gasUsed = txReceipt.gasUsed.toNumber();
                        const gasFee = toBN(gasUsed).mul(tx.gasPrice as BigNumber);

                        liq = await core.getLiquidity(oldCxLiqMkt, proxyLP.address, 0);
                        expect(liq.amount).to.eq(0);

                        expect(await deployer.getBalance()).to.eq(lpBal.add(swapCost).sub(gasFee));
                        expect(await ethers.provider.getBalance(proxyLP.address)).to.eq(0);

                        const crossLiq = await proxyLP.crossLiqs(params.marketId, 0);
                        expect(crossLiq.marketId).to.eq(AddressZero);
                    });

                    it("should transfer quote recieved to liquidity owner when no cross liquidity [market] is found", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost});

                        params.amount = 0;
                        params.crossLiquidity.marketId = AddressZero;
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        const lpBal = await deployer.getBalance();

                        await expect(await core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost})).to.emit(core, "Swap");

                        expect(await ethers.provider.getBalance(proxyLP.address)).to.eq(0);

                        expect(await deployer.getBalance()).to.eq(lpBal.add(swapCost));
                    });
                });
            });

            context("NATIVE/ERC20 <-> ERC20/NATIVE market", () => {
                it("should add liquidity and create partial cross liquidity", async () => {
                    params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
                    params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, baseAddr, AssetType.ERC20, AssetType.NATIVE, false, false, 0, 0);
                    params.crossLiquidity.price = 10;
                    params.crossLiquidity.usePriceFromRegistry = true;
                    params.crossLiquidity.priceScaleBps = 100;

                    await expect(proxyLP.updateFungibleLiquidity(params, {value: 100})).to.emit(core, "UpdatedFungibleLiquidity");

                    let liq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                    expect(liq.amount).to.equal(100);

                    const crossLiq = await proxyLP.crossLiqs(params.marketId, params.lid);
                    expect(crossLiq.owner).to.equal(deployer.address);
                    expect(crossLiq.marketId).to.equal(getAddress(params.crossLiquidity.marketId));
                    expect(crossLiq.lid).to.eq(0);
                    expect(crossLiq.isLiqSet).to.eq(false);
                    expect(crossLiq.price).to.eq(10);
                    expect(crossLiq.usePriceFromRegistry).to.eq(true);
                    expect(crossLiq.priceScaleBps).to.eq(100);
                });

                describe("create cross liquidity and complete swaps", () => {
                    let liqAmt: BigNumber;
                    let swapAmt: BigNumber;
                    let swapCost: BigNumber;
                    let swapParams: any;

                    beforeEach(async () => {
                        // Setup initial market and cross liquidity params
                        params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
                        params.amount = powOf(100);
                        params.price = pricePerBase;
                        params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, baseAddr, AssetType.ERC20, AssetType.NATIVE, false, false, 0, 0);
                        params.crossLiquidity.price = powOf(1);

                        // Setup initial liquidity
                        liqAmt = powOf(100);
                        await proxyLP.updateFungibleLiquidity(params, {value: liqAmt});

                        // Setup swap amounts
                        swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                        swapCost = swapAmt.mul(pricePerBase).div(baseDec);

                        await quoteAsset.transfer(swapper.address, swapCost);
                        await quoteAsset.connect(swapper).approve(core.address, swapCost);

                        swapParams = {
                            marketId: params.marketId,
                            provider: proxyLP.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 0,
                            marketMgrData: Buffer.from([]),
                        };
                    });

                    it("should create initial cross liquidity after first swap", async () => {
                        await expect(core.connect(swapper).swapQuoteForBase(swapParams)).to.emit(core, "Swap");

                        // Verify cross liquidity records
                        const crossLiqInfo = await proxyLP.crossLiqs(params.crossLiquidity.marketId, 0);
                        expect(crossLiqInfo.owner).to.eq(deployer.address);
                        expect(crossLiqInfo.marketId).to.eq(getAddress(params.marketId));
                        expect(crossLiqInfo.lid).to.eq(0);
                        expect(crossLiqInfo.isLiqSet).to.eq(true);
                        expect(crossLiqInfo.price).to.eq(0);
                        expect(crossLiqInfo.usePriceFromRegistry).to.eq(false);
                        expect(crossLiqInfo.priceScaleBps).to.eq(0);

                        const initialCrossLiqInfo = await proxyLP.crossLiqs(params.marketId, 0);
                        expect(initialCrossLiqInfo[0]).to.eq(deployer.address);
                        expect(initialCrossLiqInfo[1]).to.eq(getAddress(params.crossLiquidity.marketId));
                        expect(initialCrossLiqInfo[2]).to.eq(0);
                        expect(initialCrossLiqInfo[3]).to.eq(true);
                        expect(initialCrossLiqInfo[4]).to.eq(params.crossLiquidity.price);
                        expect(initialCrossLiqInfo[5]).to.eq(params.crossLiquidity.usePriceFromRegistry);
                        expect(initialCrossLiqInfo[6]).to.eq(params.crossLiquidity.priceScaleBps);

                        // Verify ownership records
                        expect(await proxyLP.liqOwners(params.marketId, 0)).to.equal(deployer.address);
                        expect(await proxyLP.liqOwners(params.crossLiquidity.marketId, 0)).to.equal(deployer.address);
                        const liqOwned = await proxyLP.liqOwned(params.marketId, deployer.address);
                        expect(liqOwned.isSet).to.equal(true);
                        expect(liqOwned.lid).to.equal(0);
                        const liqOwned2 = await proxyLP.liqOwned(params.crossLiquidity.marketId, deployer.address);
                        expect(liqOwned2.isSet).to.equal(true);
                        expect(liqOwned2.lid).to.equal(0);

                        const initialLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(initialLiq.amount).to.eq(liqAmt.sub(swapAmt));

                        // Verify cross liquidity creation
                        let crossLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(crossLiq.amount).to.eq(swapCost);
                        expect(crossLiq.price).to.eq(params.crossLiquidity.price);

                        // No value should be left in the proxyLP contract
                        expect(await baseAsset.balanceOf(proxyLP.address)).to.eq(0);
                        expect(await ethers.provider.getBalance(proxyLP.address)).to.eq(0);
                    });

                    it("should handle swaps on cross liquidity correctly", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams);

                        // Setup swap on cross liquidity
                        await baseAsset.transfer(swapper2.address, powOf(500));
                        await baseAsset.connect(swapper2).approve(cAddr, powOf(500));

                        const crossSwapAmt = powOf(5.65);
                        const crossSwapCost = crossSwapAmt.mul(params.crossLiquidity.price).div(baseDec);

                        const crossSwapParams = {
                            ...swapParams,
                            marketId: params.crossLiquidity.marketId,
                            amount: crossSwapAmt,
                            maxPrice: params.crossLiquidity.price,
                        };

                        const crossLiqBefore = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        const swapperCrossLiqBaseBal = await quoteAsset.balanceOf(swapper2.address);

                        // Execute swap on cross liquidity
                        const tx = await core.connect(swapper2).swapQuoteForBase(crossSwapParams, {value: crossSwapCost});
                        await expect(tx).to.emit(core, "Swap");

                        let txReceipt = await tx.wait();
                        let gasUsed = txReceipt.gasUsed.toNumber();
                        let gasFee = toBN(gasUsed).mul(tx.gasPrice as BigNumber);

                        // Verify main liquidity balance updated correctly
                        const initialLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(initialLiq.amount).to.eq(liqAmt.sub(swapAmt).add(crossSwapCost));

                        // Verify cross liquidity balance updated correctly
                        const crossLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(crossLiq.amount).to.eq(crossLiqBefore.amount.sub(crossSwapAmt));

                        // Verify swapper2 received correct amount of base
                        expect(await quoteAsset.balanceOf(swapper2.address)).to.eq(swapperCrossLiqBaseBal.add(crossSwapAmt));
                    });

                    it("should handle deducting liquidity", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams);

                        let initialLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(initialLiq.amount).to.eq(liqAmt.sub(swapAmt));

                        let lpBal = await deployer.getBalance();

                        params.amount = initialLiq.amount;
                        params.deduct = true;
                        let tx = await proxyLP.updateFungibleLiquidity(params);
                        await expect(tx).to.emit(core, "UpdatedFungibleLiquidity");

                        let txReceipt = await tx.wait();
                        let gasUsed = txReceipt.gasUsed.toNumber();
                        let gasFee = toBN(gasUsed).mul(tx.gasPrice as BigNumber);

                        expect(await deployer.getBalance()).to.be.eq(lpBal.add(initialLiq.amount).sub(gasFee));

                        initialLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(initialLiq.amount).to.be.eq(0);

                        let crossLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(crossLiq.amount).to.be.eq(swapCost);

                        lpBal = await quoteAsset.balanceOf(deployer.address);

                        params.amount = crossLiq.amount;
                        params.marketId = params.crossLiquidity.marketId;
                        params.crossLiquidity.marketId = AddressZero;
                        params.deduct = true;
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        expect(await quoteAsset.balanceOf(deployer.address)).to.be.eq(lpBal.add(crossLiq.amount));
                        crossLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(crossLiq.amount).to.be.eq(0);
                    });
                });

                describe("cross liquidity updates", () => {
                    let liqAmt: BigNumber;
                    let swapAmt: BigNumber;
                    let swapCost: BigNumber;
                    let swapParams: StructsLib.SwapQuoteForBaseParamsStruct;

                    beforeEach(async () => {
                        // Setup initial market and cross liquidity
                        params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
                        params.amount = powOf(100);
                        params.price = pricePerBase;
                        params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, baseAddr, AssetType.ERC20, AssetType.NATIVE, false, false, 0, 0);
                        params.crossLiquidity.price = powOf(1);

                        // Setup initial liquidity
                        liqAmt = powOf(100);
                        await proxyLP.updateFungibleLiquidity(params, {value: liqAmt});

                        // Setup swap parameters
                        swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                        swapCost = swapAmt.mul(pricePerBase).div(baseDec);

                        await quoteAsset.transfer(swapper.address, swapCost);
                        await quoteAsset.connect(swapper).approve(core.address, swapCost);

                        swapParams = {
                            marketId: params.marketId,
                            provider: proxyLP.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 0,
                            marketMgrData: Buffer.from([]),
                        };
                    });

                    it("should update cross liquidity to new a market", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams);

                        const oldCrossLiqMkt = params.crossLiquidity.marketId;
                        params.crossLiquidity.marketId = await createMarket(marketCreator, quoteAddr, baseAddr, AssetType.ERC20, AssetType.NATIVE, false, false, 0, 0);
                        params.amount = 0;
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        // Check old market liquidity is removed
                        const oldCxLiq = await core.getLiquidity(oldCrossLiqMkt, proxyLP.address, 0);
                        expect(oldCxLiq.amount).to.eq(0);

                        // Check new market liquidity is added
                        const newCxLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(newCxLiq.amount).to.eq(swapCost);

                        // Verify cross liquidity mappings
                        const initialCrossLiqInfo = await proxyLP.crossLiqs(params.marketId, 0);
                        expect(initialCrossLiqInfo.owner).to.eq(deployer.address);
                        expect(initialCrossLiqInfo.marketId).to.eq(getAddress(params.crossLiquidity.marketId));
                        expect(initialCrossLiqInfo.isLiqSet).to.eq(true);

                        let crossLiqInfo = await proxyLP.crossLiqs(params.crossLiquidity.marketId, 0);
                        expect(crossLiqInfo.owner).to.eq(deployer.address);
                        expect(crossLiqInfo.marketId).to.eq(getAddress(params.marketId));
                        expect(crossLiqInfo.isLiqSet).to.eq(true);

                        // It should only set the owner of the new reverse cross liquidity since the
                        // new/updated liquidity's market quote does not match the initial liquidity's market base asset
                        params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, token.address, AssetType.ERC20, AssetType.NATIVE, false, false, 0, 0);
                        params.crossLiquidity.price = powOf(10);
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");
                        crossLiqInfo = await proxyLP.crossLiqs(params.crossLiquidity.marketId, 0);
                        expect(crossLiqInfo.owner).to.eq(deployer.address);
                        expect(crossLiqInfo.marketId).to.eq(AddressZero);
                        expect(crossLiqInfo.isLiqSet).to.eq(false);

                        // Try swap on new market liquidity
                        let lpBal = await deployer.getBalance();
                        swapParams.marketId = params.crossLiquidity.marketId;
                        await expect(core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost})).to.emit(core, "Swap");
                        expect(await deployer.getBalance()).to.be.eq(lpBal.add(swapCost));
                    });

                    it("should reuse existing liquidity in a market if available", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams);

                        const oldCrossLiqMkt = params.crossLiquidity.marketId;
                        params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, token.address, AssetType.ERC20, AssetType.NATIVE, false, false, 0, 0);
                        params.amount = 0;
                        await proxyLP.updateFungibleLiquidity(params);

                        // Test reverting back
                        const prevCrossLiqMkt = params.crossLiquidity.marketId;
                        params.crossLiquidity.marketId = oldCrossLiqMkt;
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        const oldCxLiq = await core.getLiquidity(prevCrossLiqMkt, proxyLP.address, 0);
                        expect(oldCxLiq.amount).to.eq(0);

                        const newCxLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(newCxLiq.amount).to.eq(swapCost);

                        // Check the initial cross liquidity info. Existing liquidity should be used in previous initialCrossLiqInfo
                        const initialCrossLiqInfo = await proxyLP.crossLiqs(params.marketId, 0);
                        expect(initialCrossLiqInfo.lid).to.eq(0);
                    });

                    it("should handle new LP adding liquidity to market", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams);

                        const nextLid = await core.countLiquidity(params.marketId, proxyLP.address);
                        params.lid = nextLid;
                        params.amount = liqAmt;

                        await expect(proxyLP.connect(lp).updateFungibleLiquidity(params, {value: liqAmt})).to.emit(core, "UpdatedFungibleLiquidity");

                        let crossLiqInfo = await proxyLP.crossLiqs(params.marketId, nextLid);
                        expect(crossLiqInfo.owner).to.eq(lp.address);
                        expect(crossLiqInfo.isLiqSet).to.eq(false);

                        // Execute swap on new LP's liquidity
                        await quoteAsset.transfer(swapper.address, swapCost);
                        await quoteAsset.connect(swapper).approve(core.address, swapCost);
                        swapParams.lid = nextLid.toNumber();
                        await expect(core.connect(swapper).swapQuoteForBase(swapParams)).to.emit(core, "Swap");

                        crossLiqInfo = await proxyLP.crossLiqs(params.marketId, nextLid);
                        expect(crossLiqInfo.isLiqSet).to.eq(true);
                        expect(crossLiqInfo.lid).to.eq(nextLid);
                    });

                    it("should return liquidity back to owner when cross liquidity market is set to zero", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams);

                        let liq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(liq.amount).to.eq(swapCost);

                        const lpBal = await quoteAsset.balanceOf(deployer.address);

                        const oldCxLiqMkt = params.crossLiquidity.marketId;
                        params.amount = 0;
                        params.crossLiquidity.marketId = AddressZero;
                        const tx = await proxyLP.updateFungibleLiquidity(params);
                        await expect(tx).to.emit(core, "UpdatedFungibleLiquidity");

                        liq = await core.getLiquidity(oldCxLiqMkt, proxyLP.address, 0);
                        expect(liq.amount).to.eq(0);

                        expect(await quoteAsset.balanceOf(deployer.address)).to.eq(lpBal.add(swapCost));
                        expect(await quoteAsset.balanceOf(proxyLP.address)).to.eq(0);

                        const crossLiq = await proxyLP.crossLiqs(params.marketId, 0);
                        expect(crossLiq.marketId).to.eq(AddressZero);
                    });

                    it("should transfer quote recieved to liquidity owner when no cross liquidity [market] is found", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams);

                        let lpBal = await quoteAsset.balanceOf(deployer.address);

                        params.amount = 0;
                        params.crossLiquidity.marketId = AddressZero;
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        expect(await quoteAsset.balanceOf(deployer.address)).to.eq(lpBal.add(swapCost));

                        await quoteAsset.transfer(swapper.address, swapCost);
                        await quoteAsset.connect(swapper).approve(core.address, swapCost);

                        lpBal = await quoteAsset.balanceOf(deployer.address);

                        await expect(await core.connect(swapper).swapQuoteForBase(swapParams)).to.emit(core, "Swap");

                        expect(await quoteAsset.balanceOf(proxyLP.address)).to.eq(0);

                        expect(await quoteAsset.balanceOf(deployer.address)).to.eq(lpBal.add(swapCost));
                    });
                });
            });

            context("NATIVE/NATIVE <-> NATIVE/NATIVE market", () => {
                it("should add liquidity and create partial cross liquidity", async () => {
                    params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.NATIVE, false, false, 0, 0);
                    params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, baseAddr, AssetType.NATIVE, AssetType.NATIVE, false, false, 0, 0);
                    params.crossLiquidity.price = 10;
                    params.crossLiquidity.usePriceFromRegistry = true;
                    params.crossLiquidity.priceScaleBps = 100;

                    await expect(proxyLP.updateFungibleLiquidity(params, {value: 100})).to.emit(core, "UpdatedFungibleLiquidity");

                    let liq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                    expect(liq.amount).to.equal(100);

                    const crossLiq = await proxyLP.crossLiqs(params.marketId, params.lid);
                    expect(crossLiq.owner).to.equal(deployer.address);
                    expect(crossLiq.marketId).to.equal(getAddress(params.crossLiquidity.marketId));
                    expect(crossLiq.lid).to.eq(0);
                    expect(crossLiq.isLiqSet).to.eq(false);
                    expect(crossLiq.price).to.eq(10);
                    expect(crossLiq.usePriceFromRegistry).to.eq(true);
                    expect(crossLiq.priceScaleBps).to.eq(100);
                });

                describe("create cross liquidity and complete swaps", () => {
                    let liqAmt: BigNumber;
                    let swapAmt: BigNumber;
                    let swapCost: BigNumber;
                    let swapParams: any;

                    beforeEach(async () => {
                        // Setup initial market and cross liquidity params
                        params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.NATIVE, false, false, 0, 0);
                        params.amount = powOf(100);
                        params.price = pricePerBase;
                        params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, baseAddr, AssetType.NATIVE, AssetType.NATIVE, false, false, 0, 0);
                        params.crossLiquidity.price = powOf(1);

                        // Setup initial liquidity
                        liqAmt = powOf(100);
                        await proxyLP.updateFungibleLiquidity(params, {value: liqAmt});

                        // Setup swap amounts
                        swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                        swapCost = swapAmt.mul(pricePerBase).div(baseDec);

                        swapParams = {
                            marketId: params.marketId,
                            provider: proxyLP.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 0,
                            marketMgrData: Buffer.from([]),
                        };
                    });

                    it("should create initial cross liquidity after first swap", async () => {
                        await expect(core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost})).to.emit(core, "Swap");

                        // Verify cross liquidity records
                        const crossLiqInfo = await proxyLP.crossLiqs(params.crossLiquidity.marketId, 0);
                        expect(crossLiqInfo.owner).to.eq(deployer.address);
                        expect(crossLiqInfo.marketId).to.eq(getAddress(params.marketId));
                        expect(crossLiqInfo.lid).to.eq(0);
                        expect(crossLiqInfo.isLiqSet).to.eq(true);
                        expect(crossLiqInfo.price).to.eq(0);
                        expect(crossLiqInfo.usePriceFromRegistry).to.eq(false);
                        expect(crossLiqInfo.priceScaleBps).to.eq(0);

                        const initialCrossLiqInfo = await proxyLP.crossLiqs(params.marketId, 0);
                        expect(initialCrossLiqInfo.owner).to.eq(deployer.address);
                        expect(initialCrossLiqInfo.marketId).to.eq(getAddress(params.crossLiquidity.marketId));
                        expect(initialCrossLiqInfo.lid).to.eq(0);
                        expect(initialCrossLiqInfo.isLiqSet).to.eq(true);
                        expect(initialCrossLiqInfo.price).to.eq(params.crossLiquidity.price);
                        expect(initialCrossLiqInfo.usePriceFromRegistry).to.eq(params.crossLiquidity.usePriceFromRegistry);
                        expect(initialCrossLiqInfo.priceScaleBps).to.eq(params.crossLiquidity.priceScaleBps);

                        // Verify ownership records
                        expect(await proxyLP.liqOwners(params.marketId, 0)).to.equal(deployer.address);
                        expect(await proxyLP.liqOwners(params.crossLiquidity.marketId, 0)).to.equal(deployer.address);
                        const liqOwned = await proxyLP.liqOwned(params.marketId, deployer.address);
                        expect(liqOwned.isSet).to.equal(true);
                        expect(liqOwned.lid).to.equal(0);
                        const liqOwned2 = await proxyLP.liqOwned(params.crossLiquidity.marketId, deployer.address);
                        expect(liqOwned2.isSet).to.equal(true);
                        expect(liqOwned2.lid).to.equal(0);

                        const initialLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(initialLiq.amount).to.eq(liqAmt.sub(swapAmt));

                        // Verify cross liquidity creation
                        let crossLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(crossLiq.amount).to.eq(swapCost);
                        expect(crossLiq.price).to.eq(params.crossLiquidity.price);

                        // No value should be left in the proxyLP contract
                        expect(await baseAsset.balanceOf(proxyLP.address)).to.eq(0);
                        expect(await ethers.provider.getBalance(proxyLP.address)).to.eq(0);
                    });

                    it("should handle swaps on cross liquidity correctly", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost});

                        const crossSwapAmt = powOf(5.65);
                        const crossSwapCost = crossSwapAmt.mul(params.crossLiquidity.price).div(baseDec);
                        const crossSwapParams = {
                            ...swapParams,
                            marketId: params.crossLiquidity.marketId,
                            amount: crossSwapAmt,
                            maxPrice: params.crossLiquidity.price,
                        };

                        const crossLiqBefore = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        const swapperCrossLiqBaseBal = await swapper2.getBalance();

                        // Execute swap on cross liquidity
                        const tx = await core.connect(swapper2).swapQuoteForBase(crossSwapParams, {value: crossSwapCost});
                        await expect(tx).to.emit(core, "Swap");

                        let txReceipt = await tx.wait();
                        let gasUsed = txReceipt.gasUsed.toNumber();
                        let gasFee = toBN(gasUsed).mul(tx.gasPrice as BigNumber);

                        // Verify main liquidity balance updated correctly
                        const initialLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(initialLiq.amount).to.eq(liqAmt.sub(swapAmt).add(crossSwapCost));

                        // Verify cross liquidity balance updated correctly
                        const crossLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(crossLiq.amount).to.eq(crossLiqBefore.amount.sub(crossSwapAmt));

                        // Verify swapper2 received correct amount of base
                        expect(await swapper2.getBalance()).to.eq(swapperCrossLiqBaseBal.sub(crossSwapCost).add(crossSwapAmt).sub(gasFee));
                    });

                    it("should handle removing liquidity correctly", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost});

                        let initialLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(initialLiq.amount).to.eq(liqAmt.sub(swapAmt));

                        let lpBal = await deployer.getBalance();

                        params.amount = initialLiq.amount;
                        params.deduct = true;
                        let tx = await proxyLP.updateFungibleLiquidity(params);
                        await expect(tx).to.emit(core, "UpdatedFungibleLiquidity");

                        let txReceipt = await tx.wait();
                        let gasUsed = txReceipt.gasUsed.toNumber();
                        let gasFee = toBN(gasUsed).mul(tx.gasPrice as BigNumber);

                        expect(await deployer.getBalance()).to.be.eq(lpBal.add(initialLiq.amount).sub(gasFee));

                        initialLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(initialLiq.amount).to.be.eq(0);

                        let crossLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(crossLiq.amount).to.be.eq(swapCost);

                        lpBal = await deployer.getBalance();

                        params.amount = crossLiq.amount;
                        params.marketId = params.crossLiquidity.marketId;
                        params.crossLiquidity.marketId = AddressZero;
                        tx = await proxyLP.updateFungibleLiquidity(params);
                        await expect(tx).to.emit(core, "UpdatedFungibleLiquidity");

                        txReceipt = await tx.wait();
                        gasUsed = txReceipt.gasUsed.toNumber();
                        gasFee = toBN(gasUsed).mul(tx.gasPrice as BigNumber);

                        expect(await deployer.getBalance()).to.be.eq(lpBal.add(crossLiq.amount).sub(gasFee));

                        crossLiq = await core.getLiquidity(params.marketId, proxyLP.address, 0);
                        expect(crossLiq.amount).to.be.eq(0);
                    });
                });

                describe("cross liquidity updates", () => {
                    let liqAmt: BigNumber;
                    let swapAmt: BigNumber;
                    let swapCost: BigNumber;
                    let swapParams: StructsLib.SwapQuoteForBaseParamsStruct;

                    beforeEach(async () => {
                        // Setup initial market and cross liquidity
                        params.marketId = await createMarket(undefined, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.NATIVE, false, false, 0, 0);
                        params.amount = powOf(100);
                        params.price = pricePerBase;
                        params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, baseAddr, AssetType.NATIVE, AssetType.NATIVE, false, false, 0, 0);
                        params.crossLiquidity.price = powOf(1);

                        // Setup initial liquidity
                        liqAmt = powOf(100);
                        await proxyLP.updateFungibleLiquidity(params, {value: liqAmt});

                        // Setup swap parameters
                        swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                        swapCost = swapAmt.mul(pricePerBase).div(baseDec);

                        swapParams = {
                            marketId: params.marketId,
                            provider: proxyLP.address,
                            recipient: AddressZero,
                            lid: 0,
                            amount: swapAmt,
                            maxPrice: pricePerBase,
                            ids: [],
                            expireAt: 0,
                            operator: 0,
                            marketMgrData: Buffer.from([]),
                        };
                    });

                    it("should update cross liquidity to new a market", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost});

                        const oldCrossLiqMkt = params.crossLiquidity.marketId;
                        params.crossLiquidity.marketId = await createMarket(marketCreator, quoteAddr, baseAddr, AssetType.NATIVE, AssetType.NATIVE, false, false, 0, 0);
                        params.amount = 0;
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        // Check old market liquidity is removed
                        const oldCxLiq = await core.getLiquidity(oldCrossLiqMkt, proxyLP.address, 0);
                        expect(oldCxLiq.amount).to.eq(0);

                        // Check new market liquidity is added
                        const newCxLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(newCxLiq.amount).to.eq(swapCost);

                        // Verify cross liquidity mappings
                        const initialCrossLiqInfo = await proxyLP.crossLiqs(params.marketId, 0);
                        expect(initialCrossLiqInfo.owner).to.eq(deployer.address);
                        expect(initialCrossLiqInfo.marketId).to.eq(getAddress(params.crossLiquidity.marketId));
                        expect(initialCrossLiqInfo.isLiqSet).to.eq(true);

                        let crossLiqInfo = await proxyLP.crossLiqs(params.crossLiquidity.marketId, 0);
                        expect(crossLiqInfo.owner).to.eq(deployer.address);
                        expect(crossLiqInfo.marketId).to.eq(getAddress(params.marketId));
                        expect(crossLiqInfo.isLiqSet).to.eq(true);

                        // It should only set the owner of the new reverse cross liquidity since the
                        // new/updated liquidity's market quote does not match the initial liquidity's market base asset
                        params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, token.address, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
                        params.crossLiquidity.price = powOf(10);
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");
                        crossLiqInfo = await proxyLP.crossLiqs(params.crossLiquidity.marketId, 0);
                        expect(crossLiqInfo.owner).to.eq(deployer.address);
                        expect(crossLiqInfo.marketId).to.eq(AddressZero);
                        expect(crossLiqInfo.isLiqSet).to.eq(false);

                        // Try swap on new market liquidity
                        swapParams.marketId = params.crossLiquidity.marketId;
                        await token.transfer(swapper.address, swapCost);
                        await token.connect(swapper).approve(core.address, swapCost);
                        let lpBal = await token.balanceOf(deployer.address);
                        await expect(core.connect(swapper).swapQuoteForBase(swapParams)).to.emit(core, "Swap");
                        expect(await token.balanceOf(deployer.address)).to.be.eq(lpBal.add(swapCost));
                    });

                    it("should reuse existing liquidity in a market if available", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost});

                        const oldCrossLiqMkt = params.crossLiquidity.marketId;
                        params.crossLiquidity.marketId = await createMarket(undefined, quoteAddr, token.address, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
                        params.amount = 0;
                        await proxyLP.updateFungibleLiquidity(params);

                        // Test reverting back
                        const prevCrossLiqMkt = params.crossLiquidity.marketId;
                        params.crossLiquidity.marketId = oldCrossLiqMkt;
                        await expect(proxyLP.updateFungibleLiquidity(params)).to.emit(core, "UpdatedFungibleLiquidity");

                        const oldCxLiq = await core.getLiquidity(prevCrossLiqMkt, proxyLP.address, 0);
                        expect(oldCxLiq.amount).to.eq(0);

                        const newCxLiq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(newCxLiq.amount).to.eq(swapCost);

                        // Check the initial cross liquidity info. Existing liquidity should be used in previous initialCrossLiqInfo
                        const initialCrossLiqInfo = await proxyLP.crossLiqs(params.marketId, 0);
                        expect(initialCrossLiqInfo.lid).to.eq(0);
                    });

                    it("should handle new LP adding liquidity to market", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost});

                        const nextLid = await core.countLiquidity(params.marketId, proxyLP.address);
                        params.lid = nextLid;
                        params.amount = liqAmt;

                        await expect(proxyLP.connect(lp).updateFungibleLiquidity(params, {value: liqAmt})).to.emit(core, "UpdatedFungibleLiquidity");

                        let crossLiqInfo = await proxyLP.crossLiqs(params.marketId, nextLid);
                        expect(crossLiqInfo.owner).to.eq(lp.address);
                        expect(crossLiqInfo.isLiqSet).to.eq(false);

                        // Execute swap on new LP's liquidity
                        swapParams.lid = nextLid.toNumber();
                        await expect(core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost})).to.emit(core, "Swap");

                        crossLiqInfo = await proxyLP.crossLiqs(params.marketId, nextLid);
                        expect(crossLiqInfo.isLiqSet).to.eq(true);
                        expect(crossLiqInfo.lid).to.eq(nextLid);
                    });

                    it("should return liquidity back to owner when cross liquidity market is set to zero", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost});

                        let liq = await core.getLiquidity(params.crossLiquidity.marketId, proxyLP.address, 0);
                        expect(liq.amount).to.eq(swapCost);

                        const lpBal = await deployer.getBalance();

                        const oldCxLiqMkt = params.crossLiquidity.marketId;
                        params.amount = 0;
                        params.crossLiquidity.marketId = AddressZero;
                        const tx = await proxyLP.updateFungibleLiquidity(params);
                        await expect(tx).to.emit(core, "UpdatedFungibleLiquidity");

                        const txReceipt = await tx.wait();
                        let gasUsed = txReceipt.gasUsed.toNumber();
                        let gasFee = toBN(gasUsed).mul(tx.gasPrice as BigNumber);

                        liq = await core.getLiquidity(oldCxLiqMkt, proxyLP.address, 0);
                        expect(liq.amount).to.eq(0);

                        expect(await deployer.getBalance()).to.eq(lpBal.add(swapCost).sub(gasFee));
                        expect(await ethers.provider.getBalance(proxyLP.address)).to.eq(0);

                        const crossLiq = await proxyLP.crossLiqs(params.marketId, 0);
                        expect(crossLiq.marketId).to.eq(AddressZero);
                    });

                    it("should transfer quote recieved to liquidity owner when no cross liquidity [market] is found", async () => {
                        await core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost});

                        let lpBal = await deployer.getBalance();

                        params.amount = 0;
                        params.crossLiquidity.marketId = AddressZero;
                        let tx = await proxyLP.updateFungibleLiquidity(params);
                        await expect(tx).to.emit(core, "UpdatedFungibleLiquidity");

                        const txReceipt = await tx.wait();
                        const gasUsed = txReceipt.gasUsed.toNumber();
                        const gasFee = toBN(gasUsed).mul(tx.gasPrice as BigNumber);

                        expect(await deployer.getBalance()).to.eq(lpBal.add(swapCost).sub(gasFee));

                        lpBal = await deployer.getBalance();

                        tx = await core.connect(swapper).swapQuoteForBase(swapParams, {value: swapCost});
                        await expect(tx).to.emit(core, "Swap");

                        expect(await ethers.provider.getBalance(proxyLP.address)).to.eq(0);

                        expect(await deployer.getBalance()).to.eq(lpBal.add(swapCost));
                    });
                });
            });
        });
    });
});
