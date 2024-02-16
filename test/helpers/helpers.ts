import {ethers, waffle} from "hardhat";
import {AuxLib} from "./../../typechain-types/AuxLib";
import {LiquidityLib} from "./../../typechain-types/LiquidityLib";
import {MarketAuxLib} from "./../../typechain-types/MarketAuxLib";
const {deployMockContract} = waffle;

import {
    AssetRegistry,
    BadgeManager,
    Core,
    ENERGON,
    ERC1155T,
    ERC721T,
    FeePurse,
    FungibleLiquidityLib,
    MarketCore,
    MediatorManager,
    MinerRegistry,
    NFT,
    NonFungibleLiquidityLib,
    OfferLib,
    Operator,
    OrderLib,
    SwapFungibleLib,
    SwapNonFungibleLib,
    TOKEN,
    WithdrawLib,
} from "../../typechain-types";

import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {MockContract} from "ethereum-waffle";
import {BigNumber, constants, Contract} from "ethers";
import * as CoreArtifact from "../../artifacts/contracts/core/Core.sol/Core.json";
import {DeployedContracts} from "../../types/types";
import {makeMarketID, toBN} from "../../utils/utils";
const {getContractFactory} = ethers;

interface MakeCoreLibsResult {
    AuxLib: AuxLib;
    MarketAuxLib: MarketAuxLib;
    LiquidityLib: LiquidityLib;
    OrderLib: OrderLib;
    SwapNonFungibleLib: SwapNonFungibleLib;
    SwapFungibleLib: SwapFungibleLib;
    SwapLib: Contract;
    WithdrawLib: WithdrawLib;
    FeeLib: Contract;
    OfferLib: OfferLib;
    FungibleLiquidityLib: FungibleLiquidityLib;
    NonFungibleLiquidityLib: NonFungibleLiquidityLib;
}

function logLibAddress(libs: MakeCoreLibsResult) {
    for (const [key, value] of Object.entries(libs)) {
        console.log(`  * Deployed ${key}:`, value.address);
    }
}

export async function makeLibs(deployed: DeployedContracts = {}, log?: (message?: any, ...optionalParams: any[]) => void): Promise<MakeCoreLibsResult> {
    let MarketAuxLib: Contract;
    if (!deployed.MarketAuxLib) {
        MarketAuxLib = await (await getContractFactory("MarketAuxLib")).deploy();
        const r = await MarketAuxLib.deployTransaction.wait();
        deployed.MarketAuxLib = {address: MarketAuxLib.address, isLib: true, gasUsed: r.gasUsed.toNumber()};
        log?.("  * Deployed MarketAuxLib", MarketAuxLib.address, `GasUsed: ${r.gasUsed.toNumber()}`);
    } else {
        MarketAuxLib = await ethers.getContractAt("MarketAuxLib", deployed.MarketAuxLib.address);
        log?.("  * Attaching to MarketAuxLib at", MarketAuxLib.address);
    }

    let AuxLib: Contract;
    if (!deployed.AuxLib) {
        AuxLib = await (await getContractFactory("AuxLib", {libraries: {MarketAuxLib: MarketAuxLib.address}})).deploy();
        const r = await AuxLib.deployTransaction.wait();
        deployed.AuxLib = {address: AuxLib.address, isLib: true, gasUsed: r.gasUsed.toNumber()};
        log?.("  * Deployed AuxLib", AuxLib.address, `GasUsed: ${r.gasUsed.toNumber()}`);
    } else {
        AuxLib = await ethers.getContractAt("AuxLib", deployed.AuxLib.address);
        log?.("  * Attaching to AuxLib at", AuxLib.address);
    }

    let LiquidityLib: Contract;
    if (!deployed.LiquidityLib) {
        LiquidityLib = await (await getContractFactory("LiquidityLib", {libraries: {AuxLib: AuxLib.address, MarketAuxLib: MarketAuxLib.address}})).deploy();
        const r = await LiquidityLib.deployTransaction.wait();
        deployed.LiquidityLib = {address: LiquidityLib.address, isLib: true, gasUsed: r.gasUsed.toNumber()};
        log?.("  * Deployed LiquidityLib", deployed.LiquidityLib.address, `GasUsed: ${r.gasUsed.toNumber()}`);
    } else {
        LiquidityLib = await ethers.getContractAt("LiquidityLib", deployed.LiquidityLib.address);
        log?.("  * Attaching to LiquidityLib at", LiquidityLib.address);
    }

    let OrderLib: Contract;
    if (!deployed.OrderLib) {
        OrderLib = await (await getContractFactory("OrderLib", {libraries: {AuxLib: AuxLib.address, LiquidityLib: LiquidityLib.address, MarketAuxLib: MarketAuxLib.address}})).deploy();
        const r = await OrderLib.deployTransaction.wait();
        deployed.OrderLib = {address: OrderLib.address, isLib: true, gasUsed: r.gasUsed.toNumber()};
        log?.("  * Deployed OrderLib", OrderLib.address, `GasUsed: ${r.gasUsed.toNumber()}`);
    } else {
        OrderLib = await ethers.getContractAt("OrderLib", deployed.OrderLib.address);
        log?.("  * Attaching to OrderLib at", OrderLib.address);
    }

    let FeeLib: Contract;
    if (!deployed.FeeLib) {
        FeeLib = await (await getContractFactory("FeeLib", {libraries: {AuxLib: AuxLib.address, MarketAuxLib: MarketAuxLib.address}})).deploy();
        const r = await FeeLib.deployTransaction.wait();
        deployed.FeeLib = {address: FeeLib.address, isLib: true, gasUsed: r.gasUsed.toNumber()};
        log?.("  * Deployed FeeLib", FeeLib.address, `GasUsed: ${r.gasUsed.toNumber()}`);
    } else {
        FeeLib = await ethers.getContractAt("FeeLib", deployed.FeeLib.address);
        log?.("  * Attaching to FeeLib at", FeeLib.address);
    }

    let OrderReleaseLib: Contract;
    if (!deployed.OrderReleaseLib) {
        OrderReleaseLib = await (await getContractFactory("OrderReleaseLib", {libraries: {AuxLib: AuxLib.address, MarketAuxLib: MarketAuxLib.address, FeeLib: FeeLib.address}})).deploy();
        const r = await OrderReleaseLib.deployTransaction.wait();
        deployed.OrderReleaseLib = {address: OrderReleaseLib.address, isLib: true, gasUsed: r.gasUsed.toNumber()};
        log?.("  * Deployed OrderReleaseLib", OrderReleaseLib.address, `GasUsed: ${r.gasUsed.toNumber()}`);
    } else {
        OrderReleaseLib = await ethers.getContractAt("OrderReleaseLib", deployed.OrderReleaseLib.address);
        log?.("  * Attaching to OrderReleaseLib at", OrderReleaseLib.address);
    }

    let SwapNonFungibleLib: Contract;
    if (!deployed.SwapNonFungibleLib) {
        SwapNonFungibleLib = await (
            await getContractFactory("SwapNonFungibleLib", {
                libraries: {AuxLib: AuxLib.address, OrderLib: OrderLib.address, MarketAuxLib: MarketAuxLib.address, LiquidityLib: LiquidityLib.address, FeeLib: FeeLib.address},
            })
        ).deploy();
        const r = await SwapNonFungibleLib.deployTransaction.wait();
        deployed.SwapNonFungibleLib = {address: SwapNonFungibleLib.address, isLib: true, gasUsed: r.gasUsed.toNumber()};
        log?.("  * Deployed SwapNonFungibleLib", SwapNonFungibleLib.address, `GasUsed: ${r.gasUsed.toNumber()}`);
    } else {
        SwapNonFungibleLib = await ethers.getContractAt("SwapNonFungibleLib", deployed.SwapNonFungibleLib.address);
        log?.("  * Attaching to SwapNonFungibleLib at", SwapNonFungibleLib.address);
    }

    let SwapFungibleLib: Contract;
    if (!deployed.SwapFungibleLib) {
        SwapFungibleLib = await (
            await getContractFactory("SwapFungibleLib", {
                libraries: {
                    AuxLib: AuxLib.address,
                    LiquidityLib: LiquidityLib.address,
                    OrderLib: OrderLib.address,
                    MarketAuxLib: MarketAuxLib.address,
                    FeeLib: FeeLib.address,
                },
            })
        ).deploy();
        const r = await SwapFungibleLib.deployTransaction.wait();
        deployed.SwapFungibleLib = {address: SwapFungibleLib.address, isLib: true, gasUsed: r.gasUsed.toNumber()};
        log?.("  * Deployed SwapFungibleLib", SwapFungibleLib.address, `GasUsed: ${r.gasUsed.toNumber()}`);
    } else {
        SwapFungibleLib = await ethers.getContractAt("SwapFungibleLib", deployed.SwapFungibleLib.address);
        log?.("  * Attaching to SwapFungibleLib at", SwapFungibleLib.address);
    }

    let SwapLib: Contract;
    if (!deployed.SwapLib) {
        SwapLib = await (
            await getContractFactory("SwapLib", {
                libraries: {
                    MarketAuxLib: MarketAuxLib.address,
                    OrderLib: OrderLib.address,
                    OrderReleaseLib: OrderReleaseLib.address,
                    SwapFungibleLib: SwapFungibleLib.address,
                    SwapNonFungibleLib: SwapNonFungibleLib.address,
                },
            })
        ).deploy();
        const r = await SwapLib.deployTransaction.wait();
        deployed.SwapLib = {address: SwapLib.address, isLib: true, gasUsed: r.gasUsed.toNumber()};
        log?.("  * Deployed SwapLib", SwapLib.address, `GasUsed: ${r.gasUsed.toNumber()}`);
    } else {
        SwapLib = await ethers.getContractAt("SwapLib", deployed.SwapLib.address);
        log?.("  * Attaching to SwapLib at", SwapLib.address);
    }

    let WithdrawLib: Contract;
    if (!deployed.WithdrawLib) {
        WithdrawLib = await (await getContractFactory("WithdrawLib", {libraries: {}})).deploy();
        const r = await WithdrawLib.deployTransaction.wait();
        deployed.WithdrawLib = {address: WithdrawLib.address, isLib: true, gasUsed: r.gasUsed.toNumber()};
        log?.("  * Deployed WithdrawLib", WithdrawLib.address, `GasUsed: ${r.gasUsed.toNumber()}`);
    } else {
        WithdrawLib = await ethers.getContractAt("WithdrawLib", deployed.WithdrawLib.address);
        log?.("  * Attaching to WithdrawLib at", WithdrawLib.address);
    }

    let OfferLib: Contract;
    if (!deployed.OfferLib) {
        OfferLib = await (
            await getContractFactory("OfferLib", {
                libraries: {AuxLib: AuxLib.address, MarketAuxLib: MarketAuxLib.address, SwapFungibleLib: SwapFungibleLib.address, SwapNonFungibleLib: SwapNonFungibleLib.address},
            })
        ).deploy();
        const r = await OfferLib.deployTransaction.wait();
        deployed.OfferLib = {address: OfferLib.address, isLib: true, gasUsed: r.gasUsed.toNumber()};
        log?.("  * Deployed OfferLib", OfferLib.address, `GasUsed: ${r.gasUsed.toNumber()}`);
    } else {
        OfferLib = await ethers.getContractAt("OfferLib", deployed.OfferLib.address);
        log?.("  * Attaching to OfferLib at", OfferLib.address);
    }

    let FungibleLiquidityLib: Contract;
    if (!deployed.FungibleLiquidityLib) {
        FungibleLiquidityLib = await (await getContractFactory("FungibleLiquidityLib", {libraries: {AuxLib: AuxLib.address, MarketAuxLib: MarketAuxLib.address}})).deploy();
        const r = await FungibleLiquidityLib.deployTransaction.wait();
        deployed.FungibleLiquidityLib = {address: FungibleLiquidityLib.address, isLib: true, gasUsed: r.gasUsed.toNumber()};
        log?.("  * Deployed FungibleLiquidityLib", FungibleLiquidityLib.address, `GasUsed: ${r.gasUsed.toNumber()}`);
    } else {
        FungibleLiquidityLib = await ethers.getContractAt("FungibleLiquidityLib", deployed.FungibleLiquidityLib.address);
        log?.("  * Attaching to FungibleLiquidityLib at", FungibleLiquidityLib.address);
    }

    let NonFungibleLiquidityLib: Contract;
    if (!deployed.NonFungibleLiquidityLib) {
        NonFungibleLiquidityLib = await (await getContractFactory("NonFungibleLiquidityLib", {libraries: {AuxLib: AuxLib.address, MarketAuxLib: MarketAuxLib.address}})).deploy();
        const r = await NonFungibleLiquidityLib.deployTransaction.wait();
        deployed.NonFungibleLiquidityLib = {address: NonFungibleLiquidityLib.address, isLib: true, gasUsed: r.gasUsed.toNumber()};
        log?.("  * Deployed NonFungibleLiquidityLib", NonFungibleLiquidityLib.address, `GasUsed: ${r.gasUsed.toNumber()}`);
    } else {
        NonFungibleLiquidityLib = await ethers.getContractAt("NonFungibleLiquidityLib", deployed.NonFungibleLiquidityLib.address);
        log?.("  * Attaching to NonFungibleLiquidityLib at", NonFungibleLiquidityLib.address);
    }

    return Promise.resolve(<MakeCoreLibsResult>{
        AuxLib,
        MarketAuxLib,
        LiquidityLib,
        OrderLib,
        SwapNonFungibleLib,
        SwapFungibleLib,
        SwapLib,
        WithdrawLib,
        FeeLib,
        OfferLib,
        FungibleLiquidityLib,
        NonFungibleLiquidityLib,
    });
}

export function getCoreLibraries(libs: MakeCoreLibsResult | undefined) {
    if (!libs) return undefined;
    return {
        AuxLib: libs.AuxLib.address,
        LiquidityLib: libs.LiquidityLib.address,
        SwapLib: libs.SwapLib.address,
        WithdrawLib: libs.WithdrawLib.address,
        OfferLib: libs.OfferLib.address,
        FeeLib: libs.FeeLib.address,
        NonFungibleLiquidityLib: libs.NonFungibleLiquidityLib.address,
        FungibleLiquidityLib: libs.FungibleLiquidityLib.address,
    };
}

export async function initCoreTestSuite() {
    let marketCreator: SignerWithAddress, provider: SignerWithAddress, swapper: SignerWithAddress, marketCreator2: SignerWithAddress, inventor: SignerWithAddress;
    let baseAddr: string;
    let quoteAddr: string;
    let core: Core;
    let minerReg: MinerRegistry;
    let coreMock: MockContract;
    let mc: MarketCore;
    let energon: ENERGON;
    let nft: NFT;
    let badgeMgr: BadgeManager;
    let mediatorMgr: MediatorManager;
    let randomness: MockContract;
    let testERC721: ERC721T;
    let testERC1155: ERC1155T;
    let assetReg: AssetRegistry;
    let operator: Operator;
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
    let feePurse: FeePurse;
    let quoteDec: BigNumber;
    let minTimeToPay: number;
    let defaultDisputeDelayDur: BigNumber;
    let orderGracePeriod: number;
    let orderLifeTime: number;
    const maxSupply = 3;
    const hiddenURI = "ipfs://abc/hidden.json";
    const baseURI = "ipfs://abc/";
    let amountOfBase: BigNumber;
    let pricePerBase: BigNumber;
    let fixedSynthSwapFee = toBN("100000000000000000"); // 0.1
    let fixedNFTSwapFee = toBN("100000000000000000"); // 0.1
    let instantNFTSwapFee = 10;
    let nftDiscountBp = toBN(2500);
    let instantSwapFee = 12;
    let synthSwapFee = 14;
    let stableSwapFee = 10;
    let operatorBond = 100;
    let supply = toBN("1000000000000000000000000");
    let minerBond = 1000;
    let minerMatureDur = 600;
    let minerCancelDur = 600;
    let minerDraftReward = 1000;
    let minerUndraftReward = 1000;
    let minerExecuteReward = 1000;
    let minerCancelReward = 1000;
    let ticketBondAmt = 100;
    let ticketCancelDur = 86400;
    let ticketMatureDur = 86400;
    let ticketExpireDur = 86400;
    let ticketPauseDur = 86400;

    accts = await ethers.getSigners();
    deployer = accts[0];
    provider = accts[1];
    swapper = accts[2];
    marketCreator = accts[0];
    marketCreator2 = accts[3];
    inventor = accts[4];
    user5 = accts[5];

    let TOKEN = await getContractFactory("TOKEN");
    token = (await TOKEN.deploy("TEST", "TEST", supply, 18)) as TOKEN;
    tokenDec = toBN(10).pow(await token.decimals());

    const libs = await makeLibs();
    let marketCoreFact = await getContractFactory("MarketCore", {libraries: {}});
    mc = (await marketCoreFact.deploy(0)) as MarketCore;

    let coreFact = await getContractFactory("Core", {
        libraries: getCoreLibraries(libs),
    });
    core = (await coreFact.deploy(mc.address, token.address, 1800, 1800, 1, 3)) as Core;
    cAddr = core.address;

    coreMock = await deployMockContract(accts[0], CoreArtifact.abi);

    let ENERGON = await getContractFactory("ENERGON");
    energon = (await ENERGON.deploy("ENERGON", "ENR", supply, 18)) as ENERGON;

    let nftFact = await getContractFactory("NFT");
    nft = (await nftFact.deploy("NFT", "NFT", baseURI, maxSupply, 0, constants.AddressZero, deployer.address, energon.address, token.address)) as NFT;
    await nft.setAllocator(deployer.address);
    await nft.toggleAllowMint();

    let badgeFact = await getContractFactory("BadgeManager");
    badgeMgr = (await badgeFact.deploy()) as BadgeManager;

    let assetRegFact = await getContractFactory("AssetRegistry");
    assetReg = (await assetRegFact.deploy()) as AssetRegistry;

    await core.setNFT(nft.address);
    await core.setDiscountForNFTHolder(nftDiscountBp);
    await core.setProtoFee(instantSwapFee, synthSwapFee, stableSwapFee, fixedSynthSwapFee, fixedNFTSwapFee, instantNFTSwapFee);
    await core.setInventor(inventor.address);
    await token.addMinters([core.address]);
    await mc.updateWriter(core.address, true);
    await core.setAssetRegistry(assetReg.address);
    await core.setBadgeMgr(badgeMgr.address);
    await mc.setBadgeMgr(badgeMgr.address);

    minTimeToPay = (await core.state()).minTimeToPay.toNumber();
    orderGracePeriod = (await core.state()).orderGraceDur.toNumber();
    orderLifeTime = minTimeToPay + orderGracePeriod;
    defaultDisputeDelayDur = await mc.defaultDisputeDelayDur();

    let dummyTokenFactory = await getContractFactory("TOKEN");
    baseAsset = (await dummyTokenFactory.deploy("BASE_TOKEN", "BASE_TOKEN", supply, 18)) as TOKEN;
    baseAddr = baseAsset.address;
    quoteAsset = (await dummyTokenFactory.deploy("QUOTE_TOKEN", "QUOTE_TOKEN", supply, 18)) as TOKEN;
    quoteAddr = quoteAsset.address;
    baseDec = toBN(10).pow(await baseAsset.decimals());
    quoteDec = toBN(10).pow(await quoteAsset.decimals());
    amountOfBase = baseDec.mul(100); // amount of BASE asset to provide as liquidity
    pricePerBase = quoteDec.mul(10); // amount of QUOTE for 1 BASE

    let erc721Fact = await getContractFactory("ERC721T");
    testERC721 = (await erc721Fact.deploy("ERC721T", "ERC721T")) as ERC721T;

    let erc1155Fact = await getContractFactory("ERC1155T");
    testERC1155 = (await erc1155Fact.deploy()) as ERC1155T;

    let feePurseFact = await getContractFactory("FeePurse");
    feePurse = (await feePurseFact.deploy(token.address)) as FeePurse;
    await feePurse.updateWriter(core.address, true);
    await core.setFeePurse(feePurse.address);

    let factory = await ethers.getContractFactory("Operator");
    operator = (await factory.deploy(token.address, operatorBond)) as Operator;
    await core.setOperator(operator.address);

    let minerRegFact = await getContractFactory("MinerRegistry");
    minerReg = (await minerRegFact.deploy(token.address, minerBond, minerMatureDur, minerCancelDur)) as MinerRegistry;
    await minerReg.updateOpsReward([0, 1, 2, 3], [minerDraftReward, minerUndraftReward, minerExecuteReward, minerCancelReward]);
    await core.setMinerRegistry(minerReg.address);
    await minerReg.updateWriter(core.address, true);

    const Randomness = require("../../artifacts/contracts/randomness/Randomness.sol/Randomness.json");
    randomness = await deployMockContract(deployer, Randomness.abi);
    await randomness.mock.randomN.returns(0);

    let factory3 = await ethers.getContractFactory("MediatorManager");
    mediatorMgr = (await factory3.deploy(token.address, mc.address, randomness.address, ticketCancelDur, ticketMatureDur, ticketExpireDur, ticketPauseDur)) as MediatorManager;
    mc.setMediatorManager(mediatorMgr.address);

    mid = makeMarketID(marketCreator.address, baseAddr, quoteAddr, 1, 0);

    return Promise.resolve({
        libs,
        baseAddr,
        quoteAddr,
        core,
        mc,
        energon,
        coreMock,
        nft,
        operator,
        badgeMgr,
        testERC721,
        testERC1155,
        assetReg,
        deployer,
        user5,
        cAddr,
        accts,
        minerReg,
        minerBond,
        minerCancelDur,
        minerMatureDur,
        token,
        baseAsset,
        quoteAsset,
        mid,
        tokenDec,
        baseDec,
        quoteDec,
        minTimeToPay,
        defaultDisputeDelayDur,
        orderGracePeriod,
        orderLifeTime,
        maxSupply,
        hiddenURI,
        baseURI,
        amountOfBase,
        pricePerBase,
        marketCreator,
        provider,
        supply,
        swapper,
        marketCreator2,
        inventor,
        fixedSynthSwapFee,
        fixedNFTSwapFee,
        instantNFTSwapFee,
        mediatorMgr,
        feePurse,
        nftDiscountBp,
        instantSwapFee,
        synthSwapFee,
        randomness,
        stableSwapFee,
        minerDraftReward,
        minerUndraftReward,
        minerExecuteReward,
        minerCancelReward,
        ticketCancelDur,
        ticketMatureDur,
        ticketExpireDur,
        ticketPauseDur,
        ticketBondAmt,
    });
}
