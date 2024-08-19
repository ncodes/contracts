// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/finance/VestingWallet.sol";
import "../common/Ownable.sol";
import "../pools/interfaces/ITokenPool.sol";
import "../pools/interfaces/IFeePool.sol";

contract WrappedVestingWallet is VestingWallet {
    address public tokenPool;

    constructor(
        address beneficiaryAddress,
        uint64 startTimestamp,
        uint64 durationSeconds
    ) VestingWallet(beneficiaryAddress, startTimestamp, durationSeconds) {}

    event TokenPoolSet(address tokenPool);
    event TokenStaked(address token, uint256 amount);
    event TokenUnstaked(address token, uint256 amount);
    event WithdrawnFeePoolReward(address token, uint256 reward);
    event WithdrawnTokenPoolReward(address token, uint256 reward);

    // only beneficiary modifier
    modifier onlyBeneficiary() {
        require(_msgSender() == beneficiary(), "WVW: NOT_BENEFICIARY");
        _;
    }

    /// @notice Set the token pool address
    /// @param _tokenPool The token pool address
    function setTokenPool(address _tokenPool) public onlyBeneficiary {
        tokenPool = _tokenPool;
        emit TokenPoolSet(_tokenPool);
    }

    /// @notice Release vested tokens
    /// @param token The token address
    function release(address token) public override {
        if (tokenPool != address(0)) {
            uint256 releasable = super.releasable(token);
            uint256 tokenBal = ERC20(token).balanceOf(address(this));
            if (releasable > 0) {
                if (releasable <= tokenBal) {
                    super.release(token);
                } else {
                    ITokenPool(tokenPool).withdraw(releasable - tokenBal);
                    super.release(token);
                }
            }
            return;
        }

        super.release(token);
    }

    /// @notice Stake all tokens in the wallet
    /// @param token The token address
    function stake(address token) public onlyBeneficiary {
        require(tokenPool != address(0), "WVW: NO_TOKEN_POOL");
        uint256 balance = ERC20(token).balanceOf(address(this));
        ITokenPool(tokenPool).stake(balance);
        emit TokenStaked(token, balance);
    }

    /// @notice Unstake all tokens from the pool
    /// @param token The token address
    function unstake(address token) public onlyBeneficiary {
        require(tokenPool != address(0), "WVW: NO_TOKEN_POOL");
        uint256 stakedBal = ITokenPool(tokenPool).balanceOf(address(this));
        ITokenPool(tokenPool).withdraw(stakedBal);
        emit TokenUnstaked(token, stakedBal);
    }

    /// @notice Withdraw fee pool earnings
    /// @param token The token address
    function withdrawFeePoolReward(address token) public onlyBeneficiary {
        address feePool = ITokenPool(tokenPool).getFeePool();
        require(feePool != address(0), "WVW: NO_FEE_POOL");
        uint reward = IFeePool(feePool).earned(address(this), token);
        IFeePool(feePool).withdrawReward(token, reward);
        IERC20(token).transfer(beneficiary(), reward);
        emit WithdrawnFeePoolReward(token, reward);
    }

    /// @notice Withdraw token pool earnings
    /// @param token The token address
    function withdrawTokenPoolReward(address token) public onlyBeneficiary {
        require(tokenPool != address(0), "WVW: NO_TOKEN_POOL");
        uint reward = ITokenPool(tokenPool).earned(address(this));
        ITokenPool(tokenPool).withdrawReward(reward);
        IERC20(token).transfer(beneficiary(), reward);
        emit WithdrawnTokenPoolReward(token, reward);
    }
}
