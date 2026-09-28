// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// Test double that can return false from transfers. Not a product token.
contract FalseReturnToken {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public fail;

    function faucet() external {
        balanceOf[msg.sender] += 1_000 * 10 ** 6;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (fail) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (fail) return false;
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) return false;
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function setFail(bool next) external {
        fail = next;
    }
}
