import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Buffer} from "buffer";
import {expect} from "chai";
import {BigNumber, BigNumberish} from "ethers";
import {getAddress} from "ethers/lib/utils";
import {ethers} from "hardhat";
import {AssetRegistry, BadgeManager, Core, ERC1155T, ERC721T, FeePurse, MarketCore, MediatorManager, NFT, Operator, TOKEN, WETH9} from "../../typechain-types";
import {AddressZero, AssetType, advanceBlockTime, bnToN, makeMarketID, toBN, toDec} from "../../utils/utils";
import {initCoreTestSuite} from "../helpers/helpers";
const {getContractFactory} = ethers;

describe("Core - Swap", function () {
    let baseAddr: string;
    let quoteAddr: string;
    let core: Core;
    let mc: MarketCore;
    let nft: NFT;
    let badgeMgr: BadgeManager;
    let testERC721: ERC721T;
    let testERC1155: ERC1155T;
    let assetReg: AssetRegistry;
    let operator: Operator;
    let deployer: SignerWithAddress;
    let accts: SignerWithAddress[];
    let user5: SignerWithAddress;
    let cAddr: string;
    let token: TOKEN;
    let baseAsset: TOKEN;
    let quoteAsset: TOKEN;
    let mid: string;
    let tokenDec: BigNumber;
    let baseDec: BigNumber;
    let quoteDec: BigNumber;
    let minTimeToPay: number;
    let orderGracePeriod: number;
    let maxSupply = 3;
    let amountOfBase: BigNumber;
    let pricePerBase: BigNumber;
    let fixedSynthSwapFee: BigNumberish;
    let instantNFTSwapFee: BigNumberish;
    let instantSwapFee: BigNumberish;
    let fixedNFTSwapFee: BigNumberish;
    let synthSwapFee: BigNumberish;
    let stableSwapFee: BigNumberish;
    let feePurse: FeePurse;
    let mediatorMgr: MediatorManager;
    let wethAddr: string;
    let weth: WETH9;

    let marketCreator: SignerWithAddress, provider: SignerWithAddress, swapper: SignerWithAddress, marketCreator2: SignerWithAddress, inventor: SignerWithAddress;

    beforeEach(async () => {
        const vars = await initCoreTestSuite();
        baseAddr = vars.baseAddr;
        quoteAddr = vars.quoteAddr;
        core = vars.core;
        mc = vars.mc;
        nft = vars.nft;
        wethAddr = vars.wethAddr;
        weth = vars.weth;
        badgeMgr = vars.badgeMgr;
        testERC721 = vars.testERC721;
        testERC1155 = vars.testERC1155;
        assetReg = vars.assetReg;
        deployer = vars.deployer;
        accts = vars.accts;
        cAddr = vars.cAddr;
        token = vars.token;
        operator = vars.operator;
        baseAsset = vars.baseAsset;
        quoteAsset = vars.quoteAsset;
        mid = vars.mid;
        tokenDec = vars.tokenDec;
        baseDec = vars.baseDec;
        quoteDec = vars.quoteDec;
        minTimeToPay = vars.minTimeToPay;
        orderGracePeriod = vars.orderGracePeriod;
        maxSupply = vars.maxSupply;
        amountOfBase = vars.amountOfBase;
        pricePerBase = vars.pricePerBase;
        fixedSynthSwapFee = vars.fixedSynthSwapFee;
        instantNFTSwapFee = vars.instantNFTSwapFee;
        deployer = vars.deployer;
        user5 = vars.user5;
        marketCreator = vars.marketCreator;
        provider = vars.provider;
        swapper = vars.swapper;
        marketCreator2 = vars.marketCreator2;
        inventor = vars.inventor;
        instantSwapFee = vars.instantSwapFee;
        synthSwapFee = vars.synthSwapFee;
        stableSwapFee = vars.stableSwapFee;
        feePurse = vars.feePurse;
        fixedNFTSwapFee = vars.fixedNFTSwapFee;
        mediatorMgr = vars.mediatorMgr;

        await core.setProtoFee(instantSwapFee, synthSwapFee, stableSwapFee, 0, 0, instantNFTSwapFee);
        await mediatorMgr.updateTicketPool(0, 0, 1, 1, 1, 1, 1, 1, 1, false, false);
    });

    async function createMarket(creator: SignerWithAddress = deployer, base: string, quote: string, baseType: number, quoteType: number, permPut: boolean, permSwap: boolean, commission: BigNumberish, mediatorPoolId: BigNumberish) {
        const mid = makeMarketID(creator.address, base, quote, baseType, quoteType);
        await mc.connect(creator).createMarket(base, quote, baseType, quoteType, permPut, permSwap, commission, mediatorPoolId);
        return Promise.resolve(mid);
    }

    async function provideLiquidity(provider: SignerWithAddress, liquidityAmt: BigNumber, basePrice: BigNumber, timeToPay = 0) {
        await baseAsset.transfer(provider.address, liquidityAmt);
        await baseAsset.connect(provider).approve(cAddr, liquidityAmt);
        await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [liquidityAmt, basePrice], [], [], [timeToPay, 0, 0]);
    }

    describe(".swapQuoteForBase", () => {
        beforeEach(async () => {
            await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 1);
        });

        context("when market set required badge(s) for SWAP operation", () => {
            it("should revert with msg=MKT_BADGE_REQ when sender does not have the required badge", async () => {
                await provideLiquidity(provider, amountOfBase, pricePerBase);

                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)
                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                const badges: [string, string][] = [["verified", ""]];
                await mc.connect(marketCreator2).setRequiredBadges(mid, [], badges);

                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0)).to.be.revertedWith("OC: MKT_BADGE_REQ");
            });

            it("should revert with msg=MKT_BADGE_REQ when sender does not have all the required badges", async () => {
                await provideLiquidity(provider, amountOfBase, pricePerBase);

                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)
                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                await badgeMgr.registerIssuer(user5.address, "verified", [], []);
                await badgeMgr.connect(user5).grantBadge("verified", "", swapper.address, 0, [], []);
                const badges: [string, string][] = [
                    ["verified", ""],
                    ["pm", "bank_transfer"],
                ];
                await mc.connect(marketCreator2).setRequiredBadges(mid, [], badges);

                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0)).to.be.revertedWith("OC: MKT_BADGE_REQ");
            });

            it("should succeed when sender has all required badges", async () => {
                await provideLiquidity(provider, amountOfBase, pricePerBase);

                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)
                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                await badgeMgr.registerIssuer(user5.address, "verified", [], []);
                await badgeMgr.registerIssuer(accts[1].address, "pm", [], []);
                await badgeMgr.connect(accts[1]).registerPath("pm", "bank_transfer", [], []);
                await badgeMgr.connect(user5).grantBadge("verified", "", swapper.address, 0, [], []);
                await badgeMgr.connect(accts[1]).grantBadge("pm", "bank_transfer", swapper.address, 0, [], []);
                const badges: [string, string][] = [
                    ["verified", ""],
                    ["pm", "bank_transfer"],
                ];
                await mc.connect(marketCreator2).setRequiredBadges(mid, badges, []);

                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0)).not.to.be.reverted;
            });
        });

        context("when liquidity provider set required badge(s) for SWAP operation", () => {
            it("should revert with msg=LP_BADGE_REQ when sender does not have the required badge", async () => {
                await provideLiquidity(provider, amountOfBase, pricePerBase);

                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)
                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                const badges: [string, string][] = [["verified", ""]];
                await core.connect(provider).setSwapBadgeForLiquidity(mid, 0, badges);

                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0)).to.be.revertedWith("OC: LP_BADGE_REQ");
            });

            it("should revert with msg=LP_BADGE_REQ when sender does not have all the required badges", async () => {
                await provideLiquidity(provider, amountOfBase, pricePerBase);

                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)
                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                await badgeMgr.registerIssuer(user5.address, "verified", [], []);
                await badgeMgr.connect(user5).grantBadge("verified", "", swapper.address, 0, [], []);
                const badges: [string, string][] = [
                    ["verified", ""],
                    ["pm", "bank_transfer"],
                ];
                await core.connect(provider).setSwapBadgeForLiquidity(mid, 0, badges);

                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0)).to.be.revertedWith("OC: LP_BADGE_REQ");
            });

            it("should succeed when sender has all required badges", async () => {
                await provideLiquidity(provider, amountOfBase, pricePerBase);

                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)
                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                await badgeMgr.registerIssuer(user5.address, "verified", [], []);
                await badgeMgr.registerIssuer(accts[1].address, "pm", [], []);
                await badgeMgr.connect(accts[1]).registerPath("pm", "bank_transfer", [], []);
                await badgeMgr.connect(user5).grantBadge("verified", "", swapper.address, 0, [], []);
                await badgeMgr.connect(accts[1]).grantBadge("pm", "bank_transfer", swapper.address, 0, [], []);
                const badges: [string, string][] = [
                    ["verified", ""],
                    ["pm", "bank_transfer"],
                ];
                await core.connect(provider).setSwapBadgeForLiquidity(mid, 0, badges);

                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0)).not.to.be.reverted;
            });
        });
    });

    describe(".swapQuoteForBase (fungible)", () => {
        beforeEach(async () => {
            await mc.createMarket(baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0, 0);
        });

        it("should revert with msg='OC: EXPIRED_TX' when expireAt time was surpassed", async () => {
            const now = await advanceBlockTime(1);
            await expect(core.swapQuoteForBase(mid, swapper.address, AddressZero, 0, 0, 0, [], now, 0)).to.be.revertedWith("OC: EXPIRED_TX");
        });

        it("should revert with msg='MC: UNKNOWN_MARKET' when market is unknown", async () => {
            await expect(core.swapQuoteForBase(AddressZero, swapper.address, AddressZero, 0, 0, 0, [], 0, 0)).to.be.revertedWith("MC: UNKNOWN_MARKET");
        });

        context("market is offer-only", () => {
            it("should revert with msg=OFFER_ONLY", async () => {
                mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0, 0);
                await mc.connect(marketCreator2).markAsOfferOnly(mid);
                await expect(core.swapQuoteForBase(mid, swapper.address, AddressZero, 0, 0, 0, [], 0, 0)).to.be.revertedWith("OC: OFFER_ONLY");
            });
        });

        it("should revert with msg='ZERO_LIQ' when liquidity is zero", async () => {
            await expect(core.swapQuoteForBase(mid, swapper.address, AddressZero, 0, 100, 1, [], 0, 0)).to.be.revertedWith("OC: ZERO_LIQ");
        });

        it("should revert with msg='AMOUNT_REQ' when amount was not provided", async () => {
            await baseAsset.transfer(provider.address, "100");
            await baseAsset.connect(provider).approve(cAddr, 100);
            await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [100, 10], [], [], [0, 0, 0]);
            await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, [], 0, 0)).to.be.revertedWith("OC: AMOUNT_REQ");
        });

        it("should revert with msg='MAX_PRICE_REQ' when maxPrice is unset", async () => {
            await baseAsset.transfer(provider.address, "100");
            await baseAsset.connect(provider).approve(cAddr, 100);
            await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [100, 10], [], [], [0, 0, 0]);
            await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 1, 0, [], 0, 0)).to.be.revertedWith("OC: MAX_PRICE_REQ");
        });

        it("should revert with msg='LIQ_PAUSED' when liquidity is paused", async () => {
            await baseAsset.transfer(provider.address, "100");
            await baseAsset.connect(provider).approve(cAddr, 100);
            await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [100, 10], [], [], [0, 0, 0]);
            await core.connect(provider).togglePause(mid, 0, 0);
            await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 101, 1, [], 0, 0)).to.be.revertedWith("OC: LIQ_PAUSED");
        });

        it("should revert with msg='LOW_LIQ' when amount=0", async () => {
            await baseAsset.transfer(provider.address, "100");
            await baseAsset.connect(provider).approve(cAddr, 100);
            await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [100, 10], [], [], [0, 0, 0]);
            await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 101, 1, [], 0, 0)).to.be.revertedWith("OC: LOW_LIQ");
        });

        it("should revert with msg='MAX_PRICE_TOO_LOW' when amount=0", async () => {
            await baseAsset.transfer(provider.address, "104");
            await baseAsset.connect(provider).approve(cAddr, 100);
            await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [100, 10], [], [], [0, 0, 0]);
            await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 100, 9, [], 0, 0)).to.be.revertedWith("MAX_PRICE_TOO_LOW");
        });

        it("should revert with msg='NOT_TARGET' when sender is not the liquidity target", async () => {
            await baseAsset.transfer(provider.address, "104");
            await baseAsset.connect(provider).approve(cAddr, 100);
            await core.connect(provider).updateFungibleLiquidity(mid, 0, false, swapper.address, [100, 10], [], [], [0, 0, 0]);
            await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 100, 10, [], 0, 0)).to.be.revertedWith("NOT_TARGET");
        });

        context("base is ERC20 and quote is ERC20", () => {
            let marketCommission = 2500;

            beforeEach(async () => {
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, marketCommission, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 1);
            });

            it("should revert with msg='IDS_NREQ' when ids is set", async () => {
                await baseAsset.transfer(provider.address, "104");
                await baseAsset.connect(provider).approve(cAddr, 104);
                await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [100, 10], [], [], [0, 0, 0]);
                await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 1, 1, [1], 0, 0)).to.be.revertedWith("OC: IDS_NREQ");
            });

            it("should revert with msg='LOW_QUOTE_BAL' when sender's quote balance has insufficient balance for swap cost", async () => {
                const providerBal = toBN(100).mul(baseDec);
                await baseAsset.transfer(provider.address, providerBal);
                await baseAsset.connect(provider).approve(cAddr, providerBal);
                const pricePerQuote = toBN(1).mul(quoteDec); // wants 1 QUOTE /  BASE
                const maxPrice = pricePerQuote;
                await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [providerBal, pricePerQuote], [], [], [0, 0, 0]);
                const swapAmount = toBN(5).mul(baseDec); // wants 5 BASE
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmount, maxPrice, [], 0, 0)).to.be.revertedWith("LOW_QUOTE_BAL");
            });

            it("should perform instant swap transfer successfully", async () => {
                await provideLiquidity(provider, amountOfBase, pricePerBase);

                // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                // Give swapper enough QUOTE to pay swap cost and swapper must approve contract to spend it
                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                // Calculate expected swapper fees (for on-chain swap)
                const protoFee = swapAmt.mul((await core.state()).ints.instantSwapFeeBp).div(10000);
                const marketCreatorFee = swapAmt.mul(marketCommission).div(10000);
                const totalFees = protoFee.add(marketCreatorFee);
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0))
                    .to.emit(core, "Swap")
                    .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, swapAmt, pricePerBase, 0, 0], false, [], []);

                // swapper should get swap amount - swapper total fees
                expect((await baseAsset.balanceOf(swapper.address)).toString()).to.equal(swapAmt.sub(totalFees).toString());

                // provider should get full swap cost
                expect((await quoteAsset.balanceOf(provider.address)).toString()).to.equal(swapCost.toString());

                // swapper should have no quote balance = 0 (depleted)
                expect((await quoteAsset.balanceOf(swapper.address)).isZero()).to.be.true;

                // provider liquidity amount should = provider liquidity - swap amount (= 95)
                const liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.amount.toString()).to.equal(amountOfBase.sub(swapAmt).toString());

                // market creator should receive fee
                expect((await core.feeBalanceOf(marketCreator2.address, baseAddr)).eq(marketCreatorFee)).to.be.true;

                // protocol should receive fee
                expect((await core.inventorBalanceOf(baseAddr)).eq(protoFee)).to.be.true;
            });

            it("should share protocol fee if base asset is shareable", async () => {
                await provideLiquidity(provider, amountOfBase, pricePerBase);

                // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                // Give swapper enough QUOTE to pay swap cost and swapper must approve contract to spend it
                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                // Calculate expected swapper fees (for on-chain swap)
                const protoFee = swapAmt.mul((await core.state()).ints.instantSwapFeeBp).div(10000);

                // Make base asset shareable
                await assetReg.setSharable(baseAddr, true);
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0)).to.emit(core, "Swap");

                // protocol share protocol fee
                expect((await core.inventorBalanceOf(baseAddr)).eq(protoFee.div(2))).to.be.true;
                expect((await core.shareablesBalanceOf(baseAddr)).eq(protoFee.div(2))).to.be.true;
            });

            context("operator fee is set and swap include operator ID", async () => {
                it("should calculate correct operator fee", async () => {
                    await operator.setBond(0);
                    await operator.connect(user5).register();

                    await core.setProtoFeeSplit(5000, 2500, 2500);
                    await provideLiquidity(provider, amountOfBase, pricePerBase);

                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)
                    await quoteAsset.transfer(swapper.address, swapCost);
                    await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                    const protoFee = swapAmt.mul((await core.state()).ints.instantSwapFeeBp).div(10000);
                    await assetReg.setSharable(baseAddr, true);
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 1)).to.emit(core, "Swap");

                    expect((await core.inventorBalanceOf(baseAddr)).eq(protoFee.div(2))).to.be.true;
                    expect((await core.shareablesBalanceOf(baseAddr)).eq(protoFee.div(4))).to.be.true;
                    expect((await core.operatorBalanceOf(user5.address, baseAddr)).eq(protoFee.div(4))).to.be.true;

                    // Withdraw the reward
                    await expect(core.connect(user5).withdrawOperatorBalance(baseAddr)).not.to.be.reverted;
                    expect(await baseAsset.balanceOf(user5.address)).to.eql(protoFee.div(4));
                    expect(await core.operatorBalanceOf(user5.address, baseAddr)).to.eq(0);
                });
            });

            context("both assets are registered stablecoins", () => {
                it("should change stablecoin fees", async () => {
                    await assetReg.setStable(baseAddr, true);
                    await assetReg.setStable(quoteAddr, true);
                    await provideLiquidity(provider, amountOfBase, pricePerBase);

                    // Swap amount = 5 BASE (amount of BASE the swapper wants)
                    const swapAmt = toBN(5).mul(baseDec);
                    const swapCost = swapAmt.div(baseDec).mul(pricePerBase); // amount the swapper will pay in QUOTE (=50 QUOTE)

                    // Give swapper enough QUOTE to pay swap cost and swapper must approve contract to spend it
                    await quoteAsset.transfer(swapper.address, swapCost);
                    await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                    // Calculate expected swapper fees (for on-chain swap)
                    const protoFee = swapAmt.mul((await core.state()).ints.stableSwapFeeBp).div(10000);
                    const marketCreatorFee = swapAmt.mul(marketCommission).div(10000);
                    const totalFees = protoFee.add(marketCreatorFee);
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0))
                        .to.emit(core, "Swap")
                        .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, swapAmt, pricePerBase, 0, 0], false, [], []);

                    // swapper should get swap amount - swapper total fees
                    expect((await baseAsset.balanceOf(swapper.address)).toString()).to.equal(swapAmt.sub(totalFees).toString());

                    // provider should get full swap cost
                    expect((await quoteAsset.balanceOf(provider.address)).toString()).to.equal(swapCost.toString());

                    // swapper should have no quote balance = 0 (depleted)
                    expect((await quoteAsset.balanceOf(swapper.address)).isZero()).to.be.true;

                    // provider liquidity amount should = provider liquidity - swap amount (= 95)
                    const liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.amount.toString()).to.equal(amountOfBase.sub(swapAmt).toString());

                    // market creator should receive fee
                    expect((await core.feeBalanceOf(marketCreator2.address, baseAddr)).eq(marketCreatorFee)).to.be.true;

                    // protocol should receive fee
                    expect((await core.inventorBalanceOf(baseAddr)).eq(protoFee)).to.be.true;
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

                    await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, marketCommission, 0);
                    mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 1);
                });

                it("should perform instant swap transfer successfully", async () => {
                    await provideLiquidity(provider, amountOfBase, pricePerBase);

                    // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    const swapCost = toDec(5.65).mul(pricePerBase.toString()).toFixed(); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                    // console.log(amountOfBase, pricePerBase, swapCost);
                    // Give swapper enough QUOTE to pay swap cost and swapper must approve contract to spend it
                    await quoteAsset.transfer(swapper.address, swapCost);
                    await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                    // Calculate expected swapper fees (for on-chain swap)
                    const protoFee = swapAmt.mul((await core.state()).ints.instantSwapFeeBp).div(10000);
                    const marketCreatorFee = swapAmt.mul(marketCommission).div(10000);
                    const totalFees = protoFee.add(marketCreatorFee);
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0))
                        .to.emit(core, "Swap")
                        .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, swapAmt, pricePerBase, 0, 0], false, [], []);

                    // swapper should get swap amount - swapper total fees
                    expect((await baseAsset.balanceOf(swapper.address)).toString()).to.equal(swapAmt.sub(totalFees).toString());

                    // provider should get full swap cost
                    expect((await quoteAsset.balanceOf(provider.address)).toString()).to.equal(swapCost.toString());

                    // swapper should have no quote balance = 0 (depleted)
                    expect((await quoteAsset.balanceOf(swapper.address)).isZero()).to.be.true;

                    // provider liquidity amount should = provider liquidity - swap amount (= 95)
                    const liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.amount.toString()).to.equal(amountOfBase.sub(swapAmt).toString());

                    // market creator should receive fee
                    expect((await core.feeBalanceOf(marketCreator2.address, baseAddr)).eq(marketCreatorFee)).to.be.true;

                    // protocol should receive fee
                    expect((await core.inventorBalanceOf(baseAddr)).eq(protoFee)).to.be.true;
                });
            });

            context("base asset has non-standard decimals", () => {
                beforeEach(async () => {
                    let tokenFactory = await getContractFactory("TOKEN");
                    baseAsset = (await tokenFactory.deploy("USDT", "USDT", "1000000000000", 6)) as TOKEN;
                    baseAddr = baseAsset.address;
                    baseDec = toBN(10).pow(await baseAsset.decimals());
                    amountOfBase = baseDec.mul(100);
                    pricePerBase = quoteDec.mul(10);

                    await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, marketCommission, 0);
                    mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 1);
                });

                it("should perform instant swap transfer successfully", async () => {
                    await provideLiquidity(provider, amountOfBase, pricePerBase);

                    // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    const swapCost = toDec(5.65).mul(pricePerBase.toString()).toFixed(); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                    // Give swapper enough QUOTE to pay swap cost and swapper must approve contract to spend it
                    await quoteAsset.transfer(swapper.address, swapCost);
                    await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                    // Calculate expected swapper fees (for on-chain swap)
                    const protoFee = swapAmt.mul((await core.state()).ints.instantSwapFeeBp).div(10000);
                    const marketCreatorFee = swapAmt.mul(marketCommission).div(10000);
                    const totalFees = protoFee.add(marketCreatorFee);
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0))
                        .to.emit(core, "Swap")
                        .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, swapAmt, pricePerBase, 0, 0], false, [], []);

                    // swapper should get swap amount - swapper total fees
                    expect((await baseAsset.balanceOf(swapper.address)).toString()).to.equal(swapAmt.sub(totalFees).toString());

                    // provider should get full swap cost
                    expect((await quoteAsset.balanceOf(provider.address)).toString()).to.equal(swapCost.toString());

                    // swapper should have no quote balance = 0 (depleted)
                    expect((await quoteAsset.balanceOf(swapper.address)).isZero()).to.be.true;

                    // provider liquidity amount should = provider liquidity - swap amount (= 95)
                    const liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.amount.toString()).to.equal(amountOfBase.sub(swapAmt).toString());

                    // market creator should receive fee
                    expect((await core.feeBalanceOf(marketCreator2.address, baseAddr)).eq(marketCreatorFee)).to.be.true;

                    // protocol should receive fee
                    expect((await core.inventorBalanceOf(baseAddr)).eq(protoFee)).to.be.true;
                });
            });

            context("swapper specified a recipient address", () => {
                it("should share protocol fee if base asset is shareable", async () => {
                    await core.setProtoFee(0, 0, 0, 0, 0, 0);
                    await mc.connect(marketCreator2).setCommission(mid, 0);

                    await provideLiquidity(provider, amountOfBase, pricePerBase);

                    // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)
                    await quoteAsset.transfer(swapper.address, swapCost);
                    await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, user5.address, 0, swapAmt, pricePerBase, [], 0, 0)).to.emit(core, "Swap");
                    expect(await baseAsset.balanceOf(user5.address)).to.eql(swapAmt);
                });
            });

            context("sender has NFT", () => {
                beforeEach(async () => {
                    await core.setDiscountForNFTHolder(5000); // 50%
                    await nft.setMintCost(0);
                    await nft.allowAddr(swapper.address, 1, true);
                    await nft.connect(swapper).mint(1, false, Buffer.alloc(0), 0);
                });

                it("should apply discount to fee", async () => {
                    await provideLiquidity(provider, amountOfBase, pricePerBase);

                    // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                    // Give swapper enough QUOTE to pay swap cost and swapper must approve contract to spend it
                    await quoteAsset.transfer(swapper.address, swapCost);
                    await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                    // Calculate expected swapper fees (for on-chain swap)
                    let protoFee = swapAmt.mul((await core.state()).ints.instantSwapFeeBp).div(10000);
                    protoFee = protoFee.mul((await core.state2()).ints.nftDiscountBp).div(10000);
                    let marketCreatorFee = swapAmt.mul(marketCommission).div(10000);
                    marketCreatorFee = marketCreatorFee.mul((await core.state2()).ints.nftDiscountBp).div(10000);
                    const totalFees = protoFee.add(marketCreatorFee);
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0))
                        .to.emit(core, "Swap")
                        .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, swapAmt, pricePerBase, 0, 0], false, [], []);

                    // swapper should get swap amount - swapper total fees
                    expect((await baseAsset.balanceOf(swapper.address)).toString()).to.equal(swapAmt.sub(totalFees).toString());

                    // provider should get full swap cost
                    expect((await quoteAsset.balanceOf(provider.address)).toString()).to.equal(swapCost.toString());

                    // swapper should have no quote balance = 0 (depleted)
                    expect((await quoteAsset.balanceOf(swapper.address)).isZero()).to.be.true;

                    // provider liquidity amount should = provider liquidity - swap amount (= 95)
                    const liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.amount.toString()).to.equal(amountOfBase.sub(swapAmt).toString());

                    // market creator should receive fee
                    expect((await core.feeBalanceOf(marketCreator2.address, baseAddr)).eq(marketCreatorFee)).to.be.true;

                    // protocol should receive fee
                    expect((await core.inventorBalanceOf(baseAddr)).eq(protoFee)).to.be.true;
                });
            });

            context("base is ERC20 and quote is ERC20 (quote is WETH9)", () => {
                let marketCommission = 2500;

                beforeEach(async () => {
                    quoteAsset = weth as unknown as TOKEN;
                    quoteAddr = wethAddr;
                    await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, marketCommission, 0);
                    mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 1);
                });

                it("should perform instant swap transfer successfully", async () => {
                    await provideLiquidity(provider, amountOfBase, pricePerBase);

                    // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                    const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                    const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                    // Give convert swapper ETH to WETH9
                    await swapper.sendTransaction({to: wethAddr, value: swapCost});
                    await weth.connect(swapper).approve(core.address, swapCost);

                    // Calculate expected swapper fees (for on-chain swap)
                    const protoFee = swapAmt.mul((await core.state()).ints.instantSwapFeeBp).div(10000);
                    const marketCreatorFee = swapAmt.mul(marketCommission).div(10000);
                    const totalFees = protoFee.add(marketCreatorFee);
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0))
                        .to.emit(core, "Swap")
                        .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, swapAmt, pricePerBase, 0, 0], false, [], []);

                    // swapper should get swap amount - swapper total fees
                    expect((await baseAsset.balanceOf(swapper.address)).toString()).to.equal(swapAmt.sub(totalFees).toString());

                    // provider should get full swap cost
                    expect((await quoteAsset.balanceOf(provider.address)).toString()).to.equal(swapCost.toString());

                    // swapper should have no quote balance = 0 (depleted)
                    expect((await quoteAsset.balanceOf(swapper.address)).isZero()).to.be.true;

                    // provider liquidity amount should = provider liquidity - swap amount (= 95)
                    const liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.amount.toString()).to.equal(amountOfBase.sub(swapAmt).toString());

                    // market creator should receive fee
                    expect((await core.feeBalanceOf(marketCreator2.address, baseAddr)).eq(marketCreatorFee)).to.be.true;

                    // protocol should receive fee
                    expect((await core.inventorBalanceOf(baseAddr)).eq(protoFee)).to.be.true;
                });
            });
        });

        context("base is ERC20 and quote is NATIVE", () => {
            let marketCommission = 2500;

            beforeEach(async () => {
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.ERC20, AssetType.NATIVE, false, false, marketCommission, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, AssetType.ERC20, AssetType.NATIVE);
            });

            it("should revert with reason=LOW_QUOTE_BAL when deposit value is lower than swap cost", async () => {
                await provideLiquidity(provider, amountOfBase, pricePerBase);
                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0)).to.be.revertedWith("OC: LOW_QUOTE_BAL");
            });

            it("should perform instant swap transfer successfully", async () => {
                await provideLiquidity(provider, amountOfBase, pricePerBase);

                // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                // get provider balance
                const prevProviderBal = await provider.getBalance();

                // Calculate expected swapper fees (for on-chain swap)
                const protoFee = swapAmt.mul((await core.state()).ints.instantSwapFeeBp).div(10000);
                const marketCreatorFee = swapAmt.mul(marketCommission).div(10000);
                const totalFees = protoFee.add(marketCreatorFee);
                const tx = await core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0, {value: swapCost});
                await expect(tx).to.emit(core, "Swap").withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, swapAmt, pricePerBase, 0, 0], false, [], []);

                // swapper should get swap amount - swapper total fees
                expect((await baseAsset.balanceOf(swapper.address)).toString()).to.equal(swapAmt.sub(totalFees).toString());

                // provider should get full swap cost
                expect((await provider.getBalance()).sub(prevProviderBal).toString()).to.equal(swapCost.toString());

                // swapper should have no quote balance = 0 (depleted)
                expect((await quoteAsset.balanceOf(swapper.address)).isZero()).to.be.true;

                // provider liquidity amount should = provider liquidity - swap amount (= 95)
                const liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.amount.toString()).to.equal(amountOfBase.sub(swapAmt).toString());

                // market creator should receive fee
                expect((await core.feeBalanceOf(marketCreator2.address, baseAddr)).eq(marketCreatorFee)).to.be.true;

                // protocol should receive fee
                expect((await core.inventorBalanceOf(baseAddr)).eq(protoFee)).to.be.true;
            });
        });

        context("base is ERC20 and quote is SYNTH", () => {
            const marketCom = 0.1 * 100; // convert to 10 basis point
            beforeEach(async () => {
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 1, 0, false, false, marketCom, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);
            });

            it("should create a swap order", async () => {
                await provideLiquidity(provider, amountOfBase, pricePerBase);

                // Swap amount = 5 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(5).mul(baseDec);
                const now = await advanceBlockTime(1);
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0))
                    .to.emit(core, "SwapOrder")
                    .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, [toBN(0), toBN(0), swapAmt, pricePerBase, 0, 0, minTimeToPay + orderGracePeriod], [], []);

                // An expected order should be created.
                expect((await core.state()).numOrders.toNumber()).to.eql(1);
                const order = await core.getOrder(0);
                expect(order.provider).to.eql(provider.address);
                expect(order.taker).to.eql(swapper.address);
                expect(order.amount.toString()).to.eql(swapAmt.toString());
                expect(order.price.toString()).to.eql(pricePerBase.toString());
                expect(order.paid).to.be.false;
                expect(order.cancelAt).to.eq(now + minTimeToPay + orderGracePeriod + 1);

                // Ensure expire time is valid
                const liq = await core.getLiquidity(mid, provider.address, 0);
                const tmToPay = bnToN(liq.timeToPay) || minTimeToPay;
                expect(order.createdAt.add(tmToPay).eq(order.payDeadline)).to.be.true;

                // Provider's liquidity must reduce correctly
                expect(liq.amount.eq(amountOfBase.sub(swapAmt))).to.be.true;

                // should increment market num. orders
                const market = await mc.markets(mid);
                expect(market.numOrders.eq(1)).to.be.true;

                // should increment open order count of provider's liquidity
                expect(liq.openOrders).to.eql(toBN(1));
            });

            context("swapper provided a recipient", () => {
                it("should store recipient address in order", async () => {
                    await provideLiquidity(provider, amountOfBase, pricePerBase);

                    // Swap amount = 5 BASE (amount of BASE the swapper wants)
                    const swapAmt = toBN(5).mul(baseDec);
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, user5.address, 0, swapAmt, pricePerBase, [], 0, 0))
                        .to.emit(core, "SwapOrder")
                        .withArgs(getAddress(mid), provider.address, swapper.address, user5.address, [toBN(0), toBN(0), swapAmt, pricePerBase, 0, 0], [], []);

                    // An expected order should be created.
                    expect((await core.state()).numOrders.toNumber()).to.eql(1);
                    const order = await core.getOrder(0);
                    expect(order.provider).to.eql(provider.address);
                    expect(order.taker).to.eql(swapper.address);
                    expect(order.recipient).to.eql(user5.address);
                    expect(order.amount.toString()).to.eql(swapAmt.toString());
                    expect(order.price.toString()).to.eql(pricePerBase.toString());
                    expect(order.paid).to.be.false;
                });
            });
        });

        context("base is ERC20 and quote is NFT", () => {
            beforeEach(async () => {
                mid = await createMarket(marketCreator2, baseAddr, testERC721.address, AssetType.ERC20, AssetType.ERC721, false, false, 0, 0);
                await baseAsset.transfer(provider.address, amountOfBase);
                await baseAsset.connect(provider).approve(core.address, amountOfBase);
            });

            it("should revert with msg='AMOUNT_NREQ' when amount was set", async () => {
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], [1], [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 1, 1, [], 0, 0)).to.be.revertedWith("OC: AMOUNT_NREQ");
            });

            it("should revert with msg='MAX_PRICE_NREQ' when maxPrice was set", async () => {
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], [1], [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 1, [], 0, 0)).to.be.revertedWith("OC: MAX_PRICE_NREQ");
            });

            it("should revert with msg='IDS_REQ' when ids was not set", async () => {
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], [1], [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, [], 0, 0)).to.be.revertedWith("OC: IDS_REQ");
            });

            it("should revert with msg='IDS_HSIZE' when ids surpassed limit of 16", async () => {
                const ids = Array(17)
                    .fill(0)
                    .map((_, i) => i);
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], [1], [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0)).to.be.revertedWith("OC: IDS_HSIZE");
            });

            it("should revert with msg='IDS_NUNIQ' when ids has a duplicate entry", async () => {
                const ids = [1, 1];
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], [1], [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0)).to.be.revertedWith("OC: IDS_NUNIQ");
            });

            context("when wantOrIds=[1,2] but swapper has [1,3]", () => {
                it("should successfully swap only [1] and deduct correct fee", async () => {
                    const ids = [1, 3];
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                    const wantOrIds = [1, 2];
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, [], [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0))
                        .emit(core, "Swap")
                        .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, 0, 0, 0, 0], false, [], [1]);

                    // LP should own the NFT
                    expect(await testERC721.ownerOf(1)).to.eq(provider.address);

                    // Swapper should receive liquidity amount minus fees
                    const protoFee = amountOfBase.mul((await core.state()).ints.instantNFTSwapFeeBp).div(10000);
                    const marketCreatorFee = amountOfBase.mul(0).div(10000);
                    const totalFees = protoFee.add(marketCreatorFee);
                    expect(await baseAsset.balanceOf(swapper.address)).to.eq(amountOfBase.sub(totalFees));

                    // Expect correct inventor balance
                    expect(await core.inventorBalanceOf(baseAddr)).to.eq(totalFees);

                    const liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.amount).to.eq(0);
                });
            });

            context("when wantOrIds=[2,3] but swapper has [1]", () => {
                it("should revert with reason='NO_ID_MATCH'", async () => {
                    const ids = [1];
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                    const wantOrIds = [2, 3];
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, [], [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0)).to.be.revertedWith("OC: NO_ID_MATCH");
                });
            });

            context("when wantOrIds=[] and wantAndIds=[1,2] but swapper has [1]", () => {
                it("should revert with reason='NO_ID_MATCH'", async () => {
                    const ids = [1];
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                    const wantOrIds: BigNumberish[] = [];
                    const wantAndIds = [1, 2];
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, wantAndIds, [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0)).to.be.revertedWith("OC: NO_ID_MATCH");
                });
            });

            context("when wantOrIds=[] and wantAndIds=[1,2] but swapper has [1,2]", () => {
                it("should be successful", async () => {
                    const ids = [1, 2];
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                    const wantOrIds: BigNumberish[] = [];
                    const wantAndIds = [1, 2];
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, wantAndIds, [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0))
                        .emit(core, "Swap")
                        .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, 0, 0, 0, 0], false, [], ids);

                    // LP should own the NFTs
                    expect(await testERC721.ownerOf(1)).to.eq(provider.address);
                    expect(await testERC721.ownerOf(2)).to.eq(provider.address);
                });
            });

            context("when wantOrIds=[] and wantAndIds=[1,2] but swapper has [1,2,3]", () => {
                it("should be successful", async () => {
                    const ids = [1, 2, 3];
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                    const wantOrIds: BigNumberish[] = [];
                    const wantAndIds = [1, 2];
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, wantAndIds, [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0))
                        .emit(core, "Swap")
                        .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, 0, 0, 0, 0], false, [], [1, 2]);

                    // LP should own the NFTs
                    expect(await testERC721.ownerOf(1)).to.eq(provider.address);
                    expect(await testERC721.ownerOf(2)).to.eq(provider.address);
                });
            });

            context("when wantOrIds=[3,4,5] and wantAndIds=[1,2] but swapper has [1,2,6]", () => {
                it("should revert with reason='NO_ID_MATCH'", async () => {
                    const ids = [1];
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                    const wantOrIds: BigNumberish[] = [];
                    const wantAndIds = [1, 2];
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, wantAndIds, [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0)).to.be.revertedWith("OC: NO_ID_MATCH");
                });
            });

            context("when wantOrIds=[3,4,5] and wantAndIds=[1,2] but swapper has [1,2,4]", () => {
                it("should be successful", async () => {
                    const ids = [1, 2, 3, 4];
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                    const wantOrIds = [3, 4, 5];
                    const wantAndIds = [1, 2, 4];
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, wantAndIds, [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0)).not.to.be.reverted;

                    // LP should own the NFTs
                    expect(await testERC721.ownerOf(1)).to.eq(provider.address);
                    expect(await testERC721.ownerOf(2)).to.eq(provider.address);
                    expect(await testERC721.ownerOf(4)).to.eq(provider.address);
                });
            });

            context("when wantOrIds=[3,4,4,5] and wantAndIds=[1,1,2,2] but swapper has [1,2,2,4] (duplicate check)", () => {
                it("should be successful", async () => {
                    await testERC721.connect(swapper).setApprovalForAll(core.address, true);
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], [3, 4, 4, 5], [1, 1, 2, 2], [0, 0, 0])).to.be.revertedWith("OC: WANT_IDS_NUNIQ");
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], [3, 4, 5], [1, 1, 2, 2], [0, 0, 0])).to.be.revertedWith("OC: WANT_IDS_NUNIQ");
                });
            });

            context("when wantOrIds=[] and wantAndIds=[] but swapper has [1,2]", () => {
                it("should be successful swap all assets supplied by swapper", async () => {
                    const ids = [1, 2];
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                    const wantOrIds: BigNumber[] = [];
                    const wantAndIds: BigNumber[] = [];
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, wantAndIds, [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0)).not.to.be.reverted;

                    // LP should own the NFTs
                    expect(await testERC721.ownerOf(1)).to.eq(provider.address);
                    expect(await testERC721.ownerOf(2)).to.eq(provider.address);
                });
            });

            context("swapper provided a recipient address", () => {
                it("should be successful swap to recipient", async () => {
                    await core.setProtoFee(0, 0, 0, 0, 0, 0);

                    const ids = [1, 2];
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                    const wantOrIds: BigNumber[] = [];
                    const wantAndIds: BigNumber[] = [];
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, wantAndIds, [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, user5.address, 0, 0, 0, ids, 0, 0)).not.to.be.reverted;

                    expect(await baseAsset.balanceOf(user5.address)).to.eql(amountOfBase);
                });
            });

            context("base asset is sharable", () => {
                it("should successfully swap only [1] and deduct correct fee", async () => {
                    await assetReg.setSharable(baseAddr, true);
                    await core.setProtoFeeSplit(5000, 5000, 0);

                    const ids = [1, 3];
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                    const wantOrIds = [1, 2];
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, [], [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0)).not.to.be.reverted;

                    // LP should own the NFT
                    expect(await testERC721.ownerOf(1)).to.eq(provider.address);

                    // Swapper should receive liquidity amount minus fees
                    const protoFee = amountOfBase.mul((await core.state()).ints.instantNFTSwapFeeBp).div(10000);
                    const marketCreatorFee = amountOfBase.mul(0).div(10000);
                    const totalFees = protoFee.add(marketCreatorFee);
                    expect(await baseAsset.balanceOf(swapper.address)).to.eq(amountOfBase.sub(totalFees));

                    // Expect correct inventor and sharable balance
                    expect(await core.inventorBalanceOf(baseAddr)).to.eq(totalFees.div(2));
                    expect(await core.shareablesBalanceOf(baseAddr)).to.eq(totalFees.div(2));
                });
            });

            context("operator fee is set and swap include operator ID", () => {
                it("should calculate correct operator fee balance", async () => {
                    await operator.setBond(0);
                    await operator.register();
                    await core.setProtoFeeSplit(5000, 0, 5000);

                    const ids = [1, 3];
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                    const wantOrIds = [1, 2];
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, [], [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 1)).not.to.be.reverted;

                    // LP should own the NFT
                    expect(await testERC721.ownerOf(1)).to.eq(provider.address);

                    // Swapper should receive liquidity amount minus fees
                    const protoFee = amountOfBase.mul((await core.state()).ints.instantNFTSwapFeeBp).div(10000);
                    const marketCreatorFee = amountOfBase.mul(0).div(10000);
                    const totalFees = protoFee.add(marketCreatorFee);
                    expect(await baseAsset.balanceOf(swapper.address)).to.eq(amountOfBase.sub(totalFees));

                    // Expect correct fee balances
                    expect(await core.inventorBalanceOf(baseAddr)).to.eq(totalFees.div(2));
                    expect(await core.shareablesBalanceOf(baseAddr)).to.eq(0);
                    expect(await core.operatorBalanceOf(deployer.address, baseAddr)).to.eq(totalFees.div(2));
                });
            });

            context("base asset is verified", () => {
                it("should successfully swap only [1] and deduct correct fee", async () => {
                    await assetReg.setVerified(baseAddr, true);
                    await assetReg.setRate(baseAddr, 1);

                    const ids = [1, 3];
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                    const wantOrIds = [1, 2];
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, [], [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0)).not.to.be.reverted;

                    // LP should own the NFT
                    expect(await testERC721.ownerOf(1)).to.eq(provider.address);

                    // Swapper should receive liquidity amount minus fees
                    const protoFee = amountOfBase.mul((await core.state()).ints.instantNFTSwapFeeBp).div(10000);
                    const marketCreatorFee = amountOfBase.mul(0).div(10000);
                    const totalFees = protoFee.add(marketCreatorFee);
                    expect(await baseAsset.balanceOf(swapper.address)).to.eq(amountOfBase.sub(totalFees));

                    // Expect correct inventor balance
                    expect(await core.inventorBalanceOf(baseAddr)).to.eq(totalFees);
                });
            });

            context("quote as ERC1155", () => {
                beforeEach(async () => {
                    mid = await createMarket(marketCreator2, baseAddr, testERC1155.address, AssetType.ERC20, AssetType.ERC1155, false, false, 0, 0);
                    await baseAsset.transfer(provider.address, amountOfBase);
                    await baseAsset.connect(provider).approve(core.address, amountOfBase);
                });

                it("should successfully swap and deduct correct fee", async () => {
                    await assetReg.setSharable(baseAddr, true);
                    await core.setProtoFeeSplit(5000, 5000, 0);

                    const ids = [1, 3];
                    await testERC1155.connect(swapper).mint(1);
                    await testERC1155.connect(swapper).setApprovalForAll(core.address, true);

                    const wantOrIds = [1, 2];
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, [], [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0)).not.to.be.reverted;

                    // LP should own the NFT
                    expect(await testERC1155.balanceOf(provider.address, 1)).to.eq(1);

                    // Swapper should receive liquidity amount minus fees
                    const protoFee = amountOfBase.mul((await core.state()).ints.instantNFTSwapFeeBp).div(10000);
                    const marketCreatorFee = amountOfBase.mul(0).div(10000);
                    const totalFees = protoFee.add(marketCreatorFee);
                    expect(await baseAsset.balanceOf(swapper.address)).to.eq(amountOfBase.sub(totalFees));

                    // Expect correct inventor and sharable balance
                    expect(await core.inventorBalanceOf(baseAddr)).to.eq(totalFees.div(2));
                    expect(await core.shareablesBalanceOf(baseAddr)).to.eq(totalFees.div(2));
                });
            });
        });

        context("base is NATIVE and quote is NATIVE", () => {
            let marketCommission = 2500;

            beforeEach(async () => {
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.NATIVE, AssetType.NATIVE, false, false, marketCommission, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.NATIVE);
            });

            it("should revert with reason=LOW_QUOTE_BAL when deposit value is lower than swap cost", async () => {
                await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, pricePerBase], [], [], [0, 0, 0], {value: amountOfBase});
                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0)).to.be.revertedWith("OC: LOW_QUOTE_BAL");
            });

            it("should perform instant swap transfer successfully", async () => {
                await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, pricePerBase], [], [], [0, 0, 0], {value: amountOfBase});

                // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                // get provider balance
                const prevProviderBal = await provider.getBalance();
                const prevSwapperBal = await swapper.getBalance();

                // Calculate expected swapper fees (for on-chain swap)
                const protoFee = swapAmt.mul((await core.state()).ints.instantSwapFeeBp).div(10000);
                const marketCreatorFee = swapAmt.mul(marketCommission).div(10000);
                const totalFees = protoFee.add(marketCreatorFee);

                // Swap
                const tx = await core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0, {value: swapCost});
                await expect(tx).to.emit(core, "Swap").withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, swapAmt, pricePerBase, 0, 0], false, [], []);

                // calculate gas fee usd in eth
                const txReceipt = await tx.wait();
                const gasUsed = txReceipt.gasUsed.mul(tx.gasPrice as BigNumber);

                // swapper should get swap amount - swapper total fees
                expect(await swapper.getBalance()).to.eq(prevSwapperBal.sub(swapCost).add(swapAmt.sub(totalFees).sub(gasUsed)));

                // provider should get full swap cost
                expect(await provider.getBalance()).to.eq(prevProviderBal.add(swapCost));

                // provider liquidity amount should = provider liquidity - swap amount (= 95)
                const liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.amount.toString()).to.equal(amountOfBase.sub(swapAmt).toString());

                // market creator should receive fee
                expect((await core.feeBalanceOf(marketCreator2.address, baseAddr)).eq(marketCreatorFee)).to.be.true;

                // protocol should receive fee
                expect((await core.inventorBalanceOf(baseAddr)).eq(protoFee)).to.be.true;
            });
        });

        context("base is NATIVE and quote is ERC20", () => {
            let marketCommission = 2500;

            beforeEach(async () => {
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.NATIVE, AssetType.ERC20, false, false, marketCommission, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.ERC20);
            });

            it("should revert with reason=LOW_QUOTE_BAL when deposit value is lower than swap cost", async () => {
                await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, pricePerBase], [], [], [0, 0, 0], {value: amountOfBase});
                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0)).to.be.revertedWith("OC: LOW_QUOTE_BAL");
            });

            it("should perform instant swap transfer successfully", async () => {
                await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, pricePerBase], [], [], [0, 0, 0], {value: amountOfBase});

                // Swap amount = 5.65 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(toDec(5.65).mul(baseDec.toString()).toString());
                const swapCost = swapAmt.mul(pricePerBase).div(baseDec); // amount the swapper will pay in QUOTE (=56.5 QUOTE)

                // Calculate expected swapper fees (for on-chain swap)
                const protoFee = swapAmt.mul((await core.state()).ints.instantSwapFeeBp).div(10000);
                const marketCreatorFee = swapAmt.mul(marketCommission).div(10000);
                const totalFees = protoFee.add(marketCreatorFee);

                // approve swap cost so the contract can lock it
                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);

                // get provider balance
                const prevSwapperBal = await swapper.getBalance();

                // Swap
                const tx = await core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0);
                await expect(tx).to.emit(core, "Swap").withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, swapAmt, pricePerBase, 0, 0], false, [], []);

                // calculate gas fee usd in eth
                const txReceipt = await tx.wait();
                const gasUsed = txReceipt.gasUsed.mul(tx.gasPrice as BigNumber);

                // swapper should get swap amount - swapper total fees
                expect(await swapper.getBalance()).to.eq(prevSwapperBal.add(swapAmt.sub(totalFees).sub(gasUsed)));

                // provider should get full swap cost
                expect(await quoteAsset.balanceOf(provider.address)).to.eq(swapCost);

                // swapper quote balance should be 0
                expect(await quoteAsset.balanceOf(swapper.address)).to.eq(0);

                // provider liquidity amount should = provider liquidity - swap amount (= 95)
                const liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.amount.toString()).to.equal(amountOfBase.sub(swapAmt).toString());

                // market creator should receive fee
                expect((await core.feeBalanceOf(marketCreator2.address, baseAddr)).eq(marketCreatorFee)).to.be.true;

                // protocol should receive fee
                expect((await core.inventorBalanceOf(baseAddr)).eq(protoFee)).to.be.true;
            });
        });

        context("base is NATIVE and quote is NFT", () => {
            beforeEach(async () => {
                mid = await createMarket(marketCreator2, baseAddr, testERC721.address, AssetType.NATIVE, AssetType.ERC721, false, false, 0, 0);
            });

            it("should successfully swap and deduct correct fee", async () => {
                const ids = [1, 3];
                await testERC721.connect(swapper).mint();
                await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                const prevSwapperBal = await swapper.getBalance();

                const wantOrIds = [1, 2];
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, [], [0, 0, 0], {value: amountOfBase})).not.to.be.reverted;
                const tx = await core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0);
                await expect(tx).emit(core, "Swap").withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, 0, 0, 0, 0], false, [], [1]);

                const txReceipt = await tx.wait();
                const gasUsed = txReceipt.gasUsed.mul(tx.gasPrice as BigNumber);

                // LP should own the NFT
                expect(await testERC721.ownerOf(1)).to.eq(provider.address);

                // Swapper should receive liquidity amount minus fees
                const protoFee = amountOfBase.mul((await core.state()).ints.instantNFTSwapFeeBp).div(10000);
                const marketCreatorFee = amountOfBase.mul(0).div(10000);
                const totalFees = protoFee.add(marketCreatorFee);
                expect(await swapper.getBalance()).to.eq(prevSwapperBal.add(amountOfBase.sub(totalFees)).sub(gasUsed));

                // Expect correct inventor balance
                expect(await core.inventorBalanceOf(baseAddr)).to.eq(totalFees);

                const liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.amount).to.eq(0);
            });
        });

        context("base is NATIVE and quote is SYNTH", () => {
            const marketCom = 0.1 * 100; // convert to 10 basis point
            beforeEach(async () => {
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.NATIVE, AssetType.SYNTH, false, false, marketCom, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, AssetType.NATIVE, AssetType.SYNTH);
            });

            it("should create a swap order", async () => {
                await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, pricePerBase], [], [], [0, 0, 0], {value: amountOfBase});

                // Swap amount = 5 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(5).mul(baseDec);
                const now = await advanceBlockTime(1);
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0))
                    .to.emit(core, "SwapOrder")
                    .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, [toBN(0), toBN(0), swapAmt, pricePerBase, 0, 0, minTimeToPay + orderGracePeriod], [], []);

                // An expected order should be created.
                expect((await core.state()).numOrders.toNumber()).to.eql(1);
                const order = await core.getOrder(0);
                expect(order.provider).to.eql(provider.address);
                expect(order.taker).to.eql(swapper.address);
                expect(order.amount.toString()).to.eql(swapAmt.toString());
                expect(order.price.toString()).to.eql(pricePerBase.toString());
                expect(order.paid).to.be.false;
                expect(order.cancelAt).to.eq(now + minTimeToPay + orderGracePeriod + 1);

                // Ensure expire time is valid
                const liq = await core.getLiquidity(mid, provider.address, 0);
                const tmToPay = bnToN(liq.timeToPay) || minTimeToPay;
                expect(order.createdAt.add(tmToPay).eq(order.payDeadline)).to.be.true;

                // Provider's liquidity must reduce correctly
                expect(liq.amount.eq(amountOfBase.sub(swapAmt))).to.be.true;

                // should increment market num. orders
                const market = await mc.markets(mid);
                expect(market.numOrders.eq(1)).to.be.true;

                // should increment open order count of provider's liquidity
                expect(liq.openOrders).to.eql(toBN(1));
            });
        });

        context("base is SYNTH and quote is ERC20", () => {
            const marketCom = 0.1 * 100; // convert to 10 basis point
            beforeEach(async () => {
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 0, 1, false, false, marketCom, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 0, 1);
            });

            it("should successfully create swap and transfer swap cost to contract", async () => {
                await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, pricePerBase], [], [], [0, 0, 0]);

                // Swap amount = 5 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(5).mul(baseDec);
                const swapCost = swapAmt.div(baseDec).mul(pricePerBase); // amount the swapper will pay in QUOTE (=50 QUOTE)

                // Approve swap cost so the contract can lock it
                await quoteAsset.transfer(swapper.address, swapCost);
                await quoteAsset.connect(swapper).approve(cAddr, swapCost);
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0))
                    .to.emit(core, "SwapOrder")
                    .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, [toBN(0), toBN(0), swapAmt, pricePerBase, 0, 0], [], []);

                // An expected order should be created.
                expect((await core.state()).numOrders.toNumber()).to.eql(1);
                const order = await core.getOrder(0);
                expect(order.provider).to.eql(provider.address);
                expect(order.taker).to.eql(swapper.address);
                expect(order.amount.toString()).to.eql(swapAmt.toString());
                expect(order.price.toString()).to.eql(pricePerBase.toString());
                expect(order.paid).to.be.false;

                // Ensure expire time is valid
                const liq = await core.getLiquidity(mid, provider.address, 0);
                const tmToPay = bnToN(liq.timeToPay) || minTimeToPay;
                expect(order.createdAt.add(tmToPay).eq(order.payDeadline)).to.be.true;

                // Provider's liquidity must reduce correctly
                expect(liq.amount.eq(amountOfBase.sub(swapAmt))).to.be.true;

                // Contract balance must hold the cost
                expect((await quoteAsset.balanceOf(cAddr)).toString()).to.equal(swapCost.toString());

                // should increment market num. orders
                const market = await mc.markets(mid);
                expect(market.numOrders.eq(1)).to.be.true;

                // should increment open order count of provider's liquidity
                expect(liq.openOrders).to.eql(toBN(1));
            });
        });

        context("base is SYNTH and quote is NATIVE", () => {
            const marketCom = 0.1 * 100; // convert to 10 basis point
            beforeEach(async () => {
                baseAddr = ethers.Wallet.createRandom().address;
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, AssetType.SYNTH, AssetType.NATIVE, false, false, marketCom, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.NATIVE);
            });

            it("should successfully create swap and transfer swap cost to contract", async () => {
                await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, pricePerBase], [], [], [0, 0, 0]);

                // Swap amount = 5 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(5).mul(baseDec);
                const swapCost = swapAmt.div(baseDec).mul(pricePerBase);

                // Swap
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0, {value: swapCost}))
                    .to.emit(core, "SwapOrder")
                    .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, [toBN(0), toBN(0), swapAmt, pricePerBase, 0, 0], [], []);

                // An expected order should be created.
                expect((await core.state()).numOrders.toNumber()).to.eql(1);
                const order = await core.getOrder(0);
                expect(order.provider).to.eql(provider.address);
                expect(order.taker).to.eql(swapper.address);
                expect(order.amount.toString()).to.eql(swapAmt.toString());
                expect(order.price.toString()).to.eql(pricePerBase.toString());
                expect(order.paid).to.be.false;

                // Ensure expire time is valid
                const liq = await core.getLiquidity(mid, provider.address, 0);
                const tmToPay = bnToN(liq.timeToPay) || minTimeToPay;
                expect(order.createdAt.add(tmToPay).eq(order.payDeadline)).to.be.true;

                // Provider's liquidity must reduce correctly
                expect(liq.amount.eq(amountOfBase.sub(swapAmt))).to.be.true;

                // Contract balance must hold the cost
                expect(await core.provider.getBalance(core.address)).to.eq(swapCost);

                // should increment market num. orders
                const market = await mc.markets(mid);
                expect(market.numOrders.eq(1)).to.be.true;

                // should increment open order count of provider's liquidity
                expect(liq.openOrders).to.eql(toBN(1));
            });
        });

        context("base is SYNTH and quote is SYNTH", () => {
            it("should successfully create swap order", async () => {
                mid = await createMarket(marketCreator2, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.SYNTH, false, false, 0, 0);

                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, pricePerBase], [], [], [0, 0, 0])).not.to.be.reverted;
                const swapAmt = toBN(5).mul(baseDec);
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0)).not.to.be.reverted;
                await expect(core.getOrder(0)).not.be.revertedWith("OC: UNKNOWN_ORDER");

                // liquidity must reduce
                const liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.amount.eq(amountOfBase.sub(swapAmt))).to.be.true;

                // should increment market num. orders
                const market = await mc.markets(mid);
                expect(market.numOrders.eq(1)).to.be.true;

                // should increment open order count of provider's liquidity
                expect(liq.openOrders).to.eql(toBN(1));
            });
        });

        context("base is SYNTH and quote is NFT", () => {
            beforeEach(async () => {
                mid = await createMarket(marketCreator2, baseAddr, testERC721.address, AssetType.SYNTH, AssetType.ERC721, false, false, 0, 0);
            });

            it("should revert with msg='MAX_PRICE_NREQ' when maxPrice is set", async () => {
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], [1], [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 1, [], 0, 0)).to.be.revertedWith("OC: MAX_PRICE_NREQ");
            });

            it("should revert with msg='AMOUNT_NREQ' when amount is set", async () => {
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], [1], [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 1, 0, [], 0, 0)).to.be.revertedWith("OC: AMOUNT_NREQ");
            });

            it("should revert with msg='IDS_REQ' when token ids was not provided", async () => {
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], [1], [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, [], 0, 0)).to.be.revertedWith("OC: IDS_REQ");
            });

            it("should revert with msg='IDS_HSIZE' when ids length exceed limit", async () => {
                const ids = Array(17).fill(0).map((_, i) => i); // prettier-ignore
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], [1], [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0)).to.be.revertedWith("OC: IDS_HSIZE");
            });

            it("should revert with msg='IDS_NUNIQ' when ids length exceed limit", async () => {
                const ids = [1, 1];
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], [1], [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0)).to.be.revertedWith("OC: IDS_NUNIQ");
            });

            it("should revert with msg='NO_ID_MATCH' when no ids entry match", async () => {
                const ids = [1];
                const wantOrIds = [2, 3];
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0)).to.be.revertedWith("OC: NO_ID_MATCH");
            });

            it("should revert with msg='ERC721: invalid token ID' when matched id is not owned by sender", async () => {
                const ids = [1];
                const wantOrIds = [1];
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0)).to.be.revertedWith("ERC721: invalid token ID");
            });

            it("should successfully create order", async () => {
                await testERC721.connect(swapper).mint();
                await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                const ids = [toBN(1)];
                const wantOrIds = [1];
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0))
                    .to.emit(core, "SwapOrder")
                    .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, [toBN(0), toBN(0), 0, 0, 0, 0], [], ids);

                const order = await core.getOrder(0);
                expect(order.takerIds).to.eql(ids);

                expect(await testERC721.balanceOf(swapper.address)).to.eq(0);
            });

            it("should successfully created order (NFT = ERC1155)", async () => {
                mid = await createMarket(marketCreator2, baseAddr, testERC1155.address, AssetType.SYNTH, AssetType.ERC1155, false, false, 0, 0);
                await testERC1155.connect(swapper).mint(1);
                await testERC1155.connect(swapper).setApprovalForAll(core.address, true);

                const ids = [toBN(1)];
                const wantOrIds = [1];
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0))
                    .to.emit(core, "SwapOrder")
                    .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, [toBN(0), toBN(0), 0, 0, 0, 0], [], ids);

                const order = await core.getOrder(0);
                expect(order.takerIds).to.eql(ids);

                expect(await testERC1155.balanceOf(swapper.address, 1)).to.eq(0);
            });

            context("liquidity provided did not specify want IDs", () => {
                it("should successfully create order using all the assets provided by the swapper", async () => {
                    await testERC721.connect(swapper).mint();
                    await testERC721.connect(swapper).setApprovalForAll(core.address, true);

                    const ids = [toBN(1)];
                    const wantOrIds: BigNumber[] = [];
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, 0], wantOrIds, [], [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0))
                        .to.emit(core, "SwapOrder")
                        .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, [toBN(0), toBN(0), 0, 0, 0, 0], [], ids);

                    const order = await core.getOrder(0);
                    expect(order.takerIds).to.eql(ids);

                    expect(await testERC721.balanceOf(swapper.address)).to.eq(0);
                });
            });
        });

        context("max open order is reached", () => {
            beforeEach(async () => {
                await core.setMaxOpenOrders(1);
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 0, 1, false, false, 0, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 0, 1);
            });

            it("should revert with reason=MAX_OPEN_ORDERS", async () => {
                await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, pricePerBase], [], [], [0, 0, 0]);

                // Swap amount = 5 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(5).mul(baseDec);
                const swapCost = swapAmt.div(baseDec).mul(pricePerBase); // amount the swapper will pay in QUOTE (=50 QUOTE)

                // Approve swap cost so the contract can lock it
                await quoteAsset.transfer(swapper.address, swapCost.mul(2));
                await quoteAsset.connect(swapper).approve(cAddr, swapCost.mul(2));
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0)).not.to.be.reverted;

                // Expect to be reverted
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0)).to.be.revertedWith("OC: MAX_OPEN_ORDERS");
            });
        });

        context("max open dispute is reached", () => {
            beforeEach(async () => {
                await core.setMaxOpenDisputes(1);
                await core.setDisputeManager(deployer.address);
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 0, 1, false, false, 0, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 0, 1);
            });

            it("should revert with reason=MAX_OPEN_DISPUTES", async () => {
                await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, pricePerBase], [], [], [0, 0, 0]);

                // Swap amount = 5 BASE (amount of BASE the swapper wants)
                const swapAmt = toBN(5).mul(baseDec);
                const swapCost = swapAmt.div(baseDec).mul(pricePerBase); // amount the swapper will pay in QUOTE (=50 QUOTE)

                // Approve swap cost so the contract can lock it
                await quoteAsset.transfer(swapper.address, swapCost.mul(2));
                await quoteAsset.connect(swapper).approve(cAddr, swapCost.mul(2));

                // forcefully increment open dispute count to 1
                await core.connect(deployer).updateOpenDisputesCount(mid, provider.address, 0, true);

                // Expect to be reverted
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0)).to.be.revertedWith("OC: MAX_OPEN_DISPUTES");
            });
        });

        context("market PUT permission is true and LP PUT permission is removed after putting liquidity", () => {
            beforeEach(async () => {
                await core.setMaxOpenOrders(1);
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 0, 1, true, false, 0, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 0, 1);
            });

            it("should revert with msg=NO_PUT_PERM when swap is attempted on the liquidity", async () => {
                await mc.connect(marketCreator2).permitPut(mid, provider.address);
                await core.connect(provider).updateFungibleLiquidity(mid, 0, false, AddressZero, [amountOfBase, pricePerBase], [], [], [0, 0, 0]);
                await mc.connect(marketCreator2).revokePut(mid, provider.address);

                const swapAmt = toBN(5).mul(baseDec);
                const swapCost = swapAmt.div(baseDec).mul(pricePerBase); // amount the swapper will pay in QUOTE (=50 QUOTE)

                await quoteAsset.transfer(swapper.address, swapCost.mul(2));
                await quoteAsset.connect(swapper).approve(cAddr, swapCost.mul(2));
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, swapAmt, pricePerBase, [], 0, 0)).to.be.revertedWith("MC: NO_PUT_PERM");

                // Make sure liquidity can still be removed
                await core.connect(provider).updateFungibleLiquidity(mid, 0, true, AddressZero, [amountOfBase, pricePerBase], [], [], [0, 0, 0]);
                expect((await core.getLiquidity(mid, provider.address, 0)).amount).to.eq(0);
            });
        });
    });

    describe(".swapQuoteForBase (non-fungible)", () => {
        let marketCom: BigNumberish;
        let ids: BigNumberish[];
        beforeEach(async () => {
            marketCom = toBN(0);
            await testERC721.connect(provider).mint();
            await testERC721.connect(provider).mint();
            await testERC721.connect(swapper).mint();
            await testERC721.connect(swapper).mint();
            await testERC721.connect(provider).setApprovalForAll(core.address, true);
            await testERC721.connect(swapper).setApprovalForAll(core.address, true);
            ids = [toBN(1), toBN(2)];
            mid = await createMarket(deployer, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC20, false, false, marketCom, 0);
        });

        it("should revert with msg='OC: EXPIRED_TX' when expireAt time was surpassed", async () => {
            const now = await advanceBlockTime(1);
            mid = await createMarket(deployer, baseAddr, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, 0, 0);
            await expect(core.swapQuoteForBase(mid, swapper.address, AddressZero, 0, 0, 0, [], now, 0)).to.be.revertedWith("OC: EXPIRED_TX");
        });

        it("should revert with msg='MC: UNKNOWN_MARKET' when market is unknown", async () => {
            await expect(core.swapQuoteForBase(AddressZero, swapper.address, AddressZero, 0, 0, 0, [], 0, 0)).to.be.revertedWith("MC: UNKNOWN_MARKET");
        });

        it("should revert with msg='ZERO_LIQ' when the liquidity was not found", async () => {
            await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, pricePerBase.sub(1), [toBN(1)], 0, 0)).to.be.revertedWith("OC: ZERO_LIQ");
        });

        it("should revert with msg='AMOUNT_NREQ' when amount was provided", async () => {
            await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, pricePerBase, [], [], [0, 0, 0])).not.to.be.reverted;
            await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 1, pricePerBase, [], 0, 0)).to.be.revertedWith("OC: AMOUNT_NREQ");
        });

        it("should revert with msg='LIQ_PAUSED' liquidity is paused", async () => {
            await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, pricePerBase, [], [], [0, 0, 0])).not.to.be.reverted;
            await core.connect(provider).togglePause(mid, 0, 0);
            await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, pricePerBase.sub(1), [toBN(1)], 0, 0)).to.be.revertedWith("OC: LIQ_PAUSED");
        });

        it("should revert with msg='MAX_PRICE_REQ' when quote=ERC20,SYNTH and maxPrice was unset", async () => {
            await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, pricePerBase, [], [], [0, 0, 0])).not.to.be.reverted;
            await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, [toBN(1)], 0, 0)).to.be.revertedWith("OC: MAX_PRICE_REQ");
        });

        it("should revert with msg='MAX_PRICE_NREQ' when quote=NFT and maxPrice was set", async () => {
            mid = await createMarket(deployer, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC721, false, false, marketCom, 0);
            await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, 0, [1], [], [0, 0, 0])).not.to.be.reverted;
            await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 1, [toBN(1)], 0, 0)).to.be.revertedWith("OC: MAX_PRICE_NREQ");
        });

        it("should revert with msg='MAX_PRICE_TOO_LOW' when quote=ERC20 and max price is lower than liquidity price", async () => {
            await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, pricePerBase, [], [], [0, 0, 0])).not.to.be.reverted;
            await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, pricePerBase.sub(1), [toBN(1)], 0, 0)).to.be.revertedWith("OC: MAX_PRICE_TOO_LOW");
        });

        it("should revert with msg='IDS_NREQ' when quote=ERC20 and ids was provided", async () => {
            await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, pricePerBase, [], [], [0, 0, 0])).not.to.be.reverted;
            await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, pricePerBase, [toBN(1)], 0, 0)).to.be.revertedWith("OC: IDS_NREQ");
        });

        it("should revert with msg='IDS_REQ' when quote=NFT and ids was not provided", async () => {
            mid = await createMarket(deployer, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC721, false, false, marketCom, 0);
            await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, 0, [1], [], [0, 0, 0])).not.to.be.reverted;
            await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, [], 0, 0)).to.be.revertedWith("OC: IDS_REQ");
        });

        it("should revert with msg='NOT_TARGET' when sender is not the liquidity target", async () => {
            mid = await createMarket(deployer, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC721, false, false, marketCom, 0);
            await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, swapper.address, ids, 0, [1], [], [0, 0, 0])).not.to.be.reverted;
            await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, [1], 0, 0)).to.be.revertedWith("OC: NOT_TARGET");
        });

        context("base is NFT and quote is ERC20", () => {
            beforeEach(async () => {
                await quoteAsset.transfer(swapper.address, pricePerBase);
                await quoteAsset.connect(swapper).approve(core.address, pricePerBase);
            });

            it("should revert with msg='ERC20: insufficient allowance' when sender has insufficient ERC20 balance", async () => {
                await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, pricePerBase, [], [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, pricePerBase, [], 0, 0)).to.be.revertedWith("ERC20: insufficient allowance");
            });

            it("should successfully transfer quote asset to provider and base assets to sender and share fees correctly", async () => {
                marketCom = toBN(10);
                await mc.setCommission(mid, marketCom);

                await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, pricePerBase, [], [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, pricePerBase, [], 0, 0))
                    .emit(core, "Swap")
                    .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, 0, pricePerBase, 0, 0], false, ids, []);

                expect(await testERC721.ownerOf(1)).to.eql(swapper.address);
                expect(await testERC721.ownerOf(2)).to.eql(swapper.address);

                expect((await core.getLiquidity(mid, provider.address, 0)).ids).to.eql([]);

                // check fee distribution
                const protoFee = pricePerBase.mul((await core.state()).ints.instantNFTSwapFeeBp).div(10000);
                const marketCreatorFee = pricePerBase.mul(marketCom).div(10000);
                expect(await quoteAsset.balanceOf(provider.address)).to.eql(toBN(pricePerBase).sub(protoFee.add(marketCreatorFee)));
                expect(await core.inventorBalanceOf(quoteAddr)).to.eql(protoFee);
            });

            context("quote asset is sharable", () => {
                it("should successfully share fees correctly", async () => {
                    await assetReg.setSharable(quoteAddr, true);
                    await core.setProtoFeeSplit(5000, 5000, 0);

                    await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, pricePerBase, [], [], [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, pricePerBase, [], 0, 0))
                        .emit(core, "Swap")
                        .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, 0, pricePerBase, 0, 0], false, ids, []);

                    // check fee distribution
                    const protoFee = pricePerBase.mul((await core.state()).ints.instantNFTSwapFeeBp).div(10000);
                    expect(await quoteAsset.balanceOf(provider.address)).to.eql(toBN(pricePerBase).sub(protoFee));
                    expect(await core.inventorBalanceOf(quoteAddr)).to.eql(protoFee.div(2));
                    expect(await core.shareablesBalanceOf(quoteAddr)).to.eql(protoFee.div(2));
                });
            });

            context("operator fee is set and swap include operator ID", () => {
                it("should calculate correct operator fee balance", async () => {
                    await operator.setBond(0);
                    await operator.connect(user5).register();
                    await core.setProtoFeeSplit(5000, 0, 5000);
                    await assetReg.setSharable(quoteAddr, true);

                    await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, pricePerBase, [], [], [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, pricePerBase, [], 0, 1))
                        .emit(core, "Swap")
                        .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, 0, pricePerBase, 0, 1], false, ids, []);

                    const protoFee = pricePerBase.mul((await core.state()).ints.instantNFTSwapFeeBp).div(10000);
                    expect(await quoteAsset.balanceOf(provider.address)).to.eql(toBN(pricePerBase).sub(protoFee));
                    expect(await core.inventorBalanceOf(quoteAddr)).to.eql(protoFee.div(2));
                    expect(await core.shareablesBalanceOf(quoteAddr)).to.eq(0);
                    expect(await core.operatorBalanceOf(user5.address, quoteAddr)).to.eql(protoFee.div(2));

                    // Withdraw the reward
                    await expect(core.connect(user5).withdrawOperatorBalance(quoteAddr)).not.to.be.reverted;
                    expect(await quoteAsset.balanceOf(user5.address)).to.eql(protoFee.div(2));
                    expect(await core.operatorBalanceOf(user5.address, quoteAddr)).to.eq(0);
                });
            });

            context("sender is an nft holder", () => {
                it("should successfully share fees correctly", async () => {
                    marketCom = toBN(10);
                    await mc.setCommission(mid, marketCom);
                    await assetReg.setSharable(quoteAddr, true);
                    const nftDiscount = toBN(1000);
                    await core.setDiscountForNFTHolder(nftDiscount);
                    await core.setProtoFeeSplit(5000, 5000, 0);

                    // mint nft for provider
                    await nft.allowAddr(provider.address, 1, true);
                    await nft.connect(provider).mint(1, false, Buffer.alloc(0), 0);

                    // swap
                    await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, pricePerBase, [], [], [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, pricePerBase, [], 0, 0)).not.to.be.reverted;

                    // protocol and market fee
                    let protoFee = toBN((await core.state()).ints.instantNFTSwapFeeBp);
                    let marketFee = toBN(marketCom);
                    protoFee = protoFee.sub(nftDiscount.mul(protoFee).div(10000)); // apply nft discount
                    marketFee = marketFee.sub(nftDiscount.mul(marketFee).div(10000)); // apply nft discount
                    protoFee = pricePerBase.mul(protoFee).div(10000); // get the expected protocol fee
                    marketFee = pricePerBase.mul(marketFee).div(10000); // get the expected market fee

                    expect(await quoteAsset.balanceOf(provider.address)).to.eql(toBN(pricePerBase).sub(protoFee.add(marketFee)));
                    expect(await core.inventorBalanceOf(quoteAddr)).to.eql(protoFee.div(2));
                    expect(await core.shareablesBalanceOf(quoteAddr)).to.eql(protoFee.div(2));
                });
            });

            context("sender provided a recipient address", () => {
                it("should swap to recipient", async () => {
                    await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, pricePerBase, [], [], [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, user5.address, 0, 0, pricePerBase, [], 0, 0)).emit(core, "Swap");
                    expect(await testERC721.ownerOf(1)).to.eql(user5.address);
                    expect(await testERC721.ownerOf(2)).to.eql(user5.address);
                });
            });
        });

        context("base is NFT and quote is NATIVE", () => {
            beforeEach(async () => {
                mid = await createMarket(deployer, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.NATIVE, false, false, marketCom, 0);
            });

            it("should revert with msg='LOW_DEPOSIT' when sender did not deposit sufficient native value", async () => {
                await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, pricePerBase, [], [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, pricePerBase, [], 0, 0)).to.be.revertedWith("OC: LOW_DEPOSIT");
            });

            it("should successfully transfer quote asset to provider and base assets to sender and share fees correctly", async () => {
                marketCom = toBN(10);
                await mc.setCommission(mid, marketCom);

                await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, pricePerBase, [], [], [0, 0, 0])).not.to.be.reverted;

                const prevProviderBal = await provider.getBalance();

                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, pricePerBase, [], 0, 0, {value: pricePerBase}))
                    .emit(core, "Swap")
                    .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, 0, pricePerBase, 0, 0], false, ids, []);

                expect(await testERC721.ownerOf(1)).to.eql(swapper.address);
                expect(await testERC721.ownerOf(2)).to.eql(swapper.address);

                expect((await core.getLiquidity(mid, provider.address, 0)).ids).to.eql([]);

                // check fee distribution
                const protoFee = pricePerBase.mul((await core.state()).ints.instantNFTSwapFeeBp).div(10000);
                const marketCreatorFee = pricePerBase.mul(marketCom).div(10000);
                const totalFee = protoFee.add(marketCreatorFee);
                expect(await core.provider.getBalance(provider.address)).to.eql(prevProviderBal.add(toBN(pricePerBase).sub(totalFee)));
                expect(await core.inventorBalanceOf(quoteAddr)).to.eql(protoFee);
            });
        });

        context("base is NFT and quote is SYNTH", () => {
            beforeEach(async () => {
                mid = await createMarket(deployer, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, marketCom, 0);
            });

            it("should create a swap order", async () => {
                await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, pricePerBase, [], [], [0, 0, 0])).not.to.be.reverted;
                const now = await advanceBlockTime(1);
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, pricePerBase, [], 0, 0))
                    .emit(core, "SwapOrder")
                    .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, [toBN(0), toBN(0), 0, pricePerBase, 0, 0], ids, []);

                const order = await core.getOrder(0);
                expect(order.marketId).to.eql(getAddress(mid));
                expect(order.provider).to.eql(provider.address);
                expect(order.taker).to.eql(swapper.address);
                expect(order.lid).to.eql(toBN(0));
                expect(order.amount).to.eql(toBN(0));
                expect(order.price).to.eql(pricePerBase);
                expect(order.createdAt).to.eq(now + 1);
                expect(order.payDeadline).to.eq(now + minTimeToPay + 1);
                expect(order.cancelAt).to.eq(now + minTimeToPay + orderGracePeriod + 1);
                expect(order.providerIds).to.eql(ids);
                expect((await core.state()).numOrders).to.eq(1);
                expect((await core.getMarket(mid)).numOrders).to.eq(1);
                expect((await core.getLiquidity(mid, provider.address, 0)).openOrders).to.eq(1);
                expect((await core.getLiquidity(mid, provider.address, 0)).ids).to.eql([]);
            });
        });

        context("base is NFT and quote is NFT", () => {
            let protoFee: BigNumber;
            let mktFee: BigNumber;

            beforeEach(async () => {
                marketCom = toBN("100000000000000000");
                fixedNFTSwapFee = toBN("100000000000000000");
                mid = await createMarket(deployer, testERC721.address, testERC721.address, AssetType.ERC721, AssetType.ERC721, false, false, marketCom, 0);
            });

            it("should revert with msg='OC: NO_ID_MATCH' when sender has insufficient ERC20 balance", async () => {
                await core.setProtoFee(0, 0, 0, 0, 0, 0);
                mid = await createMarket(marketCreator2, testERC721.address, testERC721.address, AssetType.ERC721, AssetType.ERC721, false, false, 0, 0);

                const wantOrIds = [1];
                const ids = [2];
                await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, 0, wantOrIds, [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, ids, 0, 0)).to.be.revertedWith("OC: NO_ID_MATCH");
            });

            it("should revert with msg='ERC721: transfer from incorrect owner' when swapper does not own a matching want ID", async () => {
                await core.setProtoFee(0, 0, 0, 0, 0, 0);
                mid = await createMarket(marketCreator2, testERC721.address, testERC721.address, AssetType.ERC721, AssetType.ERC721, false, false, 0, 0);

                const wantOrIds = [3];
                const ids = [1];
                await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, 0, wantOrIds, [], [0, 0, 0])).not.to.be.reverted;
                await expect(core.swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, wantOrIds, 0, 0)).to.be.revertedWith("ERC721: transfer from incorrect owner");
            });

            it("should successfully transfer quote asset to provider and base assets to sender", async () => {
                await core.setProtoFee(0, 0, 0, 0, fixedNFTSwapFee, 0);

                const wantAndIds = [3, 4];
                const ids = [1, 2];

                protoFee = toBN(fixedNFTSwapFee).mul(ids.length);
                mktFee = toBN(marketCom).mul(ids.length);
                await token.transfer(provider.address, protoFee.add(mktFee));
                await token.connect(provider).approve(feePurse.address, protoFee.add(mktFee));
                await feePurse.connect(provider).deposit(protoFee.add(mktFee));

                await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, 0, [], wantAndIds, [0, 0, 0])).not.to.be.reverted;
                await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, wantAndIds, 0, 0))
                    .to.emit(core, "Swap")
                    .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, 0, 0, 0, 0], false, ids, wantAndIds);

                expect(await testERC721.ownerOf(1)).to.eql(swapper.address);
                expect(await testERC721.ownerOf(2)).to.eql(swapper.address);
                expect(await testERC721.ownerOf(3)).to.eql(provider.address);
                expect(await testERC721.ownerOf(4)).to.eql(provider.address);
                expect((await core.getLiquidity(mid, provider.address, 0)).ids).to.eql([]);

                // All protocol fee should go to inventor
                expect(await feePurse.balanceOf(inventor.address)).to.eql(toBN(protoFee));
                expect(await feePurse.balanceOf(core.address)).to.eq(0);

                // Market fee should go to market creator
                expect(await feePurse.balanceOf(deployer.address)).to.eql(toBN(mktFee));

                // Fee purse should be updated for both protocol and market creator
                let liq = await core.getLiquidity(mid, provider.address, 0);
                expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eq(0);
                expect(await feePurse.getLocked(liq.mktCreatorFeePurseId)).to.eq(0);
            });

            context("liquidity provided did not set want IDs", () => {
                it("should successfully transfer any quote assets from the swapper to the provider", async () => {
                    await core.setProtoFee(0, 0, 0, 0, fixedNFTSwapFee, 0);

                    const wantAndIds: BigNumber[] = [];
                    const swapperIds = [3, 4];
                    const ids = [1, 2];

                    protoFee = toBN(fixedNFTSwapFee).mul(ids.length);
                    mktFee = toBN(marketCom).mul(ids.length);
                    await token.transfer(provider.address, protoFee.add(mktFee));
                    await token.connect(provider).approve(feePurse.address, protoFee.add(mktFee));
                    await feePurse.connect(provider).deposit(protoFee.add(mktFee));

                    await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, 0, [], wantAndIds, [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, swapperIds, 0, 0))
                        .to.emit(core, "Swap")
                        .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, 0, 0, 0, 0], false, ids, swapperIds);

                    expect(await testERC721.ownerOf(1)).to.eql(swapper.address);
                    expect(await testERC721.ownerOf(2)).to.eql(swapper.address);
                    expect(await testERC721.ownerOf(3)).to.eql(provider.address);
                    expect(await testERC721.ownerOf(4)).to.eql(provider.address);
                    expect((await core.getLiquidity(mid, provider.address, 0)).ids).to.eql([]);

                    // All protocol fee should go to inventor
                    expect(await feePurse.balanceOf(inventor.address)).to.eql(toBN(protoFee));
                    expect(await feePurse.balanceOf(core.address)).to.eq(0);

                    // Market fee should go to market creator
                    expect(await feePurse.balanceOf(deployer.address)).to.eql(toBN(mktFee));

                    // Fee purse should be updated for both protocol and market creator
                    let liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eq(0);
                    expect(await feePurse.getLocked(liq.mktCreatorFeePurseId)).to.eq(0);
                });
            });

            context("base asset is sharable", () => {
                it("should successfully transfer quote asset to provider and base assets to sender", async () => {
                    await assetReg.setSharable(testERC721.address, true);
                    await core.setProtoFeeSplit(5000, 5000, 0);
                    await core.setProtoFee(0, 0, 0, 0, fixedNFTSwapFee, 0);

                    const wantAndIds = [3, 4];
                    const ids = [1, 2];

                    protoFee = toBN(fixedNFTSwapFee).mul(ids.length);
                    mktFee = toBN(marketCom).mul(ids.length);
                    await token.transfer(provider.address, protoFee.add(mktFee));
                    await token.connect(provider).approve(feePurse.address, protoFee.add(mktFee));
                    await feePurse.connect(provider).deposit(protoFee.add(mktFee));

                    await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, 0, [], wantAndIds, [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, wantAndIds, 0, 0))
                        .to.emit(core, "Swap")
                        .withArgs(getAddress(mid), provider.address, swapper.address, AddressZero, AddressZero, [0, 0, 0, 0, 0, 0], false, ids, wantAndIds);

                    expect(await testERC721.ownerOf(1)).to.eql(swapper.address);
                    expect(await testERC721.ownerOf(2)).to.eql(swapper.address);
                    expect(await testERC721.ownerOf(3)).to.eql(provider.address);
                    expect(await testERC721.ownerOf(4)).to.eql(provider.address);
                    expect((await core.getLiquidity(mid, provider.address, 0)).ids).to.eql([]);

                    // Must share protocol fee with inventor and core contract (community)
                    expect(await feePurse.balanceOf(inventor.address)).to.eql(toBN(protoFee.div(2)));
                    expect(await feePurse.balanceOf(core.address)).to.eq(protoFee.div(2));

                    // Market fee should go to market creator
                    expect(await feePurse.balanceOf(deployer.address)).to.eql(toBN(mktFee));

                    // Fee purse should be updated for both protocol and market creator
                    let liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eq(0);
                    expect(await feePurse.getLocked(liq.mktCreatorFeePurseId)).to.eq(0);
                });
            });

            context("operator fee is set and swap include operator ID", () => {
                it("should calculate correct operator fee balance", async () => {
                    await operator.setBond(0);
                    await operator.connect(user5).register();
                    await core.setProtoFeeSplit(5000, 0, 5000);
                    await core.setProtoFee(0, 0, 0, 0, fixedNFTSwapFee, 0);

                    const wantAndIds = [3, 4];
                    const ids = [1, 2];

                    protoFee = toBN(fixedNFTSwapFee).mul(ids.length);
                    mktFee = toBN(marketCom).mul(ids.length);
                    await token.transfer(provider.address, protoFee.add(mktFee));
                    await token.connect(provider).approve(feePurse.address, protoFee.add(mktFee));
                    await feePurse.connect(provider).deposit(protoFee.add(mktFee));

                    await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, 0, [], wantAndIds, [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, AddressZero, 0, 0, 0, wantAndIds, 0, 1)).to.emit(core, "Swap");

                    expect(await feePurse.balanceOf(deployer.address)).to.eql(toBN(mktFee));
                    expect(await feePurse.balanceOf(inventor.address)).to.eql(toBN(protoFee.div(2)));
                    expect(await feePurse.balanceOf(core.address)).to.eq(0);
                    expect(await feePurse.balanceOf(user5.address)).to.eq(protoFee.div(2));

                    // try to withdraw reward
                    await expect(core.connect(user5).withdrawOperatorBalance(await feePurse.feeToken())).not.to.be.reverted;
                    expect(await token.balanceOf(user5.address)).to.eql(protoFee.div(2));
                    expect(await feePurse.balanceOf(user5.address)).to.eq(0);
                });
            });

            context("sender provided a recipient", () => {
                it("should swap to recipient", async () => {
                    await assetReg.setSharable(testERC721.address, false);
                    await core.setProtoFeeSplit(5000, 5000, 0);
                    await mc.setCommission(mid, 0);
                    await core.setProtoFee(0, 0, 0, 0, 0, 0);

                    const wantAndIds = [3, 4];
                    const ids = [1, 2];
                    await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, AddressZero, ids, 0, [], wantAndIds, [0, 0, 0])).not.to.be.reverted;
                    await expect(core.connect(swapper).swapQuoteForBase(mid, provider.address, user5.address, 0, 0, 0, wantAndIds, 0, 0)).to.emit(core, "Swap");

                    expect(await testERC721.ownerOf(1)).to.eql(user5.address);
                    expect(await testERC721.ownerOf(2)).to.eql(user5.address);
                    expect(await testERC721.ownerOf(3)).to.eql(provider.address);
                    expect(await testERC721.ownerOf(4)).to.eql(provider.address);
                });
            });
        });
    });
});
