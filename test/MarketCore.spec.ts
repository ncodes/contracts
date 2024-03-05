import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {MockContract, deployMockContract} from "ethereum-waffle";
import {BigNumber, BigNumberish, constants} from "ethers";
import {getAddress} from "ethers/lib/utils";
import {ethers} from "hardhat";
import {MarketCore, MediatorManager, TOKEN} from "../typechain-types";
import {AddressZero, AssetType, makeMarketID, toBN} from "../utils/utils";
import {initCoreTestSuite} from "./helpers/helpers";

describe("MarketCore", function () {
    let baseAddr: string;
    let quoteAddr: string;
    let randomness: MockContract;
    let mc: MarketCore;
    let deployer: SignerWithAddress;
    let accts: SignerWithAddress[];
    let baseAsset: TOKEN;
    let quoteAsset: TOKEN;
    let mid: string;
    let mediatorMgr: MediatorManager;
    let token: TOKEN;
    let defaultDisputeDelayDur: BigNumber;
    let marketCreator: SignerWithAddress, user2: SignerWithAddress, provider: SignerWithAddress;
    let ticketCancelDur = 100;
    let ticketMatureDur = 100;
    let ticketExpireDur = 100;
    let ticketPauseDur = 100;

    beforeEach(async () => {
        const vars = await initCoreTestSuite();
        accts = vars.accts;
        deployer = accts[0];
        marketCreator = accts[0];
        user2 = accts[1];
        provider = accts[2];

        mc = vars.mc;
        token = vars.token;
        defaultDisputeDelayDur = vars.defaultDisputeDelayDur;

        const Randomness = require("../artifacts/contracts/randomness/Randomness.sol/Randomness.json");
        randomness = await deployMockContract(deployer, Randomness.abi);
        await randomness.mock.randomN.returns(0);

        let factory3 = await ethers.getContractFactory("MediatorManager");
        mediatorMgr = (await factory3.deploy(token.address, mc.address, randomness.address, ticketCancelDur, ticketMatureDur, ticketExpireDur, ticketPauseDur)) as MediatorManager;
        mc.setMediatorManager(mediatorMgr.address);

        const supply = toBN("1000000000000000000000000");
        let dummyTokenFactory = await ethers.getContractFactory("TOKEN");
        baseAsset = (await dummyTokenFactory.deploy("BASE_TOKEN", "BASE_TOKEN", supply, 18)) as TOKEN;
        baseAddr = baseAsset.address;
        quoteAsset = (await dummyTokenFactory.deploy("TEST_TOKEN", "TEST_TOKEN", supply, 18)) as TOKEN;
        quoteAddr = quoteAsset.address;

        mid = makeMarketID(marketCreator.address, baseAddr, quoteAddr, 1, 0);

        await mediatorMgr.updateTicketPool(0, 0, 1, 1, 1, 1, 1, 1, 1, false, false);
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
        mediatePoolId = 0,
    ) {
        const mid = makeMarketID(creator.address, base, quote, baseType, quoteType);
        await mc.connect(creator).createMarket(base, quote, baseType, quoteType, permPut, permSwap, commission, mediatePoolId);
        return Promise.resolve(mid);
    }

    describe(".createMarket & .hasMarket & .getMarket", () => {
        it("should revert with reason=ZERO_BASE when base is zero address", async () => {
            await expect(mc.createMarket(constants.AddressZero, quoteAddr, 0, 1, false, false, 0, 0)).to.be.revertedWith("MC: ZERO_BASE");
        });

        it("should revert with reason=ZERO_QUOTE when quote is zero address", async () => {
            await expect(mc.createMarket(baseAddr, constants.AddressZero, 0, 1, false, false, 0, 0)).to.be.revertedWith("MC: ZERO_QUOTE");
        });

        context("when native address is set", () => {
            it("should revert with reason=BAD_NATIVE_ADDR, base type is native but base address did not match the set native base address", async () => {
                await mc.setNativeAssetAddr(user2.address);
                await expect(mc.createMarket(baseAddr, quoteAddr, AssetType.NATIVE, 1, false, false, 0, 0)).to.be.revertedWith("MC: BAD_NATIVE_ADDR");
            });

            it("should revert with reason=BAD_NATIVE_ADDR, base type is native but base address did not match the set native base address", async () => {
                await mc.setNativeAssetAddr(user2.address);
                await expect(mc.createMarket(user2.address, quoteAddr, AssetType.NATIVE, AssetType.NATIVE, false, false, 0, 0)).to.be.revertedWith("MC: BAD_NATIVE_ADDR");
            });

            it("should not revert with reason=BAD_NATIVE_ADDR, base/quote type is native and match the set native base address", async () => {
                await mc.setNativeAssetAddr(user2.address);
                await expect(mc.createMarket(user2.address, user2.address, AssetType.NATIVE, AssetType.NATIVE, false, false, 0, 0)).not.to.be.revertedWith("MC: BAD_NATIVE_ADDR");
            });
        });

        it("Should create new market if not existing", async function () {
            mid = makeMarketID(marketCreator.address, baseAddr, quoteAddr, 0, 1);
            expect(await mc.hasMarket(mid)).to.be.false;
            expect(mc.createMarket(baseAddr, quoteAddr, 0, 1, true, true, 0, 0))
                .to.emit(mc, "NewMarket")
                .withArgs(getAddress(mid), marketCreator.address, baseAddr, quoteAddr, 0, 1, true, true, 0, 0);
            expect(await mc.hasMarket(mid)).to.be.true;
        });

        it("should revert when market already exists", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 0, 1, false, false, 0, 0);
            await expect(mc.createMarket(baseAddr, quoteAddr, 0, 1, false, false, 0, 0)).to.be.revertedWith("MARKET_EXIST");
        });

        describe("when pool is approve-only", () => {
            it("should revert when market is not approved for the specified pool", async () => {
                await mediatorMgr.updateTicketPool(1, 0, 1, 1, 1, 1, 1, 1, 1, false, true);
                await expect(mc.createMarket(baseAddr, quoteAddr, 0, 1, false, false, 0, 1)).to.be.revertedWith("MC: NOT_APPROVED");
            });

            it("should successfully create market when approved for the specified pool", async () => {
                await mediatorMgr.updateTicketPool(1, 0, 1, 1, 1, 1, 1, 1, 1, false, true);
                mid = makeMarketID(deployer.address, baseAddr, quoteAddr, 0, 1);
                await mediatorMgr.toggleApproveMarket(1, mid);
                await expect(mc.createMarket(baseAddr, quoteAddr, 0, 1, false, false, 0, 1)).to.emit(mc, "NewMarket");
            });
        });
    });

    describe(".setDefaultDisputeDelayDuration", () => {
        beforeEach(async () => {
            mid = await createMarket(deployer, baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0);
        });

        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner of contract", async () => {
            await expect(mc.connect(provider).setDefaultDisputeDelayDuration(1)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should set update default dispute delay time", async () => {
            expect(await mc.defaultDisputeDelayDur()).to.eql(defaultDisputeDelayDur);
            await mc.setDefaultDisputeDelayDuration(2000);
            expect(await mc.defaultDisputeDelayDur()).to.eq(2000);
        });
    });

    describe(".markAsOfferOnly", () => {
        beforeEach(async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
        });

        it("should revert with reason=NOT_OWNER when sender is not owner of market", async () => {
            await expect(mc.connect(provider).markAsOfferOnly(mid)).to.be.revertedWith("MC: NOT_CREATOR");
        });

        it("should revert with reason=MARKET_RENOUNCED when market ownership has been renounced", async () => {
            await mc["renounceOwnership(address)"](mid);
            await expect(mc.markAsOfferOnly(mid)).to.be.revertedWith("MC: MARKET_RENOUNCED");
        });

        it("should enable successfully", async () => {
            let market = await mc.markets(mid);
            expect(market.perms.offerOnly).to.be.false;
            await expect(mc.markAsOfferOnly(mid)).not.to.be.reverted;
            market = await mc.markets(mid);
            expect(market.perms.offerOnly).to.be.true;
        });
    });

    describe(".setNativeAssetAddr", () => {
        it("should revert with reason=NOT_OWNER when sender is not owner of market", async () => {
            await expect(mc.connect(provider).setNativeAssetAddr(mid)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should enable successfully", async () => {
            await expect(mc.setNativeAssetAddr(user2.address)).emit(mc, "UpdatedNativeAssetAddr").withArgs(user2.address);
            expect(await mc.getNativeAssetAddr()).to.eql(user2.address);
        });
    });

    describe(".setDisputeDelayDuration", () => {
        beforeEach(async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
        });

        it("should revert with reason=NOT_OWNER when sender is not owner of market", async () => {
            await expect(mc.connect(provider).setDisputeDelayDuration(mid, 0)).to.be.revertedWith("MC: NOT_CREATOR");
        });

        it("should revert with reason=MARKET_RENOUNCED when market ownership has been renounced", async () => {
            await mc["renounceOwnership(address)"](mid);
            await expect(mc.setDisputeDelayDuration(mid, 1)).to.be.revertedWith("MC: MARKET_RENOUNCED");
        });

        it("should update successfully", async () => {
            await expect(mc.setDisputeDelayDuration(mid, 1)).not.to.be.reverted;
            const market = await mc.markets(mid);
            expect(market.dur.disputeDelayDur).to.eq(1);
        });
    });

    describe(".allowZeroOfferPrice", () => {
        beforeEach(async () => {
            mid = await createMarket(deployer, baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0);
        });

        it("should revert with reason=NOT_CREATOR when sender is not owner of market", async () => {
            await expect(mc.connect(provider).allowZeroOfferPrice(mid)).to.be.revertedWith("MC: NOT_CREATOR");
        });

        it("should revert with reason=MARKET_RENOUNCED when market ownership has been renounced", async () => {
            await mc["renounceOwnership(address)"](mid);
            await expect(mc.allowZeroOfferPrice(mid)).to.be.revertedWith("MC: MARKET_RENOUNCED");
        });

        it("should enable successfully", async () => {
            let market = await mc.markets(mid);
            expect(market.perms.offerOnly).to.be.false;
            await expect(mc.allowZeroOfferPrice(mid)).not.to.be.reverted;
            market = await mc.markets(mid);
            expect(market.perms.allowZeroOfferPrice).to.be.true;
        });
    });

    describe(".setManager", () => {
        beforeEach(async () => {
            mid = await createMarket(deployer, baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0);
        });

        it("should revert with reason=NOT_CREATOR when sender is not owner of market", async () => {
            await expect(mc.connect(provider).setManager(mid, user2.address)).to.be.revertedWith("MC: NOT_CREATOR");
        });

        it("should revert with reason=MARKET_RENOUNCED when market ownership has been renounced", async () => {
            await mc["renounceOwnership(address)"](mid);
            await expect(mc.setManager(mid, user2.address)).to.be.revertedWith("MC: MARKET_RENOUNCED");
        });

        it("should successfully update value", async () => {
            let market = await mc.markets(mid);
            expect(market.manager).to.eql(constants.AddressZero);
            await expect(mc.setManager(mid, user2.address)).not.to.be.reverted;
            market = await mc.markets(mid);
            expect(market.manager).to.eql(user2.address);
        });
    });

    describe(".transferOwnership", () => {
        beforeEach(async () => {
            mid = await createMarket(deployer, baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0);
        });

        it("should revert with reason=NOT_CREATOR when sender is not owner of market", async () => {
            await expect(mc.connect(provider)["transferOwnership(address,address)"](mid, user2.address)).to.be.revertedWith("MC: NOT_CREATOR");
        });

        it("should revert with reason=MARKET_RENOUNCED when market ownership has been renounced", async () => {
            await mc["renounceOwnership(address)"](mid);
            await expect(mc["transferOwnership(address,address)"](mid, user2.address)).to.be.revertedWith("MC: MARKET_RENOUNCED");
        });

        it("should successfully update market creator", async () => {
            let market = await mc.markets(mid);
            expect(market.creator).to.eql(deployer.address);
            await expect(mc["transferOwnership(address,address)"](mid, user2.address)).not.to.be.reverted;
            market = await mc.markets(mid);
            expect(market.creator).to.eql(user2.address);
        });
    });

    describe(".renounceOwnership", () => {
        beforeEach(async () => {
            mid = await createMarket(deployer, baseAddr, quoteAddr, AssetType.ERC20, AssetType.SYNTH, false, false, 0);
        });

        it("should revert with reason=UNKNOWN_MARKET when market is unknown", async () => {
            await expect(mc.connect(provider)["renounceOwnership(address)"](AddressZero)).to.be.revertedWith("MC: UNKNOWN_MARKET");
        });

        it("should revert with reason=NOT_CREATOR when sender is not owner of market", async () => {
            await expect(mc.connect(provider)["renounceOwnership(address)"](mid)).to.be.revertedWith("MC: NOT_CREATOR");
        });

        it("should successfully renounce market", async () => {
            await expect(mc["renounceOwnership(address)"](mid)).not.to.be.reverted;
            expect(await mc.renouncedMarkets(mid)).to.be.true;
        });

        it("should revert with reason=MARKET_RENOUNCED when market ownership has been renounced", async () => {
            await mc["renounceOwnership(address)"](mid);
            await expect(mc["renounceOwnership(address)"](mid)).to.be.revertedWith("MC: MARKET_RENOUNCED");
        });
    });

    describe(".permitPut", () => {
        it("should revert with reason='UNKNOWN_MARKET' when market does not exist", async () => {
            await expect(mc.permitPut(mid, marketCreator.address)).to.be.revertedWith("MC: UNKNOWN_MARKET");
        });

        it("should revert with reason='NOT_OWNER' when sender is not the market creator", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await expect(mc.connect(provider).permitPut(mid, marketCreator.address)).to.be.revertedWith("MC: NOT_CREATOR");
        });

        it("should revert with reason=MARKET_RENOUNCED when market ownership has been renounced", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await mc["renounceOwnership(address)"](mid);
            await expect(mc.allowZeroOfferPrice(mid)).to.be.revertedWith("MC: MARKET_RENOUNCED");
        });

        it("should revert with reason='PERM_OFF' when market PUT permission is off", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await expect(mc.permitPut(mid, marketCreator.address)).to.be.revertedWith("MC: PERM_OFF");
        });

        it("should successfully add address to the permit index", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, true, false, 0, 0);
            const senderAddr = provider.address;
            await expect(mc.permitPut(mid, senderAddr)).not.to.be.reverted;
            expect(await mc.putAllowList(mid, senderAddr)).to.be.true;
        });
    });

    describe(".permitSwap", () => {
        it("should revert with reason='UNKNOWN_MARKET' when market does not exist", async () => {
            await expect(mc.permitSwap(mid, marketCreator.address)).to.be.revertedWith("MC: UNKNOWN_MARKET");
        });

        it("should revert with reason='NOT_OWNER' when sender is not the market creator", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await expect(mc.connect(provider).permitSwap(mid, marketCreator.address)).to.be.revertedWith("MC: NOT_CREATOR");
        });

        it("should revert with reason=MARKET_RENOUNCED when market ownership has been renounced", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await mc["renounceOwnership(address)"](mid);
            await expect(mc.permitSwap(mid, marketCreator.address)).to.be.revertedWith("MC: MARKET_RENOUNCED");
        });

        it("should revert with reason='PERM_OFF' when SWAP perm is off", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await expect(mc.permitSwap(mid, marketCreator.address)).to.be.revertedWith("MC: PERM_OFF");
        });

        it("should successfully add address to the permit index", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, true, true, 0, 0);
            const senderAddr = provider.address;
            await expect(mc.permitSwap(mid, senderAddr)).not.to.be.reverted;
            expect(await mc.swapAllowList(mid, senderAddr)).to.be.true;
        });
    });

    describe(".revokePut", () => {
        it("should revert with reason='UNKNOWN_MARKET' when market does not exist", async () => {
            await expect(mc.revokePut(mid, marketCreator.address)).to.be.revertedWith("MC: UNKNOWN_MARKET");
        });

        it("should revert with reason='NOT_OWNER' when sender is not the market creator", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await expect(mc.connect(provider).revokePut(mid, marketCreator.address)).to.be.revertedWith("MC: NOT_CREATOR");
        });

        it("should revert with reason=MARKET_RENOUNCED when market ownership has been renounced", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, true, false, 0, 0);
            await mc["renounceOwnership(address)"](mid);
            const senderAddr = provider.address;
            await expect(mc.revokePut(mid, senderAddr)).to.be.revertedWith("MC: MARKET_RENOUNCED");
        });

        it("should revert with reason='NOT_ALLOWED' when address was not previously allowed", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, true, false, 0, 0);
            const senderAddr = provider.address;
            await expect(mc.revokePut(mid, senderAddr)).to.be.revertedWith("MC: NOT_ALLOWED");
        });

        it("should successfully remove address from the permit index", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, true, false, 0, 0);
            const senderAddr = provider.address;
            await mc.permitPut(mid, senderAddr);
            expect(await mc.putAllowList(mid, senderAddr)).to.be.true;

            await mc.revokePut(mid, senderAddr);
            expect(await mc.putAllowList(mid, senderAddr)).to.be.false;
        });
    });

    describe(".revokeSwap", () => {
        it("should revert with reason='UNKNOWN_MARKET' when market does not exist", async () => {
            await expect(mc.revokeSwap(mid, marketCreator.address)).to.be.revertedWith("MC: UNKNOWN_MARKET");
        });

        it("should revert with reason='NOT_CREATOR' when sender is not the market creator", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await expect(mc.connect(provider).revokeSwap(mid, marketCreator.address)).to.be.revertedWith("MC: NOT_CREATOR");
        });

        it("should revert with reason=MARKET_RENOUNCED when market ownership has been renounced", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await mc["renounceOwnership(address)"](mid);
            const senderAddr = provider.address;
            await expect(mc.revokeSwap(mid, senderAddr)).to.be.revertedWith("MC: MARKET_RENOUNCED");
        });

        it("should revert with reason='NOT_ALLOWED' when address was not previously allowed", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, true, true, 0, 0);
            const senderAddr = provider.address;
            await expect(mc.revokeSwap(mid, senderAddr)).to.be.revertedWith("MC: NOT_ALLOWED'");
        });

        it("should successfully remove address from the permit index", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, true, true, 0, 0);

            const senderAddr = provider.address;
            await mc.permitSwap(mid, senderAddr);
            expect(await mc.swapAllowList(mid, senderAddr)).to.be.true;

            await mc.revokeSwap(mid, senderAddr);
            expect(await mc.swapAllowList(mid, senderAddr)).to.be.false;
        });
    });

    describe(".setRequiredBadges", function () {
        it("should revert with reason='UNKNOWN_MARKET' when market does not exist", async () => {
            await expect(mc.setRequiredBadges(mid, [], [])).to.be.revertedWith("MC: UNKNOWN_MARKET");
        });

        it("should revert with reason='NOT_CREATOR' when sender is not owner of market", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await expect(mc.connect(provider).setRequiredBadges(mid, [], [])).to.be.revertedWith("MC: NOT_CREATOR");
        });

        it("should revert with reason=MARKET_RENOUNCED when market ownership has been renounced", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await mc["renounceOwnership(address)"](mid);
            await expect(mc.setRequiredBadges(mid, [], [])).to.be.revertedWith("MC: MARKET_RENOUNCED");
        });

        it("should revert with reason='*_TOO_MANY' if badge size exceeds 8", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            const val: [string, string][] = [
                ["badge", "path"],
                ["badge", "path"],
                ["badge", "path"],
                ["badge", "path"],
                ["badge", "path"],
                ["badge", "path"],
                ["badge", "path"],
                ["badge", "path"],
                ["badge", "path"],
            ];
            await expect(mc.setRequiredBadges(mid, val, [])).to.be.revertedWith("MC: PUT_TOO_MANY");
            await expect(mc.setRequiredBadges(mid, [], val)).to.be.revertedWith("MC: SWAP_TOO_MANY");
        });

        it("should successfully set badges", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await expect(mc.setRequiredBadges(mid, [["badge", "path"]], [["badge2", "path2"]])).emit(mc, "UpdatedMarketBadges");
            expect(await mc.getReqBadges(mid)).to.eql([[["badge", "path"]], [["badge2", "path2"]]]);
        });
    });

    describe(".isPutPermitted", () => {
        beforeEach(async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, true, false, 0, 0);
        });

        it("should revert with reason=MC: NO_PUT_PERM when not permitted", async () => {
            await expect(mc.isPutPermitted(mid, user2.address)).to.be.revertedWith("MC: NO_PUT_PERM");
        });

        it("should return true when permitted", async () => {
            await mc.permitPut(mid, user2.address);
            expect(await mc.isPutPermitted(mid, user2.address)).to.be.true;
        });
    });

    describe(".isSwapPermitted", () => {
        beforeEach(async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, true, true, 0, 0);
        });

        it("should revert with reason=MC: NO_SWAP_PERM when not permitted", async () => {
            await expect(mc.isSwapPermitted(mid, user2.address)).to.be.revertedWith("MC: NO_SWAP_PERM");
        });

        it("should return true when permitted", async () => {
            await mc.permitSwap(mid, user2.address);
            expect(await mc.isSwapPermitted(mid, user2.address)).to.be.true;
        });
    });

    describe(".setCommission", () => {
        it("should revert with reason=UNKNOWN_MARKET when market is unknown", async () => {
            await expect(mc.setCommission(mid, 10001)).to.be.revertedWith("MC: UNKNOWN_MARKET");
        });

        it("should revert with reason=NOT_CREATOR when sender is not the owner of the market", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await expect(mc.connect(provider).setCommission(mid, 10001)).to.be.revertedWith("MC: NOT_CREATOR");
        });

        it("should revert with reason=MARKET_RENOUNCED when market ownership has been renounced", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, false, 0, 0);
            await mc["renounceOwnership(address)"](mid);
            await expect(mc.setCommission(mid, 10001)).to.be.revertedWith("MC: MARKET_RENOUNCED");
        });

        it("should revert with reason= MC: INVALID when commission is greater than 10000", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, true, 0, 0);
            await expect(mc.setCommission(mid, 10001)).to.be.revertedWith("MC: INVALID");
        });

        it("should successfully set commission", async () => {
            await mc.createMarket(baseAddr, quoteAddr, 1, 0, false, true, 0, 0);
            let market = await mc.markets(mid);
            expect(market.commission.toNumber()).to.equal(0);

            await mc.setCommission(mid, 156);
            market = await mc.markets(mid);
            expect(market.commission.toNumber()).to.equal(156);
        });
    });
});
