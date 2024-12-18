// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract ERC1155T is ERC1155 {
    constructor() ERC1155("") {}

    function mint(uint256 id) public {
        _mint(msg.sender, id, 1, "");
    }
}
