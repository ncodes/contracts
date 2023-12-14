import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {getParams, Network} from "./params";
import {constants} from "ethers";
import {ENERGON} from "../typechain-types";
import {toBN} from "../utils/utils";

const {getContractFactory: getFactory} = ethers;

const params = getParams((process.env.NETWORK as any) || Network.Goerli);

async function logAndRun(msg: string, f: () => void) {
    console.log("  *", msg);
    await f();
}

let deployer: SignerWithAddress;
let accts: SignerWithAddress[];
let energon: ENERGON;
const gasPrice = undefined;

async function main() {
    accts = await ethers.getSigners();
    deployer = accts[0];

    await deployEnergon();
    await deployNFT();
}

async function deployEnergon() {
    console.log("► Deploying Energon");
    let ENERGON = await getFactory("ENERGON");
    energon = await ENERGON.deploy("ENERGON", "ENG", "0", 18);
    await logAndRun("Set allocator", async () => {
        await energon.setAllocator(params.allocatorAddr);
    });
    // await logAndRun("Transfer ownership to SAFE", async () => {
    //     await energon.transferOwnership(params.safe);
    // });
    console.log("- Deployed:", energon.address);
}

async function deployNFT() {
    console.log("► Deploying NFT");

    // Deployed Energon
    // energon = (await getFactory("ENERGON")).attach("0x7787d10f8f277bc509fb79c68bfc508d69dd41dc");

    let NFT = await getFactory("NFT");
    const maxSupply = 10000;
    const treasuryEditionSupply = 1000;
    const baseURI = "ipfs://abc/";
    const mintCost = toBN("500000000000000000000");
    const nft = await NFT.deploy(
        "DroidPD",
        "DROID",
        baseURI,
        maxSupply,
        treasuryEditionSupply,
        constants.AddressZero,
        params.allocatorAddr,
        energon.address,
        constants.AddressZero,
        {gasPrice: gasPrice}
    );
    await logAndRun("Enable minting", async () => {
        await nft.toggleAllowMint();
    });
    await logAndRun("Setting mint cost", async () => {
        await nft.setMintCost(mintCost, {gasPrice});
    });

    await logAndRun("Permit NFT to transfer Energon", async () => {
        await energon.addRecipient(nft.address);
    });

    // await logAndRun("Transfer ownership to SAFE", async () => {
    //     await nft.transferOwnership(params.safe, {gasPrice, nonce: 6});
    // });

    console.log("- Deployed:", nft.address);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
