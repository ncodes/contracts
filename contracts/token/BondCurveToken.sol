// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "../common/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract BondCurveToken is ERC20, Ownable {
    uint8 _tokenDecimals;
    bytes32 public root;
    mapping(uint256 => mapping(address => int)) public usedClaims;
    mapping(address => uint256) public claims;
    uint256 public devAlloc;
    uint public devFeeBp;
    uint256 public devFeeEthBal;
    uint256 public claimedBalance;
    uint256 public airdropAlloc;
    uint256 public k = 127330000000;
    uint256 public bondingCurveAlloc;
    uint256 public initialBondingCurveAlloc;
    uint256 public bondingCurveEthBal;
    uint256 public minBuyForReset;
    bool public allowTrade = false;
    bool public allowClaim = false;
    bool public allowWithdraw = false;
    bool public allowSell = false;
    bool public allowBuyTransfer = false;
    uint256 _scale = 1e18;

    /// @dev Initialize contract
    /// @param _name The name of the token
    /// @param _symbol The token symbol
    /// @param _initialSupply The initial supply
    /// @param _decimals The token's decimals
    /// @param _airdropTreeRoot The merkle root for the airdrop distribution
    /// @param _airdropAlloc The airdrop supply
    /// @param _devAlloc The dev supply
    /// @param _bondingCurveAlloc The bonding curve supply
    /// @param _devFeeBp The dev fee in basis points
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply,
        uint8 _decimals,
        bytes32 _airdropTreeRoot,
        uint256 _airdropAlloc,
        uint256 _devAlloc,
        uint256 _bondingCurveAlloc,
        uint256 _devFeeBp
    ) ERC20(_name, _symbol) {
        _tokenDecimals = _decimals;
        bondingCurveAlloc = _bondingCurveAlloc;
        initialBondingCurveAlloc = _bondingCurveAlloc;
        devAlloc = _devAlloc;
        devFeeBp = _devFeeBp;
        root = _airdropTreeRoot;
        airdropAlloc = _airdropAlloc;
        _mint(msg.sender, _initialSupply);
    }

    event Claimed(address addr, uint claimId, uint256 allocation);
    event ClaimWithdrawn(address addr, uint256 amount);
    event WithdrawnToken(address beneficiary, uint256 amount);
    event AllowTrade(bool allowTrade);
    event AllowSell(bool allowSell);
    event AllowClaim(bool allowClaim);
    event AllowWithdraw(bool allowWithdraw);
    event AllowBuyTransfer(bool allowBuyTransfer);
    event Buy(address buyer, uint256 input, uint256 output, uint256 fee);
    event Sell(address seller, uint256 input, uint256 output, uint256 fee);
    event UpdatedMinBuyForReset(uint256 minBuyForReset);
    event UpdatedDevFeeBp(uint devFeeBp);
    event WithdrawnEth(address beneficiary, uint256 amount);
    event WithdrawnDevFee(address beneficiary, uint256 amount);
    event ReInitialized(bytes32 root, uint256 airdropAlloc, uint256 devAlloc, uint256 bondingCurveAlloc, uint256 devFeeBp, uint256 k);

    /// @notice Get the token's decimals
    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    /// @notice Reinitialize the contract
    /// @param _airdropTreeRoot The merkle root for the airdrop distribution
    /// @param _devAlloc The dev supply
    /// @param _bondingCurveAlloc The bonding curve supply
    /// @param _devFeeBp The dev fee in basis points
    /// @param _k The k value
    function reInit(
        bytes32 _airdropTreeRoot,
        uint256 _airdropAlloc,
        uint256 _devAlloc,
        uint256 _bondingCurveAlloc,
        uint256 _devFeeBp,
        uint256 _k
    ) public onlyOwner {
        root = _airdropTreeRoot;
        airdropAlloc = _airdropAlloc;
        devAlloc = _devAlloc;
        initialBondingCurveAlloc = _bondingCurveAlloc;
        bondingCurveAlloc = _bondingCurveAlloc;
        devFeeBp = _devFeeBp;
        k = _k;
        emit ReInitialized(root, airdropAlloc, devAlloc, bondingCurveAlloc, devFeeBp, k);
    }

    /// @notice Toggle to enable or disable buy/sell operations
    function toggleAllowTrade() public onlyOwner {
        allowTrade = !allowTrade;
        emit AllowTrade(allowTrade);
    }

    /// @notice Toggle to enable or disable sell option
    function toggleAllowSell() public onlyOwner {
        allowSell = !allowSell;
        emit AllowSell(allowSell);
    }

    /// @notice Toggle to enable or disable claim option
    function toggleAllowClaim() public onlyOwner {
        allowClaim = !allowClaim;
        emit AllowClaim(allowClaim);
    }

    /// @notice Toggle to enable or disable buy transfer option
    function toggleAllowBuyTransfer() public onlyOwner {
        allowBuyTransfer = !allowBuyTransfer;
        emit AllowBuyTransfer(allowBuyTransfer);
    }

    /// @notice Toggle to enable or disable withdraw option
    function toggleAllowWithdraw() public onlyOwner {
        allowWithdraw = !allowWithdraw;
        emit AllowWithdraw(allowWithdraw);
    }

    /// @notice Set the minimum buy for reset
    /// @param _minBuyForReset The minimum buy amount
    function setMinBuyForReset(uint256 _minBuyForReset) public onlyOwner {
        minBuyForReset = _minBuyForReset;
        emit UpdatedMinBuyForReset(minBuyForReset);
    }

    /// @notice Set the dev fee in basis points
    /// @param _devFeeBp The dev fee in basis points
    function setDevFeeBp(uint _devFeeBp) public onlyOwner {
        require(_devFeeBp <= 1000, "FEE_TOO_HIGH");
        devFeeBp = _devFeeBp;
        emit UpdatedDevFeeBp(devFeeBp);
    }

    /// @notice Verify and claim reward
    /// @param proof The merkle proof
    /// @param addr The address to claim the reward
    /// @param claimId The claim id presents the type of reward
    /// @param allocation The allocation to claim
    function claim(bytes32[] memory proof, address addr, uint claimId, uint256 allocation) public {
        require(allowClaim, "CLAIM_NOT_ALLOWED");
        require(addr == msg.sender, "SENDER_MUST_BE_ADDR");

        // verify the merkle proof
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(addr, claimId, allocation))));
        require(MerkleProof.verify(proof, root, leaf), "Invalid proof");

        // check if the claim is used for the sender
        require(usedClaims[claimId][addr] == 0, "CLAIM_USED");
        usedClaims[claimId][addr] = 1;

        // Increment claimed balance
        claimedBalance += allocation;
        require(claimedBalance <= airdropAlloc, "CLAIM_ALLOC_EXCEEDED");

        claims[addr] += allocation;

        emit Claimed(addr, claimId, allocation);
    }

    /// @notice Verify and claim multiple rewards
    /// @param proofs The merkle proofs
    /// @param addr The address to claim the reward
    /// @param claimIds The claim ids
    /// @param allocations The allocations
    function claimMulti(bytes32[][] memory proofs, address addr, uint[] memory claimIds, uint256[] memory allocations) public {
        for (uint i = 0; i < proofs.length; i++) {
            claim(proofs[i], addr, claimIds[i], allocations[i]);
        }
    }

    /// @notice Withdraw a claim
    function withdrawClaim() public {
        require(allowWithdraw, "WITHDRAW_NOT_ALLOWED");
        uint256 amount = claims[msg.sender];
        claims[msg.sender] = 0;
        ERC20(address(this)).transfer(msg.sender, amount);
        emit ClaimWithdrawn(msg.sender, amount);
    }

    /// @notice Withdraw all tokens from the contract
    /// @param beneficiary The beneficiary address
    function withdrawToken(address beneficiary) public onlyOwner {
        uint256 amount = ERC20(address(this)).balanceOf(address(this));
        ERC20(address(this)).transfer(beneficiary, amount);
        emit WithdrawnToken(beneficiary, amount);
    }

    /// @notice Withdraw all ETH from the contract
    function withdrawEth(address beneficiary) public onlyOwner {
        uint256 amount = address(this).balance;
        emit WithdrawnEth(beneficiary, amount);
        payable(beneficiary).transfer(amount);
    }

    /// @notice Withdraw all dev fee from the contract
    function withdrawDevFee(address beneficiary) public onlyOwner {
        uint256 amount = devFeeEthBal;
        devFeeEthBal = 0;
        emit WithdrawnDevFee(beneficiary, amount);
        payable(beneficiary).transfer(amount);
    }

    /// @notice Returns the circulating supply
    function circulatingSupply() public view returns (uint256) {
        return devAlloc + claimedBalance + (initialBondingCurveAlloc - bondingCurveAlloc);
    }

    /// @notice Buy tokens
    function buy(uint256 maxPrice) public payable {
        require(allowTrade, "TRADE_NOT_ALLOWED");

        uint256 value = msg.value;
        require(value > 0, "INVALID_AMOUNT");

        uint256 devFee = (value * devFeeBp) / 10000;
        value = value - devFee;
        devFeeEthBal += devFee;

        uint256 price = buyPrice(circulatingSupply());
        require(price <= maxPrice, "PRICE_TOO_HIGH");

        uint256 amount = (value * _scale) / price;
        require(amount <= bondingCurveAlloc, "INSUFFICIENT_ALLOC");
        bondingCurveAlloc -= amount;
        bondingCurveEthBal += value;

        if (value >= minBuyForReset) {
            usedClaims[0][msg.sender] = 0;
        }

        if (allowBuyTransfer) {
            ERC20(address(this)).transfer(msg.sender, amount);
        } else {
            claims[msg.sender] += amount;
        }

        emit Buy(msg.sender, msg.value, amount, devFee);
    }

    /// @notice Sell tokens
    /// @param amount The amount to sell
    /// @param minPrice The minimum price to sell
    function sell(uint256 amount, uint256 minPrice) public {
        require(allowTrade, "TRADE_NOT_ALLOWED");
        require(allowSell, "SELL_NOT_ALLOWED");
        require(amount > 0, "INVALID_AMOUNT");

        uint256 price = sellPrice(circulatingSupply(), amount);
        require(price >= minPrice, "PRICE_TOO_LOW");

        uint256 value = (amount * price) / _scale;

        bondingCurveAlloc += amount;
        bondingCurveEthBal -= value;

        uint256 devFee = (value * devFeeBp) / 10000;
        devFeeEthBal += devFee;
        value = value - devFee;

        payable(msg.sender).transfer(value);
        ERC20(address(this)).transferFrom(msg.sender, address(this), amount);

        emit Sell(msg.sender, amount, value, devFee);
    }

    /// @notice Get the buy price
    /// @param supply The supply
    function buyPrice(uint256 supply) public view returns (uint256) {
        if (supply <= 0) return 0;
        return (k * (supply ** 2)) / (_scale * _scale) / _scale;
    }

    /// @notice Get the sell price
    /// @param supply The supply
    /// @param amountToSell The amount to sell
    function sellPrice(uint256 supply, uint256 amountToSell) public view returns (uint256) {
        require(supply >= amountToSell, "INSUFFICIENT_SUPPLY");
        if (supply <= 0 || amountToSell <= 0) return 0;

        uint256 newSupply = supply - amountToSell;
        if (newSupply == 0) return _scale;

        uint256 price = (k * (newSupply ** 2)) / (_scale * _scale) / _scale;
        return price > 0 ? price : _scale;
    }

    receive() external payable {
        buy(buyPrice(circulatingSupply()));
    }
}
