import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {constants} from "ethers";
import {formatBytes32String} from "ethers/lib/utils";
import {ethers} from "hardhat";
import {ENERGON, FeePool, NFT} from "../typechain-types";
import {advanceBlockTime, toBN} from "../utils/utils";
import {MINTABLE_TOKEN} from "./../typechain-types/MINTABLE_TOKEN";

describe("NFT", function () {
    let feePool: FeePool;
    let nft: NFT;
    let e: ENERGON;
    let deployer: SignerWithAddress;
    let user2: SignerWithAddress;
    let notifier: SignerWithAddress;
    let accts: SignerWithAddress[];
    let rewardToken: MINTABLE_TOKEN;
    const maxSupply = 10;
    const treasuryEditionSupply = 5;
    const baseURI = "ipfs://abc/";

    beforeEach(async () => {
        accts = await ethers.getSigners();
        deployer = accts[0];
        user2 = accts[2];
        notifier = accts[3];

        let supply = toBN("500000000000000000000000000");
        let TOKEN = await ethers.getContractFactory("MINTABLE_TOKEN");
        rewardToken = (await TOKEN.deploy("REWARD_TOKEN", "REWARD_TOKEN", supply, 18)) as MINTABLE_TOKEN;

        let supply2 = toBN("1000000000000000000000000");
        let ENERGON = await ethers.getContractFactory("ENERGON");
        e = (await ENERGON.deploy("ENERGON", "ENR", supply2, 18)) as ENERGON;

        let factory = await ethers.getContractFactory("FeePool");
        feePool = (await factory.deploy(constants.AddressZero, notifier.address)) as FeePool;

        let factory2 = await ethers.getContractFactory("NFT");
        nft = (await factory2.deploy(
            "NFT",
            "NFT",
            baseURI,
            maxSupply,
            treasuryEditionSupply,
            feePool.address,
            deployer.address,
            e.address,
            rewardToken.address,
        )) as NFT;
        await nft.setAllocator(deployer.address);
        await nft.toggleAllowMint();
    });

    describe(".setFeePool", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(nft.connect(user2).setFeePool(user2.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully set address", async () => {
            await expect(nft.setFeePool(user2.address)).not.to.be.reverted;
            expect(await nft.feePool()).to.eql(user2.address);
        });
    });

    describe(".setAllocator", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(nft.connect(user2).setAllocator(user2.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully set address", async () => {
            await expect(nft.setAllocator(user2.address)).not.to.be.reverted;
            expect(await nft.allocator()).to.eql(user2.address);
        });
    });

    describe(".setEnergon", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(nft.connect(user2).setEnergon(user2.address)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should successfully set address", async () => {
            await expect(nft.setEnergon(user2.address)).not.to.be.reverted;
            expect(await nft.energon()).to.eql(user2.address);
        });
    });

    describe(".toggleAllowMint", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(nft.connect(user2).toggleAllowMint()).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should be successfully", async () => {
            expect(await nft.allowMint()).to.be.true;
            await expect(nft.toggleAllowMint()).not.to.be.reverted;
            expect(await nft.allowMint()).to.be.false;
        });
    });

    describe(".toggleAllowAlloc", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(nft.connect(user2).toggleAllowAlloc()).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should be successfully", async () => {
            expect(await nft.allowAlloc()).to.be.false;
            await expect(nft.toggleAllowAlloc()).not.to.be.reverted;
            expect(await nft.allowMint()).to.be.true;
        });
    });

    describe(".setBaseURI", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(nft.connect(user2).setBaseURI("/a/b")).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should be successfully", async () => {
            expect(await nft.baseURI()).to.be.eql(baseURI);
            await expect(nft.setBaseURI("ipfs:hidden")).not.to.be.reverted;
            expect(await nft.baseURI()).to.be.eql("ipfs:hidden");
        });
    });

    describe(".setContractURI", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(nft.connect(user2).setContractURI("/a/b")).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should be successfully", async () => {
            expect(await nft.contractURI()).to.be.eql("");
            await expect(nft.setContractURI("ipfs:hidden")).not.to.be.reverted;
            expect(await nft.contractURI()).to.be.eql("ipfs:hidden");
        });
    });

    describe(".setBaseExtension", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(nft.connect(user2).setBaseExtension(".text")).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should be successfully", async () => {
            expect(await nft.baseExtension()).to.be.eql(".json");
            await expect(nft.setBaseExtension(".txt")).not.to.be.reverted;
            expect(await nft.baseExtension()).to.be.eql(".txt");
        });
    });

    describe("setCost", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(nft.connect(user2).setCost(10)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should be successfully", async () => {
            expect(await nft.cost()).to.eql(toBN(0));
            await expect(nft.setCost(100)).not.to.be.reverted;
            expect(await nft.cost()).to.be.eql(toBN(100));
        });
    });

    describe("setMintCost", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(nft.connect(user2).setMintCost(10)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should be successfully", async () => {
            expect(await nft.mintCost()).to.eql(toBN(0));
            await expect(nft.setMintCost(100)).not.to.be.reverted;
            expect(await nft.mintCost()).to.be.eql(toBN(100));
        });
    });

    describe("allowAddr", () => {
        it("should revert with reason=OWNABLE: NOT_OWNER when sender is not owner", async () => {
            await expect(nft.connect(user2).allowAddr(constants.AddressZero, 2, true)).to.be.revertedWith(
                "OWNABLE: NOT_OWNER",
            );
        });

        it("should be successfully", async () => {
            await expect(nft.allowAddr(user2.address, 2, true)).not.to.be.reverted;
            expect(await nft.allowlist(user2.address)).to.be.eql(toBN(2));
            await expect(nft.allowAddr(user2.address, 1, false)).not.to.be.reverted;
            expect(await nft.allowlist(user2.address)).to.be.eql(toBN(1));
        });
    });

    describe(".mintTE", function () {
        it("should revert with msg=NOT_OWNER when sender is not owner", async () => {
            await expect(nft.connect(user2).mintTE(0, 1)).to.be.revertedWith("OWNABLE: NOT_OWNER");
        });

        it("should revert with msg=ID_OUT_OF_RANGE when token ID will be greater than treasury edition supply", async () => {
            await expect(nft.mintTE(treasuryEditionSupply, 1)).to.be.revertedWith("NFT: ID_OUT_OF_RANGE");
            await expect(nft.mintTE(treasuryEditionSupply + 1, 1)).to.be.revertedWith("NFT: ID_OUT_OF_RANGE");
        });

        it("should mint successfully from any index within the treasury edition supply", async () => {
            await expect(nft.mintTE(1, 1)).not.to.be.reverted;
        });

        it("should revert when token id in range has been minted", async () => {
            await expect(nft.mintTE(1, 1)).not.to.be.reverted;
            await expect(nft.mintTE(1, 1)).to.be.revertedWith("ERC721: token already minted");
        });

        it("should mint successfully from any index within the treasury edition supply (2)", async () => {
            await expect(nft.mintTE(1, 4)).not.to.be.reverted;
            const owned = await nft.tokensOfOwner(deployer.address);
            expect(owned[0]).to.eq(1);
            expect(owned[1]).to.eq(2);
            expect(owned[2]).to.eq(3);
            expect(owned[3]).to.eq(4);
            expect(owned[4]).to.eq(5);
        });

        it("should mint successfully from any index within the treasury edition supply (2)", async () => {
            await expect(nft.mintTE(2, 3)).not.to.be.reverted;
            const owned = await nft.tokensOfOwner(deployer.address);
            expect(owned[0]).to.eq(2);
            expect(owned[1]).to.eq(3);
            expect(owned[2]).to.eq(4);
            expect(owned[3]).to.eq(5);
        });

        it("should mint successfully from any index within the treasury edition supply (2)", async () => {
            await expect(nft.mintTE(4, 1)).not.to.be.reverted;
            const owned = await nft.tokensOfOwner(deployer.address);
            expect(owned[0]).to.eq(4);
            expect(owned[1]).to.eq(5);
        });

        it("should mint successfully from any index within the treasury edition supply (2)", async () => {
            await expect(nft.mintTE(5, 0)).not.to.be.reverted;
            const owned = await nft.tokensOfOwner(deployer.address);
            expect(owned[0]).to.eq(5);
        });
    });

    describe(".mint", function () {
        it("should revert with msg=MINT_DISABLED when mint is disabled", async () => {
            await nft.toggleAllowMint();
            await expect(nft.mint(0, false, Buffer.alloc(0), 0)).to.be.revertedWith("NFT: MINT_DISABLED");
        });

        it("should revert with msg=AMOUNT_REQ when mint amount is zero", async () => {
            await expect(nft.mint(0, false, Buffer.alloc(0), 0)).to.be.revertedWith("NFT: AMOUNT_REQ");
        });

        describe("when sender is owner", () => {
            it("should revert with msg=SURPASSED_MAX_SUPPLY when mint will surpass max supply", async () => {
                await expect(nft.mint(maxSupply, false, Buffer.alloc(0), 0)).to.be.revertedWith(
                    "NFT: SURPASSED_MAX_SUPPLY",
                );
                await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                await expect(nft.mint(1, false, Buffer.alloc(0), 0)).to.be.revertedWith("NFT: SURPASSED_MAX_SUPPLY");
            });

            it("should mint successfully", async () => {
                await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                expect(await nft.balanceOf(deployer.address)).to.be.eql(toBN(1));
                expect(await nft.mintedByOwner()).to.eq(1);
            });

            it("should successfully mint max supply", async () => {
                await expect(nft.mint(maxSupply - treasuryEditionSupply, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                expect(await nft.balanceOf(deployer.address)).to.be.eql(toBN(maxSupply - treasuryEditionSupply));
                expect(await nft.mintedByOwner()).to.eq(maxSupply - treasuryEditionSupply);
                const owned = await nft.tokensOfOwner(deployer.address);
                expect(owned[0]).to.eq(treasuryEditionSupply + 1);
                expect(owned[1]).to.eq(treasuryEditionSupply + 2);
                expect(owned[2]).to.eq(treasuryEditionSupply + 3);
                expect(owned[3]).to.eq(treasuryEditionSupply + 4);
                expect(owned[4]).to.eq(treasuryEditionSupply + 5);
            });
        });

        describe("when sender is on the allowlist", () => {
            it("should be successfully mint all slots", async () => {
                await expect(nft.allowAddr(user2.address, 2, true)).not.to.be.reverted;
                await expect(nft.connect(user2).mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                await expect(nft.connect(user2).mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                expect(await nft.balanceOf(user2.address)).to.be.eql(toBN(2));
                expect(await nft.allowlist(user2.address)).to.eql(toBN(0));
                expect(await nft.mintedByAllowlist()).to.eq(2);
            });

            it("should revert with reason=SIG_REQUIRED if all slots have been minted", async () => {
                await expect(nft.allowAddr(user2.address, 1, true)).not.to.be.reverted;
                await expect(nft.connect(user2).mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                expect(await nft.balanceOf(user2.address)).to.be.eql(toBN(1));
                expect(await nft.allowlist(user2.address)).to.eql(toBN(0));
                expect(await nft.mintedByAllowlist()).to.eq(1);
                await expect(nft.connect(user2).mint(1, false, Buffer.alloc(0), 0)).to.be.revertedWith(
                    "NFT: SIG_REQUIRED",
                );
            });

            it("should revert with reason=ABOVE_SLOT_LIMIT if mint amount > slot", async () => {
                await expect(nft.allowAddr(user2.address, 2, true)).not.to.be.reverted;
                await expect(nft.connect(user2).mint(3, false, Buffer.alloc(0), 0)).to.be.revertedWith(
                    "NFT: ABOVE_SLOT_LIMIT",
                );
            });
        });

        describe("when sender is not owner and not on the allowlist", () => {
            it("should revert with reason=SIG_REQUIRED signature was not provided", async () => {
                await expect(nft.connect(user2).mint(1, false, Buffer.alloc(0), 0)).to.be.revertedWith(
                    "NFT: SIG_REQUIRED",
                );
            });

            it("should revert with reason=BAD_SIG when signature is bad", async () => {
                await expect(nft.connect(user2).mint(1, false, Buffer.alloc(65), 0)).to.be.revertedWith("NFT: BAD_SIG");
            });

            it("should revert with reason=EXPIRED_SIG when signature has expired", async () => {
                const expireAt = (await advanceBlockTime(1)) - 1;
                const msgHash = ethers.utils.keccak256(
                    ethers.utils.solidityPack(
                        ["address", "uint256", "bool", "uint256"],
                        [user2.address, toBN(1), false, toBN(expireAt)],
                    ),
                );
                const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                const signedMsg = await deployer.signMessage(msgHashBytes);
                await expect(nft.connect(user2).mint(1, false, signedMsg, expireAt)).to.be.revertedWith(
                    "NFT: EXPIRED_SIG",
                );
            });

            it("should revert with reason=NO_PERMIT when contract is not permitted to receive energon", async () => {
                await nft.setMintCost(1);
                const expireAt = (await advanceBlockTime(1)) + 2;
                const msgHash = ethers.utils.keccak256(
                    ethers.utils.solidityPack(
                        ["address", "uint256", "bool", "uint256"],
                        [user2.address, toBN(1), false, toBN(expireAt)],
                    ),
                );
                const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                const signedMsg = await deployer.signMessage(msgHashBytes);
                await expect(nft.connect(user2).mint(1, false, signedMsg, expireAt)).to.be.revertedWith(
                    "ENERGON: NO_PERMIT",
                );
            });

            it("should revert when contract cannot transfer Energon cost from sender", async () => {
                const cost = 100;
                await e.addRecipient(nft.address);
                await nft.setMintCost(cost);
                const expireAt = (await advanceBlockTime(1)) + 4;
                const msgHash = ethers.utils.keccak256(
                    ethers.utils.solidityPack(
                        ["address", "uint256", "bool", "uint256"],
                        [user2.address, toBN(1), false, toBN(expireAt)],
                    ),
                );
                const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                const signedMsg = await deployer.signMessage(msgHashBytes);
                await expect(nft.connect(user2).mint(1, false, signedMsg, expireAt)).to.be.revertedWith(
                    "ERC20: insufficient allowance",
                );
            });

            it("should successfully mint just 1 token", async () => {
                const cost = 100;
                await e.addRecipient(nft.address);
                await e.addRecipient(user2.address);
                await nft.setMintCost(cost);
                const expireAt = (await advanceBlockTime(1)) + 4;
                const msgHash = ethers.utils.keccak256(
                    ethers.utils.solidityPack(
                        ["address", "uint256", "bool", "uint256"],
                        [user2.address, toBN(1), false, toBN(expireAt)],
                    ),
                );
                const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                const signedMsg = await deployer.signMessage(msgHashBytes);
                await e.transfer(user2.address, cost);
                await e.connect(user2).approve(nft.address, cost);
                await expect(nft.connect(user2).mint(1, false, signedMsg, expireAt)).not.to.be.reverted;
                expect(await nft.balanceOf(user2.address)).to.eql(toBN(1));
                expect(await e.balanceOf(user2.address)).to.eql(toBN(0));
                expect(await e.balanceOf(nft.address)).to.eql(toBN(cost));

                await nft.connect(user2).approve(deployer.address, treasuryEditionSupply + 1);

                expect(await nft.mintedBySig()).to.eq(1);
            });

            context("noEnergon = true", () => {
                it("should successfully mint just 1 token", async () => {
                    const cost = 100;
                    await e.addRecipient(nft.address);
                    await e.addRecipient(user2.address);
                    await nft.setMintCost(cost);
                    const expireAt = (await advanceBlockTime(1)) + 4;
                    const msgHash = ethers.utils.keccak256(
                        ethers.utils.solidityPack(
                            ["address", "uint256", "bool", "uint256"],
                            [user2.address, toBN(1), true, toBN(expireAt)],
                        ),
                    );
                    const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                    const signedMsg = await deployer.signMessage(msgHashBytes);
                    await expect(nft.connect(user2).mint(1, true, signedMsg, expireAt)).not.to.be.reverted;
                    expect(await nft.balanceOf(user2.address)).to.eql(toBN(1));
                    expect(await nft.mintedBySig()).to.eq(1);
                });
            });
        });
    });

    describe(".mint and .mintTE", function () {
        describe("when sender is owner", () => {
            it("should revert with msg=SURPASSED_MAX_SUPPLY when mint will surpass max supply", async () => {
                await expect(nft.mint(maxSupply, false, Buffer.alloc(0), 0)).to.be.revertedWith(
                    "NFT: SURPASSED_MAX_SUPPLY",
                );

                // standard mint 1
                await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                expect(await nft.ownerOf(treasuryEditionSupply + 1)).to.eql(deployer.address);

                // mint treasury supply
                await expect(nft.mintTE(1, 0)).not.to.be.reverted;
                await expect(nft.mintTE(2, 0)).not.to.be.reverted;
                expect(await nft.ownerOf(1)).to.eql(deployer.address);
                expect(await nft.ownerOf(2)).to.eql(deployer.address);

                // standard mint 2
                await expect(nft.mint(2, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                expect(await nft.ownerOf(treasuryEditionSupply + 2)).to.eql(deployer.address);
                expect(await nft.ownerOf(treasuryEditionSupply + 3)).to.eql(deployer.address);

                // mint treasury supply
                await expect(nft.mintTE(3, 2)).not.to.be.reverted;
                expect(await nft.ownerOf(3)).to.eql(deployer.address);
                expect(await nft.ownerOf(4)).to.eql(deployer.address);
                expect(await nft.ownerOf(5)).to.eql(deployer.address);

                // standard mint 3
                await expect(nft.mint(2, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                expect(await nft.ownerOf(treasuryEditionSupply + 4)).to.eql(deployer.address);
                expect(await nft.ownerOf(treasuryEditionSupply + 5)).to.eql(deployer.address);
            });
        });
    });

    describe(".allocate", function () {
        const tokenId = toBN(1 + treasuryEditionSupply);

        beforeEach(async () => {
            await nft.toggleAllowAlloc();
        });

        it("should revert with msg= when token is not owned by the sender", async () => {
            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
            await expect(nft.connect(user2).allocate(tokenId, 1, Buffer.alloc(10))).to.be.revertedWith(
                "NFT: NOT_OWNER",
            );
        });

        it("should revert with msg=BAD_SIG when signature is invalid", async () => {
            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
            await expect(nft.allocate(tokenId, 1, Buffer.alloc(65))).to.be.revertedWith("NFT: BAD_SIG");
        });

        it("should revert with msg=BAD_SIG when allocator did not sign the signature", async () => {
            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
            const signedMsg = await deployer.signMessage(
                ethers.utils.solidityPack(
                    ["address", "uint256", "uint256"],
                    [deployer.address, tokenId, toBN(expectedAmount)],
                ),
            );
            await nft.setAllocator(user2.address);
            await expect(nft.allocate(tokenId, 1, Buffer.from(signedMsg.substring(2), "hex"))).to.be.revertedWith(
                "NFT: BAD_SIG",
            );
        });

        let expectedAmount = 0;

        context("on successful allocation", () => {
            beforeEach(async () => {
                expectedAmount = 10;

                await e.addMinters([nft.address]);
                await rewardToken.addMinters([nft.address]);
                await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                await nft.setCost(1);

                // Sign message
                const msgHash = ethers.utils.keccak256(
                    ethers.utils.solidityPack(
                        ["address", "uint256", "uint256"],
                        [deployer.address, tokenId, toBN(expectedAmount)],
                    ),
                );
                const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                const signedMsg = await deployer.signMessage(msgHashBytes);

                // Allocate
                await nft.setAllocator(deployer.address);
                await expect(nft.allocate(tokenId, expectedAmount, signedMsg, {value: toBN(expectedAmount)}))
                    .to.emit(nft, "Allocated")
                    .withArgs(deployer.address, tokenId, expectedAmount);
            });

            it("should successfully allocate correct tokens to NFT owner", async () => {
                expect(await nft.p2pBalanceOf(tokenId)).to.eql(toBN(expectedAmount));
                expect(await nft.engBalanceOf(tokenId)).to.eql(toBN(expectedAmount));
                expect(await nft.totalAllocated()).to.eql(toBN(expectedAmount));
            });
        });

        context("when transaction balance is insufficient", () => {
            it("should revert with msg=INSUFFICIENT_DEPOSIT", async () => {
                await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
                await nft.setCost(1);

                // Sign message
                const msgHash = ethers.utils.keccak256(
                    ethers.utils.solidityPack(
                        ["address", "uint256", "uint256"],
                        [deployer.address, tokenId, expectedAmount],
                    ),
                );
                const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
                const signedMsg = await deployer.signMessage(msgHashBytes);

                // Attempt allocation with low balance
                await nft.setAllocator(deployer.address);
                await expect(
                    nft.allocate(tokenId, expectedAmount, signedMsg, {value: toBN(expectedAmount - 1)}),
                ).to.be.revertedWith("NFT: INSUFFICIENT_DEPOSIT");
            });
        });
    });

    describe(".depositEnergon", () => {
        it("should revert with reason='DEPOSIT_DISABLED' if deposit is disabled", async () => {
            await expect(nft.connect(user2).depositEnergon(1, 0)).to.be.revertedWith("NFT: DEPOSIT_DISABLED");
        });

        it("should deposit successfully", async () => {
            await nft.toggleAllowEnergonOps();
            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
            expect(await nft.engBalanceOf(1)).to.eq(0);

            await e.addRecipient(nft.address);
            await e.approve(nft.address, 1001);

            await expect(nft.depositEnergon(1, 1000)).not.to.be.reverted;
            expect(await nft.engBalanceOf(1)).to.eq(1000);

            await expect(nft.depositEnergon(1, 1)).not.to.be.reverted;
            expect(await nft.engBalanceOf(1)).to.eq(1001);
        });
    });

    describe(".withdrawEnergon", () => {
        const tokenId = toBN(treasuryEditionSupply + 1);
        it("should revert with reason='WITHDRAW_DISABLED' if withdraw is disabled", async () => {
            await expect(nft.connect(user2).withdrawEnergon(1, 0)).to.be.revertedWith("NFT: WITHDRAW_DISABLED");
        });

        it("should revert with reason='NOT_OWNER' if sender is not token owner", async () => {
            await nft.toggleAllowEnergonOps();
            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
            await expect(nft.connect(user2).withdrawEnergon(tokenId, 0)).to.be.revertedWith("NFT: NOT_OWNER");
        });

        it("should revert with reason='INSUFFICIENT_BAL' if token has insufficient balance", async () => {
            await nft.toggleAllowEnergonOps();
            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
            await expect(nft.withdrawEnergon(tokenId, 1)).to.be.revertedWith("NFT: INSUFFICIENT_BAL");
        });

        it("should deposit successfully", async () => {
            await nft.toggleAllowEnergonOps();
            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
            await e.addRecipient(nft.address);
            await e.addRecipient(deployer.address);
            await e.approve(nft.address, 1000);

            const beforeDepBal = await e.balanceOf(deployer.address);
            await expect(nft.depositEnergon(tokenId, 1000)).not.to.be.reverted;
            expect(await nft.engBalanceOf(tokenId)).to.eq(1000);

            let afterDepBal = await e.balanceOf(deployer.address);
            expect(afterDepBal).to.eql(beforeDepBal.sub(1000));

            await expect(nft.withdrawEnergon(tokenId, 1000)).not.to.be.reverted;
            afterDepBal = await e.balanceOf(deployer.address);
            expect(afterDepBal).to.eql(beforeDepBal);
            expect(await nft.engBalanceOf(tokenId)).to.eq(0);
        });
    });

    describe(".burnEnergon", function () {
        const tokenId = toBN(treasuryEditionSupply + 1);
        let expectedAmount = 0;

        beforeEach(async () => {
            expectedAmount = 10;

            await nft.toggleAllowAlloc();
            await nft.toggleAllowEnergonOps();

            await e.addMinters([nft.address]);
            await rewardToken.addMinters([nft.address]);
            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
            await nft.setCost(1);

            // Sign message
            const msgHash = ethers.utils.keccak256(
                ethers.utils.solidityPack(
                    ["address", "uint256", "uint256"],
                    [deployer.address, tokenId, toBN(expectedAmount)],
                ),
            );
            const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
            const signedMsg = await deployer.signMessage(msgHashBytes);

            // Allocate
            await nft.setAllocator(deployer.address);
            await expect(nft.allocate(tokenId, expectedAmount, signedMsg, {value: toBN(expectedAmount)}))
                .to.emit(nft, "Allocated")
                .withArgs(deployer.address, tokenId, expectedAmount);
        });

        it("should revert with reason='BURN_DISABLED' if burn is disabled", async () => {
            await nft.toggleAllowEnergonOps();
            await expect(nft.connect(user2).burnEnergon(tokenId, 0, formatBytes32String(""))).to.be.revertedWith(
                "NFT: BURN_DISABLED",
            );
        });

        it("should revert with reason='NOT_OWNER' if sender is not owner of token", async () => {
            await expect(nft.connect(user2).burnEnergon(tokenId, 0, formatBytes32String(""))).to.be.revertedWith(
                "NFT: NOT_OWNER",
            );
        });

        it("should revert with reason='INSUFFICIENT_BAL' if sender has insufficient energon balance", async () => {
            await expect(nft.burnEnergon(tokenId, expectedAmount + 1, formatBytes32String(""))).to.be.revertedWith(
                "NFT: INSUFFICIENT_BAL",
            );
        });

        it("should burn successfully", async () => {
            expect(await nft.engBalanceOf(tokenId)).to.eql(toBN(expectedAmount));
            await expect(nft.burnEnergon(tokenId, expectedAmount / 2, formatBytes32String("BUY_LOOT")))
                .to.emit(nft, "BurnedEnergon")
                .withArgs(deployer.address, tokenId, expectedAmount / 2, formatBytes32String("BUY_LOOT"));
        });
    });

    describe(".burnFrom", function () {
        const tokenId = toBN(treasuryEditionSupply + 1);
        let expectedAmount = 10;

        beforeEach(async () => {
            await nft.toggleAllowAlloc();
            await nft.toggleAllowEnergonOps();

            await e.addMinters([nft.address]);
            await rewardToken.addMinters([nft.address]);
            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
            await nft.setCost(1);

            // Sign message
            const msgHash = ethers.utils.keccak256(
                ethers.utils.solidityPack(
                    ["address", "uint256", "uint256"],
                    [deployer.address, tokenId, toBN(expectedAmount)],
                ),
            );
            const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
            const signedMsg = await deployer.signMessage(msgHashBytes);

            // Allocate
            await nft.setAllocator(deployer.address);
            await expect(nft.allocate(tokenId, expectedAmount, signedMsg, {value: toBN(expectedAmount)}))
                .to.emit(nft, "Allocated")
                .withArgs(deployer.address, tokenId, expectedAmount);
        });

        it("should revert with reason='BURN_DISABLED' if burn is disabled", async () => {
            await nft.toggleAllowEnergonOps();
            await expect(nft.connect(user2).burnFrom(tokenId, 1)).to.be.revertedWith("NFT: BURN_DISABLED");
        });

        it("should revert with reason='LOW_ALLOWANCE' if sender has low allowance", async () => {
            await expect(nft.connect(user2).burnFrom(tokenId, 1)).to.be.revertedWith("NFT: LOW_ALLOWANCE");
        });

        it("should revert with reason='INSUFFICIENT_BAL' if sender has low allowance", async () => {
            const allowance = 10 + 1;
            await nft.burnApprove(tokenId, user2.address, allowance + 1);
            expect(await nft.burnAllowance(tokenId, user2.address)).to.eq(allowance + 1);
            await expect(nft.connect(user2).burnFrom(tokenId, allowance + 1)).to.be.revertedWith(
                "NFT: INSUFFICIENT_BAL",
            );
        });

        it("should burn successfully", async () => {
            const allowance = 10;
            await nft.burnApprove(tokenId, user2.address, allowance / 2);
            expect(await nft.burnAllowance(tokenId, user2.address)).to.eq(allowance / 2);
            await expect(nft.connect(user2).burnFrom(tokenId, allowance / 2)).not.to.be.reverted;
            expect(await nft.burnAllowance(tokenId, user2.address)).to.eq(0);
            expect(await e.balanceOf(nft.address)).to.eql(toBN(allowance / 2));
        });
    });

    describe(".tokensOfOwner", () => {
        const tokenId = toBN(treasuryEditionSupply + 1);
        let expectedAmount = 10;

        beforeEach(async () => {
            await nft.toggleAllowAlloc();
            await nft.setCost(1);
            await e.addMinters([nft.address]);
            await rewardToken.addMinters([nft.address]);
            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;

            // Sign message
            const msgHash = ethers.utils.keccak256(
                ethers.utils.solidityPack(
                    ["address", "uint256", "uint256"],
                    [deployer.address, tokenId, toBN(expectedAmount)],
                ),
            );
            const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
            const signedMsg = await deployer.signMessage(msgHashBytes);

            // Allocate
            await nft.setAllocator(deployer.address);
            await expect(nft.allocate(tokenId, expectedAmount, signedMsg, {value: 300})).to.emit(nft, "Allocated");
        });

        it("should return correct tokens", async () => {
            expect(await nft.tokensOfOwner(deployer.address)).to.eql([tokenId]);
        });
    });

    describe(".tokenURI", () => {
        it("should return correct URI when contract is revealed", async () => {
            const tokenId = treasuryEditionSupply + 1;
            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
            expect(await nft.tokenURI(tokenId)).to.eql(`${baseURI}${tokenId}.json`);
        });
    });

    describe(".withdraw", () => {
        const expectedAmount = 10;

        beforeEach(async () => {
            await e.addMinters([nft.address]);
            await rewardToken.addMinters([nft.address]);
            await nft.toggleAllowAlloc();
        });

        it("should withdraw correct amount", async () => {
            const tokenId = toBN(treasuryEditionSupply + 1);

            await expect(nft.mint(1, false, Buffer.alloc(0), 0)).not.to.be.reverted;
            await nft.setCost(1);

            // Sign message
            const msgHash = ethers.utils.keccak256(
                ethers.utils.solidityPack(
                    ["address", "uint256", "uint256"],
                    [deployer.address, tokenId, toBN(expectedAmount)],
                ),
            );
            const msgHashBytes = Buffer.from(msgHash.substring(2), "hex");
            const signedMsg = await deployer.signMessage(msgHashBytes);

            // Allocate
            await nft.setAllocator(deployer.address);
            await expect(nft.allocate(tokenId, expectedAmount, signedMsg, {value: toBN(expectedAmount)})).not.to.be
                .reverted;

            expect(await ethers.provider.getBalance(nft.address)).to.eql(toBN(expectedAmount));
            const before = await deployer.getBalance();

            // Withdraw
            const txr = await (await nft.withdraw()).wait();
            expect(await ethers.provider.getBalance(nft.address)).to.eql(toBN(0));
            const expectedBal = before.sub(txr.gasUsed.mul(txr.effectiveGasPrice)).add(expectedAmount);
            expect(await deployer.getBalance()).to.eql(expectedBal);
        });
    });

    describe(".royaltyInfo", function () {
        beforeEach(async () => {
            await e.addMinters([nft.address]);
            await rewardToken.addMinters([nft.address]);
            await nft.toggleAllowAlloc();
            await nft.mint(1, false, Buffer.alloc(0), 0);
        });

        it("should return correct royalty info", async () => {
            await nft.setDefaultRoyalty(deployer.address, 1000);
            expect(await nft.royaltyInfo(1, 100)).to.eql([deployer.address, toBN(10)]);
        });
    });
});
