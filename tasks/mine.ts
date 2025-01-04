import {utils} from "ethers";
import {task, types} from "hardhat/config";

task("auto-mine", "Start auto mining")
    .addFlag("off", "Disable auto mining")
    .addOptionalParam("interval", "The interval in milliseconds to mine", 60000, types.int)
    .setAction(async (_args, hre) => {
        _args.interval = _args.off ? 0 : _args.interval;
        await hre.network.provider.send("evm_setAutomine", [!_args.off]);
        await hre.network.provider.send("evm_setIntervalMining", [_args.interval]);
    });

task("mine", "Mine one or more block")
    .addOptionalParam("n", "The number of blocks to mine", 1, types.int)
    .setAction(async (_args, hre) => {
        await hre.network.provider.send("hardhat_mine", [utils.hexlify(_args.n)]);
    });
