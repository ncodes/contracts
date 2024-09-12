import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {BigNumber, BigNumberish} from "ethers";
import {ethers} from "hardhat";
import {AssetRegistry, Core, FeePool, FeePurse, MarketCore, MediatorManager, TOKEN} from "../../typechain-types";
import {AddressZero, AssetType, advanceBlockTime, getERC20, makeMarketID, powOf, toBN, toDec} from "../../utils/utils";
import {initCoreTestSuite} from "../helpers/helpers";
const {getContractFactory} = ethers;

describe("Core", function () {
    let baseAddr: string;
    let quoteAddr: string;
    let core: Core;
    let mc: MarketCore;
    let medMgr: MediatorManager;
    let feePurse: FeePurse;
    let assetReg: AssetRegistry;
    let deployer: SignerWithAddress;
    let user5: SignerWithAddress;
    let cAddr: string;
    let accts: SignerWithAddress[];
    let token: TOKEN;
    let baseAsset: TOKEN;
    let quoteAsset: TOKEN;
    let mid: string;
    let tokenDec: BigNumber;
    let baseDec: BigNumber;
    let quoteDec: BigNumber;
    let minTimeToPay: number;
    let orderGracePeriod: number;
    let orderLifeTime: number;
    let maxSupply = 3;
    let hiddenURI: string;
    let baseURI: string;
    let amountOfBase: BigNumber;
    let pricePerBase: BigNumber;
    let fixedSynthSwapFee: BigNumberish;

    let marketCreator: SignerWithAddress, provider: SignerWithAddress, swapper: SignerWithAddress, marketCreator2: SignerWithAddress, inventor: SignerWithAddress;

    beforeEach(async () => {
        const vars = await initCoreTestSuite();
        baseAddr = vars.baseAddr;
        quoteAddr = vars.quoteAddr;
        core = vars.core;
        mc = vars.mc;
        feePurse = vars.feePurse;
        assetReg = vars.assetReg;
        deployer = vars.deployer;
        user5 = vars.user5;
        cAddr = vars.cAddr;
        accts = vars.accts;
        token = vars.token;
        baseAsset = vars.baseAsset;
        quoteAsset = vars.quoteAsset;
        mid = vars.mid;
        tokenDec = vars.tokenDec;
        baseDec = vars.baseDec;
        quoteDec = vars.quoteDec;
        minTimeToPay = vars.minTimeToPay;
        orderGracePeriod = vars.orderGracePeriod;
        orderLifeTime = vars.orderLifeTime;
        maxSupply = vars.maxSupply;
        hiddenURI = vars.hiddenURI;
        baseURI = vars.baseURI;
        amountOfBase = vars.amountOfBase;
        pricePerBase = vars.pricePerBase;
        fixedSynthSwapFee = vars.fixedSynthSwapFee;
        deployer = vars.deployer;
        marketCreator = vars.marketCreator;
        provider = vars.provider;
        swapper = vars.swapper;
        marketCreator2 = vars.marketCreator2;
        inventor = vars.inventor;
        user5 = vars.user5;
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

    function createOrder_BaseOn_QuoteOff(mid: string, amount = 5, price = pricePerBase, lid = 0, ids: BigNumberish[] = []) {
        return new Promise<BigNumber>(async (resolve, reject) => {
            try {
                await provideLiquidity(provider, amountOfBase, price);
                const swapAmt = toBN(amount).mul(baseDec);
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
                return resolve(res.events?.at(0)?.args?.numTypeInfo[0]);
            } catch (e) {
                reject(e);
            }
        });
    }

    describe(".setFeePool", () => {
        it("should revert with msg='OWNABLE: NOT_OWNER' when sender is not deployer", async () => {
            await expect(core.connect(accts[1]).setFeePool(accts[0].address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should succeed when sender is deployer", async () => {
            await expect(core.connect(accts[0]).setFeePool(accts[0].address)).not.to.be.reverted;
            expect((await core.state2()).feePool.toString()).to.equal(accts[0].address);
        });
    });

    describe(".setOrderGraceDur", () => {
        it("should revert with msg='OWNABLE: NOT_OWNER' when sender is not deployer", async () => {
            await expect(core.connect(accts[1]).setOrderGraceDur(2)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should succeed when sender is deployer", async () => {
            await expect(core.connect(accts[0]).setOrderGraceDur(5)).not.to.be.reverted;
            expect((await core.state()).orderGraceDur).to.equal(toBN(5));
        });
    });

    describe(".setProviderRegistry", () => {
        it('should revert with msg="OWNABLE: NOT_OWNER" when sender is not deployer', async () => {
            await expect(core.connect(accts[1]).setProviderRegistry(accts[1].address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should succeed when sender is deployer", async () => {
            await expect(core.setProviderRegistry(accts[1].address)).not.to.be.reverted;
            expect((await core.state2()).provReg).to.eql(accts[1].address);
        });
    });

    describe(".setMinTimeToPay", () => {
        it("should revert with msg='OWNABLE: NOT_OWNER' when sender is not deployer", async () => {
            await expect(core.connect(accts[1]).setMinTimeToPay(2)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should succeed when sender is deployer", async () => {
            await expect(core.connect(accts[0]).setMinTimeToPay(5)).not.to.be.reverted;
            expect((await core.state()).minTimeToPay).to.equal(toBN(5));
        });
    });

    describe(".setMaxOpenOrders", () => {
        it("should revert with msg='OWNABLE: NOT_OWNER' when sender is not deployer", async () => {
            await expect(core.connect(accts[1]).setMaxOpenOrders(2)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should succeed when sender is deployer", async () => {
            await expect(core.connect(accts[0]).setMaxOpenOrders(5)).not.to.be.reverted;
            expect((await core.state()).ints.maxOpenOrders).to.equal(toBN(5));
        });
    });

    describe(".setProtoFee", () => {
        it("should set correct values", async () => {
            await expect(core.setProtoFee(1, 1, 1, 1, 2, 1)).not.to.be.reverted;
            expect((await core.state()).ints.instantSwapFeeBp).to.eql(toBN(1));
            expect((await core.state()).ints.synthSwapFeeBp).to.eql(toBN(1));
            expect((await core.state()).ints.stableSwapFeeBp).to.eql(toBN(1));
            expect((await core.state()).ints.fixedSynthSwapFee).to.eql(toBN(1));
            expect((await core.state()).ints.fixedNFTSwapFee).to.eql(toBN(2));
            expect((await core.state()).ints.instantNFTSwapFeeBp).to.eql(toBN(1));
        });
    });

    describe(".configureFeePool", () => {
        it("should set values correctly", async () => {
            await core.configureFeePool(toBN(100));
            expect((await core.state()).feePoolTxInterval).to.eql(toBN(100));
        });
    });

    describe(".setProtoFeeSplit", () => {
        it("should revert with msg='OWNABLE: NOT_OWNER' when sender is not deployer", async () => {
            await expect(core.connect(accts[1]).setProtoFeeSplit(1, 1, 1)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should revert with msg='OC: INV_BP_TOO_LOW' when inventor BP is too low", async () => {
            await expect(core.setProtoFeeSplit(1000, 0, 0)).to.be.revertedWith("OC: INV_BP_TOO_LOW");
        });

        it("should revert with msg='OC: UNBALANCED' when base points do not represent 100%", async () => {
            await expect(core.setProtoFeeSplit(5000, 1, 1)).to.be.revertedWith("OC: UNBALANCED");
        });

        it("should be successfully update base points", async () => {
            await expect(core.setProtoFeeSplit(3000, 5000, 2000)).not.to.be.reverted;
            expect(await core.getFeeBPs()).to.eql([toBN(3000), toBN(5000), toBN(2000)]);
        });
    });

    describe.skip(".transferToFeePool", () => {
        const marketCom = 0.1 * 100;
        let fp: FeePool;
        let protoFee: BigNumber;
        let shareableBal: BigNumber;

        context("fee purse is non-zero", () => {
            it("should successfully transfer fee purse balance of Core to fee pool", async () => {
                await core.configureFeePool(toBN(86400));

                let factory = await getContractFactory("FeePool");
                fp = (await factory.deploy(user5.address, core.address)) as FeePool;
                await core.setFeePool(fp.address);
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 1, 1, false, false, marketCom, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 1);

                await provideLiquidity(provider, amountOfBase, pricePerBase);

                // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)
                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                // Calculate expected swapper fees (for on-chain swap)
                protoFee = swapAmt.mul((await core.state()).ints.instantSwapFeeBp).div(toBN(10000));

                // Make base asset non-shareable
                await assetReg.setSharable(baseAddr, false);

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
                ).to.emit(core, "Swap");

                // all protocol fee should go to inventor
                expect(await core.inventorBalanceOf(baseAddr)).to.eql(protoFee);
                expect(await core.shareablesBalanceOf(baseAddr)).to.eq(0);

                // Transfer native tokens to FeePool with core as beneficiary
                const feePurseBal = 1000;
                await token.approve(feePurse.address, feePurseBal);
                await feePurse.deposit(feePurseBal);
                await feePurse.updateWriter(deployer.address, true);
                await feePurse.transferFrom(deployer.address, core.address, feePurseBal);

                // transfer fee successfully
                await expect(core.transferToFeePool(baseAddr)).emit(core, "TransferredToFeePool").emit(feePurse, "Withdrawn");

                // Balances should be expected
                expect(await token.balanceOf(fp.address)).to.eq(feePurseBal);
                expect(await token.balanceOf(feePurse.address)).to.eq(0);
                expect(await feePurse.balanceOf(deployer.address)).to.eq(0);
            });
        });

        context("fee purse is zero (fork mainnet)", () => {
            const WETH9 = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

            beforeEach(async () => {
                await core.configureFeePool(toBN(86400));

                // set up provider's impersonated account (UNI)
                baseAddr = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
                await core.setAmmPoolInfo(baseAddr, WETH9, 3000);
                const baseAsset = getERC20(ethers.provider, baseAddr);
                provider = await ethers.getImpersonatedSigner("0xb93B36F305464761ABDbd01D7731D4BA496Fb6Fb");
                await core.setAmmInfo("0xE592427A0AEce92De3Edee1F18E0157C05861564", WETH9, 3000);

                // Setup Fee pool
                let factory = await getContractFactory("FeePool");
                fp = (await factory.deploy(user5.address, core.address)) as FeePool;
                await core.setFeePool(fp.address);
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 1, 1, false, false, marketCom, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 1);

                // Add provider's liquidity
                await baseAsset.connect(provider).approve(core.address, amountOfBase);
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

                // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                // Give swapper enough BASE to pay swap cost and swapper must approve contract to spend it
                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                // Calculate expected swapper fees (for on-chain swap)
                protoFee = swapAmt.mul((await core.state()).ints.instantSwapFeeBp).div(toBN(10000));

                // Swap (allow fee to be shared)
                await assetReg.setSharable(baseAddr, true);
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
                ).to.emit(core, "Swap");

                // protocol share protocol fee
                shareableBal = await core.shareablesBalanceOf(baseAddr);
                expect((await core.inventorBalanceOf(baseAddr)).eq(protoFee.div(2))).to.be.true;
                expect((await core.shareablesBalanceOf(baseAddr)).eq(shareableBal)).to.be.true;

                // transfer fee successfully
                await expect(core.transferToFeePool(baseAddr)).to.emit(core, "TransferredToFeePool");
            });

            it("should send shareable fee to FeeReward contract", async () => {
                expect((await core.shareablesBalanceOf(baseAddr)).eq(0)).to.be.true;

                // ensure fee pool contract has non zero balance
                expect(await getERC20(ethers.provider, WETH9).balanceOf(fp.address)).not.to.eq(0);

                // expect fee pool to have been notified
                expect((await fp.periodFinish(WETH9)).gt(0)).to.be.true;
                expect((await fp.lastUpdateTime(WETH9)).gt(0)).to.be.true;
                expect((await fp.rewardRates(WETH9)).gt(0)).to.be.true;
            });

            it("should revert with msg='OC: NOT_READY' when called before the next call interval", async () => {
                await expect(core.transferToFeePool(baseAddr)).to.be.revertedWith("OC: NOT_READY");
            });

            it("should not revert with msg='OC: NOT_READY' when called in the next call interval", async () => {
                await advanceBlockTime(86400);
                await expect(core.transferToFeePool(baseAddr)).not.to.be.revertedWith("OC: NOT_READY");
            });
        });

        context("fee token is native ETH; convert to ERC20 and send to FeePool (fork mainnet)", () => {
            const WETH9 = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
            const outToken = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984"; // UNI

            beforeEach(async () => {
                const nativeAssetAddr = WETH9;
                baseAddr = nativeAssetAddr;

                await mc.setNativeAssetAddr(nativeAssetAddr);
                await core.configureFeePool(toBN(86400));
                amountOfBase = powOf(10, 18);

                // set up provider's impersonated account (UNI)
                await core.setAmmPoolInfo(nativeAssetAddr, outToken, 3000);
                provider = await ethers.getImpersonatedSigner("0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B");
                await core.setAmmInfo("0xE592427A0AEce92De3Edee1F18E0157C05861564", WETH9, 3000);

                // Setup Fee pool
                let factory = await getContractFactory("FeePool");
                fp = (await factory.deploy(user5.address, core.address)) as FeePool;
                await core.setFeePool(fp.address);

                // Create market
                await mc.connect(marketCreator2).createMarket(nativeAssetAddr, quoteAddr, AssetType.NATIVE, AssetType.ERC20, false, false, marketCom, 0);
                mid = makeMarketID(marketCreator2.address, nativeAssetAddr, quoteAddr, AssetType.NATIVE, AssetType.ERC20);

                // Add provider's liquidity
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

                // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                // Give swapper enough QUOTE to pay swap cost and swapper must approve contract to spend it
                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                // Calculate expected swapper fees (for on-chain swap)
                protoFee = swapAmt.mul((await core.state()).ints.instantSwapFeeBp).div(toBN(10000));

                // Swap (allow fee to be shared)
                await assetReg.setSharable(baseAddr, true);
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
                ).to.emit(core, "Swap");

                // protocol share protocol fee
                expect((await core.inventorBalanceOf(baseAddr)).eq(protoFee.div(2))).to.be.true;
                shareableBal = await core.shareablesBalanceOf(baseAddr);

                // transfer fee successfully
                await expect(core.transferToFeePool(baseAddr)).to.emit(core, "TransferredToFeePool");
            });

            it("should send shareable fee to FeeReward contract", async () => {
                expect((await core.shareablesBalanceOf(baseAddr)).eq(0)).to.be.true;

                // ensure fee pool contract has non zero balance
                expect(await getERC20(ethers.provider, outToken).balanceOf(fp.address)).not.to.eq(0);

                // expect fee pool to have been notified
                expect((await fp.periodFinish(outToken)).gt(0)).to.be.true;
                expect((await fp.lastUpdateTime(outToken)).gt(0)).to.be.true;
                expect((await fp.rewardRates(outToken)).gt(0)).to.be.true;
            });
        });
    });

    describe(".withdrawFeeBalance", () => {
        const marketCom = 0.1 * 100; // convert to 10 basis point
        beforeEach(async () => {
            await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 1, 1, false, false, marketCom, 0);
            mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 1);
        });

        it("should successfully withdraw and update fee balance correctly", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);

            // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
            const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
            const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

            // Give swapper enough BASE to pay swap cost and swapper must approve contract to spend it
            await quoteAsset.transfer(swapper.address, swapCost);
            await quoteAsset.connect(swapper).approve(cAddr, swapCost);

            // Calculate expected swapper fees (for on-chain swap)
            const protoFee = swapAmt.mul((await core.state()).ints.instantSwapFeeBp).div(10000);
            const marketCreatorFee = swapAmt.mul(marketCom).div(10000);

            // Swap
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

            // market creator and protocol should receive fee
            expect((await core.feeBalanceOf(marketCreator2.address, baseAddr)).eq(marketCreatorFee)).to.be.true;
            expect((await core.inventorBalanceOf(baseAddr)).eq(protoFee)).to.be.true;

            // Withdraw market creator fee.
            await expect(core.connect(marketCreator2).withdrawFeeBalance(baseAddr)).not.to.be.reverted;
            expect((await core.feeBalanceOf(marketCreator2.address, baseAddr)).eq(0)).to.be.true;
            expect((await baseAsset.balanceOf(marketCreator2.address)).eq(marketCreatorFee)).to.be.true;
        });
    });

    describe(".withdrawInventorBalance", () => {
        const marketCom = 0.1 * 100; // convert to 10 basis point
        beforeEach(async () => {
            await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 1, 1, false, false, marketCom, 0);
            mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 1);
        });

        it("should revert with reason=NOT_INVENTOR when sender is not the protocol fee recipient", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);

            // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
            const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
            const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

            // Give swapper enough BASE to pay swap cost and swapper must approve contract to spend it
            await quoteAsset.transfer(swapper.address, swapCost);
            await quoteAsset.connect(swapper).approve(cAddr, swapCost);

            // Swap
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

            // Withdraw market creator fee.
            await expect(core.withdrawInventorBalance(baseAddr)).to.be.revertedWith("NOT_INVENTOR");
        });

        it("should not revert when sender is the protocol fee recipient", async () => {
            await provideLiquidity(provider, amountOfBase, pricePerBase);

            // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
            const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
            const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

            // Give swapper enough BASE to pay swap cost and swapper must approve contract to spend it
            await quoteAsset.transfer(swapper.address, swapCost);
            await quoteAsset.connect(swapper).approve(cAddr, swapCost);

            // Calculate expected swapper fees (for on-chain swap)
            const protoFee = swapAmt.mul((await core.state()).ints.instantSwapFeeBp).div(10000);
            const marketCreatorFee = swapAmt.mul(marketCom).div(10000);

            // Swap
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

            // market creator and protocol should receive fee
            expect((await core.feeBalanceOf(marketCreator2.address, baseAddr)).eq(marketCreatorFee)).to.be.true;
            expect((await core.inventorBalanceOf(baseAddr)).eq(protoFee)).to.be.true;

            // Set inventor fee recipient
            await core.connect(inventor).setInventor(user5.address);

            // Withdraw protocol fee.
            await expect(core.connect(user5).withdrawInventorBalance(baseAddr)).not.to.be.reverted;
            expect((await core.inventorBalanceOf(baseAddr)).eq(0)).to.be.true;
            expect((await baseAsset.balanceOf(user5.address)).eq(protoFee)).to.be.true;
        });

        context("when fee is denominated in native asset", () => {
            it("should withdraw native asset", async () => {
                await mc.setNativeAssetAddr(baseAddr);
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.NATIVE, AssetType.ERC20, false, false, marketCom, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.ERC20);

                const params = {
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
                };
                await core.connect(provider).updateFungibleLiquidity(params, {value: amountOfBase});

                // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                // Give swapper enough BASE to pay swap cost and swapper must approve contract to spend it
                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                // Calculate expected swapper fees (for on-chain swap)
                const protoFee = swapAmt.mul((await core.state()).ints.instantSwapFeeBp).div(10000);
                const marketCreatorFee = swapAmt.mul(marketCom).div(10000);

                // Swap
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
                expect((await core.inventorBalanceOf(baseAddr)).eq(protoFee)).to.be.true;

                // Set inventor fee recipient
                await core.connect(inventor).setInventor(user5.address);

                const prevUser5Bal = await core.provider.getBalance(user5.address);

                // Withdraw protocol fee.
                const tx = await core.connect(user5).withdrawInventorBalance(baseAddr);
                expect((await core.inventorBalanceOf(baseAddr)).eq(0)).to.be.true;

                // calculate gas fee in eth
                const txReceipt = await tx.wait();
                const gasUsed = txReceipt.gasUsed.mul(tx.gasPrice as BigNumber);

                const user5Bal = await core.provider.getBalance(user5.address);
                expect(user5Bal).to.eq(prevUser5Bal.add(protoFee).sub(gasUsed));
            });
        });
    });

    describe(".canCreateDispute", () => {
        beforeEach(async () => {
            await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);
        });

        it("should revert with reason='UNKNOWN_ORDER' when order was not found", async () => {
            await expect(core.canCreateDispute(0, swapper.address)).to.be.revertedWith("UNKNOWN_ORDER");
        });

        it("should return false when market has a manager", async () => {
            const orderID = await createOrder_BaseOn_QuoteOff(mid);
            await mc.createMarketWithManager(baseAddr, quoteAddr, 1, 0, false, false, 0, 0, accts[4].address);
            mid = makeMarketID(deployer.address, baseAddr, quoteAddr, 1, 0);
            expect(await core.canCreateDispute(orderID, marketCreator.address)).to.be.false;
        });

        it("should return false when 'addr' was not a provider or taker", async () => {
            const orderID = await createOrder_BaseOn_QuoteOff(mid);
            expect(await core.canCreateDispute(orderID, marketCreator.address)).to.be.false;
        });

        it("should return false when order has been released", async () => {
            const orderID = await createOrder_BaseOn_QuoteOff(mid);
            await core.connect(swapper).markOrderAsPaid(orderID);
            await core.connect(provider).releaseOrder(orderID);
            expect(await core.canCreateDispute(orderID, swapper.address)).to.be.false;
        });

        it("should return false when order has been cancelled", async () => {
            const orderID = await createOrder_BaseOn_QuoteOff(mid);
            await advanceBlockTime(orderLifeTime);
            await expect(core.connect(swapper).cancelOrder(orderID)).not.to.be.reverted;
            expect(await core.canCreateDispute(orderID, swapper.address)).to.be.false;
        });

        it("should return false when order has not been marked as paid", async () => {
            const orderID = await createOrder_BaseOn_QuoteOff(mid);
            expect(await core.canCreateDispute(orderID, swapper.address)).to.be.false;
        });

        it("should return true when order has been marked as paid", async () => {
            const orderID = await createOrder_BaseOn_QuoteOff(mid);
            await core.connect(swapper).markOrderAsPaid(orderID);
            expect(await core.canCreateDispute(orderID, provider.address)).to.be.true;
        });

        context("market has a dispute delay set", () => {
            it("should return false when within dispute delay time", async () => {
                await mc.connect(marketCreator2).setDisputeDelayDuration(mid, 10);
                const now = await advanceBlockTime(1);
                const orderID = await createOrder_BaseOn_QuoteOff(mid);
                await core.connect(swapper).markOrderAsPaid(orderID);
                expect(await core.canCreateDispute(orderID, swapper.address)).to.be.false;
                const order = await core.getOrder(orderID);
                expect(order.disputeFrom.gt(now)).to.be.true;
            });
        });
    });

    describe(".setDisputeManager", () => {
        it("should revert with reason='OWNABLE: NOT_OWNER' when sender is not deployer", async () => {
            await expect(core.connect(provider).setDisputeManager(provider.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully set dispute manager", async () => {
            await expect(core.connect(deployer).setDisputeManager(provider.address)).not.to.be.reverted;
            expect((await core.state2()).disputeManager).to.equal(provider.address);
        });
    });

    describe(".markAsDisputed", () => {
        beforeEach(async () => {
            await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);
        });

        it("should revert with reason='NOT_DISPUTE_MGR' when sender is not the dispute manager", async () => {
            const orderID = await createOrder_BaseOn_QuoteOff(mid);
            await expect(core.connect(provider).markAsDisputed(orderID)).to.be.revertedWith("NOT_DISPUTE_MGR");
        });

        it("should succeed when sender is the dispute manager", async () => {
            const orderID = await createOrder_BaseOn_QuoteOff(mid);
            await core.setDisputeManager(provider.address);
            await expect(core.connect(provider).markAsDisputed(orderID)).not.to.be.reverted;

            // should increment market num. disputes
            const market = await mc.getMarket(mid);
            expect(market.numDisputes.eq(1)).to.be.true;
        });
    });
});
