import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {BigNumber, BigNumberish, constants} from "ethers";
import {getAddress} from "ethers/lib/utils";
import {randomAddressString} from "hardhat/internal/hardhat-network/provider/utils/random";
import {AssetRegistry, BadgeManager, Core, ERC1155T, ERC721T, FeePurse, MarketCore, NFT, TOKEN} from "../../typechain-types";
import {AddressZero, AssetType, advanceBlockTime, makeMarketID, pow10str, toBN, toDec} from "../../utils/utils";
import {initCoreTestSuite} from "../helpers/helpers";

describe("Core - Liquidity", function () {
    let baseAddr: string;
    let quoteAddr: string;
    let core: Core;
    let mc: MarketCore;
    let badgeMgr: BadgeManager;
    let testERC721: ERC721T;
    let testERC1155: ERC1155T;
    let assetReg: AssetRegistry;
    let deployer: SignerWithAddress;
    let user5: SignerWithAddress;
    let accts: SignerWithAddress[];
    let cAddr: string;
    let baseAsset: TOKEN;
    let quoteAsset: TOKEN;
    let token: TOKEN;
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
    let instantNFTSwapFee: BigNumberish;
    let feePurse: FeePurse;
    let fixedSynthSwapFee: BigNumberish;
    let fixedNFTSwapFee: BigNumberish;
    let nft: NFT;
    let nftDiscountBp: BigNumber;
    let fixedFee: BigNumber;
    let curRate: BigNumber;

    let marketCreator: SignerWithAddress, provider: SignerWithAddress, swapper: SignerWithAddress, marketCreator2: SignerWithAddress, inventor: SignerWithAddress;

    beforeEach(async () => {
        const vars = await initCoreTestSuite();
        accts = vars.accts;
        baseAddr = vars.baseAddr;
        quoteAddr = vars.quoteAddr;
        core = vars.core;
        mc = vars.mc;
        nft = vars.nft;
        badgeMgr = vars.badgeMgr;
        testERC721 = vars.testERC721;
        testERC1155 = vars.testERC1155;
        feePurse = vars.feePurse;
        assetReg = vars.assetReg;
        deployer = vars.deployer;
        user5 = vars.user5;
        cAddr = vars.cAddr;
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
        instantNFTSwapFee = vars.instantNFTSwapFee;
        deployer = vars.deployer;
        marketCreator = vars.marketCreator;
        provider = vars.provider;
        swapper = vars.swapper;
        marketCreator2 = vars.marketCreator2;
        inventor = vars.inventor;
        user5 = vars.user5;
        fixedSynthSwapFee = vars.fixedSynthSwapFee;
        token = vars.token;
        nftDiscountBp = vars.nftDiscountBp;
        fixedNFTSwapFee = vars.fixedNFTSwapFee;

        fixedFee = toBN("100000000000000000"); // 0.1
        curRate = toBN("100000000000000000"); // 0.1
    });

    async function createMarket(
        creator: SignerWithAddress = deployer,
        base: string,
        quote: string,
        baseType: number,
        quoteType: number,
        permPut: boolean,
        permSwap: boolean,
        commission: BigNumberish,
        mediatorPoolId: BigNumberish
    ) {
        const mid = makeMarketID(creator.address, base, quote, baseType, quoteType);
        await mc.connect(creator).createMarket(base, quote, baseType, quoteType, permPut, permSwap, commission, mediatorPoolId);
        return Promise.resolve(mid);
    }

    async function provideLiquidity(provider: SignerWithAddress, liquidityAmt: BigNumber, basePrice: BigNumber, timeToPay = 0) {
        await baseAsset.transfer(provider.address, liquidityAmt);
        await baseAsset.connect(provider).approve(cAddr, liquidityAmt);
        await core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [liquidityAmt, basePrice], [], [], [0, 0, timeToPay, 0, 0]);
    }

    describe(".setLiquidityManager", () => {
        beforeEach(async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
        });

        it("should successfully set liquidity manager", async () => {
            await expect(core.setLiquidityManager(mid, user5.address)).to.emit(core, "UpdatedLiquidityManager").withArgs(getAddress(mid), deployer.address, user5.address, AddressZero);
            expect(await core.getLiquidityManager(mid, deployer.address)).to.eql(user5.address);
            await expect(core.setLiquidityManager(mid, deployer.address)).to.emit(core, "UpdatedLiquidityManager").withArgs(getAddress(mid), deployer.address, deployer.address, user5.address);
            expect(await core.getLiquidityManager(mid, deployer.address)).to.eql(deployer.address);
        });
    });

    describe(".updateNonFungibleLiquidity", () => {
        it("should revert with reason='EXPIRED_TX' when transaction has expired", async () => {
            const now = await advanceBlockTime(1);
            await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 10045], 0, [], [], [0, now, 0])).to.be.revertedWith("EXPIRED_TX");
        });

        it("should revert with reason='UNKNOWN_MARKET' when market does not exist", async () => {
            await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 10045], 0, [], [], [0, 0, 0])).to.be.revertedWith("UNKNOWN_MARKET");
        });

        context("market is permissioned and sender is not the owner of the market and also no permitted", () => {
            it("should revert with reason='NO_PUT_PERM'", async () => {
                mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC721, AssetType.ERC20, true, true, 0, 0);
                await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [], 0, [], [], [0, 0, 0])).to.be.revertedWith("MC: NO_PUT_PERM");
            });
        });

        it("should revert with msg=UNEXP_BASE when base asset type is not NFT", async () => {
            mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [], 0, [], [], [0, 0, 0])).to.be.revertedWith("OC: UNEXP_BASE");
        });

        context("market is not instant and timeToPay was non-zero", () => {
            it("should revert with msg=LOW_TTP when value is non-zero but less than minimum time to pay", async () => {
                await core.setMinTimeToPay(2);
                mid = await createMarket(deployer, baseAddr, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, 0, 0);
                await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [], 0, [], [], [1, 0, 0])).to.be.revertedWith("OC: LOW_TTP");
            });
        });

        it("should revert with msg=PRICE_NREQ when quote is NFT and price was provided", async () => {
            await core.setMinTimeToPay(2);
            mid = await createMarket(deployer, baseAddr, quoteAddr, AssetType.ERC721, AssetType.ERC721, false, false, 0, 0);
            await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [], 1, [], [], [0, 0, 0])).to.be.revertedWith("OC: PRICE_NREQ");
        });

        it("should revert with msg=PRICE_NREQ when quote is NFT and price is set", async () => {
            mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC721, AssetType.ERC721, false, false, 0, 0);
            await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [], 1, [], [], [0, 0, 0])).to.be.revertedWith("OC: PRICE_NREQ");
        });

        it("should revert with msg=PRICE_REQ when quote is ERC20/SYNTH and price was not provided", async () => {
            await core.setMinTimeToPay(2);
            mid = await createMarket(deployer, baseAddr, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, 0, 0);
            await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [], 0, [], [], [0, 0, 0])).to.be.revertedWith("OC: PRICE_REQ");
        });

        it("should revert with msg=WANT_IDS_NREQ when quote is ERC20/SYNTH and want IDs were set", async () => {
            mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC721, AssetType.ERC20, false, false, 0, 0);
            await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [], 1, [1], [], [0, 0, 0])).to.be.revertedWith("OC: WANT_IDS_NREQ");
            await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [], 1, [], [1], [0, 0, 0])).to.be.revertedWith("OC: WANT_IDS_NREQ");
        });

        it("should revert with msg=WANT_IDS_NUNIQ when quote is NFT and want IDs include duplicates", async () => {
            mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC721, AssetType.ERC721, false, false, 0, 0);
            await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [], 0, [1, 1], [], [0, 0, 0])).to.be.revertedWith("OC: WANT_IDS_NUNIQ");
            await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [], 0, [], [1, 1], [0, 0, 0])).to.be.revertedWith("OC: WANT_IDS_NUNIQ");
        });

        it("should revert with msg=WANT_IDS_HSIZE when quote is NFT and want array length is more than 16", async () => {
            const wantOrIds = Array(17).fill(0).map((_, i) => i); // prettier-ignore
            const wantAndIds = wantOrIds;
            mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC721, AssetType.ERC721, false, false, 0, 0);
            await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [], 0, wantOrIds, [], [0, 0, 0])).to.be.revertedWith("OC: WANT_IDS_HSIZE");
            await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [], 0, [], wantAndIds, [0, 0, 0])).to.be.revertedWith("OC: WANT_IDS_HSIZE");
        });

        it("should revert with msg=REQ_IDS when no previous liquidity and ids was not set", async () => {
            mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC721, AssetType.ERC721, false, false, 0, 0);
            await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [], 0, [1], [], [0, 0, 0])).to.be.revertedWith("OC: REQ_IDS");
        });

        it("should revert with msg=IDS_HSIZE when quote is NFT and want IDs include duplicates", async () => {
            const ids = Array(17).fill(0).map((_, i) => i); // prettier-ignore
            mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC721, AssetType.ERC721, false, false, 0, 0);
            await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 0, [1], [], [0, 0, 0])).to.be.revertedWith("OC: IDS_HSIZE");
        });

        it("should revert with msg=IDS_NUNIQ when quote is NFT and want or/and IDs include duplicates", async () => {
            mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC721, AssetType.ERC721, false, false, 0, 0);
            await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [1, 2, 1], 0, [1], [], [0, 0, 0])).to.be.revertedWith("OC: IDS_NUNIQ");
        });

        it("should revert with msg=TTP_NREQ when market is instant and timeToPay was set", async () => {
            mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC721, AssetType.ERC20, false, false, 0, 0);
            await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [], 0, [1], [], [1, 0, 0])).to.be.revertedWith("OC: TTP_NREQ");
        });

        context("BASE is ERC721/ERC1155 and QUOTE is ERC20", () => {
            beforeEach(async () => {
                await testERC721.mint();
                await testERC721.mint();
                await testERC721.approve(core.address, 1);
                await testERC721.approve(core.address, 2);
                await assetReg.setRate(testERC721.address, 2);
                await assetReg.setVerified(testERC721.address, true);
            });

            it("should successfully transfer NFT to contract", async () => {
                const ids = [1, 2];
                mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC20, false, false, 0, 0);
                await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 1, [], [], [0, 0, 0])).not.to.be.reverted;
                expect(await testERC721.balanceOf(core.address)).to.eql(toBN(2));
                expect(await testERC721.balanceOf(deployer.address)).to.eql(toBN(0));

                let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                expect(liq.ids).to.eql([toBN(1), toBN(2)]);
                expect(liq.price).to.eq(1);

                const mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eq(2);
            });

            context("BASE = ERC1155", () => {
                beforeEach(async () => {
                    await testERC1155.mint(1);
                    await testERC1155.mint(2);
                    await testERC1155.setApprovalForAll(core.address, true);
                    await assetReg.setRate(testERC1155.address, 2);
                    await assetReg.setVerified(testERC1155.address, true);
                });

                it("should successfully transfer NFT to contract", async () => {
                    const ids = [1, 2];
                    mid = await createMarket(undefined, testERC1155.address, quoteAddr, AssetType.ERC1155, AssetType.ERC20, false, false, 0, 0);
                    await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    expect(await testERC1155.balanceOf(core.address, 1)).to.eql(toBN(1));
                    expect(await testERC1155.balanceOf(core.address, 2)).to.eql(toBN(1));
                    expect(await testERC1155.balanceOf(deployer.address, 1)).to.eql(toBN(0));
                    expect(await testERC1155.balanceOf(deployer.address, 2)).to.eql(toBN(0));

                    let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([toBN(1), toBN(2)]);

                    const mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(2);
                });
            });

            context("when sender has liquidity but has lost permission to put liquidity", () => {
                it("should not be able to put more liquidity but should be able to remove existing liquidity", async () => {
                    const ids = [3, 4];
                    await testERC721.connect(provider).mint();
                    await testERC721.connect(provider).mint();
                    await testERC721.connect(provider).setApprovalForAll(core.address, true);
                    mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC20, true, false, 0, 0);
                    await mc.permitPut(mid, provider.address);
                    await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    expect(await testERC721.balanceOf(core.address)).to.eql(toBN(2));
                    expect(await testERC721.balanceOf(provider.address)).to.eql(toBN(0));

                    // Revoke PUT permission; Should not be able to put liquidity
                    await mc.revokePut(mid, provider.address);
                    await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [5], 1, [], [], [0, 0, 0])).to.be.revertedWith("MC: NO_PUT_PERM");

                    // Should be able to remove liquidity
                    await expect(core.connect(provider).updateNonFungibleLiquidity(mid, 0, true, constants.AddressZero, [0, 1, 2], 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    expect(await testERC721.balanceOf(core.address)).to.eql(toBN(0));
                    expect(await testERC721.balanceOf(provider.address)).to.eql(toBN(2));
                });
            });

            context("deduct=true", () => {
                it("should successfully remove liquidity", async () => {
                    mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC20, false, false, 0, 0);

                    const ids = [1, 2];
                    await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([toBN(1), toBN(2)]);
                    expect(await testERC721.balanceOf(deployer.address)).to.eql(toBN(0));

                    let mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(2);

                    // delete ID at index 0
                    await expect(core.updateNonFungibleLiquidity(mid, 0, true, constants.AddressZero, [0], 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([toBN(2)]);
                    expect(await testERC721.ownerOf(1)).to.eql(deployer.address);

                    mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(1);

                    // delete ID at new index 0
                    await expect(core.updateNonFungibleLiquidity(mid, 0, true, constants.AddressZero, [0], 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([]);
                    expect(await testERC721.ownerOf(1)).to.eql(deployer.address);
                    expect(await testERC721.ownerOf(2)).to.eql(deployer.address);
                    expect(await testERC721.balanceOf(core.address)).to.eql(toBN(0));

                    mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(0);

                    // restart
                    await testERC721.approve(core.address, 1);
                    await testERC721.approve(core.address, 2);
                    await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([toBN(1), toBN(2)]);

                    mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(2);

                    // delete using a unknown index (no delete should happen)
                    await expect(core.updateNonFungibleLiquidity(mid, 0, true, constants.AddressZero, [2], 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([toBN(1), toBN(2)]);

                    mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(2);

                    // delete all at once with unknown index in-between
                    await expect(core.updateNonFungibleLiquidity(mid, 0, true, constants.AddressZero, [0, 2, 1], 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([]);

                    mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(0);
                });
            });

            context("liquidity target is set", () => {
                it("should set target", async () => {
                    const ids = [1, 2];
                    mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC20, false, false, 0, 0);
                    await expect(core.updateNonFungibleLiquidity(mid, 0, false, swapper.address, ids, 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.target).to.eq(swapper.address);
                });
            });

            context("pause is set", () => {
                it("should set liquidity 'paused' state to true", async () => {
                    const ids = [1, 2];
                    mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC20, false, false, 0, 0);
                    await expect(core.updateNonFungibleLiquidity(mid, 0, false, swapper.address, ids, 1, [], [], [0, 0, 1])).not.to.be.reverted;
                    let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.paused).to.be.true;
                });
            });
        });

        context("BASE is ERC721/ERC1155 and QUOTE is SYNTH", () => {
            it("should revert when sender has insufficient fund in fee purse", async () => {
                await testERC721.mint();
                await testERC721.mint();
                await testERC721.setApprovalForAll(core.address, true);

                await assetReg.set(baseAddr, curRate, 0, fixedFee, 0, true, false, false); // rate: 100, bp: 0.1

                const ids = [1, 2];
                mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, 0, 0);
                await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 10, [], [], [0, 0, 0])).to.be.revertedWith("FP: LOW_BAL");
            });

            context("sender has no native NFT to enable discount fee; base asset has asset registry record", () => {
                it("should successfully transfer NFT to contract, lock correct liquidity fee", async () => {
                    mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, 0, 0);
                    await testERC721.mint();
                    await testERC721.mint();
                    await testERC721.setApprovalForAll(core.address, true);

                    await assetReg.set(testERC721.address, curRate, 0, fixedFee, 0, true, false, false); // rate: 100, bp: 0.1

                    const ids = [1, 2];
                    const expectedFee = toDec(fixedFee).mul(ids.length);
                    const fee = toBN(expectedFee);
                    await token.approve(feePurse.address, fee);
                    await feePurse.deposit(fee);

                    await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 10, [], [], [0, 0, 0])).not.to.be.reverted;
                    expect(await testERC721.balanceOf(core.address)).to.eql(toBN(2));
                    expect(await testERC721.balanceOf(deployer.address)).to.eql(toBN(0));

                    let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eql(fee);
                    expect(liq.ids).to.eql([toBN(1), toBN(2)]);
                    expect(liq.price).to.eq(10);
                });
            });

            context("sender has native NFT to enable discount fee; base asset has asset registry record", () => {
                it("should successfully transfer NFT to contract, lock correct liquidity fee", async () => {
                    mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, 0, 0);
                    await testERC721.mint();
                    await testERC721.mint();
                    await testERC721.setApprovalForAll(core.address, true);
                    await nft.mint(1, false, Buffer.alloc(0), 0);

                    await assetReg.set(testERC721.address, curRate, 0, fixedFee, 0, true, false, false); // rate: 100, bp: 0.1

                    const ids = [1, 2];
                    const expectedFee = toDec(fixedFee).mul(ids.length);
                    const discount = toDec(nftDiscountBp)
                        .div(100)
                        .div(100)
                        .mul(toDec(expectedFee).div(pow10str(18)));
                    const fee = toBN(expectedFee).sub(toBN(discount.mul(pow10str(18))));
                    await token.approve(feePurse.address, fee);
                    await feePurse.deposit(fee);

                    await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 10, [], [], [0, 0, 0])).not.to.be.reverted;
                    expect(await testERC721.balanceOf(core.address)).to.eql(toBN(2));
                    expect(await testERC721.balanceOf(deployer.address)).to.eql(toBN(0));

                    let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eql(fee);
                    expect(liq.ids).to.eql([toBN(1), toBN(2)]);
                    expect(liq.price).to.eq(10);
                });
            });

            context("sender has no native NFT to enable discount fee; base asset has no asset registry record", () => {
                it("should successfully transfer NFT to contract, lock correct liquidity fee", async () => {
                    mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, 0, 0);
                    await testERC721.mint();
                    await testERC721.mint();
                    await testERC721.setApprovalForAll(core.address, true);

                    const ids = [1, 2];
                    const expectedFee = toBN(fixedNFTSwapFee).mul(2);
                    await token.approve(feePurse.address, expectedFee);
                    await feePurse.deposit(expectedFee);

                    await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 10, [], [], [0, 0, 0])).not.to.be.reverted;
                    expect(await testERC721.balanceOf(core.address)).to.eql(toBN(2));
                    expect(await testERC721.balanceOf(deployer.address)).to.eql(toBN(0));

                    let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eql(expectedFee);
                    expect(liq.ids).to.eql([toBN(1), toBN(2)]);
                    expect(liq.price).to.eq(10);
                });
            });

            context("sender has native NFT to enable discount fee; base asset has no asset registry record", () => {
                it("should successfully transfer NFT to contract, lock correct liquidity fee", async () => {
                    mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, 0, 0);
                    await testERC721.mint();
                    await testERC721.mint();
                    await testERC721.setApprovalForAll(core.address, true);
                    await nft.mint(1, false, Buffer.alloc(0), 0);

                    const ids = [1, 2];
                    const discount = toDec(nftDiscountBp).div(100).div(100).mul(toDec(fixedNFTSwapFee).mul(ids.length));
                    const expectedFee = toBN(toDec(fixedNFTSwapFee).mul(ids.length).sub(discount));
                    await token.approve(feePurse.address, expectedFee);
                    await feePurse.deposit(expectedFee);

                    await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 10, [], [], [0, 0, 0])).not.to.be.reverted;
                    expect(await testERC721.balanceOf(core.address)).to.eql(toBN(2));
                    expect(await testERC721.balanceOf(deployer.address)).to.eql(toBN(0));

                    let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eql(expectedFee);
                    expect(liq.ids).to.eql([toBN(1), toBN(2)]);
                    expect(liq.price).to.eq(10);
                });
            });

            context("BASE = ERC1155", () => {
                it("should successfully transfer NFT to contract", async () => {
                    const ids = [1, 2];
                    await testERC1155.mint(1);
                    await testERC1155.mint(2);
                    await testERC1155.setApprovalForAll(core.address, true);

                    const expectedFee = toBN(toDec(fixedNFTSwapFee).mul(ids.length));
                    await token.approve(feePurse.address, expectedFee);
                    await feePurse.deposit(expectedFee);

                    mid = await createMarket(undefined, testERC1155.address, quoteAddr, AssetType.ERC1155, AssetType.SYNTH, false, false, 0, 0);
                    await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    expect(await testERC1155.balanceOf(core.address, 1)).to.eql(toBN(1));
                    expect(await testERC1155.balanceOf(core.address, 2)).to.eql(toBN(1));
                    expect(await testERC1155.balanceOf(deployer.address, 1)).to.eql(toBN(0));
                    expect(await testERC1155.balanceOf(deployer.address, 2)).to.eql(toBN(0));

                    let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([toBN(1), toBN(2)]);
                });
            });

            context("deduct=true", () => {
                let marketCom: BigNumber;

                beforeEach(async () => {
                    marketCom = toBN("100000000000000000");
                    await testERC721.mint();
                    await testERC721.mint();
                    await testERC721.setApprovalForAll(core.address, true);
                    await assetReg.setRate(testERC721.address, 2);
                    await assetReg.setVerified(testERC721.address, true);
                });

                it("should successfully remove liquidity", async () => {
                    mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.SYNTH, false, false, marketCom, 0);

                    const ids = [1, 2];
                    const protoFee = toDec(ids.length).mul(toDec(fixedNFTSwapFee));
                    const marketFee = toDec(ids.length).mul(toDec(marketCom));
                    const fee = toBN(protoFee.add(marketFee));
                    await token.approve(feePurse.address, fee);
                    await feePurse.deposit(fee);

                    await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([toBN(1), toBN(2)]);
                    expect(await testERC721.balanceOf(deployer.address)).to.eql(toBN(0));
                    expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eq(toBN(fee.div(2)));
                    expect(await feePurse.getLocked(liq.mktCreatorFeePurseId)).to.eq(toBN(fee.div(2)));
                    expect(liq.protoFeeRate).to.eql(toBN(protoFee.div(2)));
                    expect(liq.mktCreatorFeeRate).to.eql(toBN(marketFee.div(2)));

                    // delete ID at index 0
                    await expect(core.updateNonFungibleLiquidity(mid, 0, true, constants.AddressZero, [0], 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([toBN(2)]);
                    expect(await testERC721.ownerOf(1)).to.eql(deployer.address);
                    expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eq(toBN(protoFee.div(2)));
                    expect(await feePurse.getLocked(liq.mktCreatorFeePurseId)).to.eq(toBN(marketFee.div(2)));
                    expect(liq.protoFeeRate).to.eql(toBN(protoFee.div(2)));
                    expect(liq.mktCreatorFeeRate).to.eql(toBN(marketFee.div(2)));

                    // delete ID at new index 0
                    await expect(core.updateNonFungibleLiquidity(mid, 0, true, constants.AddressZero, [0], 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([]);
                    expect(await testERC721.ownerOf(1)).to.eql(deployer.address);
                    expect(await testERC721.ownerOf(2)).to.eql(deployer.address);
                    expect(await testERC721.balanceOf(core.address)).to.eql(toBN(0));
                    expect(await feePurse.balanceOf(deployer.address)).to.eq(fee);
                    expect(liq.protoFeePurseId).to.eq(0);
                    expect(liq.mktCreatorFeePurseId).to.eq(0);
                    expect(liq.protoFeeRate).to.eq(0);
                    expect(liq.mktCreatorFeeRate).to.eq(0);

                    // restart
                    await testERC721.approve(core.address, 1);
                    await testERC721.approve(core.address, 2);
                    await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    expect(await testERC721.balanceOf(deployer.address)).to.eql(toBN(0));
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([toBN(1), toBN(2)]);
                    expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eql(toBN(protoFee));
                    expect(await feePurse.getLocked(liq.mktCreatorFeePurseId)).to.eql(toBN(marketFee));

                    // delete using an unknown index (no delete should happen)
                    await expect(core.updateNonFungibleLiquidity(mid, 0, true, constants.AddressZero, [2], 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    expect(await testERC721.balanceOf(deployer.address)).to.eql(toBN(0));
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eql(toBN(protoFee));
                    expect(await feePurse.getLocked(liq.mktCreatorFeePurseId)).to.eql(toBN(marketFee));

                    // delete all at once with unknown index in-between
                    await expect(core.updateNonFungibleLiquidity(mid, 0, true, constants.AddressZero, [0, 2, 1], 1, [], [], [0, 0, 0])).not.to.be.reverted;
                    expect(await testERC721.balanceOf(deployer.address)).to.eq(2);
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([]);
                    expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eq(toBN(0));
                    expect(await feePurse.getLocked(liq.mktCreatorFeePurseId)).to.eq(toBN(0));
                    expect(liq.protoFeeRate).to.eq(0);
                    expect(liq.mktCreatorFeeRate).to.eq(0);
                });
            });
        });

        context("BASE is ERC721/ERC1155 and QUOTE is ERC721/ERC1155", () => {
            beforeEach(async () => {
                await testERC721.mint();
                await testERC721.mint();
                await testERC721.approve(core.address, 1);
                await testERC721.approve(core.address, 2);
                await assetReg.setRate(testERC721.address, 2);
                await assetReg.setVerified(testERC721.address, true);
                await core.setProtoFee(0, 0, 0, 0, 0, 0);
            });

            it("should successfully transfer NFT to contract", async () => {
                const ids = [1, 2];
                mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC721, false, false, 0, 0);
                await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 0, [1], [2], [0, 0, 0])).not.to.be.reverted;
                expect(await testERC721.balanceOf(core.address)).to.eql(toBN(2));
                expect(await testERC721.balanceOf(deployer.address)).to.eql(toBN(0));

                let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                expect(liq.ids).to.eql([toBN(1), toBN(2)]);
                expect(liq.price).to.eq(0);
            });

            context("BASE = ERC1155", () => {
                beforeEach(async () => {
                    await testERC1155.mint(1);
                    await testERC1155.mint(2);
                    await testERC1155.setApprovalForAll(core.address, true);
                    await assetReg.setRate(testERC1155.address, 2);
                    await assetReg.setVerified(testERC1155.address, true);
                });

                it("should successfully transfer NFT to contract", async () => {
                    const ids = [1, 2];
                    mid = await createMarket(undefined, testERC1155.address, quoteAddr, AssetType.ERC1155, AssetType.ERC1155, false, false, 0, 0);
                    await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 0, [1], [2], [0, 0, 0])).not.to.be.reverted;
                    expect(await testERC1155.balanceOf(core.address, 1)).to.eql(toBN(1));
                    expect(await testERC1155.balanceOf(core.address, 2)).to.eql(toBN(1));
                    expect(await testERC1155.balanceOf(deployer.address, 1)).to.eql(toBN(0));
                    expect(await testERC1155.balanceOf(deployer.address, 2)).to.eql(toBN(0));

                    let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([toBN(1), toBN(2)]);
                });
            });

            context("deduct=true", () => {
                it("should successfully remove liquidity", async () => {
                    mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC721, false, false, 0, 0);

                    const ids = [1, 2];
                    await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 0, [1], [], [0, 0, 0])).not.to.be.reverted;
                    let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([toBN(1), toBN(2)]);
                    expect(await testERC721.balanceOf(deployer.address)).to.eql(toBN(0));

                    // delete ID at index 0
                    await expect(core.updateNonFungibleLiquidity(mid, 0, true, constants.AddressZero, [0], 0, [1], [], [0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([toBN(2)]);
                    expect(await testERC721.ownerOf(1)).to.eql(deployer.address);

                    // delete ID at new index 0
                    await expect(core.updateNonFungibleLiquidity(mid, 0, true, constants.AddressZero, [0], 0, [1], [], [0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([]);
                    expect(await testERC721.ownerOf(1)).to.eql(deployer.address);
                    expect(await testERC721.ownerOf(2)).to.eql(deployer.address);
                    expect(await testERC721.balanceOf(core.address)).to.eql(toBN(0));

                    // restart
                    await testERC721.approve(core.address, 1);
                    await testERC721.approve(core.address, 2);
                    await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 0, [1], [], [0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([toBN(1), toBN(2)]);

                    // delete using a unknown index (no delete should happen)
                    await expect(core.updateNonFungibleLiquidity(mid, 0, true, constants.AddressZero, [2], 0, [1], [], [0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([toBN(1), toBN(2)]);

                    // delete all at once with unknown index in-between
                    await expect(core.updateNonFungibleLiquidity(mid, 0, true, constants.AddressZero, [0, 2, 1], 0, [1], [], [0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.ids).to.eql([]);
                });
            });
        });

        context("when market has required badge(s) for PUT operation", () => {
            beforeEach(async () => {
                await testERC721.mint();
                await testERC721.approve(core.address, 1);
            });

            it("should revert with msg=MKT_BADGE_REQ when sender does not have a required badge", async () => {
                const ids = [1];
                mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC20, false, false, 0, 0);

                const badges: [string, string][] = [["verified", ""]];
                await mc.setRequiredBadges(mid, badges, []);

                await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 1, [], [], [0, 0, 0])).to.be.revertedWith("OC: MKT_BADGE_REQ");
            });

            it("should revert with msg=MKT_BADGE_REQ when sender does not have all required badge", async () => {
                const ids = [1];
                mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC20, false, false, 0, 0);

                await badgeMgr.registerIssuer(user5.address, "verified", [], []);
                await badgeMgr.connect(user5).grantBadge("verified", "", deployer.address, 0, [], []);
                const badges: [string, string][] = [
                    ["verified", ""],
                    ["pm", "bank_transfer"],
                ];
                await mc.setRequiredBadges(mid, badges, []);

                await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 1, [], [], [0, 0, 0])).to.be.revertedWith("OC: MKT_BADGE_REQ");
            });

            it("should successfully transfer NFT to contract", async () => {
                const ids = [1];
                mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC20, false, false, 0, 0);

                await badgeMgr.registerIssuer(user5.address, "verified", [], []);
                await badgeMgr.registerIssuer(accts[1].address, "pm", [], []);
                await badgeMgr.connect(accts[1]).registerPath("pm", "bank_transfer", [], []);
                await badgeMgr.connect(user5).grantBadge("verified", "", deployer.address, 0, [], []);
                await badgeMgr.connect(accts[1]).grantBadge("pm", "bank_transfer", deployer.address, 0, [], []);
                const badges: [string, string][] = [
                    ["verified", ""],
                    ["pm", "bank_transfer"],
                ];
                await mc.setRequiredBadges(mid, badges, []);

                await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, ids, 1, [], [], [0, 0, 0])).not.to.be.reverted;
            });
        });
    });

    describe(".updateFungibleLiquidity", () => {
        it("should revert with reason='EXPIRED_TX' when transaction has expired", async () => {
            const now = await advanceBlockTime(1);
            await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 10045], [], [], [0, 0, 0, now, 0])).to.be.revertedWith("EXPIRED_TX");
        });

        it("should revert with reason='UNKNOWN_MARKET' when market does not exist", async () => {
            await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 10045], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith("UNKNOWN_MARKET");
        });

        context("market is permissioned and sender is not the owner of the market and also no permitted", () => {
            it("should revert with reason='NO_PUT_PERM'", async () => {
                await mc.createMarket(baseAddr, quoteAddr, 1, 0, true, true, 0, 0);
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 10045], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith("MC: NO_PUT_PERM");
            });
        });

        it("should revert with reason='UNEXP_BASE' when base asset is not fungible", async () => {
            mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC721, AssetType.ERC20, false, false, 0, 0);
            await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 10045], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: UNEXP_BASE");
        });

        context("market is instant but timeToPay was provided", () => {
            it("should revert with reason='TTP_NREQ'", async () => {
                mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 10045], [], [], [0, 0, 1, 0, 0])).to.be.revertedWith("OC: TTP_NREQ");
            });
        });

        it("should revert with reason=LOW_TTP when timeToPay is lesser than default minimum", async () => {
            mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0, 0);
            await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [0, 0], [], [], [0, 0, 1, 0, 0])).to.be.revertedWith("OC: LOW_TTP");
        });

        context("base asset is ERC20", () => {
            context("when sender has liquidity but has lost permission to put liquidity", () => {
                it("should not be able to put more liquidity but should be able to remove existing liquidity", async () => {
                    await baseAsset.transfer(provider.address, "200");
                    await baseAsset.connect(provider).approve(core.address, "200");
                    mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, true, false, 0, 0);
                    await mc.permitPut(mid, provider.address);
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 100], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                    let liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.amount.toNumber()).to.equal(100);

                    // When PUT perm is revoked, should not be able to put liquidity
                    await mc.revokePut(mid, provider.address);
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 100], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith("MC: NO_PUT_PERM");

                    // Should be able to remove liquidity
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, true, constants.AddressZero, [100, 100], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.amount.toNumber()).to.equal(0);
                });
            });

            context("quote asset is not NFT", () => {
                it("should revert with reason='OC: PRICE_REQ' when quote is ERC20", async () => {
                    mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                    await baseAsset.connect(provider).approve(core.address, "100");
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 0], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: PRICE_REQ");
                });

                it("should revert with reason='OC: PRICE_REQ' when quote is SYNTH", async () => {
                    mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0, 0);
                    await baseAsset.connect(provider).approve(core.address, "100");
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 0], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: PRICE_REQ");
                });
            });

            context("sender has insufficient balance", () => {
                it("should revert with reason='ERC20: transfer amount exceeds balance'", async () => {
                    mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, 0, false, false, 0, 0);
                    await baseAsset.connect(provider).approve(core.address, "100");
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 10045], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith(
                        "ERC20: transfer amount exceeds balance"
                    );
                });
            });

            context("sender has not approved the full amount", () => {
                it("should revert with reason='ERC20: transfer amount exceeds balance'", async () => {
                    await baseAsset.approve(cAddr, "99");
                    mid = await createMarket(undefined, baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
                    await expect(core.connect(marketCreator).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 10045], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith(
                        "ERC20: insufficient allowance"
                    );
                });
            });

            context("sender has approved sufficient amount", () => {
                it("should update sender's liquidity correctly", async () => {
                    await baseAsset.approve(cAddr, "200");
                    mid = await createMarket(undefined, baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
                    await expect(core.connect(marketCreator).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 100], [], [], [0, 0, 0, 0, 0])).to.emit(
                        core,
                        "UpdatedFungibleLiquidity"
                    );
                    let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.amount.toNumber()).to.equal(100);
                    expect(liq.price.toNumber()).to.equal(100);

                    // Try again
                    await core.connect(marketCreator).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 101], [], [], [0, 0, 0, 0, 0]);
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.amount.toNumber()).to.equal(200);
                    expect(liq.price.toNumber()).to.equal(101);

                    // Ensure contract has the correct liquidity balance
                    const contractBal = await baseAsset.balanceOf(cAddr);
                    expect(contractBal.toNumber()).to.equal(200);

                    const mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(200);
                });

                context("when liquidity target was set", () => {
                    it("should set target", async () => {
                        await baseAsset.approve(cAddr, "200");
                        mid = await createMarket(undefined, baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
                        await expect(core.connect(marketCreator).updateFungibleLiquidity(mid, 0, false, swapper.address, [100, 100], [], [], [0, 0, 0, 0, 0])).to.emit(
                            core,
                            "UpdatedFungibleLiquidity"
                        );
                        let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                        expect(liq.target).to.eql(swapper.address);
                    });
                });
            });

            context("quote asset is NFT and want or/and Ids where set", () => {
                it("should update sender's liquidity correctly", async () => {
                    const wantOrIds = [toBN(0), toBN(1)];
                    const wantAndIds = [toBN(2), toBN(3)];
                    await baseAsset.approve(cAddr, "200");
                    mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC721, false, false, 0, 0);
                    await expect(core.connect(marketCreator).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 0], wantOrIds, wantAndIds, [0, 0, 0, 0, 0])).to.emit(
                        core,
                        "UpdatedFungibleLiquidity"
                    );
                    let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.wantOrIds).to.eql(wantOrIds);
                    expect(liq.wantAndIds).to.eql(wantAndIds);

                    const mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(100);
                });
            });

            context("market is permissioned, but sender is permitted and sender has approved sufficient amount", () => {
                it("should update sender's liquidity correctly", async () => {
                    await baseAsset.approve(cAddr, "200");
                    await mc.createMarket(baseAddr, quoteAddr, 1, 0, true, false, 0, 0);
                    await mc.permitPut(mid, marketCreator.address);
                    await expect(core.connect(marketCreator).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 100], [], [], [0, 0, 0, 0, 0])).to.emit(
                        core,
                        "UpdatedFungibleLiquidity"
                    );
                    let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.amount.toNumber()).to.equal(100);
                    expect(liq.price.toNumber()).to.equal(100);

                    // Try again
                    await core.connect(marketCreator).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 101], [], [], [0, 0, 0, 0, 0]);
                    liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.amount.toNumber()).to.equal(200);
                    expect(liq.price.toNumber()).to.equal(101);
                });
            });

            context("sender has no existing liquidity, amount=0", () => {
                it("should revert with message='AMOUNT_REQ'", async () => {
                    await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
                    await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [0, 100], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: AMOUNT_REQ");
                });

                it("should update price only when sender previously had liquidity", async () => {
                    await baseAsset.approve(cAddr, 100);
                    await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
                    await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 100], [], [], [0, 0, 0, 0, 0])).to.emit(core, "UpdatedFungibleLiquidity");
                    await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [0, 120], [], [], [0, 0, 0, 0, 0])).to.emit(core, "UpdatedFungibleLiquidity");
                    let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.amount.toNumber()).to.equal(100);
                    expect(liq.price.toNumber()).to.equal(120);
                });
            });

            context("minSwap and maxSwap were provided", () => {
                beforeEach(async () => {
                    await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
                    await baseAsset.approve(cAddr, 100);
                });

                context("minSwap=0, maxSwap=0", () => {
                    it("should be successful", async () => {
                        await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 15], [], [], [0, 0, 0, 0, 0])).to.emit(core, "UpdatedFungibleLiquidity");
                        let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                        expect(liq.amount.toNumber()).to.equal(100);
                        expect(liq.minSwap.toNumber()).to.equal(0);
                        expect(liq.maxSwap.toNumber()).to.equal(0);
                    });
                });

                context("minSwap=0, maxSwap=10", () => {
                    it("should be successful", async () => {
                        await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 15], [], [], [0, 10, 0, 0, 0])).to.emit(core, "UpdatedFungibleLiquidity");
                        let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                        expect(liq.amount.toNumber()).to.equal(100);
                        expect(liq.minSwap.toNumber()).to.equal(0);
                        expect(liq.maxSwap.toNumber()).to.equal(10);
                    });
                });

                context("minSwap=10, maxSwap=0", () => {
                    it("should be successful", async () => {
                        await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 15], [], [], [10, 0, 0, 0, 0])).not.to.be.reverted;
                        let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                        expect(liq.amount.toNumber()).to.equal(100);
                        expect(liq.minSwap.toNumber()).to.equal(10);
                        expect(liq.maxSwap.toNumber()).to.equal(0);
                    });
                });

                context("minSwap=10, maxSwap=10", () => {
                    it("should revert", async () => {
                        await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 15], [], [], [10, 10, 0, 0, 0])).to.be.revertedWith("MIN_MAX_SWAP_INV");
                    });
                });

                context("minSwap=10, maxSwap=9", () => {
                    it("should revert", async () => {
                        await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 15], [], [], [10, 10, 0, 0, 0])).to.be.revertedWith("MIN_MAX_SWAP_INV");
                    });
                });

                context("existing liquidity has minSwap=0, maxSwap=10 | new update has minSwap=10, maxSwap=0", () => {
                    it("should revert", async () => {
                        await core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [50, 15], [], [], [0, 10, 0, 0, 0]);
                        await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [50, 15], [], [], [10, 0, 0, 0, 0])).not.to.be.reverted;
                    });
                });

                context("existing liquidity has minSwap=0, maxSwap=10 | new update has minSwap=10, maxSwap=10", () => {
                    it("should revert", async () => {
                        await core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [50, 15], [], [], [0, 10, 0, 0, 0]);
                        await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [50, 15], [], [], [10, 10, 0, 0, 0])).to.be.revertedWith("MIN_MAX_SWAP_INV");
                    });
                });

                context("existing liquidity has minSwap=0, maxSwap=10 | new update has minSwap=11, maxSwap=10", () => {
                    it("should revert", async () => {
                        await core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [50, 15], [], [], [0, 10, 0, 0, 0]);
                        await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [50, 15], [], [], [11, 10, 0, 0, 0])).to.be.revertedWith("MIN_MAX_SWAP_INV");
                    });
                });
            });

            context("timeToPay was non-zero", () => {
                beforeEach(async () => {
                    await core.setMinTimeToPay(2);
                });

                it("should revert with msg= when value is non-zero but less than minimum time to pay", async () => {
                    await baseAsset.approve(cAddr, 100);
                    await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
                    await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [50, 15], [], [], [0, 10, 1, 0, 0])).to.be.revertedWith("OC: LOW_TTP");
                });

                it("should set the liquidity timeToPay", async () => {
                    await baseAsset.approve(cAddr, 100);
                    await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
                    await core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [50, 15], [], [], [0, 10, 120, 0, 0]);
                    const liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.timeToPay.toNumber()).to.eql(120);
                });
            });

            context("pause was non-zero", () => {
                it("should set set liquidity `paused` state to true", async () => {
                    await core.setMinTimeToPay(2);
                    await baseAsset.approve(cAddr, 100);
                    await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
                    await core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [50, 15], [], [], [0, 10, 120, 0, 1]);
                    const liq = await core.getLiquidity(mid, marketCreator.address, 0);
                    expect(liq.paused).to.be.true;
                });
            });

            context("asset type is not ERC20 or SYNTH", () => {
                it("should revert with reason=UNEXP_BASE", async () => {
                    mid = makeMarketID(marketCreator.address, baseAddr, quoteAddr, 2, 0);
                    await mc.createMarket(baseAddr, quoteAddr, 2, 0, false, false, 0, 0);
                    await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 1], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: UNEXP_BASE");
                });
            });

            context("quote asset is NFT and price was provided", () => {
                it("should revert with reason=OC: PRICE_NREQ", async () => {
                    mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC721, false, false, 0, 0);
                    await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 1], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: PRICE_NREQ");
                });
            });

            context("quote asset is not NFT and want IDs was provided", () => {
                it("should revert with reason=OC: WANT_IDS_NREQ", async () => {
                    mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                    await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 1], [0], [1], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: WANT_IDS_NREQ");
                });
            });

            context("quote asset is NFT and minSwap and maxSwap was provided", () => {
                it("should revert with reason=OC: MIN_MAX_SWAP_NREQ", async () => {
                    mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC721, false, false, 0, 0);
                    await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 0], [0], [1], [1, 0, 0, 0, 0])).to.be.revertedWith("OC: MIN_MAX_SWAP_NREQ");
                    await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 0], [0], [1], [0, 1, 0, 0, 0])).to.be.revertedWith("OC: MIN_MAX_SWAP_NREQ");
                });
            });

            context("quote is NFT and no want ID include duplicates", () => {
                it("should revert with reason='WANT_IDS_NUNIQ'", async () => {
                    await baseAsset.approve(cAddr, "100");
                    mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC721, false, false, 0, 0);
                    const wantOrIds = [1, 1];
                    await expect(core.connect(marketCreator).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 0], wantOrIds, [], [0, 0, 0, 0, 0])).to.be.revertedWith(
                        "OC: WANT_IDS_NUNIQ"
                    );
                    const wantAndIds = [1, 1];
                    await expect(core.connect(marketCreator).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 0], [], wantAndIds, [0, 0, 0, 0, 0])).to.be.revertedWith(
                        "OC: WANT_IDS_NUNIQ"
                    );
                });
            });

            context("quote is NFT and no want ID exceed length=16", () => {
                it("should revert with reason='WANT_IDS_HSIZE'", async () => {
                    await baseAsset.approve(cAddr, "100");
                    const wantOrIds: BigNumberish[] = [];
                    const wantAndIds: BigNumberish[] = [];
                    for (let i = 0; i < 17; i++) {
                        wantOrIds.push(i);
                        wantAndIds.push(i);
                    }
                    mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC721, false, false, 0, 0);
                    await expect(core.connect(marketCreator).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 0], wantOrIds, [], [0, 0, 0, 0, 0])).to.be.revertedWith(
                        "OC: WANT_IDS_HSIZE"
                    );
                    await expect(core.connect(marketCreator).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 0], [], wantAndIds, [0, 0, 0, 0, 0])).to.be.revertedWith(
                        "OC: WANT_IDS_HSIZE"
                    );
                });
            });

            context("quote asset is NFT and wantOrIds or wantAndIds is set", () => {
                it("should be successful when wantOrIds is set", async () => {
                    await baseAsset.approve(cAddr, "100");
                    mid = await createMarket(marketCreator, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC721, false, false, 0, 0);
                    await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 0], [1], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                });

                it("should be successful when wantAndIds is set", async () => {
                    await baseAsset.approve(cAddr, "100");
                    mid = await createMarket(marketCreator, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC721, false, false, 0, 0);
                    await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 0], [], [1], [0, 0, 0, 0, 0])).not.to.be.reverted;
                });
            });

            context("deduct=true", () => {
                const liqAmt = 100;
                beforeEach(async () => {
                    await baseAsset.approve(cAddr, liqAmt);
                    await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
                    await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [liqAmt, 1], [], [], [0, 0, 0, 0, 0])).to.emit(core, "UpdatedFungibleLiquidity");
                    const mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(liqAmt);
                });

                it("should revert with reason=LOW_LIQ when amount is greater than available liquidity", async () => {
                    await expect(core.updateFungibleLiquidity(mid, 0, true, constants.AddressZero, [liqAmt + 1, 1], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: LOW_LIQ");
                });

                it("should deduct liquidity", async () => {
                    const baseBal = await baseAsset.balanceOf(deployer.address);

                    await expect(core.updateFungibleLiquidity(mid, 0, true, constants.AddressZero, [50, 1], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                    expect(await baseAsset.balanceOf(deployer.address)).to.eql(baseBal.add(50));
                    const liqBal = await core.getLiquidity(mid, deployer.address, 0);
                    expect(liqBal.amount).to.eql(toBN(50));

                    const mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(50);
                });
            });
        });

        context("base asset is SYNTH and quote is ERC20", () => {
            it("should successfully add liquidity", async () => {
                mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.ERC20, false, false, 0, 0);
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 10], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                let liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.amount.toNumber()).to.equal(100);
                expect(liq.price.toNumber()).to.equal(10);
            });

            it("should successfully remove liquidity", async () => {
                mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.ERC20, false, false, 0, 0);
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 10], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                let liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.amount.toNumber()).to.equal(100);
                expect(liq.price.toNumber()).to.equal(10);

                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, true, constants.AddressZero, [10, 10], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.amount.toNumber()).to.equal(90);

                const mkt = await mc.getMarket(mid);
                expect(mkt.numLiquidity).to.eq(90);
            });
        });

        context("base asset is SYNTH and quote asset is SYNTH", () => {
            let marketCom: BigNumber;

            beforeEach(async () => {
                marketCom = toBN("100000000000000000");
                mid = await createMarket(deployer, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.SYNTH, false, false, marketCom, 0);
            });

            it("should revert with reason=PRICE_REQ when price was not provided", async () => {
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [0, 0], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: PRICE_REQ");
            });

            it("should revert with reason=AMOUNT_REQ when price was not provided", async () => {
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [0, 1], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: AMOUNT_REQ");
            });

            it("should revert with reason=MIN_MAX_SWAP_INV when price was not provided", async () => {
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [1, 1], [], [], [2, 1, 0, 0, 0])).to.be.revertedWith("OC: MIN_MAX_SWAP_INV");
            });

            context("deduct = false", () => {
                it("should revert with msg='LOW_BAL' when unable to lock fee", async () => {
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [tokenDec.mul(1), 1], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith("FP: LOW_BAL");
                });

                it("should successfully deduct fee when base asset has no asset registry record", async () => {
                    let liqAmt = tokenDec.mul(2);
                    let protoFee = toDec(toDec(liqAmt).mul(toDec(fixedSynthSwapFee)).div(pow10str(18)));
                    let mktCreatorFee = toDec(toDec(liqAmt).mul(toDec(marketCom)).div(pow10str(18)));
                    const fee = protoFee.add(mktCreatorFee);

                    await token.approve(feePurse.address, toBN(fee));
                    await feePurse.deposit(toBN(fee));

                    await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [liqAmt, 1], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                    let liq = await core.getLiquidity(mid, deployer.address, 0);
                    expect(liq.protoFeePurseId).to.eq(1);
                    expect(liq.protoFeeRate.mul(liqAmt).div(tokenDec)).to.eq(toBN(protoFee));
                    expect(liq.mktCreatorFeeRate.mul(liqAmt).div(tokenDec)).to.eq(toBN(mktCreatorFee));

                    let mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(liqAmt);

                    // Set fees to 0 and adding new liquidity should recalculate fee rates
                    await mc.setCommission(mid, 0);
                    await core.setProtoFee(0, 0, 0, 0, 0, 0);
                    await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [tokenDec.mul(1), 1], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                    const upLiq = await core.getLiquidity(mid, deployer.address, 0);
                    expect(liq.protoFeeRate).not.to.eql(upLiq.protoFeeRate);
                    const updProtoFeeRate = toBN(protoFee).mul(tokenDec).div(liqAmt.add(tokenDec)); //.div(toDec(liqAmt.add(tokenDec))).mul(toDec(tokenDec));
                    expect(upLiq.protoFeeRate).to.eql(updProtoFeeRate);
                    const updMktFeeRate = toBN(mktCreatorFee).mul(tokenDec).div(liqAmt.add(tokenDec)); //.div(toDec(liqAmt.add(tokenDec))).mul(toDec(tokenDec));
                    expect(upLiq.protoFeeRate).to.eql(updMktFeeRate);

                    mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(liqAmt.add(tokenDec));
                });

                describe("sender has NFT and base asset has asset registry record", () => {
                    it("should successfully apply discount and lock correct fee (feeFixed: 0.1, nftDiscountBp: 2500)", async () => {
                        await nft.mint(1, false, Buffer.alloc(0), 0);

                        await assetReg.set(baseAddr, curRate, 0, fixedFee, 0, false, false, false);
                        const liqAmt = tokenDec.mul(2);
                        let protoFee = toDec(toDec(liqAmt).mul(toDec(fixedFee)).div(pow10str(18)));
                        let mktCreatorFee = toDec(toDec(liqAmt).mul(toDec(marketCom)).div(pow10str(18)));
                        const fee = protoFee.add(mktCreatorFee);

                        const expectedFee = toBN(fee.sub(fee.mul(toDec(nftDiscountBp).div(100).div(100))));
                        await token.approve(feePurse.address, expectedFee);
                        await feePurse.deposit(expectedFee);

                        await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [liqAmt, 1], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                        let liq = await core.getLiquidity(mid, deployer.address, 0);
                        expect(liq.protoFeePurseId).to.eq(1);
                        let protoPurseBal = await feePurse.getLocked(liq.protoFeePurseId);
                        let mktCreatorPurseBal = await feePurse.getLocked(liq.mktCreatorFeePurseId);
                        expect(protoPurseBal.add(mktCreatorPurseBal)).to.eql(expectedFee);
                        expect(await feePurse.balanceOf(deployer.address)).to.eq(0);
                    });

                    it("should successfully apply discount and lock correct fee (feeFixed: 0.5, nftDiscountBp: 2500)", async () => {
                        await nft.mint(1, false, Buffer.alloc(0), 0);

                        fixedFee = toBN("500000000000000000");
                        await assetReg.set(baseAddr, curRate, 0, fixedFee, 0, false, false, false);
                        const liqAmt = tokenDec.mul(2);
                        let protoFee = toDec(toDec(liqAmt).mul(toDec(fixedFee)).div(pow10str(18)));
                        let mktCreatorFee = toDec(toDec(liqAmt).mul(toDec(marketCom)).div(pow10str(18)));
                        const fee = protoFee.add(mktCreatorFee);

                        const expectedFee = toBN(fee.sub(fee.mul(toDec(nftDiscountBp).div(100).div(100))));
                        await token.approve(feePurse.address, expectedFee);
                        await feePurse.deposit(expectedFee);

                        await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [liqAmt, 1], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                        let liq = await core.getLiquidity(mid, deployer.address, 0);
                        let protoPurseBal = await feePurse.getLocked(liq.protoFeePurseId);
                        let mktCreatorPurseBal = await feePurse.getLocked(liq.mktCreatorFeePurseId);
                        expect(protoPurseBal.add(mktCreatorPurseBal)).to.eql(expectedFee);
                        expect(await feePurse.balanceOf(deployer.address)).to.eq(0);
                    });
                });

                describe("sender does not have NFT and base asset has asset registry record", () => {
                    it("should successfully apply discount and lock correct fee (feeFixed: 0.1)", async () => {
                        await assetReg.set(baseAddr, curRate, 0, fixedFee, 0, false, false, false);

                        const liqAmt = tokenDec.mul(2);
                        let protoFee = toBN(toDec(liqAmt).mul(toDec(fixedFee)).div(pow10str(18)));
                        let mktCreatorFee = toBN(toDec(liqAmt).mul(toDec(marketCom)).div(pow10str(18)));
                        const fee = protoFee.add(mktCreatorFee);

                        await token.approve(feePurse.address, fee);
                        await feePurse.deposit(fee);

                        await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [liqAmt, 1], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                        let liq = await core.getLiquidity(mid, deployer.address, 0);
                        expect(liq.amount).to.eql(liqAmt);
                        let protoPurseBal = await feePurse.getLocked(liq.protoFeePurseId);
                        let mktCreatorPurseBal = await feePurse.getLocked(liq.mktCreatorFeePurseId);
                        expect(protoPurseBal.add(mktCreatorPurseBal)).to.eql(fee);
                        expect(await feePurse.balanceOf(deployer.address)).to.eq(0);
                    });
                });

                describe("sender has NFT and base asset does not have asset registry record", () => {
                    it("should successfully apply discount and lock correct fee (fixedSynthSwapFee: 0.1, nftDiscountBp: 2500)", async () => {
                        await nft.mint(1, false, Buffer.alloc(0), 0);

                        const liqAmt = tokenDec.mul(2);
                        const protoFee = toDec(fixedSynthSwapFee).mul(toDec(liqAmt));
                        const mktCreatorFee = toDec(marketCom).mul(toDec(liqAmt));
                        const fee = protoFee.add(mktCreatorFee);

                        const expectedFee = toBN(fee.sub(fee.mul(toDec(nftDiscountBp)).div(10000)).div(pow10str(18)));
                        await token.approve(feePurse.address, expectedFee);
                        await feePurse.deposit(expectedFee);

                        await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [liqAmt, 1], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                        let liq = await core.getLiquidity(mid, deployer.address, 0);
                        expect(liq.amount).to.eq(liqAmt);
                        let protoPurseBal = await feePurse.getLocked(liq.protoFeePurseId);
                        let mktCreatorPurseBal = await feePurse.getLocked(liq.mktCreatorFeePurseId);
                        expect(protoPurseBal.add(mktCreatorPurseBal)).to.eql(expectedFee);
                        expect(await feePurse.balanceOf(deployer.address)).to.eq(0);
                    });
                });

                describe("sender does not have NFT and base asset does not have asset registry record", () => {
                    it("should successfully calculate and lock correct fee (fixedSynthSwapFee: 0.1, nftDiscountBp: 2500)", async () => {
                        const liqAmt = tokenDec.mul(1);
                        const protoFee = toBN(toDec(fixedSynthSwapFee).mul(toDec(liqAmt)).div(pow10str(18)));
                        const mktCreatorFee = toBN(toDec(marketCom).mul(toDec(liqAmt)).div(pow10str(18)));
                        const fee = protoFee.add(mktCreatorFee);

                        await token.approve(feePurse.address, fee);
                        await feePurse.deposit(fee);

                        await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [liqAmt, 1], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                        let liq = await core.getLiquidity(mid, deployer.address, 0);
                        expect(liq.amount).to.eq(toBN("1000000000000000000"));
                        let protoPurseBal = await feePurse.getLocked(liq.protoFeePurseId);
                        let mktCreatorPurseBal = await feePurse.getLocked(liq.mktCreatorFeePurseId);
                        expect(protoPurseBal.add(mktCreatorPurseBal)).to.eql(fee);
                        expect(await feePurse.balanceOf(deployer.address)).to.eq(0);
                    });
                });

                describe("sender has existing liquidity", () => {
                    it("should successfully calculate and lock correct fee (fixedSynthSwapFee: 0.1)", async () => {
                        const liqAmt = tokenDec.mul(2);
                        let protoFee = toBN(fixedSynthSwapFee).mul(liqAmt).div(pow10str(18));
                        let mktCreatorFee = toBN(marketCom).mul(liqAmt).div(pow10str(18));
                        const fee = protoFee.add(mktCreatorFee);

                        // Add liquidity
                        await token.approve(feePurse.address, fee);
                        await feePurse.deposit(fee);
                        await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [liqAmt, 1], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;

                        let liq = await core.getLiquidity(mid, deployer.address, 0);
                        expect(liq.amount).to.eq(liqAmt);
                        expect(liq.protoFeePurseId).to.eq(1);
                        expect(liq.mktCreatorFeePurseId).to.eq(2);
                        let protoPurseBal = await feePurse.getLocked(liq.protoFeePurseId);
                        let mktCreatorPurseBal = await feePurse.getLocked(liq.mktCreatorFeePurseId);
                        expect(protoPurseBal.add(mktCreatorPurseBal)).to.eql(fee);
                        expect(await feePurse.balanceOf(deployer.address)).to.eq(0);

                        // Add liquidity again
                        await token.approve(feePurse.address, fee);
                        await feePurse.deposit(fee);
                        await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [liqAmt, 1], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                        let liq2 = await core.getLiquidity(mid, deployer.address, 0);
                        expect(liq2.amount).to.eq(liqAmt.mul(2));
                        expect(liq2.protoFeePurseId).to.eq(3);
                        expect(liq2.mktCreatorFeePurseId).to.eq(4);
                        expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eq(0);
                        expect(await feePurse.getLocked(liq.mktCreatorFeePurseId)).to.eq(0);
                        protoPurseBal = await feePurse.getLocked(liq2.protoFeePurseId);
                        mktCreatorPurseBal = await feePurse.getLocked(liq2.mktCreatorFeePurseId);
                        expect(protoPurseBal.add(mktCreatorPurseBal)).to.eql(fee.mul(2));
                        expect(await feePurse.balanceOf(deployer.address)).to.eq(0);
                    });
                });
            });

            context("deduct = true", () => {
                it("should add and deduct liquidity", async () => {
                    const liqAmt = tokenDec.mul(2);
                    const protoFee = toBN(fixedSynthSwapFee).mul(liqAmt).div(pow10str(18));
                    const mktCreatorFee = toBN(marketCom).mul(liqAmt).div(pow10str(18));
                    const fee = protoFee.add(mktCreatorFee);

                    await token.transfer(provider.address, fee);
                    await token.connect(provider).approve(feePurse.address, fee);
                    await feePurse.connect(provider).deposit(fee);

                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [liqAmt, 1], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                    let liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.amount).to.eq(liqAmt);
                    expect(liq.price).to.eq(1);
                    expect(liq.protoFeePurseId).to.eq(1);
                    expect(liq.mktCreatorFeePurseId).to.eq(2);
                    expect(liq.protoFeeRate).not.to.eq(0);
                    expect(liq.mktCreatorFeeRate).not.to.eq(0);
                    expect(await feePurse.balanceOf(provider.address)).to.eql(toBN(0));

                    // deduct
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, true, constants.AddressZero, [liqAmt.div(2), 1], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.amount).to.eq(liqAmt.div(2));
                    expect(liq.protoFeePurseId).to.eq(3);
                    expect(liq.mktCreatorFeePurseId).to.eq(4);
                    let protoPurseBal = await feePurse.getLocked(liq.protoFeePurseId);
                    let mktCreatorPurseBal = await feePurse.getLocked(liq.mktCreatorFeePurseId);
                    expect(protoPurseBal.add(mktCreatorPurseBal)).to.eql(fee.div(2));

                    // deduct again
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, true, constants.AddressZero, [tokenDec.mul(1), 1], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.amount).to.eq(0);
                    expect(liq.protoFeePurseId).to.eq(0);
                    expect(liq.mktCreatorFeePurseId).to.eq(0);
                    protoPurseBal = await feePurse.getLocked(liq.protoFeePurseId);
                    mktCreatorPurseBal = await feePurse.getLocked(liq.mktCreatorFeePurseId);
                    expect(protoPurseBal.add(mktCreatorPurseBal)).to.eq(0);

                    // All fee should be in feePurse
                    expect(await feePurse.balanceOf(provider.address)).to.eql(fee);

                    const mkt = await mc.getMarket(mid);
                    expect(mkt.numLiquidity).to.eq(0);
                });
            });
        });

        context("base asset is SYNTH and quote asset is NFT", () => {
            beforeEach(async () => {
                mid = await createMarket(deployer, baseAddr, quoteAddr, AssetType.SYNTH, AssetType.ERC721, false, false, 0, 0);
            });

            it("should revert with reason='WANT_IDS_HSIZE' when wantOrId or wantAndId exceed length limit", async () => {
                const ids = Array(17).fill(0).map((_, i) => i); // prettier-ignore
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [0, 0], ids, [], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: WANT_IDS_HSIZE");
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [0, 0], [], ids, [0, 0, 0, 0, 0])).to.be.revertedWith("OC: WANT_IDS_HSIZE");
            });

            it("should revert with reason='WANT_IDS_NUNIQ' when wantOrId or wantAndId contain duplicates", async () => {
                const ids = [1, 1];
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [0, 0], ids, [], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: WANT_IDS_NUNIQ");
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [0, 0], [], ids, [0, 0, 0, 0, 0])).to.be.revertedWith("OC: WANT_IDS_NUNIQ");
            });

            it("should revert with reason='AMOUNT_REQ' when a new liquidity is created and amount was not provided", async () => {
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [0, 0], [1], [], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: AMOUNT_REQ");
            });

            it("should revert with reason='PRICE_NREQ' when price was provided", async () => {
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [1, 1], [1], [], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: PRICE_NREQ");
            });

            it("should successfully create liquidity", async () => {
                const liqAmt = tokenDec.mul(1);
                let fee = toBN(fixedSynthSwapFee).mul(liqAmt).div(pow10str(18));
                await token.transfer(provider.address, fee);
                await token.connect(provider).approve(feePurse.address, fee);
                await feePurse.connect(provider).deposit(fee);

                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [liqAmt, 0], [1], [], [0, 0, 0, 0, 0])).not.to.be.reverted;

                let liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.amount).to.eq(liqAmt);
                expect(liq.protoFeePurseId).to.eq(1);

                // add new at index 1
                const liqAmt2 = tokenDec.mul(2);
                fee = toBN(fixedSynthSwapFee).mul(liqAmt2).div(pow10str(18));
                await token.transfer(provider.address, fee);
                await token.connect(provider).approve(feePurse.address, fee);
                await feePurse.connect(provider).deposit(fee);
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 1, false, constants.AddressZero, [liqAmt2, 0], [1], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                liq = await core.getLiquidity(mid, provider.address, 1);
                expect(liq.amount).to.eq(liqAmt2);
                expect(liq.protoFeePurseId).to.eq(2);

                // update liquidity at index 0
                const liqAmt3 = tokenDec.mul(2);
                fee = toBN(fixedSynthSwapFee).mul(liqAmt3).div(pow10str(18));
                await token.transfer(provider.address, fee);
                await token.connect(provider).approve(feePurse.address, fee);
                await feePurse.connect(provider).deposit(fee);
                await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [liqAmt3, 0], [1], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                liq = await core.getLiquidity(mid, provider.address, 0);
                expect(liq.amount).to.eq(liqAmt.add(liqAmt3));
                expect(liq.protoFeePurseId).to.eq(3);
            });

            context("deduct = true", () => {
                it("should revert with reason='LOW_LIQ' when amount is less than available liquidity", async () => {
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, true, constants.AddressZero, [1, 0], [1], [], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: LOW_LIQ");
                });

                it("should successfully deduct liquidity", async () => {
                    const liqAmt = tokenDec.mul(2);
                    const fee = toBN(fixedSynthSwapFee).mul(liqAmt).div(pow10str(18));
                    await token.transfer(provider.address, fee);
                    await token.connect(provider).approve(feePurse.address, fee);
                    await feePurse.connect(provider).deposit(fee);

                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [liqAmt, 0], [1], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                    let liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.amount).to.eq(liqAmt);
                    expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eql(fee);

                    // deduct
                    const liqAmt2 = tokenDec.mul(1);
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, true, constants.AddressZero, [liqAmt2, 0], [1], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.amount).to.eq(liqAmt.div(2));
                    expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eql(fee.div(2));

                    // deduct again
                    await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, true, constants.AddressZero, [liqAmt2, 0], [1], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                    liq = await core.getLiquidity(mid, provider.address, 0);
                    expect(liq.amount).to.eq(0);
                    expect(await feePurse.getLocked(liq.protoFeePurseId)).to.eq(0);
                });
            });
        });

        context("when market has required badge(s) for PUT operation", () => {
            it("should revert with msg=MKT_BADGE_REQ when sender does not have a required badge", async () => {
                await baseAsset.approve(cAddr, "200");
                mid = await createMarket(undefined, baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
                const badges: [string, string][] = [["verified", ""]];
                await mc.setRequiredBadges(mid, badges, []);
                await expect(core.connect(marketCreator).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 100], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: MKT_BADGE_REQ");
            });

            it("should revert with msg=MKT_BADGE_REQ when sender does not have all required badges", async () => {
                await baseAsset.approve(cAddr, "200");
                mid = await createMarket(undefined, baseAddr, quoteAddr, 1, 0, false, false, 0, 0);

                await badgeMgr.registerIssuer(user5.address, "verified", [], []);
                await badgeMgr.connect(user5).grantBadge("verified", "", deployer.address, 0, [], []);
                const badges: [string, string][] = [
                    ["verified", ""],
                    ["pm", "bank_transfer"],
                ];
                await mc.setRequiredBadges(mid, badges, []);

                await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 100], [], [], [0, 0, 0, 0, 0])).to.be.revertedWith("OC: MKT_BADGE_REQ");
            });

            it("should be successful when sender has all requested badges", async () => {
                await baseAsset.approve(cAddr, "200");
                mid = await createMarket(undefined, baseAddr, quoteAddr, 1, 0, false, false, 0, 0);

                await badgeMgr.registerIssuer(user5.address, "verified", [], []);
                await badgeMgr.registerIssuer(accts[1].address, "pm", [], []);
                await badgeMgr.connect(accts[1]).registerPath("pm", "bank_transfer", [], []);
                await badgeMgr.connect(user5).grantBadge("verified", "", deployer.address, 0, [], []);
                await badgeMgr.connect(accts[1]).grantBadge("pm", "bank_transfer", deployer.address, 0, [], []);
                const badges: [string, string][] = [
                    ["verified", ""],
                    ["pm", "bank_transfer"],
                ];
                await mc.setRequiredBadges(mid, badges, []);

                await expect(core.updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 100], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
                let liq = await core.getLiquidity(mid, marketCreator.address, 0);
                expect(liq.amount.toNumber()).to.equal(100);
                expect(liq.price.toNumber()).to.equal(100);
            });
        });
    });

    describe(".setSwapBadgeForLiquidity & getReqSwapBadges", function () {
        it("should revert when liquidity does not exist", async () => {
            await expect(core.setSwapBadgeForLiquidity(mid, 0, [])).to.be.revertedWith("OC: ZERO_LIQ");
        });

        it("should revert when > 8 badges are provided", async () => {
            await baseAsset.transfer(provider.address, "200");
            await baseAsset.connect(provider).approve(core.address, "200");
            mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 100], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
            await expect(
                core.connect(provider).setSwapBadgeForLiquidity(mid, 0, [
                    ["badge", "path"],
                    ["badge", "path"],
                    ["badge", "path"],
                    ["badge", "path"],
                    ["badge", "path"],
                    ["badge", "path"],
                    ["badge", "path"],
                    ["badge", "path"],
                    ["badge", "path"],
                ])
            ).to.be.revertedWith("OC: TOO_MANY_BADGES");
        });

        it("should successfully set and get badges", async () => {
            await baseAsset.transfer(provider.address, "200");
            await baseAsset.connect(provider).approve(core.address, "200");
            mid = await createMarket(undefined, baseAddr, quoteAddr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            await expect(core.connect(provider).updateFungibleLiquidity(mid, 0, false, constants.AddressZero, [100, 100], [], [], [0, 0, 0, 0, 0])).not.to.be.reverted;
            const badges: [string, string][] = [["badge", "path"]];
            await expect(core.connect(provider).setSwapBadgeForLiquidity(mid, 0, badges)).emit(core, "UpdatedLiquiditySwapBadges");
            expect(await core.getReqSwapBadges(mid, 0, provider.address)).to.eql([["badge", "path"]]);
            expect(await core.getReqSwapBadges(mid, 0, user5.address)).to.eql([]);
        });
    });

    describe(".updateLiquidityPrice", () => {
        context("liquidity requires price", () => {
            beforeEach(async () => {
                await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
                mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);

                await provideLiquidity(deployer, amountOfBase, pricePerBase);
            });

            it("should revert with reason=EXPIRED_TX when tx expired", async () => {
                const now = await advanceBlockTime(1);
                await expect(core.connect(user5).updateLiquidityPrice(mid, deployer.address, 0, 123, now)).to.be.revertedWith("OC: EXPIRED_TX");
            });

            it("should revert with reason=NOT_MANAGER when sender was not approved as liquidity manager", async () => {
                await expect(core.connect(user5).updateLiquidityPrice(mid, deployer.address, 0, 123, 0)).to.be.revertedWith("NOT_MANAGER");
            });

            it("should successfully update liquidity price when sender was approved as liquidity manager", async () => {
                await core.setLiquidityManager(mid, user5.address);
                await expect(core.connect(user5).updateLiquidityPrice(mid, deployer.address, 0, 123, 0)).to.emit(core, "UpdatedPrice");
                const liq = await core.getLiquidity(mid, deployer.address, 0);
                expect(liq.price).to.eql(toBN(123));
            });
        });

        context("liquidity does not require price", () => {
            it("should revert with msg='PRICE_NREQ' when liquidity does not have a previous price set", async () => {
                await testERC721.mint();
                await testERC721.approve(core.address, 1);
                await core.setProtoFee(0, 0, 0, 0, 0, 0);
                mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC721, false, false, 0, 0);
                await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [1], 0, [1], [], [0, 0, 0])).not.to.be.reverted;
                await core.setLiquidityManager(mid, deployer.address);
                await expect(core.updateLiquidityPrice(mid, deployer.address, 0, 1, 0)).to.be.revertedWith("OC: PRICE_NREQ");
            });
        });

        context("price is required but price is zero", () => {
            it("should revert with msg='PRICE_REQ'", async () => {
                await testERC721.mint();
                await testERC721.approve(core.address, 1);
                await core.setProtoFee(0, 0, 0, 0, 0, 0);
                mid = await createMarket(undefined, testERC721.address, quoteAddr, AssetType.ERC721, AssetType.ERC20, false, false, 0, 0);
                await expect(core.updateNonFungibleLiquidity(mid, 0, false, constants.AddressZero, [1], 1, [], [], [0, 0, 0])).not.to.be.reverted;
                await core.setLiquidityManager(mid, deployer.address);
                await expect(core.updateLiquidityPrice(mid, deployer.address, 0, 0, 0)).to.be.revertedWith("OC: PRICE_REQ");
            });
        });
    });

    describe(".getLiquidityManager", () => {
        beforeEach(async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
        });

        it("should successfully get liquidity manager", async () => {
            expect(await core.getLiquidityManager(mid, deployer.address)).to.eql(constants.AddressZero);
            await expect(core.setLiquidityManager(mid, user5.address)).not.to.be.reverted;
            expect(await core.getLiquidityManager(mid, deployer.address)).to.eql(user5.address);
        });
    });

    describe(".togglePause", () => {
        beforeEach(async () => {
            await mc.connect(marketCreator2).createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            mid = makeMarketID(marketCreator2.address, baseAddr, quoteAddr, 1, 0);

            await provideLiquidity(provider, amountOfBase, pricePerBase);
        });

        it("should revert with reason=EXPIRED_TX when tx expired", async () => {
            const now = await advanceBlockTime(1);
            await expect(core.togglePause(mid, 0, now)).to.be.revertedWith("OC: EXPIRED_TX");
        });

        it("should revert with reason=ZERO_LIQ when liquidity does not exist", async () => {
            const now = await advanceBlockTime(1);
            await expect(core.togglePause(randomAddressString(), 0, now + 2)).to.be.revertedWith("OC: ZERO_LIQ");
        });

        it("should successfully pause liquidity and unpause", async () => {
            let now = await advanceBlockTime(1);
            await expect(core.connect(provider).togglePause(mid, 0, now + 2))
                .to.emit(core, "TogglePause")
                .withArgs(getAddress(mid), provider.address, 0, true);
            let liq = await core.getLiquidity(mid, provider.address, 0);
            expect(liq.paused).to.be.true;

            now = await advanceBlockTime(1);
            await expect(core.connect(provider).togglePause(mid, 0, now + 2))
                .to.emit(core, "TogglePause")
                .withArgs(getAddress(mid), provider.address, 0, false);
            liq = await core.getLiquidity(mid, provider.address, 0);
            expect(liq.paused).to.be.false;
        });
    });
});
