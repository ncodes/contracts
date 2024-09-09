import {Provider} from "@ethersproject/providers";
import {Decimal} from "decimal.js";
import {BigNumber, BigNumberish, constants} from "ethers";
import {ethers, network} from "hardhat";
import moment from "moment";
import * as erc20 from "../artifacts/contracts/token/TOKEN.sol/TOKEN.json";

export const toHex = ethers.utils.hexlify;

export enum AssetType {
    SYNTH,
    ERC20,
    ERC721,
    ERC1155,
    NATIVE,
}

export enum SourceType {
    Token,
    Native,
    Org,
}

/**
 * Create a market ID
 * @param creatorAddr The creator's address.
 * @param baseAssetAddr The base asset address.
 * @param quoteAssetAddr The quote asset address.
 * @param baseType Base asset type
 * @param quoteType Quote asset type
 * @returns The ID as a Buffer
 */
export function makeMarketID(creatorAddr: string, baseAssetAddr: string, quoteAssetAddr: string, baseType: number, quoteType: number) {
    return ethers.utils.ripemd160(ethers.utils.solidityPack(["address", "address", "address", "uint8", "uint8"], [creatorAddr, baseAssetAddr, quoteAssetAddr, baseType, quoteType]));
}

// BigNumber to Number
export function bnToN(dec: BigNumber) {
    return dec.toNumber();
}

// BigNumber to String
export function bnToS(dec: BigNumber) {
    return dec.toString();
}

export async function getCurBlockTime(nPrev = 0) {
    const blk = await ethers.provider.getBlock((await ethers.provider.getBlockNumber()) - nPrev);
    return Promise.resolve(blk.timestamp);
}

export async function advanceBlockTime(sec = 0) {
    const curBlockTime = await getCurBlockTime();
    const timestamp = moment.unix(curBlockTime).add(sec, "seconds").unix();
    await network.provider.send("evm_setNextBlockTimestamp", [timestamp]);
    await network.provider.send("evm_mine", []);
    return Promise.resolve(timestamp);
}

export async function setBlockTime(t: number) {
    await network.provider.send("evm_setNextBlockTimestamp", [t]);
    return Promise.resolve(t);
}

export async function setBlockTimeNow(t: number) {
    await network.provider.send("evm_setNextBlockTimestamp", [t]);
    await network.provider.send("evm_mine", []);
    return Promise.resolve(t);
}

export async function setAutoMine(on: boolean, interval = 5000) {
    await network.provider.send("evm_setAutomine", [on]);
    await network.provider.send("evm_setIntervalMining", [interval]);
}

export function toDec(val: any) {
    return new Decimal(val?.toString() || val);
}

export function toBN(val: any) {
    return BigNumber.from(val?.toString() || val);
}

export function now() {
    return moment.now();
}

export function pow10(dec: BigNumberish) {
    return BigNumber.from(10).pow(dec);
}

export function pow10str(dec: BigNumberish) {
    return BigNumber.from(10).pow(dec).toString();
}

export function getERC20(provider: Provider, contractAddr: string) {
    return new ethers.Contract(contractAddr, erc20.abi, provider);
}

export const AddressZero = constants.AddressZero;

export function powOf(n: BigNumberish, power: BigNumberish = 18) {
    return toBN(
        toDec(n)
            .mul(toDec(pow10(power)))
            .toFixed(0),
    );
}
