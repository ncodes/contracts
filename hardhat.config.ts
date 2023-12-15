import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@openzeppelin/hardhat-upgrades";
import "@typechain/hardhat";
import * as dotenv from "dotenv";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import {removeConsoleLog} from "hardhat-preprocessor";
import {HardhatUserConfig, task} from "hardhat/config";
import path from "path";
import "solidity-coverage";
import "./tasks";

const args = require("subarg")(process.argv.slice(2));
const net = args.network || "localhost";

dotenv.config({path: path.join(__dirname, `scripts/${net}/.env`)});
dotenv.config({path: path.join(__dirname, `scripts/${net}/.env.local`)});

task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
    const accounts = await hre.ethers.getSigners();
    for (const account of accounts) {
        console.log(account.address);
    }
});

const deployKey = process.env.DEPLOY_KEY;

module.exports = {
    preprocess: {
        eachLine: removeConsoleLog((hre) => hre.network.name !== "hardhat" && hre.network.name !== "localhost"),
    },
    networks: {
        hardhat: {
            // forking: {
            //     url: `https://mainnet.infura.io/v3/${process.env.API_KEY}`,
            //     blockNumber: 17073960,
            // },
        },
        ethereum: {
            url: `https://mainnet.infura.io/v3/${process.env.API_KEY}`,
            accounts: deployKey ? [process.env.DEPLOY_KEY] : undefined,
        },
        goerli: {
            url: `https://goerli.infura.io/v3/${process.env.API_KEY}`,
            accounts: deployKey ? [process.env.DEPLOY_KEY] : undefined,
        },
        sepolia: {
            url: `https://sepolia.infura.io/v3/${process.env.API_KEY}`,
            accounts: deployKey ? [process.env.DEPLOY_KEY] : undefined,
        },
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY,
    },
    solidity: {
        version: "0.8.13",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },
    gasReporter: {
        enabled: !!process.env.REPORT_GAS,
        currency: "ETH",
        gasPrice: 21,
        coinmarketcap: process.env.CM_KEY,
    },
} as HardhatUserConfig;
