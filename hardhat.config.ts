import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@openzeppelin/hardhat-upgrades";
import "@typechain/hardhat";
import * as dotenv from "dotenv";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import {removeConsoleLog} from "hardhat-preprocessor";
import {HardhatUserConfig} from "hardhat/config";
import path from "path";
import "solidity-coverage";
import "./tasks";

// Get network (default to localhost)
const net = process.env.HARDHAT_NETWORK || "localhost";
const host = process.env.HARDHAT_HOST || "127.0.0.1";

// Load environment variables for the network
dotenv.config({path: path.join(__dirname, `scripts/${net}/.env`)});
dotenv.config({path: path.join(__dirname, `scripts/.env.local`)});

// Get deployer key
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
        // ethereum: {
        //     url: `https://mainnet.infura.io/v3/${process.env.API_KEY}`,
        //     accounts: deployKey ? [process.env.DEPLOY_KEY] : undefined,
        // },
        // goerli: {
        //     url: `https://goerli.infura.io/v3/${process.env.API_KEY}`,
        //     accounts: deployKey ? [process.env.DEPLOY_KEY] : undefined,
        // },
        // sepolia: {
        //     url: `https://sepolia.infura.io/v3/${process.env.API_KEY}`,
        //     accounts: deployKey ? [process.env.DEPLOY_KEY] : undefined,
        //     // gasPrice: 600000000000,
        //     // gasData: {
        //     //     maxFeePerGas: "200000000000",
        //     //     maxPriorityFeePerGas: "200000000000",
        //     //     type: 2,
        //     // },
        // },
        // arbitrum: {
        //     url: "https://arb1.arbitrum.io/rpc",
        //     accounts: deployKey ? [process.env.DEPLOY_KEY] : undefined,
        // },
        // "arbitrum-sepolia": {
        //     url: "https://sepolia-rollup.arbitrum.io/rpc",
        //     accounts: deployKey ? [process.env.DEPLOY_KEY] : undefined,
        // },
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY,
    },
    solidity: {
        version: "0.8.27",
        settings: {
            viaIR: true,
            optimizer: {
                enabled: true,
                runs: 200,
                details: {
                    yulDetails: {
                        optimizerSteps: "u",
                    },
                },
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
