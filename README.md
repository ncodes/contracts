# Joint Contracts

This repository contains the smart contracts for the Joint project. Joint is a peer-to-peer protocol that allows
users to exchange tokens (ERC20, ERC721 and ERC1155) for off-chain assets (e.g. fiat, gift cards, etc.) in a trustless manner. It's fully on-chain and doesn't require any third-party intermediaries.

## Project Structure

In this section, we will describe the relevant structure of the project.

### contracts/

This directory contains the smart contracts for the Joint project. The contracts are written in Solidity and are used to define the logic of the Joint protocol. The contracts are organized in the following way:

- `assetregistry/`: Contains the AssetRegistry contract, which is used to provide fee information for specific assets.
- `badge`: Contains the BadgeManager contract, which is used to create tags/badges that can be applied to markets and liquidities for access control purposes.
- `common`: Contains commonly used libraries and interfaces.
- `core`: Contains the business logic of the Joint protocol. This includes liquidity management, swap, order and offer creation, fee management, and more.
- `feepurse`: Contains the FeePurse contract, which is used to manage fees for markets where the base and quote assets are non-fungible (NFT & Synthetic assets).
- `market`: Contains the MarketCore contract, which is used to create and manage markets.
- `mediator`: Contains the MediatorManager contract, which is used to manage mediators, mediation tickets and market, and drafting/undrafting.
- `minerregistry`: Contains the MinerRegistry contract, which is used to manage miners and their reward allocation and distribution.
- `operator`: Contains the Operator contract, which is used to manage operators.
- `pools`: Contains various token pooling contracts for liquidity management, fee-sharing and token staking.
- `randomness`: Contains random number producing contracts, which is used for random selection of mediators.
- `testutils`: Contains contracts used in tests.
- `token`: Contains various contracts for creating ERC20 tokens.

### scripts/

This directory contains scripts that are used to deploy and interact with the smart contracts. The scripts are written in TypeScript and are used to automate the deployment and testing of the contracts.

### test/

This directory contains all the tests for the smart contracts. The tests are written in TypeScript and are used to ensure that the contracts are functioning as expected.

## Install Dependencies

The dependencies can be installed using the following command:

```shell
yarn
```

## Run tests

The tests can be run using the following command:

```shell
yarn test
```

## Run a local blockchain

If you need to run a local blockchain, you can use the following command:

```shell
yarn run-local-node
```

## Deploy contracts

```shell
env STEP=1 REDEPLOY=true yarn deploy-local
```

where `STEP` is the step number and `REDEPLOY=true` forces previously deployed contracts to be ignored. If REDEPLOY is not set, the deployment will skip contracts that have already been deployed.
Steps are used to classify and configure contract calls in a specific order. Calls with same step number are grouped together and executed in the order they are defined.

## Docker

To build and run a local hardhat chain with the contracts deployed in a docker container using the following command:

```shell
yarn docker:build
```

To run the docker container, you can use the following command:

```shell
yarn docker:run
```
