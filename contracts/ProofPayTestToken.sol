// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Test token with no monetary value. Six decimals, like common stablecoin units.
contract ProofPayTestToken is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1_000 * 10 ** 6;
    uint256 public constant FAUCET_CAP = 5_000 * 10 ** 6;
    mapping(address => uint256) public faucetMinted;

    error FaucetCap();

    constructor() ERC20("ProofPay Test Token", "tUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet() external {
        if (faucetMinted[msg.sender] + FAUCET_AMOUNT > FAUCET_CAP) revert FaucetCap();
        faucetMinted[msg.sender] += FAUCET_AMOUNT;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
