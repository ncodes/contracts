import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {PriceRegistry} from "../typechain-types";
import {advanceBlockTime} from "../utils/utils";

describe("PriceRegistry", function () {
    let user2: SignerWithAddress;
    let user3: SignerWithAddress;
    let accts: SignerWithAddress[];
    let priceReg: PriceRegistry;

    beforeEach(async () => {
        accts = await ethers.getSigners();
        user2 = accts[1];
        user3 = accts[2];

        let factory = await ethers.getContractFactory("PriceRegistry");
        priceReg = (await factory.deploy()) as PriceRegistry;
    });

    describe(".addOracle", () => {
        it("should revert with msg='OWNABLE: NOT_OWNER' when called by non-owner", async () => {
            await expect(priceReg.connect(user2).addOracle(user2.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should revert with msg='PR: ZERO_ADDRESS' when called with zero address", async () => {
            await expect(priceReg.addOracle(ethers.constants.AddressZero)).to.be.revertedWith("PR: ZERO_ADDRESS");
        });

        it("should successfully add an oracle when called by owner", async () => {
            await expect(priceReg.addOracle(user2.address)).to.emit(priceReg, "OracleAdded").withArgs(user2.address);
            expect(await priceReg.oracles(user2.address)).to.be.true;
        });
    });

    describe(".removeOracle", () => {
        it("should revert with msg='OWNABLE: NOT_OWNER' when called by non-owner", async () => {
            await expect(priceReg.connect(user2).removeOracle(user2.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should revert with msg='PR: ZERO_ADDRESS' when called with zero address", async () => {
            await expect(priceReg.removeOracle(ethers.constants.AddressZero)).to.be.revertedWith("PR: ZERO_ADDRESS");
        });

        it("should successfully remove an oracle when called by owner", async () => {
            await priceReg.addOracle(user2.address);
            await expect(priceReg.removeOracle(user2.address)).to.emit(priceReg, "OracleRemoved").withArgs(user2.address);
            await expect(priceReg.removeOracle(user2.address)).to.emit(priceReg, "OracleRemoved").withArgs(user2.address);
            expect(await priceReg.oracles(user2.address)).to.be.false;
        });
    });

    describe(".setPriceStaleDuration", () => {
        it("should revert with msg='OWNABLE: NOT_OWNER' when called by non-owner", async () => {
            await expect(priceReg.connect(user2).setPriceStaleDuration(1000)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully update the price stale duration when called by owner", async () => {
            await expect(priceReg.setPriceStaleDuration(1000)).to.emit(priceReg, "UpdatedPriceStaleDuration").withArgs(1000);
            expect(await priceReg.priceStaleDuration()).to.equal(1000);
        });
    });

    describe(".setMaxBatchSize", () => {
        it("should revert with msg='OWNABLE: NOT_OWNER' when called by non-owner", async () => {
            await expect(priceReg.connect(user2).setMaxBatchSize(100)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should revert with msg='PR: MAX_BATCH_SIZE_TOO_LOW' when called with a value less than 1", async () => {
            await expect(priceReg.setMaxBatchSize(0)).to.be.revertedWith("PR: MAX_BATCH_SIZE_TOO_LOW");
        });

        it("should successfully update the max batch size when called by owner", async () => {
            await expect(priceReg.setMaxBatchSize(100)).to.emit(priceReg, "UpdatedMaxBatchSize").withArgs(100);
            expect(await priceReg.maxBatchSize()).to.equal(100);
        });
    });

    describe(".updatePrice", () => {
        it("should revert with msg='PRICE_REGISTRY: NOT_ORACLE' when called by non-oracle", async () => {
            await expect(priceReg.connect(user2).updatePrice(user2.address, 100)).to.be.revertedWith("PR: NOT_ORACLE");
        });

        it("should successfully update the price of an asset when called by an oracle", async () => {
            await priceReg.addOracle(user2.address);
            await expect(priceReg.connect(user2).updatePrice(user2.address, 100)).to.emit(priceReg, "PriceUpdated").withArgs(user2.address, 100);
            expect(await priceReg.prices(user2.address)).to.equal(100);
        });

        it("should revert with msg='PR: UPDATE_TOO_FREQUENT' when called too frequently", async () => {
            await priceReg.addOracle(user2.address);
            await expect(priceReg.connect(user2).updatePrice(user2.address, 100)).not.to.be.reverted;
            await expect(priceReg.connect(user2).updatePrice(user2.address, 100)).to.be.revertedWith("PR: UPDATE_TOO_FREQUENT");
            await advanceBlockTime((await priceReg.MIN_INTERVAL_BETWEEN_UPDATES()).toNumber());
            await expect(priceReg.connect(user2).updatePrice(user2.address, 100)).not.to.be.reverted;
        });

        it("should revert with msg='PR: PRICE_CHANGE_TOO_LARGE' when the price change is too large", async () => {
            await priceReg.addOracle(user2.address);
            await expect(priceReg.connect(user2).updatePrice(user2.address, 100)).not.to.be.reverted;
            await advanceBlockTime(30);
            await expect(priceReg.connect(user2).updatePrice(user2.address, 131)).to.be.revertedWith("PR: PRICE_CHANGE_TOO_LARGE");
            await expect(priceReg.connect(user2).updatePrice(user2.address, 69)).to.be.revertedWith("PR: PRICE_CHANGE_TOO_LARGE");
        });
    });

    describe(".updatePriceMulti", () => {
        it("should revert with msg='PRICE_REGISTRY: NOT_ORACLE' when called by non-oracle", async () => {
            await expect(priceReg.connect(user2).updatePriceMulti([user2.address], [100])).to.be.revertedWith("PR: NOT_ORACLE");
        });

        it("should revert with msg='PR: LENGTH_MISMATCH' when assets and price array lenght mismatch", async () => {
            await priceReg.addOracle(user2.address);
            await expect(priceReg.connect(user2).updatePriceMulti([user2.address, user3.address], [100])).to.be.revertedWith("PR: LENGTH_MISMATCH");
        });

        it("should revert with msg='PR: BATCH_TOO_LARGE' when batch size is greater than max batch size", async () => {
            await priceReg.addOracle(user2.address);
            await priceReg.setMaxBatchSize(1);
            await expect(priceReg.connect(user2).updatePriceMulti([user2.address, user3.address], [100, 200])).to.be.revertedWith("PR: BATCH_TOO_LARGE");
        });

        it("should successfully update the price of multiple assets when called by an oracle", async () => {
            await priceReg.addOracle(user2.address);
            await expect(priceReg.connect(user2).updatePriceMulti([user2.address, user3.address], [100, 200]))
                .to.emit(priceReg, "PriceUpdated")
                .withArgs(user2.address, 100);
            expect(await priceReg.prices(user2.address)).to.equal(100);
            expect(await priceReg.prices(user3.address)).to.equal(200);
        });
    });

    describe(".getBasePrice", () => {
        it("should revert with msg='BASE_PRICE_ZERO' when the base price is zero", async () => {
            await expect(priceReg.getBasePrice(user2.address, user3.address, 0)).to.be.revertedWith("BASE_PRICE_ZERO");
        });

        it("should revert with msg='QUOTE_PRICE_ZERO' when the quote price is zero", async () => {
            await priceReg.addOracle(user2.address);
            await priceReg.connect(user2).updatePrice(user2.address, "15640000000000000000");
            await expect(priceReg.getBasePrice(user2.address, user3.address, 0)).to.be.revertedWith("QUOTE_PRICE_ZERO");
        });

        it("should revert with msg='PRICE_STALE' when the price is stale", async () => {
            await priceReg.addOracle(user2.address);
            await priceReg.connect(user2).updatePrice(user2.address, "15640000000000000000");
            await priceReg.connect(user2).updatePrice(user3.address, "1440000000000000000");
            await priceReg.setPriceStaleDuration(10);
            await advanceBlockTime(10);
            await expect(priceReg.getBasePrice(user2.address, user3.address, 0)).to.be.revertedWith("PR: STALE_PRICE");
        });

        it("should successfully get the price of a base asset in terms of a quote asset, with scaling factor of 0", async () => {
            await priceReg.addOracle(user2.address);
            await priceReg.connect(user2).updatePrice(user2.address, "15640000000000000000");
            await priceReg.connect(user2).updatePrice(user3.address, "1440000000000000000");
            expect(await priceReg.getBasePrice(user2.address, user3.address, 0)).to.equal("10861111111111111111");
        });

        it("should successfully get the price of a base asset in terms of a quote asset, with scaling factor of 1000 bps", async () => {
            await priceReg.addOracle(user2.address);
            await priceReg.connect(user2).updatePrice(user2.address, "15640000000000000000");
            await priceReg.connect(user2).updatePrice(user3.address, "1440000000000000000");
            expect(await priceReg.getBasePrice(user2.address, user3.address, 1000)).to.equal("11947222222222222222");
        });

        it("should successfully get the price of a base asset in terms of a quote asset, with scaling factor of -1000 bps", async () => {
            await priceReg.addOracle(user2.address);
            await priceReg.connect(user2).updatePrice(user2.address, "15640000000000000000");
            await priceReg.connect(user2).updatePrice(user3.address, "1440000000000000000");
            expect(await priceReg.getBasePrice(user2.address, user3.address, -1000)).to.equal("9775000000000000000");
        });
    });
});
