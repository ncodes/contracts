import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Contract, ContractTransaction, Signer, Wallet} from "ethers";
import fs from "fs";
import {ethers, network} from "hardhat";
import path from "path";
import {getCoreLibraries, makeLibs} from "../test/helpers/helpers";
import {
    AssetRegistry,
    DisputeManager,
    ENERGON,
    FeePool,
    FeePurse,
    LPPool,
    MarketCore,
    MediatorManager,
    NFT,
    Randomness,
    TokenPool,
} from "../typechain-types";
import {BadgeManager} from "../typechain-types/BadgeManager";
import {Core} from "../typechain-types/Core";
import {Operator} from "../typechain-types/Operator";
import {TOKEN} from "../typechain-types/TOKEN";
import {WETH9} from "../typechain-types/WETH9";
import {Deployments} from "../types/deploy";
import {AddressZero} from "../utils/utils";
import {Network, getParams} from "./params";

// Supported ENV variables
const step = process.env.STEP;
const redeploy = process.env.REDEPLOY == "true";

// STEP is required
if (!step) {
    console.log("'STEP' env var is required");
    process.exit(1);
}

const params = getParams(network.name as Network);
const deploymentDir = path.join(__dirname, "deployments", network.name);
let txCount = 0;
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
let energonAddr: ENERGON;

// Store previously deployed contract and library address here.
// If set, they will be attached to instead of re-deploying
let deployed: Deployments = {
    meta: {created: Date.now()},
    contracts: {},
};

async function deployMainnet() {
    //   await deployBadgeManager();
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
    await deployEnergon();

    if (network.name == Network.Localhost) {
        await deployTestWETH9();
        await deployTestUNI();
        await deployTestNGN();
    }
}

async function main() {
    accts = await ethers.getSigners();
    deployer = accts[0];
    inventor = accts[0];

    // await deployMainnet();
    await deployLocal();
}

async function deployBadgeManager() {
    await deployOrAttach<BadgeManager>("BadgeManager", undefined, [], async (contract) => {
        badgeMgr = contract;

        await runStep(1, "Create `instruction` badge issuer", async () => {
            await call(badgeMgr, deployer, async (c) => {
                return c.registerIssuer(params.instructionBadgeIssuer, "instruction", [], []);
            });
        });

        // TODO: Step 2
        // - Deposit gas into issue
        await runStep(2, "Create `pm/*` badge issuer and initial badges", async () => {
            const issuer = new Wallet(params.paymentMethodBadgeIssuerKey, ethers.provider);
            call(badgeMgr, issuer, (c) => {
                return c.registerIssuer(issuer.address, "pm", [], []);
            });
            call(badgeMgr, issuer, (c) => {
                return c.registerPath("pm", "gtb", [], []);
            });
            call(badgeMgr, issuer, (c) => {
                return c.registerPath("pm", "bank_transfer", [], []);
            });
            call(badgeMgr, issuer, (c) => {
                return c.registerPath("pm", "first_bank", [], []);
            });
            call(badgeMgr, issuer, (c) => {
                return c.registerPath("pm", "zenith", [], []);
            });
            call(badgeMgr, issuer, (c) => {
                return c.registerPath("pm", "sterling_bank", [], []);
            });
            call(badgeMgr, issuer, (c) => {
                return c.registerPath("pm", "union_bank", [], []);
            });
        });

        // TODO: Step 2:
        // - Deposit gas into issue
        await runStep(2, "Create `kyc/*` badge issuer and initial badges", async () => {
            const issuer = new Wallet(params.kycBadgeIssuerKey, ethers.provider);
            call(badgeMgr, issuer, (c) => {
                return c.registerIssuer(issuer.address, "kyc", [], []);
            });
            call(badgeMgr, issuer, (c) => {
                return c.registerPath("kyc", "nga", [], []);
            });
        });
    });
}

async function deployP2PToken() {
    await deployOrAttach<TOKEN>(
        "TOKEN",
        undefined,
        ["P2P Test Token", "P2P", "1000000000000000000000000000", 18],
        async (contract) => {
            p2p = contract;
        },
    );
}

async function deployWrappedETH() {
    if (network.name !== "sepolia") return;
    await deployOrAttach<WETH9>("WETH9", undefined, [], async (factory, contract) => {});
}

async function deployOperatorManager() {
    await deployOrAttach<Operator>(
        "Operator",
        undefined,
        [p2p.address, params.operatorBond],
        async (contract, attached) => {
            operatorMgr = contract;
            if (attached) return;

            await runStep(1, "Setting operator manager on core", async () => {
                call(core, deployer, (c) => {
                    return c.setOperator(operatorMgr.address);
                });
            });
        },
    );
}

async function deployMarketCore() {
    await deployOrAttach<MarketCore>(
        "MarketCore",
        undefined,
        [params.defaultDisputeDelayDur],
        async (contract, attached) => {
            marketCore = contract;
            if (attached) return;

            await runStep(1, "Setting badge manager", async () => {
                call(marketCore, deployer, (c) => {
                    return c.setBadgeMgr(badgeMgr.address);
                });
            });
        },
    );
}

async function deployCore() {
    let libs = undefined;
    console.log("► Deploying Core libraries");
    libs = await makeLibs(deployed.contracts, console.log);
    console.log("🎉 Deployed Core libraries");

    await deployOrAttach<Core>(
        "Core",
        getCoreLibraries(libs),
        [
            marketCore.address,
            p2p.address,
            params.minTimeToPay,
            params.orderGraceDur,
            params.maxOpenOrders,
            params.maxOpenDisputes,
        ],
        async (contract, attached) => {
            core = contract;
            if (contract) return;

            await runStep(1, "Setting protocol fee", async () => {
                call(core, deployer, (c) => {
                    return c.setProtoFee(12, 14, 10, 1, 1, 10);
                });
            });

            await runStep(1, "Setting fee sharer config", async () => {
                call(core, deployer, (c) => {
                    return c.configureFeePool(params.transferToFeePoolInterval);
                });
            });

            await runStep(1, "Setting protocol recipient", async () => {
                call(core, deployer, (c) => {
                    return c.setInventor(inventor.address);
                });
            });

            await runStep(1, "Adding Core as P2P minter", async () => {
                call(p2p, deployer, (c) => {
                    return c.addMinters([core.address]);
                });
            });

            await runStep(1, "Setting Core as MarketCore writer", async () => {
                call(marketCore, deployer, (c) => {
                    return c.updateWriter(core.address, true);
                });
            });

            await runStep(1, "Setting badge manager", async () => {
                call(core, deployer, (c) => {
                    return c.setBadgeMgr(badgeMgr.address);
                });
            });
        },
    );
}

async function deployAssetRegistry() {
    await deployOrAttach<AssetRegistry>("AssetRegistry", undefined, [], async (contract, attached) => {
        assetReg = contract;
        if (attached) return;

        await runStep(1, "Setting asset registry on Core", async () => {
            call(core, deployer, (c) => {
                return c.setAssetRegistry(assetReg.address);
            });
        });
    });
}

async function deployFeePurse() {
    await deployOrAttach<FeePurse>("FeePurse", undefined, [p2p.address], async (contract, attached) => {
        feePurse = contract;
        if (attached) return;

        await runStep(1, "Setting fee purse on Core", async () => {
            call(core, deployer, (c) => {
                return c.setFeePurse(feePurse.address);
            });

            call(feePurse, deployer, (c) => {
                return c.updateWriter(core.address, true);
            });
        });
    });
}

async function deployRandomness() {
    await deployOrAttach<Randomness>(
        "Randomness",
        undefined,
        [params.chainlinkKeyHash, params.chainlinkCoordinator, params.chainlinkSubId],
        async (contract, attached) => {
            randomness = contract;
            if (attached) return;
        },
    );
}

async function deployDummyRandomness() {
    await deployOrAttach<Randomness>("DummyRandomness", undefined, [], async (contract) => {
        randomness = contract;
    });
}

async function deployMediatorManager() {
    await deployOrAttach<MediatorManager>(
        "MediatorManager",
        undefined,
        [
            p2p.address,
            marketCore.address,
            randomness.address,
            params.ticketCancelDur,
            params.ticketMatureDur,
            params.ticketExpireDur,
        ],
        async (contract, attached) => {
            mediatorMgr = contract;
            if (attached) return;

            await runStep(1, "Setting Ticket Params", async () => {
                call(mediatorMgr, deployer, (c) => {
                    return c.setTicketMarketParams(
                        params.baseTicketPrice,
                        params.ticketWindowDur,
                        params.ticketsPerWindow,
                        params.ticketSupply,
                        params.priceSupplyDeltaBP,
                        params.minInactiveWindowBeforeReset,
                        params.soldOutBP,
                    );
                });
            });

            await runStep(1, "Adding ticket pool", async () => {
                call(mediatorMgr, deployer, (c) => {
                    return c.updateTicketPool(
                        0,
                        params.poolReqBond,
                        params.poolDraftReward,
                        params.poolWinReward,
                        params.poolNoVoteSlashBP,
                        params.poolLoseVoteSlashBP,
                        params.poolNumDraftee,
                    );
                });
            });
        },
    );
}

async function deployDisputeManager() {
    await deployOrAttach<DisputeManager>(
        "DisputeManager",
        undefined,
        [p2p.address, marketCore.address, core.address, mediatorMgr.address, params.predictDur, params.evidenceDur],
        async (contract, attached) => {
            disputeMgr = contract;
            if (contract) return;

            await runStep(1, "Set Core's dispute manager", async () => {
                call(core, deployer, (c) => {
                    return c.setDisputeManager(disputeMgr.address);
                });
            });

            await runStep(1, "Set mediator manager's dispute manager", async () => {
                call(mediatorMgr, deployer, (c) => {
                    return c.setDisputeManager(disputeMgr.address);
                });
            });
        },
    );
}

async function deployFeePool() {
    await deployOrAttach<FeePool>(
        "FeePool",
        undefined,
        [tokenPool.address, core.address],
        async (contract, attached) => {
            feePool = contract;
        },
    );
}

async function deployTokenPoolAndFeePool() {
    await deployOrAttach<TokenPool>("TokenPool", undefined, [p2p.address, p2p.address], async (contract, attached) => {
        tokenPool = contract;
        await deployFeePool();

        if (attached) return;

        await runStep(1, "Setting FeePool on TokenPool contract", async () => {
            call(tokenPool, deployer, (c) => {
                return c.setFeePool(feePool.address);
            });

            call(core, deployer, (c) => {
                return c.setFeePool(feePool.address);
            });
        });
    });
}

async function deployLPPool() {
    await deployOrAttach<LPPool>("LPPool", undefined, [AddressZero, p2p.address], async (contract) => {
        lpPool = contract;
    });
}

async function deployNFT() {
    await deployOrAttach<NFT>(
        "NFT",
        undefined,
        ["NFT", "NFT", "ipfs://abc/", 10000, 0, AddressZero, AddressZero, AddressZero, AddressZero],
        async (contract, attached) => {
            nft = contract;
            if (contract) return;

            await runStep(1, "Setting NFT address and discount on Core contract", async () => {
                call(core, deployer, (c) => {
                    return c.setDiscountForNFTHolder(params.nftDiscountBP);
                });

                call(core, deployer, (c) => {
                    return c.setNFT(nft.address);
                });
            });
        },
    );
}

async function deployEnergon() {
    await deployOrAttach<ENERGON>(
        "ENERGON",
        undefined,
        ["ENERGON", "ENG", "1000000000000000000000000", 18],
        async (contract) => {
            energonAddr = contract;
        },
    );
}

async function deployTestWETH9() {
    await deployOrAttach<WETH9>("WETH9", undefined, [], async (contract) => {});
}

async function deployTestUNI() {
    await deployOrAttach<TOKEN>("TOKEN,UNI", [], ["UNISWAP", "UNI", "1000000000000000000000000000", 18], (c) => {});
}

async function deployTestNGN() {
    await deployOrAttach<TOKEN>(
        "TOKEN,NGN",
        [],
        ["SYNTHETIC NAIRA", "NGN", "1000000000000000000000000000", 18],
        (c) => {},
    );
}

// ###############################################
// ################## Helpers ####################
// ###############################################

/**
 * Attach to previously deployed contract or deploy a new one
 * @param name The name of the contract
 * @param libraries The libraries to link
 * @param args The constructor arguments
 * @param deployFn The function to deploy the contract
 * @returns
 */
async function deployOrAttach<T extends Contract>(
    name: string,
    libraries: any,
    args: any[] = [],
    deployFn: (contract: T, attached: boolean) => void,
) {
    const nameParts = name.split(",");
    const cName = nameParts[0];
    const deploymentName = nameParts.length > 1 ? nameParts[1] : cName;
    let factory = await ethers.getContractFactory(cName, {libraries});
    if (deployed.contracts[deploymentName]) {
        console.log(`► Attaching to ${deploymentName} at ${deployed.contracts[deploymentName].address}`);
        return deployFn(factory.attach(deployed.contracts[deploymentName].address as string) as T, true);
    } else {
        console.log(`► Deploying ${deploymentName}`);
        const contract = (await factory.deploy(...args)) as T;
        const receipt = await contract.deployTransaction.wait();
        deployed.contracts[deploymentName] = {address: contract.address, gasUsed: receipt.gasUsed.toNumber()};
        console.log("🎉 Deployed:", `Address=${contract.address}`, `GasUsed=${receipt.gasUsed.toString()}`);
        return deployFn(contract, false);
    }
}

/**
 * Call a function on a contract
 * @param c The contract
 * @param signer The signer
 * @param func The function to call
 */
async function call<T extends Contract>(c: T, signer: Signer | string, func: (contract: T) => any) {
    const _c = c.connect(signer);
    try {
        const resp = (await func(_c.functions as T)) as ContractTransaction;
        const receipt = resp ? await resp.wait() : undefined;
        txCount = resp ? txCount + 1 : txCount;
        console.log(
            "  🔥",
            `Tx=${txCount}`,
            `Hash=${receipt?.transactionHash}`,
            `GasUsed=${receipt?.gasUsed?.toString() || ""}`,
        );
    } catch (error) {
        throw new Error((error as any).data.message);
    }
}

/**
 * Run a function on a specific STEP and log the result
 * @param step The step ID. If unset, the function will always in any step.
 * @param msg The message to log
 * @param f The function to run
 */
async function runStep(step: number | undefined, msg: string, f: () => Promise<void>) {
    if (process.env.STEP && step && step !== parseInt(process.env.STEP)) return;
    console.log("  *", msg);
    await f();
}

function loadLatestDeployments() {
    if (redeploy) return;
    const hasLatestFile = fs.existsSync(path.join(deploymentDir, "latest.json"));
    if (hasLatestFile) {
        deployed = JSON.parse(fs.readFileSync(path.join(deploymentDir, "latest.json"), "utf8")) as Deployments;
    }
}

function saveDeployments() {
    const hasLatestFile = fs.existsSync(path.join(deploymentDir, "latest.json"));
    if (hasLatestFile) {
        const latest = JSON.parse(fs.readFileSync(path.join(deploymentDir, "latest.json"), "utf8")) as Deployments;
        const created = latest.meta.created;
        fs.writeFileSync(path.join(deploymentDir, `backup-${created}.json`), JSON.stringify(latest, null, 2));
    }

    fs.mkdirSync(path.join(deploymentDir), {recursive: true});
    fs.writeFileSync(path.join(deploymentDir, "latest.json"), JSON.stringify(deployed, null, 2));

    // Count total gas used
    let gasUsed = 0;
    for (const name in deployed.contracts) {
        gasUsed += deployed.contracts[name]?.gasUsed || 0;
    }

    console.log("\n⛽️ Gas used:", gasUsed, "\n");
}

// ###############################################
// ################## Helpers End ################
// ############################################===

(async () => {
    let error: any;
    try {
        loadLatestDeployments();
        await main();
    } catch (e) {
        error = e;
        console.error("ERROR", error);
    } finally {
        saveDeployments();
        process.exit(error ? 1 : 0);
    }
})();
