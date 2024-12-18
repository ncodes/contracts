// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IERC721Strip {
    function balanceOf(address owner) external view returns (uint256 balance);

    function transferFrom(address from, address to, uint256 tokenId) external;

    function ownerOf(uint256 _tokenId) external view returns (address);
}

interface IERC1155Strip {
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;

    function balanceOf(address _owner, uint256 _id) external view returns (uint256);
}
