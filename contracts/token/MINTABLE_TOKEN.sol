// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "../common/Ownable.sol";

/// @title MINTABLE_TOKEN
/// @notice This contract represents an old implementation of a mintable token used by the NFT contract.
/// It allows a set of minters to be registered to mint tokens.
/// Since the token contract will not support minting, this contract is only used for testing the NFT contract.
contract MINTABLE_TOKEN is ERC20, ERC20Burnable, Ownable {
    mapping(address => uint256) public minters;
    uint256 public numMinters;
    uint8 _tokenDecimals;

    event AddedMinter(address indexed minter);
    event RemovedMinter(address indexed minter);
    event Minted(address indexed account, uint256 amount);

    /// @dev Modifier to check if sender is a minter
    modifier isMinter() {
        require(minters[msg.sender] > 0, "TOKEN: NOT_MINTER");
        _;
    }

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

    /// @dev Add minters
    /// @param addrs The address of the minters
    function addMinters(address[] memory addrs) public onlyOwner {
        for (uint256 i = 0; i < addrs.length; i++) {
            minters[addrs[i]] = 1;
            numMinters++;
            emit AddedMinter(addrs[i]);
        }
    }

    /// @dev Remove a minter
    /// @param addr The address of the minter
    function removeMinter(address addr) public onlyOwner {
        delete minters[addr];
        numMinters--;
        emit RemovedMinter(addr);
    }

    /// @dev Mint amount for an address.
    /// @param to The account that will receive the minted tokens.
    /// @param amount The amount of tokens to be minted.
    function mint(address to, uint256 amount) external isMinter {
        _mint(to, amount);
        emit Minted(to, amount);
    }
}
