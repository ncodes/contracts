import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {BadgeManager} from "./../typechain-types/BadgeManager";
import {Core} from "./../typechain-types/Core";
import {Operator} from "./../typechain-types/Operator";
import {TOKEN} from "./../typechain-types/TOKEN";
import {WETH9} from "./../typechain-types/WETH9";

import {constants, Contract, ContractFactory, Wallet} from "ethers";
import {getCoreLibraries, makeLibs} from "../test/helpers/helpers";
import {
    AssetRegistry,
    DisputeManager,
    FeePool,
    FeePurse,
    LPPool,
    MarketCore,
    MediatorManager,
    NFT,
    Randomness,
    TokenPool,
} from "../typechain-types";
import {AddressZero} from "../utils/utils";
import {getParams, Network} from "./params";

if (!process.env.STEP) {
    console.log("Please set STEP env var");
    process.exit(1);
}

const {getContractFactory: getFactory} = ethers;

const params = getParams((process.env.NETWORK as any) || Network.Ethereum);

/**
 * Run a function and log the result
 * @param step The step ID. If unset, the function will always run.
 * @param msg The message to log
 * @param f The function to run
 */
async function runCall(step: number | undefined, msg: string, f: () => Promise<void>) {
    if (process.env.STEP && step && step !== parseInt(process.env.STEP)) return;
    console.log("  *", msg);
    await f();
}

let core: Core;
let marketCore: MarketCore;
let mediatorMgr: MediatorManager;
let disputeMgr: DisputeManager;
let badgeMgr: BadgeManager;
let operatorMgr: Operator;
let randomness: Randomness;
let assetReg: AssetRegistry;
let feePurse: FeePurse;
let deployer: SignerWithAddress;
let accts: SignerWithAddress[];
let p2p: TOKEN;
let tokenPool: TokenPool;
let lpPool: LPPool;
let feePool: FeePool;
let nft: NFT;
let inventor: SignerWithAddress;
const energonAddr = constants.AddressZero;

// Store previously deployed contract and library address here.
// If set, they will be attached to instead of re-deploying
let deployed: {[key: string]: string} = {
    // SEPOLIA CONTRACT ADDRESSES
    // BadgeManager: "0x6cF0ec545403eC6792eF4F62cfcE2FE494bF1591",
    // TOKEN: "0xd0dE9c8983C1e7071dC2cB826eb7b9F6D3ac60d2",
    // MarketCore: "0x588Dc811aF25Ea75fd5b7FEEeAB368ca63D6EcBE",
    // MarketAuxLib: "0x46b5738231aB6Ab019A57A0C0C70aDe2197a18ab",
    // AuxLib: "0xBcAbA5dd4803E579F418b325c09eC3cD618Cc612",
    // LiquidityLib: "0x9a39061a0365f0EB73327E6983B1ae0DC2052dbA",
    // OrderLib: "0xfD8df6B134d475B8c11Bd4BDdBBeB3E4B62CeAa5",
    // FeeLib: "0x1F0Cfe55ca3Eb4E9a01f7beC2ffe21caa0B894EB",
    // OrderReleaseLib: "0xd7cd04D7716F21F9677EC912419826662C76544F",
    // SwapNonFungibleLib: "0x42fB8bdd0C263b7123539b2FF93987Ef1c7620fe",
    // SwapFungibleLib: "0x865fb283d7e01868138aF7253e70e7C4B93b9DF5",
    // SwapLib: "0xf1341ab696B8AD2464c12eb90aF261Cf5F34eF73",
    // WithdrawLib: "0x4104945a76547046d5282db81881fd75772ca21b",
    // OfferLib: "0xa2b70f192fef8e3234c114d3034b3eb9224810b7",
    // FungibleLiquidityLib: "0xd88b6e0fb0a5c65ac6cb47eb8d528906eccc21a6",
    // NonFungibleLiquidityLib: "0x19b3eb0b535f5a225a6dd9129d4bb3d2a00d451c",
    // Core: "0x70b34cae2ba32a4b777e491c717d5e837574bd65",
    // AssetRegistry: "0x97fB00DbDE7ea3625C4Af2290f09092003ea8195",
    // Operator: "0x15E1A3692D930F1891Cd8F1175561cbF6B77D00C",
    // FeePurse: "0x15D9b3b0DBeBA06E80FbCf7c952992fa79b9C9fC",
    // DummyRandomness: "0x94Dc00cCb1A240779AF85986EFA6Bc0791C2661b",
    // MediatorManager: "0x0056905103f8F18fe18c04Ec9d256bF759C3Dd5D",
    // DisputeManager: "0xe3DC1f3D53c2b821e713073f02A0b358706B69a2",
    // WETH: "0x4263541d13298963498ff1f83d992812ef3d2e73",
    // NFT: "0x3b457DE90E5145CF4d6a9F2945d56e00A88D5Ab8",
    // --------------------------------------------------
    // LOCAL CONTRACT ADDRESSES
    // Core: "0x9A9f2CCfdE556A7E9Ff0848998Aa4a0CFD8863AE",
    BadgeManager: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
};

async function attachOrDeploy(
    name: string,
    libraries: any,
    deployFn: (factory: ContractFactory, contract?: Contract) => void
) {
    let factory = await ethers.getContractFactory(name, {libraries});
    if (deployed[name]) {
        console.log(`► Attaching to ${name} at ${deployed[name]}`);
        return deployFn(factory, factory.attach(deployed[name] as string));
    } else {
        return deployFn(factory, undefined);
    }
}

async function main() {
    accts = await ethers.getSigners();
    deployer = accts[0];
    inventor = accts[0];

    // await deployMainnet();
    await deployLocal();
}

async function deployMainnet() {
    await deployBadgeManager();
    return;
    await deployP2PToken();
    await deployMarketCore();
    await deployCore();
    await deployAssetRegistry();
    await deployOperatorManager();
    await deployFeePurse();
    await deployDummyRandomness();
    await deployMediatorManager();
    await deployDisputeManager();
    await deployWrappedETH();
    await deployNFT();
    // await deployTokenPoolAndFeePool();
    // await deployLPPool();
}

async function deployLocal() {
    await deployBadgeManager();
    return;
    // await deployP2PToken();
    await deployMarketCore();
    await deployCore();
    await deployAssetRegistry();
    await deployOperatorManager();
    await deployFeePurse();
    await deployDummyRandomness();
    await deployMediatorManager();
    await deployDisputeManager();
    await deployWrappedETH();
    await deployNFT();
}

async function deployBadgeManager() {
    await attachOrDeploy("BadgeManager", undefined, async (factory, contract) => {
        if (contract) {
            badgeMgr = contract as BadgeManager;
        } else {
            console.log("► Deploying BadgeManager");
            badgeMgr = (await factory.deploy()) as BadgeManager;
            deployed.BadgeManager = badgeMgr.address;
            console.log("🎉 Deployed:", badgeMgr.address);
        }

        await runCall(1, "Create `instruction` badge issuer", async () => {
            await badgeMgr.registerIssuer(params.instructionBadgeIssuer, "instruction", [], []);
        });

        // TODO: Step 2
        // - Deposit gas into issue
        await runCall(2, "Create `pm/*` badge issuer and initial badges", async () => {
            const issuer = new Wallet(params.paymentMethodBadgeIssuerKey, ethers.provider);
            // await badgeMgr.registerIssuer(issuer.address, "pm", [], []);
            await badgeMgr.connect(issuer).registerPath("pm", "gtb", [], []);
            await badgeMgr.connect(issuer).registerPath("pm", "bank_transfer", [], []);
            await badgeMgr.connect(issuer).registerPath("pm", "first_bank", [], []);
            await badgeMgr.connect(issuer).registerPath("pm", "zenith", [], []);
            await badgeMgr.connect(issuer).registerPath("pm", "sterling_bank", [], []);
            await badgeMgr.connect(issuer).registerPath("pm", "union_bank", [], []);
        });

        // TODO: Step 2:
        // - Deposit gas into issue
        await runCall(2, "Create `kyc/*` badge issuer and initial badges", async () => {
            const issuer = new Wallet(params.kycBadgeIssuerKey, ethers.provider);
            await badgeMgr.registerIssuer(issuer.address, "kyc", [], []);
            await badgeMgr.connect(issuer).registerPath("kyc", "nga", [], []);
        });
    });
}

async function deployP2PToken() {
    await attachOrDeploy("TOKEN", undefined, async (factory, contract) => {
        if (contract) {
            p2p = contract as TOKEN;
            return;
        } else {
            console.log("► Deploying P2P token");
            p2p = (await factory.deploy("P2P Test Token", "P2P", "1000000000000000000000000000", 18)) as TOKEN;
            deployed.TOKEN = p2p.address;
            console.log("🎉 Deployed:", p2p.address);
        }
    });
}

async function deployWrappedETH() {
    if (process.env.NETWORK !== "sepolia") return;
    await attachOrDeploy("WETH9", undefined, async (factory, contract) => {
        let token: WETH9;
        if (contract) {
            token = contract as WETH9;
            return;
        } else {
            console.log("► Deploying token");
            token = (await factory.deploy()) as WETH9;
            deployed.WETH9 = token.address;
            console.log("🎉 Deployed:", token.address);
        }
    });
}

async function deployOperatorManager() {
    await attachOrDeploy("Operator", undefined, async (factory, contract) => {
        if (contract) {
            operatorMgr = contract as Operator;
            return;
        } else {
            console.log("► Deploying Operator");
            operatorMgr = (await factory.deploy(p2p.address, params.operatorBond)) as Operator;
            deployed.Operator = operatorMgr.address;
            console.log("🎉 Deployed:", operatorMgr.address);
        }

        await runCall(1, "Setting operator manager on core", async () => {
            await core.setOperator(operatorMgr.address);
        });
    });
}

async function deployMarketCore() {
    await attachOrDeploy("MarketCore", undefined, async (factory, contract) => {
        if (contract) {
            marketCore = contract as MarketCore;
            return;
        } else {
            console.log("► Deploying MarketCore");
            marketCore = (await factory.deploy(params.defaultDisputeDelayDur)) as MarketCore;
            deployed.MarketCore = marketCore.address;
            console.log("🎉 Deployed:", marketCore.address);
        }

        await runCall(1, "Setting badge manager", async () => {
            await marketCore.setBadgeMgr(badgeMgr.address);
        });
    });
}

async function deployCore() {
    let libs = undefined;
    console.log("► Deploying Core libraries");
    libs = await makeLibs(deployed, console.log);
    console.log("🎉 Deployed Core libraries");

    await attachOrDeploy("Core", getCoreLibraries(libs), async (factory, contract) => {
        if (contract) {
            core = contract as Core;
            return;
        } else {
            console.log("► Deploying Core");
            core = (await factory.deploy(
                marketCore.address,
                p2p.address,
                params.minTimeToPay,
                params.orderGraceDur,
                params.maxOpenOrders,
                params.maxOpenDisputes
            )) as Core;
            deployed.Core = core.address;
            console.log("🎉 Deployed:", core.address);
        }

        await runCall(1, "Setting protocol fee", async () => {
            await core.setProtoFee(12, 14, 10, 1, 1, 10);
        });
        await runCall(1, "Setting fee sharer config", async () => {
            await core.configureFeePool(params.transferToFeePoolInterval);
        });
        await runCall(1, "Setting protocol recipient", async () => {
            await core.setInventor(inventor.address);
        });
        await runCall(1, "Adding Core as P2P minter", async () => {
            await p2p.addMinters([core.address]);
        });
        await runCall(1, "Setting Core as MarketCore writer", async () => {
            await marketCore.updateWriter(core.address, true);
        });
        await runCall(1, "Setting badge manager", async () => {
            await core.setBadgeMgr(badgeMgr.address);
        });
    });
}

async function deployAssetRegistry() {
    await attachOrDeploy("AssetRegistry", undefined, async (factory, contract) => {
        if (contract) {
            assetReg = contract as AssetRegistry;
            return;
        } else {
            console.log("► Deploying AssetRegistry");
            assetReg = (await factory.deploy()) as AssetRegistry;
            deployed.AssetRegistry = assetReg.address;
            console.log("🎉 Deployed:", assetReg.address);
        }

        await runCall(1, "Setting asset registry on Core", async () => {
            await core.setAssetRegistry(assetReg.address);
        });
    });
}

async function deployFeePurse() {
    await attachOrDeploy("FeePurse", undefined, async (factory, contract) => {
        if (contract) {
            feePurse = contract as FeePurse;
            return;
        } else {
            console.log("► Deploying FeePurse");
            feePurse = (await factory.deploy(p2p.address)) as FeePurse;
            deployed.FeePurse = feePurse.address;
            console.log("🎉 Deployed:", feePurse.address);
        }

        await runCall(1, "Setting fee purse on Core", async () => {
            await core.setFeePurse(feePurse.address);
            await feePurse.updateWriter(core.address, true);
        });
    });
}

async function deployRandomness() {
    await attachOrDeploy("Randomness", undefined, async (factory, contract) => {
        if (contract) {
            randomness = contract as Randomness;
            return;
        } else {
            console.log("► Deploying Randomness generator");
            randomness = (await factory.deploy(
                params.chainlinkKeyHash,
                params.chainlinkCoordinator,
                params.chainlinkSubId
            )) as Randomness;
            deployed.Randomness = randomness.address;
            console.log("🎉 Deployed:", randomness.address);
        }
    });
}

async function deployDummyRandomness() {
    await attachOrDeploy("DummyRandomness", undefined, async (factory, contract) => {
        if (contract) {
            randomness = contract as Randomness;
            return;
        } else {
            console.log("► Deploying DummyRandomness");
            randomness = (await factory.deploy()) as Randomness;
            deployed.DummyRandomness = randomness.address;
            console.log("🎉 Deployed:", randomness.address);
        }
    });
}

async function deployMediatorManager() {
    await attachOrDeploy("MediatorManager", undefined, async (factory, contract) => {
        if (contract) {
            mediatorMgr = contract as MediatorManager;
            return;
        } else {
            console.log("► Deploying MediatorManager");
            mediatorMgr = (await factory.deploy(
                p2p.address,
                marketCore.address,
                randomness.address,
                params.ticketCancelDur,
                params.ticketMatureDur,
                params.ticketExpireDur
            )) as MediatorManager;
            deployed.MediatorManager = mediatorMgr.address;
            console.log("🎉 Deployed:", mediatorMgr.address);
        }

        await runCall(1, "Setting Ticket Params", async () => {
            await mediatorMgr.setTicketMarketParams(
                params.baseTicketPrice,
                params.ticketWindowDur,
                params.ticketsPerWindow,
                params.ticketSupply,
                params.priceSupplyDeltaBP,
                params.minInactiveWindowBeforeReset,
                params.soldOutBP
            );
        });

        await runCall(1, "Adding ticket pool", async () => {
            await mediatorMgr.updateTicketPool(
                0,
                params.poolReqBond,
                params.poolDraftReward,
                params.poolWinReward,
                params.poolNoVoteSlashBP,
                params.poolLoseVoteSlashBP,
                params.poolNumDraftee
            );
        });
    });
}

async function deployDisputeManager() {
    await attachOrDeploy("DisputeManager", undefined, async (factory, contract) => {
        if (contract) {
            disputeMgr = contract as DisputeManager;
            return;
        } else {
            console.log("► Deploying DisputeManager");
            disputeMgr = (await factory.deploy(
                p2p.address,
                marketCore.address,
                core.address,
                mediatorMgr.address,
                params.predictDur,
                params.evidenceDur
            )) as DisputeManager;
            deployed.DisputeManager = disputeMgr.address;
            console.log("🎉 Deployed:", disputeMgr.address);
        }

        await runCall(1, "Set Core's dispute manager", async () => {
            await core.setDisputeManager(disputeMgr.address);
        });

        await runCall(1, "Set mediator manager's dispute manager", async () => {
            await mediatorMgr.setDisputeManager(disputeMgr.address);
        });
    });
}

async function deployFeePool() {
    await attachOrDeploy("FeePool", undefined, async (factory, contract) => {
        if (contract) {
            feePool = contract as FeePool;
            return;
        } else {
            console.log("► Deploying FeePool");
            feePool = (await factory.deploy(tokenPool.address, core.address)) as FeePool;
            deployed.FeePool = feePool.address;
            console.log("🎉 Deployed:", feePool.address);
        }
    });
}

async function deployTokenPoolAndFeePool() {
    await attachOrDeploy("TokenPool", undefined, async (factory, contract) => {
        if (contract) {
            tokenPool = contract as TokenPool;
            return;
        } else {
            console.log("► Deploying TokenPool");
            tokenPool = (await factory.deploy(p2p.address, p2p.address)) as TokenPool;
            deployed.TokenPool = tokenPool.address;
            console.log("🎉 Deployed:", tokenPool.address);
        }

        await deployFeePool();

        await runCall(1, "Setting FeePool on TokenPool contract", async () => {
            await tokenPool.setFeePool(feePool.address);
            await core.setFeePool(feePool.address);
        });
    });
}

async function deployLPPool() {
    await attachOrDeploy("LPPool", undefined, async (factory, contract) => {
        if (contract) {
            lpPool = contract as LPPool;
            return;
        } else {
            console.log("► Deploying LPPool");
            const poolTokenAddr = accts[1].address;
            lpPool = (await factory.deploy(poolTokenAddr, p2p.address)) as LPPool;
            deployed.LPPool = lpPool.address;
            console.log("🎉 Deployed:", lpPool.address);
        }
    });
}

async function deployNFT() {
    await attachOrDeploy("NFT", undefined, async (factory, contract) => {
        if (contract) {
            nft = contract as NFT;
            return;
        } else {
            console.log("► Deploying NFT");
            const maxSupply = 10000;
            const baseURI = "ipfs://abc/";
            nft = (await factory.deploy(
                "NFT",
                "NFT",
                baseURI,
                maxSupply,
                0,
                // feePool.address,
                AddressZero,
                // params.allocatorAddr,
                AddressZero,
                // energonAddr,
                AddressZero,
                AddressZero
            )) as NFT;
            deployed.NFT = nft.address;
            console.log("🎉 Deployed:", nft.address);
        }

        await runCall(1, "Setting NFT address and discount on Core contract", async () => {
            await core.setDiscountForNFTHolder(params.nftDiscountBP);
            await core.setNFT(nft.address);
        });
    });
}

main()
    .then(() => {
        console.log(deployed);
        process.exit(0);
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
