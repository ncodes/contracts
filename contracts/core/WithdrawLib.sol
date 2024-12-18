// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import "./StructsLib.sol";
import "../token/interfaces/IERC20.sol";
import "../common/SafeERC20.sol";
import "../pools/interfaces/IFeePool.sol";
import "../feepurse/interfaces/IFeePurse.sol";
import "../market/interfaces/IMarketCore.sol";
import "hardhat/console.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

library WithdrawLib {
    using SafeERC20 for IERC20;

    event TransferredToFeePool(address indexed token, uint256 amount);
    event TransferInventorBalance(address owner, address token, uint256 amount);
    event TransferOperatorBalance(address owner, address token, uint256 amount);

    /// @dev Withdraw fees allocated to the protocol inventor
    /// @param state State object
    /// @param asset The address of the asset the fee is denominated in.
    function withdrawInventorBalance(StructsLib.State storage state, StructsLib.State2 storage state2, address asset) public {
        uint256 bal = state.inventorBalance[asset];
        state.inventorBalance[asset] = 0;

        if (IMarketCore(state2.marketCore).getNativeAssetAddr() == asset) {
            payable(state.inventor).transfer(bal);
        } else {
            IERC20(asset).transfer(state.inventor, bal);
        }

        emit TransferInventorBalance(state.inventor, asset, bal);

        bal = state2.feePurse.balanceOf(state.inventor);
        if (bal > 0) {
            state2.feePurse.withdrawFrom(bal, state.inventor, state.inventor);
            emit TransferInventorBalance(state.inventor, asset, bal);
        }
    }

    /// @dev Withdraw fees allocated to operator (include fees in FeePurse)
    /// @param state State object
    /// @param state2 State object
    /// @param token The address of the token the fee is denominated in.
    function withdrawOperatorBalance(StructsLib.State storage state, StructsLib.State2 storage state2, address token) public {
        uint256 bal = state.operatorsBalance[msg.sender][token];

        state.operatorsBalance[msg.sender][token] = 0;

        if (IMarketCore(state2.marketCore).getNativeAssetAddr() == token) {
            payable(msg.sender).transfer(bal);
        } else {
            IERC20(token).transfer(msg.sender, bal);
        }

        emit TransferOperatorBalance(msg.sender, token, bal);

        bal = state2.feePurse.balanceOf(msg.sender);
        if (bal > 0) {
            state2.feePurse.withdrawFrom(bal, msg.sender, msg.sender);
            emit TransferOperatorBalance(msg.sender, token, bal);
        }
    }

    /// @dev Transfer fees earned on shareable assets to the fee reward contract (include fees in FeePurse)
    /// @param state State object
    /// @param state2 State object
    /// @param token The address of a shareable token
    function transferToFeePool(StructsLib.State storage state, StructsLib.State2 storage state2, address token) public {
        uint256 lastTx = state.lastFeePoolTransfer[token];
        require(lastTx == 0 || block.timestamp - lastTx > state.feePoolTxInterval, "OC: NOT_READY");

        uint256 bal = state.shareablesBalance[token];
        if (bal > 0) {
            // Clear the balance and set last transfer time
            state.shareablesBalance[token] = 0;
            state.lastFeePoolTransfer[token] = block.timestamp;

            if (IMarketCore(state2.marketCore).getNativeAssetAddr() == token) {
                state2.feePool.depositEth{value: bal}();
            } else {
                IERC20(token).transfer(address(state2.feePool), bal);
                state2.feePool.notifyFeeDeposit(token, bal);
            }

            // Notify fee pool of new deposit
            emit TransferredToFeePool(token, bal);
        }

        // Transfer shareable fees held in feepurse to feepool
        bal = state2.feePurse.balanceOf(address(this));
        if (bal > 0) {
            state2.feePurse.withdraw(bal, address(state2.feePool));
            state2.feePool.notifyFeeDeposit(address(state2.feePurse.getFeeToken()), bal);
            emit TransferredToFeePool(address(state2.feePurse.getFeeToken()), bal);
        }
    }
}
