// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IFeePool {
    function depositEth() external payable;

    function notifyWithdraw(address account, uint256 _amount) external;

    function notifyStake(address account, uint256 _amount) external;

    function notifyFeeDeposit(address token, uint256 amount) external;

    function withdrawReward(address feeToken, uint256 _amount) external;

    function earned(address account, address feeToken) external view returns (uint256);
}
