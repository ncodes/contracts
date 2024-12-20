import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {BigNumber, BigNumberish} from "ethers";
import {ethers} from "hardhat";
import {it} from "mocha";
import {Core, MarketCore, ProviderRegistry, Router, TOKEN} from "../typechain-types";
import {StructsLib} from "../typechain-types/Core";
import {AddressZero, advanceBlockTime, AssetType, makeMarketID, powOf, toBN} from "../utils/utils";
import {initCoreTestSuite} from "./helpers/helpers";

describe("Router", function () {
    let core: Core;
    let mc: MarketCore;
    let provReg: ProviderRegistry;
    let router: Router;
    let deployer: SignerWithAddress, user: SignerWithAddress, user2: SignerWithAddress, user3: SignerWithAddress, user4: SignerWithAddress;
    let accts: SignerWithAddress[];
    let mid: string, mid2: string, mid3: string;
    let tokenA_addr: string;
    let tokenB_addr: string;
    let tokenC_addr: string;
    let tokenD_addr: string;
    let tokenA: TOKEN;
    let tokenB: TOKEN;
    let tokenC: TOKEN;
    let tokenD: TOKEN;
    let supply: BigNumber;

    beforeEach(async () => {
        const vars = await initCoreTestSuite();
        accts = await ethers.getSigners();
        deployer = accts[0];
        user = accts[1];
        user2 = accts[2];
        user3 = accts[3];
        user4 = accts[4];

        mc = vars.mc;
        core = vars.core;
        provReg = vars.provReg;
        tokenA_addr = vars.baseAddr;
        tokenB_addr = vars.quoteAddr;
        tokenA = vars.baseAsset;
        tokenB = vars.quoteAsset;
        supply = vars.supply;

        let factory = await ethers.getContractFactory("Router");
        router = (await factory.deploy(core.address, provReg.address)) as Router;

        factory = await ethers.getContractFactory("TOKEN");
        tokenC = (await factory.deploy("BASE_TOKEN2", "BASE_TOKEN2", supply, 18)) as TOKEN;
        tokenC_addr = tokenC.address;
        tokenD = (await factory.deploy("QUOTE_TOKEN2", "QUOTE_TOKEN2", supply, 18)) as TOKEN;
        tokenD_addr = tokenD.address;
    });

    async function createMarket(creator: SignerWithAddress = deployer, base: string, quote: string, baseType: number, quoteType: number, permPut: boolean, permSwap: boolean, commission: BigNumberish, mediatorPoolId: BigNumberish) {
        const mid = makeMarketID(creator.address, base, quote, baseType, quoteType);
        await mc.connect(creator).createMarket(base, quote, baseType, quoteType, permPut, permSwap, commission, mediatorPoolId);
        return Promise.resolve(mid);
    }

    describe(".setCore", () => {
        it('should revert with msg="OWNABLE: NOT_OWNER" when sender is not owner', async () => {
            await expect(router.connect(user).setCore(provReg.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully set core", async () => {
            await expect(router.setCore(user.address)).not.to.be.reverted;
            expect(await router.core()).to.eql(user.address);
        });
    });

    describe(".setProviderRegistry", () => {
        it('should revert with msg="OWNABLE: NOT_OWNER" when sender is not owner', async () => {
            await expect(router.connect(user).setProviderRegistry(provReg.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully set provider registry", async () => {
            await expect(router.setProviderRegistry(user.address)).not.to.be.reverted;
            expect(await router.provReg()).to.eql(user.address);
        });
    });

    describe(".route", () => {
        it("should revert with msg='MC: NO_ROUTES' when no routes are provided", async () => {
            await expect(router.route({routes: [], target: AddressZero, deadline: 0, operator: 0})).to.be.revertedWith("ROUTER: NO_ROUTES");
        });

        it("should revert with msg='MC: UNKNOWN_MARKET' when market does not exist", async () => {
            await expect(
                router.route({
                    routes: [{market: AddressZero, liqs: []}],
                    target: AddressZero,
                    deadline: 0,
                    operator: 0,
                }),
            ).to.be.revertedWith("MC: UNKNOWN_MARKET");
        });

        it("should revert with msg='ROUTER: INV_PAIR' when market is not an ERC20/ERC20 or ERC20/NATIVE pair", async () => {
            mid = await createMarket(undefined, tokenA_addr, tokenB_addr, AssetType.ERC20, AssetType.ERC721, false, false, 0, 0);
            await expect(router.route({routes: [{market: mid, liqs: []}], target: AddressZero, deadline: 0, operator: 0})).to.be.revertedWith("ROUTER: INV_PAIR");
        });

        it("should revert with msg='ROUTER: NO_LIQ' when no liquidity is provided", async () => {
            await core.setProtoFee(1000, 0, 0, 0, 0, 0);
            mid = await createMarket(undefined, tokenA_addr, tokenB_addr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            await expect(router.route({routes: [{market: mid, liqs: []}], target: AddressZero, deadline: 0, operator: 0})).to.be.revertedWith("ROUTER: NO_LIQ");
        });

        it("should revert with msg='ROUTER: UNKNOWN_PROVIDER' when provider does not exist", async () => {
            await core.setProtoFee(1000, 0, 0, 0, 0, 0);
            mid = await createMarket(undefined, tokenA_addr, tokenB_addr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
            await expect(
                router.route({
                    routes: [{market: mid, liqs: [{provider: 1, lid: 0, amount: powOf(100), maxPrice: powOf(10)}]}],
                    target: AddressZero,
                    deadline: 0,
                    operator: 0,
                }),
            ).to.be.revertedWith("ROUTER: UNKNOWN_PROVIDER");
        });

        describe("with one route (ERC20/ERC20)", () => {
            let baseLiqParams: StructsLib.UpdateFungibleLiquidityParamsStruct = {
                marketId: "",
                target: "",
                lid: "",
                amount: "",
                price: "",
                timeToPay: "",
                expireAt: "",
                pause: false,
                wantOrIds: [],
                wantAndIds: [],
                deduct: false,
                usePriceFromRegistry: false,
                priceScaleBps: 0,
            };

            beforeEach(async () => {
                await core.setProtoFee(1000, 0, 0, 0, 0, 0);
                mid = await createMarket(undefined, tokenA_addr, tokenB_addr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                baseLiqParams = {
                    marketId: mid,
                    target: AddressZero,
                    lid: 0,
                    amount: powOf(100),
                    price: powOf(10),
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

            it("should revert with msg='ERC20: insufficient allowance' when insufficient quote allowance", async () => {
                const userLiq = powOf(100);

                // approve
                await tokenA.approve(core.address, userLiq);

                // add liquidity
                await expect(core.updateFungibleLiquidity(baseLiqParams)).not.to.be.reverted;

                await expect(
                    router.route({
                        routes: [
                            {
                                market: mid,
                                liqs: [{provider: 1, lid: 0, amount: powOf(100), maxPrice: powOf(10)}],
                            },
                        ],
                        target: AddressZero,
                        deadline: 0,
                        operator: 0,
                    }),
                ).to.be.revertedWith("ERC20: insufficient allowance");
            });

            it("should successfully route", async () => {
                const userLiq = powOf(100);
                const user1Liq = powOf(100);
                const user2Liq = powOf(100);

                // transfer liquidity
                await tokenA.transfer(user.address, user1Liq);
                await tokenA.transfer(user2.address, user2Liq);

                // approve
                await tokenA.approve(core.address, userLiq);
                await tokenA.connect(user).approve(core.address, user1Liq);
                await tokenA.connect(user2).approve(core.address, user2Liq);

                // add liquidity
                await expect(core.updateFungibleLiquidity(baseLiqParams)).not.to.be.reverted;
                await expect(core.connect(user).updateFungibleLiquidity({...baseLiqParams, amount: user1Liq})).not.to.be.reverted;
                await expect(core.connect(user2).updateFungibleLiquidity({...baseLiqParams, amount: user2Liq})).not.to.be.reverted;

                // approve router to spend total quote asset
                await tokenB.approve(router.address, powOf(1150));

                const beforeBaseBal = await tokenA.balanceOf(deployer.address);
                await expect(
                    router.route({
                        routes: [
                            {
                                market: mid,
                                liqs: [
                                    {provider: 1, lid: 0, amount: powOf(100), maxPrice: powOf(10)},
                                    {provider: 2, lid: 0, amount: powOf(10), maxPrice: powOf(10)},
                                    {provider: 3, lid: 0, amount: powOf(5), maxPrice: powOf(10)},
                                ],
                            },
                        ],
                        target: AddressZero,
                        deadline: 0,
                        operator: 0,
                    }),
                )
                    .to.emit(router, "Routed")
                    .withArgs(deployer.address, AddressZero, 0, 1);

                expect(await tokenA.balanceOf(router.address)).to.eq(0);
                expect(await tokenB.balanceOf(router.address)).to.eq(0);
                expect(await tokenA.balanceOf(deployer.address)).to.eq(beforeBaseBal.add(powOf(103.5)));
            });
        });

        describe("with multiple routes (ERC20/ERC20)", () => {
            let params: StructsLib.UpdateFungibleLiquidityParamsStruct = {
                marketId: "",
                target: "",
                lid: 0,
                amount: "",
                price: "",
                timeToPay: "",
                expireAt: 0,
                pause: false,
                wantOrIds: [],
                wantAndIds: [],
                deduct: false,
                usePriceFromRegistry: false,
                priceScaleBps: 0,
            };

            beforeEach(async () => {
                params = {
                    marketId: "",
                    target: AddressZero,
                    lid: 0,
                    amount: "",
                    price: "",
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

            it("should successfully route", async () => {
                await core.setProtoFee(1000, 0, 0, 0, 0, 0);
                mid = await createMarket(undefined, tokenA_addr, tokenB_addr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                mid2 = await createMarket(undefined, tokenC_addr, tokenA_addr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                mid3 = await createMarket(undefined, tokenD_addr, tokenC_addr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);

                // Market 1
                const userLiq = powOf(100);
                const user1Liq = powOf(100);
                const user2Liq = powOf(100);
                await tokenA.transfer(user.address, user1Liq);
                await tokenA.transfer(user2.address, user2Liq);
                await tokenA.approve(core.address, userLiq);
                await tokenA.connect(user).approve(core.address, user1Liq);
                await tokenA.connect(user2).approve(core.address, user2Liq);
                await expect(
                    core.updateFungibleLiquidity({
                        ...params,
                        marketId: mid,
                        amount: userLiq,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user).updateFungibleLiquidity({
                        ...params,
                        marketId: mid,
                        amount: user1Liq,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user2).updateFungibleLiquidity({
                        ...params,
                        marketId: mid,
                        amount: user2Liq,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;

                // Market 2
                const userLiq2 = powOf(100);
                const user1Liq2 = powOf(100);
                const user2Liq2 = powOf(100);
                await tokenC.transfer(user.address, user1Liq2);
                await tokenC.transfer(user2.address, user2Liq2);
                await tokenC.approve(core.address, userLiq2);
                await tokenC.connect(user).approve(core.address, user1Liq2);
                await tokenC.connect(user2).approve(core.address, user2Liq2);
                await expect(
                    core.updateFungibleLiquidity({
                        ...params,
                        marketId: mid2,
                        amount: userLiq2,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user).updateFungibleLiquidity({
                        ...params,
                        marketId: mid2,
                        amount: user1Liq2,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user2).updateFungibleLiquidity({
                        ...params,
                        marketId: mid2,
                        amount: user2Liq2,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;

                // Market 3
                const userLiq3 = powOf(100);
                const user1Liq3 = powOf(100);
                const user2Liq3 = powOf(100);
                await tokenD.transfer(user.address, user1Liq3);
                await tokenD.transfer(user2.address, user2Liq3);
                await tokenD.approve(core.address, userLiq3);
                await tokenD.connect(user).approve(core.address, user1Liq3);
                await tokenD.connect(user2).approve(core.address, user2Liq3);
                await expect(
                    core.updateFungibleLiquidity({
                        ...params,
                        marketId: mid3,
                        amount: userLiq3,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user).updateFungibleLiquidity({
                        ...params,
                        marketId: mid3,
                        amount: user1Liq3,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user2).updateFungibleLiquidity({
                        ...params,
                        marketId: mid3,
                        amount: user2Liq3,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;

                // approve router to spend total quote asset
                await tokenB.transfer(user3.address, powOf(1150));
                await tokenB.connect(user3).approve(router.address, powOf(1150));

                const beforeTokenABal = await tokenA.balanceOf(user3.address);
                await expect(
                    router.connect(user3).route({
                        routes: [
                            {
                                market: mid,
                                liqs: [
                                    {provider: 1, lid: 0, amount: powOf(100), maxPrice: powOf(10)},
                                    {provider: 2, lid: 0, amount: powOf(10), maxPrice: powOf(10)},
                                    {provider: 3, lid: 0, amount: powOf(5), maxPrice: powOf(10)},
                                ],
                            },
                            {
                                market: mid2,
                                liqs: [
                                    {provider: 1, lid: 0, amount: powOf(5), maxPrice: powOf(10)},
                                    {provider: 2, lid: 0, amount: powOf(3), maxPrice: powOf(10)},
                                    {provider: 3, lid: 0, amount: powOf(2.35), maxPrice: powOf(10)},
                                ],
                            },
                            {
                                market: mid3,
                                liqs: [{provider: 1, lid: 0, amount: powOf(0.9315), maxPrice: powOf(10)}],
                            },
                        ],
                        target: AddressZero,
                        deadline: 0,
                        operator: 0,
                    }),
                ).not.to.be.reverted;

                expect(await tokenA.balanceOf(router.address)).to.eq(0);
                expect(await tokenB.balanceOf(router.address)).to.eq(0);
                expect(await tokenC.balanceOf(router.address)).to.eq(0);
                expect(await tokenD.balanceOf(router.address)).to.eq(0);
                expect(await tokenA.balanceOf(user3.address)).to.eq(beforeTokenABal);
                expect(await tokenB.balanceOf(user3.address)).to.eq(0);
                expect(await tokenC.balanceOf(user3.address)).to.eq(0);
                expect(await tokenD.balanceOf(user3.address)).to.eq(powOf(0.83835));
            });

            it("should successfully route and return excess base or quote assets", async () => {
                await core.setProtoFee(1000, 0, 0, 0, 0, 0);
                mid = await createMarket(undefined, tokenA_addr, tokenB_addr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                mid2 = await createMarket(undefined, tokenC_addr, tokenA_addr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);

                // Market 1
                const userLiq = powOf(100);
                const user1Liq = powOf(100);
                const user2Liq = powOf(100);
                await tokenA.transfer(user.address, user1Liq);
                await tokenA.transfer(user2.address, user2Liq);
                await tokenA.approve(core.address, userLiq);
                await tokenA.connect(user).approve(core.address, user1Liq);
                await tokenA.connect(user2).approve(core.address, user2Liq);
                await expect(
                    core.updateFungibleLiquidity({
                        ...params,
                        marketId: mid,
                        amount: userLiq,
                        price: powOf(5),
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user).updateFungibleLiquidity({
                        ...params,
                        marketId: mid,
                        amount: user1Liq,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user2).updateFungibleLiquidity({
                        ...params,
                        marketId: mid,
                        amount: user2Liq,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;

                // Market 2
                const userLiq2 = powOf(100);
                const user1Liq2 = powOf(100);
                const user2Liq2 = powOf(100);
                await tokenC.transfer(user.address, user1Liq2);
                await tokenC.transfer(user2.address, user2Liq2);
                await tokenC.approve(core.address, userLiq2);
                await tokenC.connect(user).approve(core.address, user1Liq2);
                await tokenC.connect(user2).approve(core.address, user2Liq2);
                await expect(
                    core.updateFungibleLiquidity({
                        ...params,
                        marketId: mid2,
                        amount: userLiq2,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user).updateFungibleLiquidity({
                        ...params,
                        marketId: mid2,
                        amount: user1Liq2,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user2).updateFungibleLiquidity({
                        ...params,
                        marketId: mid2,
                        amount: user2Liq2,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;

                // approve router to spend total quote asset
                await tokenB.transfer(user3.address, powOf(1150));
                await tokenB.connect(user3).approve(router.address, powOf(1150));

                const beforeTokenABal = await tokenA.balanceOf(user3.address);
                await expect(
                    router.connect(user3).route({
                        routes: [
                            {
                                market: mid,
                                liqs: [
                                    {provider: 1, lid: 0, amount: powOf(100), maxPrice: powOf(10)}, // actual liquiidyt price = 5
                                    {provider: 2, lid: 0, amount: powOf(10), maxPrice: powOf(10)},
                                    {provider: 3, lid: 0, amount: powOf(5), maxPrice: powOf(10)},
                                ],
                            },
                            {
                                market: mid2,
                                liqs: [
                                    {provider: 1, lid: 0, amount: powOf(5), maxPrice: powOf(10)},
                                    {provider: 2, lid: 0, amount: powOf(3), maxPrice: powOf(10)},
                                    {provider: 3, lid: 0, amount: powOf(2), maxPrice: powOf(10)},
                                ],
                            },
                        ],
                        target: AddressZero,
                        deadline: 0,
                        operator: 0,
                    }),
                ).not.to.be.reverted;

                expect(await tokenA.balanceOf(router.address)).to.eq(0);
                expect(await tokenB.balanceOf(router.address)).to.eq(0);
                expect(await tokenC.balanceOf(router.address)).to.eq(0);
                expect(await tokenB.balanceOf(user3.address)).to.eq(powOf(500));
                expect(await tokenA.balanceOf(user3.address)).to.eq(beforeTokenABal.add(powOf(3.5)));
                expect(await tokenC.balanceOf(user3.address)).to.eq(powOf(9));
            });
        });

        describe("with one route (ERC20/NATIVE)", () => {
            let updateLiquidityParams: any;

            beforeEach(async () => {
                updateLiquidityParams = {
                    target: AddressZero,
                    lid: 0,
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

            it("should revert with msg= when quote transferred is insufficient", async () => {
                await core.setProtoFee(1000, 0, 0, 0, 0, 0);
                mid = await createMarket(undefined, tokenA_addr, tokenB_addr, AssetType.ERC20, AssetType.NATIVE, false, false, 0, 0);

                const userLiq = powOf(100);
                const user1Liq = powOf(100);
                const user2Liq = powOf(100);

                // transfer liquidity
                await tokenA.transfer(user.address, user1Liq);
                await tokenA.transfer(user2.address, user2Liq);

                // approve
                await tokenA.approve(core.address, userLiq);
                await tokenA.connect(user).approve(core.address, user1Liq);
                await tokenA.connect(user2).approve(core.address, user2Liq);

                // add liquidity
                await expect(
                    core.updateFungibleLiquidity({
                        ...updateLiquidityParams,
                        marketId: mid,
                        amount: userLiq,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user).updateFungibleLiquidity({
                        ...updateLiquidityParams,
                        marketId: mid,
                        amount: user1Liq,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user2).updateFungibleLiquidity({
                        ...updateLiquidityParams,
                        marketId: mid,
                        amount: user2Liq,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;

                const routes = [
                    {
                        market: mid,
                        liqs: [
                            {provider: 1, lid: 0, amount: powOf(100), maxPrice: powOf(10)},
                            {provider: 2, lid: 0, amount: powOf(10), maxPrice: powOf(10)},
                            {provider: 3, lid: 0, amount: powOf(5), maxPrice: powOf(10)},
                        ],
                    },
                ];

                await expect(router.route({routes, target: AddressZero, deadline: 0, operator: 0}, {value: powOf(100)})).to.be.revertedWith("ROUTER: INSUFFICIENT_BALANCE");

                await expect(router.route({routes, target: AddressZero, deadline: 0, operator: 0}, {value: powOf(1000)})).to.be.revertedWith("ROUTER: INSUFFICIENT_BALANCE");

                await expect(router.route({routes, target: AddressZero, deadline: 0, operator: 0}, {value: powOf(1100)})).to.be.revertedWith("ROUTER: INSUFFICIENT_BALANCE");
            });

            it("should successfully route", async () => {
                await core.setProtoFee(1000, 0, 0, 0, 0, 0);
                mid = await createMarket(undefined, tokenA_addr, tokenB_addr, AssetType.ERC20, AssetType.NATIVE, false, false, 0, 0);

                const userLiq = powOf(100);
                const user1Liq = powOf(100);
                const user2Liq = powOf(100);

                // transfer liquidity
                await tokenA.transfer(user.address, user1Liq);
                await tokenA.transfer(user2.address, user2Liq);

                // approve
                await tokenA.approve(core.address, userLiq);
                await tokenA.connect(user).approve(core.address, user1Liq);
                await tokenA.connect(user2).approve(core.address, user2Liq);

                // add liquidity
                await expect(
                    core.updateFungibleLiquidity({
                        ...updateLiquidityParams,
                        marketId: mid,
                        amount: userLiq,
                        price: powOf(5),
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user).updateFungibleLiquidity({
                        ...updateLiquidityParams,
                        marketId: mid,
                        amount: user1Liq,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user2).updateFungibleLiquidity({
                        ...updateLiquidityParams,
                        marketId: mid,
                        amount: user2Liq,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;

                const beforeBaseBal = await tokenA.balanceOf(deployer.address);
                await expect(
                    router.route(
                        {
                            routes: [
                                {
                                    market: mid,
                                    liqs: [
                                        {provider: 1, lid: 0, amount: powOf(100), maxPrice: powOf(10)},
                                        {provider: 2, lid: 0, amount: powOf(10), maxPrice: powOf(10)},
                                        {provider: 3, lid: 0, amount: powOf(5), maxPrice: powOf(10)},
                                    ],
                                },
                            ],
                            target: AddressZero,
                            deadline: 0,
                            operator: 0,
                        },
                        {value: powOf(1150)},
                    ),
                ).not.to.be.reverted;

                expect(await tokenA.balanceOf(router.address)).to.eq(0);
                expect(await ethers.provider.getBalance(router.address)).to.eq(0);
                expect(await tokenA.balanceOf(deployer.address)).to.eq(beforeBaseBal.add(powOf(103.5)));
            });

            it("should return excess native quote asset", async () => {
                await core.setProtoFee(1000, 0, 0, 0, 0, 0);
                mid = await createMarket(undefined, tokenA_addr, tokenB_addr, AssetType.ERC20, AssetType.NATIVE, false, false, 0, 0);

                const userLiq = powOf(100);
                const user1Liq = powOf(100);
                const user2Liq = powOf(100);

                // transfer liquidity
                await tokenA.transfer(user.address, user1Liq);
                await tokenA.transfer(user2.address, user2Liq);

                // approve
                await tokenA.approve(core.address, userLiq);
                await tokenA.connect(user).approve(core.address, user1Liq);
                await tokenA.connect(user2).approve(core.address, user2Liq);

                // add liquidity
                await expect(
                    core.updateFungibleLiquidity({
                        ...updateLiquidityParams,
                        marketId: mid,
                        amount: userLiq,
                        price: powOf(5),
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user).updateFungibleLiquidity({
                        ...updateLiquidityParams,
                        marketId: mid,
                        amount: user1Liq,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user2).updateFungibleLiquidity({
                        ...updateLiquidityParams,
                        marketId: mid,
                        amount: user2Liq,
                        price: powOf(10),
                    }),
                ).not.to.be.reverted;

                const beforeBaseBal = await tokenA.balanceOf(user3.address);
                const beforeQuoteBal = await ethers.provider.getBalance(user3.address);
                const tx = await router.connect(user3).route(
                    {
                        routes: [
                            {
                                market: mid,
                                liqs: [
                                    {provider: 1, lid: 0, amount: powOf(100), maxPrice: powOf(10)},
                                    {provider: 2, lid: 0, amount: powOf(10), maxPrice: powOf(10)},
                                    {provider: 3, lid: 0, amount: powOf(5), maxPrice: powOf(10)},
                                ],
                            },
                        ],
                        target: AddressZero,
                        deadline: 0,
                        operator: 0,
                    },
                    {value: powOf(1150)},
                );

                const txReceipt = await tx.wait();
                const gasUsed = txReceipt.gasUsed.toNumber();
                const gasFee = toBN(gasUsed).mul(tx.gasPrice as BigNumber);

                expect(await tokenA.balanceOf(router.address)).to.eq(0);
                expect(await ethers.provider.getBalance(router.address)).to.eq(0);
                expect(await tokenA.balanceOf(user3.address)).to.eq(beforeBaseBal.add(powOf(103.5)));
                expect(await ethers.provider.getBalance(user3.address)).to.eq(beforeQuoteBal.sub(powOf(650)).sub(gasFee));
            });
        });

        describe("with multiple route (ERC20/NATIVE)", () => {
            let commonLiquidityParams: any;

            beforeEach(async () => {
                commonLiquidityParams = {
                    target: AddressZero,
                    lid: 0,
                    price: powOf(10),
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

            it("should successfully route", async () => {
                await core.setProtoFee(1000, 0, 0, 0, 0, 0);
                mid = await createMarket(undefined, tokenA_addr, tokenB_addr, AssetType.ERC20, AssetType.NATIVE, false, false, 0, 0);
                mid2 = await createMarket(undefined, tokenC_addr, tokenA_addr, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
                mid3 = await createMarket(undefined, tokenD_addr, tokenC_addr, AssetType.ERC20, AssetType.NATIVE, false, false, 0, 0);

                // Market 1
                const userLiq = powOf(100);
                const user1Liq = powOf(100);
                const user2Liq = powOf(100);
                await tokenA.transfer(user.address, user1Liq);
                await tokenA.transfer(user2.address, user2Liq);
                await tokenA.transfer(user2.address, user2Liq);
                await tokenA.approve(core.address, userLiq);
                await tokenA.connect(user).approve(core.address, user1Liq);
                await tokenA.connect(user2).approve(core.address, user2Liq);
                await expect(
                    core.updateFungibleLiquidity({
                        ...commonLiquidityParams,
                        marketId: mid,
                        amount: userLiq,
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user).updateFungibleLiquidity({
                        ...commonLiquidityParams,
                        marketId: mid,
                        amount: user1Liq,
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user2).updateFungibleLiquidity({
                        ...commonLiquidityParams,
                        marketId: mid,
                        amount: user2Liq,
                    }),
                ).not.to.be.reverted;

                // Market 2
                const userLiq2 = powOf(100);
                const user1Liq2 = powOf(100);
                await expect(
                    core.updateFungibleLiquidity(
                        {
                            ...commonLiquidityParams,
                            marketId: mid2,
                            amount: userLiq2,
                        },
                        {value: userLiq2},
                    ),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user).updateFungibleLiquidity(
                        {
                            ...commonLiquidityParams,
                            marketId: mid2,
                            amount: user1Liq2,
                        },
                        {value: user1Liq2},
                    ),
                ).not.to.be.reverted;

                // Market 3
                const userLiq3 = powOf(100);
                const user1Liq3 = powOf(100);
                await tokenD.transfer(user.address, user1Liq3);
                await tokenD.approve(core.address, userLiq3);
                await tokenD.connect(user).approve(core.address, user1Liq3);
                await expect(
                    core.updateFungibleLiquidity({
                        ...commonLiquidityParams,
                        marketId: mid3,
                        amount: userLiq3,
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user).updateFungibleLiquidity({
                        ...commonLiquidityParams,
                        marketId: mid3,
                        amount: user1Liq3,
                    }),
                ).not.to.be.reverted;

                const beforeBaseBal = await tokenA.balanceOf(user3.address);
                await expect(
                    router.connect(user3).route(
                        {
                            routes: [
                                {
                                    market: mid,
                                    liqs: [
                                        {provider: 1, lid: 0, amount: powOf(100), maxPrice: powOf(10)},
                                        {provider: 2, lid: 0, amount: powOf(10), maxPrice: powOf(10)},
                                        {provider: 3, lid: 0, amount: powOf(5), maxPrice: powOf(10)},
                                    ],
                                },
                                {
                                    market: mid2,
                                    liqs: [
                                        {provider: 1, lid: 0, amount: powOf(5), maxPrice: powOf(10)},
                                        {provider: 2, lid: 0, amount: powOf(5), maxPrice: powOf(10)},
                                    ],
                                },
                                {
                                    market: mid3,
                                    liqs: [
                                        {provider: 1, lid: 0, amount: powOf(0.45), maxPrice: powOf(10)},
                                        {provider: 2, lid: 0, amount: powOf(0.45), maxPrice: powOf(10)},
                                    ],
                                },
                            ],
                            target: AddressZero,
                            deadline: 0,
                            operator: 0,
                        },
                        {value: powOf(1150)},
                    ),
                ).not.to.be.reverted;

                expect(await tokenA.balanceOf(router.address)).to.eq(0);
                expect(await ethers.provider.getBalance(router.address)).to.eq(0);
                expect(await tokenD.balanceOf(router.address)).to.eq(0);
                expect(await tokenA.balanceOf(user3.address)).to.eq(beforeBaseBal.add(powOf(3.5)));
                expect(await tokenD.balanceOf(user3.address)).to.eq(powOf(0.81));
            });
        });

        describe("with one route (NATIVE/ERC20)", () => {
            let commonUpdateParams: any;

            beforeEach(async () => {
                await core.setProtoFee(1000, 0, 0, 0, 0, 0);
                mid = await createMarket(undefined, tokenA_addr, tokenB_addr, AssetType.NATIVE, AssetType.ERC20, false, false, 0, 0);
                commonUpdateParams = {
                    marketId: mid,
                    target: AddressZero,
                    lid: 0,
                    price: powOf(10),
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

            it("should successfully route", async () => {
                const userLiq = powOf(100);
                const user1Liq = powOf(100);
                const user2Liq = powOf(100);

                // add liquidity
                await expect(core.updateFungibleLiquidity({...commonUpdateParams, amount: userLiq}, {value: userLiq})).not.to.be.reverted;
                await expect(core.connect(user).updateFungibleLiquidity({...commonUpdateParams, amount: user1Liq}, {value: user1Liq})).not.to.be.reverted;
                await expect(core.connect(user2).updateFungibleLiquidity({...commonUpdateParams, amount: user2Liq}, {value: user2Liq})).not.to.be.reverted;

                // approve router to spend total quote asset
                await tokenB.approve(router.address, powOf(1150));

                const beforeBaseBal = await ethers.provider.getBalance(deployer.address);
                const tx = await router.route({
                    routes: [
                        {
                            market: mid,
                            liqs: [
                                {provider: 1, lid: 0, amount: powOf(100), maxPrice: powOf(10)},
                                {provider: 2, lid: 0, amount: powOf(10), maxPrice: powOf(10)},
                                {provider: 3, lid: 0, amount: powOf(5), maxPrice: powOf(10)},
                            ],
                        },
                    ],
                    target: AddressZero,
                    deadline: 0,
                    operator: 0,
                });

                const txReceipt = await tx.wait();
                const gasUsed = txReceipt.gasUsed.toNumber();
                const gasFee = toBN(gasUsed).mul(tx.gasPrice as BigNumber);

                expect(await ethers.provider.getBalance(router.address)).to.eq(0);
                expect(await tokenB.balanceOf(router.address)).to.eq(0);
                expect(await ethers.provider.getBalance(deployer.address)).to.eq(beforeBaseBal.add(powOf(103.5).sub(gasFee)));
            });
        });

        describe("with one route (NATIVE/NATIVE)", () => {
            let commonLiquidityParams: any;

            beforeEach(async () => {
                await core.setProtoFee(1000, 0, 0, 0, 0, 0);
                mid = await createMarket(undefined, tokenA_addr, tokenB_addr, AssetType.NATIVE, AssetType.NATIVE, false, false, 0, 0);

                commonLiquidityParams = {
                    marketId: mid,
                    target: AddressZero,
                    lid: 0,
                    price: powOf(10),
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

            it("should successfully route", async () => {
                const userLiq = powOf(100);
                const user1Liq = powOf(100);
                const user2Liq = powOf(100);

                // add liquidity
                await expect(core.updateFungibleLiquidity({...commonLiquidityParams, amount: userLiq}, {value: userLiq})).not.to.be.reverted;

                await expect(core.connect(user).updateFungibleLiquidity({...commonLiquidityParams, amount: user1Liq}, {value: user1Liq})).not.to.be.reverted;

                await expect(core.connect(user2).updateFungibleLiquidity({...commonLiquidityParams, amount: user2Liq}, {value: user2Liq})).not.to.be.reverted;

                const beforeBaseBal = await ethers.provider.getBalance(user3.address);
                const tx = await router.connect(user3).route(
                    {
                        routes: [
                            {
                                market: mid,
                                liqs: [
                                    {provider: 1, lid: 0, amount: powOf(100), maxPrice: powOf(10)},
                                    {provider: 2, lid: 0, amount: powOf(10), maxPrice: powOf(10)},
                                    {provider: 3, lid: 0, amount: powOf(5), maxPrice: powOf(10)},
                                ],
                            },
                        ],
                        target: AddressZero,
                        deadline: 0,
                        operator: 0,
                    },
                    {value: powOf(1150)},
                );

                const txReceipt = await tx.wait();
                const gasUsed = txReceipt.gasUsed.toNumber();
                const gasFee = toBN(gasUsed).mul(tx.gasPrice as BigNumber);

                expect(await ethers.provider.getBalance(router.address)).to.eq(0);
                expect(await ethers.provider.getBalance(user3.address)).to.eq(beforeBaseBal.add(powOf(103.5).sub(powOf(1150)).sub(gasFee)));
            });
        });

        describe("when target is set", () => {
            it("should transfer output to recipient", async () => {
                await core.setProtoFee(1000, 0, 0, 0, 0, 0);
                mid = await createMarket(undefined, tokenA_addr, tokenB_addr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);

                const userLiq = powOf(100);
                const user1Liq = powOf(100);
                const user2Liq = powOf(100);

                // transfer liquidity
                await tokenA.transfer(user.address, user1Liq);
                await tokenA.transfer(user2.address, user2Liq);

                // approve
                await tokenA.approve(core.address, userLiq);
                await tokenA.connect(user).approve(core.address, user1Liq);
                await tokenA.connect(user2).approve(core.address, user2Liq);

                // add liquidity
                await expect(
                    core.updateFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        amount: userLiq,
                        price: powOf(10),
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user).updateFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        amount: user1Liq,
                        price: powOf(10),
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user2).updateFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        amount: user2Liq,
                        price: powOf(10),
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                    }),
                ).not.to.be.reverted;

                // approve router to spend total quote asset
                await tokenB.approve(router.address, powOf(1150));

                const beforeBaseBal = await tokenA.balanceOf(user4.address);
                await expect(
                    router.route({
                        routes: [
                            {
                                market: mid,
                                liqs: [
                                    {provider: 1, lid: 0, amount: powOf(100), maxPrice: powOf(10)},
                                    {provider: 2, lid: 0, amount: powOf(10), maxPrice: powOf(10)},
                                    {provider: 3, lid: 0, amount: powOf(5), maxPrice: powOf(10)},
                                ],
                            },
                        ],
                        target: user4.address,
                        deadline: 0,
                        operator: 0,
                    }),
                ).not.to.be.reverted;

                expect(await tokenA.balanceOf(router.address)).to.eq(0);
                expect(await tokenB.balanceOf(router.address)).to.eq(0);
                expect(await tokenA.balanceOf(user4.address)).to.eq(beforeBaseBal.add(powOf(103.5)));
            });

            it("should return excess to sender but output to target", async () => {
                await core.setProtoFee(1000, 0, 0, 0, 0, 0);
                mid = await createMarket(undefined, tokenA_addr, tokenB_addr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);
                mid2 = await createMarket(undefined, tokenC_addr, tokenA_addr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);

                // Market 1
                const userLiq = powOf(100);
                const user1Liq = powOf(100);
                const user2Liq = powOf(100);
                await tokenA.transfer(user.address, user1Liq);
                await tokenA.transfer(user2.address, user2Liq);
                await tokenA.approve(core.address, userLiq);
                await tokenA.connect(user).approve(core.address, user1Liq);
                await tokenA.connect(user2).approve(core.address, user2Liq);
                await expect(
                    core.updateFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        amount: userLiq,
                        price: powOf(5),
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user).updateFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        amount: user1Liq,
                        price: powOf(10),
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user2).updateFungibleLiquidity({
                        marketId: mid,
                        target: AddressZero,
                        lid: 0,
                        amount: user2Liq,
                        price: powOf(10),
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                    }),
                ).not.to.be.reverted;

                // Market 2
                const userLiq2 = powOf(100);
                const user1Liq2 = powOf(100);
                const user2Liq2 = powOf(100);
                await tokenC.transfer(user.address, user1Liq2);
                await tokenC.transfer(user2.address, user2Liq2);
                await tokenC.approve(core.address, userLiq2);
                await tokenC.connect(user).approve(core.address, user1Liq2);
                await tokenC.connect(user2).approve(core.address, user2Liq2);
                await expect(
                    core.updateFungibleLiquidity({
                        marketId: mid2,
                        target: AddressZero,
                        lid: 0,
                        amount: userLiq2,
                        price: powOf(10),
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user).updateFungibleLiquidity({
                        marketId: mid2,
                        target: AddressZero,
                        lid: 0,
                        amount: user1Liq2,
                        price: powOf(10),
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                    }),
                ).not.to.be.reverted;
                await expect(
                    core.connect(user2).updateFungibleLiquidity({
                        marketId: mid2,
                        target: AddressZero,
                        lid: 0,
                        amount: user2Liq2,
                        price: powOf(10),
                        timeToPay: 0,
                        expireAt: 0,
                        pause: false,
                        wantOrIds: [],
                        wantAndIds: [],
                        deduct: false,
                        usePriceFromRegistry: false,
                        priceScaleBps: 0,
                    }),
                ).not.to.be.reverted;

                // approve router to spend total quote asset
                await tokenB.transfer(user3.address, powOf(1150));
                await tokenB.connect(user3).approve(router.address, powOf(1150));

                const beforeTokenABal = await tokenA.balanceOf(user3.address);
                await expect(
                    router.connect(user3).route({
                        routes: [
                            {
                                market: mid,
                                liqs: [
                                    {provider: 1, lid: 0, amount: powOf(100), maxPrice: powOf(10)}, // actual liquiidyt price = 5
                                    {provider: 2, lid: 0, amount: powOf(10), maxPrice: powOf(10)},
                                    {provider: 3, lid: 0, amount: powOf(5), maxPrice: powOf(10)},
                                ],
                            },
                            {
                                market: mid2,
                                liqs: [
                                    {provider: 1, lid: 0, amount: powOf(5), maxPrice: powOf(10)},
                                    {provider: 2, lid: 0, amount: powOf(3), maxPrice: powOf(10)},
                                    {provider: 3, lid: 0, amount: powOf(2), maxPrice: powOf(10)},
                                ],
                            },
                        ],
                        target: user4.address,
                        deadline: 0,
                        operator: 0,
                    }),
                ).not.to.be.reverted;

                expect(await tokenA.balanceOf(router.address)).to.eq(0);
                expect(await tokenB.balanceOf(router.address)).to.eq(0);
                expect(await tokenC.balanceOf(router.address)).to.eq(0);
                expect(await tokenB.balanceOf(user3.address)).to.eq(powOf(500));
                expect(await tokenA.balanceOf(user3.address)).to.eq(beforeTokenABal.add(powOf(3.5)));
                expect(await tokenC.balanceOf(user4.address)).to.eq(powOf(9));
            });
        });

        describe("deadline is set", () => {
            it("should transfer output to recipient", async () => {
                await core.setProtoFee(1000, 0, 0, 0, 0, 0);
                mid = await createMarket(undefined, tokenA_addr, tokenB_addr, AssetType.ERC20, AssetType.ERC20, false, false, 0, 0);

                const now = await advanceBlockTime(1);
                await expect(
                    router.route({
                        routes: [],
                        target: user4.address,
                        deadline: now,
                        operator: 0,
                    }),
                ).to.be.revertedWith("ROUTER: EXPIRED_TX");
            });
        });
    });
});
