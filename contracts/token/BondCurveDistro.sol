// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;
import "./interfaces/IERC20.sol";
import "../common/Ownable.sol";
import "../common/SigLib.sol";

contract BondCurveDistro is Ownable {
    address public claimSigner;
    address public rewardToken;
    mapping(address => mapping(uint256 => mapping(uint256 => bool))) public usedClaimNonces;
    mapping(address => uint256) public claims;
    uint256 public devAlloc;
    uint public devFeeBp;
    uint256 public devFeeEthBal;
    uint256 public claimedBalance;
    uint256 public airdropAlloc;
    uint256 public k = 80000000000;
    uint256 public bondingCurveAlloc;
    uint256 public initialBondingCurveAlloc;
    uint256 public bondingCurveEthBal;
    bool public allowTrade = false;
    bool public allowClaim = false;
    bool public allowWithdraw = false;
    bool public allowSell = false;
    bool public allowBuyTransfer = false;
    uint256 scale = 1 ether;

    /// @dev Initialize contract
    /// @param _rewardToken The reward token address
    /// @param _airdropAlloc The airdrop supply
    /// @param _devAlloc The dev supply
    /// @param _bondingCurveAlloc The bonding curve supply
    /// @param _devFeeBp The dev fee in basis points
    constructor(address _rewardToken, uint256 _airdropAlloc, uint256 _devAlloc, uint256 _bondingCurveAlloc, uint256 _devFeeBp) {
        rewardToken = _rewardToken;
        bondingCurveAlloc = _bondingCurveAlloc;
        initialBondingCurveAlloc = _bondingCurveAlloc;
        devAlloc = _devAlloc;
        devFeeBp = _devFeeBp;
        airdropAlloc = _airdropAlloc;
    }

    event Claimed(address addr, uint claimId, uint nonce, uint256 allocation);
    event ClaimWithdrawn(address addr, uint256 amount);
    event WithdrawnToken(address beneficiary, uint256 amount);
    event AllowTrade(bool allowTrade);
    event AllowSell(bool allowSell);
    event AllowClaim(bool allowClaim);
    event AllowWithdraw(bool allowWithdraw);
    event AllowBuyTransfer(bool allowBuyTransfer);
    event Buy(address buyer, uint256 input, uint256 output, uint256 fee);
    event Sell(address seller, uint256 input, uint256 output, uint256 fee);
    event UpdatedDevFeeBp(uint devFeeBp);
    event WithdrawnEth(address beneficiary, uint256 amount);
    event WithdrawnDevFee(address beneficiary, uint256 amount);
    event ReInitialized(
        address rewardToken,
        uint256 airdropAlloc,
        uint256 devAlloc,
        uint256 bondingCurveAlloc,
        uint256 devFeeBp,
        uint256 k
    );
    event ClaimSignerUpdated(address newSigner, address oldSigner);

    /// @notice Reinitialize the contract
    /// @param _rewardToken The reward token address
    /// @param _airdropAlloc The airdrop supply
    /// @param _devAlloc The dev supply
    /// @param _bondingCurveAlloc The bonding curve supply
    /// @param _devFeeBp The dev fee in basis points
    /// @param _k The k value
    function reInit(
        address _rewardToken,
        uint256 _airdropAlloc,
        uint256 _devAlloc,
        uint256 _bondingCurveAlloc,
        uint256 _devFeeBp,
        uint256 _k
    ) public onlyOwner {
        rewardToken = _rewardToken;
        airdropAlloc = _airdropAlloc;
        devAlloc = _devAlloc;
        initialBondingCurveAlloc = _bondingCurveAlloc;
        bondingCurveAlloc = _bondingCurveAlloc;
        devFeeBp = _devFeeBp;
        k = _k;
        emit ReInitialized(_rewardToken, _airdropAlloc, _devAlloc, _bondingCurveAlloc, _devFeeBp, _k);
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

    /// @notice Set the claim signer
    /// @param _claimSigner The claim signer address
    function setClaimSigner(address _claimSigner) public onlyOwner {
        emit ClaimSignerUpdated(_claimSigner, claimSigner);
        claimSigner = _claimSigner;
    }

    /// @notice Set the dev fee in basis points
    /// @param _devFeeBp The dev fee in basis points
    function setDevFeeBp(uint _devFeeBp) public onlyOwner {
        require(_devFeeBp <= 1000, "FEE_TOO_HIGH");
        devFeeBp = _devFeeBp;
        emit UpdatedDevFeeBp(devFeeBp);
    }

    function claim(uint256 amount, uint claimId, uint nonce, bytes memory sig) public {
        require(allowClaim, "CLAIM_NOT_ALLOWED");
        require(verifyClaimSig(claimSigner, msg.sender, amount, claimId, nonce, sig), "INVALID_SIG");

        // check if the nonce is used for the sender
        require(!usedClaimNonces[msg.sender][claimId][nonce], "NONCE_USED");
        usedClaimNonces[msg.sender][claimId][nonce] = true;

        // Increment claimed balance
        claimedBalance += amount;
        require(claimedBalance <= airdropAlloc, "CLAIM_ALLOC_EXCEEDED");

        claims[msg.sender] += amount;
        emit Claimed(msg.sender, claimId, nonce, amount);
    }

    /// @notice Verify a claim signature
    /// @param signer The market manager's address
    /// @param beneficiary The beneficiary address
    /// @param amount The amount to claim
    /// @param claimId The claim id
    /// @param nonce The nonce
    /// @param signature The signature created by the manager
    function verifyClaimSig(
        address signer,
        address beneficiary,
        uint256 amount,
        uint claimId,
        uint nonce,
        bytes memory signature
    ) internal view returns (bool) {
        if (address(0) == signer) return false;
        bytes32 messageHash = keccak256(abi.encode(block.chainid, beneficiary, amount, claimId, nonce));
        bytes32 ethSignedMessageHash = SigLib.getSignedMessageHash(messageHash);
        return SigLib.recoverSigner(ethSignedMessageHash, signature) == signer;
    }

    /// @notice Verify and claim multiple rewards
    /// @param signatures The signatures
    /// @param nonces The nonces
    /// @param allocations The allocations
    function claimMulti(bytes[] memory signatures, uint[] memory claimIds, uint[] memory nonces, uint256[] memory allocations) public {
        for (uint i = 0; i < signatures.length; i++) {
            claim(allocations[i], claimIds[i], nonces[i], signatures[i]);
        }
    }

    /// @notice Withdraw a claim
    function withdrawClaim() public {
        require(allowWithdraw, "WITHDRAW_NOT_ALLOWED");
        uint256 amount = claims[msg.sender];
        claims[msg.sender] = 0;
        IERC20(rewardToken).transfer(msg.sender, amount);
        emit ClaimWithdrawn(msg.sender, amount);
    }

    /// @notice Withdraw all tokens from the contract
    /// @param beneficiary The beneficiary address
    function withdrawToken(address beneficiary) public onlyOwner {
        require(beneficiary != address(0), "INVALID_BENEFICIARY");
        uint256 amount = IERC20(rewardToken).balanceOf(address(this));
        IERC20(rewardToken).transfer(beneficiary, amount);
        emit WithdrawnToken(beneficiary, amount);
    }

    /// @notice Withdraw all ETH from the contract
    function withdrawEth(address beneficiary) public onlyOwner {
        require(beneficiary != address(0), "INVALID_BENEFICIARY");
        uint256 amount = address(this).balance;
        emit WithdrawnEth(beneficiary, amount);
        payable(beneficiary).transfer(amount);
    }

    /// @notice Withdraw all dev fee from the contract
    function withdrawDevFee(address beneficiary) public onlyOwner {
        require(beneficiary != address(0), "INVALID_BENEFICIARY");
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

        uint256 amount = (value * scale) / price;
        require(amount <= bondingCurveAlloc, "INSUFFICIENT_ALLOC");
        bondingCurveAlloc -= amount;
        bondingCurveEthBal += value;

        if (allowBuyTransfer) {
            IERC20(rewardToken).transfer(msg.sender, amount);
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

        uint256 value = (amount * price) / scale;

        bondingCurveAlloc += amount;
        bondingCurveEthBal -= value;

        uint256 devFee = (value * devFeeBp) / 10000;
        devFeeEthBal += devFee;
        value = value - devFee;

        payable(msg.sender).transfer(value);
        IERC20(rewardToken).transferFrom(msg.sender, address(this), amount);

        emit Sell(msg.sender, amount, value, devFee);
    }

    /// @notice Get the buy price
    /// @param supply The supply
    function buyPrice(uint256 supply) public view returns (uint256) {
        if (supply <= 0) return 0;
        return (k * (supply ** 2)) / (scale * scale) / scale;
    }

    /// @notice Get the sell price
    /// @param supply The supply
    /// @param amountToSell The amount to sell
    function sellPrice(uint256 supply, uint256 amountToSell) public view returns (uint256) {
        require(supply >= amountToSell, "INSUFFICIENT_SUPPLY");
        if (supply <= 0 || amountToSell <= 0) return 0;

        uint256 newSupply = supply - amountToSell;
        if (newSupply == 0) return scale;

        uint256 price = (k * (newSupply ** 2)) / (scale * scale) / scale;
        return price > 0 ? price : scale;
    }

    receive() external payable {
        buy(buyPrice(circulatingSupply()));
    }
}
