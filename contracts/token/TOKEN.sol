// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract TOKEN is ERC20, ERC20Burnable {
    uint8 _tokenDecimals;

    /// @dev Initialize contract
    /// @param _name The name of the token
    /// @param _symbol The token symbol
    /// @param _initialSupply The initial supply
    /// @param _decimals The token's decimals
    constructor(string memory _name, string memory _symbol, uint256 _initialSupply, uint8 _decimals) ERC20(_name, _symbol) {
        _tokenDecimals = _decimals;
        _mint(msg.sender, _initialSupply);
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }
}
