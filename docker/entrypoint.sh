#!/bin/sh

# Change to the correct directory
cd /usr/src/app;

# Start hardhat node as a background process
yarn run-local-node &

# Wait for hardhat node to initialize and then deploy contracts
npx wait-on http://127.0.0.1:8545 && env STEP=1 REDEPLOY=true yarn deploy-local;

# Auto mine
npx hardhat auto-mine --network localhost;

# The hardhat node process never completes
# Waiting prevents the container from pausing
wait $!
