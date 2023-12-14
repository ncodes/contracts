import {task} from "hardhat/config";

task("genkey", "Generate a random private key").setAction(async (_args, hre) => {
    const wallet = hre.ethers.Wallet.createRandom();
    console.log(wallet.address);
    console.log(wallet.privateKey);
});
